import {
  runtimeHeartbeatSubject,
  type RuntimeComponentStatus,
} from '@workspace-brain/domain';

export type ComponentDefinition = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly runtime: string;
  readonly service?: string;
  readonly image: string;
  readonly imageOrigin: 'built locally' | 'downloaded' | 'not a Docker image';
  readonly ports: readonly string[];
  readonly responsibility: string;
  readonly optional?: boolean;
  readonly configuredHealthCheck?: string;
};

export const COMPONENTS: readonly ComponentDefinition[] = [
  {
    id: 'explorer',
    name: 'Explorer UI',
    kind: 'User interface',
    runtime:
      'Browser tab; served by a separate local Vite process in development',
    image: 'None',
    imageOrigin: 'not a Docker image',
    ports: ['5173 dev', '4173 preview'],
    responsibility: 'Explores published knowledge through the read-only API.',
  },
  {
    id: 'api',
    name: 'Workspace Brain API',
    kind: 'HTTP API and catalogue owner',
    runtime: 'Docker Compose',
    service: 'workspace-brain-api',
    image: 'Compose-generated local image (name depends on Compose project)',
    imageOrigin: 'built locally',
    ports: ['127.0.0.1:3000 → container 3000'],
    responsibility:
      'Registers configured sources, owns DuckDB writes, publishes knowledge and serves read-only knowledge APIs.',
    configuredHealthCheck:
      'Compose checks /health; API /ready checks the catalogue, not NATS or workers.',
  },
  {
    id: 'ingestion',
    name: 'Ingestion worker',
    kind: 'Filesystem scanner',
    runtime: 'Docker Compose',
    service: 'ingestion-worker',
    image: 'Compose-generated local image (name depends on Compose project)',
    imageOrigin: 'built locally',
    ports: [],
    responsibility:
      'Scans registered, read-only source roots and serves bounded document-content requests.',
  },
  {
    id: 'knowledge',
    name: 'Knowledge worker',
    kind: 'Deterministic processor',
    runtime: 'Docker Compose',
    service: 'knowledge-worker',
    image: 'Compose-generated local image (name depends on Compose project)',
    imageOrigin: 'built locally',
    ports: [],
    responsibility:
      'Processes supported files and extracts evidence-backed candidates using repository code, not AI reasoning.',
  },
  {
    id: 'nats',
    name: 'NATS JetStream',
    kind: 'Event backbone',
    runtime: 'Docker Compose',
    service: 'nats',
    image: 'nats:2.10-alpine',
    imageOrigin: 'downloaded',
    ports: ['127.0.0.1:4222 → client 4222', '127.0.0.1:8222 → monitor 8222'],
    responsibility:
      'Carries durable JetStream events and ephemeral request/reply operations between API and workers.',
  },
  {
    id: 'librechat',
    name: 'LibreChat + embedded MCP',
    kind: 'Optional consumer',
    runtime: 'Docker Compose profile: librechat',
    service: 'librechat',
    image: 'workspace-brain-librechat:local',
    imageOrigin: 'built locally',
    ports: ['127.0.0.1:3080 → container 3080'],
    responsibility:
      'LibreChat launches the MCP server as a child process; MCP reads published knowledge from the API.',
    optional: true,
    configuredHealthCheck:
      'Compose checks /health inside the container; not exposed to Explorer.',
  },
  {
    id: 'mongo',
    name: 'LibreChat MongoDB',
    kind: 'Optional chat data store',
    runtime: 'Docker Compose profile: librechat',
    service: 'librechat-mongo',
    image: 'mongo:7.0',
    imageOrigin: 'downloaded',
    ports: ['Container-only: 27017'],
    responsibility:
      'Stores LibreChat accounts and conversations; not used by deterministic knowledge production.',
    optional: true,
    configuredHealthCheck:
      'Compose runs mongosh db.adminCommand(ping); not exposed to Explorer.',
  },
  {
    id: 'qdrant',
    name: 'Qdrant',
    kind: 'Optional semantic-search service',
    runtime: 'Docker Compose',
    service: 'qdrant',
    image: 'qdrant/qdrant:v1.15.4',
    imageOrigin: 'downloaded',
    ports: ['127.0.0.1:6333 → HTTP 6333', '127.0.0.1:6334 → gRPC 6334'],
    responsibility:
      'Optional semantic-search projection; not required for deterministic publication.',
    optional: true,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'Optional model runtime',
    runtime: 'Docker Compose',
    service: 'ollama',
    image: 'ollama/ollama:latest',
    imageOrigin: 'downloaded',
    ports: ['127.0.0.1:11434 → container 11434'],
    responsibility:
      'Optional local model runtime; not part of discovery, extraction, publication or health decisions.',
    optional: true,
  },
];

export type NatsOperation = {
  readonly subject: string;
  readonly publisher: string;
  readonly subscriber: string;
  readonly purpose: string;
  readonly transport:
    | 'JetStream durable event'
    | 'Core NATS request/reply'
    | 'Core NATS ephemeral message';
  readonly acknowledgement: string;
};

export const NATS_OPERATIONS: readonly NatsOperation[] = [
  {
    subject: runtimeHeartbeatSubject,
    publisher: 'API and NATS-connected workers',
    subscriber: 'Workspace Brain API Runtime Registry',
    purpose:
      'Publishes transient process liveness signals for the runtime registry.',
    transport: 'Core NATS ephemeral message',
    acknowledgement:
      'No persistence or acknowledgement; latest signal is kept in API memory.',
  },
  {
    subject: 'workspace.catalogue.discovery.sources',
    publisher: 'Ingestion worker',
    subscriber: 'Workspace Brain API',
    purpose:
      'Pages through the API-registered source list before each scan cycle.',
    transport: 'Core NATS request/reply',
    acknowledgement: 'Ephemeral response; no stream persistence or ack.',
  },
  {
    subject: 'workspace.discovery.source.scan.requested',
    publisher: 'Ingestion worker',
    subscriber: 'Ingestion worker',
    purpose: 'Requests a scan for a registered source.',
    transport: 'JetStream durable event',
    acknowledgement:
      'Durable consumer workspace-ingestion-scan-requested; explicit ack after handling.',
  },
  {
    subject: 'workspace.discovery.source.scan.started',
    publisher: 'Ingestion worker',
    subscriber: 'Workspace Brain API',
    purpose: 'Records that a source scan began.',
    transport: 'JetStream durable event',
    acknowledgement: 'API durable consumer workspace-api-source-scan-started.',
  },
  {
    subject: 'workspace.discovery.source.inventory.submitted',
    publisher: 'Ingestion worker',
    subscriber: 'Workspace Brain API',
    purpose:
      'Submits the discovered repository and document inventory for validation and change classification.',
    transport: 'JetStream durable event',
    acknowledgement:
      'API durable consumer workspace-api-source-inventory-submitted.',
  },
  {
    subject: 'workspace.discovery.source.scan.failed',
    publisher: 'Ingestion worker',
    subscriber: 'Workspace Brain API',
    purpose: 'Records a failed filesystem scan.',
    transport: 'JetStream durable event',
    acknowledgement: 'API durable consumer workspace-api-source-scan-failed.',
  },
  {
    subject: 'workspace.discovery.source.scan.completed',
    publisher: 'Workspace Brain API',
    subscriber: 'No durable consumer registered',
    purpose: 'Records completed catalogue-side source inventory persistence.',
    transport: 'JetStream durable event',
    acknowledgement: 'Output event; no application subscriber is registered.',
  },
  {
    subject: 'workspace.discovery.dead-letter',
    publisher: 'NATS adapter after five handler failures',
    subscriber: 'No dead-letter consumer registered',
    purpose:
      'Stores exhausted event deliveries with failure metadata and the original payload.',
    transport: 'JetStream durable event',
    acknowledgement:
      'Published to the WORKSPACE_DISCOVERY stream; source delivery is acked after dead-letter publication.',
  },
  {
    subject: 'workspace.discovery.repository.discovered',
    publisher: 'Workspace Brain API',
    subscriber: 'No durable consumer registered',
    purpose:
      'Records a newly discovered repository during API-side inventory classification.',
    transport: 'JetStream durable event',
    acknowledgement: 'Output events; no application subscriber is registered.',
  },
  {
    subject: 'workspace.discovery.repository.modified',
    publisher: 'Workspace Brain API',
    subscriber: 'No durable consumer registered',
    purpose:
      'Records a modified repository during API-side inventory classification.',
    transport: 'JetStream durable event',
    acknowledgement: 'Output event; no application subscriber is registered.',
  },
  {
    subject: 'workspace.discovery.repository.removed',
    publisher: 'Workspace Brain API',
    subscriber: 'No durable consumer registered',
    purpose:
      'Records a removed repository during API-side inventory classification.',
    transport: 'JetStream durable event',
    acknowledgement: 'Output event; no application subscriber is registered.',
  },
  {
    subject: 'workspace.discovery.document.discovered',
    publisher: 'Workspace Brain API',
    subscriber: 'Knowledge worker',
    purpose:
      'Starts processing newly discovered or changed supported documents.',
    transport: 'JetStream durable event',
    acknowledgement:
      'Durable consumer workspace-knowledge-document-discovered.',
  },
  {
    subject: 'workspace.discovery.document.modified',
    publisher: 'Workspace Brain API',
    subscriber: 'Knowledge worker',
    purpose:
      'Starts processing a changed supported document after inventory classification.',
    transport: 'JetStream durable event',
    acknowledgement: 'Durable consumer workspace-knowledge-document-modified.',
  },
  {
    subject: 'workspace.discovery.document.removed',
    publisher: 'Workspace Brain API',
    subscriber: 'No durable consumer registered',
    purpose:
      'Records removal classification; the catalogue applies its removal handling during scan persistence.',
    transport: 'JetStream durable event',
    acknowledgement: 'Output event; no application subscriber is registered.',
  },
  {
    subject: 'workspace.ingestion.document.read',
    publisher: 'Knowledge worker',
    subscriber: 'Ingestion worker',
    purpose:
      'Reads source content in bounded chunks after verifying the discovered content fingerprint.',
    transport: 'Core NATS request/reply',
    acknowledgement: 'Ephemeral response; no stream persistence or ack.',
  },
  {
    subject: 'workspace.processing.document.submitted',
    publisher: 'Knowledge worker',
    subscriber: 'Workspace Brain API',
    purpose: 'Submits deterministic processor evidence for catalogue storage.',
    transport: 'JetStream durable event',
    acknowledgement:
      'API durable consumer workspace-api-document-processing-submitted.',
  },
  {
    subject: 'workspace.processing.document.extracted',
    publisher: 'Workspace Brain API',
    subscriber: 'Knowledge worker',
    purpose:
      'Signals stored document evidence for deterministic knowledge extraction.',
    transport: 'JetStream durable event',
    acknowledgement: 'Durable consumer workspace-knowledge-document-extracted.',
  },
  {
    subject: 'workspace.catalogue.knowledge.document-evidence',
    publisher: 'Knowledge worker',
    subscriber: 'Workspace Brain API',
    purpose:
      'Pages persisted evidence and extraction context for the requested document version.',
    transport: 'Core NATS request/reply',
    acknowledgement: 'Ephemeral response; no stream persistence or ack.',
  },
  {
    subject: 'workspace.knowledge.candidates.submitted',
    publisher: 'Knowledge worker',
    subscriber: 'Workspace Brain API',
    purpose:
      'Submits deterministically extracted knowledge candidates with source provenance.',
    transport: 'JetStream durable event',
    acknowledgement:
      'API durable consumer workspace-api-knowledge-candidates-submitted.',
  },
  {
    subject: 'workspace.knowledge.entity.discovered',
    publisher: 'Workspace Brain API',
    subscriber: 'No durable consumer registered',
    purpose: 'Records a knowledge entity added from validated candidates.',
    transport: 'JetStream durable event',
    acknowledgement: 'Output events; no application subscriber is registered.',
  },
  {
    subject: 'workspace.knowledge.entity.superseded',
    publisher: 'Workspace Brain API',
    subscriber: 'No durable consumer registered',
    purpose: 'Records a knowledge entity lifecycle supersession.',
    transport: 'JetStream durable event',
    acknowledgement: 'Output event; no application subscriber is registered.',
  },
  {
    subject: 'workspace.knowledge.relationship.discovered',
    publisher: 'Workspace Brain API',
    subscriber: 'No durable consumer registered',
    purpose:
      'Records a knowledge relationship added from validated candidates.',
    transport: 'JetStream durable event',
    acknowledgement: 'Output event; no application subscriber is registered.',
  },
  {
    subject: 'workspace.knowledge.relationship.superseded',
    publisher: 'Workspace Brain API',
    subscriber: 'No durable consumer registered',
    purpose: 'Records a knowledge relationship lifecycle supersession.',
    transport: 'JetStream durable event',
    acknowledgement: 'Output events; no application subscriber is registered.',
  },
  {
    subject: 'workspace.knowledge.model.published',
    publisher: 'Workspace Brain API',
    subscriber: 'Workspace Brain API',
    purpose:
      'Triggers the API-owned search projection to be requested after publication.',
    transport: 'JetStream durable event',
    acknowledgement:
      'API durable consumer workspace-api-search-projection-publication.',
  },
  {
    subject: 'workspace.search.projection.requested',
    publisher: 'Workspace Brain API',
    subscriber: 'Workspace Brain API',
    purpose:
      'Requests and records construction of the rebuildable publication search projection.',
    transport: 'JetStream durable event',
    acknowledgement:
      'API durable consumer workspace-api-search-projection-requested; the API catalogue handles projection construction.',
  },
  {
    subject: 'workspace.search.projection.built',
    publisher: 'Workspace Brain API',
    subscriber: 'No subscriber registered',
    purpose:
      'Records a completed search-projection build; this is an output event, not a metric endpoint.',
    transport: 'JetStream durable event',
    acknowledgement:
      'No current consumer; event remains subject to stream retention.',
  },
];

export type TroubleshootingGuidance = {
  readonly title: string;
  readonly explanation: string;
  readonly commands: readonly string[];
};

export function getTroubleshootingGuidance(
  observation: RuntimeComponentStatus | undefined,
  stale = false,
  endpointUnavailable = false,
): TroubleshootingGuidance {
  if (stale) {
    return {
      title: 'The runtime snapshot is stale',
      explanation:
        'The registry request failed. The last successful component snapshot is shown as stale and must not be treated as current.',
      commands: ['curl -i http://localhost:3000/runtime/status', 'make status'],
    };
  }
  if (endpointUnavailable) {
    return {
      title: 'Explorer cannot reach the runtime registry',
      explanation:
        'The runtime status endpoint could not be reached; no component is marked offline because of the request failure.',
      commands: [
        'make status',
        'make start-api',
        'docker compose -f deploy/compose/compose.yaml logs --tail=100 workspace-brain-api',
      ],
    };
  }
  if (observation?.status === 'offline') {
    return {
      title: `${observation.componentName} is offline`,
      explanation:
        'The latest heartbeat is older than the configured offline threshold. Confirm the process and its NATS connectivity.',
      commands: [
        'make status',
        'make logs',
        'curl -fsS http://localhost:3000/runtime/status',
      ],
    };
  }
  if (observation?.status === 'degraded') {
    return {
      title: `${observation.componentName} is degraded`,
      explanation:
        'Its latest heartbeat is between the degraded and offline thresholds. Check the component logs and its NATS connection.',
      commands: ['curl -fsS http://localhost:3000/runtime/status', 'make logs'],
    };
  }
  return {
    title: 'Runtime component states are available',
    explanation:
      'Heartbeats and the API NATS connection are observable. Healthy status does not imply a worker is currently processing a job.',
    commands: [
      'curl -fsS http://localhost:3000/runtime/status',
      'make status',
      'make logs',
      'docker compose -f deploy/compose/compose.yaml logs --tail=100 nats',
    ],
  };
}
