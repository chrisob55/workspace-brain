import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { FileJson, GitFork, Microscope, Plug, Workflow } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { EntityChip, RelationshipPill } from '@/components/chips';
import { EvidencePanel } from '@/components/evidence-panel';
import { Pipeline } from '@/components/pipeline';
import { KeyMessage, ScreenHeader } from '@/components/story';
import { displayPath } from '@/lib/knowledge-graph';
import { RELATIONSHIP_STYLE } from '@/lib/palette';
import type { KnowledgeEntity, KnowledgeRelationship } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Operation {
  entity: KnowledgeEntity;
  relationship: KnowledgeRelationship;
  method: string;
  path: string;
  group: string;
}

const METHOD_COLOR: Record<string, string> = {
  get: '#34d399',
  post: '#60a5fa',
  put: '#f59e0b',
  patch: '#f59e0b',
  delete: '#f87171',
};

const GROUPS: {
  id: string;
  label: string;
  match: (path: string) => boolean;
}[] = [
  { id: 'health', label: 'Health', match: (p) => !p.startsWith('/api/') },
  {
    id: 'inventory',
    label: 'Discovery & evidence',
    match: (p) =>
      /^\/api\/v1\/(sources|workspaces|repositories|documents|evidence)/.test(
        p,
      ),
  },
  {
    id: 'knowledge',
    label: 'Knowledge Models',
    match: (p) =>
      /^\/api\/v1\/knowledge\/(models|entities|relationships)/.test(p),
  },
  {
    id: 'publications',
    label: 'Publications, diffs & currency',
    match: (p) => /^\/api\/v1\/knowledge\/(publications|diffs)/.test(p),
  },
  {
    id: 'search',
    label: 'Search projection',
    match: (p) => p.startsWith('/api/v1/search'),
  },
];

/** Decodes `/paths/<escaped path>/<method>/operationId` JSON pointers. */
function routeFromPointer(
  pointer: string,
): { method: string; path: string } | undefined {
  const parts = pointer.split('/');
  if (parts[1] !== 'paths' || parts.length < 4) return undefined;
  const path = (parts[2] ?? '').replace(/~1/g, '/').replace(/~0/g, '~');
  return { method: parts[3] ?? 'get', path };
}

type ApiNodeType = Node<
  { entity: KnowledgeEntity; count: number; selected: boolean },
  'api'
>;
type GroupNodeType = Node<{ label: string; count: number }, 'group'>;
type OperationNodeType = Node<
  { op: Operation; selected: boolean; dimmed: boolean },
  'operation'
>;

const ApiNode = memo(function ApiNode({ data }: NodeProps<ApiNodeType>) {
  return (
    <div
      className="flex w-[300px] items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3 shadow-lg"
      style={{ borderColor: '#f59e0b', boxShadow: '0 10px 40px -12px #f59e0b' }}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
        <Plug className="size-5" />
      </span>
      <div>
        <div className="font-semibold">{data.entity.name}</div>
        <div className="text-xs text-muted-foreground">
          API · exposes {data.count} operations
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-1.5 !border-0 !bg-transparent"
      />
    </div>
  );
});

const GroupNode = memo(function GroupNode({ data }: NodeProps<GroupNodeType>) {
  return (
    <div className="w-[250px] border-b pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Handle
        type="target"
        position={Position.Top}
        className="!size-1.5 !border-0 !bg-transparent"
      />
      {data.label} <span className="font-normal">· {data.count}</span>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-1.5 !border-0 !bg-transparent"
      />
    </div>
  );
});

const OperationNode = memo(function OperationNode({
  data,
}: NodeProps<OperationNodeType>) {
  const color = METHOD_COLOR[data.op.method] ?? '#94a3b8';
  return (
    <div
      className={cn(
        'w-[250px] rounded-lg border bg-card px-2.5 py-1.5 shadow-sm transition-all hover:shadow-md',
        data.dimmed && 'opacity-40',
      )}
      style={
        data.selected
          ? { borderColor: '#f59e0b', boxShadow: '0 0 0 2px #f59e0b66' }
          : undefined
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1.5 !border-0 !bg-transparent"
      />
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1 font-mono text-[9px] font-bold uppercase"
          style={{ color, background: `${color}22` }}
        >
          {data.op.method}
        </span>
        <span className="truncate text-[12px] font-medium">
          {data.op.entity.name}
        </span>
      </div>
      <div
        className="truncate font-mono text-[10px] text-muted-foreground"
        title={data.op.path}
      >
        {data.op.path}
      </div>
    </div>
  );
});

const nodeTypes = { api: ApiNode, group: GroupNode, operation: OperationNode };

function useOperations() {
  const { graph } = useKnowledgeState();
  return useMemo(() => {
    const api =
      graph.entities.find(
        (e) => e.type === 'api' && e.name === 'Workspace Brain API',
      ) ??
      graph.entities.find(
        (e) =>
          e.type === 'api' &&
          graph.relationships.some(
            (r) => r.type === 'EXPOSES' && r.sourceEntityId === e.id,
          ),
      );
    if (!api) return { api: undefined, operations: [] as Operation[] };
    const operations: Operation[] = graph.relationships
      .filter((r) => r.type === 'EXPOSES' && r.sourceEntityId === api.id)
      .flatMap((relationship) => {
        const entity = graph.entityById.get(relationship.targetEntityId);
        if (!entity) return [];
        const pointer = [...entity.provenance, ...relationship.provenance]
          .map((p) =>
            p.locator.kind === 'json-pointer' ? p.locator.pointer : '',
          )
          .find((p) => p.startsWith('/paths/'));
        const route = (pointer && routeFromPointer(pointer)) || {
          method: 'get',
          path: '?',
        };
        const group =
          GROUPS.find((g) => g.match(route.path))?.id ?? 'knowledge';
        return [{ entity, relationship, ...route, group }];
      })
      .sort(
        (a, b) =>
          a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
      );
    return { api, operations };
  }, [graph]);
}

function OpenApiCanvas({
  api,
  operations,
  selectedId,
  onSelect,
}: {
  api: KnowledgeEntity;
  operations: Operation[];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const columnWidth = 290;
    const groups = GROUPS.map((g) => ({
      ...g,
      ops: operations.filter((o) => o.group === g.id),
    })).filter((g) => g.ops.length > 0);
    const totalWidth = groups.length * columnWidth - 40;
    const nodes: Node[] = [
      {
        id: api.id,
        type: 'api',
        position: { x: totalWidth / 2 - 150, y: 0 },
        data: { entity: api, count: operations.length, selected: false },
        draggable: false,
      },
    ];
    const edges: Edge[] = [];
    const color = RELATIONSHIP_STYLE.EXPOSES.color;
    groups.forEach((group, column) => {
      const x = column * columnWidth;
      const groupId = `group:${group.id}`;
      nodes.push({
        id: groupId,
        type: 'group',
        position: { x, y: 150 },
        data: { label: group.label, count: group.ops.length },
        draggable: false,
        selectable: false,
      });
      edges.push({
        id: `e:${groupId}`,
        source: api.id,
        target: groupId,
        animated: true,
        style: { stroke: color, strokeWidth: 2 },
        label: 'EXPOSES',
        labelStyle: {
          fill: color,
          fontSize: 10,
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
        },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
      });
      group.ops.forEach((op, row) => {
        nodes.push({
          id: op.entity.id,
          type: 'operation',
          position: { x: x + 14, y: 190 + row * 58 },
          data: {
            op,
            selected: op.entity.id === selectedId,
            dimmed: selectedId !== undefined && op.entity.id !== selectedId,
          },
        });
      });
    });
    return { nodes, edges };
  }, [api, operations, selectedId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => node.type === 'operation' && onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      nodesDraggable={false}
      fitView
      fitViewOptions={{ padding: 0.08 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1.2}
        color="var(--canvas-dot)"
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function OpenApiScreen() {
  const { api, operations } = useOperations();
  const [selectedId, setSelectedId] = useState<string>();
  const [step, setStep] = useState<number>();
  const selected = operations.find((op) => op.entity.id === selectedId);

  const evidenceCount = useMemo(() => {
    const ids = new Set<string>();
    for (const op of operations) {
      for (const p of [...op.entity.provenance, ...op.relationship.provenance])
        ids.add(p.evidenceId);
    }
    return ids.size;
  }, [operations]);
  const contractPath = api?.provenance.find((p) =>
    p.documentPath.endsWith('.json'),
  )?.documentPath;

  if (!api) {
    return (
      <p className="text-muted-foreground">
        No API with EXPOSES relationships is published yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="OpenAPI Visualiser"
        title="OpenAPI contracts become knowledge"
        lead="The openapi-operations extractor reads an OpenAPI 3 contract and publishes one Operation entity per declared operation, each connected to its API by an evidence-backed EXPOSES relationship."
      />

      <Pipeline
        compact
        active={step}
        onSelect={setStep}
        steps={[
          {
            label: 'OpenAPI',
            caption: contractPath ? displayPath(contractPath) : 'openapi.json',
            icon: FileJson,
            color: '#22d3ee',
          },
          {
            label: 'Evidence',
            caption: `${evidenceCount} JSON-pointer fragments`,
            icon: Microscope,
            color: '#a78bfa',
          },
          {
            label: 'Operation entities',
            caption: `${operations.length} operations`,
            icon: Workflow,
            color: '#fbbf24',
          },
          {
            label: 'EXPOSES relationships',
            caption: `${operations.length} relationships`,
            icon: GitFork,
            color: RELATIONSHIP_STYLE.EXPOSES.color,
          },
        ]}
      />
      {step !== undefined && (
        <p className="animate-fade-up rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          {
            [
              'The contract is discovered like any other document: fingerprinted, versioned and read-only.',
              'The JSON processor emits structured values with JSON pointers such as /paths/~1api~1v1~1documents/get/operationId — exact, addressable evidence.',
              'Each operationId becomes an Operation entity. Names come from the contract, not from guesswork.',
              'The API entity EXPOSES each operation. Select any operation below to see the pointer that proves it.',
            ][step]
          }
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="h-[620px] overflow-hidden rounded-2xl border bg-card/40">
          <ReactFlowProvider>
            <OpenApiCanvas
              api={api}
              operations={operations}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </ReactFlowProvider>
        </div>
        <aside className="rounded-2xl border bg-card p-4 xl:max-h-[620px] xl:overflow-y-auto">
          {selected ? (
            <div key={selected.entity.id} className="animate-fade-up space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <EntityChip entity={api} size="sm" />
                <RelationshipPill type="EXPOSES" />
                <EntityChip entity={selected.entity} size="sm" />
              </div>
              <div className="rounded-lg bg-muted px-3 py-2 font-mono text-xs">
                <span
                  className="font-bold uppercase"
                  style={{ color: METHOD_COLOR[selected.method] }}
                >
                  {selected.method}
                </span>{' '}
                {selected.path}
              </div>
              <EvidencePanel
                provenance={selected.relationship.provenance}
                compact
              />
            </div>
          ) : (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Select an operation</p>
              <p>
                Each card is an Operation entity in the published Knowledge
                Model. Selecting one shows the JSON pointer into the contract
                that supports its EXPOSES relationship.
              </p>
              <ul className="space-y-1 font-mono text-xs">
                {[
                  'exportKnowledgePublication',
                  'getPublicationCurrency',
                  'getPublicationDiff',
                  'searchProjectedEntities',
                ]
                  .map((name) =>
                    operations.find((op) => op.entity.name === name),
                  )
                  .filter((op): op is Operation => op !== undefined)
                  .map((op) => (
                    <li key={op.entity.id}>
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => setSelectedId(op.entity.id)}
                      >
                        {op.entity.name}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <KeyMessage>OpenAPI contracts become knowledge.</KeyMessage>
    </div>
  );
}
