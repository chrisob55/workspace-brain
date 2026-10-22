import {
  completeInventoryChecksum,
  inventoryChunkChecksum,
  type DiscoveryEvent,
  type DocumentCandidate,
  type RepositoryCandidate,
  type ScanResult,
} from '@workspace-brain/domain';
import { serializeDiscoveryEvent } from '@workspace-brain/nats';

type InventoryEventName =
  | 'SourceInventoryStarted'
  | 'SourceInventoryChunk'
  | 'SourceInventoryCompleted';

export class InventoryPayloadBudgetExceededError extends Error {
  constructor(
    readonly payloadBytes: number,
    readonly payloadBudgetBytes: number,
    readonly entryTooLarge = false,
  ) {
    super(
      entryTooLarge
        ? `An inventory record exceeds the ${payloadBudgetBytes}-byte event budget`
        : `Inventory event is ${payloadBytes} bytes; budget is ${payloadBudgetBytes}`,
    );
    this.name = 'InventoryPayloadBudgetExceededError';
  }
}

export type SourceInventoryTransfer = {
  readonly started: Extract<
    DiscoveryEvent,
    { readonly eventType: 'SourceInventoryStarted' }
  >;
  readonly chunks: readonly Extract<
    DiscoveryEvent,
    { readonly eventType: 'SourceInventoryChunk' }
  >[];
  readonly completed: Extract<
    DiscoveryEvent,
    { readonly eventType: 'SourceInventoryCompleted' }
  >;
  readonly chunkSizes: readonly number[];
  readonly largestEventBytes: number;
  readonly inventoryChecksum: string;
};

type InventoryRecord =
  | { readonly kind: 'repository'; readonly candidate: RepositoryCandidate }
  | { readonly kind: 'document'; readonly candidate: DocumentCandidate };

export function createSourceInventoryTransfer(
  scan: ScanResult,
  options: {
    readonly scanId: string;
    readonly correlationId: string;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly durationMilliseconds: number;
    readonly payloadBudgetBytes: number;
  },
): SourceInventoryTransfer {
  if (
    !Number.isSafeInteger(options.payloadBudgetBytes) ||
    options.payloadBudgetBytes < 1
  ) {
    throw new Error('Inventory payload budget must be a positive safe integer');
  }

  const repositories = sortByPath(scan.repositories);
  const documents = sortByPath(scan.documents);
  assertUniquePaths(repositories, documents);

  const started = createInventoryEvent(
    'SourceInventoryStarted',
    {
      schemaVersion: 1,
      scanId: options.scanId,
      sourceId: scan.sourceId,
      startedAt: options.startedAt,
      discoveredAt: scan.discoveredAt,
      expectedRepositoryCount: repositories.length,
      expectedDocumentCount: documents.length,
    },
    scan.sourceId,
    options.scanId,
    options.correlationId,
    options.startedAt,
    'started',
  );
  const startedBytes = serializedSize(started);
  assertWithinBudget(startedBytes, options.payloadBudgetBytes);

  const records: InventoryRecord[] = [
    ...repositories.map((candidate) => ({
      kind: 'repository' as const,
      candidate,
    })),
    ...documents.map((candidate) => ({ kind: 'document' as const, candidate })),
  ].sort((left, right) => {
    const pathOrder =
      left.candidate.path < right.candidate.path
        ? -1
        : left.candidate.path > right.candidate.path
          ? 1
          : 0;
    return pathOrder || left.kind.localeCompare(right.kind);
  });

  const chunks: Extract<
    DiscoveryEvent,
    { readonly eventType: 'SourceInventoryChunk' }
  >[] = [];
  const chunkSizes: number[] = [];
  let chunkRepositories: RepositoryCandidate[] = [];
  let chunkDocuments: DocumentCandidate[] = [];
  let chunkRepositoryItemBytes = 0;
  let chunkDocumentItemBytes = 0;
  const appendRecord = (record: InventoryRecord) => {
    if (record.kind === 'repository') {
      chunkRepositories.push(record.candidate);
      chunkRepositoryItemBytes += serializedRecordSize(record.candidate);
    } else {
      chunkDocuments.push(record.candidate);
      chunkDocumentItemBytes += serializedRecordSize(record.candidate);
    }
  };
  const removeLastRecord = (record: InventoryRecord) => {
    if (record.kind === 'repository') {
      chunkRepositories.pop();
      chunkRepositoryItemBytes -= serializedRecordSize(record.candidate);
    } else {
      chunkDocuments.pop();
      chunkDocumentItemBytes -= serializedRecordSize(record.candidate);
    }
  };
  const candidateChunk = (chunkIndex: number) =>
    createChunkEvent(
      scan.sourceId,
      options,
      chunkIndex,
      chunkRepositories,
      chunkDocuments,
      scan.discoveredAt,
    );

  for (const record of records) {
    appendRecord(record);
    const candidateBytes = measureChunkSize(
      scan.sourceId,
      options,
      chunks.length,
      chunkRepositories.length,
      chunkDocuments.length,
      chunkRepositoryItemBytes,
      chunkDocumentItemBytes,
      scan.discoveredAt,
    );
    if (candidateBytes <= options.payloadBudgetBytes) {
      continue;
    }
    removeLastRecord(record);
    if (chunkRepositories.length + chunkDocuments.length === 0) {
      throw new InventoryPayloadBudgetExceededError(
        candidateBytes,
        options.payloadBudgetBytes,
        true,
      );
    }
    const finalized = candidateChunk(chunks.length);
    const finalizedBytes = serializedSize(finalized);
    assertWithinBudget(finalizedBytes, options.payloadBudgetBytes);
    chunks.push(finalized);
    chunkSizes.push(finalizedBytes);
    chunkRepositories = [];
    chunkDocuments = [];
    chunkRepositoryItemBytes = 0;
    chunkDocumentItemBytes = 0;
    appendRecord(record);
    const singleRecordBytes = measureChunkSize(
      scan.sourceId,
      options,
      chunks.length,
      chunkRepositories.length,
      chunkDocuments.length,
      chunkRepositoryItemBytes,
      chunkDocumentItemBytes,
      scan.discoveredAt,
    );
    if (singleRecordBytes > options.payloadBudgetBytes) {
      throw new InventoryPayloadBudgetExceededError(
        singleRecordBytes,
        options.payloadBudgetBytes,
        true,
      );
    }
  }

  if (chunkRepositories.length + chunkDocuments.length > 0) {
    const finalChunk = candidateChunk(chunks.length);
    const finalChunkBytes = serializedSize(finalChunk);
    assertWithinBudget(finalChunkBytes, options.payloadBudgetBytes);
    chunks.push(finalChunk);
    chunkSizes.push(finalChunkBytes);
  }

  const inventoryChecksum = completeInventoryChecksum(
    scan.sourceId,
    scan.discoveredAt,
    repositories,
    documents,
  );
  const completed = createInventoryEvent(
    'SourceInventoryCompleted',
    {
      schemaVersion: 1,
      scanId: options.scanId,
      sourceId: scan.sourceId,
      expectedChunkCount: chunks.length,
      repositoryCount: repositories.length,
      documentCount: documents.length,
      inventoryChecksum,
      completedAt: options.completedAt,
      durationMilliseconds: options.durationMilliseconds,
    },
    scan.sourceId,
    options.scanId,
    options.correlationId,
    options.completedAt,
    'completed',
  );
  const completedBytes = serializedSize(completed);
  assertWithinBudget(completedBytes, options.payloadBudgetBytes);

  return {
    started,
    chunks,
    completed,
    chunkSizes,
    largestEventBytes: Math.max(startedBytes, completedBytes, ...chunkSizes),
    inventoryChecksum,
  };
}

function measureChunkSize(
  sourceId: ScanResult['sourceId'],
  options: { readonly scanId: string; readonly correlationId: string },
  chunkIndex: number,
  repositoryCount: number,
  documentCount: number,
  repositoryItemBytes: number,
  documentItemBytes: number,
  createdAt: string,
): number {
  const template = createInventoryEvent(
    'SourceInventoryChunk',
    {
      schemaVersion: 1,
      scanId: options.scanId,
      sourceId,
      chunkIndex,
      repositoryCount,
      documentCount,
      repositories: [],
      documents: [],
      checksum: '0'.repeat(64),
      createdAt,
    },
    sourceId,
    options.scanId,
    options.correlationId,
    createdAt,
    `chunk:${chunkIndex}`,
  );
  return (
    serializedSize(template) -
    4 +
    repositoryItemBytes +
    Math.max(repositoryCount - 1, 0) +
    documentItemBytes +
    Math.max(documentCount - 1, 0)
  );
}

function serializedRecordSize(
  record: RepositoryCandidate | DocumentCandidate,
): number {
  return Buffer.byteLength(JSON.stringify(record), 'utf8');
}

export function serializedSize(event: DiscoveryEvent): number {
  return serializeDiscoveryEvent(event).byteLength;
}

function createChunkEvent(
  sourceId: ScanResult['sourceId'],
  options: {
    readonly scanId: string;
    readonly correlationId: string;
  },
  chunkIndex: number,
  repositories: readonly RepositoryCandidate[],
  documents: readonly DocumentCandidate[],
  createdAt: string,
): Extract<DiscoveryEvent, { readonly eventType: 'SourceInventoryChunk' }> {
  return createInventoryEvent(
    'SourceInventoryChunk',
    {
      schemaVersion: 1,
      scanId: options.scanId,
      sourceId,
      chunkIndex,
      repositoryCount: repositories.length,
      documentCount: documents.length,
      repositories: [...repositories],
      documents: [...documents],
      checksum: inventoryChunkChecksum(repositories, documents),
      createdAt,
    },
    sourceId,
    options.scanId,
    options.correlationId,
    createdAt,
    `chunk:${chunkIndex}`,
  );
}

function createInventoryEvent<Name extends InventoryEventName>(
  eventType: Name,
  payload: Extract<DiscoveryEvent, { readonly eventType: Name }>['payload'],
  sourceId: ScanResult['sourceId'],
  scanId: string,
  correlationId: string,
  occurredAt: string,
  suffix: string,
): Extract<DiscoveryEvent, { readonly eventType: Name }> {
  const idempotencyKey = `source-inventory:${scanId}:${suffix}`;
  return {
    eventId: idempotencyKey,
    eventType,
    eventVersion: 1,
    occurredAt,
    producer: 'workspace-brain-ingestion-worker',
    correlationId,
    idempotencyKey,
    partitionKey: sourceId,
    payload,
  } as Extract<DiscoveryEvent, { readonly eventType: Name }>;
}

function sortByPath<T extends { readonly path: string }>(
  entries: readonly T[],
): T[] {
  return [...entries].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function assertUniquePaths(
  repositories: readonly RepositoryCandidate[],
  documents: readonly DocumentCandidate[],
): void {
  for (const entries of [repositories, documents]) {
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index - 1]?.path === entries[index]?.path) {
        throw new Error('Inventory contains duplicate record paths');
      }
    }
  }
}

function assertWithinBudget(size: number, payloadBudgetBytes: number): void {
  if (size > payloadBudgetBytes) {
    throw new InventoryPayloadBudgetExceededError(size, payloadBudgetBytes);
  }
}
