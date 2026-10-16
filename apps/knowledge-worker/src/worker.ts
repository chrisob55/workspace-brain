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
  type EvidenceLocator,
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
  z
    .object({
      kind: z.literal('scala-symbol'),
      packageName: z.string().max(512),
      symbolKind: z.enum([
        'package',
        'import',
        'class',
        'object',
        'trait',
        'method',
        'value',
        'constructor-parameter',
      ]),
      symbolName: z.string().max(1024),
      enclosingSymbol: z.string().max(1024).optional(),
      signature: z.string().max(2000).optional(),
      extendsType: z.string().max(1024).optional(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('scala-call-site'),
      packageName: z.string().max(512),
      enclosingSymbol: z.string().max(1024),
      targetText: z.string().max(1024),
      methodName: z.string().max(256),
      receiver: z.string().max(512).optional(),
      branchContext: z.string().max(64).optional(),
      asyncGroup: z.string().max(64).optional(),
      callIndex: z.number().int().positive(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('play-route'),
      routeSet: z.string().max(64),
      method: z.string().max(16).optional(),
      declaredPath: z.string().max(4096).optional(),
      handlerExpression: z.string().max(2048).optional(),
      mountPrefix: z.string().max(4096).optional(),
      includeTarget: z.string().max(1024).optional(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('hocon-key'),
      key: z.string().min(1).max(1024),
      valueKind: z.enum([
        'substitution',
        'string',
        'boolean',
        'number',
        'unquoted',
        'unsupported',
        'redacted',
      ]),
      literalValue: z.string().max(2000).optional(),
      substitutions: z.array(z.string().max(1024)).max(50).optional(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
    })
    .strict(),
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
    hasExtractionContext: z.boolean().optional(),
  })
  .strict();
const extractionContextSchema =
  knowledgeInputEvidenceSchema.shape.extractionContext.unwrap();
const extractionContextPageSchema = z
  .object({
    items: z.array(
      z.union([
        z
          .object({
            repository: extractionContextSchema.shape.repositories.element,
          })
          .strict(),
        z
          .object({
            document: extractionContextSchema.shape.documents.element,
          })
          .strict(),
      ]),
    ),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();

type WorkerLogger = Pick<Logger, 'error' | 'info'>;

function evidenceLocator(
  locator: z.infer<typeof locatorSchema>,
): EvidenceLocator {
  if (locator.kind === 'markdown-lines') {
    return locator.headingPath === undefined
      ? {
          kind: 'markdown-lines',
          lineStart: locator.lineStart,
          lineEnd: locator.lineEnd,
        }
      : {
          kind: 'markdown-lines',
          lineStart: locator.lineStart,
          lineEnd: locator.lineEnd,
          headingPath: locator.headingPath,
        };
  }
  if (locator.kind === 'text-lines') {
    return locator.headingPath === undefined
      ? {
          kind: 'text-lines',
          lineStart: locator.lineStart,
          lineEnd: locator.lineEnd,
        }
      : {
          kind: 'text-lines',
          lineStart: locator.lineStart,
          lineEnd: locator.lineEnd,
          headingPath: locator.headingPath,
        };
  }
  if (locator.kind === 'yaml-lines') {
    return locator.headingPath === undefined
      ? {
          kind: 'yaml-lines',
          lineStart: locator.lineStart,
          lineEnd: locator.lineEnd,
        }
      : {
          kind: 'yaml-lines',
          lineStart: locator.lineStart,
          lineEnd: locator.lineEnd,
          headingPath: locator.headingPath,
        };
  }
  if ('pointer' in locator) {
    return { kind: 'json-pointer', pointer: locator.pointer };
  }
  if ('symbolKind' in locator) {
    return {
      kind: 'scala-symbol',
      packageName: locator.packageName,
      symbolKind: locator.symbolKind,
      symbolName: locator.symbolName,
      ...(locator.enclosingSymbol === undefined
        ? {}
        : { enclosingSymbol: locator.enclosingSymbol }),
      ...(locator.signature === undefined
        ? {}
        : { signature: locator.signature }),
      ...(locator.extendsType === undefined
        ? {}
        : { extendsType: locator.extendsType }),
      lineStart: locator.lineStart,
      lineEnd: locator.lineEnd,
    };
  }
  if ('targetText' in locator) {
    return {
      kind: 'scala-call-site',
      packageName: locator.packageName,
      enclosingSymbol: locator.enclosingSymbol,
      targetText: locator.targetText,
      methodName: locator.methodName,
      ...(locator.receiver === undefined ? {} : { receiver: locator.receiver }),
      ...(locator.branchContext === undefined
        ? {}
        : { branchContext: locator.branchContext }),
      ...(locator.asyncGroup === undefined
        ? {}
        : { asyncGroup: locator.asyncGroup }),
      callIndex: locator.callIndex,
      lineStart: locator.lineStart,
      lineEnd: locator.lineEnd,
    };
  }
  if ('routeSet' in locator) {
    return {
      kind: 'play-route',
      routeSet: locator.routeSet,
      ...(locator.method === undefined ? {} : { method: locator.method }),
      ...(locator.declaredPath === undefined
        ? {}
        : { declaredPath: locator.declaredPath }),
      ...(locator.handlerExpression === undefined
        ? {}
        : { handlerExpression: locator.handlerExpression }),
      ...(locator.mountPrefix === undefined
        ? {}
        : { mountPrefix: locator.mountPrefix }),
      ...(locator.includeTarget === undefined
        ? {}
        : { includeTarget: locator.includeTarget }),
      lineStart: locator.lineStart,
      lineEnd: locator.lineEnd,
    };
  }
  if ('valueKind' in locator) {
    return {
      kind: 'hocon-key',
      key: locator.key,
      valueKind: locator.valueKind,
      ...(locator.literalValue === undefined
        ? {}
        : { literalValue: locator.literalValue }),
      ...(locator.substitutions === undefined
        ? {}
        : { substitutions: locator.substitutions }),
      lineStart: locator.lineStart,
      lineEnd: locator.lineEnd,
    };
  }
  throw new Error('Unsupported evidence locator');
}

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
  let hasExtractionContext = false;
  let offset = 0;
  while (true) {
    const rawPage = await bus.request<unknown>(
      'workspace.catalogue.knowledge.document-evidence',
      { documentVersionId, offset, separateContext: true },
      { timeoutMs: 60_000 },
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
    hasExtractionContext ||= page.hasExtractionContext === true;
    if (page.nextOffset === null) {
      break;
    }
    offset = page.nextOffset;
  }
  if (hasExtractionContext) {
    const context: z.infer<typeof extractionContextSchema> = {
      repositories: [],
      documents: [],
    };
    offset = 0;
    while (true) {
      const page = extractionContextPageSchema.parse(
        await bus.request<unknown>(
          'workspace.catalogue.knowledge.document-evidence',
          { documentVersionId, offset, contextOnly: true },
          { timeoutMs: 60_000 },
        ),
      );
      if (
        page.nextOffset !== null &&
        (page.items.length === 0 ||
          page.nextOffset !== offset + page.items.length)
      ) {
        throw new Error('Extraction context page returned an invalid offset');
      }
      for (const item of page.items) {
        if ('repository' in item) {
          context.repositories.push(item.repository);
        } else {
          context.documents.push(item.document);
        }
      }
      if (page.nextOffset === null) {
        break;
      }
      offset = page.nextOffset;
    }
    const first = parsedInputs[0];
    if (first === undefined) {
      throw new Error('Extraction context returned without evidence');
    }
    first.extractionContext = context;
  }
  const inputs: KnowledgeInputEvidence[] = parsedInputs.map((input) => ({
    evidence: {
      ...input.evidence,
      id: parseEvidenceId(input.evidence.id),
      documentVersionId: parseDocumentVersionId(
        input.evidence.documentVersionId,
      ),
      locator: evidenceLocator(input.evidence.locator),
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
    document.path.split('/').slice(1).join('/') || document.filename,
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
