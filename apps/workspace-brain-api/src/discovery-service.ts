import type { CatalogueDiscovery } from '@workspace-brain/catalogue';
import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import type { ExpiredInventoryAssembly } from '@workspace-brain/catalogue';
import type { WorkspaceBrainConfig } from '@workspace-brain/configuration';
import type {
  DiscoveryEvent,
  DocumentCandidate,
  RepositoryCandidate,
} from '@workspace-brain/domain';
import {
  completeInventoryChecksum,
  inventoryChunkChecksum,
} from '@workspace-brain/domain';
import { NonRetryableEventError } from '@workspace-brain/nats';
import { z } from 'zod';

import type { InternalEventPublisher } from './events.js';

export type DiscoveryService = {
  handle(event: DiscoveryEvent): Promise<void>;
};

type DiscoveryLogger = {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
};

type DiscoveryCatalogue = Pick<
  CatalogueDiscovery,
  | 'getSource'
  | 'persistScan'
  | 'stageInventoryStarted'
  | 'stageInventoryChunk'
  | 'stageInventoryCompleted'
  | 'getInventoryAssembly'
  | 'listPendingDiscoveryEvents'
  | 'markDiscoveryEventPublished'
  | 'recordScanStarted'
  | 'recordScanFailed'
  | 'applyDocumentProcessing'
  | 'applyKnowledgeCandidates'
  | 'requestSearchProjection'
  | 'buildSearchProjection'
>;

export function createDiscoveryService(
  catalogue: DiscoveryCatalogue,
  events: InternalEventPublisher,
  logger: DiscoveryLogger,
  maxPayloadBytes = Number.POSITIVE_INFINITY,
): DiscoveryService {
  return {
    async handle(event) {
      if (event.eventType === 'SourceScanRequested') {
        return;
      }

      if (event.eventType === 'SourceScanCompleted') {
        return;
      }

      if (event.eventType === 'SourceScanStarted') {
        await catalogue.recordScanStarted(
          event.payload.sourceId,
          event.correlationId,
          event.payload.startedAt,
        );
        return;
      }

      if (event.eventType === 'SourceScanFailed') {
        await catalogue.recordScanFailed(
          event.payload.sourceId,
          event.correlationId,
          event.payload.failedAt,
          event.payload.durationMilliseconds,
          event.payload.failureType,
        );
        logger.error(
          {
            sourceId: event.payload.sourceId,
            correlationId: event.correlationId,
            failureType: event.payload.failureType,
            durationMilliseconds: event.payload.durationMilliseconds,
          },
          'source scan failed',
        );
        return;
      }

      if (
        event.eventType === 'SourceInventoryStarted' ||
        event.eventType === 'SourceInventoryChunk' ||
        event.eventType === 'SourceInventoryCompleted'
      ) {
        await handleInventoryTransferEvent(event, catalogue, events, logger);
        return;
      }

      if (event.eventType === 'DocumentProcessingSubmitted') {
        const { candidate } = event.payload;
        if (
          event.producer !== 'workspace-brain-knowledge-worker' ||
          event.partitionKey !== candidate.sourceId
        ) {
          throw new Error(
            'Document processing source does not match event ownership',
          );
        }
        await catalogue.applyDocumentProcessing(event);
        await publishPendingEvents(catalogue, events);
        return;
      }

      if (event.eventType === 'KnowledgeCandidatesSubmitted') {
        if (
          event.producer !== 'workspace-brain-knowledge-worker' ||
          event.partitionKey !== event.payload.sourceId
        ) {
          throw new Error(
            'Knowledge candidate source does not match event ownership',
          );
        }
        await catalogue.applyKnowledgeCandidates(event);
        await publishPendingEvents(catalogue, events);
        return;
      }

      // Search projection is a derived read model: publications drive the
      // projection, never the reverse (ADR-010, Slice 4).
      if (event.eventType === 'KnowledgeModelPublished') {
        requireApiProducedEvent(event);
        await catalogue.requestSearchProjection(event);
        await publishPendingEvents(catalogue, events);
        logger.info(
          {
            knowledgeModelId: event.payload.publication.knowledgeModelId,
            publicationId: event.payload.publication.id,
            publicationVersion: event.payload.publication.version,
            entityCount: event.payload.publication.entityVersionIds.length,
            relationshipCount:
              event.payload.publication.relationshipVersionIds.length,
            correlationId: event.correlationId,
          },
          'knowledge model published; search projection requested',
        );
        return;
      }

      if (event.eventType === 'SearchProjectionRequested') {
        requireApiProducedEvent(event);
        const projection = await catalogue.buildSearchProjection(event);
        await publishPendingEvents(catalogue, events);
        logger.info(
          {
            publicationId: projection.publicationId,
            projectedEntityCount: projection.projectedEntityCount,
            projectedRelationshipCount: projection.projectedRelationshipCount,
            correlationId: event.correlationId,
          },
          'search projection built',
        );
        return;
      }

      if (event.eventType !== 'SourceInventorySubmitted') {
        throw new Error(`Unexpected discovery event: ${event.eventType}`);
      }

      const { scan } = event.payload;
      if (scan.sourceId !== event.partitionKey) {
        throw new Error('Inventory source does not match event partition');
      }
      const source = await catalogue.getSource(scan.sourceId);
      if (source === undefined) {
        throw new Error(`Source ${scan.sourceId} is not registered`);
      }
      const rootIds = new Set<string>((source.roots ?? []).map(({ id }) => id));
      for (const candidate of scan.repositories) {
        if (!isSafeInventoryPath(candidate.path, rootIds, true)) {
          throw new Error('Inventory path is outside registered source roots');
        }
      }
      for (const candidate of scan.documents) {
        if (
          !isSafeInventoryPath(candidate.path, rootIds, false) ||
          candidate.filename !== candidate.path.split('/').at(-1)
        ) {
          throw new Error('Inventory path is outside registered source roots');
        }
      }
      const serializedBytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
      if (serializedBytes > maxPayloadBytes) {
        logger.error(
          {
            sourceId: scan.sourceId,
            scanId: event.correlationId,
            eventBytes: serializedBytes,
            maxPayloadBytes,
          },
          'legacy source inventory event rejected as oversized',
        );
        throw new NonRetryableEventError(
          'Legacy source inventory event exceeds the negotiated NATS payload limit',
        );
      }
      const inventoryChecksum = completeInventoryChecksum(
        scan.sourceId,
        scan.discoveredAt,
        scan.repositories,
        scan.documents,
      );
      const result = await catalogue.persistScan(
        scan.sourceId,
        scan.repositories,
        scan.documents,
        scan.discoveredAt,
        event.correlationId,
        event.payload.durationMilliseconds,
        {
          scanId: event.correlationId,
          inventoryChecksum,
          legacy: true,
        },
      );
      await publishPendingEvents(catalogue, events);
      logger.info(
        {
          sourceId: scan.sourceId,
          scanId: event.correlationId,
          eventBytes: serializedBytes,
          repositoryCount: scan.repositories.length,
          documentCount: scan.documents.length,
          status: result.inventoryCommitStatus ?? 'committed',
        },
        'legacy source inventory event accepted',
      );
      const addedDocuments = result.documentChanges.filter(
        ({ change }) => change === 'added',
      ).length;
      const modifiedDocuments = result.documentChanges.filter(
        ({ change }) => change === 'modified',
      ).length;
      const removedDocuments = result.documentChanges.filter(
        ({ change }) => change === 'removed',
      ).length;
      logger.info(
        {
          sourceId: scan.sourceId,
          correlationId: event.correlationId,
          repositoryCount: result.repositories.length,
          documentCount: result.documents.length,
          addedDocuments,
          modifiedDocuments,
          removedDocuments,
          unchangedDocuments:
            result.documentChanges.length -
            addedDocuments -
            modifiedDocuments -
            removedDocuments,
          durationMilliseconds: event.payload.durationMilliseconds,
        },
        addedDocuments + modifiedDocuments + removedDocuments > 0
          ? 'source scan completed; document changes detected'
          : 'source scan completed; no document changes',
      );
    },
  };
}

const sourceIdSchema = z.string().min(1);
const repositoryCandidateSchema = z
  .object({
    path: z.string().min(1).max(4096),
    repositoryType: z.enum(['git', 'unknown']),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    discoveryMethod: z.literal('filesystem'),
  })
  .strict();
const documentCandidateSchema = z
  .object({
    path: z.string().min(1).max(4096),
    filename: z.string().min(1).max(255),
    extension: z.string().max(64),
    sizeBytes: z.number().int().nonnegative().safe(),
    modifiedAt: z.iso.datetime({ offset: true }),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    discoveryMethod: z.literal('filesystem'),
  })
  .strict();
const inventoryStartedSchema = z
  .object({
    schemaVersion: z.number().int(),
    scanId: z.string().min(1).max(256),
    sourceId: sourceIdSchema,
    startedAt: z.iso.datetime({ offset: true }),
    discoveredAt: z.iso.datetime({ offset: true }),
    expectedRepositoryCount: z.number().int().nonnegative().safe(),
    expectedDocumentCount: z.number().int().nonnegative().safe(),
  })
  .strict();
const inventoryChunkSchema = z
  .object({
    schemaVersion: z.number().int(),
    scanId: z.string().min(1).max(256),
    sourceId: sourceIdSchema,
    chunkIndex: z.number().int().nonnegative().safe(),
    repositoryCount: z.number().int().nonnegative().safe(),
    documentCount: z.number().int().nonnegative().safe(),
    repositories: z.array(repositoryCandidateSchema),
    documents: z.array(documentCandidateSchema),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const inventoryCompletedSchema = z
  .object({
    schemaVersion: z.number().int(),
    scanId: z.string().min(1).max(256),
    sourceId: sourceIdSchema,
    expectedChunkCount: z.number().int().nonnegative().safe(),
    repositoryCount: z.number().int().nonnegative().safe(),
    documentCount: z.number().int().nonnegative().safe(),
    inventoryChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    completedAt: z.iso.datetime({ offset: true }),
    durationMilliseconds: z.number().finite().nonnegative(),
  })
  .strict();

async function handleInventoryTransferEvent(
  event: Extract<
    DiscoveryEvent,
    {
      readonly eventType:
        | 'SourceInventoryStarted'
        | 'SourceInventoryChunk'
        | 'SourceInventoryCompleted';
    }
  >,
  catalogue: DiscoveryCatalogue,
  events: InternalEventPublisher,
  logger: DiscoveryLogger,
): Promise<void> {
  if (
    event.eventVersion !== 1 ||
    event.producer !== 'workspace-brain-ingestion-worker'
  ) {
    throw new NonRetryableEventError(
      'Inventory transfer event has an unsupported envelope',
    );
  }
  const payloadSchema =
    event.eventType === 'SourceInventoryStarted'
      ? inventoryStartedSchema
      : event.eventType === 'SourceInventoryChunk'
        ? inventoryChunkSchema
        : inventoryCompletedSchema;
  const parsedPayload = payloadSchema.safeParse(event.payload);
  if (!parsedPayload.success) {
    throw new NonRetryableEventError(
      `Invalid ${event.eventType} payload: ${parsedPayload.error.message}`,
    );
  }
  if (parsedPayload.data.schemaVersion !== 1) {
    throw new NonRetryableEventError(
      `Unsupported ${event.eventType} schema version ${parsedPayload.data.schemaVersion}`,
    );
  }
  const { sourceId, scanId } = parsedPayload.data;
  if (sourceId !== event.partitionKey || scanId !== event.correlationId) {
    throw new NonRetryableEventError(
      'Inventory transfer source or scan does not match its event envelope',
    );
  }

  let duplicate: boolean;
  try {
    if (event.eventType === 'SourceInventoryStarted') {
      const payload = event.payload;
      duplicate =
        (await catalogue.stageInventoryStarted(payload)) === 'duplicate';
      logger.info(
        {
          sourceId,
          scanId,
          duplicate,
          expectedRepositoryCount: payload.expectedRepositoryCount,
          expectedDocumentCount: payload.expectedDocumentCount,
        },
        duplicate
          ? 'source inventory start accepted idempotently'
          : 'source inventory started',
      );
    } else if (event.eventType === 'SourceInventoryChunk') {
      const payload = event.payload;
      if (
        payload.repositoryCount !== payload.repositories.length ||
        payload.documentCount !== payload.documents.length ||
        inventoryChunkChecksum(payload.repositories, payload.documents) !==
          payload.checksum
      ) {
        throw new NonRetryableEventError(
          `Inventory chunk ${payload.chunkIndex} failed count or checksum validation`,
        );
      }
      await validateInventoryCandidates(
        catalogue,
        payload.sourceId,
        payload.repositories,
        payload.documents,
      );
      duplicate =
        (await catalogue.stageInventoryChunk(payload)) === 'duplicate';
      logger.info(
        {
          sourceId,
          scanId,
          chunkIndex: payload.chunkIndex,
          repositoryCount: payload.repositoryCount,
          documentCount: payload.documentCount,
          checksum: payload.checksum,
          duplicate,
        },
        duplicate
          ? 'source inventory duplicate chunk accepted idempotently'
          : 'source inventory chunk received',
      );
    } else {
      const payload = event.payload;
      duplicate =
        (await catalogue.stageInventoryCompleted(payload)) === 'duplicate';
      logger.info(
        {
          sourceId,
          scanId,
          expectedChunkCount: payload.expectedChunkCount,
          repositoryCount: payload.repositoryCount,
          documentCount: payload.documentCount,
          duplicate,
        },
        'source inventory completion received',
      );
    }
  } catch (error) {
    if (error instanceof CatalogueIntegrityError) {
      logger.error(
        { sourceId, scanId, err: error },
        'conflicting source inventory event rejected',
      );
      throw new NonRetryableEventError(error.message);
    }
    throw error;
  }

  try {
    await tryCommitInventoryAssembly(
      catalogue,
      events,
      logger,
      sourceId,
      scanId,
    );
  } catch (error) {
    if (error instanceof CatalogueIntegrityError) {
      logger.error(
        { sourceId, scanId, err: error },
        'source inventory commit rejected by catalogue integrity rules',
      );
      throw new NonRetryableEventError(error.message);
    }
    throw error;
  }
}

async function tryCommitInventoryAssembly(
  catalogue: DiscoveryCatalogue,
  events: InternalEventPublisher,
  logger: DiscoveryLogger,
  sourceId: string,
  scanId: string,
): Promise<void> {
  const assembly = await catalogue.getInventoryAssembly(sourceId, scanId);
  if (assembly === undefined) {
    return;
  }
  if (assembly.status !== 'assembling') {
    logger.info(
      { sourceId, scanId, status: assembly.status },
      assembly.status === 'superseded'
        ? 'source inventory scan superseded'
        : assembly.status === 'expired'
          ? 'late event rejected for expired source inventory scan'
          : 'source inventory scan already committed',
    );
    return;
  }
  if (
    assembly.startedAt === undefined ||
    assembly.discoveredAt === undefined ||
    assembly.expectedRepositoryCount === undefined ||
    assembly.expectedDocumentCount === undefined ||
    assembly.expectedChunkCount === undefined ||
    assembly.repositoryCount === undefined ||
    assembly.documentCount === undefined ||
    assembly.inventoryChecksum === undefined ||
    assembly.completedAt === undefined ||
    assembly.durationMilliseconds === undefined
  ) {
    return;
  }
  const expectedChunkCount = assembly.expectedChunkCount;
  const chunksByIndex = new Map(
    assembly.chunks.map((chunk) => [chunk.chunkIndex, chunk]),
  );
  const missingChunkIndexes = Array.from(
    { length: expectedChunkCount },
    (_, index) => index,
  ).filter((index) => !chunksByIndex.has(index));
  const unexpectedChunkIndexes = assembly.chunks
    .map(({ chunkIndex }) => chunkIndex)
    .filter((index) => index >= expectedChunkCount);
  if (unexpectedChunkIndexes.length > 0) {
    throw new NonRetryableEventError(
      `Inventory scan ${scanId} contains unexpected chunk indexes`,
    );
  }
  if (missingChunkIndexes.length > 0) {
    logger.info(
      {
        sourceId,
        scanId,
        chunksReceived: assembly.chunks.length,
        expectedChunks: expectedChunkCount,
        missingChunkCount: missingChunkIndexes.length,
      },
      'source inventory scan awaiting missing chunks',
    );
    return;
  }

  const repositories: RepositoryCandidate[] = [];
  const documents: DocumentCandidate[] = [];
  for (let index = 0; index < expectedChunkCount; index += 1) {
    const chunk = chunksByIndex.get(index);
    if (chunk === undefined) {
      throw new Error(`Validated inventory chunk ${index} disappeared`);
    }
    if (
      chunk.repositoryCount !== chunk.repositories.length ||
      chunk.documentCount !== chunk.documents.length ||
      inventoryChunkChecksum(chunk.repositories, chunk.documents) !==
        chunk.checksum
    ) {
      throw new NonRetryableEventError(
        `Staged inventory chunk ${index} failed integrity validation`,
      );
    }
    repositories.push(...chunk.repositories);
    documents.push(...chunk.documents);
  }

  repositories.sort(comparePath);
  documents.sort(comparePath);
  if (
    repositories.length !== assembly.expectedRepositoryCount ||
    documents.length !== assembly.expectedDocumentCount ||
    repositories.length !== assembly.repositoryCount ||
    documents.length !== assembly.documentCount
  ) {
    throw new NonRetryableEventError(
      `Inventory scan ${scanId} count validation failed`,
    );
  }
  const checksum = completeInventoryChecksum(
    sourceId,
    assembly.discoveredAt,
    repositories,
    documents,
  );
  if (checksum !== assembly.inventoryChecksum) {
    logger.error(
      { sourceId, scanId },
      'source inventory complete checksum validation failed',
    );
    throw new NonRetryableEventError(
      `Inventory scan ${scanId} complete checksum validation failed`,
    );
  }
  await validateInventoryCandidates(
    catalogue,
    sourceId,
    repositories,
    documents,
  );
  logger.info(
    {
      sourceId,
      scanId,
      chunkCount: assembly.chunks.length,
      repositoryCount: repositories.length,
      documentCount: documents.length,
      inventoryChecksum: checksum,
    },
    'source inventory integrity validation passed',
  );
  const result = await catalogue.persistScan(
    sourceId,
    repositories,
    documents,
    assembly.discoveredAt,
    scanId,
    assembly.durationMilliseconds,
    { scanId, inventoryChecksum: checksum },
  );
  await publishPendingEvents(catalogue, events);
  if (result.inventoryCommitStatus === 'superseded') {
    logger.info(
      { sourceId, scanId, discoveredAt: assembly.discoveredAt },
      'source inventory scan superseded',
    );
    return;
  }
  logger.info(
    {
      sourceId,
      scanId,
      repositoryCount: repositories.length,
      documentCount: documents.length,
      removedDocumentCount: result.documentChanges.filter(
        ({ change }) => change === 'removed',
      ).length,
      status: result.inventoryCommitStatus ?? 'committed',
    },
    'source inventory scan committed',
  );
}

async function validateInventoryCandidates(
  catalogue: Pick<CatalogueDiscovery, 'getSource'>,
  sourceId: string,
  repositories: readonly RepositoryCandidate[],
  documents: readonly DocumentCandidate[],
): Promise<void> {
  const source = await catalogue.getSource(sourceId);
  if (source === undefined) {
    throw new NonRetryableEventError(`Source ${sourceId} is not registered`);
  }
  const rootIds = new Set<string>((source.roots ?? []).map(({ id }) => id));
  for (const candidate of repositories) {
    if (!isSafeInventoryPath(candidate.path, rootIds, true)) {
      throw new NonRetryableEventError(
        'Inventory repository path is outside registered source roots',
      );
    }
  }
  for (const candidate of documents) {
    if (
      !isSafeInventoryPath(candidate.path, rootIds, false) ||
      candidate.filename !== candidate.path.split('/').at(-1)
    ) {
      throw new NonRetryableEventError(
        'Inventory document path is outside registered source roots',
      );
    }
  }
}

export async function expireIncompleteInventoryAssemblies(
  catalogue: Pick<CatalogueDiscovery, 'expireInventoryAssemblies'>,
  logger: DiscoveryLogger,
  ttlMilliseconds: number,
  now = Date.now(),
): Promise<readonly ExpiredInventoryAssembly[]> {
  const expired = await catalogue.expireInventoryAssemblies(
    new Date(now - ttlMilliseconds).toISOString(),
  );
  for (const assembly of expired) {
    logger.info(
      {
        sourceId: assembly.sourceId,
        scanId: assembly.scanId,
        chunksReceived: assembly.receivedChunkCount,
        expectedChunks: assembly.expectedChunkCount,
      },
      'incomplete source inventory scan expired without catalogue changes',
    );
  }
  return expired;
}

function comparePath(
  left: { readonly path: string },
  right: { readonly path: string },
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function requireApiProducedEvent(event: DiscoveryEvent): void {
  if (event.producer !== 'workspace-brain-api') {
    throw new Error(
      `${event.eventType} must be produced by the catalogue owner`,
    );
  }
}

function isSafeInventoryPath(
  path: string,
  registeredRootIds: ReadonlySet<string>,
  allowRootPath: boolean,
): boolean {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0')
  ) {
    return false;
  }
  const segments = path.split('/');
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    ) ||
    !registeredRootIds.has(segments[0] ?? '') ||
    (!allowRootPath && segments.length < 2)
  ) {
    return false;
  }
  return true;
}

export async function publishPendingEvents(
  catalogue: Pick<
    DiscoveryCatalogue,
    'listPendingDiscoveryEvents' | 'markDiscoveryEventPublished'
  >,
  events: InternalEventPublisher,
): Promise<void> {
  while (true) {
    const pending = await catalogue.listPendingDiscoveryEvents(100);
    if (pending.length === 0) {
      return;
    }
    for (const event of pending) {
      await events.publish(event);
      await catalogue.markDiscoveryEventPublished(
        event.eventId,
        new Date().toISOString(),
      );
    }
  }
}

export function configForCatalogue(config: WorkspaceBrainConfig): {
  readonly sources: Parameters<CatalogueDiscovery['registerConfiguration']>[0];
  readonly workspaces: Parameters<
    CatalogueDiscovery['registerConfiguration']
  >[1];
} {
  return {
    sources: config.sources.map((source) => ({
      configId: source.id,
      name: source.name,
      rootPaths: source.roots,
      excludeDirs: source.defaults.exclude_dirs,
      includeExtensions: source.defaults.include_extensions,
      maxFileSizeBytes: source.defaults.max_file_size_mb * 1024 * 1024,
    })),
    workspaces: config.workspaces.map((workspace) => ({
      configId: workspace.id,
      name: workspace.name,
      sourceConfigIds: workspace.sourceIds,
      include: workspace.include,
      exclude: workspace.exclude,
    })),
  };
}
