import { ulid } from 'ulid';

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type SourceId = Brand<string, 'SourceId'>;
export type SourceRootId = Brand<string, 'SourceRootId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type RepositoryId = Brand<string, 'RepositoryId'>;
export type DocumentId = Brand<string, 'DocumentId'>;
export type DocumentVersionId = Brand<string, 'DocumentVersionId'>;

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
  | 'DocumentRemoved';

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
};

export type DiscoveryEvent = {
  [Name in DiscoveryEventName]: {
    readonly eventId: string;
    readonly eventType: Name;
    readonly eventVersion: 1;
    readonly occurredAt: string;
    readonly producer:
      'workspace-brain-api' | 'workspace-brain-ingestion-worker';
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

export type DocumentVersion = {
  readonly id: DocumentVersionId;
  readonly documentId: DocumentId;
  readonly contentHash: string;
  readonly hashAlgorithm: 'sha256';
  readonly discoveredAt: string;
};
