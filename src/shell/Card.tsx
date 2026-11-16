import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import type { ExperimentBody, ExperimentMeta } from '../experiments/types';
import { useTransitionNavigate } from './navigate';
import { Stage } from './Stage';

const HOVER_DELAY_MS = 150;
const FADE_OUT_MS = 150;

/* Only one live preview exists at a time: browsers limit the number of WebGL contexts. */
let liveId: string | null = null;
const subs = new Set<() => void>();
const setLive = (id: string | null): void => { liveId = id; subs.forEach((f) => f()); };
const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => subs.delete(f); };

const canHover = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;

export function Card({ meta }: { meta: ExperimentMeta }): JSX.Element {
  const go = useTransitionNavigate();
  const live = useSyncExternalStore(subscribe, () => liveId === meta.id);
  const [body, setBody] = useState<ExperimentBody | null>(null);
  const [mounted, setMounted] = useState(false);   // keeps the stage alive during the fade out
  const [shown, setShown] = useState(false);
  const [poster, setPoster] = useState(true);
  const timer = useRef(0);

  useEffect(() => {
    if (live) {
      let alive = true;
      void meta.load().then((m) => { if (alive) { setBody(m.default); setMounted(true); requestAnimationFrame(() => requestAnimationFrame(() => alive && setShown(true))); } });
      return () => { alive = false; };
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), FADE_OUT_MS);
    return () => window.clearTimeout(t);
  }, [live, meta]);
  useEffect(() => () => { window.clearTimeout(timer.current); if (liveId === meta.id) setLive(null); }, [meta.id]);

  const enter = (): void => { if (!canHover()) return; window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setLive(meta.id), HOVER_DELAY_MS); };
  const leave = (): void => { window.clearTimeout(timer.current); if (liveId === meta.id) setLive(null); };
  const click = (e: MouseEvent): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;   // keep "open in new tab"
    e.preventDefault(); leave(); go(`/e/${meta.id}`);
  };
  // The live layer has the aspect of the experiment and covers the card, like object-fit: cover.
  const cover = `max(100%, calc(100% * ${meta.aspect / meta.cardAspect}))`;

  return (
    <a className="card" href={`/e/${meta.id}`} onClick={click} onPointerEnter={enter} onPointerLeave={leave}
      style={{ viewTransitionName: `exp-${meta.id}`, background: meta.stageBackground }} aria-label={`${meta.title}, ${meta.category}`}>
      {poster ? <img src={`/posters/${meta.id}.webp`} alt="" loading="lazy" width={800} height={Math.round(800 / meta.cardAspect)} onError={() => setPoster(false)} /> : null}
      {mounted && body ? (
        <div className="card-live" data-on={shown} aria-hidden="true">
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: cover, aspectRatio: String(meta.aspect), transform: 'translate(-50%, -50%)' }}>
            <Stage body={body} initialParams={body.defaults} preview />
          </div>
        </div>
      ) : null}
      <span className="card-label title">{meta.title}</span>
      <span className="card-label cat">{meta.category}</span>
    </a>
  );
}
