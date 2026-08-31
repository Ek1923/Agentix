import { createElement } from 'react'
import {
  Activity,
  BarChart3,
  Blocks,
  CalendarDays,
  CheckSquare,
  Clock,
  FileText,
  Lightbulb,
  ListTodo,
  NotebookPen,
  Puzzle,
  RefreshCw,
  Gauge,
  Tag,
  Target,
  Timer,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * The icons a plugin manifest may name.
 *
 * Deliberately a curated set rather than all of Lucide. Two reasons, both about
 * cost later: importing the full set puts every glyph in the bundle, and the iOS
 * build has to map each of these names to an SF Symbol by hand — a job that is
 * possible for a list this size and not possible for sixteen hundred.
 *
 * Adding an icon is one line here. That is the intended way to grow it.
 */
export const manifestIcons: Record<string, LucideIcon> = {
  Activity,
  BarChart3,
  Blocks,
  CalendarDays,
  CheckSquare,
  Clock,
  FileText,
  Lightbulb,
  ListTodo,
  NotebookPen,
  Puzzle,
  RefreshCw,
  Gauge,
  Tag,
  Target,
  Timer,
  Users,
}

/** Unknown names fall back rather than throw — a bad manifest must not blank the grid. */
export function resolveManifestIcon(name: string): LucideIcon {
  return manifestIcons[name] ?? Puzzle
}

/**
 * Renders an icon named by a manifest. A component rather than a lookup at the call
 * site, so no caller aliases a component into a local during render.
 */
export function ManifestIcon({ name, className }: { name: string; className?: string }) {
  return createElement(resolveManifestIcon(name), { className, 'aria-hidden': true })
}
