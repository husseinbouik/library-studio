import { useMemo, useRef, useState } from 'react';
import Scene from './components/Scene';
import Controls, { type LinearTarget } from './components/Controls';
import {
  FINISHES,
  INITIAL_STATE,
  addBay,
  computeLayout,
  dragDivider,
  fmtCm,
  linearDivideBayHeight,
  linearDivideBayWidth,
  linearDivideWidth,
  mergeBay,
  removeBay,
  splitBay,
  withShelves,
  withWidth,
  type LibraryLayout,
  type LibraryState,
} from './lib/design';

/**
 * Embed mode (?embed=1): render ONLY the 3D scene — no title chip, no
 * control panel, no readouts — for the portfolio card's playable frame.
 * Orbit + divider dragging stay active; the case fills the frame.
 */
const EMBED =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('embed') === '1';

const REPO_URL = 'https://github.com/husseinbouik/library-studio';
const ZONING_URL = 'https://husseinbouik.github.io/zoning-studio/';
const LINKEDIN_URL = 'https://www.linkedin.com/in/hussein-bouik';

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

/** Minimal 2D fallback: bay widths as proportional bars. */
function Fallback2D({ layout }: { layout: LibraryLayout }) {
  const total = layout.bays.reduce((a, b) => a + b.width, 0) || 1;
  return (
    <div className="fallback">
      <p className="fallback-title">This demo needs WebGL for its 3D view.</p>
      <p>Your bookcase division, computed live by the engine:</p>
      <div className="fallback-bays">
        {layout.bays.map((b) => (
          <div
            key={b.index}
            className="fallback-bay"
            style={{ width: `${(b.width / total) * 100}%` }}
          >
            <span>
              Bay {b.index + 1}
              <br />
              {fmtCm(b.width)} cm
            </span>
          </div>
        ))}
      </div>
      <p>
        Try a browser with WebGL enabled, or see the sister demo{' '}
        <a href={ZONING_URL}>Zoning Studio</a>.
      </p>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<LibraryState>(INITIAL_STATE);
  const [interacted, setInteracted] = useState(false);
  const [webglOk] = useState<boolean>(() => supportsWebGL());
  const dragBase = useRef<{ state: LibraryState; layout: LibraryLayout } | null>(null);

  const layout = useMemo(() => computeLayout(state), [state]);
  const finish = FINISHES.find((f) => f.id === state.finishId) ?? FINISHES[0];
  const selected = Math.min(state.selectedBay, Math.max(0, layout.bays.length - 1));

  const patch = (next: LibraryState) => setState(next);

  const handleLinear = (target: LinearTarget, n: number) => {
    setInteracted(true);
    if (target === 'width') patch(linearDivideWidth(state, n));
    else if (target === 'bayWidth') patch(linearDivideBayWidth(state, layout, selected, n));
    else patch(linearDivideBayHeight(state, selected, n));
  };

  return (
    <div className="app">
      <div className="canvas-wrap">
        {webglOk ? (
          <Scene
            state={state}
            layout={layout}
            finish={finish}
            embed={EMBED}
            onSelectBay={(i) => patch({ ...state, selectedBay: i })}
            onInteract={() => setInteracted(true)}
            onDragStart={() => {
              dragBase.current = { state, layout };
            }}
            onDragTo={(divider, deltaMm) => {
              const base = dragBase.current;
              if (base) setState(dragDivider(base.state, base.layout, divider, deltaMm));
            }}
            onDragEnd={() => {
              dragBase.current = null;
            }}
          />
        ) : (
          <Fallback2D layout={layout} />
        )}
      </div>

      {!EMBED && (
        <>
      {/* Title chip */}
      <header className="title-chip">
        <h1>The Library</h1>
        <p className="title-sub">Zone Divider Studio</p>
        <p className="title-author">
          by <a href={LINKEDIN_URL} target="_blank" rel="noreferrer">Hussein Bouik</a>
          {' · '}
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          {' · '}
          <a href={ZONING_URL} target="_blank" rel="noreferrer">Zoning Studio</a>
        </p>
      </header>

      {/* Explore hint — fades after the first interaction */}
      <div className={`hint ${interacted ? 'hint--gone' : ''}`} aria-hidden={interacted}>
        <span className="hint-icon">✥</span> Drag to explore
        <span className="hint-extra">&nbsp;· drag a divider to resize</span>
      </div>

      <div className="bottom-stack">
        {layout.error && <div className="error-pill">Division error: {layout.error}</div>}

        {/* Live per-bay readout (also the bay selector) */}
        <nav className="readout" aria-label="Bay widths in centimetres">
          {layout.bays.map((b) => (
            <button
              key={b.index}
              type="button"
              className={`readout-chip ${selected === b.index ? 'readout-chip--active' : ''}`}
              aria-pressed={selected === b.index}
              aria-label={`Select bay ${b.index + 1}, ${fmtCm(b.width)} centimetres wide`}
              onClick={() => patch({ ...state, selectedBay: b.index })}
            >
              <span className="readout-bay">Bay {b.index + 1}</span>
              <span className="readout-width">{fmtCm(b.width)} cm</span>
            </button>
          ))}
        </nav>

        <Controls
        state={state}
        layout={layout}
        onWidth={(mm) => patch(withWidth(state, mm))}
        onAddBay={() => patch(addBay(state))}
        onRemoveBay={() => patch(removeBay(state, selected))}
        onShelves={(count) => patch(withShelves(state, selected, count))}
        onSplit={() => patch(splitBay(state, layout, selected))}
        onMerge={() => patch(mergeBay(state, layout, selected))}
        onLinear={handleLinear}
        onFinish={(id) => patch({ ...state, finishId: id })}
        />
      </div>
        </>
      )}
    </div>
  );
}
