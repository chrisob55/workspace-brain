import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { createDuckDbCatalogue } from '../infrastructure/duckdb/dist/index.js';
import {
  FilesystemSourceScanner,
  readDocumentContentChunk,
} from '../infrastructure/filesystem/dist/index.js';
import { processDocument } from '../packages/processing-core/dist/index.js';
import { extractKnowledgeReport } from '../apps/knowledge-worker/dist/knowledge-extractors.js';
import { serializeKnowledgePublicationPackage } from '../packages/domain-publication/dist/index.js';
import { classifyPublicationCurrency } from '../packages/domain-currency/dist/index.js';
import { createPublicationDiffService } from '../services/publication-diff-service/dist/index.js';

const roots = process.argv.slice(2).map((path) => resolve(path));
if (roots.length === 0)
  throw new Error(
    'Supply read-only source roots: node scripts/validate-architecture.mjs /path/to/workspace-brain /path/to/ai-os',
  );
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(`${tmpdir()}/brain-architecture-validation-`);
const catalogue = await createDuckDbCatalogue(
  `${directory}/catalogue.duckdb`,
  `${repositoryRoot}/infrastructure/duckdb/migrations`,
);
const countBy = (items, field) => {
  const counts = {};
  for (const item of items)
    counts[item[field]] = (counts[item[field]] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
};

try {
  await catalogue.registerConfiguration(
    [
      {
        configId: 'architectural-validation',
        name: 'Architectural Validation',
        rootPaths: roots,
        excludeDirs: [
          '.git',
          'node_modules',
          'dist',
          'build',
          'coverage',
          '.turbo',
          'sources',
        ],
        includeExtensions: [
          '.md',
          '.markdown',
          '.txt',
          '.yaml',
          '.yml',
          '.json',
          '.ts',
          '.dockerfile',
        ],
        maxFileSizeBytes: 50 * 1024 * 1024,
      },
    ],
    [
      {
        configId: 'architectural-validation',
        name: 'Architectural Validation',
        sourceConfigIds: ['architectural-validation'],
        include: ['**'],
        exclude: [],
      },
    ],
  );
  const source = (await catalogue.listSourcesForDiscovery({ limit: 10 }))
    .items[0];
  assert.ok(source);
  const scan = await new FilesystemSourceScanner().scan(source);
  const inventory = await catalogue.persistScan(
    source.sourceId,
    scan.repositories,
    scan.documents,
    scan.discoveredAt,
    randomUUID(),
    1,
  );
  const contributions = new Map();
  const diagnostics = [];
  const documentOwners = new Map();
  const owner = (path) =>
    inventory.repositories
      .filter((repository) => path.startsWith(repository.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
  const candidateCounts = new Map();

  for (const document of [...inventory.documents].sort((a, b) =>
    a.path < b.path ? -1 : 1,
  )) {
    const chunks = [];
    let offset = 0;
    while (true) {
      const chunk = await readDocumentContentChunk(
        source,
        document.path,
        offset,
        256 * 1024,
      );
      const bytes = Buffer.from(chunk.contentBase64, 'base64');
      chunks.push(bytes);
      offset += bytes.length;
      if (chunk.done) break;
      assert.ok(bytes.length > 0);
    }
    const bytes = Buffer.concat(chunks);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      document.fingerprint,
      'Source changed during validation',
    );
    const processed = processDocument(
      document.filename,
      bytes.toString('utf8'),
    );
    const now = new Date().toISOString();
    const result = await catalogue
      .applyDocumentProcessing({
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
            contentFingerprint: document.fingerprint,
            processedAt: now,
            durationMilliseconds: 1,
            ...processed,
          },
        },
      })
      .catch((error) => {
        throw new Error(`Document processing failed: ${document.path}`, {
          cause: error,
        });
      });
    const inputs = await catalogue.listKnowledgeInputEvidence(
      result.documentVersion.id,
    );
    const extraction = extractKnowledgeReport(inputs);
    assert.deepEqual(
      extraction.candidates,
      extractKnowledgeReport(inputs).candidates,
      'Extractor replay changed',
    );
    for (const contribution of extraction.contributions) {
      const previous = contributions.get(contribution.extractorId) ?? {
        documents: 0,
        entities: 0,
        relationships: 0,
      };
      contributions.set(contribution.extractorId, {
        documents: previous.documents + 1,
        entities: previous.entities + contribution.entities,
        relationships: previous.relationships + contribution.relationships,
      });
    }
    diagnostics.push(...extraction.diagnostics);
    const repository = owner(document.path);
    documentOwners.set(document.id, repository?.id);
    if (repository) {
      const previous = candidateCounts.get(repository.id) ?? {
        documents: 0,
        entities: 0,
        relationships: 0,
      };
      candidateCounts.set(repository.id, {
        documents: previous.documents + 1,
        entities: previous.entities + extraction.candidates.entities.length,
        relationships:
          previous.relationships + extraction.candidates.relationships.length,
      });
    }
    const payload = {
      sourceId: document.sourceId,
      documentId: document.id,
      documentVersionId: result.documentVersion.id,
      ...extraction.candidates,
    };
    const event = {
      eventId: randomUUID(),
      eventType: 'KnowledgeCandidatesSubmitted',
      eventVersion: 1,
      producer: 'workspace-brain-knowledge-worker',
      occurredAt: now,
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      partitionKey: document.sourceId,
      payload,
    };
    assert.ok(
      Buffer.byteLength(JSON.stringify(event), 'utf8') <= 900_000,
      `Knowledge event exceeds worker bound: ${document.path}`,
    );
    await catalogue.applyKnowledgeCandidates(event);
  }
  const model = (await catalogue.listKnowledgeModels({ limit: 10 })).items[0];
  assert.ok(model);
  const publication = await catalogue.getLatestKnowledgePublication(model.id);
  assert.ok(publication);
  const snapshot = await catalogue.getPublicationSnapshot(publication.id);
  assert.ok(snapshot);
  const packageOne = await catalogue.getKnowledgePublicationExport(
    publication.id,
  );
  const packageTwo = await catalogue.getKnowledgePublicationExport(
    publication.id,
  );
  assert.ok(packageOne && packageTwo);
  assert.equal(
    serializeKnowledgePublicationPackage(packageOne),
    serializeKnowledgePublicationPackage(packageTwo),
  );
  const currencyInputs = await catalogue.getPublicationCurrencyInputs(
    publication.id,
  );
  assert.ok(currencyInputs);
  const currency = classifyPublicationCurrency(currencyInputs);
  assert.deepEqual(currency, classifyPublicationCurrency(currencyInputs));
  await catalogue.rebuildSearchProjections({
    mode: 'missing',
    correlationId: randomUUID(),
  });
  const operations = snapshot.entities.filter(
    (row) => row.entity.type === 'operation',
  );
  const operationSearch = await catalogue.searchProjectedEntities({
    publicationId: publication.id,
    type: 'operation',
    limit: 100,
  });
  assert.equal(operationSearch.items.length, Math.min(operations.length, 100));
  for (const operation of operations) {
    const lexical = await catalogue.searchProjectedEntities({
      publicationId: publication.id,
      type: 'operation',
      text: { query: operation.entity.name, field: 'name', match: 'exact' },
      limit: 100,
    });
    assert.ok(
      lexical.items.some((item) => item.entityId === operation.entity.id),
      'Operation is missing from exact-name lexical search',
    );
    const support = await catalogue.getPublishedEntityProvenance(
      publication.id,
      operation.entity.id,
    );
    assert.equal(support?.items.length, operation.entity.provenance.length);
    const hop = await catalogue.listPublishedEntityRelationships({
      publicationId: publication.id,
      entityId: operation.entity.id,
      direction: 'incoming',
      relationshipType: 'EXPOSES',
      limit: 100,
    });
    assert.ok(
      hop.items.length > 0,
      'Operation has no publication-scoped EXPOSES link',
    );
  }
  const comparisons = createPublicationDiffService({
    snapshots: catalogue,
    store: catalogue,
  });
  const diff = await comparisons.compare(publication.id, publication.id);
  assert.equal(diff.status, 'found');
  assert.equal(
    diff.diff.summary.entitiesAdded +
      diff.diff.summary.entitiesRemoved +
      diff.diff.summary.entitiesModified,
    0,
  );
  assert.deepEqual(
    diff,
    await comparisons.compare(publication.id, publication.id),
  );
  for (const item of [
    ...snapshot.entities.map((row) => row.entity),
    ...snapshot.relationships.map((row) => row.relationship),
  ]) {
    assert.ok(item.provenance.length > 0);
    assert.deepEqual(
      [...item.sourceEvidenceIds].sort(),
      item.provenance.map((support) => support.evidenceId).sort(),
    );
  }
  const repositoryResults = inventory.repositories.map((repository) => {
    const entities = snapshot.entities
      .map((row) => row.entity)
      .filter((entity) =>
        entity.provenance.some(
          (item) => documentOwners.get(item.documentId) === repository.id,
        ),
      );
    const relationships = snapshot.relationships
      .map((row) => row.relationship)
      .filter((relationship) =>
        relationship.provenance.some(
          (item) => documentOwners.get(item.documentId) === repository.id,
        ),
      );
    const root = source.roots.find(
      (root) => repository.path.split('/')[0] === root.id,
    );
    assert.ok(root);
    return {
      root: root.absolutePath,
      path: repository.path.split('/').slice(1).join('/') || '.',
      candidateContributions: candidateCounts.get(repository.id) ?? {
        documents: 0,
        entities: 0,
        relationships: 0,
      },
      entities: countBy(entities, 'type'),
      relationships: countBy(relationships, 'type'),
    };
  });
  const examples = Object.fromEntries(
    ['CONTAINS', 'EXPOSES', 'REFERENCES', 'DEPENDS_ON'].map((type) => {
      const object = snapshot.relationships.find(
        (row) => row.relationship.type === type,
      )?.relationship;
      return [
        type,
        object
          ? {
              sourceEvidenceIds: object.sourceEvidenceIds,
              provenance: object.provenance,
            }
          : null,
      ];
    }),
  );
  console.log(
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        sourceRoots: roots,
        documents: inventory.documents.length,
        publication: {
          id: publication.id,
          version: publication.version,
          schemaVersion: publication.schemaVersion,
          contentHash: publication.contentHash,
        },
        entityCount: snapshot.entities.length,
        relationshipCount: snapshot.relationships.length,
        entities: countBy(
          snapshot.entities.map((row) => row.entity),
          'type',
        ),
        relationships: countBy(
          snapshot.relationships.map((row) => row.relationship),
          'type',
        ),
        repositories: repositoryResults,
        extractorContributions: Object.fromEntries(
          [...contributions].sort(([a], [b]) => (a < b ? -1 : 1)),
        ),
        unresolvedReferences: diagnostics.filter(
          (item) => item.disposition === 'unresolved',
        ),
        rejectedCandidates: diagnostics.filter(
          (item) => item.disposition === 'rejected',
        ),
        provenanceExamples: examples,
        operations: operations.map(({ entity }) => ({
          name: entity.name,
          provenance: entity.provenance.filter(
            (item) =>
              (item.locator.kind === 'json-pointer' &&
                item.locator.pointer.endsWith('/operationId')) ||
              (item.locator.kind === 'yaml-lines' &&
                item.facts?.operationId === entity.name),
          ),
        })),
        currency: currency.summary,
        validation: {
          deterministicExtraction: true,
          deterministicExport: true,
          deterministicDiff: true,
          deterministicCurrency: true,
          completeProvenance: true,
          lexicalSearch: true,
          oneHopExploration: true,
          sourceMutation: false,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await catalogue.close();
  await rm(directory, { recursive: true, force: true });
}
