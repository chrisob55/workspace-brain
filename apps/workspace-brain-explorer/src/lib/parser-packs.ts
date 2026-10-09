import type { KnowledgeGraph } from './knowledge-graph';
import type { ProvenanceItem } from './types';

export interface ParserPack {
  id: string;
  name: string;
  description: string;
  color: string;
  status: 'current' | 'future';
  extractors: string[];
  /** Matches legacy aggregated provenance by processor when the extractor ID is generic. */
  processors?: string[];
  produces: string[];
}

export const CURRENT_PACKS: ParserPack[] = [
  {
    id: 'typescript',
    name: 'TypeScript',
    description: 'Imports, package manifests and container base images.',
    color: '#60a5fa',
    status: 'current',
    extractors: [
      'typescript-dependencies',
      'package-dependencies',
      'container-images',
    ],
    processors: ['typescript', 'dockerfile'],
    produces: ['module', 'package', 'container', 'DEPENDS_ON'],
  },
  {
    id: 'openapi',
    name: 'OpenAPI',
    description: 'APIs and the operations their contracts declare.',
    color: '#f59e0b',
    status: 'current',
    extractors: ['openapi-operations'],
    produces: ['api', 'operation', 'EXPOSES'],
  },
  {
    id: 'adr',
    name: 'ADR',
    description: 'Explicit architecture decision records and their metadata.',
    color: '#f472b6',
    status: 'current',
    extractors: ['architectural-decisions'],
    produces: ['architectural-decision', 'REFERENCES'],
  },
  {
    id: 'markdown',
    name: 'Markdown',
    description: 'Documents and the actual links between them.',
    color: '#22d3ee',
    status: 'current',
    extractors: ['markdown-references'],
    produces: ['document', 'REFERENCES'],
  },
  {
    id: 'structure',
    name: 'Repository structure',
    description: 'Frozen Git boundaries: which repository contains what.',
    color: '#34d399',
    status: 'current',
    extractors: ['repository-structure'],
    produces: ['repository', 'CONTAINS'],
  },
];

export const FUTURE_PACKS: ParserPack[] = [
  {
    id: 'scala-play',
    name: 'HMRC Scala Play',
    description:
      'routes files, build.sbt, application.conf, service manifests.',
    color: '#ef4444',
    status: 'future',
    extractors: [],
    produces: ['service', 'operation', 'DEPENDS_ON', 'EXPOSES'],
  },
  {
    id: 'spring-boot',
    name: 'Spring Boot',
    description:
      'Controllers, Maven/Gradle dependencies, application properties.',
    color: '#84cc16',
    status: 'future',
    extractors: [],
    produces: ['service', 'operation', 'package'],
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    description: 'Deployments, services, ingresses and the images they run.',
    color: '#3b82f6',
    status: 'future',
    extractors: [],
    produces: ['workload', 'container', 'EXPOSES'],
  },
  {
    id: 'terraform',
    name: 'Terraform',
    description: 'Infrastructure resources, modules and their dependencies.',
    color: '#a855f7',
    status: 'future',
    extractors: [],
    produces: ['resource', 'module', 'DEPENDS_ON'],
  },
  {
    id: 'confluence',
    name: 'Confluence',
    description: 'Design pages, decision logs and the links between them.',
    color: '#0ea5e9',
    status: 'future',
    extractors: [],
    produces: ['document', 'architectural-decision', 'REFERENCES'],
  },
];

export function packOf(item: ProvenanceItem): string | undefined {
  const extractorId = item.knowledgeExtractorId ?? item.extractionRuleId;
  const direct = CURRENT_PACKS.find((pack) =>
    pack.extractors.includes(extractorId),
  );
  if (direct) return direct.id;
  if (item.processorId === 'json' && item.locator.kind === 'json-pointer') {
    return item.locator.pointer.startsWith('/paths/') ||
      item.locator.pointer.startsWith('/info')
      ? 'openapi'
      : 'typescript';
  }
  return CURRENT_PACKS.find((pack) =>
    pack.processors?.includes(item.processorId),
  )?.id;
}

export interface PackContribution {
  pack: ParserPack;
  entities: number;
  relationships: number;
  evidence: number;
  extractorIds: string[];
}

/** Facts supported by at least one provenance record from each pack. */
export function packContributions(graph: KnowledgeGraph): PackContribution[] {
  const stats = new Map(
    CURRENT_PACKS.map((pack) => [
      pack.id,
      {
        entities: new Set<string>(),
        relationships: new Set<string>(),
        evidence: new Set<string>(),
        extractors: new Set<string>(),
      },
    ]),
  );
  const visit = (
    kind: 'entities' | 'relationships',
    id: string,
    items: ProvenanceItem[],
  ) => {
    for (const item of items) {
      const packId = packOf(item);
      const entry = packId ? stats.get(packId) : undefined;
      if (!entry) continue;
      entry[kind].add(id);
      entry.evidence.add(item.evidenceId);
      entry.extractors.add(item.knowledgeExtractorId ?? item.extractionRuleId);
    }
  };
  for (const entity of graph.entities)
    visit('entities', entity.id, entity.provenance);
  for (const rel of graph.relationships)
    visit('relationships', rel.id, rel.provenance);
  return CURRENT_PACKS.map((pack) => {
    const entry = stats.get(pack.id)!;
    return {
      pack,
      entities: entry.entities.size,
      relationships: entry.relationships.size,
      evidence: entry.evidence.size,
      extractorIds: [...entry.extractors].sort(),
    };
  });
}
