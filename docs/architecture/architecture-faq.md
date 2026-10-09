# Workspace Brain Architecture FAQ

## Executive Summary

Workspace Brain is a local-first Knowledge Model Production Platform. It
discovers configured filesystem sources, records inventory and content
fingerprints, extracts deterministic evidence, derives evidence-backed
knowledge through registered extractors, and publishes immutable,
versioned Knowledge Models. Consumers can retrieve and explain a pinned
publication without depending on internal storage.

The architecture's most important boundary is between authoritative source
material and a derived representation. A repository or document remains the
authority; a Knowledge Model is a versioned, inspectable account of what
Workspace Brain could derive from selected evidence using particular
processing and extraction definitions. Provenance, stable identity, controlled
vocabulary, validation and immutable snapshots make that account reviewable.
They do not make an incomplete or incorrect source interpretation true.

The delivered platform is deterministic and does not use AI, embeddings,
semantic search or a graph database to generate or retrieve knowledge. Its
current path includes filesystem discovery; document processing and evidence;
deterministic knowledge extractors; DuckDB-backed reconciliation and
publication; publication-scoped lexical search, exploration, diffs, currency
and JSON export. NATS JetStream transports asynchronous work. Qdrant and
Ollama are present in the broader Compose architecture but are not used by
these delivered knowledge-generation or search capabilities.

Future AI can propose candidate evidence or knowledge under explicit,
versioned controls. It cannot verify, establish or publish its own output.
Governance, acceptance rules and the consumer's own authority model remain
necessary. Workspace Brain is not a chat, agent, reasoning or RAG platform,
and it does not replace AI OS governance or its Knowledge Ledger.

This FAQ describes the implemented baseline as well as accepted decisions and
clearly identified proposals. In particular, full workspace-selection,
repository-hierarchy and structural-currency behavior in
[ADR-025](../adr/ADR-025-workspace-and-nested-repository-boundaries.md) is
proposed, not an accepted runtime contract. See the
[Architecture Definition Document](Workspace-Brain-ADD-v1.md), the
[accepted ADR index](../adr/README.md), and the
[current implementation summary](../README.md) for the source decisions.

## Architecture FAQ

### Section 1 - Product and Architecture

1. **What problem does Workspace Brain solve?**
   It turns knowledge scattered across configured repositories and documents
   into a structured, versioned representation that can be consumed and
   inspected. It makes the derivation and source lineage explicit rather than
   treating a search result or model response as an authoritative fact.

2. **Why does it exist separately from AI OS?**
   Workspace Brain acquires source material and produces evidence-backed
   Knowledge Models. AI OS consumes those contracts and owns governed
   understanding, its Knowledge Ledger, reasoning and Digital Brain. Separating
   those responsibilities avoids coupling acquisition to a particular
   consumer's governance or reasoning design.

3. **Why not use Copilot directly?**
   An interactive assistant is useful for questions and task-specific
   synthesis, but its conversational response is not, by itself, a
   reproducible, versioned publication with stable identities and complete
   provenance. Workspace Brain addresses that production and traceability
   problem; it does not replace Copilot or prohibit consumers from using it.

4. **Why not simply index documents?**
   An index supports locating content, but does not alone express typed
   entities, evidence-backed relationships, lifecycle, immutable publication
   membership or why a claim exists. Workspace Brain adds those contracts;
   lexical search remains a retrieval capability over published knowledge, not
   the product boundary.

5. **Why not use a graph database directly?**
   The current need is to create and publish a controlled, evidence-backed
   model, not to make a graph engine authoritative. A graph database would not
   solve source authority, extraction quality, provenance or publication
   governance. A graph-shaped contract can be represented and exported without
   committing to graph storage.

6. **What is a Knowledge Model?**
   It is a schema-versioned, machine-readable representation for a defined
   scope, containing stable identities, typed entities and relationships,
   evidence links and provenance. It is not the original source and does not
   assert that every relevant fact has been discovered.

7. **Why is publication important?**
   Publication creates a stable contract boundary: a consumer can pin an
   immutable version, reproduce what it received, compare later versions and
   audit the supporting evidence. A mutable “current state” alone cannot give
   those guarantees.

8. **What does “deterministic” mean here?**
   Given equivalent inputs, accepted definitions and frozen structural
   context, deterministic processing is intended to produce the same
   candidates and canonical snapshots, independent of incidental ordering.
   Determinism does not guarantee completeness, semantic correctness or
   identical output across different definition versions.

9. **What is the product boundary?**
   Workspace Brain owns configured discovery, inventory, processing and
   evidence lineage, deterministic knowledge candidates, reconciliation,
   validation, publication and publication-scoped read capabilities. It does
   not own source changes, agent actions, consumer governance or autonomous
   reasoning.

10. **What is deliberately not in the product today?**
    It is not a chat interface, an agent runtime, a reasoning engine, a RAG
    system, or a graph database. AI extraction, vector/semantic search,
    external source connectors, source writes and a complete enterprise trust
    boundary are not delivered capabilities.

### Section 2 - Discovery

1. **What constitutes a source?**
   A source is a configured acquisition provider. The delivered MVP uses
   read-only filesystem sources with configured scan roots; other providers
   such as hosted Git services or document-management systems are future
   extensions.

2. **What constitutes a workspace?**
   A workspace is a logical knowledge domain associated with configured
   sources and a Knowledge Model scope. It is not inferred from a directory
   name. Full overlapping workspace selection and per-workspace content
   routing are not yet an accepted runtime contract.

3. **What constitutes a repository?**
   Discovery identifies a Git repository from a qualifying `.git` directory
   under the accepted filesystem rules. A name such as `platform` or a
   directory containing code is not sufficient evidence of repository
   identity.

4. **How are documents discovered?**
   The scanner walks configured roots under inclusion, exclusion,
   file-size and no-follow-symlink rules, identifies supported files and
   fingerprints their content with SHA-256. A document identity persists
   across rescans at its registered location; a content change is represented
   by a new immutable document version.

5. **How are nested repositories handled?**
   Discovery traverses nested Git boundaries rather than collapsing them into
   a parent. Architectural extraction uses frozen inventory context and treats
   nested boundaries independently; it does not infer parent-child,
   submodule or dependency relationships merely from directory nesting.

6. **How is document ownership determined?**
   Where Slice 9 structural extraction applies, ownership is supported by the
   deepest segment-aligned discovered Git boundary in the frozen source-root
   context. The path must be backed by source-document evidence. This is not a
   general promise of fully modelled ownership and hierarchy across
   workspaces.

7. **What happens when a repository or source moves?**
   Current durable identity is location/source scoped, not inferred from
   equal content, commit hashes, remote URLs or names. A move is therefore
   treated as removal plus addition unless a future explicit identity and
   reconciliation contract says otherwise.

8. **What happens if a scan is incomplete or a path is inaccessible?**
   A failed or incomplete scan must not be interpreted as authoritative
   removal. Discovery has configured boundaries and exclusions, so inventory
   is not a completeness claim about inaccessible, excluded or unscanned
   content.

9. **What is authoritative: Git, the filesystem or the catalogue?**
   Original source files and repositories are authoritative for their content.
   The catalogue is authoritative for Workspace Brain's operational record,
   accepted processing authority and publication lineage. Neither the
   catalogue nor a Knowledge Model supersedes the source.

10. **Can Workspace Brain scan outside a registered root or modify a source?**
    No by design: the source mount is read-only, path reads are bounded to
    registered roots and content is parsed as data, not executed. These
    protections support the local trust model; they do not isolate a malicious
    user or process with control of the host.

### Section 3 - Evidence

1. **What is evidence?**
   Evidence is a curated, immutable source fragment or structured fact
   produced by processing, with a locator and lineage to a specific document
   version. It is the support for a higher-order candidate, not an
   interpretation-free guarantee that the interpretation is correct.

2. **Why separate evidence from knowledge?**
   Evidence captures what was observed in a source and where it came from;
   entities and relationships express what a rule derives from those
   observations. Keeping them distinct lets reviewers challenge an extraction
   without losing the underlying source observation.

3. **What does provenance record?**
   Provenance connects a knowledge item to evidence, document and document
   version, content fingerprint, precise locator, processor and extraction
   rule versions, and—where relevant—structural context or later verification
   activity. It is intended to permit an explanation back to source.

4. **What is a precise locator?**
   A locator identifies the relevant position or structure in the processed
   document, such as a source path and line range, JSON Pointer, Markdown
   heading/link or format-specific location. A file path alone is not
   sufficient when a claim depends on a particular part of the document.

5. **Why must every relationship be evidence-backed?**
   A typed edge changes the represented architecture and can be mistaken for
   a fact by downstream systems. Requiring evidence makes its origin,
   direction and rule inspectable and prevents unsupported proximity or
   co-occurrence from masquerading as a relationship.

6. **Can evidence support, contradict or qualify a claim?**
   The architecture allows supporting, contradictory and qualifying evidence
   to be preserved. Current extractors are bounded by their implemented
   evidence contracts; the conceptual model should not be mistaken for a
   claim that all forms of contradiction are already detected automatically.

7. **What happens when source content changes?**
   A changed content fingerprint creates a new document version after
   successful processing. The earlier evidence and its lineage remain
   historical; new accepted processing can contribute revised candidates and
   lead to a later publication.

8. **What happens if evidence disappears or a document is removed?**
   Historical publications retain their evidence lineage and are not silently
   rewritten. Reconciliation can supersede current knowledge whose active
   support disappears. Currency can report removed supporting documents as
   `UNKNOWN`; this does not erase the historical publication.

9. **How is processing authority selected?**
   The catalogue selects a preferred processor and extraction-rule identity
   from its accepted registry. For that identity, definition versions are
   ordered by processor version and then extraction-rule version, not by
   timestamps, event IDs or generated IDs. Stale or non-preferred processing
   history may be retained without becoming current authority.

10. **Can evidence or lineage defects be repaired by reading current state?**
    No. Historical reads validate immutable evidence, snapshots and
    provenance; missing or inconsistent lineage is an integrity failure, not
    an invitation to reconstruct the past from today's paths or inventory.

### Section 4 - Knowledge

1. **What is knowledge in this platform?**
   It is a structured candidate representation derived from evidence using
   registered rules, reconciled into stable entities and relationships, and
   included in a verified publication. “Knowledge” describes the modelled
   representation, not epistemic certainty or universal truth.

2. **What is an entity?**
   An entity is a typed, stable-identity representation of a thing the
   accepted vocabulary can support, such as a package, module, API, container,
   repository, architectural decision, document or operation. Type support
   is schema-versioned.

3. **What is a relationship?**
   A relationship is a directional, controlled-vocabulary connection between
   known entity identities, with its own evidence and provenance. It is not
   implied by shared names, co-location or graph connectivity.

4. **How are relationships created?**
   Deterministic extractors parse explicit structures or declarations and
   resolve endpoints using defined boundaries and identities. For example,
   an OpenAPI API can `EXPOSES` a declared operation; that does not establish
   who consumes it or what business process it serves.

5. **Why are relationships deterministic?**
   Relationships can drive downstream architecture maps and decisions, so
   their creation rules must be reviewable and repeatable. Current extraction
   favors explicit evidence and false negatives over plausible but guessed
   edges.

6. **How are duplicate entities prevented?**
   Extractors produce stable keys and evidence-backed candidates; shared
   candidate-building and reconciliation logic merges supported contributions
   under domain identity rules. A matching display name alone is not a
   sufficient identity rule.

7. **How are conflicting candidates handled?**
   The system validates candidates, source lineage, vocabulary and
   contribution authority before reconciliation. Conflicts that cannot be
   resolved by accepted deterministic rules should remain explicit or be
   rejected/diagnosed, not silently selected by arrival order.

8. **What prevents unsupported entity types from appearing?**
   Entity types are controlled by the versioned Knowledge Model vocabulary
   and validators. Introducing a material type or changing the meaning of a
   relationship requires compatibility review and, where appropriate, a
   superseding ADR and schema-version decision.

9. **Why not infer a `service` entity now?**
   The current structural evidence contract does not establish service
   identity adequately. A service-shaped label based on names, folders or
   loose prose would overstate what the sources prove; add it only when an
   explicit, reviewable evidence contract supports it.

10. **How are entity and relationship lifecycles represented?**
    Resources can be discovered, extracted, observed, related, asserted,
    verified, established, rejected or superseded as appropriate. These
    states are resource-specific; current automated extraction does not
    elevate its own candidate to verified or established merely by
    publishing it.

11. **What is reconciliation?**
    Reconciliation combines active, accepted per-document-version
    contributions into stable current entity and relationship state and
    immutable version snapshots. When support ceases to be active, historical
    versions remain and current objects can be superseded rather than
    rewritten.

12. **What does a relationship direction mean?**
    It follows the defined verb, for example `A DEPENDS_ON B` or `API EXPOSES
    operation`. `REFERENCES` means explicit reference, not dependency; a
    relationship's semantics must not be broadened by a consumer.

13. **How are cross-repository relationships treated?**
    They are permitted only where both endpoints and their connection are
    in-scope and supported by explicit deterministic evidence. Common
    workspace membership, similar names or nearby paths do not establish
    `REFERENCES` or `DEPENDS_ON`.

14. **Are entity and relationship IDs globally meaningful?**
    IDs are stable platform identifiers within the model and publication
    contracts. Consumers should use the published IDs and schema, not derive
    identity from display names, paths or internal database keys.

15. **Does a published relationship mean a human approved it?**
    Not necessarily. Publication means the candidate passed the platform's
    validation and publication process. Human/CI verification and downstream
    acceptance are distinct lifecycle/governance steps and must be represented
    as such.

### Section 5 - Extractors

1. **What is an extractor?**
   A knowledge extractor is a deterministic plugin that accepts supported
   evidence and context and emits evidence-backed entity/relationship
   candidates plus diagnostics. It is separate from a document processor,
   which normalizes source content into evidence blocks.

2. **What is an Extractor Definition Contract (EDC)?**
   In this FAQ, EDC names the normative information needed to review an
   extractor; it is not a separate persisted EDC document format in the
   current platform. The implemented plugin contract has an ID, version,
   applicability predicate (`supports`), extraction function (`extract`) and
   optional numeric stage.

3. **What should a complete EDC specify?**
   At minimum: stable plugin ID, versioning policy, applicability, accepted
   inputs/context, emitted types and relationships, evidence/locator
   requirements, deterministic identity rules, diagnostics and failure
   behavior, stage dependencies, compatibility impact, and positive, negative
   and repeatability tests. Any additional formal artifact is future
   governance work, not an existing runtime feature.

4. **How does extractor execution remain deterministic?**
   The registry runs plugins by stage and then ordinal plugin ID, rejects
   duplicate or invalid registrations and conflicting support/context, and
   centralizes stable keys and provenance construction. Extractors must not
   depend on wall-clock time, registration order, network results or
   nondeterministic model output.

5. **How can a later-stage extractor use another extractor's output?**
   It can consume candidates through the shared staged registry contract.
   It must not import another plugin's implementation; this keeps plugin
   composition explicit and avoids accidental, hidden dispatch coupling.

6. **How are extractors reviewed?**
   Review the extraction rule and its evidence contract, not just whether
   example output looks plausible. Verify supported inputs, endpoint
   resolution, locators, stable identity, negative cases, determinism,
   diagnostics, schema compatibility and historical impact before accepting
   a plugin.

7. **How is extractor quality controlled?**
   Through deterministic fixtures, contract and integration tests, lineage
   validation, diagnostics, real-workspace validation and review of
   false-positive/false-negative behavior. These controls reduce risk; they
   do not prove an extractor is complete or semantically correct for every
   repository.

8. **How do we prevent a bad extractor from publishing bad facts?**
   Candidate acceptance checks evidence, vocabulary, identity and frozen
   context; reconciliation and publication operate only on accepted
   contributions. Stronger production controls may include staged rollout,
   measured quality thresholds and governance approval; those must not be
   assumed unless implemented and enforced.

9. **How is an extractor change versioned?**
   Changed extraction behavior must advance the relevant accepted processing
   definition/version and reprocess affected documents. An accepted
   contribution is immutable and is not overwritten merely because plugin
   code has changed.

10. **What happens to old contributions when an extractor changes?**
    They remain historical records. New processing creates a new immutable
    version/contribution, and the catalogue's authority rules determine which
    accepted definition can be current. A migration must not guess which
    legacy run is authoritative when history is ambiguous.

11. **Can extractors be configured per workspace?**
    The current architecture registers deterministic plugins in the
    application and processes configured source/workspace inputs. Full
    workspace-specific inclusion/routing and overlapping selection are not
    fully specified as an accepted runtime contract. Do not treat a plugin
    registration as proof of isolation between overlapping workspaces.

12. **How would HMRC-specific extractors be introduced?**
    Add a separately registered plugin with a scoped ID, deterministic
    applicability, explicit evidence format and locator, controlled output
    vocabulary, stable identities, diagnostics and representative tests.
    Avoid hard-coding HMRC assumptions into generic discovery or inferring
    facts from naming conventions. New domain types or semantics need
    compatibility and governance review.

13. **How would a Scala Play extractor be added?**
    A conforming extractor can be registered and tested without redesigning
    central dispatch. It should emit only claims supported by explicit,
    versioned source evidence and reuse approved vocabulary; support for a
    language does not justify inferred service topology.

14. **Why not allow free-form extraction?**
    Unconstrained extraction makes output shape, identity, evidence selection
    and relationship meaning difficult to validate and reproduce. It can be
    explored as candidate generation in a future AI path, but output must be
    schema-validated, evidence-grounded and governed before acceptance.

15. **What is the difference between a processor and an extractor?**
    A processor selects by supported document type and normalizes raw content
    into structured evidence blocks and source locators. A knowledge
    extractor consumes that evidence to derive typed candidates; changing
    these responsibilities independently makes lineage and testing clearer.

16. **What does a processor version mean?**
    It identifies behavior that can affect normalized document/evidence
    output; the extraction-rule version identifies the corresponding accepted
    extraction definition. Their pair with stable processor/rule IDs defines
    processing identity and precedence, rather than a timestamp.

17. **How are unsupported or ambiguous references handled?**
    They do not produce guessed relationships. For example, unresolved,
    escaping, remote or ambiguous Markdown targets are excluded; explicit
    OpenAPI operation IDs and exact supported manifest values are required.
    Diagnostics and negative tests should make those omissions reviewable.

18. **What is the extractor's failure behavior?**
    Invalid registration, conflicting context and invalid or inconsistent
    candidate lineage are rejected explicitly; processing failures should be
    observable and retry behavior bounded. A failed run must not become
    successful current authority or yield a success-shaped empty publication.

19. **When does a new extractor require an ADR?**
    A plugin that conforms to accepted evidence, vocabulary and publication
    contracts generally requires registration, tests and versioned
    reprocessing, not a new architecture decision. New types, relationship
    semantics, structural authority, trust assumptions or breaking contract
    changes warrant an ADR and compatibility review.

20. **How do we measure extraction coverage?**
    Report what sources, files, versions, extractors, diagnostics and
    candidate counts were in scope, and validate against representative
    fixtures or manually reviewed samples. A successful run or high entity
    count alone is not a coverage or quality measure.

### Section 6 - Publication

1. **What is a publication?**
   It is an immutable, version-specific membership of entity and relationship
   snapshots for a Knowledge Model, with schema metadata, content hash and
   validated evidence lineage. It is the consumer-facing unit of reproducible
   knowledge.

2. **Why publish instead of expose current state?**
   Current state is useful for operations but can change during a consumer's
   read. A publication pins membership and object versions so retrieval,
   export, comparison and audit refer to the same point-in-time contract.

3. **Why are publications immutable?**
   Rewriting an old version would break reproducibility, downstream caches
   and historical explanations. Corrections or new knowledge are expressed
   as a new publication; an earlier publication can be superseded or
   withdrawn without rewriting its snapshots.

4. **How is a publication identified?**
   By a stable publication ID together with its Knowledge Model ID, model
   publication version and schema version. Consumers should pin the returned
   publication ID, not assume that “latest” remains constant.

5. **What does the publication content hash cover?**
   It is SHA-256 over canonical JSON of the Knowledge Model schema version
   and sorted entity and relationship snapshots. It is not a hash of all
   source files or necessarily of every package metadata/provenance byte;
   provenance is independently validated for consistency and integrity.

6. **How are publications versioned?**
   Each newly published snapshot has a model publication version and a
   Knowledge Model schema version. The portable JSON envelope has its own
   `formatVersion`, independently versioned from the knowledge schema.

7. **How do historical publications work?**
   They resolve to their exact immutable membership and entity/relationship
   version snapshots, evidence and provenance. Historical reads do not
   reconstruct objects from today's catalogue rows or paths.

8. **What does “latest published” mean?**
   It is a lookup convenience for discovering the currently designated
   latest publication of a model. It is mutable as new versions publish;
   consumers requiring reproducibility should save and use the returned
   publication ID.

9. **Can a publication be withdrawn?**
   Yes, withdrawal is a lifecycle/governance action that changes its
   availability or status under the contract. Withdrawal does not rewrite the
   historical snapshot or turn it into a different publication.

10. **What does the export contain?**
    A deterministic UTF-8 JSON document with publication metadata, immutable
    entity and relationship snapshots, and an explicit provenance index. It
    does not embed the complete original repositories or documents.

11. **How is export made portable and verifiable?**
    It uses a versioned plain JSON envelope, canonical key ordering and
    stable ordering of snapshot arrays. The package includes a content hash
    and evidence/document-version lineage; consumers can validate the hash
    against the documented snapshot basis and inspect provenance.

12. **Can later catalogue changes affect an earlier export?**
    No by design. The export is read-only and publication-scoped; it reads
    the selected publication's immutable snapshots and lineage, not current
    entity rows or disposable search projections.

13. **How are breaking schema changes handled?**
    Schema changes are explicit and readers support the applicable historical
    versions. Schema 2 architectural publications coexist with schema 1
    history; older hashes, membership and exports are not silently migrated
    or rewritten.

14. **What happens when publication integrity validation fails?**
    The read fails explicitly with an integrity error; the system does not
    repair, reconstitute or silently omit inconsistent knowledge. Operators
    need to investigate lineage/storage integrity rather than consume a
    success-shaped partial model.

15. **Are diffs and search part of the immutable publication?**
    No. They are derived read capabilities/projections over selected
    publications. Their outputs can be rebuilt; they do not change snapshot
    membership or make a publication mutable.

### Section 7 - Search, Exploration and Currency

1. **What search capability is implemented today?**
   Delivered search is publication-scoped lexical search over a rebuildable
   projection. It is not semantic, embedding-based or generative retrieval,
   and it must not be described as a complete RAG pipeline.

2. **What does publication-scoped retrieval mean?**
   A caller selects a publication, and search/exploration resolves results
   against that publication's immutable knowledge. It avoids mixing a
   published snapshot with mutable current entities.

3. **What does lexical search do?**
   It matches indexed textual/metadata fields using deterministic lexical
   behavior. It does not infer synonyms, resolve intent or establish a
   relationship; the exact matching and ranking contract is narrower than
   semantic relevance.

4. **What is knowledge exploration?**
   It is deterministic, one-hop relationship traversal from a publication's
   entities with evidence-backed provenance. It is not arbitrary graph
   analytics or a graph database query language.

5. **Does search update the model?**
   No. Search reads a derived projection built from a publication. Queries
   cannot create evidence, alter candidates, reconcile current knowledge or
   publish a new version.

6. **What is publication currency?**
   Currency compares the document versions supporting a published object
   with the catalogue's authoritative current-document-version pointers. It
   reports whether that lineage agrees with catalogue processing authority,
   not whether the source is factually current.

7. **How is currency calculated?**
   It uses immutable publication lineage and the catalogue pointer/revision:
   matching versions are `CURRENT`; a different current version is `STALE`;
   unavailable or removed/unresolvable current state is `UNKNOWN`. It does
   not consult timestamps, ULID order, filesystem state or scan heuristics.

8. **How are object currency states combined?**
   Currency is derived from an object's own supporting documents; `STALE`
   takes precedence over `UNKNOWN`, which takes precedence over `CURRENT`.
   Relationships are classified from their own provenance and do not inherit
   endpoint entity status.

9. **Does `CURRENT` mean the filesystem was just checked?**
   No. It means the published supporting document version agrees with the
   catalogue's authoritative current-version state. It does not prove that
   a new scan has run or that a file on disk still has those bytes.

10. **Does repository-boundary change affect currency?**
    Not currently by itself. Structural extraction context is frozen for the
    processed document version; current currency is document-version
    currency, not a comparison of live repository topology. Structural
    freshness is explicitly not claimed.

11. **What is a publication diff?**
    It is a deterministic comparison of two publications of the same
    Knowledge Model, identifying added, removed and modified entities and
    relationships. It compares published snapshots, not a publication
    against a live filesystem scan.

12. **Why are diffs derived artifacts?**
    A diff is reproducible from its two immutable inputs and can be rebuilt
    without becoming a second authority. Storing it as a derived artefact
    avoids giving disposable comparison state precedence over the
    publications it describes.

13. **Can a diff say whether a change is good or important?**
    No. It reports structural change according to the versioned comparison
    rules; it does not decide semantic significance, risk, correctness or
    approval.

14. **Can a consumer use latest search results reproducibly?**
    It should first resolve and pin a publication ID, then use that ID for
    search, exploration, diff, currency and export. Re-resolving “latest”
    between requests can select a newer publication.

15. **What happens when a projection is missing or stale?**
    A projection is rebuildable and not authoritative. Projection readiness
    or freshness should be surfaced operationally; a missing projection
    must not be silently treated as an empty authoritative publication.

### Section 8 - Knowledge Model Governance

1. **How do we trust the output?**
   Trust comes from inspectable source lineage, deterministic rules,
   constrained vocabulary, validation, immutable versions and explicit
   limitations—not from a blanket accuracy guarantee. Consumers must set
   acceptance criteria appropriate to their risk.

2. **How can a knowledge claim be audited?**
   Traverse from the published item through its immutable version,
   provenance, evidence, precise locator, document version and source, then
   inspect processor/extractor IDs and versions. Integrity failures are
   explicit rather than repaired from current state.

3. **How can a relationship be explained?**
   Identify its typed direction and endpoints, enumerate its supporting
   evidence and locators, and inspect the extraction definition/version that
   produced it. If those links are absent or inconsistent, it should not be
   accepted as a valid published claim.

4. **Does evidence-backed mean true?**
   No. It means the representation can be traced to a source observation
   and rule. The source may be wrong, stale, incomplete or ambiguous, and the
   extractor may have a defect; provenance enables challenge, not certainty.

5. **What prevents knowledge drift?**
   Versioned definitions, immutable document/evidence history, a current
   processing-authority pointer, reconciliation and immutable publication
   snapshots make changes explicit. These controls expose drift but do not
   guarantee that scans are frequent or every change is covered.

6. **Who verifies or establishes knowledge?**
   Workspace Brain can discover, extract, observe, relate and assert
   candidates. Verification/establishment requires separately governed
   deterministic rules, CI or human action; AI output cannot establish
   itself.

7. **Is publication approval the same as knowledge verification?**
   No. Publication means a model snapshot passed the publication validation
   path. It does not imply a human approved every claim or that all candidates
   have reached an `established` lifecycle state.

8. **How is audit history preserved?**
   Immutable document versions, evidence, candidate contributions,
   publication snapshots and versioned events retain lineage over time.
   Governance actions should record actor, time, reason and object/version;
   the delivered local MVP's trust and identity model is not a complete
   enterprise audit boundary.

9. **Can Workspace Brain provide regulatory compliance by itself?**
   No. Traceability and export can support a compliance process, but
   regulatory sufficiency depends on retention, access control, identity,
   approval, operational controls and jurisdiction-specific obligations not
   implied by this platform.

10. **What are the present trust-boundary limits?**
    The baseline is a single-user local-first deployment whose workstation
    owner and Compose services are one trust domain. Internal NATS traffic is
    trusted and does not require MVP publisher authentication or
    per-subject authorization; this is not a suitable assumption for an
    independently administered or multi-tenant deployment.

11. **How is consumer access governed?**
    Consumers use versioned HTTP/OpenAPI contracts and publication-scoped
    reads rather than direct SQL, NATS or vector-store access. Authentication
    and authorization are pluggable/unfinished relative to a multi-user
    enterprise model and require explicit design before exposure.

12. **How are ambiguous facts governed?**
    The deterministic baseline prefers omission over guessed ownership,
    identity or references and preserves diagnostics where available.
    Ambiguity should be made reviewable; it should not be converted into
    confidence by proximity or by a successful parser run.

13. **How are historical decisions and contracts changed?**
    Accepted ADRs are superseded rather than silently rewritten. A change
    needs evidence, consequences and migration/compatibility analysis;
    proposed ADRs are not production behavior until accepted and implemented.

14. **What must be logged or avoided in logs?**
    Operational logs should carry correlation and resource identifiers,
    processing outcomes and errors. Complete source content, evidence text,
    prompts, model output, vectors, credentials and unnecessary host paths
    should not be logged.

15. **What is needed before enterprise or multi-user use?**
    Revisit authenticated service identity, authorization of source reads and
    processing submissions, NATS accounts/ACLs, tenant and source isolation,
    secret management/rotation, audit requirements and deployment boundaries.
    The local MVP does not claim these controls.

### Section 9 - Future AI Integration

1. **Why was AI not introduced first?**
   The platform first needed clear source authority, stable evidence and
   identity, deterministic extraction, versioned contracts and immutable
   publication. Adding probabilistic output before those boundaries would
   make failures and provenance harder to separate.

2. **How can AI fit later?**
   Through capability-specific provider ports and a candidate pipeline:
   select minimal evidence, request structured output, validate it against a
   versioned schema and evidence IDs, then apply deterministic and/or human
   governance before it can affect accepted knowledge.

3. **Can AI establish facts?**
   No. Under the accepted lifecycle decision, AI output is candidate
   knowledge; it cannot verify, establish or publish itself. Publication
   validation does not convert an AI assertion into independent evidence.

4. **How is hallucination prevented?**
   It cannot be guaranteed away. Risk can be constrained by requiring
   evidence references, validating output shape and IDs, rejecting
   unsupported claims, tracking model/prompt/schema versions and keeping
   candidate and accepted states distinct.

5. **Why keep deterministic extraction if AI exists?**
   Explicit declarations and structures often yield stable, low-cost facts
   with more precise provenance than probabilistic interpretation.
   Deterministic rules provide a baseline, a regression oracle and a way to
   distinguish observed structure from AI-suggested interpretation.

6. **Could AI create candidate knowledge?**
   Yes, as a future capability. The output must be represented as a candidate
   with model/provider, digest, prompt, schema and settings lineage and must
   pass runtime validation and governance before it is eligible for
   reconciliation or publication.

7. **Can AI use source documents directly?**
   A future policy may provide selected, minimal evidence to a provider.
   Source access, data minimization, local/remote routing and disclosure
   rules must be explicit; the model must not get implicit permission to
   browse or modify repositories.

8. **What role could embeddings play?**
   Embeddings could improve similarity-based retrieval or candidate discovery
   as a rebuildable projection. They would not establish entity identity,
   prove a relationship or replace evidence and publication lineage.

9. **What is the role of semantic search?**
   It could complement lexical search for conceptually similar passages, with
   explicit ranking and provenance. Search relevance remains distinct from
   factual support and must not mutate the underlying Knowledge Model.

10. **Why is Qdrant not used yet?**
    Qdrant is included in the broader runtime design for rebuildable vector
    projections, but the delivered search path is lexical and does not
    generate/use embeddings. Introducing it without a governed embedding
    and retrieval contract would add a projection without demonstrated
    capability.

11. **Why is Ollama not used yet?**
    Ollama is the local inference adapter contemplated by the architecture,
    not an active dependency of deterministic discovery, extraction,
    publication or lexical retrieval. The delivered pipeline works without
    a model runtime.

12. **Can AI-generated output be published?**
    Only as data that has passed the same evidence, schema, identity,
    provenance, compatibility and governance requirements as any other
    candidate, with its AI origin visible. AI must not bypass the API's
    catalogue authority or immutable publication process.

13. **How would provider changes remain auditable?**
    Record capability, provider/model identifier, model digest where
    available, prompt and output schema versions, configuration and
    validation outcomes. Capability-specific ports reduce direct coupling to
    Ollama or a single provider, but do not by themselves ensure equivalent
    behavior across providers.

14. **What if an AI provider is unavailable or returns invalid output?**
    The operation should fail or remain a candidate with an explicit
    diagnostic; it must not silently fall back to an ungoverned remote
    provider or fabricate an empty success. Retries and output repair need
    defined bounds and provenance.

15. **What must be decided before introducing AI?**
    Define permitted data and locality, provider identity, candidate status,
    evidence binding, validation and rejection behavior, human/CI authority,
    reproducibility expectations, prompt/model versioning, cost and failure
    handling, retention and security review. “AI enabled” is not a sufficient
    governance policy.

### Section 10 - Technology Decisions

1. **Why TypeScript?**
   TypeScript provides a shared language for API, workers, domain contracts
   and infrastructure adapters in the monorepo, with compile-time checking
   across those boundaries. Static typing is a development control, not
   runtime validation of external events or persisted data.

2. **Why Node.js?**
   Node.js supports the TypeScript service/tooling ecosystem and asynchronous
   filesystem, HTTP and event-driven workloads. It is a pragmatic fit for the
   current local-first composition, not a claim that it is the only suitable
   runtime for all future processing scale.

3. **Why DuckDB?**
   DuckDB supplies an embedded catalogue for the local deployment without
   introducing a separate database service. It is authoritative operational
   catalogue state behind a sole-writer API boundary; the current shared
   connection is serialized, which is a deliberate simplicity and concurrency
   tradeoff rather than a multi-writer scaling design.

4. **Why is DuckDB authoritative but publications also immutable?**
   DuckDB owns current operational inventory, processing authority and
   publication records. The immutable published snapshots inside that
   catalogue define the consumer contract; neither current mutable rows nor
   the database file itself is the source repository's authority.

5. **Why NATS JetStream?**
   It provides durable asynchronous event transport, replay, bounded retries
   and dead-letter handling between the API and workers. It is transport, not
   domain state; consumers must be idempotent and the API remains the sole
   catalogue writer.

6. **What are the tradeoffs of NATS in a local platform?**
   It separates scan/processing work and gives durable asynchronous
   semantics, but introduces another service and operational lifecycle.
   Current inter-service traffic is trusted within the local Compose boundary;
   authentication and subject-level authorization must be revisited before
   that assumption changes.

7. **Why OpenAPI?**
   OpenAPI makes HTTP contracts explicit for the API, explorer and external
   consumers, and separates supported public operations from implementation
   details. Contract versioning and validation remain necessary when fields
   or schema semantics evolve.

8. **Why Docker Compose?**
   Compose provides a repeatable local topology for the API, ingestion and
   knowledge workers, NATS and optional supporting services. It is a
   development/local deployment choice, not proof of production-grade
   orchestration, high availability or tenant isolation.

9. **Why export publications as JSON?**
   A single deterministic UTF-8 JSON document is portable, inspectable and
   consumable without direct database access. Its format version is separate
   from the Knowledge Model schema version; no archive or compression
   container is introduced.

10. **Why no graph database?**
    Current graph-like knowledge is a controlled publication contract over
    entities and relationships; it does not require a graph engine to define
    truth or provenance. A graph store may be considered if measured traversal
    or query needs justify it, while remaining a projection rather than
    silently becoming source authority.

11. **Why no vector database yet?**
    Delivered search is lexical, so vector storage would add operational
    cost without an active embedding/retrieval contract. A future Qdrant
    projection must be reproducible, rebuildable, publication-scoped and
    explicitly non-authoritative.

12. **Why does Qdrant exist in Compose if it is unused?**
    It reflects the broader architecture's planned vector-projection
    capability and permits future integration work. Its presence is not
    evidence that the current platform uses semantic search or depends on
    Qdrant for publication correctness.

13. **Why does Ollama exist in Compose if it is unused?**
    It is the contemplated local provider adapter for future AI capabilities.
    The current deterministic path does not call it; a future deployment
    should be able to disable or omit it when no AI capability is enabled.

14. **Why keep DuckDB, NATS and vector/AI components separate?**
    Each has a distinct ownership: DuckDB stores operational catalogue state,
    NATS transports durable events, Qdrant (if enabled) stores rebuildable
    search projections, and Ollama (if enabled) runs inference. Separation
    prevents a cache, queue or model runtime from becoming accidental domain
    authority.

15. **What technology decision should be revisited first as scale changes?**
    Reassess the single-writer embedded catalogue, local trust assumptions,
    event delivery/operations and deployment topology against measured
    concurrency, throughput, availability and security needs. Avoid replacing
    components solely because they are familiar enterprise defaults.

## Common Architecture Challenges

| Challenge | Architecture response | Residual concern |
|---|---|---|
| Determinism can be mistaken for correctness | Rules, ordering, versions and canonical snapshots make behavior reproducible. | Reproducible extraction can still be wrong or incomplete; quality evidence and review are required. |
| Provenance can be present but too coarse to explain a claim | Require evidence IDs, source/document versions, locators and processor/extractor lineage. | Locator quality depends on each processor and extractor; a path-only explanation is insufficient. |
| Immutable publications can become stale | Keep historic snapshots fixed and calculate read-only currency against catalogue pointers. | Currency is not live filesystem freshness and does not cover structural-boundary changes. |
| A lexical projection can be confused with authoritative knowledge | Scope it to publications and treat it as disposable/rebuildable. | Operational readiness and projection freshness still need observability. |
| More extractors can cause vocabulary sprawl | Use registered plugins, controlled types/verbs, tests and ADR review for contract changes. | Governance cannot be delegated solely to plugin mechanics; domain owners must review semantics. |
| Nested repositories can confuse ownership | Freeze discovered boundaries per processed document version and require segment-aligned explicit support. | Full workspace selection and repository hierarchy remain beyond the accepted Slice 9 subset. |
| Local-first trust can be mistaken for security isolation | Read-only mounts, bounded path access and sole-writer persistence constrain normal operation. | Host owner and Compose peers are trusted; current NATS traffic is not authenticated as hostile-principal traffic. |
| AI can blur observed and inferred claims | Keep AI as a versioned candidate producer; validate evidence and require governance. | Validation does not guarantee truth, and AI policy/provider controls are future work. |
| Centralized persistence may limit throughput | Serialize operations on the shared DuckDB connection and retain one writer. | This favors correctness and simplicity over multi-writer concurrency; workload limits should be measured. |
| Source movement breaks naïve identity assumptions | Treat relocation as removal plus addition unless explicit identity evidence exists. | Consumers needing move continuity require a separately designed, auditable reconciliation policy. |

## Common Misunderstandings

- **“A Knowledge Model is the source of truth.”** It is a derived, versioned
  representation; repositories and documents remain authoritative.
- **“A publication means a human approved every statement.”** Publication
  means the snapshot passed its platform validation path, not that every item
  is human-verified or established.
- **“Evidence-backed means true.”** It means traceable to a source observation
  and rule; the source and interpretation can still be wrong.
- **“Current currency means the filesystem was scanned just now.”** Currency
  compares publication lineage with catalogue processing-authority pointers,
  not with live file contents.
- **“Nested directory means nested repository.”** Only a qualifying,
  discovered Git boundary establishes a repository under the accepted rules.
- **“A reference is a dependency.”** `REFERENCES` is not `DEPENDS_ON`; edge
  direction and vocabulary have defined meanings.
- **“The relationship graph makes this a graph database.”** The data model can
  contain relationships without a graph database product or authoritative
  graph store.
- **“Search is RAG.”** The delivered search is lexical and publication-scoped;
  no embedding, semantic retrieval or answer-generation path is delivered.
- **“Qdrant and Ollama are active because they are in Compose.”** They are
  present for the broader architecture but unused by delivered knowledge
  generation and search.
- **“An extractor plugin can assert any new concept.”** Plugins are bounded by
  evidence, vocabulary, provenance and publication contracts; new semantics
  require review.
- **“A changed extractor rewrites old facts.”** Accepted contributions and
  publications are immutable; changed behavior requires a new version and
  reprocessing.
- **“ADR-025 describes current runtime behavior.”** It is a proposal; accepted
  and implemented scope is documented separately, notably in ADR-026 and the
  Slice 9 report.
- **“Local-first means enterprise-secure by default.”** The baseline trusts
  the workstation owner and Compose peers and is not a multi-user isolation
  boundary.

## Questions Architects Should Ask

1. Which source roots and file types are actually in scope, and how are
   exclusions, inaccessible paths and incomplete scans reported?
2. For every published relationship, can we identify the exact evidence,
   locator, extractor version and endpoint-identity rule?
3. Are extractor false positives and false negatives measured against
   representative, independently reviewed fixtures?
4. Which knowledge types and relationship verbs are accepted in each schema
   version, and who approves semantic changes?
5. Are consumers pinning publication IDs, verifying hashes and handling
   schema-version changes explicitly?
6. What does a `CURRENT`, `STALE` or `UNKNOWN` currency result mean for the
   consumer's risk decision, and what freshness does it not claim?
7. What operational mechanism rebuilds lexical projections, and how are
   projection readiness and lag surfaced?
8. What happens when event delivery is duplicated, delayed or replayed, and
   how is idempotency verified at the catalogue boundary?
9. Is single-user local trust still valid for the proposed deployment? If
   not, what authenticated identities, authorization, tenant isolation and
   audit controls are required before deployment?
10. Which extracted candidates need human or CI review before downstream
    systems can treat them as established?
11. What exact data may be sent to any future AI provider, how is provider
    routing governed, and can remote fallback occur?
12. How will changed processing definitions trigger bounded reprocessing,
    preserve history and establish current authority without ambiguous
    backfill?
13. How are source moves and nested-boundary changes represented without
    guessing continuity or claiming unsupported structural currency?
14. Which APIs expose operational current state versus immutable published
    knowledge, and are those differences visible to consumers?
15. What scale, concurrency, recovery-time and recovery-point evidence would
    justify revisiting DuckDB, NATS or Compose rather than adding complexity
    pre-emptively?

## Questions Workspace Brain Should Be Able To Answer

For an architect to rely on the platform, the product and its operators should
be able to answer these questions with queryable records, tests, operational
evidence or a clear “not currently supported”:

- Which configured source, root, workspace scope and scan produced this
  document or repository inventory item?
- What fingerprint and document version were processed, and which version is
  the catalogue currently treating as authoritative?
- Which processor, extraction rule, knowledge extractor and versions
  produced this evidence and candidate?
- What exact source locator and frozen structural context support this entity
  or relationship?
- Which candidate claims were rejected, omitted as ambiguous, or diagnosed,
  and why?
- Which immutable publication contains this object, which schema version
  applies, and what is its verifiable content hash?
- Can the publication be exported and re-read without consulting mutable
  entity rows or search projections?
- What changed between two publications of the same model, and which
  published versions were compared?
- What is the currency of every published object against catalogue pointers,
  which support documents determine it, and why is any result `STALE` or
  `UNKNOWN`?
- Which search or exploration request used which publication, and what
  evidence backs each returned result or traversed relationship?
- Which extractor definitions and vocabulary changes have passed the
  required tests and architecture review?
- Which security and operational assumptions apply to this deployment, and
  which capabilities are explicitly absent?
- If AI is enabled in a future release, which provider/model/prompt/schema
  generated a candidate, what evidence did it cite, and who or what accepted
  it?

If the platform cannot answer one of these questions today, the limitation
should be stated plainly rather than inferred from a successful scan,
publication, export or search response.
