import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { prefersReducedMotion } from './Stage';

type TransitionDocument = Document & { startViewTransition?: (cb: () => void) => unknown };

/**
 * Navigate inside a view transition, so a card and the stage frame (same view-transition-name) morph.
 * Without the API, or with reduced motion, it is a plain navigation.
 */
export function useTransitionNavigate(): (to: string | number) => void {
  const navigate = useNavigate();
  return (to) => {
    const go = (): void => { if (typeof to === 'number') navigate(to); else navigate(to); };
    const doc = document as TransitionDocument;
    if (doc.startViewTransition && !prefersReducedMotion()) doc.startViewTransition(() => flushSync(go));
    else go();
  };
}
