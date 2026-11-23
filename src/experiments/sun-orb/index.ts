import { hexToRgb } from '../../lib/color';
import { createQuad, fillCanvas } from '../../lib/gl';
import { stepSpring, type SpringState } from '../../lib/spring';
import { action, color, n, num, s, b, segmented, toggle, type ExperimentBody, type Params } from '../types';
import { FRAG } from './shader';

const STATES = ['Rise', 'Response', 'Loading', 'Approved', 'Dusk', 'Set'] as const;
type OrbState = (typeof STATES)[number];
const isState = (v: string): v is OrbState => (STATES as readonly string[]).includes(v);

/** Spring speeds (omega, 1/s). Higher = faster. All springs are critically damped. */
const OMEGA = { energy: 10, warm: 9, dusk: 9, sweep: 12 };
const RISE_DELAY = 0.4;                 // seconds after mount
const DUSK_RISE = 0.93;                 // the orb sits 7% lower at dusk
const RESPONSE_PULSE = { dur: 1.5, amp: 1 };
const APPROVED_PULSE = { dur: 1.3, amp: 1.25 };
const SIM_STEP = 1 / 60;
/** Tab pill sizes are for a frame 955 px wide. Everything inside uses em, so it scales with the frame. */
const TABS_BASE_WIDTH = 955;
const TABS_TOP = 0.854;

type Key = 'rise' | 'energy' | 'warm' | 'dusk' | 'sweep';
interface Pulse { t0: number; dur: number; amp: number }

/** Pulse envelope: sin^2 attack over the first 30%, cos^2 release. Peak 1. */
function envelope(x: number): number {
  if (x <= 0 || x >= 1) return 0;
  return x < 0.3 ? Math.sin((x / 0.3) * Math.PI / 2) ** 2 : Math.cos(((x - 0.3) / 0.7) * Math.PI / 2) ** 2;
}

const TAB_CSS = `
.orb-tabs{position:absolute;left:50%;transform:translateX(-50%);display:flex;gap:.375em;padding:.375em;border-radius:999px;
  background:#FAFAFC;border:1px solid #E7E7EE;box-shadow:0 1px 2px rgba(20,20,40,.04);font-family:var(--font);z-index:2}
.orb-tabs button{all:unset;position:relative;z-index:1;cursor:pointer;height:2.5em;padding:0 .9375em;border-radius:999px;font-weight:500;
  color:#70707C;line-height:2.5em;transition:color .2s;white-space:nowrap}
.orb-tabs button[aria-pressed=true]{color:#17171C}
.orb-tabs button:focus-visible{outline:2px solid #2F5BFF;outline-offset:2px}
.orb-tabs i{position:absolute;top:.375em;left:0;height:2.5em;border-radius:999px;background:linear-gradient(#FFFFFF,#F1F1F5);
  box-shadow:0 1px 3px rgba(20,20,40,.14),0 0 0 1px rgba(20,20,40,.05);transition:transform .22s cubic-bezier(.22,1,.36,1),width .22s cubic-bezier(.22,1,.36,1)}`;

const PALETTE_KEYS = ['background', 'domeTop', 'domeLow', 'rim', 'band', 'bandEnd', 'glowTop', 'blue', 'violet', 'mauve', 'glowSide'];

const body: ExperimentBody = {
  posterTime: 3,
  traits: {
    outputs: [
      { id: 'palette', type: 'palette', label: 'Palette', keys: PALETTE_KEYS, runtime: true },
      { id: 'softness', type: 'softness', label: 'Softness', keys: ['softness'], runtime: true },
      { id: 'shape', type: 'shape', label: 'Dome, band and notch', keys: [], runtime: false,
        note: 'Signed-distance shapes with soft smoothstep edges, no blur pass: egg-shaped glow, dome cut at a horizon, band, notch. See FRAG in src/experiments/sun-orb/shader.ts.' },
      { id: 'states', type: 'behaviour', label: 'State machine', keys: [], runtime: false,
        note: 'Six states driven by critically damped springs and a sin2/cos2 pulse envelope; a new pulse takes the max of the old one. See setState and simulate in src/experiments/sun-orb/index.ts.' },
    ],
    inputs: [
      { id: 'palette', type: 'palette', label: 'Palette', keys: PALETTE_KEYS, runtime: true },
      { id: 'softness', type: 'softness', label: 'Softness', keys: ['softness'], runtime: true },
    ],
  },
  defaults: {
    state: 'Rise', showTabs: true,
    size: 1, softness: 1, horizon: 0, notch: 1,
    domeTop: '#FDFDF3', domeLow: '#FCF6BC', rim: '#FDF4A8',
    glowTop: '#FDD6A0', glowSide: '#FF9678', mauve: '#D48AB2', violet: '#AAA2FF', blue: '#C6CEFA',
    band: '#FDE0FC', bandEnd: '#F4AAFF', background: '#FDFDFD',
    pulsePeriod: 1.45, pulseStrength: 0.72, sweepSpeed: 2.2, riseSpeed: 14,
  },
  groups: [
    { title: 'State', controls: [segmented('state', 'State', [...STATES]), action('retrigger', 'Play state again'), toggle('showTabs', 'Show tabs')] },
    { title: 'Shape', controls: [num('size', 'Size', 0.5, 1.4, 0.01), num('softness', 'Softness', 0.3, 2.5, 0.05), num('horizon', 'Horizon', -0.2, 0.2, 0.005), num('notch', 'Notch', 0, 1.5, 0.05)] },
    { title: 'Colour', controls: [color('domeTop', 'Dome top'), color('domeLow', 'Dome low'), color('rim', 'Dome rim'), color('glowTop', 'Glow top'), color('glowSide', 'Glow side'),
      color('mauve', 'Mauve'), color('violet', 'Violet'), color('blue', 'Blue'), color('band', 'Band'), color('bandEnd', 'Band ends'), color('background', 'Background')] },
    { title: 'Motion', controls: [num('pulsePeriod', 'Pulse period', 0.5, 4, 0.05, 's'), num('pulseStrength', 'Pulse strength', 0, 1.5, 0.05), num('sweepSpeed', 'Sweep speed', 0, 8, 0.1), num('riseSpeed', 'Rise speed', 4, 30, 0.5)] },
  ],
  presets: [
    { name: 'Reference', params: {} },
    { name: 'Ember', params: { state: 'Approved' } },
    { name: 'Night', params: { state: 'Dusk', background: '#0C0C12', softness: 1.3 } },
  ],

  mount(el, initial, ctx) {
    let params: Params = initial;
    const canvas = fillCanvas(el);
    canvas.style.transition = ctx.reducedMotion ? 'opacity .3s' : '';
    const quad = createQuad(canvas, FRAG, () => draw());

    const val: Record<Key, SpringState> = { rise: { x: 0, v: 0 }, energy: { x: 0, v: 0 }, warm: { x: 0, v: 0 }, dusk: { x: 0, v: 0 }, sweep: { x: 0, v: 0 } };
    const target: Record<Key, number> = { rise: 0, energy: 0, warm: 0, dusk: 0, sweep: 0 };
    let state: OrbState | 'idle' = 'idle';
    let simT = 0, stateT = 0, pulse = 0, sweepAngle = -Math.PI / 2, started = false;
    let pulses: Pulse[] = [];

    /* ----- tabs (DOM over the canvas) ----- */
    const style = document.createElement('style'); style.textContent = TAB_CSS; el.appendChild(style);
    const tabs = document.createElement('div'); tabs.className = 'orb-tabs'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Orb state');
    const ind = document.createElement('i'); tabs.appendChild(ind);
    const buttons = STATES.map((name) => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = name;
      btn.addEventListener('click', () => { setState(name); ctx.setParam('state', name); });
      tabs.appendChild(btn); return btn;
    });
    el.appendChild(tabs);
    const syncTabs = (): void => {
      tabs.style.display = b(params, 'showTabs') && !ctx.preview ? 'flex' : 'none';
      let active: HTMLButtonElement | undefined;
      buttons.forEach((btn) => { const on = btn.textContent === state; btn.setAttribute('aria-pressed', String(on)); if (on) active = btn; });
      ind.style.opacity = active ? '1' : '0';
      if (active) { ind.style.transform = `translateX(${active.offsetLeft}px)`; ind.style.width = `${active.offsetWidth}px`; }
    };

    function setState(next: OrbState): void {
      state = next; stateT = 0;
      target.sweep = next === 'Loading' ? 1 : 0;
      if (next !== 'Set') target.rise = next === 'Dusk' ? DUSK_RISE : 1;
      switch (next) {
        case 'Rise': target.warm = 0; target.dusk = 0; val.energy.x = 1; target.energy = 0; break;
        case 'Response': pulses.push({ t0: simT, ...RESPONSE_PULSE }); break;
        case 'Loading': break;
        case 'Approved': target.warm = 1; target.dusk = 0; pulses.push({ t0: simT, ...APPROVED_PULSE }); break;
        case 'Dusk': target.warm = 0; target.dusk = 1; break;
        case 'Set': target.rise = 0; break;
      }
      if (ctx.reducedMotion) {
        // No travel and no pulses: jump to the target and let the canvas cross-fade.
        pulses = []; target.sweep = 0; val.energy.x = 0;
        (Object.keys(val) as Key[]).forEach((k) => { val[k].x = target[k]; val[k].v = 0; });
        canvas.style.opacity = '0.6'; requestAnimationFrame(() => { canvas.style.opacity = '1'; });
      }
      syncTabs();
    }

    function simulate(dt: number): void {
      simT += dt; stateT += dt;
      if (!started && simT >= RISE_DELAY) { started = true; const want = s(params, 'state'); setState(isState(want) ? want : 'Rise'); if (want !== 'Rise' && want !== 'Set') val.energy.x = 1; }
      stepSpring(val.rise, target.rise, n(params, 'riseSpeed'), dt);
      (['energy', 'warm', 'dusk', 'sweep'] as const).forEach((k) => stepSpring(val[k], target[k], OMEGA[k], dt));
      // A new pulse does not cancel the last one: take the maximum.
      pulses = pulses.filter((p) => simT - p.t0 < p.dur);
      let p = 0;
      for (const q of pulses) p = Math.max(p, q.amp * envelope((simT - q.t0) / q.dur));
      if (state === 'Loading' && !ctx.reducedMotion) { const period = n(params, 'pulsePeriod'); p = Math.max(p, n(params, 'pulseStrength') * envelope((stateT % period) / period)); }
      pulse = p;
      sweepAngle += n(params, 'sweepSpeed') * dt;
    }

    const rgb = (key: string): [number, number, number] => hexToRgb(s(params, key));
    function draw(): void {
      const safe = (x: number): number => (Number.isFinite(x) ? x : 0);
      quad.set('uRise', Math.max(0, Math.min(1.05, safe(val.rise.x))));
      quad.set('uEnergy', safe(val.energy.x)); quad.set('uPulse', safe(pulse));
      quad.set('uWarm', safe(val.warm.x)); quad.set('uDusk', safe(val.dusk.x));
      quad.set('uSweep', safe(val.sweep.x)); quad.set('uSweepAngle', sweepAngle);
      quad.set('uSoft', n(params, 'softness')); quad.set('uSize', n(params, 'size'));
      quad.set('uHorizon', n(params, 'horizon') * 1700); quad.set('uNotch', n(params, 'notch'));
      quad.set('uBg', ...rgb('background'));
      quad.set('uDomeTop', ...rgb('domeTop')); quad.set('uDomeLow', ...rgb('domeLow')); quad.set('uRim', ...rgb('rim'));
      quad.set('uGlowTop', ...rgb('glowTop')); quad.set('uGlowSide', ...rgb('glowSide')); quad.set('uMauve', ...rgb('mauve'));
      quad.set('uViolet', ...rgb('violet')); quad.set('uBlue', ...rgb('blue')); quad.set('uBand', ...rgb('band')); quad.set('uBandEnd', ...rgb('bandEnd'));
      quad.draw();
    }

    const off = ctx.clock.onTick((t, dt) => {
      if (dt > 0) simulate(dt);
      // A seek (dt = 0) to a later time: run the simulation forward in fixed steps so the frame is repeatable.
      else while (simT + SIM_STEP <= t) simulate(SIM_STEP);
      draw();
    });

    /** Set every spring to a settled state. Capture mode and reduced motion use this. */
    const force = (warm: number, dusk: number): void => {
      started = true; pulses = []; pulse = 0;
      target.rise = dusk ? DUSK_RISE : 1; target.warm = warm; target.dusk = dusk; target.energy = 0; target.sweep = 0;
      (Object.keys(val) as Key[]).forEach((k) => { val[k].x = target[k]; val[k].v = 0; });
      state = warm ? 'Approved' : dusk ? 'Dusk' : 'Rise'; syncTabs(); draw();
    };
    if (ctx.reducedMotion) { const want = s(initial, 'state'); force(want === 'Approved' ? 1 : 0, want === 'Dusk' ? 1 : 0); }
    el.style.background = s(params, 'background');
    syncTabs();

    return {
      update(next) {
        const prev = params; params = next;
        el.style.background = s(next, 'background');
        const want = s(next, 'state');
        if (started && want !== s(prev, 'state') && want !== state && isState(want)) setState(want);
        syncTabs();
        if (!ctx.clock.playing) draw();
      },
      trigger(id) {
        if (id === 'retrigger' && state !== 'idle') setState(state);
        else if (id === 'capture:state=default') force(0, 0);
        else if (id === 'capture:state=approved') force(1, 0);
        else if (id === 'capture:state=dusk') force(0, 1);
      },
      resize(width, height, dpr) {
        quad.resize(width, height, dpr);
        tabs.style.fontSize = `${(width / TABS_BASE_WIDTH) * 16}px`;
        tabs.style.top = `${TABS_TOP * height}px`;
        syncTabs(); draw();
      },
      destroy() { off(); quad.destroy(); },
    };
  },
};

export default body;
