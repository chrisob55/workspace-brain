/** The sections of "How Workspace Brain Works", in reading order. */
export interface DocSectionMeta {
  id: string;
  title: string;
  question: string;
}

export const SCREEN_ID = 'how-it-works';

export const SECTIONS: DocSectionMeta[] = [
  {
    id: 'overview',
    title: 'Platform Overview',
    question: 'What does it do and why?',
  },
  {
    id: 'pipeline',
    title: 'Knowledge Pipeline',
    question: 'How is knowledge produced?',
  },
  {
    id: 'parser-packs',
    title: 'Parser Packs',
    question: 'How does it learn an organisation?',
  },
  {
    id: 'anatomy',
    title: 'Anatomy of a Publication',
    question: 'What gets published?',
  },
  {
    id: 'journeys',
    title: 'Query Journeys',
    question: 'How is a question answered?',
  },
  {
    id: 'code',
    title: 'Code Explorer',
    question: 'Where does it live in code?',
  },
  { id: 'glossary', title: 'Terminology', question: 'What do the words mean?' },
  {
    id: 'ai-os',
    title: 'AI-OS Integration',
    question: 'How does AI-OS use it?',
  },
  {
    id: 'onboarding',
    title: 'Developer Onboarding',
    question: 'Where do I start?',
  },
];

export interface DeepLink {
  section?: string;
  item?: string;
}

/** Parses `#/how-it-works/<section>/<item>`. */
export function parseDeepLink(hash: string): DeepLink {
  const [screen, section, ...rest] = hash.replace(/^#\/?/, '').split('/');
  if (screen !== SCREEN_ID || !section) return {};
  if (!SECTIONS.some((entry) => entry.id === section)) return {};
  const item = rest.length > 0 ? decodeURIComponent(rest.join('/')) : undefined;
  return item ? { section, item } : { section };
}

export function deepLinkHash(section: string, item?: string): string {
  return `#/${SCREEN_ID}/${section}${item ? `/${encodeURIComponent(item)}` : ''}`;
}

export const sectionElementId = (section: string) => `hiw-${section}`;
