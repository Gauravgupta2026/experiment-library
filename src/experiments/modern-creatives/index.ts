import { hexToRgb } from '../../lib/color';
import { createQuad, fillCanvas } from '../../lib/gl';
import { clamp01, easeOutCubic, lerp, span } from '../../lib/spring';
import { imageOr, placeholder } from '../media';
import { b, color, image, n, num, s, text, toggle, type ExperimentBody, type Params } from '../types';

/* Timeline, in seconds. Read from the reference recording (see SPEC.md section 9). */
const DURATION = 8.6;
const T = {
  melt: 2.4,            // scene A starts to melt; the gradient starts to rise
  riseEnd: 3.6,
  firstWords: 3.5,      // the first two words appear together
  nextWords: 4.0,       // the third word; later words follow at wordInterval
  wordsOffA: 7.0, wordsOffB: 7.08,
  strip: 7.15,
  loopFade: 0.35,       // cross-fade to the base colour at both ends so the loop has no jump
};
const WORD_FADE = 0.25, WORD_DIM = 0.72, WORD_FULL_FADE = 0.6;
const MARKER_BLINKS_PER_S = 9, MARKER_MOVE = 0.24;
const STRIP = { left: 0.179, width: 0.503, heightFw: 4.5 };
const HERO = { left: 37, top: 19.5, width: 26, height: 61.2 };
const PAD_X_FW = 0.8, PAD_Y_FW = 0.66;
/** Inter: with line-height 1, the baseline is 0.86 em under the top of the box. */
const BASELINE_EM = 0.86;
/** 1% of the reference frame width in CSS px. */
const REF_FW = 15.11;

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uRise; uniform float uWave; uniform float uSoft;
uniform vec3 uBase; uniform vec3 uRed; uniform vec3 uMid; uniform vec3 uMagenta; uniform vec3 uOrange; uniform vec3 uGlow;
vec3 hex(float r,float g,float b){return vec3(r,g,b)/255.;}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec2 uv=vec2(gl_FragCoord.x/uRes.x,1.-gl_FragCoord.y/uRes.y); // y down
  float t=uTime;
  float under=(1.-uRise);                                        // 1 = everything is below the frame
  // Wavy top edge of the red field. A low value means that red reaches higher.
  float edge=.455-uWave*cos(6.2832*(uv.x-.16)*.95+.25*sin(t*.5))+under*.95;
  float k=smoothstep(edge-.558*uSoft,edge+.442*uSoft,uv.y);      // 0 = base, 1 = red
  // The step from base to red goes through a pale pink. It is not a straight mix.
  vec3 mid=mix(uMid,hex(232.,170.,222.),smoothstep(.15,.45,uv.x));
  vec3 col=k<.5?mix(uBase,mid,smoothstep(0.,.5,k)):mix(mid,uRed,smoothstep(.5,.92,k));
  // magenta blob, centre right; it drifts slowly
  vec2 b1=vec2(.62+.03*sin(t*.4),.60+.02*cos(t*.33)+under*.9);
  float m1=1.-smoothstep(0.,.36,length((uv-b1)*vec2(1.15,1.)));
  col=mix(col,uMagenta,m1*.95*smoothstep(.15,.6,k));
  // pale glow behind the text
  float g0=1.-smoothstep(0.,.2,length((uv-vec2(.47,.49+under*.9))*vec2(.8,1.)));
  col=mix(col,uGlow,g0*.85*smoothstep(.05,.4,k));
  // magenta at the right edge
  float m2=1.-smoothstep(0.,.42,length(uv-vec2(1.05,.46+under*.9)));
  col=mix(col,uMagenta-vec3(3.,15.,9.)/255.,m2*.9);
  // orange corners: bottom right is strong, bottom left is weak and comes and goes
  float o1=1.-smoothstep(0.,.42,length((uv-vec2(1.04,1.04))*vec2(1.,1.15)));
  col=mix(col,uOrange,o1*uRise);
  float o2=1.-smoothstep(0.,.26,length(uv-vec2(.06,1.08)));
  col=mix(col,uOrange-vec3(6.,10.,-12.)/255.,o2*uRise*(.5+.5*cos(t*.35)));
  // cool haze, upper left
  float h=1.-smoothstep(0.,.28,length((uv-vec2(.05,edge-.14))*vec2(.8,1.6)));
  col=mix(col,hex(214.,206.,234.),h*.35*(1.-k));
  col+=(hash(gl_FragCoord.xy)-.5)/255.;
  gl_FragColor=vec4(col,1.);
}`;

const CSS = `
.mc{position:absolute;inset:0;overflow:hidden;font-family:var(--font)}
.mc-a{position:absolute;inset:0;transform-origin:50% 50%}
.mc-big{position:absolute;font-size:6.1em;line-height:1;font-weight:400;color:#111;white-space:nowrap;letter-spacing:-.01em}
.mc-a img{position:absolute;object-fit:cover;display:block}
.mc-line{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);margin:0;display:flex;gap:.28em;white-space:nowrap;
  font-size:2.8em;line-height:1.2;font-weight:400;letter-spacing:-.005em;color:#fff}
.mc-mk{position:absolute;left:0;top:0}
.mc-strip{position:absolute;object-fit:cover;display:block}
.mc-fade{position:absolute;inset:0;pointer-events:none}`;

interface Box { x0: number; y0: number; x1: number; y1: number }

const PALETTE_KEYS = ['base', 'glowColor', 'mid', 'magenta', 'orange', 'red'];

const body: ExperimentBody = {
  duration: DURATION,
  traits: {
    outputs: [
      { id: 'palette', type: 'palette', label: 'Palette', keys: PALETTE_KEYS, runtime: true },
      { id: 'softness', type: 'softness', label: 'Edge softness', keys: ['edgeSoft'], runtime: true },
      { id: 'melt', type: 'behaviour', label: 'Blur melt', keys: [], runtime: false,
        note: 'A DOM scene shrinks, blurs and colour-shifts as one filtered layer while a WebGL mesh gradient rises with a wavy edge. See render() and FRAG in src/experiments/modern-creatives/index.ts.' },
      { id: 'word-reveal', type: 'behaviour', label: 'Word reveal and markers', keys: [], runtime: false,
        note: 'Words appear one by one with fixed layout; four square markers track the corners of the visible words, then move to a strip. See render() in src/experiments/modern-creatives/index.ts.' },
    ],
    inputs: [
      { id: 'palette', type: 'palette', label: 'Palette', keys: PALETTE_KEYS, runtime: true },
      { id: 'softness', type: 'softness', label: 'Edge softness', keys: ['edgeSoft'], runtime: true },
    ],
  },
  posterTime: 6.5,
  defaults: {
    wordLeft: 'you', wordRight: 'create', headline: 'The AI powered platform for modern creatives', wordInterval: 0.42,
    hero: '', trailCount: 9, strip: '',
    base: '#E5E5E5', red: '#FA434C', mid: '#EC8CA8', magenta: '#E98ADE', orange: '#FC9626', glowColor: '#EDDEF5',
    waveAmp: 0.075, edgeSoft: 0.43, drift: 1,
    meltBlur: 48, meltDuration: 0.9,
    markerSize: 0.66, markerColor: '#111111',
    rate: 1, loop: true,
  },
  groups: [
    { title: 'Copy', controls: [text('wordLeft', 'Left word', 12), text('wordRight', 'Right word', 12), text('headline', 'Headline', 60), num('wordInterval', 'Word interval', 0.1, 1, 0.01, 's')] },
    { title: 'Images', controls: [image('hero', 'Hero'), num('trailCount', 'Trail count', 0, 16, 1), image('strip', 'Strip')] },
    { title: 'Gradient', controls: [color('base', 'Base'), color('red', 'Red'), color('mid', 'Middle'), color('magenta', 'Magenta'), color('orange', 'Orange'), color('glowColor', 'Glow'),
      num('waveAmp', 'Wave', 0, 0.3, 0.005), num('edgeSoft', 'Edge softness', 0.05, 0.6, 0.01), num('drift', 'Drift', 0, 3, 0.05)] },
    { title: 'Melt', controls: [num('meltBlur', 'Blur', 0, 120, 1, 'px'), num('meltDuration', 'Duration', 0.2, 3, 0.05, 's')] },
    { title: 'Markers', controls: [num('markerSize', 'Size', 0.2, 2, 0.01, '%'), color('markerColor', 'Colour')] },
    { title: 'Time', controls: [num('rate', 'Speed', 0.25, 2, 0.05), toggle('loop', 'Loop')] },
  ],

  mount(el, initial, ctx) {
    let params: Params = initial;
    let W = 1, H = 1;
    let shaderTimeOverride: number | null = null;
    const root = document.createElement('div'); root.className = 'mc';
    const style = document.createElement('style'); style.textContent = CSS;
    el.append(style, root);
    const canvas = fillCanvas(root);
    const quad = createQuad(canvas, FRAG, () => render(ctx.clock.now));

    /* ----- scene A ----- */
    const sceneA = document.createElement('div'); sceneA.className = 'mc-a';
    const left = document.createElement('span'); left.className = 'mc-big';
    const right = document.createElement('span'); right.className = 'mc-big';
    const trail = document.createElement('div');
    const hero = document.createElement('img'); hero.alt = '';
    Object.assign(hero.style, { left: `${HERO.left}%`, top: `${HERO.top}%`, width: `${HERO.width}%`, height: `${HERO.height}%` });
    sceneA.append(left, trail, hero, right);

    /* ----- scene B ----- */
    const line = document.createElement('p'); line.className = 'mc-line';
    const strip = document.createElement('img'); strip.className = 'mc-strip'; strip.alt = '';
    const markers = [0, 1, 2, 3].map(() => { const m = document.createElement('i'); m.className = 'mc-mk'; return m; });
    const fade = document.createElement('div'); fade.className = 'mc-fade';
    root.append(sceneA, line, strip, ...markers, fade);

    let words: HTMLSpanElement[] = [];
    let boxes: Box[] = [];
    let builtFor = '';

    /** Build everything that depends on text and image params. Cheap params skip this. */
    function build(): void {
      const key = [s(params, 'wordLeft'), s(params, 'wordRight'), s(params, 'headline'), s(params, 'hero'), s(params, 'strip'), n(params, 'trailCount')].join('|');
      if (key === builtFor) return;
      builtFor = key;
      left.textContent = s(params, 'wordLeft'); right.textContent = s(params, 'wordRight');
      hero.src = imageOr(s(params, 'hero'), 0);
      strip.src = imageOr(s(params, 'strip'), 3);
      const count = n(params, 'trailCount');
      trail.replaceChildren(...Array.from({ length: count }, (_, i) => {
        const img = document.createElement('img'); img.alt = ''; img.src = placeholder(i + 1);
        // Images dropped along a path toward the hero. Later ones are larger and on top.
        const cx = 15 + i * 2.6, cy = 58 - 8 * Math.sin(i * 0.9) + (i % 3) * 3, w = 4 + i * 0.45;
        Object.assign(img.style, { left: `${cx - w / 2}%`, top: `calc(${cy}% - ${(w * 4) / 3 / 2}em)`, width: `${w}%`, aspectRatio: '3 / 4' });
        return img;
      }));
      words = s(params, 'headline').split(/\s+/).filter(Boolean).map((w) => { const sp = document.createElement('span'); sp.textContent = w; return sp; });
      line.replaceChildren(...words);
      measure();
    }

    /** Word boxes relative to the frame. Words keep their space when hidden, so this does not change over time. */
    function measure(): void {
      const o = root.getBoundingClientRect();
      boxes = words.map((w) => { const r = w.getBoundingClientRect(); return { x0: r.left - o.left, y0: r.top - o.top, x1: r.right - o.left, y1: r.bottom - o.top }; });
    }

    /** Time at which word i appears. The first two come together. */
    const appearAt = (i: number): number => (i < 2 ? T.firstWords : T.nextWords + (i - 2) * n(params, 'wordInterval'));
    /** Words blink out in two groups (1-based words 2, 3, 5, 7 first). */
    const offAt = (i: number): number => (i === 1 || (i > 0 && i % 2 === 0) ? T.wordsOffA : T.wordsOffB);

    function render(t: number): void {
      const fw = W / 100;
      /* gradient */
      const rise = t < T.melt ? lerp(0.05, 0.2, t / T.melt) : lerp(0.2, 1, easeOutCubic(span(t, T.melt, T.riseEnd - T.melt)));
      const rgb = (k: string): [number, number, number] => hexToRgb(s(params, k));
      quad.set('uTime', shaderTimeOverride ?? t * n(params, 'drift')); quad.set('uRise', rise);
      quad.set('uWave', n(params, 'waveAmp')); quad.set('uSoft', n(params, 'edgeSoft'));
      quad.set('uBase', ...rgb('base')); quad.set('uRed', ...rgb('red')); quad.set('uMid', ...rgb('mid'));
      quad.set('uMagenta', ...rgb('magenta')); quad.set('uOrange', ...rgb('orange')); quad.set('uGlow', ...rgb('glowColor'));
      quad.draw();

      /* scene A: melt = shrink, blur, tint, fade. The whole group blurs as one layer. */
      const dur = n(params, 'meltDuration');
      const m = span(t, T.melt, dur);
      const aOpacity = 1 - span(t, T.melt + dur * 0.44, dur * 0.56);
      sceneA.style.visibility = aOpacity <= 0 ? 'hidden' : 'visible';
      if (aOpacity > 0) {
        sceneA.style.opacity = String(aOpacity);
        sceneA.style.transform = `scale(${1 - 0.06 * m})`;
        // Blur plus a colour push. The filter acts on the content only, so the empty parts of the group stay clear.
        // meltBlur is in px for a frame 1511 px wide (the reference); it scales with the frame.
        const blur = (n(params, 'meltBlur') * m * m * fw) / REF_FW;
        sceneA.style.filter = m > 0 ? `blur(${blur}px) sepia(${0.7 * m}) saturate(${1 + 5 * m}) hue-rotate(${-45 * m}deg) brightness(${1 + 0.2 * m})` : 'none';
        // will-change only during the melt: a permanent blurred layer costs memory.
        sceneA.style.willChange = m > 0 && m < 1 ? 'filter, transform' : 'auto';
      }

      /* words */
      const last = words.length - 1;
      let first = -1, lastVisible = -1;
      words.forEach((w, i) => {
        const a = appearAt(i);
        const visible = t >= a && t < offAt(i);
        const dim = WORD_DIM * span(t, a, WORD_FADE);
        const full = (1 - WORD_DIM) * span(t, a + 2 * n(params, 'wordInterval'), WORD_FULL_FADE);
        w.style.opacity = visible ? String(clamp01(dim + full)) : '0';
        if (visible) { if (first < 0) first = i; lastVisible = i; }
      });

      /* strip and markers */
      const stripOn = span(t, T.strip, 0.12);
      const sh = STRIP.heightFw * fw;
      const stripBox: Box = { x0: STRIP.left * W, y0: H / 2 - sh / 2, x1: (STRIP.left + STRIP.width) * W, y1: H / 2 + sh / 2 };
      Object.assign(strip.style, { left: `${stripBox.x0}px`, top: `${stripBox.y0}px`, width: `${stripBox.x1 - stripBox.x0}px`, height: `${sh}px`, opacity: String(stripOn) });

      const size = n(params, 'markerSize') * fw;
      const px = PAD_X_FW * fw, py = PAD_Y_FW * fw;
      const textBox = (a: number, z: number): Box | null => {
        const A = boxes[a], Z = boxes[z];
        return A && Z ? { x0: A.x0 - px, y0: A.y0 - py + size / 2, x1: Z.x1 + px, y1: A.y1 + py - size / 2 } : null;
      };
      // After the words go, the markers travel from the full line to the strip corners.
      const shown = t >= T.firstWords;
      let box = first >= 0 ? textBox(first, lastVisible) : textBox(0, last);
      if (t >= T.wordsOffA) { const full = textBox(0, last); const k = easeOutCubic(span(t, T.strip, MARKER_MOVE)); if (full) box = { x0: lerp(full.x0, stripBox.x0, k), y0: lerp(full.y0, stripBox.y0, k), x1: lerp(full.x1, stripBox.x1, k), y1: lerp(full.y1, stripBox.y1, k) }; }
      const adding = t >= T.firstWords && t < appearAt(last) + 0.3;
      const blink = adding ? Math.floor(t * MARKER_BLINKS_PER_S) % 4 : -1;
      const color = s(params, 'markerColor');
      markers.forEach((mk, i) => {
        if (!box || !shown) { mk.style.opacity = '0'; return; }
        const x = i % 2 === 0 ? box.x0 : box.x1, y = i < 2 ? box.y0 : box.y1;
        Object.assign(mk.style, { width: `${size}px`, height: `${size}px`, background: color, opacity: i === blink ? '0' : '1', transform: `translate(${x - size / 2}px, ${y - size / 2}px)` });
      });

      /* loop seam */
      const seam = b(params, 'loop') ? Math.max(1 - span(t, 0, T.loopFade), span(t, DURATION - T.loopFade, T.loopFade)) : 0;
      fade.style.background = s(params, 'base'); fade.style.opacity = String(seam);
    }

    function layout(): void {
      root.style.fontSize = `${W / 100}px`;
      // Baseline of the big words at 55% of the height.
      const top = `calc(${0.55 * H}px - ${BASELINE_EM}em)`;
      Object.assign(left.style, { right: '91.5%', top }); Object.assign(right.style, { left: '68%', top });
      measure();
    }
    const applyClock = (): void => { ctx.clock.rate = n(params, 'rate'); ctx.clock.loop = b(params, 'loop'); };

    build(); applyClock();
    const off = ctx.clock.onTick((t) => render(t));
    // Text is measured again when the web font arrives: the fallback font has other widths.
    void document.fonts?.ready.then(() => { if (root.isConnected) { measure(); render(ctx.clock.now); } });

    return {
      update(next) { params = next; applyClock(); build(); render(ctx.clock.now); },
      trigger(id) {
        const m = /^capture:shaderTime=(.+)$/.exec(id);
        if (m) { const v = Number(m[1]); shaderTimeOverride = Number.isFinite(v) ? v : null; render(ctx.clock.now); }
      },
      resize(width, height, dpr) { W = width; H = height; quad.resize(width, height, dpr); layout(); render(ctx.clock.now); },
      destroy() { off(); quad.destroy(); },
    };
  },
};

export default body;
