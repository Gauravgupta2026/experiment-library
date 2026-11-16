# Studio: build spec

Working name: **Studio**. Change it in one constant (`APP_NAME`).

This document is the full brief for the builder. Read it top to bottom once. Then build in the order of section 12.

**Sources of truth, in this order:**

1. `prototypes/*.html`: working code for the four effects that are hard to describe in words. Port the shader and physics code from these files. Do not rewrite it from the prose.
2. `reference/`: frames from the five source recordings, and `reference/color-grids.json` (measured colours).
3. This document.

If the prose and a prototype disagree on a number, the prototype wins, unless section 13 lists that number as a known gap.

---

## 1. What we build

A private gallery of motion experiments.

- **Feed** (`/`): a masonry grid of all experiments. Category chips filter the grid.
- **Experiment view** (`/e/:id`): the experiment runs live on a stage. A control panel on the right changes its properties in real time.

The layout model is vibrant.design: chips on top, a dense masonry feed, and a detail view with a side column. We keep only that. We do not build: websites, "Best of X", launch videos, tools, OG images, favourites, search, sign-up, sponsors, moodboards, author avatars, AI prompt generation, similar-designs.

Do not copy Vibrant's brand (name, logo, blue accent, copy). Use the tokens in section 4.

### Version 1 content

| # | id | Title | Category | Source recording |
|---|----|-------|----------|------------------|
| 1 | `icon-fountain` | Icon Fountain | Particles | 2026-11-12 2.42.41 |
| 2 | `imagine` | Gradient Figure and Pixel Wipe | Type | 2026-11-16 3.01.26 |
| 3 | `modern-creatives` | Blur Melt to Mesh Gradient | Type | 2026-11-16 3.01.56 |
| 4 | `sun-orb` | Sun Orb States | Shader | 2026-11-16 3.07.56 |
| 5 | `street-scene` | Living Street | Illustration | 2026-11-16 3.09.52 |

Categories (chips): `All`, `Shader`, `Particles`, `Type`, `Illustration`. A chip shows only if at least one experiment uses it.

---

## 2. Stack

- Vite, React 18, TypeScript (`strict: true`, no `any`).
- `react-router-dom` with browser history.
- No backend. No database. Static build.
- No UI kit. The panel controls are our own components (section 6). This is deliberate: the panel is the product.
- WebGL1 for shaders (a raw helper, about 80 lines, no three.js). Canvas 2D for particles. DOM and CSS for type.
- Fonts: `@fontsource-variable/inter` and `@fontsource-variable/inter-tight`, self-hosted.
- Icons for the fountain: `@phosphor-icons/core` (MIT), bold weight SVG files, imported as raw strings.
- Tests: Vitest (unit), Playwright (visual and interaction).
- Package manager: npm. Node 22.

Folder layout:

```
studio/
  SPEC.md
  prototypes/            (existing; do not ship)
  reference/             (existing; do not ship)
  index.html
  src/
    main.tsx  App.tsx  config.ts            (APP_NAME, categories)
    styles/tokens.css  styles/base.css
    lib/  gl.ts  clock.ts  prng.ts  spring.ts  params.ts  masonry.ts
    shell/  Nav.tsx  Feed.tsx  Card.tsx  ExperimentPage.tsx  Stage.tsx
    panel/  Panel.tsx  controls/{Slider,Color,Select,Toggle,Action,Text,Image,Segmented}.tsx
    experiments/
      types.ts  registry.ts
      sun-orb/{index.ts,shader.ts,states.ts}
      modern-creatives/…   imagine/…   icon-fountain/…   street-scene/…
  public/posters/<id>.webp
  public/media/…         (placeholder images, section 9)
  tests/
```

---

## 3. The experiment contract

Every experiment is a plain module. React knows nothing about its internals. This keeps effects portable (they can later be copied into another app).

```ts
// experiments/types.ts
export type Category = 'Shader' | 'Particles' | 'Type' | 'Illustration';

export type Control =
  | { kind: 'number'; key: string; label: string; min: number; max: number; step: number; unit?: string }
  | { kind: 'color';  key: string; label: string }
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: 'segmented'; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: 'toggle'; key: string; label: string }
  | { kind: 'text';   key: string; label: string; maxLength: number }
  | { kind: 'image';  key: string; label: string }          // value: object URL or '' for the default
  | { kind: 'action'; id: string;  label: string };         // a button; calls instance.trigger(id)

export interface ControlGroup { title: string; controls: Control[]; collapsed?: boolean }

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface MountContext {
  clock: Clock;            // lib/clock.ts. The ONLY time source.
  random: () => number;    // seeded mulberry32. The ONLY randomness source.
  preview: boolean;        // true inside a feed card: cap DPR at 1, no pointer input, no DOM chrome
  reducedMotion: boolean;
}

export interface ExperimentInstance {
  update(params: Params): void;          // called on every control change; must be cheap
  trigger(actionId: string): void;       // action buttons and stage clicks
  resize(width: number, height: number, dpr: number): void;
  destroy(): void;                       // remove listeners, cancel RAF, lose GL context
}

export interface ExperimentDefinition {
  id: string; title: string; description: string;      // description: at most 160 characters
  category: Category; tags: string[];
  aspect: number;                // stage width / height. The stage letterboxes to this.
  cardAspect: number;            // card width / height in the feed
  stageBackground: string;       // colour behind the letterboxed frame
  duration?: number;             // seconds, for timeline experiments. Enables the scrubber.
  defaults: Params;
  groups: ControlGroup[];
  presets?: { name: string; params: Partial<Params> }[];
  mount(el: HTMLElement, params: Params, ctx: MountContext): ExperimentInstance;
}
```

Rules:

- **Time.** `Clock` has `now` (seconds), `playing`, `rate`, `seek(t)`, `onTick(cb)`. One `requestAnimationFrame` loop per clock. `dt` is clamped to 1/30 s. Experiments never call `performance.now()` or `Date.now()`.
- **Randomness.** Experiments never call `Math.random()`. Tests set the seed, so a frame at time `t` is always the same.
- **Capture mode.** `/e/:id?capture=1&t=2.5&seed=7` mounts the experiment, hides all chrome, seeks to `t`, pauses, and sets `window.__ready = true`. Tests use this.
- **Pause.** The clock stops when the tab is hidden or the stage is off screen (`IntersectionObserver`).
- **GL.** Handle `webglcontextlost` (prevent default) and `webglcontextrestored` (rebuild). Cap DPR at 2 on the stage.
- **Reduced motion.** With `prefers-reduced-motion`, the experiment mounts paused on its poster time (`posterTime` in the definition file). A "Play" button on the stage starts it. Controls still work.

`lib/params.ts`: `encode(params, defaults)` returns a base64url string of the JSON diff from defaults. `decode` validates every key against the control schema (type, range, option list) and drops anything invalid. The URL is a system boundary: validate it.

---

## 4. Visual system

Calm and neutral, so the experiments carry the colour. Light theme by default. Dark theme follows `prefers-color-scheme`, with a toggle in the nav (stored in `localStorage`, in try/catch).

```css
:root {
  --bg:#FFFFFF; --surface:#F5F5F6; --surface-2:#EDEDEF; --border:rgba(15,15,20,.08);
  --text:#111114; --text-2:#6B6B76; --text-3:#9C9CA8; --accent:#111114; --on-accent:#FFFFFF;
  --focus:#2F5BFF;
  --r-card:14px; --r-control:10px; --r-pill:999px;
  --shadow-frame:0 24px 64px rgba(15,15,20,.12), 0 2px 6px rgba(15,15,20,.06);
  --font:"Inter Variable",Inter,system-ui,sans-serif;
  --ease-out:cubic-bezier(.22,1,.36,1);
}
:root[data-theme="dark"] {
  --bg:#0C0C0E; --surface:#161619; --surface-2:#1F1F23; --border:rgba(255,255,255,.08);
  --text:#F2F2F4; --text-2:#A0A0AA; --text-3:#6C6C76; --accent:#F2F2F4; --on-accent:#0C0C0E;
  --shadow-frame:0 24px 64px rgba(0,0,0,.5);
}
```

Type scale (size/line-height, weight): 11/16 600 caps (+0.04em) for section labels; 12/16 500; 13/19 400 body; 14/20 500 controls; 18/24 600 panel title; 20/26 600 feed intro. `font-feature-settings:"cv11","ss01"`. Numbers in the panel use `font-variant-numeric: tabular-nums`.

Spacing unit: 4 px. Use 4, 8, 12, 16, 20, 24, 32.

Focus: 2 px `--focus` ring, 2 px offset, on `:focus-visible` only.

---

## 5. Shell

### 5.1 Nav (both pages)

- Height 56 px. Sticky top. Background `--bg` at 80% with `backdrop-filter: blur(12px)`. Bottom border 1 px `--border`, visible only after scroll > 0.
- Left: `APP_NAME`, 15/20 600. It links to `/`.
- Centre-left, 24 px after the name: category chips. Feed page only.
- Right: theme toggle (32 x 32 icon button).
- Chip: height 32, padding 0 12, radius pill, 13/16 500. Idle: `--surface`, `--text-2`. Hover: `--surface-2`. Active: `--accent` fill, `--on-accent` text. Row gap 6. On narrow screens the row scrolls sideways with a 24 px fade mask on the right edge.
- The active category is in the URL: `/?c=Shader`.

### 5.2 Feed

- Page padding: 12 px top, 16 px sides, 48 px bottom. Gap 8 px.
- Columns: 4 at ≥ 1400 px, 3 at ≥ 1024, 2 at ≥ 640, else 1.
- Masonry: `lib/masonry.ts` puts each item in the shortest column. Heights are known before render from `cardAspect`, so there is no layout shift. Do not use CSS `columns` (it breaks reading order).
- Item 0 is the intro block (not a card): heading "Motion experiments" 20/26 600, then one line 13/19 `--text-2`: "Open one. Change everything." Padding 24 px 4 px. Height: fits content.
- Filter change: cards that leave fade out in 120 ms; the rest move to their new place with a 260 ms `--ease-out` transform (FLIP).

### 5.3 Card

- Radius `--r-card`. Background `--surface`. Border 1 px `--border`. `overflow: hidden`. `aspect-ratio: cardAspect`.
- Content: `<img>` poster (`/posters/<id>.webp`, `object-fit: cover`, `loading="lazy"`, width and height set).
- Hover (only `@media (hover:hover) and (pointer:fine)`): after 150 ms, mount the live experiment in preview mode on top of the poster and fade it in over 200 ms. On leave, fade out 150 ms, then destroy. **Only one live preview exists at a time.** (Browsers limit WebGL contexts.)
- Hover also shows a label at bottom-left, 8 px inset: title, 12/16 500, padding 4 8, radius 8, background `color-mix(in srgb, var(--bg) 72%, transparent)` with `backdrop-filter: blur(8px)`. Top-right: category, same style. Both fade and move 4 px up in 160 ms.
- Touch devices: the label is always visible. No live preview.
- Press: `transform: scale(.985)` for 100 ms.
- The whole card is one `<a href="/e/:id">`.

### 5.4 Experiment page

Desktop (≥ 1024 px): grid `minmax(0,1fr) 340px`, height `100dvh - 56px`, no page scroll.

**Stage** (left): background `stageBackground` of the experiment. Padding 32 px. The frame is centred, sized to the largest box of ratio `aspect` that fits. Frame radius 16 px, `--shadow-frame`, `overflow: hidden`.

- Top-left, 16 px inset: back button (arrow, 32 x 32, `--bg` at 80%, blur). It goes to the feed and keeps the scroll position.
- Top-right: Replay (seek to 0 and play) and Fullscreen (Fullscreen API on the frame).
- Experiments with `duration`: a transport bar under the frame, 12 px gap, same width as the frame, height 32: play/pause button, scrubber (the Slider control), time `0:02.4 / 0:08.0` in 12 px tabular numerals. Dragging the scrubber pauses and seeks.
- Keyboard: Space = play/pause. R = replay. F = fullscreen. Left/Right = previous/next experiment. Esc = back.

**Panel** (right): background `--bg`, left border 1 px `--border`. It scrolls on its own. Padding 20 px.

1. Title 18/24 600. Description 13/19 `--text-2`, 8 px under.
2. Meta, 16 px under: category chip and tags (12/16, `--surface`, padding 2 8, radius 6).
3. Presets (if any): a Segmented control, full width.
4. Control groups. Group header: 11/16 600 caps `--text-3`, with a chevron; click folds the group. 20 px above each group, 8 px under the header.
5. Footer, sticky at the bottom, background `--bg`, top border: `Reset` (ghost), `Randomize` (ghost), `Copy link` (primary). Height 36 px each, gap 8.
   - Randomize: every number gets a random value in its range; every colour gets a random hue with the same saturation and lightness; selects and text stay.
   - Copy link: writes the URL with `?p=` to the clipboard. The button text changes to "Copied" for 1.2 s.
   - Every control change updates `?p=` with `history.replaceState`, debounced 200 ms.

Mobile (< 1024 px): the stage takes the top (frame width 100% - 24 px). The panel is a bottom sheet with two snap points: peek (96 px: title and a drag handle) and open (70dvh). Drag with the finger, 1:1. On release, project the velocity and go to the nearest snap point with a spring (stiffness 300, damping 30). `touch-action: none` on the handle only.

**Feed to page transition:** use the View Transitions API (`document.startViewTransition`). The card image and the stage frame share `view-transition-name: exp-<id>`. Duration 320 ms, `--ease-out`. If the API is missing, or with reduced motion, navigate with no animation.

---

## 6. Panel controls

All rows: height 32 px, label on the left (13/16 `--text-2`, width 112 px, truncate with ellipsis), control on the right. Row gap 6 px.

- **Slider**: track height 4 px, radius 2, `--surface-2`; the filled part is `--text`. Thumb 14 px circle, `--bg` with a 1 px `--border` and a small shadow; it grows to 16 px while dragged. To the right, a value field 56 px wide, 12 px tabular, right-aligned, with the unit. The field is editable: Enter commits, Esc cancels, Up/Down steps (Shift = 10 steps). The pointer drags the whole track, not only the thumb (`setPointerCapture`). Double-click the label to reset this one control.
- **Color**: a 24 x 24 swatch, radius 6, 1 px border, then the hex value in an editable field (validate `^#[0-9a-fA-F]{6}$`). Click the swatch to open a popover: a saturation/value square 200 x 140, a hue strip, the hex field. Our own component, not `<input type=color>` (it looks different in each browser and has no live drag in Safari).
- **Select**: native `<select>` with our own skin (height 32, radius `--r-control`, `--surface`).
- **Segmented**: equal segments in a `--surface` pill. The active segment is a `--bg` pill with a shadow; it slides to the new segment in 220 ms `--ease-out`.
- **Toggle**: 36 x 20 switch.
- **Text**: one-line input, same skin as Select.
- **Image**: a 32 x 32 thumbnail, a "Replace" button and a "Default" button. Files stay local: `URL.createObjectURL`, never uploaded. Accept `image/png, image/jpeg, image/webp`. Reject files over 8 MB with an inline message. Image params are not put in the share URL.
- **Action**: a full-width button, height 32, `--surface`; hover `--surface-2`.

Performance rule: a control change calls `instance.update(params)` in the same frame. The React panel state must not re-render the stage.

---

## 7. Experiment 1: Icon Fountain

**Prototype:** `prototypes/icon-fountain.html`. Port `P`, `makeSprite`, `spawn` and `tick` as they are.
**Reference:** `reference/icon-fountain/`.

### What happens in the reference

A dark phone screen: "Thank you for subscribing!" with an app icon above the title. Each tap on the icon throws a burst of about 26 small neon travel icons out from behind it. They go up in two fans, left and right, reach a peak about 150 px above the icon, then fall past the text and off the bottom. As they fall they get larger (as if they come toward the camera), go out of focus, and fade. Taps stack: a second burst starts while the first one falls.

### How it works

- One Canvas 2D layer behind the icon and the text. `globalCompositeOperation = 'lighter'`, so overlaps add up to a bright glow.
- Sprites are made once: glyph x colour x 4 blur levels, each 128 px. Blur uses the shadow-offset trick (draw the glyph far off canvas with `shadowOffsetX`; only the blurred shadow lands on the canvas). `ctx.filter` is not used: Safari does not support it.
- Per frame: integrate, sort by life fraction (young = far = drawn first), then two `drawImage` calls per particle to cross-fade between blur levels.
- Depth is faked with one number: life fraction `f`. Scale, blur and fade all come from `f`.

### Stage

`aspect` 390/844, `cardAspect` 3/4, `stageBackground` `#0B0B0D`. The frame is the phone screen (radius 44 px, black). Emitter at (195, 262) in a 390 x 844 space. Scale the full space with the frame.

### Parameters

| Group | Key | Kind | Range (step) | Default |
|---|---|---|---|---|
| Burst | `burstCount` | number | 4–80 (1) | 26 |
| Burst | `burstSpreadMs` | number | 0–600 (10) ms | 180 |
| Burst | `mode` | segmented | Tap / Loop / Hold | Tap |
| Burst | `loopInterval` | number | 0.4–4 (0.1) s | 1.6 |
| Burst | (action) `burst` | action | | "Burst" |
| Motion | `speedMin` / `speedMax` | number | 200–1400 (10) px/s | 480 / 760 |
| Motion | `angleMin` / `angleMax` | number | 0–60 (1) deg | 4 / 20 |
| Motion | `gravity` | number | 0–3000 (50) | 1500 |
| Motion | `dragX` / `dragY` | number | 0–3 (0.05) | 1.2 / 0.25 |
| Motion | `spinMax` | number | 0–8 (0.1) rad/s | 2.5 |
| Motion | `lifeMin` / `lifeMax` | number | 0.8–5 (0.1) s | 1.9 / 2.6 |
| Look | `baseSize` | number | 12–80 (1) px | 36 |
| Look | `scaleStart` / `scaleEnd` | number | 0.2–4 (0.05) | 0.6 / 2.0 |
| Look | `blurStart` | number | 0–1 (0.01) | 0.45 |
| Look | `maxBlur` | number | 0–16 (0.5) px | 7.5 |
| Look | `glow` | number | 0–2 (0.05) | 1 |
| Look | `fadeOutStart` | number | 0–1 (0.01) | 0.62 |
| Look | `iconSet` | select | Travel / Money / Party | Travel |
| Colour | `color1`…`color6` | color | | `#2F6BFF #3FA0FF #8B5CFF #F0509A #1FCB6B #FF9A2E` |
| Colour | `background` | color | | `#000000` |
| Copy | `title` | text (40) | | Thank you for subscribing! |
| Copy | `showChrome` | toggle | | on |

Colour weights are fixed at 4, 3, 3, 2, 2, 1 (blue is the main colour). `Hold` mode emits 40 particles per second while the pointer is down. A change to `baseSize`, `maxBlur`, `glow`, `iconSet` or a colour rebuilds the sprites: debounce 120 ms.

Icon sets (Phosphor bold): Travel = `bank`, `airplane-tilt`, `suitcase-rolling`, `bus`, `bed`, `lifebuoy`, `camera`, `map-pin`. Money = `coins`, `credit-card`, `piggy-bank`, `chart-line-up`, `wallet`, `receipt`. Party = `confetti`, `star`, `heart`, `gift`, `balloon`, `sparkle`. Turn each SVG `<path d>` into a `Path2D`. Phosphor bold icons are filled outlines in a 256 box: use `fill`, not `stroke`, and scale by 72/256. This replaces the hand-made stroke glyphs in the prototype.

Presets: `Reference` (defaults), `Confetti` (count 60, angles 10–55, gravity 900, scaleEnd 1.2, maxBlur 2), `Slow rise` (gravity 300, speed 200–380, life 3.5–5).

### Checklist

- [ ] The icon button goes to scale 0.9 on press (80 ms) and comes back with an overshoot (`cubic-bezier(.3,1.8,.5,1)`, 450 ms).
- [ ] A burst comes out from behind the icon. The canvas is under the icon and under the text.
- [ ] There are two fans, left and right. Almost nothing goes straight up.
- [ ] The peak is 120–180 px above the icon centre at default values.
- [ ] Icons grow by about 3x between launch and exit.
- [ ] Icons are sharp for the first 45% of life, then they blur without a visible step.
- [ ] Overlaps get brighter (additive). They never get darker.
- [ ] Ten quick taps: 60 fps on a mid-range phone, at most 300 live particles (drop the oldest above that).
- [ ] No particle objects are left after the last one dies (check the array length in a test).
- [ ] Reduced motion: no fountain. One still burst frame is drawn at `f = 0.35`, and a tap cross-fades it in and out over 600 ms.

---

## 8. Experiment 2: Gradient Figure and Pixel Wipe (`imagine`)

**Prototype:** `prototypes/pixel-wipe.html` (the shader and the letter reveal). The bracket-word scene is not in the prototype; build it from this section.
**Reference:** `reference/imagine/`.

### What happens in the reference

1. A soft, blurred figure (head and shoulders, in profile) on a peach-to-violet vertical gradient. The figure is coloured by a gradient map: pink hair, yellow-peach face, pale body.
2. A line of large light text appears letter by letter: "Imagine to have all your tools". New letters come in orange and pink, then turn white. At the same time the figure's colours cycle (pink to yellow to violet).
3. A short glitch: a few 1 px white lines and one band of the picture shifts sideways.
4. A pixel wipe: light gray eats the picture from the top-left to the bottom-right. The edge is a wavy stair of square cells. Cells on the edge flash magenta, orange and pink.
5. On gray: `{ in }`, then `{ in one }`, then `{ in one place }`, in black. Each new word pushes the braces apart with a springy layout. Four small black squares jump around the text like a selection box that looks for its target, then they lock onto a big rectangle.
6. The text changes to `{ intro ducing }` and a small stack of images grows in the gap in the middle of the word.

### Timeline (seconds; `duration` 8.0; loops)

| t | Event |
|---|---|
| 0.0 | Figure. Palette phase 0. |
| 2.0 | Letter reveal starts. 35 ms stagger. Each letter: opacity 0 to 1 in 350 ms, colour warm to white in 600 ms (starts 150 ms after the letter). Palette phase runs at 0.33 cycles/s. |
| 3.3 | Glitch on (until 4.0). |
| 3.5 | Wipe starts. 1.6 s, linear. |
| 4.0 | `{ in }` appears. Markers start to jump. |
| 4.6 | `one` is added. |
| 5.3 | `place` is added. At 5.6 the markers lock. |
| 6.1 | The text changes to `{ intro ducing }`. The markers move to the wide rectangle. |
| 6.2 | Image 1 (main) grows. 6.35 image 2 (left). 6.5 image 3 (tiny, right). |
| 7.0–8.0 | Hold. |

### Layout numbers (fractions of the frame; frame `aspect` 3022/1708)

- Line 1: left edge at 19.8% of the width, vertical centre at 48% of the height. Inter Tight 300, size 4.6% of the frame width, tracking -0.035em, white.
- Bracket text: centred on the frame. Inter Tight 400, size 3.44% of the frame width, tracking -0.03em, colour `#111111`. One space inside each brace.
- Markers: black squares, side 1.2% of the frame width. Locked rectangle for `in one place`: x 37.5% to 87.7%, y 33% to 66.7%. For `introducing`: x 12.3% to 75.3%, y 33% to 66.7%. (Yes, they are off centre. That is in the reference.)
- Images in `introducing`, as fractions of the bracket font size: main 1.2 x 1.2, centre in the gap; second 0.58 x 0.92, left of the main one and behind it, overlap 30%; third 0.23 x 0.27, 0.35 em right of the main one. The gap opens to 2.3 em.
- Gray: `#E5E5E5`.

### How it works

- **Background and wipe:** one fragment shader (`FRAG` in the prototype). The figure is a signed-distance shape (head, face, hair/back, shoulder, joined with a smooth minimum) with one soft edge. Its colour is `figurePalette(t + phase)`, where `t` runs from the top of the figure to the bottom. The wipe is a scalar field per cell, `w = y + 0.58x + noise`. A cell is gray when `w < progress - band`, and it is a random edge colour when `w` is inside the band. Cells are `frameWidth / wipeColumns` pixels.
- **Figure from an image (new, not in the prototype):** when the `figureImage` param is set, load it into a texture, and use its luminance, blurred, in place of the signed-distance mask: `a = smoothstep(.35,.65,lum)`, `t = lum`. Blur: draw the image to a 64-px-wide canvas, then upload with LINEAR filtering. That is enough at this softness.
- **Text clipped by the wipe:** line 1 must go away with the same stair edge. Do not use the `clip-path` shortcut from the prototype. Draw line 1 into a 2D canvas, upload it as a texture, and composite it in the shader before the wipe. Update the texture only when a letter changes.
- **Bracket words:** DOM. Each word is an `inline-block`. A new word has width 0, opacity 0 and blur 6 px, and goes to its natural width with a spring (stiffness 260, damping 22: a small overshoot), opacity in 200 ms. Measure the natural width once with a hidden copy. The braces are flex siblings, so they move by themselves. The text stays centred.
- **Markers:** four absolutely positioned squares. Search phase: every 90 ms, choose a random rectangle around the text (width 1.0–2.4 times the text width, height 1.6–3.2 times the text height, centre offset up to ±20%); each marker goes to its corner with no tween (a hard jump) and is hidden with probability 0.3. Lock phase: all four are shown and move to the locked rectangle in 280 ms `--ease-out`.
- **Images:** each one scales from 0.2 to 1 with a spring (stiffness 320, damping 20) and fades in 120 ms.

### Parameters

| Group | Key | Kind | Range (step) | Default |
|---|---|---|---|---|
| Copy | `line` | text (40) | | Imagine to have all your tools |
| Copy | `words` | text (40) | space-separated | in one place |
| Copy | `finalWord` | text (20) | `|` marks the gap | intro\|ducing |
| Figure | `figureImage` | image | | built-in shape |
| Figure | `bgTop` / `bgBottom` | color | | `#FACA96` / `#9E92F8` |
| Figure | `pal1`…`pal5` | color | | `#D65C92 #F5CC90 #EBC6AD #E264B0 #B890F0` |
| Figure | `softness` | number | 0.2–3 (0.05) | 1 |
| Figure | `paletteSpeed` | number | 0–2 (0.01) cycles/s | 0.33 |
| Wipe | `wipeColumns` | number | 12–160 (1) | 50 |
| Wipe | `wipeAngle` | number | 0–1.5 (0.01) | 0.58 |
| Wipe | `wipeNoise` | number | 0–1 (0.01) | 0.34 |
| Wipe | `wipeDuration` | number | 0.4–4 (0.1) s | 1.6 |
| Wipe | `edgeDepth` | number | 0–6 (0.1) cells | 1.6 |
| Wipe | `edge1`…`edge4` | color | | `#D860F0 #F8B860 #F096CD #F8D6F0` |
| Wipe | `wipeTo` | color | | `#E5E5E5` |
| Wipe | `glitch` | toggle | | on |
| Markers | `markerSize` | number | 0.4–3 (0.1) % | 1.2 |
| Markers | `markerColor` | color | | `#111111` |
| Images | `image1`…`image3` | image | | placeholders |
| Time | `rate` | number | 0.25–2 (0.05) | 1 |
| Time | `loop` | toggle | | on |

### Checklist

- [ ] At t = 0.5 the frame matches `color-grids.json → imagine.figure` (mean ≤ 9, no point over 40; the prototype is at 6.8, worst point 34; see section 12). Points outside the figure must be within 4.
- [ ] The figure has no hard edge and no seam at any palette phase.
- [ ] Letters come in from left to right; each one starts warm and ends white. At t = 2.6, the left third is white and the right third is still warm.
- [ ] The glitch lines are 1 device pixel high, not more.
- [ ] The wipe edge is made of square cells on a fixed grid. Cells do not move; only the edge moves.
- [ ] The edge colours change about 14 times per second.
- [ ] The gray goes from the top-left to the bottom-right. The left side is ahead of the right side.
- [ ] Line 1 is cut by the same stair edge as the picture.
- [ ] When a word is added, no text jumps. The braces move with a small overshoot.
- [ ] Markers jump with no tween during the search and move with a tween at the lock.
- [ ] The scrubber can seek to any time, forward and back, and the frame is the same as in normal play. (All state is a pure function of `t` and the seed. No state builds up.)
- [ ] Reduced motion: a still at t = 7.5.

---

## 9. Experiment 3: Blur Melt to Mesh Gradient (`modern-creatives`)

**Prototype:** `prototypes/mesh-gradient.html` (the gradient shader, the word reveal, the markers). The first scene and the melt are not in the prototype.
**Reference:** `reference/modern-creatives/`.

### What happens in the reference

1. Gray background. Big black words "you" (cut by the left edge) and "create". Between them, a tall photo, and a trail of smaller copies of other photos behind it on the left, as if images were dropped along a path. A red glow starts to show in the bottom corners.
2. The whole scene shrinks a little, blurs hard, takes on pink and orange tints, and fades out. At the same time a red, magenta and orange gradient rises from the bottom with a wavy top edge.
3. On the gradient, a white line appears word by word: "The AI powered platform for modern creatives". Four tiny black squares sit on the corners of the text and follow it as it grows; one of them blinks off while words are added.
4. The words blink out in two groups. A wide, thin photo strip takes their place inside the same four markers.

### Timeline (`duration` 8.6; loops)

| t | Event |
|---|---|
| 0.0 | Scene A. `uRise` goes slowly from 0.05 to 0.2 by t = 2.4. |
| 2.4 | Melt starts (0.9 s): scale 1 to 0.94, blur 0 to 48 px (ease-in), tint 0 to 1, opacity 1 to 0 (the opacity starts at 2.8). |
| 2.4–3.6 | `uRise` 0.2 to 1, ease-out cubic. |
| 3.5 | "The AI" appears (two words together). Markers on. |
| 4.0 / 4.4 / 4.9 / 5.3 / 5.7 | powered / platform / for / modern / creatives. |
| 5.7–7.0 | Hold. The last two words rise from opacity 0.72 to 1 over 600 ms. |
| 7.0 | Words 2, 3, 5, 7 off. 7.08: words 1, 4, 6 off. |
| 7.15 | The strip is on (opacity in 120 ms). The markers move to its corners in 240 ms. |
| 7.2–8.6 | Hold. The gradient still drifts. |

### Layout numbers (frame `aspect` 3022/1708; fractions of the frame)

- Scene A text: Inter 400, size 6.1% of the width, colour `#111111`, baseline at 55% of the height. "you": right edge at 8.5% (it starts off the frame). "create": left edge at 68%.
- Hero image: x 37% to 63%, y 19.5% to 80.7% (ratio 3:4), `object-fit: cover`, no radius.
- Trail: 9 images. Image `i` (0 = oldest) is centred at x = 15% + i · 2.6%, y = 58% − 8% · sin(i · 0.9) + (i mod 3) · 3%. Its width is 4% + i · 0.45% of the frame width; ratio 3:4. Later images are on top. The hero is on top of all.
- Line 2: centred. Inter 400, size 2.65% of the width, tracking -0.005em, white, word gap 0.28em. It spans about 17.5% to 82% of the width.
- Markers: side 0.66% of the width, `#111111`. Box padding: 0.8% of the width on x, 0.66% on y.
- Strip: x 17.9% to 68.2%, height 4.5% of the frame width, vertical centre 50%. `object-fit: cover`.

### How it works

- **Gradient:** the `FRAG` shader in the prototype. A wavy edge function splits gray from red. The step from gray to red goes through a pale pink (it is not a straight mix). Soft blobs are added: magenta at centre-right, magenta at the right edge, orange in the bottom corners, a pale glow behind the text. `uRise` moves it all up from under the frame.
- **Melt:** scene A is one DOM group. Animate `transform: scale()` and `filter: blur()` on the group. For the tint, put a copy of the gradient colours over the group as a child with `mix-blend-mode: color` (linear-gradient 160deg, `#F0509A`, `#FF9A2E`, `#B890F0`), opacity 0 to 0.9; the group has `isolation: isolate`. Animating `filter: blur` on a large layer is expensive: it runs for 0.9 s only, and `will-change: filter` is set only during the melt.
- **Words and markers:** as in the prototype. The marker box is measured from the first and the last visible word with `getBoundingClientRect`, relative to the frame. Measure after fonts load (`document.fonts.ready`) and on resize.

### Parameters

| Group | Key | Kind | Range (step) | Default |
|---|---|---|---|---|
| Copy | `wordLeft` / `wordRight` | text (12) | | you / create |
| Copy | `headline` | text (60) | | The AI powered platform for modern creatives |
| Copy | `wordInterval` | number | 0.1–1 (0.01) s | 0.42 |
| Images | `hero` | image | | placeholder |
| Images | `trailCount` | number | 0–16 (1) | 9 |
| Images | `strip` | image | | placeholder |
| Gradient | `base` | color | | `#E5E5E5` |
| Gradient | `red` / `mid` / `magenta` / `orange` / `glowColor` | color | | `#FA434C` / `#EC8CA8` / `#E98ADE` / `#FC9626` / `#EDDEF5` |
| Gradient | `waveAmp` | number | 0–0.3 (0.005) | 0.075 |
| Gradient | `edgeSoft` | number | 0.05–0.6 (0.01) | 0.43 |
| Gradient | `drift` | number | 0–3 (0.05) | 1 |
| Melt | `meltBlur` | number | 0–120 (1) px | 48 |
| Melt | `meltDuration` | number | 0.2–3 (0.05) s | 0.9 |
| Markers | `markerSize` / `markerColor` | number / color | 0.2–2 % | 0.66 / `#111111` |
| Time | `rate`, `loop` | | | 1, on |

`edgeSoft` is the full width of the `smoothstep` (the prototype uses −0.24 and +0.19; keep that 56:44 split).

### Placeholder images

Do not use the photos from the recordings. They belong to other people. Ship neutral placeholders in `public/media/placeholder-1.webp` … `-6.webp`: generate them at build time (a script draws a soft two-colour gradient with a large number in the centre, 900 x 1200). The user replaces them in the panel or in the folder.

### Checklist

- [ ] At t = 6.2 the canvas matches `color-grids.json → modern-creatives.gradient` (mean ≤ 10; the prototype is at 9.2). The drift moves the blobs, so for this test set the shader time to 5.0 s, the value at which the prototype was measured (capture option `shaderTime=5`).
- [ ] The edge between gray and red goes through pink. There is no muddy gray-red band.
- [ ] The gradient moves all the time, slowly. The loop restart shows no jump (at t = 0 the gradient is under the frame).
- [ ] During the melt, the text and the images blur as one group.
- [ ] The words never move after they appear (the line is laid out at full width; hidden words keep their space).
- [ ] The markers sit on the corners of the visible words, with the padding above.
- [ ] The strip is inside the markers. The markers end on its corners.
- [ ] Seek to any `t` gives the same frame as normal play.
- [ ] Reduced motion: a still at t = 6.5.

---

## 10. Experiment 4: Sun Orb States (`sun-orb`)

**Prototype:** `prototypes/sun-orb.html`. Port `FRAG`, the spring loop, `env()` and `setState()` as they are.
**Reference:** `reference/sun-orb/`.

### What happens in the reference

A soft glowing orb on white, like a sun that sets into water: a pale yellow dome, an orange-to-coral arch around it, a pink band under a horizon line, violet and blue lobes at the bottom corners, and a white notch at the bottom centre. Under it, a pill with six state tabs.

- **Rise:** the orb comes up from under the tabs. It starts as a flat peach blob, then gets its colours (too saturated at first), then relaxes.
- **Response:** one white pulse. The inside goes white from the centre out and comes back. The arch stays.
- **Loading:** the same pulse, weaker, again and again. A light patch goes around the arch.
- **Approved:** a strong white flash. Then the cool colours go: the pink band and the blue lobes turn warm peach.
- **Dusk** and **Set** are not in the recording. They are our design: Dusk = a cool palette, the orb 7% lower. Set = the reverse of Rise.

### How it works

One full-screen fragment shader. There is no blur pass: each edge is `smoothstep` on a signed distance, so softness is free and does not depend on resolution. Layers, from back to front:

1. Outer glow: an egg-shaped rounded box. Its colour depends only on y (light orange, coral, mauve, violet, pale blue).
2. Halo: pale yellow just outside the dome rim, at the top.
3. Band: a wide rounded bar under the horizon (pink; magenta at the ends; lavender lower down).
4. Dome: a circle cut at the horizon (pale at the top and centre, more yellow at the rim and at the horizon).
5. White pulse: an ellipse that grows from the dome centre. It covers the dome and the band, not the glow.
6. Notch: a white ellipse at the bottom centre.

All geometry is in the pixel space of the reference frame (1910 x 1700). The shader fits that space to the canvas by height. Keep this: it lets you check every number against the frame.

Uniforms and animation:

| Uniform | Meaning | Driver |
|---|---|---|
| `uRise` | 0 = under the frame, 1 = up | spring, ω = 14 |
| `uEnergy` | extra saturation | set to 1 when Rise starts; spring to 0, ω = 10 |
| `uPulse` | white pulse 0…1.25 | envelope: `sin²` attack over the first 30%, `cos²` release |
| `uWarm` | Approved palette mix | spring, ω = 9 |
| `uDusk` | Dusk palette mix | spring, ω = 9 |
| `uSweep`, `uSweepAngle` | light on the arch | spring, ω = 12; the angle moves at 2.2 rad/s |

Springs are critically damped: `a = ω²(target − x) − 2ω·v`. Pulses: Response 1.5 s, peak 1. Approved 1.3 s, peak 1.25. Loading: period 1.45 s, peak 0.72.

State changes can come at any time. Every value is a spring or an envelope, so nothing snaps. A new pulse does not cancel the last one: take the maximum.

### Stage

`aspect` 1910/1700, `cardAspect` 1, `stageBackground` `#FDFDFD`. The tab pill is DOM over the canvas, centred, with its top at 85.4% of the frame height. Pill: padding 6, gap 6, radius 999, background `#FAFAFC`, border 1 px `#E7E7EE`. Tab: height 40, padding 0 15, 16 px, weight 500; idle colour `#9C9CA8`; active colour `#17171C` on a raised pill (`linear-gradient(#FFFFFF,#F1F1F5)`, shadow `0 1px 3px rgba(20,20,40,.14), 0 0 0 1px rgba(20,20,40,.05)`). The raised pill slides between tabs (220 ms). These sizes are for a frame 955 px wide: scale them with the frame. Hide the pill in card previews. The orb rises 400 ms after mount (card previews too).

### Parameters

| Group | Key | Kind | Range (step) | Default |
|---|---|---|---|---|
| State | `state` | segmented | Rise / Response / Loading / Approved / Dusk / Set | Rise |
| State | `showTabs` | toggle | | on |
| Shape | `size` | number | 0.5–1.4 (0.01) | 1 |
| Shape | `softness` | number | 0.3–2.5 (0.05) | 1 |
| Shape | `horizon` | number | −0.2–0.2 (0.005) | 0 |
| Shape | `notch` | number | 0–1.5 (0.05) | 1 |
| Colour | `domeTop` / `domeLow` / `rim` | color | | `#FDFDF3` / `#FCF6BC` / `#FDF4A8` |
| Colour | `glowTop` / `glowSide` | color | | `#FDD6A0` / `#FF9678` |
| Colour | `mauve` / `violet` / `blue` | color | | `#D48AB2` / `#AAA2FF` / `#C6CEFA` |
| Colour | `band` / `bandEnd` | color | | `#FDE0FC` / `#F4AAFF` |
| Colour | `background` | color | | `#FDFDFD` |
| Motion | `pulsePeriod` | number | 0.5–4 (0.05) s | 1.45 |
| Motion | `pulseStrength` | number | 0–1.5 (0.05) | 0.72 |
| Motion | `sweepSpeed` | number | 0–8 (0.1) rad/s | 2.2 |
| Motion | `riseSpeed` | number | 4–30 (0.5) | 14 |

`softness` multiplies every `soft` argument of `cover()` and every `smoothstep` width in the shader. `size` scales `q` around the dome centre. `horizon` moves the horizon line and the band by `horizon × 1700` px. The colour params replace the `hex()` constants of the default palette only; the warm and dusk palettes stay fixed.

Presets: `Reference`, `Ember` (all warm: `uWarm` at 1 from the start), `Night` (background `#0C0C12`, the Dusk palette, softness 1.3. With a dark background the notch and the fade must use `background`, not white. Test this preset: it is the one that shows a hard-coded white).

### Checklist

- [ ] The settled default state matches `color-grids.json → sun-orb.default` (mean ≤ 8, no point over 35; the prototype is at 5.6, worst point 32).
- [ ] The settled Approved state matches `sun-orb.approved` (mean ≤ 9; the prototype is at 6.7).
- [ ] No banding in the soft edges on an 8-bit display: add an ordered dither of ±0.5/255 before the output (new; not in the prototype).
- [ ] Rise takes about 1.2 s to arrive and about 1 s more to settle. The colours are stronger in the middle of the rise than at rest.
- [ ] The Response pulse leaves the arch in colour while the inside is white.
- [ ] The Loading pulse repeats with no visible seam.
- [ ] Approved: flash first, then the cool colours fade to warm in under 1 s.
- [ ] Fast clicks across all tabs: no snap, no NaN, no stuck white.
- [ ] Set, then Rise: works again from zero.
- [ ] The orb keeps its shape at any frame size (fit by height, centre by width).
- [ ] Reduced motion: state changes cross-fade in 300 ms. No travel, no pulses.

---

## 11. Experiment 5: Living Street (`street-scene`)

**Reference:** `reference/street-scene/`. **There is no prototype.**

### Read this first

The recording shows a hand-drawn, frame-by-frame illustration: a tree-lined road to a red gate, with rickshaws, cars, a bus and people. Code cannot reproduce that drawing, and we must not trace it: it is another artist's work. Version 1 is **our own scene with the same motion ideas and the same colour mood**. "Matches the reference" for this experiment means the checklist below. It does not mean the same picture.

### What moves in the reference

- Traffic comes toward the viewer down the left lane and goes away up the right lane. Things get bigger as they come near and go behind the tree in the foreground.
- People walk on both pavements. A few stand and do one small loop action (sweep, wave, turn).
- The leaves do not sway as a mass. Small light dots in the trees flicker, and the purple shadows on the ground change shape a little.
- Flat colours, no outlines: orange road, purple shadows, many greens, cyan sky, one red landmark.
- The camera does not move.

### Design

SVG for the static art. One Canvas 2D layer for everything that moves. `aspect` 3022/1394, `cardAspect` 16/9, `stageBackground` `#FFFFFF`. The frame has an 8 px white inner border, as in the reference.

Scene, from back to front:

1. Sky, with flat cloud shapes.
2. Far trees and the far end of the road. The road is a trapezoid to a vanishing point at (51%, 47%).
3. A landmark at the vanishing point. Use a simple original shape (a clock tower or an arch). Do not draw the gate from the reference.
4. Pavements, a building on the left, a low wall and water on the right.
5. Ground shadows: purple blobs.
6. Movers (canvas).
7. Near trees: trunks, and canopies made of 30–60 overlapping circles in 4 greens.
8. Leaf sparkle (canvas): small light dots in the canopies.

Movers run on **lanes**. A lane is a line from a far point to a near point in frame space, with a far scale and a near scale. A mover has `u` in 0…1 along its lane. Position = `lerp(far, near, u²)`. Scale = `lerp(farScale, nearScale, u²)`. The square gives the perspective speed-up. Draw movers sorted by y.

- Vehicle lanes: one toward the viewer (left of the centre line), one away (right).
- Walker lanes: one or two on each pavement.
- Vehicle kinds, drawn with canvas paths (flat shapes, no outlines), each about 6–10 shapes: car, bus, bicycle with rider, scooter. Wheels turn.
- Walkers: a head circle, a body, two legs. The legs swing with `sin(phase)`. Step phase moves with the distance travelled, so the feet do not slide.
- Idle actors: 2–4 fixed figures with a loop of ±6° on one arm.
- Each mover has a purple shadow ellipse under it.
- Spawn: each lane has a timer with a random gap. All randomness comes from `ctx.random`.

Leaf sparkle: N dots at fixed random places inside the canopies. Opacity of dot `i` = `step(0.6, noise(i, floor(t · 6)))`. This is a 6 fps flicker, like the frame-by-frame look. Shadows: each blob's scale moves by ±3% at 0.3 Hz, each with its own phase.

Stepped time: a `frameRate` param holds the scene time at 12 fps (`t = floor(t · fps) / fps`). This gives the hand-animated feel. It is the most important single detail of this experiment.

### Parameters

| Group | Key | Kind | Range (step) | Default |
|---|---|---|---|---|
| Traffic | `vehicleRate` | number | 0–2 (0.05) per s | 0.5 |
| Traffic | `walkerRate` | number | 0–3 (0.05) per s | 0.8 |
| Traffic | `speed` | number | 0.2–3 (0.05) | 1 |
| Feel | `frameRate` | number | 4–60 (1) fps | 12 |
| Feel | `sparkle` | number | 0–1 (0.01) | 0.5 |
| Feel | `shadowDrift` | number | 0–1 (0.01) | 0.5 |
| Colour | `palette` | select | Day / Dusk / Night / Mono | Day |
| Colour | `road` / `shadow` / `sky` / `leaf` / `landmark` | color | | `#D2620A` / `#8A1FA8` / `#35C8E8` / `#22B04A` / `#E8431A` |
| Time | `rate`, `loop` | | | 1, off |

Day palette, sampled from the reference mood: road `#D2620A`, shadow `#8A1FA8`, sky `#35C8E8`, leaf greens `#22B04A #2FD060 #1E8F4E #7FBF1F`, trunk `#7A1F45`, pavement `#D9D4C8`, landmark `#E8431A`, building `#8E8FE8`, lane line `#FFF4E0`. The static SVG uses CSS variables for all of these, so a palette change is instant.

### Checklist

- [ ] No part of the scene is traced or copied from the reference drawing.
- [ ] Flat fills only. No strokes, no gradients, no blur.
- [ ] Movers get bigger and faster as they come near, and they pass behind the near trees.
- [ ] Feet do not slide.
- [ ] At 12 fps the motion is in clear steps, but the page still scrolls and reacts at the display rate.
- [ ] At most 40 movers alive. A mover is removed when `u > 1`.
- [ ] A palette change takes effect in one frame.
- [ ] Reduced motion: a still scene with 6 movers placed by the seed.

---

## 12. Build order and gates

Do not start a phase before the gate of the phase before it passes.

| Phase | Work | Gate |
|---|---|---|
| 0 | Scaffold: Vite, TS strict, lint, Vitest, Playwright, tokens, fonts. `git init`. | `npm run typecheck`, `npm test` and `npm run build` pass with no experiments. |
| 1 | `lib/` (clock, prng, spring, params, masonry, gl) with unit tests. | Params codec: round trip, and it rejects bad input (wrong type, out of range, unknown key, broken base64). Clock: a seek gives the same result as play. |
| 2 | Shell with one dummy experiment (a colour that changes with one slider): nav, feed, card, page, stage, panel, all controls, URL state, keyboard, bottom sheet. | Playwright: open the feed, filter, open a card, drag a slider, copy the link, load the link in a new context, and get the same value. Screenshots at 1440, 1024 and 390 px wide, light and dark. |
| 3 | `sun-orb`. | Its checklist, and the colour-grid test. |
| 4 | `modern-creatives`. | Same. |
| 5 | `imagine`. | Same. |
| 6 | `icon-fountain`. | Its checklist. |
| 7 | `street-scene`. | Its checklist. |
| 8 | Posters (a Playwright script captures each experiment at its `posterTime`, 2x, WebP quality 82), the view transition, a reduced-motion pass, an a11y pass, a performance pass. | Lighthouse on the feed: performance ≥ 90, accessibility ≥ 95. No experiment drops under 55 fps at 4x CPU throttle on the stage. The JS of an experiment loads only on its page or on card hover (dynamic `import()`). |

### The colour-grid test (phases 3, 4, 5)

`tests/visual/color-grid.spec.ts`: open `/e/<id>?capture=1&t=<t>&seed=1` at a viewport where the frame has the aspect of the reference frame. Wait for `window.__ready`. Take a screenshot of the frame element. For each point in `reference/color-grids.json`, average a 9 x 9 block at the same fraction of the frame. The error of a point is the largest channel difference. Assert the mean and the maximum given in the checklists. Screenshot as PNG, never JPEG.

Settled states for the orb: use `?capture=1&state=default` and `state=approved`, which set the spring values directly (the `force()` hook in the prototype).

### Accessibility, all phases

- Every control has a label and works with the keyboard. Sliders use `role="slider"` with `aria-valuemin/max/now` and arrow keys.
- The stage has `role="img"` and an `aria-label` from the description. Action buttons are real buttons outside the canvas.
- Text contrast ≥ 4.5:1 in both themes (check `--text-3` on `--bg`: use it only for 11 px caps labels, at ≥ 3:1).
- Touch targets ≥ 44 px on coarse pointers.

### Security

- Validate the `?p=` param against the schema. Never spread it into params.
- User text params go into the DOM with `textContent`, never `innerHTML`.
- Uploaded images: only as `img.src` or textures from object URLs. Uploading SVG is not allowed (script risk).

---

## 13. What is verified and what is not

Be honest with yourself about which numbers are measured.

| Item | Status |
|---|---|
| Sun orb: default and Approved still frames | **Measured.** The prototype is within 5.6 and 6.7 mean levels of the reference on 81 points. |
| Mesh gradient still frame | **Measured.** 9.2 mean. Worst points are near (0.38, 0.38–0.62): the pink there can come closer. |
| Sun orb: Rise, Response, Loading timings | Read from frames at 5 fps. Accuracy about ±0.15 s. Not checked in motion against the video. |
| Sun orb: Dusk and Set | Our own design. Not in the recording. |
| Pixel wipe: cell size, direction, edge colours | Checked by eye against the frames. The noise shape is close, not identical (the reference edge has larger, slower bumps at some moments: try `n * .34` up to `.45` and the frequency `3.2` down to `2.4`). |
| Figure still frame | **Measured.** 6.8 mean, worst point 34. The background is exact. The profile is simpler than the reference (less chin and neck). With `figureImage` set, the user gets an exact shape. |
| Letter reveal colours | By eye. |
| Bracket words, markers, the "introducing" images | From frame analysis only. No prototype. Highest risk in `imagine`. |
| Scene A and the melt in `modern-creatives` | From frame analysis only. No prototype. The trail layout formula is an approximation of the reference positions. |
| Icon fountain motion | The prototype was run in fixed steps and compared by eye with the frames. The reference is a blurry phone video, so the icon shapes and exact colours are a best reading. |
| Street scene | A new design. It is not a reproduction, on purpose. |
| Font | The reference type looks like Inter or Inter Tight. Not confirmed. |

Known gaps in the prototypes (the spec wins here): `pixel-wipe.html` clips the text with `clip-path` (use the texture method in section 8). `icon-fountain.html` uses hand-made stroke glyphs (use Phosphor fills). `sun-orb.html` has no dither and assumes a white background. The prototypes read `performance.now()` and `Math.random()` (use the clock and the seeded PRNG).

---

## 14. Open decisions (defaults are set; change them before the build if needed)

1. **Name.** Default "Studio".
2. **Photos.** Default: generated placeholders, and the user replaces them in the panel.
3. **Street scene.** Default: our own code-drawn scene (section 11). Alternative: the user supplies layered art (PNG or SVG, one file per mover and per depth layer), and the same lane engine moves it.
4. **Sixth recording.** A file `Screen Recording 2026-11-16 at 3.02.47 PM.mov` is on the Desktop, but it was not in the request. It is not analysed here.
5. **Hosting.** Default: none. Local `npm run dev` and a static `dist/`.
