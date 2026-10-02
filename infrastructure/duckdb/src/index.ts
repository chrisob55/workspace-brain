import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import type {
  CatalogueHealth,
  CataloguePage,
  CataloguePageRequest,
  CatalogueReader,
} from '@workspace-brain/catalogue';
import {
  parseSourceId,
  parseWorkspaceId,
  type Source,
  type Workspace,
} from '@workspace-brain/domain';
import { z } from 'zod';

const sourceConfigurationSchema = z
  .object({
    containerPaths: z.array(z.string()),
  })
  .strict();

const workspaceConfigurationSchema = z
  .object({
    sourceIds: z.array(z.string()),
  })
  .strict();

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

type DuckDbCatalogue = CatalogueReader & CatalogueHealth;

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
      return {
        items: rows.map((row) => {
          const parsedRow = sourceRowSchema.parse(row);
          const config = sourceConfigurationSchema.parse(
            JSON.parse(parsedRow.config_json),
          );
          return {
            id: parseSourceId(parsedRow.id),
            name: parsedRow.name,
            type: 'filesystem',
            containerPaths: config.containerPaths,
            createdAt: parsedRow.created_at,
          };
        }),
      };
    },

    async listWorkspaces(request): Promise<CataloguePage<Workspace>> {
      const rows = await queryPage(
        connection,
        'workspaces',
        request,
        "SELECT id, name, description, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM workspaces",
      );
      return {
        items: rows.map((row) => {
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
        }),
      };
    },

    async check(): Promise<void> {
      await connection.runAndReadAll('SELECT 1');
    },

    async close(): Promise<void> {
      connection.closeSync();
      instance.closeSync();
    },
  };
}

async function queryPage(
  connection: Awaited<ReturnType<DuckDBInstance['connect']>>,
  table: 'sources' | 'workspaces',
  request: CataloguePageRequest,
  select: string,
): Promise<Record<string, unknown>[]> {
  const after = request.afterId === undefined ? '' : ' WHERE id > $1';
  const limitParameter = request.afterId === undefined ? '$1' : '$2';
  const parameters =
    request.afterId === undefined
      ? [request.limit]
      : [request.afterId, request.limit];
  const result = await connection.runAndReadAll(
    `${select}${after} ORDER BY id LIMIT ${limitParameter}`,
    parameters,
  );
  return result.getRowObjectsJson().map((row) => {
    if (!row || typeof row !== 'object') {
      throw new Error(`DuckDB returned an invalid row for ${table}`);
    }
    return row;
  });
}

async function runMigrations(
  connection: Awaited<ReturnType<DuckDBInstance['connect']>>,
  migrationsDirectory: string,
): Promise<void> {
  await connection.run(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{3}-[a-z0-9-]+\.sql$/.test(file))
    .sort();

  if (migrationFiles.length === 0) {
    throw new Error(
      `No valid DuckDB migrations found in ${migrationsDirectory}`,
    );
  }

  for (const file of migrationFiles) {
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
