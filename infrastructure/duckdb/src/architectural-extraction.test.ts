import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { type DiscoveryEvent, type Document } from '@workspace-brain/domain';
import { processDocument } from '../../../packages/processing-core/src/index.js';
import { serializeKnowledgePublicationPackage } from '@workspace-brain/domain-publication';
import { classifyPublicationCurrency } from '@workspace-brain/domain-currency';
import { createPublicationDiffService } from '@workspace-brain/publication-diff-service';
import { describe, expect, it } from 'vitest';
import { FilesystemSourceScanner } from '../../filesystem/src/index.js';
import { extractKnowledgeCandidates } from '../../../apps/knowledge-worker/src/knowledge-extractors.js';
import { createDuckDbCatalogue } from './index.js';
import { createApiServer } from '../../../apps/workspace-brain-api/src/server.js';

const migrations = resolve('infrastructure/duckdb/migrations');
const files: Record<string, string> = {
  'package.json':
    '{"name":"parent","dependencies":{"external":"1"},"files":["src/entry.ts","nested/child.ts"]}',
  'src/entry.ts': "import './other.js';\nexport const value = 1;",
  'src/other.ts': 'export const other = 2;',
  'openapi.json': JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Architecture API', version: '1' },
    paths: { '/export': { get: { operationId: 'exportPublication' } } },
  }),
  'docs/ADR-001-first.md': '# ADR-001: First\n\n- **Status:** Accepted\n',
  'docs/ADR-002-second.md':
    '# ADR-002: Second\n\n- **Status:** Accepted\n- **Supersedes:** ADR-001\n',
  'docs/architecture.md': '# Architecture\n\n[API](../openapi.json)\n',
  'README.md':
    '# Fixture\n\n[Architecture](docs/architecture.md)\n[ADR](docs/ADR-002-second.md)\n[Child](nested/README.md)\n',
  'nested/README.md': '# Child repository\n',
  'nested/package.json': '{"name":"child","files":["child.ts"]}',
  'nested/child.ts': 'export const child = 3;',
};

describe('architectural publication integration', () => {
  it('publishes mixed architecture with nested independence and preserves historical export, diff, currency and provenance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brain-architecture-'));
    const rootPath = join(directory, 'parent');
    const catalogue = await createDuckDbCatalogue(
      join(directory, 'catalogue.duckdb'),
      migrations,
    );
    try {
      await mkdir(join(rootPath, '.git'), { recursive: true });
      await mkdir(join(rootPath, 'nested', '.git'), { recursive: true });
      for (const [path, content] of Object.entries(files)) {
        await mkdir(join(rootPath, path, '..'), { recursive: true });
        await writeFile(join(rootPath, path), content);
      }
      await catalogue.registerConfiguration(
        [
          {
            configId: 'source',
            name: 'Source',
            rootPaths: [rootPath],
            excludeDirs: ['.git'],
            includeExtensions: ['.md', '.json', '.ts'],
            maxFileSizeBytes: 1024 * 1024,
          },
        ],
        [
          {
            configId: 'workspace',
            name: 'Workspace',
            sourceConfigIds: ['source'],
            include: ['**'],
            exclude: [],
          },
        ],
      );
      const source = (await catalogue.listSourcesForDiscovery({ limit: 10 }))
        .items[0];
      if (!source) throw new Error('Fixture source missing');
      const scan = async () => {
        const inventory = await new FilesystemSourceScanner().scan(source);
        return catalogue.persistScan(
          source.sourceId,
          inventory.repositories,
          inventory.documents,
          inventory.discoveredAt,
          randomUUID(),
          1,
        );
      };
      const inventory = await scan();
      const process = async (document: Document, legacy = false) => {
        const content = await readFile(
          join(rootPath, document.path.split('/').slice(1).join('/')),
          'utf8',
        );
        const processed = processDocument(document.filename, content);
        const now = new Date().toISOString();
        const event: Extract<
          DiscoveryEvent,
          { eventType: 'DocumentProcessingSubmitted' }
        > = {
          eventId: randomUUID(),
          eventType: 'DocumentProcessingSubmitted',
          eventVersion: 1,
          producer: 'workspace-brain-knowledge-worker',
          occurredAt: now,
          correlationId: randomUUID(),
          idempotencyKey: randomUUID(),
          partitionKey: document.sourceId,
          payload: {
            candidate: {
              documentId: document.id,
              sourceId: document.sourceId,
              path: document.path,
              contentFingerprint: createHash('sha256')
                .update(content)
                .digest('hex'),
              processedAt: now,
              durationMilliseconds: 1,
              ...processed,
              processorVersion: legacy ? 1 : processed.processorVersion,
            },
          },
        };
        const result = await catalogue.applyDocumentProcessing(event);
        const inputs = await catalogue.listKnowledgeInputEvidence(
          result.documentVersion.id,
        );
        await catalogue.applyKnowledgeCandidates({
          eventId: randomUUID(),
          eventType: 'KnowledgeCandidatesSubmitted',
          eventVersion: 1,
          producer: 'workspace-brain-knowledge-worker',
          occurredAt: now,
          correlationId: randomUUID(),
          idempotencyKey: randomUUID(),
          partitionKey: document.sourceId,
          payload: {
            sourceId: document.sourceId,
            documentId: document.id,
            documentVersionId: result.documentVersion.id,
            ...extractKnowledgeCandidates(inputs),
          },
        });
        return inputs;
      };
      const manifest = inventory.documents.find(
        (document) =>
          document.filename === 'package.json' &&
          !document.path.includes('/nested/'),
      );
      if (!manifest) throw new Error('Fixture manifest missing');
      await process(manifest, true);
      const model = (await catalogue.listKnowledgeModels({ limit: 10 }))
        .items[0];
      if (!model) throw new Error('Fixture model missing');
      const historic = await catalogue.getLatestKnowledgePublication(model.id);
      if (!historic) throw new Error('Historic publication missing');
      expect(historic.schemaVersion).toBe(1);
      const historicPackage = await catalogue.getKnowledgePublicationExport(
        historic.id,
      );
      if (!historicPackage) throw new Error('Historic package missing');
      const historicBytes =
        serializeKnowledgePublicationPackage(historicPackage);
      for (const document of [...inventory.documents].sort((a, b) =>
        a.path < b.path ? -1 : 1,
      ))
        await process(document);
      const publication = await catalogue.getLatestKnowledgePublication(
        model.id,
      );
      if (!publication) throw new Error('Architecture publication missing');
      expect(publication.schemaVersion).toBe(2);
      const snapshot = await catalogue.getPublicationSnapshot(publication.id);
      if (!snapshot) throw new Error('Architecture snapshot missing');
      expect(
        new Set(snapshot.entities.map((item) => item.entity.type)),
      ).toEqual(
        new Set([
          'repository',
          'package',
          'module',
          'api',
          'operation',
          'architectural-decision',
          'document',
        ]),
      );
      expect(
        new Set(snapshot.relationships.map((item) => item.relationship.type)),
      ).toEqual(new Set(['DEPENDS_ON', 'CONTAINS', 'EXPOSES', 'REFERENCES']));
      for (const object of [
        ...snapshot.entities.map((item) => item.entity),
        ...snapshot.relationships.map((item) => item.relationship),
      ]) {
        expect(object.provenance.length).toBeGreaterThan(0);
        expect(object.provenance.map((item) => item.evidenceId).sort()).toEqual(
          [...object.sourceEvidenceIds].sort(),
        );
      }
      const entities = new Map(
        snapshot.entities.map((item) => [item.entity.id, item.entity]),
      );
      const containment = snapshot.relationships.filter(
        (item) => item.relationship.type === 'CONTAINS',
      );
      expect(
        containment.some(
          (item) =>
            entities.get(item.relationship.sourceEntityId)?.name === 'parent' &&
            entities.get(item.relationship.targetEntityId)?.name ===
              'nested/child',
        ),
      ).toBe(false);
      await catalogue.rebuildSearchProjections({
        mode: 'missing',
        correlationId: 'architecture-test',
      });
      expect(
        (
          await catalogue.searchProjectedEntities({
            publicationId: publication.id,
            type: 'operation',
            limit: 100,
          })
        ).items,
      ).toHaveLength(1);
      const server = createApiServer(catalogue);
      try {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/search/entities?publicationId=${publication.id}&type=repository`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().items).toHaveLength(2);
      } finally {
        await server.close();
      }
      for (const entity of snapshot.entities) {
        const support = await catalogue.getPublishedEntityProvenance(
          publication.id,
          entity.entity.id,
        );
        expect(support?.items.length).toBe(entity.entity.provenance.length);
      }
      const currencyInputs = await catalogue.getPublicationCurrencyInputs(
        publication.id,
      );
      if (!currencyInputs) throw new Error('Currency inputs missing');
      const currency = classifyPublicationCurrency(currencyInputs);
      expect(
        currency.summary.staleEntities + currency.summary.unknownEntities,
      ).toBe(0);
      const diffService = createPublicationDiffService({
        snapshots: catalogue,
        store: catalogue,
      });
      const diff = await diffService.compare(historic.id, publication.id);
      if (diff.status !== 'found')
        throw new Error('Expected publication comparison');
      expect(diff.diff.summary.entitiesAdded).toBeGreaterThan(0);
      expect(diff).toEqual(
        await diffService.compare(historic.id, publication.id),
      );
      const oldPackage = await catalogue.getKnowledgePublicationExport(
        historic.id,
      );
      if (!oldPackage) throw new Error('Historic export disappeared');
      expect(serializeKnowledgePublicationPackage(oldPackage)).toBe(
        historicBytes,
      );

      const beforePackage = await catalogue.getKnowledgePublicationExport(
        publication.id,
      );
      if (!beforePackage) throw new Error('Export missing');
      const beforeBytes = serializeKnowledgePublicationPackage(beforePackage);
      const apiDocument = inventory.documents.find(
        (document) => document.filename === 'openapi.json',
      );
      if (!apiDocument) throw new Error('OpenAPI fixture missing');
      await writeFile(
        join(rootPath, 'openapi.json'),
        files['openapi.json']!.replace('"version":"1"', '"version":"2"'),
      );
      const modifiedInventory = await scan();
      const modifiedApi = modifiedInventory.documents.find(
        (document) => document.id === apiDocument.id,
      );
      if (!modifiedApi)
        throw new Error('Modified OpenAPI document disappeared');
      await process(modifiedApi);
      const modifiedPublication = await catalogue.getLatestKnowledgePublication(
        model.id,
      );
      if (!modifiedPublication) throw new Error('Modified publication missing');
      const changed = await diffService.compare(
        publication.id,
        modifiedPublication.id,
      );
      if (changed.status !== 'found')
        throw new Error('Modified comparison missing');
      expect(changed.diff.summary.entitiesModified).toBeGreaterThan(0);
      expect(changed.diff.summary.entitiesAdded).toBe(0);
      const staleInputs = await catalogue.getPublicationCurrencyInputs(
        publication.id,
      );
      if (!staleInputs) throw new Error('Historical currency missing');
      expect(
        classifyPublicationCurrency(staleInputs).summary.staleEntities,
      ).toBeGreaterThan(0);
      const oldInputs = await process(manifest);
      // A boundary-only change must not rewrite the accepted extraction context.
      await rm(join(rootPath, 'nested', '.git'), { recursive: true });
      await scan();
      const afterInputs = await process(manifest);
      expect(afterInputs[0]?.extractionContext).toEqual(
        oldInputs[0]?.extractionContext,
      );
      const afterPackage = await catalogue.getKnowledgePublicationExport(
        publication.id,
      );
      if (!afterPackage)
        throw new Error('Historic architecture package disappeared');
      expect(serializeKnowledgePublicationPackage(afterPackage)).toBe(
        beforeBytes,
      );
      const candidate = extractKnowledgeCandidates(oldInputs);
      const repository = candidate.entities.find(
        (entity) => entity.type === 'repository',
      );
      if (!repository) throw new Error('Repository candidate missing');
      await expect(
        catalogue.applyKnowledgeCandidates({
          eventId: randomUUID(),
          eventType: 'KnowledgeCandidatesSubmitted',
          eventVersion: 1,
          producer: 'workspace-brain-knowledge-worker',
          occurredAt: new Date().toISOString(),
          correlationId: 'forged-boundary',
          idempotencyKey: randomUUID(),
          partitionKey: manifest.sourceId,
          payload: {
            sourceId: manifest.sourceId,
            documentId: manifest.id,
            documentVersionId: oldInputs[0]!.documentVersion.id,
            entities: [
              {
                ...repository,
                provenance: repository.provenance.map((item) => ({
                  ...item,
                  repositoryBoundary: {
                    id: item.repositoryBoundary?.id ?? manifest.id,
                    path: 'wrong',
                    fingerprint: '0'.repeat(64),
                  },
                })),
              },
            ],
            relationships: [],
          },
        }),
      ).rejects.toThrow('owning Git boundary');
    } finally {
      await catalogue.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it('migrates populated version-1 tables without changing authoritative rows', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      for (const file of [
        '001-schema-migrations.sql',
        '002-sources.sql',
        '003-workspaces.sql',
        '004-discovery.sql',
        '007-document-evidence.sql',
        '008-knowledge-models.sql',
        '009-knowledge-reconciliation.sql',
        '010-relationship-version-storage.sql',
      ]) {
        await connection.run(await readFile(join(migrations, file), 'utf8'));
      }
      await connection.run(
        "INSERT INTO knowledge_models VALUES ('model', 'workspace', 'old', 1, 1, '2026-10-08')",
      );
      await connection.run(
        "INSERT INTO knowledge_entities VALUES ('entity', 'model', 'key', 'package', 'old', '[]', '[]', 'observed', 'version', '2026-10-08', '2026-10-08')",
      );
      await connection.run(
        "INSERT INTO entity_versions VALUES ('version', 'entity', 1, '{\"historic\":true}', '2026-10-08')",
      );
      await connection.run(
        "INSERT INTO knowledge_publications VALUES ('publication', 'model', 1, 1, 'published', 'hash', '[\"version\"]', '[]', '2026-10-08')",
      );
      const tables = [
        'knowledge_models',
        'knowledge_entities',
        'entity_versions',
        'relationship_versions',
        'knowledge_publications',
      ];
      const before = await Promise.all(
        tables.map(async (table) =>
          (
            await connection.runAndReadAll(`SELECT * FROM ${table}`)
          ).getRowObjectsJson(),
        ),
      );
      await connection.run(
        await readFile(
          join(migrations, '016-architectural-knowledge-schema.sql'),
          'utf8',
        ),
      );
      const after = await Promise.all(
        tables.map(async (table) =>
          (
            await connection.runAndReadAll(`SELECT * FROM ${table}`)
          ).getRowObjectsJson(),
        ),
      );
      expect(after).toEqual(before);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });
});
