import { useEffect, useState } from 'react';

const KEY = 'alphanote:theme';

export function initTheme() {
  const saved = localStorage.getItem(KEY);
  document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark');
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<string>(document.documentElement.getAttribute('data-theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return (
    <button
      className="icon-btn"
      title="Toggle theme"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
