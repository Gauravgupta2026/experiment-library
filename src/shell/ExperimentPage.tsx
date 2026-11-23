import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { DEFAULT_SEED, STAGE_MAX_DPR } from '../config';
import { experiments, findExperiment } from '../experiments/registry';
import type { ExperimentBody, ExperimentMeta, Params, ParamValue } from '../experiments/types';
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../lib/color';
import { decodeParams, encodeParams, schemaOf, snap } from '../lib/params';
import { stepSpring } from '../lib/spring';
import { Track } from '../panel/controls';
import { Panel } from '../panel/Panel';
import { useTransitionNavigate } from './navigate';
import { prefersReducedMotion, Stage, type StageHandle } from './Stage';

const URL_DEBOUNCE_MS = 200;
const TRANSPORT_SPACE = '44px';           // 32 px bar + 12 px gap
const SHEET_PEEK = 96;
const SHEET_QUERY = '(max-width: 1023px)';
const SHEET_SPRING_OMEGA = Math.sqrt(300); // stiffness 300; damping 30 is close to critical
const CAPTURE_KEYS = new Set(['capture', 't', 'seed', 'p', 'poster']);

declare global { interface Window { __ready?: boolean; __stage?: StageHandle; __params?: Params } }

const I = {
  back: <path d="M9.5 3.5L5 8l4.5 4.5M5 8h7" />, replay: <path d="M3 8a5 5 0 1 0 1.6-3.7M3 3v2.6h2.6" />,
  full: <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />, play: <path d="M5 3.5v9l7-4.5z" fill="currentColor" />, pause: <path d="M5 3.5v9M11 3.5v9" />,
};
const Icon = ({ d }: { d: JSX.Element }): JSX.Element => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const fmt = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function useBody(meta: ExperimentMeta | undefined): { body: ExperimentBody | null; error: boolean; retry(): void } {
  const [state, setState] = useState<{ id: string; body: ExperimentBody } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!meta) return;
    let alive = true;
    meta.load().then(
      (m) => { if (alive) { setState({ id: meta.id, body: m.default }); setError(null); } },
      (err: unknown) => { console.error(err); if (alive) setError(meta.id); },
    );
    return () => { alive = false; };
  }, [meta, attempt]);
  return { body: meta && state?.id === meta.id ? state.body : null, error: !!meta && error === meta.id, retry: () => setAttempt((a) => a + 1) };
}

/** Transport bar for experiments with a timeline. It reads the clock on each frame. */
function Transport({ handle, duration }: { handle: StageHandle; duration: number }): JSX.Element {
  const [, tick] = useState(0);
  useEffect(() => {
    const rerender = (): void => tick((x) => x + 1);
    const a = handle.clock.onTick(rerender), b = handle.clock.onChange(rerender);
    return () => { a(); b(); };
  }, [handle]);
  const { clock } = handle;
  return (
    <div className="transport">
      <button type="button" className="icon-btn" aria-label={clock.playing ? 'Pause' : 'Play'} onClick={() => clock.setPlaying(!clock.playing)}><Icon d={clock.playing ? I.pause : I.play} /></button>
      <Track label="Timeline" value={Number(clock.now.toFixed(2))} min={0} max={duration} step={0.01} valueText={`${clock.now.toFixed(1)} seconds`}
        onDragStart={() => clock.setPlaying(false)} onChange={(v) => clock.seek(v)} />
      <span className="time">{fmt(clock.now)} / {fmt(duration)}</span>
    </div>
  );
}

/** Mobile bottom sheet: follows the finger 1:1, then a spring takes it to the nearest snap point. */
function useSheet(): { style: CSSProperties; handleProps: { onPointerDown(e: RPointerEvent): void; onPointerMove(e: RPointerEvent): void; onPointerUp(e: RPointerEvent): void; onClick(): void } } {
  const [y, setY] = useState<number | null>(null);          // px down from the open position; null = not measured yet
  const drag = useRef<{ startY: number; startOffset: number; lastY: number; lastT: number; vel: number; moved: boolean } | null>(null);
  const raf = useRef(0);
  const closed = (): number => Math.max(0, window.innerHeight * 0.7 - SHEET_PEEK);
  // The sheet exists only under the desktop breakpoint. On desktop the panel is a normal grid column.
  useEffect(() => {
    const mq = matchMedia(SHEET_QUERY);
    const sync = (): void => setY(mq.matches ? closed() : null);
    sync(); mq.addEventListener('change', sync);
    return () => { mq.removeEventListener('change', sync); cancelAnimationFrame(raf.current); };
  }, []);
  const animateTo = (to: number, from: number, v0: number): void => {
    cancelAnimationFrame(raf.current);
    const s = { x: from, v: v0 }; let last = performance.now();
    const step = (now: number): void => {
      stepSpring(s, to, SHEET_SPRING_OMEGA, Math.min(1 / 30, (now - last) / 1000)); last = now;
      if (Math.abs(s.x - to) < 0.5 && Math.abs(s.v) < 5) { setY(to); return; }
      setY(s.x); raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  return {
    style: y === null ? {} : { transform: `translateY(${y}px)` },
    handleProps: {
      onPointerDown(e) { cancelAnimationFrame(raf.current); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { startY: e.clientY, startOffset: y ?? 0, lastY: e.clientY, lastT: e.timeStamp, vel: 0, moved: false }; },
      onPointerMove(e) {
        const d = drag.current; if (!d) return;
        const dt = Math.max(1, e.timeStamp - d.lastT);
        d.vel = ((e.clientY - d.lastY) / dt) * 1000; d.lastY = e.clientY; d.lastT = e.timeStamp;
        if (Math.abs(e.clientY - d.startY) > 4) d.moved = true;
        setY(Math.max(0, Math.min(closed(), d.startOffset + e.clientY - d.startY)));
      },
      onPointerUp(e) {
        const d = drag.current; drag.current = null; if (!d || !d.moved) return;
        const now = Math.max(0, Math.min(closed(), d.startOffset + e.clientY - d.startY));
        // Project where the sheet would stop, then choose the nearest snap point.
        const projected = now + d.vel * 0.2;
        animateTo(projected > closed() / 2 ? closed() : 0, now, d.vel);
      },
      onClick() { if (y !== null && !drag.current) animateTo(y > closed() / 2 ? 0 : closed(), y, 0); },
    },
  };
}

export function ExperimentPage(): JSX.Element {
  const { id } = useParams();
  const meta = findExperiment(id);
  const { body, error, retry } = useBody(meta);
  if (!meta) return <main className="feed"><div className="intro"><h1>Not found</h1><p>There is no experiment with this address.</p></div></main>;
  if (error) return <main className="feed"><div className="intro"><h1>Could not load</h1><p>The code for this experiment did not load.</p><button type="button" className="btn" style={{ marginTop: 12 }} onClick={retry}>Try again</button></div></main>;
  if (!body) return <main className="page" aria-busy="true"><div className="stage" style={{ background: meta.stageBackground }} /><aside className="panel" /></main>;
  return <Loaded key={meta.id} meta={meta} body={body} />;
}

function Loaded({ meta, body }: { meta: ExperimentMeta; body: ExperimentBody }): JSX.Element {
  const [search] = useSearchParams();
  const go = useTransitionNavigate();
  const capture = search.get('capture') === '1';
  const seed = Number(search.get('seed')) || DEFAULT_SEED;
  const initial = useMemo(() => decodeParams(search.get('p'), body.defaults, body.groups), [body]);   // read the link once
  const [params, setParams] = useState<Params>(initial);
  const paramsRef = useRef(params); paramsRef.current = params;
  const [preset, setPreset] = useState<string | null>(null);
  const [handle, setHandle] = useState<StageHandle | null>(null);
  const [needsPlay, setNeedsPlay] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const urlTimer = useRef(0);
  const sheet = useSheet();
  const reduced = useMemo(prefersReducedMotion, []);
  // Capture mode: `t` seeks to a time; `poster=1` seeks to the experiment's poster time.
  const pausedAt = capture ? (search.get('poster') === '1' ? body.posterTime : Number(search.get('t')) || 0) : reduced ? body.posterTime : undefined;

  const apply = useCallback((next: Params): void => {
    setParams(next); paramsRef.current = next;
    handle?.instance.update(next);            // same frame; the stage does not re-render
    if (handle && !handle.clock.playing) handle.clock.refresh();
    window.clearTimeout(urlTimer.current);
    urlTimer.current = window.setTimeout(() => {
      const enc = encodeParams(next, body.defaults, body.groups);
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${enc ? `?p=${enc}` : ''}`);
    }, URL_DEBOUNCE_MS);
  }, [handle, body]);
  useEffect(() => () => window.clearTimeout(urlTimer.current), []);

  const onChange = useCallback((key: string, value: ParamValue): void => { setPreset(null); apply({ ...paramsRef.current, [key]: value }); }, [apply]);
  // A change that comes from inside the frame (a tab): the panel follows; the instance already has it.
  const onParam = useCallback((key: string, value: ParamValue): void => { const next = { ...paramsRef.current, [key]: value }; setParams(next); paramsRef.current = next; }, []);

  const onReady = useCallback((h: StageHandle | null): void => {
    setHandle(h);
    if (!h) return;
    if (capture) {
      // Test hooks: timing and visual tests drive the instance directly from the full current params.
      window.__stage = h; window.__params = paramsRef.current;
      // Extra query keys go to the experiment, for example state=approved or shaderTime=5.
      new URLSearchParams(window.location.search).forEach((v, k) => { if (!CAPTURE_KEYS.has(k)) h.instance.trigger(`capture:${k}=${v}`); });
      h.clock.refresh();
      requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));
    } else if (reduced) setNeedsPlay(true);
  }, [capture, reduced]);

  const replay = useCallback((): void => { if (!handle) return; setNeedsPlay(false); handle.clock.seek(0); handle.instance.trigger('replay'); handle.clock.setPlaying(true); }, [handle]);
  const fullscreen = useCallback((): void => { const el = frame.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); }, []);
  const neighbour = useCallback((d: number): void => { const i = experiments.indexOf(meta); const next = experiments[(i + d + experiments.length) % experiments.length]; if (next && next !== meta) go(`/e/${next.id}`); }, [meta, go]);

  useEffect(() => {
    if (capture) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Keys that a focused control uses must not also drive the page.
      if (t && (t.closest('input, select, textarea, [role="slider"], [role="radiogroup"], [role="dialog"]') || (t.tagName === 'BUTTON' && e.key === ' '))) return;
      if (e.key === ' ') { e.preventDefault(); if (handle) { setNeedsPlay(false); handle.clock.setPlaying(!handle.clock.playing); } }
      else if (e.key === 'r' || e.key === 'R') replay();
      else if (e.key === 'f' || e.key === 'F') fullscreen();
      else if (e.key === 'ArrowRight') neighbour(1);
      else if (e.key === 'ArrowLeft') neighbour(-1);
      else if (e.key === 'Escape' && !document.fullscreenElement) go('/');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capture, handle, replay, fullscreen, neighbour, go]);

  const randomize = (): void => {
    const next: Params = { ...paramsRef.current };
    for (const [key, c] of schemaOf(body.groups)) {
      if (c.kind === 'number') next[key] = snap(c.min + Math.random() * (c.max - c.min), c.min, c.max, c.step);
      else if (c.kind === 'color') { const cur = next[key]; const [, s, v] = rgbToHsv(...hexToRgb(typeof cur === 'string' ? cur : '#808080')); next[key] = rgbToHex(...hsvToRgb(Math.random() * 360, s, v)); }
    }
    setPreset(null); apply(next);
  };
  const copy = async (): Promise<boolean> => {
    const enc = encodeParams(paramsRef.current, body.defaults, body.groups);
    try { await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${enc ? `?p=${enc}` : ''}`); return true; } catch { return false; }
  };
  const applyPreset = (name: string): void => {
    const p = body.presets?.find((x) => x.name === name); if (!p) return;
    const next: Params = { ...body.defaults };
    for (const [k, v] of Object.entries(p.params)) if (v !== undefined) next[k] = v;
    // Keep the user's images: a preset has no images.
    for (const [key, c] of schemaOf(body.groups)) if (c.kind === 'image') next[key] = paramsRef.current[key] ?? '';
    apply(next); setPreset(name);
  };

  const frameStyle = { '--aspect': String(meta.aspect), viewTransitionName: `exp-${meta.id}` } as CSSProperties;
  // A poster looks like a feed card: no in-frame chrome (for example the orb tabs).
  const poster = capture && search.get('poster') === '1';
  const stage = <Stage body={body} initialParams={initial} seed={seed} startPausedAt={pausedAt} onReady={onReady} onParam={onParam} preview={poster} maxDpr={poster ? STAGE_MAX_DPR : undefined} />;

  if (capture) return <div className="capture"><div className="frame" id="frame" style={{ '--aspect': String(meta.aspect) } as CSSProperties}>{stage}</div></div>;

  return (
    <main className="page">
      <section className="stage" style={{ background: meta.stageBackground }} aria-label="Stage">
        <div className="stage-btns left"><button type="button" className="icon-btn" aria-label="Back to the feed" onClick={() => go('/')}><Icon d={I.back} /></button></div>
        <div className="stage-btns right">
          <button type="button" className="icon-btn" aria-label="Replay" onClick={replay}><Icon d={I.replay} /></button>
          <button type="button" className="icon-btn" aria-label="Fullscreen" onClick={fullscreen}><Icon d={I.full} /></button>
        </div>
        <div className="stage-fit" style={{ '--aspect': String(meta.aspect), '--transport': body.duration ? TRANSPORT_SPACE : '0px' } as CSSProperties}>
          <div className="frame" id="frame" ref={frame} style={frameStyle} role="img" aria-label={meta.description}>
            {stage}
            {needsPlay ? <button type="button" className="frame-play" onClick={() => { setNeedsPlay(false); handle?.clock.setPlaying(true); }}>Play</button> : null}
          </div>
          {body.duration && handle ? <Transport handle={handle} duration={body.duration} /> : null}
        </div>
      </section>
      <aside className="panel" style={sheet.style} aria-label="Controls">
        <button type="button" className="sheet-handle" aria-label="Open or close the controls" {...sheet.handleProps} />
        <Panel meta={meta} body={body} params={params} preset={preset} onChange={onChange} onAction={(a) => { setNeedsPlay(false); handle?.instance.trigger(a); }}
          onPreset={applyPreset} onReset={() => { setPreset(null); apply({ ...body.defaults }); }} onRandomize={randomize} onCopy={copy} />
      </aside>
    </main>
  );
}
