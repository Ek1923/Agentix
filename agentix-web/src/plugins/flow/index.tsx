import type { AgentixPlugin } from '../../core/plugin-host/types'
import { Flow } from './Flow'
import { manifest } from './manifest'

export const flowPlugin: AgentixPlugin = {
  manifest,
  Component: Flow,
}
