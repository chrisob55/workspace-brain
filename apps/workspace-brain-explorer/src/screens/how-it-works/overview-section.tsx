import { ArrowDown, ArrowRight } from 'lucide-react';
import { useMemo } from 'react';

import { useKnowledgeState } from '@/app-context';
import { MermaidDiagram } from '@/components/docs/mermaid-diagram';
import { KeyMessage } from '@/components/story';
import { Card, CardContent } from '@/components/ui/card';
import { concept, PIPELINE } from '@/lib/how-it-works/concepts';
import { conceptExample, pipelineDiagram } from '@/lib/how-it-works/examples';
import {
  distinctRepositories,
  distinctSourceDocuments,
} from '@/lib/knowledge-graph';
import { cn, formatNumber } from '@/lib/utils';

import {
  DocSection,
  ImplementedBy,
  InspectButton,
  JsonButton,
  StatusBadge,
  useDeepLink,
} from './shared';

export const MISSION =
  'Transform organisational assets into trusted, structured, evidence-backed Knowledge Models.';

export function OverviewSection() {
  const { graph } = useKnowledgeState();
  const { item, select } = useDeepLink('overview');
  const selected = PIPELINE.find((stage) => stage.id === item) ?? PIPELINE[0]!;
  const selectedConcept = concept(selected.conceptId);
  const example = useMemo(
    () => conceptExample(selected.conceptId, graph),
    [selected.conceptId, graph],
  );
  const stats = [
    { label: 'Repositories', value: distinctRepositories(graph).length },
    { label: 'Source documents', value: distinctSourceDocuments(graph) },
    { label: 'Entities', value: graph.entities.length },
    { label: 'Relationships', value: graph.relationships.length },
  ];

  return (
    <DocSection
      id="overview"
      lead="Workspace Brain reads the assets an organisation already has, such as repositories, contracts, manifests and ADRs. From them it builds a Knowledge Model in which every fact can be traced back to the exact evidence that supports it."
    >
      <KeyMessage>{MISSION}</KeyMessage>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-4">
              <p className="text-2xl font-semibold">
                {formatNumber(stat.value)}
              </p>
              <p className="text-xs text-muted-foreground">
                {stat.label} in the loaded publication v{graph.meta.version}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">Why it exists:</strong> knowledge
        about software is scattered across files and people. It goes out of date
        silently and can rarely be verified. Workspace Brain makes that
        knowledge explicit, versioned and traceable, so people and AI can rely
        on it.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <ol
          className="flex flex-col items-stretch"
          aria-label="Knowledge pipeline"
        >
          {PIPELINE.map((stage, index) => (
            <li key={stage.id} className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => select(stage.id)}
                aria-pressed={stage.id === selected.id}
                className={cn(
                  'w-full rounded-lg border px-4 py-2.5 text-left transition-all hover:border-primary/60 hover:shadow-sm',
                  stage.id === selected.id &&
                    'border-primary bg-primary/10 ring-2 ring-primary/30',
                )}
              >
                <span className="block font-semibold">{stage.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {stage.tagline}
                </span>
              </button>
              {index < PIPELINE.length - 1 && (
                <ArrowDown className="my-1 size-4 text-muted-foreground" />
              )}
            </li>
          ))}
        </ol>

        <Card className="min-w-0">
          <CardContent className="space-y-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold">{selected.title}</h3>
              <StatusBadge status={selectedConcept.status} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md bg-muted px-2 py-1">
                {selected.input}
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
              <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">
                {selected.output}
              </span>
            </div>
            <div className="space-y-2 text-sm">
              <p>{selectedConcept.summary}</p>
              <p className="text-muted-foreground">
                <strong className="text-foreground">Why:</strong>{' '}
                {selectedConcept.why}
              </p>
            </div>
            {example && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Example data · live from publication
                </p>
                <p className="mb-2 text-sm">{example.text}</p>
                <div className="flex flex-wrap gap-2">
                  {example.value !== undefined && (
                    <JsonButton
                      title={`${selected.title} example`}
                      value={example.value}
                    />
                  )}
                  {example.provenance && (
                    <InspectButton
                      target={{
                        kind: 'evidence',
                        title: selected.title,
                        provenance: example.provenance,
                      }}
                    >
                      View evidence
                    </InspectButton>
                  )}
                </div>
              </div>
            )}
            <ImplementedBy
              refs={selectedConcept.implementedBy}
              schemas={selectedConcept.schemas}
              apis={selectedConcept.apis}
              adrs={selectedConcept.adrs}
            />
          </CardContent>
        </Card>
      </div>

      <MermaidDiagram
        title="The same pipeline as a Mermaid diagram"
        chart={pipelineDiagram(PIPELINE)}
      />
    </DocSection>
  );
}
