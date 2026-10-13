import { ArrowRight, BrainCircuit, Sparkles } from 'lucide-react';
import { Fragment, useMemo } from 'react';

import { useKnowledgeState } from '@/app-context';
import { MermaidDiagram } from '@/components/docs/mermaid-diagram';
import { Card, CardContent } from '@/components/ui/card';
import { concept } from '@/lib/how-it-works/concepts';
import { AI_OS_DIAGRAM, conceptExample } from '@/lib/how-it-works/examples';

import { DocSection, ImplementedBy, JsonButton } from './shared';

const FLOW = [
  'Discovery',
  'Evidence',
  'Knowledge Model',
  'Publication',
  'AI-OS',
];

export function AiOsSection() {
  const { graph } = useKnowledgeState();
  const contextPackage = concept('context-package');
  const consumer = concept('consumer');
  const example = useMemo(
    () => conceptExample('context-package', graph),
    [graph],
  );
  return (
    <DocSection
      id="ai-os"
      lead="Workspace Brain and AI-OS have a deliberate split of responsibility. One produces trusted knowledge, and the other reasons over it. The publication is the contract between them."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="space-y-2 py-6">
            <BrainCircuit className="size-8 text-primary" />
            <h3 className="text-xl font-semibold">
              Workspace Brain = Knowledge Production
            </h3>
            <p className="text-2xl font-medium text-primary">
              “What do we know?”
            </p>
            <p className="text-sm text-muted-foreground">
              Deterministic, evidence-backed and versioned. It never guesses:
              every fact cites the file and location it came from.
            </p>
          </CardContent>
        </Card>
        <Card className="border-violet-500/40 bg-violet-500/5">
          <CardContent className="space-y-2 py-6">
            <Sparkles className="size-8 text-violet-500" />
            <h3 className="text-xl font-semibold">
              AI-OS = Reasoning and Assistance
            </h3>
            <p className="text-2xl font-medium text-violet-600 dark:text-violet-400">
              “What should we do with that knowledge?”
            </p>
            <p className="text-sm text-muted-foreground">
              It plans, answers and assists. It grounds its reasoning in
              published, cited facts instead of re-reading raw repositories.
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card p-4">
        {FLOW.map((step, index) => (
          <Fragment key={step}>
            <span
              className={
                index === FLOW.length - 1
                  ? 'rounded-lg border border-violet-500/50 bg-violet-500/10 px-4 py-2 font-semibold text-violet-700 dark:text-violet-300'
                  : 'rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 font-medium'
              }
            >
              {step}
            </span>
            {index < FLOW.length - 1 && (
              <ArrowRight className="size-4 text-muted-foreground" />
            )}
          </Fragment>
        ))}
      </div>
      <MermaidDiagram chart={AI_OS_DIAGRAM} title="Responsibility boundary" />
      <Card>
        <CardContent className="space-y-4 py-5">
          <h3 className="font-semibold">The hand-off: {contextPackage.term}</h3>
          <p className="text-sm">{contextPackage.summary}</p>
          <p className="text-sm text-muted-foreground">{contextPackage.why}</p>
          {example && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{example.text}</span>
              {example.value !== undefined && (
                <JsonButton
                  title="Illustrative context package"
                  value={example.value}
                />
              )}
            </div>
          )}
          <ImplementedBy
            refs={[...consumer.implementedBy, ...contextPackage.implementedBy]}
            schemas={
              contextPackage.schemas.length > 0
                ? contextPackage.schemas
                : consumer.schemas
            }
            apis={[...new Set([...consumer.apis, ...contextPackage.apis])]}
            adrs={[...new Set([...consumer.adrs, ...contextPackage.adrs])]}
          />
        </CardContent>
      </Card>
    </DocSection>
  );
}
