import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import type {
  CatalogueDiscovery,
  CatalogueHealth,
  CataloguePage,
  CataloguePageRequest,
  ConfiguredSource,
  ConfiguredWorkspace,
  ScanPersistenceResult,
  SourceScanMetrics,
} from '@workspace-brain/catalogue';
import {
  createDocumentId,
  createRepositoryId,
  createSourceId,
  createSourceRootId,
  createWorkspaceId,
  type DiscoveryEvent,
  type DiscoverySource,
  type DocumentCandidate,
  type InventoryChange,
  type InventoryRecord,
  parseDocumentId,
  parseRepositoryId,
  parseSourceId,
  parseSourceRootId,
  parseWorkspaceId,
  type Document,
  type RepositoryCandidate,
  type Repository,
  type Source,
  type SourceRoot,
  type Workspace,
  type WorkspaceDiscoveryRules,
} from '@workspace-brain/domain';
import { z } from 'zod';

const sourceRootSchema = z
  .object({
    id: z.string(),
    sourceId: z.string(),
    absolutePath: z.string(),
  })
  .strict();

const workspaceRulesSchema = z
  .object({
    include: z.array(z.string()),
    exclude: z.array(z.string()),
  })
  .strict();

const sourceConfigurationSchema = z
  .object({
    configId: z.string().optional(),
    roots: z.array(sourceRootSchema).optional(),
    containerPaths: z.array(z.string()).optional(),
    excludeDirs: z.array(z.string()).default([]),
    includeExtensions: z.array(z.string()).default([]),
    maxFileSizeBytes: z.number().nonnegative().optional(),
    workspaceRules: z.array(workspaceRulesSchema).default([]),
  })
  .passthrough();

const workspaceConfigurationSchema = z
  .object({
    configId: z.string().optional(),
    sourceIds: z.array(z.string()),
    include: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
  })
  .passthrough();

const sourceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  config_json: z.string(),
  created_at: z.string(),
});

const workspaceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  config_json: z.string(),
  created_at: z.string(),
});

const repositoryRowSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  path: z.string(),
  repository_type: z.enum(['git', 'unknown']),
  fingerprint: z.string(),
  discovered_at: z.string(),
  last_seen_at: z.string(),
  discovery_method: z.string(),
});

const documentRowSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  path: z.string(),
  filename: z.string(),
  extension: z.string(),
  size_bytes: z.coerce.number(),
  modified_at: z.string(),
  fingerprint: z.string(),
  discovered_at: z.string(),
  last_seen_at: z.string(),
  discovery_method: z.string(),
});

const inventoryRowSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  path: z.string(),
  asset_type: z.enum(['repository', 'document']),
  fingerprint: z.string(),
  discovered_at: z.string(),
  last_seen_at: z.string(),
  is_present: z.boolean(),
});

const discoveryEventEnvelopeSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: z.enum([
      'SourceScanRequested',
      'SourceScanStarted',
      'SourceInventorySubmitted',
      'SourceScanFailed',
      'SourceScanCompleted',
      'RepositoryDiscovered',
      'RepositoryModified',
      'RepositoryRemoved',
      'DocumentDiscovered',
      'DocumentModified',
      'DocumentRemoved',
    ]),
    eventVersion: z.literal(1),
    occurredAt: z.string(),
    producer: z.literal('workspace-brain-api'),
    correlationId: z.string(),
    idempotencyKey: z.string(),
    partitionKey: z.string(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

type DuckDbCatalogue = CatalogueDiscovery & CatalogueHealth;
type DuckDbConnection = Awaited<ReturnType<DuckDBInstance['connect']>>;

export async function createDuckDbCatalogue(
  databasePath: string,
  migrationsDirectory: string,
): Promise<DuckDbCatalogue> {
  const instance = await DuckDBInstance.create(databasePath);
  const connection = await instance.connect();

  try {
    await runMigrations(connection, migrationsDirectory);
  } catch (error) {
    connection.closeSync();
    instance.closeSync();
    throw error;
  }

  return {
    async listSources(request): Promise<CataloguePage<Source>> {
      const rows = await queryPage(
        connection,
        'sources',
        request,
        "SELECT id, name, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM sources",
      );
      return { items: rows.map(parseSourceRow) };
    },

    async listWorkspaces(request): Promise<CataloguePage<Workspace>> {
      const rows = await queryPage(
        connection,
        'workspaces',
        request,
        "SELECT id, name, description, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM workspaces",
      );
      return { items: rows.map(parseWorkspaceRow) };
    },

    async listRepositories(request): Promise<CataloguePage<Repository>> {
      const { where, parameters } = buildFilters(request, false);
      const rows = await queryFilteredPage(
        connection,
        'repositories',
        request.limit,
        "SELECT * FROM (SELECT repositories.id, repositories.source_id, repositories.path, repositories.repository_type, inventory_records.fingerprint, strftime(repositories.discovered_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS discovered_at, strftime(inventory_records.last_seen_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS last_seen_at, repositories.discovery_method FROM repositories JOIN inventory_records USING (source_id, path) WHERE inventory_records.asset_type = 'repository' AND inventory_records.is_present) AS repository_catalogue",
        where,
        parameters,
      );
      return {
        items: rows.map((row) => {
          const parsed = repositoryRowSchema.parse(row);
          return {
            id: parseRepositoryId(parsed.id),
            sourceId: parseSourceId(parsed.source_id),
            path: parsed.path,
            repositoryType: parsed.repository_type,
            fingerprint: parsed.fingerprint,
            discoveredAt: parsed.discovered_at,
            lastSeenAt: parsed.last_seen_at,
            discoveryMethod: parseDiscoveryMethod(parsed.discovery_method),
          };
        }),
      };
    },

    async listDocuments(request): Promise<CataloguePage<Document>> {
      const { where, parameters } = buildFilters(request, true);
      const rows = await queryFilteredPage(
        connection,
        'documents',
        request.limit,
        "SELECT * FROM (SELECT documents.id, documents.source_id, documents.path, documents.filename, documents.extension, documents.size_bytes, strftime(documents.modified_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS modified_at, inventory_records.fingerprint, strftime(documents.discovered_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS discovered_at, strftime(inventory_records.last_seen_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS last_seen_at, documents.discovery_method FROM documents JOIN inventory_records USING (source_id, path) WHERE inventory_records.asset_type = 'document' AND inventory_records.is_present) AS document_catalogue",
        where,
        parameters,
      );
      return {
        items: rows.map((row) => {
          const parsed = documentRowSchema.parse(row);
          return {
            id: parseDocumentId(parsed.id),
            sourceId: parseSourceId(parsed.source_id),
            path: parsed.path,
            filename: parsed.filename,
            extension: parsed.extension,
            sizeBytes: parsed.size_bytes,
            modifiedAt: parsed.modified_at,
            fingerprint: parsed.fingerprint,
            discoveredAt: parsed.discovered_at,
            lastSeenAt: parsed.last_seen_at,
            discoveryMethod: parseDiscoveryMethod(parsed.discovery_method),
          };
        }),
      };
    },

    async registerConfiguration(
      sources: readonly ConfiguredSource[],
      workspaces: readonly ConfiguredWorkspace[],
    ): Promise<void> {
      const sourceIds = new Map<string, ReturnType<typeof createSourceId>>();
      const workspaceRules = new Map<string, WorkspaceDiscoveryRules[]>();
      for (const workspace of workspaces) {
        for (const sourceConfigId of workspace.sourceConfigIds) {
          const rules = workspaceRules.get(sourceConfigId) ?? [];
          rules.push({
            include: workspace.include,
            exclude: workspace.exclude,
          });
          workspaceRules.set(sourceConfigId, rules);
        }
      }

      for (const source of sources) {
        const existing = await connection.runAndReadAll(
          "SELECT id, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM sources WHERE config_id = $1",
          [source.configId],
        );
        const existingRow = existing.getRowObjectsJson()[0];
        const previousConfig =
          existingRow === undefined
            ? undefined
            : sourceConfigurationSchema.parse(
                JSON.parse(
                  requiredString(existingRow.config_json, 'source config'),
                ),
              );
        const id =
          existingRow === undefined
            ? createSourceId()
            : parseSourceId(requiredString(existingRow.id, 'source id'));
        sourceIds.set(source.configId, id);
        const previousRoots = new Map(
          (previousConfig?.roots ?? []).map((root) => [
            root.absolutePath,
            root,
          ]),
        );
        const roots: SourceRoot[] = source.rootPaths.map((absolutePath) => {
          const previous = previousRoots.get(absolutePath);
          return {
            id:
              previous === undefined
                ? createSourceRootId()
                : parseSourceRootId(previous.id),
            sourceId: id,
            absolutePath,
          };
        });
        const config = JSON.stringify({
          configId: source.configId,
          roots,
          containerPaths: roots.map((root) => root.absolutePath),
          excludeDirs: source.excludeDirs,
          includeExtensions: source.includeExtensions,
          maxFileSizeBytes: source.maxFileSizeBytes,
          workspaceRules: workspaceRules.get(source.configId) ?? [],
        });
        await connection.run(
          'INSERT INTO sources (id, name, provider_type, config_json, created_at, config_id) VALUES ($1, $2, $3, $4, COALESCE((SELECT created_at FROM sources WHERE id = $1), CURRENT_TIMESTAMP), $5) ON CONFLICT (id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, config_id = excluded.config_id',
          [id, source.name, 'filesystem', config, source.configId],
        );
      }

      for (const workspace of workspaces) {
        const sourceIdsForWorkspace = workspace.sourceConfigIds.map(
          (sourceConfigId) => {
            const sourceId = sourceIds.get(sourceConfigId);
            if (sourceId === undefined) {
              throw new Error(
                `Workspace ${workspace.configId} references unregistered source ${sourceConfigId}`,
              );
            }
            return sourceId;
          },
        );
        const existing = await connection.runAndReadAll(
          'SELECT id FROM workspaces WHERE config_id = $1',
          [workspace.configId],
        );
        const existingId = existing.getRowObjectsJson()[0]?.id;
        const id =
          existingId === undefined
            ? createWorkspaceId()
            : parseWorkspaceId(requiredString(existingId, 'workspace id'));
        const config = JSON.stringify({
          configId: workspace.configId,
          sourceIds: sourceIdsForWorkspace,
          include: workspace.include,
          exclude: workspace.exclude,
        });
        await connection.run(
          'INSERT INTO workspaces (id, name, description, config_json, created_at, config_id) VALUES ($1, $2, NULL, $3, COALESCE((SELECT created_at FROM workspaces WHERE id = $1), CURRENT_TIMESTAMP), $4) ON CONFLICT (id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, config_id = excluded.config_id',
          [id, workspace.name, config, workspace.configId],
        );
      }
    },

    async getSource(sourceId: string): Promise<Source | undefined> {
      const rows = await connection.runAndReadAll(
        "SELECT id, name, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM sources WHERE id = $1",
        [sourceId],
      );
      const row = rows.getRowObjectsJson()[0];
      return row === undefined ? undefined : parseSourceRow(row);
    },

    async listSourcesForDiscovery(
      request,
    ): Promise<CataloguePage<DiscoverySource>> {
      const rows = await queryPage(
        connection,
        'sources',
        request,
        "SELECT id, name, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM sources",
      );
      const sources = rows.map(parseSourceRow);
      return {
        items: sources.map((source) => {
          const rules = source.workspaceRules ?? [];
          return {
            sourceId: source.id,
            roots: source.roots ?? [],
            workspaceRules: rules,
            excludedDirectoryNames: source.excludeDirs ?? [],
            includeExtensions: source.includeExtensions ?? [],
            maxFileSizeBytes: source.maxFileSizeBytes ?? 50 * 1024 * 1024,
          };
        }),
      };
    },

    async persistScan(
      sourceId: string,
      repositories: readonly RepositoryCandidate[],
      documents: readonly DocumentCandidate[],
      discoveredAt: string,
      correlationId: string,
      durationMilliseconds: number,
    ): Promise<ScanPersistenceResult> {
      const parsedSourceId = parseSourceId(sourceId);
      const persistedRepositories: Repository[] = [];
      const persistedDocuments: Document[] = [];
      const repositoryChanges: InventoryChange<Repository | InventoryRecord>[] =
        [];
      const documentChanges: InventoryChange<Document | InventoryRecord>[] = [];
      await connection.run('BEGIN TRANSACTION');
      try {
        const inventoryResult = await connection.runAndReadAll(
          "SELECT id, source_id, path, asset_type, fingerprint, strftime(discovered_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS discovered_at, strftime(last_seen_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS last_seen_at, is_present FROM inventory_records WHERE source_id = $1",
          [sourceId],
        );
        const previousRecords = new Map(
          inventoryResult
            .getRowObjectsJson()
            .map((row) => inventoryRowSchema.parse(row))
            .map((row) => [`${row.asset_type}\0${row.path}`, row]),
        );
        const seenKeys = new Set<string>();

        for (const candidate of repositories) {
          const key = `repository\0${candidate.path}`;
          const previous = previousRecords.get(key);
          const record: Repository = {
            id:
              previous === undefined
                ? createRepositoryId()
                : parseRepositoryId(previous.id),
            sourceId: parsedSourceId,
            path: candidate.path,
            repositoryType: candidate.repositoryType,
            fingerprint: candidate.fingerprint,
            discoveredAt:
              previous === undefined
                ? discoveredAt
                : normalizeTimestamp(previous.discovered_at),
            lastSeenAt: discoveredAt,
            discoveryMethod: candidate.discoveryMethod,
          };
          const change = getInventoryChange(previous, record.fingerprint);
          seenKeys.add(key);

          await connection.run(
            'INSERT INTO repositories (id, source_id, path, repository_type, discovered_at, discovery_method) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (source_id, path) DO UPDATE SET repository_type = excluded.repository_type, discovered_at = excluded.discovered_at, discovery_method = excluded.discovery_method WHERE repositories.repository_type IS DISTINCT FROM excluded.repository_type OR repositories.discovery_method IS DISTINCT FROM excluded.discovery_method',
            [
              record.id,
              record.sourceId,
              record.path,
              record.repositoryType,
              record.discoveredAt,
              record.discoveryMethod,
            ],
          );
          await upsertInventoryRecord(
            connection,
            record.id,
            record.sourceId,
            record.path,
            'repository',
            record.fingerprint,
            record.discoveredAt,
            record.lastSeenAt,
          );
          repositoryChanges.push({ change, record });
          if (change !== 'unchanged') {
            await insertDiscoveryHistory(
              connection,
              repositoryEventType(change),
              record,
              correlationId,
              discoveredAt,
            );
          }
          persistedRepositories.push(record);
        }

        for (const candidate of documents) {
          const key = `document\0${candidate.path}`;
          const previous = previousRecords.get(key);
          const record: Document = {
            id:
              previous === undefined
                ? createDocumentId()
                : parseDocumentId(previous.id),
            sourceId: parsedSourceId,
            ...candidate,
            discoveredAt:
              previous === undefined
                ? discoveredAt
                : normalizeTimestamp(previous.discovered_at),
            lastSeenAt: discoveredAt,
          };
          const change = getInventoryChange(previous, record.fingerprint);
          seenKeys.add(key);

          await connection.run(
            'INSERT INTO documents (id, source_id, path, filename, extension, size_bytes, modified_at, discovered_at, discovery_method) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (source_id, path) DO UPDATE SET filename = excluded.filename, extension = excluded.extension, size_bytes = excluded.size_bytes, modified_at = excluded.modified_at, discovered_at = excluded.discovered_at, discovery_method = excluded.discovery_method WHERE documents.filename IS DISTINCT FROM excluded.filename OR documents.extension IS DISTINCT FROM excluded.extension OR documents.size_bytes IS DISTINCT FROM excluded.size_bytes OR documents.modified_at IS DISTINCT FROM excluded.modified_at OR documents.discovery_method IS DISTINCT FROM excluded.discovery_method',
            [
              record.id,
              record.sourceId,
              record.path,
              record.filename,
              record.extension,
              record.sizeBytes,
              record.modifiedAt,
              record.discoveredAt,
              record.discoveryMethod,
            ],
          );
          await upsertInventoryRecord(
            connection,
            record.id,
            record.sourceId,
            record.path,
            'document',
            record.fingerprint,
            record.discoveredAt,
            record.lastSeenAt,
          );
          documentChanges.push({ change, record });
          if (change !== 'unchanged') {
            await insertDiscoveryHistory(
              connection,
              documentEventType(change),
              record,
              correlationId,
              discoveredAt,
            );
          }
          persistedDocuments.push(record);
        }

        for (const previous of previousRecords.values()) {
          const key = `${previous.asset_type}\0${previous.path}`;
          if (seenKeys.has(key) || !previous.is_present) {
            continue;
          }
          const record: InventoryRecord = {
            id: previous.id,
            sourceId: parsedSourceId,
            path: previous.path,
            type: previous.asset_type,
            fingerprint: previous.fingerprint,
            discoveredAt: normalizeTimestamp(previous.discovered_at),
            lastSeenAt: normalizeTimestamp(previous.last_seen_at),
          };
          const change = { change: 'removed' as const, record };
          if (previous.asset_type === 'repository') {
            repositoryChanges.push(change);
            await connection.run(
              'DELETE FROM repositories WHERE source_id = $1 AND path = $2',
              [sourceId, previous.path],
            );
            await insertDiscoveryHistory(
              connection,
              'RepositoryRemoved',
              record,
              correlationId,
              discoveredAt,
            );
          } else {
            documentChanges.push(change);
            await connection.run(
              'DELETE FROM documents WHERE source_id = $1 AND path = $2',
              [sourceId, previous.path],
            );
            await insertDiscoveryHistory(
              connection,
              'DocumentRemoved',
              record,
              correlationId,
              discoveredAt,
            );
          }
          await connection.run(
            'UPDATE inventory_records SET is_present = FALSE WHERE source_id = $1 AND path = $2 AND asset_type = $3',
            [sourceId, previous.path, previous.asset_type],
          );
        }
        const changes = [...repositoryChanges, ...documentChanges];
        const metrics: SourceScanMetrics = {
          repositoryCount: persistedRepositories.length,
          documentCount: persistedDocuments.length,
          addedCount: changes.filter(({ change }) => change === 'added').length,
          modifiedCount: changes.filter(({ change }) => change === 'modified')
            .length,
          removedCount: changes.filter(({ change }) => change === 'removed')
            .length,
          unchangedCount: changes.filter(({ change }) => change === 'unchanged')
            .length,
          durationMilliseconds,
        };
        await completeScanAndQueueEvent(
          connection,
          sourceId,
          correlationId,
          discoveredAt,
          metrics,
        );
        await connection.run('COMMIT');
      } catch (error) {
        await connection.run('ROLLBACK');
        throw error;
      }
      return {
        repositories: persistedRepositories,
        documents: persistedDocuments,
        repositoryChanges,
        documentChanges,
      };
    },

    async listPendingDiscoveryEvents(limit: number): Promise<DiscoveryEvent[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error('Outbox page limit must be between 1 and 1000');
      }
      const rows = await connection.runAndReadAll(
        'SELECT CAST(event_json AS VARCHAR) AS event_json FROM discovery_outbox WHERE published_at IS NULL ORDER BY occurred_at, event_id LIMIT $1',
        [limit],
      );
      return rows.getRowObjectsJson().map((row) => {
        const eventJson = requiredString(row.event_json, 'outbox event');
        const parsed = discoveryEventEnvelopeSchema.safeParse(
          JSON.parse(eventJson) as unknown,
        );
        if (!parsed.success) {
          throw new Error('DuckDB returned an invalid discovery outbox event');
        }
        return parsed.data as DiscoveryEvent;
      });
    },

    async markDiscoveryEventPublished(
      eventId: string,
      publishedAt: string,
    ): Promise<void> {
      await connection.run(
        'UPDATE discovery_outbox SET published_at = $2 WHERE event_id = $1 AND published_at IS NULL',
        [eventId, publishedAt],
      );
      const result = await connection.runAndReadAll(
        'SELECT published_at FROM discovery_outbox WHERE event_id = $1',
        [eventId],
      );
      const published = result.getRowObjectsJson()[0]?.published_at;
      if (published === undefined || published === null) {
        throw new Error(`Discovery outbox event ${eventId} was not found`);
      }
    },

    async recordScanStarted(
      sourceId: string,
      correlationId: string,
      startedAt: string,
    ): Promise<void> {
      await connection.run(
        "INSERT INTO source_scan_runs (correlation_id, source_id, status, started_at) VALUES ($1, $2, 'started', $3) ON CONFLICT (correlation_id) DO NOTHING",
        [correlationId, sourceId, startedAt],
      );
      const existing = await connection.runAndReadAll(
        'SELECT source_id FROM source_scan_runs WHERE correlation_id = $1',
        [correlationId],
      );
      if (existing.getRowObjectsJson()[0]?.source_id !== sourceId) {
        throw new Error(
          `Source scan correlation ${correlationId} is already assigned to another source`,
        );
      }
    },

    async recordScanFailed(
      sourceId: string,
      correlationId: string,
      failedAt: string,
      durationMilliseconds: number,
      failureType: string,
    ): Promise<void> {
      await connection.run(
        "INSERT INTO source_scan_runs (correlation_id, source_id, status, started_at, completed_at, duration_milliseconds, failure_type) VALUES ($1, $2, 'failed', $3, $3, $4, $5) ON CONFLICT (correlation_id) DO UPDATE SET status = 'failed', completed_at = excluded.completed_at, duration_milliseconds = excluded.duration_milliseconds, failure_type = excluded.failure_type",
        [correlationId, sourceId, failedAt, durationMilliseconds, failureType],
      );
      await assertScanRunStatus(connection, sourceId, correlationId, 'failed');
    },

    async check(): Promise<void> {
      await connection.runAndReadAll('SELECT 1');
      const migrationFiles = await listMigrationFiles(migrationsDirectory);
      const applied = await connection.runAndReadAll(
        'SELECT version FROM schema_migrations',
      );
      const appliedVersions = new Set(
        applied
          .getRowObjectsJson()
          .map((row) => requiredString(row.version, 'migration version')),
      );
      const missing = migrationFiles.filter(
        (file) => !appliedVersions.has(file.slice(0, -'.sql'.length)),
      );
      if (missing.length > 0) {
        throw new Error(
          `DuckDB migrations are incomplete: ${missing.join(', ')}`,
        );
      }
    },

    async close(): Promise<void> {
      connection.closeSync();
      instance.closeSync();
    },
  };
}

function parseSourceRow(row: unknown): Source {
  const parsedRow = sourceRowSchema.parse(row);
  const config = sourceConfigurationSchema.parse(
    JSON.parse(parsedRow.config_json),
  );
  const id = parseSourceId(parsedRow.id);
  const roots: SourceRoot[] =
    config.roots?.map((root) => ({
      id: parseSourceRootId(root.id),
      sourceId: parseSourceId(root.sourceId),
      absolutePath: root.absolutePath,
    })) ??
    (config.containerPaths ?? []).map((absolutePath) => ({
      id: createSourceRootId(),
      sourceId: id,
      absolutePath,
    }));
  return {
    id,
    name: parsedRow.name,
    type: 'filesystem',
    containerPaths: roots.map((root) => root.absolutePath),
    roots,
    excludeDirs: config.excludeDirs,
    includeExtensions: config.includeExtensions,
    ...(config.maxFileSizeBytes === undefined
      ? {}
      : { maxFileSizeBytes: config.maxFileSizeBytes }),
    workspaceRules: config.workspaceRules,
    createdAt: parsedRow.created_at,
  };
}

function parseWorkspaceRow(row: unknown): Workspace {
  const parsedRow = workspaceRowSchema.parse(row);
  const config = workspaceConfigurationSchema.parse(
    JSON.parse(parsedRow.config_json),
  );
  return {
    id: parseWorkspaceId(parsedRow.id),
    name: parsedRow.name,
    ...(parsedRow.description === null
      ? {}
      : { description: parsedRow.description }),
    sourceIds: config.sourceIds.map(parseSourceId),
    createdAt: parsedRow.created_at,
  };
}

function getInventoryChange(
  previous: z.infer<typeof inventoryRowSchema> | undefined,
  fingerprint: string,
): 'added' | 'modified' | 'unchanged' {
  if (previous === undefined || !previous.is_present) {
    return 'added';
  }
  return previous.fingerprint === fingerprint ? 'unchanged' : 'modified';
}

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error('DuckDB returned an invalid inventory timestamp');
  }
  return date.toISOString();
}

async function completeScanAndQueueEvent(
  connection: DuckDbConnection,
  sourceId: string,
  correlationId: string,
  discoveredAt: string,
  metrics: SourceScanMetrics,
): Promise<void> {
  const completedAt = new Date().toISOString();
  await connection.run(
    "INSERT INTO source_scan_runs (correlation_id, source_id, status, started_at) VALUES ($1, $2, 'started', $3) ON CONFLICT (correlation_id) DO NOTHING",
    [correlationId, sourceId, discoveredAt],
  );
  await connection.run(
    "UPDATE source_scan_runs SET status = 'completed', completed_at = $3, duration_milliseconds = $4, repository_count = $5, document_count = $6, added_count = $7, modified_count = $8, removed_count = $9, unchanged_count = $10, failure_type = NULL WHERE source_id = $1 AND correlation_id = $2 AND status != 'completed'",
    [
      sourceId,
      correlationId,
      completedAt,
      metrics.durationMilliseconds,
      metrics.repositoryCount,
      metrics.documentCount,
      metrics.addedCount,
      metrics.modifiedCount,
      metrics.removedCount,
      metrics.unchangedCount,
    ],
  );
  await assertScanRunStatus(connection, sourceId, correlationId, 'completed');
  await insertOutboxEvent(
    connection,
    createCatalogueEvent(
      'SourceScanCompleted',
      {
        sourceId,
        discoveredAt,
        ...metrics,
      },
      sourceId,
      correlationId,
      `source-scan-completed:${sourceId}:${correlationId}`,
      completedAt,
    ),
  );
}

async function assertScanRunStatus(
  connection: DuckDbConnection,
  sourceId: string,
  correlationId: string,
  expectedStatus: 'completed' | 'failed',
): Promise<void> {
  const result = await connection.runAndReadAll(
    'SELECT status FROM source_scan_runs WHERE source_id = $1 AND correlation_id = $2',
    [sourceId, correlationId],
  );
  const status = result.getRowObjectsJson()[0]?.status;
  if (status !== expectedStatus) {
    throw new Error(
      `Source scan run ${correlationId} could not be recorded as ${expectedStatus}`,
    );
  }
}

function repositoryEventType(change: 'added' | 'modified'): string {
  return change === 'added' ? 'RepositoryDiscovered' : 'RepositoryModified';
}

function documentEventType(change: 'added' | 'modified'): string {
  return change === 'added' ? 'DocumentDiscovered' : 'DocumentModified';
}

async function upsertInventoryRecord(
  connection: DuckDbConnection,
  id: string,
  sourceId: string,
  path: string,
  assetType: 'repository' | 'document',
  fingerprint: string,
  discoveredAt: string,
  lastSeenAt: string,
): Promise<void> {
  await connection.run(
    'INSERT INTO inventory_records (id, source_id, path, asset_type, fingerprint, discovered_at, last_seen_at, is_present) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE) ON CONFLICT (source_id, path, asset_type) DO UPDATE SET fingerprint = excluded.fingerprint, last_seen_at = excluded.last_seen_at, is_present = TRUE',
    [id, sourceId, path, assetType, fingerprint, discoveredAt, lastSeenAt],
  );
}

async function insertDiscoveryHistory(
  connection: DuckDbConnection,
  rawEventType: string,
  record: Repository | Document | InventoryRecord,
  correlationId: string,
  occurredAt: string,
): Promise<DiscoveryEvent> {
  const eventType = parseCatalogueEventType(rawEventType);
  const removed = eventType.endsWith('Removed');
  const payload = removed
    ? { inventoryRecord: record }
    : eventType.startsWith('Repository')
      ? { repository: record }
      : { document: record };
  const idempotencyKey = `catalogue:${eventType}:${record.sourceId}:${record.id}:${correlationId}`;
  const event = createCatalogueEvent(
    eventType,
    payload,
    record.sourceId,
    correlationId,
    idempotencyKey,
    occurredAt,
  );
  await connection.run(
    'INSERT INTO discovery_history (id, source_id, event_type, subject_id, path, fingerprint, occurred_at, correlation_id, payload_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      event.eventId,
      record.sourceId,
      eventType,
      record.id,
      record.path,
      record.fingerprint,
      occurredAt,
      correlationId,
      JSON.stringify(record),
    ],
  );
  await insertOutboxEvent(connection, event);
  return event;
}

type CatalogueEventType = Extract<
  DiscoveryEvent['eventType'],
  | 'SourceScanCompleted'
  | 'RepositoryDiscovered'
  | 'RepositoryModified'
  | 'RepositoryRemoved'
  | 'DocumentDiscovered'
  | 'DocumentModified'
  | 'DocumentRemoved'
>;

function parseCatalogueEventType(value: string): CatalogueEventType {
  const eventTypes: readonly CatalogueEventType[] = [
    'SourceScanCompleted',
    'RepositoryDiscovered',
    'RepositoryModified',
    'RepositoryRemoved',
    'DocumentDiscovered',
    'DocumentModified',
    'DocumentRemoved',
  ];
  if (!eventTypes.includes(value as CatalogueEventType)) {
    throw new Error(`Unsupported catalogue discovery event: ${value}`);
  }
  return value as CatalogueEventType;
}

function createCatalogueEvent(
  eventType: CatalogueEventType,
  payload: object,
  sourceId: string,
  correlationId: string,
  idempotencyKey: string,
  occurredAt: string,
): DiscoveryEvent {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    occurredAt,
    producer: 'workspace-brain-api',
    correlationId,
    idempotencyKey,
    partitionKey: sourceId,
    payload,
  } as DiscoveryEvent;
}

async function insertOutboxEvent(
  connection: DuckDbConnection,
  event: DiscoveryEvent,
): Promise<void> {
  await connection.run(
    'INSERT INTO discovery_outbox (event_id, idempotency_key, source_id, event_type, occurred_at, correlation_id, event_json) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (idempotency_key) DO NOTHING',
    [
      event.eventId,
      event.idempotencyKey,
      event.partitionKey,
      event.eventType,
      event.occurredAt,
      event.correlationId,
      JSON.stringify(event),
    ],
  );
}

function parseDiscoveryMethod(value: string): 'filesystem' {
  if (value !== 'filesystem') {
    throw new Error(`Unsupported discovery method: ${value}`);
  }
  return value;
}

async function queryPage(
  connection: DuckDbConnection,
  table: 'sources' | 'workspaces',
  request: CataloguePageRequest,
  select: string,
): Promise<Record<string, unknown>[]> {
  const filters: string[] = [];
  const parameters: (string | number)[] = [];
  if (request.afterId !== undefined) {
    parameters.push(request.afterId);
    filters.push(`id > $${parameters.length}`);
  }
  if (request.sourceId !== undefined && table === 'workspaces') {
    parameters.push(request.sourceId);
    filters.push(
      `list_contains(CAST(json_extract(config_json, '$.sourceIds') AS VARCHAR[]), $${parameters.length})`,
    );
  }
  return queryFilteredPage(
    connection,
    table,
    request.limit,
    select,
    filters,
    parameters,
  );
}

function buildFilters(
  request: CataloguePageRequest,
  allowExtension: boolean,
): { where: string[]; parameters: (string | number)[] } {
  const where: string[] = [];
  const parameters: (string | number)[] = [];
  if (request.afterId !== undefined) {
    parameters.push(request.afterId);
    where.push(`id > $${parameters.length}`);
  }
  if (request.sourceId !== undefined) {
    parameters.push(request.sourceId);
    where.push(`source_id = $${parameters.length}`);
  }
  if (allowExtension && request.extension !== undefined) {
    parameters.push(request.extension);
    where.push(`lower(extension) = lower($${parameters.length})`);
  }
  return { where, parameters };
}

async function queryFilteredPage(
  connection: DuckDbConnection,
  table: string,
  limit: number,
  select: string,
  filters: readonly string[],
  parameters: readonly (string | number)[],
): Promise<Record<string, unknown>[]> {
  const limitParameter = parameters.length + 1;
  const result = await connection.runAndReadAll(
    `${select}${filters.length === 0 ? '' : ` WHERE ${filters.join(' AND ')}`} ORDER BY id LIMIT $${limitParameter}`,
    [...parameters, limit],
  );
  return result.getRowObjectsJson().map((row) => {
    if (!row || typeof row !== 'object') {
      throw new Error(`DuckDB returned an invalid row for ${table}`);
    }
    return row;
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`DuckDB returned an invalid ${label}`);
  }
  return value;
}

async function listMigrationFiles(
  migrationsDirectory: string,
): Promise<string[]> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{3}-[a-z0-9-]+\.sql$/.test(file))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `No valid DuckDB migrations found in ${migrationsDirectory}`,
    );
  }
  return files;
}

async function runMigrations(
  connection: DuckDbConnection,
  migrationsDirectory: string,
): Promise<void> {
  await connection.run(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  for (const file of await listMigrationFiles(migrationsDirectory)) {
    const version = file.slice(0, -'.sql'.length);
    const applied = await connection.runAndReadAll(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [version],
    );
    if (applied.getRowObjects().length > 0) {
      continue;
    }

    const migrationSql = (
      await readFile(join(migrationsDirectory, file), 'utf8')
    ).trim();
    if (migrationSql.length === 0) {
      throw new Error(`DuckDB migration ${file} is empty`);
    }

    await connection.run('BEGIN TRANSACTION');
    try {
      await connection.run(migrationSql);
      await connection.run(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version],
      );
      await connection.run('COMMIT');
    } catch (error) {
      try {
        await connection.run('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error],
          `Migration ${file} failed and rollback failed`,
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }
}
