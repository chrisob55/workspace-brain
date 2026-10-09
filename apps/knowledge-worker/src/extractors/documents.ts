import { posix } from 'node:path';
import type {
  KnowledgeInputEvidence,
  ExtractionDocument,
  KnowledgeProvenance,
} from '@workspace-brain/domain';
import {
  CandidateBuilder,
  resolveDocument,
  type KnowledgeExtractor,
} from './framework.js';

const adrId = (filename: string): string | undefined =>
  /^(ADR-\d+)(?:[-_.]|$)/i.exec(filename)?.[1]?.toUpperCase();
function documentEntity(
  output: CandidateBuilder,
  input: KnowledgeInputEvidence,
  target?: ExtractionDocument,
  extra: Pick<KnowledgeProvenance, 'facts'> = {},
  explicitDecision?: string,
) {
  const path = target?.path ?? input.document.path;
  const filename = target?.filename ?? input.document.filename;
  const decision = adrId(filename) ?? (target ? undefined : explicitDecision);
  return output.entity(
    decision ? 'architectural-decision' : 'document',
    decision ?? filename,
    path,
    [input],
    { ...extra, ...(target ? { resolvedDocument: target } : {}) },
  );
}
const markdown = (inputs: readonly KnowledgeInputEvidence[]) =>
  /\.(?:md|markdown)$/i.test(inputs[0]?.document.filename ?? '');

export const markdownReferenceExtractor: KnowledgeExtractor = {
  id: 'markdown-references',
  version: 1,
  supports: markdown,
  extract(inputs) {
    const output = new CandidateBuilder(this.id, this.version);
    const own = inputs.find(
      (input) =>
        !input.evidence.truncated &&
        (input.evidence.kind === 'heading' ||
          input.evidence.kind === 'paragraph'),
    );
    if (
      own &&
      !adrId(own.document.filename) &&
      !inputs.some(
        (input) =>
          input.evidence.key.startsWith('markdown-metadata:') &&
          /^(?:[-*]\s+)?(?:\*\*)?ADR-ID:(?:\*\*)?\s*ADR-\d+$/i.test(
            input.evidence.excerpt,
          ),
      )
    ) {
      documentEntity(output, own);
    }
    for (const input of inputs) {
      if (
        input.evidence.truncated ||
        !input.evidence.key.startsWith('markdown-link:')
      )
        continue;
      if (
        adrId(input.document.filename) ||
        inputs.some(
          (item) =>
            item.evidence.key.startsWith('markdown-metadata:') &&
            /^(?:[-*]\s+)?(?:\*\*)?ADR-ID:(?:\*\*)?\s*ADR-\d+$/i.test(
              item.evidence.excerpt,
            ),
        )
      )
        continue;
      const target = resolveDocument(input, input.evidence.excerpt);
      if (!target) {
        output.diagnose(
          input,
          'unresolved',
          'LINK_TARGET_NOT_DISCOVERED_OR_UNSUPPORTED',
          input.evidence.excerpt,
        );
        continue;
      }
      if (target.path === input.document.path) continue;
      // ADR endpoints are handled solely by the ADR extractor to avoid duplicate support.
      if (adrId(input.document.filename) || adrId(target.filename)) continue;
      const source = documentEntity(output, input);
      const destination = documentEntity(output, input, target);
      output.relationship('REFERENCES', source, destination, [input], {
        resolvedDocument: target,
      });
    }
    return output.result();
  },
};

export const adrExtractor: KnowledgeExtractor = {
  id: 'architectural-decisions',
  version: 1,
  supports: (inputs) => markdown(inputs),
  extract(inputs) {
    const output = new CandidateBuilder(this.id, this.version);
    const explicit = inputs.find(
      (input) =>
        !input.evidence.truncated &&
        input.evidence.key.startsWith('markdown-metadata:') &&
        /^(?:[-*]\s+)?(?:\*\*)?ADR-ID:(?:\*\*)?\s*ADR-\d+$/i.test(
          input.evidence.excerpt,
        ),
    );
    const decisionId =
      adrId(inputs[0]?.document.filename ?? '') ??
      /ADR-\d+$/i.exec(explicit?.evidence.excerpt ?? '')?.[0]?.toUpperCase();
    const isAdr = decisionId !== undefined;
    for (const input of inputs) {
      if (input.evidence.truncated || input.evidence.kind === 'code-block')
        continue;
      const metadata = input.evidence.key.startsWith('markdown-metadata:')
        ? /^(?:[-*]\s+)?(?:\*\*)?(Status|Supersedes|Superseded[- ]by|Related decisions|References|ADR-ID):(?:\*\*)?\s*(.+)$/i.exec(
            input.evidence.excerpt,
          )
        : null;
      if (isAdr && metadata) {
        const field = (metadata[1] ?? '').toLowerCase();
        const value = (metadata[2] ?? '').trim();
        const source = documentEntity(
          output,
          input,
          undefined,
          { facts: { [field]: value } },
          decisionId,
        );
        if (field === 'status' || field === 'adr-id') continue;
        // Metadata reference lists must consist exclusively of ADR identifiers.
        if (!/^(?:ADR-\d+)(?:\s*[,;]\s*ADR-\d+)*$/i.test(value)) continue;
        for (const identifier of value.split(/\s*[,;]\s*/)) {
          const matches =
            input.extractionContext?.documents.filter(
              (document) =>
                posix.dirname(document.path) ===
                  posix.dirname(input.document.path) &&
                adrId(document.filename) === identifier.toUpperCase(),
            ) ?? [];
          if (matches.length !== 1) {
            output.diagnose(
              input,
              'unresolved',
              'ADR_TARGET_MISSING_OR_AMBIGUOUS',
              identifier,
            );
            continue;
          }
          const target = matches[0];
          if (!target) continue;
          if (target.path === input.document.path) continue;
          const destination = documentEntity(output, input, target);
          output.relationship('REFERENCES', source, destination, [input], {
            resolvedDocument: target,
            facts: { referenceKind: field },
          });
        }
      }
      if (
        isAdr &&
        input.evidence.kind === 'heading' &&
        /^ADR-\d+\b/i.test(input.evidence.excerpt)
      ) {
        documentEntity(output, input, undefined, {}, decisionId);
      }
      if (!input.evidence.key.startsWith('markdown-link:')) continue;
      const target = resolveDocument(input, input.evidence.excerpt);
      if (!target) {
        if (isAdr)
          output.diagnose(
            input,
            'unresolved',
            'LINK_TARGET_NOT_DISCOVERED_OR_UNSUPPORTED',
            input.evidence.excerpt,
          );
        continue;
      }
      if (
        target.path === input.document.path ||
        (!isAdr && !adrId(target.filename))
      )
        continue;
      const source = documentEntity(output, input, undefined, {}, decisionId);
      const destination = documentEntity(output, input, target);
      const metadataInput = inputs.find(
        (item) =>
          item.evidence.key.startsWith('markdown-metadata:') &&
          item.evidence.locator.kind !== 'json-pointer' &&
          input.evidence.locator.kind !== 'json-pointer' &&
          item.evidence.locator.lineStart ===
            input.evidence.locator.lineStart &&
          /^(?:[-*]\s+)?(?:\*\*)?(Supersedes|Superseded[- ]by):/i.test(
            item.evidence.excerpt,
          ),
      );
      const referenceKind = metadataInput
        ? /(?:Supersedes|Superseded[- ]by)/i
            .exec(metadataInput.evidence.excerpt)?.[0]
            ?.toLowerCase()
        : undefined;
      output.relationship('REFERENCES', source, destination, [input], {
        resolvedDocument: target,
        ...(referenceKind ? { facts: { referenceKind } } : {}),
      });
    }
    return output.result();
  },
};
