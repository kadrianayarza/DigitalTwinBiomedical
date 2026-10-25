import { useEffect, useRef, useState } from 'react';
import { THEMES, setTheme, useTheme } from '../lib/theme';

/** Topbar menu for choosing how the dashboard looks. The choice is kept per browser. */
export function ThemeSwitch() {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="pswitch" ref={root}>
      <button
        className="roleswitch pswitch__btn themeswitch__btn"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Themes"
        title="Themes"
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" className="themeswitch__half" />
        </svg>
        <span className="themeswitch__label">Themes</span>
      </button>
      {open && (
        <div className="pswitch__menu themeswitch__menu" role="menu" aria-label="Themes">
          {THEMES.map(t => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === theme}
              className={`pswitch__item ${t.id === theme ? 'pswitch__item--on' : ''}`}
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
            >
              <span className="pswitch__name">{t.label}</span>
              <span className="pswitch__care">{t.note}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
