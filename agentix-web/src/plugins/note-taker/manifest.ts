import type { Manifest } from '../../core/plugin-host/types'

export const manifest: Manifest = {
  id: 'note-taker',
  name: 'Note Taker',
  icon: 'NotebookPen',
  version: '1.0.0',
  // The shell shows a hint on the menu row when no key is configured. The plugin
  // itself still works without one — only the summary is unavailable.
  requiresAI: true,
}
