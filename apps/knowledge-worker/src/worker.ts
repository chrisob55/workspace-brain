import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  discoveryEventSubject,
  parseDocumentVersionId,
  parseDocumentId,
  parseEvidenceId,
  parseSourceId,
  type DiscoveryEvent,
  type Document,
  type KnowledgeInputEvidence,
} from '@workspace-brain/domain';
import type { NatsDiscoveryBus } from '@workspace-brain/nats';
import {
  documentProcessors,
  processDocument,
} from '@workspace-brain/processing-core';
import type { Logger } from 'pino';
import { z } from 'zod';

import { extractKnowledgeReport } from './knowledge-extractors.js';

const chunkBytes = 256 * 1024;
const maximumSubmissionBytes = 900_000;
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
const locatorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.enum(['markdown-lines', 'text-lines', 'yaml-lines']),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
      headingPath: z.array(z.string()).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('json-pointer'), pointer: z.string() }).strict(),
]);
const knowledgeInputEvidenceSchema = z
  .object({
    evidence: z
      .object({
        id: z.string(),
        documentVersionId: z.string(),
        key: z.string(),
        kind: z.enum([
          'heading',
          'paragraph',
          'list-item',
          'table-row',
          'code-block',
          'structured-value',
        ]),
        excerpt: z.string(),
        truncated: z.boolean(),
        locator: locatorSchema,
      })
      .strict(),
    documentVersion: z
      .object({
        id: z.string(),
        documentId: z.string(),
        contentHash: z.string(),
        hashAlgorithm: z.literal('sha256'),
        discoveredAt: z.string().datetime(),
        processorId: z.string(),
        processorVersion: z.number().int().positive(),
        extractionRuleId: z.string(),
        extractionRuleVersion: z.number().int().positive(),
        evidenceCount: z.number().int().nonnegative(),
      })
      .strict(),
    document: z
      .object({
        id: z.string(),
        sourceId: z.string(),
        path: z.string(),
        filename: z.string(),
        fingerprint: z.string(),
      })
      .strict(),
    provenance: z
      .object({
        documentPath: z.string(),
        contentFingerprint: z.string(),
        processorId: z.string(),
        processorVersion: z.number().int().positive(),
        extractionRuleId: z.string(),
        extractionRuleVersion: z.number().int().positive(),
      })
      .strict(),
    extractionContext: z
      .object({
        repositories: z.array(
          z
            .object({
              id: z.string(),
              path: z.string(),
              fingerprint: z.string(),
              name: z.string().optional(),
            })
            .strict(),
        ),
        documents: z.array(
          z
            .object({
              id: z.string(),
              path: z.string(),
              filename: z.string(),
              fingerprint: z.string(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();
const knowledgeInputEvidencePageSchema = z
  .object({
    items: z.array(knowledgeInputEvidenceSchema),
    nextOffset: z.number().int().nonnegative().nullable(),
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
        discoveryEventSubject('DocumentDiscovered'),
        'workspace-knowledge-document-discovered',
        (event) => processDiscoveryEvent(event, bus, logger),
      );
      await bus.subscribe(
        discoveryEventSubject('DocumentModified'),
        'workspace-knowledge-document-modified',
        (event) => processDiscoveryEvent(event, bus, logger),
      );
      await bus.subscribe(
        discoveryEventSubject('DocumentExtracted'),
        'workspace-knowledge-document-extracted',
        (event) => processKnowledgeEvent(event, bus, logger),
      );
    },
    stop: () => bus.close(),
  };
}

async function processKnowledgeEvent(
  event: DiscoveryEvent,
  bus: NatsDiscoveryBus,
  logger: WorkerLogger,
): Promise<void> {
  if (event.eventType !== 'DocumentExtracted') {
    return;
  }
  const documentVersionId = parseDocumentVersionId(
    event.payload.documentVersionId,
  );
  const parsedInputs: z.infer<typeof knowledgeInputEvidenceSchema>[] = [];
  let offset = 0;
  while (true) {
    const rawPage = await bus.request<unknown>(
      'workspace.catalogue.knowledge.document-evidence',
      { documentVersionId, offset },
    );
    const page = knowledgeInputEvidencePageSchema.parse(rawPage);
    if (
      page.nextOffset !== null &&
      (page.items.length === 0 ||
        page.nextOffset !== offset + page.items.length)
    ) {
      throw new Error('Knowledge evidence page returned an invalid offset');
    }
    parsedInputs.push(...page.items);
    if (page.nextOffset === null) {
      break;
    }
    offset = page.nextOffset;
  }
  const inputs: KnowledgeInputEvidence[] = parsedInputs.map((input) => ({
    evidence: {
      ...input.evidence,
      id: parseEvidenceId(input.evidence.id),
      documentVersionId: parseDocumentVersionId(
        input.evidence.documentVersionId,
      ),
      locator:
        input.evidence.locator.kind === 'json-pointer'
          ? input.evidence.locator
          : input.evidence.locator.headingPath === undefined
            ? {
                kind: input.evidence.locator.kind,
                lineStart: input.evidence.locator.lineStart,
                lineEnd: input.evidence.locator.lineEnd,
              }
            : {
                kind: input.evidence.locator.kind,
                lineStart: input.evidence.locator.lineStart,
                lineEnd: input.evidence.locator.lineEnd,
                headingPath: input.evidence.locator.headingPath,
              },
    },
    documentVersion: {
      ...input.documentVersion,
      id: parseDocumentVersionId(input.documentVersion.id),
      documentId: parseDocumentId(input.documentVersion.documentId),
    },
    document: {
      ...input.document,
      id: parseDocumentId(input.document.id),
      sourceId: parseSourceId(input.document.sourceId),
    },
    provenance: input.provenance,
    ...(input.extractionContext === undefined
      ? {}
      : {
          extractionContext: {
            ...input.extractionContext,
            repositories: input.extractionContext.repositories.map(
              ({ name, ...repository }) => ({
                ...repository,
                ...(name === undefined ? {} : { name }),
              }),
            ),
          },
        }),
  }));
  if (inputs.some((input) => input.documentVersion.id !== documentVersionId)) {
    throw new Error(
      'Knowledge evidence response does not match the requested version',
    );
  }
  const extraction = extractKnowledgeReport(inputs);
  const candidates = extraction.candidates;
  const occurredAt = new Date().toISOString();
  const sourceId = parseSourceId(event.partitionKey);
  const candidatePayload = {
    sourceId,
    documentId: parseDocumentId(event.payload.documentId),
    documentVersionId,
    ...candidates,
  };
  const candidateHash = createHash('sha256')
    .update(JSON.stringify(candidatePayload))
    .digest('hex');
  const submission: DiscoveryEvent = {
    eventId: randomUUID(),
    eventType: 'KnowledgeCandidatesSubmitted',
    eventVersion: 1,
    occurredAt,
    producer: 'workspace-brain-knowledge-worker',
    correlationId: event.correlationId,
    idempotencyKey: `knowledge-candidates:${documentVersionId}:${candidateHash}`,
    partitionKey: sourceId,
    payload: candidatePayload,
  };
  if (
    Buffer.byteLength(JSON.stringify(submission), 'utf8') >
    maximumSubmissionBytes
  ) {
    throw new Error('Knowledge candidates exceed the supported event size');
  }
  await bus.publish(submission);
  logger.info(
    {
      correlationId: event.correlationId,
      documentId: event.payload.documentId,
      documentVersionId,
      entityCount: candidates.entities.length,
      relationshipCount: candidates.relationships.length,
      extractorContributions: extraction.contributions,
      diagnostics: extraction.diagnostics,
    },
    'knowledge candidates submitted',
  );
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
  await submitDocumentProcessing(
    event.payload.document,
    bus,
    logger,
    event.correlationId,
  );
}

export async function submitDocumentProcessing(
  inventoryDocument: unknown,
  bus: NatsDiscoveryBus,
  logger: WorkerLogger,
  correlationId: string,
): Promise<'submitted' | 'unsupported'> {
  const parsedDocument = documentSchema.parse(inventoryDocument);
  const document: Document = {
    ...parsedDocument,
    id: parseDocumentId(parsedDocument.id),
    sourceId: parseSourceId(parsedDocument.sourceId),
  };
  if (
    !documentProcessors.some((processor) =>
      processor.supports(document.filename),
    )
  ) {
    logger.info(
      { documentId: document.id, documentPath: document.path },
      'document processing unsupported',
    );
    return 'unsupported';
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
    correlationId,
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
      correlationId,
      documentId: document.id,
      sourceId: document.sourceId,
      documentPath: document.path,
      evidenceCount: processed.evidence.length,
    },
    'document evidence submitted',
  );
  return 'submitted';
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
