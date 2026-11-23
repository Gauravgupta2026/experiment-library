import { hexToRgb } from '../../lib/color';
import { createQuad, fillCanvas } from '../../lib/gl';
import { hash01 } from '../../lib/prng';
import { clamp01, easeOutCubic, lerp, smooth, span, springAt } from '../../lib/spring';
import { imageOr } from '../media';
import { b, color, image, n, num, s, text, toggle, type ExperimentBody, type Params } from '../types';
import { FRAG } from './shader';

/* Timeline in seconds, read from the reference recording (SPEC.md section 8). */
const DURATION = 8;
const T = {
  textIn: 2.0, letterStagger: 0.035, letterFade: 0.35, letterWhiteDelay: 0.15, letterWhite: 0.6,
  glitchOn: 3.3, glitchOff: 4.0,
  wipe: 3.5,
  words: 4.0, wordStep: 0.65,       // "{ in }" then one word per step
  lockAfterLastWord: 0.3,
  finalWord: 6.1,
  images: [6.2, 6.35, 6.5],
  loopFade: 0.3,
};
const PALETTE_START = 0;
const WIPE_EASE_POWER = 2.4;
const MARKER_JUMP_S = 0.09, MARKER_HIDE_P = 0.3, MARKER_MOVE = 0.28;
/** Locked marker rectangles, as fractions of the frame. They are off centre in the reference. */
const LOCK_1 = { x0: 0.375, y0: 0.33, x1: 0.877, y1: 0.667 };
const LOCK_2 = { x0: 0.123, y0: 0.33, x1: 0.753, y1: 0.667 };
const WORD_SPRING = { k: 260, c: 22 }, IMAGE_SPRING = { k: 320, c: 20 };
const GAP_EM = 2.3;
const LINE = { left: 0.198, centerY: 0.48, sizeFw: 4.6, tracking: -0.035 };
const FIGURE_TEX_WIDTH = 64;
const WARM_A: [number, number, number] = [245, 160, 80], WARM_B: [number, number, number] = [232, 96, 192];
const LINE_FONT = '"Inter Tight Variable", "Inter Tight", Inter, system-ui, sans-serif';

const CSS = `
.im{position:absolute;inset:0;overflow:hidden}
.im-br{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;white-space:pre;
  font-family:${LINE_FONT};font-weight:400;font-size:3.44em;line-height:1.2;letter-spacing:-.03em;color:#111}
.im-br span{display:inline-block;overflow:visible}
.im-w{overflow:hidden!important;vertical-align:top}
.im-gap{position:relative;height:1.2em}
.im-gap img{position:absolute;top:50%;object-fit:cover;display:block}
.im-mk{position:absolute;left:0;top:0}
.im-fade{position:absolute;inset:0;pointer-events:none}`;

interface Rect { x0: number; y0: number; x1: number; y1: number }
const mixRect = (a: Rect, z: Rect, k: number): Rect => ({ x0: lerp(a.x0, z.x0, k), y0: lerp(a.y0, z.y0, k), x1: lerp(a.x1, z.x1, k), y1: lerp(a.y1, z.y1, k) });

const body: ExperimentBody = {
  duration: DURATION,
  posterTime: 3.25,
  defaults: {
    line: 'Imagine to have all your tools', words: 'in one place', finalWord: 'intro|ducing',
    figureImage: '', bgTop: '#FACA96', bgBottom: '#9E92F8',
    pal1: '#D65C92', pal2: '#F5CC90', pal3: '#EBC6AD', pal4: '#E264B0', pal5: '#B890F0',
    softness: 1, paletteSpeed: 0.33,
    wipeColumns: 50, wipeAngle: 0.58, wipeNoise: 0.34, wipeDuration: 1.6, edgeDepth: 1.6,
    edge1: '#D860F0', edge2: '#F8B860', edge3: '#F096CD', edge4: '#F8D6F0', wipeTo: '#E5E5E5', glitch: true,
    markerSize: 1.2, markerColor: '#111111',
    image1: '', image2: '', image3: '',
    rate: 1, loop: true,
  },
  groups: [
    { title: 'Copy', controls: [text('line', 'First line', 40), text('words', 'Bracket words', 40), text('finalWord', 'Final word', 20)] },
    { title: 'Figure', controls: [image('figureImage', 'Figure image'), color('bgTop', 'Sky top'), color('bgBottom', 'Sky bottom'),
      color('pal1', 'Palette 1'), color('pal2', 'Palette 2'), color('pal3', 'Palette 3'), color('pal4', 'Palette 4'), color('pal5', 'Palette 5'),
      num('softness', 'Softness', 0.2, 3, 0.05), num('paletteSpeed', 'Palette speed', 0, 2, 0.01)] },
    { title: 'Wipe', controls: [num('wipeColumns', 'Columns', 12, 160, 1), num('wipeAngle', 'Angle', 0, 1.5, 0.01), num('wipeNoise', 'Noise', 0, 1, 0.01),
      num('wipeDuration', 'Duration', 0.4, 4, 0.1, 's'), num('edgeDepth', 'Edge depth', 0, 6, 0.1), color('edge1', 'Edge 1'), color('edge2', 'Edge 2'),
      color('edge3', 'Edge 3'), color('edge4', 'Edge 4'), color('wipeTo', 'Wipe to'), toggle('glitch', 'Glitch')] },
    { title: 'Markers', controls: [num('markerSize', 'Size', 0.4, 3, 0.1, '%'), color('markerColor', 'Colour')] },
    { title: 'Images', controls: [image('image1', 'Image 1'), image('image2', 'Image 2'), image('image3', 'Image 3')], collapsed: true },
    { title: 'Time', controls: [num('rate', 'Speed', 0.25, 2, 0.05), toggle('loop', 'Loop')] },
  ],

  mount(el, initial, ctx) {
    let params: Params = initial;
    let W = 1, H = 1, DPR = 1;
    const root = document.createElement('div'); root.className = 'im';
    const style = document.createElement('style'); style.textContent = CSS;
    el.append(style, root);
    const canvas = fillCanvas(root);
    const quad = createQuad(canvas, FRAG, () => { textKey = ''; figureKey = ''; render(ctx.clock.now); });

    /* ----- first line: drawn to a 2D canvas, then used as a texture so the wipe can cut it ----- */
    const textCanvas = document.createElement('canvas');
    const tctx = textCanvas.getContext('2d');
    let textKey = '';
    let glyphX: number[] = [];

    function layoutLine(): void {
      if (!tctx) return;
      const size = LINE.sizeFw * (W / 100) * DPR;
      tctx.font = `300 ${size}px ${LINE_FONT}`;
      let x = LINE.left * W * DPR;
      // Letters are placed one by one, so each can have its own colour and opacity.
      glyphX = [...s(params, 'line')].map((ch) => { const at = x; x += tctx.measureText(ch).width + LINE.tracking * size; return at; });
    }
    function drawLine(t: number): void {
      if (!tctx) return;
      const chars = [...s(params, 'line')];
      const end = T.textIn + chars.length * T.letterStagger + T.letterWhiteDelay + T.letterWhite;
      // The texture changes only during the reveal. Outside it, one upload is enough.
      const key = t < T.textIn ? 'empty' : t > end ? 'full' : `t${t.toFixed(3)}`;
      const full = `${key}|${s(params, 'line')}|${textCanvas.width}x${textCanvas.height}`;
      if (full === textKey) return;
      textKey = full;
      const size = LINE.sizeFw * (W / 100) * DPR;
      tctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
      tctx.font = `300 ${size}px ${LINE_FONT}`; tctx.textBaseline = 'middle';
      chars.forEach((ch, i) => {
        const lt = t - T.textIn - i * T.letterStagger;
        const alpha = smooth(lt / T.letterFade);
        if (alpha <= 0) return;
        // A new letter is warm (orange to pink), then it settles to white.
        const k = smooth((lt - T.letterWhiteDelay) / T.letterWhite);
        const wm = 0.5 + 0.5 * Math.sin(i * 0.45 + t * 3);
        const c = [0, 1, 2].map((j) => Math.round(lerp(lerp(WARM_A[j] ?? 0, WARM_B[j] ?? 0, wm), 255, k)));
        tctx.globalAlpha = alpha; tctx.fillStyle = `rgb(${c.join(',')})`;
        tctx.fillText(ch, glyphX[i] ?? 0, LINE.centerY * H * DPR);
      });
      quad.texture('uText', 0, textCanvas);
    }

    /* ----- optional figure image ----- */
    let figureKey = '';
    const figureCanvas = document.createElement('canvas');
    let hasFigure = false;
    function loadFigure(): void {
      const src = s(params, 'figureImage');
      if (src === figureKey) return;
      figureKey = src; hasFigure = false;
      if (!src) { render(ctx.clock.now); return; }
      const img = new Image();
      img.onload = () => {
        if (figureKey !== src) return;
        // A tiny copy with linear filtering is the blur: enough at this softness.
        figureCanvas.width = FIGURE_TEX_WIDTH; figureCanvas.height = Math.max(1, Math.round(FIGURE_TEX_WIDTH * (H / W)));
        const f = figureCanvas.getContext('2d'); if (!f) return;
        const scale = Math.max(figureCanvas.width / img.width, figureCanvas.height / img.height);   // cover
        const w = img.width * scale, h = img.height * scale;
        f.drawImage(img, (figureCanvas.width - w) / 2, (figureCanvas.height - h) / 2, w, h);
        quad.texture('uFigure', 1, figureCanvas); hasFigure = true; render(ctx.clock.now);
      };
      img.src = src;
    }

    /* ----- bracket words ----- */
    const row1 = document.createElement('div'); row1.className = 'im-br';
    const row2 = document.createElement('div'); row2.className = 'im-br';
    const markers = [0, 1, 2, 3].map(() => { const m = document.createElement('i'); m.className = 'im-mk'; return m; });
    const fade = document.createElement('div'); fade.className = 'im-fade';
    root.append(row1, row2, ...markers, fade);
    let wordEls: HTMLSpanElement[] = [], wordW: number[] = [];
    let gap: HTMLSpanElement | null = null; let imgs: HTMLImageElement[] = [];
    let textW = 0, textH = 0, builtFor = '';
    const span_ = (cls: string, txt: string): HTMLSpanElement => { const e = document.createElement('span'); if (cls) e.className = cls; e.textContent = txt; return e; };

    function build(): void {
      const key = [s(params, 'words'), s(params, 'finalWord'), s(params, 'image1'), s(params, 'image2'), s(params, 'image3')].join('|');
      if (key === builtFor) return;
      builtFor = key;
      const list = s(params, 'words').split(/\s+/).filter(Boolean);
      // Each word after the first carries its leading space, so the space grows with the word.
      wordEls = list.map((w, i) => span_('im-w', i === 0 ? w : ` ${w}`));
      row1.replaceChildren(span_('', '{ '), ...wordEls, span_('', ' }'));
      const [a = '', z = ''] = s(params, 'finalWord').split('|');
      gap = span_('im-gap', '');
      // Sizes are fractions of the font size: main, second (behind, left), third (small, right).
      const spec = [{ w: 1.2, h: 1.2, x: 0, z: 2 }, { w: 0.58, h: 0.92, x: -0.72, z: 1 }, { w: 0.23, h: 0.27, x: 1.07, z: 1 }];
      imgs = spec.map((sp, i) => {
        const im = document.createElement('img'); im.alt = ''; im.src = imageOr(s(params, `image${i + 1}`), i + 2);
        Object.assign(im.style, { width: `${sp.w}em`, height: `${sp.h}em`, left: `calc(50% + ${sp.x - sp.w / 2}em)`, marginTop: `${-sp.h / 2}em`, zIndex: String(sp.z) });
        return im;
      });
      gap.append(...imgs);
      row2.replaceChildren(span_('', '{ '), span_('', a), gap, span_('', z), span_('', ' }'));
      measure();
    }
    function measure(): void {
      wordEls.forEach((w) => { w.style.width = 'auto'; });
      wordW = wordEls.map((w) => w.getBoundingClientRect().width);
      const r = row1.getBoundingClientRect(); textW = r.width; textH = r.height;
    }

    function render(t: number): void {
      const fw = W / 100;
      const rgb = (k: string): [number, number, number] => hexToRgb(s(params, k));
      // Ease-out: the edge crosses most of the frame early and the last sliver leaves slowly, as in the reference.
      const wipe = 1 - Math.pow(1 - clamp01((t - T.wipe) / n(params, 'wipeDuration')), WIPE_EASE_POWER);
      drawLine(t);
      quad.set('uTime', t);
      // The palette is still for 2 s, then it cycles while the text comes in.
      quad.set('uPhase', PALETTE_START + Math.max(0, t - T.textIn) * n(params, 'paletteSpeed'));
      quad.set('uWipe', wipe);
      quad.set('uGlitch', b(params, 'glitch') && t > T.glitchOn && t < T.glitchOff ? 1 : 0);
      quad.set('uCols', n(params, 'wipeColumns')); quad.set('uAngle', n(params, 'wipeAngle')); quad.set('uNoise', n(params, 'wipeNoise'));
      quad.set('uEdgeDepth', n(params, 'edgeDepth')); quad.set('uSoft', n(params, 'softness')); quad.set('uHasFigure', hasFigure ? 1 : 0);
      quad.set('uBgTop', ...rgb('bgTop')); quad.set('uBgBottom', ...rgb('bgBottom')); quad.set('uWipeTo', ...rgb('wipeTo'));
      (['uPal1', 'uPal2', 'uPal3', 'uPal4', 'uPal5'] as const).forEach((u, i) => quad.set(u, ...rgb(`pal${i + 1}`)));
      (['uEdge1', 'uEdge2', 'uEdge3', 'uEdge4'] as const).forEach((u, i) => quad.set(u, ...rgb(`edge${i + 1}`)));
      quad.draw();

      /* bracket words: a new word grows from width 0 with a spring, so the braces move with a small overshoot */
      const phase2 = t >= T.finalWord;
      row1.style.visibility = t >= T.words && !phase2 ? 'visible' : 'hidden';
      row2.style.visibility = phase2 ? 'visible' : 'hidden';
      wordEls.forEach((w, i) => {
        const at = T.words + i * T.wordStep;
        const p = i === 0 ? 1 : springAt(t - at, WORD_SPRING.k, WORD_SPRING.c);
        const o = i === 0 ? 1 : span(t, at, 0.2);
        w.style.width = `${Math.max(0, (wordW[i] ?? 0) * p)}px`;
        w.style.opacity = String(o);
        w.style.filter = o < 1 ? `blur(${6 * (1 - o) * fw / 15.11}px)` : 'none';
      });
      if (gap) gap.style.width = `${Math.max(0, GAP_EM * springAt(t - T.finalWord, WORD_SPRING.k, WORD_SPRING.c))}em`;
      imgs.forEach((im, i) => {
        const at = T.images[i] ?? T.finalWord;
        im.style.opacity = String(span(t, at, 0.12));
        im.style.transform = `scale(${lerp(0.2, 1, springAt(t - at, IMAGE_SPRING.k, IMAGE_SPRING.c))})`;
      });

      /* markers: a selection box that looks for its target, then locks */
      const size = n(params, 'markerSize') * fw;
      const lockAt = T.words + Math.max(0, wordEls.length - 1) * T.wordStep + T.lockAfterLastWord;
      const px = (r: Rect): Rect => ({ x0: r.x0 * W, y0: r.y0 * H, x1: r.x1 * W, y1: r.y1 * H });
      const searchRect = (tick: number): Rect => {
        const w = textW * lerp(1.0, 2.4, hash01(tick, 1)), h = textH * lerp(1.6, 3.2, hash01(tick, 2));
        const cx = W / 2 + textW * lerp(-0.2, 0.2, hash01(tick, 3)), cy = H / 2 + textH * lerp(-0.2, 0.2, hash01(tick, 4));
        return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
      };
      let rect: Rect | null = null; let hide: boolean[] = [false, false, false, false];
      if (t >= T.words && t < lockAt) {
        const tick = Math.floor((t - T.words) / MARKER_JUMP_S);      // a hard jump every 90 ms, no tween
        rect = searchRect(tick);
        hide = [0, 1, 2, 3].map((i) => hash01(tick, 10 + i) < MARKER_HIDE_P);
      } else if (t >= lockAt && t < T.finalWord) {
        const lastTick = Math.floor((lockAt - T.words) / MARKER_JUMP_S) - 1;
        rect = mixRect(searchRect(lastTick), px(LOCK_1), easeOutCubic(span(t, lockAt, MARKER_MOVE)));
      } else if (t >= T.finalWord) {
        rect = mixRect(px(LOCK_1), px(LOCK_2), easeOutCubic(span(t, T.finalWord, MARKER_MOVE)));
      }
      const mc = s(params, 'markerColor');
      markers.forEach((m, i) => {
        if (!rect || hide[i]) { m.style.opacity = '0'; return; }
        const x = i % 2 === 0 ? rect.x0 : rect.x1, y = i < 2 ? rect.y0 : rect.y1;
        Object.assign(m.style, { opacity: '1', width: `${size}px`, height: `${size}px`, background: mc, transform: `translate(${x - size / 2}px, ${y - size / 2}px)` });
      });

      /* loop seam: the end frame is the wipe colour, so the start fades in from it */
      fade.style.background = s(params, 'wipeTo');
      fade.style.opacity = b(params, 'loop') ? String(1 - span(t, 0, T.loopFade)) : '0';
    }

    const applyClock = (): void => { ctx.clock.rate = n(params, 'rate'); ctx.clock.loop = b(params, 'loop'); };
    build(); applyClock(); loadFigure();
    const off = ctx.clock.onTick((t) => render(t));
    const fontsReady = (): void => { if (!root.isConnected) return; layoutLine(); textKey = ''; measure(); render(ctx.clock.now); };
    // The canvas text needs the web font before it draws. Ask for it, then lay out again.
    void Promise.all([document.fonts?.load(`300 16px ${LINE_FONT}`), document.fonts?.load(`400 16px ${LINE_FONT}`), document.fonts?.ready]).then(fontsReady, fontsReady);

    return {
      update(next) {
        const lineChanged = s(next, 'line') !== s(params, 'line');
        params = next; applyClock(); build(); loadFigure();
        if (lineChanged) { layoutLine(); textKey = ''; }
        render(ctx.clock.now);
      },
      trigger() { /* no actions */ },
      resize(width, height, dpr) {
        W = width; H = height; DPR = dpr;
        quad.resize(width, height, dpr);
        textCanvas.width = canvas.width; textCanvas.height = canvas.height;
        root.style.fontSize = `${W / 100}px`;
        layoutLine(); textKey = ''; measure(); render(ctx.clock.now);
      },
      destroy() { off(); quad.destroy(); },
    };
  },
};

export default body;
