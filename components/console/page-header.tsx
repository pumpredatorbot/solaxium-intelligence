export function ConsoleHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-1.5">{eyebrow}</div>}
        <h1 className="font-mono text-base font-medium uppercase tracking-widest2 text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-ink-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyConsole({ title, description }: { title: string; description: string }) {
  return (
    <div className="panel flex flex-col items-center gap-2.5 px-6 py-16 text-center">
      <div className="font-mono text-2xs uppercase tracking-widest2 text-ink-muted">{title}</div>
      <p className="max-w-md font-mono text-3xs leading-relaxed text-ink-faint">{description}</p>
      <p className="mt-1 font-mono text-3xs text-ink-ghost">
        Use the transport controls in the top bar to start a run.
      </p>
    </div>
  );
}
