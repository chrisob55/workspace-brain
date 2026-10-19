import { randomUUID } from 'node:crypto';

import type {
  CatalogueHealth,
  CatalogueReader,
  PublicationExportReader,
  PublicationCurrencyReader,
  PublicationDiffStore,
  PublicationSnapshotReader,
  SearchProjectionReader,
} from '@workspace-brain/catalogue';
import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import {
  classifyPublicationCurrency,
  compareCurrencySortKey,
  currencyObjectTypes,
  currencyStates,
  PublicationCurrencyLineageError,
  type PublicationCurrency,
} from '@workspace-brain/domain-currency';
import {
  createPublicationDiffService,
  PublicationDiffScopeError,
} from '@workspace-brain/publication-diff-service';
import {
  KnowledgePublicationPackageIntegrityError,
  serializeKnowledgePublicationPackage,
} from '@workspace-brain/domain-publication';
import {
  knowledgeRelationshipTypes,
  knowledgeEntityTypes,
  searchMatchModes,
  type KnowledgeObjectProvenance,
  type RuntimeStatusResponse,
} from '@workspace-brain/domain';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import pino from 'pino';
import { z } from 'zod';

import { RuntimeRegistryService } from './runtime-registry.js';

const pageQuerySchema = z
  .object({
    cursor: z.string().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const sourceIdSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const documentIdSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const evidenceIdSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const repositoryQuerySchema = pageQuerySchema
  .extend({ sourceId: sourceIdSchema.optional() })
  .strict();
const documentQuerySchema = repositoryQuerySchema
  .extend({
    extension: z
      .string()
      .regex(/^\.[a-zA-Z0-9]+$/)
      .optional(),
  })
  .strict();
const knowledgeModelQuerySchema = pageQuerySchema.strict();
const knowledgeEntityQuerySchema = pageQuerySchema
  .extend({
    knowledgeModelId: sourceIdSchema.optional(),
    publicationId: sourceIdSchema.optional(),
    lifecycleStatus: z
      .enum(['observed', 'verified', 'established', 'rejected', 'superseded'])
      .optional(),
    type: z.enum(knowledgeEntityTypes).optional(),
  })
  .strict();
const knowledgeRelationshipQuerySchema = pageQuerySchema
  .extend({
    knowledgeModelId: sourceIdSchema.optional(),
    publicationId: sourceIdSchema.optional(),
    lifecycleStatus: z
      .enum([
        'observed',
        'related',
        'verified',
        'established',
        'rejected',
        'superseded',
      ])
      .optional(),
    type: z.enum(knowledgeRelationshipTypes).optional(),
  })
  .strict();
const knowledgePublicationQuerySchema = pageQuerySchema
  .extend({ knowledgeModelId: sourceIdSchema.optional() })
  .strict();
const scopedPageQuerySchema = pageQuerySchema.extend({
  cursor: z.string().min(1).max(2048).optional(),
});
const publicationRelationshipQuerySchema = scopedPageQuerySchema
  .extend({
    direction: z.enum(['incoming', 'outgoing', 'both']).default('both'),
    relationshipType: z.enum(knowledgeRelationshipTypes).optional(),
  })
  .strict();
const provenancePageQuerySchema = scopedPageQuerySchema.strict();
const relationshipCursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('published-relationships'),
    publicationId: sourceIdSchema,
    entityId: sourceIdSchema,
    direction: z.enum(['incoming', 'outgoing', 'both']),
    relationshipType: z.enum(knowledgeRelationshipTypes).optional(),
    afterId: sourceIdSchema,
  })
  .strict();
const publicationChangesCursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('publication-comparisons'),
    publicationId: sourceIdSchema,
    afterId: sourceIdSchema,
  })
  .strict();
const provenanceCursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('published-provenance'),
    publicationId: sourceIdSchema,
    objectType: z.enum(['entity', 'relationship']),
    objectId: sourceIdSchema,
    knowledgeVersionId: sourceIdSchema,
    afterId: evidenceIdSchema,
  })
  .strict();

const publicationChangesQuerySchema = pageQuerySchema.strict();

const currencyBasisHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const publicationCurrencyQuerySchema = scopedPageQuerySchema
  .extend({
    objectType: z.enum(currencyObjectTypes).optional(),
    state: z.enum(currencyStates).optional(),
  })
  .strict();
const publicationCurrencyCursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('publication-currency'),
    publicationId: sourceIdSchema,
    objectType: z.enum(currencyObjectTypes).optional(),
    state: z.enum(currencyStates).optional(),
    currencyBasisHash: currencyBasisHashSchema,
    afterObjectType: z.enum(currencyObjectTypes),
    afterId: sourceIdSchema,
  })
  .strict();

const searchTextQuerySchema = z.string().trim().min(1).max(256);
const searchEntityQuerySchema = pageQuerySchema
  .extend({
    publicationId: sourceIdSchema.optional(),
    type: z.enum(knowledgeEntityTypes).optional(),
    lifecycleStatus: z
      .enum(['observed', 'verified', 'established', 'rejected', 'superseded'])
      .optional(),
    query: searchTextQuerySchema.optional(),
    match: z.enum(searchMatchModes).optional(),
    field: z.enum(['name', 'text']).optional(),
  })
  .strict();
const searchRelationshipQuerySchema = pageQuerySchema
  .extend({
    publicationId: sourceIdSchema.optional(),
    type: z.enum(knowledgeRelationshipTypes).optional(),
    entityId: sourceIdSchema.optional(),
    query: searchTextQuerySchema.optional(),
    match: z.enum(searchMatchModes).optional(),
    field: z.enum(['type', 'text']).optional(),
  })
  .strict();
const journeySearchQuerySchema = pageQuerySchema
  .extend({
    publicationId: sourceIdSchema.optional(),
    query: searchTextQuerySchema.optional(),
    service: searchTextQuerySchema.optional(),
    api: searchTextQuerySchema.optional(),
    connector: searchTextQuerySchema.optional(),
  })
  .strict()
  .refine(
    ({ query, service, api, connector }) =>
      [query, service, api, connector].filter((value) => value !== undefined)
        .length <= 1,
    'Specify only one of query, service, api, or connector.',
  );
const journeyIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const journeyProvenanceReferenceSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      'evidence',
      'source-file',
      'publication',
      'service',
      'api',
      'connector',
      'relationship',
    ]),
    label: z.string(),
    source: z.string().optional(),
    documentPath: z.string().optional(),
    documentId: sourceIdSchema.optional(),
    documentVersionId: sourceIdSchema.optional(),
    documentEntityId: sourceIdSchema.optional(),
    publicationId: sourceIdSchema.optional(),
  })
  .strict();
const journeyEntityReferenceSchema = z
  .object({
    entityKey: z.string().min(1).optional(),
    role: z.enum([
      'operation',
      'controller',
      'service',
      'connector',
      'component',
      'api',
      'document',
      'step',
    ]),
    label: z.string(),
    entityId: sourceIdSchema.optional(),
    entityType: z.enum(knowledgeEntityTypes).optional(),
    displayName: z.string().optional(),
    publicationId: sourceIdSchema.optional(),
  })
  .strict()
  .refine(
    (reference) =>
      reference.entityId !== undefined
        ? reference.entityType !== undefined &&
          reference.displayName !== undefined
        : reference.entityKey !== undefined,
    'A Journey entity reference must have published identity and display data or a legacy candidate key.',
  );
const journeyRelationshipReferenceSchema = z
  .object({
    relationshipKey: z.string().min(1).optional(),
    type: z.enum(knowledgeRelationshipTypes),
    relationshipId: sourceIdSchema.optional(),
    sourceEntityId: sourceIdSchema.optional(),
    targetEntityId: sourceIdSchema.optional(),
    sourceDisplayName: z.string().optional(),
    targetDisplayName: z.string().optional(),
    publicationId: sourceIdSchema.optional(),
  })
  .strict()
  .refine(
    (reference) =>
      reference.relationshipId !== undefined
        ? reference.sourceEntityId !== undefined &&
          reference.targetEntityId !== undefined
        : reference.relationshipKey !== undefined,
    'A Journey relationship reference must have published endpoints or a legacy candidate key.',
  );
const journeyStepBaseSchema = {
  id: z.string().min(1),
  service: z.string().optional(),
  entityKey: z.string().optional(),
  stepEntityKey: z.string().optional(),
  stepEntityId: sourceIdSchema.optional(),
  subject: journeyEntityReferenceSchema.optional(),
  entityReferences: z.array(journeyEntityReferenceSchema).optional(),
  evidenceRef: z.string().optional(),
  evidenceBasis: z.enum(['proven', 'derived', 'unresolved']),
  order: z.enum(['entry', 'source-order', 'conditional', 'grouped']),
  branchContext: z.string().optional(),
  asyncGroup: z.string().optional(),
  provenance: z.array(journeyProvenanceReferenceSchema),
};
const journeyStepSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...journeyStepBaseSchema,
      type: z.literal('HttpRouteStep'),
      method: z.string(),
      route: z.string(),
    })
    .strict(),
  z
    .object({
      ...journeyStepBaseSchema,
      type: z.literal('ControllerStep'),
      controller: z.string(),
    })
    .strict(),
  z
    .object({
      ...journeyStepBaseSchema,
      type: z.literal('ServiceStep'),
      service: z.string(),
    })
    .strict(),
  z
    .object({
      ...journeyStepBaseSchema,
      type: z.literal('ComponentStep'),
      component: z.string(),
    })
    .strict(),
  z
    .object({
      ...journeyStepBaseSchema,
      type: z.literal('ConnectorStep'),
      connector: z.string(),
      service: z.string(),
    })
    .strict(),
  z
    .object({
      ...journeyStepBaseSchema,
      type: z.literal('HttpClientCallStep'),
      targetExpression: z.string(),
      method: z.string(),
    })
    .strict(),
  z
    .object({
      ...journeyStepBaseSchema,
      type: z.literal('ApiCallStep'),
      target: z.string(),
      method: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...journeyStepBaseSchema,
      type: z.literal('UnresolvedCallStep'),
      targetExpression: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      ...journeyStepBaseSchema,
      type: z.literal('PersistenceStep'),
      target: z.string(),
    })
    .strict(),
]);
const journeyDiagnosticSchema = z
  .object({
    key: z.string().min(1),
    reason: z.string(),
    target: z.string(),
    evidenceRef: z.string().optional(),
  })
  .strict();
const journeySchema = z
  .object({
    id: journeyIdSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    sourceServices: z.array(z.string()),
    confidence: z.enum(['proven', 'derived']),
    completeness: z.enum(['complete', 'partial', 'unresolved']),
    provenance: z.array(journeyProvenanceReferenceSchema),
    steps: z.array(journeyStepSchema),
    transitions: z.array(
      z
        .object({
          id: z.string().min(1),
          type: z.enum([
            'RouteDispatch',
            'MethodInvocation',
            'ConnectorInvocation',
            'HttpRequest',
            'PersistenceOperation',
          ]),
          from: z.string().min(1),
          to: z.string().min(1),
          fromSubject: journeyEntityReferenceSchema.optional(),
          toSubject: journeyEntityReferenceSchema.optional(),
          evidenceRef: z.string().optional(),
          order: z.enum(['entry', 'source-order', 'conditional', 'grouped']),
          provenance: z.array(journeyProvenanceReferenceSchema),
          certainty: z.enum(['proven', 'derived', 'unresolved']),
          entityReferences: z.array(journeyEntityReferenceSchema).optional(),
          relationshipReferences: z
            .array(journeyRelationshipReferenceSchema)
            .optional(),
        })
        .strict(),
    ),
    entityReferences: z.array(journeyEntityReferenceSchema),
    relationshipReferences: z.array(journeyRelationshipReferenceSchema),
    unresolvedBoundaries: z.array(journeyDiagnosticSchema),
    diagnostics: z.array(journeyDiagnosticSchema).optional(),
  })
  .strict();
const searchLookupQuerySchema = z
  .object({ publicationId: sourceIdSchema.optional() })
  .strict();

type SearchCatalogue = CatalogueReader &
  SearchProjectionReader &
  PublicationSnapshotReader &
  PublicationExportReader &
  PublicationCurrencyReader &
  PublicationDiffStore &
  CatalogueHealth;

type ApiServerOptions = {
  readonly logger?: boolean;
  readonly runtimeRegistry?: RuntimeRegistryService;
};

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly title: string,
    message: string,
  ) {
    super(message);
  }
}

export function createApiServer(
  catalogue: SearchCatalogue,
  options: ApiServerOptions = {},
): FastifyInstance {
  const server = Fastify({
    logger:
      options.logger === false
        ? false
        : { timestamp: pino.stdTimeFunctions.isoTime },
    genReqId: (request) => {
      const suppliedId = request.headers['x-correlation-id'];
      return typeof suppliedId === 'string' &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(suppliedId)
        ? suppliedId
        : randomUUID();
    },
  });
  const runtimeRegistry =
    options.runtimeRegistry ??
    new RuntimeRegistryService({ logger: server.log });

  // Diffs are derived artefacts computed in-process from immutable
  // publications; the API remains the sole DuckDB writer (ADR-017).
  const publicationDiffs = createPublicationDiffService({
    snapshots: catalogue,
    store: catalogue,
  });

  server.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.id);
    return payload;
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return sendProblem(reply, error.statusCode, error.title, error.message);
    }
    if (error instanceof PublicationDiffScopeError) {
      return sendProblem(reply, 400, 'Invalid Request', error.message);
    }
    if (
      error instanceof CatalogueIntegrityError ||
      error instanceof PublicationCurrencyLineageError
    ) {
      request.log.error(
        { err: error },
        'published knowledge integrity failure',
      );
      return sendProblem(
        reply,
        500,
        'Knowledge Integrity Failure',
        'The stored publication or provenance data is incomplete or inconsistent.',
      );
    }
    request.log.error({ err: error }, 'request failed');
    return sendProblem(
      reply,
      500,
      'Internal Server Error',
      'The request could not be completed.',
    );
  });

  server.get('/health', { logLevel: 'silent' }, async () => ({
    status: 'ok',
  }));

  server.get(
    '/runtime/status',
    { logLevel: 'silent' },
    async (_request, reply) =>
      reply.send(runtimeRegistry.snapshot() satisfies RuntimeStatusResponse),
  );

  server.get('/ready', { logLevel: 'silent' }, async (_request, reply) => {
    try {
      await catalogue.check();
      return { status: 'ready' };
    } catch (error) {
      server.log.error({ err: error }, 'catalogue readiness check failed');
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  server.get('/api/v1/sources', async (request, reply) => {
    const query = parsePageQuery(request.query);
    const page = await catalogue.listSources({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeCursor(query.cursor) }),
      limit: query.limit + 1,
    });
    return sendPage(
      reply,
      page.items.map((source) => ({
        id: source.id,
        name: source.name,
        type: source.type,
        containerPaths: source.containerPaths,
        ...(source.roots === undefined ? {} : { roots: source.roots }),
        createdAt: source.createdAt,
      })),
      query.limit,
    );
  });

  server.get('/api/v1/workspaces', async (request, reply) => {
    const query = parsePageQuery(request.query);
    const page = await catalogue.listWorkspaces({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeCursor(query.cursor) }),
      limit: query.limit + 1,
    });
    return sendPage(reply, page.items, query.limit);
  });

  server.get('/api/v1/repositories', async (request, reply) => {
    const query = parseCatalogueQuery(request.query, repositoryQuerySchema);
    const page = await catalogue.listRepositories({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeCursor(query.cursor) }),
      ...(query.sourceId === undefined ? {} : { sourceId: query.sourceId }),
      limit: query.limit + 1,
    });
    return sendPage(reply, page.items, query.limit);
  });

  server.get('/api/v1/documents', async (request, reply) => {
    const query = parseCatalogueQuery(request.query, documentQuerySchema);
    const page = await catalogue.listDocuments({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeCursor(query.cursor) }),
      ...(query.sourceId === undefined ? {} : { sourceId: query.sourceId }),
      ...(query.extension === undefined
        ? {}
        : { extension: query.extension.toLocaleLowerCase('en-US') }),
      limit: query.limit + 1,
    });
    return sendPage(reply, page.items, query.limit);
  });

  server.get('/api/v1/knowledge/models', async (request, reply) => {
    const query = parseCatalogueQuery(request.query, knowledgeModelQuerySchema);
    const page = await catalogue.listKnowledgeModels({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeCursor(query.cursor) }),
      limit: query.limit + 1,
    });
    return sendPage(reply, page.items, query.limit);
  });

  server.get('/api/v1/knowledge/models/:modelId', async (request, reply) => {
    const params = z
      .object({ modelId: sourceIdSchema })
      .strict()
      .safeParse(request.params);
    if (!params.success) {
      throw new ApiError(
        400,
        'Invalid Request',
        'Knowledge Model ID is invalid.',
      );
    }
    const model = await catalogue.getKnowledgeModel(params.data.modelId);
    if (model === undefined) {
      throw new ApiError(404, 'Not Found', 'Knowledge Model was not found.');
    }
    return reply.send(model);
  });

  server.get(
    '/api/v1/knowledge/models/:modelId/publications/latest',
    async (request, reply) => {
      const modelId = parseIdParam(
        request.params,
        'modelId',
        'Knowledge Model',
      );
      const publication =
        await catalogue.getLatestKnowledgePublication(modelId);
      if (publication === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'No published Knowledge Model publication was found for this model.',
        );
      }
      return reply.send(publication);
    },
  );

  server.get('/api/v1/knowledge/entities', async (request, reply) => {
    const query = parseCatalogueQuery(
      request.query,
      knowledgeEntityQuerySchema,
    );
    const page = await catalogue.listKnowledgeEntities({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeCursor(query.cursor) }),
      ...(query.knowledgeModelId === undefined
        ? {}
        : { knowledgeModelId: query.knowledgeModelId }),
      ...(query.publicationId === undefined
        ? {}
        : { publicationId: query.publicationId }),
      ...(query.lifecycleStatus === undefined
        ? {}
        : { lifecycleStatus: query.lifecycleStatus }),
      ...(query.type === undefined ? {} : { type: query.type }),
      limit: query.limit + 1,
    });
    return sendPage(reply, page.items, query.limit);
  });

  server.get('/api/v1/knowledge/entities/:entityId', async (request, reply) => {
    const params = z
      .object({ entityId: sourceIdSchema })
      .strict()
      .safeParse(request.params);
    if (!params.success) {
      throw new ApiError(
        400,
        'Invalid Request',
        'Knowledge Entity ID is invalid.',
      );
    }
    const entity = await catalogue.getKnowledgeEntity(params.data.entityId);
    if (entity === undefined) {
      throw new ApiError(404, 'Not Found', 'Knowledge Entity was not found.');
    }
    return reply.send(entity);
  });

  server.get('/api/v1/knowledge/relationships', async (request, reply) => {
    const query = parseCatalogueQuery(
      request.query,
      knowledgeRelationshipQuerySchema,
    );
    const page = await catalogue.listKnowledgeRelationships({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeCursor(query.cursor) }),
      ...(query.knowledgeModelId === undefined
        ? {}
        : { knowledgeModelId: query.knowledgeModelId }),
      ...(query.publicationId === undefined
        ? {}
        : { publicationId: query.publicationId }),
      ...(query.lifecycleStatus === undefined
        ? {}
        : { lifecycleStatus: query.lifecycleStatus }),
      ...(query.type === undefined ? {} : { type: query.type }),
      limit: query.limit + 1,
    });
    return sendPage(reply, page.items, query.limit);
  });

  server.get(
    '/api/v1/knowledge/relationships/:relationshipId',
    async (request, reply) => {
      const params = z
        .object({ relationshipId: sourceIdSchema })
        .strict()
        .safeParse(request.params);
      if (!params.success) {
        throw new ApiError(
          400,
          'Invalid Request',
          'Knowledge Relationship ID is invalid.',
        );
      }
      const relationship = await catalogue.getKnowledgeRelationship(
        params.data.relationshipId,
      );
      if (relationship === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge Relationship was not found.',
        );
      }
      return reply.send(relationship);
    },
  );

  server.get('/api/v1/knowledge/publications', async (request, reply) => {
    const query = parseCatalogueQuery(
      request.query,
      knowledgePublicationQuerySchema,
    );
    const page = await catalogue.listAvailableKnowledgePublications({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeCursor(query.cursor) }),
      ...(query.knowledgeModelId === undefined
        ? {}
        : { knowledgeModelId: query.knowledgeModelId }),
      limit: query.limit + 1,
    });
    return sendPage(reply, page.items, query.limit);
  });

  server.get(
    '/api/v1/knowledge/publications/:publicationId',
    async (request, reply) => {
      const publicationId = parseIdParam(
        request.params,
        'publicationId',
        'Publication',
      );
      const publication =
        await catalogue.getKnowledgePublication(publicationId);
      if (publication === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge publication was not found.',
        );
      }
      return reply.send(publication);
    },
  );

  server.get(
    '/api/v1/knowledge/publications/:publicationId/summary',
    async (request, reply) => {
      parseCatalogueQuery(request.query, z.object({}).strict());
      const publicationId = parseIdParam(
        request.params,
        'publicationId',
        'Publication',
      );
      const summary =
        await catalogue.getKnowledgePublicationSummary(publicationId);
      if (summary === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge publication was not found.',
        );
      }
      return reply.send(summary);
    },
  );

  server.get(
    '/api/v1/knowledge/publications/:publicationId/export',
    async (request, reply) => {
      const publicationId = parseIdParam(
        request.params,
        'publicationId',
        'Publication',
      );
      parseCatalogueQuery(request.query, z.object({}).strict());
      const publicationPackage =
        await catalogue.getKnowledgePublicationExport(publicationId);
      if (publicationPackage === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge publication was not found.',
        );
      }
      let serialized: string;
      try {
        serialized = serializeKnowledgePublicationPackage(publicationPackage);
      } catch (error) {
        if (error instanceof KnowledgePublicationPackageIntegrityError) {
          throw new CatalogueIntegrityError(error.message);
        }
        throw error;
      }
      request.log.info(
        {
          publicationId,
          contentHash: publicationPackage.metadata.contentHash,
          entityCount: publicationPackage.metadata.entityCount,
          relationshipCount: publicationPackage.metadata.relationshipCount,
        },
        'knowledge publication exported',
      );
      return reply
        .header('content-type', 'application/json; charset=utf-8')
        .send(serialized);
    },
  );

  server.get(
    '/api/v1/knowledge/publications/:publicationId/entities/:entityId',
    async (request, reply) => {
      const { publicationId, objectId: entityId } = parsePublishedObjectParams(
        request.params,
        'entityId',
        'Entity',
      );
      const published = await catalogue.getPublishedEntity(
        publicationId,
        entityId,
      );
      if (published === undefined) {
        await ensurePublicationExists(catalogue, publicationId);
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge entity was not found in this publication.',
        );
      }
      return reply.send(published);
    },
  );

  server.get(
    '/api/v1/knowledge/publications/:publicationId/entities/:entityId/relationships',
    async (request, reply) => {
      const { publicationId, objectId: entityId } = parsePublishedObjectParams(
        request.params,
        'entityId',
        'Entity',
      );
      const query = parseCatalogueQuery(
        request.query,
        publicationRelationshipQuerySchema,
      );
      const publication =
        await catalogue.getKnowledgePublication(publicationId);
      if (publication === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge publication was not found.',
        );
      }
      const entity = await catalogue.getPublishedEntity(
        publicationId,
        entityId,
      );
      if (entity === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge entity was not found in this publication.',
        );
      }
      const cursor =
        query.cursor === undefined
          ? undefined
          : decodeRelationshipCursor(query.cursor, {
              publicationId,
              entityId,
              direction: query.direction,
              ...(query.relationshipType === undefined
                ? {}
                : { relationshipType: query.relationshipType }),
            });
      const page = await catalogue.listPublishedEntityRelationships({
        publicationId,
        entityId,
        direction: query.direction,
        ...(query.relationshipType === undefined
          ? {}
          : { relationshipType: query.relationshipType }),
        ...(cursor === undefined ? {} : { afterId: cursor.afterId }),
        limit: query.limit + 1,
      });
      const hasMore = page.items.length > query.limit;
      const items = page.items.slice(0, query.limit);
      return reply.send({
        publicationId,
        items,
        nextCursor:
          hasMore && items.length > 0
            ? encodeRelationshipCursor({
                publicationId,
                entityId,
                direction: query.direction,
                ...(query.relationshipType === undefined
                  ? {}
                  : { relationshipType: query.relationshipType }),
                afterId: items.at(-1)!.relationship.id,
              })
            : null,
      });
    },
  );

  server.get(
    '/api/v1/knowledge/publications/:publicationId/entities/:entityId/provenance',
    async (request, reply) => {
      const { publicationId, objectId: entityId } = parsePublishedObjectParams(
        request.params,
        'entityId',
        'Entity',
      );
      const query = parseCatalogueQuery(
        request.query,
        provenancePageQuerySchema,
      );
      await ensurePublicationExists(catalogue, publicationId);
      const provenance = await catalogue.getPublishedEntityProvenance(
        publicationId,
        entityId,
      );
      if (provenance === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge entity was not found in this publication.',
        );
      }
      return sendProvenancePage(reply, provenance, query);
    },
  );

  server.get(
    '/api/v1/knowledge/publications/:publicationId/relationships/:relationshipId',
    async (request, reply) => {
      const { publicationId, objectId: relationshipId } =
        parsePublishedObjectParams(
          request.params,
          'relationshipId',
          'Relationship',
        );
      const published = await catalogue.getPublishedRelationship(
        publicationId,
        relationshipId,
      );
      if (published === undefined) {
        await ensurePublicationExists(catalogue, publicationId);
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge relationship was not found in this publication.',
        );
      }
      return reply.send(published);
    },
  );

  server.get(
    '/api/v1/knowledge/publications/:publicationId/relationships/:relationshipId/provenance',
    async (request, reply) => {
      const { publicationId, objectId: relationshipId } =
        parsePublishedObjectParams(
          request.params,
          'relationshipId',
          'Relationship',
        );
      const query = parseCatalogueQuery(
        request.query,
        provenancePageQuerySchema,
      );
      await ensurePublicationExists(catalogue, publicationId);
      const provenance = await catalogue.getPublishedRelationshipProvenance(
        publicationId,
        relationshipId,
      );
      if (provenance === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge relationship was not found in this publication.',
        );
      }
      return sendProvenancePage(reply, provenance, query);
    },
  );

  server.get(
    '/api/v1/knowledge/publications/:publicationId/diff/:otherPublicationId',
    async (request, reply) => {
      const params = z
        .object({
          publicationId: sourceIdSchema,
          otherPublicationId: sourceIdSchema,
        })
        .strict()
        .safeParse(request.params);
      if (!params.success) {
        throw new ApiError(
          400,
          'Invalid Request',
          'Publication ID is invalid.',
        );
      }
      parseCatalogueQuery(request.query, z.object({}).strict());
      const result = await publicationDiffs.compare(
        params.data.publicationId,
        params.data.otherPublicationId,
      );
      if (result.status === 'publication-not-found') {
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge publication was not found.',
        );
      }
      request.log.info(
        {
          diffId: result.diff.id,
          fromPublicationId: result.diff.fromPublicationId,
          toPublicationId: result.diff.toPublicationId,
          diffContentHash: result.diff.contentHash,
        },
        'publication diff resolved',
      );
      return reply.send(result.diff);
    },
  );

  server.get(
    '/api/v1/knowledge/publications/:publicationId/changes',
    async (request, reply) => {
      const publicationId = parseIdParam(
        request.params,
        'publicationId',
        'Publication',
      );
      const query = parseCatalogueQuery(
        request.query,
        publicationChangesQuerySchema,
      );
      const cursor =
        query.cursor === undefined
          ? undefined
          : decodePublicationChangesCursor(query.cursor, publicationId);
      await ensurePublicationExists(catalogue, publicationId);
      const page = await publicationDiffs.listComparisons({
        publicationId,
        ...(cursor === undefined ? {} : { afterId: cursor.afterId }),
        limit: query.limit + 1,
      });
      const hasMore = page.items.length > query.limit;
      const items = page.items.slice(0, query.limit);
      const last = items.at(-1);
      return reply.send({
        items,
        nextCursor:
          hasMore && last !== undefined
            ? encodeScopedCursor({
                version: 1,
                kind: 'publication-comparisons',
                publicationId,
                afterId: last.id,
              })
            : null,
      });
    },
  );

  // Publication currency is computed on demand from the catalogue's
  // current-version pointers; nothing is persisted and nothing is written.
  const loadPublicationCurrency = async (
    publicationId: string,
  ): Promise<PublicationCurrency> => {
    const inputs = await catalogue.getPublicationCurrencyInputs(publicationId);
    if (inputs === undefined) {
      throw new ApiError(
        404,
        'Not Found',
        'Knowledge publication was not found.',
      );
    }
    return classifyPublicationCurrency(inputs);
  };

  server.get(
    '/api/v1/knowledge/publications/:publicationId/currency',
    async (request, reply) => {
      const publicationId = parseIdParam(
        request.params,
        'publicationId',
        'Publication',
      );
      parseCatalogueQuery(request.query, z.object({}).strict());
      const { summary } = await loadPublicationCurrency(publicationId);
      request.log.info(
        { publicationId, currencyBasisHash: summary.currencyBasisHash },
        'publication currency resolved',
      );
      return reply.send(summary);
    },
  );

  server.get(
    '/api/v1/knowledge/publications/:publicationId/currency/details',
    async (request, reply) => {
      const publicationId = parseIdParam(
        request.params,
        'publicationId',
        'Publication',
      );
      const query = parseCatalogueQuery(
        request.query,
        publicationCurrencyQuerySchema,
      );
      const filters = {
        ...(query.objectType === undefined
          ? {}
          : { objectType: query.objectType }),
        ...(query.state === undefined ? {} : { state: query.state }),
      };
      const cursor =
        query.cursor === undefined
          ? undefined
          : decodePublicationCurrencyCursor(query.cursor, {
              publicationId,
              ...filters,
            });
      const { summary, records } = await loadPublicationCurrency(publicationId);
      if (
        cursor !== undefined &&
        cursor.currencyBasisHash !== summary.currencyBasisHash
      ) {
        throw new ApiError(
          409,
          'Currency Basis Changed',
          'The catalogue current-version basis changed during pagination; restart from the first page.',
        );
      }
      const after =
        cursor === undefined
          ? undefined
          : { objectType: cursor.afterObjectType, id: cursor.afterId };
      const matching = records.filter(
        (record) =>
          (query.objectType === undefined ||
            record.objectType === query.objectType) &&
          (query.state === undefined || record.state === query.state) &&
          (after === undefined || compareCurrencySortKey(record, after) > 0),
      );
      const items = matching.slice(0, query.limit);
      const last = items.at(-1);
      return reply.send({
        publicationId: summary.publicationId,
        knowledgeModelId: summary.knowledgeModelId,
        currencyBasisHash: summary.currencyBasisHash,
        items,
        nextCursor:
          matching.length > query.limit && last !== undefined
            ? encodeScopedCursor({
                version: 1,
                kind: 'publication-currency',
                publicationId,
                ...filters,
                currencyBasisHash: summary.currencyBasisHash,
                afterObjectType: last.objectType,
                afterId: last.id,
              })
            : null,
      });
    },
  );

  server.get('/api/v1/knowledge/diffs/:diffId', async (request, reply) => {
    const diffId = parseIdParam(request.params, 'diffId', 'Diff');
    parseCatalogueQuery(request.query, z.object({}).strict());
    const diff = await publicationDiffs.getDiff(diffId);
    if (diff === undefined) {
      throw new ApiError(404, 'Not Found', 'Publication diff was not found.');
    }
    return reply.send(diff);
  });

  server.get('/api/v1/search/entities', async (request, reply) => {
    const query = parseCatalogueQuery(request.query, searchEntityQuerySchema);
    const text = searchTextFilter(query, 'name');
    const page = await catalogue.searchProjectedEntities({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeIdCursor(query.cursor) }),
      ...(query.publicationId === undefined
        ? {}
        : { publicationId: query.publicationId }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.lifecycleStatus === undefined
        ? {}
        : { lifecycleStatus: query.lifecycleStatus }),
      ...(text === undefined ? {} : { text }),
      limit: query.limit + 1,
    });
    return sendKeyedPage(
      reply,
      page.items,
      query.limit,
      (item) => item.entityId,
    );
  });

  server.get('/api/v1/search/journeys', async (request, reply) => {
    const query = parseCatalogueQuery(request.query, journeySearchQuerySchema);
    const searchText =
      query.service ?? query.api ?? query.connector ?? query.query;
    const page = await catalogue.searchProjectedEntities({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeIdCursor(query.cursor) }),
      ...(query.publicationId === undefined
        ? {}
        : { publicationId: query.publicationId }),
      type: 'journey',
      ...(searchText === undefined
        ? {}
        : {
            text: {
              query: searchText,
              match: 'contains',
              field: 'text',
            } as const,
          }),
      limit: query.limit + 1,
    });
    const items = await Promise.all(
      page.items.map(async (item) => {
        const published = await catalogue.getPublishedEntity(
          item.publicationId,
          item.entityId,
        );
        if (published === undefined) {
          throw new CatalogueIntegrityError(
            `Journey projection ${item.entityId} references a missing published entity`,
          );
        }
        return publishedJourneyResponse(published);
      }),
    );
    return sendKeyedPage(
      reply,
      items,
      query.limit,
      (item) => item.journeyEntityId,
    );
  });

  server.get(
    '/api/v1/knowledge/publications/:publicationId/journeys/:journeyId',
    async (request, reply) => {
      const params = z
        .object({
          publicationId: sourceIdSchema,
          journeyId: journeyIdSchema,
        })
        .strict()
        .safeParse(request.params);
      if (!params.success) {
        throw new ApiError(
          400,
          'Invalid Request',
          'Journey identity is invalid.',
        );
      }
      parseCatalogueQuery(request.query, z.object({}).strict());
      const page = await catalogue.searchProjectedEntities({
        publicationId: params.data.publicationId,
        type: 'journey',
        text: {
          query: params.data.journeyId,
          match: 'contains',
          field: 'text',
        },
        limit: 100,
      });
      if (page.items.length === 100) {
        throw new CatalogueIntegrityError(
          `Journey identity search returned too many candidates for ${params.data.journeyId}`,
        );
      }
      const matches: ReturnType<typeof publishedJourneyResponse>[] = [];
      for (const item of page.items) {
        const published = await catalogue.getPublishedEntity(
          params.data.publicationId,
          item.entityId,
        );
        if (published === undefined) {
          throw new CatalogueIntegrityError(
            `Journey projection ${item.entityId} references a missing published entity`,
          );
        }
        const response = publishedJourneyResponse(published);
        if (response.journeyId === params.data.journeyId) {
          matches.push(response);
        }
      }
      if (matches.length === 0) {
        throw new ApiError(
          404,
          'Not Found',
          'Published Journey was not found.',
        );
      }
      if (matches.length > 1) {
        throw new CatalogueIntegrityError(
          `Journey identity ${params.data.journeyId} is not unique in publication ${params.data.publicationId}`,
        );
      }
      return reply.send(matches[0]);
    },
  );

  server.get('/api/v1/search/relationships', async (request, reply) => {
    const query = parseCatalogueQuery(
      request.query,
      searchRelationshipQuerySchema,
    );
    const text = searchTextFilter(query, 'type');
    const page = await catalogue.searchProjectedRelationships({
      ...(query.cursor === undefined
        ? {}
        : { afterId: decodeIdCursor(query.cursor) }),
      ...(query.publicationId === undefined
        ? {}
        : { publicationId: query.publicationId }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
      ...(text === undefined ? {} : { text }),
      limit: query.limit + 1,
    });
    return sendKeyedPage(
      reply,
      page.items,
      query.limit,
      (item) => item.relationshipId,
    );
  });

  server.get('/api/v1/search/entity/:entityId', async (request, reply) => {
    const entityId = parseIdParam(request.params, 'entityId', 'Entity');
    const query = parseCatalogueQuery(request.query, searchLookupQuerySchema);
    const entity = await catalogue.getProjectedEntity(
      entityId,
      query.publicationId,
    );
    if (entity === undefined) {
      throw new ApiError(404, 'Not Found', 'Projected entity was not found.');
    }
    return reply.send(entity);
  });

  server.get(
    '/api/v1/search/relationship/:relationshipId',
    async (request, reply) => {
      const relationshipId = parseIdParam(
        request.params,
        'relationshipId',
        'Relationship',
      );
      const query = parseCatalogueQuery(request.query, searchLookupQuerySchema);
      const relationship = await catalogue.getProjectedRelationship(
        relationshipId,
        query.publicationId,
      );
      if (relationship === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'Projected relationship was not found.',
        );
      }
      return reply.send(relationship);
    },
  );

  server.get(
    '/api/v1/search/publication/:publicationId',
    async (request, reply) => {
      const publicationId = parseIdParam(
        request.params,
        'publicationId',
        'Publication',
      );
      parseCatalogueQuery(request.query, z.object({}).strict());
      const statistics = await catalogue.getProjectionStatistics(publicationId);
      if (statistics === undefined) {
        throw new ApiError(
          404,
          'Not Found',
          'Knowledge publication was not found.',
        );
      }
      return reply.send(statistics);
    },
  );

  server.get(
    '/api/v1/documents/:documentId/evidence',
    async (request, reply) => {
      const params = z
        .object({ documentId: documentIdSchema })
        .strict()
        .safeParse(request.params);
      if (!params.success) {
        throw new ApiError(400, 'Invalid Request', 'Document ID is invalid.');
      }
      const query = parsePageQuery(request.query);
      const page = await catalogue.listDocumentEvidence(
        params.data.documentId,
        {
          ...(query.cursor === undefined
            ? {}
            : { afterId: decodeCursor(query.cursor) }),
          limit: query.limit + 1,
        },
      );
      return sendPage(reply, page.items, query.limit);
    },
  );

  server.get('/api/v1/evidence/:evidenceId/explanation', async (request) => {
    const params = z
      .object({ evidenceId: evidenceIdSchema })
      .strict()
      .safeParse(request.params);
    if (!params.success) {
      throw new ApiError(400, 'Invalid Request', 'Evidence ID is invalid.');
    }
    const explanation = await catalogue.explainEvidence(params.data.evidenceId);
    if (explanation === undefined) {
      throw new ApiError(404, 'Not Found', 'Evidence was not found.');
    }
    return explanation;
  });

  return server;
}

async function ensurePublicationExists(
  catalogue: CatalogueReader,
  publicationId: string,
): Promise<void> {
  if ((await catalogue.getKnowledgePublication(publicationId)) === undefined) {
    throw new ApiError(
      404,
      'Not Found',
      'Knowledge publication was not found.',
    );
  }
}

function parsePublishedObjectParams(
  params: unknown,
  objectParameter: 'entityId' | 'relationshipId',
  label: string,
): { readonly publicationId: string; readonly objectId: string } {
  const schema = z
    .object({
      publicationId: sourceIdSchema,
      [objectParameter]: sourceIdSchema,
    })
    .strict();
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new ApiError(
      400,
      'Invalid Request',
      `Publication or ${label.toLocaleLowerCase('en-US')} ID is invalid.`,
    );
  }
  const publicationId = parsed.data.publicationId;
  const objectId = parsed.data[objectParameter];
  if (typeof publicationId !== 'string' || typeof objectId !== 'string') {
    throw new ApiError(400, 'Invalid Request', `${label} ID is invalid.`);
  }
  return {
    publicationId,
    objectId,
  };
}

function decodeRelationshipCursor(
  cursor: string,
  expected: {
    readonly publicationId: string;
    readonly entityId: string;
    readonly direction: 'incoming' | 'outgoing' | 'both';
    readonly relationshipType?: (typeof knowledgeRelationshipTypes)[number];
  },
): z.infer<typeof relationshipCursorSchema> {
  const parsed = decodeScopedCursor(cursor, relationshipCursorSchema);
  if (
    parsed.publicationId !== expected.publicationId ||
    parsed.entityId !== expected.entityId ||
    parsed.direction !== expected.direction ||
    parsed.relationshipType !== expected.relationshipType
  ) {
    throw invalidCursor();
  }
  return parsed;
}

function encodeRelationshipCursor(
  payload: Omit<z.infer<typeof relationshipCursorSchema>, 'version' | 'kind'>,
): string {
  return encodeScopedCursor({
    version: 1,
    kind: 'published-relationships',
    ...payload,
  });
}

function decodeProvenanceCursor(
  cursor: string,
  expected: {
    readonly publicationId: string;
    readonly objectType: 'entity' | 'relationship';
    readonly objectId: string;
    readonly knowledgeVersionId: string;
  },
): z.infer<typeof provenanceCursorSchema> {
  const parsed = decodeScopedCursor(cursor, provenanceCursorSchema);
  if (
    parsed.publicationId !== expected.publicationId ||
    parsed.objectType !== expected.objectType ||
    parsed.objectId !== expected.objectId ||
    parsed.knowledgeVersionId !== expected.knowledgeVersionId
  ) {
    throw invalidCursor();
  }
  return parsed;
}

function encodeProvenanceCursor(
  payload: Omit<z.infer<typeof provenanceCursorSchema>, 'version' | 'kind'>,
): string {
  return encodeScopedCursor({
    version: 1,
    kind: 'published-provenance',
    ...payload,
  });
}

function decodePublicationChangesCursor(
  cursor: string,
  publicationId: string,
): z.infer<typeof publicationChangesCursorSchema> {
  const parsed = decodeScopedCursor(cursor, publicationChangesCursorSchema);
  if (parsed.publicationId !== publicationId) {
    throw invalidCursor();
  }
  return parsed;
}

function decodePublicationCurrencyCursor(
  cursor: string,
  expected: {
    readonly publicationId: string;
    readonly objectType?: (typeof currencyObjectTypes)[number];
    readonly state?: (typeof currencyStates)[number];
  },
): z.infer<typeof publicationCurrencyCursorSchema> {
  const parsed = decodeScopedCursor(cursor, publicationCurrencyCursorSchema);
  if (
    parsed.publicationId !== expected.publicationId ||
    parsed.objectType !== expected.objectType ||
    parsed.state !== expected.state
  ) {
    throw invalidCursor();
  }
  return parsed;
}

function decodeScopedCursor<T extends z.ZodType>(
  cursor: string,
  schema: T,
): z.infer<T> {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (
    decoded.length === 0 ||
    Buffer.from(decoded).toString('base64url') !== cursor
  ) {
    throw invalidCursor();
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded) as unknown;
  } catch {
    throw invalidCursor();
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success || JSON.stringify(parsed.data) !== decoded) {
    throw invalidCursor();
  }
  return parsed.data;
}

function encodeScopedCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function invalidCursor(): ApiError {
  return new ApiError(
    400,
    'Invalid Cursor',
    'The pagination cursor is invalid.',
  );
}

function sendProvenancePage(
  reply: FastifyReply,
  provenance: KnowledgeObjectProvenance,
  query: z.infer<typeof provenancePageQuerySchema>,
): FastifyReply {
  const cursor =
    query.cursor === undefined
      ? undefined
      : decodeProvenanceCursor(query.cursor, {
          publicationId: provenance.publicationId,
          objectType: provenance.knowledgeObjectType,
          objectId: provenance.knowledgeObjectId,
          knowledgeVersionId: provenance.knowledgeVersionId,
        });
  const afterId = cursor?.afterId;
  const candidates = provenance.items.filter(
    ({ provenance: support }) =>
      afterId === undefined || support.evidenceId > afterId,
  );
  const hasMore = candidates.length > query.limit;
  const items = candidates.slice(0, query.limit);
  const last = items.at(-1);
  return reply.send({
    publicationId: provenance.publicationId,
    knowledgeObjectType: provenance.knowledgeObjectType,
    knowledgeObjectId: provenance.knowledgeObjectId,
    knowledgeVersionId: provenance.knowledgeVersionId,
    knowledgeVersionNumber: provenance.knowledgeVersionNumber,
    items,
    nextCursor:
      hasMore && last !== undefined
        ? encodeProvenanceCursor({
            publicationId: provenance.publicationId,
            objectType: provenance.knowledgeObjectType,
            objectId: provenance.knowledgeObjectId,
            knowledgeVersionId: provenance.knowledgeVersionId,
            afterId: last.provenance.evidenceId,
          })
        : null,
  });
}

function parseCatalogueQuery<T extends z.ZodType>(
  query: unknown,
  schema: T,
): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new ApiError(
      400,
      'Invalid Request',
      'Catalogue query parameters are invalid.',
    );
  }
  return parsed.data;
}

function sendPage<T extends { readonly id: string }>(
  reply: FastifyReply,
  items: readonly T[],
  limit: number,
): FastifyReply {
  const hasMore = items.length > limit;
  const pageItems = items.slice(0, limit);
  return reply.send({
    items: pageItems,
    nextCursor: hasMore ? encodeCursor(pageItems.at(-1)?.id) : null,
  });
}

function searchTextFilter<Field extends string>(
  query: {
    readonly query?: string | undefined;
    readonly match?: (typeof searchMatchModes)[number] | undefined;
    readonly field?: Field | undefined;
  },
  defaultField: Field,
):
  | {
      readonly query: string;
      readonly match: (typeof searchMatchModes)[number];
      readonly field: Field;
    }
  | undefined {
  if (query.query === undefined) {
    if (query.match !== undefined || query.field !== undefined) {
      throw new ApiError(
        400,
        'Invalid Request',
        'match and field require a search query.',
      );
    }
    return undefined;
  }
  return {
    query: query.query,
    match: query.match ?? 'contains',
    field: query.field ?? defaultField,
  };
}

function parseIdParam(params: unknown, name: string, label: string): string {
  const parsed = z
    .object({ [name]: sourceIdSchema })
    .strict()
    .safeParse(params);
  if (!parsed.success) {
    throw new ApiError(400, 'Invalid Request', `${label} ID is invalid.`);
  }
  const value = parsed.data[name];
  if (typeof value !== 'string') {
    throw new ApiError(400, 'Invalid Request', `${label} ID is invalid.`);
  }
  return value;
}

function sendKeyedPage<T>(
  reply: FastifyReply,
  items: readonly T[],
  limit: number,
  key: (item: T) => string,
): FastifyReply {
  const hasMore = items.length > limit;
  const pageItems = items.slice(0, limit);
  const last = pageItems.at(-1);
  return reply.send({
    items: pageItems,
    nextCursor: hasMore && last !== undefined ? encodeCursor(key(last)) : null,
  });
}

function publishedJourneyResponse(published: {
  readonly publicationId: string;
  readonly entityVersionId: string;
  readonly versionNumber: number;
  readonly entity: {
    readonly id: string;
    readonly type: string;
    readonly name: string;
    readonly sourceEvidenceIds: readonly string[];
    readonly provenance: readonly {
      readonly facts?: Readonly<Record<string, string>>;
    }[];
  };
}) {
  if (published.entity.type !== 'journey') {
    throw new CatalogueIntegrityError(
      `Published entity ${published.entity.id} is not a Journey`,
    );
  }
  const serializedModels = published.entity.provenance.flatMap((item) =>
    item.facts?.journeyJson ? [item.facts.journeyJson] : [],
  );
  if (serializedModels.length !== 1) {
    throw new CatalogueIntegrityError(
      `Published Journey ${published.entity.id} must contain exactly one serialized model`,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(serializedModels[0] ?? '');
  } catch (error) {
    throw new CatalogueIntegrityError(
      `Published Journey ${published.entity.id} contains invalid model JSON: ${String(error)}`,
    );
  }
  const parsed = journeySchema.safeParse(decoded);
  if (
    !parsed.success ||
    parsed.data.name !== published.entity.name ||
    published.entity.provenance.every(
      (item) => item.facts?.journeyId !== parsed.data.id,
    )
  ) {
    throw new CatalogueIntegrityError(
      `Published Journey ${published.entity.id} does not match its serialized model`,
    );
  }
  const pinReference = <
    T extends {
      readonly entityId?: string | undefined;
      readonly relationshipId?: string | undefined;
      readonly documentEntityId?: string | undefined;
    },
  >(
    reference: T,
  ): T =>
    reference.entityId || reference.relationshipId || reference.documentEntityId
      ? { ...reference, publicationId: published.publicationId }
      : reference;
  return {
    publicationId: published.publicationId,
    journeyEntityId: published.entity.id,
    journeyId: parsed.data.id,
    sourceEvidenceIds: [...published.entity.sourceEvidenceIds],
    journey: {
      ...parsed.data,
      entityReferences: parsed.data.entityReferences.map(pinReference),
      relationshipReferences:
        parsed.data.relationshipReferences.map(pinReference),
      provenance: parsed.data.provenance.map(pinReference),
      steps: parsed.data.steps.map((step) => ({
        ...step,
        ...(step.subject ? { subject: pinReference(step.subject) } : {}),
        ...(step.entityReferences
          ? {
              entityReferences: step.entityReferences.map(pinReference),
            }
          : {}),
        provenance: step.provenance.map(pinReference),
      })),
      transitions: parsed.data.transitions.map((transition) => ({
        ...transition,
        ...(transition.fromSubject
          ? { fromSubject: pinReference(transition.fromSubject) }
          : {}),
        ...(transition.toSubject
          ? { toSubject: pinReference(transition.toSubject) }
          : {}),
        ...(transition.entityReferences
          ? {
              entityReferences: transition.entityReferences.map(pinReference),
            }
          : {}),
        ...(transition.relationshipReferences
          ? {
              relationshipReferences:
                transition.relationshipReferences.map(pinReference),
            }
          : {}),
        provenance: transition.provenance.map(pinReference),
      })),
    },
  };
}

function decodeIdCursor(cursor: string): string {
  const id = decodeCursor(cursor);
  if (!sourceIdSchema.safeParse(id).success) {
    throw new ApiError(
      400,
      'Invalid Cursor',
      'The pagination cursor is invalid.',
    );
  }
  return id;
}

function parsePageQuery(query: unknown): z.infer<typeof pageQuerySchema> {
  const parsed = pageQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new ApiError(
      400,
      'Invalid Request',
      'Pagination query parameters are invalid.',
    );
  }
  return parsed.data;
}

function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (
    id.length === 0 ||
    id.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(id) ||
    Buffer.from(id).toString('base64url') !== cursor
  ) {
    throw new ApiError(
      400,
      'Invalid Cursor',
      'The pagination cursor is invalid.',
    );
  }
  return id;
}

function encodeCursor(id: string | undefined): string {
  if (id === undefined) {
    throw new Error(
      'Cannot encode a pagination cursor without a final item ID',
    );
  }
  return Buffer.from(id).toString('base64url');
}

function sendProblem(
  reply: FastifyReply,
  statusCode: number,
  title: string,
  detail: string,
): FastifyReply {
  return reply.code(statusCode).type('application/problem+json').send({
    type: 'about:blank',
    title,
    status: statusCode,
    detail,
  });
}
