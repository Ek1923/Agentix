import { lazy } from 'react'
import { manifest as agendaManifest } from '../../plugins/agenda/manifest'
import { manifest as backtestManifest } from '../../plugins/backtest/manifest'
import { manifest as flowManifest } from '../../plugins/flow/manifest'
import { manifest as habitsManifest } from '../../plugins/habits/manifest'
import { manifest as noteTakerManifest } from '../../plugins/note-taker/manifest'
import { manifest as reconsiderManifest } from '../../plugins/reconsider/manifest'
import { manifest as tagsManifest } from '../../plugins/tags/manifest'
import { manifest as taskManagerManifest } from '../../plugins/task-manager/manifest'
import { manifest as workloadManifest } from '../../plugins/workload/manifest'
import type { AgentixPlugin, Manifest, PluginComponent } from './types'

/*
  Manifests are imported eagerly; the plugins behind them are not.

  The shell needs every manifest on first paint — the menu lists nine names and
  icons before anything is opened — but it needs at most one plugin's code, and
  only once someone opens it. Importing all nine put every plugin, its logic and
  its charts into the entry bundle: 644 kB to render a menu.

  A manifest is four strings and a boolean, so the eager half costs nothing. The
  component behind it is loaded on open, from its own chunk.
*/
function entry(manifest: Manifest, load: () => Promise<{ Component: PluginComponent }>): AgentixPlugin {
  return { manifest, Component: lazy(async () => ({ default: (await load()).Component })) }
}

/**
 * Installed plugins, in the order they appear on the home tile grid.
 *
 * The shell reads nothing but the manifest and the Component from each entry, so
 * adding a plugin is this one line and no shell change.
 */
export const registry: AgentixPlugin[] = [
  entry(taskManagerManifest, () => import('../../plugins/task-manager').then((m) => m.taskManagerPlugin)),
  entry(agendaManifest, () => import('../../plugins/agenda').then((m) => m.agendaPlugin)),
  entry(noteTakerManifest, () => import('../../plugins/note-taker').then((m) => m.noteTakerPlugin)),
  entry(reconsiderManifest, () => import('../../plugins/reconsider').then((m) => m.reconsiderPlugin)),
  entry(habitsManifest, () => import('../../plugins/habits').then((m) => m.habitsPlugin)),
  entry(backtestManifest, () => import('../../plugins/backtest').then((m) => m.backtestPlugin)),
  entry(tagsManifest, () => import('../../plugins/tags').then((m) => m.tagsPlugin)),
  entry(workloadManifest, () => import('../../plugins/workload').then((m) => m.workloadPlugin)),
  entry(flowManifest, () => import('../../plugins/flow').then((m) => m.flowPlugin)),
]

export function findPlugin(id: string): AgentixPlugin | undefined {
  return registry.find((p) => p.manifest.id === id)
}
