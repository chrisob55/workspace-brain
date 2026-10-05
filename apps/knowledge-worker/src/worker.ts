import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  parseDocumentId,
  parseSourceId,
  type DiscoveryEvent,
  type Document,
} from '@workspace-brain/domain';
import type { NatsDiscoveryBus } from '@workspace-brain/nats';
import { processDocument } from '@workspace-brain/processing-core';
import type { Logger } from 'pino';
import { z } from 'zod';

const chunkBytes = 256 * 1024;
const maximumSubmissionBytes = 900_000;
const supportedExtensions = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.yaml',
  '.yml',
  '.json',
]);
const documentSchema = z
  .object({
    id: z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    sourceId: z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    path: z.string().min(1).max(4096),
    filename: z.string().min(1).max(255),
    extension: z.string(),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(50 * 1024 * 1024),
    modifiedAt: z.string().datetime(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    discoveredAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    discoveryMethod: z.literal('filesystem'),
  })
  .strict();
const documentChunkSchema = z
  .object({
    contentBase64: z.string().max(350_000),
    sizeBytes: z.number().int().nonnegative(),
    done: z.boolean(),
  })
  .strict();

type WorkerLogger = Pick<Logger, 'error' | 'info'>;

export type KnowledgeWorker = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createKnowledgeWorker(
  bus: NatsDiscoveryBus,
  logger: WorkerLogger,
): KnowledgeWorker {
  return {
    async start() {
      await bus.subscribe(
        'workspace.discovery.document.discovered',
        'workspace-knowledge-document-discovered',
        (event) => processDiscoveryEvent(event, bus, logger),
      );
      await bus.subscribe(
        'workspace.discovery.document.modified',
        'workspace-knowledge-document-modified',
        (event) => processDiscoveryEvent(event, bus, logger),
      );
    },
    stop: () => bus.close(),
  };
}

async function processDiscoveryEvent(
  event: DiscoveryEvent,
  bus: NatsDiscoveryBus,
  logger: WorkerLogger,
): Promise<void> {
  if (
    event.eventType !== 'DocumentDiscovered' &&
    event.eventType !== 'DocumentModified'
  ) {
    return;
  }
  const parsedDocument = documentSchema.parse(event.payload.document);
  const document: Document = {
    ...parsedDocument,
    id: parseDocumentId(parsedDocument.id),
    sourceId: parseSourceId(parsedDocument.sourceId),
  };
  if (!supportedExtensions.has(document.extension.toLocaleLowerCase('en-US'))) {
    return;
  }

  const started = performance.now();
  const content = await readDocument(bus, document);
  const fingerprint = createHash('sha256').update(content).digest('hex');
  if (fingerprint !== document.fingerprint) {
    throw new Error('Document changed after discovery');
  }
  const processed = processDocument(
    document.filename,
    content.toString('utf8'),
  );
  const processedAt = new Date().toISOString();
  const pipelineKey = [
    processed.processorId,
    processed.processorVersion,
    processed.extractionRuleId,
    processed.extractionRuleVersion,
  ].join(':');
  const submission: DiscoveryEvent = {
    eventId: randomUUID(),
    eventType: 'DocumentProcessingSubmitted',
    eventVersion: 1,
    occurredAt: processedAt,
    producer: 'workspace-brain-knowledge-worker',
    correlationId: event.correlationId,
    idempotencyKey: `document-processing:${document.id}:${fingerprint}:${pipelineKey}`,
    partitionKey: document.sourceId,
    payload: {
      candidate: {
        documentId: document.id,
        sourceId: document.sourceId,
        path: document.path,
        contentFingerprint: fingerprint,
        processedAt,
        durationMilliseconds: performance.now() - started,
        processorId: processed.processorId,
        processorVersion: processed.processorVersion,
        extractionRuleId: processed.extractionRuleId,
        extractionRuleVersion: processed.extractionRuleVersion,
        evidence: processed.evidence,
      },
    },
  };
  if (
    Buffer.byteLength(JSON.stringify(submission), 'utf8') >
    maximumSubmissionBytes
  ) {
    throw new Error(
      'Document evidence candidate exceeds the supported event size',
    );
  }
  await bus.publish(submission);
  logger.info(
    {
      correlationId: event.correlationId,
      documentId: document.id,
      sourceId: document.sourceId,
      evidenceCount: processed.evidence.length,
    },
    'document evidence submitted',
  );
}

async function readDocument(
  bus: NatsDiscoveryBus,
  document: Document,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let offset = 0;
  let expectedSize: number | undefined;
  while (true) {
    const response = await bus.request<unknown>(
      'workspace.ingestion.document.read',
      {
        sourceId: document.sourceId,
        path: document.path,
        offset,
        requestedBytes: chunkBytes,
      },
    );
    const parsed = documentChunkSchema.safeParse(response);
    if (!parsed.success) {
      const failureType =
        typeof response === 'object' &&
        response !== null &&
        'failureType' in response &&
        typeof response.failureType === 'string'
          ? response.failureType
          : 'InvalidDocumentContentResponse';
      throw new Error(`Document content request failed: ${failureType}`);
    }
    const chunk = Buffer.from(parsed.data.contentBase64, 'base64');
    if (
      chunk.toString('base64') !== parsed.data.contentBase64 ||
      chunk.length > chunkBytes ||
      (expectedSize !== undefined && parsed.data.sizeBytes !== expectedSize)
    ) {
      throw new Error('Ingestion worker returned an invalid document chunk');
    }
    const actualSize = parsed.data.sizeBytes;
    expectedSize = actualSize;
    chunks.push(chunk);
    offset += chunk.length;
    if (offset > document.sizeBytes || offset > actualSize) {
      throw new Error('Ingestion worker returned excess document content');
    }
    if (parsed.data.done) {
      break;
    }
    if (chunk.length === 0) {
      throw new Error('Ingestion worker returned an empty non-final chunk');
    }
  }
  if (offset !== document.sizeBytes || expectedSize !== document.sizeBytes) {
    throw new Error('Document size changed after discovery');
  }
  const content = Buffer.concat(chunks);
  if (!Buffer.from(content.toString('utf8'), 'utf8').equals(content)) {
    throw new Error('Document is not valid UTF-8 text');
  }
  return content;
}
