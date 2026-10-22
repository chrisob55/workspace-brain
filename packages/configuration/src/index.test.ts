import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseDiscoveryInventoryConfig,
  parseRuntimeObservabilityConfig,
  parseWorkspaceBrainConfig,
} from './index.js';

const validConfig = `
version: 1
platform:
  data_dir: /data
  hash_algorithm: sha256
sources:
  - id: projects
    type: filesystem
    container_paths: [/sources/projects]
workspaces:
  - id: hmrc-agents
    name: HMRC Agents
    sources: [projects]
`;

describe('parseWorkspaceBrainConfig', () => {
  it('parses v1 YAML and applies safe defaults', () => {
    const config = parseWorkspaceBrainConfig(validConfig);

    expect(config.version).toBe(1);
    expect(config.sources[0]?.defaults.follow_symbolic_links).toBe(false);
    expect(config.ai.policy.allow_remote_fallback).toBe(false);
    expect(config.governance.allow_source_mutation).toBe(false);
    expect(config.sources[0]?.roots).toEqual(['/sources/projects']);
    expect(config.sources[0]?.defaults.include_extensions).toEqual(
      expect.arrayContaining(['.scala', '.routes', '.conf']),
    );
  });

  describe('parseDiscoveryInventoryConfig', () => {
    it('uses safe defaults and accepts validated overrides', () => {
      expect(parseDiscoveryInventoryConfig({})).toEqual({
        maxEventBytes: 1_000_000,
        payloadSafetyRatio: 0.8,
        publishConcurrency: 4,
        assemblyTtlMs: 86_400_000,
      });
      expect(
        parseDiscoveryInventoryConfig({
          DISCOVERY_INVENTORY_MAX_EVENT_BYTES: '900000',
          DISCOVERY_INVENTORY_PAYLOAD_SAFETY_RATIO: '0.75',
          DISCOVERY_INVENTORY_PUBLISH_CONCURRENCY: '2',
          DISCOVERY_INVENTORY_ASSEMBLY_TTL_MS: '3600000',
        }),
      ).toEqual({
        maxEventBytes: 900_000,
        payloadSafetyRatio: 0.75,
        publishConcurrency: 2,
        assemblyTtlMs: 3_600_000,
      });
    });

    it.each([
      { DISCOVERY_INVENTORY_MAX_EVENT_BYTES: '0' },
      { DISCOVERY_INVENTORY_MAX_EVENT_BYTES: '900000.5' },
      { DISCOVERY_INVENTORY_PAYLOAD_SAFETY_RATIO: '0' },
      { DISCOVERY_INVENTORY_PAYLOAD_SAFETY_RATIO: '1.1' },
      { DISCOVERY_INVENTORY_PUBLISH_CONCURRENCY: '-1' },
      { DISCOVERY_INVENTORY_ASSEMBLY_TTL_MS: '0' },
    ])('rejects invalid inventory configuration %#', (env) => {
      expect(() => parseDiscoveryInventoryConfig(env)).toThrow();
    });
  });

  describe('parseRuntimeObservabilityConfig', () => {
    it('uses safe defaults and accepts validated overrides', () => {
      expect(parseRuntimeObservabilityConfig({})).toEqual({
        heartbeatEnabled: true,
        heartbeatIntervalMs: 15_000,
        degradedAfterMs: 30_000,
        offlineAfterMs: 90_000,
      });
      expect(
        parseRuntimeObservabilityConfig({
          RUNTIME_HEARTBEAT_ENABLED: 'false',
          RUNTIME_HEARTBEAT_INTERVAL_MS: '10000',
          RUNTIME_DEGRADED_AFTER_MS: '20000',
          RUNTIME_OFFLINE_AFTER_MS: '60000',
          RUNTIME_INSTANCE_ID: 'api-a',
        }),
      ).toEqual({
        heartbeatEnabled: false,
        heartbeatIntervalMs: 10_000,
        degradedAfterMs: 20_000,
        offlineAfterMs: 60_000,
        instanceId: 'api-a',
      });
    });

    it.each([
      {
        RUNTIME_HEARTBEAT_INTERVAL_MS: '0',
      },
      {
        RUNTIME_HEARTBEAT_INTERVAL_MS: '20000',
        RUNTIME_DEGRADED_AFTER_MS: '20000',
      },
      {
        RUNTIME_DEGRADED_AFTER_MS: '30000',
        RUNTIME_OFFLINE_AFTER_MS: '30000',
      },
      {
        RUNTIME_HEARTBEAT_ENABLED: 'yes',
      },
    ])('rejects invalid runtime configuration %#', (env) => {
      expect(() => parseRuntimeObservabilityConfig(env)).toThrow();
    });
  });

  it('accepts the checked-in local-first example configuration', async () => {
    const yaml = await readFile(
      resolve(process.cwd(), 'config/workspace-brain.yaml'),
      'utf8',
    );
    const config = parseWorkspaceBrainConfig(yaml);

    expect(config.version).toBe(1);
    expect(config.sources).toHaveLength(1);
    expect(config.workspaces[0]?.sourceIds).toEqual(['local-projects']);
    expect(config.ai.policy.allow_remote_fallback).toBe(false);
  });

  it('normalizes source roots and workspace discovery rules', () => {
    const config = parseWorkspaceBrainConfig(`
version: 1
platform:
  data_dir: /data
sources:
  - id: projects
    name: Projects
    type: filesystem
    roots: [/workspace/projects]
workspaces:
  - id: hmrc-agents
    name: HMRC Agents
    sourceIds: [projects]
    include: ["**"]
    exclude: ["**/node_modules/**", "**/.git/**"]
`);

    expect(config.sources[0]?.name).toBe('Projects');
    expect(config.sources[0]?.roots).toEqual(['/workspace/projects']);
    expect(config.workspaces[0]?.sourceIds).toEqual(['projects']);
    expect(config.workspaces[0]?.include).toEqual(['**']);
    expect(config.workspaces[0]?.exclude).toEqual([
      '**/node_modules/**',
      '**/.git/**',
    ]);
  });

  it('rejects unsupported versions and writable source configuration', () => {
    expect(() =>
      parseWorkspaceBrainConfig(
        validConfig.replace('version: 1', 'version: 2'),
      ),
    ).toThrow();
    expect(() =>
      parseWorkspaceBrainConfig(
        validConfig.replace(
          'sources: [projects]',
          'sources: [projects]\\n    allow_source_mutation: true',
        ),
      ),
    ).toThrow();
  });

  it('rejects workspaces that reference an unknown source', () => {
    expect(() =>
      parseWorkspaceBrainConfig(
        validConfig.replace('[projects]', '[missing-source]'),
      ),
    ).toThrow();
  });

  it('rejects non-local AI fallback unless policy is explicitly revised', () => {
    expect(() =>
      parseWorkspaceBrainConfig(
        `${validConfig}\\nai:\\n  policy:\\n    local_only: true\\n    allow_remote_fallback: true`,
      ),
    ).toThrow();
  });
});
