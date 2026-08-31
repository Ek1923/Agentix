import type { AgentixPlugin } from "../../core/plugin-host/types"
import { manifest } from "./manifest"
import { Habits } from "./Habits"

export const habitsPlugin: AgentixPlugin = {
  manifest,
  Component: Habits,
}
