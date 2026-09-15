import Image from 'next/image';

/**
 * The SOLAXIUM mark. The asset is a raster logo, so it is rendered through
 * next/image with an explicit size rather than scaled by CSS.
 */
export function SolaxiumMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <Image
      src="/solaxium-mark.png"
      alt=""
      width={size}
      height={size}
      priority
      className={`shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function SolaxiumWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 flex-col leading-none">
      <span className="font-mono text-xs font-semibold uppercase tracking-widest2 text-ink">
        Solaxium
      </span>
      {!compact && (
        <span className="mt-1 font-mono text-3xs uppercase tracking-widest3 text-ink-faint">
          Intelligence
        </span>
      )}
    </span>
  );
}
