import type React from 'react'
import type { AIService } from '../ai'
import type { Queries } from '../db/queries'

export interface Manifest {
  id: string
  name: string
  icon: string          // lucide icon name
  version: string
  requiresAI: boolean   // shell shows a hint if no key is configured
}

export interface PluginContext {
  db: Queries           // from core/db/queries
  ai: AIService         // from core/ai
  navigate: (to: string) => void
}

/**
 * A plugin's entry component.
 *
 * `ComponentType` rather than `FC` because the registry hands the shell a
 * `React.lazy` wrapper, which renders like a component but is not a plain
 * function. Plugins themselves are unaffected — an `FC` still satisfies this.
 */
export type PluginComponent = React.ComponentType<{ ctx: PluginContext }>

export interface AgentixPlugin {
  manifest: Manifest
  Component: PluginComponent
}
