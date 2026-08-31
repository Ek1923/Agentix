import type { AgentixPlugin } from '../../core/plugin-host/types'
import { manifest } from './manifest'
import { NoteTaker } from './NoteTaker'

export const noteTakerPlugin: AgentixPlugin = {
  manifest,
  Component: NoteTaker,
}
