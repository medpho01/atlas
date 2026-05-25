'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

const STORAGE_KEY = 'labstack-theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as 'light' | 'dark' | null);
    const initial = stored ?? 'dark';
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  if (theme === null) return <span className="w-8 h-8" />; // SSR placeholder
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggle}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      className="w-8 h-8 rounded-md flex items-center justify-center text-ink-500 hover:text-ink-900 hover:bg-ink-100 transition-colors"
      aria-label="Toggle theme"
    >
      {isDark ? <Sun className="w-4 h-4" strokeWidth={2.25} /> : <Moon className="w-4 h-4" strokeWidth={2.25} />}
    </button>
  );
}

function applyTheme(theme: 'light' | 'dark') {
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}
