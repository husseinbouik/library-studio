import { processLindiv } from '../engine/processLinDiv';
import { EvaluationErrors } from '../engine/types';

/**
 * The Library — design model.
 *
 * Every division in this app is computed by Hussein Bouik's own
 * linear-zone-divider engine (`src/engine`, vendored verbatim from his
 * library — the same copy Zoning Studio ships):
 *
 *   - the engine divides the bookcase's clear interior WIDTH into bays
 *     (a ratio formula: one section per bay);
 *   - each bay then runs the engine again on the clear interior HEIGHT
 *     with an equal formula to place its shelf rows;
 *   - "Linear division" is the engine doing what it is named for: an
 *     equal-ratio formula applied in one action, horizontally or
 *     vertically.
 *
 * The engine returns *clear openings*: panel thickness sits between
 * zones, so sum(zones) + (count - 1) * thickness === total length.
 *
 * Bay weights are stored as integers ≈ the bays' clear widths in mm.
 * Because the engine distributes the clear length proportionally to the
 * ratio sections, feeding the current clear widths back as weights makes
 * the engine reproduce them exactly — which is what makes divider
 * dragging precise: a drag rewrites the two neighbouring weights.
 */

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

/** Carcass side, divider and shelf thickness in mm (the engine's t). */
export const PANEL_MM = 18;
/** Overall bookcase height in mm (fixed). */
export const HEIGHT_MM = 2100;
/** Bookcase depth in mm. */
export const DEPTH_MM = 320;
export const MIN_WIDTH_MM = 1800;
export const MAX_WIDTH_MM = 3600;
export const MIN_BAYS = 1;
export const MAX_BAYS = 8;
/** A bay may not be dragged or split below this clear width (mm). */
export const MIN_BAY_MM = 240;
export const MAX_SHELVES = 6;
export const DEFAULT_SHELVES = 2;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export interface LibraryState {
  /** Overall width in mm (1800–3600). */
  widthMm: number;
  /** One integer ratio weight per bay (≈ clear width in mm). */
  weights: number[];
  /** Shelf count per bay (rows = shelves + 1). */
  shelvesPerBay: number[];
  selectedBay: number;
  finishId: string;
}

export const INITIAL_STATE: LibraryState = {
  widthMm: 2400,
  weights: [776, 776, 776],
  shelvesPerBay: [3, 2, 3],
  selectedBay: 1,
  finishId: 'oak',
};

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export interface RowLayout {
  /** Distance from the interior's bottom edge to this row's bottom, mm. */
  y: number;
  /** Clear opening height in mm. */
  height: number;
}

export interface BayLayout {
  index: number;
  /** Distance from the bookcase's left edge to this bay's left edge, mm. */
  x: number;
  /** Clear opening width in mm (the engine's output). */
  width: number;
  /** Rows ordered bottom-up (rows[0] sits on the bottom panel). */
  rows: RowLayout[];
  error?: string;
}

export interface LibraryLayout {
  bays: BayLayout[];
  innerWidthMm: number;
  innerHeightMm: number;
  error?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Run the engine and normalise its result to { values } or { error }. */
function runEngine(
  formula: string,
  totalLength: number,
  dividerThickness: number,
): { values: number[] } | { error: string } {
  const result = processLindiv(formula, totalLength, dividerThickness);
  if (result instanceof EvaluationErrors) {
    return { error: result.message.replace(/^Evaluation Error:\s*/, '') };
  }
  if (!Array.isArray(result)) {
    return { error: 'The engine did not return a division.' };
  }
  return { values: result.map(round2) };
}

/** Build an equal-ratio formula with `count` sections, e.g. 3 -> "1:1:1". */
export function equalFormula(count: number): string {
  return Array.from({ length: Math.max(1, count) }, () => '1').join(':');
}

/** Compute the full layout for a state. Never throws. */
export function computeLayout(state: LibraryState): LibraryLayout {
  const innerWidthMm = state.widthMm - 2 * PANEL_MM;
  const innerHeightMm = HEIGHT_MM - 2 * PANEL_MM;

  const vertical = runEngine(state.weights.join(':'), innerWidthMm, PANEL_MM);
  if ('error' in vertical) {
    return { bays: [], innerWidthMm, innerHeightMm, error: vertical.error };
  }

  const bays: BayLayout[] = [];
  let x = PANEL_MM;
  vertical.values.forEach((bayWidth, i) => {
    const shelves = state.shelvesPerBay[i] ?? DEFAULT_SHELVES;
    const horizontal = runEngine(equalFormula(shelves + 1), innerHeightMm, PANEL_MM);
    const rows: RowLayout[] = [];
    let error: string | undefined;
    if ('error' in horizontal) {
      error = horizontal.error;
    } else {
      // Engine order is top-first; convert to bottom-up rows.
      let yTop = innerHeightMm;
      const topFirst: RowLayout[] = horizontal.values.map((h) => {
        yTop -= h;
        const row = { y: round2(yTop), height: h };
        yTop -= PANEL_MM;
        return row;
      });
      rows.push(...topFirst.reverse());
    }
    bays.push({ index: i, x: round2(x), width: bayWidth, rows, error });
    x += bayWidth + PANEL_MM;
  });

  return { bays, innerWidthMm, innerHeightMm };
}

/* ------------------------------------------------------------------ */
/* Weight helpers                                                      */
/* ------------------------------------------------------------------ */

/** Integer weights, proportional to `widths`, summing exactly to `total`. */
export function integerWeights(widths: number[], total: number): number[] {
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum <= 0 || widths.length === 0) return widths.map(() => Math.max(1, Math.round(total / Math.max(1, widths.length))));
  const raw = widths.map((w) => (w / sum) * total);
  const out = raw.map((v) => Math.max(1, Math.floor(v)));
  let drift = Math.round(total) - out.reduce((a, b) => a + b, 0);
  // Hand the rounding remainder to the largest fractional parts.
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (drift > 0 && order.length > 0) {
    out[order[k % order.length].i] += 1;
    drift -= 1;
    k += 1;
  }
  while (drift < 0) {
    const idx = out.indexOf(Math.max(...out));
    out[idx] -= 1;
    drift += 1;
  }
  return out;
}

const clampBay = (i: number, count: number) => Math.min(Math.max(0, i), Math.max(0, count - 1));

/* ------------------------------------------------------------------ */
/* Editing actions (all pure: state in, state out)                     */
/* ------------------------------------------------------------------ */

export function withWidth(state: LibraryState, widthMm: number): LibraryState {
  const clamped = Math.min(MAX_WIDTH_MM, Math.max(MIN_WIDTH_MM, Math.round(widthMm)));
  if (clamped === state.widthMm) return state;
  const layout = computeLayout(state);
  const clearTotal = clamped - 2 * PANEL_MM - (state.weights.length - 1) * PANEL_MM;
  const current = layout.bays.length === state.weights.length
    ? layout.bays.map((b) => b.width)
    : state.weights;
  return { ...state, widthMm: clamped, weights: integerWeights(current, clearTotal) };
}

export function addBay(state: LibraryState): LibraryState {
  if (state.weights.length >= MAX_BAYS) return state;
  const avg = Math.round(state.weights.reduce((a, b) => a + b, 0) / state.weights.length);
  return {
    ...state,
    weights: [...state.weights, Math.max(1, avg)],
    shelvesPerBay: [...state.shelvesPerBay, DEFAULT_SHELVES],
  };
}

export function removeBay(state: LibraryState, index: number): LibraryState {
  if (state.weights.length <= MIN_BAYS) return state;
  const i = clampBay(index, state.weights.length);
  return {
    ...state,
    weights: state.weights.filter((_, k) => k !== i),
    shelvesPerBay: state.shelvesPerBay.filter((_, k) => k !== i),
    selectedBay: clampBay(state.selectedBay, state.weights.length - 1),
  };
}

export function withShelves(state: LibraryState, bay: number, shelves: number): LibraryState {
  const i = clampBay(bay, state.weights.length);
  const clamped = Math.min(MAX_SHELVES, Math.max(0, Math.round(shelves)));
  return {
    ...state,
    shelvesPerBay: state.shelvesPerBay.map((s, k) => (k === i ? clamped : s)),
  };
}

/** Split bay `index` into two bays at its midpoint. */
export function splitBay(state: LibraryState, layout: LibraryLayout, index: number): LibraryState {
  if (state.weights.length >= MAX_BAYS) return state;
  const i = clampBay(index, state.weights.length);
  const bay = layout.bays[i];
  // The new divider's thickness comes out of the split bay itself, so
  // every other bay keeps its exact width.
  if (!bay || bay.width - PANEL_MM < 2 * MIN_BAY_MM) return state;
  const usable = Math.round(bay.width - PANEL_MM);
  const a = Math.floor(usable / 2);
  const b = usable - a;
  const weights = [...state.weights];
  weights.splice(i, 1, a, b);
  const shelves = [...state.shelvesPerBay];
  shelves.splice(i, 1, shelves[i] ?? DEFAULT_SHELVES, shelves[i] ?? DEFAULT_SHELVES);
  return { ...state, weights, shelvesPerBay: shelves, selectedBay: i };
}

/** Merge bay `index` with its right neighbour (or left, if it is last). */
export function mergeBay(state: LibraryState, layout: LibraryLayout, index: number): LibraryState {
  const n = state.weights.length;
  if (n <= MIN_BAYS) return state;
  const i = clampBay(index, n);
  const left = i < n - 1 ? i : i - 1;
  const a = layout.bays[left];
  const b = layout.bays[left + 1];
  if (!a || !b) return state;
  // The removed divider's thickness becomes clear width.
  const merged = Math.round(a.width + b.width + PANEL_MM);
  const weights = [...state.weights];
  weights.splice(left, 2, merged);
  const shelves = [...state.shelvesPerBay];
  shelves.splice(left, 2, shelves[left] ?? DEFAULT_SHELVES);
  return { ...state, weights, shelvesPerBay: shelves, selectedBay: left };
}

/**
 * Rewrite the two weights around divider `dividerIndex` so the engine
 * moves that divider by `deltaMm` (positive = right). The pair's total
 * is preserved and both bays respect MIN_BAY_MM.
 */
export function dragDivider(
  state: LibraryState,
  layout: LibraryLayout,
  dividerIndex: number,
  deltaMm: number,
): LibraryState {
  const left = layout.bays[dividerIndex];
  const right = layout.bays[dividerIndex + 1];
  if (!left || !right) return state;
  const pair = left.width + right.width;
  const newLeft = Math.min(pair - MIN_BAY_MM, Math.max(MIN_BAY_MM, left.width + deltaMm));
  const newLeftInt = Math.round(newLeft);
  const newRightInt = Math.round(pair) - newLeftInt;
  if (newRightInt < 1) return state;
  const weights = [...state.weights];
  weights[dividerIndex] = newLeftInt;
  weights[dividerIndex + 1] = newRightInt;
  return { ...state, weights };
}

/* ------------------------------------------------------------------ */
/* Linear division — the engine's signature move                       */
/* ------------------------------------------------------------------ */

/** Divide the whole width into `n` equal bays (equal-ratio formula). */
export function linearDivideWidth(state: LibraryState, n: number): LibraryState {
  const count = Math.min(MAX_BAYS, Math.max(2, Math.round(n)));
  const shelves: number[] = [];
  for (let i = 0; i < count; i++) shelves.push(state.shelvesPerBay[i] ?? DEFAULT_SHELVES);
  // Weights stay in "≈ clear mm" terms like every other action, so a
  // later split/drag/merge (which write layout-derived mm) stays exact.
  const clearTotal = state.widthMm - 2 * PANEL_MM - (count - 1) * PANEL_MM;
  return {
    ...state,
    weights: integerWeights(Array.from({ length: count }, () => 1), clearTotal),
    shelvesPerBay: shelves,
    selectedBay: clampBay(state.selectedBay, count),
  };
}

/** Divide bay `index`'s width into `n` equal bays, in place. */
export function linearDivideBayWidth(
  state: LibraryState,
  layout: LibraryLayout,
  index: number,
  n: number,
): LibraryState {
  const count = Math.round(n);
  if (count < 2 || state.weights.length + count - 1 > MAX_BAYS) return state;
  const i = clampBay(index, state.weights.length);
  const bay = layout.bays[i];
  if (!bay || bay.width < count * 150) return state;
  // The new dividers' thickness comes out of the divided bay, so the
  // parts sum to (bay width − new dividers) and other bays are unmoved.
  const parts = integerWeights(
    Array.from({ length: count }, () => bay.width / count),
    Math.round(bay.width) - (count - 1) * PANEL_MM,
  );
  const weights = [...state.weights];
  weights.splice(i, 1, ...parts);
  const shelves = [...state.shelvesPerBay];
  shelves.splice(i, 1, ...Array.from({ length: count }, () => shelves[i] ?? DEFAULT_SHELVES));
  return { ...state, weights, shelvesPerBay: shelves, selectedBay: i };
}

/** Divide bay `index`'s height into `n` equal shelf rows. */
export function linearDivideBayHeight(state: LibraryState, index: number, n: number): LibraryState {
  return withShelves(state, index, Math.round(n) - 1);
}

/* ------------------------------------------------------------------ */
/* Books (procedural, seeded — stable per bay/row)                     */
/* ------------------------------------------------------------------ */

export interface BookSpec {
  /** Offset from the row's left edge to the book's left edge, mm. */
  offsetX: number;
  /** Offset from the row's bottom (for horizontal stacks), mm. */
  offsetY: number;
  w: number;
  h: number;
  d: number;
  color: string;
  /** Lean angle in radians (0 = upright). */
  lean: number;
}

const BOOK_PALETTE = [
  '#a44a3f', '#c96f4a', '#d9a441', '#7d8c5c', '#4f6f8f', '#5b7d9e',
  '#8a5a72', '#71563f', '#b08968', '#606c5d', '#94422e', '#33566e',
  '#caa472', '#546e7a',
];

/** Deterministic PRNG so a bay's books never reshuffle between renders. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function booksForRow(
  bayIndex: number,
  rowIndex: number,
  rowWidthMm: number,
  rowHeightMm: number,
): BookSpec[] {
  if (rowHeightMm < 170 || rowWidthMm < 120) return [];
  const rand = mulberry32((bayIndex * 1000 + rowIndex + 1) * 2654435761);
  const books: BookSpec[] = [];
  const maxBookH = Math.min(rowHeightMm - 24, 300);
  const fillTarget = rowWidthMm * (0.55 + rand() * 0.35);
  let x = 6 + rand() * 20;

  while (x < fillTarget && books.length < 40) {
    // Occasionally a horizontal stack instead of a standing group.
    if (rand() < 0.16 && rowWidthMm - x > 260 && rowHeightMm > 210) {
      const stackW = 190 + rand() * 50;
      const count = 2 + Math.floor(rand() * 3);
      let y = 0;
      for (let s = 0; s < count; s++) {
        const h = 26 + rand() * 12;
        books.push({
          offsetX: x + rand() * 6,
          offsetY: y,
          w: stackW - rand() * 14,
          h,
          d: 140 + rand() * 40,
          color: BOOK_PALETTE[Math.floor(rand() * BOOK_PALETTE.length)],
          lean: 0,
        });
        y += h + 1.5;
      }
      x += stackW + 16 + rand() * 40;
      continue;
    }
    const group = 3 + Math.floor(rand() * 7);
    for (let g = 0; g < group && x < fillTarget && books.length < 40; g++) {
      const w = 16 + rand() * 18;
      if (x + w > rowWidthMm - 4) break;
      const h = maxBookH * (0.68 + rand() * 0.3);
      const isLast = g === group - 1;
      const lean = isLast && rand() < 0.3 && fillTarget - x > 70 ? 0.1 + rand() * 0.06 : 0;
      books.push({
        offsetX: x,
        offsetY: 0,
        w,
        h,
        d: 150 + rand() * 60,
        color: BOOK_PALETTE[Math.floor(rand() * BOOK_PALETTE.length)],
        lean,
      });
      x += w + 1.5 + (lean > 0 ? lean * h * 0.8 : 0);
    }
    x += 14 + rand() * 46;
  }
  return books;
}

/**
 * Books for the whole bookcase, indexed [bay][rowFromBottom].
 * One zone is always left empty (the last bay's second row from the
 * bottom, when it has one) so the division itself stays visible.
 */
export function generateBooks(layout: LibraryLayout): BookSpec[][][] {
  const emptyBay = layout.bays.length - 1;
  return layout.bays.map((bay, bi) => {
    const emptyRow = bi === emptyBay && bay.rows.length >= 2 ? 1 : -1;
    return bay.rows.map((row, ri) =>
      ri === emptyRow ? [] : booksForRow(bi, ri, bay.width, row.height),
    );
  });
}

/* ------------------------------------------------------------------ */
/* Wood finishes                                                       */
/* ------------------------------------------------------------------ */

export interface Finish {
  id: string;
  name: string;
  /** Base panel colour. */
  base: string;
  /** Darker grain streak colour used by the procedural texture. */
  grain: string;
  /** Frame / divider colour. */
  frame: string;
  roughness: number;
  swatch: string;
}

export const FINISHES: Finish[] = [
  { id: 'oak', name: 'Natural Oak', base: '#c49a63', grain: '#a67c4a', frame: '#4a3826', roughness: 0.55, swatch: '#c49a63' },
  { id: 'walnut', name: 'Smoked Walnut', base: '#7a5138', grain: '#5d3c27', frame: '#2e2019', roughness: 0.6, swatch: '#7a5138' },
  { id: 'nordic', name: 'Nordic White', base: '#e9e2d4', grain: '#cfc3ab', frame: '#5c554b', roughness: 0.5, swatch: '#e9e2d4' },
];

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** Millimetres -> centimetre label, e.g. 776 -> "77.6", 800 -> "80". */
export function fmtCm(mm: number): string {
  const cm = Math.round(mm) / 10;
  return Number.isInteger(cm) ? `${cm}` : cm.toFixed(1);
}
