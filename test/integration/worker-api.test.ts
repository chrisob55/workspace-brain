import {
  createDocumentId,
  createRepositoryId,
  createSourceId,
  createSourceRootId,
  type DiscoveryEvent,
  type DiscoverySource,
  type Document,
  type DocumentCandidate,
  type Repository,
  type RepositoryCandidate,
  type Source,
} from '../../packages/domain/src/index.js';
import type {
  CatalogueDiscovery,
  CataloguePage,
} from '@workspace-brain/catalogue';
import type { NatsDiscoveryBus } from '@workspace-brain/nats';
import { describe, expect, it } from 'vitest';

import { createDiscoveryService } from '../../apps/workspace-brain-api/src/discovery-service.js';
import type { InternalEventPublisher } from '../../apps/workspace-brain-api/src/events.js';
import { NatsEventConsumer } from '../../apps/ingestion-worker/src/event-consumer.js';

describe('worker/API application flow', () => {
  it('scans a catalogue source and submits ID-free inventory through the API handler using a fake bus', async () => {
    const sourceId = createSourceId();
    const rootId = createSourceRootId();
    const source: Source = {
      id: sourceId,
      name: 'Projects',
      type: 'filesystem',
      containerPaths: ['/sources'],
      roots: [{ id: rootId, sourceId, absolutePath: '/sources' }],
      createdAt: new Date().toISOString(),
    };
    const discoverySource: DiscoverySource = {
      sourceId,
      roots: source.roots ?? [],
      workspaceRules: [{ include: ['**'], exclude: [] }],
      excludedDirectoryNames: ['.git', 'node_modules'],
      includeExtensions: ['.md'],
      maxFileSizeBytes: 1024,
    };
    const repositoryCandidate: RepositoryCandidate = {
      path: `${rootId}/project`,
      repositoryType: 'git',
      fingerprint: 'a'.repeat(64),
      discoveryMethod: 'filesystem',
    };
    const documentCandidate: DocumentCandidate = {
      path: `${rootId}/project/README.md`,
      filename: 'README.md',
      extension: '.md',
      sizeBytes: 12,
      modifiedAt: new Date().toISOString(),
      fingerprint: 'b'.repeat(64),
      discoveryMethod: 'filesystem',
    };
    const repository: Repository = {
      ...repositoryCandidate,
      id: createRepositoryId(),
      sourceId,
      discoveredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const document: Document = {
      ...documentCandidate,
      id: createDocumentId(),
      sourceId,
      discoveredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const persistedCandidates: {
      repositories: readonly RepositoryCandidate[];
      documents: readonly DocumentCandidate[];
    }[] = [];
    const catalogueCalls: string[] = [];
    const pendingEvents: DiscoveryEvent[] = [];
    const catalogue: Pick<
      CatalogueDiscovery,
      | 'getSource'
      | 'persistScan'
      | 'listPendingDiscoveryEvents'
      | 'markDiscoveryEventPublished'
      | 'recordScanStarted'
      | 'recordScanFailed'
    > = {
      async getSource(id: string) {
        return id === sourceId ? source : undefined;
      },
      async persistScan(
        _id: string,
        repositories: readonly RepositoryCandidate[],
        documents: readonly DocumentCandidate[],
      ) {
        persistedCandidates.push({ repositories, documents });
        catalogueCalls.push('persist');
        catalogueCalls.push('completed');
        pendingEvents.push(
          createCatalogueEvent(
            'RepositoryDiscovered',
            { repository },
            sourceId,
          ),
          createCatalogueEvent('DocumentDiscovered', { document }, sourceId),
          createCatalogueEvent(
            'SourceScanCompleted',
            {
              sourceId,
              discoveredAt: inventoryEventTime,
              repositoryCount: 1,
              documentCount: 1,
              addedCount: 2,
              modifiedCount: 0,
              removedCount: 0,
              unchangedCount: 0,
              durationMilliseconds: 1,
            },
            sourceId,
          ),
        );
        return {
          repositories: [repository],
          documents: [document],
          repositoryChanges: [{ change: 'added' as const, record: repository }],
          documentChanges: [{ change: 'added' as const, record: document }],
        };
      },
      async recordScanStarted() {
        catalogueCalls.push('started');
      },
      async listPendingDiscoveryEvents() {
        return [...pendingEvents];
      },
      async markDiscoveryEventPublished(eventId: string) {
        const index = pendingEvents.findIndex(
          (event) => event.eventId === eventId,
        );
        if (index >= 0) {
          pendingEvents.splice(index, 1);
        }
      },
      async recordScanFailed() {
        catalogueCalls.push('failed');
      },
    };
    const catalogueEvents: DiscoveryEvent[] = [];
    const publisher: InternalEventPublisher = {
      async publish(event) {
        catalogueEvents.push(event);
      },
    };
    const api = createDiscoveryService(catalogue, publisher, {
      info() {},
      error() {},
    });
    const bus = new FakeDiscoveryBus(discoverySource, (event) => {
      if (
        event.eventType === 'SourceScanStarted' ||
        event.eventType === 'SourceInventorySubmitted' ||
        event.eventType === 'SourceScanFailed'
      ) {
        return api.handle(event);
      }
      return Promise.resolve();
    });
    const scannedSources: DiscoverySource[] = [];
    const consumer = new NatsEventConsumer(
      {
        async scan(scannedSource) {
          scannedSources.push(scannedSource);
          return {
            sourceId,
            discoveredAt: new Date().toISOString(),
            repositories: [repositoryCandidate],
            documents: [documentCandidate],
          };
        },
      },
      bus,
      { error() {}, info() {} },
      60_000,
    );

    await consumer.start();
    const requested = bus.published.find(
      (event) => event.eventType === 'SourceScanRequested',
    );
    if (requested === undefined) {
      throw new Error('Worker did not request a source scan');
    }
    await bus.invoke(requested);

    expect(scannedSources).toEqual([discoverySource]);
    expect(persistedCandidates).toEqual([
      {
        repositories: [repositoryCandidate],
        documents: [documentCandidate],
      },
    ]);
    expect(catalogueCalls).toEqual(['started', 'persist', 'completed']);
    expect(catalogueEvents.map((event) => event.eventType)).toEqual([
      'RepositoryDiscovered',
      'DocumentDiscovered',
      'SourceScanCompleted',
    ]);
    expect(persistedCandidates[0]?.repositories[0]).not.toHaveProperty('id');
    await consumer.stop();
  });
});

const inventoryEventTime = '2026-10-01T12:00:00.000Z';
let catalogueEventNumber = 0;

function createCatalogueEvent(
  eventType:
    'RepositoryDiscovered' | 'DocumentDiscovered' | 'SourceScanCompleted',
  payload: Extract<DiscoveryEvent, { eventType: typeof eventType }>['payload'],
  sourceId: string,
): DiscoveryEvent {
  catalogueEventNumber += 1;
  return {
    eventId: `catalogue-event-${catalogueEventNumber}`,
    eventType,
    eventVersion: 1,
    occurredAt: inventoryEventTime,
    producer: 'workspace-brain-api',
    correlationId: 'integration-correlation',
    idempotencyKey: `catalogue-event-key-${catalogueEventNumber}`,
    partitionKey: sourceId,
    payload,
  } as DiscoveryEvent;
}

class FakeDiscoveryBus implements NatsDiscoveryBus {
  readonly published: DiscoveryEvent[] = [];
  private handler: ((event: DiscoveryEvent) => Promise<void>) | undefined;

  constructor(
    private readonly source: DiscoverySource,
    private readonly onPublish: (event: DiscoveryEvent) => Promise<void>,
  ) {}

  async publish(event: DiscoveryEvent): Promise<void> {
    this.published.push(event);
    await this.onPublish(event);
  }

  async subscribe(
    _subject: string,
    _durableName: string,
    handler: (event: DiscoveryEvent) => Promise<void>,
  ): Promise<void> {
    this.handler = handler;
  }

  subscribeRequests(): void {}

  async request<T>(): Promise<T> {
    const page: CataloguePage<DiscoverySource> = { items: [this.source] };
    return page as T;
  }

  async close(): Promise<void> {}

  async invoke(event: DiscoveryEvent): Promise<void> {
    if (this.handler === undefined) {
      throw new Error('Worker did not subscribe to scan requests');
    }
    await this.handler(event);
  }
}
