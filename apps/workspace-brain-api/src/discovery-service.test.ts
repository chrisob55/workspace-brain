import {
  createDocumentId,
  createDocumentVersionId,
  createKnowledgeModelId,
  createKnowledgePublicationId,
  createRepositoryId,
  createSourceId,
  createSourceRootId,
  type DiscoveryEvent,
  type Document,
  type DocumentCandidate,
  type Repository,
  type RepositoryCandidate,
  type Source,
  type SourceId,
} from '@workspace-brain/domain';
import { describe, expect, it } from 'vitest';

import { createDiscoveryService } from './discovery-service.js';
import type { InternalEventPublisher } from './events.js';

const sourceId = createSourceId();
const rootId = createSourceRootId();
const source: Source = {
  id: sourceId,
  name: 'Projects',
  type: 'filesystem',
  containerPaths: ['/projects'],
  roots: [{ id: rootId, sourceId, absolutePath: '/projects' }],
  createdAt: '2026-10-01T12:00:00.000Z',
};
const repositoryCandidate: RepositoryCandidate = {
  path: `${rootId}/repository`,
  repositoryType: 'git',
  fingerprint: 'a'.repeat(64),
  discoveryMethod: 'filesystem',
};
const documentCandidate: DocumentCandidate = {
  path: `${rootId}/repository/README.md`,
  filename: 'README.md',
  extension: '.md',
  sizeBytes: 7,
  modifiedAt: '2026-10-01T12:00:00.000Z',
  fingerprint: 'b'.repeat(64),
  discoveryMethod: 'filesystem',
};
const repository: Repository = {
  ...repositoryCandidate,
  id: createRepositoryId(),
  sourceId,
  discoveredAt: '2026-10-01T12:00:00.000Z',
  lastSeenAt: '2026-10-01T12:00:00.000Z',
};
const document: Document = {
  ...documentCandidate,
  id: createDocumentId(),
  sourceId,
  discoveredAt: '2026-10-01T12:00:00.000Z',
  lastSeenAt: '2026-10-01T12:00:00.000Z',
};
const inventoryEvent: DiscoveryEvent = {
  eventId: 'event-inventory',
  eventType: 'SourceInventorySubmitted',
  eventVersion: 1,
  occurredAt: '2026-10-01T12:00:00.000Z',
  producer: 'workspace-brain-ingestion-worker',
  correlationId: 'correlation-id',
  idempotencyKey: 'inventory-idempotency-key',
  partitionKey: sourceId,
  payload: {
    scan: {
      sourceId,
      discoveredAt: '2026-10-01T12:00:00.000Z',
      repositories: [repositoryCandidate],
      documents: [documentCandidate],
    },
    durationMilliseconds: 15,
  },
};
const processingEvent: DiscoveryEvent = {
  eventId: 'event-processing-submitted',
  eventType: 'DocumentProcessingSubmitted',
  eventVersion: 1,
  occurredAt: '2026-10-01T12:00:01.000Z',
  producer: 'workspace-brain-knowledge-worker',
  correlationId: 'processing-correlation',
  idempotencyKey: 'document-processing-idempotency',
  partitionKey: sourceId,
  payload: {
    candidate: {
      documentId: document.id,
      sourceId,
      path: document.path,
      contentFingerprint: document.fingerprint,
      processedAt: '2026-10-01T12:00:01.000Z',
      durationMilliseconds: 4,
      processorId: 'markdown',
      processorVersion: 1,
      extractionRuleId: 'markdown-blocks',
      extractionRuleVersion: 1,
      evidence: [],
    },
  },
};

const publication = {
  id: createKnowledgePublicationId(),
  knowledgeModelId: createKnowledgeModelId(),
  version: 1,
  schemaVersion: 1 as const,
  status: 'published' as const,
  contentHash: 'c'.repeat(64),
  entityVersionIds: [],
  relationshipVersionIds: [],
  publishedAt: '2026-10-05T08:00:01.000Z',
};
const publishedEvent: Extract<
  DiscoveryEvent,
  { readonly eventType: 'KnowledgeModelPublished' }
> = {
  eventId: 'knowledge-model-published-event',
  eventType: 'KnowledgeModelPublished',
  eventVersion: 1,
  occurredAt: publication.publishedAt,
  producer: 'workspace-brain-api',
  correlationId: 'knowledge-correlation',
  idempotencyKey: `knowledge-model-published:${publication.knowledgeModelId}:1`,
  partitionKey: sourceId,
  payload: { publication },
};

describe('DiscoveryService', () => {
  it('publishes catalogue events from the durable outbox after scan completion', async () => {
    const calls: string[] = [];
    const published: DiscoveryEvent[] = [];
    const service = createDiscoveryService(
      createCatalogue(source, calls),
      createPublisher(published, calls),
    );

    await service.handle(inventoryEvent);

    expect(calls.slice(0, 2)).toEqual(['persist', 'completed']);
    expect(calls).toContain('publish:RepositoryDiscovered');
    expect(calls).toContain('publish:DocumentDiscovered');
    expect(calls).toContain('publish:SourceScanCompleted');
    expect(published.map((event) => event.eventType)).toEqual([
      'RepositoryDiscovered',
      'DocumentDiscovered',
      'SourceScanCompleted',
    ]);
    expect(
      published.every((event) => event.producer === 'workspace-brain-api'),
    ).toBe(true);
    expect(published[0]?.payload).toMatchObject({ repository });
  });

  it('retries pending lifecycle events after a publish failure without losing them', async () => {
    const calls: string[] = [];
    const published: DiscoveryEvent[] = [];
    const catalogue = createCatalogue(source, calls);
    let failNextPublish = true;
    const publisher: InternalEventPublisher = {
      async publish(event) {
        if (failNextPublish) {
          failNextPublish = false;
          throw new Error('temporary event transport failure');
        }
        published.push(event);
      },
    };
    const service = createDiscoveryService(catalogue, publisher);

    await expect(service.handle(inventoryEvent)).rejects.toThrow(
      'temporary event transport failure',
    );
    await service.handle(inventoryEvent);

    expect(published.map(({ eventType }) => eventType)).toEqual([
      'RepositoryDiscovered',
      'DocumentDiscovered',
      'SourceScanCompleted',
    ]);
    expect(new Set(published.map(({ eventId }) => eventId)).size).toBe(3);
  });

  it('reuses the same outbox event when publishing succeeds but delivery marking fails', async () => {
    const calls: string[] = [];
    const published: DiscoveryEvent[] = [];
    const baseCatalogue = createCatalogue(source, calls);
    let failNextMark = true;
    const catalogue = {
      ...baseCatalogue,
      async markDiscoveryEventPublished(eventId: string, publishedAt: string) {
        if (failNextMark) {
          failNextMark = false;
          throw new Error('temporary outbox update failure');
        }
        await baseCatalogue.markDiscoveryEventPublished(eventId, publishedAt);
      },
    };
    const service = createDiscoveryService(catalogue, {
      async publish(event) {
        published.push(event);
      },
    });

    await expect(service.handle(inventoryEvent)).rejects.toThrow(
      'temporary outbox update failure',
    );
    await service.handle(inventoryEvent);

    expect(published[0]?.eventId).toBe(published[1]?.eventId);
    expect(published[0]?.idempotencyKey).toBe(published[1]?.idempotencyKey);
    expect(new Set(published.map(({ eventId }) => eventId)).size).toBe(3);
  });

  it('rejects unnormalized, absolute, and escaping inventory paths before persistence', async () => {
    const calls: string[] = [];
    const service = createDiscoveryService(
      createCatalogue(source, calls),
      createPublisher([], calls),
    );
    const started: DiscoveryEvent = {
      ...inventoryEvent,
      eventId: 'event-started',
      eventType: 'SourceScanStarted',
      payload: { sourceId, startedAt: inventoryEvent.occurredAt },
    };

    await service.handle(started);
    expect(calls).toEqual(['started']);

    for (const path of [
      '../escape.md',
      `${rootId}/../../outside.md`,
      `${rootId}/..\\outside.md`,
      `${rootId}//outside.md`,
      `${rootId}/./outside.md`,
      `/absolute/outside.md`,
      `${rootId}/nested/`,
    ]) {
      const malformed: DiscoveryEvent = {
        ...inventoryEvent,
        payload: {
          ...inventoryEvent.payload,
          scan: {
            ...inventoryEvent.payload.scan,
            documents: [{ ...documentCandidate, path }],
          },
        },
      };
      await expect(service.handle(malformed)).rejects.toThrow(
        'Inventory path is outside registered source roots',
      );
    }
    expect(calls).toEqual(['started']);
  });

  it('records worker scan failures without attempting inventory persistence', async () => {
    const calls: string[] = [];
    const service = createDiscoveryService(
      createCatalogue(source, calls),
      createPublisher([], calls),
    );
    const failed: DiscoveryEvent = {
      ...inventoryEvent,
      eventId: 'event-failed',
      eventType: 'SourceScanFailed',
      payload: {
        sourceId,
        failedAt: inventoryEvent.occurredAt,
        durationMilliseconds: 10,
        failureType: 'FilesystemError',
      },
    };

    await service.handle(failed);
    expect(calls).toEqual(['failed']);
  });

  it('persists submitted evidence before publishing the extracted document fact', async () => {
    const calls: string[] = [];
    const published: DiscoveryEvent[] = [];
    const service = createDiscoveryService(
      createCatalogue(source, calls),
      createPublisher(published, calls),
    );

    await service.handle(processingEvent);

    expect(calls[0]).toBe('processing');
    expect(calls).toContain('publish:DocumentExtracted');
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      eventType: 'DocumentExtracted',
      payload: {
        documentId: document.id,
        contentFingerprint: document.fingerprint,
        evidenceCount: 0,
      },
    });
  });

  it('rejects processing candidates partitioned to another source', async () => {
    const calls: string[] = [];
    const service = createDiscoveryService(
      createCatalogue(source, calls),
      createPublisher([], calls),
    );

    await expect(
      service.handle({ ...processingEvent, partitionKey: createSourceId() }),
    ).rejects.toThrow('source does not match event ownership');
    expect(calls).toEqual([]);
  });

  it('accepts knowledge candidates only from the source that owns the event', async () => {
    const calls: string[] = [];
    const service = createDiscoveryService(
      createCatalogue(source, calls),
      createPublisher([], calls),
    );
    const event: DiscoveryEvent = {
      eventId: 'knowledge-candidate-event',
      eventType: 'KnowledgeCandidatesSubmitted',
      eventVersion: 1,
      occurredAt: '2026-10-05T08:00:00.000Z',
      producer: 'workspace-brain-knowledge-worker',
      correlationId: 'knowledge-correlation',
      idempotencyKey: 'knowledge-candidate-idempotency',
      partitionKey: sourceId,
      payload: { sourceId, entities: [], relationships: [] },
    };

    await service.handle(event);
    expect(calls).toEqual(['knowledge-candidates']);

    await expect(
      service.handle({ ...event, partitionKey: createSourceId() }),
    ).rejects.toThrow('source does not match event ownership');
  });

  it('requests and builds search projections from catalogue-owned publication events', async () => {
    const calls: string[] = [];
    const published: DiscoveryEvent[] = [];
    const service = createDiscoveryService(
      createCatalogue(source, calls),
      createPublisher(published, calls),
    );

    await service.handle(publishedEvent);
    const requested = published.find(
      ({ eventType }) => eventType === 'SearchProjectionRequested',
    );
    if (requested === undefined) {
      throw new Error('Search projection request was not published');
    }
    await service.handle(requested);

    expect(calls).toEqual([
      'search-projection-requested',
      'publish:SearchProjectionRequested',
      `mark:${requested.eventId}`,
      'search-projection-built',
      'publish:SearchProjectionBuilt',
      'mark:event-SearchProjectionBuilt',
    ]);
    expect(published.map(({ eventType }) => eventType)).toEqual([
      'SearchProjectionRequested',
      'SearchProjectionBuilt',
    ]);
  });

  it('rejects projection events that were not produced by the catalogue owner', async () => {
    const calls: string[] = [];
    const service = createDiscoveryService(
      createCatalogue(source, calls),
      createPublisher([], calls),
    );
    const forged = {
      ...publishedEvent,
      producer: 'workspace-brain-knowledge-worker' as const,
    };

    await expect(service.handle(forged)).rejects.toThrow(
      'must be produced by the catalogue owner',
    );
    await expect(
      service.handle({
        ...forged,
        eventType: 'SearchProjectionRequested',
        payload: {
          publicationId: publication.id,
          knowledgeModelId: publication.knowledgeModelId,
          publicationVersion: 1,
          publicationContentHash: publication.contentHash,
        },
      }),
    ).rejects.toThrow('must be produced by the catalogue owner');
    expect(calls).toEqual([]);
  });
});

function createCatalogue(source: Source, calls: string[]) {
  const pending: DiscoveryEvent[] = [];
  return {
    async getSource(id: string) {
      return id === source.id ? source : undefined;
    },
    async persistScan(
      _sourceId: SourceId,
      repositories: readonly RepositoryCandidate[],
      documents: readonly DocumentCandidate[],
    ) {
      calls.push('persist');
      expect(repositories).toEqual([repositoryCandidate]);
      expect(documents).toEqual([documentCandidate]);
      calls.push('completed');
      addPending(
        pending,
        createCatalogueEvent('RepositoryDiscovered', { repository }),
        createCatalogueEvent('DocumentDiscovered', { document }),
        createCatalogueEvent('SourceScanCompleted', {
          sourceId,
          discoveredAt: inventoryEvent.payload.scan.discoveredAt,
          repositoryCount: 1,
          documentCount: 1,
          addedCount: 2,
          modifiedCount: 0,
          removedCount: 0,
          unchangedCount: 0,
          durationMilliseconds: 15,
        }),
      );
      return {
        repositories: [repository],
        documents: [document],
        repositoryChanges: [{ change: 'added' as const, record: repository }],
        documentChanges: [{ change: 'added' as const, record: document }],
      };
    },
    async applyDocumentProcessing(event) {
      calls.push('processing');
      const candidate = event.payload.candidate;
      const documentVersionId = createDocumentVersionId();
      addPending(
        pending,
        createCatalogueEvent('DocumentExtracted', {
          documentId: candidate.documentId,
          documentVersionId,
          contentFingerprint: candidate.contentFingerprint,
          evidenceCount: candidate.evidence.length,
        }),
      );
      return {
        documentVersion: {
          id: documentVersionId,
          documentId: candidate.documentId,
          contentHash: candidate.contentFingerprint,
          hashAlgorithm: 'sha256' as const,
          discoveredAt: candidate.processedAt,
          processorId: candidate.processorId,
          processorVersion: candidate.processorVersion,
          extractionRuleId: candidate.extractionRuleId,
          extractionRuleVersion: candidate.extractionRuleVersion,
          evidenceCount: candidate.evidence.length,
        },
        evidence: [],
        duplicate: false,
      };
    },
    async applyKnowledgeCandidates() {
      calls.push('knowledge-candidates');
    },
    async requestSearchProjection(
      event: Extract<
        DiscoveryEvent,
        { readonly eventType: 'KnowledgeModelPublished' }
      >,
    ) {
      calls.push('search-projection-requested');
      addPending(pending, {
        ...event,
        eventId: 'event-SearchProjectionRequested',
        eventType: 'SearchProjectionRequested',
        idempotencyKey: `search-projection-requested:${event.payload.publication.id}`,
        payload: {
          publicationId: event.payload.publication.id,
          knowledgeModelId: event.payload.publication.knowledgeModelId,
          publicationVersion: event.payload.publication.version,
          publicationContentHash: event.payload.publication.contentHash,
        },
      });
    },
    async buildSearchProjection(
      event: Extract<
        DiscoveryEvent,
        { readonly eventType: 'SearchProjectionRequested' }
      >,
    ) {
      calls.push('search-projection-built');
      const projection = {
        publicationId: event.payload.publicationId,
        modelId: event.payload.knowledgeModelId,
        publicationVersion: event.payload.publicationVersion,
        publicationContentHash: event.payload.publicationContentHash,
        projectionSchemaVersion: 1 as const,
        projectionContentHash: 'd'.repeat(64),
        projectedEntityCount: 0,
        projectedRelationshipCount: 0,
        projectedSearchDocumentCount: 0,
        builtAt: event.occurredAt,
      };
      addPending(pending, {
        ...event,
        eventId: 'event-SearchProjectionBuilt',
        eventType: 'SearchProjectionBuilt',
        idempotencyKey: `search-projection-built:${event.payload.publicationId}`,
        payload: { projection },
      });
      return projection;
    },
    async recordScanStarted() {
      calls.push('started');
    },
    async listPendingDiscoveryEvents() {
      return [...pending];
    },
    async markDiscoveryEventPublished(eventId: string) {
      calls.push(`mark:${eventId}`);
      const index = pending.findIndex((event) => event.eventId === eventId);
      if (index >= 0) {
        pending.splice(index, 1);
      }
    },
    async recordScanFailed() {
      calls.push('failed');
    },
  };
}

function createCatalogueEvent(
  eventType:
    | 'RepositoryDiscovered'
    | 'DocumentDiscovered'
    | 'SourceScanCompleted'
    | 'DocumentExtracted',
  payload: Extract<DiscoveryEvent, { eventType: typeof eventType }>['payload'],
): DiscoveryEvent {
  const stableKey =
    eventType === 'RepositoryDiscovered'
      ? repository.id
      : eventType === 'DocumentDiscovered'
        ? document.id
        : eventType === 'DocumentExtracted'
          ? document.id
          : sourceId;
  return {
    eventId: `event-${eventType}-${stableKey}`,
    eventType,
    eventVersion: 1,
    occurredAt: inventoryEvent.occurredAt,
    producer: 'workspace-brain-api',
    correlationId: inventoryEvent.correlationId,
    idempotencyKey: `${eventType}:${stableKey}:${inventoryEvent.correlationId}`,
    partitionKey: sourceId,
    payload,
  } as DiscoveryEvent;
}

function addPending(
  pending: DiscoveryEvent[],
  ...events: DiscoveryEvent[]
): void {
  for (const event of events) {
    if (
      !pending.some(
        ({ idempotencyKey }) => idempotencyKey === event.idempotencyKey,
      )
    ) {
      pending.push(event);
    }
  }
}

function createPublisher(
  published: DiscoveryEvent[],
  calls: string[],
): InternalEventPublisher {
  return {
    async publish(event) {
      calls.push(`publish:${event.eventType}`);
      published.push(event);
    },
  };
}
