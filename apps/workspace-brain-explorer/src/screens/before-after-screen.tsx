import { ArrowRight, Boxes, GitFork, Radio, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { KeyMessage, ScreenHeader, SectionTitle } from '@/components/story';
import {
  relationshipBreakdown,
  RELATIONSHIP_TYPES,
} from '@/lib/knowledge-graph';
import { RELATIONSHIP_STYLE } from '@/lib/palette';
import type { RelationshipType } from '@/lib/types';
import { cn, formatNumber } from '@/lib/utils';

interface Snapshot {
  label: string;
  caption: string;
  entities: number;
  relationships: number;
  breakdown: Record<RelationshipType, number>;
  live?: boolean;
}

// Source: docs/implementation/slice-9-report.md (baseline) and publication v377 (after).
const BEFORE: Snapshot = {
  label: 'Before Slice 9',
  caption: 'Schema 1 · dependency analysis',
  entities: 163,
  relationships: 324,
  breakdown: { DEPENDS_ON: 324, CONTAINS: 0, EXPOSES: 0, REFERENCES: 0 },
};

const AFTER: Snapshot = {
  label: 'After Slice 9',
  caption: 'Publication v377 · architectural extraction',
  entities: 290,
  relationships: 545,
  breakdown: { DEPENDS_ON: 377, CONTAINS: 63, EXPOSES: 34, REFERENCES: 71 },
};

function useAnimatedNumber(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function Counter({ value }: { value: number }) {
  return <>{formatNumber(useAnimatedNumber(value))}</>;
}

function SnapshotCard({
  snapshot,
  scale,
  highlight,
}: {
  snapshot: Snapshot;
  scale: number;
  highlight?: boolean;
}) {
  const types = RELATIONSHIP_TYPES.filter((t) => snapshot.breakdown[t] > 0);
  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border bg-card p-5',
        highlight && 'border-primary/60 shadow-xl',
      )}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold">{snapshot.label}</h3>
        {snapshot.live && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-emerald-500">
            <Radio className="size-3" /> now
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{snapshot.caption}</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Boxes className="size-3.5" /> Entities
          </div>
          <div className="text-4xl font-semibold tabular-nums tracking-tight">
            <Counter value={snapshot.entities} />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitFork className="size-3.5" /> Relationships
          </div>
          <div className="text-4xl font-semibold tabular-nums tracking-tight">
            <Counter value={snapshot.relationships} />
          </div>
        </div>
      </div>

      <div
        className="mt-5 flex h-3 overflow-hidden rounded-full bg-muted"
        style={{
          width: `${Math.max(8, (snapshot.relationships / scale) * 100)}%`,
        }}
      >
        {types.map((t) => (
          <div
            key={t}
            className="h-full transition-all duration-700"
            style={{
              flexGrow: snapshot.breakdown[t],
              background: RELATIONSHIP_STYLE[t].color,
            }}
          />
        ))}
      </div>

      <ul className="mt-4 space-y-2">
        {RELATIONSHIP_TYPES.map((t) => {
          const count = snapshot.breakdown[t];
          return (
            <li
              key={t}
              className={cn(
                'flex items-center gap-2 text-sm',
                count === 0 && 'opacity-35',
              )}
            >
              <span
                className="size-2.5 rounded-full"
                style={{ background: RELATIONSHIP_STYLE[t].color }}
              />
              <span className="w-28 font-mono text-xs">{t}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${(count / scale) * 100}%`,
                    background: RELATIONSHIP_STYLE[t].color,
                  }}
                />
              </div>
              <span className="w-10 text-right tabular-nums">
                {count === 0 ? '—' : formatNumber(count)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Delta({
  before,
  after,
  label,
}: {
  before: number;
  after: number;
  label: string;
}) {
  const pct = Math.round(((after - before) / before) * 100);
  return (
    <div className="rounded-xl border bg-card p-4 text-center">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-center justify-center gap-1 text-2xl font-semibold text-emerald-500">
        <TrendingUp className="size-5" />+{pct}%
      </div>
      <div className="text-xs text-muted-foreground">
        {formatNumber(before)} → {formatNumber(after)}
      </div>
    </div>
  );
}

export function BeforeAfterScreen() {
  const { graph, source } = useKnowledgeState();
  const now: Snapshot = {
    label: `Publication v${graph.meta.version}`,
    caption: source === 'live' ? 'Latest live publication' : 'Bundled snapshot',
    entities: graph.meta.entityCount,
    relationships: graph.meta.relationshipCount,
    breakdown: relationshipBreakdown(graph),
    live: source === 'live',
  };
  const showNow = graph.meta.version !== 377;
  const scale = Math.max(AFTER.relationships, now.relationships);

  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Before vs After Slice 9"
        title="From dependency analysis to architectural knowledge"
        lead="Slice 9 added staged extractor plug-ins for repository structure, OpenAPI operations, Markdown references and ADRs — on the same evidence, with the same provenance."
      />

      <div
        className={cn(
          'grid items-stretch gap-4',
          showNow
            ? 'lg:grid-cols-[1fr_auto_1fr_1fr]'
            : 'lg:grid-cols-[1fr_auto_1fr]',
        )}
      >
        <SnapshotCard snapshot={BEFORE} scale={scale} />
        <div className="flex items-center justify-center">
          <ArrowRight className="size-8 rotate-90 text-primary lg:rotate-0" />
        </div>
        <SnapshotCard snapshot={AFTER} scale={scale} highlight />
        {showNow && <SnapshotCard snapshot={now} scale={scale} />}
      </div>

      <section>
        <SectionTitle>Slice 9 in numbers</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Delta
            label="Entities"
            before={BEFORE.entities}
            after={AFTER.entities}
          />
          <Delta
            label="Relationships"
            before={BEFORE.relationships}
            after={AFTER.relationships}
          />
          <div className="rounded-xl border bg-card p-4 text-center">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Relationship types
            </div>
            <div className="mt-1 text-2xl font-semibold">1 → 4</div>
            <div className="text-xs text-muted-foreground">
              CONTAINS · EXPOSES · REFERENCES
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4 text-center">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              New entity types
            </div>
            <div className="mt-1 text-2xl font-semibold">+4</div>
            <div className="text-xs text-muted-foreground">
              repository · operation · document · ADR
            </div>
          </div>
        </div>
      </section>

      <KeyMessage>
        Workspace Brain evolved from dependency analysis into architectural
        knowledge extraction.
      </KeyMessage>
    </div>
  );
}
