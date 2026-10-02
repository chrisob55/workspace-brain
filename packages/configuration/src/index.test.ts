import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseWorkspaceBrainConfig } from './index.js';

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
  });

  it('accepts the checked-in local-first example configuration', async () => {
    const yaml = await readFile(
      resolve(process.cwd(), 'config/workspace-brain.yaml'),
      'utf8',
    );
    const config = parseWorkspaceBrainConfig(yaml);

    expect(config.version).toBe(1);
    expect(config.sources).toHaveLength(1);
    expect(config.workspaces[0]?.sources).toEqual(['local-projects']);
    expect(config.ai.policy.allow_remote_fallback).toBe(false);
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
