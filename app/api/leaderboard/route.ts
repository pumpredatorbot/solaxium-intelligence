import { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { getActiveSimulation, getLeaderboard, type LeaderboardCategory } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CATEGORIES: LeaderboardCategory[] = [
  'MOST_PROFITABLE',
  'HIGHEST_CAPITAL',
  'LONGEST_SURVIVAL',
  'MOST_CLONES',
  'BEST_ROI',
];

export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const scope = params.get('scope') ?? 'CURRENT';
    const raw = params.get('category') ?? 'MOST_PROFITABLE';
    const category = (
      CATEGORIES.includes(raw as LeaderboardCategory) ? raw : 'MOST_PROFITABLE'
    ) as LeaderboardCategory;

    const simulation = await getActiveSimulation(params.get('simulationId'));
    // ALL_TIME spans every simulation ever run; CURRENT is scoped to this one.
    const simulationId = scope === 'ALL_TIME' ? null : (simulation?.id ?? null);
    if (scope !== 'ALL_TIME' && !simulationId) return { entries: [], category, simulation: null };

    const generationParam = params.get('generation');

    return {
      category,
      scope,
      simulation,
      entries: await getLeaderboard(simulationId, category, {
        generation: generationParam !== null ? Number(generationParam) : undefined,
        limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      }),
    };
  });
}
