import {
  displayPath,
  repositoryOfEntity,
  type KnowledgeGraph,
} from './knowledge-graph';
import type { KnowledgeEntity, KnowledgeRelationship } from './types';

export interface Decision {
  entity: KnowledgeEntity;
  title: string | undefined;
  repository: string;
  referencedBy: KnowledgeRelationship[];
}

export function decisionTitle(entity: KnowledgeEntity): string | undefined {
  const prefix = `${entity.name}-`.toLowerCase();
  for (const item of entity.provenance) {
    const filename = item.documentPath.split('/').at(-1) ?? '';
    if (!filename.toLowerCase().startsWith(prefix)) continue;
    const heading =
      'headingPath' in item.locator
        ? item.locator.headingPath?.find((text) =>
            text.toLowerCase().startsWith(entity.name.toLowerCase()),
          )
        : undefined;
    if (heading) {
      const title = heading.slice(entity.name.length).replace(/^[\s:–—-]+/, '');
      if (title) return title;
    }
    const title = filename
      .slice(prefix.length)
      .replace(/\.md$/i, '')
      .replace(/[-_]+/g, ' ');
    if (title) return title[0]!.toUpperCase() + title.slice(1);
  }
  return undefined;
}

export function collectDecisions(graph: KnowledgeGraph): Decision[] {
  return graph.entities
    .filter((entity) => entity.type === 'architectural-decision')
    .map((entity) => ({
      entity,
      title: decisionTitle(entity),
      repository: repositoryOfEntity(entity),
      referencedBy: (graph.relationshipsByEntity.get(entity.id) ?? []).filter(
        (rel) => rel.type === 'REFERENCES' && rel.targetEntityId === entity.id,
      ),
    }))
    .sort(
      (a, b) =>
        a.repository.localeCompare(b.repository) ||
        a.entity.name.localeCompare(b.entity.name, 'en', { numeric: true }),
    );
}

export function filterDecisions(
  decisions: Decision[],
  repository: string,
  query: string,
): Decision[] {
  const terms = query.trim().toLowerCase().split(/\s+/);
  return decisions.filter(
    (decision) =>
      (!repository || decision.repository === repository) &&
      terms.every((term) =>
        [
          decision.entity.name,
          decision.title ?? '',
          decision.repository,
          ...decision.entity.provenance.map((item) =>
            displayPath(item.documentPath),
          ),
        ]
          .join(' ')
          .toLowerCase()
          .includes(term),
      ),
  );
}
