import { useState, type ReactNode } from 'react';

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

export function Panel({
  title,
  code,
  className = '',
  collapsible = false,
  dataTab,
  children,
}: {
  title?: ReactNode;
  code?: ReactNode;
  className?: string;
  collapsible?: boolean;
  /** Marks the section so voice navigation can scroll to it. */
  dataTab?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  if (collapsible) {
    return (
      <details
        className={`panel panel--collapsible ${className}`}
        data-tab={dataTab}
        open={expanded}
        onToggle={event => {
          const next = event.currentTarget.open;
          setExpanded(current => (current === next ? current : next));
        }}
      >
        {(title || code) && (
          <summary className="panel__head panel__head--toggle">
            <span className="panel__head-main">
              {title && (
                <span className="panel__title" role="heading" aria-level={2}>
                  {title}
                </span>
              )}
              {code && <span className="panel__code">{code}</span>}
            </span>
            <span className="panel__chevron" aria-hidden />
          </summary>
        )}
        {children}
      </details>
    );
  }

  return (
    <section className={`panel ${className}`} data-tab={dataTab}>
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

/** Nested section with its own corner chevron, independent of sibling sections. */
export function Disclosure({
  label,
  count,
  className = '',
  defaultOpen = true,
  children,
}: {
  label: ReactNode;
  count?: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  return (
    <details
      className={`disclosure ${className}`}
      open={expanded}
      onToggle={event => {
        const next = event.currentTarget.open;
        setExpanded(current => (current === next ? current : next));
      }}
    >
      <summary className="disclosure__head">
        <span className="disclosure__label">{label}</span>
        {count !== undefined && <span className="disclosure__count">{count}</span>}
        <span className="disclosure__chevron" aria-hidden />
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
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
