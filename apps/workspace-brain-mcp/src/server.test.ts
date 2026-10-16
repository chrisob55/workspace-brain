import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  WorkspaceBrainClient,
  createClientFromEnv,
} from './client/workspace-brain-client.js';
import {
  SERVER_INSTRUCTIONS,
  createWorkspaceBrainMcpServer,
} from './create-server.js';
import {
  ENTITY_SEARCH_FIELDS,
  ENTITY_TYPES,
  LIFECYCLE_STATUSES,
  RELATIONSHIP_SEARCH_FIELDS,
  RELATIONSHIP_TYPES,
  SEARCH_MATCHES,
} from './tools/search.js';

const PUB = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const PUB2 = '01JABCDEFGHJKMNPQRSTVWXYZ1';
const MODEL = '01JMODEL000000000000000000';
const ENT = '01JENTITY0000000000000000A';
const REL = '01JRELATION000000000000000';
const JOURNEY = 'a'.repeat(64);

const EXPECTED_TOOLS = [
  'search_entities',
  'search_relationships',
  'search_journeys',
  'get_journey',
  'get_service_journeys',
  'get_entity',
  'get_published_entity',
  'list_relationships_for_entity',
  'get_entity_provenance',
  'get_relationship',
  'get_published_relationship',
  'get_relationship_provenance',
  'list_publications',
  'get_latest_publication',
  'get_publication_summary',
  'get_publication_export_metadata',
  'export_publication',
  'get_publication_currency',
  'list_publication_currency_details',
  'compare_publications',
];

type Recorded = {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
};

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void;

let api: Server;
let baseUrl: string;
let requests: Recorded[];
let routes: Map<string, Handler>;

function json(status: number, body: unknown): Handler {
  return (_req, res) => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'content-type':
        status >= 400 ? 'application/problem+json' : 'application/json',
      'content-length': Buffer.byteLength(text),
    });
    res.end(text);
  };
}

function echo(req: IncomingMessage, res: ServerResponse, url: URL): void {
  json(200, { echo: url.pathname })(req, res, url);
}

beforeAll(async () => {
  api = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requests.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    });
    (routes.get(url.pathname) ?? echo)(req, res, url);
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

beforeEach(() => {
  requests = [];
  routes = new Map();
});

async function connect(client = new WorkspaceBrainClient({ baseUrl })) {
  const server = createWorkspaceBrainMcpServer(client);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'test', version: '0.0.0' });
  await mcp.connect(clientTransport);
  return mcp;
}

type ToolOutput = { isError: boolean; text: string; json: unknown };

async function invoke(
  mcp: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutput> {
  const result = await mcp.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]!.text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = undefined;
  }
  return { isError: result.isError === true, text, json: parsed };
}

async function call(
  name: string,
  args: Record<string, unknown> = {},
  client?: WorkspaceBrainClient,
): Promise<ToolOutput> {
  const mcp = await connect(client);
  try {
    return await invoke(mcp, name, args);
  } finally {
    await mcp.close();
  }
}

const EXPECTED_SCHEMAS: Record<
  string,
  { required: string[]; optional: string[] }
> = {
  search_entities: {
    required: ['query'],
    optional: [
      'publicationId',
      'type',
      'lifecycleStatus',
      'match',
      'field',
      'limit',
      'cursor',
    ],
  },
  search_relationships: {
    required: ['query'],
    optional: [
      'publicationId',
      'relationshipType',
      'entityId',
      'match',
      'field',
      'limit',
      'cursor',
    ],
  },
  search_journeys: {
    required: [],
    optional: ['query', 'api', 'connector', 'publicationId', 'limit', 'cursor'],
  },
  get_journey: {
    required: ['publicationId', 'journeyId'],
    optional: [],
  },
  get_service_journeys: {
    required: ['service'],
    optional: ['publicationId', 'limit', 'cursor'],
  },
  get_entity: { required: ['entityId'], optional: [] },
  get_published_entity: {
    required: ['publicationId', 'entityId'],
    optional: [],
  },
  list_relationships_for_entity: {
    required: ['publicationId', 'entityId'],
    optional: ['direction', 'relationshipType', 'limit', 'cursor'],
  },
  get_entity_provenance: {
    required: ['publicationId', 'entityId'],
    optional: ['limit', 'cursor'],
  },
  get_relationship: { required: ['relationshipId'], optional: [] },
  get_published_relationship: {
    required: ['publicationId', 'relationshipId'],
    optional: [],
  },
  get_relationship_provenance: {
    required: ['publicationId', 'relationshipId'],
    optional: ['limit', 'cursor'],
  },
  list_publications: {
    required: [],
    optional: ['knowledgeModelId', 'limit', 'cursor'],
  },
  get_latest_publication: { required: ['knowledgeModelId'], optional: [] },
  get_publication_summary: { required: ['publicationId'], optional: [] },
  get_publication_export_metadata: {
    required: ['publicationId'],
    optional: [],
  },
  export_publication: { required: ['publicationId'], optional: [] },
  get_publication_currency: { required: ['publicationId'], optional: [] },
  list_publication_currency_details: {
    required: ['publicationId'],
    optional: ['objectType', 'state', 'limit', 'cursor'],
  },
  compare_publications: {
    required: ['publicationId', 'otherPublicationId'],
    optional: [],
  },
};

async function listTools() {
  const mcp = await connect();
  try {
    return (await mcp.listTools()).tools;
  } finally {
    await mcp.close();
  }
}

describe('tool inventory', () => {
  it('registers exactly the expected read-only tools', async () => {
    const tools = await listTools();
    expect(tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
    expect(tools).toHaveLength(20);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it('declares the expected required and optional arguments', async () => {
    const tools = await listTools();
    for (const tool of tools) {
      const expected = EXPECTED_SCHEMAS[tool.name]!;
      const properties = Object.keys(tool.inputSchema.properties ?? {});
      expect([...properties].sort(), tool.name).toEqual(
        [...expected.required, ...expected.optional].sort(),
      );
      expect([...(tool.inputSchema.required ?? [])].sort(), tool.name).toEqual(
        [...expected.required].sort(),
      );
    }
  });

  it('labels current-state and publication-pinned tools', async () => {
    const descriptions = new Map(
      (await listTools()).map((tool) => [tool.name, tool.description ?? '']),
    );
    for (const name of ['get_entity', 'get_relationship']) {
      expect(descriptions.get(name)).toMatch(
        /^Retrieve the current catalogue state/,
      );
      expect(descriptions.get(name)).toContain('CURRENT STATE');
      expect(descriptions.get(name)).toContain(
        'for publication analysis use the publication-pinned tool instead',
      );
    }
    for (const name of [
      'get_published_entity',
      'get_published_relationship',
      'get_entity_provenance',
      'get_relationship_provenance',
      'list_relationships_for_entity',
    ]) {
      expect(descriptions.get(name)).toMatch(/^PUBLICATION-PINNED/);
      expect(descriptions.get(name)).not.toContain('CURRENT STATE');
    }
    expect(descriptions.get('export_publication')).toContain('resource link');
  });

  it('gives compact instructions for latest, pinned reads, cursors, search, provenance and exports', async () => {
    const mcp = await connect();
    const instructions = mcp.getInstructions();
    await mcp.close();
    expect(instructions).toBe(SERVER_INSTRUCTIONS);
    expect(instructions!.length).toBeLessThan(2500);
    expect(instructions).toContain(
      'get_latest_publication resolves the current latest publication',
    );
    expect(instructions).toContain(
      'list_publications lists publication history and maps a known version number to a publication ID; never page through it to find the latest.',
    );
    expect(instructions).toContain(
      'get_entity and get_relationship return mutable current catalogue state; use them only when current state is explicitly required.',
    );
    expect(instructions).toContain(
      'Do not mix current-state and publication-pinned reads in one workflow unless the user explicitly asks for a comparison.',
    );
    expect(instructions).toContain('Cursors are opaque');
    expect(instructions).toContain('not fuzzy or semantic');
    expect(instructions).toContain('get_relationship_provenance');
    expect(instructions).toContain('get_publication_export_metadata');
    expect(instructions).toContain('No tool writes, ingests or modifies data.');
    expect(instructions).not.toMatch(
      /use list_publications to (find|resolve)/i,
    );
  });
});

describe('search parameters match the OpenAPI contract', () => {
  type Parameter = {
    name: string;
    schema: { enum?: string[]; default?: unknown };
  };
  const openapi = JSON.parse(
    readFileSync(
      new URL('../../../openapi/openapi.json', import.meta.url),
      'utf8',
    ),
  ) as { paths: Record<string, { get: { parameters: Parameter[] } }> };
  const parameter = (path: string, name: string) =>
    openapi.paths[path]!.get.parameters.find((p) => p.name === name)!.schema;
  const entities = '/api/v1/search/entities';
  const relationships = '/api/v1/search/relationships';

  it.each([
    [entities, 'type', ENTITY_TYPES],
    [entities, 'lifecycleStatus', LIFECYCLE_STATUSES],
    [entities, 'match', SEARCH_MATCHES],
    [entities, 'field', ENTITY_SEARCH_FIELDS],
    [relationships, 'type', RELATIONSHIP_TYPES],
    [relationships, 'match', SEARCH_MATCHES],
    [relationships, 'field', RELATIONSHIP_SEARCH_FIELDS],
  ])('%s %s enum', (path, name, values) => {
    expect([...values]).toEqual(parameter(path, name).enum);
  });

  it('documents the OpenAPI defaults without sending them', async () => {
    expect(parameter(entities, 'match').default).toBe('contains');
    expect(parameter(entities, 'field').default).toBe('name');
    expect(parameter(relationships, 'field').default).toBe('type');
    const tools = await listTools();
    const schema = (tool: string, property: string) =>
      JSON.stringify(
        tools.find((t) => t.name === tool)!.inputSchema.properties![property],
      );
    expect(schema('search_entities', 'match')).toContain(
      'when omitted the API uses \\"contains\\"',
    );
    expect(schema('search_entities', 'field')).toContain(
      'when omitted the API uses \\"name\\"',
    );
    expect(schema('search_relationships', 'field')).toContain(
      'when omitted the API uses \\"type\\"',
    );
    await call('search_entities', { query: 'agent' });
    expect(requests[0]!.query).toEqual({ query: 'agent' });
  });

  it.each([
    ['lifecycleStatus', 'retired'],
    ['match', 'fuzzy'],
    ['field', 'description'],
    ['type', 'service'],
  ])('rejects an unknown %s before calling the API', async (name, value) => {
    const result = await call('search_entities', {
      query: 'agent',
      [name]: value,
    });
    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
  });

  it('describes deterministic, non-semantic search behaviour', async () => {
    const tools = await listTools();
    for (const name of ['search_entities', 'search_relationships']) {
      const description = tools.find((t) => t.name === name)!.description!;
      expect(description).toContain('deterministic and case-insensitive');
      expect(description).toContain('ordered by ID');
      expect(description).toContain('no fuzzy, stemmed or semantic search');
      expect(description).toContain('agent-subscription');
      expect(description).toContain('each significant term individually');
    }
  });
});

describe('endpoint mapping', () => {
  it.each([
    [
      'search_entities',
      {
        query: 'Agent',
        publicationId: PUB,
        type: 'api',
        lifecycleStatus: 'verified',
        match: 'exact',
        field: 'text',
        limit: 10,
      },
      '/api/v1/search/entities',
      {
        query: 'Agent',
        publicationId: PUB,
        type: 'api',
        lifecycleStatus: 'verified',
        match: 'exact',
        field: 'text',
        limit: '10',
      },
    ],
    [
      'search_relationships',
      {
        query: 'DEPENDS',
        relationshipType: 'DEPENDS_ON',
        entityId: ENT,
        match: 'prefix',
        field: 'type',
      },
      '/api/v1/search/relationships',
      {
        query: 'DEPENDS',
        type: 'DEPENDS_ON',
        entityId: ENT,
        match: 'prefix',
        field: 'type',
      },
    ],
    [
      'search_journeys',
      { query: 'subscription', api: undefined, publicationId: PUB, limit: 5 },
      '/api/v1/search/journeys',
      { query: 'subscription', publicationId: PUB, limit: '5' },
    ],
    [
      'get_journey',
      { publicationId: PUB, journeyId: JOURNEY },
      `/api/v1/knowledge/publications/${PUB}/journeys/${JOURNEY}`,
      {},
    ],
    [
      'get_service_journeys',
      { service: 'services.SubscriptionService', publicationId: PUB },
      '/api/v1/search/journeys',
      { publicationId: PUB, service: 'services.SubscriptionService' },
    ],
    ['get_entity', { entityId: ENT }, `/api/v1/knowledge/entities/${ENT}`, {}],
    [
      'get_published_entity',
      { publicationId: PUB, entityId: ENT },
      `/api/v1/knowledge/publications/${PUB}/entities/${ENT}`,
      {},
    ],
    [
      'get_relationship',
      { relationshipId: REL },
      `/api/v1/knowledge/relationships/${REL}`,
      {},
    ],
    [
      'get_published_relationship',
      { publicationId: PUB, relationshipId: REL },
      `/api/v1/knowledge/publications/${PUB}/relationships/${REL}`,
      {},
    ],
    [
      'get_relationship_provenance',
      { publicationId: PUB, relationshipId: REL, limit: 5, cursor: 'c1' },
      `/api/v1/knowledge/publications/${PUB}/relationships/${REL}/provenance`,
      { limit: '5', cursor: 'c1' },
    ],
    [
      'list_relationships_for_entity',
      { publicationId: PUB, entityId: ENT, direction: 'incoming' },
      `/api/v1/knowledge/publications/${PUB}/entities/${ENT}/relationships`,
      { direction: 'incoming' },
    ],
    [
      'get_entity_provenance',
      { publicationId: PUB, entityId: ENT, cursor: 'abc' },
      `/api/v1/knowledge/publications/${PUB}/entities/${ENT}/provenance`,
      { cursor: 'abc' },
    ],
    ['list_publications', {}, '/api/v1/knowledge/publications', {}],
    [
      'get_latest_publication',
      { knowledgeModelId: MODEL },
      `/api/v1/knowledge/models/${MODEL}/publications/latest`,
      {},
    ],
    [
      'get_publication_summary',
      { publicationId: PUB },
      `/api/v1/knowledge/publications/${PUB}/summary`,
      {},
    ],
    [
      'get_publication_export_metadata',
      { publicationId: PUB },
      `/api/v1/knowledge/publications/${PUB}/export`,
      {},
    ],
    [
      'export_publication',
      { publicationId: PUB },
      `/api/v1/knowledge/publications/${PUB}/summary`,
      {},
    ],
    [
      'get_publication_currency',
      { publicationId: PUB },
      `/api/v1/knowledge/publications/${PUB}/currency`,
      {},
    ],
    [
      'list_publication_currency_details',
      { publicationId: PUB },
      `/api/v1/knowledge/publications/${PUB}/currency/details`,
      {},
    ],
    [
      'list_publications',
      { knowledgeModelId: MODEL, limit: 3, cursor: 'opaque+/=' },
      '/api/v1/knowledge/publications',
      { knowledgeModelId: MODEL, limit: '3', cursor: 'opaque+/=' },
    ],
    [
      'compare_publications',
      { publicationId: PUB, otherPublicationId: PUB2 },
      `/api/v1/knowledge/publications/${PUB}/diff/${PUB2}`,
      {},
    ],
  ])('%s %j calls the matching endpoint', async (name, args, path, query) => {
    if (name === 'search_journeys' || name === 'get_service_journeys') {
      routes.set(
        '/api/v1/search/journeys',
        json(200, { items: [], nextCursor: null }),
      );
    }
    const result = await call(name, args);
    expect(requests).toEqual([{ method: 'GET', path, query }]);
    expect(result.isError).toBe(false);
  });
});

describe('Journey search responses', () => {
  it('returns concise published summaries with exact previews and provenance counts', async () => {
    const steps = Array.from({ length: 7 }, (_, index) => ({
      id: `step-${index}`,
      type: index === 0 ? 'HttpRouteStep' : 'UnresolvedCallStep',
      order: index === 0 ? 'entry' : 'source-order',
      route: index === 0 ? 'POST /amls/arn/:arn' : undefined,
      targetExpression: index === 0 ? undefined : `call${index}()`,
      evidenceBasis: 'derived',
      provenance: [
        {
          id: `evidence-${index}`,
          kind: 'evidence',
          label: `step ${index}`,
        },
      ],
    }));
    routes.set(
      '/api/v1/search/journeys',
      json(200, {
        items: [
          {
            publicationId: PUB,
            journeyEntityId: ENT,
            journeyId: JOURNEY,
            sourceEvidenceIds: ['source-1', 'source-2', 'source-3', 'source-4'],
            journey: {
              id: JOURNEY,
              name: 'POST /amls/arn/:arn',
              description: 'Technical route journey',
              sourceServices: ['example.services.AmlsService'],
              confidence: 'derived',
              completeness: 'partial',
              provenance: [
                { id: 'journey-evidence-1', kind: 'evidence', label: 'route' },
                { id: 'journey-evidence-2', kind: 'evidence', label: 'call' },
                {
                  id: 'journey-evidence-3',
                  kind: 'evidence',
                  label: 'service',
                },
                { id: 'journey-evidence-4', kind: 'evidence', label: 'extra' },
              ],
              steps,
              transitions: [{ id: 'transition-1' }],
              unresolvedBoundaries: [
                { key: 'boundary-1', reason: 'unresolved', target: 'target' },
              ],
              diagnostics: [
                { key: 'diagnostic-1', reason: 'bounded', target: 'target' },
              ],
              entityReferences: [{ entityKey: 'service-1', label: 'service' }],
              relationshipReferences: [
                { relationshipKey: 'uses-1', type: 'USES' },
              ],
            },
          },
        ],
        nextCursor: 'next-page',
      }),
    );

    const result = await call('search_journeys', { publicationId: PUB });

    expect(result.isError).toBe(false);
    expect(result.json).toMatchObject({
      nextCursor: 'next-page',
      items: [
        {
          journeyId: JOURNEY,
          sourceEvidenceIds: ['source-1', 'source-2', 'source-3'],
          sourceEvidenceCount: 4,
          journey: {
            name: 'POST /amls/arn/:arn',
            completeness: 'partial',
            stepCount: 7,
            stepPreview: [
              {
                id: 'step-0',
                type: 'HttpRouteStep',
                route: 'POST /amls/arn/:arn',
              },
              { id: 'step-1', type: 'UnresolvedCallStep' },
              { id: 'step-2', type: 'UnresolvedCallStep' },
              { id: 'step-3', type: 'UnresolvedCallStep' },
              { id: 'step-4', type: 'UnresolvedCallStep' },
            ],
            stepsTruncated: true,
            transitionsOmitted: true,
            provenanceReferenceCount: 4,
            unresolvedBoundaryCount: 1,
            diagnosticCount: 1,
            entityReferences: [{ entityKey: 'service-1', label: 'service' }],
            relationshipReferences: [
              { relationshipKey: 'uses-1', type: 'USES' },
            ],
          },
        },
      ],
    });
    expect(JSON.stringify(result.json).includes('transition-1')).toBe(false);
  });

  it('documents the detail tool for complete step and transition data', async () => {
    const tools = await listTools();
    const description = tools.find(
      (tool) => tool.name === 'search_journeys',
    )!.description!;
    expect(description).toContain('compact preview');
    expect(description).toContain('Use get_journey for all recorded steps');
  });
});

describe('current-state and publication-pinned reads', () => {
  const currentEntity = {
    id: ENT,
    name: 'agent-subscription',
    currentVersionId: 'V2',
  };
  const publishedEntity = {
    publicationId: PUB,
    entityVersionId: 'V1',
    versionNumber: 1,
    entity: { id: ENT, name: 'agent-subscription' },
  };

  it('returns the current entity unchanged', async () => {
    routes.set(`/api/v1/knowledge/entities/${ENT}`, json(200, currentEntity));
    const result = await call('get_entity', { entityId: ENT });
    expect(result.text).toBe(JSON.stringify(currentEntity));
  });

  it('returns the published entity unchanged with its publication and version IDs', async () => {
    routes.set(
      `/api/v1/knowledge/publications/${PUB}/entities/${ENT}`,
      json(200, publishedEntity),
    );
    const result = await call('get_published_entity', {
      publicationId: PUB,
      entityId: ENT,
    });
    expect(result.text).toBe(JSON.stringify(publishedEntity));
    expect(requests).toEqual([
      {
        method: 'GET',
        path: `/api/v1/knowledge/publications/${PUB}/entities/${ENT}`,
        query: {},
      },
    ]);
  });

  it('returns the current relationship unchanged', async () => {
    const body = { id: REL, type: 'DEPENDS_ON', currentVersionId: 'R2' };
    routes.set(`/api/v1/knowledge/relationships/${REL}`, json(200, body));
    const result = await call('get_relationship', { relationshipId: REL });
    expect(result.text).toBe(JSON.stringify(body));
  });

  it('returns the published relationship unchanged', async () => {
    const body = {
      publicationId: PUB,
      relationshipVersionId: 'R1',
      versionNumber: 1,
      relationship: { id: REL, type: 'DEPENDS_ON' },
    };
    routes.set(
      `/api/v1/knowledge/publications/${PUB}/relationships/${REL}`,
      json(200, body),
    );
    const result = await call('get_published_relationship', {
      publicationId: PUB,
      relationshipId: REL,
    });
    expect(result.text).toBe(JSON.stringify(body));
  });

  it('does not accept a publicationId on current-state tools', async () => {
    const result = await call('get_entity', {
      entityId: ENT,
      publicationId: PUB,
    });
    expect(requests).toEqual([
      { method: 'GET', path: `/api/v1/knowledge/entities/${ENT}`, query: {} },
    ]);
    expect(result.isError).toBe(false);
  });

  it('passes a published-read 404 through', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'x',
    };
    routes.set(
      `/api/v1/knowledge/publications/${PUB}/entities/${ENT}`,
      json(404, problem),
    );
    expect(
      await call('get_published_entity', { publicationId: PUB, entityId: ENT }),
    ).toMatchObject({
      isError: true,
      json: { error: { kind: 'http', status: 404, body: problem } },
    });
  });
});

describe('provenance and cursors', () => {
  it('returns relationship provenance byte-for-byte', async () => {
    const page = {
      items: [
        {
          provenance: {
            evidenceId: 'E1',
            documentPath: 'services/agent-subscription/README.md',
            contentFingerprint: 'sha256:abc',
            locator: { kind: 'markdown-lines', lineStart: 3, lineEnd: 9 },
            extractionRuleId: 'rule',
          },
          evidenceExplanation: {
            evidence: {
              id: 'E1',
              locator: { kind: 'yaml-pointer', pointer: '/a/b' },
            },
          },
        },
      ],
      nextCursor: 'eyJ2IjoxfQ',
    };
    const path = `/api/v1/knowledge/publications/${PUB}/relationships/${REL}/provenance`;
    routes.set(path, json(200, page));
    const result = await call('get_relationship_provenance', {
      publicationId: PUB,
      relationshipId: REL,
    });
    expect(result.text).toBe(JSON.stringify(page));
  });

  it('returns entity provenance byte-for-byte and passes the cursor unchanged', async () => {
    const cursor = 'eyJvZmZzZXQiOjUwfQ+/=';
    const page = {
      items: [
        {
          provenance: {
            evidenceId: 'E2',
            documentPath: 'docs/agent-client-relationships.md',
            locator: {
              kind: 'markdown-lines',
              lineStart: 41,
              lineEnd: 44,
              headingPath: ['Overview'],
            },
            processorId: 'markdown-processor',
            extractorId: 'markdown-extractor',
          },
        },
      ],
      nextCursor: 'next+/=',
    };
    const path = `/api/v1/knowledge/publications/${PUB}/entities/${ENT}/provenance`;
    routes.set(path, json(200, page));
    const result = await call('get_entity_provenance', {
      publicationId: PUB,
      entityId: ENT,
      limit: 1,
      cursor,
    });
    expect(requests).toEqual([
      { method: 'GET', path, query: { limit: '1', cursor } },
    ]);
    expect(result.text).toBe(JSON.stringify(page));
  });

  it('passes relationship-provenance and traversal cursors unchanged', async () => {
    const cursor = 'a.b~c_d-e+f/g=';
    await call('get_relationship_provenance', {
      publicationId: PUB,
      relationshipId: REL,
      cursor,
    });
    await call('list_relationships_for_entity', {
      publicationId: PUB,
      entityId: ENT,
      cursor,
    });
    expect(requests.map((r) => r.query.cursor)).toEqual([cursor, cursor]);
  });

  it('passes currency-detail filters and the opaque cursor through unchanged', async () => {
    const cursor = 'eyJ2ZXJzaW9uIjoxLCJraW5kIjoi+/=_-.~';
    const page = {
      publicationId: PUB,
      knowledgeModelId: MODEL,
      currencyBasisHash: 'a'.repeat(64),
      items: [{ objectType: 'entity', id: ENT, state: 'STALE' }],
      nextCursor: 'next-opaque',
    };
    const path = `/api/v1/knowledge/publications/${PUB}/currency/details`;
    routes.set(path, json(200, page));
    const result = await call('list_publication_currency_details', {
      publicationId: PUB,
      objectType: 'entity',
      state: 'STALE',
      limit: 25,
      cursor,
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        path,
        query: { objectType: 'entity', state: 'STALE', limit: '25', cursor },
      },
    ]);
    expect(result.text).toBe(JSON.stringify(page));
  });

  it('rejects unknown currency filters before calling the API', async () => {
    const result = await call('list_publication_currency_details', {
      publicationId: PUB,
      state: 'stale',
    });
    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
  });
});

describe('publication exports', () => {
  const exportPath = `/api/v1/knowledge/publications/${PUB}/export`;
  const metadata = {
    publicationId: PUB,
    knowledgeModelId: MODEL,
    publicationVersion: 664,
    schemaVersion: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    contentHash: 'f'.repeat(64),
    entityCount: 5000,
    relationshipCount: 2,
  };
  const pkg = {
    format: 'workspace-brain-knowledge-publication',
    formatVersion: 1,
    metadata,
    entities: Array.from({ length: 5000 }, (_, i) => ({
      publicationId: PUB,
      entity: { id: `E${i}`, description: 'é'.repeat(400) },
    })),
    relationships: [{ id: 'R0' }, { id: 'R1' }],
    provenance: [
      { evidenceId: 'P0' },
      { evidenceId: 'P1' },
      { evidenceId: 'P2' },
    ],
  };
  const pkgText = JSON.stringify(pkg);
  const resourceUri = `workspace-brain://publications/${PUB}/export`;

  it('returns bounded metadata and a resource link, never the arrays', async () => {
    routes.set(exportPath, json(200, pkg));
    const mcp = await connect();
    let result;
    try {
      result = await mcp.callTool({
        name: 'get_publication_export_metadata',
        arguments: { publicationId: PUB },
      });
    } finally {
      await mcp.close();
    }
    const [text, link] = result.content as [
      { type: string; text: string },
      Record<string, unknown>,
    ];
    expect(pkgText.length).toBeGreaterThan(2_000_000);
    expect(text.text.length).toBeLessThan(1000);
    expect(JSON.parse(text.text)).toEqual({
      ...metadata,
      format: 'workspace-brain-knowledge-publication',
      formatVersion: 1,
      provenanceCount: 3,
      exportSizeBytes: Buffer.byteLength(pkgText),
      resourceUri,
      mimeType: 'application/json',
    });
    expect(text.text).not.toMatch(/"entities"|"relationships"|"provenance"/);
    expect(link).toEqual({
      type: 'resource_link',
      uri: resourceUri,
      name: `publication-${PUB}-export.json`,
      title: `Workspace Brain publication ${PUB} export`,
      mimeType: 'application/json',
    });
  });

  it('export_publication returns only a resource link and never fetches the package', async () => {
    routes.set(
      `/api/v1/knowledge/publications/${PUB}/summary`,
      json(200, { publication: { id: PUB } }),
    );
    routes.set(exportPath, json(200, pkg));
    const mcp = await connect();
    let result;
    try {
      result = await mcp.callTool({
        name: 'export_publication',
        arguments: { publicationId: PUB },
      });
    } finally {
      await mcp.close();
    }
    expect(requests.map((r) => r.path)).toEqual([
      `/api/v1/knowledge/publications/${PUB}/summary`,
    ]);
    const content = result.content as Record<string, unknown>[];
    expect(JSON.stringify(content).length).toBeLessThan(1000);
    expect(JSON.parse(content[0]!.text as string)).toMatchObject({
      publicationId: PUB,
      contentIncluded: false,
      resourceUri,
      mimeType: 'application/json',
    });
    expect(content[1]).toMatchObject({
      type: 'resource_link',
      uri: resourceUri,
    });
  });

  it('passes an unknown-publication 404 through from both export tools', async () => {
    const problem = { title: 'Not Found', status: 404 };
    routes.set(exportPath, json(404, problem));
    routes.set(
      `/api/v1/knowledge/publications/${PUB}/summary`,
      json(404, problem),
    );
    for (const name of [
      'get_publication_export_metadata',
      'export_publication',
    ]) {
      expect(await call(name, { publicationId: PUB })).toMatchObject({
        isError: true,
        json: { error: { kind: 'http', status: 404, body: problem } },
      });
    }
  });

  it('serves the exact export bytes for the requested publication as a resource', async () => {
    const otherPkg = { ...pkg, metadata: { ...metadata, publicationId: PUB2 } };
    routes.set(exportPath, json(200, pkg));
    routes.set(
      `/api/v1/knowledge/publications/${PUB2}/export`,
      json(200, otherPkg),
    );
    const mcp = await connect();
    try {
      const { resourceTemplates } = await mcp.listResourceTemplates();
      expect(resourceTemplates).toEqual([
        expect.objectContaining({
          uriTemplate: 'workspace-brain://publications/{publicationId}/export',
          mimeType: 'application/json',
        }),
      ]);
      expect((await mcp.listResources()).resources).toEqual([]);
      const read = await mcp.readResource({ uri: resourceUri });
      expect(read.contents).toEqual([
        { uri: resourceUri, mimeType: 'application/json', text: pkgText },
      ]);
      const other = await mcp.readResource({
        uri: `workspace-brain://publications/${PUB2}/export`,
      });
      expect(other.contents).toEqual([
        {
          uri: `workspace-brain://publications/${PUB2}/export`,
          mimeType: 'application/json',
          text: JSON.stringify(otherPkg),
        },
      ]);
    } finally {
      await mcp.close();
    }
    expect(requests.map((r) => r.path)).toEqual([
      exportPath,
      `/api/v1/knowledge/publications/${PUB2}/export`,
    ]);
  });

  it('rejects invalid resource IDs and reports API failures as resource errors', async () => {
    routes.set(exportPath, json(404, { title: 'Not Found', status: 404 }));
    const mcp = await connect();
    try {
      await expect(
        mcp.readResource({
          uri: 'workspace-brain://publications/..%2Fsources/export',
        }),
      ).rejects.toThrow(/Invalid publication ID/);
      await expect(mcp.readResource({ uri: resourceUri })).rejects.toThrow(
        /"status":404/,
      );
    } finally {
      await mcp.close();
    }
    expect(requests.map((r) => r.path)).toEqual([exportPath]);
  });
});

describe('error handling', () => {
  it.each([400, 404, 409, 500])(
    'passes HTTP %i problems through',
    async (status) => {
      const problem = {
        type: 'about:blank',
        title: 'Problem',
        status,
        detail: 'd',
      };
      routes.set(`/api/v1/knowledge/entities/${ENT}`, json(status, problem));
      expect(await call('get_entity', { entityId: ENT })).toEqual({
        isError: true,
        text: JSON.stringify({
          error: { kind: 'http', status, body: problem },
        }),
        json: { error: { kind: 'http', status, body: problem } },
      });
    },
  );

  it('keeps a non-JSON error body as text', async () => {
    routes.set('/api/v1/knowledge/publications', (_req, res) => {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<h1>Bad Gateway</h1>');
    });
    expect((await call('list_publications')).json).toEqual({
      error: { kind: 'http', status: 502, body: '<h1>Bad Gateway</h1>' },
    });
  });

  it('reports a malformed success body', async () => {
    routes.set('/api/v1/knowledge/publications', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not json');
    });
    expect(await call('list_publications')).toMatchObject({
      isError: true,
      json: {
        error: {
          kind: 'malformed-body',
          status: 200,
          body: {
            title: 'Malformed Workspace Brain Response',
            contentType: 'text/plain',
          },
        },
      },
    });
  });

  it('reports a timeout while awaiting response headers', async () => {
    routes.set('/api/v1/knowledge/publications', () => undefined);
    const result = await call(
      'list_publications',
      {},
      new WorkspaceBrainClient({ baseUrl, timeoutMs: 150 }),
    );
    expect(result).toMatchObject({
      isError: true,
      json: {
        error: {
          kind: 'timeout',
          status: null,
          body: {
            title: 'Workspace Brain Request Timed Out',
            detail:
              'The Workspace Brain API did not complete the request within the configured timeout (150 ms).',
            cause: 'ETIMEDOUT',
            phase: 'response',
          },
        },
      },
    });
  });

  it('reports a timeout while reading the response body as structured JSON', async () => {
    routes.set('/api/v1/knowledge/publications', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"items":[');
    });
    const result = await call(
      'list_publications',
      {},
      new WorkspaceBrainClient({ baseUrl, timeoutMs: 150 }),
    );
    expect(result).toMatchObject({
      isError: true,
      json: {
        error: {
          kind: 'timeout',
          status: null,
          body: {
            title: 'Workspace Brain Request Timed Out',
            cause: 'ETIMEDOUT',
            phase: 'body',
          },
        },
      },
    });
  });

  it('reports a dropped connection while reading the body', async () => {
    routes.set('/api/v1/knowledge/publications', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"items":[', () => res.destroy());
    });
    expect(await call('list_publications')).toMatchObject({
      isError: true,
      json: {
        error: {
          kind: 'connection',
          status: null,
          body: { title: 'Workspace Brain Connection Failed', phase: 'body' },
        },
      },
    });
  });

  it('preserves ECONNREFUSED on connection failure', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const result = await call(
      'list_publications',
      {},
      new WorkspaceBrainClient({
        baseUrl: `http://127.0.0.1:${port}`,
        timeoutMs: 2000,
      }),
    );
    expect(result).toMatchObject({
      isError: true,
      json: {
        error: {
          kind: 'connection',
          status: null,
          body: {
            title: 'Workspace Brain Connection Failed',
            detail:
              'The Workspace Brain API could not be reached or the connection was interrupted.',
            cause: 'ECONNREFUSED',
            phase: 'response',
          },
        },
      },
    });
  });

  it('preserves ECONNRESET when the API resets the connection', async () => {
    routes.set('/api/v1/knowledge/publications', (req) => {
      req.socket.resetAndDestroy();
    });
    expect(await call('list_publications')).toMatchObject({
      isError: true,
      json: {
        error: {
          kind: 'connection',
          status: null,
          body: {
            title: 'Workspace Brain Connection Failed',
            cause: 'ECONNRESET',
          },
        },
      },
    });
  });

  it('preserves ENOTFOUND on a real DNS resolution failure', async () => {
    const result = await call(
      'list_publications',
      {},
      new WorkspaceBrainClient({
        baseUrl: 'http://workspace-brain.invalid:3000',
        timeoutMs: 10_000,
      }),
    );
    expect(result).toMatchObject({
      isError: true,
      json: {
        error: {
          kind: 'connection',
          status: null,
          body: {
            title: 'Workspace Brain Connection Failed',
            cause: 'ENOTFOUND',
            phase: 'response',
          },
        },
      },
    });
  });

  it('never exposes credentials or stack traces in transport errors', async () => {
    const failingFetch: typeof fetch = () =>
      Promise.reject(new TypeError('fetch failed'));
    const result = await call(
      'list_publications',
      {},
      new WorkspaceBrainClient({
        baseUrl: 'http://admin:s3cret@brain:3000',
        fetch: failingFetch,
      }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).not.toContain('s3cret');
    expect(result.text).not.toContain('admin');
    expect(result.text).not.toMatch(/\bat .*\(.*:\d+:\d+\)/);
    expect(result.json).toMatchObject({
      error: {
        kind: 'connection',
        body: { url: 'http://brain:3000/api/v1/knowledge/publications' },
      },
    });
  });

  it('preserves nested codes such as ENOTFOUND', async () => {
    const failingFetch: typeof fetch = () =>
      Promise.reject(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('getaddrinfo ENOTFOUND brain'), {
            code: 'ENOTFOUND',
          }),
        }),
      );
    const result = await call(
      'list_publications',
      {},
      new WorkspaceBrainClient({
        baseUrl: 'http://brain:3000',
        fetch: failingFetch,
      }),
    );
    expect(result.json).toMatchObject({
      error: {
        kind: 'connection',
        body: {
          cause: 'ENOTFOUND',
          detail:
            'The Workspace Brain API could not be reached or the connection was interrupted.',
        },
      },
    });
  });

  it('rejects identifiers that would alter the request path', async () => {
    const result = await call('get_entity', { entityId: '../sources' });
    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
    expect(() =>
      new WorkspaceBrainClient({ baseUrl }).getPublishedEntity(
        PUB,
        '../sources',
      ),
    ).toThrow(/entityId/);
  });
});

describe('Journey tool payloads', () => {
  it('returns publication-pinned Journey records with provenance and boundaries', async () => {
    const published = {
      publicationId: PUB,
      journeyEntityId: ENT,
      journeyId: JOURNEY,
      sourceEvidenceIds: [REL],
      journey: {
        id: JOURNEY,
        name: 'GET /subscriptions (static candidate)',
        confidence: 'derived',
        completeness: 'partial',
        sourceServices: ['services.SubscriptionService'],
        entityReferences: [
          {
            entityKey: 'module:service-candidate',
            role: 'service',
            label: 'Candidate service name',
            entityId: ENT,
            entityType: 'module',
            displayName: 'services.SubscriptionService',
            publicationId: PUB,
          },
        ],
        relationshipReferences: [
          {
            relationshipKey: 'USES:journey->service',
            type: 'USES',
            relationshipId: REL,
            sourceEntityId: PUB2,
            targetEntityId: ENT,
            publicationId: PUB,
          },
        ],
        steps: [
          {
            id: 'unresolved-1',
            type: 'UnresolvedCallStep',
            order: 'source-order',
            evidenceBasis: 'unresolved',
            provenance: [],
          },
        ],
        transitions: [],
        provenance: [{ id: REL, kind: 'evidence', label: 'source file' }],
        unresolvedBoundaries: [
          {
            key: 'unresolved-1',
            target: 'service.accept()',
            reason: 'unresolved',
          },
        ],
      },
    };
    const page = { items: [published], nextCursor: null };
    routes.set('/api/v1/search/journeys', json(200, page));
    routes.set(
      `/api/v1/knowledge/publications/${PUB}/journeys/${JOURNEY}`,
      json(200, published),
    );

    const search = await call('get_service_journeys', {
      service: 'services.SubscriptionService',
      publicationId: PUB,
    });
    const retrieve = await call('get_journey', {
      publicationId: PUB,
      journeyId: JOURNEY,
    });

    expect(search.json).toEqual(page);
    expect(retrieve.json).toEqual(published);
    expect(search.isError).toBe(false);
    expect(retrieve.isError).toBe(false);
    routes.set(
      `/api/v1/knowledge/publications/${PUB}/entities/${ENT}`,
      json(200, {
        publicationId: PUB,
        entity: {
          id: ENT,
          type: 'module',
          name: 'services.SubscriptionService',
        },
      }),
    );
    routes.set(
      `/api/v1/knowledge/publications/${PUB}/entities/${ENT}/relationships`,
      json(200, { items: [], nextCursor: null }),
    );
    const compact = await call('search_journeys', { publicationId: PUB });
    expect(compact.isError).toBe(false);
    expect(compact.json).toMatchObject({
      items: [
        {
          journey: {
            entityReferences: [
              {
                entityId: ENT,
                entityType: 'module',
                displayName: 'services.SubscriptionService',
                publicationId: PUB,
                role: 'service',
              },
            ],
            relationshipReferences: [
              { relationshipId: REL, type: 'USES', publicationId: PUB },
            ],
          },
        },
      ],
    });
    const reference = published.journey.entityReferences[0]!;
    const entityResult = await call('get_published_entity', {
      publicationId: reference.publicationId,
      entityId: reference.entityId,
    });
    await call('list_relationships_for_entity', {
      publicationId: reference.publicationId,
      entityId: reference.entityId,
    });
    expect(entityResult.json).toMatchObject({
      publicationId: PUB,
      entity: { id: ENT },
    });
    expect(requests.at(-1)).toMatchObject({
      path: `/api/v1/knowledge/publications/${PUB}/entities/${ENT}/relationships`,
    });
  });
});

describe('publication-bound multi-step workflows', () => {
  it('keeps a "latest" provenance workflow on one concrete publication', async () => {
    const latest = {
      id: PUB,
      knowledgeModelId: MODEL,
      version: 664,
      entityVersionIds: [],
      relationshipVersionIds: [],
    };
    routes.set(
      `/api/v1/knowledge/models/${MODEL}/publications/latest`,
      json(200, latest),
    );
    routes.set(
      '/api/v1/search/entities',
      json(200, {
        items: [
          {
            entityId: ENT,
            modelId: MODEL,
            publicationId: PUB,
            name: 'agent-subscription',
          },
        ],
        nextCursor: null,
      }),
    );
    routes.set(
      `/api/v1/knowledge/publications/${PUB}/entities/${ENT}/relationships`,
      json(200, { publicationId: PUB, items: [{ id: REL }], nextCursor: null }),
    );

    const mcp = await connect();
    try {
      const pinned = (
        await invoke(mcp, 'get_latest_publication', { knowledgeModelId: MODEL })
      ).json as { id: string };
      const publicationId = pinned.id;
      const search = (
        await invoke(mcp, 'search_entities', {
          query: 'subscription',
          publicationId,
        })
      ).json as { items: { entityId: string }[] };
      const entityId = search.items[0]!.entityId;
      const entity = await invoke(mcp, 'get_published_entity', {
        publicationId,
        entityId,
      });
      await invoke(mcp, 'get_entity_provenance', { publicationId, entityId });
      const relationships = (
        await invoke(mcp, 'list_relationships_for_entity', {
          publicationId,
          entityId,
          direction: 'incoming',
        })
      ).json as { items: { id: string }[] };
      const relationshipId = relationships.items[0]!.id;
      const relationship = await invoke(mcp, 'get_published_relationship', {
        publicationId,
        relationshipId,
      });
      await invoke(mcp, 'get_relationship_provenance', {
        publicationId,
        relationshipId,
      });
      await invoke(mcp, 'get_publication_export_metadata', { publicationId });
      await invoke(mcp, 'export_publication', { publicationId });

      expect(entity.json).toEqual({
        echo: `/api/v1/knowledge/publications/${PUB}/entities/${ENT}`,
      });
      expect(relationship.json).toEqual({
        echo: `/api/v1/knowledge/publications/${PUB}/relationships/${REL}`,
      });
    } finally {
      await mcp.close();
    }

    const [first, ...rest] = requests;
    expect(first?.path).toBe(
      `/api/v1/knowledge/models/${MODEL}/publications/latest`,
    );
    for (const request of rest) {
      expect(
        request.path.startsWith(`/api/v1/knowledge/publications/${PUB}/`) ||
          request.query.publicationId === PUB,
      ).toBe(true);
    }
    expect(
      requests.some((r) => r.path.startsWith('/api/v1/knowledge/entities/')),
    ).toBe(false);
    expect(
      requests.some((r) =>
        r.path.startsWith('/api/v1/knowledge/relationships/'),
      ),
    ).toBe(false);
    expect(
      requests.some((r) => r.path === '/api/v1/knowledge/publications'),
    ).toBe(false);
  });

  it('keeps a version comparison workflow on concrete publication IDs', async () => {
    const mcp = await connect();
    try {
      await invoke(mcp, 'compare_publications', {
        publicationId: PUB,
        otherPublicationId: PUB2,
      });
      await invoke(mcp, 'search_entities', {
        query: 'agent',
        publicationId: PUB2,
      });
    } finally {
      await mcp.close();
    }
    expect(requests).toEqual([
      {
        method: 'GET',
        path: `/api/v1/knowledge/publications/${PUB}/diff/${PUB2}`,
        query: {},
      },
      {
        method: 'GET',
        path: '/api/v1/search/entities',
        query: { query: 'agent', publicationId: PUB2 },
      },
    ]);
  });
});

describe('list_publications compaction', () => {
  it('replaces version-ID arrays with counts and keeps authoritative fields', async () => {
    const publication = {
      id: PUB,
      knowledgeModelId: MODEL,
      version: 5,
      schemaVersion: 2,
      status: 'published',
      contentHash: 'abc',
      entityVersionIds: ['a', 'b', 'c'],
      relationshipVersionIds: ['d'],
      publishedAt: '2026-01-01T00:00:00.000Z',
    };
    routes.set(
      '/api/v1/knowledge/publications',
      json(200, {
        items: [publication, { unexpected: true }],
        nextCursor: 'next',
      }),
    );
    const result = await call('list_publications', {
      knowledgeModelId: MODEL,
      limit: 2,
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        path: '/api/v1/knowledge/publications',
        query: { knowledgeModelId: MODEL, limit: '2' },
      },
    ]);
    expect(result.json).toEqual({
      items: [
        {
          id: PUB,
          knowledgeModelId: MODEL,
          version: 5,
          schemaVersion: 2,
          status: 'published',
          contentHash: 'abc',
          publishedAt: '2026-01-01T00:00:00.000Z',
          entityCount: 3,
          relationshipCount: 1,
        },
        { unexpected: true },
      ],
      nextCursor: 'next',
    });
  });
});

describe('createClientFromEnv', () => {
  it('defaults to localhost:3000', () => {
    expect(createClientFromEnv({}).baseUrl).toBe('http://localhost:3000');
  });

  it('honours WORKSPACE_BRAIN_API_URL', () => {
    expect(
      createClientFromEnv({ WORKSPACE_BRAIN_API_URL: 'http://brain:8080/' })
        .baseUrl,
    ).toBe('http://brain:8080');
  });

  it('rejects an invalid timeout', () => {
    expect(() =>
      createClientFromEnv({ WORKSPACE_BRAIN_API_TIMEOUT_MS: 'soon' }),
    ).toThrow(/WORKSPACE_BRAIN_API_TIMEOUT_MS/);
  });
});
