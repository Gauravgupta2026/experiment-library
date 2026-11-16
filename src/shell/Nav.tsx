import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { APP_NAME, CATEGORIES } from '../config';
import { experiments } from '../experiments/registry';

export type Theme = 'light' | 'dark';

const Sun = (): JSX.Element => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85" />
  </svg>
);
const Moon = (): JSX.Element => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z" /></svg>
);

export function Nav({ theme, onToggleTheme }: { theme: Theme; onToggleTheme(): void }): JSX.Element {
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const [scrolled, setScrolled] = useState(false);
  const onFeed = pathname === '/';
  const active = search.get('c') ?? 'All';
  // A chip shows only if at least one experiment uses its category.
  const chips = ['All', ...CATEGORIES.filter((c) => experiments.some((e) => e.category === c))];

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 0);
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="nav" data-scrolled={scrolled}>
      <Link to="/" className="nav-brand">{APP_NAME}</Link>
      {onFeed ? (
        <nav className="nav-chips" aria-label="Categories">
          {chips.map((c) => <Link key={c} className="chip" to={c === 'All' ? '/' : `/?c=${c}`} aria-current={active === c} replace>{c}</Link>)}
        </nav>
      ) : <span className="nav-spacer" />}
      <button type="button" className="icon-btn" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Use the light theme' : 'Use the dark theme'}>
        {theme === 'dark' ? <Sun /> : <Moon />}
      </button>
    </header>
  );
}
