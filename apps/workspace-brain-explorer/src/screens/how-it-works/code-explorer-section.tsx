import { Braces, Landmark, Plug, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { CodeRefLink } from '@/components/docs/code-ref-link';
import {
  useInspector,
  type InspectorTarget,
} from '@/components/docs/inspector-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { QUICK_LINKS } from '@/lib/how-it-works/catalogue';
import { CONCEPTS, type CodeRef } from '@/lib/how-it-works/concepts';
import {
  ADRS,
  DOCUMENT_PROCESSORS,
  HMRC_NORMALIZERS_PATH,
  HMRC_PROCESSORS,
  KNOWLEDGE_EXTRACTORS,
  MIGRATION_TABLES,
  PROCESSING_PATH,
} from '@/lib/implementation-metadata';
import { OPENAPI } from '@/lib/openapi-contract';
import { cn } from '@/lib/utils';

import { DocSection, ImplementedBy, StatusBadge, useDeepLink } from './shared';

type Registry = {
  id: string;
  title: string;
  count: number;
  render: (filter: string) => ReactNode;
};

const matches = (filter: string, ...values: (string | undefined)[]) =>
  !filter || values.some((value) => value?.toLowerCase().includes(filter));

function RefList({ refs }: { refs: CodeRef[] }) {
  return refs.length === 0 ? (
    <p className="px-2 text-sm text-muted-foreground">No matches.</p>
  ) : (
    <div className="grid gap-0.5 md:grid-cols-2">
      {refs.map((ref) => (
        <CodeRefLink key={`${ref.path}#${ref.symbol ?? ''}`} codeRef={ref} />
      ))}
    </div>
  );
}

function TargetList({
  items,
}: {
  items: {
    key: string;
    label: string;
    detail: string;
    icon: ReactNode;
    target: InspectorTarget;
  }[];
}) {
  const inspector = useInspector();
  return (
    <div className="grid gap-0.5 md:grid-cols-2">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => inspector.open(item.target)}
          className="group flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-primary"
        >
          {item.icon}
          <span className="min-w-0">
            <span className="block truncate font-mono text-[13px] font-medium group-hover:text-primary">
              {item.label}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {item.detail}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Registries read from the implementation, so this index grows with the code. */
const REGISTRIES: Registry[] = [
  {
    id: 'extractors',
    title: 'Knowledge extractors',
    count: KNOWLEDGE_EXTRACTORS.length,
    render: (filter) => (
      <RefList
        refs={KNOWLEDGE_EXTRACTORS.filter((item) =>
          matches(filter, item.id, item.exportName, ...item.emitsEntities),
        ).map((item) => ({
          path: item.path,
          symbol: item.exportName,
          kind: 'constant',
          label: `${item.id} v${item.version}`,
          description: `Stage ${item.stage} · emits ${[...item.emitsEntities, ...item.emitsRelationships].join(', ') || 'nothing'}`,
        }))}
      />
    ),
  },
  {
    id: 'processors',
    title: 'Document processors',
    count: DOCUMENT_PROCESSORS.length,
    render: (filter) => (
      <RefList
        refs={DOCUMENT_PROCESSORS.filter((item) =>
          matches(filter, item.id, item.normalizer, ...item.files),
        ).map((item) => ({
          path: HMRC_PROCESSORS.includes(item)
            ? HMRC_NORMALIZERS_PATH
            : PROCESSING_PATH,
          symbol: item.normalizer,
          kind: 'function',
          label: `${item.id} v${item.version}`,
          description: `${item.normalizer} · ${item.files.join(', ')}`,
        }))}
      />
    ),
  },
  {
    id: 'api',
    title: 'API operations',
    count: OPENAPI.operations.length,
    render: (filter) => (
      <TargetList
        items={OPENAPI.operations
          .filter((item) =>
            matches(filter, item.operationId, item.path, item.summary),
          )
          .map((item) => ({
            key: item.operationId,
            label: item.operationId,
            detail: `${item.method} ${item.path}`,
            icon: <Plug />,
            target: { kind: 'api', operationId: item.operationId },
          }))}
      />
    ),
  },
  {
    id: 'schemas',
    title: 'Schemas',
    count: Object.keys(OPENAPI.schemas).length,
    render: (filter) => (
      <TargetList
        items={Object.entries(OPENAPI.schemas)
          .filter(([name, schema]) => matches(filter, name, schema.description))
          .map(([name, schema]) => ({
            key: name,
            label: name,
            detail: schema.description ?? 'OpenAPI component schema',
            icon: <Braces />,
            target: { kind: 'schema', name },
          }))}
      />
    ),
  },
  {
    id: 'tables',
    title: 'Catalogue tables',
    count: MIGRATION_TABLES.length,
    render: (filter) => (
      <RefList
        refs={MIGRATION_TABLES.filter((item) =>
          matches(filter, item.table, item.migration),
        ).map((item) => ({
          path: item.path,
          symbol: item.table,
          kind: 'table',
          description: item.migration,
        }))}
      />
    ),
  },
  {
    id: 'adrs',
    title: 'ADRs',
    count: ADRS.length,
    render: (filter) => (
      <TargetList
        items={ADRS.filter((item) =>
          matches(filter, item.id, item.title, item.status),
        ).map((item) => ({
          key: item.id,
          label: `${item.id} · ${item.title}`,
          detail: item.status,
          icon: <Landmark />,
          target: { kind: 'adr', number: item.number },
        }))}
      />
    ),
  },
];

export function CodeExplorerSection() {
  const inspector = useInspector();
  const { item, select } = useDeepLink('code');
  const [filter, setFilter] = useState('');
  const selectedConcept = CONCEPTS.find((entry) => entry.id === item);
  const registry =
    REGISTRIES.find((entry) => entry.id === item) ??
    (selectedConcept ? undefined : REGISTRIES[0]!);
  const term = filter.trim().toLowerCase();
  const body = useMemo(() => registry?.render(term), [registry, term]);

  const quickTarget = (
    link: (typeof QUICK_LINKS)[number],
  ): InspectorTarget | undefined =>
    link.ref
      ? { kind: 'code', ref: link.ref }
      : link.schema
        ? { kind: 'schema', name: link.schema }
        : link.operationId
          ? { kind: 'api', operationId: link.operationId }
          : link.adr !== undefined
            ? { kind: 'adr', number: link.adr }
            : undefined;

  return (
    <DocSection
      id="code"
      lead="Every concept is linked to the files, classes, functions, schemas, ADRs and APIs that implement it. Links open the real source at the right line, with a jump to GitHub or your editor. The registries are parsed from the code itself."
    >
      <div className="flex flex-wrap gap-2">
        {QUICK_LINKS.map((link) => {
          const target = quickTarget(link);
          return (
            target && (
              <Button
                key={link.label}
                variant="outline"
                size="sm"
                onClick={() => inspector.open(target)}
              >
                {link.label}
              </Button>
            )
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav className="space-y-4 text-sm">
          <div>
            <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              By concept
            </p>
            {CONCEPTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => select(entry.id)}
                className={cn(
                  'block w-full rounded-md px-2 py-1 text-left hover:bg-accent',
                  entry.id === selectedConcept?.id &&
                    'bg-primary/10 font-medium text-primary',
                )}
              >
                {entry.term}
              </button>
            ))}
          </div>
          <div>
            <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Registries
            </p>
            {REGISTRIES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => select(entry.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-accent',
                  entry.id === registry?.id &&
                    'bg-primary/10 font-medium text-primary',
                )}
              >
                {entry.title}
                <Badge variant="secondary">{entry.count}</Badge>
              </button>
            ))}
          </div>
        </nav>
        <Card className="min-w-0">
          <CardContent className="space-y-4 py-5">
            {selectedConcept ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">
                    {selectedConcept.term}
                  </h3>
                  <StatusBadge status={selectedConcept.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedConcept.summary}
                </p>
                <ImplementedBy
                  refs={selectedConcept.implementedBy}
                  schemas={selectedConcept.schemas}
                  apis={selectedConcept.apis}
                  adrs={selectedConcept.adrs}
                />
              </>
            ) : (
              registry && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">
                      {registry.title}{' '}
                      <span className="text-muted-foreground">
                        ({registry.count})
                      </span>
                    </h3>
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                        placeholder="Filter…"
                        className="pl-8"
                      />
                    </div>
                  </div>
                  {body}
                </>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </DocSection>
  );
}
