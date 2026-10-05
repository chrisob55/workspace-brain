import { randomUUID } from 'node:crypto';

import type {
  CatalogueHealth,
  CatalogueReader,
  SearchProjectionReader,
} from '@workspace-brain/catalogue';
import {
  knowledgeRelationshipTypes,
  searchMatchModes,
} from '@workspace-brain/domain';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';

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
    type: z.enum(['package', 'container', 'api', 'module']).optional(),
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

const searchTextQuerySchema = z.string().trim().min(1).max(256);
const searchEntityQuerySchema = pageQuerySchema
  .extend({
    publicationId: sourceIdSchema.optional(),
    type: z.enum(['package', 'container', 'api', 'module']).optional(),
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
const searchLookupQuerySchema = z
  .object({ publicationId: sourceIdSchema.optional() })
  .strict();

type SearchCatalogue = CatalogueReader &
  SearchProjectionReader &
  CatalogueHealth;

type ApiServerOptions = {
  readonly logger?: boolean;
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
    logger: options.logger ?? true,
    genReqId: (request) => {
      const suppliedId = request.headers['x-correlation-id'];
      return typeof suppliedId === 'string' &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(suppliedId)
        ? suppliedId
        : randomUUID();
    },
  });

  server.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.id);
    return payload;
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return sendProblem(reply, error.statusCode, error.title, error.message);
    }
    request.log.error({ err: error }, 'request failed');
    return sendProblem(
      reply,
      500,
      'Internal Server Error',
      'The request could not be completed.',
    );
  });

  server.get('/health', async () => ({ status: 'ok' }));

  server.get('/ready', async (_request, reply) => {
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
    const page = await catalogue.listKnowledgePublications({
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
