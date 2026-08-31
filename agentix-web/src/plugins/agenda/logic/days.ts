/**
 * Agenda's day helpers. The implementation lives in core/dates.ts because three
 * plugins need the same arithmetic; this file keeps Agenda's own import surface
 * stable so its callers and tests do not care where it moved.
 */
export * from '../../../core/dates'
export type { DayKey } from '../../../core/dates'
