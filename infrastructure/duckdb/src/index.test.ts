import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { DuckDBInstance } from '@duckdb/node-api';
import type { DiscoveryEvent } from '@workspace-brain/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { createDuckDbCatalogue } from './index.js';

const migrationsDirectory = resolve(
  process.cwd(),
  'infrastructure/duckdb/migrations',
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createProcessingEvent(
  candidate: Extract<
    DiscoveryEvent,
    { readonly eventType: 'DocumentProcessingSubmitted' }
  >['payload']['candidate'],
  eventId: string,
): Extract<
  DiscoveryEvent,
  { readonly eventType: 'DocumentProcessingSubmitted' }
> {
  return {
    eventId,
    eventType: 'DocumentProcessingSubmitted',
    eventVersion: 1,
    occurredAt: candidate.processedAt,
    producer: 'workspace-brain-knowledge-worker',
    correlationId: 'evidence-correlation',
    idempotencyKey: `processing:${eventId}`,
    partitionKey: candidate.sourceId,
    payload: { candidate },
  };
}

describe('DuckDB catalogue migrations', () => {
  it('runs and safely reapplies initial migrations for schema, sources, and workspaces', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workspace-brain-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'catalogue.duckdb');

    const first = await createDuckDbCatalogue(
      databasePath,
      migrationsDirectory,
    );
    await expect(first.check()).resolves.toBeUndefined();
    expect((await first.listSources({ limit: 10 })).items).toEqual([]);
    expect((await first.listWorkspaces({ limit: 10 })).items).toEqual([]);
    await first.close();

    const writer = await DuckDBInstance.create(databasePath);
    const writerConnection = await writer.connect();
    const sourceId = '01K6JQ3Z5JY0N0WZ3MEGFS9WH0';
    const workspaceId = '01K6JQ3Z5JY0N0WZ3MEGFS9WH1';
    await writerConnection.run(
      'INSERT INTO sources (id, name, provider_type, config_json, created_at) VALUES ($1, $2, $3, $4, $5)',
      [
        sourceId,
        'Projects',
        'filesystem',
        JSON.stringify({ containerPaths: ['/sources/projects'] }),
        '2026-10-01T12:00:00.000Z',
      ],
    );
    await writerConnection.run(
      'INSERT INTO workspaces (id, name, description, config_json, created_at) VALUES ($1, $2, $3, $4, $5)',
      [
        workspaceId,
        'Product',
        'Project knowledge',
        JSON.stringify({ sourceIds: [sourceId] }),
        '2026-10-01T12:00:00.000Z',
      ],
    );
    writerConnection.closeSync();
    writer.closeSync();

    const second = await createDuckDbCatalogue(
      databasePath,
      migrationsDirectory,
    );
    await expect(second.check()).resolves.toBeUndefined();
    expect((await second.listSources({ limit: 10 })).items).toEqual([
      expect.objectContaining({
        id: sourceId,
        name: 'Projects',
        type: 'filesystem',
        containerPaths: ['/sources/projects'],
      }),
    ]);
    expect((await second.listWorkspaces({ limit: 10 })).items).toEqual([
      expect.objectContaining({
        id: workspaceId,
        name: 'Product',
        description: 'Project knowledge',
        sourceIds: [sourceId],
      }),
    ]);
    await second.close();

    const instance = await DuckDBInstance.create(databasePath);
    const connection = await instance.connect();
    const tables = await connection.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name",
    );
    expect(tables.getRowObjectsJson().map((row) => row.table_name)).toEqual([
      'discovery_history',
      'discovery_outbox',
      'document_processing_runs',
      'document_versions',
      'documents',
      'extracted_evidence',
      'inventory_records',
      'repositories',
      'schema_migrations',
      'source_scan_runs',
      'sources',
      'workspaces',
    ]);
    connection.closeSync();
    instance.closeSync();
  });

  it('keeps inventory and completion events pending across retries and catalogue restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workspace-brain-outbox-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'catalogue.duckdb');
    const catalogue = await createDuckDbCatalogue(
      databasePath,
      migrationsDirectory,
    );
    await catalogue.registerConfiguration(
      [
        {
          configId: 'outbox-source',
          name: 'Outbox Source',
          rootPaths: [join(directory, 'source')],
          excludeDirs: [],
          includeExtensions: ['.md'],
          maxFileSizeBytes: 1024,
        },
      ],
      [],
    );
    const source = (await catalogue.listSources({ limit: 10 })).items[0];
    const root = source?.roots?.[0];
    if (source === undefined || root === undefined) {
      throw new Error('Outbox source registration failed');
    }
    const discoveredAt = '2026-10-02T10:00:00.000Z';
    const candidate = {
      path: `${root.id}/README.md`,
      filename: 'README.md',
      extension: '.md',
      sizeBytes: 12,
      modifiedAt: discoveredAt,
      fingerprint: 'a'.repeat(64),
      discoveryMethod: 'filesystem' as const,
    };

    await catalogue.recordScanStarted(source.id, 'outbox-scan', discoveredAt);
    await catalogue.persistScan(
      source.id,
      [],
      [candidate],
      discoveredAt,
      'outbox-scan',
      100,
    );
    await catalogue.persistScan(
      source.id,
      [],
      [candidate],
      discoveredAt,
      'outbox-scan',
      100,
    );
    const firstPending = await catalogue.listPendingDiscoveryEvents(10);
    expect(firstPending.map(({ eventType }) => eventType)).toEqual([
      'DocumentDiscovered',
      'SourceScanCompleted',
    ]);
    expect(firstPending[1]?.payload).toMatchObject({
      addedCount: 1,
      unchangedCount: 0,
      durationMilliseconds: 100,
    });
    await catalogue.close();

    const restarted = await createDuckDbCatalogue(
      databasePath,
      migrationsDirectory,
    );
    const recovered = await restarted.listPendingDiscoveryEvents(10);
    expect(recovered).toEqual(firstPending);
    const discoveredEvent = recovered.find(
      ({ eventType }) => eventType === 'DocumentDiscovered',
    );
    if (discoveredEvent === undefined) {
      throw new Error('Document discovery event was not in the outbox');
    }
    await restarted.markDiscoveryEventPublished(
      discoveredEvent.eventId,
      '2026-10-02T10:00:02.000Z',
    );
    expect(await restarted.listPendingDiscoveryEvents(10)).toEqual([
      expect.objectContaining({ eventType: 'SourceScanCompleted' }),
    ]);
    await restarted.close();
  });

  it('serializes concurrent writes while persisting immutable evidence idempotently', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'workspace-brain-evidence-'),
    );
    temporaryDirectories.push(directory);
    const catalogue = await createDuckDbCatalogue(
      join(directory, 'catalogue.duckdb'),
      migrationsDirectory,
    );
    await catalogue.registerConfiguration(
      [
        {
          configId: 'evidence-source',
          name: 'Evidence Source',
          rootPaths: [join(directory, 'source')],
          excludeDirs: [],
          includeExtensions: ['.md'],
          maxFileSizeBytes: 1024,
        },
      ],
      [],
    );
    const source = (await catalogue.listSources({ limit: 10 })).items[0];
    const root = source?.roots?.[0];
    if (source === undefined || root === undefined) {
      throw new Error('Evidence source registration failed');
    }
    const discoveredAt = '2026-10-02T10:00:00.000Z';
    const content = '# Evidence\n\nA deterministic fact.';
    const fingerprint = createHash('sha256').update(content).digest('hex');
    const scan = await catalogue.persistScan(
      source.id,
      [],
      [
        {
          path: `${root.id}/README.md`,
          filename: 'README.md',
          extension: '.md',
          sizeBytes: Buffer.byteLength(content),
          modifiedAt: discoveredAt,
          fingerprint,
          discoveryMethod: 'filesystem',
        },
      ],
      discoveredAt,
      'evidence-scan',
      10,
    );
    const document = scan.documents[0];
    if (document === undefined) {
      throw new Error('Evidence fixture document was not persisted');
    }
    const candidate = {
      documentId: document.id,
      sourceId: source.id,
      path: document.path,
      contentFingerprint: fingerprint,
      processedAt: '2026-10-02T10:00:01.000Z',
      durationMilliseconds: 12,
      processorId: 'markdown',
      processorVersion: 1,
      extractionRuleId: 'markdown-blocks',
      extractionRuleVersion: 1,
      evidence: [
        {
          key: 'markdown:1:heading',
          kind: 'heading' as const,
          excerpt: 'Evidence',
          truncated: false,
          locator: {
            kind: 'markdown-lines' as const,
            lineStart: 1,
            lineEnd: 1,
          },
        },
      ],
    };
    const event = createProcessingEvent(candidate, 'processing-event-1');

    await expect(
      catalogue.applyDocumentProcessing(
        createProcessingEvent(
          {
            ...candidate,
            extractionRuleId: 'json-scalar-values',
          },
          'processing-invalid-processor',
        ),
      ),
    ).rejects.toThrow('Invalid document processing submission');
    await expect(
      catalogue.applyDocumentProcessing(
        createProcessingEvent(
          {
            ...candidate,
            processorId: 'json',
            extractionRuleId: 'json-scalar-values',
            evidence: [
              {
                key: 'json:invalid-pointer',
                kind: 'structured-value',
                excerpt: 'value',
                truncated: false,
                locator: { kind: 'json-pointer', pointer: 'invalid' },
              },
            ],
          },
          'processing-invalid-pointer',
        ),
      ),
    ).rejects.toThrow('Invalid document processing submission');

    const [first] = await Promise.all([
      catalogue.applyDocumentProcessing(event),
      catalogue.persistScan(
        source.id,
        [],
        [
          {
            path: document.path,
            filename: document.filename,
            extension: document.extension,
            sizeBytes: document.sizeBytes,
            modifiedAt: document.modifiedAt,
            fingerprint,
            discoveryMethod: 'filesystem',
          },
        ],
        discoveredAt,
        'evidence-concurrent-scan',
        10,
      ),
    ]);
    const replay = await catalogue.applyDocumentProcessing(event);
    const sameFingerprint = await catalogue.applyDocumentProcessing(
      createProcessingEvent(candidate, 'processing-event-2'),
    );

    expect(first.duplicate).toBe(false);
    expect(first.documentVersion.documentId).toBe(document.id);
    expect(first.documentVersion.contentHash).toBe(fingerprint);
    expect(first.evidence).toHaveLength(1);
    expect(replay.duplicate).toBe(true);
    expect(replay.evidence.map(({ id }) => id)).toEqual(
      first.evidence.map(({ id }) => id),
    );
    expect(sameFingerprint.duplicate).toBe(true);
    expect(
      (await catalogue.listDocumentEvidence(document.id, { limit: 20 })).items,
    ).toEqual(first.evidence);
    const explanation = await catalogue.explainEvidence(
      String(first.evidence[0]?.id),
    );
    expect(explanation).toMatchObject({
      document: {
        id: document.id,
        sourceId: source.id,
        path: document.path,
        fingerprint,
      },
      provenance: {
        provider: 'filesystem',
        contentFingerprint: fingerprint,
        processorId: 'markdown',
        extractionRuleId: 'markdown-blocks',
      },
    });
    const pending = await catalogue.listPendingDiscoveryEvents(100);
    expect(
      pending.filter(({ eventType }) => eventType === 'DocumentExtracted'),
    ).toHaveLength(1);

    await expect(
      catalogue.applyDocumentProcessing(
        createProcessingEvent(
          {
            ...candidate,
            evidence: [
              {
                ...candidate.evidence[0],
                excerpt: 'altered',
              },
            ],
          },
          'processing-event-1',
        ),
      ),
    ).rejects.toThrow('reused with a different payload');

    await catalogue.persistScan(
      source.id,
      [],
      [
        {
          path: document.path,
          filename: document.filename,
          extension: document.extension,
          sizeBytes: document.sizeBytes,
          modifiedAt: discoveredAt,
          fingerprint: 'c'.repeat(64),
          discoveryMethod: 'filesystem',
        },
      ],
      discoveredAt,
      'evidence-scan-modified',
      10,
    );
    await expect(
      catalogue.applyDocumentProcessing(
        createProcessingEvent(candidate, 'processing-event-3'),
      ),
    ).rejects.toThrow('does not match the current catalogue document');

    const changedContent = '# Updated evidence';
    const changedFingerprint = createHash('sha256')
      .update(changedContent)
      .digest('hex');
    await catalogue.persistScan(
      source.id,
      [],
      [
        {
          path: document.path,
          filename: document.filename,
          extension: document.extension,
          sizeBytes: Buffer.byteLength(changedContent),
          modifiedAt: discoveredAt,
          fingerprint: changedFingerprint,
          discoveryMethod: 'filesystem',
        },
      ],
      discoveredAt,
      'evidence-scan-updated',
      10,
    );
    const changed = await catalogue.applyDocumentProcessing(
      createProcessingEvent(
        {
          ...candidate,
          contentFingerprint: changedFingerprint,
          processedAt: '2026-10-02T10:00:02.000Z',
          evidence: [
            {
              key: 'markdown:1:heading',
              kind: 'heading',
              excerpt: 'Updated evidence',
              truncated: false,
              locator: {
                kind: 'markdown-lines',
                lineStart: 1,
                lineEnd: 1,
              },
            },
          ],
        },
        'processing-event-4',
      ),
    );
    expect(changed.duplicate).toBe(false);
    expect(changed.documentVersion.id).not.toBe(first.documentVersion.id);
    expect(
      (await catalogue.listDocumentEvidence(document.id, { limit: 20 })).items,
    ).toHaveLength(2);
    expect(
      (await catalogue.listDocumentEvidence(document.id, { limit: 101 })).items,
    ).toHaveLength(2);
    await catalogue.close();
  });

  it('registers source roots and workspaces, then persists filterable discovery metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workspace-brain-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'catalogue.duckdb');
    const catalogue = await createDuckDbCatalogue(
      databasePath,
      migrationsDirectory,
    );
    const configuredSources = [
      {
        configId: 'projects',
        name: 'Projects',
        rootPaths: [join(directory, 'projects')],
        excludeDirs: ['.git', 'node_modules'],
        includeExtensions: ['.md', '.txt'],
        maxFileSizeBytes: 1024,
      },
    ];
    const configuredWorkspaces = [
      {
        configId: 'product',
        name: 'Product',
        sourceConfigIds: ['projects'],
        include: ['**'],
        exclude: ['**/node_modules/**'],
      },
    ];
    await catalogue.registerConfiguration(
      configuredSources,
      configuredWorkspaces,
    );
    const sourcePage = await catalogue.listSources({ limit: 10 });
    const workspacePage = await catalogue.listWorkspaces({ limit: 10 });
    const source = sourcePage.items[0];
    if (source === undefined) {
      throw new Error('Configured source was not registered');
    }
    expect(source.roots).toHaveLength(1);
    expect(workspacePage.items[0]?.sourceIds).toEqual([source.id]);
    expect(
      (await catalogue.listSourcesForDiscovery({ limit: 10 })).items[0],
    ).toMatchObject({
      sourceId: source.id,
      roots: source.roots,
      workspaceRules: [{ include: ['**'], exclude: ['**/node_modules/**'] }],
      excludedDirectoryNames: ['.git', 'node_modules'],
      includeExtensions: ['.md', '.txt'],
      maxFileSizeBytes: 1024,
    });
    await catalogue.registerConfiguration(
      configuredSources,
      configuredWorkspaces,
    );
    const reregisteredSource = (await catalogue.listSources({ limit: 10 }))
      .items[0];
    expect(reregisteredSource?.id).toBe(source.id);
    expect(reregisteredSource?.roots?.[0]?.id).toBe(source.roots?.[0]?.id);

    await catalogue.recordScanStarted(
      source.id,
      'correlation-one',
      '2026-10-01T12:00:00.000Z',
    );
    const repository = {
      path: `${source.roots?.[0]?.id}/repo`,
      repositoryType: 'git' as const,
      fingerprint: 'a'.repeat(64),
      discoveryMethod: 'filesystem' as const,
    };
    const document = {
      path: `${source.roots?.[0]?.id}/repo/README.md`,
      filename: 'README.md',
      extension: '.md',
      sizeBytes: 12,
      modifiedAt: '2026-10-01T11:00:00.000Z',
      fingerprint: 'b'.repeat(64),
      discoveryMethod: 'filesystem' as const,
    };
    const persisted = await catalogue.persistScan(
      source.id,
      [repository],
      [document],
      '2026-10-01T12:00:00.000Z',
      'correlation-one',
      100,
    );
    await catalogue.recordScanStarted(
      source.id,
      'correlation-one',
      '2026-10-01T12:00:00.000Z',
    );
    const repeatedSubmission = await catalogue.persistScan(
      source.id,
      [repository],
      [document],
      '2026-10-01T12:00:00.000Z',
      'correlation-one',
      100,
    );
    const rescanned = await catalogue.persistScan(
      source.id,
      [repository],
      [document],
      '2026-10-01T13:00:00.000Z',
      'correlation-two',
      100,
    );

    expect(persisted.repositories[0]).toMatchObject({
      ...repository,
      sourceId: source.id,
      discoveredAt: '2026-10-01T12:00:00.000Z',
      lastSeenAt: '2026-10-01T12:00:00.000Z',
    });
    expect(persisted.documents[0]).toMatchObject({
      ...document,
      sourceId: source.id,
      modifiedAt: '2026-10-01T11:00:00.000Z',
      discoveredAt: '2026-10-01T12:00:00.000Z',
      lastSeenAt: '2026-10-01T12:00:00.000Z',
    });
    expect(persisted.repositoryChanges.map(({ change }) => change)).toEqual([
      'added',
    ]);
    expect(persisted.documentChanges.map(({ change }) => change)).toEqual([
      'added',
    ]);
    expect(
      repeatedSubmission.repositoryChanges.map(({ change }) => change),
    ).toEqual(['unchanged']);
    expect(
      repeatedSubmission.documentChanges.map(({ change }) => change),
    ).toEqual(['unchanged']);
    expect(repeatedSubmission.repositories[0]?.id).toBe(
      persisted.repositories[0]?.id,
    );
    expect(repeatedSubmission.documents[0]?.id).toBe(
      persisted.documents[0]?.id,
    );
    await catalogue.recordScanFailed(
      source.id,
      'correlation-failed',
      '2026-10-01T12:00:02.000Z',
      2000,
      'FilesystemError',
    );
    expect(rescanned.repositories[0]?.id).toBe(persisted.repositories[0]?.id);
    expect(rescanned.documents[0]?.id).toBe(persisted.documents[0]?.id);
    expect(rescanned.documents[0]?.discoveredAt).toBe(
      persisted.documents[0]?.discoveredAt,
    );
    expect(rescanned.documents[0]?.lastSeenAt).toBe('2026-10-01T13:00:00.000Z');
    expect(rescanned.repositoryChanges.map(({ change }) => change)).toEqual([
      'unchanged',
    ]);
    expect(rescanned.documentChanges.map(({ change }) => change)).toEqual([
      'unchanged',
    ]);

    const modified = await catalogue.persistScan(
      source.id,
      [{ ...repository, fingerprint: 'c'.repeat(64) }],
      [{ ...document, fingerprint: 'd'.repeat(64) }],
      '2026-10-01T14:00:00.000Z',
      'correlation-three',
      100,
    );
    expect(modified.repositories[0]?.id).toBe(persisted.repositories[0]?.id);
    expect(modified.documents[0]?.id).toBe(persisted.documents[0]?.id);
    expect(modified.repositoryChanges.map(({ change }) => change)).toEqual([
      'modified',
    ]);
    expect(modified.documentChanges.map(({ change }) => change)).toEqual([
      'modified',
    ]);

    const removed = await catalogue.persistScan(
      source.id,
      [],
      [],
      '2026-10-01T15:00:00.000Z',
      'correlation-four',
      100,
    );
    expect(removed.repositoryChanges.map(({ change }) => change)).toEqual([
      'removed',
    ]);
    expect(removed.documentChanges.map(({ change }) => change)).toEqual([
      'removed',
    ]);
    expect(
      (await catalogue.listDocuments({ sourceId: source.id, limit: 10 })).items,
    ).toEqual([]);

    const restored = await catalogue.persistScan(
      source.id,
      [repository],
      [document],
      '2026-10-01T16:00:00.000Z',
      'correlation-five',
      100,
    );
    expect(restored.repositories[0]?.id).toBe(persisted.repositories[0]?.id);
    expect(restored.documents[0]?.id).toBe(persisted.documents[0]?.id);
    expect(restored.repositoryChanges.map(({ change }) => change)).toEqual([
      'added',
    ]);
    expect(restored.documentChanges.map(({ change }) => change)).toEqual([
      'added',
    ]);
    expect(
      (await catalogue.listRepositories({ sourceId: source.id, limit: 10 }))
        .items,
    ).toHaveLength(1);
    expect(
      (
        await catalogue.listDocuments({
          sourceId: source.id,
          extension: '.md',
          limit: 10,
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await catalogue.listDocuments({
          sourceId: source.id,
          extension: '.txt',
          limit: 10,
        })
      ).items,
    ).toEqual([]);
    await catalogue.close();

    const historyInstance = await DuckDBInstance.create(databasePath);
    const historyConnection = await historyInstance.connect();
    const history = await historyConnection.runAndReadAll(
      'SELECT event_type, count(*) AS event_count FROM discovery_history GROUP BY event_type ORDER BY event_type',
    );
    expect(
      history
        .getRowObjectsJson()
        .map((row) => [row.event_type, Number(row.event_count)]),
    ).toEqual([
      ['DocumentDiscovered', 2],
      ['DocumentModified', 1],
      ['DocumentRemoved', 1],
      ['RepositoryDiscovered', 2],
      ['RepositoryModified', 1],
      ['RepositoryRemoved', 1],
    ]);
    const scanRuns = await historyConnection.runAndReadAll(
      'SELECT correlation_id, status, repository_count, document_count, added_count, modified_count, removed_count, unchanged_count, failure_type FROM source_scan_runs ORDER BY correlation_id',
    );
    expect(
      scanRuns.getRowObjectsJson().map((row) => ({
        ...row,
        ...(row.repository_count === null
          ? {}
          : { repository_count: Number(row.repository_count) }),
        ...(row.document_count === null
          ? {}
          : { document_count: Number(row.document_count) }),
        ...(row.added_count === null
          ? {}
          : { added_count: Number(row.added_count) }),
        ...(row.modified_count === null
          ? {}
          : { modified_count: Number(row.modified_count) }),
        ...(row.removed_count === null
          ? {}
          : { removed_count: Number(row.removed_count) }),
        ...(row.unchanged_count === null
          ? {}
          : { unchanged_count: Number(row.unchanged_count) }),
      })),
    ).toEqual([
      {
        correlation_id: 'correlation-failed',
        status: 'failed',
        repository_count: null,
        document_count: null,
        added_count: null,
        modified_count: null,
        removed_count: null,
        unchanged_count: null,
        failure_type: 'FilesystemError',
      },
      {
        correlation_id: 'correlation-five',
        status: 'completed',
        repository_count: 1,
        document_count: 1,
        added_count: 2,
        modified_count: 0,
        removed_count: 0,
        unchanged_count: 0,
        failure_type: null,
      },
      {
        correlation_id: 'correlation-four',
        status: 'completed',
        repository_count: 0,
        document_count: 0,
        added_count: 0,
        modified_count: 0,
        removed_count: 2,
        unchanged_count: 0,
        failure_type: null,
      },
      {
        correlation_id: 'correlation-one',
        status: 'completed',
        repository_count: 1,
        document_count: 1,
        added_count: 2,
        modified_count: 0,
        removed_count: 0,
        unchanged_count: 0,
        failure_type: null,
      },
      {
        correlation_id: 'correlation-three',
        status: 'completed',
        repository_count: 1,
        document_count: 1,
        added_count: 0,
        modified_count: 2,
        removed_count: 0,
        unchanged_count: 0,
        failure_type: null,
      },
      {
        correlation_id: 'correlation-two',
        status: 'completed',
        repository_count: 1,
        document_count: 1,
        added_count: 0,
        modified_count: 0,
        removed_count: 0,
        unchanged_count: 2,
        failure_type: null,
      },
    ]);
    historyConnection.closeSync();
    historyInstance.closeSync();
  });
});
