import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import { Expand, RotateCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { EntityChip, RelationshipPill } from '@/components/chips';
import { EvidencePanel } from '@/components/evidence-panel';
import {
  layoutGraph,
  nodeTypes,
  relationshipEdge,
  type EntityFlowNode,
} from '@/components/flow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  neighbours,
  RELATIONSHIP_TYPES,
  repositoryOfEntity,
  searchEntities,
  shortName,
  type KnowledgeGraph,
} from '@/lib/knowledge-graph';
import { ENTITY_STYLE, entityStyle, RELATIONSHIP_STYLE } from '@/lib/palette';
import type {
  KnowledgeEntity,
  KnowledgeRelationship,
  RelationshipType,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const EXPAND_BATCH = 12;
const TYPE_ORDER: RelationshipType[] = [
  'CONTAINS',
  'EXPOSES',
  'REFERENCES',
  'DEPENDS_ON',
];

type Selection = { kind: 'node' | 'edge'; id: string } | null;

function otherEnd(rel: KnowledgeRelationship, id: string) {
  return rel.sourceEntityId === id ? rel.targetEntityId : rel.sourceEntityId;
}

function findSeed(graph: KnowledgeGraph): KnowledgeEntity | undefined {
  return (
    graph.entities.find(
      (e) =>
        e.type === 'document' &&
        e.name === 'README.md' &&
        e.provenance.some((p) =>
          p.documentPath.endsWith('/workspace-brain/README.md'),
        ),
    ) ??
    graph.entities.find((e) => e.type === 'repository') ??
    graph.entities[0]
  );
}

function Explorer() {
  const { graph } = useKnowledgeState();
  const flow = useReactFlow();
  const seed = useMemo(() => findSeed(graph), [graph]);
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(seed ? [seed.id] : []),
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [filters, setFilters] = useState<Set<RelationshipType>>(
    () => new Set(RELATIONSHIP_TYPES),
  );
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<string>>(() => new Set());
  const [nodes, setNodes, onNodesChange] = useNodesState<EntityFlowNode>([]);

  const expand = useCallback(
    (id: string, current: Set<string>): Set<string> => {
      const next = new Set(current);
      next.add(id);
      const candidates = neighbours(graph, id, filters)
        .filter((rel) => !current.has(otherEnd(rel, id)))
        .sort(
          (a, b) =>
            TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
            (graph.entityById.get(otherEnd(a, id))?.name ?? '').localeCompare(
              graph.entityById.get(otherEnd(b, id))?.name ?? '',
            ),
        );
      for (const rel of candidates.slice(0, EXPAND_BATCH))
        next.add(otherEnd(rel, id));
      return next;
    },
    [graph, filters],
  );

  useEffect(() => {
    if (seed) setVisible(expand(seed.id, new Set([seed.id])));
    // Seed once per publication.
  }, [seed]);

  const visibleEdges = useMemo(
    () =>
      graph.relationships.filter(
        (rel) =>
          filters.has(rel.type) &&
          visible.has(rel.sourceEntityId) &&
          visible.has(rel.targetEntityId),
      ),
    [graph, visible, filters],
  );

  const selectedNodeId = selection?.kind === 'node' ? selection.id : undefined;
  const selectedEdge =
    selection?.kind === 'edge'
      ? graph.relationshipById.get(selection.id)
      : undefined;

  const highlight = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const ids = new Set([selectedNodeId]);
    for (const rel of visibleEdges) {
      if (
        rel.sourceEntityId === selectedNodeId ||
        rel.targetEntityId === selectedNodeId
      ) {
        ids.add(rel.sourceEntityId);
        ids.add(rel.targetEntityId);
      }
    }
    return ids;
  }, [selectedNodeId, visibleEdges]);

  const edges: Edge[] = useMemo(
    () =>
      visibleEdges.map((rel) => {
        const touches =
          !!selectedNodeId &&
          (rel.sourceEntityId === selectedNodeId ||
            rel.targetEntityId === selectedNodeId);
        return relationshipEdge(rel, {
          selected: selectedEdge?.id === rel.id,
          dimmed:
            (!!selectedNodeId && !touches) ||
            (!!selectedEdge && selectedEdge.id !== rel.id),
          animated: touches || selectedEdge?.id === rel.id,
          showLabel: touches || selectedEdge?.id === rel.id,
        });
      }),
    [visibleEdges, selectedNodeId, selectedEdge],
  );

  const layoutKey = useMemo(
    () => [...visible].sort().join(',') + '|' + [...filters].sort().join(','),
    [visible, filters],
  );

  useEffect(() => {
    const raw: EntityFlowNode[] = [...visible].flatMap((id) => {
      const entity = graph.entityById.get(id);
      if (!entity) return [];
      const hidden = neighbours(graph, id, filters).filter(
        (rel) => !visible.has(otherEnd(rel, id)),
      ).length;
      return [
        {
          id,
          type: 'entity' as const,
          position: { x: 0, y: 0 },
          data: { entity, hiddenNeighbours: hidden },
        },
      ];
    });
    const laidOut = layoutGraph(
      raw,
      visibleEdges.map((rel) => relationshipEdge(rel)),
      'LR',
      { rank: 110, node: 16 },
    );
    setNodes(laidOut);
    const timer = window.setTimeout(
      () => void flow.fitView({ duration: 500, padding: 0.15 }),
      30,
    );
    return () => window.clearTimeout(timer);
    // Re-layout only when the visible set changes, not on selection.
  }, [layoutKey]);

  const styledNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          dimmed: highlight ? !highlight.has(node.id) : false,
          focus: node.id === selectedNodeId,
        },
      })),
    [nodes, highlight, selectedNodeId],
  );

  const focusEntity = useCallback(
    (id: string) => {
      setVisible((current) => expand(id, current));
      setSelection({ kind: 'node', id });
    },
    [expand],
  );

  const reset = () => {
    if (seed) setVisible(expand(seed.id, new Set([seed.id])));
    setSelection(null);
  };

  const results = useMemo(
    () => searchEntities(graph, query, typeFilter, 60),
    [graph, query, typeFilter],
  );

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex max-h-[40%] shrink-0 flex-col border-b md:max-h-none md:w-80 md:border-b-0 md:border-r">
        <div className="space-y-3 border-b p-4">
          <div>
            <h1 className="text-lg font-semibold">Knowledge Graph</h1>
            <p className="text-xs text-muted-foreground">
              Search published entities. Select a node to expand its
              relationships.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search entities… e.g. ADR-026, domain"
              className="pl-8"
              aria-label="Search entities"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(ENTITY_STYLE).map(([type, style]) => {
              const on = typeFilter.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    setTypeFilter((current) => {
                      const next = new Set(current);
                      if (on) next.delete(type);
                      else next.add(type);
                      return next;
                    })
                  }
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                    on
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  style={
                    on
                      ? {
                          borderColor: style.color,
                          background: `${style.color}22`,
                        }
                      : undefined
                  }
                >
                  {style.label}
                </button>
              );
            })}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.map((entity) => (
            <li key={entity.id}>
              <button
                type="button"
                onClick={() => focusEntity(entity.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                  visible.has(entity.id) && 'font-medium',
                )}
              >
                {(() => {
                  const style = entityStyle(entity.type);
                  const Icon = style.icon;
                  return (
                    <Icon
                      className="size-4 shrink-0"
                      style={{ color: style.color }}
                    />
                  );
                })()}
                <span className="min-w-0 flex-1 truncate" title={entity.name}>
                  {shortName(entity)}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {repositoryOfEntity(entity)}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">
              No published entities match.
            </li>
          )}
        </ul>
      </aside>

      <div className="relative min-h-[320px] min-w-0 flex-1">
        <ReactFlow
          nodes={styledNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => focusEntity(node.id)}
          onEdgeClick={(_, edge) => setSelection({ kind: 'edge', id: edge.id })}
          onPaneClick={() => setSelection(null)}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
          fitView
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.2}
            color="var(--canvas-dot)"
          />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            className="!hidden lg:!block"
            nodeColor={(node) =>
              entityStyle(
                (node.data as { entity: KnowledgeEntity }).entity.type,
              ).color
            }
            maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
          />
        </ReactFlow>

        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5 rounded-xl border bg-card/90 p-1.5 shadow-sm backdrop-blur">
          {RELATIONSHIP_TYPES.map((type) => {
            const on = filters.has(type);
            const color = RELATIONSHIP_STYLE[type].color;
            return (
              <button
                key={type}
                type="button"
                onClick={() =>
                  setFilters((current) => {
                    const next = new Set(current);
                    if (on) next.delete(type);
                    else next.add(type);
                    return next;
                  })
                }
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[11px] font-semibold transition-opacity',
                  !on && 'opacity-40',
                )}
                style={{ color }}
                aria-pressed={on}
                title={RELATIONSHIP_STYLE[type].description}
              >
                <span
                  className="h-0.5 w-4 rounded"
                  style={{ background: color }}
                />
                {type}
              </button>
            );
          })}
          <span className="mx-1 h-5 w-px bg-border" />
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw /> Reset
          </Button>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border bg-card/90 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {visible.size} of {graph.entities.length} entities ·{' '}
          {visibleEdges.length} relationships shown
        </div>
      </div>

      {selection && (
        <aside className="animate-fade-up flex max-h-[50%] shrink-0 flex-col border-t md:max-h-none md:w-[24rem] md:border-l md:border-t-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {selection.kind === 'node' ? 'Entity' : 'Relationship'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelection(null)}
              aria-label="Close details"
            >
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selection.kind === 'node' ? (
              <EntityDetails
                entityId={selection.id}
                visible={visible}
                onFocus={focusEntity}
                onExpand={() =>
                  setVisible((current) => expand(selection.id, current))
                }
                filters={filters}
              />
            ) : selectedEdge ? (
              <RelationshipDetails rel={selectedEdge} onFocus={focusEntity} />
            ) : null}
          </div>
        </aside>
      )}
    </div>
  );
}

function EntityDetails({
  entityId,
  visible,
  onFocus,
  onExpand,
  filters,
}: {
  entityId: string;
  visible: Set<string>;
  onFocus: (id: string) => void;
  onExpand: () => void;
  filters: Set<RelationshipType>;
}) {
  const { graph } = useKnowledgeState();
  const entity = graph.entityById.get(entityId);
  if (!entity) return null;
  const rels = neighbours(graph, entityId, filters);
  const hidden = rels.filter(
    (rel) => !visible.has(otherEnd(rel, entityId)),
  ).length;
  const grouped = TYPE_ORDER.map((type) => ({
    type,
    outgoing: rels.filter(
      (r) => r.type === type && r.sourceEntityId === entityId,
    ),
    incoming: rels.filter(
      (r) => r.type === type && r.targetEntityId === entityId,
    ),
  })).filter((g) => g.outgoing.length + g.incoming.length > 0);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <EntityChip
          entity={entity}
          size="lg"
          label={shortName(entity)}
          className="max-w-full"
        />
        <p className="break-all font-mono text-xs text-muted-foreground">
          {entity.name}
        </p>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded bg-muted px-2 py-0.5">
            repo: {repositoryOfEntity(entity)}
          </span>
          <span className="rounded bg-muted px-2 py-0.5">
            {entity.lifecycleStatus}
          </span>
          <span className="rounded bg-muted px-2 py-0.5">
            {entity.provenance.length} evidence
          </span>
        </div>
        {hidden > 0 && (
          <Button size="sm" variant="outline" onClick={onExpand}>
            <Expand /> Show {Math.min(hidden, EXPAND_BATCH)} more of {hidden}{' '}
            hidden
          </Button>
        )}
      </div>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Relationships
        </h3>
        {grouped.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No relationships with the active filters.
          </p>
        )}
        {grouped.map((group) => (
          <div key={group.type} className="space-y-1.5">
            <RelationshipPill
              type={group.type}
              count={group.outgoing.length + group.incoming.length}
            />
            <ul className="space-y-0.5">
              {[...group.outgoing, ...group.incoming].slice(0, 8).map((rel) => {
                const other = graph.entityById.get(otherEnd(rel, entityId));
                if (!other) return null;
                const outgoing = rel.sourceEntityId === entityId;
                return (
                  <li key={rel.id}>
                    <button
                      type="button"
                      onClick={() => onFocus(other.id)}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
                    >
                      <span className="w-6 shrink-0 text-muted-foreground">
                        {outgoing ? '→' : '←'}
                      </span>
                      <span className="truncate" title={other.name}>
                        {shortName(other)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {group.outgoing.length + group.incoming.length > 8 && (
                <li className="px-1.5 text-xs text-muted-foreground">
                  +{group.outgoing.length + group.incoming.length - 8} more
                </li>
              )}
            </ul>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Why this entity exists
        </h3>
        <EvidencePanel key={entity.id} provenance={entity.provenance} compact />
      </section>
    </div>
  );
}

function RelationshipDetails({
  rel,
  onFocus,
}: {
  rel: KnowledgeRelationship;
  onFocus: (id: string) => void;
}) {
  const { graph } = useKnowledgeState();
  const source = graph.entityById.get(rel.sourceEntityId);
  const target = graph.entityById.get(rel.targetEntityId);
  if (!source || !target) return null;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onFocus(source.id)}
          className="block max-w-full"
        >
          <EntityChip
            entity={source}
            label={shortName(source)}
            className="max-w-full"
          />
        </button>
        <div className="pl-4">
          <RelationshipPill type={rel.type} />
        </div>
        <button
          type="button"
          onClick={() => onFocus(target.id)}
          className="block max-w-full"
        >
          <EntityChip
            entity={target}
            label={shortName(target)}
            className="max-w-full"
          />
        </button>
        <p className="text-sm text-muted-foreground">
          {RELATIONSHIP_STYLE[rel.type].description}
        </p>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded bg-muted px-2 py-0.5">
            confidence {rel.confidence}
          </span>
          <span className="rounded bg-muted px-2 py-0.5">
            {rel.lifecycleStatus}
          </span>
          <span className="rounded bg-muted px-2 py-0.5">
            {rel.provenance.length} evidence
          </span>
        </div>
      </div>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Evidence
        </h3>
        <EvidencePanel key={rel.id} provenance={rel.provenance} compact />
      </section>
    </div>
  );
}

export function GraphExplorerScreen() {
  return (
    <ReactFlowProvider>
      <Explorer />
    </ReactFlowProvider>
  );
}
