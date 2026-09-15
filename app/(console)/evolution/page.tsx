import Link from 'next/link';
import { EmptyState, PageHeader, Panel } from '@/components/ui';
import { FamilyTree } from '@/components/family-tree';
import { getActiveSimulation, getFamilyTree } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Evolution' };

export default async function EvolutionPage({
  searchParams,
}: {
  searchParams: Promise<{ simulationId?: string }>;
}) {
  const { simulationId } = await searchParams;
  const simulation = await getActiveSimulation(simulationId);
  const roots = simulation ? await getFamilyTree(simulation.id) : [];

  if (!simulation || roots.length === 0) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-10">
        <PageHeader eyebrow="Family tree" title="Evolution" />
        <div className="mt-8">
          <EmptyState
            title="No lineage yet"
            description="The tree fills in as agents reproduce. Founders appear at the root; each clone hangs beneath its parent."
            action={
              <Link href="/simulation" className="btn btn-primary mt-2">
                Start simulation
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const count = (nodes: typeof roots): number =>
    nodes.reduce((sum, node) => sum + 1 + count(node.children), 0);

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <PageHeader
        eyebrow={`${count(roots)} agents · ${roots.length} founding ${roots.length === 1 ? 'line' : 'lines'}`}
        title="Evolution"
        description="The full lineage. A line that ends in red died out; a line that keeps branching found something that works."
      />

      <Panel className="mt-8" bodyClassName="overflow-x-auto p-6">
        <FamilyTree roots={roots} />
      </Panel>
    </div>
  );
}
