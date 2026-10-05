import type {
  Document,
  DiscoveryEvent,
  DiscoverySource,
  DocumentCandidate,
  DocumentVersion,
  Evidence,
  EvidenceExplanation,
  KnowledgeCandidateEvent,
  KnowledgeEntity,
  KnowledgeInputEvidence,
  KnowledgeModel,
  KnowledgeObjectProvenance,
  KnowledgePublication,
  KnowledgePublicationSummary,
  KnowledgeRelationship,
  PublishedEntity,
  PublishedRelationship,
  PublishedRelationshipTraversal,
  InventoryChange,
  ProjectedEntity,
  ProjectedRelationship,
  ProjectionStatistics,
  SearchMatchMode,
  SearchProjectionSummary,
  InventoryRecord,
  RepositoryCandidate,
  Repository,
  Source,
  Workspace,
} from '@workspace-brain/domain';

export type CataloguePage<T> = {
  readonly items: readonly T[];
};

export type CataloguePageRequest = {
  readonly afterId?: string;
  readonly limit: number;
  readonly sourceId?: string;
  readonly extension?: string;
};

export type ConfiguredSource = {
  readonly configId: string;
  readonly name: string;
  readonly rootPaths: readonly string[];
  readonly excludeDirs: readonly string[];
  readonly includeExtensions: readonly string[];
  readonly maxFileSizeBytes: number;
};

export type ConfiguredWorkspace = {
  readonly configId: string;
  readonly name: string;
  readonly sourceConfigIds: readonly string[];
  readonly include: readonly string[];
  readonly exclude: readonly string[];
};

export type ScanPersistenceResult = {
  readonly repositories: readonly Repository[];
  readonly documents: readonly Document[];
  readonly repositoryChanges: readonly InventoryChange<
    Repository | InventoryRecord
  >[];
  readonly documentChanges: readonly InventoryChange<
    Document | InventoryRecord
  >[];
};

export type SourceScanMetrics = {
  readonly repositoryCount: number;
  readonly documentCount: number;
  readonly addedCount: number;
  readonly modifiedCount: number;
  readonly removedCount: number;
  readonly unchangedCount: number;
  readonly durationMilliseconds: number;
};

export type DocumentProcessingEvent = Extract<
  DiscoveryEvent,
  { readonly eventType: 'DocumentProcessingSubmitted' }
>;

export type DocumentProcessingApplyResult = {
  readonly documentVersion: DocumentVersion;
  readonly evidence: readonly Evidence[];
  readonly duplicate: boolean;
};
export type KnowledgePageRequest = Pick<
  CataloguePageRequest,
  'afterId' | 'limit'
> & {
  readonly knowledgeModelId?: string;
  readonly publicationId?: string;
  readonly lifecycleStatus?: string;
  readonly type?: string;
};

export type PublishedRelationshipRequest = {
  readonly publicationId: string;
  readonly entityId: string;
  readonly direction: 'incoming' | 'outgoing' | 'both';
  readonly relationshipType?: string;
  readonly afterId?: string;
  readonly limit: number;
};

export class CatalogueIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogueIntegrityError';
  }
}

export type SearchTextFilter<Field extends string> = {
  readonly query: string;
  readonly match: SearchMatchMode;
  readonly field: Field;
};

export type SearchEntityRequest = Pick<
  CataloguePageRequest,
  'afterId' | 'limit'
> & {
  readonly publicationId?: string;
  readonly type?: string;
  readonly lifecycleStatus?: string;
  readonly text?: SearchTextFilter<'name' | 'text'>;
};

export type SearchRelationshipRequest = Pick<
  CataloguePageRequest,
  'afterId' | 'limit'
> & {
  readonly publicationId?: string;
  readonly type?: string;
  readonly entityId?: string;
  readonly text?: SearchTextFilter<'type' | 'text'>;
};

export type KnowledgeModelPublishedEvent = Extract<
  DiscoveryEvent,
  { readonly eventType: 'KnowledgeModelPublished' }
>;

export type SearchProjectionRequestedEvent = Extract<
  DiscoveryEvent,
  { readonly eventType: 'SearchProjectionRequested' }
>;

export type { InventoryChange } from '@workspace-brain/domain';

/**
 * Read-only access to the disposable search projection. When publicationId is
 * omitted, reads are scoped to the latest publication of each Knowledge Model.
 */
export interface SearchProjectionReader {
  searchProjectedEntities(
    request: SearchEntityRequest,
  ): Promise<CataloguePage<ProjectedEntity>>;
  searchProjectedRelationships(
    request: SearchRelationshipRequest,
  ): Promise<CataloguePage<ProjectedRelationship>>;
  getProjectedEntity(
    entityId: string,
    publicationId?: string,
  ): Promise<ProjectedEntity | undefined>;
  getProjectedRelationship(
    relationshipId: string,
    publicationId?: string,
  ): Promise<ProjectedRelationship | undefined>;
  getProjectionStatistics(
    publicationId: string,
  ): Promise<ProjectionStatistics | undefined>;
}

/**
 * Projection maintenance. Implementations read only Knowledge Publications and
 * their immutable snapshots and write only projection rows and outbox events.
 */
export interface SearchProjectionWriter {
  requestSearchProjection(event: KnowledgeModelPublishedEvent): Promise<void>;
  buildSearchProjection(
    event: SearchProjectionRequestedEvent,
  ): Promise<SearchProjectionSummary>;
  rebuildSearchProjections(request: {
    readonly mode: 'missing' | 'all';
    readonly correlationId: string;
  }): Promise<readonly SearchProjectionSummary[]>;
}

export interface CatalogueReader {
  listSources(request: CataloguePageRequest): Promise<CataloguePage<Source>>;
  listWorkspaces(
    request: CataloguePageRequest,
  ): Promise<CataloguePage<Workspace>>;
  listRepositories(
    request: CataloguePageRequest,
  ): Promise<CataloguePage<Repository>>;
  listDocuments(
    request: CataloguePageRequest,
  ): Promise<CataloguePage<Document>>;
  listDocumentEvidence(
    documentId: string,
    request: CataloguePageRequest,
  ): Promise<CataloguePage<Evidence>>;
  explainEvidence(evidenceId: string): Promise<EvidenceExplanation | undefined>;
  listKnowledgeInputEvidence(
    documentVersionId: string,
  ): Promise<readonly KnowledgeInputEvidence[]>;
  listKnowledgeModels(
    request: KnowledgePageRequest,
  ): Promise<CataloguePage<KnowledgeModel>>;
  getKnowledgeModel(modelId: string): Promise<KnowledgeModel | undefined>;
  listKnowledgeEntities(
    request: KnowledgePageRequest,
  ): Promise<CataloguePage<KnowledgeEntity>>;
  getKnowledgeEntity(entityId: string): Promise<KnowledgeEntity | undefined>;
  listKnowledgeRelationships(
    request: KnowledgePageRequest,
  ): Promise<CataloguePage<KnowledgeRelationship>>;
  getKnowledgeRelationship(
    relationshipId: string,
  ): Promise<KnowledgeRelationship | undefined>;
  listKnowledgePublications(
    request: KnowledgePageRequest,
  ): Promise<CataloguePage<KnowledgePublication>>;
  listAvailableKnowledgePublications(
    request: KnowledgePageRequest,
  ): Promise<CataloguePage<KnowledgePublication>>;
  getKnowledgePublication(
    publicationId: string,
  ): Promise<KnowledgePublication | undefined>;
  getLatestKnowledgePublication(
    modelId: string,
  ): Promise<KnowledgePublication | undefined>;
  getKnowledgePublicationSummary(
    publicationId: string,
  ): Promise<KnowledgePublicationSummary | undefined>;
  getPublishedEntity(
    publicationId: string,
    entityId: string,
  ): Promise<PublishedEntity | undefined>;
  getPublishedRelationship(
    publicationId: string,
    relationshipId: string,
  ): Promise<PublishedRelationship | undefined>;
  listPublishedEntityRelationships(
    request: PublishedRelationshipRequest,
  ): Promise<CataloguePage<PublishedRelationshipTraversal>>;
  getPublishedEntityProvenance(
    publicationId: string,
    entityId: string,
  ): Promise<KnowledgeObjectProvenance | undefined>;
  getPublishedRelationshipProvenance(
    publicationId: string,
    relationshipId: string,
  ): Promise<KnowledgeObjectProvenance | undefined>;
}

export interface DiscoverySourceProvider {
  listSourcesForDiscovery(
    request: CataloguePageRequest,
  ): Promise<CataloguePage<DiscoverySource>>;
}

export interface CatalogueHealth {
  check(): Promise<void>;
  close(): Promise<void>;
}

export interface CatalogueDiscovery
  extends CatalogueReader, SearchProjectionReader, SearchProjectionWriter {
  registerConfiguration(
    sources: readonly ConfiguredSource[],
    workspaces: readonly ConfiguredWorkspace[],
  ): Promise<void>;
  getSource(sourceId: string): Promise<Source | undefined>;
  listSourcesForDiscovery(
    request: CataloguePageRequest,
  ): Promise<CataloguePage<DiscoverySource>>;
  persistScan(
    sourceId: string,
    repositories: readonly RepositoryCandidate[],
    documents: readonly DocumentCandidate[],
    discoveredAt: string,
    correlationId: string,
    durationMilliseconds: number,
  ): Promise<ScanPersistenceResult>;
  listPendingDiscoveryEvents(limit: number): Promise<readonly DiscoveryEvent[]>;
  markDiscoveryEventPublished(
    eventId: string,
    publishedAt: string,
  ): Promise<void>;
  recordScanStarted(
    sourceId: string,
    correlationId: string,
    startedAt: string,
  ): Promise<void>;
  recordScanFailed(
    sourceId: string,
    correlationId: string,
    failedAt: string,
    durationMilliseconds: number,
    failureType: string,
  ): Promise<void>;
  applyDocumentProcessing(
    event: DocumentProcessingEvent,
  ): Promise<DocumentProcessingApplyResult>;
  applyKnowledgeCandidates(event: KnowledgeCandidateEvent): Promise<void>;
}
