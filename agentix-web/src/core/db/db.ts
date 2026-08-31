import Dexie, { type EntityTable } from 'dexie'
import type {
  Bucket,
  Habit,
  HabitLog,
  Membership,
  Note,
  Organization,
  Person,
  SyncOutboxEntry,
  Task,
  TimeSession,
} from './types'

/**
 * Stable ids for the built-in columns.
 *
 * Fixed rather than generated, so the version 2 upgrade can map an existing task's
 * status onto a bucket deterministically, and so two devices seeding their own
 * defaults agree on which "To do" is which when sync arrives.
 */
/** Palette ids from ui/avatars BACKGROUNDS, cycled when a column has no colour. */
export const DEFAULT_BUCKET_COLORS = ['slate', 'ocean', 'forest', 'violet', 'ember', 'rose', 'gold', 'mist'] as const

export const DEFAULT_BUCKET_IDS = {
  todo: 'bucket-todo',
  active: 'bucket-active',
  done: 'bucket-done',
} as const

/**
 * The application database. Everything here is sync-eligible in Phase 6, which is
 * exactly why API keys live in a physically separate database — see
 * core/ai/secure-store.ts. Keys cannot leak into a sync push that cannot see them.
 */
export class AgentixDB extends Dexie {
  tasks!: EntityTable<Task, 'id'>
  sessions!: EntityTable<TimeSession, 'id'>
  notes!: EntityTable<Note, 'id'>
  buckets!: EntityTable<Bucket, 'id'>
  people!: EntityTable<Person, 'id'>
  habits!: EntityTable<Habit, 'id'>
  habitLogs!: EntityTable<HabitLog, 'id'>
  organizations!: EntityTable<Organization, 'id'>
  memberships!: EntityTable<Membership, 'id'>
  syncOutbox!: EntityTable<SyncOutboxEntry, 'id'>

  constructor() {
    super('agentix')

    // `deletedAt` is deliberately NOT indexed. IndexedDB cannot index null, so a row
    // with `deletedAt: null` — every live row — would be absent from that index and
    // silently vanish from any query using it. Soft deletes are filtered in
    // queries.ts instead, which is the only place reads are allowed to happen.
    this.version(1).stores({
      tasks: 'id, plannedFor, status',
      sessions: 'id, taskId, startedAt',
      notes: 'id, taskId',
    })

    this.version(2)
      .stores({
        tasks: 'id, plannedFor, status, bucketId',
        sessions: 'id, taskId, startedAt',
        notes: 'id, taskId',
        buckets: 'id, order',
        people: 'id, name',
      })
      .upgrade(async (tx) => {
        // Every existing task predates buckets. Placing them by status keeps a
        // board that already had work on it looking the way the user left it,
        // rather than dumping everything into one column.
        await tx
          .table<Task>('tasks')
          .toCollection()
          .modify((task) => {
            task.bucketId =
              task.status === 'done'
                ? DEFAULT_BUCKET_IDS.done
                : task.status === 'active'
                  ? DEFAULT_BUCKET_IDS.active
                  : DEFAULT_BUCKET_IDS.todo
            task.link = task.link ?? null
            task.assigneeIds = task.assigneeIds ?? []
          })
      })

    // Columns gained a colour. No index changes, so this only backfills a value
    // onto rows that predate the field.
    this.version(3).upgrade(async (tx) => {
      const palette = DEFAULT_BUCKET_COLORS
      await tx
        .table<Bucket>('buckets')
        .toCollection()
        .modify((bucket) => {
          bucket.colorId = bucket.colorId ?? palette[bucket.order % palette.length] ?? 'slate'
        })
    })

    // Recurring routines. `[habitId+day]` is the index that makes "was this done
    // on that day" a lookup rather than a scan, which the streak walk does a lot.
    this.version(4).stores({
      habits: 'id, archivedAt',
      habitLogs: 'id, habitId, day, [habitId+day]',
    })

    // The push queue. Indexed by table so a push can walk one table at a time.
    this.version(5).stores({
      syncOutbox: 'id, table, queuedAt',
    })

    /*
      Shared workspaces.

      `[orgId+email]` is the index that matters: an email is how an invitation is
      addressed and how a person is matched to their membership when they first
      sign in, so "is this address already on this roster" has to be a lookup
      rather than a scan of everyone.

      Nothing is seeded. An install with no organisation is the personal app it
      has always been, and creating one is a deliberate act.
    */
    this.version(6).stores({
      organizations: 'id',
      memberships: 'id, orgId, email, [orgId+email]',
    })

    /*
      Routines on the board.

      A task can now be the day's instance of a habit, and `habitId` is indexed so
      "everything this routine has produced" is a lookup — which pausing or
      deleting a routine needs, to clear the cards it left behind.

      IndexedDB cannot index null, so ordinary tasks are simply absent from this
      index. That is exactly the wanted behaviour here: the index holds routine
      tasks and nothing else. Every other query on tasks uses a different index and
      is unaffected.
    */
    this.version(7)
      .stores({
        tasks: 'id, plannedFor, status, bucketId, habitId',
      })
      .upgrade(async (tx) => {
        // Existing tasks predate routines. Written explicitly rather than left
        // undefined, so `habitId === null` is a fact about every row instead of a
        // question about when it was created.
        await tx
          .table<Task>('tasks')
          .toCollection()
          .modify((task) => {
            task.habitId = task.habitId ?? null
          })
      })
  }
}

export const db = new AgentixDB()
