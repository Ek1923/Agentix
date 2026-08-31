import type { Manifest } from '../../core/plugin-host/types'

export const manifest: Manifest = {
  id: 'reconsider',
  name: 'Reconsider',
  icon: 'RefreshCw',
  version: '1.0.0',
  // Every suggestion is derived from tracked data, not generated. No key needed.
  requiresAI: false,
}
