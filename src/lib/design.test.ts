import { processLindiv } from '../engine/processLinDiv';
import { EvaluationErrors } from '../engine/types';
import {
  HEIGHT_MM,
  INITIAL_STATE,
  PANEL_MM,
  computeLayout,
  dragDivider,
  equalFormula,
  generateBooks,
  linearDivideBayHeight,
  linearDivideBayWidth,
  linearDivideWidth,
  mergeBay,
  splitBay,
  withWidth,
  type LibraryState,
} from './design';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('engine cross-check — same inputs as Zoning Studio, same outputs', () => {
  it('reproduces the values Zoning Studio asserts in its design tests', () => {
    // From zoning-studio/src/lib/design.test.ts (its passing suite).
    expect(processLindiv('1:2:1', 1800, 18)).toEqual([441, 882, 441]);
    expect(processLindiv('1:1', 2100, 18)).toEqual([1041, 1041]);
    expect(processLindiv('100mm:1:100mm', 1800, 18)).toEqual([100, 1564, 100]);
    expect(processLindiv('1', 2064, 18)).toEqual([2064]);
  });

  it('divides equally for every count the UI offers (2–8 sections)', () => {
    for (let n = 2; n <= 8; n++) {
      const r = processLindiv(equalFormula(n), 2364, 18);
      expect(r instanceof EvaluationErrors).toBe(false);
      const values = r as number[];
      expect(values).toHaveLength(n);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.01);
      expect(sum(values) + (n - 1) * 18).toBeCloseTo(2364, 6);
    }
  });

  it('treats large integer sections as ratio weights (the drag path)', () => {
    // Weights are the bays' clear widths in mm; the engine must return
    // them unchanged when they already sum to the clear length.
    expect(processLindiv('843:512:1009', 2400, 18)).toEqual([843, 512, 1009]);
    const r = processLindiv('412:288:300', 2364, 18) as number[];
    expect(sum(r) + 2 * 18).toBeCloseTo(2364, 6);
    expect(r[0]).toBeCloseTo((412 / 1000) * (2364 - 36), 1);
  });
});

describe('computeLayout', () => {
  it('accounts for every panel: bays + sides + dividers === total width', () => {
    const layout = computeLayout(INITIAL_STATE);
    expect(layout.error).toBeUndefined();
    expect(layout.bays).toHaveLength(3);
    const total =
      sum(layout.bays.map((b) => b.width)) + (layout.bays.length + 1) * PANEL_MM;
    expect(total).toBeCloseTo(INITIAL_STATE.widthMm, 6);
  });

  it('divides each bay height into equal rows through the engine', () => {
    const layout = computeLayout(INITIAL_STATE);
    for (const bay of layout.bays) {
      const heights = bay.rows.map((r) => r.height);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.01);
      const total = sum(heights) + (bay.rows.length - 1) * PANEL_MM;
      expect(total).toBeCloseTo(HEIGHT_MM - 2 * PANEL_MM, 6);
      // Bottom-up rows tile the interior without gaps.
      let y = 0;
      for (const row of bay.rows) {
        expect(row.y).toBeCloseTo(y, 6);
        y += row.height + PANEL_MM;
      }
    }
  });

  it('starts from three equal bays', () => {
    const layout = computeLayout(INITIAL_STATE);
    const widths = layout.bays.map((b) => b.width);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.01);
    expect(widths[0]).toBeCloseTo(776, 6);
  });
});

describe('dragDivider', () => {
  it('moves the divider by the requested delta, exactly', () => {
    const layout = computeLayout(INITIAL_STATE);
    const next = dragDivider(INITIAL_STATE, layout, 0, 120);
    const after = computeLayout(next);
    expect(after.bays[0].width).toBeCloseTo(layout.bays[0].width + 120, 0);
    expect(after.bays[1].width).toBeCloseTo(layout.bays[1].width - 120, 0);
    expect(after.bays[2].width).toBeCloseTo(layout.bays[2].width, 0);
  });

  it('clamps at the minimum bay width', () => {
    const layout = computeLayout(INITIAL_STATE);
    const next = dragDivider(INITIAL_STATE, layout, 0, 100000);
    const after = computeLayout(next);
    expect(after.bays[1].width).toBeGreaterThanOrEqual(239);
    expect(after.bays[0].width + after.bays[1].width).toBeCloseTo(
      layout.bays[0].width + layout.bays[1].width,
      0,
    );
  });
});

describe('classical editing', () => {
  it('splitBay halves a bay and mergeBay restores it', () => {
    const layout = computeLayout(INITIAL_STATE);
    const split = splitBay(INITIAL_STATE, layout, 1);
    expect(split.weights).toHaveLength(4);
    const splitLayout = computeLayout(split);
    expect(splitLayout.bays[1].width).toBeCloseTo(splitLayout.bays[2].width, 0);
    expect(splitLayout.bays[1].width + splitLayout.bays[2].width + PANEL_MM).toBeCloseTo(
      layout.bays[1].width,
      0,
    );
    const merged = mergeBay(split, splitLayout, 1);
    expect(merged.weights).toHaveLength(3);
    expect(computeLayout(merged).bays.map((b) => b.width)).toEqual(
      layout.bays.map((b) => b.width),
    );
  });

  it('withWidth rescales bays proportionally and keeps the sum invariant', () => {
    const wide = withWidth(INITIAL_STATE, 3600);
    const layout = computeLayout(wide);
    const total = sum(layout.bays.map((b) => b.width)) + (layout.bays.length + 1) * PANEL_MM;
    expect(total).toBeCloseTo(3600, 6);
    const widths = layout.bays.map((b) => b.width);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1.5);
  });
});

describe('linear division', () => {
  it('divides the whole width into N equal bays', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const layout = computeLayout(linearDivideWidth(INITIAL_STATE, n));
      expect(layout.bays).toHaveLength(n);
      const widths = layout.bays.map((b) => b.width);
      // Weights are integer millimetres, so equality holds to ≤1 mm.
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1.5);
    }
  });

  it('divides one bay width into N equal bays, in place', () => {
    const base = computeLayout(INITIAL_STATE);
    const next = linearDivideBayWidth(INITIAL_STATE, base, 1, 3);
    const layout = computeLayout(next);
    expect(layout.bays).toHaveLength(5);
    const parts = layout.bays.slice(1, 4).map((b) => b.width);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThan(1.5);
    expect(sum(parts) + 2 * PANEL_MM).toBeCloseTo(base.bays[1].width, 0);
    // Untouched bays keep their widths.
    expect(layout.bays[0].width).toBeCloseTo(base.bays[0].width, 0);
    expect(layout.bays[4].width).toBeCloseTo(base.bays[2].width, 0);
  });

  it('divides one bay height into N equal rows', () => {    const next: LibraryState = linearDivideBayHeight(INITIAL_STATE, 0, 5);
    const layout = computeLayout(next);
    expect(layout.bays[0].rows).toHaveLength(5);
    const heights = layout.bays[0].rows.map((r) => r.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.01);
    // Other bays untouched.
    expect(layout.bays[1].rows).toHaveLength(INITIAL_STATE.shelvesPerBay[1] + 1);
  });
});

describe('combined operations keep mm-weight semantics', () => {
  it('split after a whole-width linear division only touches the split bay', () => {
    const divided = linearDivideWidth(INITIAL_STATE, 4);
    const base = computeLayout(divided);
    expect(base.bays).toHaveLength(4);
    const split = splitBay(divided, base, 1);
    const layout = computeLayout(split);
    expect(layout.bays).toHaveLength(5);
    // Halves of bay 2 (minus the new divider), others untouched.
    expect(layout.bays[1].width).toBeCloseTo(layout.bays[2].width, 0);
    expect(layout.bays[1].width + layout.bays[2].width + PANEL_MM).toBeCloseTo(base.bays[1].width, 0);
    expect(layout.bays[0].width).toBeCloseTo(base.bays[0].width, 0);
    expect(layout.bays[3].width).toBeCloseTo(base.bays[2].width, 0);
    expect(layout.bays[4].width).toBeCloseTo(base.bays[3].width, 0);
  });

  it('drag after a whole-width linear division moves only the two neighbours', () => {
    const divided = linearDivideWidth(INITIAL_STATE, 4);
    const base = computeLayout(divided);
    const dragged = dragDivider(divided, base, 0, 100);
    const layout = computeLayout(dragged);
    expect(layout.bays[0].width).toBeCloseTo(base.bays[0].width + 100, 0);
    expect(layout.bays[1].width).toBeCloseTo(base.bays[1].width - 100, 0);
    expect(layout.bays[2].width).toBeCloseTo(base.bays[2].width, 0);
    expect(layout.bays[3].width).toBeCloseTo(base.bays[3].width, 0);
  });
});

describe('generateBooks', () => {
  it('fills rows deterministically and always leaves one zone empty', () => {
    const layout = computeLayout(INITIAL_STATE);
    const a = generateBooks(layout);
    const b = generateBooks(layout);
    expect(a).toEqual(b);
    const lastBay = a[a.length - 1];
    expect(lastBay[1]).toEqual([]);
    const filled = a.flat().filter((row) => row.length > 0);
    expect(filled.length).toBeGreaterThan(3);
    // No book exceeds its row.
    a.forEach((bayBooks, bi) => {
      bayBooks.forEach((rowBooks, ri) => {
        const row = layout.bays[bi].rows[ri];
        for (const book of rowBooks) {
          expect(book.offsetX + book.w).toBeLessThanOrEqual(layout.bays[bi].width + 0.01);
          expect(book.h).toBeLessThanOrEqual(row.height);
        }
      });
    });
  });
});
