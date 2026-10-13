import {
  ArrowRight,
  Check,
  FileSearch,
  Layers,
  Library,
  Send,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { useKnowledgeState } from '@/app-context';
import { EntityChip } from '@/components/chips';
import { JsonViewer } from '@/components/docs/json-viewer';
import { MermaidDiagram } from '@/components/docs/mermaid-diagram';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { concept } from '@/lib/how-it-works/concepts';
import {
  apiModelExample,
  discoveryExample,
  evidenceExamples,
  knowledgeMapping,
  operationLabel,
} from '@/lib/how-it-works/examples';
import { exampleRequestPath } from '@/lib/how-it-works/requests';
import {
  DISCOVERY_EVENTS,
  DOCUMENT_PROCESSORS,
  ENTITY_LIFECYCLE,
  ENTITY_TYPES,
  EVIDENCE_LOCATOR_KINDS,
  RELATIONSHIP_VOCABULARY,
} from '@/lib/implementation-metadata';
import type { KnowledgeGraph } from '@/lib/knowledge-graph';
import { displayPath } from '@/lib/knowledge-graph';
import { apiOperation } from '@/lib/openapi-contract';
import type { KnowledgeEntity } from '@/lib/types';
import { cn } from '@/lib/utils';

import {
  DocSection,
  ImplementedBy,
  InspectButton,
  JsonButton,
  SchemaButton,
  StatusBadge,
  useDeepLink,
} from './shared';

interface Step {
  id: string;
  title: string;
  icon: ReactNode;
  conceptId: string;
  render: (graph: KnowledgeGraph) => ReactNode;
}

const STEPS: Step[] = [
  {
    id: 'discovery',
    title: 'Discovery',
    icon: <FileSearch />,
    conceptId: 'discovery',
    render: (graph) => <DiscoveryStep graph={graph} />,
  },
  {
    id: 'evidence',
    title: 'Evidence Extraction',
    icon: <Layers />,
    conceptId: 'evidence',
    render: (graph) => <EvidenceStep graph={graph} />,
  },
  {
    id: 'knowledge',
    title: 'Knowledge Model Generation',
    icon: <Library />,
    conceptId: 'knowledge-model',
    render: (graph) => <KnowledgeStep graph={graph} />,
  },
  {
    id: 'publications',
    title: 'Publications',
    icon: <Send />,
    conceptId: 'publication',
    render: (graph) => <PublicationStep graph={graph} />,
  },
];

function Chips({
  items,
  mono = true,
}: {
  items: readonly string[];
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge
          key={item}
          variant="secondary"
          className={cn(mono && 'font-mono font-normal')}
        >
          {item}
        </Badge>
      ))}
    </div>
  );
}

function Explain({ points }: { points: { title: string; text: ReactNode }[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {points.map((point) => (
        <div key={point.title} className="rounded-lg border p-3">
          <dt className="font-medium">{point.title}</dt>
          <dd className="mt-1 text-sm text-muted-foreground">{point.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h4>
  );
}

function DiscoveryStep({ graph }: { graph: KnowledgeGraph }) {
  const example = discoveryExample(graph);
  return (
    <div className="space-y-5">
      <Explain
        points={[
          {
            title: 'Source registration',
            text: 'Sources and roots declared in config/workspace-brain.yaml are registered in the catalogue with a stable ID.',
          },
          {
            title: 'Repository discovery',
            text: 'The scanner walks each root, treats every directory containing .git as a repository boundary and fingerprints it.',
          },
          {
            title: 'File discovery',
            text: 'Files are inventoried with a content fingerprint. A changed fingerprint creates a new document version, and unchanged files are skipped.',
          },
          {
            title: 'Classification',
            text: `Filenames are matched against the processing registry, which currently has ${DOCUMENT_PROCESSORS.length} processors, so each document is routed to the right normaliser.`,
          },
        ]}
      />
      {example && (
        <div>
          <Label>Example repository · {example.repository.name}</Label>
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] [&>*]:min-w-0">
            <div>
              <p className="mb-1 text-sm font-medium">
                Input: repository metadata
              </p>
              <JsonViewer value={example.input} expandDepth={2} />
            </div>
            <ArrowRight className="mx-auto hidden size-5 text-muted-foreground lg:mt-12 lg:block" />
            <div>
              <p className="mb-1 text-sm font-medium">
                Output: discovery record
              </p>
              <JsonViewer value={example.output} expandDepth={2} />
            </div>
          </div>
        </div>
      )}
      <div>
        <Label>Events emitted (DiscoveryEventName)</Label>
        <Chips items={DISCOVERY_EVENTS} />
      </div>
    </div>
  );
}

function EvidenceStep({ graph }: { graph: KnowledgeGraph }) {
  const examples = evidenceExamples(graph);
  return (
    <div className="space-y-5">
      <p className="text-sm">
        <strong>Evidence is the atomic fact layer.</strong> Each document
        version is normalised into evidence blocks. Every block records exactly
        where it came from, using a typed locator, so any later fact can cite
        it.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Evidence</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
              <th className="px-3 py-2 font-medium">Provenance</th>
            </tr>
          </thead>
          <tbody>
            {examples.map((item) => (
              <tr key={item.id} className="border-t align-top">
                <td className="px-3 py-2 font-medium">{item.label}</td>
                <td className="max-w-[16rem] break-words px-3 py-2 font-mono text-[13px]">
                  {item.value}
                </td>
                <td className="px-3 py-2">
                  <span className="block break-all font-mono text-xs">
                    {item.source}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {item.locator}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {item.confidence !== undefined
                    ? item.confidence.toFixed(2)
                    : 'n/a (entity)'}
                  <span className="block text-muted-foreground">
                    {item.lifecycleStatus}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <InspectButton
                    target={{
                      kind: 'evidence',
                      title: `${item.label}: ${item.value}`,
                      provenance: item.provenance,
                    }}
                  >
                    {item.extractor}
                  </InspectButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Confidence is recorded on relationships. Entities carry a lifecycle
        status instead (EntityLifecycleStatus: {ENTITY_LIFECYCLE.join(' → ')}).
      </p>
      <div>
        <Label>Locator kinds (EvidenceLocator)</Label>
        <Chips items={EVIDENCE_LOCATOR_KINDS} />
      </div>
    </div>
  );
}

function KnowledgeStep({ graph }: { graph: KnowledgeGraph }) {
  const rows = knowledgeMapping(graph);
  const example = apiModelExample(graph);
  return (
    <div className="space-y-5">
      <p className="text-sm">
        Extractors read evidence and propose candidate entities and
        relationships. The knowledge store reconciles the candidates against the
        existing model, de-duplicating by identity and keeping every supporting
        evidence ID. The result is a typed, versioned model.
      </p>
      <div className="grid gap-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[9rem_1fr_auto] sm:items-center"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{row.concept}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              {row.representedBy}
              {row.example && (
                <span className="mt-0.5 block font-mono text-xs text-foreground">
                  e.g. {row.example}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm tabular-nums">{row.count}</span>
              <StatusBadge status={row.coverage} />
            </div>
          </div>
        ))}
      </div>
      {example && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <Label>Real example from publication v{graph.meta.version}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <EntityChip entity={example.api} size="lg" />
              <span className="text-sm text-muted-foreground">
                EXPOSES {example.operations.length} operations
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {example.operations.slice(0, 8).map((operation) => (
                <EntityChip
                  key={operation.id}
                  entity={operation}
                  label={operationLabel(operation)}
                  size="sm"
                />
              ))}
              {example.operations.length > 8 && (
                <span className="self-center text-xs text-muted-foreground">
                  +{example.operations.length - 8} more
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <JsonButton
                title={example.api.name}
                value={{
                  entity: example.api,
                  exposes: example.exposes,
                  operations: example.operations,
                }}
              />
              <SchemaButton name="KnowledgeEntity" label="View Schema" />
              <InspectButton
                target={{
                  kind: 'evidence',
                  title: example.api.name,
                  provenance: example.api.provenance,
                }}
              >
                View Source Evidence
              </InspectButton>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <div>
          <Label>Entity types (ENTITY_TYPES)</Label>
          <Chips items={ENTITY_TYPES} />
        </div>
        <div>
          <Label>Relationship vocabulary</Label>
          <Chips items={RELATIONSHIP_VOCABULARY} />
        </div>
      </div>
    </div>
  );
}

function documentationOutput(entity: KnowledgeEntity): string {
  const evidence = entity.provenance
    .slice(0, 3)
    .map((item) => `- ${displayPath(item.documentPath)}`);
  return [
    `## ${entity.name}`,
    '',
    `Type: ${entity.type} · Status: ${entity.lifecycleStatus}`,
    '',
    'Evidence:',
    ...evidence,
  ].join('\n');
}

function PublicationStep({ graph }: { graph: KnowledgeGraph }) {
  const entity = apiModelExample(graph)?.api ?? graph.entities[0];
  const operation = apiOperation('getPublishedEntity');
  const requestPath =
    operation && entity
      ? exampleRequestPath(operation, graph, entity.id)
      : undefined;
  if (!entity) return null;
  const outputs: { title: string; status: string; body: ReactNode }[] = [
    {
      title: 'Explorer View',
      status: 'implemented',
      body: <EntityChip entity={entity} size="lg" />,
    },
    {
      title: 'JSON Publication',
      status: 'implemented',
      body: (
        <JsonButton
          title={`${entity.name} (package entry)`}
          value={entity}
          label="Open package entry"
        />
      ),
    },
    {
      title: 'API Response',
      status: 'implemented',
      body: (
        <div className="space-y-2">
          <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
            GET {requestPath}
          </code>
          <InspectButton
            target={{ kind: 'api', operationId: 'getPublishedEntity' }}
          >
            Inspect endpoint
          </InspectButton>
        </div>
      ),
    },
    {
      title: 'Future Documentation Output',
      status: 'planned',
      body: (
        <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
          {documentationOutput(entity)}
        </pre>
      ),
    },
  ];
  return (
    <div className="space-y-5">
      <p className="text-sm">
        <strong>
          A publication is a consumable representation of a Knowledge Model.
        </strong>{' '}
        It is an immutable, content-hashed snapshot (v{graph.meta.version}, hash{' '}
        {graph.meta.contentHash.slice(0, 12)}…). Every output below is generated
        from the same published entity.
      </p>
      <MermaidDiagram
        chart={[
          'flowchart LR',
          `  km(["Knowledge Model<br/><small>${entity.name.replace(/["<>]/g, "'")}</small>"]) --> pub[["Publication v${graph.meta.version}"]]`,
          ...outputs.map(
            (output, index) =>
              `  pub ${output.status === 'planned' ? '-.->' : '-->'} o${index}["${output.title}"]`,
          ),
        ].join('\n')}
      />
      <div className="grid gap-3 md:grid-cols-2">
        {outputs.map((output) => (
          <div key={output.title} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{output.title}</span>
              <StatusBadge status={output.status} />
            </div>
            {output.body}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PipelineSection() {
  const { graph } = useKnowledgeState();
  const { item, select } = useDeepLink('pipeline');
  const index = Math.max(
    0,
    STEPS.findIndex((step) => step.id === item),
  );
  const step = STEPS[index]!;
  const stepConcept = concept(step.conceptId);
  const body = useMemo(() => step.render(graph), [step, graph]);
  return (
    <DocSection
      id="pipeline"
      lead="Walk through the four stages that turn files into published knowledge. Every example below is computed from the publication the Explorer has loaded."
    >
      <ol className="grid gap-2 sm:grid-cols-4" aria-label="Pipeline steps">
        {STEPS.map((entry, position) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => select(entry.id)}
              aria-current={position === index ? 'step' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary/60',
                position === index && 'border-primary bg-primary/10',
              )}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold [&_svg]:size-4',
                  position < index &&
                    'border-primary bg-primary text-primary-foreground',
                  position === index && 'border-primary text-primary',
                )}
              >
                {position < index ? <Check /> : entry.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">
                  Step {position + 1}
                </span>
                <span className="block truncate text-sm font-medium">
                  {entry.title}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <Card>
        <CardContent className="space-y-6 py-5">
          <h3 className="text-xl font-semibold">
            Step {index + 1} · {step.title}
          </h3>
          {body}
          <div className="border-t pt-4">
            <Label>Implemented by</Label>
            <ImplementedBy
              refs={stepConcept.implementedBy}
              schemas={stepConcept.schemas}
              apis={stepConcept.apis}
              adrs={stepConcept.adrs}
            />
          </div>
          <div className="flex justify-between">
            <Button
              variant="ghost"
              size="sm"
              disabled={index === 0}
              onClick={() => select(STEPS[index - 1]?.id)}
            >
              ← Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={index === STEPS.length - 1}
              onClick={() => select(STEPS[index + 1]?.id)}
            >
              Next →
            </Button>
          </div>
        </CardContent>
      </Card>
    </DocSection>
  );
}
