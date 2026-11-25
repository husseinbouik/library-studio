import { useState } from 'react';
import {
  FINISHES,
  MAX_BAYS,
  MAX_SHELVES,
  MAX_WIDTH_MM,
  MIN_BAYS,
  MIN_WIDTH_MM,
  PANEL_MM,
  fmtCm,
  type LibraryLayout,
  type LibraryState,
} from '../lib/design';

export type LinearTarget = 'width' | 'bayWidth' | 'bayHeight';

interface ControlsProps {
  state: LibraryState;
  layout: LibraryLayout;
  onWidth: (mm: number) => void;
  onAddBay: () => void;
  onRemoveBay: () => void;
  onShelves: (count: number) => void;
  onSplit: () => void;
  onMerge: () => void;
  onLinear: (target: LinearTarget, n: number) => void;
  onFinish: (id: string) => void;
}

const LINEAR_NS = [2, 3, 4, 5, 6];

export default function Controls(props: ControlsProps) {
  const { state, layout, onWidth, onAddBay, onRemoveBay, onShelves, onSplit, onMerge, onLinear, onFinish } = props;
  const [target, setTarget] = useState<LinearTarget>('width');
  const [n, setN] = useState(3);

  const bayCount = state.weights.length;
  const selected = Math.min(state.selectedBay, bayCount - 1);
  const shelves = state.shelvesPerBay[selected] ?? 0;
  const canMerge = bayCount > MIN_BAYS;
  const canSplit = bayCount < MAX_BAYS;

  return (
    <div className="panel" role="group" aria-label="Bookcase controls">
      {/* Width */}
      <div className="row row--slider">
        <label className="row-label" htmlFor="width-slider">
          Width
        </label>
        <input
          id="width-slider"
          type="range"
          min={MIN_WIDTH_MM / 10}
          max={MAX_WIDTH_MM / 10}
          step={1}
          value={state.widthMm / 10}
          onChange={(e) => onWidth(Number(e.target.value) * 10)}
          aria-valuetext={`${state.widthMm / 10} centimetres`}
        />
        <span className="row-value">{state.widthMm / 10} cm</span>
      </div>

      {/* Classical editing: bays */}
      <div className="row">
        <span className="row-label">Bays</span>
        <div className="btn-group">
          <button type="button" className="btn" onClick={onRemoveBay} disabled={bayCount <= MIN_BAYS} aria-label="Remove selected bay">
            − Bay
          </button>
          <span className="count" aria-live="polite">{bayCount}</span>
          <button type="button" className="btn" onClick={onAddBay} disabled={bayCount >= MAX_BAYS} aria-label="Add a bay">
            + Bay
          </button>
          <button type="button" className="btn" onClick={onSplit} disabled={!canSplit} aria-label="Split selected bay in two">
            Split
          </button>
          <button type="button" className="btn" onClick={onMerge} disabled={!canMerge} aria-label="Merge selected bay with its neighbour">
            Merge
          </button>
        </div>
      </div>

      {/* Classical editing: shelves of the selected bay */}
      <div className="row">
        <span className="row-label">Shelves</span>
        <div className="btn-group">
          <span className="bay-tag">Bay {selected + 1}</span>
          <button
            type="button"
            className="btn btn--step"
            onClick={() => onShelves(shelves - 1)}
            disabled={shelves <= 0}
            aria-label="Remove a shelf from the selected bay"
          >
            −
          </button>
          <span className="count" aria-live="polite">{shelves}</span>
          <button
            type="button"
            className="btn btn--step"
            onClick={() => onShelves(shelves + 1)}
            disabled={shelves >= MAX_SHELVES}
            aria-label="Add a shelf to the selected bay"
          >
            +
          </button>
          <span className="row-note">
            {layout.bays[selected]
              ? `rows of ${fmtCm(layout.bays[selected].rows[0]?.height ?? 0)} cm`
              : ''}
          </span>
        </div>
      </div>

      {/* Linear division */}
      <fieldset className="linear">
        <legend className="linear-title">
          Linear division
          <span className="linear-badge">engine</span>
        </legend>
        <div className="btn-group" role="group" aria-label="What to divide">
          <button
            type="button"
            className={`btn ${target === 'width' ? 'btn--active' : ''}`}
            aria-pressed={target === 'width'}
            onClick={() => setTarget('width')}
          >
            Whole width
          </button>
          <button
            type="button"
            className={`btn ${target === 'bayWidth' ? 'btn--active' : ''}`}
            aria-pressed={target === 'bayWidth'}
            onClick={() => setTarget('bayWidth')}
          >
            Bay ↔ width
          </button>
          <button
            type="button"
            className={`btn ${target === 'bayHeight' ? 'btn--active' : ''}`}
            aria-pressed={target === 'bayHeight'}
            onClick={() => setTarget('bayHeight')}
          >
            Bay ↕ height
          </button>
        </div>
        <div className="btn-group" role="group" aria-label="Number of equal zones">
          <span className="row-note">into</span>
          {LINEAR_NS.map((k) => (
            <button
              key={k}
              type="button"
              className={`btn btn--step ${n === k ? 'btn--active' : ''}`}
              aria-pressed={n === k}
              onClick={() => setN(k)}
            >
              {k}
            </button>
          ))}
          <button type="button" className="btn btn--primary" onClick={() => onLinear(target, n)}>
            Divide
          </button>
        </div>
        <p className="linear-hint">
          One action, N equal zones — computed by the linear-zone-divider engine.
        </p>
      </fieldset>

      {/* Finishes + fixed divider note */}
      <div className="row">
        <span className="row-label">Finish</span>
        <div className="btn-group">
          {FINISHES.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`swatch ${state.finishId === f.id ? 'swatch--active' : ''}`}
              style={{ background: f.swatch }}
              aria-label={`${f.name} finish`}
              aria-pressed={state.finishId === f.id}
              title={f.name}
              onClick={() => onFinish(f.id)}
            />
          ))}
          <span className="row-note">
            {FINISHES.find((f) => f.id === state.finishId)?.name}
          </span>
        </div>
        <span className="chip chip--static">Divider {PANEL_MM} mm</span>
      </div>
    </div>
  );
}
