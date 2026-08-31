import type { AgentixPlugin } from '../../core/plugin-host/types'
import { Backtest } from './Backtest'
import { manifest } from './manifest'

export const backtestPlugin: AgentixPlugin = {
  manifest,
  Component: Backtest,
}
