import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { experiments } from '../experiments/registry';
import { columnsFor, placeMasonry } from '../lib/masonry';
import { Card } from './Card';

const GAP = 8;
const SCROLL_KEY = 'studio.feedScroll';
const INTRO_HEIGHT_GUESS = 110;

export function Feed(): JSX.Element {
  const [search] = useSearchParams();
  const category = search.get('c');
  const grid = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [introH, setIntroH] = useState(INTRO_HEIGHT_GUESS);
  const [ready, setReady] = useState(false);
  const lastPos = useRef(new Map<string, { x: number; y: number }>());

  useLayoutEffect(() => {
    const el = grid.current; if (!el) return;
    const measure = (): void => { setWidth(el.clientWidth); if (intro.current) setIntroH(intro.current.offsetHeight); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el); if (intro.current) ro.observe(intro.current);
    return () => ro.disconnect();
  }, []);

  // Keep the scroll position when the user comes back from an experiment.
  useEffect(() => {
    let saved = 0;
    try { saved = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0); } catch { /* storage can be blocked */ }
    if (saved > 0) window.scrollTo(0, saved);
    const id = requestAnimationFrame(() => setReady(true));   // turn on position transitions only after the first layout
    return () => { cancelAnimationFrame(id); try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch { /* ignore */ } };
  }, []);

  const columns = columnsFor(typeof window === 'undefined' ? 1280 : window.innerWidth);
  const colW = width > 0 ? (width - GAP * (columns - 1)) / columns : 0;
  const visible = experiments.filter((e) => !category || e.category === category);
  const { items, height } = placeMasonry([introH, ...visible.map((e) => colW / e.cardAspect)], columns, GAP);
  const at = (i: number): { x: number; y: number } => { const it = items[i]; return { x: (it?.column ?? 0) * (colW + GAP), y: it?.top ?? 0 }; };
  const introPos = at(0);

  return (
    <main className="feed">
      <div className="feed-grid" ref={grid} data-ready={ready} style={{ height }}>
        <div className="feed-item" style={{ width: colW || '100%', transform: `translate(${introPos.x}px, ${introPos.y}px)` }}>
          <div className="intro" ref={intro}>
            <h1>Motion experiments</h1>
            <p>Open one. Change everything.</p>
          </div>
        </div>
        {colW > 0 ? experiments.map((e) => {
          const index = visible.indexOf(e);
          const hidden = index < 0;
          // A card that leaves the filter fades out in its last place.
          const pos = hidden ? lastPos.current.get(e.id) ?? { x: 0, y: 0 } : at(index + 1);
          if (!hidden) lastPos.current.set(e.id, pos);
          return (
            <div className="feed-item" key={e.id} data-hidden={hidden} aria-hidden={hidden}
              style={{ width: colW, height: colW / e.cardAspect, transform: `translate(${pos.x}px, ${pos.y}px)` }}>
              <Card meta={e} />
            </div>
          );
        }) : null}
      </div>
    </main>
  );
}
