import { parse } from 'yaml';
import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

const sourceDefaultsSchema = z
  .object({
    exclude_dirs: z
      .array(nonEmptyString)
      .default(['.git', 'node_modules', 'dist', 'build']),
    include_extensions: z
      .array(z.string().regex(/^\.[a-zA-Z0-9]+$/))
      .default(['.md', '.txt', '.yaml', '.yml', '.json', '.ts', '.js']),
    max_file_size_mb: z.number().positive().default(50),
    follow_symbolic_links: z.boolean().default(false),
  })
  .strict();

const sourceSchema = z
  .object({
    id: nonEmptyString,
    type: z.literal('filesystem'),
    container_paths: z.array(nonEmptyString).min(1),
    defaults: sourceDefaultsSchema.prefault({}),
  })
  .strict();

const workspaceSchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    sources: z.array(nonEmptyString).min(1),
    repository_rules: z
      .object({
        include: z.array(nonEmptyString).default([]),
        exclude: z.array(nonEmptyString).default([]),
      })
      .strict()
      .prefault({}),
  })
  .strict();

const knowledgeModelSchema = z
  .object({
    id: nonEmptyString,
    scope: z
      .object({
        type: z.enum(['repository', 'workspace']),
        target: nonEmptyString,
      })
      .strict(),
  })
  .strict();

export const workspaceBrainConfigSchema = z
  .object({
    version: z.literal(1),
    platform: z
      .object({
        data_dir: nonEmptyString,
        hash_algorithm: z.literal('sha256').default('sha256'),
      })
      .strict(),
    sources: z.array(sourceSchema),
    workspaces: z.array(workspaceSchema),
    knowledge_models: z.array(knowledgeModelSchema).default([]),
    search: z
      .object({
        lexical: z
          .object({ enabled: z.boolean().default(true) })
          .strict()
          .prefault({}),
        semantic: z
          .object({ enabled: z.boolean().default(true) })
          .strict()
          .prefault({}),
      })
      .strict()
      .prefault({}),
    ai: z
      .object({
        policy: z
          .object({
            local_only: z.boolean().default(true),
            allow_remote_fallback: z.boolean().default(false),
          })
          .strict()
          .prefault({}),
        providers: z
          .array(
            z
              .object({
                id: nonEmptyString,
                type: z.literal('ollama'),
                endpoint: z.url(),
              })
              .strict(),
          )
          .default([]),
      })
      .strict()
      .prefault({}),
    governance: z
      .object({
        provenance_required: z.literal(true).default(true),
        relationships_require_evidence: z.literal(true).default(true),
        allow_source_mutation: z.literal(false).default(false),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .superRefine((config, context) => {
    const sourceIds = new Set<string>();
    for (const source of config.sources) {
      if (sourceIds.has(source.id)) {
        context.addIssue({
          code: 'custom',
          path: ['sources'],
          message: `Duplicate source ID: ${source.id}`,
        });
      }
      sourceIds.add(source.id);
    }

    const workspaceIds = new Set<string>();
    for (const workspace of config.workspaces) {
      if (workspaceIds.has(workspace.id)) {
        context.addIssue({
          code: 'custom',
          path: ['workspaces'],
          message: `Duplicate workspace ID: ${workspace.id}`,
        });
      }
      workspaceIds.add(workspace.id);
      for (const sourceId of workspace.sources) {
        if (!sourceIds.has(sourceId)) {
          context.addIssue({
            code: 'custom',
            path: ['workspaces'],
            message: `Workspace ${workspace.id} references unknown source ${sourceId}`,
          });
        }
      }
    }

    if (config.ai.policy.local_only && config.ai.policy.allow_remote_fallback) {
      context.addIssue({
        code: 'custom',
        path: ['ai', 'policy', 'allow_remote_fallback'],
        message: 'Remote fallback cannot be enabled while local_only is true',
      });
    }
  });

export type WorkspaceBrainConfig = z.infer<typeof workspaceBrainConfigSchema>;

export function parseWorkspaceBrainConfig(yaml: string): WorkspaceBrainConfig {
  return workspaceBrainConfigSchema.parse(parse(yaml));
}
