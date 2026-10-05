import { ulid } from 'ulid';

export const processingDefinitionRegistry = [
  {
    filenameMatchKind: 'suffix',
    filenameMatch: '.md',
    processorId: 'markdown',
    extractionRuleId: 'markdown-blocks',
  },
  {
    filenameMatchKind: 'suffix',
    filenameMatch: '.markdown',
    processorId: 'markdown',
    extractionRuleId: 'markdown-blocks',
  },
  {
    filenameMatchKind: 'suffix',
    filenameMatch: '.yaml',
    processorId: 'yaml',
    extractionRuleId: 'yaml-scalar-values',
  },
  {
    filenameMatchKind: 'suffix',
    filenameMatch: '.yml',
    processorId: 'yaml',
    extractionRuleId: 'yaml-scalar-values',
  },
  {
    filenameMatchKind: 'suffix',
    filenameMatch: '.json',
    processorId: 'json',
    extractionRuleId: 'json-scalar-values',
  },
  {
    filenameMatchKind: 'suffix',
    filenameMatch: '.txt',
    processorId: 'plain-text',
    extractionRuleId: 'text-paragraphs',
  },
  {
    filenameMatchKind: 'suffix',
    filenameMatch: '.ts',
    processorId: 'typescript',
    extractionRuleId: 'typescript-imports',
  },
  {
    filenameMatchKind: 'exact',
    filenameMatch: 'dockerfile',
    processorId: 'dockerfile',
    extractionRuleId: 'dockerfile-base-images',
  },
  {
    filenameMatchKind: 'suffix',
    filenameMatch: '.dockerfile',
    processorId: 'dockerfile',
    extractionRuleId: 'dockerfile-base-images',
  },
] as const;

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type SourceId = Brand<string, 'SourceId'>;
export type SourceRootId = Brand<string, 'SourceRootId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type RepositoryId = Brand<string, 'RepositoryId'>;
export type DocumentId = Brand<string, 'DocumentId'>;
export type DocumentVersionId = Brand<string, 'DocumentVersionId'>;
export type EvidenceId = Brand<string, 'EvidenceId'>;
export type KnowledgeModelId = Brand<string, 'KnowledgeModelId'>;
export type KnowledgeEntityId = Brand<string, 'KnowledgeEntityId'>;
export type KnowledgeRelationshipId = Brand<string, 'KnowledgeRelationshipId'>;
export type EntityVersionId = Brand<string, 'EntityVersionId'>;
export type RelationshipVersionId = Brand<string, 'RelationshipVersionId'>;
export type KnowledgePublicationId = Brand<string, 'KnowledgePublicationId'>;

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function parseBrandedId<Name extends string>(
  value: string,
): Brand<string, Name> {
  if (!ulidPattern.test(value)) {
    throw new Error('Catalogue contains an invalid ULID');
  }
  return value as Brand<string, Name>;
}

export const createSourceId = (): SourceId => ulid() as SourceId;
export const createSourceRootId = (): SourceRootId => ulid() as SourceRootId;
export const createWorkspaceId = (): WorkspaceId => ulid() as WorkspaceId;
export const createRepositoryId = (): RepositoryId => ulid() as RepositoryId;
export const createDocumentId = (): DocumentId => ulid() as DocumentId;
export const createDocumentVersionId = (): DocumentVersionId =>
  ulid() as DocumentVersionId;
export const createEvidenceId = (): EvidenceId => ulid() as EvidenceId;
export const createKnowledgeModelId = (): KnowledgeModelId =>
  ulid() as KnowledgeModelId;
export const createKnowledgeEntityId = (): KnowledgeEntityId =>
  ulid() as KnowledgeEntityId;
export const createKnowledgeRelationshipId = (): KnowledgeRelationshipId =>
  ulid() as KnowledgeRelationshipId;
export const createEntityVersionId = (): EntityVersionId =>
  ulid() as EntityVersionId;
export const createRelationshipVersionId = (): RelationshipVersionId =>
  ulid() as RelationshipVersionId;
export const createKnowledgePublicationId = (): KnowledgePublicationId =>
  ulid() as KnowledgePublicationId;

export const parseSourceId = (value: string): SourceId =>
  parseBrandedId<'SourceId'>(value);
export const parseSourceRootId = (value: string): SourceRootId =>
  parseBrandedId<'SourceRootId'>(value);
export const parseWorkspaceId = (value: string): WorkspaceId =>
  parseBrandedId<'WorkspaceId'>(value);
export const parseRepositoryId = (value: string): RepositoryId =>
  parseBrandedId<'RepositoryId'>(value);
export const parseDocumentId = (value: string): DocumentId =>
  parseBrandedId<'DocumentId'>(value);
export const parseDocumentVersionId = (value: string): DocumentVersionId =>
  parseBrandedId<'DocumentVersionId'>(value);
export const parseEvidenceId = (value: string): EvidenceId =>
  parseBrandedId<'EvidenceId'>(value);
export const parseKnowledgeModelId = (value: string): KnowledgeModelId =>
  parseBrandedId<'KnowledgeModelId'>(value);
export const parseKnowledgeEntityId = (value: string): KnowledgeEntityId =>
  parseBrandedId<'KnowledgeEntityId'>(value);
export const parseKnowledgeRelationshipId = (
  value: string,
): KnowledgeRelationshipId => parseBrandedId<'KnowledgeRelationshipId'>(value);
export const parseEntityVersionId = (value: string): EntityVersionId =>
  parseBrandedId<'EntityVersionId'>(value);
export const parseRelationshipVersionId = (
  value: string,
): RelationshipVersionId => parseBrandedId<'RelationshipVersionId'>(value);
export const parseKnowledgePublicationId = (
  value: string,
): KnowledgePublicationId => parseBrandedId<'KnowledgePublicationId'>(value);

export type Source = {
  readonly id: SourceId;
  readonly name: string;
  readonly type: 'filesystem';
  readonly containerPaths: readonly string[];
  readonly roots?: readonly SourceRoot[];
  readonly excludeDirs?: readonly string[];
  readonly includeExtensions?: readonly string[];
  readonly maxFileSizeBytes?: number;
  readonly workspaceRules?: readonly WorkspaceDiscoveryRules[];
  readonly createdAt: string;
};

export const knowledgeRelationshipTypes = [
  'CONTAINS',
  'BELONGS_TO',
  'REFERENCES',
  'DOCUMENTS',
  'DEPENDS_ON',
  'USES',
  'IMPLEMENTS',
  'EXPOSES',
  'CONSUMES',
  'CLASSIFIED_AS',
  'DERIVED_FROM',
] as const;

export type KnowledgeRelationshipType =
  (typeof knowledgeRelationshipTypes)[number];
export type KnowledgeEntityType = 'package' | 'container' | 'api' | 'module';

export function createKnowledgeEntityKey(
  type: KnowledgeEntityType,
  sourceId: SourceId | string,
  identityScope: string,
  name: string,
): string {
  const identityName =
    type === 'module' ? name.trim() : name.trim().toLocaleLowerCase('en-US');
  return `${type}:${sourceId}:${encodeURIComponent(identityScope)}:${encodeURIComponent(identityName)}`;
}

export type EntityLifecycleStatus =
  'observed' | 'verified' | 'established' | 'rejected' | 'superseded';
export type RelationshipLifecycleStatus =
  | 'observed'
  | 'related'
  | 'verified'
  | 'established'
  | 'rejected'
  | 'superseded';

export type KnowledgeProvenance = {
  readonly evidenceId: EvidenceId;
  readonly documentVersionId: DocumentVersionId;
  readonly documentId: DocumentId;
  readonly sourceId: SourceId;
  readonly documentPath: string;
  readonly contentFingerprint: string;
  readonly locator: EvidenceLocator;
  readonly processorId: string;
  readonly processorVersion: number;
  readonly extractionRuleId: string;
  readonly extractionRuleVersion: number;
  readonly knowledgeExtractorId: string;
  readonly knowledgeExtractorVersion: number;
};

export type KnowledgeInputEvidence = {
  readonly evidence: Evidence;
  readonly documentVersion: DocumentVersion;
  readonly document: Pick<
    Document,
    'id' | 'sourceId' | 'path' | 'filename' | 'fingerprint'
  >;
  readonly provenance: Omit<
    EvidenceExplanation['provenance'],
    'sourceId' | 'provider'
  >;
};

export type KnowledgeEntityCandidate = {
  readonly key: string;
  readonly type: KnowledgeEntityType;
  readonly identityScope: string;
  readonly name: string;
  readonly sourceEvidenceIds: readonly EvidenceId[];
  readonly provenance: readonly KnowledgeProvenance[];
  readonly lifecycleStatus: 'observed';
};

export type KnowledgeRelationshipCandidate = {
  readonly key: string;
  readonly type: KnowledgeRelationshipType;
  readonly sourceEntityKey: string;
  readonly targetEntityKey: string;
  readonly sourceEvidenceIds: readonly EvidenceId[];
  readonly provenance: readonly KnowledgeProvenance[];
  readonly confidence: number;
  readonly lifecycleStatus: 'related';
};

export type KnowledgeEntity = {
  readonly id: KnowledgeEntityId;
  readonly knowledgeModelId: KnowledgeModelId;
  readonly type: KnowledgeEntityType;
  readonly name: string;
  readonly sourceEvidenceIds: readonly EvidenceId[];
  readonly provenance: readonly KnowledgeProvenance[];
  readonly lifecycleStatus: EntityLifecycleStatus;
  readonly currentVersionId: EntityVersionId;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type KnowledgeRelationship = {
  readonly id: KnowledgeRelationshipId;
  readonly knowledgeModelId: KnowledgeModelId;
  readonly type: KnowledgeRelationshipType;
  readonly sourceEntityId: KnowledgeEntityId;
  readonly targetEntityId: KnowledgeEntityId;
  readonly sourceEvidenceIds: readonly EvidenceId[];
  readonly provenance: readonly KnowledgeProvenance[];
  readonly confidence: number;
  readonly lifecycleStatus: RelationshipLifecycleStatus;
  readonly currentVersionId: RelationshipVersionId;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type EntityVersion = {
  readonly id: EntityVersionId;
  readonly entityId: KnowledgeEntityId;
  readonly version: number;
  readonly snapshot: KnowledgeEntity;
  readonly createdAt: string;
};

export type RelationshipVersion = {
  readonly id: RelationshipVersionId;
  readonly relationshipId: KnowledgeRelationshipId;
  readonly version: number;
  readonly snapshot: KnowledgeRelationship;
  readonly createdAt: string;
};

export type KnowledgeModel = {
  readonly id: KnowledgeModelId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly schemaVersion: 1;
  readonly latestPublicationVersion: number | null;
  readonly createdAt: string;
};

export type KnowledgePublication = {
  readonly id: KnowledgePublicationId;
  readonly knowledgeModelId: KnowledgeModelId;
  readonly version: number;
  readonly schemaVersion: 1;
  readonly status: 'published';
  readonly contentHash: string;
  readonly entityVersionIds: readonly EntityVersionId[];
  readonly relationshipVersionIds: readonly RelationshipVersionId[];
  readonly publishedAt: string;
};

export type KnowledgePublicationSummary = {
  readonly publication: KnowledgePublication;
  readonly entityCount: number;
  readonly relationshipCount: number;
};

export type PublishedEntity = {
  readonly publicationId: KnowledgePublicationId;
  readonly entityVersionId: EntityVersionId;
  readonly versionNumber: number;
  readonly entity: KnowledgeEntity;
};

export type PublishedRelationship = {
  readonly publicationId: KnowledgePublicationId;
  readonly relationshipVersionId: RelationshipVersionId;
  readonly versionNumber: number;
  readonly relationship: KnowledgeRelationship;
};

export type KnowledgeSupportRecord = {
  readonly provenance: KnowledgeProvenance;
  readonly evidenceExplanation: EvidenceExplanation;
};

export type KnowledgeObjectProvenance = {
  readonly publicationId: KnowledgePublicationId;
  readonly knowledgeObjectType: 'entity' | 'relationship';
  readonly knowledgeObjectId: KnowledgeEntityId | KnowledgeRelationshipId;
  readonly knowledgeVersionId: EntityVersionId | RelationshipVersionId;
  readonly knowledgeVersionNumber: number;
  readonly items: readonly KnowledgeSupportRecord[];
};

export type StoredKnowledgeProvenance = Omit<
  KnowledgeObjectProvenance,
  'items'
> & {
  readonly provenance: readonly KnowledgeProvenance[];
};

export type PublishedRelationshipTraversal = {
  readonly publicationId: KnowledgePublicationId;
  readonly relationshipVersionId: RelationshipVersionId;
  readonly versionNumber: number;
  readonly direction: 'incoming' | 'outgoing';
  readonly relationship: KnowledgeRelationship;
};

export const searchProjectionSchemaVersion = 1 as const;
export const searchMatchModes = ['contains', 'prefix', 'exact'] as const;
export type SearchMatchMode = (typeof searchMatchModes)[number];

export type ProjectedEntity = {
  readonly entityId: KnowledgeEntityId;
  readonly modelId: KnowledgeModelId;
  readonly publicationId: KnowledgePublicationId;
  readonly type: KnowledgeEntityType;
  readonly name: string;
  readonly lifecycleStatus: EntityLifecycleStatus;
  readonly sourceEvidenceIds: readonly EvidenceId[];
  readonly relationshipCount: number;
  readonly publishedAt: string;
};

export type ProjectedRelationship = {
  readonly relationshipId: KnowledgeRelationshipId;
  readonly modelId: KnowledgeModelId;
  readonly publicationId: KnowledgePublicationId;
  readonly type: KnowledgeRelationshipType;
  readonly sourceEntityId: KnowledgeEntityId;
  readonly targetEntityId: KnowledgeEntityId;
  readonly lifecycleStatus: RelationshipLifecycleStatus;
  readonly sourceEvidenceIds: readonly EvidenceId[];
  readonly publishedAt: string;
};

export type ProjectedSearchDocument = {
  readonly documentId: string;
  readonly publicationId: KnowledgePublicationId;
  readonly searchableText: string;
  readonly searchableTerms: readonly string[];
  readonly publishedAt: string;
};

export type SearchProjection = {
  readonly publicationId: KnowledgePublicationId;
  readonly modelId: KnowledgeModelId;
  readonly publicationVersion: number;
  readonly publicationContentHash: string;
  readonly schemaVersion: typeof searchProjectionSchemaVersion;
  readonly contentHash: string;
  readonly entities: readonly ProjectedEntity[];
  readonly relationships: readonly ProjectedRelationship[];
  readonly documents: readonly ProjectedSearchDocument[];
};

export type ProjectionStatistics = {
  readonly publication: KnowledgePublication;
  readonly projectionStatus: 'built' | 'pending';
  readonly projectionSchemaVersion: typeof searchProjectionSchemaVersion | null;
  readonly projectionContentHash: string | null;
  readonly projectedEntityCount: number;
  readonly projectedRelationshipCount: number;
  readonly projectedSearchDocumentCount: number;
  readonly builtAt: string | null;
};

export type SearchProjectionSummary = {
  readonly publicationId: KnowledgePublicationId;
  readonly modelId: KnowledgeModelId;
  readonly publicationVersion: number;
  readonly publicationContentHash: string;
  readonly projectionSchemaVersion: typeof searchProjectionSchemaVersion;
  readonly projectionContentHash: string;
  readonly projectedEntityCount: number;
  readonly projectedRelationshipCount: number;
  readonly projectedSearchDocumentCount: number;
  readonly builtAt: string;
};

export type KnowledgeCandidateEvent = Extract<
  DiscoveryEvent,
  { readonly eventType: 'KnowledgeCandidatesSubmitted' }
>;
export type KnowledgeDocumentRemovalEvent = Extract<
  DiscoveryEvent,
  { readonly eventType: 'DocumentRemoved' }
>;

export type SourceRoot = {
  readonly id: SourceRootId;
  readonly sourceId: SourceId;
  readonly absolutePath: string;
};

export type DiscoverySource = {
  readonly sourceId: SourceId;
  readonly roots: readonly SourceRoot[];
  readonly workspaceRules: readonly WorkspaceDiscoveryRules[];
  readonly excludedDirectoryNames: readonly string[];
  readonly includeExtensions: readonly string[];
  readonly maxFileSizeBytes: number;
};

export type RepositoryCandidate = {
  readonly path: string;
  readonly repositoryType: 'git' | 'unknown';
  readonly fingerprint: string;
  readonly discoveryMethod: 'filesystem';
};

export type DocumentCandidate = {
  readonly path: string;
  readonly filename: string;
  readonly extension: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly fingerprint: string;
  readonly discoveryMethod: 'filesystem';
};

export type ScanResult = {
  readonly sourceId: SourceId;
  readonly discoveredAt: string;
  readonly repositories: readonly RepositoryCandidate[];
  readonly documents: readonly DocumentCandidate[];
};

export type DiscoveryEventName =
  | 'SourceScanRequested'
  | 'SourceScanStarted'
  | 'SourceInventorySubmitted'
  | 'SourceScanFailed'
  | 'SourceScanCompleted'
  | 'RepositoryDiscovered'
  | 'RepositoryModified'
  | 'RepositoryRemoved'
  | 'DocumentDiscovered'
  | 'DocumentModified'
  | 'DocumentRemoved'
  | 'DocumentProcessingSubmitted'
  | 'DocumentExtracted'
  | 'KnowledgeCandidatesSubmitted'
  | 'KnowledgeEntityDiscovered'
  | 'KnowledgeEntitySuperseded'
  | 'KnowledgeRelationshipDiscovered'
  | 'KnowledgeRelationshipSuperseded'
  | 'KnowledgeModelPublished'
  | 'SearchProjectionRequested'
  | 'SearchProjectionBuilt';

export function discoveryEventSubject(eventType: DiscoveryEventName): string {
  switch (eventType) {
    case 'SearchProjectionRequested':
      return 'workspace.search.projection.requested';
    case 'SearchProjectionBuilt':
      return 'workspace.search.projection.built';
    case 'DocumentProcessingSubmitted':
      return 'workspace.processing.document.submitted';
    case 'DocumentExtracted':
      return 'workspace.processing.document.extracted';
    case 'KnowledgeCandidatesSubmitted':
    case 'KnowledgeEntityDiscovered':
    case 'KnowledgeEntitySuperseded':
    case 'KnowledgeRelationshipDiscovered':
    case 'KnowledgeRelationshipSuperseded':
    case 'KnowledgeModelPublished':
      return `workspace.knowledge.${eventType
        .replace(/^Knowledge/, '')
        .replace(/[A-Z]/g, (letter) => `.${letter.toLowerCase()}`)
        .replace(/^\./, '')}`;
    default:
      return `workspace.discovery.${eventType
        .replace(/[A-Z]/g, (letter) => `.${letter.toLowerCase()}`)
        .replace(/^\./, '')}`;
  }
}

export type EvidenceLocator =
  | {
      readonly kind: 'markdown-lines' | 'text-lines' | 'yaml-lines';
      readonly lineStart: number;
      readonly lineEnd: number;
      readonly headingPath?: readonly string[];
    }
  | {
      readonly kind: 'json-pointer';
      readonly pointer: string;
    };

export type EvidenceCandidate = {
  readonly key: string;
  readonly kind:
    | 'heading'
    | 'paragraph'
    | 'list-item'
    | 'table-row'
    | 'code-block'
    | 'structured-value';
  readonly excerpt: string;
  readonly truncated: boolean;
  readonly locator: EvidenceLocator;
};

export type DocumentProcessingCandidate = {
  readonly documentId: DocumentId;
  readonly sourceId: SourceId;
  readonly path: string;
  readonly contentFingerprint: string;
  readonly processedAt: string;
  readonly durationMilliseconds: number;
  readonly processorId: string;
  readonly processorVersion: number;
  readonly extractionRuleId: string;
  readonly extractionRuleVersion: number;
  readonly evidence: readonly EvidenceCandidate[];
};

export type DocumentVersion = {
  readonly id: DocumentVersionId;
  readonly documentId: DocumentId;
  readonly contentHash: string;
  readonly hashAlgorithm: 'sha256';
  readonly discoveredAt: string;
  readonly processorId: string;
  readonly processorVersion: number;
  readonly extractionRuleId: string;
  readonly extractionRuleVersion: number;
  readonly evidenceCount: number;
};

export type Evidence = {
  readonly id: EvidenceId;
  readonly documentVersionId: DocumentVersionId;
  readonly key: string;
  readonly kind: EvidenceCandidate['kind'];
  readonly excerpt: string;
  readonly truncated: boolean;
  readonly locator: EvidenceLocator;
};

export type EvidenceExplanation = {
  readonly evidence: Evidence;
  readonly documentVersion: DocumentVersion;
  readonly document: Pick<
    Document,
    'id' | 'sourceId' | 'path' | 'filename' | 'fingerprint'
  >;
  readonly provenance: {
    readonly sourceId: SourceId;
    readonly provider: 'filesystem';
    readonly documentPath: string;
    readonly contentFingerprint: string;
    readonly processorId: string;
    readonly processorVersion: number;
    readonly extractionRuleId: string;
    readonly extractionRuleVersion: number;
  };
};

export type DiscoveryEventPayloads = {
  SourceScanRequested: { readonly sourceId: SourceId };
  SourceScanStarted: {
    readonly sourceId: SourceId;
    readonly startedAt: string;
  };
  SourceInventorySubmitted: {
    readonly scan: ScanResult;
    readonly durationMilliseconds: number;
  };
  SourceScanFailed: {
    readonly sourceId: SourceId;
    readonly failedAt: string;
    readonly durationMilliseconds: number;
    readonly failureType: string;
  };
  SourceScanCompleted: {
    readonly sourceId: SourceId;
    readonly discoveredAt: string;
    readonly repositoryCount: number;
    readonly documentCount: number;
    readonly addedCount: number;
    readonly modifiedCount: number;
    readonly removedCount: number;
    readonly unchangedCount: number;
    readonly durationMilliseconds: number;
  };
  RepositoryDiscovered: { readonly repository: Repository };
  RepositoryModified: { readonly repository: Repository };
  RepositoryRemoved: { readonly inventoryRecord: InventoryRecord };
  DocumentDiscovered: { readonly document: Document };
  DocumentModified: { readonly document: Document };
  DocumentRemoved: { readonly inventoryRecord: InventoryRecord };
  DocumentProcessingSubmitted: {
    readonly candidate: DocumentProcessingCandidate;
  };
  DocumentExtracted: {
    readonly documentId: DocumentId;
    readonly documentVersionId: DocumentVersionId;
    readonly contentFingerprint: string;
    readonly evidenceCount: number;
  };
  KnowledgeCandidatesSubmitted: {
    readonly sourceId: SourceId;
    readonly documentId: DocumentId;
    readonly documentVersionId: DocumentVersionId;
    readonly entities: readonly KnowledgeEntityCandidate[];
    readonly relationships: readonly KnowledgeRelationshipCandidate[];
  };
  KnowledgeEntityDiscovered: { readonly entity: KnowledgeEntity };
  KnowledgeEntitySuperseded: { readonly entity: KnowledgeEntity };
  KnowledgeRelationshipDiscovered: {
    readonly relationship: KnowledgeRelationship;
  };
  KnowledgeRelationshipSuperseded: {
    readonly relationship: KnowledgeRelationship;
  };
  KnowledgeModelPublished: { readonly publication: KnowledgePublication };
  SearchProjectionRequested: {
    readonly publicationId: KnowledgePublicationId;
    readonly knowledgeModelId: KnowledgeModelId;
    readonly publicationVersion: number;
    readonly publicationContentHash: string;
  };
  SearchProjectionBuilt: { readonly projection: SearchProjectionSummary };
};

export type DiscoveryEvent = {
  [Name in DiscoveryEventName]: {
    readonly eventId: string;
    readonly eventType: Name;
    readonly eventVersion: 1;
    readonly occurredAt: string;
    readonly producer:
      | 'workspace-brain-api'
      | 'workspace-brain-ingestion-worker'
      | 'workspace-brain-knowledge-worker';
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly partitionKey: string;
    readonly payload: DiscoveryEventPayloads[Name];
  };
}[DiscoveryEventName];

export type WorkspaceDiscoveryRules = {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
};

export type Workspace = {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly description?: string;
  readonly sourceIds: readonly SourceId[];
  readonly createdAt: string;
};

export type Repository = {
  readonly id: RepositoryId;
  readonly sourceId: SourceId;
  readonly path: string;
  readonly repositoryType: 'git' | 'unknown';
  readonly fingerprint: string;
  readonly discoveredAt: string;
  readonly lastSeenAt: string;
  readonly discoveryMethod: 'filesystem';
};

export type Document = {
  readonly id: DocumentId;
  readonly sourceId: SourceId;
  readonly path: string;
  readonly filename: string;
  readonly extension: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly fingerprint: string;
  readonly discoveredAt: string;
  readonly lastSeenAt: string;
  readonly discoveryMethod: 'filesystem';
};

export type InventoryRecord = {
  readonly id: string;
  readonly sourceId: SourceId;
  readonly path: string;
  readonly type: 'repository' | 'document';
  readonly fingerprint: string;
  readonly discoveredAt: string;
  readonly lastSeenAt: string;
};

export type InventoryChange<T extends Repository | Document | InventoryRecord> =
  {
    readonly change: 'added' | 'modified' | 'removed' | 'unchanged';
    readonly record: T;
  };
