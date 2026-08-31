import type { AgentixPlugin } from "../../core/plugin-host/types"
import { manifest } from "./manifest"
import { Tags } from "./Tags"

export const tagsPlugin: AgentixPlugin = {
  manifest,
  Component: Tags,
}
