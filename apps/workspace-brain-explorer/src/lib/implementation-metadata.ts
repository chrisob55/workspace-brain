/**
 * Documentation metadata derived from the implementation itself. Each parser
 * reads real source text, so registries, vocabularies and parser packs shown in
 * the Explorer change when the code changes. Tests assert the parsers still
 * recognise the source shapes they depend on.
 */
import domainSource from '../../../../packages/domain/src/index.ts?raw';
import processingSource from '../../../../packages/processing-core/src/index.ts?raw';
import hmrcNormalizerSource from '../../../../packages/processing-core/src/hmrc-scala-play.ts?raw';
import hmrcCandidatesSource from '../../../../packages/processing-core/src/hmrc-scala-play-candidates.ts?raw';
import extractorRegistrySource from '../../../../apps/knowledge-worker/src/knowledge-extractors.ts?raw';
import publicationSource from '../../../../packages/domain-publication/src/index.ts?raw';
import rootPackageSource from '../../../../package.json?raw';
import { toRepositoryPath } from './source-files';

const extractorSources = import.meta.glob(
  '../../../../apps/knowledge-worker/src/extractors/*.ts',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const adrSources = import.meta.glob('../../../../docs/adr/ADR-*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const migrationSources = import.meta.glob(
  '../../../../infrastructure/duckdb/migrations/*.sql',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const repositoryPath = toRepositoryPath;

export const DOMAIN_PATH = 'packages/domain/src/index.ts';
export const PROCESSING_PATH = 'packages/processing-core/src/index.ts';
export const HMRC_NORMALIZERS_PATH =
  'packages/processing-core/src/hmrc-scala-play.ts';
export const HMRC_CANDIDATES_PATH =
  'packages/processing-core/src/hmrc-scala-play-candidates.ts';
export const EXTRACTOR_REGISTRY_PATH =
  'apps/knowledge-worker/src/knowledge-extractors.ts';

function quoted(text: string): string[] {
  return [...text.matchAll(/'([^'\n]+)'/g)].map((match) => match[1]!);
}

/** The text of `export const NAME ... = [ ... ]`. */
function arrayLiteral(source: string, name: string): string | undefined {
  const start = new RegExp(`export const ${name}\\b[^=]*=\\s*\\[`).exec(source);
  if (!start) return undefined;
  const open = start.index + start[0].length;
  let depth = 1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1;
    else if (source[i] === ']' && --depth === 0) return source.slice(open, i);
  }
  return undefined;
}

export function parseConstStringArray(source: string, name: string): string[] {
  const body = arrayLiteral(source, name);
  return body ? quoted(body) : [];
}

export interface ProcessingDefinition {
  filenameMatchKind: string;
  filenameMatch: string;
  processorId: string;
  extractionRuleId: string;
}

export function parseProcessingDefinitions(
  source: string,
): ProcessingDefinition[] {
  const body = arrayLiteral(source, 'processingDefinitionRegistry') ?? '';
  return [...body.matchAll(/\{([^{}]+)\}/g)].flatMap((match) => {
    const field = (key: string) =>
      new RegExp(`${key}:\\s*'([^']+)'`).exec(match[1]!)?.[1];
    const definition = {
      filenameMatchKind: field('filenameMatchKind'),
      filenameMatch: field('filenameMatch'),
      processorId: field('processorId'),
      extractionRuleId: field('extractionRuleId'),
    };
    return Object.values(definition).every(Boolean)
      ? [definition as ProcessingDefinition]
      : [];
  });
}

export interface DocumentProcessorMetadata {
  id: string;
  version: number;
  normalizer: string;
  files: string[];
  extractionRuleId: string;
}

/** `createProcessor('id', ..., normalizer, version?)` calls in processing-core. */
export function parseDocumentProcessors(
  source: string,
  definitions: readonly ProcessingDefinition[],
): DocumentProcessorMetadata[] {
  const body = arrayLiteral(source, 'documentProcessors') ?? '';
  const defaultVersion = Number(
    /function createProcessor\([\s\S]*?version = (\d+)/.exec(source)?.[1] ?? 1,
  );
  return body
    .split(/createProcessor\(/)
    .slice(1)
    .flatMap((call) => {
      const id = /^\s*'([\w-]+)'/.exec(call)?.[1];
      if (!id) return [];
      const args = call.replace(/\)\s*,?\s*$/, '');
      const trailingVersion = /,\s*(\d+)\s*,?\s*$/.exec(args);
      const normalizer =
        /extractionRuleId,\s*(?:\([^)]*\)\s*=>\s*)?(\w+)/.exec(args)?.[1] ??
        'unknown';
      const matching = definitions.filter((item) => item.processorId === id);
      return [
        {
          id,
          version: trailingVersion
            ? Number(trailingVersion[1])
            : defaultVersion,
          normalizer,
          files: matching.map((item) =>
            item.filenameMatchKind === 'exact'
              ? item.filenameMatch
              : `*${item.filenameMatch}`,
          ),
          extractionRuleId: matching[0]?.extractionRuleId ?? 'unknown',
        },
      ];
    });
}

export interface KnowledgeExtractorMetadata {
  exportName: string;
  id: string;
  version: number;
  stage: number;
  path: string;
  emitsEntities: string[];
  emitsRelationships: string[];
}

function topLevelBlocks(source: string): { name: string; text: string }[] {
  const starts = [
    ...source.matchAll(
      /^(?:export )?(?:const|function|class) (\w+)|^const (\w+) =/gm,
    ),
  ];
  return starts.map((match, index) => ({
    name: (match[1] ?? match[2])!,
    text: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  }));
}

function emittedTypes(
  text: string,
  helpers: { name: string; text: string }[],
  entityVocabulary: ReadonlySet<string>,
) {
  const entities = new Set(
    [...text.matchAll(/output\.entity\(\s*'([\w-]+)'/g)].map((m) => m[1]!),
  );
  const relationships = new Set(
    [...text.matchAll(/output\.relationship\(\s*'([A-Z_]+)'/g)].map(
      (m) => m[1]!,
    ),
  );
  for (const helper of helpers) {
    if (!new RegExp(`\\b${helper.name}\\(`).test(text)) continue;
    for (const literal of quoted(helper.text))
      if (entityVocabulary.has(literal)) entities.add(literal);
  }
  return { entities: [...entities].sort(), relationships: [...relationships] };
}

export function parseKnowledgeExtractors(
  registrySource: string,
  sources: Record<string, string>,
  entityVocabulary: ReadonlySet<string>,
): KnowledgeExtractorMetadata[] {
  const registered = (
    /knowledgeExtractors:[^=]*=\s*\[([\s\S]*?)\]/.exec(registrySource)?.[1] ??
    ''
  )
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const result: KnowledgeExtractorMetadata[] = [];
  for (const exportName of registered) {
    for (const [key, source] of Object.entries(sources)) {
      const blocks = topLevelBlocks(source);
      const block = blocks.find(
        (item) =>
          item.name === exportName &&
          /:\s*KnowledgeExtractor\s*=/.test(item.text),
      );
      if (!block) continue;
      const helpers = blocks.filter(
        (item) => item !== block && /output\.entity\(/.test(item.text),
      );
      const emitted = emittedTypes(block.text, helpers, entityVocabulary);
      result.push({
        exportName,
        id: /\bid:\s*'([\w-]+)'/.exec(block.text)?.[1] ?? exportName,
        version: Number(/\bversion:\s*(\d+)/.exec(block.text)?.[1] ?? 1),
        stage: Number(/\bstage:\s*(\d+)/.exec(block.text)?.[1] ?? 0),
        path: repositoryPath(key),
        emitsEntities: emitted.entities,
        emitsRelationships: emitted.relationships,
      });
      break;
    }
  }
  return result;
}

export interface HmrcPackMetadata {
  id: string;
  version: number;
  extractors: { constant: string; id: string }[];
  candidateTypes: string[];
}

export function parseHmrcPack(source: string): HmrcPackMetadata {
  return {
    id: /const parserPackId = '([^']+)'/.exec(source)?.[1] ?? 'unknown',
    version: Number(/const parserPackVersion = (\d+)/.exec(source)?.[1] ?? 0),
    extractors: [
      ...source.matchAll(/^const (\w+ExtractorId) = '([^']+)'/gm),
    ].map((match) => ({ constant: match[1]!, id: match[2]! })),
    candidateTypes: [
      ...source.matchAll(/^export type (Hmrc\w+Candidate) =/gm),
    ].map((match) => match[1]!),
  };
}

/** Names imported from `from`, e.g. the normalisers a pack contributes. */
export function parseNamedImports(source: string, from: string): string[] {
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*'${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`,
  );
  const body = pattern.exec(source)?.[1] ?? '';
  return body
    .split(',')
    .map((item) => item.replace(/^\s*type\s+/, '').trim())
    .filter(Boolean);
}

/** Evidence locator kinds a processor implementation actually emits. */
export function emittedLocatorKinds(
  source: string,
  kinds: readonly string[],
): string[] {
  return kinds.filter((kind) => source.includes(`kind: '${kind}'`));
}

export function parseUnionLiterals(source: string, typeName: string): string[] {
  const match = new RegExp(`export type ${typeName} =([\\s\\S]*?);\\n`).exec(
    source,
  );
  return match ? quoted(match[1]!) : [];
}

export function parseEvidenceLocatorKinds(source: string): string[] {
  const match = /export type EvidenceLocator =([\s\S]*?)\n\n/.exec(source);
  if (!match) return [];
  return [...match[1]!.matchAll(/kind:\s*([^;]+);/g)].flatMap((kind) =>
    quoted(kind[1]!),
  );
}

export interface AdrMetadata {
  number: number;
  id: string;
  title: string;
  status: string;
  decision: string;
  /** The heading that carries the decision, e.g. "Decision" or "Proposal". */
  decisionHeading: string;
  path: string;
}

export function parseAdr(
  path: string,
  markdown: string,
): AdrMetadata | undefined {
  const heading = /^# (ADR-(\d+)):\s*(.+)$/m.exec(markdown);
  if (!heading) return undefined;
  const section =
    /^## (Decision|Proposed decision|Proposal)\s*\n+([^\n#][^\n]*)/im.exec(
      markdown,
    );
  const decision = section?.[2]?.trim() ?? '';
  return {
    number: Number(heading[2]),
    id: heading[1]!,
    title: heading[3]!.trim(),
    status: /\*\*Status:\*\*\s*([^\n]+)/.exec(markdown)?.[1]?.trim() ?? '',
    decision,
    decisionHeading: section?.[1] ?? 'Context',
    path,
  };
}

export interface MigrationTable {
  table: string;
  migration: string;
  path: string;
}

export function parseMigrationTables(
  sources: Record<string, string>,
): MigrationTable[] {
  const latest = new Map<string, MigrationTable>();
  for (const [key, sql] of Object.entries(sources).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const path = repositoryPath(key);
    const migration = path.split('/').pop() ?? path;
    for (const match of sql.matchAll(
      /^CREATE TABLE (?:IF NOT EXISTS )?(\w+)/gim,
    )) {
      latest.set(match[1]!, { table: match[1]!, migration, path });
    }
  }
  return [...latest.values()].sort((a, b) => a.table.localeCompare(b.table));
}

export const ENTITY_TYPES = parseConstStringArray(
  domainSource,
  'knowledgeEntityTypes',
);
export const RELATIONSHIP_VOCABULARY = parseConstStringArray(
  domainSource,
  'knowledgeRelationshipTypes',
);
export const PROCESSING_DEFINITIONS = parseProcessingDefinitions(domainSource);
export const DOCUMENT_PROCESSORS = parseDocumentProcessors(
  processingSource,
  PROCESSING_DEFINITIONS,
);
export const KNOWLEDGE_EXTRACTORS = parseKnowledgeExtractors(
  extractorRegistrySource,
  extractorSources,
  new Set(ENTITY_TYPES),
);
export const HMRC_PACK = parseHmrcPack(hmrcCandidatesSource);
export const DISCOVERY_EVENTS = parseUnionLiterals(
  domainSource,
  'DiscoveryEventName',
);
export const EVIDENCE_LOCATOR_KINDS = parseEvidenceLocatorKinds(domainSource);
export const ENTITY_LIFECYCLE = parseUnionLiterals(
  domainSource,
  'EntityLifecycleStatus',
);
export const ADRS: AdrMetadata[] = Object.entries(adrSources)
  .flatMap(([key, markdown]) => parseAdr(repositoryPath(key), markdown) ?? [])
  .sort((a, b) => a.number - b.number);
export const MIGRATION_TABLES = parseMigrationTables(migrationSources);
export const ROOT_SCRIPTS =
  (JSON.parse(rootPackageSource) as { scripts?: Record<string, string> })
    .scripts ?? {};

export function adr(number: number): AdrMetadata | undefined {
  return ADRS.find((item) => item.number === number);
}

export function migrationFor(table: string): MigrationTable | undefined {
  return MIGRATION_TABLES.find((item) => item.table === table);
}

const hmrcNormalizers = new Set(
  parseNamedImports(processingSource, './hmrc-scala-play.js'),
);

export const HMRC_PROCESSORS = DOCUMENT_PROCESSORS.filter((processor) =>
  hmrcNormalizers.has(processor.normalizer),
);
export const CORE_PROCESSORS = DOCUMENT_PROCESSORS.filter(
  (processor) => !hmrcNormalizers.has(processor.normalizer),
);
export const CORE_LOCATOR_KINDS = emittedLocatorKinds(
  processingSource,
  EVIDENCE_LOCATOR_KINDS,
);
export const HMRC_LOCATOR_KINDS = emittedLocatorKinds(
  hmrcNormalizerSource,
  EVIDENCE_LOCATOR_KINDS,
);

/** `knowledgePublicationPackageFormat` and its version, from domain-publication. */
export const PUBLICATION_FORMAT = {
  format:
    /knowledgePublicationPackageFormat =\s*'([^']+)'/.exec(
      publicationSource,
    )?.[1] ?? 'unknown',
  formatVersion: Number(
    /knowledgePublicationPackageFormatVersion = (\d+)/.exec(
      publicationSource,
    )?.[1] ?? 0,
  ),
};
