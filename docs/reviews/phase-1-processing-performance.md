# Phase 1 — HMRC processing performance

Date: 19 October 2026

Baseline: `c7f8f05`

Branch: `codex/hmrc-processing-performance`

Outcome: corrected and verified a repeated schema-construction defect in the
publication evidence loader. The original six-service acceptance remains
unverified because the source corpus is unavailable on this machine.

## 1. Observed symptoms and existing evidence

The [parser implementation report](../implementation/hmrc-scala-play-parser-pack-mvp-implementation.md)
records a combined six-service run stopped after approximately 32 minutes of
CPU-bound processing. Its earlier candidate-only baseline contains 1,411
documents, including 1,020 Scala documents, 21,948 call-site evidence records,
16,566 symbol records, 188 route records and 689 HOCON records. A separate
181-document `agent-subscription` publication run passed. These historical
measurements were not repeated during Phase 1.

The relevant entry points are
[`validate-hmrc-scala-play.mjs`](../../scripts/validate-hmrc-scala-play.mjs) and
[`validate-architecture.mjs`](../../scripts/validate-architecture.mjs).
The HMRC wrapper calls the architecture validator synchronously. That validator:

1. Scans sources into a temporary catalogue.
2. Parses and persists each document, then loads its evidence.
3. Extracts document candidates twice to check replay.
4. Submits each document's candidates, triggering normal model reconciliation.
5. Analyzes repository candidates twice, then checks publication/export, search,
   API and MCP behavior.

Reconciliation loads all active document contributions and production parser
evidence, extracts repository graph candidates, resolves Journey references,
and updates/publishes the model. It runs after each newly activated contribution.
The historical report does not identify the exact blocked function or document.

Existing instrumentation provides aggregate document/evidence/candidate counts,
provenance assertions and a few progress messages. It does not provide stage
elapsed time, CPU usage or memory measurements. The validation script writes
`durationMilliseconds: 1`; that is a placeholder, not a measurement. Neither
existing validation wrapper supplies a subprocess timeout.

The source directories documented under `/Users/chrisobrien/workspace/hmrc/agents`
and the corresponding `/Users/chris/workspace/hmrc/agents` are absent. Existing
synthetic HMRC publication fixtures are available and exercise the same parser,
evidence-loader and reconciliation path. No source repositories or live
catalogues were modified.

## 2. Ranked hypotheses and investigation

| Rank | Hypothesis and initial evidence                                                                                                                                                         | Result                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Reconciliation repeats expensive work over accumulated evidence after every document; this is the principal difference between candidate discovery and combined publication validation. | Confirmed a specific defect: the same row-validation schema was constructed and compiled for every evidence row read, including every reconciliation reload. Corrected and verified. |
| 2    | Repository HMRC/Journey candidate extraction becomes expensive as evidence and graph size grow; it runs within every reconciliation.                                                    | Not independently investigated after hypothesis 1 produced a verified correction. No claim that this work is cost-free.                                                              |
| 3    | Scala document parsing itself is slow; it runs for every Scala document.                                                                                                                | Stage measurements show only 4–8 ms total parsing in the small baseline fixtures. Not the bottleneck there; no full-corpus conclusion.                                               |

Two temporary-catalogue scenarios used 8 and 16 independent Scala controllers,
20 unresolved calls per controller, and one route per controller. They exercise
production parsing, processing persistence, evidence loading, document extraction,
reconciliation and graph publication. Routes are processed after controllers,
matching the validator's path ordering. They do not reproduce the entire
real-service dependency graph or the API/MCP acceptance stages.

Node's built-in Inspector CPU sampler was sufficient; no profiling dependency
was added. Baseline samples prominently included Zod schema initialization,
parser generation/compilation and garbage collection. Most wall-time samples
were idle while asynchronous native work ran; these small cases did not
reproduce the sustained CPU-bound character of the historical full run.

An additional isolated scenario called the production `listKnowledgeInputEvidence`
loader with 1,000 and 2,000 valid Scala-call rows supplied by an in-memory query
stub. This isolates row hydration/validation from SQL, graph extraction and
publication. It is not a DuckDB throughput measurement. The fixtures deliberately
reuse fixed identity values; row count, locators and coercions are validated.

Each of the four scenarios ran once before and once after the correction: two
substantial attempts per scenario. Separate parent processes enforce 120-second
pipeline deadlines and 30-second isolated-loader deadlines, even if child
JavaScript blocks. No full-corpus benchmark was attempted.

## 3. Confirmed defect and its limits

`parseKnowledgeInputEvidence` in
[`knowledge.ts`](../../infrastructure/duckdb/src/knowledge.ts) constructed a new
Zod object schema, including its child schemas, on every invocation. Parsing
then triggered compilation for that fresh schema. Inspection of the installed
Zod implementation confirms that its compiled `fastpass` is held per schema
instance, explaining the construction/compilation frames in the CPU samples.
Both document evidence loading
and `loadActiveParserEvidence` use this function.

This turns fixed validation setup into per-row work. Reconciliation amplifies it:
with growing active evidence `E_i`, setup is repeated over approximately
`sum(E_i)` rows across document activations, rather than once per process.
The small pipeline fixtures expose 1,020 and 3,512 cumulative active evidence
rows respectively, plus ordinary document evidence reads. These are fixture
operation counts, not extrapolations of the original run.

Reusing the exact schema eliminates this avoidable construction and compilation
work. It does not change the existing model-wide reconciliation algorithm or its
accumulation of work. The isolated improvement and pipeline reduction establish
a real defect and a useful correction; they do not prove this was the sole cause
of the historical 32-minute run or guarantee full six-service completion.

## 4. Changes implemented

- Hoisted the unchanged evidence-row schema to module scope. Every row is still
  validated and converted; no row, source context or candidate result is cached.
- Added five focused loader correctness tests covering output/lineage, repeated
  reads and rejection of malformed IDs, fingerprints, numeric versions and
  locators in later rows.
- Added two bounded diagnostic scripts:
  [`benchmark-hmrc-processing.mjs`](../../scripts/benchmark-hmrc-processing.mjs)
  and [`benchmark-hmrc-evidence.mjs`](../../scripts/benchmark-hmrc-evidence.mjs).
  They report elapsed time, process CPU and peak RSS; the pipeline script also
  reports stages, evidence/graph counts and sampled JavaScript CPU frames.

No dependencies, extraction rules, parser-pack versions, schema constraints,
publication vocabulary, authority boundaries or deployment configuration changed.

## 5. Before/after performance

Environment: macOS arm64, Node `v23.4.0`, pnpm `10.32.1`, locked dependencies,
including Zod `4.6.5`. Each measurement uses a fresh process. Docker runtime
uses Node 22; these are local measurements, not production-runtime certification.

### Isolated production evidence loader

|  Rows | Before elapsed | After elapsed | Speedup | Before user/system CPU | After user/system CPU | Before/after peak RSS |
| ----: | -------------: | ------------: | ------: | ---------------------: | --------------------: | --------------------: |
| 1,000 |      165.08 ms |      20.81 ms |    7.9× |      292.56 / 14.64 ms |       37.57 / 2.31 ms |   197.89 / 159.53 MiB |
| 2,000 |      314.72 ms |      35.81 ms |    8.8× |      498.67 / 23.73 ms |       71.41 / 6.42 ms |   224.70 / 171.73 MiB |

Doubling rows increased elapsed time 1.91× before and 1.72× after. This removes
setup overhead; it does not establish a new asymptotic complexity class.

### Small temporary-catalogue publication pipeline

| Controllers / documents / evidence | Before elapsed | After elapsed | Reduction | Before/after reconcile | Before/after peak RSS |
| ---------------------------------- | -------------: | ------------: | --------: | ---------------------: | --------------------: |
| 8 / 9 / 192                        |    2,470.34 ms |   2,049.80 ms |     17.0% | 2,176.35 / 1,793.75 ms |   620.83 / 591.61 MiB |
| 16 / 17 / 384                      |    5,486.54 ms |   4,063.36 ms |     25.9% | 4,942.88 / 3,647.62 ms |   821.36 / 882.94 MiB |

| Controllers | Before user/system CPU | After user/system CPU | Before/after direct evidence reads | Entities / relationships, unchanged |
| ----------: | ---------------------: | --------------------: | ---------------------------------: | ----------------------------------: |
|           8 |   3,160.72 / 463.65 ms |  2,721.37 / 433.94 ms |                   46.59 / 20.24 ms |                           210 / 416 |
|          16 |   7,157.99 / 979.43 ms |  5,286.73 / 845.85 ms |                   98.69 / 33.99 ms |                           418 / 832 |

Pipeline elapsed scaling was 2.22× before and 1.98× after when doubling
controllers. CPU totals can exceed wall time because native DuckDB work and
other runtime threads consume CPU concurrently. Inspector samples represent
the JavaScript isolate, not all native threads. Peak RSS covers process lifetime,
including setup; the 16-controller result increased, so there is no demonstrated
general memory reduction. One pair per size gives directional evidence, not a
statistical throughput guarantee. Inspector overhead is present in both pipeline
runs and absent from the isolated-loader measurements.

Reproduction from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm -r --workspace-concurrency=1 --filter @workspace-brain/duckdb... --filter @workspace-brain/filesystem... --filter @workspace-brain/knowledge-worker... run build
node scripts/benchmark-hmrc-evidence.mjs 1000
node scripts/benchmark-hmrc-evidence.mjs 2000
node scripts/benchmark-hmrc-processing.mjs 8
node scripts/benchmark-hmrc-processing.mjs 16
```

For a baseline comparison, build baseline `c7f8f05` in a separate checkout and
supply the same diagnostic scripts. Scripts are intentionally outside `pnpm test`;
timing assertions would be environment-dependent.

## 6. Tests and correctness verification

- Targeted dependency builds and the corrected DuckDB package build: passed.
- DuckDB package typecheck: passed.
- Five targeted Vitest files: **39 tests passed**. Included the new loader tests,
  HMRC candidate and knowledge tests, Journey reference tests and all four HMRC
  publication scenarios (missing, unique, ambiguous and oversized provider).
- Existing publication fixtures verify graph identities, complete provenance,
  changed/deleted-document edge retraction, deterministic export and preservation
  of earlier publication bytes. Candidate fixtures cover evidence-order replay.
- A direct comparison using the previous inline schema and corrected loader
  produced byte-identical JSON for six locator shapes (Scala symbol/call, route,
  HOCON, JSON and Markdown), numeric coercion and truncation flags. This was an
  ephemeral verification; the loader tests retain explicit expected output.
- Before/after pipeline document, evidence, entity and relationship counts match.
  Independently generated publication IDs/timestamps were not compared as bytes
  across fresh catalogues; historical immutability is checked within each test.
- ESLint on changed code/scripts, Prettier and `git diff --check`: passed.
- An attempted `tsconfig.tests.json` typecheck could not run because that file is
  absent in this checkout; the package's supported typecheck was used instead.

Validation remains on the read path, with unchanged constraints and coercion.
No evidence selection, semantic inference, publication mutation or source-authority
logic changed. No live catalogue was opened. No Docker rebuild was performed.

## 7. Outstanding risks

- The original HMRC corpus and six-service completion are unverified. This report
  identifies a confirmed contributing defect, not a complete attribution of the
  historical incident.
- Full reconciliation still revisits accumulated evidence and graph state.
  Further optimization would need new measurements and separate authorization
  if it changes architecture or publication behavior. It was not explored here.
- Real repositories may exercise different graph shapes and costs. The small
  pipeline cases are deliberately bounded and have unresolved local calls.
- Local Node 23 results may differ from the Node 22 container runtime.
- Existing acceptance commands have no built-in timeout. Any later real-corpus
  attempt must run the architecture-validator process itself under a strict
  parent-enforced deadline; terminating only its HMRC wrapper can orphan the
  nested validator. Neither full-corpus command was run tonight.

## 8. Recommended next action and runtime handover

Review the dedicated Phase 1 commit. When the HMRC sources become available,
first run one representative service against a temporary catalogue under a
five-minute subprocess deadline, with measured stage progress. Only consider a
strictly bounded six-service run if that result establishes a reason. No Phase 2
or Phase 3 work is included or authorized by this report.

**Runtime action:** rebuild and recreate **`workspace-brain-api`** with
`make rebuild-api` from the repository root after approval to deploy. The API
imports DuckDB and executes catalogue reconciliation; workers call the API and
do not import this implementation. Application code is baked into the image,
so restart alone does not deploy this correction. The target also brings up its
NATS dependency; no NATS image rebuild is needed. No worker, LibreChat or Explorer
rebuild/restart is required. Deployment was **not performed**. After deployment,
check API `/ready`, container health/status and logs. There are no migration or
extraction-rule changes and no historical evidence reprocessing requirement.
