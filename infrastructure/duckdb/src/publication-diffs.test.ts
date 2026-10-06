import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import {
  CatalogueIntegrityError,
  type CatalogueDiscovery,
} from '@workspace-brain/catalogue';
import {
  createKnowledgeEntityKey,
  type DiscoveryEvent,
  type Document,
  type KnowledgeCandidateEvent,
  type KnowledgeInputEvidence,
  type KnowledgePublication,
} from '@workspace-brain/domain';
import {
  publicationDiffContent,
  type PublicationDiff,
} from '@workspace-brain/domain-evolution';
import { createPublicationDiffService } from '@workspace-brain/publication-diff-service';
import { afterEach, describe, expect, it } from 'vitest';

import { createDuckDbCatalogue } from './index.js';

const migrationsDirectory = resolve(
  process.cwd(),
  'infrastructure/duckdb/migrations',
);
const temporaryDirectories: string[] = [];
const authoritativeTables = [
  'knowledge_models',
  'knowledge_entities',
  'knowledge_relationships',
  'entity_versions',
  'relationship_versions',
  'knowledge_publications',
] as const;
const projectionTables = [
  'search_projection_runs',
  'search_projected_entities',
  'search_projected_relationships',
  'search_projected_documents',
  'search_projected_terms',
] as const;
const diffTables = [
  'publication_diff_relationship_changes',
  'publication_diff_entity_changes',
  'publication_diffs',
] as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

type Catalogue = CatalogueDiscovery & { close(): Promise<void> };

type Fixture = {
  readonly databasePath: string;
  readonly catalogue: Catalogue;
  /** service → lodash, left-pad */
  readonly first: KnowledgePublication;
  /** first + web → react */
  readonly second: KnowledgePublication;
  /** service re-versioned → lodash, chalk */
  readonly third: KnowledgePublication;
};

const contents = {
  service:
    '{"name":"@workspace/service","dependencies":{"lodash":"^4","left-pad":"^1"}}',
  web: '{"name":"@workspace/web","dependencies":{"react":"^19"}}',
  serviceV2:
    '{"name":"@workspace/service","dependencies":{"lodash":"^4","chalk":"^5"}}',
} as const;

async function createFixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-brain-diff-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'catalogue.duckdb');
  const catalogue = await createDuckDbCatalogue(
    databasePath,
    migrationsDirectory,
  );
  await catalogue.registerConfiguration(
    [
      {
        configId: 'diff-source',
        name: 'Diff Source',
        rootPaths: [join(directory, 'source')],
        excludeDirs: [],
        includeExtensions: ['.json'],
        maxFileSizeBytes: 4096,
      },
    ],
    [
      {
        configId: 'diff-workspace',
        name: 'Diff Workspace',
        sourceConfigIds: ['diff-source'],
        include: ['**'],
        exclude: [],
      },
    ],
  );
  const source = (await catalogue.listSources({ limit: 10 })).items[0];
  const root = source?.roots?.[0];
  if (source === undefined || root === undefined) {
    throw new Error('Diff source registration failed');
  }
  const sourceId = source.id;

  async function scan(
    files: Record<'service' | 'web', string>,
    at: string,
    correlationId: string,
  ): Promise<readonly Document[]> {
    const result = await catalogue.persistScan(
      sourceId,
      [],
      Object.entries(files).map(([folder, content]) => ({
        path: `${root!.id}/${folder}/package.json`,
        filename: 'package.json',
        extension: '.json',
        sizeBytes: Buffer.byteLength(content),
        modifiedAt: at,
        fingerprint: fingerprint(content),
        discoveryMethod: 'filesystem' as const,
      })),
      at,
      correlationId,
      10,
    );
    return result.documents;
  }

  async function publishPackage(
    documents: readonly Document[],
    folder: 'service' | 'web',
    content: string,
    owner: string,
    dependencies: readonly string[],
    step: string,
    processedAt: string,
  ): Promise<void> {
    const document = documents.find(({ path }) =>
      path.endsWith(`/${folder}/package.json`),
    );
    if (document === undefined) {
      throw new Error('Diff document fixture was not persisted');
    }
    const evidenceFor = (pointer: string, excerpt: string) => ({
      key: `json:${pointer}`,
      kind: 'structured-value' as const,
      excerpt,
      truncated: false,
      locator: { kind: 'json-pointer' as const, pointer },
    });
    const processingEvent: Extract<
      DiscoveryEvent,
      { readonly eventType: 'DocumentProcessingSubmitted' }
    > = {
      eventId: `diff-processing-${step}`,
      eventType: 'DocumentProcessingSubmitted',
      eventVersion: 1,
      occurredAt: processedAt,
      producer: 'workspace-brain-knowledge-worker',
      correlationId: `diff-processing-${step}`,
      idempotencyKey: `diff-processing-${step}`,
      partitionKey: sourceId,
      payload: {
        candidate: {
          documentId: document.id,
          sourceId,
          path: document.path,
          contentFingerprint: fingerprint(content),
          processedAt,
          durationMilliseconds: 1,
          processorId: 'json',
          processorVersion: 1,
          extractionRuleId: 'json-scalar-values',
          extractionRuleVersion: 1,
          evidence: [
            evidenceFor('/name', owner),
            ...dependencies.map((dependency) =>
              evidenceFor(`/dependencies/${dependency}`, '^1'),
            ),
          ],
        },
      },
    };
    const processed = await catalogue.applyDocumentProcessing(processingEvent);
    const inputs = await catalogue.listKnowledgeInputEvidence(
      processed.documentVersion.id,
    );
    const input = (key: string): KnowledgeInputEvidence => {
      const found = inputs.find(({ evidence }) => evidence.key === key);
      if (found === undefined) {
        throw new Error(`Diff evidence ${key} was not persisted`);
      }
      return found;
    };
    const provenance = (item: KnowledgeInputEvidence) => ({
      evidenceId: item.evidence.id,
      documentVersionId: item.documentVersion.id,
      documentId: item.document.id,
      sourceId: item.document.sourceId,
      documentPath: item.document.path,
      contentFingerprint: item.provenance.contentFingerprint,
      locator: item.evidence.locator,
      processorId: item.provenance.processorId,
      processorVersion: item.provenance.processorVersion,
      extractionRuleId: item.provenance.extractionRuleId,
      extractionRuleVersion: item.provenance.extractionRuleVersion,
      knowledgeExtractorId: 'deterministic-knowledge-extractors',
      knowledgeExtractorVersion: 1 as const,
    });
    const keyFor = (name: string) =>
      createKnowledgeEntityKey('package', sourceId, document.path, name);
    const ownerInput = input('json:/name');
    const ownerKey = keyFor(owner);
    const event: KnowledgeCandidateEvent = {
      eventId: `diff-candidates-${step}`,
      eventType: 'KnowledgeCandidatesSubmitted',
      eventVersion: 1,
      occurredAt: processedAt,
      producer: 'workspace-brain-knowledge-worker',
      correlationId: `diff-candidates-${step}`,
      idempotencyKey: `diff-candidates-${step}`,
      partitionKey: sourceId,
      payload: {
        sourceId,
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
          ...dependencies.map((dependency) => {
            const dependencyInput = input(`json:/dependencies/${dependency}`);
            return {
              key: keyFor(dependency),
              type: 'package' as const,
              identityScope: document.path,
              name: dependency,
              sourceEvidenceIds: [dependencyInput.evidence.id],
              provenance: [provenance(dependencyInput)],
              lifecycleStatus: 'observed' as const,
            };
          }),
        ],
        relationships: dependencies.map((dependency) => {
          const dependencyInput = input(`json:/dependencies/${dependency}`);
          return {
            key: `DEPENDS_ON:${ownerKey}->${keyFor(dependency)}`,
            type: 'DEPENDS_ON' as const,
            sourceEntityKey: ownerKey,
            targetEntityKey: keyFor(dependency),
            sourceEvidenceIds: [dependencyInput.evidence.id],
            provenance: [provenance(dependencyInput)],
            confidence: 1,
            lifecycleStatus: 'related' as const,
          };
        }),
      },
    };
    await catalogue.applyKnowledgeCandidates(event);
  }

  const initial = await scan(
    { service: contents.service, web: contents.web },
    '2026-12-01T08:00:00.000Z',
    'diff-scan-1',
  );
  await publishPackage(
    initial,
    'service',
    contents.service,
    '@workspace/service',
    ['lodash', 'left-pad'],
    'service-v1',
    '2026-12-01T08:00:01.000Z',
  );
  await publishPackage(
    initial,
    'web',
    contents.web,
    '@workspace/web',
    ['react'],
    'web-v1',
    '2026-12-01T08:00:02.000Z',
  );
  const rescanned = await scan(
    { service: contents.serviceV2, web: contents.web },
    '2026-12-01T08:00:03.000Z',
    'diff-scan-2',
  );
  await publishPackage(
    rescanned,
    'service',
    contents.serviceV2,
    '@workspace/service',
    ['lodash', 'chalk'],
    'service-v2',
    '2026-12-01T08:00:04.000Z',
  );

  const publications = (
    await catalogue.listKnowledgePublications({ limit: 10 })
  ).items
    .slice()
    .sort((left, right) => left.version - right.version);
  const [first, second, third] = publications;
  if (
    publications.length !== 3 ||
    first === undefined ||
    second === undefined ||
    third === undefined
  ) {
    throw new Error(
      `Expected three publications, found ${publications.length}`,
    );
  }
  return { databasePath, catalogue, first, second, third };
}

function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function serviceFor(catalogue: CatalogueDiscovery) {
  return createPublicationDiffService({
    snapshots: catalogue,
    store: catalogue,
  });
}

async function compare(
  catalogue: CatalogueDiscovery,
  from: KnowledgePublication,
  to: KnowledgePublication,
): Promise<PublicationDiff> {
  const result = await serviceFor(catalogue).compare(from.id, to.id);
  if (result.status !== 'found') {
    throw new Error('Expected publication diff');
  }
  return result.diff;
}

function content(diff: PublicationDiff) {
  return publicationDiffContent(diff);
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

async function projectAllPublished(catalogue: CatalogueDiscovery) {
  const pending = async <EventType extends DiscoveryEvent['eventType']>(
    eventType: EventType,
  ) =>
    (await catalogue.listPendingDiscoveryEvents(500)).filter(
      (
        event,
      ): event is Extract<DiscoveryEvent, { readonly eventType: EventType }> =>
        event.eventType === eventType,
    );
  for (const event of await pending('KnowledgeModelPublished')) {
    await catalogue.requestSearchProjection(event);
  }
  for (const request of await pending('SearchProjectionRequested')) {
    await catalogue.buildSearchProjection(request);
  }
}

describe('DuckDB publication diffs', () => {
  it('compares publications by stable identity and immutable version', async () => {
    const { catalogue, first, second, third } = await createFixture();
    try {
      const growth = await compare(catalogue, first, second);
      expect(growth.summary).toEqual({
        entitiesAdded: 2,
        entitiesRemoved: 0,
        entitiesModified: 0,
        entitiesUnchanged: 3,
        relationshipsAdded: 1,
        relationshipsRemoved: 0,
        relationshipsModified: 0,
        relationshipsUnchanged: 2,
      });
      expect(
        growth.entityChanges.map(({ name, changeType }) => [name, changeType]),
      ).toEqual(
        expect.arrayContaining([
          ['@workspace/web', 'ADDED'],
          ['react', 'ADDED'],
        ]),
      );

      const evolution = await compare(catalogue, second, third);
      expect(evolution.summary).toEqual({
        entitiesAdded: 1,
        entitiesRemoved: 1,
        entitiesModified: 2,
        entitiesUnchanged: 2,
        relationshipsAdded: 1,
        relationshipsRemoved: 1,
        relationshipsModified: 1,
        relationshipsUnchanged: 1,
      });
      const byName = Object.fromEntries(
        evolution.entityChanges.map((change) => [change.name, change]),
      );
      expect(byName.chalk?.changeType).toBe('ADDED');
      expect(byName['left-pad']?.changeType).toBe('REMOVED');
      expect(byName.lodash?.changeType).toBe('MODIFIED');
      expect(byName.lodash?.changedFields).toEqual([
        'sourceEvidenceIds',
        'provenance',
      ]);
      expect(byName['@workspace/service']?.changeType).toBe('MODIFIED');
      expect(byName.lodash!.to!.versionNumber).toBeGreaterThan(
        byName.lodash!.from!.versionNumber,
      );
      const targets = new Map(
        evolution.entityChanges.map((change) => [change.entityId, change.name]),
      );
      expect(
        evolution.relationshipChanges
          .map((change) => [
            targets.get(change.targetEntityId),
            change.changeType,
          ])
          .sort(),
      ).toEqual([
        ['chalk', 'ADDED'],
        ['left-pad', 'REMOVED'],
        ['lodash', 'MODIFIED'],
      ]);
      expect([
        ...evolution.entityChanges.map(({ entityId }) => entityId),
      ]).toEqual(
        [...evolution.entityChanges.map(({ entityId }) => entityId)].sort(),
      );

      expect(await catalogue.getPublicationDiff(evolution.id)).toEqual(
        evolution,
      );
      expect(await catalogue.findPublicationDiff(second.id, third.id)).toEqual(
        evolution,
      );
      const listed = await catalogue.listPublicationComparisons({
        publicationId: second.id,
        limit: 10,
      });
      expect(listed.items.map(({ id }) => id).sort()).toEqual(
        [growth.id, evolution.id].sort(),
      );
      expect(listed.items[0]).not.toHaveProperty('entityChanges');
      const firstPage = await catalogue.listPublicationComparisons({
        publicationId: second.id,
        limit: 1,
      });
      const nextPage = await catalogue.listPublicationComparisons({
        publicationId: second.id,
        afterId: firstPage.items[0]!.id,
        limit: 1,
      });
      expect([...firstPage.items, ...nextPage.items]).toEqual(listed.items);
      expect(
        (
          await catalogue.listPublicationComparisons({
            publicationId: first.id,
            limit: 10,
          })
        ).items.map(({ id }) => id),
      ).toEqual([growth.id]);
    } finally {
      await catalogue.close();
    }
  });

  it('reuses a stored diff and returns an empty diff for identical publications', async () => {
    const { catalogue, first, third } = await createFixture();
    try {
      const created = await compare(catalogue, first, third);
      const repeated = await compare(catalogue, first, third);
      expect(repeated).toEqual(created);
      const reversed = await compare(catalogue, third, first);
      expect(reversed.id).not.toBe(created.id);
      expect(reversed.summary.entitiesAdded).toBe(
        created.summary.entitiesRemoved,
      );
      const identity = await compare(catalogue, third, third);
      expect(identity.entityChanges).toEqual([]);
      expect(identity.relationshipChanges).toEqual([]);
    } finally {
      await catalogue.close();
    }
  });

  it('preserves historical integrity and regenerates identical diffs', async () => {
    const fixture = await createFixture();
    let catalogue: Catalogue = fixture.catalogue;
    await projectAllPublished(catalogue);
    const exploreBefore = await Promise.all([
      catalogue.getKnowledgePublicationSummary(fixture.first.id),
      catalogue.getKnowledgePublicationSummary(fixture.third.id),
      catalogue.listKnowledgeEntities({
        publicationId: fixture.first.id,
        limit: 50,
      }),
      catalogue.searchProjectedEntities({
        publicationId: fixture.first.id,
        limit: 50,
      }),
    ]);
    await catalogue.close();
    const before = await withRawConnection(fixture.databasePath, (connection) =>
      tableDump(connection, [...authoritativeTables, ...projectionTables]),
    );

    catalogue = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    let original: PublicationDiff;
    try {
      original = await compare(catalogue, fixture.first, fixture.third);
      await compare(catalogue, fixture.second, fixture.third);
    } finally {
      await catalogue.close();
    }

    const afterDiff = await withRawConnection(
      fixture.databasePath,
      async (connection) => {
        const dump = await tableDump(connection, [
          ...authoritativeTables,
          ...projectionTables,
        ]);
        // Diffs are disposable: discard every derived diff row.
        for (const table of diffTables) {
          await connection.run(`DELETE FROM ${table}`);
        }
        return dump;
      },
    );
    for (const table of [...authoritativeTables, ...projectionTables]) {
      expect(afterDiff[table]).toEqual(before[table]);
    }

    catalogue = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    try {
      expect(await catalogue.getPublicationDiff(original.id)).toBeUndefined();
      expect(
        (
          await catalogue.listPublicationComparisons({
            publicationId: fixture.first.id,
            limit: 10,
          })
        ).items,
      ).toEqual([]);
      const regenerated = await compare(
        catalogue,
        fixture.first,
        fixture.third,
      );
      expect(regenerated.id).not.toBe(original.id);
      expect(content(regenerated)).toEqual(content(original));
      expect(regenerated.contentHash).toBe(original.contentHash);
      expect(await serviceFor(catalogue).getDiff(regenerated.id)).toEqual(
        regenerated,
      );

      const exploreAfter = await Promise.all([
        catalogue.getKnowledgePublicationSummary(fixture.first.id),
        catalogue.getKnowledgePublicationSummary(fixture.third.id),
        catalogue.listKnowledgeEntities({
          publicationId: fixture.first.id,
          limit: 50,
        }),
        catalogue.searchProjectedEntities({
          publicationId: fixture.first.id,
          limit: 50,
        }),
      ]);
      expect(exploreAfter).toEqual(exploreBefore);
    } finally {
      await catalogue.close();
    }

    const after = await withRawConnection(fixture.databasePath, (connection) =>
      tableDump(connection, [...authoritativeTables, ...projectionTables]),
    );
    for (const table of [...authoritativeTables, ...projectionTables]) {
      expect(after[table]).toEqual(before[table]);
    }
  });

  it('detects tampered stored diffs and replaces them on comparison', async () => {
    const fixture = await createFixture();
    let catalogue: Catalogue = fixture.catalogue;
    const created = await compare(catalogue, fixture.second, fixture.third);
    await catalogue.close();
    await withRawConnection(fixture.databasePath, (connection) =>
      connection.run(
        "UPDATE publication_diff_entity_changes SET change_type = 'ADDED' WHERE diff_id = $1 AND change_type = 'REMOVED'",
        [created.id],
      ),
    );
    catalogue = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    try {
      await expect(
        serviceFor(catalogue).getDiff(created.id),
      ).rejects.toBeInstanceOf(CatalogueIntegrityError);
      const repaired = await compare(catalogue, fixture.second, fixture.third);
      expect(repaired.id).not.toBe(created.id);
      expect(content(repaired)).toEqual(content(created));
      expect(await catalogue.getPublicationDiff(created.id)).toBeUndefined();
      expect(await serviceFor(catalogue).getDiff(repaired.id)).toEqual(
        repaired,
      );
    } finally {
      await catalogue.close();
    }
  });

  it('replaces malformed stored diffs whose header hash still matches', async () => {
    const fixture = await createFixture();
    let catalogue: Catalogue = fixture.catalogue;
    const created = await compare(catalogue, fixture.second, fixture.third);
    await catalogue.close();
    await withRawConnection(fixture.databasePath, (connection) =>
      connection.run(
        `UPDATE publication_diff_entity_changes SET changed_fields_json = '["notAField"]' WHERE diff_id = $1`,
        [created.id],
      ),
    );
    catalogue = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    try {
      await expect(
        catalogue.getPublicationDiff(created.id),
      ).rejects.toBeInstanceOf(CatalogueIntegrityError);
      const repaired = await compare(catalogue, fixture.second, fixture.third);
      expect(repaired.id).not.toBe(created.id);
      expect(content(repaired)).toEqual(content(created));
      expect(await catalogue.getPublicationDiff(created.id)).toBeUndefined();
      // A direct save of matching content must also not keep a malformed row.
      expect(
        await catalogue.savePublicationDiff({
          ...repaired,
          id: created.id,
        }),
      ).toEqual(repaired);
    } finally {
      await catalogue.close();
    }
  });

  it('verifies listed comparison summaries against their publications', async () => {
    const fixture = await createFixture();
    let catalogue: Catalogue = fixture.catalogue;
    const created = await compare(catalogue, fixture.second, fixture.third);
    const listed = await serviceFor(catalogue).listComparisons({
      publicationId: fixture.second.id,
      limit: 10,
    });
    expect(listed.items.map(({ id }) => id)).toEqual([created.id]);
    await catalogue.close();
    await withRawConnection(fixture.databasePath, (connection) =>
      connection.run(
        'UPDATE publication_diffs SET entities_added = entities_added + 1 WHERE id = $1',
        [created.id],
      ),
    );
    catalogue = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    try {
      await expect(
        serviceFor(catalogue).listComparisons({
          publicationId: fixture.second.id,
          limit: 10,
        }),
      ).rejects.toBeInstanceOf(CatalogueIntegrityError);
      const repaired = await compare(catalogue, fixture.second, fixture.third);
      expect(
        (
          await serviceFor(catalogue).listComparisons({
            publicationId: fixture.second.id,
            limit: 10,
          })
        ).items.map(({ id }) => id),
      ).toEqual([repaired.id]);
    } finally {
      await catalogue.close();
    }
  });

  it('replaces a stored diff whose header ID is malformed', async () => {
    const fixture = await createFixture();
    let catalogue: Catalogue = fixture.catalogue;
    const created = await compare(catalogue, fixture.second, fixture.third);
    await catalogue.close();
    await withRawConnection(fixture.databasePath, async (connection) => {
      for (const table of [
        'publication_diff_entity_changes',
        'publication_diff_relationship_changes',
      ]) {
        await connection.run(
          `UPDATE ${table} SET diff_id = 'not-a-ulid' WHERE diff_id = $1`,
          [created.id],
        );
      }
      await connection.run(
        "UPDATE publication_diffs SET id = 'not-a-ulid' WHERE id = $1",
        [created.id],
      );
    });
    catalogue = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    let repaired: PublicationDiff;
    try {
      repaired = await compare(catalogue, fixture.second, fixture.third);
      expect(content(repaired)).toEqual(content(created));
      expect(await catalogue.getPublicationDiff(repaired.id)).toEqual(repaired);
    } finally {
      await catalogue.close();
    }
    const counts = await withRawConnection(
      fixture.databasePath,
      async (connection) =>
        (
          await connection.runAndReadAll(
            "SELECT (SELECT count(*) FROM publication_diffs) AS diffs, (SELECT count(*) FROM publication_diffs WHERE id = 'not-a-ulid') + (SELECT count(*) FROM publication_diff_entity_changes WHERE diff_id = 'not-a-ulid') + (SELECT count(*) FROM publication_diff_relationship_changes WHERE diff_id = 'not-a-ulid') AS malformed",
          )
        ).getRowObjectsJson()[0],
    );
    expect(counts).toEqual({ diffs: '1', malformed: '0' });
  });
});
