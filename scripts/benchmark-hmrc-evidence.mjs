import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

// Isolate the production row loader from DuckDB I/O and graph publication.
const count = Number(process.argv[2] ?? 1000);
assert.ok(Number.isSafeInteger(count) && count > 0 && count <= 10_000);
if (process.argv[3] !== '--child') {
  const result = spawnSync(
    process.execPath,
    [process.argv[1], String(count), '--child'],
    {
      stdio: 'inherit',
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0);
} else {
  const { listKnowledgeInputEvidence } =
    await import('../infrastructure/duckdb/dist/knowledge.js');
  const id = '01K7ZZZZZZ0000000000000000';
  const rows = Array.from({ length: count }, (_, index) => ({
    id,
    document_version_id: id,
    evidence_key: `call-${index}`,
    evidence_kind: 'structured-value',
    excerpt: 'unknown.get()',
    truncated: false,
    locator_json: JSON.stringify({
      kind: 'scala-call-site',
      packageName: 'controllers',
      enclosingSymbol: 'controllers.Example.get',
      targetText: 'unknown.get',
      methodName: 'get',
      receiver: 'unknown',
      callIndex: index + 1,
      lineStart: index + 1,
      lineEnd: index + 1,
    }),
    version_id: id,
    document_id: id,
    content_fingerprint: 'a'.repeat(64),
    processed_at: '2026-10-19T00:00:00.000Z',
    processor_id: 'scala-source',
    processor_version: 2,
    extraction_rule_id: 'scala-source',
    extraction_rule_version: 2,
    evidence_count: count,
    source_id: id,
    path: 'root/agent/app/controllers/Example.scala',
    filename: 'Example.scala',
  }));
  const connection = {
    runAndReadAll: async (sql) => ({
      getRowObjectsJson: () =>
        sql.includes('FROM extracted_evidence') ? rows : [],
    }),
  };
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  const inputs = await listKnowledgeInputEvidence(connection, id);
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuStart);
  assert.equal(inputs.length, count);
  assert.equal(inputs.at(-1).evidence.locator.callIndex, count);
  console.log(
    JSON.stringify(
      {
        rows: count,
        elapsedMs,
        cpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 },
        maxRssMiB: process.resourceUsage().maxRSS / 1024,
      },
      null,
      2,
    ),
  );
}
