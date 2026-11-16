import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Option } from '../experiments/types';
import { hexToRgb, hsvToRgb, isHex, rgbToHex, rgbToHsv } from '../lib/color';
import { snap } from '../lib/params';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/* ---------------- Track: the drag surface shared by the slider and the scrubber ---------------- */

interface TrackProps {
  value: number; min: number; max: number; step: number; label: string;
  onChange(v: number): void; onDragStart?(): void; valueText?: string;
}

export function Track({ value, min, max, step, label, onChange, onDragStart, valueText }: TrackProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const frac = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;

  const fromPointer = (clientX: number): number => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return value;
    return snap(min + ((clientX - r.left) / r.width) * (max - min), min, max, step);
  };
  // The whole track drags, not only the thumb. Pointer capture keeps the drag alive outside the element.
  const down = (e: RPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(true); onDragStart?.(); onChange(fromPointer(e.clientX));
  };
  const move = (e: RPointerEvent<HTMLDivElement>): void => { if (drag) onChange(fromPointer(e.clientX)); };
  const up = (): void => setDrag(false);
  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    const mult = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step * mult;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step * mult;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault(); e.stopPropagation();
    onChange(snap(next, min, max, step));
  };
  return (
    <div className="track-wrap" data-drag={drag} ref={ref} role="slider" tabIndex={0} aria-label={label}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valueText}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
      <div className="track">
        <div className="track-fill" style={{ width: `${frac * 100}%` }} />
        <div className="thumb" style={{ left: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

/* ---------------- Slider ---------------- */

interface SliderProps { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange(v: number): void }

export function Slider({ label, value, min, max, step, unit, onChange }: SliderProps): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(parsed)) onChange(snap(parsed, min, max, step));
    setDraft(null);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation();
    if (e.key === 'Enter') { commit(); e.currentTarget.blur(); }
    else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      onChange(snap(value + dir * step * (e.shiftKey ? 10 : 1), min, max, step)); setDraft(null);
    }
  };
  return (
    <>
      <Track label={label} value={value} min={min} max={max} step={step} onChange={onChange} valueText={`${value}${unit ? ` ${unit}` : ''}`} />
      <input className="num" inputMode="decimal" aria-label={`${label} value`} value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={(e) => e.target.select()} />
      {unit ? <span className="unit">{unit}</span> : null}
    </>
  );
}

/* ---------------- Color ---------------- */

function useDrag(onMove: (fx: number, fy: number) => void): { onPointerDown(e: RPointerEvent<HTMLDivElement>): void; onPointerMove(e: RPointerEvent<HTMLDivElement>): void } {
  const at = (e: RPointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    onMove(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
  };
  return {
    onPointerDown: (e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); },
    onPointerMove: (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e); },
  };
}

export function ColorControl({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // Hue is kept in state: a gray colour has no hue, so it cannot be read back from the hex value.
  const [hue, setHue] = useState(() => rgbToHsv(...hexToRgb(value))[0]);
  const [, sat, val] = rgbToHsv(...hexToRgb(value));

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent): void => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);

  const sv = useDrag((fx, fy) => onChange(rgbToHex(...hsvToRgb(hue, fx, 1 - fy))));
  const hueDrag = useDrag((fx) => { const h = fx * 359.9; setHue(h); onChange(rgbToHex(...hsvToRgb(h, Math.max(sat, 0.01), Math.max(val, 0.01)))); });
  const invalid = draft !== null && !isHex(draft.startsWith('#') ? draft : `#${draft}`);
  const commit = (): void => {
    if (draft !== null) {
      const hex = draft.startsWith('#') ? draft : `#${draft}`;
      if (isHex(hex)) { onChange(hex.toUpperCase()); setHue(rgbToHsv(...hexToRgb(hex))[0]); }
    }
    setDraft(null);
  };
  return (
    <div className="ctl" ref={wrap}>
      <button type="button" className="swatch" style={{ background: value }} aria-label={`${label}: pick colour`} aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      <input className="field hex" aria-label={`${label} hex`} aria-invalid={invalid} maxLength={7} spellCheck={false} value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(null); }} />
      {open ? (
        <div className="pop" role="dialog" aria-label={`${label} colour`}>
          <div className="sv" style={{ backgroundColor: `hsl(${hue} 100% 50%)` }} {...sv}>
            <div className="knob" style={{ left: `${sat * 100}%`, top: `${(1 - val) * 100}%` }} />
          </div>
          <div className="hue" {...hueDrag}><div className="knob" style={{ left: `${(hue / 360) * 100}%` }} /></div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Segmented ---------------- */

export function Segmented({ label, value, options, onChange, wrap }: { label: string; value: string; options: Option[]; onChange(v: string): void; wrap?: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const measure = useCallback((): void => {
    const el = ref.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]');
    setInd(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
  }, []);
  useLayoutEffect(measure, [measure, value, options.length]);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = options.findIndex((o) => o.value === value);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    const next = options[(i + d + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div className={`seg${wrap ? ' wrap' : ''}`} role="radiogroup" aria-label={label} ref={ref} onKeyDown={key}>
      {ind ? <div className="seg-ind" style={{ transform: `translate(${ind.x}px, ${ind.y - 2}px)`, width: ind.w, height: ind.h, bottom: 'auto' }} /> : null}
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------------- Small controls ---------------- */

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }): JSX.Element {
  return <button type="button" className="switch" role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)} />;
}

export function Select({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange(v: string): void }): JSX.Element {
  return (
    <select className="field" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function TextControl({ label, value, maxLength, onChange }: { label: string; value: string; maxLength: number; onChange(v: string): void }): JSX.Element {
  return <input className="field" aria-label={label} value={value} maxLength={maxLength} spellCheck={false}
    onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />;
}

/** Image files stay on this computer: an object URL, never an upload. SVG is refused (it can carry script). */
export function ImageControl({ label, value, onChange, onError }: { label: string; value: string; onChange(v: string): void; onError(msg: string): void }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const pick = (file: File | undefined): void => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) { onError('Use a PNG, JPEG or WebP file.'); return; }
    if (file.size > MAX_IMAGE_BYTES) { onError('The file is larger than 8 MB.'); return; }
    onError('');
    if (value.startsWith('blob:')) URL.revokeObjectURL(value);
    onChange(URL.createObjectURL(file));
  };
  return (
    <div className="ctl">
      {value ? <img className="thumb-img" src={value} alt="" /> : <span className="thumb-img" aria-hidden="true" />}
      <button type="button" className="btn" onClick={() => input.current?.click()}>Replace</button>
      <button type="button" className="btn ghost" disabled={!value} onClick={() => { if (value.startsWith('blob:')) URL.revokeObjectURL(value); onError(''); onChange(''); }}>Default</button>
      <input ref={input} className="sr-only" type="file" tabIndex={-1} aria-label={`${label} file`} accept={IMAGE_TYPES.join(',')}
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
