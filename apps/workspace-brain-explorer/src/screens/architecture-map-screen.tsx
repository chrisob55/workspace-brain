import {
  ArrowDown,
  ArrowRight,
  Boxes,
  Braces,
  CircleCheck,
  Database,
  FileCode2,
  FileSearch,
  GitBranch,
  HardDrive,
  Network,
  Radio,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useState } from 'react';

import { KeyMessage, ScreenHeader, SectionTitle } from '@/components/story';
import { cn } from '@/lib/utils';

type ArchitectureNode = {
  id: string;
  step: string;
  title: string;
  technology: string;
  description: string;
  icon: LucideIcon;
  color: string;
};

const FLOW: ArchitectureNode[] = [
  {
    id: 'sources',
    step: '01 · SOURCE EDGE',
    title: 'Your workspace',
    technology: 'Filesystem · Git repositories',
    description:
      'Configured folders are mounted read-only. The original files and repositories remain authoritative; Workspace Brain never edits them.',
    icon: FileCode2,
    color: '#34d399',
  },
  {
    id: 'ingestion',
    step: '02 · DISCOVERY',
    title: 'Ingestion worker',
    technology: 'Node.js · TypeScript',
    description:
      'Scans files deterministically, fingerprints content with SHA-256, identifies changes, and submits inventory through the internal event interface.',
    icon: FileSearch,
    color: '#22d3ee',
  },
  {
    id: 'events',
    step: '03 · EVENT BACKBONE',
    title: 'NATS JetStream',
    technology: 'Durable events · request/reply',
    description:
      'Carries small, versioned facts between services and buffers asynchronous work. It is transport, not the database or the source of truth.',
    icon: Radio,
    color: '#a78bfa',
  },
  {
    id: 'catalogue',
    step: '04 · AUTHORITY',
    title: 'API + catalogue',
    technology: 'Fastify · DuckDB',
    description:
      'The API is the sole DuckDB writer. It owns inventory, document versions, evidence, knowledge state, search projections, and publication records.',
    icon: Database,
    color: '#818cf8',
  },
  {
    id: 'publication',
    step: '05 · CONTRACT',
    title: 'Knowledge Model',
    technology: 'Versioned · immutable · portable',
    description:
      'A validated publication captures a precise, content-hashed snapshot. Consumers can pin a version and trace claims back to source evidence.',
    icon: Boxes,
    color: '#f59e0b',
  },
  {
    id: 'consumers',
    step: '06 · CONSUMPTION',
    title: 'Explorer + AI OS',
    technology: 'OpenAPI · read-only',
    description:
      'The Explorer explains and explores published knowledge. AI OS may consume the same contract; neither consumer reaches into storage internals.',
    icon: Search,
    color: '#f472b6',
  },
];

const TECHNOLOGIES = [
  {
    name: 'TypeScript + Node.js',
    role: 'One language across API, workers, domain packages, and tooling.',
    state: 'Runtime',
    icon: Braces,
  },
  {
    name: 'pnpm + Turborepo',
    role: 'Workspace packages share contracts while apps keep clear boundaries.',
    state: 'Build system',
    icon: GitBranch,
  },
  {
    name: 'NATS JetStream',
    role: 'Durable internal events; asynchronous work can resume after interruption.',
    state: 'Event transport',
    icon: Radio,
  },
  {
    name: 'DuckDB',
    role: 'Embedded authoritative catalogue, owned and written only by the API.',
    state: 'System of record',
    icon: Database,
  },
  {
    name: 'OpenAPI + Zod',
    role: 'Typed HTTP contracts and runtime validation at system boundaries.',
    state: 'Contracts',
    icon: Workflow,
  },
  {
    name: 'React + Vite',
    role: 'The Explorer UI, consuming publication data rather than storage.',
    state: 'Explorer',
    icon: Sparkles,
  },
];

const OPTIONAL_CAPABILITIES = [
  {
    name: 'Qdrant',
    role: 'Semantic-search projection; rebuildable and not authoritative.',
    icon: Network,
  },
  {
    name: 'Ollama',
    role: 'Local model runtime; AI is optional and never establishes facts.',
    icon: Server,
  },
];

const SUPPORTING_STORES = [
  {
    title: 'Processed artefacts',
    text: 'Normalised document content can be regenerated from source.',
    icon: HardDrive,
  },
  {
    title: 'Search projection',
    text: 'Search indexes are derived views; losing one does not lose knowledge.',
    icon: Search,
  },
  {
    title: 'Published snapshots',
    text: 'Immutable outputs are identified by version and content hash.',
    icon: CircleCheck,
  },
];

export function ArchitectureMapScreen() {
  const [selectedId, setSelectedId] = useState('catalogue');
  const selected = FLOW.find((node) => node.id === selectedId) ?? FLOW[3]!;
  const SelectedIcon = selected.icon;

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <div className="hero-gradient -mx-5 -mt-8 px-5 pb-2 pt-10 md:-mx-8 md:px-8">
        <ScreenHeader
          eyebrow="Technical Architecture · A guided system map"
          title={
            <>
              From source files to{' '}
              <span className="text-gradient">trustworthy knowledge</span>
            </>
          }
          lead="Think of Workspace Brain as an evidence foundry: it watches sources without touching them, turns changes into traceable knowledge, then hands consumers a sealed, versioned snapshot."
        />
      </div>

      <KeyMessage>
        Sources stay yours. Events keep the work moving. The catalogue owns
        state. Publications are the only knowledge contract consumers need.
      </KeyMessage>

      <section aria-labelledby="system-map">
        <h2
          id="system-map"
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Follow one change through the system
        </h2>
        <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
          Select a station to see its job and the boundary it protects. On small
          screens, the same journey reads from top to bottom.
        </p>
        <div className="rounded-2xl border bg-card p-4 md:p-6">
          <ol className="grid gap-2 md:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)_2rem_minmax(0,1fr)_2rem_minmax(0,1fr)_2rem_minmax(0,1fr)_2rem_minmax(0,1fr)] md:items-stretch">
            {FLOW.map((node, index) => {
              const Icon = node.icon;
              const active = node.id === selectedId;
              return (
                <Fragment key={node.id}>
                  <li className="min-w-0">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedId(node.id)}
                      className={cn(
                        'group flex h-full min-h-28 w-full items-start gap-3 rounded-xl border bg-background p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md md:flex-col md:gap-2',
                        active && 'border-primary ring-2 ring-primary/20',
                      )}
                    >
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          background: `color-mix(in oklch, ${node.color} 18%, transparent)`,
                          color: node.color,
                        }}
                      >
                        <Icon className="size-4.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[10px] font-semibold tracking-wider text-muted-foreground">
                          {node.step}
                        </span>
                        <span className="mt-1 block text-sm font-semibold leading-tight">
                          {node.title}
                        </span>
                        <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                          {node.technology}
                        </span>
                      </span>
                    </button>
                  </li>
                  {index < FLOW.length - 1 && (
                    <li
                      className="flex h-7 items-center justify-center text-muted-foreground md:h-auto"
                      aria-hidden
                    >
                      <ArrowDown className="size-4 md:hidden" />
                      <ArrowRight className="hidden size-4 md:block" />
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ol>

          <div
            key={selected.id}
            className="mt-4 flex animate-fade-up items-start gap-3 rounded-xl border bg-muted/40 p-4"
            aria-live="polite"
          >
            <span
              className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: `color-mix(in oklch, ${selected.color} 18%, transparent)`,
                color: selected.color,
              }}
            >
              <SelectedIcon className="size-4.5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">{selected.title}</h3>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {selected.description}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
            <div className="rounded-lg border border-dashed p-3">
              <p className="text-xs font-semibold">Knowledge worker</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Subscribes to document work, runs processors and deterministic
                extractors, then returns evidence through the catalogue
                contract.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <ArrowRight className="size-3.5" />
              NATS events
              <ArrowRight className="size-3.5" />
            </div>
            <div className="rounded-lg border border-dashed p-3">
              <p className="text-xs font-semibold">API-owned catalogue</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Workers request changes through explicit interfaces; they do not
                open DuckDB or write around its owner.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>What each technology is doing here</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {TECHNOLOGIES.map((technology) => {
            const Icon = technology.icon;
            return (
              <article
                key={technology.name}
                className="rounded-xl border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{technology.name}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {technology.role}
                    </p>
                    <span className="mt-3 inline-flex rounded-full bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {technology.state}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <SectionTitle>Keep the record; rebuild the projections</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            {SUPPORTING_STORES.map((store) => {
              const Icon = store.icon;
              return (
                <article
                  key={store.title}
                  className="rounded-xl border bg-card p-4"
                >
                  <Icon className="mb-3 size-5 text-primary" />
                  <h3 className="text-sm font-semibold">{store.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {store.text}
                  </p>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="rounded-xl border border-dashed bg-card/60 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">
              Optional local intelligence
            </h2>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            The Compose topology includes these services, but deterministic
            discovery and publication do not depend on AI or vector search.
            Treat them as optional capabilities, not hidden sources of truth.
          </p>
          <div className="space-y-3">
            {OPTIONAL_CAPABILITIES.map((capability) => {
              const Icon = capability.icon;
              return (
                <div key={capability.name} className="flex gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-semibold">{capability.name}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {capability.role}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </section>

      <section className="rounded-2xl border bg-card p-5 md:p-6">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="size-5 text-emerald-500" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            The boundaries that make it trustworthy
          </h2>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Boundary
            title="Read-only sources"
            text="Discovery observes; it never mutates your repositories."
          />
          <Boundary
            title="Evidence before assertion"
            text="Knowledge links back to a source version and precise location."
          />
          <Boundary
            title="One writer"
            text="Only the API owns writes to the authoritative DuckDB catalogue."
          />
          <Boundary
            title="AI proposes, never promotes"
            text="Model output is a candidate, not established truth."
          />
        </div>
      </section>
    </div>
  );
}

function Boundary({ title, text }: { title: string; text: string }) {
  return (
    <div className="border-l-2 border-primary/30 pl-3">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {text}
      </p>
    </div>
  );
}
