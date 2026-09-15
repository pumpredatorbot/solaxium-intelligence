/** The SOLAXIUM mark: three orbiting nodes around a core — drawn, not an emoji. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <circle cx="12" cy="12" r="6.4" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <circle cx="12" cy="12" r="10.2" stroke="currentColor" strokeWidth="1" opacity="0.22" />
      <circle cx="18.4" cy="12" r="1.5" fill="currentColor" opacity="0.85" />
      <circle cx="8.8" cy="4.6" r="1.2" fill="currentColor" opacity="0.6" />
      <circle cx="5.2" cy="16.6" r="1.1" fill="currentColor" opacity="0.45" />
    </svg>
  );
}
