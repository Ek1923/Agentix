import type { AgentixPlugin } from '../../core/plugin-host/types'
import { manifest } from './manifest'
import { TaskManager } from './TaskManager'

/**
 * The plugin as the shell sees it: a manifest and a component, nothing else.
 * Assembly only — the component lives in its own file.
 */
export const taskManagerPlugin: AgentixPlugin = {
  manifest,
  Component: TaskManager,
}
