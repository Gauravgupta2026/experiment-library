import type { ControlGroup, Params, ParamValue, ValueControl } from '../experiments/types';
import { isHex } from './color';

/** All value controls of an experiment, by key. Action buttons have no value. */
export function schemaOf(groups: ControlGroup[]): Map<string, ValueControl> {
  const map = new Map<string, ValueControl>();
  for (const g of groups) for (const c of g.controls) if (c.kind !== 'action') map.set(c.key, c);
  return map;
}

/** Check one value against its control. Returns the safe value, or undefined to reject it. */
export function validate(control: ValueControl, value: unknown): ParamValue | undefined {
  switch (control.kind) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      return value < control.min || value > control.max ? undefined : value;
    case 'color':
      return typeof value === 'string' && isHex(value) ? value.toUpperCase() : undefined;
    case 'select':
    case 'segmented':
      return typeof value === 'string' && control.options.some((o) => o.value === value) ? value : undefined;
    case 'toggle':
      return typeof value === 'boolean' ? value : undefined;
    case 'text':
      return typeof value === 'string' && value.length <= control.maxLength ? value : undefined;
    case 'image':
      // Image values are local object URLs. They are never read from a link.
      return undefined;
  }
}

const toBase64Url = (s: string): string => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s: string): string => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** The share string: base64url of the JSON of the values that differ from the defaults. Empty when nothing differs. */
export function encodeParams(params: Params, defaults: Params, groups: ControlGroup[]): string {
  const schema = schemaOf(groups);
  const diff: Params = {};
  for (const [key, control] of schema) {
    if (control.kind === 'image') continue;
    const v = params[key];
    if (v !== undefined && v !== defaults[key]) diff[key] = v;
  }
  return Object.keys(diff).length ? toBase64Url(JSON.stringify(diff)) : '';
}

/**
 * Read a share string. The URL is a system boundary: every key is checked against the schema,
 * and anything unknown, of the wrong type or out of range is dropped.
 */
export function decodeParams(encoded: string | null, defaults: Params, groups: ControlGroup[]): Params {
  const out: Params = { ...defaults };
  if (!encoded) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(fromBase64Url(encoded)); } catch { return out; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out;
  const schema = schemaOf(groups);
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const control = schema.get(key);
    if (!control) continue;
    const safe = validate(control, value);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}

/** Snap a number to its control step and range. */
export function snap(value: number, min: number, max: number, step: number): number {
  const snapped = Math.round((value - min) / step) * step + min;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(Math.max(min, Math.min(max, snapped)).toFixed(decimals));
}
