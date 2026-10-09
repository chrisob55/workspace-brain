import {
  ArrowDown,
  ArrowRight,
  Check,
  Database,
  FileCode2,
  GitBranch,
  GitFork,
  Network,
  Radio,
  Route,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { useState } from 'react';

import { KeyMessage, ScreenHeader, SectionTitle } from '@/components/story';
import { RELATIONSHIP_STYLE } from '@/lib/palette';
import { cn } from '@/lib/utils';

const flowSteps = [
  'RelationshipController',
  'RelationshipService',
  'AgentConnector',
  'EACD API',
  'RelationshipStore',
  'Response',
];

const evidenceBases = [
  {
    id: 'proven',
    name: 'Proven',
    description: 'Directly established from source code.',
    detail:
      'A source-level call or operation is explicitly present at a cited location.',
  },
  {
    id: 'derived',
    name: 'Derived',
    description:
      'Established through deterministic analysis of routes, configuration and framework conventions.',
    detail:
      'A versioned parser pack applies reproducible rules and preserves the evidence used.',
  },
  {
    id: 'observed',
    name: 'Observed',
    description: 'Supported by runtime evidence such as traces.',
    detail:
      'An execution was seen in a runtime context; this does not by itself prove every execution follows the same path.',
  },
  {
    id: 'corroborated',
    name: 'Corroborated',
    description:
      'Supported by both deterministic analysis and runtime evidence.',
    detail:
      'Source-derived and observed evidence support the same claim and remain independently traceable.',
  },
] as const;

function Panel({
  title,
  eyebrow,
  children,
  className,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border bg-card p-5', className)}>
      {eyebrow && (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
      )}
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function RelationshipNode({
  name,
  type,
}: {
  name: string;
  type: string;
}) {
  const color = RELATIONSHIP_STYLE.DEPENDS_ON.color;
  return (
    <div
      className="rounded-lg border bg-background px-3 py-2 text-center"
      style={{ borderColor: `color-mix(in oklch, ${color} 42%, var(--border))` }}
    >
      <div className="text-sm font-medium">{name}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {type}
      </div>
    </div>
  );
}

function FlowSequence() {
  return (
    <ol className="mt-4 space-y-1.5" aria-label="Proposed ordered flow">
      {flowSteps.map((step, index) => (
        <li key={step} className="flex flex-col items-center">
          <div className="flex w-full items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {step}
            </span>
            {index === 0 ? (
              <Route className="size-3.5 shrink-0 text-primary" />
            ) : null}
          </div>
          {index < flowSteps.length - 1 && (
            <ArrowDown
              className="my-0.5 size-3.5 text-primary/70"
              aria-hidden="true"
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function JourneyColumn({
  title,
  future = false,
  steps,
}: {
  title: string;
  future?: boolean;
  steps: string[];
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border bg-card p-5',
        future && 'border-dashed border-primary/50 bg-primary/[0.035]',
      )}
    >
      <div className="mb-4 flex items-center gap-2">
        <span
          className={cn(
            'flex size-8 items-center justify-center rounded-lg',
            future ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {future ? <Workflow className="size-4" /> : <Network className="size-4" />}
        </span>
        <h3 className="font-semibold">{title}</h3>
        {future && (
          <span className="ml-auto rounded-full border border-primary/40 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
            Proposed direction
          </span>
        )}
      </div>
      <ol className="flex flex-col items-center gap-1.5">
        {steps.map((step, index) => (
          <li key={step} className="flex w-full flex-col items-center">
            <div
              className={cn(
                'flex min-h-9 w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                future
                  ? 'border-primary/20 bg-background'
                  : 'bg-background',
              )}
            >
              <span className="text-muted-foreground">
                {index === 0 ? (
                  <FileCode2 className="size-3.5" />
                ) : index === steps.length - 1 ? (
                  <ShieldCheck className="size-3.5" />
                ) : (
                  <GitFork className="size-3.5" />
                )}
              </span>
              <span className="flex-1 font-medium">{step}</span>
              {future && index === 3 && (
                <span className="text-[9px] uppercase tracking-wider text-primary">
                  Future
                </span>
              )}
            </div>
            {index < steps.length - 1 && (
              <ArrowDown
                className={cn(
                  'my-0.5 size-4',
                  future ? 'text-primary/70' : 'text-muted-foreground/60',
                )}
                aria-hidden="true"
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function BehaviouralFlowVisionScreen() {
  const [selectedBasis, setSelectedBasis] =
    useState<(typeof evidenceBases)[number]['id']>('proven');
  const selected = evidenceBases.find((basis) => basis.id === selectedBasis)!;

  return (
    <div className="space-y-8">
      <ScreenHeader
        eyebrow="Future Architectural Direction · ADR-027"
        title="Behavioural Flow Vision"
        lead={
          <>
            Workspace Brain can explain <em>what depends on what</em> today.
            Behavioural flow modelling is a proposed future capability for
            explaining <em>what happens when an operation executes</em>.
          </>
        }
      >
        <span className="flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <Radio className="size-3.5" />
          Not implemented
        </span>
      </ScreenHeader>

      <section aria-label="Current capability and future direction">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>From dependencies to execution behaviour</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Structural knowledge is current · flows are proposed in ADR-027
          </p>
        </div>
        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          <Panel title="Dependency Graph" eyebrow="Current capability">
            <div className="mt-4 flex justify-center">
              <RelationshipNode name="Service A" type="service" />
            </div>
            <div className="mx-auto my-2 h-5 w-px bg-border" />
            <div className="space-y-2">
              {[
                { name: 'Service B', type: 'service' },
                { name: 'Database', type: 'data store' },
              ].map((target) => (
                <div
                  key={target.name}
                  className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2"
                >
                  <ArrowRight
                    className="size-4 text-primary"
                    style={{ color: RELATIONSHIP_STYLE.DEPENDS_ON.color }}
                    aria-hidden="true"
                  />
                  <span
                    className="font-mono text-[9px] font-semibold"
                    style={{ color: RELATIONSHIP_STYLE.DEPENDS_ON.color }}
                  >
                    DEPENDS_ON
                  </span>
                  <RelationshipNode name={target.name} type={target.type} />
                </div>
              ))}
            </div>
            <p className="mt-5 border-t pt-3 text-sm text-muted-foreground">
              Structural knowledge explains static relationships.
            </p>
          </Panel>

          <Panel
            title="Behavioural Flow"
            eyebrow="Future capability"
            className="relative overflow-hidden border-primary/40"
          >
            <span className="absolute right-4 top-4 rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-[9px] font-bold tracking-wider text-primary">
              PROPOSED · ADR-027
            </span>
            <p className="mt-4 rounded-lg bg-muted/70 px-3 py-2 font-mono text-xs font-semibold">
              POST /agent-relationships
            </p>
            <FlowSequence />
            <p className="mt-4 border-t pt-3 text-sm text-muted-foreground">
              Behavioural knowledge explains what happens when an operation
              executes.
            </p>
          </Panel>

          <Panel title="Provenance" eyebrow="Evidence-backed by design">
            <div className="mt-4 flex flex-col items-center gap-1.5">
              <div className="w-full rounded-lg border bg-background px-3 py-2 text-center text-sm font-medium">
                Flow Step
              </div>
              <ArrowDown className="size-4 text-muted-foreground" />
              <div className="w-full rounded-lg border bg-background px-3 py-2 text-center text-sm font-medium">
                Evidence
              </div>
              <ArrowDown className="size-4 text-muted-foreground" />
              <div className="w-full rounded-lg border bg-background px-3 py-2 text-center text-sm font-medium">
                Source Location
              </div>
            </div>
            <div className="mt-3 space-y-1.5 rounded-lg bg-muted/60 p-3 font-mono text-[11px]">
              <div className="flex items-center gap-2">
                <FileCode2 className="size-3.5 text-primary" />
                <span>RelationshipController</span>
              </div>
              <div className="pl-5 text-muted-foreground">Line 42</div>
              <div className="flex items-center gap-2 pt-1">
                <FileCode2 className="size-3.5 text-primary" />
                <span>AgentConnector#create</span>
              </div>
              <div className="pl-5 text-muted-foreground">Line 118</div>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-[9px] font-bold tracking-wider text-emerald-600 dark:text-emerald-400">
              <Check className="size-3" />
              DETERMINISTIC
            </span>
            <p className="mt-2 text-sm text-muted-foreground">
              Every flow step must be supported by evidence.
            </p>
          </Panel>
        </div>
      </section>

      <section>
        <SectionTitle>Architectural journey</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <JourneyColumn
            title="Today"
            steps={['Repositories', 'Evidence', 'Knowledge Graph', 'Publication']}
          />
          <JourneyColumn
            title="Future"
            future
            steps={[
              'Repositories',
              'Evidence',
              'Knowledge Graph',
              'Behavioural Flows',
              'Publication',
            ]}
          />
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          Flows are a proposed addition to immutable, evidence-backed
          publications—not a delivered publication feature.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Example Parser Pack" eyebrow="Future example">
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-primary">
            <GitBranch className="size-4" />
            HMRC Scala Play
          </div>
          <ol className="mt-4 flex flex-col items-center gap-1">
            {[
              'routes file',
              'Controller',
              'Service',
              'Connector',
              'External API',
              'Database',
            ].map((step, index, allSteps) => (
              <li key={step} className="flex w-full flex-col items-center">
                <div className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className="font-medium">{step}</span>
                  {index === 0 && (
                    <FileCode2 className="ml-auto size-4 text-muted-foreground" />
                  )}
                  {index === allSteps.length - 1 && (
                    <Database className="ml-auto size-4 text-muted-foreground" />
                  )}
                </div>
                {index < allSteps.length - 1 && (
                  <ArrowDown
                    className="my-0.5 size-4 text-primary/70"
                    aria-hidden="true"
                  />
                )}
              </li>
            ))}
          </ol>
          <span className="mt-3 inline-flex rounded-full border border-dashed px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Future Organisation-Specific Parser Pack
          </span>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Parser packs encode organisational architecture conventions and
            convert them into a standard Knowledge Model.
          </p>
        </Panel>

        <Panel
          title="Evidence basis—not confidence scores"
          eyebrow="Future ADR-027 classifications"
        >
          <p className="mt-1 text-xs text-muted-foreground">
            These labels describe how a behavioural claim is supported. They
            are not numeric scores or probabilities.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {evidenceBases.map((basis) => (
              <button
                key={basis.id}
                type="button"
                aria-pressed={selectedBasis === basis.id}
                onClick={() => setSelectedBasis(basis.id)}
                className={cn(
                  'rounded-xl border p-3 text-left transition-colors',
                  selectedBasis === basis.id
                    ? 'border-primary/60 bg-primary/8'
                    : 'bg-background hover:bg-accent/60',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Check className="size-4 text-emerald-500" />
                  {basis.name}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {basis.description}
                </span>
              </button>
            ))}
          </div>
          <div
            className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed"
            aria-live="polite"
          >
            <span className="font-semibold text-primary">
              {selected.name}:
            </span>{' '}
            {selected.detail}
          </div>
        </Panel>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex items-start gap-2 rounded-xl border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
          <Workflow className="mt-0.5 size-4 shrink-0 text-primary" />
          Deterministic source analysis—not AI—is the preferred way to discover
          flows.
        </div>
        <div className="flex items-start gap-2 rounded-xl border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
          <Radio className="mt-0.5 size-4 shrink-0 text-primary" />
          Runtime observations may complement source analysis; they do not
          silently replace it.
        </div>
        <div className="flex items-start gap-2 rounded-xl border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          Evidence, provenance and immutable publication integrity remain
          essential.
        </div>
      </div>

      <KeyMessage className="border-primary/50 bg-primary/10 py-7">
        Workspace Brain is evolving from a dependency graph into an
        evidence-backed behavioural understanding platform.
      </KeyMessage>

      <div className="flex items-center justify-center gap-2 pb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        <GitFork className="size-3.5" />
        <span>Static relationships</span>
        <ArrowRight className="size-3.5" />
        <span>Execution journeys</span>
      </div>
    </div>
  );
}
