export type TaskStatus = 'todo' | 'active' | 'done' | 'missed'

export interface Task {
  id: string                 // uuid, generated on device
  title: string
  notes: string | null
  link: string | null        // one reference URL, shown large on the task
  status: TaskStatus
  bucketId: string           // which board column it sits in
  assigneeIds: string[]      // people tagged on this task
  plannedFor: string         // ISO date 'YYYY-MM-DD' — which day it belongs to
  estimateMin: number | null // user's own guess, drives accuracy scoring
  completedAt: string | null // ISO datetime
  priority: 0 | 1 | 2
  tags: string[]
  /**
   * The routine this task is today's instance of, or null for ordinary work.
   *
   * A habit stays the rule; this is the day it produced. Set only by the
   * materialiser in `queries.ts`, which also derives such a task's id from the
   * routine and the day — see `core/habits.ts` for why that id is not random.
   */
  habitId: string | null

  createdAt: string
  updatedAt: string          // drives sync conflict resolution
  deletedAt: string | null   // soft delete — never hard delete
}

export interface TimeSession {
  id: string
  taskId: string
  startedAt: string          // clock in
  endedAt: string | null     // null means the timer is running right now
  source: 'timer' | 'manual'

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Note {
  id: string
  taskId: string | null      // null = standalone note
  content: string
  aiSummary: string | null

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/**
 * A board column. Renameable and addable, so the board is the user's own.
 *
 * `impliesStatus` is what keeps a custom column meaningful to the rest of the app:
 * Backtest counts completion by `Task.status`, not by column name, so a bucket has
 * to say what dropping a card into it *means*. Rename "Done" to "Shipped" and
 * completion still counts; add "Blocked" and its cards are still open work.
 */
export interface Bucket {
  id: string
  name: string
  order: number
  impliesStatus: TaskStatus
  /** An id from ui/avatars BACKGROUNDS — the same palette profiles and people use. */
  colorId: string
  /** Whether this column was seeded rather than invented. Does not restrict deletion. */
  isDefault: boolean

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** Someone a task can be tagged with. Local to this device until the pool exists. */
export interface Person {
  id: string
  name: string
  /** An id from ui/avatars BACKGROUNDS, so people look like profiles. */
  colorId: string

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/**
 * A recurring routine.
 *
 * Deliberately not a Task with a repeat flag: a habit is a *rule*, and a task is
 * one occurrence. Keeping them apart means editing the rule never rewrites
 * history, and a missed day stays missed instead of disappearing when the
 * schedule changes.
 */
export interface Habit {
  id: string
  title: string
  /** Local weekday numbers, 0 = Sunday. Empty means every day. */
  daysOfWeek: number[]
  estimateMin: number | null
  colorId: string
  archivedAt: string | null

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** One completed occurrence. The day is a local calendar date, as everywhere. */
export interface HabitLog {
  id: string
  habitId: string
  day: string
  completedAt: string

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** What a member may do. Three roles, not thirty — see core/org/README.md. */
export type OrgRole = 'owner' | 'admin' | 'member'

/**
 * Where someone is in the join.
 *
 * `invited` is the invitation itself rather than a separate table: an invitation
 * *is* a membership that has not been accepted, and modelling it twice means two
 * places to keep in step and a window where both exist.
 *
 * `suspended` keeps the row — and the audit trail — while removing access. It
 * still holds a seat, because a suspended account you are still paying for is the
 * honest reading, and the alternative silently changes the bill.
 */
export type MembershipStatus = 'invited' | 'active' | 'suspended'

/** Seats come from the plan; the plan is what an owner buys. */
export type OrgPlan = 'solo' | 'team' | 'enterprise'

/**
 * A workspace several people share.
 *
 * Optional by design. Agentix without an organisation is exactly the app it was
 * before this existed — local, private, single-user. Creating one is a deliberate
 * act, so nobody's personal database quietly becomes someone else's to administer.
 */
export interface Organization {
  id: string
  name: string
  plan: OrgPlan
  /** Seats paid for. Every member that is not removed holds one. */
  seats: number

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/**
 * One person's place in an organisation.
 *
 * `email` rather than `userId` is the identity that survives the whole lifecycle:
 * an invitation is addressed to an email long before that person has an account,
 * and `userId` is filled in when they first sign in and claim it.
 */
export interface Membership {
  id: string
  orgId: string
  /** The account behind this membership, once they have signed in and claimed it. */
  userId: string | null
  /** Lowercased. The invitation address, and the identity before `userId` exists. */
  email: string
  name: string | null
  role: OrgRole
  status: MembershipStatus
  /**
   * Which plugins this member may open. `null` means every plugin — the default,
   * and what almost everyone should stay on.
   *
   * This is a menu, not a lock. Real enforcement is row-level security on the
   * server; hiding a plugin the client already downloaded protects nobody. It is
   * here because "everyone sees the four tools they use" is worth more to most
   * teams than any restriction it implies.
   */
  allowedPluginIds: string[] | null
  invitedAt: string
  joinedAt: string | null

  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** The tables that sync. API keys are absent because they live in another database. */
export type SyncTable =
  | 'tasks'
  | 'sessions'
  | 'notes'
  | 'buckets'
  | 'people'
  | 'habits'
  | 'habitLogs'
  | 'organizations'
  | 'memberships'

export const SYNC_TABLES: readonly SyncTable[] = [
  'tasks',
  'sessions',
  'notes',
  'buckets',
  'people',
  'habits',
  'habitLogs',
  'organizations',
  'memberships',
]

/**
 * One row waiting to be pushed.
 *
 * The brief calls for "a dirty flag on records changed since the last successful
 * push". This is that, as an outbox rather than a column: a flag would mean adding
 * a field to all seven entities and setting it on every write path, and clearing
 * it after a push that might half-fail. A queue keyed by `table:rowId` is
 * idempotent — editing a row five times queues it once — and clearing it is a
 * delete of exactly the entries that were pushed.
 *
 * It also avoids the failure mode of using `updatedAt` as a watermark: a device
 * clock that jumps backwards would strand every row written before the jump.
 */
export interface SyncOutboxEntry {
  /** `${table}:${rowId}`, which is what makes enqueueing idempotent. */
  id: string
  table: SyncTable
  rowId: string
  queuedAt: string
}

/** Anything that syncs carries these three. */
export interface Syncable {
  id: string
  updatedAt: string
  deletedAt: string | null
}

/**
 * The fields a caller supplies on create. The rest are stamped by the query layer,
 * so no caller can forget an audit field or invent its own id.
 */
export type NewTask = Pick<Task, 'title'> &
  Partial<Omit<Task, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'deletedAt'>>

export type NewNote = Pick<Note, 'content'> &
  Partial<Omit<Note, 'id' | 'content' | 'createdAt' | 'updatedAt' | 'deletedAt'>>

/** Patches never carry audit fields — `updatedAt` is always the layer's to set. */
export type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>
export type NotePatch = Partial<Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>
export type BucketPatch = Partial<Omit<Bucket, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>
export type HabitPatch = Partial<Omit<Habit, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>
export type PersonPatch = Partial<Omit<Person, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>
export type OrganizationPatch = Partial<
  Omit<Organization, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
>
export type MembershipPatch = Partial<
  Omit<Membership, 'id' | 'orgId' | 'createdAt' | 'updatedAt' | 'deletedAt'>
>
