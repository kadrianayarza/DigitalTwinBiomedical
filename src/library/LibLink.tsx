import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useData } from '../lib/data';

/**
 * An inline library reference. One tap shows a hint; two quick taps open the
 * side library drawer. Unknown terms render as plain text.
 */
export function LibLink({
  slug,
  onOpen,
  children,
}: {
  slug: string;
  onOpen: (slug: string) => void;
  children?: ReactNode;
}) {
  const data = useData();
  const entry = data.libraryEntries.find(e => e.slug === slug);
  const lastTap = useRef(0);
  const hintTimer = useRef<number | undefined>(undefined);
  const [hint, setHint] = useState(false);

  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  if (!entry) return <>{children ?? slug}</>;

  const tap = () => {
    const now = Date.now();
    if (now - lastTap.current < 350) {
      lastTap.current = 0;
      setHint(false);
      onOpen(entry.slug);
      return;
    }
    lastTap.current = now;
    setHint(true);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(false), 1800);
  };

  return (
    <button
      type="button"
      className={`liblink${hint ? ' liblink--hint' : ''}`}
      onClick={tap}
      title="Double-tap to learn more"
    >
      {children ?? entry.name}
      {hint && (
        <span className="liblink__hint" role="status">
          Tap twice to learn more
        </span>
      )}
    </button>
  );
}
