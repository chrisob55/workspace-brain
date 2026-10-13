import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { EntityChip } from '@/components/chips';
import { countBy, searchEntities } from '@/lib/knowledge-graph';
import { cn, formatNumber, shortHash } from '@/lib/utils';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useInspector } from './inspector-context';

/** Inspect the loaded publication: integrity metadata, composition and any entity's JSON and provenance. */
export function PublicationInspector() {
  const { graph, source, modelName } = useKnowledgeState();
  const inspector = useInspector();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string>();
  const types = useMemo(
    () =>
      [...countBy(graph.entities, (entity) => entity.type).entries()].sort(
        (a, b) => b[1] - a[1],
      ),
    [graph],
  );
  const relTypes = useMemo(
    () =>
      [...countBy(graph.relationships, (rel) => rel.type).entries()].sort(
        (a, b) => b[1] - a[1],
      ),
    [graph],
  );
  const results = useMemo(
    () => searchEntities(graph, query, type ? new Set([type]) : undefined, 12),
    [graph, query, type],
  );
  const meta = [
    ['Model', modelName],
    ['Publication', shortHash(graph.meta.publicationId, 26)],
    ['Version', `v${graph.meta.version}`],
    ['Schema', `v${graph.meta.schemaVersion}`],
    ['Content hash', shortHash(graph.meta.contentHash)],
    ['Created', new Date(graph.meta.createdAt).toLocaleString()],
  ];
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Publication inspector</h3>
        <div className="flex gap-2">
          <Badge variant="outline">
            {source === 'live' ? 'Live API' : 'Bundled snapshot'}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              inspector.open({
                kind: 'json',
                title: 'Publication metadata',
                value: graph.meta,
                schema: 'KnowledgePublicationPackage',
              })
            }
          >
            Metadata JSON
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
        {meta.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate font-mono text-[13px]" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {formatNumber(graph.entities.length)} entities. Click a type to
            filter.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {types.map(([name, count]) => (
              <button
                key={name}
                type="button"
                onClick={() =>
                  setType((current) => (current === name ? undefined : name))
                }
                className={cn(
                  'rounded-md border px-2 py-0.5 font-mono text-xs hover:border-primary/60',
                  type === name && 'border-primary bg-primary/10 text-primary',
                )}
              >
                {name} · {count}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {formatNumber(graph.relationships.length)} relationships
          </p>
          <div className="flex flex-wrap gap-1.5">
            {relTypes.map(([name, count]) => (
              <span
                key={name}
                className="rounded-md border px-2 py-0.5 font-mono text-xs"
              >
                {name} · {count}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find an entity in this publication…"
          className="pl-8"
        />
      </div>
      <ul className="divide-y rounded-lg border">
        {results.map((entity) => (
          <li
            key={entity.id}
            className="flex flex-wrap items-center gap-2 px-3 py-2"
          >
            <EntityChip entity={entity} size="sm" className="max-w-full" />
            <span className="ml-auto flex gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  inspector.open({
                    kind: 'json',
                    title: entity.name,
                    value: entity,
                    schema: 'KnowledgeEntity',
                  })
                }
              >
                JSON
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  inspector.open({
                    kind: 'evidence',
                    title: entity.name,
                    provenance: entity.provenance,
                  })
                }
              >
                Provenance ({entity.provenance.length})
              </Button>
            </span>
          </li>
        ))}
        {results.length === 0 && (
          <li className="px-3 py-4 text-sm text-muted-foreground">
            No entities match.
          </li>
        )}
      </ul>
    </div>
  );
}
