import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import console from 'node:console';

// A separate process enforces the deadline even when JavaScript is CPU-bound.
const size = Number(process.argv[2] ?? 8);
assert.ok(Number.isSafeInteger(size) && size > 0 && size <= 64);
if (process.argv[3] !== '--child') {
  const result = spawnSync(
    process.execPath,
    [process.argv[1], String(size), '--child'],
    {
      stdio: 'inherit',
      timeout: 120_000,
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Benchmark exited with ${result.status}`);
} else {
  const { createDuckDbCatalogue } =
    await import('../infrastructure/duckdb/dist/index.js');
  const { FilesystemSourceScanner } =
    await import('../infrastructure/filesystem/dist/index.js');
  const { processDocument } =
    await import('../packages/processing-core/dist/index.js');
  const { extractKnowledgeReport } =
    await import('../apps/knowledge-worker/dist/knowledge-extractors.js');
  const directory = await mkdtemp(join(tmpdir(), 'brain-hmrc-performance-'));
  const root = join(directory, 'agent');
  const times = {
    parse: 0,
    persistProcessing: 0,
    loadEvidence: 0,
    extract: 0,
    reconcile: 0,
  };
  const timed = async (stage, run) => {
    const start = performance.now();
    const result = await run();
    times[stage] += performance.now() - start;
    return result;
  };
  let catalogue;
  const session = new Session();
  session.connect();
  try {
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'conf'), { recursive: true });
    for (let index = 0; index < size; index++) {
      await writeFile(
        join(root, `app/controllers/Controller${index}.scala`),
        `package controllers
class Controller${index} {
  def get() = {
${Array.from({ length: 20 }, (_, call) => `    unknown.call${call}()`).join('\n')}
  }
}`,
      );
    }
    await writeFile(
      join(root, 'conf/app.routes'),
      Array.from(
        { length: size },
        (_, index) => `GET /route${index} controllers.Controller${index}.get()`,
      ).join('\n'),
    );
    catalogue = await createDuckDbCatalogue(
      join(directory, 'catalogue.duckdb'),
      resolve('infrastructure/duckdb/migrations'),
    );
    await catalogue.registerConfiguration(
      [
        {
          configId: 'performance',
          name: 'Performance',
          rootPaths: [root],
          excludeDirs: ['.git'],
          includeExtensions: ['.scala', '.routes'],
          maxFileSizeBytes: 1024 * 1024,
        },
      ],
      [
        {
          configId: 'performance',
          name: 'Performance',
          sourceConfigIds: ['performance'],
          include: ['**'],
          exclude: [],
        },
      ],
    );
    const source = (await catalogue.listSourcesForDiscovery({ limit: 10 }))
      .items[0];
    const scan = await new FilesystemSourceScanner().scan(source);
    const inventory = await catalogue.persistScan(
      source.sourceId,
      scan.repositories,
      scan.documents,
      scan.discoveredAt,
      randomUUID(),
      1,
    );
    let evidenceCount = 0;
    let cumulativeActiveEvidence = 0;
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    await session.post('Profiler.enable');
    await session.post('Profiler.start');
    for (const document of [...inventory.documents].sort((a, b) =>
      a.path.localeCompare(b.path),
    )) {
      const relative = document.path.split('/').slice(1).join('/');
      const content = await readFile(join(root, relative), 'utf8');
      const processed = await timed('parse', () =>
        processDocument(document.filename, content, relative),
      );
      evidenceCount += processed.evidence.length;
      cumulativeActiveEvidence += evidenceCount;
      const now = new Date().toISOString();
      const envelope = {
        eventId: randomUUID(),
        eventVersion: 1,
        producer: 'workspace-brain-knowledge-worker',
        occurredAt: now,
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        partitionKey: source.sourceId,
      };
      const result = await timed('persistProcessing', () =>
        catalogue.applyDocumentProcessing({
          ...envelope,
          eventType: 'DocumentProcessingSubmitted',
          payload: {
            candidate: {
              documentId: document.id,
              sourceId: source.sourceId,
              path: document.path,
              contentFingerprint: document.fingerprint,
              processedAt: now,
              durationMilliseconds: 1,
              ...processed,
            },
          },
        }),
      );
      const inputs = await timed('loadEvidence', () =>
        catalogue.listKnowledgeInputEvidence(result.documentVersion.id),
      );
      const extraction = await timed('extract', () =>
        extractKnowledgeReport(inputs),
      );
      await timed('reconcile', () =>
        catalogue.applyKnowledgeCandidates({
          ...envelope,
          eventId: randomUUID(),
          eventType: 'KnowledgeCandidatesSubmitted',
          payload: {
            sourceId: source.sourceId,
            documentId: document.id,
            documentVersionId: result.documentVersion.id,
            ...extraction.candidates,
          },
        }),
      );
    }
    const { profile } = await session.post('Profiler.stop');
    const elapsedMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    const samples = new Map();
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    for (let index = 0; index < profile.samples.length; index++) {
      const frame = nodes.get(profile.samples[index]).callFrame;
      const key = `${frame.functionName || '(anonymous)'} ${frame.url.replace(/^.*workspace-brain\//, '')}:${frame.lineNumber + 1}`;
      samples.set(key, (samples.get(key) ?? 0) + profile.timeDeltas[index]);
    }
    const model = (await catalogue.listKnowledgeModels({ limit: 10 })).items[0];
    const publication = await catalogue.getLatestKnowledgePublication(model.id);
    const snapshot = await catalogue.getPublicationSnapshot(publication.id);
    console.log(
      JSON.stringify(
        {
          size,
          documents: inventory.documents.length,
          evidenceCount,
          cumulativeActiveEvidence,
          elapsedMs,
          cpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 },
          maxRssMiB: process.resourceUsage().maxRSS / 1024,
          timesMs: times,
          entities: snapshot.entities.length,
          relationships: snapshot.relationships.length,
          topCpuSamplesMs: [...samples]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([frame, us]) => ({ frame, ms: us / 1000 })),
        },
        null,
        2,
      ),
    );
  } finally {
    session.disconnect();
    await catalogue?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
