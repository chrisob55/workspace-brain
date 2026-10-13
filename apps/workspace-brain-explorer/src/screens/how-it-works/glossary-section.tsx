import { Link2, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  CONCEPT_BY_ID,
  CONCEPTS,
  type Concept,
} from '@/lib/how-it-works/concepts';
import { conceptExample } from '@/lib/how-it-works/examples';
import { scrollToElement } from '@/lib/how-it-works/scroll';
import { deepLinkHash } from '@/lib/how-it-works/sections';
import { cn } from '@/lib/utils';

import {
  DocSection,
  ImplementedBy,
  InspectButton,
  JsonButton,
  StatusBadge,
  useDeepLink,
} from './shared';

function GlossaryEntry({
  entry,
  active,
  onSelect,
}: {
  entry: Concept;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const { graph } = useKnowledgeState();
  const ref = useRef<HTMLDivElement>(null);
  const live = useMemo(
    () => (active ? conceptExample(entry.id, graph) : undefined),
    [active, entry.id, graph],
  );
  useEffect(() => {
    if (active) if (ref.current) scrollToElement(ref.current);
  }, [active]);
  return (
    <div ref={ref} id={`hiw-term-${entry.id}`} className="scroll-mt-6">
      <Card
        className={cn(
          'h-full transition-shadow',
          active && 'ring-2 ring-primary/40',
        )}
      >
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(active ? '' : entry.id)}
              className="text-left hover:text-primary"
            >
              <h3 className="text-lg font-semibold">{entry.term}</h3>
            </button>
            <StatusBadge status={entry.status} />
            <a
              href={deepLinkHash('glossary', entry.id)}
              className="ml-auto text-muted-foreground hover:text-primary"
              title="Link to this term"
            >
              <Link2 className="size-4" />
            </a>
          </div>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                What it means
              </dt>
              <dd className="mt-0.5">{entry.summary}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Why it exists
              </dt>
              <dd className="mt-0.5">{entry.why}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Where it is used
              </dt>
              <dd className="mt-0.5">
                <ul className="list-inside list-disc text-muted-foreground">
                  {entry.whereUsed.map((use) => (
                    <li key={use}>{use}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Example
              </dt>
              <dd className="mt-0.5 text-muted-foreground">{entry.example}</dd>
            </div>
          </dl>
          {active && (
            <div className="space-y-4 border-t pt-3">
              {live && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">Live:</span>
                  <span className="text-muted-foreground">{live.text}</span>
                  {live.value !== undefined && (
                    <JsonButton
                      title={`${entry.term} example`}
                      value={live.value}
                    />
                  )}
                  {live.provenance && (
                    <InspectButton
                      target={{
                        kind: 'evidence',
                        title: entry.term,
                        provenance: live.provenance,
                      }}
                    >
                      View evidence
                    </InspectButton>
                  )}
                </div>
              )}
              <ImplementedBy
                refs={entry.implementedBy}
                schemas={entry.schemas}
                apis={entry.apis}
                adrs={entry.adrs}
              />
            </div>
          )}
          {entry.related.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Related:</span>
              {entry.related.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelect(id)}
                  className="rounded-full border px-2 py-0.5 hover:border-primary/60 hover:text-primary"
                >
                  {CONCEPT_BY_ID.get(id)?.term ?? id}
                </button>
              ))}
            </div>
          )}
          {!active && (
            <button
              type="button"
              onClick={() => onSelect(entry.id)}
              className="text-xs text-primary hover:underline"
            >
              Show live example and implementation →
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function GlossarySection() {
  const { item, select } = useDeepLink('glossary');
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const entries = CONCEPTS.filter(
    (entry) =>
      !term ||
      [entry.term, entry.summary, entry.why, entry.example].some((text) =>
        text.toLowerCase().includes(term),
      ),
  );
  return (
    <DocSection
      id="glossary"
      lead="Every term links to where it is implemented. Select a term to see a live example from the loaded publication, and copy its link to share it."
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search terms…"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CONCEPTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => select(entry.id)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs hover:border-primary/60',
                item === entry.id &&
                  'border-primary bg-primary/10 text-primary',
              )}
            >
              {entry.term}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {entries.map((entry) => (
          <GlossaryEntry
            key={entry.id}
            entry={entry}
            active={item === entry.id}
            onSelect={(id) => select(id || undefined)}
          />
        ))}
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No terms match “{query}”.
          </p>
        )}
      </div>
    </DocSection>
  );
}
