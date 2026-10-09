import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
} from '@xyflow/react';
import { Info } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { EntityChip, RelationshipPill } from '@/components/chips';
import { EvidencePanel } from '@/components/evidence-panel';
import {
  layoutGraph,
  nodeTypes,
  relationshipEdge,
  type EntityFlowNode,
} from '@/components/flow';
import { KeyMessage, ScreenHeader, SectionTitle } from '@/components/story';
import { displayPath, repositoryOfEntity } from '@/lib/knowledge-graph';
import type { KnowledgeEntity, KnowledgeRelationship } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Decision {
  entity: KnowledgeEntity;
  repository: string;
  referencedBy: KnowledgeRelationship[];
}

function documentLabel(entity: KnowledgeEntity): string {
  const path = entity.provenance[0]
    ? displayPath(entity.provenance[0].documentPath)
    : entity.name;
  return path.split('/').slice(1).join('/') || entity.name;
}

function AdrGraph({
  decisions,
  selectedId,
  onSelect,
}: {
  decisions: Decision[];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const { graph } = useKnowledgeState();
  const { nodes, edges } = useMemo(() => {
    const rels = decisions.flatMap((d) => d.referencedBy);
    const ids = new Set<string>();
    for (const rel of rels) {
      ids.add(rel.sourceEntityId);
      ids.add(rel.targetEntityId);
    }
    for (const d of decisions) ids.add(d.entity.id);
    const focus = new Set<string>();
    if (selectedId) {
      focus.add(selectedId);
      for (const rel of rels) {
        if (
          rel.targetEntityId === selectedId ||
          rel.sourceEntityId === selectedId
        ) {
          focus.add(rel.sourceEntityId);
          focus.add(rel.targetEntityId);
        }
      }
    }
    const raw: EntityFlowNode[] = [...ids].flatMap((id) => {
      const entity = graph.entityById.get(id);
      if (!entity) return [];
      return [
        {
          id,
          type: 'entity' as const,
          position: { x: 0, y: 0 },
          data: {
            entity,
            label:
              entity.type === 'document' ? documentLabel(entity) : entity.name,
            focus: id === selectedId,
            dimmed: selectedId !== undefined && !focus.has(id),
          },
        },
      ];
    });
    const edges: Edge[] = rels.map((rel) => {
      const touches =
        rel.targetEntityId === selectedId || rel.sourceEntityId === selectedId;
      return relationshipEdge(rel, {
        dimmed: selectedId !== undefined && !touches,
        animated: touches,
        selected: touches,
      });
    });
    return {
      nodes: layoutGraph(raw, edges, 'LR', { rank: 160, node: 10 }),
      edges,
    };
  }, [decisions, graph, selectedId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      fitView
      fitViewOptions={{ padding: 0.1 }}
      minZoom={0.1}
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

export function AdrScreen() {
  const { graph } = useKnowledgeState();
  const decisions = useMemo<Decision[]>(() => {
    return graph.entities
      .filter((e) => e.type === 'architectural-decision')
      .map((entity) => ({
        entity,
        repository: repositoryOfEntity(entity),
        referencedBy: graph.relationships.filter(
          (r) => r.type === 'REFERENCES' && r.targetEntityId === entity.id,
        ),
      }))
      .sort((a, b) =>
        a.entity.name.localeCompare(b.entity.name, 'en', { numeric: true }),
      );
  }, [graph]);
  const repositories = useMemo(
    () => [...new Set(decisions.map((d) => d.repository))].sort(),
    [decisions],
  );
  const [repository, setRepository] = useState(() =>
    repositories.includes('workspace-brain')
      ? 'workspace-brain'
      : (repositories[0] ?? ''),
  );
  const scoped = decisions.filter((d) => d.repository === repository);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () =>
      decisions.find(
        (d) =>
          d.entity.name === 'ADR-026' && d.repository === 'workspace-brain',
      )?.entity.id,
  );
  const selected = decisions.find((d) => d.entity.id === selectedId);
  const selectedEntity = selectedId
    ? graph.entityById.get(selectedId)
    : undefined;
  const maxRefs = Math.max(1, ...scoped.map((d) => d.referencedBy.length));

  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Architecture Decisions"
        title="Decisions become first-class knowledge"
        lead="The architectural-decisions extractor recognises explicit ADR metadata; markdown-references records each actual link to an ADR. Decisions are now entities you can search, trace and explore."
      >
        <div className="flex gap-1 rounded-lg border bg-card p-1">
          {repositories.map((repo) => (
            <button
              key={repo}
              type="button"
              onClick={() => {
                setRepository(repo);
                setSelectedId(undefined);
              }}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                repo === repository
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {repo}{' '}
              <span className="text-xs opacity-75">
                {decisions.filter((d) => d.repository === repo).length}
              </span>
            </button>
          ))}
        </div>
      </ScreenHeader>

      <section>
        <SectionTitle
          aside={
            <span className="text-xs text-muted-foreground">
              Shade = how often each decision is referenced
            </span>
          }
        >
          Decision record
        </SectionTitle>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-[repeat(13,minmax(0,1fr))]">
          {scoped.map((d, i) => {
            const active = d.entity.id === selectedId;
            const intensity = d.referencedBy.length / maxRefs;
            return (
              <button
                key={d.entity.id}
                type="button"
                onClick={() => setSelectedId(d.entity.id)}
                style={{
                  animationDelay: `${i * 20}ms`,
                  background: `color-mix(in oklch, #f472b6 ${Math.round(8 + intensity * 40)}%, var(--card))`,
                  boxShadow: active ? '0 0 0 2px #f472b6' : undefined,
                }}
                className="animate-fade-up rounded-lg border px-1 py-2 text-center transition-transform hover:-translate-y-0.5"
              >
                <div className="font-mono text-xs font-semibold">
                  {d.entity.name.replace('ADR-', '')}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {d.referencedBy.length} refs
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <div className="h-[560px] overflow-hidden rounded-2xl border bg-card/40">
          <ReactFlowProvider key={repository}>
            <AdrGraph
              decisions={scoped}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </ReactFlowProvider>
        </div>
        <aside className="rounded-2xl border bg-card p-4 xl:max-h-[560px] xl:overflow-y-auto">
          {selectedEntity ? (
            <div key={selectedEntity.id} className="animate-fade-up space-y-4">
              <EntityChip entity={selectedEntity} size="lg" />
              {selected ? (
                <>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Referenced by {selected.referencedBy.length} documents
                    </h3>
                    <ul className="space-y-1">
                      {selected.referencedBy.map((rel) => {
                        const doc = graph.entityById.get(rel.sourceEntityId);
                        return doc ? (
                          <li
                            key={rel.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <RelationshipPill
                              type="REFERENCES"
                              className="!px-1.5"
                            />
                            <button
                              type="button"
                              className="truncate font-mono hover:underline"
                              onClick={() => setSelectedId(doc.id)}
                            >
                              {documentLabel(doc)}
                            </button>
                          </li>
                        ) : null;
                      })}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Why this decision is known
                    </h3>
                    <EvidencePanel
                      provenance={selectedEntity.provenance}
                      compact
                    />
                  </div>
                </>
              ) : (
                <EvidencePanel provenance={selectedEntity.provenance} compact />
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a decision or document to see its references and evidence.
            </p>
          )}
        </aside>
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          Only explicit links are published. A decision that mentions another
          ADR in prose (for example ADR-026 citing ADR-025) does not create a
          REFERENCES relationship until it links to it — Workspace Brain does
          not infer relationships from free text.
        </p>
      </div>

      <KeyMessage>
        Architectural decisions become first-class Knowledge Model entities.
      </KeyMessage>
    </div>
  );
}
