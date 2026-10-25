import { useSyncExternalStore } from 'react';

export const THEMES = [
  { id: 'standard', label: 'Standard', note: 'Bright, color-coded' },
  { id: 'professional', label: 'Professional', note: 'Muted monochrome, serif type' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'twin-theme';
const listeners = new Set<() => void>();

function stored(): ThemeId {
  const v = localStorage.getItem(KEY);
  return THEMES.some(t => t.id === v) ? (v as ThemeId) : 'standard';
}

/** Standard is the stylesheet's default, so it needs no attribute. */
function apply(theme: ThemeId) {
  if (theme === 'standard') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function initTheme() {
  apply(stored());
}

export function setTheme(theme: ThemeId) {
  localStorage.setItem(KEY, theme);
  apply(theme);
  listeners.forEach(l => l());
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    stored
  );
}
