import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { ExperimentPage } from './shell/ExperimentPage';
import { Feed } from './shell/Feed';
import { Nav, type Theme } from './shell/Nav';

const THEME_KEY = 'studio.theme';

function readStored(): Theme | null {
  try { const v = localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : null; } catch { return null; }
}
const systemTheme = (): Theme => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function Shell(): JSX.Element {
  const [search] = useSearchParams();
  const capture = search.get('capture') === '1';
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? systemTheme());

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  // Follow the system until the user chooses a theme.
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => { if (!readStored()) setTheme(systemTheme()); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const toggle = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage can be blocked */ }
  };

  return (
    <>
      {capture ? null : <Nav theme={theme} onToggleTheme={toggle} />}
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/e/:id" element={<ExperimentPage />} />
        <Route path="*" element={<main className="feed"><div className="intro"><h1>Not found</h1></div></main>} />
      </Routes>
    </>
  );
}

export function App(): JSX.Element {
  return <BrowserRouter><Shell /></BrowserRouter>;
}
