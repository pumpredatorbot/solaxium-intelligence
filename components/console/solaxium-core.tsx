'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoreNode } from '@/lib/repo/queries';
import { MODULE_BY_KIND } from '@/lib/telemetry';
import { useConsole } from './console-provider';

/**
 * THE SOLAXIUM CORE
 *
 * A live portrait of the population. Every node is a real agent, every edge a
 * real parent→child lineage, every ring a generation. Node radius tracks
 * capital, colour tracks state.
 *
 * Driven by two real sources: the population snapshot on the status poll
 * (authoritative — the visualisation self-heals rather than drifting), and the
 * event stream (transient: births scale in, deaths fade to red, clones send a
 * pulse down the lineage edge that produced them).
 *
 * Rendered on a 2D canvas rather than SVG/DOM because a few hundred animated
 * nodes as DOM elements would thrash layout on every frame.
 */

const MODULES = [
  'PERCEPTION',
  'ANALYSIS',
  'JUDGMENT',
  'DECISION',
  'EXECUTION',
  'LEARNING',
  'ADAPTATION',
  'MEMORY',
] as const;

type ModuleName = (typeof MODULES)[number];

interface RenderNode {
  id: string;
  code: string;
  generation: number;
  alive: boolean;
  capital: number;
  parentId: string | null;
  /** Stable polar position, so nodes never jump between polls. */
  angle: number;
  ring: number;
  /** 0→1 birth animation. */
  age: number;
  /** 0→1 death fade. */
  decay: number;
  seen: number;
}

interface Pulse {
  fromId: string;
  toId: string | null;
  t: number;
  tone: 'birth' | 'death' | 'clone' | 'flow';
}

/** Deterministic hash → an angle that never changes for a given agent. */
function angleFor(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 0x1_0000_0000) * Math.PI * 2;
}

export function SolaxiumCore({ initialPopulation }: { initialPopulation: CoreNode[] }) {
  const { population, events, lifecycleEvents, telemetry, running, stats } = useConsole();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Map<string, RenderNode>>(new Map());
  const pulsesRef = useRef<Pulse[]>([]);
  const moduleHeatRef = useRef<Record<string, number>>({});
  const frameRef = useRef<number>(0);
  const lastEventSeq = useRef(0);
  const lastLifecycleSeq = useRef(0);
  const [reduced, setReduced] = useState(false);

  const live = population.length > 0 ? population : initialPopulation;
  const populationCount = stats?.liveAgents ?? live.filter((n) => n.a === 1).length;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const listen = () => setReduced(query.matches);
    query.addEventListener('change', listen);
    return () => query.removeEventListener('change', listen);
  }, []);

  // --- reconcile the authoritative snapshot into render state --------------
  useEffect(() => {
    const map = nodesRef.current;
    const now = performance.now();

    for (const node of live) {
      const existing = map.get(node.i);
      if (existing) {
        existing.capital = node.k;
        existing.generation = node.g;
        existing.parentId = node.p;
        existing.seen = now;
        if (existing.alive && node.a === 0) existing.decay = 0.001; // just died
        existing.alive = node.a === 1;
      } else {
        map.set(node.i, {
          id: node.i,
          code: node.c,
          generation: node.g,
          alive: node.a === 1,
          capital: node.k,
          parentId: node.p,
          angle: angleFor(node.i),
          ring: node.g,
          age: 0,
          decay: node.a === 1 ? 0 : 1,
          seen: now,
        });
      }
    }

    // Drop anything the snapshot no longer carries (e.g. after a reset).
    for (const [id, node] of map) {
      if (node.seen !== now) map.delete(id);
    }
  }, [live]);

  // --- lifecycle: births, deaths, clones -----------------------------------
  // Read from the complete lifecycle stream so no birth or death is missed,
  // however fast the engine is running.
  useEffect(() => {
    for (const event of lifecycleEvents) {
      if (event.seq <= lastLifecycleSeq.current) continue;
      lastLifecycleSeq.current = event.seq;

      if (event.type === 'AGENT_BORN' && event.agentId) {
        pulsesRef.current.push({ fromId: event.agentId, toId: null, t: 0, tone: 'birth' });
      } else if (event.type === 'AGENT_DEAD' && event.agentId) {
        pulsesRef.current.push({ fromId: event.agentId, toId: null, t: 0, tone: 'death' });
      } else if (event.type === 'CLONE_CREATED' && event.agentId) {
        const childId = (event.data as { childId?: string } | null)?.childId ?? null;
        pulsesRef.current.push({ fromId: event.agentId, toId: childId, t: 0, tone: 'clone' });
      }
    }
    if (pulsesRef.current.length > 140) pulsesRef.current = pulsesRef.current.slice(-140);
  }, [lifecycleEvents]);

  // --- activity: a pulse per recorded action -------------------------------
  useEffect(() => {
    for (const event of events) {
      if (event.seq <= lastEventSeq.current) continue;
      lastEventSeq.current = event.seq;
      if (event.type === 'AGENT_ACTION' && event.agentId) {
        pulsesRef.current.push({ fromId: event.agentId, toId: null, t: 0, tone: 'flow' });
      }
    }
    // A burst at 25x must not become an unbounded queue.
    if (pulsesRef.current.length > 140) {
      pulsesRef.current = pulsesRef.current.slice(-140);
    }
  }, [events]);

  // --- module heat, from the real telemetry kinds --------------------------
  const moduleHeat = useMemo(() => {
    const heat: Record<string, number> = {};
    const recent = telemetry.slice(-40);
    recent.forEach((line, index) => {
      const module = MODULE_BY_KIND[line.kind];
      // Newer lines weigh more, so the ring reflects the present.
      heat[module] = Math.max(heat[module] ?? 0, (index + 1) / recent.length);
    });
    return heat;
  }, [telemetry]);

  useEffect(() => {
    moduleHeatRef.current = moduleHeat;
  }, [moduleHeat]);

  // --- render loop ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      // Nothing is visible in a hidden tab; don't burn the CPU drawing it.
      if (document.hidden) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }

      // Before the first layout pass the canvas can report a zero box; drawing
      // an arc with a negative radius throws, so wait for a real size.
      if (width < 40 || height < 40) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }

      const cx = width / 2;
      const cy = height / 2;
      const maxRadius = Math.max(24, Math.min(width, height) / 2 - 18);

      ctx.clearRect(0, 0, width, height);

      const nodes = [...nodesRef.current.values()];
      const maxRing = Math.max(1, ...nodes.map((n) => n.ring));
      const maxCapital = Math.max(1, ...nodes.map((n) => n.capital));

      const positionOf = (node: RenderNode) => {
        // Generation 0 sits near the nucleus; each generation moves outward.
        const t = maxRing === 0 ? 0.35 : 0.3 + (node.ring / maxRing) * 0.7;
        const radius = t * maxRadius;
        const wobble = reduced ? 0 : Math.sin(now / 2600 + node.angle * 3) * 3.5;
        return {
          x: cx + Math.cos(node.angle) * (radius + wobble),
          y: cy + Math.sin(node.angle) * (radius + wobble),
        };
      };

      // --- generation rings (recessive) ---
      ctx.lineWidth = 1;
      for (let ring = 0; ring <= maxRing; ring++) {
        const t = maxRing === 0 ? 0.35 : 0.3 + (ring / maxRing) * 0.7;
        ctx.beginPath();
        ctx.arc(cx, cy, t * maxRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(140,170,255,0.055)';
        ctx.stroke();
      }

      // --- lineage edges ---
      for (const node of nodes) {
        if (!node.parentId) continue;
        const parent = nodesRef.current.get(node.parentId);
        if (!parent) continue;
        const a = positionOf(parent);
        const b = positionOf(node);
        const alpha = node.alive ? 0.2 : 0.07;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        // Bow the edge toward the nucleus so the lineage reads as radial.
        ctx.quadraticCurveTo((a.x + b.x) / 2 + (cx - (a.x + b.x) / 2) * 0.28,
                             (a.y + b.y) / 2 + (cy - (a.y + b.y) / 2) * 0.28,
                             b.x, b.y);
        ctx.strokeStyle = `rgba(76,141,255,${alpha})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }

      // --- pulses travelling the lineage ---
      const pulses = pulsesRef.current;
      for (let i = pulses.length - 1; i >= 0; i--) {
        const pulse = pulses[i];
        pulse.t += dt * (pulse.tone === 'flow' ? 2.4 : 1.5);
        if (pulse.t >= 1) {
          pulses.splice(i, 1);
          continue;
        }

        const from = nodesRef.current.get(pulse.fromId);
        if (!from) {
          pulses.splice(i, 1);
          continue;
        }
        const origin = positionOf(from);

        if (pulse.toId) {
          const to = nodesRef.current.get(pulse.toId);
          if (to) {
            const target = positionOf(to);
            const x = origin.x + (target.x - origin.x) * pulse.t;
            const y = origin.y + (target.y - origin.y) * pulse.t;
            ctx.beginPath();
            ctx.arc(x, y, 2.4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(240,91,208,${1 - pulse.t})`;
            ctx.fill();
            continue;
          }
        }

        // A ring expanding from the node itself.
        const tone =
          pulse.tone === 'death'
            ? '255,92,119'
            : pulse.tone === 'birth'
              ? '47,214,155'
              : '34,224,240';
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, 3 + pulse.t * 14, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${tone},${(1 - pulse.t) * 0.55})`;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }

      // --- nodes ---
      for (const node of nodes) {
        if (node.age < 1) node.age = Math.min(1, node.age + dt * 2.2);
        if (!node.alive && node.decay < 1) node.decay = Math.min(1, node.decay + dt * 0.7);

        const { x, y } = positionOf(node);
        const capital = Number.isFinite(node.capital) ? Math.max(0, node.capital) : 0;
        const scale = 0.4 + 0.6 * (capital / maxCapital);
        const radius = Math.max(0.5, (1.6 + scale * 3.4) * node.age);

        if (node.alive) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 4.5);
          glow.addColorStop(0, 'rgba(34,224,240,0.32)');
          glow.addColorStop(1, 'rgba(34,224,240,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, radius * 4.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = '#9EF3FB';
          ctx.fill();
        } else {
          const fade = 1 - node.decay * 0.75;
          ctx.beginPath();
          ctx.arc(x, y, radius * (1 - node.decay * 0.45), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,92,119,${0.5 * fade})`;
          ctx.fill();
        }
      }

      // --- nucleus ---
      const nucleus = 26 + (reduced ? 0 : Math.sin(now / 900) * 2);
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucleus * 3.4);
      halo.addColorStop(0, 'rgba(154,107,255,0.30)');
      halo.addColorStop(0.45, 'rgba(34,224,240,0.12)');
      halo.addColorStop(1, 'rgba(34,224,240,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, nucleus * 3.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, nucleus, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(34,224,240,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
    };
  }, [reduced]);

  return (
    <div className="relative flex aspect-square w-full items-center justify-center">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={`Population network: ${populationCount} live agents across ${stats?.generations ?? 0} generations`}
      />

      {/* Cognitive modules. HTML rather than canvas so the labels stay
          selectable, legible and available to a screen reader. */}
      {MODULES.map((module, index) => {
        const angle = (index / MODULES.length) * Math.PI * 2 - Math.PI / 2;
        const heat = moduleHeat[module] ?? 0;
        return (
          <div
            key={module}
            className="pointer-events-none absolute"
            style={{
              left: `${50 + Math.cos(angle) * 43}%`,
              top: `${50 + Math.sin(angle) * 43}%`,
              transform: 'translate(-50%,-50%)',
            }}
          >
            <ModuleBadge name={module} heat={running ? heat : heat * 0.25} />
          </div>
        );
      })}

      {/* Nucleus label */}
      <div className="pointer-events-none relative z-10 flex flex-col items-center text-center">
        <span className="font-mono text-[10px] uppercase tracking-widest3 text-cy/80">
          Solaxium
        </span>
        <span className="mt-1 font-mono text-[10px] uppercase tracking-widest3 text-ink-muted">
          Core
        </span>
        <span className="tabular mt-2.5 font-mono text-lg text-ink">{populationCount}</span>
        <span className="font-mono text-[9px] uppercase tracking-widest2 text-ink-faint">
          live agents
        </span>
      </div>
    </div>
  );
}

function ModuleBadge({ name, heat }: { name: ModuleName; heat: number }) {
  const intensity = Math.min(1, heat);
  return (
    <div
      className="flex flex-col items-center gap-1 transition-opacity duration-500"
      style={{ opacity: 0.4 + intensity * 0.6 }}
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full border transition-colors duration-500"
        style={{
          borderColor: `rgba(34,224,240,${0.18 + intensity * 0.6})`,
          background: `rgba(34,224,240,${intensity * 0.12})`,
          boxShadow: intensity > 0.5 ? `0 0 14px -4px rgba(34,224,240,${intensity})` : 'none',
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full transition-colors duration-500"
          style={{ background: `rgba(158,243,251,${0.35 + intensity * 0.65})` }}
        />
      </span>
      <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-widest2 text-ink-faint">
        {name}
      </span>
    </div>
  );
}
