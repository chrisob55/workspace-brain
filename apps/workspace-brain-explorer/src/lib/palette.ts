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
    description: 'A document explicitly links to another document or an ADR.',
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
  'architectural-decision': { color: '#f472b6', icon: Landmark, label: 'ADR' },
  document: { color: '#22d3ee', icon: FileText, label: 'Document' },
  container: { color: '#94a3b8', icon: Container, label: 'Container' },
};

export function entityStyle(type: string) {
  return ENTITY_STYLE[type] ?? { color: '#94a3b8', icon: Box, label: type };
}

export const KNOWLEDGE_MODEL_ICON = Boxes;
