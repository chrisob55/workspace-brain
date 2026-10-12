import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  filterFaqSections,
  parseExecutiveSummary,
  parseFaqSections,
} from './architecture-faq';

const markdown = readFileSync(
  new URL('../../../../docs/architecture/architecture-faq.md', import.meta.url),
  'utf8',
);
const sections = parseFaqSections(markdown);

describe('architecture FAQ browser', () => {
  it('keeps every source question and answer, with unique IDs across topics', () => {
    const questions = sections.flatMap((section) => section.questions);
    expect(sections).toHaveLength(10);
    expect(questions).toHaveLength(
      [...markdown.matchAll(/^\d+\. \*\*(.+?)\*\*\s*$/gm)].length,
    );
    expect(new Set(questions.map((question) => question.id)).size).toBe(
      questions.length,
    );
    expect(
      questions.every((question) => question.question && question.answer),
    ).toBe(true);
    expect(questions.at(-1)?.answer).not.toContain(
      'Common Architecture Challenges',
    );
  });

  it('preserves answer paragraphs while unwrapping source lines', () => {
    const parsed = parseFaqSections(`### Section 1 - Example

1. **A question?**
   First line
   continued here.

   Another paragraph.

2. **Another question?**
   Second answer.

## Appendix
Not an answer.`);
    expect(parsed[0]?.questions[0]?.answer).toBe(
      'First line continued here.\n\nAnother paragraph.',
    );
    expect(parsed[0]?.questions[1]?.answer).toBe('Second answer.');
  });

  it('retains the full executive summary behind the compact view', () => {
    const summary = parseExecutiveSummary(markdown);
    expect(summary).toHaveLength(5);
    expect(summary[0]).toContain(
      'local-first Knowledge Model Production Platform',
    );
    expect(summary[4]).toContain('proposed, not an accepted runtime contract');
    expect(summary.join(' ')).not.toContain(
      'What problem does Workspace Brain solve?',
    );
    expect(
      parseExecutiveSummary('## Executive Summary\n\nOnly paragraph.'),
    ).toEqual(['Only paragraph.']);
  });

  it('combines topic filtering with searches of both questions and answers', () => {
    expect(filterFaqSections(sections, '', '')).toEqual(sections);
    expect(filterFaqSections(sections, 'section-2', '')).toEqual([sections[1]]);
    const matches = filterFaqSections(sections, '', '  QDRANT  ');
    expect(matches.length).toBeGreaterThan(0);
    expect(
      matches
        .flatMap((section) => section.questions)
        .every(({ question, answer }) =>
          `${question} ${answer}`.toLowerCase().includes('qdrant'),
        ),
    ).toBe(true);
    expect(filterFaqSections(sections, 'section-2', 'qdrant')).toEqual([]);
    expect(filterFaqSections(sections, '', 'no-such-question')).toEqual([]);
    expect(filterFaqSections([], '', '')).toEqual([]);
  });
});
