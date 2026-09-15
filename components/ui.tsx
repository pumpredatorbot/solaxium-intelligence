import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-2">{eyebrow}</div>}
        <h1 className="text-xl font-medium tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className = '',
  bodyClassName = 'p-4',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-head">
          {title && <h2 className="label">{title}</h2>}
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: 'default' | 'sol' | 'danger' | 'muted';
}) {
  const toneClass =
    tone === 'sol'
      ? 'text-sol'
      : tone === 'danger'
        ? 'text-danger'
        : tone === 'muted'
          ? 'text-ink-muted'
          : 'text-ink';

  return (
    <div className="panel p-4">
      <div className="label">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`stat-value ${toneClass}`}>{value}</span>
        {unit && <span className="font-mono text-2xs uppercase text-ink-faint">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-2xs text-ink-faint">{hint}</div>}
    </div>
  );
}

export function StatusDot({ status }: { status: 'ALIVE' | 'DEAD' | string }) {
  const alive = status === 'ALIVE';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={[
          'h-1.5 w-1.5 rounded-full',
          alive ? 'bg-sol animate-pulse-soft' : 'bg-danger/70',
        ].join(' ')}
      />
      <span
        className={`font-mono text-2xs uppercase tracking-wider ${alive ? 'text-sol' : 'text-danger/90'}`}
      >
        {status}
      </span>
    </span>
  );
}

export function AgentLink({
  code,
  id,
  className = '',
}: {
  code: string;
  id: string;
  className?: string;
}) {
  return (
    <Link
      href={`/agents/${id}`}
      className={`font-mono text-xs text-ink transition-colors hover:text-sol ${className}`}
    >
      {code}
    </Link>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="font-mono text-xs uppercase tracking-widest2 text-ink-muted">{title}</div>
      <p className="max-w-md text-sm leading-relaxed text-ink-faint">{description}</p>
      {action}
    </div>
  );
}

export function Delta({ value, decimals = 4 }: { value: number; decimals?: number }) {
  const tone = value > 0 ? 'text-sol' : value < 0 ? 'text-danger' : 'text-ink-faint';
  const sign = value > 0 ? '+' : '';
  return (
    <span className={`tabular font-mono ${tone}`}>
      {sign}
      {value.toFixed(decimals)}
    </span>
  );
}

export function TraitBar({ name, value }: { name: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 font-mono text-2xs uppercase tracking-wider text-ink-faint">
        {name}
      </span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-sol/70"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="tabular w-10 text-right font-mono text-2xs text-ink-muted">
        {value.toFixed(2)}
      </span>
    </div>
  );
}
