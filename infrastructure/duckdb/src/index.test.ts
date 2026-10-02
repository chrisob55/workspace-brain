import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
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
      {
        id: sourceId,
        name: 'Projects',
        type: 'filesystem',
        containerPaths: ['/sources/projects'],
        createdAt: '2026-10-01T12:00:00.000000Z',
      },
    ]);
    expect((await second.listWorkspaces({ limit: 10 })).items).toEqual([
      {
        id: workspaceId,
        name: 'Product',
        description: 'Project knowledge',
        sourceIds: [sourceId],
        createdAt: '2026-10-01T12:00:00.000000Z',
      },
    ]);
    await second.close();

    const instance = await DuckDBInstance.create(databasePath);
    const connection = await instance.connect();
    const tables = await connection.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name",
    );
    expect(tables.getRowObjectsJson().map((row) => row.table_name)).toEqual([
      'schema_migrations',
      'sources',
      'workspaces',
    ]);
    connection.closeSync();
    instance.closeSync();
  });
});
