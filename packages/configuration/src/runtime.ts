import { z } from 'zod';

const positiveMilliseconds = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().safe().int().positive());

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
