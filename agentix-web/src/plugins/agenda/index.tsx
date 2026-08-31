import type { AgentixPlugin } from '../../core/plugin-host/types'
import { Agenda } from './Agenda'
import { manifest } from './manifest'

export const agendaPlugin: AgentixPlugin = {
  manifest,
  Component: Agenda,
}
