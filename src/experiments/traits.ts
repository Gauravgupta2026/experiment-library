import { hexToRgb, isHex } from '../lib/color';
import { schemaOf, snap } from '../lib/params';
import type { ControlGroup, Params, ValueControl } from './types';

/**
 * Traits are the named parts of an experiment that can travel along a wire in the node canvas.
 *
 * A trait port points at existing params by key, so a runtime trait needs no change in the effect code:
 * the viewer reads the donor's params, maps them, and pushes the result into the host with update().
 * Agent-only traits never touch the viewer. They describe a part of the source for the prompt and the agent.
 */
export type TraitType = 'palette' | 'softness' | 'tempo' | 'curve' | 'type' | 'shape' | 'behaviour';

/** The trait types that the viewer can mix live in v1. All others are agent-only until params exist for them. */
export const RUNTIME_TRAITS: ReadonlySet<TraitType> = new Set<TraitType>(['palette', 'softness']);

export interface TraitPort {
  /** Unique inside the experiment, for example 'palette'. Used in graph links, so keep it stable. */
  id: string;
  type: TraitType;
  /** Shown on the node. */
  label: string;
  /** Param keys in role order (palettes: background first, accents last). Empty for agent-only ports. */
  keys: string[];
  /** False = agent-only: it goes into the prompt and the agent brief, never into the viewer. */
  runtime: boolean;
  /** Agent-only: what this part is and where it lives in the source. */
  note?: string;
}

export interface Traits { outputs: TraitPort[]; inputs: TraitPort[] }

/** A trait value in transit. Softness travels normalised, so ranges of different experiments match. */
export type TraitValue =
  | { type: 'palette'; colors: string[] }
  | { type: 'softness'; u: number };

/* ---------------- colour helpers ---------------- */

/** WCAG relative luminance of a hex colour (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hexToRgb(hex).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Indices of `items` sorted from darkest to lightest. Ties keep their original order (stable sort). */
function rankByLuminance(colors: string[]): number[] {
  return colors.map((c, i) => ({ i, l: luminance(c) })).sort((a, b) => a.l - b.l || a.i - b.i).map((x) => x.i);
}

/** `count` indices spread evenly over 0..length-1, both ends included. */
function spread(count: number, length: number): number[] {
  if (count <= 0 || length <= 0) return [];
  if (count === 1) return [Math.floor((length - 1) / 2)];
  return Array.from({ length: count }, (_, i) => Math.round((i * (length - 1)) / (count - 1)));
}

/* ---------------- read and write ---------------- */

const controlOf = (groups: ControlGroup[], key: string): ValueControl | undefined => schemaOf(groups).get(key);

/** Read the value an output port gives, from the donor's current params. Null for agent-only ports. */
export function readPort(port: TraitPort, params: Params, groups: ControlGroup[]): TraitValue | null {
  if (!port.runtime) return null;
  if (port.type === 'palette') {
    const colors = port.keys.map((k) => params[k]).filter((v): v is string => typeof v === 'string' && isHex(v));
    return colors.length ? { type: 'palette', colors } : null;
  }
  if (port.type === 'softness') {
    const key = port.keys[0];
    const c = key ? controlOf(groups, key) : undefined;
    const v = key ? params[key] : undefined;
    if (!c || c.kind !== 'number' || typeof v !== 'number' || c.max <= c.min) return null;
    return { type: 'softness', u: Math.max(0, Math.min(1, (v - c.min) / (c.max - c.min))) };
  }
  return null;
}

/**
 * The params an input port changes when it receives a value.
 *
 * Palette: donor and host colours are each ranked by luminance, so light stays light and dark stays dark.
 * - Donor has fewer colours (n < m): they go to n host ranks spread evenly from darkest to lightest.
 *   The other host colours keep their value. Example: 6 donor colours into 11 host colours change 6.
 * - Donor has more or the same (n >= m): every host rank takes the donor colour at the matching spread rank.
 * Softness: the normalised value is scaled into the host control's range and snapped to its step.
 */
export function writePort(port: TraitPort, value: TraitValue, hostParams: Params, groups: ControlGroup[]): Partial<Params> {
  if (!port.runtime || port.type !== value.type) return {};
  const out: Partial<Params> = {};
  if (value.type === 'palette') {
    const hostKeys = port.keys.filter((k) => typeof hostParams[k] === 'string');
    const hostColors = hostKeys.map((k) => String(hostParams[k]));
    const n = value.colors.length, m = hostKeys.length;
    if (!n || !m) return out;
    const hostRanks = rankByLuminance(hostColors);
    const donorSorted = rankByLuminance(value.colors).map((i) => value.colors[i] ?? '#000000');
    if (n < m) {
      spread(n, m).forEach((hostRank, i) => {
        const key = hostKeys[hostRanks[hostRank] ?? -1];
        if (key) out[key] = (donorSorted[i] ?? '#000000').toUpperCase();
      });
    } else {
      const donorRanks = spread(m, n);
      hostRanks.forEach((hostIndex, rank) => {
        const key = hostKeys[hostIndex];
        if (key) out[key] = (donorSorted[donorRanks[rank] ?? 0] ?? '#000000').toUpperCase();
      });
    }
    return out;
  }
  const key = port.keys[0];
  const c = key ? controlOf(groups, key) : undefined;
  if (!key || !c || c.kind !== 'number') return out;
  out[key] = snap(c.min + value.u * (c.max - c.min), c.min, c.max, c.step);
  return out;
}

/** One wire into the host: the donor's output port feeds the host's input port. */
export interface TraitWire {
  donor: { params: Params; groups: ControlGroup[]; port: TraitPort };
  hostPort: TraitPort;
}

/**
 * The params the viewer shows. Order: host defaults, then the host node's own tweaks, then each wire in order.
 * A later wire into the same keys wins. Wires of different types, or into agent-only ports, change nothing.
 */
export function mergeTraits(host: { defaults: Params; groups: ControlGroup[]; params?: Partial<Params> }, wires: TraitWire[]): Params {
  let merged: Params = { ...host.defaults };
  for (const [k, v] of Object.entries(host.params ?? {})) if (v !== undefined) merged[k] = v;
  for (const w of wires) {
    if (w.donor.port.type !== w.hostPort.type) continue;
    const value = readPort(w.donor.port, w.donor.params, w.donor.groups);
    if (!value) continue;
    merged = { ...merged, ...(writePort(w.hostPort, value, merged, host.groups) as Params) };
  }
  return merged;
}

/**
 * Problems with an experiment's trait declarations. Empty list = valid.
 * The contract test runs this for every registered experiment.
 */
export function checkTraits(traits: Traits | undefined, defaults: Params, groups: ControlGroup[]): string[] {
  if (!traits) return ['no traits declared'];
  const problems: string[] = [];
  const schema = schemaOf(groups);
  for (const [side, ports] of [['output', traits.outputs], ['input', traits.inputs]] as const) {
    const ids = new Set<string>();
    for (const p of ports) {
      const where = `${side} '${p.id}'`;
      if (!/^[a-z][a-z0-9-]*$/.test(p.id)) problems.push(`${where}: id must be lowercase letters, digits and hyphens`);
      if (ids.has(p.id)) problems.push(`${where}: duplicate id`);
      ids.add(p.id);
      if (p.runtime && !RUNTIME_TRAITS.has(p.type)) problems.push(`${where}: type '${p.type}' cannot be runtime in v1`);
      if (!p.runtime) {
        if (!p.note) problems.push(`${where}: agent-only port needs a note`);
        if (side === 'input') problems.push(`${where}: inputs must be runtime (agent-only traits only go out)`);
        continue;
      }
      if (p.type === 'palette' && p.keys.length < 2) problems.push(`${where}: a palette needs at least 2 keys`);
      if (p.type === 'softness' && p.keys.length !== 1) problems.push(`${where}: softness needs exactly 1 key`);
      for (const k of p.keys) {
        const c = schema.get(k);
        if (!(k in defaults) || !c) { problems.push(`${where}: key '${k}' is not a param`); continue; }
        if (p.type === 'palette' && c.kind !== 'color') problems.push(`${where}: key '${k}' is not a colour`);
        if (p.type === 'softness' && c.kind !== 'number') problems.push(`${where}: key '${k}' is not a number`);
      }
    }
  }
  return problems;
}
