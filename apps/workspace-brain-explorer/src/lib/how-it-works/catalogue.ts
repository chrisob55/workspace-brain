/**
 * Section content for "How Workspace Brain Works" that is not a single concept:
 * parser packs, publication anatomy, onboarding and quick links. Lists of
 * processors, extractors, locators and scripts come from the implementation
 * metadata rather than being restated here.
 */
import {
  CORE_LOCATOR_KINDS,
  CORE_PROCESSORS,
  HMRC_CANDIDATES_PATH,
  HMRC_LOCATOR_KINDS,
  HMRC_NORMALIZERS_PATH,
  HMRC_PACK,
  HMRC_PROCESSORS,
  KNOWLEDGE_EXTRACTORS,
  PROCESSING_DEFINITIONS,
  ROOT_SCRIPTS,
  type DocumentProcessorMetadata,
} from '../implementation-metadata';
import { PATHS, type CodeRef } from './concepts';

export type PackStatus = 'published' | 'candidates' | 'illustrative';

export interface PackRule {
  rule: string;
  effect: string;
}

export interface ParserPackDoc {
  id: string;
  name: string;
  status: PackStatus;
  statusNote: string;
  summary: string;
  recognises: string[];
  files: string[];
  rules: PackRule[];
  evidence: string[];
  knowledge: string[];
  processors: DocumentProcessorMetadata[];
  refs: CodeRef[];
  adrs: number[];
}

const unique = <T>(items: T[]) => [...new Set(items)];

function processorRules(processors: DocumentProcessorMetadata[]): PackRule[] {
  return processors.map((processor) => ({
    rule: processor.files.join(', '),
    effect: `${processor.id} v${processor.version} → ${processor.extractionRuleId}`,
  }));
}

const coreExtractors = KNOWLEDGE_EXTRACTORS;

export const PARSER_PACKS: ParserPackDoc[] = [
  {
    id: 'generic-typescript',
    name: 'Generic TypeScript Pack',
    status: 'published',
    statusNote: 'Built in; produces the published Knowledge Model today.',
    summary:
      'The core pack: understands TypeScript monorepos, package manifests, OpenAPI contracts, Dockerfiles and Markdown ADRs.',
    recognises: [
      'Repositories and workspace packages',
      'TypeScript modules and their imports',
      'OpenAPI contracts and their operations',
      'Container images',
      'Architecture decision records and document links',
    ],
    files: unique(CORE_PROCESSORS.flatMap((processor) => processor.files)),
    rules: [
      ...processorRules(CORE_PROCESSORS),
      ...coreExtractors.map((extractor) => ({
        rule: `${extractor.id} v${extractor.version} (stage ${extractor.stage})`,
        effect: [
          ...extractor.emitsEntities,
          ...extractor.emitsRelationships,
        ].join(', '),
      })),
    ],
    evidence: CORE_LOCATOR_KINDS,
    knowledge: unique([
      ...coreExtractors.flatMap((extractor) => extractor.emitsEntities),
      ...coreExtractors.flatMap((extractor) => extractor.emitsRelationships),
    ]),
    processors: CORE_PROCESSORS,
    refs: [
      {
        path: PATHS.PROCESSING,
        symbol: 'documentProcessors',
        kind: 'constant',
      },
      {
        path: PATHS.EXTRACTORS,
        symbol: 'knowledgeExtractors',
        kind: 'constant',
      },
      ...unique(coreExtractors.map((extractor) => extractor.path)).map(
        (path): CodeRef => ({ path, kind: 'file' }),
      ),
      {
        path: 'apps/knowledge-worker/src/knowledge-extractors.test.ts',
        kind: 'test',
      },
    ],
    adrs: [16, 26],
  },
  {
    id: HMRC_PACK.id,
    name: 'HMRC Scala Play Pack',
    status: 'candidates',
    statusNote: `Pack ${HMRC_PACK.id} v${HMRC_PACK.version}: candidate analysis implemented, not yet published into the Knowledge Model (ADR-028).`,
    summary:
      'Teaches Workspace Brain how HMRC builds Scala Play services: route files, HOCON configuration, controllers, connectors and outbound HTTP calls.',
    recognises: [
      'Play routes and included route files',
      'HOCON service configuration and base URLs',
      'Scala controllers, services and connectors',
      'Outbound HTTP interactions between services',
    ],
    files: unique(HMRC_PROCESSORS.flatMap((processor) => processor.files)),
    rules: [
      ...processorRules(HMRC_PROCESSORS),
      ...HMRC_PACK.extractors.map((extractor) => ({
        rule: extractor.id,
        effect: `${extractor.constant} in the candidate analysis`,
      })),
    ],
    evidence: HMRC_LOCATOR_KINDS,
    knowledge: HMRC_PACK.candidateTypes,
    processors: HMRC_PROCESSORS,
    refs: [
      {
        path: HMRC_NORMALIZERS_PATH,
        symbol: 'normalizePlayRoutes',
        kind: 'function',
      },
      {
        path: HMRC_NORMALIZERS_PATH,
        symbol: 'normalizeHocon',
        kind: 'function',
      },
      {
        path: HMRC_NORMALIZERS_PATH,
        symbol: 'normalizeScala',
        kind: 'function',
      },
      {
        path: HMRC_CANDIDATES_PATH,
        symbol: 'analyzeHmrcScalaPlayRepository',
        kind: 'function',
      },
      {
        path: 'packages/processing-core/src/hmrc-scala-play-candidates.test.ts',
        kind: 'test',
      },
      {
        path: 'docs/parser-packs/hmrc-scala-play-extractor-contracts.md',
        kind: 'doc',
      },
      { path: 'scripts/validate-hmrc-scala-play.mjs', kind: 'script' },
    ],
    adrs: [28, 16],
  },
  {
    id: 'organisation-xyz-spring',
    name: 'Organisation XYZ Spring Pack',
    status: 'illustrative',
    statusNote:
      'Illustrative template only. Nothing below exists in the codebase; it shows what a new organisation would add.',
    summary:
      'A hypothetical pack for an organisation building Java Spring Boot services with Maven and application.yml configuration.',
    recognises: [
      'Maven and Gradle modules',
      '@RestController endpoints',
      'Spring configuration properties',
      'Feign / WebClient outbound calls',
    ],
    files: ['pom.xml', 'build.gradle', '*.java', 'application.yml'],
    rules: [
      { rule: '*.java', effect: 'java-source → java-symbols-and-annotations' },
      { rule: 'pom.xml', effect: 'maven-pom → maven-dependencies' },
      { rule: '@GetMapping("/x")', effect: 'operation GET /x' },
      { rule: '@FeignClient(url = …)', effect: 'service DEPENDS_ON service' },
    ],
    evidence: [
      'java-symbol (new locator)',
      'yaml-lines',
      'xml-path (new locator)',
    ],
    knowledge: ['package', 'api', 'operation', 'EXPOSES', 'DEPENDS_ON'],
    processors: [],
    refs: [],
    adrs: [16],
  },
];

export interface PackChecklistItem {
  id: string;
  title: string;
  description: string;
  refs: CodeRef[];
}

/** "What gets added when a new parser pack is created?" — modelled on the HMRC pack. */
export const NEW_PACK_CHECKLIST: PackChecklistItem[] = [
  {
    id: 'definition',
    title: 'Parser Definition',
    description: `Register filename matches in the processing definition registry (${PROCESSING_DEFINITIONS.length} today) and add a processor with an id and version.`,
    refs: [
      {
        path: PATHS.DOMAIN,
        symbol: 'processingDefinitionRegistry',
        kind: 'constant',
      },
      {
        path: PATHS.PROCESSING,
        symbol: 'documentProcessors',
        kind: 'constant',
      },
    ],
  },
  {
    id: 'rules',
    title: 'Rules',
    description:
      'Write the normaliser that turns a file into blocks: what is a route, a symbol or a config key in this ecosystem.',
    refs: [
      {
        path: HMRC_NORMALIZERS_PATH,
        symbol: 'normalizePlayRoutes',
        kind: 'function',
      },
      {
        path: HMRC_NORMALIZERS_PATH,
        symbol: 'normalizeScala',
        kind: 'function',
      },
    ],
  },
  {
    id: 'evidence',
    title: 'Evidence Mappings',
    description:
      'Add evidence locator kinds so every block can point to an exact place in the file, and keep the OpenAPI contract in step.',
    refs: [
      { path: PATHS.DOMAIN, symbol: 'EvidenceLocator', kind: 'type' },
      {
        path: 'openapi/openapi.json',
        symbol: 'EvidenceLocator',
        kind: 'config',
      },
    ],
  },
  {
    id: 'knowledge',
    title: 'Knowledge Mappings',
    description:
      'Write deterministic extractors that read the evidence and emit entity and relationship candidates with provenance.',
    refs: [
      { path: PATHS.FRAMEWORK, symbol: 'KnowledgeExtractor', kind: 'type' },
      { path: PATHS.FRAMEWORK, symbol: 'CandidateBuilder', kind: 'class' },
      {
        path: PATHS.EXTRACTORS,
        symbol: 'knowledgeExtractors',
        kind: 'constant',
      },
      {
        path: HMRC_CANDIDATES_PATH,
        symbol: 'analyzeHmrcScalaPlayRepository',
        kind: 'function',
      },
    ],
  },
  {
    id: 'tests',
    title: 'Tests',
    description:
      'Prove the pack with fixtures and a validation script against a real repository.',
    refs: [
      {
        path: 'packages/processing-core/src/hmrc-scala-play-candidates.test.ts',
        kind: 'test',
      },
      { path: 'scripts/validate-hmrc-scala-play.mjs', kind: 'script' },
    ],
  },
];

export interface AnatomyNode {
  id: string;
  title: string;
  status: 'implemented' | 'planned';
  purpose: string;
  producer: CodeRef;
  consumer: string;
  /** OpenAPI schema name, when one describes the output. */
  schema?: string;
  operationId?: string;
}

export const PUBLICATION_ANATOMY: AnatomyNode[] = [
  {
    id: 'explorer-view',
    title: 'Explorer View',
    status: 'implemented',
    purpose:
      'Interactive, human-readable views (graph, ADRs, this page) built from the exported package.',
    producer: {
      path: `${PATHS.EXPLORER}/lib/knowledge-graph.ts`,
      symbol: 'buildKnowledgeGraph',
      kind: 'function',
    },
    consumer: 'Developers, architects and stakeholders',
    schema: 'KnowledgePublicationPackage',
  },
  {
    id: 'json-publication',
    title: 'JSON Publication',
    status: 'implemented',
    purpose:
      'The canonical, integrity-checked package: metadata, entities and relationships with provenance.',
    producer: {
      path: PATHS.PUBLICATION,
      symbol: 'createKnowledgePublicationPackage',
      kind: 'function',
    },
    consumer: 'Snapshots, offline tools, AI-OS',
    schema: 'KnowledgePublicationPackage',
    operationId: 'exportKnowledgePublication',
  },
  {
    id: 'rest-api',
    title: 'REST API',
    status: 'implemented',
    purpose:
      'Fine-grained reads of one published entity, its relationships and provenance.',
    producer: {
      path: PATHS.API_SERVER,
      symbol: 'createApiServer',
      kind: 'function',
    },
    consumer: 'Services, scripts and integrations',
    schema: 'PublishedEntity',
    operationId: 'getPublishedEntity',
  },
  {
    id: 'search-index',
    title: 'Search Index',
    status: 'implemented',
    purpose:
      'A rebuildable projection of a publication, normalised for text search.',
    producer: {
      path: PATHS.SEARCH_BUILDER,
      symbol: 'buildSearchProjection',
      kind: 'function',
    },
    consumer: 'Search UIs and lookup APIs',
    schema: 'ProjectedEntitySearchResults',
    operationId: 'searchProjectedEntities',
  },
  {
    id: 'ai-context',
    title: 'Future AI Context',
    status: 'planned',
    purpose:
      'A context package: a bounded, cited slice of a publication shaped for AI-OS reasoning.',
    producer: { path: 'docs/adr/ADR-002-ai-os-relationship.md', kind: 'doc' },
    consumer: 'AI-OS',
  },
];

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  /** Root package.json scripts, verified to exist. */
  scripts: string[];
  commands: string[];
  refs: CodeRef[];
  /** Section on this page to visit. */
  section?: string;
  /** Another Explorer screen to visit. */
  screen?: string;
}

export const ONBOARDING: OnboardingStep[] = [
  {
    id: 'overview',
    title: 'Platform Overview',
    description:
      'Read the mission and the pipeline, then the architecture definition document.',
    scripts: [],
    commands: [],
    refs: [
      { path: 'README.md', kind: 'doc' },
      { path: PATHS.ADD, symbol: '1. Executive summary', kind: 'doc' },
    ],
    section: 'overview',
  },
  {
    id: 'create-parser-pack',
    title: 'Create Parser Pack',
    description:
      'Follow the parser-pack checklist: definition, rules, evidence mappings, knowledge mappings and tests.',
    scripts: ['validate:hmrc-scala-play'],
    commands: [],
    refs: [
      {
        path: PATHS.PROCESSING,
        symbol: 'documentProcessors',
        kind: 'constant',
      },
      {
        path: 'docs/parser-packs/hmrc-scala-play-extractor-contracts.md',
        kind: 'doc',
      },
    ],
    section: 'parser-packs',
  },
  {
    id: 'run-discovery',
    title: 'Run Discovery',
    description:
      'Start the stack, point config/workspace-brain.yaml at a folder and let the scanner discover repositories.',
    scripts: ['test:smoke:discovery'],
    commands: ['docker compose -f deploy/compose/compose.yaml up --build'],
    refs: [
      { path: 'config/workspace-brain.yaml', kind: 'config' },
      { path: 'deploy/compose/compose.yaml', kind: 'config' },
      {
        path: PATHS.FILESYSTEM,
        symbol: 'FilesystemSourceScanner',
        kind: 'class',
      },
    ],
    section: 'pipeline',
  },
  {
    id: 'view-evidence',
    title: 'View Evidence',
    description:
      'Inspect the evidence behind a fact: open any entity provenance or call the evidence explanation endpoint.',
    scripts: ['test:smoke:evidence'],
    commands: [],
    refs: [
      { path: PATHS.PROCESSING, symbol: 'processDocument', kind: 'function' },
      {
        path: PATHS.DUCKDB,
        symbol: 'loadEvidenceExplanation',
        kind: 'function',
      },
    ],
    screen: 'explain',
  },
  {
    id: 'generate-publication',
    title: 'Generate Publication',
    description:
      'Reprocess the architecture so the knowledge worker reconciles and publishes a new immutable version.',
    scripts: ['reprocess:architecture'],
    commands: [],
    refs: [
      {
        path: PATHS.KNOWLEDGE_STORE,
        symbol: 'publishKnowledgeModel',
        kind: 'function',
      },
      {
        path: PATHS.PUBLICATION,
        symbol: 'createKnowledgePublicationPackage',
        kind: 'function',
      },
    ],
    section: 'anatomy',
  },
  {
    id: 'query-explorer',
    title: 'Query Explorer',
    description:
      'Run the Explorer against the live API and follow a query journey through the graph.',
    scripts: [],
    commands: ['pnpm --filter @workspace-brain/workspace-brain-explorer dev'],
    refs: [
      {
        path: `${PATHS.EXPLORER}/lib/knowledge-graph.ts`,
        symbol: 'buildKnowledgeGraph',
        kind: 'function',
      },
    ],
    section: 'journeys',
  },
  {
    id: 'consume-api',
    title: 'Consume via API',
    description:
      'Read the OpenAPI contract and call the publication endpoints; the contract tests keep it honest.',
    scripts: ['test:contract'],
    commands: ['curl http://localhost:3000/api/v1/knowledge/models'],
    refs: [
      { path: 'openapi/openapi.json', kind: 'config' },
      { path: PATHS.API_SERVER, symbol: 'createApiServer', kind: 'function' },
      { path: 'test/contract/openapi.test.ts', kind: 'test' },
    ],
    screen: 'openapi',
  },
];

export function scriptCommand(name: string): string | undefined {
  return ROOT_SCRIPTS[name] === undefined ? undefined : `pnpm ${name}`;
}

export interface QuickLink {
  label: string;
  ref?: CodeRef;
  schema?: string;
  operationId?: string;
  adr?: number;
}

export const QUICK_LINKS: QuickLink[] = [
  {
    label: 'View extractor code',
    ref: {
      path: 'apps/knowledge-worker/src/extractors/openapi.ts',
      symbol: 'openApiExtractor',
      kind: 'constant',
    },
  },
  { label: 'View Knowledge Model schema', schema: 'KnowledgeEntity' },
  { label: 'View publication contract', schema: 'KnowledgePublicationPackage' },
  { label: 'View API endpoint', operationId: 'exportKnowledgePublication' },
  { label: 'View ADR', adr: 4 },
];
