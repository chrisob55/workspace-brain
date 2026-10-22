import { describe, expect, it, vi } from 'vitest';
import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import { snapshot } from '../../../packages/domain-publication/src/test-fixtures.js';
import type { DuckDbConnection } from './index.js';
import {
  getPublicationSnapshot,
  getKnowledgePublicationSummary,
  getPublishedEntity,
  getPublishedRelationship,
  getPublishedEntityProvenance,
  getPublishedRelationshipProvenance,
  listPublishedEntityRelationships,
} from './knowledge.js';

function fixture() {
  const { publication, entities, relationships } = structuredClone(snapshot);
  const support = entities[0]!.entity.provenance[0]!;
  const entityRows = entities.map(
    ({ entity, entityVersionId, versionNumber }) => ({
      id: entityVersionId,
      entity_id: entity.id,
      version_number: versionNumber,
      snapshot_json: JSON.stringify(entity),
    }),
  );
  const relationshipRows = relationships.map(
    ({ relationship, relationshipVersionId, versionNumber }) => ({
      id: relationshipVersionId,
      relationship_id: relationship.id,
      version_number: versionNumber,
      snapshot_json: JSON.stringify(relationship),
    }),
  );
  const evidenceRows = [
    {
      evidence_id: support.evidenceId,
      document_version_id: support.documentVersionId,
      document_id: support.documentId,
      source_id: support.sourceId,
      path: support.documentPath,
      content_fingerprint: support.contentFingerprint,
      processor_id: support.processorId,
      processor_version: support.processorVersion,
      extraction_rule_id: support.extractionRuleId,
      extraction_rule_version: support.extractionRuleVersion,
      locator_json: JSON.stringify(support.locator),
    },
  ];
  const query = vi.fn(async (sql: string) => ({
    getRowObjectsJson: () => {
      if (sql.includes('FROM knowledge_publications'))
        return [
          {
            id: publication.id,
            knowledge_model_id: publication.knowledgeModelId,
            version_number: publication.version,
            schema_version: publication.schemaVersion,
            status: publication.status,
            content_hash: publication.contentHash,
            entity_version_ids_json: JSON.stringify(
              publication.entityVersionIds,
            ),
            relationship_version_ids_json: JSON.stringify(
              publication.relationshipVersionIds,
            ),
            published_at: publication.publishedAt,
          },
        ];
      if (sql.includes('FROM entity_versions')) return entityRows;
      if (sql.includes('FROM relationship_versions')) return relationshipRows;
      if (sql.includes('FROM extracted_evidence')) return evidenceRows;
      throw new Error(`Unexpected query: ${sql}`);
    },
  }));
  return {
    publication,
    entities,
    relationships,
    entityRows,
    evidenceRows,
    query,
    connection: { runAndReadAll: query } as unknown as DuckDbConnection,
  };
}

const operations = {
  snapshot: (f: ReturnType<typeof fixture>) =>
    getPublicationSnapshot(f.connection, f.publication.id),
  summary: (f: ReturnType<typeof fixture>) =>
    getKnowledgePublicationSummary(f.connection, f.publication.id),
  entity: (f: ReturnType<typeof fixture>) =>
    getPublishedEntity(
      f.connection,
      f.publication.id,
      f.entities[0]!.entity.id,
    ),
  relationship: (f: ReturnType<typeof fixture>) =>
    getPublishedRelationship(
      f.connection,
      f.publication.id,
      f.relationships[0]!.relationship.id,
    ),
  entityProvenance: (f: ReturnType<typeof fixture>) =>
    getPublishedEntityProvenance(
      f.connection,
      f.publication.id,
      f.entities[0]!.entity.id,
    ),
  relationshipProvenance: (f: ReturnType<typeof fixture>) =>
    getPublishedRelationshipProvenance(
      f.connection,
      f.publication.id,
      f.relationships[0]!.relationship.id,
    ),
  traversal: (f: ReturnType<typeof fixture>) =>
    listPublishedEntityRelationships(f.connection, {
      publicationId: f.publication.id,
      entityId: f.entities[0]!.entity.id,
      direction: 'both',
      limit: 10,
    }),
};

describe('publication read integrity and hydration', () => {
  it.each(Object.entries(operations))(
    '%s loads each graph table once and revalidates subsequent calls',
    async (_name, read) => {
      const f = fixture();
      expect(await read(f)).toBeDefined();
      expect(
        f.query.mock.calls.map(([sql]) => sql.match(/FROM (\w+)/)?.[1]),
      ).toEqual([
        'knowledge_publications',
        'entity_versions',
        'relationship_versions',
        'extracted_evidence',
      ]);
      f.evidenceRows.splice(0);
      await expect(read(f)).rejects.toThrow(CatalogueIntegrityError);
    },
  );

  it.each(Object.entries(operations))(
    '%s rejects changed immutable snapshots',
    async (_name, read) => {
      const f = fixture();
      const row = f.entityRows[0]!;
      row.snapshot_json = JSON.stringify({
        ...f.entities[0]!.entity,
        name: 'tampered',
      });
      await expect(read(f)).rejects.toThrow(
        'content does not match its stored hash',
      );
    },
  );

  it('returns the complete validated graph, identities, counts and provenance unchanged', async () => {
    const f = fixture();
    const loaded = await getPublicationSnapshot(f.connection, f.publication.id);
    expect(loaded).toEqual({
      ...snapshot,
      entities: [...snapshot.entities].sort((a, b) =>
        a.entity.id.localeCompare(b.entity.id),
      ),
    });
    expect(await operations.summary(f)).toEqual({
      publication: snapshot.publication,
      entityCount: 2,
      relationshipCount: 1,
    });
    expect(await operations.entity(f)).toEqual(snapshot.entities[0]);
    expect(await operations.relationship(f)).toEqual(snapshot.relationships[0]);
    expect((await operations.entityProvenance(f))?.provenance).toEqual(
      snapshot.entities[0]!.entity.provenance,
    );
    expect((await operations.traversal(f)).items).toEqual([
      { ...snapshot.relationships[0], direction: 'outgoing' },
    ]);
  });
});
