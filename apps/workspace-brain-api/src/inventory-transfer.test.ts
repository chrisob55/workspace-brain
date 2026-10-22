import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  type DiscoveryEvent,
  type DocumentCandidate,
  type RepositoryCandidate,
  type ScanResult,
} from '@workspace-brain/domain';
import { createDuckDbCatalogue } from '@workspace-brain/duckdb';
import { afterEach, describe, expect, it } from 'vitest';
import pino from 'pino';

import { createSourceInventoryTransfer } from '../../ingestion-worker/src/source-inventory.js';
import { connectNatsDiscoveryBus } from '@workspace-brain/nats';
import { NonRetryableEventError } from '@workspace-brain/nats';
import { createDiscoveryService } from './discovery-service.js';

const migrationsDirectory = resolve(
  process.cwd(),
  'infrastructure/duckdb/migrations',
);
const temporaryDirectories: string[] = [];
const natsServers = process.env.NATS_TEST_SERVERS;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('source inventory transfer with DuckDB catalogue', () => {
  it('expires incomplete staging without catalogue changes and rejects late events', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'workspace-brain-inventory-expiry-'),
    );
    temporaryDirectories.push(directory);
    const catalogue = await openCatalogue(
      join(directory, 'catalogue.duckdb'),
      directory,
    );
    const source = (await catalogue.listSources({ limit: 10 })).items[0];
    const root = source?.roots?.[0];
    if (source === undefined || root === undefined) {
      throw new Error('Inventory expiry source registration failed');
    }
    const transfer = createSourceInventoryTransfer(
      {
        sourceId: source.id,
        discoveredAt: '2026-10-19T09:00:00.000Z',
        repositories: [],
        documents: [candidateDocument(`${root.id}/pending.md`, 'a'.repeat(64))],
      },
      {
        scanId: 'expired-incomplete-scan',
        correlationId: 'expired-incomplete-scan',
        startedAt: '2026-10-19T09:00:00.000Z',
        completedAt: '2026-10-19T09:00:01.000Z',
        durationMilliseconds: 1_000,
        payloadBudgetBytes: 10_000,
      },
    );
    const service = createDiscoveryService(
      catalogue,
      { async publish() {} },
      { info() {}, error() {} },
      10_000,
    );
    await service.handle(transfer.started);
    const firstChunk = transfer.chunks[0];
    if (firstChunk === undefined) {
      throw new Error('Inventory expiry fixture did not contain a chunk');
    }
    await service.handle(firstChunk);
    const expired = await catalogue.expireInventoryAssemblies(
      '9999-12-31T00:00:00.000Z',
    );

    expect(expired).toEqual([
      {
        sourceId: source.id,
        scanId: 'expired-incomplete-scan',
        receivedChunkCount: 1,
      },
    ]);
    expect(
      await catalogue.getInventoryAssembly(
        source.id,
        'expired-incomplete-scan',
      ),
    ).toMatchObject({ status: 'expired', chunks: [] });
    await expect(service.handle(transfer.completed)).rejects.toBeInstanceOf(
      NonRetryableEventError,
    );
    expect(
      await catalogue.listDocuments({ limit: 10, sourceId: source.id }),
    ).toMatchObject({ items: [] });
    await catalogue.close();
  });

  it('supersedes an older overlapping scan that completes after the newer scan', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'workspace-brain-inventory-order-'),
    );
    temporaryDirectories.push(directory);
    const catalogue = await openCatalogue(
      join(directory, 'catalogue.duckdb'),
      directory,
    );
    const source = (await catalogue.listSources({ limit: 10 })).items[0];
    const root = source?.roots?.[0];
    if (source === undefined || root === undefined) {
      throw new Error('Inventory ordering source registration failed');
    }
    const olderDocument = candidateDocument(
      `${root.id}/older.md`,
      'a'.repeat(64),
    );
    const newerDocument = candidateDocument(
      `${root.id}/newer.md`,
      'b'.repeat(64),
    );
    const older = createSourceInventoryTransfer(
      {
        sourceId: source.id,
        discoveredAt: '2026-10-18T09:00:00.000Z',
        repositories: [],
        documents: [olderDocument],
      },
      {
        scanId: 'older-overlapping-scan',
        correlationId: 'older-overlapping-scan',
        startedAt: '2026-10-18T09:00:00.000Z',
        completedAt: '2026-10-18T09:00:01.000Z',
        durationMilliseconds: 1_000,
        payloadBudgetBytes: 10_000,
      },
    );
    const newer = createSourceInventoryTransfer(
      {
        sourceId: source.id,
        discoveredAt: '2026-10-19T09:00:00.000Z',
        repositories: [],
        documents: [newerDocument],
      },
      {
        scanId: 'newer-overlapping-scan',
        correlationId: 'newer-overlapping-scan',
        startedAt: '2026-10-19T09:00:00.000Z',
        completedAt: '2026-10-19T09:00:01.000Z',
        durationMilliseconds: 1_000,
        payloadBudgetBytes: 10_000,
      },
    );
    const published: DiscoveryEvent[] = [];
    const service = createDiscoveryService(
      catalogue,
      {
        async publish(event) {
          published.push(event);
        },
      },
      { info() {}, error() {} },
      10_000,
    );

    await service.handle(older.started);
    for (const chunk of older.chunks) {
      await service.handle(chunk);
    }
    await service.handle(newer.started);
    for (const chunk of newer.chunks) {
      await service.handle(chunk);
    }
    await service.handle(newer.completed);
    await service.handle(older.completed);

    expect(
      await catalogue.getInventoryAssembly(
        source.id,
        older.completed.payload.scanId,
      ),
    ).toMatchObject({ status: 'superseded' });
    expect(
      await catalogue.getInventoryAssembly(
        source.id,
        newer.completed.payload.scanId,
      ),
    ).toMatchObject({ status: 'committed' });
    const documents = await catalogue.listDocuments({
      limit: 10,
      sourceId: source.id,
    });
    expect(documents.items.map(({ path }) => path)).toEqual([
      newerDocument.path,
    ]);
    expect(
      published.filter(
        (event) =>
          event.eventType === 'SourceScanCompleted' &&
          event.correlationId === 'newer-overlapping-scan',
      ),
    ).toHaveLength(1);
    expect(
      published.some(
        (event) =>
          event.eventType === 'SourceScanCompleted' &&
          event.correlationId === 'older-overlapping-scan',
      ),
    ).toBe(false);
    await catalogue.close();
  });

  it('stages a >1 MiB scan durably, applies removals once only after assembly, and survives API restart', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'workspace-brain-inventory-transfer-'),
    );
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'catalogue.duckdb');
    let catalogue = await openCatalogue(databasePath, directory);
    const source = (await catalogue.listSources({ limit: 10 })).items[0];
    const root = source?.roots?.[0];
    if (source === undefined || root === undefined) {
      throw new Error('Inventory transfer source registration failed');
    }

    const scan = createLargeScan(source.id, root.id);
    const keptDocument = scan.documents[0];
    if (keptDocument === undefined) {
      throw new Error('Inventory fixture did not contain its kept document');
    }
    const removedDocument = candidateDocument(
      `${root.id}/removed/removed.md`,
      'c'.repeat(64),
    );
    await catalogue.persistScan(
      source.id,
      [],
      [keptDocument, removedDocument],
      '2026-10-18T09:00:00.000Z',
      'seed-scan',
      1,
    );

    const transfer = createSourceInventoryTransfer(scan, {
      scanId: 'representative-scan',
      correlationId: 'representative-scan',
      startedAt: '2026-10-19T09:00:00.000Z',
      completedAt: '2026-10-19T09:00:03.000Z',
      durationMilliseconds: 3_000,
      payloadBudgetBytes: 838_860,
    });

    expect(Buffer.byteLength(JSON.stringify(scan), 'utf8')).toBeGreaterThan(
      1_048_576,
    );
    expect(transfer.chunks.length).toBeGreaterThan(1);
    expect(
      transfer.chunks.every(
        (event) => Buffer.byteLength(JSON.stringify(event), 'utf8') <= 838_860,
      ),
    ).toBe(true);

    const published: DiscoveryEvent[] = [];
    let service = createDiscoveryService(
      catalogue,
      {
        async publish(event) {
          published.push(event);
        },
      },
      { info() {}, error() {} },
      1_048_576,
    );

    for (const chunk of transfer.chunks.slice(0, -1)) {
      await service.handle(chunk);
    }
    const firstChunk = transfer.chunks[0];
    if (firstChunk === undefined) {
      throw new Error('Expected at least one chunk');
    }
    await service.handle(firstChunk);
    await service.handle(transfer.completed);

    const beforeCompletion = await catalogue.listDocuments({
      limit: 10,
      sourceId: source.id,
    });
    expect(beforeCompletion.items).toHaveLength(2);
    expect(
      beforeCompletion.items.some(({ path }) => path === removedDocument.path),
    ).toBe(true);

    await catalogue.close();
    catalogue = await createDuckDbCatalogue(databasePath, migrationsDirectory);
    service = createDiscoveryService(
      catalogue,
      {
        async publish(event) {
          published.push(event);
        },
      },
      { info() {}, error() {} },
      1_048_576,
    );
    await service.handle(transfer.started);
    const finalChunk = transfer.chunks.at(-1);
    if (finalChunk === undefined) {
      throw new Error('Expected a final inventory chunk');
    }
    await service.handle(finalChunk);

    const afterCommit = await catalogue.listDocuments({
      limit: 5_000,
      sourceId: source.id,
    });
    const repositories = await catalogue.listRepositories({
      limit: 100,
      sourceId: source.id,
    });
    expect(afterCommit.items).toHaveLength(3_952);
    expect(
      afterCommit.items.some(({ path }) => path === removedDocument.path),
    ).toBe(false);
    expect(repositories.items).toHaveLength(21);
    expect(
      published.filter(
        (event) =>
          event.eventType === 'SourceScanCompleted' &&
          event.correlationId === 'representative-scan',
      ),
    ).toHaveLength(1);

    await service.handle(transfer.completed);
    expect(
      published.filter(
        (event) =>
          event.eventType === 'SourceScanCompleted' &&
          event.correlationId === 'representative-scan',
      ),
    ).toHaveLength(1);
    expect(
      await catalogue.getInventoryAssembly(source.id, 'representative-scan'),
    ).toMatchObject({ status: 'committed' });
    await catalogue.close();
  }, 120_000);
});

describe.skipIf(natsServers === undefined)(
  'source inventory transfer over JetStream',
  () => {
    it('accepts bounded events and commits the complete 21-repository inventory only after all chunks', async () => {
      if (natsServers === undefined) {
        throw new Error('NATS_TEST_SERVERS is required');
      }
      const directory = await mkdtemp(
        join(tmpdir(), 'workspace-brain-inventory-nats-'),
      );
      temporaryDirectories.push(directory);
      const catalogue = await openCatalogue(
        join(directory, 'catalogue.duckdb'),
        directory,
      );
      const source = (await catalogue.listSources({ limit: 10 })).items[0];
      const root = source?.roots?.[0];
      if (source === undefined || root === undefined) {
        throw new Error('NATS inventory source registration failed');
      }
      const scan = createLargeScan(source.id, root.id);
      const scanId = `jetstream-representative-${source.id}`;
      const firstDocument = scan.documents[0];
      if (firstDocument === undefined) {
        throw new Error('NATS inventory fixture has no documents');
      }
      const removedDocument = candidateDocument(
        `${root.id}/removed/removed.md`,
        'c'.repeat(64),
      );
      await catalogue.persistScan(
        source.id,
        [],
        [firstDocument, removedDocument],
        '2026-10-18T09:00:00.000Z',
        'jetstream-seed-scan',
        1,
      );
      const transfer = createSourceInventoryTransfer(scan, {
        scanId,
        correlationId: scanId,
        startedAt: '2026-10-19T09:00:00.000Z',
        completedAt: '2026-10-19T09:00:03.000Z',
        durationMilliseconds: 3_000,
        payloadBudgetBytes: 838_860,
      });
      const bus = await connectNatsDiscoveryBus(
        natsServers,
        pino({ level: 'silent' }),
      );
      let completedCount = 0;
      let resolveCompleted: (() => void) | undefined;
      const completed = new Promise<void>((resolve) => {
        resolveCompleted = resolve;
      });
      const apiService = createDiscoveryService(
        catalogue,
        bus,
        { info() {}, error() {} },
        bus.maxPayloadBytes,
      );
      const durablePrefix = `inventory-${source.id.toLowerCase()}`;
      try {
        await bus.subscribe(
          'workspace.discovery.source.inventory.started.v1',
          `${durablePrefix}-started`,
          (event) => apiService.handle(event),
        );
        await bus.subscribe(
          'workspace.discovery.source.inventory.chunk.v1',
          `${durablePrefix}-chunk`,
          (event) => apiService.handle(event),
        );
        await bus.subscribe(
          'workspace.discovery.source.inventory.completed.v1',
          `${durablePrefix}-completed`,
          (event) => apiService.handle(event),
        );
        await bus.subscribe(
          'workspace.discovery.source.scan.completed',
          `${durablePrefix}-scan-result`,
          async (event) => {
            if (
              event.eventType === 'SourceScanCompleted' &&
              event.correlationId === scanId
            ) {
              completedCount += 1;
              resolveCompleted?.();
            }
          },
        );

        const safePayloadBudget = Math.min(
          Math.floor(bus.maxPayloadBytes * 0.8),
          1_000_000,
        );
        const transferEvents = [
          transfer.started,
          ...transfer.chunks,
          transfer.completed,
        ];
        const eventSizes = transferEvents.map((event) =>
          Buffer.byteLength(JSON.stringify(event), 'utf8'),
        );
        expect(Buffer.byteLength(JSON.stringify(scan), 'utf8')).toBeGreaterThan(
          bus.maxPayloadBytes,
        );
        expect(Math.max(...eventSizes)).toBeLessThanOrEqual(safePayloadBudget);

        await bus.publish(transfer.started);
        for (const chunk of transfer.chunks.slice(0, -1)) {
          await bus.publish(chunk);
        }
        await bus.publish(transfer.completed);
        await waitFor(async () => {
          const assembly = await catalogue.getInventoryAssembly(
            source.id,
            transfer.completed.payload.scanId,
          );
          return (
            assembly?.expectedChunkCount === transfer.chunks.length &&
            assembly.chunks.length === transfer.chunks.length - 1
          );
        });
        const partialCatalogue = await catalogue.listDocuments({
          limit: 10,
          sourceId: source.id,
        });
        expect(partialCatalogue.items).toHaveLength(2);
        expect(
          partialCatalogue.items.some(
            ({ path }) => path === removedDocument.path,
          ),
        ).toBe(true);

        const finalChunk = transfer.chunks.at(-1);
        if (finalChunk === undefined) {
          throw new Error('NATS inventory fixture has no final chunk');
        }
        await bus.publish(finalChunk);
        await Promise.race([
          completed,
          new Promise<never>((_, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new Error('Timed out waiting for JetStream scan commit'),
                ),
              90_000,
            );
            timer.unref();
          }),
        ]);
        await bus.publish({
          ...transfer.chunks[0]!,
          eventId: 'duplicate-inventory-chunk-event',
          idempotencyKey: 'duplicate-inventory-chunk-message',
        });
        await bus.publish(transfer.completed);

        const documents = await catalogue.listDocuments({
          limit: 5_000,
          sourceId: source.id,
        });
        const repositories = await catalogue.listRepositories({
          limit: 100,
          sourceId: source.id,
        });
        expect(documents.items).toHaveLength(3_952);
        expect(
          documents.items.some(({ path }) => path === removedDocument.path),
        ).toBe(false);
        expect(repositories.items).toHaveLength(21);
        expect(completedCount).toBe(1);
        expect(transfer.largestEventBytes).toBeLessThanOrEqual(
          safePayloadBudget,
        );
        expect(Math.max(...eventSizes)).toBe(transfer.largestEventBytes);
        expect(
          await catalogue.getInventoryAssembly(source.id, scanId),
        ).toMatchObject({
          status: 'committed',
          expectedChunkCount: transfer.chunks.length,
          repositoryCount: 21,
          documentCount: 3_952,
          inventoryChecksum: transfer.inventoryChecksum,
        });
      } finally {
        await bus.close();
        await catalogue.close();
      }
    }, 120_000);
  },
);

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMilliseconds = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for durable inventory staging');
}

async function openCatalogue(databasePath: string, directory: string) {
  const catalogue = await createDuckDbCatalogue(
    databasePath,
    migrationsDirectory,
  );
  await catalogue.registerConfiguration(
    [
      {
        configId: 'inventory-transfer-source',
        name: 'Inventory Transfer Source',
        rootPaths: [join(directory, 'source')],
        excludeDirs: [],
        includeExtensions: ['.md'],
        maxFileSizeBytes: 10_000,
      },
    ],
    [],
  );
  return catalogue;
}

function createLargeScan(
  sourceId: ScanResult['sourceId'],
  rootId: string,
): ScanResult {
  const discoveredAt = '2026-10-19T09:00:00.000Z';
  const repositories = Array.from({ length: 21 }, (_, index) =>
    candidateRepository(
      `${rootId}/repository-${String(index).padStart(2, '0')}`,
    ),
  );
  const documents = Array.from({ length: 3_952 }, (_, index) => {
    const repositoryIndex = index % repositories.length;
    const path = `${rootId}/repository-${String(repositoryIndex).padStart(2, '0')}/document-${String(index).padStart(4, '0')}-${'x'.repeat(130)}.md`;
    return candidateDocument(path, 'b'.repeat(64));
  });
  return { sourceId, discoveredAt, repositories, documents };
}

function candidateRepository(path: string): RepositoryCandidate {
  return {
    path,
    repositoryType: 'git',
    fingerprint: 'a'.repeat(64),
    discoveryMethod: 'filesystem',
  };
}

function candidateDocument(
  path: string,
  fingerprint: string,
): DocumentCandidate {
  return {
    path,
    filename: path.split('/').at(-1) ?? path,
    extension: '.md',
    sizeBytes: 2048,
    modifiedAt: '2026-10-19T09:00:00.000Z',
    fingerprint,
    discoveryMethod: 'filesystem',
  };
}
