import type { KnowledgeInputEvidence } from '@workspace-brain/domain';
import {
  CandidateBuilder,
  type KnowledgeCandidates,
  type KnowledgeExtractor,
} from './extractors/framework.js';
import {
  packageExtractor,
  moduleExtractor,
  containerExtractor,
} from './extractors/dependencies.js';
import { openApiExtractor } from './extractors/openapi.js';
import { repositoryExtractor } from './extractors/repositories.js';
import {
  adrExtractor,
  markdownReferenceExtractor,
} from './extractors/documents.js';

export type {
  KnowledgeCandidates,
  KnowledgeExtractor,
} from './extractors/framework.js';
export const knowledgeExtractors: readonly KnowledgeExtractor[] = [
  packageExtractor,
  moduleExtractor,
  containerExtractor,
  openApiExtractor,
  repositoryExtractor,
  adrExtractor,
  markdownReferenceExtractor,
];

export function extractKnowledgeCandidates(
  inputs: readonly KnowledgeInputEvidence[],
  registry: readonly KnowledgeExtractor[] = knowledgeExtractors,
): KnowledgeCandidates {
  return extractKnowledgeReport(inputs, registry).candidates;
}

export function extractKnowledgeReport(
  inputs: readonly KnowledgeInputEvidence[],
  registry: readonly KnowledgeExtractor[] = knowledgeExtractors,
) {
  const document = inputs[0]?.document;
  const contributions: {
    extractorId: string;
    version: number;
    entities: number;
    relationships: number;
  }[] = [];
  if (document === undefined)
    return {
      candidates: { entities: [], relationships: [] },
      contributions,
      diagnostics: [],
    };
  if (
    inputs.some(
      (input) =>
        input.document.id !== document.id ||
        input.document.path !== document.path ||
        input.documentVersion.id !== inputs[0]?.documentVersion.id ||
        input.document.sourceId !== document.sourceId,
    )
  )
    throw new Error(
      'Knowledge extraction inputs must belong to one document version',
    );
  if (
    new Set(registry.map((extractor) => extractor.id)).size !== registry.length
  ) {
    throw new Error('Duplicate knowledge extractor registration');
  }
  if (
    registry.some(
      (extractor) =>
        !/^[a-z][a-z0-9-]{0,127}$/.test(extractor.id) ||
        !Number.isSafeInteger(extractor.version) ||
        extractor.version < 1 ||
        !Number.isSafeInteger(extractor.stage ?? 0) ||
        (extractor.stage ?? 0) < 0,
    )
  ) {
    throw new Error('Invalid knowledge extractor registration');
  }
  const context = inputs[0]?.extractionContext;
  if (
    inputs.some(
      (input) =>
        input.extractionContext !== undefined &&
        JSON.stringify(input.extractionContext) !== JSON.stringify(context),
    )
  ) {
    throw new Error('Conflicting immutable extraction contexts');
  }
  const normalizedInputs =
    context === undefined
      ? inputs
      : inputs.map((input) => ({
          ...input,
          extractionContext: context,
        }));
  const combined = new CandidateBuilder('registry', 1);
  for (const extractor of [...registry].sort(
    (a, b) =>
      (a.stage ?? 0) - (b.stage ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )) {
    if (!extractor.supports(normalizedInputs)) continue;
    const result = extractor.extract(normalizedInputs, combined.result());
    contributions.push({
      extractorId: extractor.id,
      version: extractor.version,
      entities: result.entities.length,
      relationships: result.relationships.length,
    });
    combined.merge(result);
  }
  const result = combined.result();
  return {
    candidates: {
      entities: result.entities,
      relationships: result.relationships,
    },
    contributions,
    diagnostics: result.diagnostics ?? [],
  };
}
