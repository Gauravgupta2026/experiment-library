import type { Category } from './experiments/types';

export const APP_NAME = 'Studio';
export const CATEGORIES: Category[] = ['Shader', 'Particles', 'Type', 'Illustration'];
/** Device pixel ratio caps: the stage is sharp, card previews are cheap. */
export const STAGE_MAX_DPR = 2;
export const PREVIEW_MAX_DPR = 1;
export const DEFAULT_SEED = 1;
