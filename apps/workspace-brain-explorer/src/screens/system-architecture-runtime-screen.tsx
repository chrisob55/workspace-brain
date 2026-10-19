import {
  ArrowDown,
  ArrowRight,
  Clock3,
  Database,
  ExternalLink,
  HardDrive,
  RefreshCw,
  Server,
  Signal,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type {
  RuntimeComponentState,
  RuntimeComponentStatus,
} from '@workspace-brain/domain';

import { ScreenHeader } from '../components/story';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import {
  COMPONENTS,
  NATS_OPERATIONS,
  getTroubleshootingGuidance,
} from '../lib/operational-architecture';
import { useRuntimeKnowledgeFacts } from '../lib/queries';
import {
  summarizeRuntime,
  useRuntimeStatus,
  type RuntimeDashboardState,
} from '../lib/runtime-status';
import { cn } from '../lib/utils';

const FLOW_STEPS = [
  {
    title: 'Register the configured source',
    text: 'At API startup, the API validates config/workspace-brain.yaml and registers its source roots and workspace rules in the catalogue. The YAML is a startup snapshot, not hot-reloaded.',
    tag: 'API startup',
  },
  {
    title: 'Discover repositories and files',
    text: 'Ingestion lists registered sources over NATS request/reply on startup and every SCAN_INTERVAL_MS (default 300000 ms). It scans the read-only /sources mount; there is no filesystem watcher. Inventory is submitted to the API, which validates root boundaries and classifies additions, changes and removals. A successful scan submits SourceInventorySubmitted; a scan error submits SourceScanFailed. There is no single cross-pipeline completion endpoint.',
    tag: 'Ingestion worker',
  },
  {
    title: 'Read and process changed documents',
    text: 'The API emits discovered/modified document events. The knowledge worker asks ingestion for file-content chunks over request/reply, verifies the content fingerprint, then runs the deterministic document processor and submits evidence to the API.',
    tag: 'Knowledge worker',
  },
  {
    title: 'Extract evidence-backed knowledge',
    text: 'The API stores document evidence and emits DocumentExtracted. The knowledge worker reads the stored evidence and applies deterministic extractors; it submits candidates with provenance. No AI reasoning is used to discover, extract, publish or set health.',
    tag: 'Knowledge worker',
  },
  {
    title: 'Publish and build search projection',
    text: 'The API applies candidates and owns publication writes. A Knowledge Model publication is generated when candidate application changes the model; unchanged candidates do not imply a new publication. Publication events trigger API-owned, rebuildable search projection work. Reprocessing submits documents again; it does not rebuild images.',
    tag: 'API + catalogue',
  },
  {
    title: 'Consume the immutable publication',
    text: 'Explorer reads published knowledge from the HTTP API. LibreChat starts the MCP server inside its own container; MCP also reads through the API. A source or configuration entry alone is not a publication.',
    tag: 'Explorer + MCP',
  },
];

const STATUS_LABELS: Record<RuntimeComponentState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  offline: 'Offline',
  unknown: 'Unknown',
};

const STATUS_CLASSES: Record<RuntimeComponentState, string> = {
  healthy: 'text-emerald-700 dark:text-emerald-300',
  degraded: 'text-amber-700 dark:text-amber-300',
  offline: 'text-destructive',
  unknown: 'text-muted-foreground',
};

type ComponentCardProps = {
  readonly component: RuntimeComponentStatus;
  readonly instanceCount: number;
  readonly stale: boolean;
};

function ComponentCard({
  component,
  instanceCount,
  stale,
}: ComponentCardProps) {
  const label = STATUS_LABELS[component.status];
  const knownMetadata: Readonly<Record<string, string>> = {
    queueDepth: 'Queue depth',
    repositoriesIndexed: 'Repositories indexed',
    publicationCount: 'Publications generated',
    journeyCount: 'Journey models',
    lastPublication: 'Last publication',
  };
  const metadata = Object.entries(component.metadata ?? {}).filter(
    ([key, value]) =>
      key in knownMetadata &&
      (typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'),
  );

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {component.componentName}
            </CardTitle>
            <CardDescription className="mt-1">
              {component.componentType}
            </CardDescription>
          </div>
          <span
            className={cn(
              'text-xs font-medium',
              STATUS_CLASSES[component.status],
            )}
            aria-label={`${label} status for ${component.componentName}`}
          >
            {label}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-xs sm:grid-cols-[7rem_1fr]">
          {instanceCount > 1 && component.instanceId !== 'not-observed' && (
            <>
              <dt className="text-muted-foreground">Instance</dt>
              <dd className="break-all font-mono">{component.instanceId}</dd>
            </>
          )}
          {component.version !== undefined && (
            <>
              <dt className="text-muted-foreground">Version</dt>
              <dd>{component.version}</dd>
            </>
          )}
          {component.uptimeSeconds !== undefined && (
            <>
              <dt className="text-muted-foreground">Uptime</dt>
              <dd>{formatUptime(component.uptimeSeconds)}</dd>
            </>
          )}
          {component.timestamp !== undefined && (
            <>
              <dt className="text-muted-foreground">
                {component.source === 'heartbeat'
                  ? 'Last heartbeat'
                  : 'Last connection signal'}
              </dt>
              <dd>
                <time
                  dateTime={component.timestamp}
                  title={formatTimestamp(component.timestamp)}
                >
                  {component.ageSeconds === undefined
                    ? 'Not available'
                    : `${formatAge(component.ageSeconds)} ago`}
                </time>
              </dd>
            </>
          )}
          {component.ageSeconds !== undefined && (
            <>
              <dt className="text-muted-foreground">Signal age</dt>
              <dd>{formatAge(component.ageSeconds)}</dd>
            </>
          )}
          {metadata.map(([key, value]) => (
            <div className="contents" key={key}>
              <dt className="text-muted-foreground">{knownMetadata[key]}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
        {component.status === 'unknown' && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs">
            No heartbeat has been observed for this expected component.
          </p>
        )}
        {stale && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs">
            Snapshot is stale; this status may have changed since it was last
            refreshed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function formatAge(seconds: number) {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function RuntimeStatusPanel({
  runtime,
}: {
  readonly runtime: RuntimeDashboardState;
}) {
  const components = runtime.snapshot?.components ?? [];
  const thresholds = runtime.snapshot?.thresholds ?? {
    degradedAfterSeconds: 30,
    offlineAfterSeconds: 90,
  };
  const countsByComponent = new Map<string, number>();
  for (const component of components) {
    countsByComponent.set(
      component.componentId,
      (countsByComponent.get(component.componentId) ?? 0) + 1,
    );
  }
  const groups = new Map<string, typeof components>();
  for (const component of components) {
    const group = groups.get(component.componentType) ?? [];
    groups.set(component.componentType, [...group, component]);
  }

  return (
    <section aria-labelledby="runtime-status-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Signal className="size-5 text-primary" aria-hidden="true" />
            <h2 id="runtime-status-heading" className="text-xl font-semibold">
              What&apos;s Running, Where?
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Live status comes from component heartbeats and the API&apos;s NATS
            connection state; it is independent of container platforms.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={runtime.refresh}
          disabled={runtime.refreshing}
          aria-label="Refresh runtime status"
        >
          <RefreshCw
            className={cn('size-4', runtime.refreshing && 'animate-spin')}
            aria-hidden="true"
          />
          {runtime.refreshing ? 'Checking…' : 'Refresh'}
        </Button>
      </div>

      <Card
        aria-live="polite"
        aria-busy={runtime.loading || runtime.refreshing}
      >
        <CardContent className="grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">Operational interpretation</span>
              {runtime.stale && <Badge variant="secondary">Stale</Badge>}
            </div>
            <p className="mt-2 text-sm leading-relaxed">
              {summarizeRuntime(runtime)}
            </p>
            {runtime.refreshError && (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                {runtime.refreshError}
              </p>
            )}
          </div>
          <div className="text-sm text-muted-foreground md:text-right">
            <div className="flex items-center gap-1.5 md:justify-end">
              <Clock3 className="size-4" aria-hidden="true" />
              <span>Last successful refresh</span>
            </div>
            <p className="mt-1">
              {runtime.lastRefreshAt
                ? formatTimestamp(runtime.lastRefreshAt)
                : 'Not yet checked'}
            </p>
            <p className="mt-1 text-xs">Automatic refresh every 15 seconds</p>
          </div>
        </CardContent>
      </Card>

      {runtime.endpointUnavailable && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 p-4 text-sm"
        >
          Runtime registry endpoint unavailable. Component statuses are not
          available; this does not mean every component is offline.
        </div>
      )}
      {[...groups.entries()].map(([groupName, groupComponents]) => (
        <section key={groupName} aria-label={`${groupName} runtime components`}>
          <h3 className="mb-3 text-lg font-semibold">{groupName}</h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {groupComponents.map((component) => (
              <ComponentCard
                key={`${component.componentId}:${component.instanceId}`}
                component={component}
                instanceCount={
                  countsByComponent.get(component.componentId) ?? 1
                }
                stale={runtime.stale}
              />
            ))}
          </div>
        </section>
      ))}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            How to interpret runtime states
          </CardTitle>
          <CardDescription>
            Component state comes from the age of its latest heartbeat; NATS
            state comes from the API client connection.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <StateMeaning
            state="Healthy"
            meaning={`The latest heartbeat is less than ${thresholds.degradedAfterSeconds} seconds old.`}
          />
          <StateMeaning
            state="Degraded"
            meaning={`The latest heartbeat is ${thresholds.degradedAfterSeconds} through ${thresholds.offlineAfterSeconds} seconds old, inclusive.`}
          />
          <StateMeaning
            state="Offline"
            meaning={`A previously observed component has a heartbeat older than ${thresholds.offlineAfterSeconds} seconds.`}
          />
          <StateMeaning
            state="Unknown"
            meaning="The component is expected, but no heartbeat has ever been observed by this API process."
          />
          <StateMeaning
            state="Stale snapshot"
            meaning="The registry request failed after an earlier success. Displayed states are old and are not reinterpreted as current."
          />
        </CardContent>
      </Card>
    </section>
  );
}

function StateMeaning({
  state,
  meaning,
}: {
  readonly state: string;
  readonly meaning: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <h3 className="font-medium">{state}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {meaning}
      </p>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform architecture</CardTitle>
        <CardDescription>
          The API owns registration and catalogue writes; workers communicate
          through NATS; consumers read published knowledge through the API.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="img"
          aria-label="Architecture: configured filesystem sources are scanned by the ingestion worker. The API and workers exchange events and content through NATS JetStream and request/reply. The API stores deterministic evidence and immutable knowledge publications, which Explorer and the MCP server embedded in LibreChat consume through HTTP."
          className="grid gap-3"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <ArchitectureNode
              icon={HardDrive}
              title="Configured sources"
              detail="Read-only roots, configured in YAML"
              tone="border-emerald-500/50"
            />
            <ArchitectureNode
              icon={Server}
              title="Workspace Brain API"
              detail="Registers sources · owns catalogue writes"
              tone="border-sky-500/50"
            />
            <ArchitectureNode
              icon={Database}
              title="DuckDB catalogue"
              detail="Inventory · evidence · publications"
              tone="border-emerald-500/50"
            />
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <ArrowDown className="size-4" aria-hidden="true" />
            API, ingestion and knowledge workers exchange messages
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <ArchitectureNode
              icon={Workflow}
              title="Ingestion worker"
              detail="Scans files · serves document content"
              tone="border-emerald-500/50"
            />
            <ArchitectureNode
              icon={Signal}
              title="NATS JetStream"
              detail="Durable events + ephemeral request/reply"
              tone="border-amber-500/50"
            />
            <ArchitectureNode
              icon={Workflow}
              title="Knowledge worker"
              detail="Deterministic processing and extraction"
              tone="border-emerald-500/50"
            />
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <ArrowDown className="size-4" aria-hidden="true" />
            API publishes immutable knowledge for read-only consumers
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <ArchitectureNode
              icon={Database}
              title="Knowledge + publications"
              detail="Evidence-backed, versioned API output"
              tone="border-emerald-500/50"
            />
            <ArchitectureNode
              icon={ExternalLink}
              title="Explorer + MCP / LibreChat"
              detail="Separate consumers; MCP runs inside LibreChat"
              tone="border-violet-500/50"
            />
          </div>
        </div>
        <details className="mt-4 rounded-lg border p-4">
          <summary className="cursor-pointer font-medium">
            Read the architecture in sequence
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Sources are mounted read-only and registered by the API.</li>
            <li>
              Ingestion scans and exchanges inventory/content with the API and
              knowledge worker through NATS.
            </li>
            <li>
              The knowledge worker deterministically processes documents and
              extracts evidence-backed candidates.
            </li>
            <li>The API owns catalogue writes and immutable publication.</li>
            <li>Explorer and embedded MCP consume published data via HTTP.</li>
          </ol>
        </details>
      </CardContent>
    </Card>
  );
}

function ArchitectureNode({
  icon: Icon,
  title,
  detail,
  tone,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly detail: string;
  readonly tone: string;
}) {
  return (
    <div className={cn('rounded-xl border-l-4 bg-muted/50 p-4', tone)}>
      <div className="flex items-center gap-2 font-medium">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function RepositoryFlow() {
  return (
    <section aria-labelledby="repository-flow-heading" className="space-y-4">
      <PageSectionTitle
        id="repository-flow-heading"
        title="Repository to publication"
        description="Adding a repository does not immediately create knowledge. The trigger and each deterministic stage are explicit."
      />
      <Card>
        <CardContent className="p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <h3 className="font-semibold">Add a repository directory</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Place it under the configured read-only source root (default
                Compose mount: ./sources → /sources). There is no watcher; the
                next ingestion scan discovers it (default interval: five
                minutes).
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <h3 className="font-semibold">
                Add a source in configuration YAML
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Edit config/workspace-brain.yaml, then rebuild/recreate the API
                because configuration is baked into its image and loaded at
                startup. The next ingestion scan reads the newly registered
                source.
              </p>
            </div>
          </div>
          <ol className="mt-5 grid gap-3 lg:grid-cols-2">
            {FLOW_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3 rounded-lg border p-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{step.title}</h3>
                    <Badge variant="outline">{step.tag}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.text}
                  </p>
                  {index < FLOW_STEPS.length - 1 && (
                    <ArrowRight
                      className="mt-3 size-4 text-primary lg:hidden"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-lg bg-muted p-3 text-sm">
            There is no public “start discovery” endpoint in the current API.
            Discovery runs on ingestion-worker startup and its interval. The
            repository-wide <code>make reprocess-architecture</code> command
            resubmits inventoried documents; it is distinct from discovery.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function NatsSection() {
  return (
    <section aria-labelledby="nats-heading" className="space-y-4">
      <PageSectionTitle
        id="nats-heading"
        title="NATS: event backbone, not the source of truth"
        description="A NATS server accepts connections. Services publish to named subjects; subscribers receive events, while request/reply uses an ephemeral response rather than a durable work item."
      />
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MiniFact
              title="Server"
              text="Compose service nats; image nats:2.10-alpine. Client port 4222; monitor port 8222."
            />
            <MiniFact
              title="Connections and subjects"
              text="The API and workers establish NATS client connections using NATS_SERVERS (nats://nats:4222 in Compose). A subject is the exact routing name shown in the table; publishers send on it and subscribers register for it."
            />
            <MiniFact
              title="JetStream"
              text="Stream WORKSPACE_DISCOVERY uses file storage and limits retention over workspace.discovery.>, workspace.processing.>, workspace.knowledge.> and workspace.search.>."
            />
            <MiniFact
              title="Delivery"
              text="Durable consumers explicitly ack with one message pending per consumer. Failures are NAKed with a 1-second delay; after five failed deliveries, the implementation publishes to workspace.discovery.dead-letter."
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <caption className="mb-3 text-left text-sm text-muted-foreground">
                Verified NATS subjects and request/reply operations. No queue
                group is configured in the inspected subscribers.
              </caption>
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="p-3">
                    Subject / operation
                  </th>
                  <th scope="col" className="p-3">
                    Publisher / requester
                  </th>
                  <th scope="col" className="p-3">
                    Subscriber / responder
                  </th>
                  <th scope="col" className="p-3">
                    Purpose and delivery
                  </th>
                </tr>
              </thead>
              <tbody>
                {NATS_OPERATIONS.map((operation) => (
                  <tr key={operation.subject} className="border-b align-top">
                    <th
                      scope="row"
                      className="p-3 font-mono text-xs font-medium"
                    >
                      {operation.subject}
                    </th>
                    <td className="p-3">{operation.publisher}</td>
                    <td className="p-3">{operation.subscriber}</td>
                    <td className="p-3">
                      <p>{operation.purpose}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {operation.transport}; {operation.acknowledgement}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="rounded-lg bg-muted p-3 text-sm">
            An empty stream can be a healthy idle system. Delivery is not proof
            of successful processing; handlers ack only after success, and
            exhausted failures are dead-lettered. Live stream counts, consumer
            lag, acknowledgements, redeliveries and last activity are not
            exposed through the current API.
          </p>
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">
            Scan success/failure is represented by inventory-submitted or
            scan-failed events. Other handler exceptions are logged, NAKed and
            retried; after the fifth failed delivery the event is copied to the
            dead-letter subject and acknowledged. There is no configured
            dead-letter consumer or user-facing failed-job list.
          </p>
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">
            The API&apos;s <code>/ready</code> route checks the DuckDB catalogue
            only; it does not verify a live NATS connection or worker
            availability. A ready API can coexist with a broken event-processing
            path.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function MiniFact({
  title,
  text,
}: {
  readonly title: string;
  readonly text: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {text}
      </p>
    </div>
  );
}

function BuildRunMatrix() {
  return (
    <section aria-labelledby="build-run-heading" className="space-y-4">
      <PageSectionTitle
        id="build-run-heading"
        title="Build versus run"
        description="An image contains code; a container runs an image; discovery and reprocessing operate on source data. These are separate actions."
      />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <caption className="sr-only">
                Components, images and their runtime locations
              </caption>
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="p-3">
                    Component
                  </th>
                  <th scope="col" className="p-3">
                    Where
                  </th>
                  <th scope="col" className="p-3">
                    Build / image origin
                  </th>
                  <th scope="col" className="p-3">
                    Exposed ports
                  </th>
                  <th scope="col" className="p-3">
                    Live runtime evidence
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPONENTS.map((component) => (
                  <tr key={component.id} className="border-b align-top">
                    <th scope="row" className="p-3 font-medium">
                      {component.name}
                      {component.optional && (
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          Optional
                        </span>
                      )}
                    </th>
                    <td className="p-3">{component.runtime}</td>
                    <td className="p-3">
                      <span className="block">{component.imageOrigin}</span>
                      <code className="mt-1 block break-all text-xs text-muted-foreground">
                        {component.image}
                      </code>
                    </td>
                    <td className="p-3">
                      {component.ports.join('; ') || 'None'}
                    </td>
                    <td className="p-3">
                      {component.id === 'api'
                        ? 'Live /health and /ready probes'
                        : component.id === 'explorer'
                          ? 'This browser page is loaded; Vite process is not probed'
                          : component.configuredHealthCheck
                            ? `Compose probe configured, but result is not exposed to Explorer: ${component.configuredHealthCheck}`
                            : 'Not currently observable from Explorer'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <CommandCard
          title="Build or deploy code"
          commands={[
            'make rebuild-backend',
            'make rebuild-api',
            'make rebuild-workers',
            'make rebuild-librechat',
          ]}
          description="Rebuild targets recreate affected service containers; start-* reuses existing images."
        />
        <CommandCard
          title="Start, inspect or reprocess"
          commands={[
            'make start-backend',
            'make status',
            'make logs',
            'make reprocess-architecture',
          ]}
          description="Reprocess uses the already-running code and does not rebuild an image or discover an unregistered YAML source."
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Compose does not pin names for API/worker container images; those images
        are built from the shared backend Dockerfile. The LibreChat image is
        explicitly named. Compose generates the containers for services without
        a fixed container_name.
      </p>
    </section>
  );
}

function CommandCard({
  title,
  commands,
  description,
}: {
  readonly title: string;
  readonly commands: readonly string[];
  readonly description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {commands.map((command) => (
            <li key={command}>
              <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
                {command}
              </code>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Troubleshooting({
  observation,
  stale,
  endpointUnavailable,
}: {
  readonly observation?: RuntimeComponentStatus;
  readonly stale: boolean;
  readonly endpointUnavailable: boolean;
}) {
  const guidance = getTroubleshootingGuidance(
    observation,
    stale,
    endpointUnavailable,
  );
  return (
    <section aria-labelledby="troubleshooting-heading" className="space-y-4">
      <PageSectionTitle
        id="troubleshooting-heading"
        title="What should I do next?"
        description="This first recommendation follows the live API/catalogue probes. The service-specific branches below use repository-confirmed commands."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{guidance.title}</CardTitle>
          <CardDescription>{guidance.explanation}</CardDescription>
        </CardHeader>
        <CardContent>
          <CommandList commands={guidance.commands} />
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <TroubleshootingBranch
          title="NATS or a worker is down / unknown"
          commands={[
            'make status',
            'docker compose -f deploy/compose/compose.yaml logs --tail=100 nats ingestion-worker knowledge-worker',
            'make start-backend',
          ]}
          note="Start existing images first. Rebuild only when application code or image inputs changed."
        />
        <TroubleshootingBranch
          title="Added repository but no inventory appears"
          commands={[
            'make status',
            'docker compose -f deploy/compose/compose.yaml logs --tail=100 ingestion-worker',
            'make rebuild-api',
          ]}
          note="Confirm the path is under the configured mounted source root. Rebuild/recreate API only when YAML source configuration changed; otherwise allow the next scan interval."
        />
        <TroubleshootingBranch
          title="Discovery ran but no knowledge/publication appeared"
          commands={[
            'docker compose -f deploy/compose/compose.yaml logs --tail=100 knowledge-worker workspace-brain-api',
            'make reprocess-architecture',
            'curl -fsS http://localhost:3000/api/v1/knowledge/models',
          ]}
          note="Check file support, processor/extractor evidence, worker/API logs and whether a Knowledge Model has a publication. Reprocess after workers are healthy; it does not build code."
        />
        <TroubleshootingBranch
          title="Publication exists but a consumer cannot retrieve it"
          commands={[
            'curl -i http://localhost:3000/ready',
            'curl -fsS http://localhost:3000/api/v1/knowledge/models',
            'pnpm test:mcp:smoke',
          ]}
          note="Explorer falls back to its bundled snapshot if live API access fails. MCP runs inside the optional LibreChat container; it is not a separate service."
        />
        <TroubleshootingBranch
          title="Code changed, but the old image is running"
          commands={['make rebuild-backend', 'make status']}
          note="A local build or restart does not deploy application code into existing containers."
        />
        <TroubleshootingBranch
          title="Only source data needs reprocessing"
          commands={['make status', 'make reprocess-architecture']}
          note="No image rebuild is needed if deployed processing code is correct. Reprocessing does not start missing services and does not create a new source registration."
        />
        <TroubleshootingBranch
          title="A container is Created or has exited"
          commands={[
            'make status',
            'docker compose -f deploy/compose/compose.yaml logs --tail=100 workspace-brain-api ingestion-worker knowledge-worker nats',
            'make start-backend',
          ]}
          note="Created means the process has not started; exited means it stopped. The browser cannot inspect Docker state, so confirm the affected service with Compose before choosing a rebuild."
        />
      </div>
    </section>
  );
}

function TroubleshootingBranch({
  title,
  commands,
  note,
}: {
  readonly title: string;
  readonly commands: readonly string[];
  readonly note: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{note}</CardDescription>
      </CardHeader>
      <CardContent>
        <CommandList commands={commands} />
      </CardContent>
    </Card>
  );
}

function CommandList({ commands }: { readonly commands: readonly string[] }) {
  return (
    <ul className="space-y-2">
      {commands.map((command) => (
        <li key={command}>
          <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
            {command}
          </code>
        </li>
      ))}
    </ul>
  );
}

function ActivityVisibility() {
  const knowledge = useRuntimeKnowledgeFacts();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current processing and NATS activity</CardTitle>
        <CardDescription>
          Repository inventory and publication facts come from the knowledge
          API, independently of transient component heartbeats.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MiniFact
          title="Repositories in inventory"
          text={
            knowledge.data
              ? String(knowledge.data.repositoriesInInventory)
              : knowledge.isError
                ? 'Unavailable from the knowledge API'
                : 'Loading from the knowledge API…'
          }
        />
        <MiniFact
          title="Last successful publication"
          text={
            knowledge.data?.latestPublication
              ? `Version ${knowledge.data.latestPublication.version} · ${formatTimestamp(knowledge.data.latestPublication.publishedAt)}`
              : knowledge.data
                ? 'No published model is currently available'
                : knowledge.isError
                  ? 'Unavailable from the knowledge API'
                  : 'Loading from the knowledge API…'
          }
        />
        {[
          'Active jobs / idle state',
          'NATS connected clients and subscriptions',
          'Pending messages, consumer lag, retries and dead letters',
          'Last successful source scan',
        ].map((metric) => (
          <MiniFact
            key={metric}
            title={metric}
            text="Not exposed by the current API"
          />
        ))}
      </CardContent>
    </Card>
  );
}

function EvidenceReferences() {
  return (
    <details className="rounded-xl border p-5">
      <summary className="cursor-pointer font-semibold">
        Evidence and implementation references
      </summary>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Compose topology and health checks: deploy/compose/compose.yaml.
        </li>
        <li>
          Source registration and startup snapshot: API startup.ts and
          config/workspace-brain.yaml.
        </li>
        <li>
          Discovery scheduling and source scanning: ingestion-worker
          event-consumer.ts.
        </li>
        <li>
          Event transport, stream and retry policy:
          infrastructure/nats/src/index.ts.
        </li>
        <li>
          Worker processing and extraction: knowledge-worker/src/worker.ts.
        </li>
        <li>
          Daily start, rebuild and reprocess commands: Makefile and
          docs/local-development.md.
        </li>
        <li>
          Current live probes: <code>/health</code> (API liveness) and{' '}
          <code>/ready</code> (catalogue check). Neither exposes Docker
          container state, NATS connectivity, worker heartbeat or NATS metrics.
          Compose also configures health checks for LibreChat and its MongoDB,
          but those container results are not readable by this browser.
        </li>
        <li>
          The configuration schema accepts <code>knowledge_models</code>, but
          current API startup registration passes sources and workspaces only;
          the catalogue creates a model per workspace. Custom YAML model entries
          are therefore not applied by this startup path.
        </li>
        <li>
          The supplied reference&apos;s downloaded-image count is stale: Compose
          also configures Qdrant and Ollama images, in addition to NATS and
          LibreChat MongoDB.
        </li>
      </ul>
    </details>
  );
}

export function SystemArchitectureRuntimeScreen() {
  const runtime = useRuntimeStatus();
  const api = runtime.snapshot?.components.find(
    ({ componentId }) => componentId === 'workspace-brain-api',
  );

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-5 pb-12 pt-8 md:px-8">
      <ScreenHeader
        eyebrow="System operations · implementation-backed"
        title="System Architecture & Runtime"
        lead="Understand the real service boundaries, deterministic repository-to-publication path, NATS messaging and the runtime evidence currently available to Explorer."
      />
      <RuntimeStatusPanel runtime={runtime} />
      <ArchitectureDiagram />
      <RepositoryFlow />
      <NatsSection />
      <BuildRunMatrix />
      <ActivityVisibility />
      <Troubleshooting
        observation={api}
        stale={runtime.stale}
        endpointUnavailable={runtime.endpointUnavailable}
      />
      <EvidenceReferences />
    </div>
  );
}

function PageSectionTitle({
  id,
  title,
  description,
}: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
