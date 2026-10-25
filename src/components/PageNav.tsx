import { useEffect, useRef, useState } from 'react';
import { PAGE_TABS, registerPageActivator } from '../lib/navigate';
import { metaFor } from '../lib/voice';

/** The shell pages: the dashboard plus the dedicated schedule, messages, and app-setup pages. */
export type ShellPage = 'home' | 'schedule' | 'messages' | 'setup';

const initialShellPage = (): ShellPage => {
  const p = new URLSearchParams(window.location.search).get('page');
  return p === 'schedule' || p === 'messages' || p === 'setup' ? p : 'home';
};

/**
 * Page state for a shell screen. Syncs the ?page= URL param and registers the
 * activator that lets navigation helpers (voice, chat, cross-links) switch pages.
 */
export function useShellPage(): [ShellPage, (page: ShellPage) => void] {
  const [page, setPage] = useState<ShellPage>(initialShellPage);
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
    const url = new URL(window.location.href);
    if (page === 'home') url.searchParams.delete('page');
    else url.searchParams.set('page', page);
    window.history.replaceState(null, '', url);
  }, [page]);
  useEffect(() => {
    registerPageActivator(target => {
      const next: ShellPage = PAGE_TABS.has(target) ? (target as ShellPage) : 'home';
      const changed = pageRef.current !== next;
      if (changed) setPage(next);
      return changed;
    });
    return () => registerPageActivator(null);
  }, []);
  return [page, setPage];
}

/** The tab strip that switches between the dashboard and the dedicated pages. */
export function PageNav({
  page,
  onChange,
  tabs,
  setupLabel = 'Your app',
}: {
  page: ShellPage;
  onChange: (page: ShellPage) => void;
  tabs: readonly string[];
  setupLabel?: string;
}) {
  const items: Array<{ id: ShellPage; label: string }> = [{ id: 'home', label: 'Home' }];
  if (tabs.includes('schedule')) items.push({ id: 'schedule', label: metaFor('schedule').label });
  if (tabs.includes('messages')) items.push({ id: 'messages', label: metaFor('messages').label });
  items.push({ id: 'setup', label: setupLabel });
  return (
    <nav className="pagenav" aria-label="Pages">
      <span className="ptabs" role="tablist">
        {items.map(item => (
          <button
            key={item.id}
            role="tab"
            aria-selected={page === item.id}
            className={`ptabs__tab pagenav__tab ${page === item.id ? 'ptabs__tab--on' : ''}`}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </span>
    </nav>
  );
}
