import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  DEPTH_MM,
  HEIGHT_MM,
  PANEL_MM,
  fmtCm,
  generateBooks,
  type Finish,
  type LibraryLayout,
  type LibraryState,
} from '../lib/design';
import { makeWoodTexture } from '../lib/texture';

const ACCENT = '#2e6bff';
const H = HEIGHT_MM / 1000;
const D = DEPTH_MM / 1000;
const T = PANEL_MM / 1000;
const MAX_BOOKS = 1800;

/**
 * Stage framing per aspect: on portrait screens the control panel
 * covers the lower half, and on landscape screens it sits bottom-centre —
 * either way the bookcase is lifted and the camera aimed low so the
 * whole case plays in the free area above the panel.
 */
function stageFor(aspect: number): { stageY: number; targetY: number; factor: number } {
  if (aspect < 0.75) return { stageY: 0.34, targetY: 0.62, factor: 1.18 };
  if (aspect < 1.05) return { stageY: 0.16, targetY: 0.72, factor: 1.3 };
  if (aspect < 1.7) return { stageY: 0.12, targetY: 0.6, factor: 1.32 };
  // Very short wide screens (landscape phones, social-card frames):
  // pull back so the whole case still reads above the panel.
  return { stageY: 0.1, targetY: 0.5, factor: 1.6 };
}

interface SceneProps {
  state: LibraryState;
  layout: LibraryLayout;
  finish: Finish;
  onSelectBay: (index: number) => void;
  onInteract: () => void;
  onDragStart: () => void;
  onDragTo: (dividerIndex: number, deltaMm: number) => void;
  onDragEnd: () => void;
}

/* ------------------------------------------------------------------ */
/* Damped layout animation (same approach as Zoning Studio): the mm   */
/* layout is mirrored into a mutable ref and damped toward the        */
/* engine's target every frame, so panels glide instead of snapping.  */
/* ------------------------------------------------------------------ */

interface AnimRow {
  y: number;
  height: number;
}
interface AnimBay {
  x: number;
  width: number;
  rows: AnimRow[];
}
interface AnimState {
  widthMm: number;
  bays: AnimBay[];
}

function snapshot(layout: LibraryLayout, state: LibraryState): AnimState {
  return {
    widthMm: state.widthMm,
    bays: layout.bays.map((b) => ({
      x: b.x / 1000,
      width: b.width / 1000,
      rows: b.rows.map((r) => ({ y: r.y / 1000, height: r.height / 1000 })),
    })),
  };
}

const LAMBDA = 11;
const SNAP = 0.00002;

function dampTo(cur: number, target: number, delta: number, snap: boolean): number {
  if (snap || Math.abs(target - cur) < SNAP) return target;
  return THREE.MathUtils.damp(cur, target, LAMBDA, delta);
}

function stepToward(cur: AnimState, target: AnimState, delta: number, snap: boolean) {
  cur.widthMm = dampTo(cur.widthMm, target.widthMm, delta, snap);
  const shared = Math.min(cur.bays.length, target.bays.length);
  for (let i = 0; i < shared; i++) {
    const c = cur.bays[i];
    const t = target.bays[i];
    c.x = dampTo(c.x, t.x, delta, snap);
    c.width = dampTo(c.width, t.width, delta, snap);
    const zShared = Math.min(c.rows.length, t.rows.length);
    for (let j = 0; j < zShared; j++) {
      c.rows[j].y = dampTo(c.rows[j].y, t.rows[j].y, delta, snap);
      c.rows[j].height = dampTo(c.rows[j].height, t.rows[j].height, delta, snap);
    }
    if (c.rows.length < t.rows.length) {
      for (let j = c.rows.length; j < t.rows.length; j++) c.rows.push({ ...t.rows[j] });
    } else if (c.rows.length > t.rows.length) {
      c.rows.length = t.rows.length;
    }
  }
  if (cur.bays.length < target.bays.length) {
    for (let i = cur.bays.length; i < target.bays.length; i++) {
      const t = target.bays[i];
      cur.bays.push({ x: t.x, width: t.width, rows: t.rows.map((r) => ({ ...r })) });
    }
  } else if (cur.bays.length > target.bays.length) {
    cur.bays.length = target.bays.length;
  }
}

/* ------------------------------------------------------------------ */

interface BookcaseProps extends SceneProps {
  woodMaterial: THREE.Material;
  backMaterial: THREE.Material;
  accentMaterial: THREE.Material;
  hitMaterial: THREE.Material;
}

function Bookcase(props: BookcaseProps) {
  const { state, layout, onSelectBay, onInteract, onDragStart, onDragTo, onDragEnd } = props;
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const { stageY } = stageFor(aspect);

  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const anim = useRef<AnimState>(snapshot(layout, state));
  const [, setTick] = useState(0);
  const [hoveredDivider, setHoveredDivider] = useState<number | null>(null);
  const [activeDivider, setActiveDivider] = useState<number | null>(null);
  const dragRef = useRef<{ divider: number; startMm: number } | null>(null);
  const booksRef = useRef<THREE.InstancedMesh>(null!);

  const books = useMemo(() => generateBooks(layout), [layout]);
  const bookCount = useMemo(
    () => books.reduce((a, bay) => a + bay.reduce((x, row) => x + row.length, 0), 0),
    [books],
  );

  // Book colours are set once per generated layout; matrices follow the
  // animated geometry every frame.
  useEffect(() => {
    const mesh = booksRef.current;
    if (!mesh) return;
    const color = new THREE.Color();
    let k = 0;
    for (const bay of books) {
      for (const row of bay) {
        for (const book of row) {
          if (k >= MAX_BOOKS) break;
          mesh.setColorAt(k, color.set(book.color));
          k += 1;
        }
      }
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [books]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((_, delta) => {
    const target = snapshot(layout, state);
    const before = JSON.stringify(anim.current);
    stepToward(anim.current, target, Math.min(delta, 0.05), reducedMotion);
    if (JSON.stringify(anim.current) !== before) setTick((n) => n + 1);

    // Books ride the animated geometry.
    const mesh = booksRef.current;
    if (mesh) {
      const a = anim.current;
      const W = a.widthMm / 1000;
      let k = 0;
      books.forEach((bayBooks, bi) => {
        const animBay = a.bays[bi];
        const targetBay = layout.bays[bi];
        if (!animBay || !targetBay) return;
        const ratio = targetBay.width > 0 ? (animBay.width * 1000) / targetBay.width : 1;
        bayBooks.forEach((rowBooks, ri) => {
          const animRow = animBay.rows[ri];
          if (!animRow) return;
          const baseY = T + animRow.y;
          for (const book of rowBooks) {
            if (k >= MAX_BOOKS) break;
            const wMm = book.w * ratio;
            const cx = -W / 2 + animBay.x + (book.offsetX * ratio + wMm / 2) / 1000;
            const halfH = book.h / 2000;
            const lean = book.lean;
            dummy.position.set(
              cx + Math.sin(lean) * halfH,
              baseY + book.offsetY / 1000 + Math.cos(lean) * halfH,
              -D / 2 + 0.012 + book.d / 2000 + 0.004,
            );
            dummy.rotation.set(0, 0, -lean);
            dummy.scale.set(wMm / 1000, book.h / 1000, book.d / 1000);
            dummy.updateMatrix();
            mesh.setMatrixAt(k, dummy.matrix);
            k += 1;
          }
        });
      });
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  const a = anim.current;
  const W = a.widthMm / 1000;
  const toX = (mFromLeft: number) => -W / 2 + mFromLeft;
  const innerH = H - 2 * T;

  /** Pointer x in mm from the bookcase's left edge, via the front plane. */
  const pointerMm = (e: ThreeEvent<PointerEvent>): number | null => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -D / 2);
    const point = new THREE.Vector3();
    if (!e.ray.intersectPlane(plane, point)) return null;
    return (point.x + state.widthMm / 2000) * 1000;
  };

  const handleDown = (divider: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onInteract();
    const mm = pointerMm(e);
    if (mm === null) return;
    dragRef.current = { divider, startMm: mm };
    setActiveDivider(divider);
    if (controls) controls.enabled = false;
    (e.target as unknown as { setPointerCapture?: (id: number) => void }).setPointerCapture?.(
      e.pointerId,
    );
    onDragStart();
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const mm = pointerMm(e);
    if (mm === null) return;
    onDragTo(drag.divider, mm - drag.startMm);
  };

  const handleUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setActiveDivider(null);
    if (controls) controls.enabled = true;
    onDragEnd();
  };

  const shownDivider = activeDivider ?? hoveredDivider;
  const shownBay = shownDivider !== null ? layout.bays[shownDivider] : undefined;
  const shownNext = shownDivider !== null ? layout.bays[shownDivider + 1] : undefined;
  const shownAnimBay = shownDivider !== null ? a.bays[shownDivider] : undefined;

  return (
    <group position={[0, stageY, 0]}>
      {/* Floor shadow catcher is ContactShadows (below); carcass: */}
      {/* Bottom + top panels */}
      <mesh position={[0, T / 2, 0]} material={props.woodMaterial} castShadow receiveShadow>
        <boxGeometry args={[W, T, D]} />
      </mesh>
      <mesh position={[0, H - T / 2, 0]} material={props.woodMaterial} castShadow receiveShadow>
        <boxGeometry args={[W, T, D]} />
      </mesh>
      {/* Sides */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (W / 2 - T / 2), H / 2, 0]}
          material={props.woodMaterial}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[T, innerH, D]} />
        </mesh>
      ))}
      {/* Back panel */}
      <mesh position={[0, H / 2, -D / 2 + 0.006]} material={props.backMaterial} receiveShadow>
        <boxGeometry args={[W - 2 * T, innerH, 0.012]} />
      </mesh>

      {a.bays.map((bay, bi) => {
        const targetBay = layout.bays[bi];
        const centerX = toX(bay.x + bay.width / 2);
        const isSelected = state.selectedBay === bi;
        return (
          <group key={bi}>
            {/* Selected-bay tint on the back panel */}
            {isSelected && (
              <mesh position={[centerX, H / 2, -D / 2 + 0.013]}>
                <planeGeometry args={[Math.max(bay.width, 0.01), innerH]} />
                <meshBasicMaterial color={ACCENT} transparent opacity={0.13} depthWrite={false} />
              </mesh>
            )}
            {/* Bay click target (select this bay) */}
            <mesh
              position={[centerX, H / 2, -D / 2 + 0.02]}
              material={props.hitMaterial}
              onClick={(e) => {
                if (e.delta > 6) return;
                e.stopPropagation();
                onInteract();
                onSelectBay(bi);
              }}
            >
              <boxGeometry args={[Math.max(bay.width, 0.01), innerH, 0.01]} />
            </mesh>

            {/* Shelf boards between this bay's rows */}
            {bay.rows.slice(1).map((row, ri) => (
              <mesh
                key={ri}
                position={[centerX, T + row.y - T / 2, -0.012]}
                material={props.woodMaterial}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[Math.max(bay.width, 0.001), T, D - 0.024]} />
              </mesh>
            ))}

            {/* Divider after this bay (+ drag handle hitbox) */}
            {bi < a.bays.length - 1 && (
              <>
                <mesh
                  position={[toX(bay.x + bay.width) + T / 2, H / 2, -0.012]}
                  material={shownDivider === bi ? props.accentMaterial : props.woodMaterial}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[T, innerH, D - 0.024]} />
                </mesh>
                <mesh
                  position={[toX(bay.x + bay.width) + T / 2, H / 2, D / 2 - 0.05]}
                  material={props.hitMaterial}
                  onPointerDown={handleDown(bi)}
                  onPointerMove={handleMove}
                  onPointerUp={handleUp}
                  onPointerOver={(e) => {
                    e.stopPropagation();
                    setHoveredDivider(bi);
                    document.body.style.cursor = 'ew-resize';
                  }}
                  onPointerOut={() => {
                    if (activeDivider === null) setHoveredDivider(null);
                    document.body.style.cursor = 'auto';
                  }}
                >
                  <boxGeometry args={[0.07, innerH, 0.1]} />
                </mesh>
              </>
            )}
            {targetBay === undefined && null}
          </group>
        );
      })}

      {/* Books (single instanced draw) */}
      <instancedMesh
        ref={booksRef}
        args={[undefined, undefined, MAX_BOOKS]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.82} metalness={0.02} />
      </instancedMesh>

      {/* Drag handle + live widths, on the hovered/dragged divider */}
      {shownDivider !== null && shownAnimBay && (
        <Html
          position={[toX(shownAnimBay.x + shownAnimBay.width) + T / 2, H * 0.52, D / 2 + 0.03]}
          center
          zIndexRange={[30, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="drag-handle" aria-hidden="true">
            <span>‹</span>
            <span>›</span>
          </div>
          {activeDivider !== null && shownBay && shownNext && (
            <div className="drag-label" aria-hidden="true">
              {fmtCm(shownBay.width)} · {fmtCm(shownNext.width)} cm
            </div>
          )}
        </Html>
      )}

      <ContactShadows position={[0, 0.005, 0]} opacity={0.42} scale={11} blur={2.6} far={2.6} color="#4a3418" />
    </group>
  );
}

/* ------------------------------------------------------------------ */

/** Frame the bookcase on mount / width change, until the user orbits. */
function CameraRig({ widthMm }: { widthMm: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
    addEventListener: (ev: string, fn: () => void) => void;
  } | null;
  const size = useThree((s) => s.size);
  const userMoved = useRef(false);

  useEffect(() => {
    if (!controls) return;
    const mark = () => {
      userMoved.current = true;
    };
    controls.addEventListener('start', mark);
    return () => {
      (controls as unknown as { removeEventListener?: (ev: string, fn: () => void) => void })
        .removeEventListener?.('start', mark);
    };
  }, [controls]);

  useEffect(() => {
    if (userMoved.current || !controls) return;
    const aspect = size.width / Math.max(1, size.height);
    const { stageY, targetY, factor } = stageFor(aspect);
    const widthM = widthMm / 1000;
    const vfov = THREE.MathUtils.degToRad(40);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fitW = widthM / 2 / Math.tan(hfov / 2);
    const fitH =
      Math.max(stageY + H - targetY, targetY - stageY) / Math.tan(vfov / 2);
    const dist = THREE.MathUtils.clamp(Math.max(fitW, fitH) * factor + 0.5, 3.4, 12.5);
    const dir = new THREE.Vector3(0.42, 0.3, 1).normalize();
    camera.position.copy(dir.multiplyScalar(dist).add(new THREE.Vector3(0, targetY, 0)));
    controls.target.set(0, targetY, 0);
    controls.update();
  }, [camera, controls, size, widthMm]);

  return null;
}

/* ------------------------------------------------------------------ */

export default function Scene(props: SceneProps) {
  const { finish } = props;
  const woodTexture = useMemo(() => makeWoodTexture(finish), [finish]);
  const woodMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: woodTexture,
        roughness: finish.roughness,
        metalness: 0.04,
      }),
    [woodTexture, finish],
  );
  const backMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(finish.base).multiplyScalar(0.52),
        roughness: 0.92,
      }),
    [finish],
  );
  const accentMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: ACCENT,
        roughness: 0.38,
        emissive: new THREE.Color(ACCENT),
        emissiveIntensity: 0.3,
      }),
    [],
  );
  const hitMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      }),
    [],
  );

  useEffect(() => () => woodTexture.dispose(), [woodTexture]);
  useEffect(() => () => woodMaterial.dispose(), [woodMaterial]);
  useEffect(() => () => backMaterial.dispose(), [backMaterial]);
  useEffect(() => () => accentMaterial.dispose(), [accentMaterial]);
  useEffect(() => () => hitMaterial.dispose(), [hitMaterial]);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [2.9, 2.1, 5.4], fov: 40 }}
      style={{
        background:
          'radial-gradient(120% 90% at 50% 18%, #f8eedb 0%, #f0e1c4 55%, #e2cd9f 100%)',
      }}
    >
      <ambientLight intensity={0.75} />
      <directionalLight
        position={[4.5, 6.5, 5]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-3}
      />
      <directionalLight position={[-5, 3, 3]} intensity={0.35} color="#ffe3b3" />
      <directionalLight position={[0, 2, -4]} intensity={0.18} color="#cfe0ff" />

      <Bookcase
        {...props}
        woodMaterial={woodMaterial}
        backMaterial={backMaterial}
        accentMaterial={accentMaterial}
        hitMaterial={hitMaterial}
      />
      <CameraRig widthMm={props.state.widthMm} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1.6}
        maxDistance={13}
        maxPolarAngle={Math.PI * 0.55}
      />
    </Canvas>
  );
}
