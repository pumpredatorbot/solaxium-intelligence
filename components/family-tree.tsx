import Link from 'next/link';
import type { TreeNode } from '@/lib/repo/queries';

/**
 * ASCII-style lineage tree.
 *
 * A force-directed graph looks impressive and reads badly; an indented tree
 * with box-drawing connectors shows parentage, depth and outcome at a glance
 * and stays readable at 200 agents.
 */
export function FamilyTree({ roots }: { roots: TreeNode[] }) {
  return (
    <div className="min-w-[640px] font-mono text-xs">
      {roots.map((root, index) => (
        <TreeBranch
          key={root.id}
          node={root}
          prefix=""
          isLast={index === roots.length - 1}
          isRoot
        />
      ))}
    </div>
  );
}

function TreeBranch({
  node,
  prefix,
  isLast,
  isRoot = false,
}: {
  node: TreeNode;
  prefix: string;
  isLast: boolean;
  isRoot?: boolean;
}) {
  const dead = node.status === 'DEAD';
  const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
  const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

  return (
    <div>
      <div className="group flex items-center whitespace-pre py-0.5 hover:bg-raised">
        <span className="text-line-strong">{prefix}</span>
        <span className="text-line-strong">{connector}</span>

        <Link
          href={`/agents/${node.id}`}
          className={`transition-colors ${dead ? 'text-ink-faint line-through decoration-danger/40' : 'text-ink hover:text-sol'}`}
        >
          {node.code}
        </Link>

        <span className="ml-3 text-ink-faint">G{node.generation}</span>

        <span className={`ml-3 text-2xs uppercase ${dead ? 'text-danger/70' : 'text-sol/80'}`}>
          {dead ? 'dead' : 'alive'}
        </span>

        <span className="tabular ml-3 text-ink-muted">{node.capitalSol.toFixed(3)} SOL</span>

        <span
          className={`tabular ml-3 ${node.profitSol >= 0 ? 'text-sol/70' : 'text-danger/70'}`}
        >
          {node.profitSol >= 0 ? '+' : ''}
          {node.profitSol.toFixed(3)}
        </span>

        <span className="ml-3 text-2xs text-ink-faint opacity-0 transition-opacity group-hover:opacity-100">
          {node.strategy}
        </span>
      </div>

      {node.children.map((child, index) => (
        <TreeBranch
          key={child.id}
          node={child}
          prefix={childPrefix}
          isLast={index === node.children.length - 1}
        />
      ))}
    </div>
  );
}
