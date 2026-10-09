import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApiServer } from '../../apps/workspace-brain-api/src/server.js';
import { knowledgeEntityTypes } from '../../packages/domain/src/index.js';
import {
  changeTypes,
  entityContentFields,
  relationshipContentFields,
} from '../../packages/domain-evolution/src/index.js';
import {
  classifyPublicationCurrency,
  currencyObjectTypes,
  currencyReasons,
  currencyStates,
  type PublicationCurrencyInputs,
} from '../../packages/domain-currency/src/index.js';

const openApiPath = resolve(process.cwd(), 'openapi/openapi.json');

type OpenApiDocument = {
  openapi: string;
  paths: Record<
    string,
    {
      get?: {
        operationId?: string;
        tags?: string[];
        parameters?: { name: string }[];
        responses?: Record<
          string,
          {
            $ref?: string;
            content?: Record<string, { schema?: { $ref?: string } }>;
          }
        >;
      };
    }
  >;
  components: {
    parameters?: Record<string, Record<string, unknown>>;
    schemas: Record<
      string,
      {
        required?: string[];
        properties?: Record<string, unknown>;
        enum?: string[];
        additionalProperties?: boolean;
      }
    >;
  };
  tags?: { name: string }[];
};

describe('OpenAPI contract', () => {
  it('declares architectural vocabulary and both immutable publication schemas', async () => {
    const document = JSON.parse(
      await readFile(openApiPath, 'utf8'),
    ) as OpenApiDocument;
    for (const name of ['KnowledgeEntity', 'ProjectedEntity', 'EntityChange']) {
      expect(
        document.components.schemas[name]?.properties?.type ??
          document.components.schemas[name]?.properties?.entityType,
      ).toMatchObject({ enum: [...knowledgeEntityTypes] });
    }
    for (const name of [
      'KnowledgeModel',
      'KnowledgePublication',
      'KnowledgePublicationPackageMetadata',
    ]) {
      expect(
        document.components.schemas[name]?.properties?.schemaVersion,
      ).toEqual({ enum: [1, 2] });
    }
    expect(
      document.components.schemas.KnowledgeProvenance?.properties,
    ).toHaveProperty('repositoryBoundary');
    expect(
      document.components.schemas.KnowledgeProvenance?.properties,
    ).toHaveProperty('resolvedDocument');
    expect(
      document.components.schemas.KnowledgeProvenance?.properties,
    ).toHaveProperty('facts');
  });
  it('declares the Slice 0 health and read-only catalogue routes', async () => {
    const document = JSON.parse(
      await readFile(openApiPath, 'utf8'),
    ) as OpenApiDocument;

    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/health']?.get?.operationId).toBe('getHealth');
    expect(document.paths['/ready']?.get?.operationId).toBe('getReadiness');
    expect(document.paths['/api/v1/sources']?.get?.operationId).toBe(
      'listSources',
    );
    expect(document.paths['/api/v1/workspaces']?.get?.operationId).toBe(
      'listWorkspaces',
    );
    expect(document.paths['/api/v1/repositories']?.get?.operationId).toBe(
      'listRepositories',
    );
    expect(document.paths['/api/v1/documents']?.get?.operationId).toBe(
      'listDocuments',
    );
    expect(
      document.paths['/api/v1/documents/{documentId}/evidence']?.get
        ?.operationId,
    ).toBe('listDocumentEvidence');
    expect(
      document.paths['/api/v1/evidence/{evidenceId}/explanation']?.get
        ?.operationId,
    ).toBe('getEvidenceExplanation');
    const knowledgeOperations = [
      ['/api/v1/knowledge/models', 'listKnowledgeModels'],
      ['/api/v1/knowledge/models/{modelId}', 'getKnowledgeModel'],
      [
        '/api/v1/knowledge/models/{modelId}/publications/latest',
        'getLatestKnowledgePublication',
      ],
      ['/api/v1/knowledge/entities', 'listKnowledgeEntities'],
      ['/api/v1/knowledge/entities/{entityId}', 'getKnowledgeEntity'],
      ['/api/v1/knowledge/relationships', 'listKnowledgeRelationships'],
      [
        '/api/v1/knowledge/relationships/{relationshipId}',
        'getKnowledgeRelationship',
      ],
      ['/api/v1/knowledge/publications', 'listKnowledgePublications'],
      [
        '/api/v1/knowledge/publications/{publicationId}',
        'getKnowledgePublication',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/summary',
        'getKnowledgePublicationSummary',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/export',
        'exportKnowledgePublication',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/entities/{entityId}',
        'getPublishedEntity',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/entities/{entityId}/relationships',
        'listPublishedEntityRelationships',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/entities/{entityId}/provenance',
        'getPublishedEntityProvenance',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/relationships/{relationshipId}',
        'getPublishedRelationship',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/relationships/{relationshipId}/provenance',
        'getPublishedRelationshipProvenance',
      ],
    ] as const;
    for (const [path, operationId] of knowledgeOperations) {
      expect(document.paths[path]?.get?.operationId).toBe(operationId);
      expect(Object.keys(document.paths[path] ?? {})).toEqual(['get']);
    }
    expect(
      document.paths['/api/v1/sources']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.$ref,
    ).toBe('#/components/schemas/SourcePage');
    expect(
      document.paths['/api/v1/workspaces']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.$ref,
    ).toBe('#/components/schemas/WorkspacePage');
    expect(document.components.schemas.Source).toBeDefined();
    expect(document.components.schemas.SourceRoot).toBeDefined();
    expect(document.components.schemas.Workspace).toBeDefined();
    expect(document.components.schemas.Repository).toBeDefined();
    expect(document.components.schemas.Document).toBeDefined();
    expect(document.components.schemas.Evidence).toBeDefined();
    expect(document.components.schemas.EvidenceLocator).toBeDefined();
    expect(document.components.schemas.EvidenceExplanation).toBeDefined();
    expect(document.components.schemas.KnowledgeModel).toBeDefined();
    expect(document.components.schemas.KnowledgeEntity).toBeDefined();
    expect(document.components.schemas.KnowledgeRelationship).toBeDefined();
    expect(document.components.schemas.KnowledgePublication).toBeDefined();
    expect(
      document.components.schemas.KnowledgePublicationSummary,
    ).toBeDefined();
    expect(document.components.schemas.PublishedEntity).toBeDefined();
    expect(document.components.schemas.PublishedRelationship).toBeDefined();
    expect(
      document.components.schemas.KnowledgePublicationPackage,
    ).toBeDefined();
    expect(
      document.components.schemas.KnowledgePublicationPackageMetadata,
    ).toBeDefined();
    expect(
      document.components.schemas.PublishedKnowledgeProvenance,
    ).toBeDefined();
    expect(
      document.components.schemas.KnowledgePublicationPackage
        ?.additionalProperties,
    ).toBe(false);
    expect(
      document.components.schemas.KnowledgePublicationPackage?.required,
    ).toEqual([
      'format',
      'formatVersion',
      'metadata',
      'entities',
      'relationships',
      'provenance',
    ]);
    expect(
      document.components.schemas.KnowledgePublicationPackageMetadata
        ?.additionalProperties,
    ).toBe(false);
    expect(
      document.components.schemas.KnowledgePublicationPackageMetadata?.required,
    ).toContain('contentHash');
    expect(document.components.schemas.KnowledgeProvenancePage).toBeDefined();
    expect(document.components.schemas.PublishedRelationshipPage).toBeDefined();
    expect(document.components.schemas.PublishedEntity?.required).toContain(
      'entityVersionId',
    );
    expect(
      document.components.schemas.PublishedRelationship?.required,
    ).toContain('relationshipVersionId');
    for (const path of [
      '/api/v1/knowledge/publications/{publicationId}/entities/{entityId}',
      '/api/v1/knowledge/publications/{publicationId}/relationships/{relationshipId}',
    ]) {
      expect(document.paths[path]?.get?.responses?.['404']?.$ref).toBe(
        '#/components/responses/NotFound',
      );
    }
    expect(document.components.schemas.KnowledgeEntity?.required).toContain(
      'provenance',
    );
    expect(
      document.components.schemas.KnowledgeRelationship?.required,
    ).toContain('sourceEvidenceIds');
    expect(
      document.components.schemas.KnowledgeRelationship?.required,
    ).toContain('confidence');
    const relationshipType = document.components.schemas.KnowledgeRelationship
      ?.properties?.type as { enum?: string[] } | undefined;
    expect(relationshipType?.enum).toEqual([
      'CONTAINS',
      'BELONGS_TO',
      'REFERENCES',
      'DOCUMENTS',
      'DEPENDS_ON',
      'USES',
      'IMPLEMENTS',
      'EXPOSES',
      'CONSUMES',
      'CLASSIFIED_AS',
      'DERIVED_FROM',
    ]);
    expect(
      document.paths['/api/v1/documents/{documentId}/evidence']?.get
        ?.responses?.['200']?.content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/EvidencePage');
    expect(
      document.paths['/api/v1/evidence/{evidenceId}/explanation']?.get
        ?.responses?.['404']?.content?.['application/problem+json']?.schema
        ?.$ref,
    ).toBe('#/components/schemas/ProblemDetails');
    expect(document.components.schemas.Repository?.required).toContain(
      'fingerprint',
    );
    expect(document.components.schemas.Repository?.required).toContain(
      'lastSeenAt',
    );
    expect(document.components.schemas.Document?.required).toContain(
      'fingerprint',
    );
    expect(document.components.schemas.Document?.required).toContain(
      'lastSeenAt',
    );
    expect(Object.keys(document.paths['/api/v1/sources'] ?? {})).toEqual([
      'get',
    ]);
    expect(Object.keys(document.paths['/api/v1/workspaces'] ?? {})).toEqual([
      'get',
    ]);
    expect(Object.keys(document.paths['/api/v1/repositories'] ?? {})).toEqual([
      'get',
    ]);
    expect(Object.keys(document.paths['/api/v1/documents'] ?? {})).toEqual([
      'get',
    ]);
    expect(
      Object.keys(
        document.paths['/api/v1/documents/{documentId}/evidence'] ?? {},
      ),
    ).toEqual(['get']);
    expect(
      Object.keys(
        document.paths['/api/v1/evidence/{evidenceId}/explanation'] ?? {},
      ),
    ).toEqual(['get']);
    expect(
      document.paths['/api/v1/repositories']?.get?.parameters?.map(
        (parameter) => parameter.name,
      ),
    ).toContain('sourceId');
    expect(
      document.paths['/api/v1/documents']?.get?.parameters?.map(
        (parameter) => parameter.name,
      ),
    ).toContain('extension');
  });

  it('declares and registers the Slice 5 publication-scoped exploration API', async () => {
    const document = JSON.parse(
      await readFile(openApiPath, 'utf8'),
    ) as OpenApiDocument;
    const operations = [
      [
        '/api/v1/knowledge/models/{modelId}/publications/latest',
        'getLatestKnowledgePublication',
        'KnowledgePublication',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}',
        'getKnowledgePublication',
        'KnowledgePublication',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/summary',
        'getKnowledgePublicationSummary',
        'KnowledgePublicationSummary',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/export',
        'exportKnowledgePublication',
        'KnowledgePublicationPackage',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/entities/{entityId}',
        'getPublishedEntity',
        'PublishedEntity',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/entities/{entityId}/relationships',
        'listPublishedEntityRelationships',
        'PublishedRelationshipPage',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/entities/{entityId}/provenance',
        'getPublishedEntityProvenance',
        'KnowledgeProvenancePage',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/relationships/{relationshipId}',
        'getPublishedRelationship',
        'PublishedRelationship',
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/relationships/{relationshipId}/provenance',
        'getPublishedRelationshipProvenance',
        'KnowledgeProvenancePage',
      ],
    ] as const;
    const server = createApiServer(
      {} as Parameters<typeof createApiServer>[0],
      { logger: false },
    );
    await server.ready();
    for (const [path, operationId, schema] of operations) {
      const operation = document.paths[path]?.get;
      expect(operation?.operationId).toBe(operationId);
      expect(
        operation?.responses?.['200']?.content?.['application/json']?.schema
          ?.$ref,
      ).toBe(`#/components/schemas/${schema}`);
      expect(operation?.responses?.['400']?.$ref).toBe(
        '#/components/responses/InvalidRequest',
      );
      expect(
        server.hasRoute({
          method: 'GET',
          url: path.replace(/\{([^}]+)\}/g, ':$1'),
        }),
      ).toBe(true);
      for (const parameter of operation?.parameters ?? []) {
        const ref = (parameter as { $ref?: string }).$ref;
        if (ref !== undefined) {
          const name = ref.split('/').at(-1);
          expect(
            name === undefined
              ? undefined
              : document.components.parameters?.[name],
          ).toBeDefined();
        }
      }
    }
    expect(
      document.components.schemas.PublishedRelationshipTraversal?.required,
    ).toContain('relationshipVersionId');
    expect(
      document.components.schemas.KnowledgeProvenancePage?.required,
    ).toContain('knowledgeVersionNumber');
    await server.close();
  });

  it('classifies every route as operational or published knowledge', async () => {
    const document = JSON.parse(
      await readFile(openApiPath, 'utf8'),
    ) as OpenApiDocument;
    const declaredTags = new Set(document.tags?.map(({ name }) => name));
    expect(declaredTags).toEqual(
      new Set(['Operational / Current State', 'Published Knowledge']),
    );
    for (const [path, pathItem] of Object.entries(document.paths)) {
      const expectedTag =
        path.startsWith('/api/v1/knowledge/publications') ||
        path === '/api/v1/knowledge/models/{modelId}/publications/latest' ||
        path.startsWith('/api/v1/knowledge/diffs/')
          ? 'Published Knowledge'
          : 'Operational / Current State';
      for (const operation of Object.values(pathItem)) {
        expect(operation.tags).toEqual([expectedTag]);
        expect(declaredTags.has(expectedTag)).toBe(true);
      }
    }
  });

  it('declares the Slice 4 read-only search projection routes and schemas', async () => {
    const document = JSON.parse(
      await readFile(openApiPath, 'utf8'),
    ) as OpenApiDocument;
    const searchOperations = [
      [
        '/api/v1/search/entities',
        'searchProjectedEntities',
        'ProjectedEntitySearchResults',
        [
          'cursor',
          'limit',
          'publicationId',
          'type',
          'lifecycleStatus',
          'query',
          'match',
          'field',
        ],
      ],
      [
        '/api/v1/search/relationships',
        'searchProjectedRelationships',
        'ProjectedRelationshipSearchResults',
        [
          'cursor',
          'limit',
          'publicationId',
          'type',
          'entityId',
          'query',
          'match',
          'field',
        ],
      ],
      [
        '/api/v1/search/entity/{entityId}',
        'getProjectedEntity',
        'ProjectedEntity',
        ['entityId', 'publicationId'],
      ],
      [
        '/api/v1/search/relationship/{relationshipId}',
        'getProjectedRelationship',
        'ProjectedRelationship',
        ['relationshipId', 'publicationId'],
      ],
      [
        '/api/v1/search/publication/{publicationId}',
        'getProjectionStatistics',
        'ProjectionStatistics',
        ['publicationId'],
      ],
    ] as const;
    const documentedSearchPaths = Object.keys(document.paths).filter((path) =>
      path.startsWith('/api/v1/search/'),
    );
    expect(documentedSearchPaths.sort()).toEqual(
      searchOperations.map(([path]) => path).sort(),
    );
    const server = createApiServer(
      {} as Parameters<typeof createApiServer>[0],
      { logger: false },
    );
    await server.ready();
    for (const [path, operationId, schema, parameters] of searchOperations) {
      const operation = document.paths[path]?.get;
      expect(Object.keys(document.paths[path] ?? {})).toEqual(['get']);
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.parameters?.map(({ name }) => name)).toEqual(
        parameters,
      );
      expect(
        operation?.responses?.['200']?.content?.['application/json']?.schema
          ?.$ref,
      ).toBe(`#/components/schemas/${schema}`);
      expect(
        operation?.responses?.['400']?.content?.['application/problem+json']
          ?.schema?.$ref,
      ).toBe('#/components/schemas/ProblemDetails');
      expect(
        server.hasRoute({
          method: 'GET',
          url: path.replace(/\{([^}]+)\}/g, ':$1'),
        }),
      ).toBe(true);
    }
    await server.close();

    const schemas = document.components.schemas;
    expect(schemas.ProjectedEntity?.required).toEqual([
      'entityId',
      'modelId',
      'publicationId',
      'type',
      'name',
      'lifecycleStatus',
      'sourceEvidenceIds',
      'relationshipCount',
      'publishedAt',
    ]);
    expect(schemas.ProjectedRelationship?.required).toEqual([
      'relationshipId',
      'modelId',
      'publicationId',
      'type',
      'sourceEntityId',
      'targetEntityId',
      'lifecycleStatus',
      'sourceEvidenceIds',
      'publishedAt',
    ]);
    expect(schemas.ProjectionStatistics?.required).toEqual(
      expect.arrayContaining([
        'publication',
        'projectedEntityCount',
        'projectedRelationshipCount',
      ]),
    );
    expect(schemas.ProjectionStatistics?.properties?.publication).toEqual({
      $ref: '#/components/schemas/KnowledgePublication',
    });
    expect(schemas.SearchResults).toBeDefined();
    const match = document.paths[
      '/api/v1/search/entities'
    ]?.get?.parameters?.find(({ name }) => name === 'match') as
      { schema?: { enum?: string[] } } | undefined;
    expect(match?.schema?.enum).toEqual(['contains', 'prefix', 'exact']);
  });
  it('declares and registers the Slice 6 knowledge evolution API', async () => {
    const document = JSON.parse(
      await readFile(openApiPath, 'utf8'),
    ) as OpenApiDocument;
    const operations = [
      [
        '/api/v1/knowledge/publications/{publicationId}/diff/{otherPublicationId}',
        'getPublicationDiff',
        'PublicationDiff',
        ['PublicationId', 'OtherPublicationId'],
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/changes',
        'listPublicationComparisons',
        'PublicationComparisonPage',
        ['PublicationId', 'Cursor', 'Limit'],
      ],
      [
        '/api/v1/knowledge/diffs/{diffId}',
        'getPublicationDiffById',
        'PublicationDiff',
        ['DiffId'],
      ],
    ] as const;
    const server = createApiServer(
      {} as Parameters<typeof createApiServer>[0],
      { logger: false },
    );
    await server.ready();
    for (const [path, operationId, schema, parameters] of operations) {
      const operation = document.paths[path]?.get;
      expect(Object.keys(document.paths[path] ?? {})).toEqual(['get']);
      expect(operation?.operationId).toBe(operationId);
      expect(
        operation?.parameters?.map(
          (parameter) => (parameter as { $ref?: string }).$ref,
        ),
      ).toEqual(parameters.map((name) => `#/components/parameters/${name}`));
      expect(
        operation?.responses?.['200']?.content?.['application/json']?.schema
          ?.$ref,
      ).toBe(`#/components/schemas/${schema}`);
      expect(operation?.responses?.['400']?.$ref).toBe(
        '#/components/responses/InvalidRequest',
      );
      expect(operation?.responses?.['404']?.$ref).toBe(
        '#/components/responses/NotFound',
      );
      expect(operation?.responses?.['500']?.$ref).toBe(
        '#/components/responses/IntegrityFailure',
      );
      expect(
        server.hasRoute({
          method: 'GET',
          url: path.replace(/\{([^}]+)\}/g, ':$1'),
        }),
      ).toBe(true);
    }
    await server.close();

    const schemas = document.components.schemas;
    expect(schemas.ChangeType?.enum).toEqual([...changeTypes]);
    expect(schemas.ChangeSummary?.required).toEqual([
      'entitiesAdded',
      'entitiesRemoved',
      'entitiesModified',
      'entitiesUnchanged',
      'relationshipsAdded',
      'relationshipsRemoved',
      'relationshipsModified',
      'relationshipsUnchanged',
    ]);
    const changedFieldsEnum = (name: string) =>
      (
        schemas[name]?.properties?.changedFields as
          { items?: { enum?: string[] } } | undefined
      )?.items?.enum;
    expect(changedFieldsEnum('EntityChange')).toEqual([...entityContentFields]);
    expect(changedFieldsEnum('RelationshipChange')).toEqual([
      ...relationshipContentFields,
    ]);
    expect(schemas.PublicationDiff?.required).toEqual([
      ...(schemas.PublicationComparison?.required ?? []),
      'entityChanges',
      'relationshipChanges',
    ]);
    for (const name of [
      'ChangeSummary',
      'KnowledgeVersionReference',
      'EntityChange',
      'RelationshipChange',
      'PublicationComparison',
      'PublicationDiff',
    ]) {
      expect(schemas[name]?.additionalProperties, name).toBe(false);
      expect(Object.keys(schemas[name]?.properties ?? {}).sort(), name).toEqual(
        [...(schemas[name]?.required ?? [])].sort(),
      );
    }

    const references = JSON.stringify(document).match(
      /"#\/components\/[a-zA-Z]+\/[a-zA-Z]+"/g,
    );
    for (const reference of references ?? []) {
      const [, , section, name] = JSON.parse(reference).split('/');
      expect(
        (document.components as Record<string, Record<string, unknown>>)[
          section
        ]?.[name],
        reference,
      ).toBeDefined();
    }
  });

  it('declares and registers the Slice 7 publication currency API', async () => {
    const document = JSON.parse(
      await readFile(openApiPath, 'utf8'),
    ) as OpenApiDocument;
    const operations = [
      [
        '/api/v1/knowledge/publications/{publicationId}/currency',
        'getPublicationCurrency',
        'PublicationCurrencySummary',
        ['PublicationId'],
        ['200', '400', '404', '500'],
      ],
      [
        '/api/v1/knowledge/publications/{publicationId}/currency/details',
        'listPublicationCurrencyDetails',
        'PublicationCurrencyPage',
        [
          'PublicationId',
          'CurrencyObjectTypeFilter',
          'CurrencyStateFilter',
          'PublicationCurrencyCursor',
          'Limit',
        ],
        ['200', '400', '404', '409', '500'],
      ],
    ] as const;
    const problemResponses: Record<string, string> = {
      '400': 'CurrencyInvalidRequest',
      '404': 'CurrencyNotFound',
      '409': 'CurrencyBasisChanged',
      '500': 'CurrencyIntegrityFailure',
    };
    const server = createApiServer(
      {} as Parameters<typeof createApiServer>[0],
      { logger: false },
    );
    await server.ready();
    for (const [
      path,
      operationId,
      schema,
      parameters,
      statuses,
    ] of operations) {
      const operation = document.paths[path]?.get;
      expect(Object.keys(document.paths[path] ?? {})).toEqual(['get']);
      expect(operation?.operationId).toBe(operationId);
      expect(
        operation?.parameters?.map(
          (parameter) => (parameter as { $ref?: string }).$ref,
        ),
      ).toEqual(parameters.map((name) => `#/components/parameters/${name}`));
      expect(Object.keys(operation?.responses ?? {})).toEqual([...statuses]);
      expect(
        operation?.responses?.['200']?.content?.['application/json']?.schema
          ?.$ref,
      ).toBe(`#/components/schemas/${schema}`);
      for (const status of statuses.filter((value) => value !== '200')) {
        expect(operation?.responses?.[status]?.$ref, status).toBe(
          `#/components/responses/${problemResponses[status]}`,
        );
      }
      expect(
        server.hasRoute({
          method: 'GET',
          url: path.replace(/\{([^}]+)\}/g, ':$1'),
        }),
      ).toBe(true);
    }
    await server.close();

    const components = document.components as OpenApiDocument['components'] & {
      responses: Record<
        string,
        { content?: Record<string, { schema?: { $ref?: string } }> }
      >;
    };
    for (const name of Object.values(problemResponses)) {
      expect(
        components.responses[name]?.content?.['application/problem+json']
          ?.schema?.$ref,
        name,
      ).toBe('#/components/schemas/CurrencyProblemDetails');
    }
    const parameter = (name: string) =>
      components.parameters?.[name] as
        { name?: string; in?: string; schema?: { $ref?: string } } | undefined;
    expect(parameter('CurrencyObjectTypeFilter')).toMatchObject({
      name: 'objectType',
      in: 'query',
      schema: { $ref: '#/components/schemas/CurrencyObjectType' },
    });
    expect(parameter('CurrencyStateFilter')).toMatchObject({
      name: 'state',
      in: 'query',
      schema: { $ref: '#/components/schemas/CurrencyState' },
    });
    expect(parameter('PublicationCurrencyCursor')).toMatchObject({
      name: 'cursor',
      in: 'query',
      schema: { $ref: '#/components/schemas/PublicationCurrencyCursor' },
    });

    const schemas = document.components.schemas;
    expect(schemas.CurrencyState?.enum).toEqual([...currencyStates]);
    expect(schemas.CurrencyReason?.enum).toEqual([...currencyReasons]);
    expect(schemas.CurrencyObjectType?.enum).toEqual([...currencyObjectTypes]);
    expect(schemas.CurrencyProblemDetails?.properties?.status).toEqual({
      type: 'integer',
      enum: [400, 404, 409, 500],
    });
    expect(schemas.PublicationCurrencyCursor).toMatchObject({
      type: 'string',
      maxLength: 2048,
    });
    for (const name of [
      'PublicationCurrencySummary',
      'SupportingDocumentCurrency',
      'KnowledgeObjectCurrency',
      'PublicationCurrencyPage',
      'CurrencyProblemDetails',
    ]) {
      expect(schemas[name]?.additionalProperties, name).toBe(false);
      expect(Object.keys(schemas[name]?.properties ?? {}).sort(), name).toEqual(
        [...(schemas[name]?.required ?? [])].sort(),
      );
    }
    const cursorPayload = schemas.PublicationCurrencyCursorPayload;
    expect(cursorPayload?.additionalProperties).toBe(false);
    expect(Object.keys(cursorPayload?.properties ?? {})).toEqual([
      'version',
      'kind',
      'publicationId',
      'objectType',
      'state',
      'currencyBasisHash',
      'afterObjectType',
      'afterId',
    ]);
    expect(cursorPayload?.required).toEqual([
      'version',
      'kind',
      'publicationId',
      'currencyBasisHash',
      'afterObjectType',
      'afterId',
    ]);

    // The contract mirrors exactly the fields the domain classifier emits.
    const provenance = {
      evidenceId: '01K00000000000000000000001',
      documentVersionId: '01K00000000000000000000002',
      documentId: '01K00000000000000000000003',
    };
    const result = classifyPublicationCurrency({
      publication: {
        id: '01K00000000000000000000004',
        knowledgeModelId: '01K00000000000000000000005',
      },
      entities: [
        {
          entityVersionId: '01K00000000000000000000006',
          versionNumber: 1,
          entity: {
            id: '01K00000000000000000000007',
            provenance: [provenance],
          },
        },
      ],
      relationships: [],
      documentVersions: [
        {
          id: provenance.documentVersionId,
          documentId: provenance.documentId,
          contentHash: 'a'.repeat(64),
        },
      ],
      documents: [
        {
          documentId: provenance.documentId,
          documentPresent: true,
          currentDocumentVersionId: provenance.documentVersionId,
          revision: 1,
        },
      ],
    } as unknown as PublicationCurrencyInputs);
    const record = result.records[0]!;
    expect(Object.keys(result.summary).sort()).toEqual(
      [...(schemas.PublicationCurrencySummary?.required ?? [])].sort(),
    );
    expect(Object.keys(record).sort()).toEqual(
      [...(schemas.KnowledgeObjectCurrency?.required ?? [])].sort(),
    );
    expect(Object.keys(record.supportingDocuments[0]!).sort()).toEqual(
      [...(schemas.SupportingDocumentCurrency?.required ?? [])].sort(),
    );
  });
});
