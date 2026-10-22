/* global fetch, AbortSignal */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import console from 'node:console';

// Bound the benchmark process, including native DB work.
const size = Number(process.argv[2] ?? 200);
assert.ok(Number.isSafeInteger(size) && size > 0 && size <= 500);
if (process.argv[3] !== '--child') {
  const result = spawnSync(
    process.execPath,
    [process.argv[1], String(size), '--child'],
    {
      stdio: 'inherit',
      timeout: 120_000,
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0);
} else {
  const { createDuckDbCatalogue } =
    await import('../infrastructure/duckdb/dist/index.js');
  const { FilesystemSourceScanner } =
    await import('../infrastructure/filesystem/dist/index.js');
  const { processDocument } =
    await import('../packages/processing-core/dist/index.js');
  const { extractKnowledgeReport } =
    await import('../apps/knowledge-worker/dist/knowledge-extractors.js');
  const { createApiServer } =
    await import('../apps/workspace-brain-api/dist/server.js');
  const require = createRequire(
    new URL('../apps/workspace-brain-mcp/package.json', import.meta.url),
  );
  const { Client } = await import(
    require.resolve('@modelcontextprotocol/sdk/client/index.js')
  );
  const { StdioClientTransport } = await import(
    require.resolve('@modelcontextprotocol/sdk/client/stdio.js')
  );
  const directory = await mkdtemp(join(tmpdir(), 'brain-mcp-retrieval-'));
  let catalogue, api, client, transport;
  const reads = [];
  try {
    const root = join(directory, 'source');
    await mkdir(root);
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: '@fixture/service',
        dependencies: Object.fromEntries(
          Array.from({ length: size }, (_, i) => [`dependency-${i}`, '^1']),
        ),
      }),
    );
    catalogue = await createDuckDbCatalogue(
      join(directory, 'catalogue.duckdb'),
      resolve('infrastructure/duckdb/migrations'),
    );
    await catalogue.registerConfiguration(
      [
        {
          configId: 'retrieval',
          name: 'Retrieval fixture',
          rootPaths: [root],
          excludeDirs: [],
          includeExtensions: ['.json'],
          maxFileSizeBytes: 1024 * 1024,
        },
      ],
      [
        {
          configId: 'retrieval',
          name: 'Retrieval fixture',
          sourceConfigIds: ['retrieval'],
          include: ['**'],
          exclude: [],
        },
      ],
    );
    const source = (await catalogue.listSourcesForDiscovery({ limit: 1 }))
      .items[0];
    const scan = await new FilesystemSourceScanner().scan(source);
    const inventory = await catalogue.persistScan(
      source.sourceId,
      scan.repositories,
      scan.documents,
      scan.discoveredAt,
      randomUUID(),
      1,
    );
    const document = inventory.documents[0];
    const processed = processDocument(
      document.filename,
      await readFile(join(root, 'package.json'), 'utf8'),
      'package.json',
    );
    const envelope = () => ({
      eventId: randomUUID(),
      eventVersion: 1,
      producer: 'workspace-brain-knowledge-worker',
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      partitionKey: source.sourceId,
    });
    const result = await catalogue.applyDocumentProcessing({
      ...envelope(),
      eventType: 'DocumentProcessingSubmitted',
      payload: {
        candidate: {
          documentId: document.id,
          sourceId: source.sourceId,
          path: document.path,
          contentFingerprint: document.fingerprint,
          processedAt: new Date().toISOString(),
          durationMilliseconds: 1,
          ...processed,
        },
      },
    });
    const inputs = await catalogue.listKnowledgeInputEvidence(
      result.documentVersion.id,
    );
    const extraction = extractKnowledgeReport(inputs);
    await catalogue.applyKnowledgeCandidates({
      ...envelope(),
      eventType: 'KnowledgeCandidatesSubmitted',
      payload: {
        sourceId: source.sourceId,
        documentId: document.id,
        documentVersionId: result.documentVersion.id,
        ...extraction.candidates,
      },
    });
    await catalogue.rebuildSearchProjections({
      mode: 'missing',
      correlationId: randomUUID(),
    });
    const model = (await catalogue.listKnowledgeModels({ limit: 1 })).items[0];
    const publication = await catalogue.getLatestKnowledgePublication(model.id);
    const snapshot = await catalogue.getPublicationSnapshot(publication.id);
    const entity = snapshot.entities.find(
      ({ entity }) => entity.name === '@fixture/service',
    ).entity;
    const exportBefore = JSON.stringify(
      await catalogue.getKnowledgePublicationExport(publication.id),
    );
    const measuredCatalogue = new Proxy(catalogue, {
      get(target, key) {
        const value = target[key];
        if (typeof value !== 'function') return value;
        return async (...args) => {
          const start = performance.now();
          try {
            return await value.apply(target, args);
          } finally {
            reads.push({ method: key, ms: performance.now() - start });
          }
        };
      },
    });
    api = createApiServer(measuredCatalogue, { logger: false });
    const baseUrl = await api.listen({ host: '127.0.0.1', port: 0 });
    client = new Client({ name: 'retrieval-benchmark', version: '1' });
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('apps/workspace-brain-mcp/dist/server.js')],
      env: { PATH: process.env.PATH, WORKSPACE_BRAIN_API_URL: baseUrl },
      stderr: 'pipe',
    });
    const coldStart = performance.now();
    await client.connect(transport, { timeout: 10_000 });
    const coldInitMs = performance.now() - coldStart;
    const discoveryStart = performance.now();
    const tools = await client.listTools();
    const discoveryMs = performance.now() - discoveryStart;
    const pubPath = `/api/v1/knowledge/publications/${publication.id}`;
    const cases = [
      [
        'list_publications',
        { limit: 1 },
        '/api/v1/knowledge/publications?limit=1',
      ],
      [
        'get_latest_publication',
        { knowledgeModelId: model.id },
        `/api/v1/knowledge/models/${model.id}/publications/latest`,
      ],
      [
        'get_publication_summary',
        { publicationId: publication.id },
        `${pubPath}/summary`,
      ],
      [
        'search_entities',
        { query: 'dependency', publicationId: publication.id, limit: 10 },
        `/api/v1/search/entities?query=dependency&publicationId=${publication.id}&limit=10`,
      ],
      [
        'get_published_entity',
        { publicationId: publication.id, entityId: entity.id },
        `${pubPath}/entities/${entity.id}`,
      ],
      [
        'list_relationships_for_entity',
        { publicationId: publication.id, entityId: entity.id, limit: 10 },
        `${pubPath}/entities/${entity.id}/relationships?limit=10`,
      ],
      [
        'get_entity_provenance',
        { publicationId: publication.id, entityId: entity.id, limit: 10 },
        `${pubPath}/entities/${entity.id}/provenance?limit=10`,
      ],
    ];
    const measurements = [];
    const cpuStart = process.cpuUsage();
    for (const [name, args, path] of cases) {
      for (const via of ['HTTP', 'MCP']) {
        const samples = [],
          catalogueMs = [],
          bytes = [],
          serializationMs = [];
        for (let repeat = 0; repeat < 3; repeat++) {
          reads.length = 0;
          const start = performance.now();
          const response =
            via === 'HTTP'
              ? await fetch(`${baseUrl}${path}`, {
                  signal: AbortSignal.timeout(15_000),
                }).then(async (r) => {
                  assert.equal(r.status, 200);
                  return r.text();
                })
              : await client
                  .callTool({ name, arguments: args }, undefined, {
                    timeout: 15_000,
                  })
                  .then((r) => {
                    assert.notEqual(r.isError, true);
                    return r.content[0].text;
                  });
          samples.push(performance.now() - start);
          catalogueMs.push(reads.reduce((sum, read) => sum + read.ms, 0));
          bytes.push(Buffer.byteLength(response));
          const parsed = JSON.parse(response);
          const serialStart = performance.now();
          JSON.stringify(parsed);
          serializationMs.push(performance.now() - serialStart);
          assert.ok(
            response.includes(publication.id),
            `${name} publication reference missing`,
          );
        }
        const median = (values) => [...values].sort((a, b) => a - b)[1];
        measurements.push({
          name,
          via,
          elapsedMs: median(samples),
          rangeMs: [Math.min(...samples), Math.max(...samples)],
          catalogueMs: median(catalogueMs),
          bytes: bytes[0],
          jsonStringifyMs: median(serializationMs),
        });
      }
    }
    assert.equal(
      JSON.stringify(
        await catalogue.getKnowledgePublicationExport(publication.id),
      ),
      exportBefore,
    );
    console.log(
      JSON.stringify(
        {
          size,
          entities: snapshot.entities.length,
          relationships: snapshot.relationships.length,
          evidence: inputs.length,
          coldInitMs,
          discoveryMs,
          tools: tools.tools.length,
          measurements,
          cpuMs: Object.fromEntries(
            Object.entries(process.cpuUsage(cpuStart)).map(([key, us]) => [
              key,
              us / 1000,
            ]),
          ),
          maxRssMiB: process.resourceUsage().maxRSS / 1024,
          immutableExport: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await client?.close();
    await transport?.close();
    await api?.close();
    await catalogue?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
