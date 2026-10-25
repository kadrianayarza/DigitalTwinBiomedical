import type { HealthCategory } from '../../spacetimedb/src/health';

const PATHS: Record<HealthCategory | 'sources' | 'summary' | 'browse', string> = {
  activity: 'M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.8 1.2 2.8 2.2 3C10.5 8.5 11 5.5 12 3z',
  body: 'M12 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM6 9.5h12M12 9.5v5m0 0-3 6m3-6 3 6',
  cycle: 'M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z',
  hearing: 'M7 9a5 5 0 1 1 9.4 2.4c-.9 1.5-2.4 2.2-2.4 4.1a2.5 2.5 0 0 1-4.5 1.5M10 9.5a2 2 0 1 1 3 1.7',
  heart: 'M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z',
  medications: 'M8.5 15.5l7-7a3.5 3.5 0 0 0-5-5l-7 7a3.5 3.5 0 0 0 5 5zM7 7l5 5',
  mental: 'M12 20c-4.5-2-7-5.5-7-9.5C8 10.5 10.5 12 12 15c1.5-3 4-4.5 7-4.5 0 4-2.5 7.5-7 9.5zM12 15V8m0 0c-1.5-1.5-1.5-3.5 0-5 1.5 1.5 1.5 3.5 0 5z',
  mobility: 'M13 4.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 21l2.5-6.5L14 17v4m-6.5-9.5L10 9l3.5 1 2 3.5h3M11.5 14.5 13 10',
  nutrition: 'M12 8c-1-2.5-4-3-6-1.5S4 12 6 16c1.5 3 3.5 4.5 6 3.5 2.5 1 4.5-.5 6-3.5 2-4 1.5-8-1-9.5S13 5.5 12 8zm0 0c0-2 1-3.5 3-4.5',
  respiratory: 'M12 4v8m0 0c-1 1-3 1.5-3 1.5M12 12c1 1 3 1.5 3 1.5M9 8c-3 0-5 4-5 9 0 2 1.5 3 3 2.5s2-1.5 2-3.5V8zm6 0c3 0 5 4 5 9 0 2-1.5 3-3 2.5s-2-1.5-2-3.5V8z',
  sleep: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z',
  vitals: 'M3 12h4l2-5 3.5 10 2.5-7 1.5 2H21',
  other: 'M12 5v14M5 12h14',
  sources: 'M9 3.5h6l.6 3H8.4zM9 20.5h6l.6-3H8.4zM7.5 6.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM12 9.5V12l1.5 1.5',
  summary: 'M12 4a8 8 0 1 0 8 8M12 4a8 8 0 0 1 8 8M12 4v8h8',
  browse: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z',
};

export function CategoryIcon({ id, className = '' }: { id: keyof typeof PATHS; className?: string }) {
  return (
    <svg className={`hicon ${className}`} viewBox="0 0 24 24" aria-hidden>
      <path d={PATHS[id]} />
    </svg>
  );
}
