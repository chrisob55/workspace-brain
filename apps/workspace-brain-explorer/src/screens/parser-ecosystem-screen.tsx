import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Boxes, CheckCircle2, Hourglass, Puzzle } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { KeyMessage, ScreenHeader, SectionTitle } from '@/components/story';
import {
  CURRENT_PACKS,
  FUTURE_PACKS,
  packContributions,
  type PackContribution,
  type ParserPack,
} from '@/lib/parser-packs';
import { cn, formatNumber } from '@/lib/utils';

type PackNodeData = {
  pack: ParserPack;
  contribution?: PackContribution | undefined;
  side: 'left' | 'right';
  selected: boolean;
};
type HubNodeData = { entities: number; relationships: number; version: number };

const PackNode = memo(function PackNode({
  data,
}: NodeProps<Node<PackNodeData>>) {
  const future = data.pack.status === 'future';
  return (
    <div
      className={cn(
        'w-[280px] rounded-xl border bg-card px-3.5 py-2.5 shadow-sm transition-all hover:shadow-lg',
        future && 'border-dashed bg-card/60',
      )}
      style={{
        borderColor: data.selected
          ? data.pack.color
          : future
            ? undefined
            : `${data.pack.color}88`,
        boxShadow: data.selected
          ? `0 0 0 2px ${data.pack.color}66, 0 10px 30px -12px ${data.pack.color}`
          : undefined,
      }}
    >
      <Handle
        type="source"
        position={data.side === 'left' ? Position.Right : Position.Left}
        className="!size-1.5 !border-0 !bg-transparent"
      />
      <div className="flex items-center gap-2">
        <Puzzle className="size-4" style={{ color: data.pack.color }} />
        <span className="min-w-0 truncate font-semibold">{data.pack.name}</span>
        <span
          className={cn(
            'ml-auto rounded-full px-1.5 text-[10px] font-medium uppercase tracking-wider',
            future
              ? 'bg-muted text-muted-foreground'
              : 'bg-emerald-500/15 text-emerald-500',
          )}
        >
          {future ? 'planned' : 'live'}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">
        {data.contribution
          ? `${formatNumber(data.contribution.entities)} entities · ${formatNumber(data.contribution.relationships)} relationships`
          : data.pack.produces.join(' · ')}
      </div>
    </div>
  );
});

const HubNode = memo(function HubNode({ data }: NodeProps<Node<HubNodeData>>) {
  return (
    <div className="relative flex w-[260px] flex-col items-center gap-2 rounded-3xl border-2 border-primary bg-card px-5 py-6 text-center shadow-2xl">
      <div className="absolute -inset-3 -z-10 animate-glow rounded-[2rem] bg-primary/20 blur-2xl" />
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1.5 !border-0 !bg-transparent"
      />
      <Handle
        id="right"
        type="target"
        position={Position.Right}
        className="!size-1.5 !border-0 !bg-transparent"
      />
      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
        <Boxes className="size-6" />
      </span>
      <div className="text-base font-semibold leading-tight">
        Workspace Brain Knowledge Model
      </div>
      <div className="text-xs text-muted-foreground">
        v{data.version} · {formatNumber(data.entities)} entities ·{' '}
        {formatNumber(data.relationships)} relationships
      </div>
    </div>
  );
});

const nodeTypes = { pack: PackNode, hub: HubNode };

function EcosystemCanvas({
  contributions,
  showFuture,
  selectedId,
  onSelect,
}: {
  contributions: PackContribution[];
  showFuture: boolean;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const { graph } = useKnowledgeState();
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [
      {
        id: 'hub',
        type: 'hub',
        position: { x: 0, y: -60 },
        data: {
          entities: graph.meta.entityCount,
          relationships: graph.meta.relationshipCount,
          version: graph.meta.version,
        },
        draggable: false,
      },
    ];
    const edges: Edge[] = [];
    const place = (packs: ParserPack[], side: 'left' | 'right') => {
      packs.forEach((pack, i) => {
        const y = (i - (packs.length - 1) / 2) * 104 - 10;
        const x = side === 'left' ? -400 : 380;
        nodes.push({
          id: pack.id,
          type: 'pack',
          position: { x, y },
          data: {
            pack,
            contribution: contributions.find((c) => c.pack.id === pack.id),
            side,
            selected: pack.id === selectedId,
          },
        });
        const future = pack.status === 'future';
        edges.push({
          id: `e:${pack.id}`,
          source: pack.id,
          target: 'hub',
          ...(side === 'right' ? { targetHandle: 'right' } : {}),
          animated: !future,
          style: {
            stroke: pack.color,
            strokeWidth: selectedId === pack.id ? 3 : 2,
            strokeDasharray: future ? '4 6' : undefined,
            opacity: future ? 0.55 : 0.9,
          },
        });
      });
    };
    place(CURRENT_PACKS, 'left');
    if (showFuture) place(FUTURE_PACKS, 'right');
    return { nodes, edges };
  }, [contributions, graph, selectedId, showFuture]);

  return (
    <ReactFlow
      key={showFuture ? 'future' : 'current'}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => node.type === 'pack' && onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      nodesDraggable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1.2}
        color="var(--canvas-dot)"
      />
    </ReactFlow>
  );
}

export function ParserEcosystemScreen() {
  const { graph } = useKnowledgeState();
  const contributions = useMemo(() => packContributions(graph), [graph]);
  const [showFuture, setShowFuture] = useState(true);
  const [selectedId, setSelectedId] = useState<string>();
  const pack = [...CURRENT_PACKS, ...FUTURE_PACKS].find(
    (p) => p.id === selectedId,
  );
  const contribution = contributions.find((c) => c.pack.id === selectedId);

  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Parser Ecosystem"
        title="Workspace Brain learns organisations through parser packs"
        lead="Each pack is a set of independently registered, versioned extractors. They all emit the same controlled vocabulary, so every pack feeds one Knowledge Model."
      >
        <div className="flex gap-1 rounded-lg border bg-card p-1 text-sm">
          <button
            type="button"
            onClick={() => setShowFuture(false)}
            className={cn(
              'rounded-md px-3 py-1',
              !showFuture
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground',
            )}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setShowFuture(true)}
            className={cn(
              'rounded-md px-3 py-1',
              showFuture
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground',
            )}
          >
            Today + planned
          </button>
        </div>
      </ScreenHeader>

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="h-[540px] overflow-hidden rounded-2xl border bg-card/40">
          <ReactFlowProvider>
            <EcosystemCanvas
              contributions={contributions}
              showFuture={showFuture}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </ReactFlowProvider>
        </div>
        <aside className="rounded-2xl border bg-card p-5">
          {pack ? (
            <div key={pack.id} className="animate-fade-up space-y-4">
              <div className="flex items-center gap-2">
                <Puzzle className="size-5" style={{ color: pack.color }} />
                <h3 className="text-lg font-semibold">{pack.name}</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                {pack.description}
              </p>
              {contribution ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      ['Entities', contribution.entities],
                      ['Relations', contribution.relationships],
                      ['Evidence', contribution.evidence],
                    ].map(([label, value]) => (
                      <div
                        key={label as string}
                        className="rounded-lg bg-muted p-2"
                      >
                        <div className="text-lg font-semibold tabular-nums">
                          {formatNumber(value as number)}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Extractors in this publication
                    </div>
                    <ul className="space-y-1">
                      {contribution.extractorIds.map((id) => (
                        <li
                          key={id}
                          className="flex items-center gap-1.5 font-mono text-xs"
                        >
                          <CheckCircle2 className="size-3.5 text-emerald-500" />{' '}
                          {id}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <p className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  <Hourglass className="size-4" /> Planned. Adding it needs a
                  registration and tests — not a redesign.
                </p>
              )}
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Produces
                </div>
                <div className="flex flex-wrap gap-1">
                  {pack.produces.map((p) => (
                    <span
                      key={p}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                Select a parser pack
              </p>
              <p>
                Live packs show exactly how many published facts their
                extractors support.
              </p>
            </div>
          )}
        </aside>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle>The plug-in contract (ADR-026)</SectionTitle>
          <pre className="overflow-x-auto rounded-xl border bg-card p-4 font-mono text-xs leading-relaxed">
            <span className="text-muted-foreground">
              {'// a pure, deterministic plug-in'}
            </span>
            {`
type KnowledgeExtractor = {
  id: string;        `}
            <span className="text-muted-foreground">
              {'// e.g. "openapi-operations"'}
            </span>
            {`
  version: number;   `}
            <span className="text-muted-foreground">
              {'// recorded in every provenance record'}
            </span>
            {`
  stage?: number;    `}
            <span className="text-muted-foreground">
              {'// later stages may use earlier candidates'}
            </span>
            {`
  supports(evidence): boolean;
  extract(evidence, candidates?): { entities, relationships };
};`}
          </pre>
        </div>
        <div>
          <SectionTitle>Why packs scale</SectionTitle>
          <ul className="space-y-2 text-sm">
            {[
              'Packs are registered, not hard-wired: a staged registry runs them in a deterministic order.',
              'Every fact a pack emits carries its extractor ID and version as provenance.',
              'Packs share one vocabulary, so knowledge from different stacks is comparable.',
              'No AI and no inference from prose or folder names — only explicit evidence.',
            ].map((text) => (
              <li
                key={text}
                className="flex gap-2 rounded-lg border bg-card p-3"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <KeyMessage>
        Workspace Brain learns organisations through parser packs.
      </KeyMessage>
    </div>
  );
}
