import type {
  Document,
  DiscoveryEvent,
  DiscoverySource,
  DocumentCandidate,
  InventoryChange,
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

export type { InventoryChange } from '@workspace-brain/domain';

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

export interface CatalogueDiscovery extends CatalogueReader {
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
}
