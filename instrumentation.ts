/**
 * Next.js instrumentation hook — runs once when a server instance boots.
 *
 * This is where the in-process simulation runners are reconciled with the
 * database, so a run the database still considers RUNNING survives a restart
 * or a redeploy instead of silently freezing.
 */

export async function register() {
  // The runner uses Node timers and Prisma; neither exists on the edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // `next build` bootstraps a server to prerender pages. Touching the database
  // there would make the build depend on one, which it currently does not.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { bootstrapOnce } = await import('@/lib/engine/bootstrap');
  await bootstrapOnce();
}
