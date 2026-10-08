import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { DuckDBInstance } from '@duckdb/node-api';
import type {
  DiscoveryEvent,
  KnowledgeCandidateEvent,
  KnowledgeInputEvidence,
} from '@workspace-brain/domain';
import {
  createKnowledgeEntityKey,
  createKnowledgeModelId,
  processingDefinitionRegistry,
} from '@workspace-brain/domain';
import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import { afterEach, describe, expect, it } from 'vitest';

import { createDuckDbCatalogue } from './index.js';
import { createKnowledgePublicationContentHash } from './knowledge.js';

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
  it('preserves relationship history while removing the DuckDB update blocker', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      await connection.run(
        'CREATE TABLE knowledge_relationships (id VARCHAR PRIMARY KEY, lifecycle_status VARCHAR NOT NULL)',
      );
      await connection.run(
        'CREATE TABLE relationship_versions (id VARCHAR PRIMARY KEY, relationship_id VARCHAR NOT NULL REFERENCES knowledge_relationships(id), version_number BIGINT NOT NULL, snapshot_json JSON NOT NULL, created_at TIMESTAMP NOT NULL, UNIQUE (relationship_id, version_number))',
      );
      await connection.run(
        "INSERT INTO knowledge_relationships VALUES ('relationship-1', 'related')",
      );
      await connection.run(
        "INSERT INTO relationship_versions VALUES ('version-1', 'relationship-1', 1, '{\"version\":1}', '2026-10-05T08:00:00Z')",
      );
      await connection.run(
        await readFile(
          resolve(
            process.cwd(),
            'infrastructure/duckdb/migrations/010-relationship-version-storage.sql',
          ),
          'utf8',
        ),
      );

      const historicalVersions = await connection.runAndReadAll(
        'SELECT id, relationship_id, version_number FROM relationship_versions',
      );
      expect(historicalVersions.getRowObjectsJson()).toEqual([
        {
          id: 'version-1',
          relationship_id: 'relationship-1',
          version_number: '1',
        },
      ]);
      await connection.run(
        "UPDATE knowledge_relationships SET lifecycle_status = 'superseded' WHERE id = 'relationship-1'",
      );
      await connection.run(
        "INSERT INTO relationship_versions VALUES ('version-2', 'relationship-1', 2, '{\"version\":2}', '2026-10-05T08:00:01Z')",
      );
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  it('backfills only uniquely accepted definitions and repairs unsafe legacy pointers', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      await connection.run(
        'CREATE TABLE documents (id VARCHAR PRIMARY KEY, source_id VARCHAR NOT NULL, path VARCHAR NOT NULL, filename VARCHAR NOT NULL)',
      );
      await connection.run(
        'CREATE TABLE document_versions (id VARCHAR PRIMARY KEY, document_id VARCHAR NOT NULL, source_id VARCHAR NOT NULL, path VARCHAR NOT NULL, content_fingerprint VARCHAR NOT NULL, processor_id VARCHAR NOT NULL, processor_version INTEGER NOT NULL, extraction_rule_id VARCHAR NOT NULL, extraction_rule_version INTEGER NOT NULL)',
      );
      await connection.run(
        'CREATE TABLE inventory_records (source_id VARCHAR NOT NULL, path VARCHAR NOT NULL, asset_type VARCHAR NOT NULL, fingerprint VARCHAR NOT NULL, is_present BOOLEAN NOT NULL)',
      );
      await connection.run(
        'CREATE TABLE document_processing_runs (document_version_id VARCHAR NOT NULL, status VARCHAR NOT NULL)',
      );
      await connection.run(
        "INSERT INTO documents VALUES ('accepted', 'source-1', 'root/accepted/package.json', 'package.json'), ('non-preferred', 'source-1', 'root/non-preferred/package.json', 'package.json'), ('incomparable', 'source-1', 'root/incomparable/package.json', 'package.json'), ('ambiguous', 'source-1', 'root/ambiguous/package.json', 'package.json'), ('old-fingerprint', 'source-1', 'root/old/package.json', 'package.json'), ('removed', 'source-1', 'root/removed/package.json', 'package.json'), ('failed', 'source-1', 'root/failed/package.json', 'package.json')",
      );
      await connection.run(
        "INSERT INTO document_versions VALUES ('accepted-v1', 'accepted', 'source-1', 'root/accepted/package.json', 'a', 'json', 1, 'json-scalar-values', 1), ('non-preferred-v1', 'non-preferred', 'source-1', 'root/non-preferred/package.json', 'b', 'markdown', 1, 'markdown-blocks', 1), ('incomparable-v1', 'incomparable', 'source-1', 'root/incomparable/package.json', 'c', 'yaml', 1, 'yaml-scalar-values', 1), ('ambiguous-v1', 'ambiguous', 'source-1', 'root/ambiguous/package.json', 'd', 'json', 1, 'json-scalar-values', 1), ('ambiguous-v2', 'ambiguous', 'source-1', 'root/ambiguous/package.json', 'd', 'json', 2, 'json-scalar-values', 1), ('old-v1', 'old-fingerprint', 'source-1', 'root/old/package.json', 'old', 'json', 1, 'json-scalar-values', 1), ('removed-v1', 'removed', 'source-1', 'root/removed/package.json', 'f', 'json', 1, 'json-scalar-values', 1), ('failed-v1', 'failed', 'source-1', 'root/failed/package.json', 'g', 'json', 1, 'json-scalar-values', 1)",
      );
      await connection.run(
        "INSERT INTO inventory_records VALUES ('source-1', 'root/accepted/package.json', 'document', 'a', TRUE), ('source-1', 'root/non-preferred/package.json', 'document', 'b', TRUE), ('source-1', 'root/incomparable/package.json', 'document', 'c', TRUE), ('source-1', 'root/ambiguous/package.json', 'document', 'd', TRUE), ('source-1', 'root/old/package.json', 'document', 'current', TRUE), ('source-1', 'root/removed/package.json', 'document', 'f', FALSE), ('source-1', 'root/failed/package.json', 'document', 'g', TRUE)",
      );
      await connection.run(
        "INSERT INTO document_processing_runs VALUES ('accepted-v1', 'completed'), ('non-preferred-v1', 'completed'), ('incomparable-v1', 'completed'), ('ambiguous-v1', 'completed'), ('ambiguous-v2', 'completed'), ('old-v1', 'completed'), ('removed-v1', 'completed'), ('failed-v1', 'failed')",
      );
      await connection.run(
        await readFile(
          resolve(
            process.cwd(),
            'infrastructure/duckdb/migrations/011-current-document-version.sql',
          ),
          'utf8',
        ),
      );

      const registeredDefinitions = await connection.runAndReadAll(
        'SELECT filename_match_kind, filename_match, processor_id, extraction_rule_id FROM accepted_processing_definitions ORDER BY filename_match_kind, filename_match',
      );
      const expectedDefinitions = [...processingDefinitionRegistry]
        .map((definition) => ({
          filename_match_kind: definition.filenameMatchKind,
          filename_match: definition.filenameMatch,
          processor_id: definition.processorId,
          extraction_rule_id: definition.extractionRuleId,
        }))
        .sort(
          (left, right) =>
            left.filename_match_kind.localeCompare(right.filename_match_kind) ||
            left.filename_match.localeCompare(right.filename_match),
        );
      expect(registeredDefinitions.getRowObjectsJson()).toEqual(
        expectedDefinitions,
      );
      const currentVersions = await connection.runAndReadAll(
        'SELECT document_id, document_version_id, revision FROM document_current_versions ORDER BY document_id',
      );
      expect(currentVersions.getRowObjectsJson()).toEqual([
        {
          document_id: 'accepted',
          document_version_id: 'accepted-v1',
          revision: '1',
        },
      ]);

      await connection.run(
        "INSERT INTO document_current_versions VALUES ('non-preferred', 'non-preferred-v1', 1, '2026-10-05T09:00:00Z')",
      );
      const migration012 = await readFile(
        resolve(
          process.cwd(),
          'infrastructure/duckdb/migrations/012-processing-authority-reconciliation.sql',
        ),
        'utf8',
      );
      await connection.run(migration012);
      const afterRepair = await connection.runAndReadAll(
        'SELECT document_id, document_version_id, revision FROM document_current_versions ORDER BY document_id',
      );
      expect(afterRepair.getRowObjectsJson()).toEqual([
        {
          document_id: 'accepted',
          document_version_id: 'accepted-v1',
          revision: '1',
        },
        {
          document_id: 'non-preferred',
          document_version_id: null,
          revision: '2',
        },
      ]);
      await connection.run(migration012);
      const afterRepeat = await connection.runAndReadAll(
        'SELECT document_id, document_version_id, revision FROM document_current_versions ORDER BY document_id',
      );
      expect(afterRepeat.getRowObjectsJson()).toEqual(
        afterRepair.getRowObjectsJson(),
      );

      await connection.run('DELETE FROM accepted_processing_definitions');
      await connection.run('DELETE FROM document_current_versions');
      await connection.run(migration012);
      const upgradeDefinitions = await connection.runAndReadAll(
        'SELECT filename_match_kind, filename_match, processor_id, extraction_rule_id FROM accepted_processing_definitions ORDER BY filename_match_kind, filename_match',
      );
      expect(upgradeDefinitions.getRowObjectsJson()).toEqual(
        expectedDefinitions,
      );
      const upgradeBackfill = await connection.runAndReadAll(
        'SELECT document_id, document_version_id FROM document_current_versions ORDER BY document_id',
      );
      expect(upgradeBackfill.getRowObjectsJson()).toEqual([
        { document_id: 'accepted', document_version_id: 'accepted-v1' },
      ]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  it('selects current processing authority deterministically across completion order', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'workspace-brain-processing-authority-'),
    );
    temporaryDirectories.push(directory);
    const cataloguePath = join(directory, 'catalogue.duckdb');
    const catalogue = await createDuckDbCatalogue(
      cataloguePath,
      migrationsDirectory,
    );
    await catalogue.registerConfiguration(
      [
        {
          configId: 'authority-source',
          name: 'Authority Source',
          rootPaths: [join(directory, 'source')],
          excludeDirs: [],
          includeExtensions: ['.json'],
          maxFileSizeBytes: 4096,
        },
      ],
      [
        {
          configId: 'authority-workspace',
          name: 'Authority Workspace',
          sourceConfigIds: ['authority-source'],
          include: ['**'],
          exclude: [],
        },
      ],
    );
    const source = (await catalogue.listSources({ limit: 10 })).items[0];
    const root = source?.roots?.[0];
    if (source === undefined || root === undefined) {
      throw new Error('Authority source registration failed');
    }
    const sourceText = '{"name":"@workspace/order","dependencies":{"v1":"^1"}}';
    const fingerprint = createHash('sha256').update(sourceText).digest('hex');
    const discoveredAt = '2026-10-05T09:00:00.000Z';
    const scan = await catalogue.persistScan(
      source.id,
      [],
      ['root-first', 'root-second'].map((suffix) => ({
        path: `${root.id}/${suffix}/package.json`,
        filename: 'package.json',
        extension: '.json',
        sizeBytes: Buffer.byteLength(sourceText),
        modifiedAt: discoveredAt,
        fingerprint,
        discoveryMethod: 'filesystem' as const,
      })),
      discoveredAt,
      'authority-scan',
      10,
    );
    const firstDocument = scan.documents.find(({ path }) =>
      path.includes('root-first'),
    );
    const secondDocument = scan.documents.find(({ path }) =>
      path.includes('root-second'),
    );
    if (firstDocument === undefined || secondDocument === undefined) {
      throw new Error('Authority documents were not persisted');
    }

    async function processVersion(
      document: typeof firstDocument,
      processorVersion: number,
      dependencyName: string,
      eventId: string,
      processorId = 'json',
      contentFingerprint = fingerprint,
    ) {
      const isJson = processorId === 'json';
      const candidate = {
        documentId: document.id,
        sourceId: source.id,
        path: document.path,
        contentFingerprint,
        processedAt: `2026-10-05T09:00:${String(processorVersion).padStart(2, '0')}.000Z`,
        durationMilliseconds: 1,
        processorId,
        processorVersion,
        extractionRuleId: isJson ? 'json-scalar-values' : 'yaml-scalar-values',
        extractionRuleVersion: processorVersion,
        evidence: [
          {
            key: isJson ? 'json:/name' : 'yaml:/name',
            kind: 'structured-value' as const,
            excerpt: '@workspace/order',
            truncated: false,
            locator: isJson
              ? ({ kind: 'json-pointer', pointer: '/name' } as const)
              : ({ kind: 'yaml-lines', lineStart: 1, lineEnd: 1 } as const),
          },
          {
            key: isJson
              ? `json:/dependencies/${dependencyName}`
              : `yaml:/dependencies/${dependencyName}`,
            kind: 'structured-value' as const,
            excerpt: dependencyName === 'new' ? '^2' : '^1',
            truncated: false,
            locator: isJson
              ? ({
                  kind: 'json-pointer',
                  pointer: `/dependencies/${dependencyName}`,
                } as const)
              : ({ kind: 'yaml-lines', lineStart: 2, lineEnd: 2 } as const),
          },
        ],
      };
      return catalogue.applyDocumentProcessing(
        createProcessingEvent(candidate, eventId),
      );
    }

    function makeKnowledgeEvent(
      document: typeof firstDocument,
      versionId: string,
      inputs: readonly KnowledgeInputEvidence[],
      suffix: string,
      dependencyName: string,
    ): KnowledgeCandidateEvent {
      const ownerInput = inputs.find(({ evidence }) =>
        evidence.key.endsWith('/name'),
      );
      const dependencyInput = inputs.find(({ evidence }) =>
        evidence.key.endsWith(`/${dependencyName}`),
      );
      if (ownerInput === undefined || dependencyInput === undefined) {
        throw new Error(`Evidence for ${suffix} was not persisted`);
      }
      const provenanceFor = (input: KnowledgeInputEvidence) => ({
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
        '@workspace/order',
      );
      const dependencyKey = createKnowledgeEntityKey(
        'package',
        source.id,
        document.path,
        dependencyName,
      );
      return {
        eventId: `authority-knowledge-${suffix}`,
        eventType: 'KnowledgeCandidatesSubmitted',
        eventVersion: 1,
        occurredAt: '2026-10-05T09:01:00.000Z',
        producer: 'workspace-brain-knowledge-worker',
        correlationId: `authority-correlation-${suffix}`,
        idempotencyKey: `authority-idempotency-${suffix}`,
        partitionKey: source.id,
        payload: {
          sourceId: source.id,
          documentId: document.id,
          documentVersionId: versionId,
          entities: [
            {
              key: ownerKey,
              type: 'package',
              identityScope: document.path,
              name: '@workspace/order',
              sourceEvidenceIds: [ownerInput.evidence.id],
              provenance: [provenanceFor(ownerInput)],
              lifecycleStatus: 'observed',
            },
            {
              key: dependencyKey,
              type: 'package',
              identityScope: document.path,
              name: dependencyName,
              sourceEvidenceIds: [dependencyInput.evidence.id],
              provenance: [provenanceFor(dependencyInput)],
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
              provenance: [provenanceFor(dependencyInput)],
              confidence: 1,
              lifecycleStatus: 'related',
            },
          ],
        },
      } as KnowledgeCandidateEvent;
    }

    const firstV2 = await processVersion(
      firstDocument,
      2,
      'fresh',
      'authority-first-v2',
    );
    const firstV1 = await processVersion(
      firstDocument,
      1,
      'legacy',
      'authority-first-delayed-v1',
    );
    expect(firstV1.documentVersion.id).not.toBe(firstV2.documentVersion.id);
    const firstV2Inputs = await catalogue.listKnowledgeInputEvidence(
      firstV2.documentVersion.id,
    );
    const firstV1Inputs = await catalogue.listKnowledgeInputEvidence(
      firstV1.documentVersion.id,
    );
    await catalogue.applyKnowledgeCandidates(
      makeKnowledgeEvent(
        firstDocument,
        firstV2.documentVersion.id,
        firstV2Inputs,
        'first-v2',
        'fresh',
      ),
    );
    const firstPublicationCount = (
      await catalogue.listKnowledgePublications({ limit: 20 })
    ).items.length;
    await catalogue.applyKnowledgeCandidates(
      makeKnowledgeEvent(
        firstDocument,
        firstV1.documentVersion.id,
        firstV1Inputs,
        'first-delayed-v1',
        'legacy',
      ),
    );
    expect(
      (await catalogue.listKnowledgePublications({ limit: 20 })).items,
    ).toHaveLength(firstPublicationCount);

    const secondV1 = await processVersion(
      secondDocument,
      1,
      'legacy',
      'authority-second-v1',
    );
    const secondV1Inputs = await catalogue.listKnowledgeInputEvidence(
      secondV1.documentVersion.id,
    );
    await catalogue.applyKnowledgeCandidates(
      makeKnowledgeEvent(
        secondDocument,
        secondV1.documentVersion.id,
        secondV1Inputs,
        'second-v1',
        'legacy',
      ),
    );
    const secondV2 = await processVersion(
      secondDocument,
      2,
      'fresh',
      'authority-second-v2',
    );
    const secondV2Inputs = await catalogue.listKnowledgeInputEvidence(
      secondV2.documentVersion.id,
    );
    await catalogue.applyKnowledgeCandidates(
      makeKnowledgeEvent(
        secondDocument,
        secondV2.documentVersion.id,
        secondV2Inputs,
        'second-v2',
        'fresh',
      ),
    );
    const beforeReplayPublications = (
      await catalogue.listKnowledgePublications({ limit: 20 })
    ).items;
    const secondV2Replay = await processVersion(
      secondDocument,
      2,
      'fresh',
      'authority-second-v2-different-event',
    );
    expect(secondV2Replay.documentVersion.id).toBe(secondV2.documentVersion.id);
    expect(secondV2Replay.duplicate).toBe(true);
    await catalogue.applyKnowledgeCandidates(
      makeKnowledgeEvent(
        secondDocument,
        secondV2.documentVersion.id,
        secondV2Inputs,
        'second-v2-replay',
        'fresh',
      ),
    );
    const delayedSecondV1 = await processVersion(
      secondDocument,
      1,
      'legacy',
      'authority-second-v1-delayed-duplicate',
    );
    expect(delayedSecondV1.documentVersion.id).toBe(
      secondV1.documentVersion.id,
    );
    await catalogue.applyKnowledgeCandidates(
      makeKnowledgeEvent(
        secondDocument,
        secondV1.documentVersion.id,
        secondV1Inputs,
        'second-v1-delayed-duplicate',
        'legacy',
      ),
    );
    expect(
      (await catalogue.listKnowledgePublications({ limit: 20 })).items,
    ).toEqual(beforeReplayPublications);

    const incomparableRun = await processVersion(
      firstDocument,
      3,
      'incomparable',
      'authority-incomparable-yaml',
      'yaml',
    );
    const incomparableInputs = await catalogue.listKnowledgeInputEvidence(
      incomparableRun.documentVersion.id,
    );
    const beforeIncomparable = (
      await catalogue.listKnowledgePublications({ limit: 20 })
    ).items;
    await catalogue.applyKnowledgeCandidates(
      makeKnowledgeEvent(
        firstDocument,
        incomparableRun.documentVersion.id,
        incomparableInputs,
        'incomparable',
        'incomparable',
      ),
    );
    expect(
      (await catalogue.listKnowledgePublications({ limit: 20 })).items,
    ).toEqual(beforeIncomparable);

    const model = (await catalogue.listKnowledgeModels({ limit: 10 })).items[0];
    if (model === undefined) {
      throw new Error('Authority Knowledge Model was not initialized');
    }
    for (const document of [firstDocument, secondDocument]) {
      const entities = (
        await catalogue.listKnowledgeEntities({
          knowledgeModelId: model.id,
          type: 'package',
          limit: 100,
        })
      ).items.filter(({ provenance }) =>
        provenance.some(({ documentId }) => documentId === document.id),
      );
      expect(
        entities.map(({ name, lifecycleStatus }) => [name, lifecycleStatus]),
      ).toContainEqual(['fresh', 'observed']);
      expect(
        entities
          .filter(
            ({ lifecycleStatus }) =>
              lifecycleStatus !== 'superseded' &&
              lifecycleStatus !== 'rejected',
          )
          .map(({ name }) => name),
      ).not.toContain('legacy');
      const relationships = (
        await catalogue.listKnowledgeRelationships({
          knowledgeModelId: model.id,
          type: 'DEPENDS_ON',
          limit: 100,
        })
      ).items
        .filter(({ provenance }) =>
          provenance.some(({ documentId }) => documentId === document.id),
        )
        .filter(
          ({ lifecycleStatus }) =>
            lifecycleStatus !== 'superseded' && lifecycleStatus !== 'rejected',
        );
      expect(relationships).toHaveLength(1);
      expect(relationships[0]?.sourceEvidenceIds).toContain(
        (document.id === firstDocument.id
          ? firstV2Inputs
          : secondV2Inputs
        ).find(({ evidence }) => evidence.key.endsWith('/fresh'))?.evidence.id,
      );
    }
    expect(
      await catalogue.listKnowledgeInputEvidence(firstV1.documentVersion.id),
    ).toHaveLength(2);

    const changedText =
      '{"name":"@workspace/order","dependencies":{"new":"^2"}}';
    const changedFingerprint = createHash('sha256')
      .update(changedText)
      .digest('hex');
    await catalogue.persistScan(
      source.id,
      [],
      [
        {
          path: firstDocument.path,
          filename: firstDocument.filename,
          extension: firstDocument.extension,
          sizeBytes: Buffer.byteLength(changedText),
          modifiedAt: '2026-10-05T09:02:00.000Z',
          fingerprint: changedFingerprint,
          discoveryMethod: 'filesystem',
        },
        {
          path: secondDocument.path,
          filename: secondDocument.filename,
          extension: secondDocument.extension,
          sizeBytes: Buffer.byteLength(sourceText),
          modifiedAt: discoveredAt,
          fingerprint,
          discoveryMethod: 'filesystem',
        },
      ],
      '2026-10-05T09:02:00.000Z',
      'authority-content-changed',
      10,
    );
    const publicationsBeforeStaleResult = (
      await catalogue.listKnowledgePublications({ limit: 20 })
    ).items;
    const entitiesBeforeStaleResult = (
      await catalogue.listKnowledgeEntities({
        knowledgeModelId: model.id,
        type: 'package',
        limit: 100,
      })
    ).items;
    const staleA = await processVersion(
      firstDocument,
      3,
      'stale',
      'authority-old-content-in-flight',
    );
    expect(staleA.duplicate).toBe(false);
    const staleInputs = await catalogue.listKnowledgeInputEvidence(
      staleA.documentVersion.id,
    );
    expect(staleInputs).toHaveLength(2);
    expect(
      (
        await catalogue.listDocumentEvidence(firstDocument.id, { limit: 100 })
      ).items.map(({ documentVersionId }) => documentVersionId),
    ).toContain(staleA.documentVersion.id);
    expect(await catalogue.listKnowledgePublications({ limit: 20 })).toEqual({
      items: publicationsBeforeStaleResult,
    });
    expect(
      (
        await catalogue.listKnowledgeEntities({
          knowledgeModelId: model.id,
          type: 'package',
          limit: 100,
        })
      ).items,
    ).toEqual(entitiesBeforeStaleResult);
    await expect(
      processVersion(
        firstDocument,
        3,
        'stale',
        'authority-old-content-in-flight',
      ),
    ).resolves.toMatchObject({
      documentVersion: { id: staleA.documentVersion.id },
      duplicate: true,
    });
    await expect(
      processVersion(
        firstDocument,
        3,
        'conflicting-replay',
        'authority-old-content-in-flight',
      ),
    ).rejects.toThrow('reused with a different payload');
    await catalogue.applyKnowledgeCandidates(
      makeKnowledgeEvent(
        firstDocument,
        staleA.documentVersion.id,
        staleInputs,
        'stale-content',
        'stale',
      ),
    );
    expect(
      (await catalogue.listKnowledgePublications({ limit: 20 })).items,
    ).toEqual(publicationsBeforeStaleResult);
    const outboxAfterStale = await catalogue.listPendingDiscoveryEvents(1000);
    expect(
      outboxAfterStale.some(
        (item) =>
          item.eventType === 'DocumentExtracted' &&
          item.payload.documentVersionId === staleA.documentVersion.id,
      ),
    ).toBe(false);

    const currentB = await processVersion(
      firstDocument,
      4,
      'new',
      'authority-current-content-v4',
      'json',
      changedFingerprint,
    );
    const currentBInputs = await catalogue.listKnowledgeInputEvidence(
      currentB.documentVersion.id,
    );
    await catalogue.applyKnowledgeCandidates(
      makeKnowledgeEvent(
        firstDocument,
        currentB.documentVersion.id,
        currentBInputs,
        'first-current-content-v4',
        'new',
      ),
    );
    expect(
      (await catalogue.listKnowledgePublications({ limit: 20 })).items.length,
    ).toBeGreaterThan(publicationsBeforeStaleResult.length);
    const currentEntitiesAfterB = (
      await catalogue.listKnowledgeEntities({
        knowledgeModelId: model.id,
        type: 'package',
        limit: 100,
      })
    ).items.filter(({ provenance }) =>
      provenance.some(({ documentId }) => documentId === firstDocument.id),
    );
    expect(currentEntitiesAfterB.map(({ name }) => name)).toContain('new');
    expect(currentEntitiesAfterB.map(({ name }) => name)).not.toContain(
      'stale',
    );

    const invalidIdentityCandidate = {
      documentId: firstDocument.id,
      sourceId: source.id,
      path: secondDocument.path,
      contentFingerprint: changedFingerprint,
      processedAt: '2026-10-05T09:04:00.000Z',
      durationMilliseconds: 1,
      processorId: 'json' as const,
      processorVersion: 5,
      extractionRuleId: 'json-scalar-values' as const,
      extractionRuleVersion: 1,
      evidence: [],
    };
    await expect(
      catalogue.applyDocumentProcessing(
        createProcessingEvent(
          invalidIdentityCandidate,
          'authority-invalid-document-identity',
        ),
      ),
    ).rejects.toThrow('does not match a known catalogue document');
    await expect(
      catalogue.applyDocumentProcessing(
        createProcessingEvent(
          {
            ...invalidIdentityCandidate,
            path: firstDocument.path,
            extractionRuleId: 'typescript-imports' as const,
          },
          'authority-invalid-provenance',
        ),
      ),
    ).rejects.toThrow('Invalid document processing submission');

    const restoredScan = await catalogue.persistScan(
      source.id,
      [],
      [
        {
          path: firstDocument.path,
          filename: firstDocument.filename,
          extension: firstDocument.extension,
          sizeBytes: Buffer.byteLength(sourceText),
          modifiedAt: '2026-10-05T09:03:00.000Z',
          fingerprint,
          discoveryMethod: 'filesystem',
        },
        {
          path: secondDocument.path,
          filename: secondDocument.filename,
          extension: secondDocument.extension,
          sizeBytes: Buffer.byteLength(sourceText),
          modifiedAt: discoveredAt,
          fingerprint,
          discoveryMethod: 'filesystem',
        },
      ],
      '2026-10-05T09:03:00.000Z',
      'authority-content-restored',
      10,
    );
    expect(restoredScan.documents).toHaveLength(2);
    const publicationsBeforeRestoreResult = (
      await catalogue.listKnowledgePublications({ limit: 20 })
    ).items;
    const firstV2Restored = await processVersion(
      firstDocument,
      2,
      'fresh',
      'authority-first-v2-restored',
    );
    expect(firstV2Restored.documentVersion.id).toBe(firstV2.documentVersion.id);
    expect(
      (await catalogue.listKnowledgePublications({ limit: 20 })).items,
    ).toEqual(publicationsBeforeRestoreResult);
    await catalogue.close();

    const verificationInstance = await DuckDBInstance.create(cataloguePath);
    const verificationConnection = await verificationInstance.connect();
    const staleRun = await verificationConnection.runAndReadAll(
      "SELECT event_id, status, document_version_id FROM document_processing_runs WHERE event_id = 'authority-old-content-in-flight'",
    );
    expect(staleRun.getRowObjectsJson()).toEqual([
      {
        event_id: 'authority-old-content-in-flight',
        status: 'completed',
        document_version_id: staleA.documentVersion.id,
      },
    ]);
    const staleEvidenceCount = await verificationConnection.runAndReadAll(
      'SELECT count(*) AS evidence_count FROM extracted_evidence WHERE document_version_id = $1',
      [staleA.documentVersion.id],
    );
    expect(staleEvidenceCount.getRowObjectsJson()).toEqual([
      { evidence_count: '2' },
    ]);
    const invalidRunCount = await verificationConnection.runAndReadAll(
      "SELECT count(*) AS run_count FROM document_processing_runs WHERE event_id IN ('authority-invalid-document-identity', 'authority-invalid-provenance')",
    );
    expect(invalidRunCount.getRowObjectsJson()).toEqual([{ run_count: '0' }]);
    const currentAuthority = await verificationConnection.runAndReadAll(
      'SELECT document_version_id FROM document_current_versions WHERE document_id = $1',
      [firstDocument.id],
    );
    expect(currentAuthority.getRowObjectsJson()).toEqual([
      { document_version_id: firstV2.documentVersion.id },
    ]);
    const separateExecutionCount = await verificationConnection.runAndReadAll(
      'SELECT count(*) AS run_count FROM document_processing_runs WHERE document_version_id = $1 AND event_id IN ($2, $3)',
      [
        secondV2.documentVersion.id,
        'authority-second-v2',
        'authority-second-v2-different-event',
      ],
    );
    expect(separateExecutionCount.getRowObjectsJson()).toEqual([
      { run_count: '2' },
    ]);
    verificationConnection.closeSync();
    verificationInstance.closeSync();
  });

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
      'accepted_processing_definitions',
      'discovery_history',
      'discovery_outbox',
      'document_current_versions',
      'document_processing_runs',
      'document_versions',
      'documents',
      'entity_versions',
      'extracted_evidence',
      'inventory_records',
      'knowledge_active_document_contributions',
      'knowledge_candidate_runs',
      'knowledge_document_contributions',
      'knowledge_entities',
      'knowledge_models',
      'knowledge_publications',
      'knowledge_relationships',
      'publication_diff_entity_changes',
      'publication_diff_relationship_changes',
      'publication_diffs',
      'relationship_versions',
      'repositories',
      'schema_migrations',
      'search_projected_documents',
      'search_projected_entities',
      'search_projected_relationships',
      'search_projected_terms',
      'search_projection_runs',
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
      [
        {
          configId: 'evidence-workspace',
          name: 'Evidence Workspace',
          sourceConfigIds: ['evidence-source'],
          include: ['**'],
          exclude: [],
        },
      ],
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
    const knowledgeEvidence = first.evidence[0];
    if (knowledgeEvidence === undefined) {
      throw new Error('Knowledge transaction evidence was not persisted');
    }
    const entityName = 'Evidence';
    const entityCandidate = {
      key: createKnowledgeEntityKey(
        'package',
        source.id,
        document.path,
        entityName,
      ),
      type: 'package' as const,
      identityScope: document.path,
      name: entityName,
      sourceEvidenceIds: [knowledgeEvidence.id],
      provenance: [
        {
          evidenceId: knowledgeEvidence.id,
          documentVersionId: first.documentVersion.id,
          documentId: document.id,
          sourceId: source.id,
          documentPath: document.path,
          contentFingerprint: fingerprint,
          locator: knowledgeEvidence.locator,
          processorId: 'markdown',
          processorVersion: 1,
          extractionRuleId: 'markdown-blocks',
          extractionRuleVersion: 1,
          knowledgeExtractorId: 'deterministic-knowledge-extractors',
          knowledgeExtractorVersion: 1 as const,
        },
      ],
      lifecycleStatus: 'observed' as const,
    };
    const knowledgeEvent: KnowledgeCandidateEvent = {
      eventId: 'coordinator-knowledge-event',
      eventType: 'KnowledgeCandidatesSubmitted',
      eventVersion: 1,
      occurredAt: '2026-10-02T10:00:03.000Z',
      producer: 'workspace-brain-knowledge-worker',
      correlationId: 'coordinator-knowledge',
      idempotencyKey: 'coordinator-knowledge',
      partitionKey: source.id,
      payload: {
        sourceId: source.id,
        documentId: document.id,
        documentVersionId: first.documentVersion.id,
        entities: [entityCandidate],
        relationships: [],
      },
    };
    const conflictingReplay: KnowledgeCandidateEvent = {
      ...knowledgeEvent,
      payload: {
        ...knowledgeEvent.payload,
        entities: [
          {
            ...entityCandidate,
            name: 'Conflicting',
            key: createKnowledgeEntityKey(
              'package',
              source.id,
              document.path,
              'Conflicting',
            ),
          },
        ],
      },
    };
    const concurrentWrites = await Promise.allSettled([
      catalogue.applyKnowledgeCandidates(knowledgeEvent),
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
        'coordinator-concurrent-scan',
        10,
      ),
      catalogue.applyKnowledgeCandidates(conflictingReplay),
      catalogue.recordScanStarted(
        source.id,
        'coordinator-later-scan',
        '2026-10-02T10:00:04.000Z',
      ),
      catalogue.applyKnowledgeCandidates({
        ...knowledgeEvent,
        eventId: 'coordinator-knowledge-replay',
        idempotencyKey: 'coordinator-knowledge-replay',
      }),
    ]);
    expect(concurrentWrites.map(({ status }) => status)).toEqual([
      'fulfilled',
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
    ]);
    expect(concurrentWrites[2]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: expect.stringContaining('was reused with a different payload'),
      }),
    });
    expect(
      (
        await catalogue.listKnowledgeEntities({
          limit: 10,
        })
      ).items.map(({ name }) => name),
    ).toEqual(['Evidence']);
    expect(
      (
        await catalogue.listKnowledgePublications({
          limit: 10,
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (await catalogue.listPendingDiscoveryEvents(100))
        .filter(({ eventType }) => eventType.startsWith('Knowledge'))
        .map(({ eventType }) => eventType)
        .sort(),
    ).toEqual(['KnowledgeEntityDiscovered', 'KnowledgeModelPublished']);
    expect(
      (await catalogue.listPendingDiscoveryEvents(100)).filter(
        ({ eventType, correlationId }) =>
          eventType === 'SourceScanCompleted' &&
          correlationId === 'coordinator-concurrent-scan',
      ),
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
    const staleResult = await catalogue.applyDocumentProcessing(
      createProcessingEvent(candidate, 'processing-event-3'),
    );
    expect(staleResult.documentVersion.contentHash).toBe(fingerprint);
    expect(
      (
        await catalogue.listDocumentEvidence(document.id, { limit: 20 })
      ).items.map(({ documentVersionId }) => documentVersionId),
    ).toContain(staleResult.documentVersion.id);

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
    const acceptedBeforeClose = catalogue.recordScanStarted(
      source.id,
      'coordinator-close-drain',
      '2026-10-02T10:00:05.000Z',
    );
    const closing = catalogue.close();
    const rejectedAfterClose = catalogue.recordScanStarted(
      source.id,
      'coordinator-after-close',
      '2026-10-02T10:00:06.000Z',
    );
    await expect(rejectedAfterClose).rejects.toThrow(
      'DuckDB catalogue is closing or closed',
    );
    await acceptedBeforeClose;
    await closing;
    const verificationInstance = await DuckDBInstance.create(
      join(directory, 'catalogue.duckdb'),
    );
    const verificationConnection = await verificationInstance.connect();
    const closeDrainRun = await verificationConnection.runAndReadAll(
      "SELECT correlation_id FROM source_scan_runs WHERE correlation_id = 'coordinator-close-drain'",
    );
    expect(closeDrainRun.getRowObjectsJson()).toHaveLength(1);
    verificationConnection.closeSync();
    verificationInstance.closeSync();
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
    await expect(
      catalogue.registerConfiguration(configuredSources, configuredWorkspaces),
    ).resolves.toBeUndefined();
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

  it('validates, versions, publishes and retains immutable Knowledge Model snapshots', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'workspace-brain-knowledge-'),
    );
    temporaryDirectories.push(directory);
    const catalogue = await createDuckDbCatalogue(
      join(directory, 'catalogue.duckdb'),
      migrationsDirectory,
    );
    await catalogue.registerConfiguration(
      [
        {
          configId: 'knowledge-source',
          name: 'Knowledge Source',
          rootPaths: [join(directory, 'source')],
          excludeDirs: [],
          includeExtensions: ['.json'],
          maxFileSizeBytes: 4096,
        },
      ],
      [
        {
          configId: 'knowledge-workspace',
          name: 'Knowledge Workspace',
          sourceConfigIds: ['knowledge-source'],
          include: ['**'],
          exclude: [],
        },
      ],
    );
    const source = (await catalogue.listSources({ limit: 10 })).items[0];
    const root = source?.roots?.[0];
    if (source === undefined || root === undefined) {
      throw new Error('Knowledge source registration failed');
    }
    const registeredWorkspace = (await catalogue.listWorkspaces({ limit: 10 }))
      .items[0];
    const registeredModel = (await catalogue.listKnowledgeModels({ limit: 10 }))
      .items[0];
    expect(registeredWorkspace?.sourceIds).toContain(source.id);
    expect(registeredModel?.workspaceId).toBe(registeredWorkspace?.id);

    const firstContent =
      '{"name":"@workspace/service","dependencies":{"lodash":"^4"}}';
    const secondContent = '{"name":"@workspace/service"}';
    const secondDocumentContent =
      '{"name":"@workspace/service","dependencies":{"lodash":"^4"}}';
    const firstFingerprint = createHash('sha256')
      .update(firstContent)
      .digest('hex');
    const secondFingerprint = createHash('sha256')
      .update(secondContent)
      .digest('hex');
    const secondDocumentFingerprint = createHash('sha256')
      .update(secondDocumentContent)
      .digest('hex');
    const scanAt = '2026-10-05T08:00:00.000Z';
    const scan = await catalogue.persistScan(
      source.id,
      [],
      [
        {
          path: `${root.id}/service/package.json`,
          filename: 'package.json',
          extension: '.json',
          sizeBytes: Buffer.byteLength(firstContent),
          modifiedAt: scanAt,
          fingerprint: firstFingerprint,
          discoveryMethod: 'filesystem',
        },
        {
          path: `${root.id}/other/package.json`,
          filename: 'package.json',
          extension: '.json',
          sizeBytes: Buffer.byteLength(secondContent),
          modifiedAt: scanAt,
          fingerprint: secondDocumentFingerprint,
          discoveryMethod: 'filesystem',
        },
      ],
      scanAt,
      'knowledge-scan',
      10,
    );
    const firstDocument = scan.documents.find(({ path }) =>
      path.endsWith('/service/package.json'),
    );
    const secondDocument = scan.documents.find(({ path }) =>
      path.endsWith('/other/package.json'),
    );
    if (firstDocument === undefined || secondDocument === undefined) {
      throw new Error('Knowledge document fixture was not persisted');
    }

    async function processPackage(
      document: typeof firstDocument,
      content: string,
      processedAt: string,
      eventId: string,
      overrides: {
        readonly processorVersion?: number;
        readonly extractionRuleVersion?: number;
        readonly dependencyName?: string;
      } = {},
    ) {
      const fingerprint = createHash('sha256').update(content).digest('hex');
      const candidate = {
        documentId: document.id,
        sourceId: source.id,
        path: document.path,
        contentFingerprint: fingerprint,
        processedAt,
        durationMilliseconds: 1,
        processorId: 'json',
        processorVersion: overrides.processorVersion ?? 1,
        extractionRuleId: 'json-scalar-values',
        extractionRuleVersion: overrides.extractionRuleVersion ?? 1,
        evidence: [
          {
            key: 'json:/name',
            kind: 'structured-value' as const,
            excerpt: '@workspace/service',
            truncated: false,
            locator: { kind: 'json-pointer' as const, pointer: '/name' },
          },
          ...(content.includes('dependencies')
            ? [
                {
                  key: `json:/dependencies/${overrides.dependencyName ?? 'lodash'}`,
                  kind: 'structured-value' as const,
                  excerpt: '^4',
                  truncated: false,
                  locator: {
                    kind: 'json-pointer' as const,
                    pointer: `/dependencies/${overrides.dependencyName ?? 'lodash'}`,
                  },
                },
              ]
            : []),
        ],
      };
      return catalogue.applyDocumentProcessing(
        createProcessingEvent(candidate, eventId),
      );
    }

    const firstProcessed = await processPackage(
      firstDocument,
      firstContent,
      '2026-10-05T08:00:01.000Z',
      'knowledge-processing-one',
    );
    const firstInputs = await catalogue.listKnowledgeInputEvidence(
      firstProcessed.documentVersion.id,
    );
    const ownerEvidence = firstInputs.find(
      ({ evidence }) => evidence.key === 'json:/name',
    );
    const dependencyEvidence = firstInputs.find(
      ({ evidence }) => evidence.key === 'json:/dependencies/lodash',
    );
    if (ownerEvidence === undefined || dependencyEvidence === undefined) {
      throw new Error('Package evidence fixture was not persisted');
    }
    const knowledgeProvenance = (input: (typeof firstInputs)[number]) => ({
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
      firstDocument.path,
      '@workspace/service',
    );
    const dependencyKey = createKnowledgeEntityKey(
      'package',
      source.id,
      firstDocument.path,
      'lodash',
    );
    const ownerCandidate = {
      key: ownerKey,
      type: 'package' as const,
      identityScope: firstDocument.path,
      name: '@workspace/service',
      sourceEvidenceIds: [ownerEvidence.evidence.id],
      provenance: [knowledgeProvenance(ownerEvidence)],
      lifecycleStatus: 'observed' as const,
    };
    const dependencyCandidate = {
      key: dependencyKey,
      type: 'package' as const,
      identityScope: firstDocument.path,
      name: 'lodash',
      sourceEvidenceIds: [dependencyEvidence.evidence.id],
      provenance: [knowledgeProvenance(dependencyEvidence)],
      lifecycleStatus: 'observed' as const,
    };
    const relationCandidate = {
      key: `DEPENDS_ON:${ownerKey}->${dependencyKey}`,
      type: 'DEPENDS_ON' as const,
      sourceEntityKey: ownerKey,
      targetEntityKey: dependencyKey,
      sourceEvidenceIds: [dependencyEvidence.evidence.id],
      provenance: [knowledgeProvenance(dependencyEvidence)],
      confidence: 1,
      lifecycleStatus: 'related' as const,
    };
    const firstEvent: KnowledgeCandidateEvent = {
      eventId: 'knowledge-candidates-one',
      eventType: 'KnowledgeCandidatesSubmitted',
      eventVersion: 1,
      occurredAt: '2026-10-05T08:00:02.000Z',
      producer: 'workspace-brain-knowledge-worker',
      correlationId: 'knowledge-correlation-one',
      idempotencyKey: 'knowledge-candidates-one',
      partitionKey: source.id,
      payload: {
        sourceId: source.id,
        documentId: firstDocument.id,
        documentVersionId: firstProcessed.documentVersion.id,
        entities: [ownerCandidate, dependencyCandidate],
        relationships: [relationCandidate],
      },
    };
    const missingEntityKey = createKnowledgeEntityKey(
      'package',
      source.id,
      firstDocument.path,
      'missing',
    );
    await expect(
      catalogue.applyKnowledgeCandidates({
        ...firstEvent,
        eventId: 'knowledge-orphan-before-acceptance',
        idempotencyKey: 'knowledge-orphan-before-acceptance',
        payload: {
          ...firstEvent.payload,
          entities: [],
          relationships: [
            {
              ...relationCandidate,
              key: `REFERENCES:${ownerKey}->${missingEntityKey}`,
              type: 'REFERENCES',
              targetEntityKey: missingEntityKey,
            },
          ],
        },
      }),
    ).rejects.toThrow('references an unknown entity');
    await catalogue.applyKnowledgeCandidates(firstEvent);
    await catalogue.applyKnowledgeCandidates(firstEvent);

    const model = (await catalogue.listKnowledgeModels({ limit: 10 })).items[0];
    if (model === undefined) {
      throw new Error('Knowledge Model was not created for the workspace');
    }
    const firstPublication = (
      await catalogue.listKnowledgePublications({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items[0];
    if (firstPublication === undefined) {
      throw new Error('Knowledge Model publication was not created');
    }
    expect(firstPublication).toMatchObject({
      version: 1,
      status: 'published',
      schemaVersion: 1,
      entityVersionIds: expect.arrayContaining([
        expect.any(String),
        expect.any(String),
      ]),
      relationshipVersionIds: [expect.any(String)],
    });
    expect(
      (await catalogue.listKnowledgeRelationships({ limit: 10 })).items,
    ).toMatchObject([
      {
        type: 'DEPENDS_ON',
        confidence: 1,
        sourceEvidenceIds: [dependencyEvidence.evidence.id],
        provenance: [
          {
            evidenceId: dependencyEvidence.evidence.id,
            documentVersionId: firstProcessed.documentVersion.id,
          },
        ],
      },
    ]);
    expect(
      (
        await catalogue.listKnowledgeEntities({
          publicationId: firstPublication.id,
          limit: 10,
        })
      ).items,
    ).toHaveLength(2);
    const unrelatedModelId = createKnowledgeModelId();
    expect(
      (
        await catalogue.listKnowledgeEntities({
          publicationId: firstPublication.id,
          knowledgeModelId: unrelatedModelId,
          limit: 10,
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          publicationId: firstPublication.id,
          knowledgeModelId: unrelatedModelId,
          limit: 10,
        })
      ).items,
    ).toEqual([]);

    const secondProcessed = await processPackage(
      secondDocument,
      secondDocumentContent,
      '2026-10-05T08:00:03.000Z',
      'knowledge-processing-two',
    );
    const secondInputs = await catalogue.listKnowledgeInputEvidence(
      secondProcessed.documentVersion.id,
    );
    const secondOwnerEvidence = secondInputs.find(
      ({ evidence }) => evidence.key === 'json:/name',
    );
    const secondDependencyEvidence = secondInputs.find(
      ({ evidence }) => evidence.key === 'json:/dependencies/lodash',
    );
    if (
      secondOwnerEvidence === undefined ||
      secondDependencyEvidence === undefined
    ) {
      throw new Error('Second package evidence fixture was not persisted');
    }
    const secondEvent: KnowledgeCandidateEvent = {
      ...firstEvent,
      eventId: 'knowledge-candidates-two',
      occurredAt: '2026-10-05T08:00:04.000Z',
      correlationId: 'knowledge-correlation-two',
      idempotencyKey: 'knowledge-candidates-two',
      payload: {
        sourceId: source.id,
        documentId: secondDocument.id,
        documentVersionId: secondProcessed.documentVersion.id,
        entities: [
          {
            ...ownerCandidate,
            sourceEvidenceIds: [secondOwnerEvidence.evidence.id],
            provenance: [knowledgeProvenance(secondOwnerEvidence)],
          },
          {
            ...dependencyCandidate,
            sourceEvidenceIds: [secondDependencyEvidence.evidence.id],
            provenance: [knowledgeProvenance(secondDependencyEvidence)],
          },
        ],
        relationships: [
          {
            ...relationCandidate,
            sourceEvidenceIds: [secondDependencyEvidence.evidence.id],
            provenance: [knowledgeProvenance(secondDependencyEvidence)],
          },
        ],
      },
    };
    await catalogue.applyKnowledgeCandidates(secondEvent);
    const publications = (
      await catalogue.listKnowledgePublications({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items.sort((left, right) => left.version - right.version);
    expect(publications.map(({ version }) => version)).toEqual([1, 2]);
    expect(
      (await catalogue.listKnowledgeModels({ limit: 10 })).items[0]
        ?.latestPublicationVersion,
    ).toBe(2);
    const currentOwner = (
      await catalogue.listKnowledgeEntities({
        knowledgeModelId: model.id,
        type: 'package',
        limit: 10,
      })
    ).items.find(({ name }) => name === '@workspace/service');
    expect(currentOwner?.sourceEvidenceIds).toHaveLength(2);
    const currentRelationship = (
      await catalogue.listKnowledgeRelationships({
        knowledgeModelId: model.id,
        type: 'DEPENDS_ON',
        limit: 10,
      })
    ).items[0];
    expect(currentRelationship?.sourceEvidenceIds).toEqual(
      expect.arrayContaining([
        dependencyEvidence.evidence.id,
        secondDependencyEvidence.evidence.id,
      ]),
    );
    const secondPublication = publications[1];
    if (secondPublication === undefined) {
      throw new Error('Second Knowledge Model publication was not created');
    }
    expect((await catalogue.getLatestKnowledgePublication(model.id))?.id).toBe(
      secondPublication.id,
    );
    expect(
      await catalogue.getLatestKnowledgePublication(createKnowledgeModelId()),
    ).toBeUndefined();
    expect(
      await catalogue.getKnowledgePublication(firstPublication.id),
    ).toEqual(firstPublication);
    expect(
      await catalogue.getKnowledgePublicationSummary(secondPublication.id),
    ).toMatchObject({
      publication: secondPublication,
      entityCount: 2,
      relationshipCount: 1,
    });
    const firstPublishedEntities = (
      await catalogue.listKnowledgeEntities({
        publicationId: firstPublication.id,
        limit: 10,
      })
    ).items;
    const secondPublishedEntities = (
      await catalogue.listKnowledgeEntities({
        publicationId: secondPublication.id,
        limit: 10,
      })
    ).items;
    const firstPublishedOwner = firstPublishedEntities.find(
      ({ name }) => name === '@workspace/service',
    );
    const secondPublishedOwner = secondPublishedEntities.find(
      ({ name }) => name === '@workspace/service',
    );
    if (
      firstPublishedOwner === undefined ||
      secondPublishedOwner === undefined
    ) {
      throw new Error('Published entity snapshots were not available');
    }
    expect(firstPublishedOwner.id).toBe(secondPublishedOwner.id);
    expect(firstPublishedOwner.currentVersionId).not.toBe(
      secondPublishedOwner.currentVersionId,
    );
    const firstPublishedEntity = await catalogue.getPublishedEntity(
      firstPublication.id,
      firstPublishedOwner.id,
    );
    const secondPublishedEntity = await catalogue.getPublishedEntity(
      secondPublication.id,
      secondPublishedOwner.id,
    );
    expect(firstPublishedEntity).toMatchObject({
      publicationId: firstPublication.id,
      entityVersionId: firstPublishedOwner.currentVersionId,
      entity: firstPublishedOwner,
    });
    expect(secondPublishedEntity).toMatchObject({
      publicationId: secondPublication.id,
      entityVersionId: secondPublishedOwner.currentVersionId,
      entity: secondPublishedOwner,
    });
    const secondPublishedRelationship = (
      await catalogue.listKnowledgeRelationships({
        publicationId: secondPublication.id,
        limit: 10,
      })
    ).items[0];
    if (secondPublishedRelationship === undefined) {
      throw new Error('Published relationship snapshot was not available');
    }
    const publishedRelationship = await catalogue.getPublishedRelationship(
      secondPublication.id,
      secondPublishedRelationship.id,
    );
    expect(publishedRelationship).toMatchObject({
      publicationId: secondPublication.id,
      relationshipVersionId: secondPublishedRelationship.currentVersionId,
      relationship: secondPublishedRelationship,
    });
    const outgoing = await catalogue.listPublishedEntityRelationships({
      publicationId: secondPublication.id,
      entityId: secondPublishedRelationship.sourceEntityId,
      direction: 'outgoing',
      relationshipType: 'DEPENDS_ON',
      limit: 10,
    });
    const incoming = await catalogue.listPublishedEntityRelationships({
      publicationId: secondPublication.id,
      entityId: secondPublishedRelationship.targetEntityId,
      direction: 'incoming',
      relationshipType: 'DEPENDS_ON',
      limit: 10,
    });
    expect(outgoing.items).toHaveLength(1);
    expect(outgoing.items[0]).toMatchObject({
      publicationId: secondPublication.id,
      relationshipVersionId: secondPublishedRelationship.currentVersionId,
      versionNumber: expect.any(Number),
      direction: 'outgoing',
      relationship: secondPublishedRelationship,
    });
    expect(incoming.items).toHaveLength(1);
    expect(incoming.items[0]?.direction).toBe('incoming');
    expect(
      (
        await catalogue.getPublishedRelationshipProvenance(
          secondPublication.id,
          secondPublishedRelationship.id,
        )
      )?.items,
    ).toHaveLength(2);
    const publishedEntityProvenance =
      await catalogue.getPublishedEntityProvenance(
        secondPublication.id,
        secondPublishedOwner.id,
      );
    expect(publishedEntityProvenance?.items).toHaveLength(2);
    for (const support of publishedEntityProvenance?.items ?? []) {
      expect(support.evidenceExplanation.evidence.id).toBe(
        support.provenance.evidenceId,
      );
      expect(support.evidenceExplanation.evidence.documentVersionId).toBe(
        support.provenance.documentVersionId,
      );
      expect(support.evidenceExplanation.documentVersion.contentHash).toBe(
        firstFingerprint,
      );
      expect(support.evidenceExplanation.document.fingerprint).toBe(
        support.provenance.contentFingerprint,
      );
      expect(support.evidenceExplanation.documentVersion.processorVersion).toBe(
        support.provenance.processorVersion,
      );
      expect(
        support.evidenceExplanation.documentVersion.extractionRuleVersion,
      ).toBe(support.provenance.extractionRuleVersion);
    }
    expect(secondPublication.contentHash).not.toBe(
      firstPublication.contentHash,
    );
    const hashEntities = (
      await catalogue.listKnowledgeEntities({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items.filter(
      ({ lifecycleStatus }) =>
        lifecycleStatus !== 'superseded' && lifecycleStatus !== 'rejected',
    );
    const hashRelationships = (
      await catalogue.listKnowledgeRelationships({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items.filter(
      ({ lifecycleStatus }) =>
        lifecycleStatus !== 'superseded' && lifecycleStatus !== 'rejected',
    );
    const canonicalHash = createKnowledgePublicationContentHash(
      hashEntities,
      hashRelationships,
    );
    expect(canonicalHash).toBe(secondPublication.contentHash);
    expect(
      createKnowledgePublicationContentHash(
        [...hashEntities].reverse(),
        [...hashRelationships].reverse(),
      ),
    ).toBe(canonicalHash);
    const entitySnapshotChange = hashEntities.map((entity, index) =>
      index === 0 ? { ...entity, name: `${entity.name} changed` } : entity,
    );
    expect(
      createKnowledgePublicationContentHash(
        entitySnapshotChange,
        hashRelationships,
      ),
    ).not.toBe(canonicalHash);
    const relationshipSnapshotChange = hashRelationships.map(
      (relationship) => ({
        ...relationship,
        confidence: relationship.confidence === 1 ? 0.9 : 1,
      }),
    );
    expect(
      createKnowledgePublicationContentHash(
        hashEntities,
        relationshipSnapshotChange,
      ),
    ).not.toBe(canonicalHash);
    const reorderedSecondEvent: KnowledgeCandidateEvent = {
      ...secondEvent,
      eventId: 'knowledge-candidates-two-reordered',
      idempotencyKey: 'knowledge-candidates-two-reordered',
      payload: {
        ...secondEvent.payload,
        entities: [...secondEvent.payload.entities].reverse(),
        relationships: [...secondEvent.payload.relationships].reverse(),
      },
    };
    await catalogue.applyKnowledgeCandidates(reorderedSecondEvent);
    expect(
      (
        await catalogue.listKnowledgePublications({
          knowledgeModelId: model.id,
          limit: 10,
        })
      ).items,
    ).toHaveLength(2);
    expect(
      (
        await catalogue.listKnowledgePublications({
          knowledgeModelId: model.id,
          limit: 10,
        })
      ).items.find(({ version }) => version === 2)?.contentHash,
    ).toBe(secondPublication.contentHash);

    const modifiedFirstScan = await catalogue.persistScan(
      source.id,
      [],
      [
        {
          path: firstDocument.path,
          filename: firstDocument.filename,
          extension: firstDocument.extension,
          sizeBytes: Buffer.byteLength(secondContent),
          modifiedAt: '2026-10-05T08:00:05.000Z',
          fingerprint: secondFingerprint,
          discoveryMethod: 'filesystem',
        },
        {
          path: secondDocument.path,
          filename: secondDocument.filename,
          extension: secondDocument.extension,
          sizeBytes: Buffer.byteLength(secondDocumentContent),
          modifiedAt: '2026-10-05T08:00:00.000Z',
          fingerprint: secondDocumentFingerprint,
          discoveryMethod: 'filesystem',
        },
      ],
      '2026-10-05T08:00:05.000Z',
      'knowledge-scan-modified',
      10,
    );
    const currentFirstDocument = modifiedFirstScan.documents.find(
      ({ id }) => id === firstDocument.id,
    );
    if (currentFirstDocument === undefined) {
      throw new Error('Modified knowledge document was not retained');
    }
    const modifiedFirstProcessed = await processPackage(
      currentFirstDocument,
      secondContent,
      '2026-10-05T08:00:06.000Z',
      'knowledge-processing-modified',
    );
    const modifiedFirstInputs = await catalogue.listKnowledgeInputEvidence(
      modifiedFirstProcessed.documentVersion.id,
    );
    const modifiedOwnerEvidence = modifiedFirstInputs.find(
      ({ evidence }) => evidence.key === 'json:/name',
    );
    if (modifiedOwnerEvidence === undefined) {
      throw new Error('Modified package owner evidence was not persisted');
    }
    const modifiedEvent: KnowledgeCandidateEvent = {
      ...firstEvent,
      eventId: 'knowledge-candidates-modified',
      occurredAt: '2026-10-05T08:00:07.000Z',
      correlationId: 'knowledge-correlation-modified',
      idempotencyKey: 'knowledge-candidates-modified',
      payload: {
        sourceId: source.id,
        documentId: firstDocument.id,
        documentVersionId: modifiedFirstProcessed.documentVersion.id,
        entities: [
          {
            ...ownerCandidate,
            sourceEvidenceIds: [modifiedOwnerEvidence.evidence.id],
            provenance: [knowledgeProvenance(modifiedOwnerEvidence)],
          },
        ],
        relationships: [],
      },
    };
    await catalogue.applyKnowledgeCandidates(modifiedEvent);
    const beforeStaleContentCandidate = (
      await catalogue.listKnowledgePublications({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items;
    await catalogue.applyKnowledgeCandidates({
      ...firstEvent,
      eventId: 'knowledge-candidates-stale-old-content',
      occurredAt: '2026-10-05T08:00:07.500Z',
      correlationId: 'knowledge-correlation-stale-old-content',
      idempotencyKey: 'knowledge-candidates-stale-old-content',
    });
    expect(
      (
        await catalogue.listKnowledgePublications({
          knowledgeModelId: model.id,
          limit: 10,
        })
      ).items,
    ).toEqual(beforeStaleContentCandidate);
    const thirdPublication = (
      await catalogue.listKnowledgePublications({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items.find(({ version }) => version === 3);
    if (thirdPublication === undefined) {
      throw new Error('Reconciled Knowledge Model publication was not created');
    }
    expect(thirdPublication.contentHash).not.toBe(
      secondPublication.contentHash,
    );
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          publicationId: thirdPublication.id,
          limit: 10,
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          publicationId: thirdPublication.id,
          type: 'DEPENDS_ON',
          limit: 10,
        })
      ).items[0]?.sourceEvidenceIds,
    ).toEqual([secondDependencyEvidence.evidence.id]);
    await catalogue.applyKnowledgeCandidates(modifiedEvent);
    expect(
      (
        await catalogue.listKnowledgePublications({
          knowledgeModelId: model.id,
          limit: 10,
        })
      ).items,
    ).toHaveLength(3);

    const removalScan = await catalogue.persistScan(
      source.id,
      [],
      [
        {
          path: firstDocument.path,
          filename: firstDocument.filename,
          extension: firstDocument.extension,
          sizeBytes: Buffer.byteLength(secondContent),
          modifiedAt: '2026-10-05T08:00:05.000Z',
          fingerprint: secondFingerprint,
          discoveryMethod: 'filesystem',
        },
      ],
      '2026-10-05T08:00:08.000Z',
      'knowledge-scan-removed',
      10,
    );
    expect(removalScan.documentChanges.map(({ change }) => change)).toContain(
      'removed',
    );
    const fourthPublication = (
      await catalogue.listKnowledgePublications({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items.find(({ version }) => version === 4);
    if (fourthPublication === undefined) {
      throw new Error('Document removal did not publish reconciled knowledge');
    }
    expect(fourthPublication.contentHash).not.toBe(
      thirdPublication.contentHash,
    );
    expect(
      (
        await catalogue.listKnowledgeEntities({
          publicationId: fourthPublication.id,
          limit: 10,
        })
      ).items.map(({ name }) => name),
    ).toEqual(['@workspace/service']);
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          publicationId: fourthPublication.id,
          limit: 10,
        })
      ).items,
    ).toEqual([]);
    expect(
      await catalogue.getPublishedRelationship(
        fourthPublication.id,
        currentRelationship?.id ?? '',
      ),
    ).toBeUndefined();
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          publicationId: firstPublication.id,
          limit: 10,
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await catalogue.listKnowledgePublications({
          knowledgeModelId: model.id,
          limit: 10,
        })
      ).items.find(({ version }) => version === 1)?.contentHash,
    ).toBe(firstPublication.contentHash);
    const latestModel = (await catalogue.listKnowledgeModels({ limit: 10 }))
      .items[0];
    expect(latestModel?.latestPublicationVersion).toBe(4);
    const retainedOwner = (
      await catalogue.listKnowledgeEntities({
        publicationId: firstPublication.id,
        type: 'package',
        limit: 10,
      })
    ).items.find(({ name }) => name === '@workspace/service');
    expect(retainedOwner?.sourceEvidenceIds).toEqual([
      ownerEvidence.evidence.id,
    ]);
    if (retainedOwner === undefined) {
      throw new Error('Retained published entity was not available');
    }
    const retainedProvenance = await catalogue.getPublishedEntityProvenance(
      firstPublication.id,
      retainedOwner.id,
    );
    expect(retainedProvenance?.items).toHaveLength(1);
    expect(
      retainedProvenance?.items[0]?.evidenceExplanation.documentVersion.id,
    ).toBe(firstProcessed.documentVersion.id);
    expect(
      retainedProvenance?.items[0]?.evidenceExplanation.documentVersion
        .contentHash,
    ).toBe(firstFingerprint);
    expect(
      retainedProvenance?.items[0]?.evidenceExplanation.document.fingerprint,
    ).toBe(firstFingerprint);

    const historicalRelationship = (
      await catalogue.listKnowledgeRelationships({
        publicationId: thirdPublication.id,
        limit: 10,
      })
    ).items[0];
    const historicalDependency = (
      await catalogue.listKnowledgeEntities({
        publicationId: thirdPublication.id,
        limit: 10,
      })
    ).items.find(({ name }) => name === 'lodash');
    const supersededRelationship = (
      await catalogue.listKnowledgeRelationships({
        knowledgeModelId: model.id,
        type: 'DEPENDS_ON',
        limit: 10,
      })
    ).items[0];
    const supersededDependency = (
      await catalogue.listKnowledgeEntities({
        knowledgeModelId: model.id,
        type: 'package',
        limit: 10,
      })
    ).items.find(({ id }) => id === historicalDependency?.id);
    expect(supersededRelationship?.lifecycleStatus).toBe('superseded');
    expect(supersededDependency?.lifecycleStatus).toBe('superseded');
    if (
      historicalRelationship === undefined ||
      historicalDependency === undefined ||
      supersededRelationship === undefined ||
      supersededDependency === undefined
    ) {
      throw new Error('Historical knowledge required for reactivation missing');
    }

    const restoredScan = await catalogue.persistScan(
      source.id,
      [],
      [
        {
          path: firstDocument.path,
          filename: firstDocument.filename,
          extension: firstDocument.extension,
          sizeBytes: Buffer.byteLength(secondContent),
          modifiedAt: '2026-10-05T08:00:09.000Z',
          fingerprint: secondFingerprint,
          discoveryMethod: 'filesystem',
        },
        {
          path: secondDocument.path,
          filename: secondDocument.filename,
          extension: secondDocument.extension,
          sizeBytes: Buffer.byteLength(secondDocumentContent),
          modifiedAt: '2026-10-05T08:00:09.000Z',
          fingerprint: secondDocumentFingerprint,
          discoveryMethod: 'filesystem',
        },
      ],
      '2026-10-05T08:00:09.000Z',
      'knowledge-scan-restored',
      10,
    );
    const restoredDocument = restoredScan.documents.find(
      ({ id }) => id === secondDocument.id,
    );
    if (restoredDocument === undefined) {
      throw new Error('Restored knowledge document was not persisted');
    }
    const publicationCountBeforeRestoredProcessing = (
      await catalogue.listKnowledgePublications({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items;
    await catalogue.applyKnowledgeCandidates({
      ...secondEvent,
      eventId: 'knowledge-candidates-after-removal-before-processing',
      occurredAt: '2026-10-05T08:00:09.500Z',
      correlationId: 'knowledge-correlation-after-removal-before-processing',
      idempotencyKey: 'knowledge-candidates-after-removal-before-processing',
    });
    expect(
      (
        await catalogue.listKnowledgePublications({
          knowledgeModelId: model.id,
          limit: 10,
        })
      ).items,
    ).toEqual(publicationCountBeforeRestoredProcessing);
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          knowledgeModelId: model.id,
          type: 'DEPENDS_ON',
          limit: 10,
        })
      ).items[0]?.lifecycleStatus,
    ).toBe('superseded');
    const restoredProcessing = await processPackage(
      restoredDocument,
      secondDocumentContent,
      '2026-10-05T08:00:10.000Z',
      'knowledge-processing-restored-v2',
      {
        processorVersion: 2,
        extractionRuleVersion: 2,
        dependencyName: 'Lodash',
      },
    );
    const restoredInputs = await catalogue.listKnowledgeInputEvidence(
      restoredProcessing.documentVersion.id,
    );
    const restoredOwnerEvidence = restoredInputs.find(
      ({ evidence }) => evidence.key === 'json:/name',
    );
    const restoredDependencyEvidence = restoredInputs.find(
      ({ evidence }) => evidence.key === 'json:/dependencies/Lodash',
    );
    if (
      restoredOwnerEvidence === undefined ||
      restoredDependencyEvidence === undefined
    ) {
      throw new Error('Restored knowledge evidence was not persisted');
    }
    const restoredEvent: KnowledgeCandidateEvent = {
      ...secondEvent,
      eventId: 'knowledge-candidates-restored-v2',
      occurredAt: '2026-10-05T08:00:11.000Z',
      correlationId: 'knowledge-correlation-restored-v2',
      idempotencyKey: 'knowledge-candidates-restored-v2',
      payload: {
        sourceId: source.id,
        documentId: restoredDocument.id,
        documentVersionId: restoredProcessing.documentVersion.id,
        entities: [
          {
            ...ownerCandidate,
            sourceEvidenceIds: [restoredOwnerEvidence.evidence.id],
            provenance: [knowledgeProvenance(restoredOwnerEvidence)],
          },
          {
            ...dependencyCandidate,
            name: 'Lodash',
            sourceEvidenceIds: [restoredDependencyEvidence.evidence.id],
            provenance: [knowledgeProvenance(restoredDependencyEvidence)],
          },
        ],
        relationships: [
          {
            ...relationCandidate,
            sourceEvidenceIds: [restoredDependencyEvidence.evidence.id],
            provenance: [knowledgeProvenance(restoredDependencyEvidence)],
          },
        ],
      },
    };
    const publicationsBeforeFailedReactivation = (
      await catalogue.listKnowledgePublications({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items;
    const outboxBeforeFailedReactivation =
      await catalogue.listPendingDiscoveryEvents(100);
    const missingReactivationEntityKey = createKnowledgeEntityKey(
      'package',
      source.id,
      firstDocument.path,
      'missing-reactivation-target',
    );
    await expect(
      catalogue.applyKnowledgeCandidates({
        ...restoredEvent,
        eventId: 'knowledge-candidates-restoration-rollback',
        idempotencyKey: 'knowledge-candidates-restoration-rollback',
        payload: {
          ...restoredEvent.payload,
          relationships: [
            {
              ...relationCandidate,
              key: `REFERENCES:${ownerKey}->${missingReactivationEntityKey}`,
              type: 'REFERENCES',
              targetEntityKey: missingReactivationEntityKey,
              sourceEvidenceIds: [restoredDependencyEvidence.evidence.id],
              provenance: [knowledgeProvenance(restoredDependencyEvidence)],
            },
          ],
        },
      }),
    ).rejects.toThrow('references an unknown entity');
    expect(
      (
        await catalogue.listKnowledgeEntities({
          knowledgeModelId: model.id,
          type: 'package',
          limit: 10,
        })
      ).items.find(({ id }) => id === supersededDependency.id),
    ).toEqual(supersededDependency);
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          knowledgeModelId: model.id,
          type: 'DEPENDS_ON',
          limit: 10,
        })
      ).items[0],
    ).toEqual(supersededRelationship);
    expect(
      (
        await catalogue.listKnowledgePublications({
          knowledgeModelId: model.id,
          limit: 10,
        })
      ).items,
    ).toEqual(publicationsBeforeFailedReactivation);
    expect(await catalogue.listPendingDiscoveryEvents(100)).toEqual(
      outboxBeforeFailedReactivation,
    );
    await catalogue.applyKnowledgeCandidates(restoredEvent);
    const reactivatedEntity = (
      await catalogue.listKnowledgeEntities({
        knowledgeModelId: model.id,
        type: 'package',
        limit: 10,
      })
    ).items.find(({ id }) => id === supersededDependency.id);
    const reactivatedRelationship = (
      await catalogue.listKnowledgeRelationships({
        knowledgeModelId: model.id,
        type: 'DEPENDS_ON',
        limit: 10,
      })
    ).items[0];
    expect(reactivatedEntity).toMatchObject({
      id: supersededDependency.id,
      name: 'Lodash',
      lifecycleStatus: 'observed',
    });
    expect(reactivatedEntity?.currentVersionId).not.toBe(
      supersededDependency.currentVersionId,
    );
    expect(reactivatedRelationship).toMatchObject({
      id: supersededRelationship.id,
      lifecycleStatus: 'related',
    });
    expect(reactivatedRelationship?.currentVersionId).not.toBe(
      supersededRelationship.currentVersionId,
    );
    expect(await catalogue.getKnowledgeEntity(supersededDependency.id)).toEqual(
      reactivatedEntity,
    );
    expect(
      await catalogue.getKnowledgeRelationship(supersededRelationship.id),
    ).toEqual(reactivatedRelationship);
    const fifthPublication = (
      await catalogue.listKnowledgePublications({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items.find(({ version }) => version === 5);
    if (fifthPublication === undefined) {
      throw new Error('Reactivation did not publish reconciled knowledge');
    }
    expect(fifthPublication.contentHash).not.toBe(
      fourthPublication.contentHash,
    );
    const publicationsAfterReactivation = (
      await catalogue.listKnowledgePublications({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items;
    for (const historicalPublication of [
      firstPublication,
      secondPublication,
      thirdPublication,
      fourthPublication,
    ]) {
      expect(
        publicationsAfterReactivation.find(
          ({ id }) => id === historicalPublication.id,
        ),
      ).toEqual(historicalPublication);
    }
    expect(
      (
        await catalogue.listKnowledgeEntities({
          publicationId: fifthPublication.id,
          limit: 10,
        })
      ).items.find(({ id }) => id === supersededDependency.id),
    ).toEqual(reactivatedEntity);
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          publicationId: fifthPublication.id,
          limit: 10,
        })
      ).items.find(({ id }) => id === supersededRelationship.id),
    ).toEqual(reactivatedRelationship);
    expect(
      (
        await catalogue.listKnowledgeEntities({
          publicationId: thirdPublication.id,
          limit: 10,
        })
      ).items.find(({ id }) => id === historicalDependency.id),
    ).toMatchObject({ name: 'lodash', lifecycleStatus: 'observed' });
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          publicationId: thirdPublication.id,
          limit: 10,
        })
      ).items,
    ).toEqual([historicalRelationship]);
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          publicationId: fourthPublication.id,
          limit: 10,
        })
      ).items,
    ).toEqual([]);

    const publicationsBeforeReplay = (
      await catalogue.listKnowledgePublications({
        knowledgeModelId: model.id,
        limit: 10,
      })
    ).items;
    const outboxBeforeReplay = await catalogue.listPendingDiscoveryEvents(100);
    await catalogue.applyKnowledgeCandidates(restoredEvent);
    const staleCandidateEvent: KnowledgeCandidateEvent = {
      ...secondEvent,
      eventId: 'knowledge-candidates-stale-same-fingerprint',
      occurredAt: '2026-10-05T08:00:12.000Z',
      correlationId: 'knowledge-correlation-stale-same-fingerprint',
      idempotencyKey: 'knowledge-candidates-stale-same-fingerprint',
    };
    await catalogue.applyKnowledgeCandidates(staleCandidateEvent);
    expect(
      (
        await catalogue.listKnowledgePublications({
          knowledgeModelId: model.id,
          limit: 10,
        })
      ).items,
    ).toEqual(publicationsBeforeReplay);
    expect(await catalogue.listPendingDiscoveryEvents(100)).toEqual(
      outboxBeforeReplay,
    );
    expect(
      (
        await catalogue.listKnowledgeEntities({
          knowledgeModelId: model.id,
          type: 'package',
          limit: 10,
        })
      ).items.find(({ id }) => id === supersededDependency.id),
    ).toMatchObject({
      name: 'Lodash',
      lifecycleStatus: 'observed',
      sourceEvidenceIds: [restoredDependencyEvidence.evidence.id],
      provenance: [
        expect.objectContaining({
          documentVersionId: restoredProcessing.documentVersion.id,
        }),
      ],
    });
    expect(
      (
        await catalogue.listKnowledgeRelationships({
          knowledgeModelId: model.id,
          type: 'DEPENDS_ON',
          limit: 10,
        })
      ).items[0],
    ).toMatchObject({
      id: supersededRelationship.id,
      lifecycleStatus: 'related',
      sourceEvidenceIds: [restoredDependencyEvidence.evidence.id],
      provenance: [
        expect.objectContaining({
          documentVersionId: restoredProcessing.documentVersion.id,
        }),
      ],
    });
    expect(
      (
        await catalogue.listKnowledgePublications({
          knowledgeModelId: model.id,
          limit: 10,
        })
      ).items.find(({ version }) => version === 3)?.contentHash,
    ).toBe(thirdPublication.contentHash);

    const invalidEvent = (
      eventId: string,
      entities: readonly unknown[],
      relationships: readonly unknown[],
    ): KnowledgeCandidateEvent =>
      ({
        ...firstEvent,
        eventId,
        idempotencyKey: eventId,
        payload: {
          sourceId: source.id,
          documentId: firstDocument.id,
          documentVersionId: firstProcessed.documentVersion.id,
          entities,
          relationships,
        },
      }) as unknown as KnowledgeCandidateEvent;
    await expect(
      catalogue.applyKnowledgeCandidates(
        invalidEvent(
          'knowledge-invalid-type',
          [],
          [{ ...relationCandidate, type: 'OWNS' }],
        ),
      ),
    ).rejects.toThrow('Invalid knowledge candidate submission');
    await expect(
      catalogue.applyKnowledgeCandidates(
        invalidEvent(
          'knowledge-missing-provenance',
          [{ ...ownerCandidate, provenance: [] }],
          [],
        ),
      ),
    ).rejects.toThrow('Invalid knowledge candidate submission');
    await expect(
      catalogue.applyKnowledgeCandidates(
        invalidEvent(
          'knowledge-missing-evidence',
          [{ ...ownerCandidate, sourceEvidenceIds: [], provenance: [] }],
          [],
        ),
      ),
    ).rejects.toThrow('Invalid knowledge candidate submission');
    await expect(
      catalogue.applyKnowledgeCandidates(
        invalidEvent(
          'knowledge-invalid-lifecycle',
          [{ ...ownerCandidate, lifecycleStatus: 'published' }],
          [],
        ),
      ),
    ).rejects.toThrow('Invalid knowledge candidate submission');
    expect(
      (
        await catalogue.listKnowledgePublications({
          knowledgeModelId: model.id,
          limit: 10,
        })
      ).items,
    ).toHaveLength(5);
    expect(
      await catalogue.getKnowledgePublication(firstPublication.id),
    ).toEqual(firstPublication);
    expect(
      await catalogue.getKnowledgePublication(secondPublication.id),
    ).toEqual(secondPublication);
    await catalogue.close();

    const verificationInstance = await DuckDBInstance.create(
      join(directory, 'catalogue.duckdb'),
    );
    const verificationConnection = await verificationInstance.connect();
    try {
      const entityVersions = await verificationConnection.runAndReadAll(
        'SELECT CAST(snapshot_json AS VARCHAR) AS snapshot_json FROM entity_versions WHERE entity_id = $1 ORDER BY version_number',
        [supersededDependency.id],
      );
      const reactivatedSnapshots = entityVersions
        .getRowObjectsJson()
        .map((row) => JSON.parse(String(row.snapshot_json)) as unknown)
        .filter(
          (snapshot): snapshot is { name: string; lifecycleStatus: string } =>
            typeof snapshot === 'object' &&
            snapshot !== null &&
            'name' in snapshot &&
            snapshot.name === 'Lodash' &&
            'lifecycleStatus' in snapshot &&
            snapshot.lifecycleStatus === 'observed',
        );
      expect(reactivatedSnapshots).toHaveLength(1);
    } finally {
      verificationConnection.closeSync();
      verificationInstance.closeSync();
    }

    const expectSnapshotIntegrityFailure = async (
      table: 'entity_versions' | 'relationship_versions',
      versionId: string,
      publicationId: string,
      mutate: (snapshot: Record<string, unknown>) => Record<string, unknown>,
      expectedMessage?: string,
    ): Promise<void> => {
      const databasePath = join(directory, 'catalogue.duckdb');
      const mutationInstance = await DuckDBInstance.create(databasePath);
      const mutationConnection = await mutationInstance.connect();
      const originalSnapshot = await (async (): Promise<string> => {
        try {
          const rows = await mutationConnection.runAndReadAll(
            `SELECT CAST(snapshot_json AS VARCHAR) AS snapshot_json FROM ${table} WHERE id = $1`,
            [versionId],
          );
          const row = rows.getRowObjectsJson()[0];
          if (row?.snapshot_json === undefined) {
            throw new Error(`Published ${table} row was not retained`);
          }
          const snapshotJson = String(row.snapshot_json);
          await mutationConnection.run(
            `UPDATE ${table} SET snapshot_json = $1 WHERE id = $2`,
            [
              JSON.stringify(
                mutate(JSON.parse(snapshotJson) as Record<string, unknown>),
              ),
              versionId,
            ],
          );
          return snapshotJson;
        } finally {
          mutationConnection.closeSync();
          mutationInstance.closeSync();
        }
      })();

      const integrityCatalogue = await createDuckDbCatalogue(
        databasePath,
        migrationsDirectory,
      );
      try {
        const failure = await integrityCatalogue
          .getKnowledgePublication(publicationId)
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        expect(failure).toBeInstanceOf(CatalogueIntegrityError);
        if (expectedMessage !== undefined) {
          expect(failure).toMatchObject({ message: expectedMessage });
        }
      } finally {
        await integrityCatalogue.close();
      }

      const restoreInstance = await DuckDBInstance.create(databasePath);
      const restoreConnection = await restoreInstance.connect();
      try {
        await restoreConnection.run(
          `UPDATE ${table} SET snapshot_json = $1 WHERE id = $2`,
          [originalSnapshot, versionId],
        );
      } finally {
        restoreConnection.closeSync();
        restoreInstance.closeSync();
      }
    };

    const mutateEntitySnapshot = (
      mutate: (snapshot: Record<string, unknown>) => Record<string, unknown>,
    ) =>
      expectSnapshotIntegrityFailure(
        'entity_versions',
        firstPublishedOwner.currentVersionId,
        firstPublication.id,
        mutate,
      );
    const mutateRelationshipSnapshot = (
      mutate: (snapshot: Record<string, unknown>) => Record<string, unknown>,
    ) =>
      expectSnapshotIntegrityFailure(
        'relationship_versions',
        secondPublishedRelationship.currentVersionId,
        secondPublication.id,
        mutate,
      );

    for (const mutateSupport of [
      (snapshot: Record<string, unknown>) => ({
        ...snapshot,
        sourceEvidenceIds: [],
      }),
      (snapshot: Record<string, unknown>) => ({
        ...snapshot,
        provenance: [],
      }),
      (snapshot: Record<string, unknown>) => ({
        ...snapshot,
        sourceEvidenceIds: [],
        provenance: [],
      }),
    ]) {
      await mutateEntitySnapshot(mutateSupport);
      await mutateRelationshipSnapshot(mutateSupport);
    }

    await mutateEntitySnapshot(
      (snapshot) => ({
        ...snapshot,
        name: `${String(snapshot.name)} (modified)`,
      }),
      'content does not match its stored hash',
    );
    await mutateRelationshipSnapshot(
      (snapshot) => ({
        ...snapshot,
        type: snapshot.type === 'DEPENDS_ON' ? 'USES' : 'DEPENDS_ON',
      }),
      'content does not match its stored hash',
    );
  });
});
