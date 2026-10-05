import { createHash } from 'node:crypto';

import {
  createKnowledgeEntityKey,
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createSourceId,
  type DiscoveryEvent,
} from '@workspace-brain/domain';
import type {
  DiscoveryEventHandler,
  NatsDiscoveryBus,
} from '@workspace-brain/nats';
import { describe, expect, it } from 'vitest';

import { createKnowledgeWorker } from './worker.js';

describe('knowledge worker', () => {
  it('reads source content through bounded requests and submits evidence candidates', async () => {
    const documentId = createDocumentId();
    const sourceId = createSourceId();
    const contents = Buffer.from('# Overview\n\nRead-only evidence.');
    const fingerprint = createHash('sha256').update(contents).digest('hex');
    const handlers = new Map<string, DiscoveryEventHandler>();
    const published: DiscoveryEvent[] = [];
    const requests: number[] = [];
    const bus: NatsDiscoveryBus = {
      async publish(event) {
        published.push(event);
      },
      async subscribe(subject, _durableName, handler) {
        handlers.set(subject, handler);
      },
      subscribeRequests() {},
      async request<T>(_subject: string, rawRequest: unknown): Promise<T> {
        const request = rawRequest as {
          offset: number;
          requestedBytes: number;
        };
        requests.push(request.offset);
        const bytes = contents.subarray(
          request.offset,
          request.offset + request.requestedBytes,
        );
        return {
          contentBase64: bytes.toString('base64'),
          sizeBytes: contents.length,
          done: request.offset + bytes.length >= contents.length,
        } as T;
      },
      async close() {},
    };
    const worker = createKnowledgeWorker(bus, {
      error() {},
      info() {},
    });
    await worker.start();
    const documentEvent: DiscoveryEvent = {
      eventId: 'discovery-event-1',
      eventType: 'DocumentDiscovered',
      eventVersion: 1,
      occurredAt: '2026-10-02T10:00:00.000Z',
      producer: 'workspace-brain-api',
      correlationId: 'correlation-1',
      idempotencyKey: 'discovery:doc-1',
      partitionKey: sourceId,
      payload: {
        document: {
          id: documentId,
          sourceId,
          path: '01K6JQ3Z5JY0N0WZ3MEGFS9WH0/project/README.md',
          filename: 'README.md',
          extension: '.md',
          sizeBytes: contents.length,
          modifiedAt: '2026-10-02T10:00:00.000Z',
          fingerprint,
          discoveredAt: '2026-10-02T10:00:00.000Z',
          lastSeenAt: '2026-10-02T10:00:00.000Z',
          discoveryMethod: 'filesystem',
        },
      },
    };

    const handler = handlers.get('workspace.discovery.document.discovered');
    if (handler === undefined) {
      throw new Error('Document discovery handler was not registered');
    }
    await handler(documentEvent);

    expect(requests).toEqual([0]);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      eventType: 'DocumentProcessingSubmitted',
      producer: 'workspace-brain-knowledge-worker',
      correlationId: 'correlation-1',
      payload: {
        candidate: {
          documentId,
          sourceId,
          contentFingerprint: fingerprint,
          processorId: 'markdown',
          evidence: expect.arrayContaining([
            expect.objectContaining({
              excerpt: 'Overview',
              locator: {
                kind: 'markdown-lines',
                lineStart: 1,
                lineEnd: 1,
              },
            }),
          ]),
        },
      },
    });
    expect(JSON.stringify(published[0])).not.toContain(contents.toString());
    await worker.stop();
  });

  it('does not submit content if it changed after inventory discovery', async () => {
    const documentId = createDocumentId();
    const sourceId = createSourceId();
    const handlers = new Map<string, DiscoveryEventHandler>();
    const contents = Buffer.from('changed');
    const bus: NatsDiscoveryBus = {
      async publish() {
        throw new Error('Changed documents must not be submitted');
      },
      async subscribe(subject, _durableName, handler) {
        handlers.set(subject, handler);
      },
      subscribeRequests() {},
      async request<T>() {
        return {
          contentBase64: contents.toString('base64'),
          sizeBytes: contents.length,
          done: true,
        } as T;
      },
      async close() {},
    };
    const worker = createKnowledgeWorker(bus, {
      error() {},
      info() {},
    });
    await worker.start();
    const event: DiscoveryEvent = {
      eventId: 'discovery-event-2',
      eventType: 'DocumentModified',
      eventVersion: 1,
      occurredAt: '2026-10-02T10:00:00.000Z',
      producer: 'workspace-brain-api',
      correlationId: 'correlation-2',
      idempotencyKey: 'discovery:doc-2',
      partitionKey: sourceId,
      payload: {
        document: {
          id: documentId,
          sourceId,
          path: 'root/notes.txt',
          filename: 'notes.txt',
          extension: '.txt',
          sizeBytes: contents.length,
          modifiedAt: '2026-10-02T10:00:00.000Z',
          fingerprint: '0'.repeat(64),
          discoveredAt: '2026-10-02T10:00:00.000Z',
          lastSeenAt: '2026-10-02T10:00:00.000Z',
          discoveryMethod: 'filesystem',
        },
      },
    };
    const handler = handlers.get('workspace.discovery.document.modified');
    if (handler === undefined) {
      throw new Error('Document modification handler was not registered');
    }

    await expect(handler(event)).rejects.toThrow(
      'Document changed after discovery',
    );
    await worker.stop();
  });

  it('turns extracted package evidence into source-linked knowledge candidates', async () => {
    const documentId = createDocumentId();
    const documentVersionId = createDocumentVersionId();
    const evidenceId = createEvidenceId();
    const sourceId = createSourceId();
    const fingerprint = 'a'.repeat(64);
    const handlers = new Map<string, DiscoveryEventHandler>();
    const published: DiscoveryEvent[] = [];
    let requestedVersionId = '';
    const bus: NatsDiscoveryBus = {
      async publish(event) {
        published.push(event);
      },
      async subscribe(subject, _durableName, handler) {
        handlers.set(subject, handler);
      },
      subscribeRequests() {},
      async request<T>(subject: string, request: unknown): Promise<T> {
        if (subject !== 'workspace.catalogue.knowledge.document-evidence') {
          throw new Error(`Unexpected catalogue request: ${subject}`);
        }
        requestedVersionId = (request as { documentVersionId: string })
          .documentVersionId;
        return [
          {
            evidence: {
              id: evidenceId,
              documentVersionId,
              key: 'json:/name',
              kind: 'structured-value',
              excerpt: '@workspace/service',
              truncated: false,
              locator: { kind: 'json-pointer', pointer: '/name' },
            },
            documentVersion: {
              id: documentVersionId,
              documentId,
              contentHash: fingerprint,
              hashAlgorithm: 'sha256',
              discoveredAt: '2026-10-05T08:00:00.000Z',
              processorId: 'json',
              processorVersion: 1,
              extractionRuleId: 'json-scalar-values',
              extractionRuleVersion: 1,
              evidenceCount: 1,
            },
            document: {
              id: documentId,
              sourceId,
              path: 'root/service/package.json',
              filename: 'package.json',
              fingerprint,
            },
            provenance: {
              documentPath: 'root/service/package.json',
              contentFingerprint: fingerprint,
              processorId: 'json',
              processorVersion: 1,
              extractionRuleId: 'json-scalar-values',
              extractionRuleVersion: 1,
            },
          },
        ] as T;
      },
      async close() {},
    };
    const worker = createKnowledgeWorker(bus, {
      error() {},
      info() {},
    });
    await worker.start();
    const event: DiscoveryEvent = {
      eventId: 'document-extracted-event',
      eventType: 'DocumentExtracted',
      eventVersion: 1,
      occurredAt: '2026-10-05T08:00:00.000Z',
      producer: 'workspace-brain-api',
      correlationId: 'knowledge-correlation',
      idempotencyKey: 'document-extracted-idempotency',
      partitionKey: sourceId,
      payload: {
        documentId,
        documentVersionId,
        contentFingerprint: fingerprint,
        evidenceCount: 1,
      },
    };
    const handler = handlers.get('workspace.processing.document.extracted');
    if (handler === undefined) {
      throw new Error('Document-extracted handler was not registered');
    }
    await handler(event);

    expect(requestedVersionId).toBe(documentVersionId);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      eventType: 'KnowledgeCandidatesSubmitted',
      producer: 'workspace-brain-knowledge-worker',
      partitionKey: sourceId,
      payload: {
        sourceId,
        documentId,
        documentVersionId,
        entities: [
          {
            key: createKnowledgeEntityKey(
              'package',
              sourceId,
              'root/service/package.json',
              '@workspace/service',
            ),
            type: 'package',
            identityScope: 'root/service/package.json',
            name: '@workspace/service',
            sourceEvidenceIds: [evidenceId],
            provenance: [
              {
                evidenceId,
                documentVersionId,
                knowledgeExtractorId: 'deterministic-knowledge-extractors',
              },
            ],
          },
        ],
        relationships: [],
      },
    });
    await worker.stop();
  });
});
