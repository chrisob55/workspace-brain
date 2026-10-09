import {
  ArrowDown,
  Boxes,
  Building2,
  Landmark,
  Leaf,
  Puzzle,
  Radio,
} from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';

import { useKnowledgeState } from '@/app-context';
import { KeyMessage, ScreenHeader, SectionTitle } from '@/components/story';
import { distinctRepositories } from '@/lib/knowledge-graph';
import { cn, formatNumber } from '@/lib/utils';

interface Estate {
  id: string;
  estate: string;
  icon: typeof Building2;
  color: string;
  conventions: string[];
  pack: string;
  extractors: string[];
  live?: boolean;
}

const ESTATES: Estate[] = [
  {
    id: 'hmrc',
    estate: 'HMRC Estate',
    icon: Landmark,
    color: '#ef4444',
    conventions: [
      'Scala Play services',
      'conf/*.routes',
      'build.sbt',
      'service manager config',
    ],
    pack: 'HMRC Parser Pack',
    extractors: ['play-routes', 'sbt-dependencies', 'service-manager'],
  },
  {
    id: 'spring',
    estate: 'Spring Estate',
    icon: Leaf,
    color: '#84cc16',
    conventions: [
      '@RestController',
      'pom.xml / build.gradle',
      'application.yml',
      'Helm charts',
    ],
    pack: 'Spring Parser Pack',
    extractors: ['spring-controllers', 'maven-dependencies', 'helm-releases'],
  },
  {
    id: 'banking',
    estate: 'Banking Estate',
    icon: Building2,
    color: '#0ea5e9',
    conventions: [
      'Mainframe interfaces',
      'AsyncAPI events',
      'Terraform',
      'Confluence ADRs',
    ],
    pack: 'Banking Parser Pack',
    extractors: [
      'asyncapi-channels',
      'terraform-modules',
      'confluence-decisions',
    ],
  },
];

const COMMON_VOCABULARY = {
  entities: [
    'repository',
    'package',
    'module',
    'api',
    'operation',
    'document',
    'architectural-decision',
    'container',
  ],
  relationships: ['DEPENDS_ON', 'CONTAINS', 'EXPOSES', 'REFERENCES'],
};

function EstateColumn({
  estate,
  active,
  index,
  onHover,
}: {
  estate: Estate;
  active: boolean;
  index: number;
  onHover: () => void;
}) {
  const Icon = estate.icon;
  const style: CSSProperties = { animationDelay: `${index * 120}ms` };
  return (
    <div
      className="animate-fade-up row-span-4 grid grid-rows-subgrid justify-items-center gap-2"
      style={style}
      onMouseEnter={onHover}
    >
      <div
        className={cn(
          'w-full rounded-2xl border bg-card p-4 transition-all',
          active && 'shadow-xl',
          !estate.live && 'border-dashed',
        )}
        style={{ borderColor: active ? estate.color : undefined }}
      >
        <div className="flex items-center gap-2">
          <span
            className="flex size-9 items-center justify-center rounded-lg"
            style={{ background: `${estate.color}22`, color: estate.color }}
          >
            <Icon className="size-5" />
          </span>
          <div className="font-semibold">{estate.estate}</div>
          {estate.live && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-emerald-500">
              <Radio className="size-3" /> live
            </span>
          )}
        </div>
        <ul className="mt-3 flex flex-wrap gap-1">
          {estate.conventions.map((c) => (
            <li
              key={c}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              {c}
            </li>
          ))}
        </ul>
      </div>
      <FlowArrow color={estate.color} active={active} />
      <div
        className={cn(
          'w-full rounded-2xl border-2 bg-card p-4 transition-all',
          active && 'shadow-xl',
        )}
        style={{ borderColor: `${estate.color}${active ? 'ff' : '66'}` }}
      >
        <div className="flex items-center gap-2 font-semibold">
          <Puzzle className="size-4" style={{ color: estate.color }} />
          {estate.pack}
        </div>
        <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
          {estate.extractors.map((x) => (
            <li key={x}>▸ {x}</li>
          ))}
        </ul>
      </div>
      <FlowArrow color={estate.color} active={active} />
    </div>
  );
}

function FlowArrow({ color, active }: { color: string; active: boolean }) {
  return (
    <div className="relative flex h-10 flex-col items-center">
      <svg width="4" height="30" className="overflow-visible">
        <line
          x1="2"
          y1="0"
          x2="2"
          y2="30"
          stroke={color}
          strokeWidth={active ? 3 : 2}
          className="flow-line"
          opacity={active ? 1 : 0.6}
        />
      </svg>
      <ArrowDown className="-mt-2 size-4" style={{ color }} />
    </div>
  );
}

export function EnterpriseScreen() {
  const { graph } = useKnowledgeState();
  const repositories = distinctRepositories(graph);
  const thisEstate: Estate = {
    id: 'this',
    estate: 'This workspace',
    icon: Boxes,
    color: '#a78bfa',
    conventions: [
      ...repositories,
      'package.json',
      'openapi.ts',
      'docs/adr/*.md',
    ],
    pack: 'TypeScript · OpenAPI · ADR · Markdown',
    extractors: [
      'typescript-dependencies',
      'openapi-operations',
      'architectural-decisions',
      'markdown-references',
    ],
    live: true,
  };
  const estates = [thisEstate, ...ESTATES];
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(
      () => setActive((i) => (i + 1) % estates.length),
      2600,
    );
    return () => window.clearInterval(timer);
  }, [paused, estates.length]);

  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Enterprise Scaling"
        title="Different estates. One Knowledge Model."
        lead="Every organisation encodes architecture in its own conventions. A parser pack translates those conventions into the shared vocabulary — everything downstream stays the same."
      />

      <div
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {estates.map((estate, i) => (
          <EstateColumn
            key={estate.id}
            estate={estate}
            active={active === i}
            index={i}
            onHover={() => setActive(i)}
          />
        ))}
      </div>

      <div className="relative overflow-hidden rounded-3xl border-2 border-primary bg-card p-6 shadow-2xl">
        <div className="hero-gradient pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
          <div className="flex items-center gap-4">
            <span className="flex size-14 animate-glow items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Boxes className="size-7" />
            </span>
            <div>
              <div className="text-xl font-semibold">
                Workspace Brain Knowledge Model
              </div>
              <div className="text-sm text-muted-foreground">
                One vocabulary · one provenance contract · immutable
                publications
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {COMMON_VOCABULARY.entities.map((e) => (
                <span
                  key={e}
                  className="rounded-md border bg-background/60 px-2 py-0.5 font-mono text-xs"
                >
                  {e}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_VOCABULARY.relationships.map((r) => (
                <span
                  key={r}
                  className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <section>
        <SectionTitle>What stays the same across every estate</SectionTitle>
        <div className="grid gap-3 md:grid-cols-4">
          {[
            [
              'Publications',
              'Immutable, versioned snapshots of the same shape.',
            ],
            [
              'Provenance',
              'Every fact names its file, lines, extractor and version.',
            ],
            [
              'Currency',
              'The same check tells you when a publication is stale.',
            ],
            [
              'Exploration',
              `This explorer works unchanged — today it shows ${formatNumber(graph.meta.entityCount)} entities.`,
            ],
          ].map(([title, text]) => (
            <div key={title} className="rounded-xl border bg-card p-4">
              <div className="font-semibold">{title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          HMRC, Spring and Banking packs are illustrative — they are not built
          yet. Only this workspace&apos;s packs are live.
        </p>
      </section>

      <KeyMessage>
        Organisation-specific architecture becomes a common Knowledge Model.
      </KeyMessage>
    </div>
  );
}
