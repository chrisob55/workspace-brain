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
  createDocumentVersionId,
  createKnowledgeEntityKey,
  type DiscoveryEvent,
  type Document,
  type KnowledgeCandidateEvent,
  type KnowledgeInputEvidence,
  type KnowledgePublication,
} from '@workspace-brain/domain';
import {
  classifyPublicationCurrency,
  type KnowledgeObjectCurrency,
  type PublicationCurrency,
} from '@workspace-brain/domain-currency';
import { serializeKnowledgePublicationPackage } from '@workspace-brain/domain-publication';
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
const catalogueTables = [
  'documents',
  'document_versions',
  'document_current_versions',
  'extracted_evidence',
  'inventory_records',
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
type Folder = 'service' | 'web' | 'other';

const contents = {
  service:
    '{"name":"@workspace/service","dependencies":{"lodash":"^4","left-pad":"^1"}}',
  web: '{"name":"@workspace/web","dependencies":{"react":"^19"}}',
  other: '{"name":"@workspace/other","dependencies":{"vitest":"^3"}}',
  otherV2: '{"name":"@workspace/other","dependencies":{"tsx":"^4"}}',
  serviceV2:
    '{"name":"@workspace/service","dependencies":{"lodash":"^4","chalk":"^5"}}',
} as const;

const dependencies = {
  service: ['lodash', 'left-pad'],
  web: ['react'],
  serviceV2: ['lodash', 'chalk'],
} as const;

type Fixture = {
  readonly databasePath: string;
  readonly catalogue: Catalogue;
  /** service → lodash, left-pad; web → react. Every object is CURRENT. */
  readonly publication: KnowledgePublication;
  scan(
    files: Partial<Record<Folder, string>>,
    step: string,
  ): Promise<readonly Document[]>;
  process(
    documents: readonly Document[],
    folder: Folder,
    content: string,
    step: string,
    processorVersion?: number,
  ): Promise<string>;
  publish(
    documents: readonly Document[],
    folder: Folder,
    content: string,
    names: readonly string[],
    step: string,
  ): Promise<void>;
  documentId(folder: Folder): Promise<string>;
};

let clock = Date.parse('2027-01-01T08:00:00.000Z');
const nextTimestamp = () => {
  clock += 1000;
  return new Date(clock).toISOString();
};

async function createFixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-brain-currency-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'catalogue.duckdb');
  const catalogue = await createDuckDbCatalogue(
    databasePath,
    migrationsDirectory,
  );
  await catalogue.registerConfiguration(
    [
      {
        configId: 'currency-source',
        name: 'Currency Source',
        rootPaths: [join(directory, 'source')],
        excludeDirs: [],
        includeExtensions: ['.json'],
        maxFileSizeBytes: 4096,
      },
    ],
    [
      {
        configId: 'currency-workspace',
        name: 'Currency Workspace',
        sourceConfigIds: ['currency-source'],
        include: ['**'],
        exclude: [],
      },
    ],
  );
  const source = (await catalogue.listSources({ limit: 10 })).items[0];
  const root = source?.roots?.[0];
  if (source === undefined || root === undefined) {
    throw new Error('Currency source registration failed');
  }
  const sourceId = source.id;
  const pathFor = (folder: Folder) => `${root.id}/${folder}/package.json`;

  const scan: Fixture['scan'] = async (files, step) => {
    const at = nextTimestamp();
    const result = await catalogue.persistScan(
      sourceId,
      [],
      Object.entries(files).map(([folder, content]) => ({
        path: pathFor(folder as Folder),
        filename: 'package.json',
        extension: '.json',
        sizeBytes: Buffer.byteLength(content),
        modifiedAt: at,
        fingerprint: fingerprint(content),
        discoveryMethod: 'filesystem' as const,
      })),
      at,
      `currency-scan-${step}`,
      10,
    );
    return result.documents;
  };

  const findDocument = (documents: readonly Document[], folder: Folder) => {
    const document = documents.find(({ path }) => path === pathFor(folder));
    if (document === undefined) {
      throw new Error('Currency document fixture was not persisted');
    }
    return document;
  };

  const evidenceFor = (pointer: string, excerpt: string) => ({
    key: `json:${pointer}`,
    kind: 'structured-value' as const,
    excerpt,
    truncated: false,
    locator: { kind: 'json-pointer' as const, pointer },
  });

  const processDocument = async (
    documents: readonly Document[],
    folder: Folder,
    content: string,
    step: string,
    processorVersion = 1,
  ) => {
    const document = findDocument(documents, folder);
    const parsed = JSON.parse(content) as {
      name: string;
      dependencies: Record<string, string>;
    };
    const processedAt = nextTimestamp();
    const event: Extract<
      DiscoveryEvent,
      { readonly eventType: 'DocumentProcessingSubmitted' }
    > = {
      eventId: `currency-processing-${step}`,
      eventType: 'DocumentProcessingSubmitted',
      eventVersion: 1,
      occurredAt: processedAt,
      producer: 'workspace-brain-knowledge-worker',
      correlationId: `currency-processing-${step}`,
      idempotencyKey: `currency-processing-${step}`,
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
          processorVersion,
          extractionRuleId: 'json-scalar-values',
          extractionRuleVersion: 1,
          evidence: [
            evidenceFor('/name', parsed.name),
            ...Object.entries(parsed.dependencies).map(([name, range]) =>
              evidenceFor(`/dependencies/${name}`, range),
            ),
          ],
        },
      },
    };
    return (await catalogue.applyDocumentProcessing(event)).documentVersion.id;
  };

  const publish: Fixture['publish'] = async (
    documents,
    folder,
    content,
    names,
    step,
  ) => {
    const document = findDocument(documents, folder);
    const documentVersionId = await processDocument(
      documents,
      folder,
      content,
      step,
    );
    const owner = (JSON.parse(content) as { name: string }).name;
    const inputs =
      await catalogue.listKnowledgeInputEvidence(documentVersionId);
    const input = (key: string): KnowledgeInputEvidence => {
      const found = inputs.find(({ evidence }) => evidence.key === key);
      if (found === undefined) {
        throw new Error(`Currency evidence ${key} was not persisted`);
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
    const occurredAt = nextTimestamp();
    const event: KnowledgeCandidateEvent = {
      eventId: `currency-candidates-${step}`,
      eventType: 'KnowledgeCandidatesSubmitted',
      eventVersion: 1,
      occurredAt,
      producer: 'workspace-brain-knowledge-worker',
      correlationId: `currency-candidates-${step}`,
      idempotencyKey: `currency-candidates-${step}`,
      partitionKey: sourceId,
      payload: {
        sourceId,
        documentId: document.id,
        documentVersionId,
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
          ...names.map((name) => {
            const dependencyInput = input(`json:/dependencies/${name}`);
            return {
              key: keyFor(name),
              type: 'package' as const,
              identityScope: document.path,
              name,
              sourceEvidenceIds: [dependencyInput.evidence.id],
              provenance: [provenance(dependencyInput)],
              lifecycleStatus: 'observed' as const,
            };
          }),
        ],
        relationships: names.map((name) => {
          const dependencyInput = input(`json:/dependencies/${name}`);
          return {
            key: `DEPENDS_ON:${ownerKey}->${keyFor(name)}`,
            type: 'DEPENDS_ON' as const,
            sourceEntityKey: ownerKey,
            targetEntityKey: keyFor(name),
            sourceEvidenceIds: [dependencyInput.evidence.id],
            provenance: [provenance(dependencyInput)],
            confidence: 1,
            lifecycleStatus: 'related' as const,
          };
        }),
      },
    };
    await catalogue.applyKnowledgeCandidates(event);
  };

  const initial = await scan(
    {
      service: contents.service,
      web: contents.web,
      other: contents.other,
    },
    'initial',
  );
  await publish(
    initial,
    'service',
    contents.service,
    dependencies.service,
    'service-v1',
  );
  await publish(initial, 'web', contents.web, dependencies.web, 'web-v1');
  const publication = await latestPublication(catalogue);
  return {
    databasePath,
    catalogue,
    publication,
    scan,
    process: processDocument,
    publish,
    async documentId(folder) {
      return findDocument(
        (await catalogue.listDocuments({ limit: 10 })).items,
        folder,
      ).id;
    },
  };
}

async function latestPublication(
  catalogue: CatalogueDiscovery,
): Promise<KnowledgePublication> {
  const latest = (
    await catalogue.listKnowledgePublications({ limit: 50 })
  ).items
    .slice()
    .sort((left, right) => right.version - left.version)[0];
  if (latest === undefined) {
    throw new Error('Expected a publication');
  }
  return latest;
}

async function currency(
  catalogue: CatalogueDiscovery,
  publicationId: string,
): Promise<PublicationCurrency> {
  const inputs = await catalogue.getPublicationCurrencyInputs(publicationId);
  if (inputs === undefined) {
    throw new Error('Expected publication currency inputs');
  }
  return classifyPublicationCurrency(inputs);
}

describe('publication package export', () => {
  it('exports immutable publication snapshots with verified provenance', async () => {
    const fixture = await createFixture();
    const initialExport = await fixture.catalogue.getKnowledgePublicationExport(
      fixture.publication.id,
    );
    if (initialExport === undefined) {
      throw new Error('Expected publication export');
    }
    const initialBytes = serializeKnowledgePublicationPackage(initialExport);

    expect(initialExport.metadata).toMatchObject({
      publicationId: fixture.publication.id,
      publicationVersion: fixture.publication.version,
      contentHash: fixture.publication.contentHash,
      entityCount: 5,
      relationshipCount: 3,
    });
    expect(initialExport.provenance.length).toBe(
      initialExport.entities.length + initialExport.relationships.length,
    );
    expect(
      initialExport.entities.every(
        ({ entity }) => entity.provenance.length > 0,
      ),
    ).toBe(true);

    const rescanned = await fixture.scan(
      {
        service: contents.serviceV2,
        web: contents.web,
        other: contents.other,
      },
      'publication-export-changed-current-state',
    );
    await fixture.publish(
      rescanned,
      'service',
      contents.serviceV2,
      dependencies.serviceV2,
      'publication-export-publish-newer',
    );
    const historicalExport =
      await fixture.catalogue.getKnowledgePublicationExport(
        fixture.publication.id,
      );
    if (historicalExport === undefined) {
      throw new Error('Expected historical publication export');
    }

    expect(serializeKnowledgePublicationPackage(historicalExport)).toBe(
      initialBytes,
    );
    expect(historicalExport).toEqual(initialExport);
  });
});

/** Records keyed by entity name or relationship target name. */
async function byName(
  catalogue: CatalogueDiscovery,
  publicationId: string,
  result: PublicationCurrency,
): Promise<Record<string, KnowledgeObjectCurrency>> {
  const snapshot = await catalogue.getPublicationSnapshot(publicationId);
  const names = new Map<string, string>();
  for (const { entity } of snapshot?.entities ?? []) {
    names.set(entity.id, entity.name);
  }
  for (const { relationship } of snapshot?.relationships ?? []) {
    names.set(
      relationship.id,
      `${names.get(relationship.sourceEntityId)}->${names.get(relationship.targetEntityId)}`,
    );
  }
  return Object.fromEntries(
    result.records.map((record) => [names.get(record.id) ?? record.id, record]),
  );
}

function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex');
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

const serviceNames = [
  '@workspace/service',
  'lodash',
  'left-pad',
  '@workspace/service->lodash',
  '@workspace/service->left-pad',
] as const;
const webNames = ['@workspace/web', 'react', '@workspace/web->react'] as const;

describe('DuckDB publication currency', () => {
  it('excludes unrelated catalogue changes from the publication basis hash', async () => {
    const fixture = await createFixture();
    const { catalogue, publication } = fixture;
    try {
      const before = await currency(catalogue, publication.id);
      const documents = (await catalogue.listDocuments({ limit: 10 })).items;
      await fixture.process(documents, 'other', contents.other, 'other-v1');
      const afterInitialProcessing = await currency(catalogue, publication.id);
      expect(afterInitialProcessing.summary.currencyBasisHash).toBe(
        before.summary.currencyBasisHash,
      );

      const rescanned = await fixture.scan(
        {
          service: contents.service,
          web: contents.web,
          other: contents.otherV2,
        },
        'other-changed',
      );
      await fixture.process(rescanned, 'other', contents.otherV2, 'other-v2');
      const afterUnrelatedChange = await currency(catalogue, publication.id);
      expect(afterUnrelatedChange.summary.currencyBasisHash).toBe(
        before.summary.currencyBasisHash,
      );
      expect(afterUnrelatedChange.records).toEqual(before.records);
    } finally {
      await catalogue.close();
    }
  });

  it('classifies a freshly published publication as entirely CURRENT', async () => {
    const { catalogue, publication } = await createFixture();
    try {
      const result = await currency(catalogue, publication.id);
      expect(result.summary).toMatchObject({
        publicationId: publication.id,
        knowledgeModelId: publication.knowledgeModelId,
        currentEntities: 5,
        staleEntities: 0,
        unknownEntities: 0,
        currentRelationships: 3,
        staleRelationships: 0,
        unknownRelationships: 0,
      });
      expect(result.summary.currencyBasisHash).toMatch(/^[a-f0-9]{64}$/);
      const keys = result.records.map(
        ({ objectType, id }) => `${objectType}:${id}`,
      );
      expect(keys).toEqual(
        [...keys].sort((left, right) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      );
      for (const record of result.records) {
        expect(record.supportingDocuments.length).toBeGreaterThan(0);
        for (const document of record.supportingDocuments) {
          expect(document).toMatchObject({
            state: 'CURRENT',
            reason: null,
            catalogueRevision: 1,
          });
          expect(document.currentDocumentVersionId).toBe(
            document.publishedDocumentVersionId,
          );
          expect(document.currentContentHash).toBe(
            document.publishedContentHash,
          );
        }
      }
      expect(
        await catalogue.getPublicationCurrencyInputs(
          '01K00000000000000000000000',
        ),
      ).toBeUndefined();
    } finally {
      await catalogue.close();
    }
  });

  it('follows the catalogue pointer through pending, changed and removed documents', async () => {
    const fixture = await createFixture();
    const { catalogue, publication } = fixture;
    try {
      const initial = await currency(catalogue, publication.id);

      // Rescan without processing: the pointer is cleared (pending).
      const rescanned = await fixture.scan(
        { service: contents.serviceV2, web: contents.web },
        'modified',
      );
      const pending = await currency(catalogue, publication.id);
      expect(pending.summary.currencyBasisHash).not.toBe(
        initial.summary.currencyBasisHash,
      );
      const pendingByName = await byName(catalogue, publication.id, pending);
      for (const name of serviceNames) {
        expect(pendingByName[name]?.state, name).toBe('UNKNOWN');
        expect(pendingByName[name]?.supportingDocuments[0]).toMatchObject({
          currentDocumentVersionId: null,
          currentContentHash: null,
          catalogueRevision: 2,
          reason: 'CURRENT_VERSION_UNAVAILABLE',
        });
      }
      for (const name of webNames) {
        expect(pendingByName[name]?.state, name).toBe('CURRENT');
      }

      // Processing the new content advances the pointer: STALE.
      await fixture.publish(
        rescanned,
        'service',
        contents.serviceV2,
        dependencies.serviceV2,
        'service-v2',
      );
      const changed = await currency(catalogue, publication.id);
      const changedByName = await byName(catalogue, publication.id, changed);
      for (const name of serviceNames) {
        const record = changedByName[name];
        expect(record?.state, name).toBe('STALE');
        expect(record?.supportingDocuments[0]?.reason).toBe('CONTENT_CHANGED');
        expect(record?.supportingDocuments[0]?.catalogueRevision).toBe(3);
        expect(record?.supportingDocuments[0]?.currentContentHash).toBe(
          fingerprint(contents.serviceV2),
        );
        expect(record?.supportingDocuments[0]?.publishedContentHash).toBe(
          fingerprint(contents.service),
        );
      }
      expect(changed.summary).toMatchObject({
        currentEntities: 2,
        staleEntities: 3,
        unknownEntities: 0,
        currentRelationships: 1,
        staleRelationships: 2,
        unknownRelationships: 0,
      });
      // The newest publication is based on the current versions.
      const latest = await latestPublication(catalogue);
      expect(latest.id).not.toBe(publication.id);
      const latestCurrency = await currency(catalogue, latest.id);
      expect(
        latestCurrency.records.every(({ state }) => state === 'CURRENT'),
      ).toBe(true);

      // Removing the web document clears its pointer: DOCUMENT_REMOVED.
      await fixture.scan({ service: contents.serviceV2 }, 'removed');
      const removed = await currency(catalogue, publication.id);
      const removedByName = await byName(catalogue, publication.id, removed);
      for (const name of webNames) {
        expect(removedByName[name]?.state, name).toBe('UNKNOWN');
        expect(removedByName[name]?.supportingDocuments[0]).toMatchObject({
          currentDocumentVersionId: null,
          catalogueRevision: 2,
          reason: 'DOCUMENT_REMOVED',
        });
      }
      for (const name of serviceNames) {
        expect(removedByName[name]?.state, name).toBe('STALE');
      }
      expect(removed.summary.currencyBasisHash).not.toBe(
        changed.summary.currencyBasisHash,
      );
    } finally {
      await catalogue.close();
    }
  });

  it('reports PROCESSING_CHANGED when identical content is reprocessed', async () => {
    const fixture = await createFixture();
    const { catalogue, publication } = fixture;
    try {
      const documents = (await catalogue.listDocuments({ limit: 10 })).items;
      await fixture.process(
        documents,
        'service',
        contents.service,
        'service-reprocessed',
        2,
      );
      const result = await currency(catalogue, publication.id);
      const records = await byName(catalogue, publication.id, result);
      for (const name of serviceNames) {
        const document = records[name]?.supportingDocuments[0];
        expect(records[name]?.state, name).toBe('STALE');
        expect(document?.reason).toBe('PROCESSING_CHANGED');
        expect(document?.currentDocumentVersionId).not.toBe(
          document?.publishedDocumentVersionId,
        );
        expect(document?.currentContentHash).toBe(
          document?.publishedContentHash,
        );
        expect(document?.catalogueRevision).toBe(2);
      }
      for (const name of webNames) {
        expect(records[name]?.state, name).toBe('CURRENT');
      }
    } finally {
      await catalogue.close();
    }
  });

  it('reports CURRENT_VERSION_UNRESOLVABLE for a pointer to another document', async () => {
    const fixture = await createFixture();
    const { catalogue, publication } = fixture;
    const serviceId = await fixture.documentId('service');
    const webId = await fixture.documentId('web');
    await catalogue.close();
    await withRawConnection(fixture.databasePath, async (connection) => {
      const webVersion = (
        await connection.runAndReadAll(
          'SELECT document_version_id FROM document_current_versions WHERE document_id = $1',
          [webId],
        )
      ).getRowObjectsJson()[0]?.document_version_id as string;
      await connection.run(
        'UPDATE document_current_versions SET document_version_id = NULL, revision = revision + 1 WHERE document_id = $1',
        [webId],
      );
      await connection.run(
        'UPDATE document_current_versions SET document_version_id = $2, revision = revision + 1 WHERE document_id = $1',
        [serviceId, webVersion],
      );
    });
    const reopened = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    try {
      const result = await currency(reopened, publication.id);
      const records = await byName(reopened, publication.id, result);
      for (const name of serviceNames) {
        expect(records[name]?.state, name).toBe('UNKNOWN');
        expect(records[name]?.supportingDocuments[0]).toMatchObject({
          reason: 'CURRENT_VERSION_UNRESOLVABLE',
          currentContentHash: null,
        });
      }
      for (const name of webNames) {
        expect(records[name]?.supportingDocuments[0]?.reason, name).toBe(
          'CURRENT_VERSION_UNAVAILABLE',
        );
      }
    } finally {
      await reopened.close();
    }
  });

  it('classifies malformed current targets as unresolvable and rejects malformed published versions', async () => {
    const currentTargetFixture = await createFixture();
    const serviceDocumentId = await currentTargetFixture.documentId('service');
    const currentTargetVersionId = createDocumentVersionId();
    await currentTargetFixture.catalogue.close();
    await withRawConnection(
      currentTargetFixture.databasePath,
      async (connection) => {
        const currentVersionId = (
          await connection.runAndReadAll(
            'SELECT document_version_id FROM document_current_versions WHERE document_id = $1',
            [serviceDocumentId],
          )
        ).getRowObjectsJson()[0]?.document_version_id as string;
        await connection.run(
          `INSERT INTO document_versions (
            id, document_id, source_id, path, filename, content_fingerprint,
            content_hash, hash_algorithm, processed_at, processor_id,
            processor_version, extraction_rule_id, extraction_rule_version,
            evidence_count
          )
          SELECT $1, document_id, source_id, path, filename,
            content_fingerprint, 'not-a-sha256', hash_algorithm, processed_at,
            processor_id, processor_version + 1, extraction_rule_id,
            extraction_rule_version, evidence_count
          FROM document_versions WHERE id = $2`,
          [currentTargetVersionId, currentVersionId],
        );
        await connection.run(
          'UPDATE document_current_versions SET document_version_id = $1, revision = revision + 1 WHERE document_id = $2',
          [currentTargetVersionId, serviceDocumentId],
        );
      },
    );
    const currentTargetCatalogue = await createDuckDbCatalogue(
      currentTargetFixture.databasePath,
      migrationsDirectory,
    );
    try {
      const result = await currency(
        currentTargetCatalogue,
        currentTargetFixture.publication.id,
      );
      const records = await byName(
        currentTargetCatalogue,
        currentTargetFixture.publication.id,
        result,
      );
      for (const name of serviceNames) {
        expect(records[name]?.state, name).toBe('UNKNOWN');
        expect(records[name]?.supportingDocuments[0]).toMatchObject({
          documentId: serviceDocumentId,
          currentDocumentVersionId: currentTargetVersionId,
          currentContentHash: null,
          reason: 'CURRENT_VERSION_UNRESOLVABLE',
          state: 'UNKNOWN',
        });
      }
    } finally {
      await currentTargetCatalogue.close();
    }

    const publishedVersionFixture = await createFixture();
    const publishedServiceDocumentId =
      await publishedVersionFixture.documentId('service');
    const snapshot =
      await publishedVersionFixture.catalogue.getPublicationSnapshot(
        publishedVersionFixture.publication.id,
      );
    const publishedVersionId = snapshot?.entities
      .flatMap(({ entity }) => entity.provenance)
      .find(
        ({ documentId }) => documentId === publishedServiceDocumentId,
      )?.documentVersionId;
    if (publishedVersionId === undefined) {
      throw new Error('Expected published service document version lineage');
    }
    await publishedVersionFixture.catalogue.close();
    await withRawConnection(
      publishedVersionFixture.databasePath,
      async (connection) => {
        await connection.run(
          'CREATE TEMP TABLE currency_evidence_backup AS SELECT * FROM extracted_evidence WHERE document_version_id = $1',
          [publishedVersionId],
        );
        await connection.run(
          'CREATE TEMP TABLE currency_processing_runs_backup AS SELECT * FROM document_processing_runs WHERE document_version_id = $1',
          [publishedVersionId],
        );
        await connection.run(
          'UPDATE document_current_versions SET document_version_id = NULL WHERE document_id = $1',
          [publishedServiceDocumentId],
        );
        await connection.run(
          'DELETE FROM extracted_evidence WHERE document_version_id = $1',
          [publishedVersionId],
        );
        await connection.run(
          'DELETE FROM document_processing_runs WHERE document_version_id = $1',
          [publishedVersionId],
        );
        await connection.run(
          'DELETE FROM knowledge_active_document_contributions WHERE document_version_id = $1',
          [publishedVersionId],
        );
        await connection.run(
          'DELETE FROM knowledge_document_contributions WHERE document_version_id = $1',
          [publishedVersionId],
        );
        await connection.run(
          'UPDATE document_versions SET content_hash = $1 WHERE id = $2',
          ['not-a-sha256', publishedVersionId],
        );
        await connection.run(
          'INSERT INTO extracted_evidence SELECT * FROM currency_evidence_backup',
        );
        await connection.run(
          'INSERT INTO document_processing_runs SELECT * FROM currency_processing_runs_backup',
        );
        await connection.run(
          'UPDATE document_current_versions SET document_version_id = $1, revision = revision + 1 WHERE document_id = $2',
          [publishedVersionId, publishedServiceDocumentId],
        );
      },
    );
    const publishedVersionCatalogue = await createDuckDbCatalogue(
      publishedVersionFixture.databasePath,
      migrationsDirectory,
    );
    try {
      await expect(
        publishedVersionCatalogue.getPublicationCurrencyInputs(
          publishedVersionFixture.publication.id,
        ),
      ).rejects.toBeInstanceOf(CatalogueIntegrityError);
    } finally {
      await publishedVersionCatalogue.close();
    }
  });

  it('is read-only, repeatable and leaves Slice 5 and Slice 6 results unchanged', async () => {
    const fixture = await createFixture();
    let catalogue: Catalogue = fixture.catalogue;
    const rescanned = await fixture.scan(
      { service: contents.serviceV2, web: contents.web },
      'modified',
    );
    await fixture.publish(
      rescanned,
      'service',
      contents.serviceV2,
      dependencies.serviceV2,
      'service-v2',
    );
    const latest = await latestPublication(catalogue);
    await projectAllPublished(catalogue);
    const diffs = createPublicationDiffService({
      snapshots: catalogue,
      store: catalogue,
    });
    const diff = await diffs.compare(fixture.publication.id, latest.id);
    if (diff.status !== 'found') {
      throw new Error('Expected publication diff');
    }
    const slice5And6 = async (target: CatalogueDiscovery) =>
      Promise.all([
        target.getKnowledgePublicationSummary(fixture.publication.id),
        target.getPublicationSnapshot(fixture.publication.id),
        target.listKnowledgeEntities({
          publicationId: fixture.publication.id,
          limit: 50,
        }),
        target.searchProjectedEntities({
          publicationId: fixture.publication.id,
          limit: 50,
        }),
        target.getPublicationDiff(diff.diff.id),
        target.listPublicationComparisons({
          publicationId: fixture.publication.id,
          limit: 10,
        }),
      ]);
    const exploreBefore = await slice5And6(catalogue);
    const publicationExportsBefore = await Promise.all(
      [fixture.publication.id, latest.id].map((publicationId) =>
        catalogue.getKnowledgePublicationExport(publicationId),
      ),
    );
    const publicationExportBytesBefore = publicationExportsBefore.map(
      (publicationPackage) => {
        if (publicationPackage === undefined) {
          throw new Error('Expected publication export');
        }
        return serializeKnowledgePublicationPackage(publicationPackage);
      },
    );
    await catalogue.close();
    const tables = [
      ...authoritativeTables,
      ...catalogueTables,
      ...projectionTables,
      ...diffTables,
      'discovery_outbox',
    ];
    const before = await withRawConnection(fixture.databasePath, (connection) =>
      tableDump(connection, tables),
    );

    catalogue = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    let firstRun: PublicationCurrency[];
    try {
      firstRun = [
        await currency(catalogue, fixture.publication.id),
        await currency(catalogue, latest.id),
      ];
      const secondRun = [
        await currency(catalogue, fixture.publication.id),
        await currency(catalogue, latest.id),
      ];
      expect(secondRun).toEqual(firstRun);
      expect(JSON.stringify(secondRun)).toBe(JSON.stringify(firstRun));
      expect(firstRun[0]?.summary.staleEntities).toBe(3);
      expect(firstRun[1]?.summary.staleEntities).toBe(0);
      expect(await slice5And6(catalogue)).toEqual(exploreBefore);
      const reopenedExports = await Promise.all(
        [fixture.publication.id, latest.id].map((publicationId) =>
          catalogue.getKnowledgePublicationExport(publicationId),
        ),
      );
      expect(
        reopenedExports.map((publicationPackage) => {
          if (publicationPackage === undefined) {
            throw new Error('Expected publication export');
          }
          return serializeKnowledgePublicationPackage(publicationPackage);
        }),
      ).toEqual(publicationExportBytesBefore);
    } finally {
      await catalogue.close();
    }

    const after = await withRawConnection(fixture.databasePath, (connection) =>
      tableDump(connection, tables),
    );
    for (const table of tables) {
      expect(after[table], table).toEqual(before[table]);
    }

    // A reopened catalogue with the same basis yields identical results.
    catalogue = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    try {
      expect(await currency(catalogue, fixture.publication.id)).toEqual(
        firstRun[0],
      );
    } finally {
      await catalogue.close();
    }
  });

  it('raises integrity errors instead of UNKNOWN for broken historical lineage', async () => {
    const fixture = await createFixture();
    const { publication } = fixture;
    await fixture.catalogue.close();
    await withRawConnection(fixture.databasePath, (connection) =>
      connection.run(
        'UPDATE extracted_evidence SET locator_json = \'{"kind":"json-pointer","pointer":"/tampered"}\' WHERE id = (SELECT min(id) FROM extracted_evidence)',
      ),
    );
    const reopened = await createDuckDbCatalogue(
      fixture.databasePath,
      migrationsDirectory,
    );
    try {
      await expect(
        reopened.getPublicationCurrencyInputs(publication.id),
      ).rejects.toBeInstanceOf(CatalogueIntegrityError);
    } finally {
      await reopened.close();
    }
  });
});
