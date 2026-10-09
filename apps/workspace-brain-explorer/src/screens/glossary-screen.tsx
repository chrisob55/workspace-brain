import {
  BookMarked,
  Boxes,
  CircleDot,
  Clock,
  FileSearch,
  GitFork,
  Lock,
  Microscope,
  Package,
  Puzzle,
  Route,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { useKnowledgeState } from '@/app-context';
import { EntityChip, RelationshipPill } from '@/components/chips';
import { EvidenceExcerpt } from '@/components/evidence-panel';
import { KeyMessage, ScreenHeader } from '@/components/story';
import {
  describeLocator,
  displayPath,
  extractorContributions,
  findFact,
  RELATIONSHIP_TYPES,
  toFact,
  type Fact,
  type KnowledgeGraph,
} from '@/lib/knowledge-graph';
import { useCurrency } from '@/lib/queries';
import type { KnowledgeEntity } from '@/lib/types';
import { cn, formatNumber, shortHash } from '@/lib/utils';

interface Concept {
  id: string;
  term: string;
  icon: LucideIcon;
  color: string;
  question?: string;
  definition: string;
  examples?: string[];
  details?: ReactNode;
  Diagram: (props: { graph: KnowledgeGraph }) => ReactNode;
}

function FactRow({ fact }: { fact: Fact }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EntityChip entity={fact.source} size="sm" />
      <RelationshipPill type={fact.relationship.type} />
      <EntityChip entity={fact.target} size="sm" />
    </div>
  );
}

function sampleFacts(graph: KnowledgeGraph): Fact[] {
  return RELATIONSHIP_TYPES.flatMap((type) => {
    const preferred: Record<string, [string, string]> = {
      CONTAINS: ['workspace-brain', ''],
      EXPOSES: ['Workspace Brain API', 'exportKnowledgePublication'],
      REFERENCES: ['README.md', 'ADR-026'],
    };
    const [sourceName, targetName] = preferred[type] ?? ['', ''];
    const fact =
      (targetName && findFact(graph, sourceName, type, targetName)) ||
      graph.relationships
        .filter((rel) => rel.type === type)
        .map((rel) => toFact(graph, rel))
        .find((f) => f && (!sourceName || f.source.name === sourceName));
    return fact ? [fact] : [];
  });
}

function referenceFact(graph: KnowledgeGraph): Fact | undefined {
  return (
    findFact(
      graph,
      'README.md',
      'REFERENCES',
      'ADR-026',
      'workspace-brain/README.md',
    ) ?? findFact(graph, 'README.md', 'REFERENCES', 'ADR-026')
  );
}

const CURRENCY_STATES = [
  {
    value: 'CURRENT',
    color: '#10b981',
    meaning:
      'Every supporting document is still the version the catalogue treats as current.',
  },
  {
    value: 'STALE',
    color: '#f59e0b',
    meaning:
      'A supporting document has changed since publishing — its content or how it is processed.',
  },
  {
    value: 'UNKNOWN',
    color: '#94a3b8',
    meaning:
      'Currency cannot be decided — the document was removed or its current version cannot be resolved.',
  },
] as const;

const CONCEPTS: Concept[] = [
  {
    id: 'knowledge-model',
    term: 'Knowledge Model',
    question: 'What does Workspace Brain know?',
    icon: Boxes,
    color: '#818cf8',
    definition: 'A versioned representation of discovered knowledge.',
    Diagram: ({ graph }) => (
      <div className="relative h-28">
        {[3, 2, 1, 0].map((i) => (
          <div
            key={i}
            className="absolute flex h-16 w-48 items-center justify-center rounded-lg border bg-card font-mono text-xs shadow-sm"
            style={{
              left: `${i * 18}px`,
              top: `${(3 - i) * 10}px`,
              opacity: 1 - i * 0.2,
              borderColor: i === 0 ? '#818cf8' : undefined,
            }}
          >
            {i === 0
              ? `v${graph.meta.version} · latest`
              : `v${graph.meta.version - i}`}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'publication',
    term: 'Publication',
    question: 'Which version of the knowledge am I looking at?',
    icon: BookMarked,
    color: '#f59e0b',
    definition: 'An immutable snapshot of a Knowledge Model.',
    Diagram: ({ graph }) => (
      <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
        <Lock className="size-8 text-amber-500" />
        <div className="font-mono text-xs leading-relaxed">
          <div>publication v{graph.meta.version}</div>
          <div className="text-muted-foreground">
            {formatNumber(graph.meta.entityCount)} entities ·{' '}
            {formatNumber(graph.meta.relationshipCount)} relationships
          </div>
          <div className="text-muted-foreground">
            sha256:{shortHash(graph.meta.contentHash, 16)}…
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'entity',
    term: 'Entity',
    question: 'What things does it know about?',
    icon: Package,
    color: '#34d399',
    definition: 'A known thing.',
    examples: ['Repository', 'Package', 'API', 'ADR'],
    Diagram: ({ graph }) => {
      const pick = (type: string, name?: string) =>
        graph.entities.find(
          (e) => e.type === type && (!name || e.name === name),
        );
      const items = [
        pick('repository', 'workspace-brain'),
        pick('package', '@workspace-brain/domain') ?? pick('package'),
        pick('api', 'Workspace Brain API'),
        pick('architectural-decision', 'ADR-026'),
      ].filter((e): e is KnowledgeEntity => e !== undefined);
      return (
        <div className="flex flex-wrap gap-2">
          {items.map((entity) => (
            <EntityChip key={entity.id} entity={entity} size="sm" />
          ))}
        </div>
      );
    },
  },
  {
    id: 'relationship',
    term: 'Relationship',
    question: 'How are those things connected?',
    icon: GitFork,
    color: '#f472b6',
    definition: 'A connection between two entities.',
    examples: ['DEPENDS_ON', 'CONTAINS', 'EXPOSES', 'REFERENCES'],
    Diagram: ({ graph }) => (
      <div className="space-y-2">
        {sampleFacts(graph).map((fact) => (
          <FactRow key={fact.relationship.id} fact={fact} />
        ))}
      </div>
    ),
  },
  {
    id: 'evidence',
    term: 'Evidence',
    question: 'What is this fact based on?',
    icon: Microscope,
    color: '#a78bfa',
    definition: 'A source fragment that supports knowledge.',
    Diagram: ({ graph }) => {
      const fact = referenceFact(graph);
      const item = fact?.relationship.provenance[0];
      if (!item) return null;
      return (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{displayPath(item.documentPath)}</span>{' '}
            · {describeLocator(item)}
          </div>
          <EvidenceExcerpt item={item} className="max-h-40" />
        </div>
      );
    },
  },
  {
    id: 'provenance',
    term: 'Provenance',
    question: 'Where did this fact come from?',
    icon: Route,
    color: '#22d3ee',
    definition: 'The record explaining where knowledge came from.',
    Diagram: ({ graph }) => {
      const fact = referenceFact(graph);
      const item = fact?.relationship.provenance[0];
      if (!fact || !item) return null;
      const chain = [
        {
          label: 'Fact',
          value: `${fact.source.name} REFERENCES ${fact.target.name}`,
        },
        { label: 'Evidence', value: `${describeLocator(item)}` },
        { label: 'Document', value: displayPath(item.documentPath) },
        {
          label: 'Extractor',
          value: `${item.knowledgeExtractorId ?? item.extractionRuleId}`,
        },
        { label: 'Publication', value: `v${graph.meta.version}` },
      ];
      return (
        <ol className="space-y-1">
          {chain.map((link) => (
            <li key={link.label} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 text-muted-foreground">
                {link.label}
              </span>
              <span className="truncate rounded bg-muted px-2 py-0.5 font-mono">
                {link.value}
              </span>
            </li>
          ))}
        </ol>
      );
    },
  },
  {
    id: 'currency',
    term: 'Currency',
    icon: Clock,
    color: '#10b981',
    question: 'How current is this publication?',
    definition:
      'Whether a publication still matches the latest source documents.',
    examples: CURRENCY_STATES.map((s) => s.value),
    details: <CurrencyStates />,
    Diagram: CurrencyDiagram,
  },
  {
    id: 'extractor',
    term: 'Extractor',
    question: 'How does content become knowledge?',
    icon: Workflow,
    color: '#fb923c',
    definition:
      'A deterministic component that converts content into knowledge.',
    Diagram: ({ graph }) => {
      const contributions = extractorContributions(graph).slice(0, 5);
      return (
        <ul className="space-y-1.5">
          {contributions.map((c) => (
            <li
              key={c.extractorId}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="truncate font-mono">{c.extractorId}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {c.entities + c.relationships} facts
              </span>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'parser-pack',
    term: 'Parser Pack',
    question: 'How does it understand my organisation?',
    icon: Puzzle,
    color: '#e879f9',
    definition:
      'A collection of extractors that understand the engineering conventions of a specific organisation.',
    Diagram: () => (
      <div className="rounded-xl border-2 border-dashed border-fuchsia-400/50 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fuchsia-400">
          e.g. HMRC Scala Play pack
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            'routes → operations',
            'build.sbt → dependencies',
            'app.conf → services',
            'ADRs',
          ].map((x) => (
            <span
              key={x}
              className="rounded-md bg-muted px-2 py-1 font-mono text-[11px]"
            >
              {x}
            </span>
          ))}
        </div>
      </div>
    ),
  },
];

function CurrencyStates() {
  return (
    <ul className="space-y-2">
      {CURRENCY_STATES.map((s) => (
        <li key={s.value} className="flex gap-2.5 text-sm">
          <span
            className="mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold"
            style={{
              background: `color-mix(in oklch, ${s.color} 18%, transparent)`,
              color: s.color,
            }}
          >
            {s.value}
          </span>
          <span className="text-muted-foreground">{s.meaning}</span>
        </li>
      ))}
    </ul>
  );
}

function CurrencyDiagram({ graph }: { graph: KnowledgeGraph }) {
  const { source } = useKnowledgeState();
  const currency = useCurrency(graph.meta.publicationId, source === 'live');
  if (!currency.data) {
    return (
      <p className="text-xs text-muted-foreground">
        {source === 'live'
          ? 'Checking currency…'
          : 'Currency is calculated live by the API against the catalogue.'}
      </p>
    );
  }
  const c = currency.data;
  const total =
    c.currentEntities +
      c.staleEntities +
      c.unknownEntities +
      c.currentRelationships +
      c.staleRelationships +
      c.unknownRelationships || 1;
  const current = c.currentEntities + c.currentRelationships;
  const stale = c.staleEntities + c.staleRelationships;
  const unknown = c.unknownEntities + c.unknownRelationships;
  const counts = { CURRENT: current, STALE: stale, UNKNOWN: unknown };
  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {CURRENCY_STATES.map((s) => (
          <div
            key={s.value}
            style={{
              width: `${(counts[s.value] / total) * 100}%`,
              background: s.color,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {CURRENCY_STATES.map((s) => (
          <span key={s.value} className="inline-flex items-center gap-1.5">
            <CircleDot className="size-3" style={{ color: s.color }} />
            {formatNumber(counts[s.value])} {s.value.toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

export function GlossaryScreen() {
  const { graph } = useKnowledgeState();
  const [selected, setSelected] = useState<string>('knowledge-model');
  const concept = useMemo(
    () => CONCEPTS.find((c) => c.id === selected)!,
    [selected],
  );
  const Icon = concept.icon;

  return (
    <div className="space-y-8">
      <ScreenHeader
        eyebrow="Glossary & Concepts"
        title="Nine ideas explain the whole platform"
        lead="Select a concept to see it illustrated with real knowledge from the current publication."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,26rem)]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CONCEPTS.map((c, i) => {
            const CIcon = c.icon;
            const active = c.id === selected;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c.id)}
                style={{ animationDelay: `${i * 40}ms` }}
                className={cn(
                  'animate-fade-up group flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg',
                  active && 'shadow-lg',
                )}
                {...(active
                  ? { 'aria-pressed': true }
                  : { 'aria-pressed': false })}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-9 items-center justify-center rounded-lg"
                    style={{
                      background: `color-mix(in oklch, ${c.color} 18%, transparent)`,
                      color: c.color,
                      boxShadow: active ? `0 0 0 2px ${c.color}` : undefined,
                    }}
                  >
                    <CIcon className="size-4.5" />
                  </span>
                  <span className="font-semibold">{c.term}</span>
                </div>
                <div className="space-y-1 text-sm">
                  {c.question && (
                    <p className="font-medium text-foreground">{c.question}</p>
                  )}
                  <p className="text-muted-foreground">{c.definition}</p>
                </div>
                {c.examples && (
                  <div className="flex flex-wrap gap-1">
                    {c.examples.map((x) => (
                      <span
                        key={x}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {x}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <aside
          key={concept.id}
          className="animate-fade-up h-fit rounded-xl border bg-card p-6 lg:sticky lg:top-4"
          style={{
            borderColor: `color-mix(in oklch, ${concept.color} 45%, var(--border))`,
          }}
        >
          <div className="mb-4 flex items-center gap-3">
            <span
              className="flex size-11 items-center justify-center rounded-xl"
              style={{
                background: `color-mix(in oklch, ${concept.color} 18%, transparent)`,
                color: concept.color,
              }}
            >
              <Icon className="size-5" />
            </span>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Concept
              </div>
              <h2 className="text-xl font-semibold">{concept.term}</h2>
            </div>
          </div>
          {concept.question && (
            <p className="mb-1 text-lg font-medium">{concept.question}</p>
          )}
          <p className="mb-5 text-base">{concept.definition}</p>
          {concept.details && <div className="mb-5">{concept.details}</div>}
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <FileSearch className="size-3.5" /> In this publication
          </div>
          <concept.Diagram graph={graph} />
        </aside>
      </div>

      <KeyMessage>
        Entities and relationships are <em>facts</em>; evidence and provenance
        make every fact explainable; publications make them stable; currency
        tells you when to refresh.
      </KeyMessage>
    </div>
  );
}
