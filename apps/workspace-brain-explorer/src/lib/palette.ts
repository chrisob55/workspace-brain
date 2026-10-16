import {
  Box,
  Boxes,
  Container,
  FileCode2,
  FileText,
  FolderGit2,
  Landmark,
  Package,
  Plug,
  Route,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import type { RelationshipType } from './types';

export const RELATIONSHIP_STYLE: Record<
  RelationshipType,
  { color: string; label: string; description: string }
> = {
  DEPENDS_ON: {
    color: '#818cf8',
    label: 'Depends on',
    description:
      'An implementation dependency: an import or a manifest dependency.',
  },
  CONTAINS: {
    color: '#34d399',
    label: 'Contains',
    description:
      'A structural boundary: a repository contains packages and modules.',
  },
  EXPOSES: {
    color: '#f59e0b',
    label: 'Exposes',
    description:
      'An API exposes an operation declared in its OpenAPI contract.',
  },
  REFERENCES: {
    color: '#f472b6',
    label: 'References',
    description: 'An evidence-backed reference to another published entity.',
  },
  USES: {
    color: '#38bdf8',
    label: 'Uses',
    description:
      'A source-backed component invocation or Journey participation link.',
  },
  CONSUMES: {
    color: '#fb923c',
    label: 'Consumes',
    description:
      'A statically resolved HTTP client/API interaction, not a runtime trace.',
  },
  DERIVED_FROM: {
    color: '#a78bfa',
    label: 'Derived from',
    description:
      'The published source document supporting a Journey or step; exact evidence IDs are in provenance.',
  },
  BELONGS_TO: {
    color: '#2dd4bf',
    label: 'Belongs to',
    description: 'Membership of a published structural boundary.',
  },
  DOCUMENTS: {
    color: '#22d3ee',
    label: 'Documents',
    description: 'A source-backed documentation relationship.',
  },
  IMPLEMENTS: {
    color: '#818cf8',
    label: 'Implements',
    description: 'An explicitly established implementation relationship.',
  },
  CLASSIFIED_AS: {
    color: '#e879f9',
    label: 'Classified as',
    description: 'An evidence-backed classification.',
  },
};

export const ENTITY_STYLE: Record<
  string,
  { color: string; icon: LucideIcon; label: string }
> = {
  repository: { color: '#34d399', icon: FolderGit2, label: 'Repository' },
  package: { color: '#818cf8', icon: Package, label: 'Package' },
  module: { color: '#a5b4fc', icon: FileCode2, label: 'Module' },
  api: { color: '#f59e0b', icon: Plug, label: 'API' },
  operation: { color: '#fbbf24', icon: Workflow, label: 'Operation' },
  journey: { color: '#c084fc', icon: Route, label: 'Journey' },
  'architectural-decision': { color: '#f472b6', icon: Landmark, label: 'ADR' },
  document: { color: '#22d3ee', icon: FileText, label: 'Document' },
  container: { color: '#94a3b8', icon: Container, label: 'Container' },
};

export function entityStyle(type: string) {
  return ENTITY_STYLE[type] ?? { color: '#94a3b8', icon: Box, label: type };
}

export const KNOWLEDGE_MODEL_ICON = Boxes;
