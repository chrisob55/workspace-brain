import {
  ArrowRight,
  BookMarked,
  Boxes,
  FileText,
  FolderGit2,
  GitFork,
  Layers,
  Microscope,
  Radar,
  ScanSearch,
  ShieldCheck,
  Telescope,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useKnowledgeState, useNavigation } from '@/app-context';
import { Pipeline, type PipelineStep } from '@/components/pipeline';
import { Stat } from '@/components/stat';
import { KeyMessage, ScreenHeader, SectionTitle } from '@/components/story';
import { Button } from '@/components/ui/button';
import {
  countBy,
  distinctRepositories,
  distinctSourceDocuments,
  relationshipBreakdown,
} from '@/lib/knowledge-graph';
import { entityStyle, RELATIONSHIP_STYLE } from '@/lib/palette';
import { useCurrency, useInventoryCounts } from '@/lib/queries';
import type { RelationshipType } from '@/lib/types';
import { formatNumber, shortHash } from '@/lib/utils';

const STEPS: PipelineStep[] = [
  {
    label: 'Repositories',
    caption: 'Read-only sources',
    icon: FolderGit2,
    color: '#34d399',
  },
  {
    label: 'Discovery',
    caption: 'Deterministic scan',
    icon: Radar,
    color: '#22d3ee',
  },
  {
    label: 'Evidence',
    caption: 'Located source fragments',
    icon: Microscope,
    color: '#a78bfa',
  },
  {
    label: 'Knowledge',
    caption: 'Entities & relationships',
    icon: Boxes,
    color: '#818cf8',
  },
  {
    label: 'Publication',
    caption: 'Immutable snapshot',
    icon: BookMarked,
    color: '#f59e0b',
  },
  {
    label: 'Exploration',
    caption: 'Search, explain, diff',
    icon: Telescope,
    color: '#f472b6',
  },
];

export function OverviewScreen() {
  const { graph, source } = useKnowledgeState();
  const { goTo } = useNavigation();
  const live = source === 'live';
  const inventory = useInventoryCounts(live);
  const currency = useCurrency(graph.meta.publicationId, live);
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(true);

  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setInterval(
      () => setActive((i) => (i + 1) % STEPS.length),
      2800,
    );
    return () => window.clearInterval(timer);
  }, [autoplay]);

  const evidenceCount = useMemo(() => {
    const ids = new Set<string>();
    for (const item of [...graph.entities, ...graph.relationships]) {
      for (const id of item.sourceEvidenceIds) ids.add(id);
    }
    return ids.size;
  }, [graph]);
  const breakdown = useMemo(() => relationshipBreakdown(graph), [graph]);
  const entityTypes = useMemo(
    () =>
      [...countBy(graph.entities, (e) => e.type).entries()].sort(
        (a, b) => b[1] - a[1],
      ),
    [graph],
  );
  const repositories = distinctRepositories(graph);
  const supportingDocs = useMemo(() => distinctSourceDocuments(graph), [graph]);

  const repoCount = live ? inventory.data?.repositories : repositories.length;
  const docCount = live ? inventory.data?.documents : supportingDocs;
  const stale = currency.data
    ? currency.data.staleEntities + currency.data.staleRelationships
    : undefined;

  const details: { title: string; body: string; metric: string }[] = [
    {
      title: 'Repositories stay authoritative',
      body: 'Workspace Brain reads configured workspaces and repositories read-only. Sources are never modified — they remain the single source of truth.',
      metric: `${formatNumber(repoCount)} repositories discovered · ${repositories.join(', ')} published`,
    },
    {
      title: 'Discovery is deterministic',
      body: 'Every file is fingerprinted with SHA-256 and classified as added, modified, removed or unchanged. The same inputs always yield the same inventory.',
      metric: `${formatNumber(docCount)} documents in the catalogue`,
    },
    {
      title: 'Evidence pins knowledge to source',
      body: 'Processors extract located fragments — line ranges, Markdown blocks, JSON pointers — from specific document versions.',
      metric: `${formatNumber(evidenceCount)} evidence fragments support this publication`,
    },
    {
      title: 'Extractors produce knowledge',
      body: 'Independently registered, versioned extractors convert evidence into a controlled vocabulary of entities and relationships. No AI, no guessing.',
      metric: `${formatNumber(graph.meta.entityCount)} entities · ${formatNumber(graph.meta.relationshipCount)} relationships`,
    },
    {
      title: 'Publications are immutable',
      body: 'A Knowledge Model is published as a versioned, content-hashed snapshot. Consumers pin to a publication and get exactly the same answer every time.',
      metric: `Version ${graph.meta.version} · sha256:${shortHash(graph.meta.contentHash)}…`,
    },
    {
      title: 'Explore without mutating',
      body: 'Search, one-hop exploration, provenance explanation, diffs and currency checks all read published knowledge — they never change it.',
      metric:
        stale === undefined
          ? 'Explain any fact back to its evidence'
          : stale === 0
            ? 'Currency: every fact matches the latest source documents'
            : `Currency: ${formatNumber(stale)} facts have newer source documents`,
    },
  ];
  const detail = details[active]!;
  const DetailIcon = STEPS[active]!.icon;

  return (
    <div className="space-y-10">
      <div className="hero-gradient -mx-5 -mt-8 px-5 pb-2 pt-10 md:-mx-8 md:px-8">
        <ScreenHeader
          eyebrow="Knowledge Model Production Platform"
          title={
            <>
              From repositories to{' '}
              <span className="text-gradient">
                trustworthy, versioned knowledge
              </span>
            </>
          }
          lead="Workspace Brain discovers what is in your repositories and documents, extracts evidence-backed facts, and publishes them as immutable Knowledge Models that people and AI can explore."
        >
          <Button onClick={() => goTo('graph')} size="lg" className="shrink-0">
            Explore the knowledge <ArrowRight />
          </Button>
        </ScreenHeader>
      </div>

      <section>
        <SectionTitle
          aside={
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setAutoplay((v) => !v)}
            >
              {autoplay ? 'Pause walkthrough' : 'Resume walkthrough'}
            </button>
          }
        >
          How it works
        </SectionTitle>
        <Pipeline
          steps={STEPS}
          active={active}
          onSelect={(i) => {
            setAutoplay(false);
            setActive(i);
          }}
        />
        <div
          key={active}
          className="animate-fade-up mt-4 flex flex-col gap-4 rounded-xl border bg-card p-5 md:flex-row md:items-center"
        >
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: `color-mix(in oklch, ${STEPS[active]!.color} 18%, transparent)`,
              color: STEPS[active]!.color,
            }}
          >
            <DetailIcon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{detail.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{detail.body}</p>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2 font-mono text-xs md:max-w-sm">
            {detail.metric}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle
          aside={
            <span className="text-xs text-muted-foreground">
              {live
                ? 'Live from the Workspace Brain API'
                : 'From the bundled publication export'}
            </span>
          }
        >
          What it knows right now
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat
            label="Repositories"
            value={repoCount}
            loading={live && inventory.isPending}
            icon={FolderGit2}
            color="#34d399"
            hint={live ? 'discovered in the catalogue' : 'in the publication'}
          />
          <Stat
            label="Documents"
            value={docCount}
            loading={live && inventory.isPending}
            icon={FileText}
            color="#22d3ee"
            hint={
              live
                ? 'discovered in the catalogue'
                : 'supporting published facts'
            }
          />
          <Stat
            label="Entities"
            value={graph.meta.entityCount}
            icon={Boxes}
            color="#818cf8"
            hint={`${entityTypes.length} entity types`}
          />
          <Stat
            label="Relationships"
            value={graph.meta.relationshipCount}
            icon={GitFork}
            color="#f472b6"
            hint="4 relationship types"
          />
          <Stat
            label="Publication"
            value={`v${graph.meta.version}`}
            icon={Layers}
            color="#f59e0b"
            hint={`schema ${graph.meta.schemaVersion} · ${new Date(graph.meta.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`}
            className="col-span-2 md:col-span-1"
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <CompositionBar
            title="Entities by type"
            items={entityTypes.map(([type, count]) => ({
              key: type,
              label: entityStyle(type).label,
              count,
              color: entityStyle(type).color,
            }))}
          />
          <CompositionBar
            title="Relationships by type"
            items={(
              Object.entries(breakdown) as [RelationshipType, number][]
            ).map(([type, count]) => ({
              key: type,
              label: type,
              count,
              color: RELATIONSHIP_STYLE[type].color,
            }))}
          />
        </div>
        {currency.data && (
          <button
            type="button"
            onClick={() => goTo('concepts')}
            className="mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ShieldCheck className="size-3.5 text-emerald-500" />
            Currency: {formatNumber(currency.data.currentEntities)} entities and{' '}
            {formatNumber(currency.data.currentRelationships)} relationships
            current · {formatNumber(stale)} stale
          </button>
        )}
      </section>

      <KeyMessage>
        Workspace Brain converts repositories and documents into{' '}
        <span className="text-gradient">versioned Knowledge Models</span>.
      </KeyMessage>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => goTo('concepts')}>
          Learn the concepts <ArrowRight />
        </Button>
        <Button variant="ghost" onClick={() => goTo('explain')}>
          <ScanSearch /> See why a fact is true
        </Button>
      </div>
    </div>
  );
}

function CompositionBar({
  title,
  items,
}: {
  title: string;
  items: { key: string; label: string; count: number; color: string }[];
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 text-sm font-medium">{title}</div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {items.map((item) => (
          <div
            key={item.key}
            title={`${item.label}: ${item.count}`}
            style={{
              width: `${(item.count / total) * 100}%`,
              background: item.color,
            }}
            className="transition-all"
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {items.map((item) => (
          <span
            key={item.key}
            className="inline-flex items-center gap-1.5 text-xs"
          >
            <span
              className="size-2 rounded-full"
              style={{ background: item.color }}
            />
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-medium tabular-nums">{item.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
