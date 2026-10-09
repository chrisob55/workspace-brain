import { posix } from 'node:path';
import {
  createKnowledgeEntityKey,
  type KnowledgeEntityCandidate,
  type KnowledgeInputEvidence,
  type KnowledgeProvenance,
  type KnowledgeRelationshipCandidate,
  type ExtractionDocument,
} from '@workspace-brain/domain';

export type KnowledgeCandidates = {
  readonly entities: readonly KnowledgeEntityCandidate[];
  readonly relationships: readonly KnowledgeRelationshipCandidate[];
};
export type ExtractionDiagnostic = {
  readonly extractorId: string;
  readonly evidenceId: string;
  readonly documentPath: string;
  readonly disposition: 'unresolved' | 'rejected';
  readonly reason: string;
  readonly target: string;
};
export type ExtractorResult = KnowledgeCandidates & {
  readonly diagnostics?: readonly ExtractionDiagnostic[];
};
export type KnowledgeExtractor = {
  readonly id: string;
  readonly version: number;
  readonly stage?: number;
  supports(inputs: readonly KnowledgeInputEvidence[]): boolean;
  extract(
    inputs: readonly KnowledgeInputEvidence[],
    candidates?: KnowledgeCandidates,
  ): ExtractorResult;
};

export class CandidateBuilder {
  private readonly entities = new Map<string, KnowledgeEntityCandidate>();
  private readonly relationships = new Map<
    string,
    KnowledgeRelationshipCandidate
  >();
  private readonly diagnostics: ExtractionDiagnostic[] = [];
  constructor(
    private readonly id: string,
    private readonly version: number,
  ) {}

  entity(
    type: KnowledgeEntityCandidate['type'],
    name: string,
    scope: string,
    inputs: readonly KnowledgeInputEvidence[],
    extra: Pick<
      KnowledgeProvenance,
      'repositoryBoundary' | 'resolvedDocument' | 'facts'
    > = {},
  ): string {
    const first = inputs[0];
    if (first === undefined || !name.trim()) {
      throw new Error(
        `Extractor ${this.id} attempted an entity without complete evidence`,
      );
    }
    const key = createKnowledgeEntityKey(
      type,
      first.document.sourceId,
      scope,
      name.trim(),
    );
    this.merge({
      entities: [
        {
          key,
          type,
          identityScope: scope,
          name: name.trim(),
          sourceEvidenceIds: inputs.map((input) => input.evidence.id),
          provenance: inputs.map((input) => this.provenance(input, extra)),
          lifecycleStatus: 'observed',
        },
      ],
      relationships: [],
    });
    return key;
  }

  relationship(
    type: KnowledgeRelationshipCandidate['type'],
    source: string,
    target: string,
    inputs: readonly KnowledgeInputEvidence[],
    extra: Pick<
      KnowledgeProvenance,
      'repositoryBoundary' | 'resolvedDocument' | 'facts'
    > = {},
  ): void {
    if (source === target) return;
    if (inputs.length === 0) {
      throw new Error(
        `Extractor ${this.id} attempted a relationship without complete evidence`,
      );
    }
    this.merge({
      entities: [],
      relationships: [
        {
          key: `${type}:${source}->${target}`,
          type,
          sourceEntityKey: source,
          targetEntityKey: target,
          sourceEvidenceIds: inputs.map((input) => input.evidence.id),
          provenance: inputs.map((input) => this.provenance(input, extra)),
          confidence: 1,
          lifecycleStatus: 'related',
        },
      ],
    });
  }

  diagnose(
    input: KnowledgeInputEvidence,
    disposition: ExtractionDiagnostic['disposition'],
    reason: string,
    target: string,
  ): void {
    this.diagnostics.push({
      extractorId: this.id,
      evidenceId: input.evidence.id,
      documentPath: input.document.path,
      disposition,
      reason,
      target,
    });
  }
  merge(candidates: ExtractorResult): void {
    this.diagnostics.push(...(candidates.diagnostics ?? []));
    for (const item of candidates.entities) {
      const previous = this.entities.get(item.key);
      if (
        previous &&
        (previous.type !== item.type ||
          previous.name !== item.name ||
          previous.identityScope !== item.identityScope ||
          previous.lifecycleStatus !== item.lifecycleStatus)
      ) {
        throw new Error(`Conflicting entity candidate ${item.key}`);
      }
      this.entities.set(item.key, { ...item, ...mergeSupport(previous, item) });
    }
    for (const item of candidates.relationships) {
      const previous = this.relationships.get(item.key);
      if (
        previous &&
        (previous.type !== item.type ||
          previous.sourceEntityKey !== item.sourceEntityKey ||
          previous.targetEntityKey !== item.targetEntityKey ||
          previous.confidence !== item.confidence ||
          previous.lifecycleStatus !== item.lifecycleStatus)
      ) {
        throw new Error(`Conflicting relationship candidate ${item.key}`);
      }
      this.relationships.set(item.key, {
        ...item,
        ...mergeSupport(previous, item),
      });
    }
  }
  result(): ExtractorResult {
    return {
      entities: [...this.entities.values()].sort((a, b) =>
        ordinal(a.key, b.key),
      ),
      relationships: [...this.relationships.values()].sort((a, b) =>
        ordinal(a.key, b.key),
      ),
      diagnostics: [...this.diagnostics].sort((a, b) =>
        ordinal(JSON.stringify(a), JSON.stringify(b)),
      ),
    };
  }
  private provenance(
    input: KnowledgeInputEvidence,
    extra: Pick<
      KnowledgeProvenance,
      'repositoryBoundary' | 'resolvedDocument' | 'facts'
    >,
  ): KnowledgeProvenance {
    return {
      evidenceId: input.evidence.id,
      documentVersionId: input.documentVersion.id,
      documentId: input.document.id,
      sourceId: input.document.sourceId,
      documentPath: input.document.path,
      contentFingerprint: input.provenance.contentFingerprint,
      locator: input.evidence.locator,
      processorId: input.provenance.processorId,
      processorVersion: input.provenance.processorVersion,
      extractionRuleId: input.provenance.extractionRuleId,
      extractionRuleVersion: input.provenance.extractionRuleVersion,
      knowledgeExtractorId: this.id,
      knowledgeExtractorVersion: this.version,
      ...extra,
    };
  }
}

function mergeSupport(
  previous: { readonly provenance: readonly KnowledgeProvenance[] } | undefined,
  item: { readonly provenance: readonly KnowledgeProvenance[] },
) {
  const support = new Map<string, KnowledgeProvenance>();
  for (const provenance of [
    ...(previous?.provenance ?? []),
    ...item.provenance,
  ]) {
    const existing = support.get(provenance.evidenceId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(provenance)) {
      throw new Error(`Conflicting extractor support ${provenance.evidenceId}`);
    }
    support.set(provenance.evidenceId, provenance);
  }
  const provenance = [...support.values()].sort((a, b) =>
    ordinal(a.evidenceId, b.evidenceId),
  );
  return {
    provenance,
    sourceEvidenceIds: provenance.map((item) => item.evidenceId),
  };
}
export const ordinal = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
export const decodePointer = (value: string): string =>
  value.replace(/~1/g, '/').replace(/~0/g, '~');
export const scalarKey = (input: KnowledgeInputEvidence): string =>
  input.evidence.key.replace(/^(?:json|yaml):/, '');
export function stringScalar(
  input: KnowledgeInputEvidence,
  inputs: readonly KnowledgeInputEvidence[],
): boolean {
  if (input.evidence.truncated) return false;
  if (input.documentVersion.processorVersion < 3) return true;
  const key = input.evidence.key.replace(/^(json|yaml):/, '$1-type:');
  return inputs.some(
    (item) =>
      item.evidence.key === key &&
      item.evidence.excerpt === 'string' &&
      !item.evidence.truncated,
  );
}
export const moduleScope = (path: string): string =>
  path.replace(/\.(?:tsx?|jsx?)$/i, '');
export const moduleName = (path: string): string =>
  moduleScope(path.split('/').slice(1).join('/'));
export function owningRepository(
  input: KnowledgeInputEvidence,
  path = input.document.path,
) {
  return input.extractionContext?.repositories
    .filter((repo) => path.startsWith(repo.path + '/'))
    .sort(
      (a, b) => b.path.length - a.path.length || ordinal(a.path, b.path),
    )[0];
}
export function resolveDocument(
  input: KnowledgeInputEvidence,
  href: string,
  kind: 'link' | 'manifest' = 'link',
): ExtractionDocument | undefined {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(href) ||
    href.startsWith('/') ||
    href.includes('\\') ||
    href.includes('\0')
  )
    return undefined;
  if (kind === 'manifest' && /[?#*]/.test(href)) return undefined;
  const raw = kind === 'manifest' ? href : href.split(/[?#]/)[0];
  if (!raw) return undefined;
  let decoded: string;
  try {
    decoded = kind === 'manifest' ? raw : decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  if (
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    decoded.startsWith('/')
  )
    return undefined;
  const path = posix.normalize(
    posix.join(posix.dirname(input.document.path), decoded),
  );
  if (path.split('/')[0] !== input.document.path.split('/')[0])
    return undefined;
  return input.extractionContext?.documents.find(
    (document) => document.path === path,
  );
}
