import type { ExperimentMeta } from './types';

/** Feed order. The heavy code of each experiment loads on demand through load(). */
export const experiments: ExperimentMeta[] = [
  {
    id: 'sun-orb', title: 'Sun Orb States', category: 'Shader', tags: ['WebGL', 'State', 'Glow'],
    description: 'A soft sun that rises, answers, loads, approves and sets. One fragment shader, no blur pass.',
    aspect: 1910 / 1700, cardAspect: 1, stageBackground: '#FDFDFD',
    load: () => import('./sun-orb'),
  },
];

export const findExperiment = (id: string | undefined): ExperimentMeta | undefined => experiments.find((e) => e.id === id);
