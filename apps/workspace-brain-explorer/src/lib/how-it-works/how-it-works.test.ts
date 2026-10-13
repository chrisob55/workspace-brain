import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildKnowledgeGraph } from '../knowledge-graph';
import {
  ADRS,
  DOCUMENT_PROCESSORS,
  HMRC_NORMALIZERS_PATH,
  HMRC_PROCESSORS,
  KNOWLEDGE_EXTRACTORS,
  MIGRATION_TABLES,
  PROCESSING_PATH,
  PUBLICATION_FORMAT,
  ROOT_SCRIPTS,
  adr,
} from '../implementation-metadata';
import {
  apiOperation,
  apiSchema,
  OPENAPI,
  routeHandlerSymbol,
} from '../openapi-contract';
import { locateSymbol } from '../source-files';
import type { PublicationPackage } from '../types';
import {
  NEW_PACK_CHECKLIST,
  ONBOARDING,
  PARSER_PACKS,
  PUBLICATION_ANATOMY,
  QUICK_LINKS,
} from './catalogue';
import {
  API_REFS,
  CONCEPT_BY_ID,
  CONCEPTS,
  EXPLORER_REFS,
  PIPELINE,
  SEARCH_REFS,
  type CodeRef,
} from './concepts';
import {
  apisJourney,
  conceptExample,
  dependentsJourney,
  discoveryExample,
  evidenceExamples,
  knowledgeMapping,
  preferredRepository,
} from './examples';
import { exampleRequestPath, isRunnable } from './requests';
import { deepLinkHash, parseDeepLink, SECTIONS } from './sections';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8');
const API_SERVER = 'apps/workspace-brain-api/src/server.ts';

const ALL_REFS: [string, CodeRef][] = [
  ...CONCEPTS.flatMap((item) =>
    item.implementedBy.map(
      (ref) => [`concept ${item.id}`, ref] as [string, CodeRef],
    ),
  ),
  ...SEARCH_REFS.map((ref) => ['SEARCH_REFS', ref] as [string, CodeRef]),
  ...API_REFS.map((ref) => ['API_REFS', ref] as [string, CodeRef]),
  ...EXPLORER_REFS.map((ref) => ['EXPLORER_REFS', ref] as [string, CodeRef]),
  ...PARSER_PACKS.flatMap((pack) =>
    pack.refs.map((ref) => [`pack ${pack.id}`, ref] as [string, CodeRef]),
  ),
  ...NEW_PACK_CHECKLIST.flatMap((item) =>
    item.refs.map((ref) => [`checklist ${item.id}`, ref] as [string, CodeRef]),
  ),
  ...PUBLICATION_ANATOMY.map(
    (node) => [`anatomy ${node.id}`, node.producer] as [string, CodeRef],
  ),
  ...ONBOARDING.flatMap((step) =>
    step.refs.map((ref) => [`onboarding ${step.id}`, ref] as [string, CodeRef]),
  ),
  ...QUICK_LINKS.flatMap((link) =>
    link.ref
      ? [[`quick link ${link.label}`, link.ref] as [string, CodeRef]]
      : [],
  ),
  ...KNOWLEDGE_EXTRACTORS.map(
    (item) =>
      [
        `extractor ${item.id}`,
        { path: item.path, symbol: item.exportName, kind: 'constant' },
      ] as [string, CodeRef],
  ),
  ...DOCUMENT_PROCESSORS.map(
    (item) =>
      [
        `processor ${item.id}`,
        {
          path: HMRC_PROCESSORS.includes(item)
            ? HMRC_NORMALIZERS_PATH
            : PROCESSING_PATH,
          symbol: item.normalizer,
          kind: 'function',
        },
      ] as [string, CodeRef],
  ),
  ...MIGRATION_TABLES.map(
    (item) =>
      [
        `table ${item.table}`,
        { path: item.path, symbol: item.table, kind: 'table' },
      ] as [string, CodeRef],
  ),
  ...ADRS.map(
    (item) =>
      [
        `${item.id} decision`,
        { path: item.path, symbol: item.decisionHeading, kind: 'doc' },
      ] as [string, CodeRef],
  ),
  ...OPENAPI.operations.flatMap((operation) => [
    [
      `route ${operation.operationId}`,
      {
        path: API_SERVER,
        symbol: routeHandlerSymbol(operation),
        kind: 'function',
      },
    ] as [string, CodeRef],
    [
      `openapi ${operation.operationId}`,
      {
        path: 'openapi/openapi.json',
        symbol: `text:"operationId": "${operation.operationId}"`,
        kind: 'config',
      },
    ] as [string, CodeRef],
  ]),
  ...Object.keys(OPENAPI.schemas).map(
    (name) =>
      [
        `schema ${name}`,
        { path: 'openapi/openapi.json', symbol: name, kind: 'config' },
      ] as [string, CodeRef],
  ),
];

describe('How Workspace Brain Works: code references', () => {
  it.each(
    ALL_REFS.map(
      ([owner, ref]) =>
        [
          `${owner} → ${ref.path}${ref.symbol ? `#${ref.symbol}` : ''}`,
          ref,
        ] as const,
    ),
  )('%s resolves', (_label, ref) => {
    expect(existsSync(`${ROOT}${ref.path}`), `${ref.path} exists`).toBe(true);
    if (ref.symbol)
      expect(
        locateSymbol(read(ref.path), ref.symbol),
        `${ref.symbol} in ${ref.path}`,
      ).toBeDefined();
  });

  it('references only ADRs, operations and schemas that exist', () => {
    const adrs = [
      ...CONCEPTS.flatMap((item) => item.adrs),
      ...PARSER_PACKS.flatMap((pack) => pack.adrs),
      ...QUICK_LINKS.flatMap((link) => link.adr ?? []),
    ];
    for (const number of adrs)
      expect(adr(number), `ADR ${number}`).toBeDefined();
    const operations = [
      ...CONCEPTS.flatMap((item) => item.apis),
      ...PUBLICATION_ANATOMY.flatMap((node) => node.operationId ?? []),
      ...QUICK_LINKS.flatMap((link) => link.operationId ?? []),
      'getPublishedEntity',
      'listPublishedEntityRelationships',
      'searchProjectedRelationships',
      'searchProjectedEntities',
    ];
    for (const id of operations) expect(apiOperation(id), id).toBeDefined();
    const schemas = [
      ...CONCEPTS.flatMap((item) => item.schemas),
      ...PUBLICATION_ANATOMY.flatMap((node) => node.schema ?? []),
      ...QUICK_LINKS.flatMap((link) => link.schema ?? []),
      'KnowledgeEntity',
    ];
    for (const name of schemas) expect(apiSchema(name), name).toBeDefined();
  });

  it('links concepts, pipeline stages and onboarding to things that exist', () => {
    for (const item of CONCEPTS)
      for (const id of item.related)
        expect(CONCEPT_BY_ID.has(id), `${item.id} → ${id}`).toBe(true);
    for (const stage of PIPELINE)
      expect(CONCEPT_BY_ID.has(stage.conceptId), stage.id).toBe(true);
    for (const step of ONBOARDING) {
      for (const script of step.scripts)
        expect(ROOT_SCRIPTS[script], script).toBeDefined();
      if (step.section)
        expect(
          SECTIONS.some((section) => section.id === step.section),
          step.section,
        ).toBe(true);
    }
  });

  it('covers every glossary term the page promises', () => {
    expect(CONCEPTS.map((item) => item.term)).toEqual(
      expect.arrayContaining([
        'Source',
        'Discovery',
        'Evidence',
        'Knowledge Model',
        'Publication',
        'Parser Pack',
        'Extractor',
        'Relationship',
        'Currency',
        'Provenance',
        'Consumer',
        'Context Package',
      ]),
    );
  });

  it('derives the publication format from domain-publication', () => {
    expect(PUBLICATION_FORMAT).toEqual({
      format: 'workspace-brain-knowledge-publication',
      formatVersion: 1,
    });
  });
});

describe('How Workspace Brain Works: deep links', () => {
  it('round-trips section and item', () => {
    expect(parseDeepLink(deepLinkHash('glossary', 'knowledge-model'))).toEqual({
      section: 'glossary',
      item: 'knowledge-model',
    });
    expect(parseDeepLink('#/how-it-works/pipeline')).toEqual({
      section: 'pipeline',
    });
    expect(parseDeepLink('#/how-it-works')).toEqual({});
    expect(parseDeepLink('#/how-it-works/unknown/x')).toEqual({});
    expect(parseDeepLink('#/graph/glossary')).toEqual({});
  });
});

describe('How Workspace Brain Works: examples from the snapshot publication', () => {
  const pkg = JSON.parse(
    read('apps/workspace-brain-explorer/public/snapshot/publication.json'),
  ) as PublicationPackage;
  const graph = buildKnowledgeGraph(pkg);

  it('matches the snapshot package format', () => {
    expect({ format: pkg.format, formatVersion: pkg.formatVersion }).toEqual(
      PUBLICATION_FORMAT,
    );
  });

  it('builds a discovery record for a real repository', () => {
    const example = discoveryExample(graph);
    expect(example?.repository.type).toBe('repository');
    expect(example?.output.documentsContributingKnowledge).toBeGreaterThan(0);
  });

  it('finds evidence examples with value, source and provenance', () => {
    const examples = evidenceExamples(graph);
    expect(examples.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'repository-name',
        'package-name',
        'dependency',
        'openapi-endpoint',
        'docker-service',
      ]),
    );
    for (const item of examples) {
      expect(item.value).not.toBe('');
      expect(item.source).not.toBe('');
      expect(item.provenance.length).toBeGreaterThan(0);
    }
    expect(
      examples.find((item) => item.id === 'dependency')?.confidence,
    ).toBeTypeOf('number');
  });

  it('maps the five knowledge concepts', () => {
    expect(knowledgeMapping(graph).map((row) => row.concept)).toEqual([
      'Capability',
      'Service',
      'API',
      'Dependency',
      'Ownership',
    ]);
  });

  it('answers the dependency journey, falling back when the target is unknown', () => {
    const journey = dependentsJourney(graph, 'Agent Invitations');
    expect(journey).toBeDefined();
    expect(journey!.stages.map((stage) => stage.id)).toEqual([
      'publication',
      'dependency-graph',
      'relationship-index',
      'answer',
    ]);
    expect(journey!.dependents.length).toBeGreaterThan(0);
    const exact = dependentsJourney(graph, journey!.target.name);
    expect(exact?.matched).toBe(true);
  });

  it('answers the APIs journey for a repository', () => {
    const repository = preferredRepository(graph)!.name;
    const journey = apisJourney(graph, repository);
    expect(journey.stages.map((stage) => stage.id)).toEqual([
      'repository',
      'evidence',
      'knowledge-model',
      'publication',
    ]);
    expect(journey.apis.length).toBeGreaterThan(0);
  });

  it('has a live example for every implemented concept', () => {
    for (const item of CONCEPTS.filter((entry) => entry.status !== 'planned'))
      if (!['currency'].includes(item.id))
        expect(conceptExample(item.id, graph), item.id).toBeDefined();
  });

  it('fills example API requests from the publication', () => {
    const operation = apiOperation('getPublishedEntity')!;
    const path = exampleRequestPath(operation, graph);
    expect(isRunnable(path)).toBe(true);
    expect(path).toContain(graph.meta.publicationId);
  });
});
