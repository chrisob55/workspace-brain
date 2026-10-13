import { ArrowRight, Info, MessageCircleQuestion } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { EntityChip } from '@/components/chips';
import { JsonViewer } from '@/components/docs/json-viewer';
import { MermaidDiagram } from '@/components/docs/mermaid-diagram';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EXPLORER_REFS, SEARCH_REFS } from '@/lib/how-it-works/concepts';
import {
  apisDiagram,
  apisJourney,
  dependencyCandidates,
  dependentsDiagram,
  dependentsJourney,
  operationLabel,
  preferredRepository,
  type JourneyStage,
} from '@/lib/how-it-works/examples';
import { distinctRepositories } from '@/lib/knowledge-graph';
import { cn } from '@/lib/utils';

import {
  Callout,
  DocSection,
  ImplementedBy,
  InspectButton,
  useDeepLink,
} from './shared';

function StageFlow({ stages }: { stages: JourneyStage[] }) {
  const [active, setActive] = useState(stages.length - 1);
  const stage = stages[Math.min(active, stages.length - 1)]!;
  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap items-center gap-2">
        {stages.map((entry, index) => (
          <li key={entry.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActive(index)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm transition-colors hover:border-primary/60',
                index === active &&
                  'border-primary bg-primary/10 font-medium text-primary',
                index < active && 'border-primary/40',
              )}
            >
              {index + 1}. {entry.title}
            </button>
            {index < stages.length - 1 && (
              <ArrowRight className="size-4 text-muted-foreground" />
            )}
          </li>
        ))}
      </ol>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <p className="text-sm">{stage.detail}</p>
        <JsonViewer value={stage.value} expandDepth={2} />
      </div>
    </div>
  );
}

function DependentsJourneyView() {
  const { graph } = useKnowledgeState();
  const [requested, setRequested] = useState('Agent Invitations');
  const [targetId, setTargetId] = useState<string>();
  const journey = useMemo(
    () => dependentsJourney(graph, requested, targetId),
    [graph, requested, targetId],
  );
  const suggestions = useMemo(
    () => dependencyCandidates(graph).slice(0, 6),
    [graph],
  );
  if (!journey)
    return (
      <p className="text-sm text-muted-foreground">
        This publication has no dependency relationships.
      </p>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">What services depend on</span>
        <Input
          value={requested}
          onChange={(event) => {
            setRequested(event.target.value);
            setTargetId(undefined);
          }}
          className="w-64"
          aria-label="Dependency target"
        />
        <span className="text-sm font-medium">?</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        Try:
        {suggestions.map((entity) => (
          <button
            key={entity.id}
            type="button"
            onClick={() => {
              setRequested(entity.name);
              setTargetId(entity.id);
            }}
            className="rounded-md border px-2 py-0.5 font-mono hover:border-primary/60 hover:text-foreground"
          >
            {entity.name}
          </button>
        ))}
      </div>
      {!journey.matched && (
        <Callout icon={<Info />}>
          {requested.trim()
            ? `"${requested}" is not in this publication, which only covers the repositories that were scanned.`
            : 'No target given.'}{' '}
          The journey below uses the most depended-on entity,{' '}
          <strong className="text-foreground">{journey.target.name}</strong>. In
          a workspace that contains the Agent Invitations services, the same
          steps answer the original question.
        </Callout>
      )}
      <StageFlow key={journey.target.id} stages={journey.stages} />
      {journey.dependents.length > 0 && (
        <div className="grid grid-cols-1 gap-4 [&>*]:min-w-0">
          <MermaidDiagram
            chart={dependentsDiagram(journey)}
            title={journey.question}
          />
          <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
            {journey.dependents.map((fact) => (
              <li
                key={fact.relationship.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2"
              >
                <EntityChip
                  entity={fact.source}
                  size="sm"
                  className="max-w-[60%]"
                />
                <span className="text-xs text-muted-foreground">
                  DEPENDS_ON
                </span>
                <InspectButton
                  className="ml-auto"
                  target={{
                    kind: 'evidence',
                    title: `${fact.source.name} DEPENDS_ON ${fact.target.name}`,
                    provenance: fact.relationship.provenance,
                  }}
                >
                  Evidence
                </InspectButton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ApisJourneyView() {
  const { graph } = useKnowledgeState();
  const repositories = useMemo(() => distinctRepositories(graph), [graph]);
  const [repository, setRepository] = useState(
    () => preferredRepository(graph)?.name ?? repositories[0] ?? '',
  );
  const journey = useMemo(
    () => apisJourney(graph, repository),
    [graph, repository],
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">What APIs exist in</span>
        <select
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          aria-label="Repository"
        >
          {repositories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span className="text-sm font-medium">?</span>
      </div>
      <StageFlow key={repository} stages={journey.stages} />
      {journey.apis.length > 0 && (
        <div className="grid grid-cols-1 gap-4 [&>*]:min-w-0">
          <MermaidDiagram
            chart={apisDiagram(journey)}
            title={journey.question}
          />
          <div className="space-y-3">
            {journey.apis.map(({ api, operations }) => (
              <div key={api.id} className="rounded-lg border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <EntityChip entity={api} />
                  <InspectButton
                    className="ml-auto"
                    target={{
                      kind: 'evidence',
                      title: api.name,
                      provenance: api.provenance,
                    }}
                  >
                    Evidence
                  </InspectButton>
                </div>
                <ul className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-xs">
                  {operations.map((operation) => (
                    <li key={operation.id}>{operationLabel(operation)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const JOURNEYS = [
  {
    id: 'dependents',
    title: 'What services depend on Agent Invitations?',
    view: DependentsJourneyView,
  },
  {
    id: 'apis',
    title: 'What APIs exist in this service?',
    view: ApisJourneyView,
  },
];

export function JourneysSection() {
  const { item, select } = useDeepLink('journeys');
  const journey = JOURNEYS.find((entry) => entry.id === item) ?? JOURNEYS[0]!;
  const View = journey.view;
  return (
    <DocSection
      id="journeys"
      lead="Follow real questions through the system. Each stage shows the data it actually produces from the loaded publication."
    >
      <div className="grid gap-2 md:grid-cols-2">
        {JOURNEYS.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => select(entry.id)}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/60',
              entry.id === journey.id && 'border-primary bg-primary/10',
            )}
          >
            <MessageCircleQuestion className="mt-0.5 size-5 shrink-0 text-primary" />
            <span>
              <span className="block text-xs uppercase tracking-wider text-muted-foreground">
                Example {index + 1}
              </span>
              <span className="font-medium">{entry.title}</span>
            </span>
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="space-y-5 py-5">
          <View />
          <div className="border-t pt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Implemented by
            </h4>
            <ImplementedBy
              refs={[...EXPLORER_REFS.slice(0, 2), ...SEARCH_REFS.slice(0, 2)]}
              apis={
                journey.id === 'dependents'
                  ? [
                      'listPublishedEntityRelationships',
                      'searchProjectedRelationships',
                    ]
                  : ['searchProjectedEntities', 'getPublishedEntity']
              }
            />
          </div>
        </CardContent>
      </Card>
    </DocSection>
  );
}
