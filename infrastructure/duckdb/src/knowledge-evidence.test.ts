import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createSourceId,
} from '@workspace-brain/domain';
import { describe, expect, it } from 'vitest';
import type { DuckDbConnection } from './index.js';
import { listKnowledgeInputEvidence } from './knowledge.js';

const versionId = createDocumentVersionId();
const row = {
  id: createEvidenceId(),
  document_version_id: versionId,
  evidence_key: 'scala:call:1',
  evidence_kind: 'structured-value',
  excerpt: 'http.get()',
  truncated: false,
  locator_json: JSON.stringify({
    kind: 'scala-call-site',
    packageName: 'controllers',
    enclosingSymbol: 'controllers.Example.get',
    targetText: 'http.get',
    methodName: 'get',
    receiver: 'http',
    callIndex: 1,
    lineStart: 3,
    lineEnd: 3,
  }),
  version_id: versionId,
  document_id: createDocumentId(),
  content_fingerprint: 'a'.repeat(64),
  processed_at: '2026-10-19T00:00:00.000Z',
  processor_id: 'scala-source',
  processor_version: '2',
  extraction_rule_id: 'scala-source',
  extraction_rule_version: '2',
  evidence_count: '2',
  source_id: createSourceId(),
  path: 'root/agent/app/controllers/Example.scala',
  filename: 'Example.scala',
};

function connectionFor(rows: Record<string, unknown>[]): DuckDbConnection {
  return {
    runAndReadAll: async (sql: string) => ({
      getRowObjectsJson: () =>
        sql.includes('FROM extracted_evidence') ? rows : [],
    }),
  } as unknown as DuckDbConnection;
}

describe('knowledge evidence row validation', () => {
  it('preserves row order, locator, numeric coercion and full evidence lineage on repeated loads', async () => {
    const second = {
      ...row,
      id: createEvidenceId(),
      evidence_key: 'scala:call:2',
    };
    const connection = connectionFor([row, second]);
    const loaded = await listKnowledgeInputEvidence(connection, versionId);
    expect(loaded.map((input) => input.evidence.id)).toEqual([
      row.id,
      second.id,
    ]);
    expect(loaded[0]).toEqual({
      evidence: {
        id: row.id,
        documentVersionId: versionId,
        key: row.evidence_key,
        kind: row.evidence_kind,
        excerpt: row.excerpt,
        truncated: false,
        locator: JSON.parse(row.locator_json),
      },
      documentVersion: {
        id: versionId,
        documentId: row.document_id,
        contentHash: row.content_fingerprint,
        hashAlgorithm: 'sha256',
        discoveredAt: row.processed_at,
        processorId: row.processor_id,
        processorVersion: 2,
        extractionRuleId: row.extraction_rule_id,
        extractionRuleVersion: 2,
        evidenceCount: 2,
      },
      document: {
        id: row.document_id,
        sourceId: row.source_id,
        path: row.path,
        filename: row.filename,
        fingerprint: row.content_fingerprint,
      },
      provenance: {
        documentPath: row.path,
        contentFingerprint: row.content_fingerprint,
        processorId: row.processor_id,
        processorVersion: 2,
        extractionRuleId: row.extraction_rule_id,
        extractionRuleVersion: 2,
      },
    });
    expect(await listKnowledgeInputEvidence(connection, versionId)).toEqual(
      loaded,
    );
  });

  it.each([
    { content_fingerprint: 'invalid' },
    { processor_version: 'not-a-number' },
    { id: 'invalid' },
    {
      locator_json: JSON.stringify({
        ...JSON.parse(row.locator_json),
        callIndex: 0,
      }),
    },
  ])(
    'rejects a malformed later row after a valid load: %j',
    async (invalid) => {
      const rows: Record<string, unknown>[] = [{ ...row }];
      const connection = connectionFor(rows);
      await expect(
        listKnowledgeInputEvidence(connection, versionId),
      ).resolves.toHaveLength(1);
      rows.push({ ...row, ...invalid });
      await expect(
        listKnowledgeInputEvidence(connection, versionId),
      ).rejects.toThrow();
    },
  );
});
