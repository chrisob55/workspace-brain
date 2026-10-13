import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
} from '@xyflow/react';
import { Info } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { EntityChip } from '@/components/chips';
import { EvidencePanel } from '@/components/evidence-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  layoutGraph,
  nodeTypes,
  relationshipEdge,
  type EntityFlowNode,
} from '@/components/flow';
import { ScreenHeader } from '@/components/story';
import {
  collectDecisions,
  filterDecisions,
  type Decision,
} from '@/lib/decisions';
import { displayPath } from '@/lib/knowledge-graph';
import type { KnowledgeEntity, KnowledgeRelationship } from '@/lib/types';
import { cn } from '@/lib/utils';

function documentLabel(
  entity: KnowledgeEntity,
  reference?: KnowledgeRelationship,
): string {
  const item = reference?.provenance[0] ?? entity.provenance[0];
  return item ? displayPath(item.documentPath) : entity.name;
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
  const [open, setOpen] = useState(false);
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
              entity.type === 'document'
                ? documentLabel(
                    entity,
                    rels.find((rel) => rel.sourceEntityId === id),
                  )
                : entity.name,
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
    <details
      className="rounded-lg border"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Explore reference graph
      </summary>
      <p className="px-3 pb-2 text-xs text-muted-foreground">
        Arrows point from a document to this ADR. Select a document to inspect
        its evidence.
      </p>
      <div className="h-[320px] overflow-hidden rounded-b-lg bg-card/40">
        {open && (
          <ReactFlowProvider>
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
          </ReactFlowProvider>
        )}
      </div>
    </details>
  );
}

export function AdrScreen() {
  const { graph } = useKnowledgeState();
  const decisions = useMemo(() => collectDecisions(graph), [graph]);
  const repositories = useMemo(
    () => [...new Set(decisions.map((d) => d.repository))].sort(),
    [decisions],
  );
  const [repository, setRepository] = useState('');
  const [query, setQuery] = useState('');
  const scoped = filterDecisions(decisions, repository, query);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = scoped.find((d) => d.entity.id === selectedId) ?? scoped[0];
  const [documentId, setDocumentId] = useState<string>();
  const selectedReference = selected?.referencedBy.find(
    (rel) => rel.sourceEntityId === documentId,
  );
  const selectedDocument = selectedReference
    ? graph.entityById.get(selectedReference.sourceEntityId)
    : undefined;
  const selectedEntity = selectedDocument ?? selected?.entity;
  const detailsHeading = useRef<HTMLHeadingElement>(null);

  function revealDetails() {
    requestAnimationFrame(() => {
      detailsHeading.current?.scrollIntoView({
        block: window.matchMedia('(min-width: 1024px)').matches
          ? 'nearest'
          : 'start',
      });
    });
  }

  function selectDecision(id: string) {
    setSelectedId(id);
    setDocumentId(undefined);
    revealDetails();
  }

  function selectDocument(id: string) {
    setDocumentId(id);
    revealDetails();
  }

  return (
    <div className="space-y-4 lg:flex lg:h-[calc(100dvh-7.5rem)] lg:flex-col">
      <ScreenHeader
        eyebrow="Architecture Decisions"
        title="Browse architecture decisions"
        lead="Architecture Decision Records (ADRs) capture architectural choices. Select a record to see the documents that link to it and the source evidence behind it."
      />

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-1">
        <section
          aria-label="Decision browser"
          className="min-w-0 rounded-2xl border bg-card lg:flex lg:min-h-0 lg:flex-col"
        >
          <div className="space-y-3 border-b p-4">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Search decisions</span>
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setDocumentId(undefined);
                }}
                placeholder="ADR number, title or source path"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Repository</span>
              <select
                value={repository}
                onChange={(event) => {
                  setRepository(event.target.value);
                  setDocumentId(undefined);
                }}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">All repositories</option>
                {repositories.map((repo) => (
                  <option key={repo} value={repo}>
                    {repo}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground" role="status">
              {scoped.length} of {decisions.length} decisions
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto p-2 lg:min-h-0 lg:flex-1 lg:max-h-none">
            {scoped.length ? (
              <ul className="space-y-1">
                {scoped.map((decision) => (
                  <li key={decision.entity.id}>
                    <button
                      type="button"
                      aria-pressed={decision.entity.id === selected?.entity.id}
                      aria-controls="adr-details"
                      onClick={() => selectDecision(decision.entity.id)}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        decision.entity.id === selected?.entity.id
                          ? 'border-primary bg-primary/10'
                          : 'border-transparent hover:bg-accent',
                      )}
                    >
                      <span className="flex flex-wrap justify-between gap-1 text-xs">
                        <span className="font-mono font-semibold">
                          {decision.entity.name}
                        </span>
                        <span className="text-muted-foreground">
                          {decision.repository}
                        </span>
                      </span>
                      <span className="mt-1 block text-sm font-medium">
                        {decision.title ??
                          'Title not available in this publication'}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                        {decision.summary ??
                          'Summary unavailable in this publication.'}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {decision.referencedBy.length} explicit{' '}
                        {decision.referencedBy.length === 1
                          ? 'reference'
                          : 'references'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                {decisions.length
                  ? 'No decisions match these filters. Try another search or repository.'
                  : 'No architecture decisions in this publication.'}
              </p>
            )}
          </div>
        </section>
        <section
          id="adr-details"
          aria-labelledby="adr-details-heading"
          className="min-w-0 rounded-2xl border bg-card p-4 lg:min-h-0 lg:overflow-y-auto"
        >
          <h2
            id="adr-details-heading"
            ref={detailsHeading}
            className="mb-3 scroll-mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {selectedDocument ? 'Referencing document' : 'Decision details'}
          </h2>
          {selectedEntity ? (
            <div key={selectedEntity.id} className="animate-fade-up space-y-4">
              {selectedDocument && selected && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectDecision(selected.entity.id)}
                >
                  Back to {selected.entity.name}
                </Button>
              )}
              <EntityChip entity={selectedEntity} size="lg" />
              {selected && !selectedDocument ? (
                <>
                  <div>
                    <h3 className="text-xl font-semibold">
                      {selected.title ??
                        'Title not available in this publication'}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Repository: {selected.repository}
                    </p>
                  </div>
                  <div>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Decision summary
                    </h3>
                    <p className="text-sm leading-relaxed">
                      {selected.summary ??
                        'Summary unavailable in this publication.'}
                    </p>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Documents linking to this decision
                    </h3>
                    {!selected.referencedBy.length && (
                      <p className="text-sm text-muted-foreground">
                        No explicit document links in this publication. This
                        does not mean the decision is unused.
                      </p>
                    )}
                    <ul className="space-y-1">
                      {selected.referencedBy.map((rel) => {
                        const doc = graph.entityById.get(rel.sourceEntityId);
                        return doc ? (
                          <li
                            key={rel.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <button
                              type="button"
                              className="break-all text-left font-mono text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => selectDocument(doc.id)}
                            >
                              {documentLabel(doc, rel)}
                            </button>
                          </li>
                        ) : null;
                      })}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Source evidence
                    </h3>
                    <EvidencePanel
                      provenance={selectedEntity.provenance}
                      compact
                    />
                  </div>
                  <AdrGraph
                    decisions={[selected]}
                    selectedId={selected.entity.id}
                    onSelect={(id) => {
                      if (id && id !== selected.entity.id) selectDocument(id);
                    }}
                  />
                </>
              ) : (
                <EvidencePanel
                  provenance={
                    selectedReference?.provenance ?? selectedEntity.provenance
                  }
                  compact
                />
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {decisions.length
                ? 'Choose a matching decision to see its references and evidence.'
                : 'Decision details will appear here when ADRs are published.'}
            </p>
          )}
        </section>
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
    </div>
  );
}
