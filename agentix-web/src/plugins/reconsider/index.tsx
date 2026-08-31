import type { AgentixPlugin } from '../../core/plugin-host/types'
import { manifest } from './manifest'
import { Reconsider } from './Reconsider'

export const reconsiderPlugin: AgentixPlugin = {
  manifest,
  Component: Reconsider,
}
