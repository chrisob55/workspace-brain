# Workspace Brain HMRC Parser Pack Validation

- **Validation timestamp:** 2026-10-13 13:15:10 +01:00
- **API base URL:** `http://localhost:3000`
- **Latest publication:** `01M4QYH0Z0MGCPXYKW74P40XPJ` (version 664)
- **Assessment:** **PASS with material semantic-depth warnings**
  **Overall score:** **7/10**

> Large list and export responses are represented below by compact JSON excerpts and
> measured aggregates rather than copied wholesale. The latest publication export
> alone is approximately 6.1 MiB. Commands are included so each full response can
> be reproduced from a terminal.

## Executive Summary

The local API was initially unavailable. The repository's documented Compose stack
was started with `docker compose -f deploy/compose/compose.yaml up -d`; health and
readiness then returned `ok` and `ready`.

The validation found 19 Git repositories, including 17 recognizable HMRC-style
service/mobile repository paths. The latest published model (version 664) contains
463 entities and 637 relationships. It identifies HMRC concepts such as Agent
Client Enrolments, Agent Authorisation, Agent Client Relationships, their
repositories, APIs and operations. In particular, 82 `EXPOSES` relationships
connect six APIs to operations. This is evidence of genuine architecture-shaped
knowledge, not only a repository inventory.

Provenance is a standout: all 463 exported entities and 637 relationships include
source evidence and provenance. An inspected API entity traces to `openapi.yaml`,
including source/document/version IDs, a content fingerprint, YAML line locators,
processor metadata and extractor metadata.

The semantic graph is not yet sufficient for unqualified senior-architect
decision support. `DEPENDS_ON` (377) is present, but there are no direct API- or
repository-level dependency edges; `USES`, `CONSUMES`, `IMPLEMENTS`, `DOCUMENTS`,
`BELONGS_TO` and `CLASSIFIED_AS` are absent. The `agent` and `enrolment` searches
find meaningful HMRC concepts, while `eacd` returns no results. A significant
share of the model remains code/package/document inventory, and architectural
decisions are named mostly as `ADR-001`, etc., rather than by decision title.

**Conclusion:** the pack demonstrates a useful and distinctive
repository-to-knowledge-and-provenance pipeline, including OpenAPI operation
discovery. It has not yet demonstrated complete service-to-service understanding
or validated domain coverage. Before a senior-architect demonstration, lead with
the provenance-backed HMRC API/operation examples, clearly label the current
relationship and naming gaps, and avoid presenting the graph as a complete
dependency model.

## Test 1 — System Health

**Assessment: PASS**

The first request attempt could not connect because the local stack had stopped.
After starting the documented Compose stack, both endpoints passed.

**API requests**

```sh
curl -s http://localhost:3000/health | jq
curl -s http://localhost:3000/ready | jq
```

**Raw JSON output**

```json
{"status":"ok"}
{"status":"ready"}
```

**Findings:** The API is healthy and ready after the stack was brought up.

## Test 2 — Repository Discovery

**Assessment: PASS**

**API request**

```sh
curl -s http://localhost:3000/api/v1/repositories?limit=100 | jq
```

**Findings**

- 19 repositories returned; all are `git`; no next-page cursor was present.
- 17 paths are recognizable HMRC-style service/mobile repositories: 13 `agent-*`
  services and four mobile repositories. The remaining entries are `ai-os` and
  `workspace-brain`.
- Examples include `agent-client-enrolments`, `agent-client-relationships`,
  `agent-authorisation-api`, `agent-assurance`, `agent-subscription`,
  `mobile-help-to-save` and `mobile-startup`.
- Repository paths are source-relative and prefixed with the source ID.

**Raw JSON output (compact excerpt)**

```json
{
  "count": 19,
  "repositoryTypes": [{ "type": "git", "count": 19 }],
  "examples": [
    {
      "path": "01M48WSQDV4P0XDVFRE72RFVXP/workspace-brain",
      "repositoryType": "git"
    },
    { "path": "01M48WSQDV4P0XDVFRE72RFVXP/ai-os", "repositoryType": "git" },
    {
      "path": "01M48WSQDV4P0XDVFRE72RFVXP/ai-os/workspace/mobile-help-to-save",
      "repositoryType": "git"
    },
    {
      "path": "01M48WSQDV4P0XDVFRE72RFVXP/agent-access-control",
      "repositoryType": "git"
    }
  ],
  "nextCursor": null
}
```

## Test 3 — Knowledge Models

**Assessment: PASS**

**API request**

```sh
curl -s http://localhost:3000/api/v1/knowledge/models | jq
```

**Findings**

- One model: `Local Workspace Knowledge Model`, schema version 2.
- Its latest publication version is 664. The latest-publication endpoint resolves
  publication `01M4QYH0Z0MGCPXYKW74P40XPJ`, published
  `2026-10-12T11:38:40.927Z`.
- The publications list endpoint is paginated: its first response contained 50
  items (versions 1–50) and a next cursor. It is not sufficient by itself to find
  the latest publication; the model's `/publications/latest` endpoint was used.

**Raw JSON output**

```json
{
  "items": [
    {
      "id": "01M48WSQE5H93RMEQPZ8PF3FSB",
      "workspaceId": "01M48WSQE03Z6TXRBM3SEVAWR7",
      "name": "Local Workspace Knowledge Model",
      "schemaVersion": 2,
      "latestPublicationVersion": 664,
      "createdAt": "2026-10-06T15:20:01.221Z"
    }
  ],
  "nextCursor": null
}
```

## Test 4 — Knowledge Entities

**Assessment: PASS with WARNING on naming and page scope**

**API request**

```sh
curl -s http://localhost:3000/api/v1/knowledge/entities?limit=100 | jq
```

**Findings**

- The requested entity-list page returned 100 entities and a next cursor. It is
  the first page, heavily weighted toward Workspace Brain implementation
  artifacts; it is not a complete inventory of the latest publication.
- First-page types: `api` 1, `container` 1, `module` 62, `package` 36.
- The latest publication export provides the broader inventory (463 entities):

| Entity type            | Count |
| ---------------------- | ----: |
| api                    |    11 |
| container              |     1 |
| module                 |    90 |
| repository             |    19 |
| operation              |    82 |
| document               |   139 |
| architectural-decision |    39 |
| package                |    82 |

- The first page's top 20 names (alphabetically, including distinct entities
  sharing a name) are primarily module/package artifacts, such as
  `@duckdb/node-api`, `@workspace-brain/catalogue`,
  `@workspace-brain/configuration` and `@workspace-brain/domain`. This is a
  limitation of interpreting the first page as a representative architectural
  sample.
- The published model also contains meaningful names such as
  `Agent Client Enrolments API`, `Agent Client Relationships API`,
  `Agent Assurance API`, `Agent Authorisation`, and operations such as
  `terminateAgent`, `getAgentDetails` and `Getstartupdata`.
- Names are mixed quality. APIs and repositories are recognizable, but 39
  architectural-decision entities are named with IDs such as `ADR-001` through
  `ADR-012`; those names do not communicate the decision themselves. Some
  operation names have inconsistent casing/word separation.
- The latest export has 337 unique entity names across 463 entities.

**Top 20 distinct names by name, from the latest publication**

1. `@duckdb/node-api` — module
2. `@eslint/js` — package
3. `@modelcontextprotocol/sdk` — package
4. `@types/markdown-it` — package
5. `@types/node` — package
6. `@workspace-brain/catalogue` — module
7. `@workspace-brain/configuration` — module
8. `@workspace-brain/domain` — module
9. `@workspace-brain/domain-currency` — package
10. `@workspace-brain/domain-evolution` — package
11. `@workspace-brain/domain-publication` — module
12. `@workspace-brain/duckdb` — module
13. `@workspace-brain/filesystem` — module
14. `@workspace-brain/ingestion-worker` — package
15. `@workspace-brain/knowledge-worker` — package
16. `@workspace-brain/nats` — module
17. `@workspace-brain/processing-core` — module
18. `@workspace-brain/publication-diff-service` — module
19. `@workspace-brain/workspace-brain-api` — package
20. `AAC01.md` — document

**Raw JSON output (entity-list excerpt and latest-publication type counts)**

```json
{
  "pageCount": 100,
  "nextCursor": "MDFNNDhXVEM5WlJIMlBYWlhGNE0xSktIS0o",
  "first": {
    "id": "01M48WSYMDK84P00EY2TKEXT2K",
    "type": "module",
    "name": "workspace-brain/apps/knowledge-worker/src/knowledge-extractors.test",
    "sourceEvidenceIds": ["01M4FT7RNWT3K6HYZFEPT3D7HB"]
  },
  "latestPublicationEntityCounts": {
    "api": 11,
    "architectural-decision": 39,
    "container": 1,
    "document": 139,
    "module": 90,
    "operation": 82,
    "package": 82,
    "repository": 19
  }
}
```

## Test 5 — Knowledge Relationships

**Assessment: PASS for dependencies and API exposure; WARNING for service graph**

**API requests**

```sh
curl -s http://localhost:3000/api/v1/knowledge/relationships?limit=200 | jq
curl -s http://localhost:3000/api/v1/knowledge/relationships?limit=100 | jq
```

The requested `limit=200` returned HTTP 400 with
`{"type":"about:blank","title":"Invalid Request","status":400,"detail":"Catalogue query parameters are invalid."}`.
Retrying at `limit=100` returned 100 records and a next cursor. The latest
publication export was used for complete relationship counts.

| Relationship type | Count |
| ----------------- | ----: |
| DEPENDS_ON        |   377 |
| USES              |     0 |
| EXPOSES           |    82 |
| CONSUMES          |     0 |
| IMPLEMENTS        |     0 |
| REFERENCES        |   100 |
| DOCUMENTS         |     0 |
| CONTAINS          |    78 |
| BELONGS_TO        |     0 |
| CLASSIFIED_AS     |     0 |

**Findings**

- Dependency relationships exist, but none of the 377 `DEPENDS_ON` edges has an
  API or repository as either endpoint. The graph therefore does not establish
  service-to-service dependencies.
- `EXPOSES` is useful, operation-level API knowledge. The 82 edges cover six
  APIs, including 22 operations for `Agent Client Relationships API`, 16 for
  `Agent Authorisation` and one for `Agent Client Enrolments`.
- `CONTAINS` provides some repository/package/module structure; `REFERENCES`
  provides document links.
- No evidence of API consumption, implementation, document ownership, or
  classification relationships was present under the requested types.

**Raw JSON output (latest-publication aggregate and relationship example)**

```json
{
  "relationshipCount": 637,
  "relationshipTypes": [
    { "type": "CONTAINS", "count": 78 },
    { "type": "DEPENDS_ON", "count": 377 },
    { "type": "EXPOSES", "count": 82 },
    { "type": "REFERENCES", "count": 100 }
  ],
  "example": {
    "type": "EXPOSES",
    "source": { "name": "Workspace Brain API", "type": "api" },
    "target": { "name": "listDocumentEvidence", "type": "operation" }
  }
}
```

## Test 6 — Search Validation

**Assessment: PASS for HMRC language; WARNING for acronym coverage**

**API requests**

```sh
curl -s "http://localhost:3000/api/v1/search/entities?query=agent" | jq
curl -s "http://localhost:3000/api/v1/search/entities?query=enrolment" | jq
curl -s "http://localhost:3000/api/v1/search/entities?query=eacd" | jq
```

**Findings**

- `agent`: 33 matches. Results include HMRC repositories, APIs and operations,
  including `Agent Client Relationships API`, `Agent Authorisation`,
  `Agent Client Enrolments API`, `terminateAgent` and `getAgentDetails`.
  Results also include generic `AGENTS.md` documents, so keyword relevance is
  not uniformly domain-specific.
- `enrolment`: 3 matches — `Agent Client Enrolments API`, the
  `agent-client-enrolments` repository, and `Agent Client Enrolments`.
- `eacd`: 0 matches. This shows no indexed entity-name match for this query;
  whether it should resolve depends on whether EACD is present in the supplied
  source corpus and whether search is expected to match evidence text.

**Raw JSON output (compact excerpts)**

```json
{
  "agent": {
    "count": 33,
    "sample": [
      {
        "type": "api",
        "name": "Agent Client Enrolments API",
        "relationshipCount": 0
      },
      { "type": "api", "name": "Agent Authorisation", "relationshipCount": 6 },
      {
        "type": "api",
        "name": "Agent Client Relationships API",
        "relationshipCount": 22
      },
      { "type": "operation", "name": "terminateAgent", "relationshipCount": 1 }
    ]
  },
  "enrolment": {
    "count": 3,
    "names": [
      "Agent Client Enrolments API",
      "agent-client-enrolments",
      "Agent Client Enrolments"
    ]
  },
  "eacd": { "count": 0, "items": [], "nextCursor": null }
}
```

## Test 7 — Publications

**Assessment: PASS**

**API requests**

```sh
curl -s http://localhost:3000/api/v1/knowledge/publications | jq
MODEL_ID=01M48WSQE5H93RMEQPZ8PF3FSB
curl -s "http://localhost:3000/api/v1/knowledge/models/$MODEL_ID/publications/latest" | jq
PUB=01M4QYH0Z0MGCPXYKW74P40XPJ
curl -s "http://localhost:3000/api/v1/knowledge/publications/$PUB/summary" | jq
```

**Findings**

- Latest publication: `01M4QYH0Z0MGCPXYKW74P40XPJ`, version 664, schema version 2,
  status `published`, published `2026-10-12T11:38:40.927Z`.
- Summary reports 463 entities and 637 relationships.
- The generic publications listing's initial 50-item page contains older
  versions, so the latest-model endpoint was necessary to identify the current
  publication reliably.

**Raw JSON output**

```json
{
  "publication": {
    "id": "01M4QYH0Z0MGCPXYKW74P40XPJ",
    "version": 664,
    "schemaVersion": 2,
    "status": "published",
    "contentHash": "49f7c494c16bd81cfc63e4c327c2a9b73b83d2357126ebadbcc1b06303d201a4",
    "publishedAt": "2026-10-12T11:38:40.927Z"
  },
  "entityCount": 463,
  "relationshipCount": 637
}
```

## Test 8 — Publication Export

**Assessment: PASS for usable, versioned export; WARNING for semantic richness**

**API request**

```sh
PUB=01M4QYH0Z0MGCPXYKW74P40XPJ
curl -s "http://localhost:3000/api/v1/knowledge/publications/$PUB/export" | jq
```

**Findings**

- The export is `workspace-brain-knowledge-publication`, format version 1, with
  publication metadata, entity versions, relationship versions and provenance.
- It contains 463 entities and 637 relationships, so it is useful for downstream
  consumption and audit.
- Provenance is structurally complete: all exported entities (463/463) and
  relationships (637/637) carry `sourceEvidenceIds` and non-empty `provenance`.
- Entity semantics remain mostly name/type/linkage. The export does not turn
  every artifact into a richly described business concept; e.g. several
  architectural decisions are identified only by ADR number.
- The full pretty-printed JSON response was approximately 6.1 MiB and is not
  duplicated in this report; the following JSON is a raw excerpt.

**Raw JSON output (export metadata and entity example)**

```json
{
  "format": "workspace-brain-knowledge-publication",
  "formatVersion": 1,
  "metadata": {
    "publicationId": "01M4QYH0Z0MGCPXYKW74P40XPJ",
    "publicationVersion": 664,
    "schemaVersion": 2,
    "entityCount": 463,
    "relationshipCount": 637
  },
  "entityExample": {
    "name": "Agent Client Relationships API",
    "type": "api",
    "sourceEvidenceIds": [
      "01M4QYEAKF6NNNFXZTN84S20PV",
      "01M4QYEAKGNHH6GH5NAWNXN16M",
      "01M4QYEAKGY88TFWTZMC1PANKM"
    ]
  }
}
```

## Test 9 — Provenance Validation

**Assessment: PASS**

**API request**

```sh
ENTITY_ID=01M4QYEDME0FRYT1CVDN4B020S
curl -s "http://localhost:3000/api/v1/knowledge/entities/$ENTITY_ID" | jq
```

**Findings**

- The inspected `Agent Client Relationships API` entity has three
  `sourceEvidenceIds` and three provenance records.
- A provenance record identifies the source, document and document version,
  path `agent-client-relationships/openapi.yaml`, content fingerprint, YAML
  line range, processor/version, extraction rule/version and knowledge
  extractor/version.
- This is strong traceability metadata. The validation inspected provenance
  carried by entity responses/export; it did not independently fetch and
  compare every referenced evidence payload against repository content.

**Raw JSON output (one provenance record)**

```json
{
  "id": "01M4QYEDME0FRYT1CVDN4B020S",
  "type": "api",
  "name": "Agent Client Relationships API",
  "sourceEvidenceIds": [
    "01M4QYEAKF6NNNFXZTN84S20PV",
    "01M4QYEAKGNHH6GH5NAWNXN16M",
    "01M4QYEAKGY88TFWTZMC1PANKM"
  ],
  "provenance": [
    {
      "evidenceId": "01M4QYEAKF6NNNFXZTN84S20PV",
      "documentVersionId": "01M4QYEAFXWEAT6MHESXF51KYC",
      "documentId": "01M4QY86NQ5B4QFV40FHPETZGJ",
      "sourceId": "01M48WSQDT3RQNS93F0A97ZRQG",
      "documentPath": "01M48WSQDV4P0XDVFRE72RFVXP/agent-client-relationships/openapi.yaml",
      "contentFingerprint": "c621c7ef11502cd74ad65183ba0d0bd98c80895287c4f3827d0c30896f3033db",
      "locator": { "kind": "yaml-lines", "lineStart": 3, "lineEnd": 3 },
      "processorId": "yaml",
      "processorVersion": 3,
      "extractionRuleId": "yaml-scalar-values",
      "extractionRuleVersion": 1,
      "knowledgeExtractorId": "openapi-operations",
      "knowledgeExtractorVersion": 1
    }
  ]
}
```

## Test 10 — Parser Pack Success Assessment

1. **Did the parser create architectural knowledge?** Yes. It creates API,
   operation, repository, document and architectural-decision entities and
   useful `EXPOSES`, `CONTAINS` and `REFERENCES` links. Some of the model is still
   code/package inventory rather than high-level architecture.
2. **Did it identify HMRC-specific concepts?** Yes. Agent Authorisation,
   Agent Client Enrolments, Agent Client Relationships, Agent Assurance and
   related operations/repositories are present and searchable.
3. **Did it identify dependencies?** Yes at 377 `DEPENDS_ON` edges, but no
   direct API/repository-level dependency edge was found. Service-to-service
   dependency understanding is therefore not demonstrated.
4. **Is provenance complete?** Structurally, yes for this publication:
   463/463 entities and 637/637 relationships include evidence IDs and
   provenance. Independent source-content revalidation was not part of this run.
5. **Is publication export useful?** Yes. It is versioned, machine-readable and
   carries entity/relationship versions, evidence and provenance. Its size and
   artifact-heavy content need consideration for consumers.
6. **Most impressive discoveries:** operation-level API exposure; 11 API
   entities and 82 operations, including 22 relationship-service operations and
   16 authorisation operations; repository discovery across the HMRC-style
   corpus; and line/fingerprint/extractor-level provenance.
7. **What gaps remain?** No `USES`, `CONSUMES`, `IMPLEMENTS`, `DOCUMENTS`,
   `BELONGS_TO` or `CLASSIFIED_AS`; no API/repository dependency edges; zero
   `eacd` search results; generic ADR-number names; inconsistent operation
   naming; first-page entity results skewed toward internal implementation.
8. **What would a senior architect challenge?** Whether the extracted
   relationships are accurate and complete; whether syntactic imports imply
   useful architecture; how APIs are consumed across services; whether the ADR
   nodes represent decisions or only file identifiers; and why a domain acronym
   expected for the corpus is absent.
9. **Is this production-quality?** The ingestion, publication and provenance
   capabilities look strong. The semantic model is not yet production-quality
   as a complete architecture/dependency authority without coverage, precision
   and cross-service relationship validation.
10. **Overall score:** **7/10** — strong traceable extraction and API discovery;
    incomplete service-level semantics and uneven domain labeling.

## Recommendations

1. Add or validate explicit API/service consumption and dependency extraction,
   then test API-to-API/repository edges against known HMRC examples.
2. Enrich ADR entities with decision title, status and summary rather than
   presenting `ADR-001` as the architectural concept.
3. Validate expected terminology (including `eacd`) against the actual source
   corpus and supported search semantics; report absent source coverage
   separately from extraction failures.
4. Improve operation-name normalization and reduce duplicate/ambiguous API
   entities where multiple source documents describe the same service.
5. Make the demo HMRC-focused and cursor-aware so the first 100 internal
   module/package records do not mask the published HMRC entities.
6. Before claiming production architecture coverage, measure extraction
   precision/recall against a curated set of repositories, APIs, operations,
   decisions and known cross-service relationships; independently verify a
   sample of evidence locators against the source files.

## Terminal Commands to Reproduce

```sh
BASE=http://localhost:3000

curl -s "$BASE/health" | jq
curl -s "$BASE/ready" | jq
curl -s "$BASE/api/v1/repositories?limit=100" | jq
curl -s "$BASE/api/v1/knowledge/models" | jq
curl -s "$BASE/api/v1/knowledge/entities?limit=100" | jq
curl -s "$BASE/api/v1/knowledge/relationships?limit=200" | jq
curl -s "$BASE/api/v1/knowledge/relationships?limit=100" | jq
curl -s "$BASE/api/v1/search/entities?query=agent" | jq
curl -s "$BASE/api/v1/search/entities?query=enrolment" | jq
curl -s "$BASE/api/v1/search/entities?query=eacd" | jq
curl -s "$BASE/api/v1/knowledge/publications" | jq

MODEL_ID=01M48WSQE5H93RMEQPZ8PF3FSB
PUB=01M4QYH0Z0MGCPXYKW74P40XPJ
ENTITY_ID=01M4QYEDME0FRYT1CVDN4B020S

curl -s "$BASE/api/v1/knowledge/models/$MODEL_ID/publications/latest" | jq
curl -s "$BASE/api/v1/knowledge/publications/$PUB/summary" | jq
curl -s "$BASE/api/v1/knowledge/publications/$PUB/export" | jq
curl -s "$BASE/api/v1/knowledge/entities/$ENTITY_ID" | jq
```
