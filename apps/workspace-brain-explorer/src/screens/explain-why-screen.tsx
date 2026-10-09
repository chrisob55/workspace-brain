import {
  Braces,
  FileCode,
  Fingerprint,
  Layers,
  ListOrdered,
  Microscope,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { useKnowledgeState } from '@/app-context';
import { EntityChip } from '@/components/chips';
import { EvidenceExcerpt } from '@/components/evidence-panel';
import { KeyMessage, ScreenHeader } from '@/components/story';
import {
  describeLocator,
  displayPath,
  extractorOf,
  findFact,
  toFact,
  type Fact,
  type KnowledgeGraph,
} from '@/lib/knowledge-graph';
import { RELATIONSHIP_STYLE } from '@/lib/palette';
import { useEvidence } from '@/lib/queries';
import { cn, shortHash } from '@/lib/utils';

function featuredFacts(graph: KnowledgeGraph): Fact[] {
  const candidates = [
    findFact(
      graph,
      'README.md',
      'REFERENCES',
      'ADR-026',
      'workspace-brain/README.md',
    ),
    findFact(
      graph,
      'Workspace Brain API',
      'EXPOSES',
      'exportKnowledgePublication',
    ),
    findFact(graph, 'README.md', 'REFERENCES', 'ADR-025'),
    findFact(graph, 'workspace-brain', 'CONTAINS', '@workspace-brain/domain'),
    findFact(
      graph,
      '@workspace-brain/workspace-brain-api',
      'DEPENDS_ON',
      '@workspace-brain/domain-publication',
    ),
  ];
  const facts = candidates.filter((fact): fact is Fact => fact !== undefined);
  for (const type of [
    'REFERENCES',
    'EXPOSES',
    'CONTAINS',
    'DEPENDS_ON',
  ] as const) {
    if (!facts.some((f) => f.relationship.type === type)) {
      const rel = graph.relationships.find((r) => r.type === type);
      const fact = rel && toFact(graph, rel);
      if (fact) facts.push(fact);
    }
  }
  return facts;
}

function Step({
  index,
  icon: Icon,
  title,
  color,
  children,
  last = false,
}: {
  index: number;
  icon: LucideIcon;
  title: string;
  color: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <li
      className="animate-fade-up relative flex gap-4"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex flex-col items-center">
        <span
          className="z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2 bg-background"
          style={{ borderColor: color, color }}
        >
          <Icon className="size-4.5" />
        </span>
        {!last && (
          <svg
            className="w-2 flex-1"
            preserveAspectRatio="none"
            viewBox="0 0 8 100"
            aria-hidden
          >
            <line
              x1="4"
              y1="0"
              x2="4"
              y2="100"
              stroke={color}
              strokeWidth="2"
              className="flow-line"
            />
          </svg>
        )}
      </div>
      <div className={cn('min-w-0 flex-1', !last && 'pb-6')}>
        <div className="mb-1.5 flex items-center gap-2 pt-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {index}
          </span>
          <h3 className="font-semibold">{title}</h3>
        </div>
        {children}
      </div>
    </li>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
      {children}
    </span>
  );
}

export function ExplainWhyScreen() {
  const { graph, source } = useKnowledgeState();
  const facts = useMemo(() => featuredFacts(graph), [graph]);
  const [factIndex, setFactIndex] = useState(0);
  const [provIndex, setProvIndex] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const fact = facts[factIndex];
  const item =
    fact?.relationship.provenance[
      Math.min(provIndex, fact.relationship.provenance.length - 1)
    ];
  const evidence = useEvidence(item?.evidenceId, source === 'live');

  if (!fact || !item) {
    return (
      <p className="text-muted-foreground">
        No relationships are published yet.
      </p>
    );
  }
  const color = RELATIONSHIP_STYLE[fact.relationship.type].color;

  return (
    <div className="space-y-8">
      <ScreenHeader
        eyebrow="Explain Why"
        title="Every fact can be traced back to evidence"
        lead="Pick a published fact and follow its provenance: from the relationship, to the exact source lines, to the extractor that produced it, to the immutable publication that contains it."
      />

      <div className="flex flex-wrap gap-2">
        {facts.map((f, i) => (
          <button
            key={f.relationship.id}
            type="button"
            onClick={() => {
              setFactIndex(i);
              setProvIndex(0);
            }}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              i === factIndex
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f.source.name.split('/').pop()} · {f.relationship.type} ·{' '}
            {f.target.name.split('/').pop()}
          </button>
        ))}
      </div>

      <div className="hero-gradient flex flex-col items-center gap-4 rounded-2xl border bg-card p-8 md:flex-row md:justify-center md:gap-0">
        <EntityChip entity={fact.source} size="lg" />
        <div className="flex flex-col items-center px-4">
          <span
            className="font-mono text-sm font-bold tracking-wider"
            style={{ color }}
          >
            {fact.relationship.type}
          </span>
          <svg className="h-6 w-40" viewBox="0 0 160 24" aria-hidden>
            <line
              x1="4"
              y1="12"
              x2="148"
              y2="12"
              stroke={color}
              strokeWidth="2.5"
              className="flow-line"
            />
            <path
              d="M146 5 L156 12 L146 19"
              fill="none"
              stroke={color}
              strokeWidth="2.5"
            />
          </svg>
          <span className="text-xs text-muted-foreground">
            confidence {fact.relationship.confidence} ·{' '}
            {fact.relationship.provenance.length} supporting evidence
          </span>
        </div>
        <EntityChip entity={fact.target} size="lg" />
      </div>

      {fact.relationship.provenance.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Supporting evidence:</span>
          {fact.relationship.provenance.map((prov, i) => (
            <button
              key={prov.evidenceId}
              type="button"
              onClick={() => setProvIndex(i)}
              className={cn(
                'rounded-md border px-2 py-0.5',
                i === provIndex
                  ? 'border-primary bg-primary/10'
                  : 'text-muted-foreground',
              )}
            >
              {displayPath(prov.documentPath).split('/').slice(-2).join('/')} ·{' '}
              {describeLocator(prov)}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <ol key={`${fact.relationship.id}:${item.evidenceId}`}>
          <Step index={1} icon={FileCode} title="Source file" color="#34d399">
            <p className="text-sm">
              <Mono>{displayPath(item.documentPath)}</Mono>
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Fingerprint className="size-3.5" /> Document version{' '}
              <span className="font-mono">{item.documentVersionId}</span> ·
              sha256:
              <span className="font-mono">
                {shortHash(item.contentFingerprint, 16)}…
              </span>
            </p>
          </Step>
          <Step
            index={2}
            icon={ListOrdered}
            title="Source lines"
            color="#22d3ee"
          >
            <p className="text-sm">
              {describeLocator(item)}
              {item.locator.kind !== 'json-pointer' &&
              item.locator.headingPath?.length ? (
                <span className="text-muted-foreground">
                  {' '}
                  under “{item.locator.headingPath.join(' › ')}”
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Locator kind: {item.locator.kind}
            </p>
          </Step>
          <Step index={3} icon={Microscope} title="Evidence" color="#a78bfa">
            {evidence.data && (
              <p className="mb-2 text-xs text-muted-foreground">
                {evidence.data.evidence.kind} · key{' '}
                <span className="font-mono">{evidence.data.evidence.key}</span>
              </p>
            )}
            <EvidenceExcerpt item={item} />
          </Step>
          <Step index={4} icon={Workflow} title="Extractor" color="#fb923c">
            <p className="text-sm">
              <Mono>
                {extractorOf(item)}
                {item.knowledgeExtractorVersion !== undefined &&
                  ` v${item.knowledgeExtractorVersion}`}
              </Mono>
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Processor{' '}
              <span className="font-mono">
                {item.processorId} v{item.processorVersion}
              </span>{' '}
              applied rule{' '}
              <span className="font-mono">
                {item.extractionRuleId} v{item.extractionRuleVersion}
              </span>
              . Deterministic: the same evidence always yields the same fact.
            </p>
          </Step>
          <Step index={5} icon={Layers} title="Publication" color="#f59e0b">
            <p className="text-sm">
              Published in Knowledge Model version{' '}
              <strong>v{graph.meta.version}</strong>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-mono">{graph.meta.publicationId}</span> ·
              content sha256:
              <span className="font-mono">
                {shortHash(graph.meta.contentHash, 16)}…
              </span>{' '}
              · immutable
            </p>
          </Step>
          <Step
            index={6}
            icon={Braces}
            title="Provenance record"
            color="#f472b6"
            last
          >
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? 'Hide' : 'Show'} the provenance exactly as published
            </button>
            {showRaw && (
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(item, null, 2)}
              </pre>
            )}
          </Step>
        </ol>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:h-fit">
          <div className="rounded-xl border bg-card p-5">
            <h3 className="mb-2 font-semibold">What this proves</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>✓ The fact came from a specific version of a real file.</li>
              <li>
                ✓ It points at exact lines (or a JSON pointer), not a whole
                document.
              </li>
              <li>
                ✓ A named, versioned extractor produced it — no AI inference.
              </li>
              <li>✓ It belongs to an immutable, content-hashed publication.</li>
            </ul>
          </div>
          <div className="rounded-xl border bg-card p-5 text-xs text-muted-foreground">
            Served by{' '}
            <span className="font-mono">
              GET /knowledge/publications/…/relationships/…/provenance
            </span>{' '}
            and <span className="font-mono">GET /evidence/…/explanation</span>.
          </div>
        </aside>
      </div>

      <KeyMessage>Every fact can be traced back to evidence.</KeyMessage>
    </div>
  );
}
