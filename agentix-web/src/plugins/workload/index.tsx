import type { AgentixPlugin } from '../../core/plugin-host/types'
import { manifest } from './manifest'
import { Workload } from './Workload'

export const workloadPlugin: AgentixPlugin = {
  manifest,
  Component: Workload,
}
