/** Small helpers shared by the route handlers. */

import { NextResponse } from 'next/server';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { status: 200, ...init });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Wraps a handler so a thrown error becomes a clean 4xx/5xx, never a stack. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    // Engine pre-conditions ("… is PAUSED, not RUNNING") are client errors.
    const status = /unknown|not found/i.test(message)
      ? 404
      : /cannot|not RUNNING|is (PAUSED|STOPPED|COMPLETED|CREATED)/i.test(message)
        ? 409
        : 500;
    if (status === 500) console.error('[api]', error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
