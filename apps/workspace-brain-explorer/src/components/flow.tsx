import dagre from '@dagrejs/dagre';
import {
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { memo } from 'react';

import { shortName } from '@/lib/knowledge-graph';
import { entityStyle, RELATIONSHIP_STYLE } from '@/lib/palette';
import type { KnowledgeEntity, KnowledgeRelationship } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface EntityNodeData extends Record<string, unknown> {
  entity: KnowledgeEntity;
  label?: string;
  focus?: boolean;
  dimmed?: boolean;
  hiddenNeighbours?: number;
  direction?: 'LR' | 'TB';
}

export type EntityFlowNode = Node<EntityNodeData, 'entity'>;

export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 52;

export const EntityNode = memo(function EntityNode({
  data,
  selected,
}: NodeProps<EntityFlowNode>) {
  const style = entityStyle(data.entity.type);
  const Icon = style.icon;
  const vertical = data.direction === 'TB';
  return (
    <div
      className={cn(
        'group relative flex items-center gap-2.5 rounded-xl border bg-card px-3 shadow-sm transition-all',
        data.dimmed && 'opacity-35',
        (selected || data.focus) && 'shadow-lg',
      )}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        borderColor:
          selected || data.focus
            ? style.color
            : `color-mix(in oklch, ${style.color} 40%, var(--border))`,
        boxShadow:
          selected || data.focus
            ? `0 0 0 2px ${style.color}55, 0 10px 30px -10px ${style.color}`
            : undefined,
      }}
    >
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        className="!size-1.5 !border-0 !bg-transparent"
      />
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: `color-mix(in oklch, ${style.color} 18%, transparent)`,
          color: style.color,
        }}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span
          className="block truncate text-[13px] font-medium"
          title={data.entity.name}
        >
          {data.label ?? shortName(data.entity)}
        </span>
        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
          {style.label}
        </span>
      </span>
      {data.hiddenNeighbours ? (
        <span
          className="absolute -right-2 -top-2 rounded-full border bg-background px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground"
          title={`${data.hiddenNeighbours} more related entities — select to expand`}
        >
          +{data.hiddenNeighbours}
        </span>
      ) : null}
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        className="!size-1.5 !border-0 !bg-transparent"
      />
    </div>
  );
});

export const nodeTypes = { entity: EntityNode };

export function relationshipEdge(
  rel: KnowledgeRelationship,
  options: {
    selected?: boolean;
    dimmed?: boolean;
    animated?: boolean;
    showLabel?: boolean;
  } = {},
): Edge {
  const color = RELATIONSHIP_STYLE[rel.type].color;
  return {
    id: rel.id,
    source: rel.sourceEntityId,
    target: rel.targetEntityId,
    type: 'default',
    animated: options.animated ?? false,
    selected: options.selected ?? false,
    ...(options.showLabel ? { label: rel.type } : {}),
    labelStyle: {
      fontSize: 10,
      fontWeight: 600,
      fill: color,
      fontFamily: 'var(--font-mono)',
    },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    style: {
      stroke: color,
      strokeWidth: options.selected ? 3 : 1.6,
      opacity: options.dimmed ? 0.15 : 0.9,
    },
    interactionWidth: 18,
  };
}

/** Lays out nodes with dagre; positions are top-left for React Flow. */
export function layoutGraph<T extends Node>(
  nodes: T[],
  edges: Edge[],
  direction: 'LR' | 'TB' = 'LR',
  spacing: { rank?: number; node?: number } = {},
): T[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: spacing.rank ?? 90,
    nodesep: spacing.node ?? 18,
    marginx: 20,
    marginy: 20,
  });
  for (const node of nodes)
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target))
      g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);
  return nodes.map((node) => {
    const position = g.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
    };
  });
}
