import { AlertTriangle, ArrowRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { EntityChip } from '@/components/chips';
import { EvidencePanel } from '@/components/evidence-panel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  decodePublishedJourney,
  journeyMatches,
  resolveJourneyEntityReference,
  type JourneyEntityReferenceView,
  type JourneyStepView,
  type JourneyView,
} from '@/lib/journeys';
import type { KnowledgeEntity } from '@/lib/types';

function stepLabel(step: JourneyStepView): string {
  for (const key of [
    'route',
    'controller',
    'service',
    'connector',
    'component',
    'target',
    'targetExpression',
  ]) {
    const value = step[key];
    if (typeof value === 'string') return value;
  }
  return step.type;
}

function RelatedLink({
  label,
  role,
  graphEntities,
  entityId,
  entityType,
}: {
  label: string;
  role: string;
  graphEntities: readonly KnowledgeEntity[];
  entityId?: string | undefined;
  entityType?: string | undefined;
}) {
  const entity = resolveJourneyEntityReference(graphEntities, {
    ...(entityId ? { entityId } : {}),
    ...(entityType ? { entityType } : {}),
  });
  if (!entity) {
    return (
      <span className="inline-flex items-center gap-2">
        <span>{label}</span>
        <Badge variant="outline">{role}</Badge>
        <span className="text-xs text-muted-foreground">
          {entityId ? 'Published target unavailable' : 'Unresolved reference'}
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-2 text-left hover:text-primary"
      onClick={() => {
        window.location.hash = `/graph/entity/${encodeURIComponent(entity.id)}`;
      }}
    >
      <EntityChip entity={entity} label={label} size="sm" />
      <span className="sr-only">Open {label} in the knowledge graph</span>
    </button>
  );
}

function ReferenceLinks({
  references,
  graphEntities,
}: {
  references: readonly JourneyEntityReferenceView[];
  graphEntities: readonly KnowledgeEntity[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {references.map((reference) => (
        <RelatedLink
          key={reference.entityId ?? reference.entityKey}
          label={reference.displayName ?? reference.label}
          role={reference.role}
          entityId={reference.entityId}
          entityType={reference.entityType}
          graphEntities={graphEntities}
        />
      ))}
    </div>
  );
}

function EvidenceLinks({
  references,
  entity,
}: {
  references: JourneyStepView['provenance'];
  entity: KnowledgeEntity;
}) {
  const ids = new Set(
    references
      .filter((reference) => reference.kind === 'evidence')
      .map((reference) => reference.id),
  );
  const provenance = entity.provenance.filter((item) =>
    ids.has(item.evidenceId),
  );
  return provenance.length === 0 ? null : (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        Inspect evidence and source locations ({provenance.length})
      </summary>
      <div className="mt-2">
        <EvidencePanel provenance={provenance} compact />
      </div>
    </details>
  );
}

function StepDetails({
  step,
  graphEntities,
  entity,
}: {
  step: JourneyStepView;
  graphEntities: readonly KnowledgeEntity[];
  entity: KnowledgeEntity;
}) {
  const detail =
    step.branchContext || step.asyncGroup
      ? [step.branchContext, step.asyncGroup].filter(Boolean).join(' · ')
      : undefined;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{step.type}</Badge>
        <RelatedLink
          label={stepLabel(step)}
          role={step.type}
          graphEntities={graphEntities}
          entityId={step.stepEntityId}
        />
        <Badge variant="secondary">{step.evidenceBasis}</Badge>
      </div>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      {step.entityReferences && (
        <div className="mt-2">
          <ReferenceLinks
            references={step.entityReferences.filter(
              (reference) => reference.role !== 'step',
            )}
            graphEntities={graphEntities}
          />
        </div>
      )}
      <EvidenceLinks references={step.provenance} entity={entity} />
    </div>
  );
}

function JourneyDetail({
  entity,
  journey,
  graphEntities,
}: {
  entity: KnowledgeEntity;
  journey: JourneyView;
  graphEntities: readonly KnowledgeEntity[];
}) {
  const diagnostics = [...journey.unresolvedBoundaries, ...journey.diagnostics];
  const sourceFiles = journey.entityReferences.filter(
    (reference) => reference.role === 'document',
  );
  const services = journey.entityReferences.filter(
    (reference) => reference.role === 'service',
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                journey.completeness === 'complete' ? 'default' : 'outline'
              }
            >
              {journey.completeness}
            </Badge>
            <Badge variant="secondary">{journey.confidence} evidence</Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {journey.id}
            </span>
          </div>
          <CardTitle className="pt-2">{journey.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {journey.description ??
              'Deterministic static-path candidate; not a runtime observation.'}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Participating services
            </h3>
            <div className="flex flex-wrap gap-2">
              {services.length > 0 ? (
                <ReferenceLinks
                  references={services}
                  graphEntities={graphEntities}
                />
              ) : (
                <span className="text-sm text-muted-foreground">
                  No service-role component was established.
                </span>
              )}
            </div>
          </div>
          {journey.entityReferences.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Referenced entities
              </h3>
              <div className="flex flex-wrap gap-2">
                <ReferenceLinks
                  references={journey.entityReferences.filter(
                    (reference) =>
                      reference.role !== 'step' &&
                      reference.role !== 'document',
                  )}
                  graphEntities={graphEntities}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ordered static steps</CardTitle>
          <p className="text-sm text-muted-foreground">
            Steps are source-derived candidates, with branch and asynchronous
            grouping preserved where parser evidence provides them.
          </p>
        </CardHeader>
        <CardContent>
          {journey.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No supported steps were produced.
            </p>
          ) : (
            <ol className="space-y-2">
              {journey.steps.map((step, index) => (
                <li key={step.id}>
                  <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">
                      {index + 1}
                    </span>
                    <StepDetails
                      step={step}
                      entity={entity}
                      graphEntities={graphEntities}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transitions</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every transition is shown with its recorded order and evidence
            certainty; no intermediate step is synthesized.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {journey.transitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No transitions were established.
            </p>
          ) : (
            journey.transitions.map((transition) => {
              const from = journey.steps.find(
                (step) => step.id === transition.from,
              );
              const to = journey.steps.find(
                (step) => step.id === transition.to,
              );
              return (
                <div
                  key={transition.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
                >
                  <RelatedLink
                    label={from ? stepLabel(from) : transition.from}
                    role="step"
                    entityId={from?.stepEntityId}
                    graphEntities={graphEntities}
                  />
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  <RelatedLink
                    label={to ? stepLabel(to) : transition.to}
                    role="step"
                    entityId={to?.stepEntityId}
                    graphEntities={graphEntities}
                  />
                  <Badge variant="outline">{transition.type}</Badge>
                  <Badge variant="secondary">{transition.order}</Badge>
                  <Badge variant="outline">{transition.certainty}</Badge>
                  {transition.entityReferences && (
                    <ReferenceLinks
                      references={transition.entityReferences.filter(
                        (reference) => reference.role !== 'step',
                      )}
                      graphEntities={graphEntities}
                    />
                  )}
                  <EvidenceLinks
                    references={transition.provenance}
                    entity={entity}
                  />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Unresolved boundaries and diagnostics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {diagnostics.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No unresolved boundaries were reported.
              </p>
            ) : (
              diagnostics.map((item, index) => (
                <div
                  key={`${item.key}:${index}`}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="size-4 text-amber-500" />
                    {item.reason}
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {item.target}
                  </p>
                  {item.evidenceRef && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Evidence reference: {item.evidenceRef}
                    </p>
                  )}
                </div>
              ))
            )}
            {journey.relationshipReferences.length > 0 && (
              <div className="border-t pt-3">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Publication relationships
                </h4>
                {journey.relationshipReferences.map((reference) => (
                  <p
                    key={reference.relationshipId ?? reference.relationshipKey}
                    className="break-all font-mono text-xs text-muted-foreground"
                  >
                    {reference.relationshipId ? (
                      <a
                        className="hover:text-primary"
                        href={`#/graph/relationship/${encodeURIComponent(reference.relationshipId)}`}
                      >
                        {reference.type}: {reference.relationshipId}
                      </a>
                    ) : (
                      `${reference.type}: unresolved candidate reference`
                    )}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Source files</CardTitle>
          </CardHeader>
          <CardContent>
            {sourceFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No source-file paths were published.
              </p>
            ) : (
              <div className="space-y-1">
                <ReferenceLinks
                  references={sourceFiles}
                  graphEntities={graphEntities}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provenance</CardTitle>
          <p className="text-sm text-muted-foreground">
            Evidence, source locations, and extraction details from this
            immutable publication.
          </p>
        </CardHeader>
        <CardContent>
          <EvidencePanel provenance={entity.provenance} compact />
        </CardContent>
      </Card>
    </div>
  );
}

export function JourneysScreen() {
  const { graph } = useKnowledgeState();
  const [query, setQuery] = useState('');
  const records = useMemo(
    () =>
      graph.entities
        .filter((entity) => entity.type === 'journey')
        .map((entity) => ({
          entity,
          decoded: decodePublishedJourney(entity),
        }))
        .sort((a, b) => a.entity.name.localeCompare(b.entity.name)),
    [graph],
  );
  const visible = records.filter(
    ({ decoded }) => !decoded.journey || journeyMatches(decoded.journey, query),
  );
  const [selectedId, setSelectedId] = useState<string>();
  const selected =
    visible.find(({ entity }) => entity.id === selectedId) ?? visible[0];

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-5 lg:p-8">
        <header className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Published Knowledge
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Journeys</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Browse deterministic source-level path candidates in publication v
            {graph.meta.version}. These records describe static evidence, not
            observed execution or inferred business intent.
          </p>
        </header>

        <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Journey catalogue</CardTitle>
              <div className="relative pt-2">
                <Search className="absolute left-3 top-[1.35rem] size-4 text-muted-foreground" />
                <Input
                  aria-label="Search Journeys"
                  className="pl-9"
                  placeholder="Search route, service, or step"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {visible.map(({ entity, decoded }) => (
                <button
                  key={entity.id}
                  type="button"
                  onClick={() => setSelectedId(entity.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/50 ${
                    selected?.entity.id === entity.id
                      ? 'border-primary bg-primary/10'
                      : 'bg-card'
                  }`}
                >
                  <span className="block text-sm font-medium">
                    {entity.name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {decoded.journey
                      ? `${decoded.journey.steps.length} steps · ${decoded.journey.completeness}`
                      : decoded.error}
                  </span>
                </button>
              ))}
              {visible.length === 0 && (
                <p className="py-4 text-sm text-muted-foreground">
                  {records.length === 0
                    ? 'This publication contains no Journey records.'
                    : 'No Journeys match this search.'}
                </p>
              )}
            </CardContent>
          </Card>

          {selected && (
            <section aria-label="Journey detail">
              {selected.decoded.journey ? (
                <JourneyDetail
                  entity={selected.entity}
                  journey={selected.decoded.journey}
                  graphEntities={graph.entities}
                />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>{selected.entity.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-destructive">
                      {selected.decoded.error}
                    </p>
                  </CardContent>
                </Card>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
