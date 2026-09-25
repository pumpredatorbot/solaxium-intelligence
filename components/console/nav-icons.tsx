/**
 * Navigation glyphs. Drawn inline as 16px stroke icons so they inherit colour
 * and stay crisp, and so the console ships no icon-font dependency.
 */
type IconProps = { className?: string };

const base = 'h-4 w-4 shrink-0';

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className ?? ''}`}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconOverview(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1.8" y="1.8" width="5" height="5" rx="1" />
      <rect x="9.2" y="1.8" width="5" height="5" rx="1" />
      <rect x="1.8" y="9.2" width="5" height="5" rx="1" />
      <rect x="9.2" y="9.2" width="5" height="5" rx="1" />
    </Svg>
  );
}

export function IconAgents(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="5.4" r="2.4" />
      <path d="M1.9 13.4c0-2.3 1.8-3.8 4.1-3.8s4.1 1.5 4.1 3.8" />
      <path d="M11 3.4a2.3 2.3 0 0 1 0 4.2M12.4 13.4c0-1.6-.5-2.7-1.4-3.4" />
    </Svg>
  );
}

export function IconEngines(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="2.1" />
      <circle cx="8" cy="8" r="6.1" strokeDasharray="2.4 2.2" />
      <path d="M8 1.9v1.8M8 12.3v1.8M1.9 8h1.8M12.3 8h1.8" />
    </Svg>
  );
}

export function IconMarket(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M1.8 11.6 5.4 7.4l3 2.4 5.8-6" />
      <path d="M10.6 3.8h3.6v3.6" />
    </Svg>
  );
}

export function IconPortfolio(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1.8" y="4.6" width="12.4" height="9" rx="1.4" />
      <path d="M5.4 4.6V3.4a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.2M1.8 8.4h12.4" />
    </Svg>
  );
}

export function IconAnalytics(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.2 14V9.2M6.1 14V3.4M10 14v-6.4M13.9 14V6" />
    </Svg>
  );
}

export function IconReplay(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.2 8a5.8 5.8 0 1 0 1.9-4.3" />
      <path d="M2 2.2v3.4h3.4" />
      <path d="M7.2 6.4 10.2 8l-3 1.6z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6 3.5 3.5" />
    </Svg>
  );
}

export function IconPlay(p: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={`${base} ${p.className ?? ''}`} aria-hidden="true">
      <path d="M5 3.4v9.2l7.2-4.6z" />
    </svg>
  );
}

export function IconPause(p: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={`${base} ${p.className ?? ''}`} aria-hidden="true">
      <rect x="4.4" y="3.4" width="2.6" height="9.2" rx="0.6" />
      <rect x="9" y="3.4" width="2.6" height="9.2" rx="0.6" />
    </svg>
  );
}

export function IconStep(p: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={`${base} ${p.className ?? ''}`} aria-hidden="true">
      <path d="M3.6 3.4v9.2L10 8z" />
      <rect x="10.8" y="3.4" width="2.2" height="9.2" rx="0.6" />
    </svg>
  );
}

export function IconStop(p: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={`${base} ${p.className ?? ''}`} aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1" />
    </svg>
  );
}

export function IconReset(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.8 8a5.8 5.8 0 1 1-1.9-4.3" />
      <path d="M14 2.2v3.4h-3.4" />
    </Svg>
  );
}

/** Paper trading: two candles crossed by a target line. */
export function IconTrading(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 3.4v1.8M4 10.6v2" />
      <rect x="2.6" y="5.2" width="2.8" height="5.4" rx="0.6" />
      <path d="M11 2.6v1.6M11 11v2.4" />
      <rect x="9.6" y="4.2" width="2.8" height="6.8" rx="0.6" />
      <path d="M1.2 8h13.6" strokeDasharray="1.6 1.6" opacity="0.5" />
    </Svg>
  );
}
