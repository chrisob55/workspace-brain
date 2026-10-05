import { randomUUID } from 'node:crypto';

import type {
  CatalogueHealth,
  CatalogueReader,
} from '@workspace-brain/catalogue';
import { knowledgeRelationshipTypes } from '@workspace-brain/domain';
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
  catalogue: CatalogueReader & CatalogueHealth,
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
