/**
 * The concept catalogue behind "How Workspace Brain Works". Every section of the
 * page (pipeline, glossary, code explorer, onboarding) renders from these
 * records, and every reference is verified against the repository by
 * `concepts.test.ts`, so the documentation cannot silently drift from the code.
 */

export type CodeRefKind =
  | 'function'
  | 'class'
  | 'method'
  | 'type'
  | 'constant'
  | 'table'
  | 'test'
  | 'config'
  | 'doc'
  | 'script'
  | 'component'
  | 'file';

export interface CodeRef {
  /** Repository-relative path. */
  path: string;
  /** Declaration name, Markdown heading, or `text:` literal; omit for whole files. */
  symbol?: string;
  kind: CodeRefKind;
  label?: string;
  description?: string;
}

export type ConceptStatus = 'implemented' | 'partial' | 'planned';

export interface Concept {
  id: string;
  term: string;
  /** What it means. */
  summary: string;
  /** Why it exists. */
  why: string;
  /** Where it is used. */
  whereUsed: string[];
  /** Fallback example; live examples are derived from the publication. */
  example: string;
  status: ConceptStatus;
  implementedBy: CodeRef[];
  adrs: number[];
  /** OpenAPI operation ids. */
  apis: string[];
  /** OpenAPI component schema names. */
  schemas: string[];
  related: string[];
}

const DOMAIN = 'packages/domain/src/index.ts';
const PROCESSING = 'packages/processing-core/src/index.ts';
const HMRC_NORMALIZERS = 'packages/processing-core/src/hmrc-scala-play.ts';
const HMRC_CANDIDATES =
  'packages/processing-core/src/hmrc-scala-play-candidates.ts';
const FILESYSTEM = 'infrastructure/filesystem/src/index.ts';
const DUCKDB = 'infrastructure/duckdb/src/index.ts';
const KNOWLEDGE_STORE = 'infrastructure/duckdb/src/knowledge.ts';
const PUBLICATION_EXPORT = 'infrastructure/duckdb/src/publication-export.ts';
const SEARCH_BUILDER = 'infrastructure/duckdb/src/search-projection-builder.ts';
const SEARCH = 'infrastructure/duckdb/src/search-projection.ts';
const CATALOGUE = 'packages/catalogue/src/index.ts';
const PUBLICATION = 'packages/domain-publication/src/index.ts';
const CURRENCY = 'packages/domain-currency/src/index.ts';
const DIFF = 'services/publication-diff-service/src/engine.ts';
const API_SERVER = 'apps/workspace-brain-api/src/server.ts';
const DISCOVERY_SERVICE = 'apps/workspace-brain-api/src/discovery-service.ts';
const INGESTION_CONSUMER = 'apps/ingestion-worker/src/event-consumer.ts';
const KNOWLEDGE_WORKER = 'apps/knowledge-worker/src/worker.ts';
const EXTRACTORS = 'apps/knowledge-worker/src/knowledge-extractors.ts';
const FRAMEWORK = 'packages/processing-core/src/knowledge-extractors.ts';
const EXPLORER = 'apps/workspace-brain-explorer/src';
const ADD = 'docs/architecture/Workspace-Brain-ADD-v1.md';
const SCHEMA_MIGRATION =
  'infrastructure/duckdb/migrations/016-architectural-knowledge-schema.sql';

export const CONCEPTS: Concept[] = [
  {
    id: 'source',
    term: 'Source',
    summary:
      'A configured location Workspace Brain is allowed to read: today a filesystem root containing repositories, with include/exclude rules and size limits.',
    why: 'Sources make the boundary of what is known explicit. Nothing is discovered unless an operator configured where to look and what to ignore.',
    whereUsed: [
      'config/workspace-brain.yaml declares sources and workspace rules',
      'The API registers that configuration into the catalogue at start-up',
      'Every provenance record carries the sourceId it came from',
    ],
    example:
      'A filesystem source rooted at the workspace folder, excluding node_modules and dist.',
    status: 'implemented',
    implementedBy: [
      { path: 'config/workspace-brain.yaml', kind: 'config' },
      {
        path: 'packages/configuration/src/index.ts',
        symbol: 'parseWorkspaceBrainConfig',
        kind: 'function',
      },
      { path: DOMAIN, symbol: 'Source', kind: 'type' },
      {
        path: DUCKDB,
        symbol: 'registerConfiguration',
        kind: 'method',
        description: 'Upserts configured sources into the catalogue.',
      },
      {
        path: DISCOVERY_SERVICE,
        symbol: 'configForCatalogue',
        kind: 'function',
      },
    ],
    adrs: [23],
    apis: ['listSources', 'listWorkspaces'],
    schemas: ['Source', 'SourceRoot'],
    related: ['discovery', 'provenance'],
  },
  {
    id: 'discovery',
    term: 'Discovery',
    summary:
      'Scanning a source to find repositories and documents, fingerprinting them, classifying each file against the discovery rules and recording what changed.',
    why: 'Discovery turns an unknown file tree into an inventory with stable identities, so later stages only reprocess what actually changed.',
    whereUsed: [
      'A SourceScanRequested event asks the ingestion worker to scan',
      'The filesystem scanner walks roots and fingerprints repositories',
      'The API persists the inventory and publishes discovery events from an outbox',
    ],
    example:
      'A scan finds the workspace-brain repository and emits repository and document discovery events.',
    status: 'implemented',
    implementedBy: [
      {
        path: INGESTION_CONSUMER,
        symbol: 'NatsEventConsumer',
        kind: 'class',
        description: 'Receives scan requests and runs the scanner.',
      },
      {
        path: FILESYSTEM,
        symbol: 'FilesystemSourceScanner',
        kind: 'class',
        description: 'Walks configured roots and produces the scan inventory.',
      },
      {
        path: FILESYSTEM,
        symbol: 'repositoryFingerprint',
        kind: 'function',
        description: 'Identifies repositories by their git metadata.',
      },
      {
        path: FILESYSTEM,
        symbol: 'matchesDiscoveryRules',
        kind: 'function',
        description: 'Applies include/exclude classification rules.',
      },
      {
        path: DISCOVERY_SERVICE,
        symbol: 'createDiscoveryService',
        kind: 'function',
      },
      {
        path: DUCKDB,
        symbol: 'persistScan',
        kind: 'method',
        description: 'Diffs the scan against the inventory and queues events.',
      },
      {
        path: DISCOVERY_SERVICE,
        symbol: 'publishPendingEvents',
        kind: 'function',
      },
      { path: DOMAIN, symbol: 'DiscoveryEvent', kind: 'type' },
      { path: DOMAIN, symbol: 'discoveryEventSubject', kind: 'function' },
      {
        path: 'infrastructure/nats/src/index.ts',
        symbol: 'connectNatsDiscoveryBus',
        kind: 'function',
      },
      { path: 'infrastructure/filesystem/src/index.test.ts', kind: 'test' },
    ],
    adrs: [23, 3],
    apis: ['listRepositories', 'listDocuments'],
    schemas: ['Repository', 'Document'],
    related: ['source', 'evidence'],
  },
  {
    id: 'evidence',
    term: 'Evidence',
    summary:
      'The atomic fact layer: a normalised block of one specific document version with a precise locator (lines, JSON pointer, Scala symbol, route).',
    why: 'Knowledge must be explainable. Evidence pins every fact to an exact place in an exact version of a file, so any claim can be traced back.',
    whereUsed: [
      'Document processors normalise files into evidence blocks',
      'Knowledge extractors read evidence, never raw files',
      'Explain Why and provenance panels render evidence excerpts',
    ],
    example:
      'json-pointer /dependencies/react in apps/workspace-brain-explorer/package.json.',
    status: 'implemented',
    implementedBy: [
      { path: DOMAIN, symbol: 'Evidence', kind: 'type' },
      { path: DOMAIN, symbol: 'EvidenceLocator', kind: 'type' },
      {
        path: DOMAIN,
        symbol: 'processingDefinitionRegistry',
        kind: 'constant',
        description: 'Routes each file to a processor by filename.',
      },
      { path: PROCESSING, symbol: 'documentProcessors', kind: 'constant' },
      {
        path: PROCESSING,
        symbol: 'processDocument',
        kind: 'function',
        description: 'Normalises a document version into evidence blocks.',
      },
      {
        path: KNOWLEDGE_WORKER,
        symbol: 'submitDocumentProcessing',
        kind: 'function',
      },
      {
        path: DUCKDB,
        symbol: 'applyDocumentProcessing',
        kind: 'function',
        description: 'Stores evidence for a document version.',
      },
      { path: DUCKDB, symbol: 'loadEvidenceExplanation', kind: 'function' },
      { path: 'packages/processing-core/src/index.test.ts', kind: 'test' },
    ],
    adrs: [5, 16, 26],
    apis: ['listDocumentEvidence', 'getEvidenceExplanation'],
    schemas: ['Evidence', 'EvidenceLocator', 'EvidenceExplanation'],
    related: ['provenance', 'extractor'],
  },
  {
    id: 'knowledge-model',
    term: 'Knowledge Model',
    summary:
      'The structured, typed graph of entities and relationships that Workspace Brain believes about a workspace, each backed by provenance and a lifecycle status.',
    why: 'Consumers need typed facts ("this API exposes these operations"), not files. A shared schema gives every consumer the same vocabulary.',
    whereUsed: [
      'The knowledge worker applies extractor candidates to it',
      'Reconciliation decides what is observed, established or superseded',
      'Each publication is an immutable snapshot of it',
    ],
    example:
      'Entity "Workspace Brain API" (api) EXPOSES operation "GET /api/v1/health".',
    status: 'implemented',
    implementedBy: [
      { path: DOMAIN, symbol: 'KnowledgeModel', kind: 'type' },
      { path: DOMAIN, symbol: 'KnowledgeEntity', kind: 'type' },
      { path: DOMAIN, symbol: 'knowledgeEntityTypes', kind: 'constant' },
      { path: DOMAIN, symbol: 'EntityLifecycleStatus', kind: 'type' },
      {
        path: KNOWLEDGE_STORE,
        symbol: 'applyKnowledgeCandidates',
        kind: 'function',
      },
      {
        path: KNOWLEDGE_STORE,
        symbol: 'reconcileKnowledgeModel',
        kind: 'function',
      },
      { path: SCHEMA_MIGRATION, symbol: 'knowledge_entities', kind: 'table' },
      { path: ADD, symbol: '4. Knowledge Model contract', kind: 'doc' },
    ],
    adrs: [4, 9, 18],
    apis: [
      'listKnowledgeModels',
      'listKnowledgeEntities',
      'getKnowledgeEntity',
    ],
    schemas: ['KnowledgeModel', 'KnowledgeEntity', 'KnowledgeRelationship'],
    related: ['relationship', 'publication', 'provenance'],
  },
  {
    id: 'publication',
    term: 'Publication',
    summary:
      'An immutable, versioned and content-hashed snapshot of a Knowledge Model, exported as a self-describing package that consumers can verify.',
    why: 'Consumers need a stable thing to read and cite. Immutable publications make answers reproducible and changes diffable.',
    whereUsed: [
      'Published after each successful knowledge reconciliation',
      'Exported as a package by the API and bundled into this Explorer',
      'Diffed between versions and indexed into the search projection',
    ],
    example:
      'A publication package with its metadata, entities and relationships.',
    status: 'implemented',
    implementedBy: [
      {
        path: KNOWLEDGE_STORE,
        symbol: 'publishKnowledgeModel',
        kind: 'function',
        description: 'Freezes the model into an immutable publication.',
      },
      {
        path: PUBLICATION,
        symbol: 'createKnowledgePublicationPackage',
        kind: 'function',
      },
      {
        path: PUBLICATION,
        symbol: 'createKnowledgePublicationContentHash',
        kind: 'function',
      },
      {
        path: PUBLICATION,
        symbol: 'assertKnowledgePublicationPackageIntegrity',
        kind: 'function',
      },
      {
        path: PUBLICATION,
        symbol: 'KnowledgePublicationPackage',
        kind: 'type',
      },
      {
        path: PUBLICATION_EXPORT,
        symbol: 'getKnowledgePublicationExport',
        kind: 'function',
      },
      { path: DIFF, symbol: 'comparePublicationSnapshots', kind: 'function' },
      {
        path: SCHEMA_MIGRATION,
        symbol: 'knowledge_publications',
        kind: 'table',
      },
      { path: 'packages/domain-publication/src/index.test.ts', kind: 'test' },
    ],
    adrs: [18, 20],
    apis: [
      'getLatestKnowledgePublication',
      'exportKnowledgePublication',
      'getPublicationDiff',
    ],
    schemas: ['KnowledgePublication', 'KnowledgePublicationPackage'],
    related: ['knowledge-model', 'consumer', 'currency'],
  },
  {
    id: 'parser-pack',
    term: 'Parser Pack',
    summary:
      'A bundle of processing definitions, document processors, evidence locators and knowledge extractors that teaches Workspace Brain how one organisation structures software.',
    why: 'Every organisation builds software differently. Packs keep organisation-specific rules out of the core, so new ecosystems are added rather than hard-coded.',
    whereUsed: [
      'Processing definitions route files to processors',
      'Processors normalise files into evidence',
      'Pack extractors turn that evidence into candidates',
    ],
    example:
      'hmrc-scala-play recognises Play routes, HOCON configuration and Scala components.',
    status: 'partial',
    implementedBy: [
      {
        path: DOMAIN,
        symbol: 'processingDefinitionRegistry',
        kind: 'constant',
      },
      { path: PROCESSING, symbol: 'documentProcessors', kind: 'constant' },
      {
        path: HMRC_NORMALIZERS,
        symbol: 'normalizePlayRoutes',
        kind: 'function',
      },
      {
        path: HMRC_CANDIDATES,
        symbol: 'analyzeHmrcScalaPlayRepository',
        kind: 'function',
      },
      {
        path: 'docs/parser-packs/hmrc-scala-play-extractor-contracts.md',
        kind: 'doc',
      },
      {
        path: 'packages/processing-core/src/hmrc-scala-play-candidates.test.ts',
        kind: 'test',
      },
      { path: 'scripts/validate-hmrc-scala-play.mjs', kind: 'script' },
    ],
    adrs: [16, 28],
    apis: [],
    schemas: [],
    related: ['extractor', 'evidence'],
  },
  {
    id: 'extractor',
    term: 'Extractor',
    summary:
      'A deterministic, versioned function that reads evidence and proposes knowledge candidates (entities and relationships) with provenance.',
    why: 'Extraction is where understanding happens. Keeping extractors small, deterministic and versioned makes knowledge reproducible and attributable.',
    whereUsed: [
      'The knowledge worker runs every registered extractor per repository',
      'Each candidate records which extractor and version produced it',
      'Stage ordering lets later extractors build on earlier entities',
    ],
    example: 'openapi-operations emits api and operation entities and EXPOSES.',
    status: 'implemented',
    implementedBy: [
      { path: FRAMEWORK, symbol: 'KnowledgeExtractor', kind: 'type' },
      { path: FRAMEWORK, symbol: 'CandidateBuilder', kind: 'class' },
      { path: EXTRACTORS, symbol: 'knowledgeExtractors', kind: 'constant' },
      {
        path: EXTRACTORS,
        symbol: 'extractKnowledgeCandidates',
        kind: 'function',
      },
      {
        path: 'apps/knowledge-worker/src/extractors/openapi.ts',
        symbol: 'openApiExtractor',
        kind: 'constant',
      },
      {
        path: KNOWLEDGE_WORKER,
        symbol: 'createKnowledgeWorker',
        kind: 'function',
      },
      {
        path: 'apps/knowledge-worker/src/knowledge-extractors.test.ts',
        kind: 'test',
      },
    ],
    adrs: [26, 15],
    apis: [],
    schemas: [],
    related: ['evidence', 'parser-pack', 'knowledge-model'],
  },
  {
    id: 'relationship',
    term: 'Relationship',
    summary:
      'A typed, directed edge between two entities from a controlled vocabulary (DEPENDS_ON, CONTAINS, EXPOSES, REFERENCES and others) with confidence and provenance.',
    why: 'Most useful questions are about connections: what depends on this, what does this expose. A fixed vocabulary keeps those answers comparable.',
    whereUsed: [
      'Extractors emit relationships alongside entities',
      'The API traverses them for incoming and outgoing queries',
      'The Explorer graph and query journeys walk them',
    ],
    example: 'Module A DEPENDS_ON module B because of an import statement.',
    status: 'implemented',
    implementedBy: [
      { path: DOMAIN, symbol: 'knowledgeRelationshipTypes', kind: 'constant' },
      { path: DOMAIN, symbol: 'KnowledgeRelationship', kind: 'type' },
      {
        path: SCHEMA_MIGRATION,
        symbol: 'knowledge_relationships',
        kind: 'table',
      },
      { path: ADD, symbol: '6. Relationship vocabulary', kind: 'doc' },
    ],
    adrs: [4],
    apis: ['listPublishedEntityRelationships', 'getPublishedRelationship'],
    schemas: ['KnowledgeRelationship', 'KnowledgeRelationshipType'],
    related: ['knowledge-model'],
  },
  {
    id: 'currency',
    term: 'Currency',
    summary:
      'Whether a published fact still reflects the current version of the documents that support it: current, stale or unknown.',
    why: 'Publications are immutable but code keeps moving. Currency tells consumers how far they can trust a fact today without republishing.',
    whereUsed: [
      'Computed per publication against current document versions',
      'Surfaced by the API and the Explorer data-source badge',
    ],
    example:
      'An entity becomes stale when its supporting document has a newer version.',
    status: 'implemented',
    implementedBy: [
      {
        path: CURRENCY,
        symbol: 'classifyPublicationCurrency',
        kind: 'function',
      },
      { path: CURRENCY, symbol: 'CurrencyState', kind: 'constant' },
      { path: 'packages/domain-currency/src/index.test.ts', kind: 'test' },
    ],
    adrs: [],
    apis: ['getPublicationCurrency', 'listPublicationCurrencyDetails'],
    schemas: ['PublicationCurrencySummary', 'CurrencyState'],
    related: ['publication', 'provenance'],
  },
  {
    id: 'provenance',
    term: 'Provenance',
    summary:
      'The chain from a fact back to its evidence: source, document version, processor, extraction rule, extractor and locator.',
    why: 'Trust. Every claim Workspace Brain publishes can answer "how do you know?" with an exact file, version and location.',
    whereUsed: [
      'Attached to every entity and relationship',
      'Exported inside every publication package',
      'Rendered by the Explain Why screen and evidence panels',
    ],
    example:
      'openapi-operations v1 → openapi/openapi.json → json-pointer into /paths.',
    status: 'implemented',
    implementedBy: [
      { path: DOMAIN, symbol: 'KnowledgeProvenance', kind: 'type' },
      {
        path: PUBLICATION,
        symbol: 'PublishedKnowledgeProvenance',
        kind: 'type',
      },
      { path: DUCKDB, symbol: 'resolveKnowledgeProvenance', kind: 'function' },
      {
        path: `${EXPLORER}/components/evidence-panel.tsx`,
        symbol: 'EvidencePanel',
        kind: 'component',
      },
      { path: ADD, symbol: '7. Provenance', kind: 'doc' },
    ],
    adrs: [5],
    apis: ['getPublishedEntityProvenance', 'getEvidenceExplanation'],
    schemas: ['KnowledgeProvenance', 'PublishedKnowledgeProvenance'],
    related: ['evidence', 'publication'],
  },
  {
    id: 'consumer',
    term: 'Consumer',
    summary:
      'Anything that reads publications rather than producing knowledge: this Explorer, API clients, search and AI-OS.',
    why: 'Separating production from consumption keeps Workspace Brain focused on being correct, and lets many consumers share one trusted model.',
    whereUsed: [
      'The REST API is the supported consumption boundary',
      'The Explorer reads the export (live) or a bundled snapshot',
      'AI-OS consumes publications as context',
    ],
    example: 'This page is a consumer: it reads the latest publication export.',
    status: 'implemented',
    implementedBy: [
      { path: API_SERVER, symbol: 'createApiServer', kind: 'function' },
      { path: CATALOGUE, symbol: 'CatalogueReader', kind: 'type' },
      {
        path: `${EXPLORER}/lib/queries.ts`,
        symbol: 'useKnowledge',
        kind: 'function',
      },
      { path: 'test/contract/openapi.test.ts', kind: 'test' },
    ],
    adrs: [20, 2, 1],
    apis: ['exportKnowledgePublication', 'searchProjectedEntities'],
    schemas: ['KnowledgePublicationPackage'],
    related: ['publication', 'context-package'],
  },
  {
    id: 'context-package',
    term: 'Context Package',
    summary:
      'A future publication format: a curated, size-bounded slice of a publication with provenance, shaped for an AI assistant to reason over.',
    why: 'AI-OS needs relevant, citable context rather than a whole graph. Context packages would be generated from the same Knowledge Model as every other publication.',
    whereUsed: [
      'Not implemented yet; AI-OS reads publications through the API today',
      'Planned as another projection of a publication, like the search index',
    ],
    example:
      'For "what depends on X?": X, its dependents and the evidence for each edge.',
    status: 'planned',
    implementedBy: [
      { path: 'docs/adr/ADR-002-ai-os-relationship.md', kind: 'doc' },
      {
        path: SEARCH_BUILDER,
        symbol: 'buildSearchProjection',
        kind: 'function',
        description: 'The closest existing projection pattern.',
      },
    ],
    adrs: [2, 15],
    apis: [],
    schemas: [],
    related: ['consumer', 'publication'],
  },
];

export const CONCEPT_BY_ID = new Map(CONCEPTS.map((item) => [item.id, item]));

export function concept(id: string): Concept {
  const found = CONCEPT_BY_ID.get(id);
  if (!found) throw new Error(`Unknown concept ${id}`);
  return found;
}

/** Section 1's flow; each stage is a view onto a concept. */
export interface PipelineStage {
  id: string;
  title: string;
  conceptId: string;
  tagline: string;
  input: string;
  output: string;
}

export const PIPELINE: PipelineStage[] = [
  {
    id: 'sources',
    title: 'Sources',
    conceptId: 'source',
    tagline: 'Where knowledge comes from',
    input: 'workspace-brain.yaml',
    output: 'Registered sources',
  },
  {
    id: 'discovery',
    title: 'Discovery',
    conceptId: 'discovery',
    tagline: 'Find and fingerprint repositories and files',
    input: 'Repository metadata',
    output: 'Discovery record and events',
  },
  {
    id: 'evidence',
    title: 'Evidence',
    conceptId: 'evidence',
    tagline: 'Normalise files into atomic, located facts',
    input: 'Document versions',
    output: 'Evidence blocks with locators',
  },
  {
    id: 'knowledge-model',
    title: 'Knowledge Model',
    conceptId: 'knowledge-model',
    tagline: 'Turn evidence into typed entities and relationships',
    input: 'Evidence and extractors',
    output: 'Entities, relationships, provenance',
  },
  {
    id: 'publication',
    title: 'Publication',
    conceptId: 'publication',
    tagline: 'Freeze an immutable, verifiable snapshot',
    input: 'Reconciled model',
    output: 'Content-hashed package',
  },
  {
    id: 'consumers',
    title: 'Consumers',
    conceptId: 'consumer',
    tagline: 'Explorer, API, search and AI-OS read it',
    input: 'Publication package',
    output: 'Answers and context',
  },
];

export const SEARCH_REFS: CodeRef[] = [
  { path: SEARCH_BUILDER, symbol: 'buildSearchProjection', kind: 'function' },
  { path: SEARCH_BUILDER, symbol: 'normalizeSearchText', kind: 'function' },
  { path: SEARCH, symbol: 'searchProjectedEntities', kind: 'function' },
  { path: SEARCH, symbol: 'getProjectionStatistics', kind: 'function' },
];

export const API_REFS: CodeRef[] = [
  { path: 'openapi/openapi.json', kind: 'config', label: 'OpenAPI contract' },
  { path: API_SERVER, symbol: 'createApiServer', kind: 'function' },
  { path: CATALOGUE, symbol: 'CatalogueReader', kind: 'type' },
  { path: CATALOGUE, symbol: 'PublicationExportReader', kind: 'type' },
  { path: 'test/contract/openapi.test.ts', kind: 'test' },
];

export const EXPLORER_REFS: CodeRef[] = [
  {
    path: `${EXPLORER}/lib/knowledge-graph.ts`,
    symbol: 'buildKnowledgeGraph',
    kind: 'function',
    description: 'Indexes a publication package for the Explorer.',
  },
  {
    path: `${EXPLORER}/lib/knowledge-graph.ts`,
    symbol: 'searchEntities',
    kind: 'function',
  },
  {
    path: `${EXPLORER}/lib/queries.ts`,
    symbol: 'useKnowledge',
    kind: 'function',
  },
  { path: `${EXPLORER}/lib/api.ts`, symbol: 'api', kind: 'constant' },
];

export const PATHS = {
  DOMAIN,
  PROCESSING,
  HMRC_NORMALIZERS,
  HMRC_CANDIDATES,
  FILESYSTEM,
  DUCKDB,
  KNOWLEDGE_STORE,
  PUBLICATION,
  PUBLICATION_EXPORT,
  SEARCH,
  SEARCH_BUILDER,
  CATALOGUE,
  CURRENCY,
  DIFF,
  API_SERVER,
  DISCOVERY_SERVICE,
  INGESTION_CONSUMER,
  KNOWLEDGE_WORKER,
  EXTRACTORS,
  FRAMEWORK,
  EXPLORER,
  ADD,
  SCHEMA_MIGRATION,
} as const;
