import { memo, useEffect, useRef, useState } from 'react';
import { DEFAULT_SEED, PREVIEW_MAX_DPR, STAGE_MAX_DPR } from '../config';
import type { ExperimentBody, ExperimentInstance, Params, ParamValue } from '../experiments/types';
import { Clock } from '../lib/clock';
import { mulberry32 } from '../lib/prng';

export interface StageHandle { clock: Clock; instance: ExperimentInstance }

interface StageProps {
  body: ExperimentBody;
  /** Read once at mount. Later changes go through handle.instance.update(), so React never re-renders the stage. */
  initialParams: Params;
  preview?: boolean;
  /** Overrides the DPR cap. Posters are preview-mode (no chrome) but full resolution. */
  maxDpr?: number;
  seed?: number;
  /** Mount paused at this time (capture mode and reduced motion). */
  startPausedAt?: number;
  onReady?(handle: StageHandle | null): void;
  onParam?(key: string, value: ParamValue): void;
}

export const prefersReducedMotion = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Mounts one experiment in a div and owns its clock. */
export const Stage = memo(function Stage({ body, initialParams, preview = false, seed = DEFAULT_SEED, startPausedAt, onReady, onParam, maxDpr: dprCap }: StageProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady); ready.current = onReady;
  const param = useRef(onParam); param.current = onParam;
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clock = new Clock(body.duration);
    const maxDpr = dprCap ?? (preview ? PREVIEW_MAX_DPR : STAGE_MAX_DPR);
    const dpr = (): number => Math.min(maxDpr, window.devicePixelRatio || 1);
    let instance: ExperimentInstance;
    try {
      instance = body.mount(el, initialParams, { clock, random: mulberry32(seed), preview, reducedMotion: prefersReducedMotion(), setParam: (k, v) => param.current?.(k, v) });
    } catch (err) {
      clock.destroy(); el.replaceChildren();
      const webgl = err instanceof Error && /webgl/i.test(err.message);
      setFailed(webgl ? 'This experiment needs WebGL, and this browser does not give it.' : 'This experiment could not start.');
      console.error(err);
      return;
    }
    setFailed(null);

    const size = (): void => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { instance.resize(r.width, r.height, dpr()); clock.refresh(); } };
    size();
    const ro = new ResizeObserver(size); ro.observe(el);

    // Stop frames when nobody can see them.
    let onScreen = true;
    const sync = (): void => clock.setSuspended(document.hidden || !onScreen);
    const io = new IntersectionObserver((entries) => { onScreen = entries[0]?.isIntersecting ?? true; sync(); });
    io.observe(el);
    document.addEventListener('visibilitychange', sync);

    if (startPausedAt !== undefined) { clock.playing = false; clock.seek(startPausedAt); }
    clock.start();
    ready.current?.({ clock, instance });
    return () => {
      ready.current?.(null);
      ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', sync);
      clock.destroy(); instance.destroy(); el.replaceChildren();
    };
    // The experiment is mounted once per body. Params are pushed through the handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, preview, seed]);

  return (
    <>
      <div className="frame-mount" ref={ref} />
      {failed ? <p className="frame-error" role="alert">{failed}</p> : null}
    </>
  );
});
