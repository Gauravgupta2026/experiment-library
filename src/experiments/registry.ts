import type { ExperimentMeta } from './types';

/** Feed order. The heavy code of each experiment loads on demand through load(). */
export const experiments: ExperimentMeta[] = [
  {
    id: 'sun-orb', title: 'Sun Orb States', category: 'Shader', tags: ['WebGL', 'State', 'Glow'],
    description: 'A soft sun that rises, answers, loads, approves and sets. One fragment shader, no blur pass.',
    aspect: 1910 / 1700, cardAspect: 1, stageBackground: '#FDFDFD',
    load: () => import('./sun-orb'),
  },
  {
    id: 'modern-creatives', title: 'Blur Melt to Mesh Gradient', category: 'Type', tags: ['WebGL', 'Timeline', 'Kinetic type'],
    description: 'A photo scene melts into a red and magenta mesh gradient. A headline appears word by word inside four markers.',
    aspect: 3022 / 1708, cardAspect: 16 / 10, stageBackground: '#F5F5F6',
    load: () => import('./modern-creatives'),
  },
  {
    id: 'imagine', title: 'Gradient Figure and Pixel Wipe', category: 'Type', tags: ['WebGL', 'Timeline', 'Transition'],
    description: 'A soft gradient figure, a letter-by-letter line, then a pixel wipe to gray and bracket words that a marker box hunts.',
    aspect: 3022 / 1708, cardAspect: 4 / 3, stageBackground: '#F5F5F6',
    load: () => import('./imagine'),
  },
];

export const findExperiment = (id: string | undefined): ExperimentMeta | undefined => experiments.find((e) => e.id === id);
