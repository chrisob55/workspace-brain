/**
 * Live examples for "How Workspace Brain Works", computed from whichever
 * publication the Explorer has loaded (live API or bundled snapshot). Nothing
 * here is hard-coded data: if the publication changes, the examples change.
 */
import {
  ENTITY_TYPES,
  RELATIONSHIP_VOCABULARY,
} from '../implementation-metadata';
import {
  countBy,
  displayPath,
  extractorContributions,
  extractorOf,
  repositoryOfEntity,
  repositoryOfPath,
  toFact,
  type Fact,
  type KnowledgeGraph,
} from '../knowledge-graph';
import type {
  KnowledgeEntity,
  KnowledgeRelationship,
  ProvenanceItem,
} from '../types';

type BoundaryProvenance = ProvenanceItem & {
  repositoryBoundary?: {
    id: string;
    name: string;
    path: string;
    fingerprint: string;
  };
};

function describeLocatorShort(item: ProvenanceItem): string {
  const locator = item.locator;
  if (locator.kind === 'json-pointer') return locator.pointer;
  return locator.lineStart === locator.lineEnd
    ? `L${locator.lineStart}`
    : `L${locator.lineStart}-${locator.lineEnd}`;
}

export function preferredRepository(
  graph: KnowledgeGraph,
): KnowledgeEntity | undefined {
  const repositories = graph.entities.filter(
    (entity) => entity.type === 'repository',
  );
  return (
    repositories.find((entity) => entity.name === 'workspace-brain') ??
    repositories[0]
  );
}

export function entitiesInRepository(
  graph: KnowledgeGraph,
  repository: string,
): KnowledgeEntity[] {
  return graph.entities.filter(
    (entity) => repositoryOfEntity(entity) === repository,
  );
}

// ---------------------------------------------------------------- discovery

export interface DiscoveryExample {
  repository: KnowledgeEntity;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export function discoveryExample(
  graph: KnowledgeGraph,
): DiscoveryExample | undefined {
  const repository = preferredRepository(graph);
  if (!repository) return undefined;
  const boundary = (repository.provenance as BoundaryProvenance[]).find(
    (item) => item.repositoryBoundary,
  )?.repositoryBoundary;
  const documents = new Map<string, ProvenanceItem>();
  for (const item of [...graph.entities, ...graph.relationships].flatMap(
    (fact) => fact.provenance,
  )) {
    if (repositoryOfPath(item.documentPath) === repository.name)
      documents.set(item.documentId, item);
  }
  const processors = countBy(documents.values(), (item) => item.processorId);
  const sourceId = repository.provenance[0]?.sourceId;
  return {
    repository,
    input: {
      repository: repository.name,
      path: boundary ? displayPath(boundary.path) : repository.name,
      sourceId,
      fingerprint: boundary?.fingerprint,
    },
    output: {
      repositoryId: boundary?.id,
      name: repository.name,
      sourceId,
      documentsContributingKnowledge: documents.size,
      classifiedByProcessor: Object.fromEntries(
        [...processors.entries()].sort((a, b) => b[1] - a[1]),
      ),
      sampleDocuments: [...documents.values()]
        .slice(0, 5)
        .map((item) => displayPath(item.documentPath)),
    },
  };
}

// ----------------------------------------------------------------- evidence

export interface EvidenceExample {
  id: string;
  label: string;
  value: string;
  source: string;
  locator: string;
  confidence?: number;
  lifecycleStatus: string;
  extractor: string;
  provenance: ProvenanceItem[];
  entity?: KnowledgeEntity;
  relationship?: KnowledgeRelationship;
}

function fromEntity(
  id: string,
  label: string,
  entity: KnowledgeEntity | undefined,
  value?: (entity: KnowledgeEntity) => string,
): EvidenceExample | undefined {
  const first = entity?.provenance[0];
  if (!entity || !first) return undefined;
  return {
    id,
    label,
    value: value ? value(entity) : entity.name,
    source: displayPath(first.documentPath),
    locator: describeLocatorShort(first),
    lifecycleStatus: entity.lifecycleStatus,
    extractor: extractorOf(first),
    provenance: entity.provenance,
    entity,
  };
}

export function operationLabel(entity: KnowledgeEntity): string {
  const facts = entity.provenance.find((item) => item.facts)?.facts;
  return facts?.method && facts.path
    ? `${facts.method} ${facts.path}`
    : entity.name;
}

export function evidenceExamples(graph: KnowledgeGraph): EvidenceExample[] {
  const repository = preferredRepository(graph);
  const home = repository?.name;
  const inHome = (entity: KnowledgeEntity) =>
    !home || repositoryOfEntity(entity) === home;
  const ofType = (type: string) =>
    graph.entities.filter((entity) => entity.type === type && inHome(entity));

  const internalPackage =
    ofType('package').find((entity) =>
      entity.provenance.some(
        (item) =>
          item.locator.kind === 'json-pointer' &&
          item.locator.pointer === '/name',
      ),
    ) ?? ofType('package')[0];

  const operations = ofType('operation');
  const operation =
    operations.find((entity) => entity.name === 'exportKnowledgePublication') ??
    operations[0];

  const dependency = graph.relationships
    .filter((rel) => rel.type === 'DEPENDS_ON')
    .map((rel) => toFact(graph, rel))
    .find(
      (fact): fact is Fact =>
        !!fact &&
        fact.source.type === 'package' &&
        inHome(fact.source) &&
        fact.relationship.provenance[0]?.locator.kind === 'json-pointer',
    );

  const examples: (EvidenceExample | undefined)[] = [
    fromEntity('repository-name', 'Repository Name', repository),
    fromEntity('package-name', 'Package Name', internalPackage),
    dependency && dependency.relationship.provenance[0]
      ? {
          id: 'dependency',
          label: 'Dependency',
          value: `${dependency.source.name} → ${dependency.target.name}`,
          source: displayPath(
            dependency.relationship.provenance[0].documentPath,
          ),
          locator: describeLocatorShort(dependency.relationship.provenance[0]),
          confidence: dependency.relationship.confidence,
          lifecycleStatus: dependency.relationship.lifecycleStatus,
          extractor: extractorOf(dependency.relationship.provenance[0]),
          provenance: dependency.relationship.provenance,
          relationship: dependency.relationship,
        }
      : undefined,
    fromEntity(
      'openapi-endpoint',
      'OpenAPI Endpoint',
      operation,
      operationLabel,
    ),
    fromEntity(
      'docker-service',
      'Docker Service',
      graph.entities.find((entity) => entity.type === 'container'),
    ),
  ];
  return examples.filter((item): item is EvidenceExample => !!item);
}

// ---------------------------------------------------------- knowledge model

export type ModelCoverage = 'modelled' | 'partial' | 'not-modelled';

export interface KnowledgeMappingRow {
  id: string;
  concept: string;
  coverage: ModelCoverage;
  representedBy: string;
  count: number;
  example?: string;
}

export function knowledgeMapping(graph: KnowledgeGraph): KnowledgeMappingRow[] {
  const types = countBy(graph.entities, (entity) => entity.type);
  const rels = countBy(graph.relationships, (rel) => rel.type);
  const has = (type: string) => ENTITY_TYPES.includes(type);
  const firstFact = (type: string) => {
    const rel = graph.relationships.find((item) => item.type === type);
    const fact = rel && toFact(graph, rel);
    return fact ? `${fact.source.name} ${type} ${fact.target.name}` : undefined;
  };
  const apiEntity = graph.entities.find((entity) => entity.type === 'api');
  return [
    {
      id: 'capability',
      concept: 'Capability',
      coverage: has('capability') ? 'modelled' : 'not-modelled',
      representedBy: has('capability')
        ? 'capability entities'
        : 'Not yet an entity type; capabilities are inferred by readers from APIs and packages.',
      count: types.get('capability') ?? 0,
    },
    {
      id: 'service',
      concept: 'Service',
      coverage: has('service') ? 'modelled' : 'partial',
      representedBy: has('service')
        ? 'service entities'
        : 'Approximated by deployable packages, containers and the APIs they expose.',
      count: (types.get('package') ?? 0) + (types.get('container') ?? 0),
      example: graph.entities.find((entity) => entity.type === 'container')
        ?.name,
    },
    {
      id: 'api',
      concept: 'API',
      coverage: has('api') ? 'modelled' : 'not-modelled',
      representedBy: `api and operation entities joined by EXPOSES (${rels.get('EXPOSES') ?? 0}).`,
      count: (types.get('api') ?? 0) + (types.get('operation') ?? 0),
      example: apiEntity?.name,
    },
    {
      id: 'dependency',
      concept: 'Dependency',
      coverage: RELATIONSHIP_VOCABULARY.includes('DEPENDS_ON')
        ? 'modelled'
        : 'not-modelled',
      representedBy: 'DEPENDS_ON relationships from manifests and imports.',
      count: rels.get('DEPENDS_ON') ?? 0,
      example: firstFact('DEPENDS_ON'),
    },
    {
      id: 'ownership',
      concept: 'Ownership',
      coverage: has('team') ? 'modelled' : 'partial',
      representedBy:
        'Structural ownership via CONTAINS (repository → package). Team ownership is not modelled yet.',
      count: rels.get('CONTAINS') ?? 0,
      example: firstFact('CONTAINS'),
    },
  ];
}

export interface ApiModelExample {
  api: KnowledgeEntity;
  operations: KnowledgeEntity[];
  exposes: KnowledgeRelationship[];
}

export function apiModelExample(
  graph: KnowledgeGraph,
): ApiModelExample | undefined {
  const apis = graph.entities.filter((entity) => entity.type === 'api');
  const withOps = apis
    .map((api) => {
      const exposes = (graph.relationshipsByEntity.get(api.id) ?? []).filter(
        (rel) => rel.type === 'EXPOSES' && rel.sourceEntityId === api.id,
      );
      const operations = exposes
        .map((rel) => graph.entityById.get(rel.targetEntityId))
        .filter((entity): entity is KnowledgeEntity => !!entity);
      return { api, operations, exposes };
    })
    .sort((a, b) => b.operations.length - a.operations.length);
  return withOps[0];
}

// ------------------------------------------------------------ query journeys

export interface JourneyStage {
  id: string;
  title: string;
  detail: string;
  value: unknown;
}

export interface DependentsJourney {
  question: string;
  requested: string;
  matched: boolean;
  target: KnowledgeEntity;
  dependents: Fact[];
  stages: JourneyStage[];
}

const normalise = (value: string) =>
  value.toLowerCase().replace(/[\s_-]+/g, '');

export function dependencyCandidates(graph: KnowledgeGraph): KnowledgeEntity[] {
  const incoming = countBy(
    graph.relationships.filter((rel) => rel.type === 'DEPENDS_ON'),
    (rel) => rel.targetEntityId,
  );
  return [...incoming.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => graph.entityById.get(id))
    .filter((entity): entity is KnowledgeEntity => !!entity);
}

/** "What depends on X?" — falls back to the most depended-on entity when X is unknown. */
export function dependentsJourney(
  graph: KnowledgeGraph,
  requested: string,
  targetId?: string,
): DependentsJourney | undefined {
  const wanted = normalise(requested);
  const explicit = targetId ? graph.entityById.get(targetId) : undefined;
  const matchedEntity =
    explicit ??
    (wanted
      ? (graph.entities.find((entity) => normalise(entity.name) === wanted) ??
        graph.entities.find((entity) =>
          normalise(entity.name).includes(wanted),
        ))
      : undefined);
  const target = matchedEntity ?? dependencyCandidates(graph)[0];
  if (!target) return undefined;

  const allDependsOn = graph.relationships.filter(
    (rel) => rel.type === 'DEPENDS_ON',
  );
  const incoming = (graph.relationshipsByEntity.get(target.id) ?? []).filter(
    (rel) => rel.type === 'DEPENDS_ON' && rel.targetEntityId === target.id,
  );
  const dependents = incoming
    .map((rel) => toFact(graph, rel))
    .filter((fact): fact is Fact => !!fact)
    .sort((a, b) => a.source.name.localeCompare(b.source.name));
  const byType = countBy(dependents, (fact) => fact.source.type);

  return {
    question: `What depends on ${matchedEntity ? target.name : requested}?`,
    requested,
    matched: !!matchedEntity,
    target,
    dependents,
    stages: [
      {
        id: 'publication',
        title: 'Publication',
        detail: `Start from the immutable publication v${graph.meta.version}, so the answer is reproducible.`,
        value: {
          publicationId: graph.meta.publicationId,
          version: graph.meta.version,
          contentHash: graph.meta.contentHash,
          entities: graph.meta.entityCount,
          relationships: graph.meta.relationshipCount,
        },
      },
      {
        id: 'dependency-graph',
        title: 'Dependency graph',
        detail: `Select only DEPENDS_ON edges: ${allDependsOn.length} of ${graph.relationships.length} relationships.`,
        value: { relationshipType: 'DEPENDS_ON', edges: allDependsOn.length },
      },
      {
        id: 'relationship-index',
        title: 'Relationship index',
        detail: `Look up incoming edges for "${target.name}" in the per-entity relationship index.`,
        value: {
          entityId: target.id,
          direction: 'incoming',
          matches: incoming.length,
        },
      },
      {
        id: 'answer',
        title: 'Answer',
        detail:
          dependents.length === 0
            ? 'Nothing in this publication depends on it.'
            : `${dependents.length} dependents, each backed by provenance.`,
        value: {
          dependents: dependents.length,
          byType: Object.fromEntries(byType),
        },
      },
    ],
  };
}

export interface ApisJourney {
  question: string;
  repository: string;
  evidence: ProvenanceItem[];
  apis: ApiModelExample[];
  stages: JourneyStage[];
}

/** "What APIs exist in this service?" for one repository. */
export function apisJourney(
  graph: KnowledgeGraph,
  repository: string,
): ApisJourney {
  const apis = graph.entities
    .filter(
      (entity) =>
        entity.type === 'api' && repositoryOfEntity(entity) === repository,
    )
    .map((api) => {
      const exposes = (graph.relationshipsByEntity.get(api.id) ?? []).filter(
        (rel) => rel.type === 'EXPOSES' && rel.sourceEntityId === api.id,
      );
      return {
        api,
        exposes,
        operations: exposes
          .map((rel) => graph.entityById.get(rel.targetEntityId))
          .filter((entity): entity is KnowledgeEntity => !!entity),
      };
    });
  const evidenceById = new Map<string, ProvenanceItem>();
  for (const { api, operations } of apis)
    for (const item of [api, ...operations].flatMap(
      (entity) => entity.provenance,
    ))
      evidenceById.set(item.evidenceId, item);
  const evidence = [...evidenceById.values()];
  const documents = [
    ...new Set(evidence.map((item) => displayPath(item.documentPath))),
  ];
  const operations = apis.reduce(
    (sum, item) => sum + item.operations.length,
    0,
  );

  return {
    question: `What APIs exist in ${repository}?`,
    repository,
    evidence,
    apis,
    stages: [
      {
        id: 'repository',
        title: 'Repository',
        detail: `Discovery registered ${repository} as a repository boundary.`,
        value: { repository },
      },
      {
        id: 'evidence',
        title: 'Evidence',
        detail:
          evidence.length === 0
            ? 'No API contract evidence was found in this repository.'
            : `${evidence.length} evidence blocks from ${documents.length} contract document(s).`,
        value: { documents, evidenceBlocks: evidence.length },
      },
      {
        id: 'knowledge-model',
        title: 'Knowledge Model',
        detail: `${apis.length} api entities exposing ${operations} operations.`,
        value: apis.map(({ api, operations: ops }) => ({
          api: api.name,
          operations: ops.length,
        })),
      },
      {
        id: 'publication',
        title: 'Publication',
        detail: `Published in v${graph.meta.version}; consumers read it via the export or the entity API.`,
        value: {
          publicationId: graph.meta.publicationId,
          apiEntityIds: apis.map(({ api }) => api.id),
        },
      },
    ],
  };
}

// --------------------------------------------------------- concept examples

export interface ConceptExample {
  text: string;
  value?: unknown;
  provenance?: ProvenanceItem[];
}

export function conceptExample(
  conceptId: string,
  graph: KnowledgeGraph,
): ConceptExample | undefined {
  const evidence = evidenceExamples(graph);
  switch (conceptId) {
    case 'source': {
      const sources = countBy(
        graph.entities.flatMap((entity) => entity.provenance),
        (item) => item.sourceId,
      );
      return {
        text: `${sources.size} source(s) contributed to this publication.`,
        value: Object.fromEntries(sources),
      };
    }
    case 'discovery': {
      const example = discoveryExample(graph);
      return (
        example && {
          text: `Discovery record for ${example.repository.name}.`,
          value: example.output,
        }
      );
    }
    case 'evidence':
    case 'provenance': {
      const item =
        evidence.find((entry) => entry.id === 'package-name') ?? evidence[0];
      return (
        item && {
          text: `${item.label} "${item.value}" from ${item.source} at ${item.locator}.`,
          value: item.provenance[0],
          provenance: item.provenance,
        }
      );
    }
    case 'knowledge-model':
      return {
        text: `${graph.entities.length} entities and ${graph.relationships.length} relationships.`,
        value: {
          entities: Object.fromEntries(
            countBy(graph.entities, (entity) => entity.type),
          ),
          relationships: Object.fromEntries(
            countBy(graph.relationships, (rel) => rel.type),
          ),
        },
      };
    case 'publication':
      return { text: `Publication v${graph.meta.version}.`, value: graph.meta };
    case 'extractor':
    case 'parser-pack': {
      const contributions = extractorContributions(graph);
      return {
        text: `${contributions.length} extractors contributed to this publication.`,
        value: contributions.map(
          ({ extractorId, entities, relationships }) => ({
            extractorId,
            entities,
            relationships,
          }),
        ),
      };
    }
    case 'relationship': {
      const item = evidence.find((entry) => entry.id === 'dependency');
      return (
        item && {
          text: `${item.value} (confidence ${item.confidence ?? 'n/a'}).`,
          value: item.relationship,
          provenance: item.provenance,
        }
      );
    }
    case 'consumer':
    case 'context-package': {
      const journey = dependentsJourney(graph, '');
      return (
        journey && {
          text:
            conceptId === 'consumer'
              ? 'This page consumes the publication to answer questions like the one below.'
              : `A context package for "${journey.question}" might contain:`,
          value: {
            question: journey.question,
            subject: {
              id: journey.target.id,
              name: journey.target.name,
              type: journey.target.type,
            },
            facts: journey.dependents.slice(0, 5).map((fact) => ({
              statement: `${fact.source.name} DEPENDS_ON ${fact.target.name}`,
              evidence: fact.relationship.provenance.map(
                (item) =>
                  `${displayPath(item.documentPath)} ${describeLocatorShort(item)}`,
              ),
            })),
          },
        }
      );
    }
    default:
      return undefined;
  }
}

// --------------------------------------------------------------- diagrams

const mermaidId = (value: string) =>
  `n_${value.replace(/[^A-Za-z0-9_]/g, '_')}`;
const mermaidLabel = (value: string) => value.replace(/["<>]/g, "'");

export function pipelineDiagram(
  stages: { id: string; title: string; output: string }[],
): string {
  const lines = ['flowchart LR'];
  for (const stage of stages)
    lines.push(
      `  ${mermaidId(stage.id)}["${mermaidLabel(stage.title)}<br/><small>${mermaidLabel(stage.output)}</small>"]`,
    );
  for (let i = 1; i < stages.length; i += 1)
    lines.push(
      `  ${mermaidId(stages[i - 1]!.id)} --> ${mermaidId(stages[i]!.id)}`,
    );
  return lines.join('\n');
}

/** Keeps diagram nodes narrow: long module paths keep only their last segments. */
function shortName(name: string, segments = 2): string {
  const parts = name.split('/');
  return parts.length > segments
    ? `…/${parts.slice(-segments).join('/')}`
    : name;
}

export function dependentsDiagram(
  journey: DependentsJourney,
  limit = 8,
): string {
  const lines = ['flowchart RL'];
  const target = mermaidId(journey.target.id);
  lines.push(`  ${target}(["${mermaidLabel(journey.target.name)}"])`);
  for (const fact of journey.dependents.slice(0, limit)) {
    const id = mermaidId(fact.source.id);
    lines.push(
      `  ${id}["${mermaidLabel(shortName(fact.source.name))}"] --> ${target}`,
    );
  }
  if (journey.dependents.length > limit)
    lines.push(
      `  more["+${journey.dependents.length - limit} more"] -.-> ${target}`,
    );
  return lines.join('\n');
}

export function apisDiagram(journey: ApisJourney, limit = 8): string {
  const lines = [
    'flowchart LR',
    `  repo[("${mermaidLabel(journey.repository)}")]`,
  ];
  for (const { api, operations } of journey.apis) {
    const id = mermaidId(api.id);
    lines.push(`  repo -->|CONTAINS| ${id}["${mermaidLabel(api.name)}"]`);
    for (const operation of operations.slice(0, limit))
      lines.push(
        `  ${id} -->|EXPOSES| ${mermaidId(operation.id)}["${mermaidLabel(operationLabel(operation))}"]`,
      );
    if (operations.length > limit)
      lines.push(
        `  ${id} -.-> ${id}_more["+${operations.length - limit} more"]`,
      );
  }
  return lines.join('\n');
}

export function anatomyDiagram(
  nodes: { id: string; title: string; status: string }[],
): string {
  const lines = ['flowchart LR', '  km(["Knowledge Model"])'];
  for (const node of nodes) {
    const arrow = node.status === 'planned' ? '-.->' : '-->';
    lines.push(
      `  km ${arrow} ${mermaidId(node.id)}["${mermaidLabel(node.title)}"]`,
    );
  }
  return lines.join('\n');
}

export const AI_OS_DIAGRAM = [
  'flowchart TB',
  '  subgraph WB["Workspace Brain · Knowledge Production"]',
  '    direction LR',
  '    d[Discovery] --> e[Evidence] --> k[Knowledge Model] --> p[Publication]',
  '  end',
  '  subgraph AI["AI-OS · Reasoning and Assistance"]',
  '    direction LR',
  '    c[Context] --> r[Reasoning] --> a[Assistance]',
  '  end',
  '  WB ==>|published, cited knowledge| AI',
].join('\n');
