import type {
  KnowledgeEntity,
  KnowledgeRelationship,
  ProvenanceItem,
  PublicationPackage,
  RelationshipType,
} from './types';

export const RELATIONSHIP_TYPES: RelationshipType[] = [
  'DEPENDS_ON',
  'CONTAINS',
  'EXPOSES',
  'REFERENCES',
];

export interface PublicationMeta {
  publicationId: string;
  knowledgeModelId: string;
  version: number;
  schemaVersion: number;
  contentHash: string;
  createdAt: string;
  entityCount: number;
  relationshipCount: number;
}

export interface KnowledgeGraph {
  meta: PublicationMeta;
  entities: KnowledgeEntity[];
  relationships: KnowledgeRelationship[];
  entityById: Map<string, KnowledgeEntity>;
  relationshipById: Map<string, KnowledgeRelationship>;
  relationshipsByEntity: Map<string, KnowledgeRelationship[]>;
}

export function buildKnowledgeGraph(pkg: PublicationPackage): KnowledgeGraph {
  const entities = pkg.entities.map((item) => item.entity);
  const relationships = pkg.relationships.map((item) => item.relationship);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const relationshipById = new Map(relationships.map((rel) => [rel.id, rel]));
  const relationshipsByEntity = new Map<string, KnowledgeRelationship[]>();
  for (const rel of relationships) {
    for (const id of [rel.sourceEntityId, rel.targetEntityId]) {
      const list = relationshipsByEntity.get(id);
      if (list) list.push(rel);
      else relationshipsByEntity.set(id, [rel]);
    }
  }
  return {
    meta: {
      publicationId: pkg.metadata.publicationId,
      knowledgeModelId: pkg.metadata.knowledgeModelId,
      version: pkg.metadata.publicationVersion,
      schemaVersion: pkg.metadata.schemaVersion,
      contentHash: pkg.metadata.contentHash,
      createdAt: pkg.metadata.createdAt,
      entityCount: pkg.metadata.entityCount,
      relationshipCount: pkg.metadata.relationshipCount,
    },
    entities,
    relationships,
    entityById,
    relationshipById,
    relationshipsByEntity,
  };
}

/** Document paths are `<sourceRootId>/<repository>/<path>`; drop the opaque root. */
export function displayPath(documentPath: string): string {
  const slash = documentPath.indexOf('/');
  return slash === -1 ? documentPath : documentPath.slice(slash + 1);
}

export function repositoryOfPath(documentPath: string): string {
  return displayPath(documentPath).split('/')[0] ?? 'unknown';
}

export function repositoryOfEntity(entity: KnowledgeEntity): string {
  const first = entity.provenance[0];
  return first ? repositoryOfPath(first.documentPath) : 'unknown';
}

export function describeLocator(item: ProvenanceItem): string {
  const locator = item.locator;
  if (locator.kind === 'json-pointer') return `JSON pointer ${locator.pointer}`;
  return locator.lineStart === locator.lineEnd
    ? `line ${locator.lineStart}`
    : `lines ${locator.lineStart}–${locator.lineEnd}`;
}

export function extractorOf(item: ProvenanceItem): string {
  return item.knowledgeExtractorId ?? item.extractionRuleId;
}

export function countBy<T>(
  items: Iterable<T>,
  key: (item: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function relationshipBreakdown(
  graph: KnowledgeGraph,
): Record<RelationshipType, number> {
  const counts = countBy(graph.relationships, (rel) => rel.type);
  return Object.fromEntries(
    RELATIONSHIP_TYPES.map((type) => [type, counts.get(type) ?? 0]),
  ) as Record<RelationshipType, number>;
}

export interface ExtractorContribution {
  extractorId: string;
  processorIds: string[];
  entities: number;
  relationships: number;
  evidence: number;
}

/** Counts facts each extractor supports, using provenance carried by the publication. */
export function extractorContributions(
  graph: KnowledgeGraph,
): ExtractorContribution[] {
  const byExtractor = new Map<
    string,
    {
      processors: Set<string>;
      entities: Set<string>;
      relationships: Set<string>;
      evidence: Set<string>;
    }
  >();
  const visit = (
    kind: 'entities' | 'relationships',
    id: string,
    items: ProvenanceItem[],
  ) => {
    for (const item of items) {
      const extractorId = extractorOf(item);
      let entry = byExtractor.get(extractorId);
      if (!entry) {
        entry = {
          processors: new Set(),
          entities: new Set(),
          relationships: new Set(),
          evidence: new Set(),
        };
        byExtractor.set(extractorId, entry);
      }
      entry.processors.add(item.processorId);
      entry[kind].add(id);
      entry.evidence.add(item.evidenceId);
    }
  };
  for (const entity of graph.entities)
    visit('entities', entity.id, entity.provenance);
  for (const rel of graph.relationships)
    visit('relationships', rel.id, rel.provenance);
  return [...byExtractor.entries()]
    .map(([extractorId, entry]) => ({
      extractorId,
      processorIds: [...entry.processors].sort(),
      entities: entry.entities.size,
      relationships: entry.relationships.size,
      evidence: entry.evidence.size,
    }))
    .sort(
      (a, b) => b.entities + b.relationships - (a.entities + a.relationships),
    );
}

export function distinctSourceDocuments(graph: KnowledgeGraph): number {
  const docs = new Set<string>();
  for (const item of [...graph.entities, ...graph.relationships]) {
    for (const prov of item.provenance) docs.add(prov.documentId);
  }
  return docs.size;
}

export function distinctRepositories(graph: KnowledgeGraph): string[] {
  return graph.entities
    .filter((entity) => entity.type === 'repository')
    .map((entity) => entity.name)
    .sort();
}

export interface Fact {
  relationship: KnowledgeRelationship;
  source: KnowledgeEntity;
  target: KnowledgeEntity;
}

export function toFact(
  graph: KnowledgeGraph,
  rel: KnowledgeRelationship,
): Fact | undefined {
  const source = graph.entityById.get(rel.sourceEntityId);
  const target = graph.entityById.get(rel.targetEntityId);
  return source && target ? { relationship: rel, source, target } : undefined;
}

/** Finds a fact by names; `evidencePath` narrows by the supporting document path. */
export function findFact(
  graph: KnowledgeGraph,
  sourceName: string,
  type: RelationshipType,
  targetName: string,
  evidencePath?: string,
): Fact | undefined {
  for (const rel of graph.relationships) {
    if (rel.type !== type) continue;
    const fact = toFact(graph, rel);
    if (
      !fact ||
      fact.source.name !== sourceName ||
      fact.target.name !== targetName
    )
      continue;
    if (
      evidencePath &&
      !rel.provenance.some(
        (prov) => displayPath(prov.documentPath) === evidencePath,
      )
    ) {
      continue;
    }
    return fact;
  }
  return undefined;
}

export function neighbours(
  graph: KnowledgeGraph,
  entityId: string,
  allowedTypes?: ReadonlySet<RelationshipType>,
): KnowledgeRelationship[] {
  return (graph.relationshipsByEntity.get(entityId) ?? []).filter(
    (rel) => !allowedTypes || allowedTypes.has(rel.type),
  );
}

export function searchEntities(
  graph: KnowledgeGraph,
  query: string,
  types?: ReadonlySet<string>,
  limit = 50,
): KnowledgeEntity[] {
  const q = query.trim().toLowerCase();
  const matches = graph.entities.filter(
    (entity) =>
      (!types || types.size === 0 || types.has(entity.type)) &&
      (q === '' || entity.name.toLowerCase().includes(q)),
  );
  const score = (entity: KnowledgeEntity) => {
    const name = entity.name.toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q) || name.endsWith(`/${q}`)) return 1;
    return 2;
  };
  return matches
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function shortName(entity: KnowledgeEntity): string {
  if (entity.type === 'module' || entity.type === 'package') {
    const parts = entity.name.split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : entity.name;
  }
  return entity.name;
}
