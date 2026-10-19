# Runtime observability

Workspace Brain runtime state is transient operational data, separate from the
evidence-backed Knowledge Model and publication lifecycle.

## Flow and contract

The API and NATS-connected workers publish version 1 JSON heartbeats on the
ephemeral Core NATS subject `workspace.runtime.heartbeat`. The event contains
the component identity, process instance ID, version, process start time,
uptime, event timestamp, and optional bounded public metadata. It is not stored
in JetStream or in the catalogue.

The API validates each event, retains the newest timestamp per
`componentId + instanceId` in memory, and calculates status when
`GET /runtime/status` is called. NATS status is derived separately from the
API's NATS connection lifecycle; it is not inferred from historical component
heartbeats. Explorer reads only the REST endpoint and refreshes it every 15
seconds. The runtime page also reads repository-inventory and latest
publication facts from the existing knowledge API; these are not inferred
from heartbeat metadata.

The expected runtime component list lives in the shared domain runtime
contract. Expected API and worker components with no heartbeat are `unknown`.
An observed component becomes `offline` after its heartbeat expires. Components
not in the expected list are still included when discovered. Current
NATS-connected heartbeat publishers are the API, ingestion worker, and
knowledge worker. MCP is not listed as a heartbeat publisher because its
current process boundary reads through the HTTP API and does not connect to
NATS.

## Status and stale data

Default age thresholds use the timestamp in the latest heartbeat:

| Status | Meaning |
| --- | --- |
| `healthy` | Heartbeat age is less than 30 seconds. |
| `degraded` | Age is 30 through 90 seconds, inclusive. |
| `offline` | Age is greater than 90 seconds after an instance was observed. |
| `unknown` | An expected component has not been observed, or the API has no NATS connection signal yet. |

Explorer's `Stale` label describes the page snapshot, not the component. It
appears when a refresh fails after a successful response. A first request
failure is shown as “Runtime registry endpoint unavailable”; it does not mark
components offline. An unknown component has never been observed by the current
API process; an offline component was observed before but stopped renewing its
heartbeat.

## Registering another component

Use the existing `@workspace-brain/nats` `createHeartbeatPublisher` from a
process that already owns a NATS connection. Pass a stable component ID, a
unique instance ID for the process lifetime, its public version, and only a
small component-owned metadata callback. Start it after connecting to NATS and
stop it before closing the NATS bus. The publisher sends immediately, repeats
at the configured interval, avoids overlapping metadata/publication work, and
resumes when the connection recovers. It does not fail the process when an
individual heartbeat publish fails.

Metadata is limited to 4 KiB of JSON. The publisher and API reject non-JSON,
oversized, and credential-like metadata keys. Do not include credentials,
tokens, connection strings, source code, or environment values. Explorer
deliberately renders only known public keys such as `queueDepth`,
`repositoriesIndexed`, `publicationCount`, `journeyCount`, and
`lastPublication`.

## Configuration

Defaults are safe for local development and are validated once by the shared
configuration package:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `RUNTIME_HEARTBEAT_ENABLED` | `true` | Enables publishers in the API and workers. |
| `RUNTIME_HEARTBEAT_INTERVAL_MS` | `15000` | Publisher interval. |
| `RUNTIME_DEGRADED_AFTER_MS` | `30000` | Heartbeat age at which a component becomes degraded. Must exceed the interval. |
| `RUNTIME_OFFLINE_AFTER_MS` | `90000` | Heartbeat age after which an observed component becomes offline. Must exceed the degraded threshold. |
| `RUNTIME_INSTANCE_ID` | generated per process | Optional process instance ID override. Set distinct values when manually running multiple instances of one component. |

The API reports configured thresholds in seconds in the REST response. A
configuration with invalid integer values or unordered thresholds fails at
process startup.

## Local diagnosis

Run the backend using the [local runtime guide](../local-development.md). Then:

```sh
curl -fsS http://localhost:3000/runtime/status
```

To observe a worker heartbeat age transition, stop just the ingestion worker:

```sh
docker compose -f deploy/compose/compose.yaml stop ingestion-worker
sleep 35
curl -fsS http://localhost:3000/runtime/status
sleep 60
curl -fsS http://localhost:3000/runtime/status
docker compose -f deploy/compose/compose.yaml start ingestion-worker
sleep 2
curl -fsS http://localhost:3000/runtime/status
```

With default thresholds, the first snapshot should show `degraded`, the next
should show `offline`, and the restarted worker should return to `healthy`
after its immediate heartbeat. Use `make status` and worker logs if it does
not recover.

NATS health uses the live API client connection:

```sh
docker compose -f deploy/compose/compose.yaml stop nats
sleep 2
curl -fsS http://localhost:3000/runtime/status
docker compose -f deploy/compose/compose.yaml start nats
sleep 5
curl -fsS http://localhost:3000/runtime/status
```

NATS should be `offline` while disconnected and healthy after reconnection.
Worker heartbeats may become stale during the interruption and return to
healthy after their publishers reconnect. These commands stop and start
services without deleting persistent data.
