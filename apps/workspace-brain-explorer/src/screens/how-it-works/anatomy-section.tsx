import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { useKnowledgeState } from '@/app-context';
import { CodeRefLink } from '@/components/docs/code-ref-link';
import { JsonViewer } from '@/components/docs/json-viewer';
import { MermaidDiagram } from '@/components/docs/mermaid-diagram';
import { PublicationInspector } from '@/components/docs/publication-inspector';
import {
  PUBLICATION_ANATOMY,
  type AnatomyNode,
} from '@/lib/how-it-works/catalogue';
import { anatomyDiagram, conceptExample } from '@/lib/how-it-works/examples';
import { exampleRequestPath } from '@/lib/how-it-works/requests';
import { PUBLICATION_FORMAT } from '@/lib/implementation-metadata';
import {
  countBy,
  searchEntities,
  type KnowledgeGraph,
} from '@/lib/knowledge-graph';
import { apiOperation } from '@/lib/openapi-contract';
import { cn } from '@/lib/utils';

import {
  DocSection,
  InspectButton,
  SchemaButton,
  StatusBadge,
  useDeepLink,
} from './shared';

/** Example output for each anatomy node, derived from the loaded publication. */
function exampleOutput(node: AnatomyNode, graph: KnowledgeGraph): unknown {
  switch (node.id) {
    case 'explorer-view':
      return {
        view: 'Knowledge Graph',
        nodes: graph.entities.length,
        edges: graph.relationships.length,
        nodesByType: Object.fromEntries(
          countBy(graph.entities, (entity) => entity.type),
        ),
      };
    case 'json-publication':
      return {
        ...PUBLICATION_FORMAT,
        metadata: graph.meta,
        entities: graph.entities.slice(0, 2).map((entity) => ({ entity })),
        relationships: graph.relationships
          .slice(0, 1)
          .map((relationship) => ({ relationship })),
      };
    case 'rest-api': {
      const operation = node.operationId
        ? apiOperation(node.operationId)
        : undefined;
      const entity =
        graph.entities.find((item) => item.type === 'api') ?? graph.entities[0];
      return {
        request:
          operation &&
          `${operation.method} ${exampleRequestPath(operation, graph, entity?.id)}`,
        response: { publicationId: graph.meta.publicationId, entity },
      };
    }
    case 'search-index': {
      const term = 'knowledge';
      return {
        query: term,
        results: searchEntities(graph, term, undefined, 5).map(
          ({ id, name, type }) => ({ id, name, type }),
        ),
      };
    }
    default:
      return conceptExample('context-package', graph)?.value;
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_1fr]">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:pt-1">
        {label}
      </dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

export function AnatomySection() {
  const { graph } = useKnowledgeState();
  const { item, select } = useDeepLink('anatomy');
  return (
    <DocSection
      id="anatomy"
      lead="Every output is a projection of one immutable publication. Expand a node to see its purpose, the code that produces it, who consumes it, its schema and a real example."
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="rounded-xl border bg-card p-4 font-mono text-sm">
          <p className="mb-2 font-semibold">
            Knowledge Model · publication v{graph.meta.version}
          </p>
          <ul>
            {PUBLICATION_ANATOMY.map((node, index) => {
              const open = item === node.id;
              const last = index === PUBLICATION_ANATOMY.length - 1;
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => select(open ? undefined : node.id)}
                    className="flex w-full items-center gap-1 rounded py-1 text-left hover:bg-accent"
                  >
                    <span className="whitespace-pre text-muted-foreground">
                      {last ? '└── ' : '├── '}
                    </span>
                    <ChevronRight
                      className={cn(
                        'size-4 transition-transform',
                        open && 'rotate-90',
                      )}
                    />
                    <span className={cn(open && 'text-primary')}>
                      {node.title}
                    </span>
                    <span className="ml-auto font-sans">
                      <StatusBadge status={node.status} />
                    </span>
                  </button>
                  {open && (
                    <div
                      className={cn(
                        'ml-3 border-l py-3 pl-6 font-sans',
                        last && 'border-transparent',
                      )}
                    >
                      <dl className="space-y-3">
                        <Field label="Purpose">{node.purpose}</Field>
                        <Field label="Producer">
                          <CodeRefLink
                            codeRef={node.producer}
                            className="-mx-2"
                          />
                        </Field>
                        <Field label="Consumer">{node.consumer}</Field>
                        <Field label="Schema">
                          <div className="flex flex-wrap gap-2">
                            {node.schema ? (
                              <SchemaButton name={node.schema} />
                            ) : (
                              <span className="text-muted-foreground">
                                Not yet defined
                              </span>
                            )}
                            {node.operationId && (
                              <InspectButton
                                target={{
                                  kind: 'api',
                                  operationId: node.operationId,
                                }}
                              >
                                {node.operationId}
                              </InspectButton>
                            )}
                          </div>
                        </Field>
                        <Field label="Example output">
                          <JsonViewer
                            value={exampleOutput(node, graph)}
                            expandDepth={1}
                          />
                        </Field>
                      </dl>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <MermaidDiagram
          chart={anatomyDiagram(PUBLICATION_ANATOMY)}
          title="Publication fan-out"
        />
      </div>
      <PublicationInspector />
    </DocSection>
  );
}
