import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceBrainClient } from '../client/workspace-brain-client.js';
import { createWorkspaceBrainMcpServer } from '../create-server.js';
import {
  runSmoke,
  SmokeFailure,
  type Connection,
  type SmokeScenario,
} from './smoke.js';

let api: Server;
let apiUrl: string;
let publications: unknown[] = [];

beforeAll(async () => {
  api = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/ready') {
      send(200, { status: 'ready' });
    } else if (url.pathname === '/api/v1/knowledge/publications') {
      send(200, { items: publications, nextCursor: null });
    } else if (url.pathname.endsWith('/summary')) {
      send(200, {
        publication: { id: url.pathname.split('/')[5] },
        entityCount: 1,
      });
    } else {
      send(404, { title: 'Not Found' });
    }
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

function inMemory(server: McpServer): () => Connection {
  return () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    void server.connect(serverTransport);
    return { transport: clientTransport };
  };
}

function realServer(baseUrl: string): McpServer {
  return createWorkspaceBrainMcpServer(
    new WorkspaceBrainClient({ baseUrl, timeoutMs: 2000 }),
  );
}

function run(scenario: SmokeScenario, server: McpServer, url = apiUrl) {
  return runSmoke({
    scenario,
    connect: inMemory(server),
    apiUrl: url,
    failureBoundMs: 5000,
  });
}

describe('runSmoke', () => {
  it('passes against an API with publications and re-reads the record', async () => {
    publications = [
      { id: 'PUB1', entityVersionIds: ['a'], relationshipVersionIds: [] },
    ];
    const report = await run('happy', realServer(apiUrl));
    expect(report.serverName).toBe('workspace-brain');
    expect(report.toolCount).toBeGreaterThan(0);
    expect(report.evidence).toContain('PUB1');
  });

  it('accepts an empty catalogue but still validates the page shape', async () => {
    publications = [];
    const report = await run('happy', realServer(apiUrl));
    expect(report.evidence).toContain('empty page');
  });

  it('fails the api-connectivity stage when /ready is unreachable', async () => {
    await expect(
      run('happy', realServer(apiUrl), 'http://127.0.0.1:9'),
    ).rejects.toMatchObject({ stage: 'api-connectivity' });
  });

  it('fails tool-discovery when expected tools are missing', async () => {
    const bare = new McpServer({ name: 'workspace-brain', version: '0' });
    bare.registerTool('only_tool', {}, () => ({ content: [] }));
    await expect(run('happy', bare)).rejects.toMatchObject({
      stage: 'tool-discovery',
    });
  });

  it('fails initialisation on the wrong server identity', async () => {
    const other = new McpServer({ name: 'something-else', version: '0' });
    await expect(run('happy', other)).rejects.toMatchObject({
      stage: 'initialisation',
    });
  });

  it('surfaces invalid input as an error and stays available', async () => {
    const report = await run('bad-input', realServer(apiUrl));
    expect(report.evidence.length).toBeGreaterThan(0);
  });

  it('reports an unreachable API as a structured tool error', async () => {
    const report = await run(
      'api-down',
      realServer('http://127.0.0.1:9'),
      'http://127.0.0.1:9',
    );
    expect(JSON.parse(report.evidence)).toMatchObject({
      error: { kind: expect.any(String) },
    });
  });

  it('fails api-down if the tool succeeds against a reachable API', async () => {
    await expect(run('api-down', realServer(apiUrl))).rejects.toBeInstanceOf(
      SmokeFailure,
    );
  });

  it('detects secrets leaking into output', async () => {
    await expect(
      runSmoke({
        scenario: 'api-down',
        connect: inMemory(realServer('http://127.0.0.1:9')),
        apiUrl: 'http://127.0.0.1:9',
        // The failure envelope contains the unreachable URL.
        secrets: ['127.0.0.1'],
        failureBoundMs: 5000,
      }),
    ).rejects.toThrow(/sensitive/);
  });
});
