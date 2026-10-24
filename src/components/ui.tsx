import type { ReactNode } from 'react';

export function Brand({ sub, size = 'md' }: { sub?: string; size?: 'md' | 'lg' }) {
  return (
    <div className={`brand brand--${size}`}>
      <HexMark />
      <span className="brand__name">
        Digital Twin <em>Biomedical</em>
      </span>
      {sub && <span className="brand__sub">{sub}</span>}
    </div>
  );
}

export function HexMark() {
  return (
    <svg className="hexmark" viewBox="0 0 32 32" aria-hidden>
      <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" />
      <polygon points="16,10 21,13 21,19 16,22 11,19 11,13" />
    </svg>
  );
}

export type HexTone = 'ok' | 'info' | 'watch' | 'alarm' | 'off';

/** Hexagonal status light. */
export function Hex({ tone, label, children }: { tone: HexTone; label?: string; children?: ReactNode }) {
  return (
    <span className={`hex hex--${tone}`} role={label ? 'img' : undefined} aria-label={label} title={label}>
      {children}
    </span>
  );
}

export function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <span className={`live ${connected ? 'live--on' : ''}`}>
      <Hex tone={connected ? 'ok' : 'off'} />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

export function Panel({
  title,
  code,
  className = '',
  children,
}: {
  title?: ReactNode;
  code?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || code) && (
        <header className="panel__head">
          {title && <h2 className="panel__title">{title}</h2>}
          {code && <span className="panel__code">{code}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

export function SeverityHex({ severity }: { severity: number }) {
  const tone: HexTone = severity >= 7 ? 'alarm' : severity >= 4 ? 'watch' : 'ok';
  return (
    <Hex tone={tone} label={`Pain ${severity} of 10`}>
      {severity}
    </Hex>
  );
}
