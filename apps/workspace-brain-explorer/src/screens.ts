import {
  BookOpen,
  Building2,
  Compass,
  GitCompareArrows,
  Landmark,
  Network,
  Puzzle,
  Rocket,
  ScanSearch,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { AdrScreen } from './screens/adr-screen';
import { BehaviouralFlowVisionScreen } from './screens/behavioural-flow-vision-screen';
import { BeforeAfterScreen } from './screens/before-after-screen';
import { EnterpriseScreen } from './screens/enterprise-screen';
import { ExplainWhyScreen } from './screens/explain-why-screen';
import { FutureScreen } from './screens/future-screen';
import { GlossaryScreen } from './screens/glossary-screen';
import { GraphExplorerScreen } from './screens/graph-explorer-screen';
import { OpenApiScreen } from './screens/openapi-screen';
import { OverviewScreen } from './screens/overview-screen';
import { ParserEcosystemScreen } from './screens/parser-ecosystem-screen';

export interface ScreenDefinition {
  id: string;
  title: string;
  question: string;
  icon: LucideIcon;
  component: ComponentType;
  /** Full-bleed screens manage their own scrolling (e.g. graph canvases). */
  fullBleed?: boolean;
}

export const SCREENS: ScreenDefinition[] = [
  {
    id: 'overview',
    title: 'Overview',
    question: 'What is Workspace Brain?',
    icon: Sparkles,
    component: OverviewScreen,
  },
  {
    id: 'concepts',
    title: 'Glossary & Concepts',
    question: 'What do the words mean?',
    icon: BookOpen,
    component: GlossaryScreen,
  },
  {
    id: 'graph',
    title: 'Knowledge Graph',
    question: 'What does it know?',
    icon: Network,
    component: GraphExplorerScreen,
    fullBleed: true,
  },
  {
    id: 'explain',
    title: 'Explain Why',
    question: 'Why should I trust it?',
    icon: ScanSearch,
    component: ExplainWhyScreen,
  },
  {
    id: 'openapi',
    title: 'OpenAPI Visualiser',
    question: 'How do contracts become knowledge?',
    icon: Compass,
    component: OpenApiScreen,
  },
  {
    id: 'adrs',
    title: 'Architecture Decisions',
    question: 'How are decisions captured?',
    icon: Landmark,
    component: AdrScreen,
  },
  {
    id: 'parsers',
    title: 'Parser Ecosystem',
    question: 'How does it understand organisations?',
    icon: Puzzle,
    component: ParserEcosystemScreen,
  },
  {
    id: 'behavioural-flow-vision',
    title: 'Behavioural Flow Vision',
    question: 'What happens when an operation executes?',
    icon: Workflow,
    component: BehaviouralFlowVisionScreen,
  },
  {
    id: 'evolution',
    title: 'Before vs After Slice 9',
    question: 'How does it evolve?',
    icon: GitCompareArrows,
    component: BeforeAfterScreen,
  },
  {
    id: 'enterprise',
    title: 'Enterprise Scaling',
    question: 'Does it scale beyond one repository?',
    icon: Building2,
    component: EnterpriseScreen,
  },
  {
    id: 'future',
    title: 'Future Direction',
    question: 'Where is it heading?',
    icon: Rocket,
    component: FutureScreen,
  },
];
