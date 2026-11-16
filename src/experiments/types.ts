import type { Clock } from '../lib/clock';

export type Category = 'Shader' | 'Particles' | 'Type' | 'Illustration';

export interface Option { value: string; label: string }

export type Control =
  | { kind: 'number'; key: string; label: string; min: number; max: number; step: number; unit?: string }
  | { kind: 'color'; key: string; label: string }
  | { kind: 'select'; key: string; label: string; options: Option[] }
  | { kind: 'segmented'; key: string; label: string; options: Option[] }
  | { kind: 'toggle'; key: string; label: string }
  | { kind: 'text'; key: string; label: string; maxLength: number }
  | { kind: 'image'; key: string; label: string }
  | { kind: 'action'; id: string; label: string };

export type ValueControl = Exclude<Control, { kind: 'action' }>;

export interface ControlGroup { title: string; controls: Control[]; collapsed?: boolean }

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface MountContext {
  /** The only time source. */
  clock: Clock;
  /** Seeded generator. The only randomness source. */
  random: () => number;
  /** True inside a feed card: low DPR, no pointer input, no DOM chrome. */
  preview: boolean;
  reducedMotion: boolean;
  /** The experiment changed one of its own params (for example a tab inside the frame). The panel follows. */
  setParam(key: string, value: ParamValue): void;
}

export interface ExperimentInstance {
  update(params: Params): void;
  trigger(actionId: string): void;
  resize(width: number, height: number, dpr: number): void;
  destroy(): void;
}

/** Light data that the feed needs. It is in the main bundle. */
export interface ExperimentMeta {
  id: string;
  title: string;
  /** At most 160 characters. */
  description: string;
  category: Category;
  tags: string[];
  /** Stage width / height. */
  aspect: number;
  /** Card width / height in the feed. */
  cardAspect: number;
  stageBackground: string;
  load(): Promise<{ default: ExperimentBody }>;
}

/** The heavy part. It loads on the experiment page or on card hover. */
export interface ExperimentBody {
  /** Timeline length in seconds. Enables the scrubber. */
  duration?: number;
  /** The time of the poster frame and of the reduced-motion still. */
  posterTime: number;
  defaults: Params;
  groups: ControlGroup[];
  presets?: { name: string; params: Partial<Params> }[];
  mount(el: HTMLElement, params: Params, ctx: MountContext): ExperimentInstance;
}

// Short builders keep the control tables readable.
export const num = (key: string, label: string, min: number, max: number, step: number, unit?: string): Control =>
  ({ kind: 'number', key, label, min, max, step, unit });
export const color = (key: string, label: string): Control => ({ kind: 'color', key, label });
export const toggle = (key: string, label: string): Control => ({ kind: 'toggle', key, label });
export const text = (key: string, label: string, maxLength: number): Control => ({ kind: 'text', key, label, maxLength });
export const image = (key: string, label: string): Control => ({ kind: 'image', key, label });
export const action = (id: string, label: string): Control => ({ kind: 'action', id, label });
const opts = (values: string[]): Option[] => values.map((v) => ({ value: v, label: v }));
export const select = (key: string, label: string, values: string[]): Control => ({ kind: 'select', key, label, options: opts(values) });
export const segmented = (key: string, label: string, values: string[]): Control => ({ kind: 'segmented', key, label, options: opts(values) });

/** Typed readers. Params are validated at the boundary, so these only narrow the type. */
export const n = (p: Params, key: string): number => { const v = p[key]; return typeof v === 'number' ? v : 0; };
export const s = (p: Params, key: string): string => { const v = p[key]; return typeof v === 'string' ? v : ''; };
export const b = (p: Params, key: string): boolean => p[key] === true;
