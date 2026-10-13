import assert from 'node:assert/strict';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const agentsRoot = process.argv[2];
if (agentsRoot === undefined) {
  throw new Error(
    'Supply the HMRC agents directory: pnpm validate:hmrc-scala-play /path/to/hmrc/agents',
  );
}

const services = [
  'agent-client-relationships',
  'agent-access-control',
  'agent-services-account',
  'agent-subscription',
  'agent-registration',
  'agent-authorisation-api',
];
const roots = await Promise.all(
  services.map(async (service) => {
    const root = resolve(agentsRoot, service);
    if (!(await stat(root)).isDirectory()) {
      throw new Error(`Expected HMRC service directory: ${root}`);
    }
    return root;
  }),
);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const validation = spawnSync(
  process.execPath,
  ['scripts/validate-architecture.mjs', ...roots],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
if (validation.error) throw validation.error;
if (validation.status !== 0) {
  throw new Error(
    `HMRC temporary-catalogue validation failed with exit status ${validation.status}`,
  );
}

const report = JSON.parse(validation.stdout);
const requiredProcessors = ['hocon', 'play-routes', 'scala-source'];
const requiredLocators = [
  'hocon-key',
  'play-route',
  'scala-call-site',
  'scala-symbol',
];
for (const processor of requiredProcessors) {
  assert.ok(
    report.processors[processor] > 0,
    `No ${processor} documents were processed`,
  );
}
for (const locator of requiredLocators) {
  assert.ok(
    report.locators[locator] > 0,
    `No ${locator} evidence was produced`,
  );
}
assert.equal(report.validation.sourceMutation, false);
assert.equal(report.validation.completeProvenance, true);
assert.ok(report.hmrcCandidates.totals.routes > 0);
assert.ok(report.hmrcCandidates.totals.resolvedRoutes > 0);
assert.ok(report.hmrcCandidates.totals.staticPaths > 0);
assert.ok(report.publication.hmrcScalaPlay.entities > 0);
assert.ok(report.publication.hmrcScalaPlay.operations > 0);
assert.ok(report.publication.hmrcScalaPlay.semanticRelationships.CALLS > 0);
assert.ok(
  report.publication.hmrcScalaPlay.semanticRelationships.IMPLEMENTED_BY > 0,
);
assert.ok(report.publication.hmrcScalaPlay.downstreamSystems > 0);

console.log(
  JSON.stringify(
    {
      serviceCount: roots.length,
      services,
      documentCount: report.documents,
      processors: report.processors,
      locators: report.locators,
      hmrcCandidates: report.hmrcCandidates,
      temporaryCatalogue: true,
      readOnlySourceRepositories: true,
      sourceMutation: false,
      publicationAndHistoricalCompatibilityChecks:
        report.validation.deterministicExport &&
        report.validation.completeProvenance,
    },
    null,
    2,
  ),
);
