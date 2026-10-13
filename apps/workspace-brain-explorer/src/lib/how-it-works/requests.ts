import type { KnowledgeGraph } from '../knowledge-graph';
import type { ApiOperation } from '../openapi-contract';

/** Fills an operation's path parameters from the loaded publication. */
export function exampleRequestPath(
  operation: ApiOperation,
  graph: KnowledgeGraph,
  preferredEntityId?: string,
): string {
  const entity =
    (preferredEntityId ? graph.entityById.get(preferredEntityId) : undefined) ??
    graph.entities.find((item) => item.type === 'api') ??
    graph.entities[0];
  const provenance = entity?.provenance[0];
  const known: Record<string, string | undefined> = {
    modelId: graph.meta.knowledgeModelId,
    publicationId: graph.meta.publicationId,
    otherPublicationId: graph.meta.publicationId,
    entityId: entity?.id,
    relationshipId: graph.relationships[0]?.id,
    evidenceId: provenance?.evidenceId,
    documentId: provenance?.documentId,
  };
  const path = operation.path.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = known[name];
    return value ? encodeURIComponent(value) : match;
  });
  if (operation.operationId === 'searchProjectedEntities')
    return `${path}?query=${encodeURIComponent(entity?.name ?? 'workspace')}`;
  return path;
}

/** Whether every path parameter could be filled, so the request is runnable. */
export function isRunnable(path: string): boolean {
  return !/\{\w+\}/.test(path);
}
