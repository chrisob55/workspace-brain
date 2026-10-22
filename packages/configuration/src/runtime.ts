import { z } from 'zod';

const positiveMilliseconds = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().safe().int().positive());
const positiveSafeInteger = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().safe().int().positive());

const catalogueRuntimeSchema = z.object({
  memoryLimitMb: positiveSafeInteger.prefault('3072'),
  threads: positiveSafeInteger.prefault('1'),
});

export function parseCatalogueRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): { readonly memoryLimitMb: number; readonly threads: number } {
  return catalogueRuntimeSchema.parse({
    memoryLimitMb: env.DUCKDB_MEMORY_LIMIT_MB,
    threads: env.DUCKDB_THREADS,
  });
}

const discoveryInventorySchema = z.object({
  maxEventBytes: positiveSafeInteger.prefault('1000000'),
  payloadSafetyRatio: z
    .string()
    .regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/)
    .transform(Number)
    .pipe(z.number().gt(0).lte(1))
    .prefault('0.8'),
  publishConcurrency: positiveSafeInteger.prefault('4'),
  assemblyTtlMs: positiveMilliseconds.prefault('86400000'),
});

export interface DiscoveryInventoryConfig {
  readonly maxEventBytes: number;
  readonly payloadSafetyRatio: number;
  readonly publishConcurrency: number;
  readonly assemblyTtlMs: number;
}

export function parseDiscoveryInventoryConfig(
  env: NodeJS.ProcessEnv = process.env,
): DiscoveryInventoryConfig {
  return discoveryInventorySchema.parse({
    maxEventBytes: env.DISCOVERY_INVENTORY_MAX_EVENT_BYTES,
    payloadSafetyRatio: env.DISCOVERY_INVENTORY_PAYLOAD_SAFETY_RATIO,
    publishConcurrency: env.DISCOVERY_INVENTORY_PUBLISH_CONCURRENCY,
    assemblyTtlMs: env.DISCOVERY_INVENTORY_ASSEMBLY_TTL_MS,
  });
}

const runtimeObservabilitySchema = z
  .object({
    heartbeatEnabled: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    heartbeatIntervalMs: positiveMilliseconds.prefault('15000'),
    degradedAfterMs: positiveMilliseconds.prefault('30000'),
    offlineAfterMs: positiveMilliseconds.prefault('90000'),
    instanceId: z.string().trim().min(1).optional(),
  })
  .superRefine((config, context) => {
    if (config.degradedAfterMs <= config.heartbeatIntervalMs) {
      context.addIssue({
        code: 'custom',
        path: ['degradedAfterMs'],
        message: 'RUNTIME_DEGRADED_AFTER_MS must exceed heartbeat interval',
      });
    }
    if (config.offlineAfterMs <= config.degradedAfterMs) {
      context.addIssue({
        code: 'custom',
        path: ['offlineAfterMs'],
        message:
          'RUNTIME_OFFLINE_AFTER_MS must exceed RUNTIME_DEGRADED_AFTER_MS',
      });
    }
  });

export interface RuntimeObservabilityConfig {
  readonly heartbeatEnabled: boolean;
  readonly heartbeatIntervalMs: number;
  readonly degradedAfterMs: number;
  readonly offlineAfterMs: number;
  readonly instanceId?: string;
}

export function parseRuntimeObservabilityConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeObservabilityConfig {
  const config = runtimeObservabilitySchema.parse({
    heartbeatEnabled: env.RUNTIME_HEARTBEAT_ENABLED,
    heartbeatIntervalMs: env.RUNTIME_HEARTBEAT_INTERVAL_MS,
    degradedAfterMs: env.RUNTIME_DEGRADED_AFTER_MS,
    offlineAfterMs: env.RUNTIME_OFFLINE_AFTER_MS,
    instanceId: env.RUNTIME_INSTANCE_ID,
  });
  return {
    heartbeatEnabled: config.heartbeatEnabled,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    degradedAfterMs: config.degradedAfterMs,
    offlineAfterMs: config.offlineAfterMs,
    ...(config.instanceId === undefined
      ? {}
      : { instanceId: config.instanceId }),
  };
}
