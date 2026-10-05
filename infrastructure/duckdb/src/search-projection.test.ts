import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import type { CatalogueDiscovery } from '@workspace-brain/catalogue';
import {
  createKnowledgeEntityKey,
  type DiscoveryEvent,
  type KnowledgeCandidateEvent,
  type KnowledgeInputEvidence,
  type KnowledgePublication,
} from '@workspace-brain/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { createDuckDbCatalogue } from './index.js';

const migrationsDirectory = resolve(
  process.cwd(),
  'infrastructure/duckdb/migrations',
);
const temporaryDirectories: string[] = [];
const projectionTables = [
  'search_projection_runs',
  'search_projected_entities',
  'search_projected_relationships',
  'search_projected_documents',
  'search_projected_terms',
] as const;
const knowledgeTables = [
  'knowledge_models',
  'knowledge_entities',
  'knowledge_relationships',
  'entity_versions',
  'relationship_versions',
  'knowledge_publications',
] as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

type Fixture = {
  readonly databasePath: string;
  readonly catalogue: CatalogueDiscovery & { close(): Promise<void> };
  readonly first: KnowledgePublication;
  readonly second: KnowledgePublication;
};

async function createFixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-brain-search-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'catalogue.duckdb');
  const catalogue = await createDuckDbCatalogue(
    databasePath,
    migrationsDirectory,
  );
  await catalogue.registerConfiguration(
    [
      {
        configId: 'search-source',
        name: 'Search Source',
        rootPaths: [join(directory, 'source')],
        excludeDirs: [],
        includeExtensions: ['.json'],
        maxFileSizeBytes: 4096,
      },
    ],
    [
      {
        configId: 'search-workspace',
        name: 'Search Workspace',
        sourceConfigIds: ['search-source'],
        include: ['**'],
        exclude: [],
      },
    ],
  );
  const source = (await catalogue.listSources({ limit: 10 })).items[0];
  const root = source?.roots?.[0];
  if (source === undefined || root === undefined) {
    throw new Error('Search source registration failed');
  }
  const contents = {
    service: '{"name":"@workspace/service","dependencies":{"lodash":"^4"}}',
    web: '{"name":"@workspace/web","dependencies":{"react":"^19"}}',
  };
  const scanAt = '2026-11-01T08:00:00.000Z';
  const scan = await catalogue.persistScan(
    source.id,
    [],
    Object.entries(contents).map(([folder, content]) => ({
      path: `${root.id}/${folder}/package.json`,
      filename: 'package.json',
      extension: '.json',
      sizeBytes: Buffer.byteLength(content),
      modifiedAt: scanAt,
      fingerprint: createHash('sha256').update(content).digest('hex'),
      discoveryMethod: 'filesystem' as const,
    })),
    scanAt,
    'search-scan',
    10,
  );

  async function publishPackage(
    folder: keyof typeof contents,
    owner: string,
    dependency: string,
    index: number,
  ): Promise<void> {
    const document = scan.documents.find(({ path }) =>
      path.endsWith(`/${folder}/package.json`),
    );
    if (document === undefined || source === undefined) {
      throw new Error('Search document fixture was not persisted');
    }
    const content = contents[folder];
    const processedAt = `2026-11-01T08:00:0${index}.000Z`;
    const candidate = {
      documentId: document.id,
      sourceId: source.id,
      path: document.path,
      contentFingerprint: createHash('sha256').update(content).digest('hex'),
      processedAt,
      durationMilliseconds: 1,
      processorId: 'json',
      processorVersion: 1,
      extractionRuleId: 'json-scalar-values',
      extractionRuleVersion: 1,
      evidence: [
        {
          key: 'json:/name',
          kind: 'structured-value' as const,
          excerpt: owner,
          truncated: false,
          locator: { kind: 'json-pointer' as const, pointer: '/name' },
        },
        {
          key: `json:/dependencies/${dependency}`,
          kind: 'structured-value' as const,
          excerpt: '^1',
          truncated: false,
          locator: {
            kind: 'json-pointer' as const,
            pointer: `/dependencies/${dependency}`,
          },
        },
      ],
    };
    const processingEvent: Extract<
      DiscoveryEvent,
      { readonly eventType: 'DocumentProcessingSubmitted' }
    > = {
      eventId: `search-processing-${folder}`,
      eventType: 'DocumentProcessingSubmitted',
      eventVersion: 1,
      occurredAt: processedAt,
      producer: 'workspace-brain-knowledge-worker',
      correlationId: `search-processing-${folder}`,
      idempotencyKey: `search-processing-${folder}`,
      partitionKey: source.id,
      payload: { candidate },
    };
    const processed = await catalogue.applyDocumentProcessing(processingEvent);
    const inputs = await catalogue.listKnowledgeInputEvidence(
      processed.documentVersion.id,
    );
    const ownerInput = inputs.find(
      ({ evidence }) => evidence.key === 'json:/name',
    );
    const dependencyInput = inputs.find(
      ({ evidence }) => evidence.key === `json:/dependencies/${dependency}`,
    );
    if (ownerInput === undefined || dependencyInput === undefined) {
      throw new Error('Search evidence fixture was not persisted');
    }
    const provenance = (input: KnowledgeInputEvidence) => ({
      evidenceId: input.evidence.id,
      documentVersionId: input.documentVersion.id,
      documentId: input.document.id,
      sourceId: input.document.sourceId,
      documentPath: input.document.path,
      contentFingerprint: input.provenance.contentFingerprint,
      locator: input.evidence.locator,
      processorId: input.provenance.processorId,
      processorVersion: input.provenance.processorVersion,
      extractionRuleId: input.provenance.extractionRuleId,
      extractionRuleVersion: input.provenance.extractionRuleVersion,
      knowledgeExtractorId: 'deterministic-knowledge-extractors',
      knowledgeExtractorVersion: 1 as const,
    });
    const ownerKey = createKnowledgeEntityKey(
      'package',
      source.id,
      document.path,
      owner,
    );
    const dependencyKey = createKnowledgeEntityKey(
      'package',
      source.id,
      document.path,
      dependency,
    );
    const event: KnowledgeCandidateEvent = {
      eventId: `search-candidates-${folder}`,
      eventType: 'KnowledgeCandidatesSubmitted',
      eventVersion: 1,
      occurredAt: processedAt,
      producer: 'workspace-brain-knowledge-worker',
      correlationId: `search-candidates-${folder}`,
      idempotencyKey: `search-candidates-${folder}`,
      partitionKey: source.id,
      payload: {
        sourceId: source.id,
        documentId: document.id,
        documentVersionId: processed.documentVersion.id,
        entities: [
          {
            key: ownerKey,
            type: 'package',
            identityScope: document.path,
            name: owner,
            sourceEvidenceIds: [ownerInput.evidence.id],
            provenance: [provenance(ownerInput)],
            lifecycleStatus: 'observed',
          },
          {
            key: dependencyKey,
            type: 'package',
            identityScope: document.path,
            name: dependency,
            sourceEvidenceIds: [dependencyInput.evidence.id],
            provenance: [provenance(dependencyInput)],
            lifecycleStatus: 'observed',
          },
        ],
        relationships: [
          {
            key: `DEPENDS_ON:${ownerKey}->${dependencyKey}`,
            type: 'DEPENDS_ON',
            sourceEntityKey: ownerKey,
            targetEntityKey: dependencyKey,
            sourceEvidenceIds: [dependencyInput.evidence.id],
            provenance: [provenance(dependencyInput)],
            confidence: 1,
            lifecycleStatus: 'related',
          },
        ],
      },
    };
    await catalogue.applyKnowledgeCandidates(event);
  }

  await publishPackage('service', '@workspace/service', 'lodash', 1);
  await publishPackage('web', '@workspace/web', 'react', 2);
  const publications = (
    await catalogue.listKnowledgePublications({ limit: 10 })
  ).items
    .slice()
    .sort((left, right) => left.version - right.version);
  const [first, second] = publications;
  if (first === undefined || second === undefined) {
    throw new Error('Search publication fixture was not created');
  }
  return { databasePath, catalogue, first, second };
}

async function pendingEvents<EventType extends DiscoveryEvent['eventType']>(
  catalogue: CatalogueDiscovery,
  eventType: EventType,
): Promise<Extract<DiscoveryEvent, { readonly eventType: EventType }>[]> {
  return (await catalogue.listPendingDiscoveryEvents(500)).filter(
    (
      event,
    ): event is Extract<DiscoveryEvent, { readonly eventType: EventType }> =>
      event.eventType === eventType,
  );
}

async function projectAllPublished(catalogue: CatalogueDiscovery) {
  for (const event of await pendingEvents(
    catalogue,
    'KnowledgeModelPublished',
  )) {
    await catalogue.requestSearchProjection(event);
  }
  const requests = await pendingEvents(catalogue, 'SearchProjectionRequested');
  const summaries = [];
  for (const request of requests) {
    summaries.push(await catalogue.buildSearchProjection(request));
  }
  return { requests, summaries };
}

async function withRawConnection<T>(
  databasePath: string,
  run: (
    connection: Awaited<ReturnType<DuckDBInstance['connect']>>,
  ) => Promise<T>,
): Promise<T> {
  const instance = await DuckDBInstance.create(databasePath);
  const connection = await instance.connect();
  try {
    return await run(connection);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function tableDump(
  connection: Awaited<ReturnType<DuckDBInstance['connect']>>,
  tables: readonly string[],
): Promise<Record<string, unknown>> {
  const dump: Record<string, unknown> = {};
  for (const table of tables) {
    const rows = await connection.runAndReadAll(
      `SELECT * FROM ${table} ORDER BY ALL`,
    );
    dump[table] = rows.getRowObjectsJson();
  }
  return dump;
}

describe('DuckDB search projection', () => {
  it('builds publication-scoped projections from publication events idempotently', async () => {
    const { catalogue, first, second } = await createFixture();
    try {
      const { requests, summaries } = await projectAllPublished(catalogue);
      expect(
        requests.map(({ payload }) => payload.publicationId).sort(),
      ).toEqual([first.id, second.id].sort());
      expect(requests[0]).toMatchObject({
        producer: 'workspace-brain-api',
        idempotencyKey: `search-projection-requested:${requests[0]?.payload.publicationId}`,
      });
      const built = await pendingEvents(catalogue, 'SearchProjectionBuilt');
      expect(built).toHaveLength(2);
      expect(
        built
          .map(({ payload }) => payload.projection)
          .sort((a, b) => a.publicationVersion - b.publicationVersion),
      ).toEqual(
        summaries
          .slice()
          .sort((a, b) => a.publicationVersion - b.publicationVersion),
      );

      const firstStatistics = await catalogue.getProjectionStatistics(first.id);
      expect(firstStatistics).toMatchObject({
        publication: first,
        projectionStatus: 'built',
        projectionSchemaVersion: 1,
        projectedEntityCount: 2,
        projectedRelationshipCount: 1,
        projectedSearchDocumentCount: 3,
      });
      const secondStatistics = await catalogue.getProjectionStatistics(
        second.id,
      );
      expect(secondStatistics).toMatchObject({
        projectionStatus: 'built',
        projectedEntityCount: 4,
        projectedRelationshipCount: 2,
      });

      const firstEntities = await catalogue.searchProjectedEntities({
        publicationId: first.id,
        limit: 10,
      });
      expect(firstEntities.items.map(({ name }) => name).sort()).toEqual([
        '@workspace/service',
        'lodash',
      ]);
      expect(
        firstEntities.items.every(
          ({ publicationId, publishedAt, relationshipCount }) =>
            publicationId === first.id &&
            publishedAt === first.publishedAt &&
            relationshipCount === 1,
        ),
      ).toBe(true);

      // Replaying the request and publication events changes nothing.
      const replayRequests = await pendingEvents(
        catalogue,
        'SearchProjectionRequested',
      );
      const replayed = [];
      for (const request of replayRequests) {
        replayed.push(await catalogue.buildSearchProjection(request));
      }
      expect(replayed).toEqual(summaries);
      for (const event of await pendingEvents(
        catalogue,
        'KnowledgeModelPublished',
      )) {
        await catalogue.requestSearchProjection(event);
      }
      expect(
        await pendingEvents(catalogue, 'SearchProjectionRequested'),
      ).toHaveLength(2);
      expect(
        await pendingEvents(catalogue, 'SearchProjectionBuilt'),
      ).toHaveLength(2);
      expect(await catalogue.getProjectionStatistics(first.id)).toEqual(
        firstStatistics,
      );
      expect(
        await catalogue.searchProjectedEntities({
          publicationId: first.id,
          limit: 10,
        }),
      ).toEqual(firstEntities);

      await expect(
        catalogue.buildSearchProjection({
          ...requests[0]!,
          payload: {
            ...requests[0]!.payload,
            publicationContentHash: 'f'.repeat(64),
          },
        }),
      ).rejects.toThrow('does not match a stored publication');
    } finally {
      await catalogue.close();
    }
  });

  it('never mutates knowledge rows and rebuilds identical projections after a drop', async () => {
    const fixture = await createFixture();
    let catalogue = fixture.catalogue;
    await projectAllPublished(catalogue);
    await catalogue.close();

    const before = await withRawConnection(fixture.databasePath, (connection) =>
      tableDump(connection, [...knowledgeTables, ...projectionTables]),
    );
    await withRawConnection(fixture.databasePath, async (connection) => {
      for (const table of projectionTables) {
        await connection.run(`DELETE FROM ${table}`);
      }
    });

    catalogue = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    try {
      expect(
        await catalogue.getProjectionStatistics(fixture.first.id),
      ).toMatchObject({
        projectionStatus: 'pending',
        projectedEntityCount: 0,
        builtAt: null,
      });
      expect(
        (await catalogue.searchProjectedEntities({ limit: 10 })).items,
      ).toEqual([]);
      const rebuilt = await catalogue.rebuildSearchProjections({
        mode: 'missing',
        correlationId: 'search-rebuild',
      });
      expect(rebuilt.map(({ publicationId }) => publicationId).sort()).toEqual(
        [fixture.first.id, fixture.second.id].sort(),
      );
      expect(
        await catalogue.rebuildSearchProjections({
          mode: 'missing',
          correlationId: 'search-rebuild-again',
        }),
      ).toEqual([]);
      const all = await catalogue.rebuildSearchProjections({
        mode: 'all',
        correlationId: 'search-rebuild-all',
      });
      expect(
        all.map(({ projectionContentHash }) => projectionContentHash),
      ).toEqual(
        rebuilt.map(({ projectionContentHash }) => projectionContentHash),
      );
    } finally {
      await catalogue.close();
    }

    const after = await withRawConnection(fixture.databasePath, (connection) =>
      tableDump(connection, [...knowledgeTables, ...projectionTables]),
    );
    for (const table of knowledgeTables) {
      expect(after[table]).toEqual(before[table]);
    }
    for (const table of projectionTables.filter(
      (table) => table !== 'search_projection_runs',
    )) {
      expect(after[table]).toEqual(before[table]);
    }
    const stripBuiltAt = (rows: unknown) =>
      (rows as Record<string, unknown>[]).map((row) => ({
        ...row,
        built_at: undefined,
      }));
    expect(stripBuiltAt(after.search_projection_runs)).toEqual(
      stripBuiltAt(before.search_projection_runs),
    );
  });

  it('isolates publications and searches historical and current publications', async () => {
    const { catalogue, first, second } = await createFixture();
    try {
      await projectAllPublished(catalogue);

      const historical = await catalogue.searchProjectedEntities({
        publicationId: first.id,
        text: { query: 'react', match: 'exact', field: 'name' },
        limit: 10,
      });
      expect(historical.items).toEqual([]);
      const current = await catalogue.searchProjectedEntities({
        text: { query: 'react', match: 'exact', field: 'name' },
        limit: 10,
      });
      expect(current.items).toHaveLength(1);
      expect(current.items[0]?.publicationId).toBe(second.id);

      const lodashHistorical = await catalogue.searchProjectedEntities({
        publicationId: first.id,
        text: { query: 'LODASH', match: 'exact', field: 'name' },
        limit: 10,
      });
      const lodashCurrent = await catalogue.searchProjectedEntities({
        text: { query: 'lodash', match: 'exact', field: 'name' },
        limit: 10,
      });
      expect(lodashHistorical.items[0]?.entityId).toBe(
        lodashCurrent.items[0]?.entityId,
      );
      expect(lodashHistorical.items[0]?.publicationId).toBe(first.id);
      expect(lodashCurrent.items[0]?.publicationId).toBe(second.id);
      expect(
        await catalogue.getProjectedEntity(
          lodashCurrent.items[0]!.entityId,
          first.id,
        ),
      ).toEqual(lodashHistorical.items[0]);
      expect(
        await catalogue.getProjectedEntity(lodashCurrent.items[0]!.entityId),
      ).toEqual(lodashCurrent.items[0]);

      const reactEntityId = current.items[0]!.entityId;
      expect(
        await catalogue.getProjectedEntity(reactEntityId, first.id),
      ).toBeUndefined();
      const reactRelationships = await catalogue.searchProjectedRelationships({
        entityId: reactEntityId,
        limit: 10,
      });
      expect(reactRelationships.items).toHaveLength(1);
      expect(
        (
          await catalogue.searchProjectedRelationships({
            publicationId: first.id,
            entityId: reactEntityId,
            limit: 10,
          })
        ).items,
      ).toEqual([]);
      expect(
        await catalogue.getProjectedRelationship(
          reactRelationships.items[0]!.relationshipId,
        ),
      ).toEqual(reactRelationships.items[0]);
      expect(
        await catalogue.getProjectedRelationship(
          reactRelationships.items[0]!.relationshipId,
          first.id,
        ),
      ).toBeUndefined();
    } finally {
      await catalogue.close();
    }
  });

  it('supports deterministic contains, prefix and exact matching with cursor pagination', async () => {
    const { catalogue, second } = await createFixture();
    try {
      await projectAllPublished(catalogue);
      const names = async (
        query: string,
        match: 'contains' | 'prefix' | 'exact',
        field: 'name' | 'text' = 'name',
      ) =>
        (
          await catalogue.searchProjectedEntities({
            text: { query, match, field },
            limit: 10,
          })
        ).items
          .map(({ name }) => name)
          .sort();

      expect(await names('workspace', 'contains')).toEqual([
        '@workspace/service',
        '@workspace/web',
      ]);
      expect(await names('workspace', 'prefix')).toEqual([]);
      expect(await names('@workspace/w', 'prefix')).toEqual(['@workspace/web']);
      expect(await names('@workspace/web', 'exact')).toEqual([
        '@workspace/web',
      ]);
      expect(await names('@workspace/we', 'exact')).toEqual([]);
      expect(await names('serv', 'prefix', 'text')).toEqual([
        '@workspace/service',
      ]);
      expect(await names('package', 'exact', 'text')).toHaveLength(4);
      expect(await names('ash pack', 'contains', 'text')).toEqual(['lodash']);
      expect(await names('lodahs', 'contains')).toEqual([]);

      const relationshipTypes = async (
        query: string,
        match: 'contains' | 'prefix' | 'exact',
        field: 'type' | 'text',
      ) =>
        (
          await catalogue.searchProjectedRelationships({
            text: { query, match, field },
            limit: 10,
          })
        ).items.length;
      expect(await relationshipTypes('depends_on', 'exact', 'type')).toBe(2);
      expect(await relationshipTypes('DEPENDS', 'prefix', 'type')).toBe(2);
      expect(await relationshipTypes('ends_o', 'contains', 'type')).toBe(2);
      expect(await relationshipTypes('ends_o', 'prefix', 'type')).toBe(0);
      expect(await relationshipTypes('react', 'exact', 'text')).toBe(1);
      expect(
        (
          await catalogue.searchProjectedRelationships({
            type: 'USES',
            limit: 10,
          })
        ).items,
      ).toEqual([]);

      expect(
        (
          await catalogue.searchProjectedEntities({
            type: 'api',
            limit: 10,
          })
        ).items,
      ).toEqual([]);
      expect(
        (
          await catalogue.searchProjectedEntities({
            lifecycleStatus: 'observed',
            limit: 10,
          })
        ).items,
      ).toHaveLength(4);

      const all = (
        await catalogue.searchProjectedEntities({
          publicationId: second.id,
          limit: 10,
        })
      ).items;
      expect(all.map(({ entityId }) => entityId)).toEqual(
        all.map(({ entityId }) => entityId).sort(),
      );
      const page = await catalogue.searchProjectedEntities({
        publicationId: second.id,
        limit: 2,
      });
      const next = await catalogue.searchProjectedEntities({
        publicationId: second.id,
        afterId: page.items[1]!.entityId,
        limit: 10,
      });
      expect([...page.items, ...next.items]).toEqual(all);
      await expect(
        catalogue.searchProjectedEntities({ limit: 102 }),
      ).rejects.toThrow('between 1 and 101');
    } finally {
      await catalogue.close();
    }
  });

  it('leaves a failed rebuild pending without fallback, false success or authoritative impact', async () => {
    const fixture = await createFixture();
    let catalogue = fixture.catalogue;
    const { first, second } = fixture;
    await projectAllPublished(catalogue);
    const firstStatistics = await catalogue.getProjectionStatistics(first.id);
    const firstEntities = await catalogue.searchProjectedEntities({
      publicationId: first.id,
      limit: 10,
    });
    const builtEvents = await pendingEvents(catalogue, 'SearchProjectionBuilt');
    await catalogue.close();

    // Simulate a corrupt V2-only snapshot and a lost V2 projection so the
    // startup reconciliation genuinely fails for V2 while V1 stays built.
    const corruptVersionId = second.entityVersionIds.find(
      (versionId) => !first.entityVersionIds.includes(versionId),
    );
    expect(corruptVersionId).toBeDefined();
    const before = await withRawConnection(
      fixture.databasePath,
      async (connection) => {
        await connection.run(
          `UPDATE entity_versions SET snapshot_json = json_merge_patch(snapshot_json, json_object('currentVersionId', $2)) WHERE id = $1`,
          [corruptVersionId!, first.entityVersionIds[0]!],
        );
        for (const table of projectionTables) {
          await connection.run(
            `DELETE FROM ${table} WHERE publication_id = $1`,
            [second.id],
          );
        }
        return tableDump(connection, [...knowledgeTables, ...projectionTables]);
      },
    );

    catalogue = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    try {
      await expect(
        catalogue.rebuildSearchProjections({
          mode: 'missing',
          correlationId: 'search-startup-failure',
        }),
      ).rejects.toThrow('does not match its snapshot');

      expect(await catalogue.getProjectionStatistics(second.id)).toEqual({
        publication: second,
        projectionStatus: 'pending',
        projectionSchemaVersion: null,
        projectionContentHash: null,
        projectedEntityCount: 0,
        projectedRelationshipCount: 0,
        projectedSearchDocumentCount: 0,
        builtAt: null,
      });
      expect(await catalogue.getProjectionStatistics(first.id)).toEqual(
        firstStatistics,
      );
      expect(await pendingEvents(catalogue, 'SearchProjectionBuilt')).toEqual(
        builtEvents,
      );

      // Current scope resolves to V2 and never falls back to V1 rows.
      expect(
        (await catalogue.searchProjectedEntities({ limit: 10 })).items,
      ).toEqual([]);
      expect(
        (await catalogue.searchProjectedRelationships({ limit: 10 })).items,
      ).toEqual([]);
      expect(
        await catalogue.getProjectedEntity(firstEntities.items[0]!.entityId),
      ).toBeUndefined();
      expect(
        (
          await catalogue.searchProjectedEntities({
            publicationId: second.id,
            limit: 10,
          })
        ).items,
      ).toEqual([]);
      expect(
        await catalogue.searchProjectedEntities({
          publicationId: first.id,
          limit: 10,
        }),
      ).toEqual(firstEntities);

      expect(
        (await catalogue.listKnowledgePublications({ limit: 10 })).items,
      ).toHaveLength(2);
      expect((await catalogue.listSources({ limit: 10 })).items).toHaveLength(
        1,
      );
    } finally {
      await catalogue.close();
    }

    const after = await withRawConnection(fixture.databasePath, (connection) =>
      tableDump(connection, [...knowledgeTables, ...projectionTables]),
    );
    expect(after).toEqual(before);
  });
});
