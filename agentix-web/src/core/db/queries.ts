import { habitTaskId, isActiveOn, routinesFor } from '../habits'
import { notifyChanged } from './changes'
import { db, DEFAULT_BUCKET_COLORS, DEFAULT_BUCKET_IDS } from './db'
import { SYNC_TABLES } from './types'
import type {
  Bucket,
  BucketPatch,
  SyncOutboxEntry,
  SyncTable,
  Habit,
  HabitLog,
  HabitPatch,
  Membership,
  MembershipPatch,
  NewNote,
  NewTask,
  Note,
  NotePatch,
  OrgPlan,
  OrgRole,
  Organization,
  OrganizationPatch,
  Person,
  PersonPatch,
  Task,
  TaskPatch,
  TimeSession,
} from './types'

/** ISO 8601 UTC. Every audit timestamp in the app is produced here and nowhere else. */
const now = (): string => new Date().toISOString()

const newId = (): string => crypto.randomUUID()

const live = <T extends { deletedAt: string | null }>(row: T): boolean =>
  row.deletedAt === null


/**
 * Queues a row for the next push.
 *
 * Called from every mutation below. That is only safe to promise because this
 * module is the single gateway to storage — no plugin opens its own connection,
 * so there is no write path that can bypass the queue.
 *
 * Keyed by `table:rowId` and written with `put`, so editing a row twenty times
 * leaves one entry.
 */
async function touch(table: SyncTable, rowId: string): Promise<void> {
  const entry: SyncOutboxEntry = {
    id: `${table}:${rowId}`,
    table,
    rowId,
    queuedAt: now(),
  }
  await db.syncOutbox.put(entry)
  notifyChanged(table)
}

/** Everything waiting to go out, oldest first. */
async function listOutbox(): Promise<SyncOutboxEntry[]> {
  const entries = await db.syncOutbox.toArray()
  return entries.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

/** Clears exactly what was pushed. Anything queued since stays queued. */
async function clearOutbox(ids: string[]): Promise<void> {
  await db.syncOutbox.bulkDelete(ids)
}

/**
 * Writes a row that arrived from the server without queueing it back.
 *
 * The distinction matters: a local edit must be pushed, and a pulled row must
 * not be, or two devices bounce the same row between them forever.
 */
async function applyRemote<T extends { id: string }>(table: SyncTable, row: T): Promise<void> {
  await tableFor(table).put(row as never)
  // Not queued, but just as real: a pulled row moves the same totals a local edit does.
  notifyChanged(table)
}

function tableFor(table: SyncTable) {
  if (table === 'tasks') return db.tasks
  if (table === 'sessions') return db.sessions
  if (table === 'notes') return db.notes
  if (table === 'buckets') return db.buckets
  if (table === 'people') return db.people
  if (table === 'habits') return db.habits
  return db.habitLogs
}

/** Reads a row by table name, for the push side of a sync. */
async function readRow(table: SyncTable, id: string): Promise<unknown | undefined> {
  return tableFor(table).get(id)
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** Local calendar date, not UTC — "which day is this task on" is a local question. */
function todayLocal(): string {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

async function createTask(input: NewTask): Promise<Task> {
  const stamp = now()
  const task: Task = {
    id: newId(),
    title: input.title,
    notes: input.notes ?? null,
    link: input.link ?? null,
    status: input.status ?? 'todo',
    bucketId: input.bucketId ?? DEFAULT_BUCKET_IDS.todo,
    assigneeIds: input.assigneeIds ?? [],
    plannedFor: input.plannedFor ?? todayLocal(),
    estimateMin: input.estimateMin ?? null,
    completedAt: input.completedAt ?? null,
    priority: input.priority ?? 0,
    tags: input.tags ?? [],
    habitId: input.habitId ?? null,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }
  await db.tasks.add(task)
  await touch('tasks', task.id)
  return task
}

/**
 * Edits a task.
 *
 * Two things happen here that do not happen to an ordinary row, both because a
 * routine's card is the day's instance of a rule rather than a thing of its own:
 *
 * - **It cannot be moved to another day.** The card's id is derived from the
 *   routine and the day it belongs to, so a card sitting on Thursday under
 *   Wednesday's id would be logged against the wrong morning and would collide
 *   with Thursday's own card. Tomorrow's instance is tomorrow's to make. The field
 *   is dropped; every other field in the same patch still applies.
 * - **Finishing it records the day.** The board finishes work by moving a card
 *   into a done column, which arrives here as a status change rather than through
 *   `setTaskDone` — so the routine's log is kept in step at the gateway every
 *   write passes through, not at one of the two doors into it.
 */
async function updateTask(id: string, patch: TaskPatch): Promise<void> {
  await db.transaction('rw', [db.tasks, db.habitLogs, db.syncOutbox], async () => {
    const task = await db.tasks.get(id)
    const routine = task?.habitId ?? null

    let fields = patch
    if (routine !== null && patch.plannedFor !== undefined) {
      const { plannedFor: _fixed, ...rest } = patch
      fields = rest
      if (Object.keys(rest).length === 0) return
    }

    await db.tasks.update(id, { ...fields, updatedAt: now() })
    await touch('tasks', id)

    if (routine === null || task === undefined || fields.status === undefined) return

    const nowDone = fields.status === 'done'
    if (nowDone !== (task.status === 'done')) {
      await applyHabitLog(routine, task.plannedFor, nowDone)
    }
  })
}

/** Soft delete. A delete is an update, so it syncs like any other edit. */
async function deleteTask(id: string): Promise<void> {
  const stamp = now()
  await db.tasks.update(id, { deletedAt: stamp, updatedAt: stamp })
  await touch('tasks', id)
}

async function getTask(id: string): Promise<Task | undefined> {
  const task = await db.tasks.get(id)
  return task && live(task) ? task : undefined
}

async function listTasksByDay(plannedFor: string): Promise<Task[]> {
  return db.tasks.where('plannedFor').equals(plannedFor).filter(live).toArray()
}

/** Inclusive on both ends. Backtest windows are expressed as a date range. */
async function listTasksInRange(fromDate: string, toDate: string): Promise<Task[]> {
  return db.tasks
    .where('plannedFor')
    .between(fromDate, toDate, true, true)
    .filter(live)
    .toArray()
}

/**
 * Tasks from the last `days` days up to today, newest day first.
 *
 * Day keys are zero-padded, so the range is a plain string comparison and needs
 * no date parsing. Used where a plugin needs something to attach to without
 * reaching into another plugin for date helpers.
 */
async function listRecentTasks(days = 7): Promise<Task[]> {
  const to = todayLocal()
  const from = new Date()
  from.setDate(from.getDate() - days)
  const month = String(from.getMonth() + 1).padStart(2, '0')
  const day = String(from.getDate()).padStart(2, '0')

  const tasks = await listTasksInRange(`${from.getFullYear()}-${month}-${day}`, to)
  return tasks.sort((a, b) => b.plannedFor.localeCompare(a.plannedFor))
}

/**
 * Marks a task finished or reopens it, keeping status, completedAt, the board
 * column and any running timer in agreement.
 *
 * The body of `setTaskDone`, split out so the two directions of a routine —
 * ticking the card, and ticking the routine in its own plugin — can share it
 * without calling each other in a circle. Assumes it is already inside a
 * transaction that covers tasks, buckets and sessions.
 */
async function applyTaskDone(id: string, done: boolean): Promise<void> {
  const task = await db.tasks.get(id)
  if (!task || !live(task)) return

  const stamp = now()
  const buckets = (await db.buckets.filter(live).toArray()).sort(
    (a, b) => a.order - b.order,
  )
  const target = done
    ? buckets.find((b) => b.impliesStatus === 'done')
    : buckets.find((b) => b.impliesStatus !== 'done')

  // Finished work stops accruing time.
  if (done) {
    const running = await db.sessions
      .filter((sess) => live(sess) && sess.endedAt === null && sess.taskId === id)
      .toArray()
    for (const open of running) {
      await db.sessions.update(open.id, { endedAt: stamp, updatedAt: stamp })
      await touch('sessions', open.id)
    }
  }

  await touch('tasks', id)
  await db.tasks.update(id, {
    status: done ? 'done' : (target?.impliesStatus ?? 'todo'),
    completedAt: done ? stamp : null,
    ...(target ? { bucketId: target.id } : {}),
    updatedAt: stamp,
  })
}

/**
 * Finishes a task, and — when that task is a day's instance of a routine — records
 * the routine as kept on the day the card belongs to.
 *
 * Centralised because more than one plugin can finish a task, and four things
 * drifting apart is exactly how a card ends up ticked in the wrong column with a
 * clock still running against it. The routine's log is the fifth: a card ticked on
 * the board that left the streak untouched would make two screens disagree about
 * the same morning.
 */
async function setTaskDone(id: string, done: boolean): Promise<void> {
  await db.transaction(
    'rw',
    [db.tasks, db.buckets, db.sessions, db.habitLogs, db.syncOutbox],
    async () => {
      const task = await db.tasks.get(id)
      if (!task || !live(task)) return

      await applyTaskDone(id, done)
      if (task.habitId !== null) await applyHabitLog(task.habitId, task.plannedFor, done)
    },
  )
}

// ---------------------------------------------------------------------------
// Time sessions
// ---------------------------------------------------------------------------

async function getRunningSession(): Promise<TimeSession | undefined> {
  // endedAt is null on a running session and null is not indexable, so this is a
  // scan. The running set is at most one row, and the table stays small by design.
  return db.sessions.filter((s) => live(s) && s.endedAt === null).first()
}

/**
 * Clock in. Enforces the one-running-session rule in the DB layer, inside a
 * transaction, so no UI path and no future plugin can produce two open timers.
 */
async function startSession(
  taskId: string,
  source: TimeSession['source'] = 'timer',
): Promise<TimeSession> {
  return db.transaction('rw', [db.sessions, db.syncOutbox], async () => {
    const stamp = now()

    const running = await db.sessions
      .filter((s) => live(s) && s.endedAt === null)
      .toArray()
    for (const open of running) {
      await db.sessions.update(open.id, { endedAt: stamp, updatedAt: stamp })
      await touch('sessions', open.id)
    }

    const session: TimeSession = {
      id: newId(),
      taskId,
      startedAt: stamp,
      endedAt: null,
      source,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    }
    await db.sessions.add(session)
    await touch('sessions', session.id)
    return session
  })
}

/**
 * Closes a session that has clearly been forgotten.
 *
 * A timer left running overnight silently adds fourteen hours to a task, and every
 * estimate-accuracy figure that reads it is wrong from then on. The session is
 * closed at the cap rather than at now, because the hours after the cap are not
 * evidence of anything.
 *
 * Returns how many were closed. Zero hours disables the check entirely.
 */
async function closeForgottenSessions(maxHours: number): Promise<number> {
  if (maxHours <= 0) return 0

  return db.transaction('rw', [db.sessions, db.syncOutbox], async () => {
    const cutoffMs = maxHours * 3_600_000
    const running = await db.sessions
      .filter((s) => live(s) && s.endedAt === null)
      .toArray()

    let closed = 0
    for (const session of running) {
      const started = Date.parse(session.startedAt)
      if (Number.isNaN(started) || Date.now() - started < cutoffMs) continue

      const endedAt = new Date(started + cutoffMs).toISOString()
      await db.sessions.update(session.id, { endedAt, updatedAt: now() })
      await touch('sessions', session.id)
      closed += 1
    }
    return closed
  })
}

/** Clock out. Closes the running session if there is one; a no-op if there is not. */
async function stopRunningSession(): Promise<TimeSession | undefined> {
  return db.transaction('rw', [db.sessions, db.syncOutbox], async () => {
    const running = await db.sessions
      .filter((s) => live(s) && s.endedAt === null)
      .first()
    if (!running) return undefined

    const stamp = now()
    await db.sessions.update(running.id, { endedAt: stamp, updatedAt: stamp })
    await touch('sessions', running.id)
    return { ...running, endedAt: stamp, updatedAt: stamp }
  })
}

async function listSessionsForTask(taskId: string): Promise<TimeSession[]> {
  return db.sessions.where('taskId').equals(taskId).filter(live).toArray()
}

/** One indexed query for a whole day's tasks, rather than one per row. */
async function listSessionsForTasks(taskIds: string[]): Promise<TimeSession[]> {
  if (taskIds.length === 0) return []
  return db.sessions.where('taskId').anyOf(taskIds).filter(live).toArray()
}

/** Sessions that began inside the window. Both bounds are ISO datetimes. */
async function listSessionsInRange(from: string, to: string): Promise<TimeSession[]> {
  return db.sessions
    .where('startedAt')
    .between(from, to, true, true)
    .filter(live)
    .toArray()
}

async function deleteSession(id: string): Promise<void> {
  const stamp = now()
  await db.sessions.update(id, { deletedAt: stamp, updatedAt: stamp })
  await touch('sessions', id)
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

async function createNote(input: NewNote): Promise<Note> {
  const stamp = now()
  const note: Note = {
    id: newId(),
    taskId: input.taskId ?? null,
    content: input.content,
    aiSummary: input.aiSummary ?? null,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }
  await db.notes.add(note)
  await touch('notes', note.id)
  return note
}

async function updateNote(id: string, patch: NotePatch): Promise<void> {
  await db.notes.update(id, { ...patch, updatedAt: now() })
  await touch('notes', id)
}

async function deleteNote(id: string): Promise<void> {
  const stamp = now()
  await db.notes.update(id, { deletedAt: stamp, updatedAt: stamp })
  await touch('notes', id)
}

async function listNotesForTask(taskId: string): Promise<Note[]> {
  return db.notes.where('taskId').equals(taskId).filter(live).toArray()
}

/** Every live note, most recently edited first. */
async function listNotes(): Promise<Note[]> {
  const notes = await db.notes.filter(live).toArray()
  return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function getNote(id: string): Promise<Note | undefined> {
  const note = await db.notes.get(id)
  return note && live(note) ? note : undefined
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

const DEFAULT_BUCKETS: ReadonlyArray<
  Pick<Bucket, 'id' | 'name' | 'order' | 'impliesStatus' | 'colorId'>
> = [
  { id: DEFAULT_BUCKET_IDS.todo, name: 'To do', order: 0, impliesStatus: 'todo', colorId: 'slate' },
  {
    id: DEFAULT_BUCKET_IDS.active,
    name: 'In progress',
    order: 1,
    impliesStatus: 'active',
    colorId: 'ocean',
  },
  { id: DEFAULT_BUCKET_IDS.done, name: 'Done', order: 2, impliesStatus: 'done', colorId: 'forest' },
]

/**
 * Seeds the starting columns, but only on a board that has none.
 *
 * Deliberately not "fill in any missing default": the built-in columns can be
 * deleted like any other, and re-creating them on the next mount would make that
 * deletion impossible. A board keeps at least one column, so after the first run
 * this never fires again.
 *
 * Idempotent and transactional, so two tabs mounting at once cannot double-seed.
 */
async function ensureDefaultBuckets(): Promise<void> {
  await db.transaction('rw', [db.buckets, db.syncOutbox], async () => {
    const existing = await db.buckets.filter(live).count()
    if (existing > 0) return

    const stamp = now()
    for (const preset of DEFAULT_BUCKETS) {
      await db.buckets.put({
        ...preset,
        isDefault: true,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
      })
      await touch('buckets', preset.id)
    }
  })
}

async function listBuckets(): Promise<Bucket[]> {
  const buckets = await db.buckets.filter(live).toArray()
  return buckets.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
}

async function createBucket(name: string, colorId?: string): Promise<Bucket> {
  return db.transaction('rw', [db.buckets, db.syncOutbox], async () => {
    const stamp = now()
    const existing = await db.buckets.filter(live).toArray()
    const maxOrder = existing.reduce((max, b) => Math.max(max, b.order), -1)

    const bucket: Bucket = {
      id: newId(),
      name,
      order: maxOrder + 1,
      // A column someone invents holds open work. Only a column that means
      // "finished" counts as done, so inventing columns cannot corrupt
      // completion rates.
      impliesStatus: 'todo',
      colorId:
        colorId ??
        DEFAULT_BUCKET_COLORS[existing.length % DEFAULT_BUCKET_COLORS.length] ??
        'slate',
      isDefault: false,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    }
    await db.buckets.add(bucket)
    await touch('buckets', bucket.id)
    return bucket
  })
}

async function updateBucket(id: string, patch: BucketPatch): Promise<void> {
  await db.buckets.update(id, { ...patch, updatedAt: now() })
  await touch('buckets', id)
}

/**
 * Removes a column and rehomes its cards into the first one that remains.
 *
 * Any column can go, including a seeded one. The single rule is that the last
 * column cannot be removed: a board with nowhere to put a task is not a state
 * worth being able to reach, and deleting a column must never delete work.
 */
async function deleteBucket(id: string): Promise<void> {
  await db.transaction('rw', [db.buckets, db.tasks, db.syncOutbox], async () => {
    const bucket = await db.buckets.get(id)
    if (!bucket || !live(bucket)) return

    const remaining = (await db.buckets.filter(live).toArray())
      .filter((b) => b.id !== id)
      .sort((a, b) => a.order - b.order)
    if (remaining.length === 0) return

    const fallback = remaining[0]!
    const stamp = now()
    const orphans = await db.tasks.where('bucketId').equals(id).filter(live).toArray()
    for (const task of orphans) {
      await db.tasks.update(task.id, {
        bucketId: fallback.id,
        status: fallback.impliesStatus,
        // A task rehomed out of a done column is no longer finished.
        completedAt: fallback.impliesStatus === 'done' ? task.completedAt : null,
        updatedAt: stamp,
      })
      await touch('tasks', task.id)
    }

    await db.buckets.update(id, { deletedAt: stamp, updatedAt: stamp })
    await touch('buckets', id)
  })
}

async function reorderBuckets(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', [db.buckets, db.syncOutbox], async () => {
    const stamp = now()
    for (const [index, id] of orderedIds.entries()) {
      await db.buckets.update(id, { order: index, updatedAt: stamp })
      await touch('buckets', id)
    }
  })
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

async function listPeople(): Promise<Person[]> {
  const people = await db.people.filter(live).toArray()
  return people.sort((a, b) => a.name.localeCompare(b.name))
}

async function createPerson(name: string, colorId: string): Promise<Person> {
  const stamp = now()
  const person: Person = {
    id: newId(),
    name,
    colorId,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }
  await db.people.add(person)
  await touch('people', person.id)
  return person
}

async function updatePerson(id: string, patch: PersonPatch): Promise<void> {
  await db.people.update(id, { ...patch, updatedAt: now() })
  await touch('people', id)
}

/** Removing a person also untags them, so no task points at someone who is gone. */
async function deletePerson(id: string): Promise<void> {
  await db.transaction('rw', [db.people, db.tasks, db.syncOutbox], async () => {
    const stamp = now()
    const tagged = await db.tasks.filter((t) => live(t) && t.assigneeIds.includes(id)).toArray()
    for (const task of tagged) {
      await db.tasks.update(task.id, {
        assigneeIds: task.assigneeIds.filter((a) => a !== id),
        updatedAt: stamp,
      })
      await touch('tasks', task.id)
    }
    await db.people.update(id, { deletedAt: stamp, updatedAt: stamp })
    await touch('people', id)
  })
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

async function listHabits(includeArchived = false): Promise<Habit[]> {
  const habits = await db.habits.filter(live).toArray()
  return habits
    .filter((h) => includeArchived || h.archivedAt === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * Creates a routine, and puts today's card on the board if it is due today.
 *
 * Immediately rather than at next open, because a routine you just wrote down and
 * cannot find anywhere reads as one that was not saved.
 */
async function createHabit(
  title: string,
  daysOfWeek: number[],
  estimateMin: number | null,
  colorId: string,
): Promise<Habit> {
  const stamp = now()
  const habit: Habit = {
    id: newId(),
    title,
    daysOfWeek,
    estimateMin,
    colorId,
    archivedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }

  await db.transaction(
    'rw',
    [db.habits, db.tasks, db.buckets, db.habitLogs, db.syncOutbox],
    async () => {
      await db.habits.add(habit)
      await touch('habits', habit.id)
      await reconcileRoutine(habit.id, todayLocal())
    },
  )
  return habit
}

/**
 * Edits a routine, and brings today's card back in line with it.
 *
 * Renaming, re-timing, changing which days it falls on and pausing it all land
 * here, and all of them can change what today's board should show — so the card
 * is reconsidered on every edit rather than only on the ones that look relevant.
 */
async function updateHabit(id: string, patch: HabitPatch): Promise<void> {
  await db.transaction(
    'rw',
    [db.habits, db.tasks, db.buckets, db.habitLogs, db.syncOutbox],
    async () => {
      await db.habits.update(id, { ...patch, updatedAt: now() })
      await touch('habits', id)

      // Pausing also clears anything already put on a day still to come.
      if (patch.archivedAt != null) await clearRoutineTasks(id, todayLocal())
      await reconcileRoutine(id, todayLocal())
    },
  )
}

/** Soft-deletes a routine and takes back the cards it left on days not yet spent. */
async function deleteHabit(id: string): Promise<void> {
  const stamp = now()
  await db.transaction(
    'rw',
    [db.habits, db.tasks, db.buckets, db.habitLogs, db.syncOutbox],
    async () => {
      await db.habits.update(id, { deletedAt: stamp, updatedAt: stamp })
      await touch('habits', id)
      await clearRoutineTasks(id, todayLocal())
    },
  )
}

/** Logs across a day range, inclusive. Day keys sort lexically, so this is cheap. */
async function listHabitLogs(fromDay: string, toDay: string): Promise<HabitLog[]> {
  return db.habitLogs.where('day').between(fromDay, toDay, true, true).filter(live).toArray()
}

/**
 * Writes the log that says a routine was kept on a day, or takes it back.
 *
 * Idempotent in both directions: ticking twice leaves one log, and unticking a day
 * that was never logged is a no-op. The compound index makes the lookup a single
 * hit rather than a scan, which the streak walk does a lot of.
 *
 * Assumes a transaction covering habitLogs. Split out of `setHabitDone` so that
 * finishing the day's card can record the same fact without the two entry points
 * calling each other in a circle.
 */
async function applyHabitLog(habitId: string, day: string, done: boolean): Promise<void> {
  const stamp = now()
  const existing = await db.habitLogs.where('[habitId+day]').equals([habitId, day]).toArray()

  if (done) {
    if (existing.some(live)) return

    const revivable = existing[0]
    if (revivable) {
      await db.habitLogs.update(revivable.id, {
        deletedAt: null,
        completedAt: stamp,
        updatedAt: stamp,
      })
      await touch('habitLogs', revivable.id)
      return
    }

    const logId = newId()
    await db.habitLogs.add({
      id: logId,
      habitId,
      day,
      completedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    })
    await touch('habitLogs', logId)
    return
  }

  for (const log of existing.filter(live)) {
    await db.habitLogs.update(log.id, { deletedAt: stamp, updatedAt: stamp })
    await touch('habitLogs', log.id)
  }
}

/**
 * Marks a habit done, or undone, for one day - from the Habits plugin.
 *
 * If that day's card has already been put on the board, it is ticked too. Ticking
 * a routine in one place and finding it unticked in the other is the kind of
 * disagreement that makes people stop trusting both screens.
 */
async function setHabitDone(habitId: string, day: string, done: boolean): Promise<void> {
  await db.transaction(
    'rw',
    [db.habitLogs, db.tasks, db.buckets, db.sessions, db.syncOutbox],
    async () => {
      await applyHabitLog(habitId, day, done)

      const card = await db.tasks.get(habitTaskId(habitId, day))
      if (card === undefined || !live(card)) return
      if ((card.status === 'done') === done) return

      await applyTaskDone(card.id, done)
    },
  )
}

// ---------------------------------------------------------------------------
// Routines on the board
// ---------------------------------------------------------------------------

/**
 * Puts one routine's day in order: the card exists when it should, matches the
 * rule while it is still open, and is gone when it should not be there at all.
 *
 * Every path that can change the answer goes through here - creating a routine,
 * renaming it, changing its days, pausing it, deleting it, and opening the app on
 * a new morning - so the rules live in one place instead of four.
 *
 * Three things it deliberately does not do:
 *
 * - **It never resurrects a card someone deleted.** A soft-deleted row still
 *   exists, and finding it is the difference between "not made yet" and "not
 *   wanted today".
 * - **It never touches a finished card.** Work that was done stays done, and stays
 *   in the record, even if the routine behind it is later paused or renamed.
 * - **It never makes a card for a past day.** Yesterday's chore appearing this
 *   morning is not a reminder, it is a lie about which day you are in.
 *
 * Assumes a transaction covering tasks, buckets, habits and habitLogs.
 */
async function reconcileRoutine(habitId: string, day: string): Promise<void> {
  const habit = await db.habits.get(habitId)
  const taskId = habitTaskId(habitId, day)
  const existing = await db.tasks.get(taskId)
  const wanted = habit !== undefined && live(habit) && isActiveOn(habit, day)

  if (!wanted) {
    // Paused, deleted, or not due today after all: take back only what is still open.
    if (existing !== undefined && live(existing) && existing.status !== 'done') {
      const stamp = now()
      await db.tasks.update(taskId, { deletedAt: stamp, updatedAt: stamp })
      await touch('tasks', taskId)
    }
    return
  }

  const stamp = now()

  if (existing === undefined) {
    /*
      The routine may already have been kept today - ticked in the Habits plugin,
      or on another device before this one caught up. A card that arrives already
      done is the honest picture; a fresh "to do" for something finished at seven
      this morning is not.
    */
    const logs = await db.habitLogs.where('[habitId+day]').equals([habitId, day]).toArray()
    const kept = logs.find(live)

    const buckets = (await db.buckets.filter(live).toArray()).sort((a, b) => a.order - b.order)
    const column = kept
      ? buckets.find((b) => b.impliesStatus === 'done')
      : buckets.find((b) => b.impliesStatus !== 'done')

    await db.tasks.add({
      id: taskId,
      title: habit.title,
      notes: null,
      link: null,
      status: kept ? 'done' : 'todo',
      bucketId: column?.id ?? (kept ? DEFAULT_BUCKET_IDS.done : DEFAULT_BUCKET_IDS.todo),
      assigneeIds: [],
      plannedFor: day,
      estimateMin: habit.estimateMin,
      completedAt: kept?.completedAt ?? null,
      priority: 0,
      tags: [],
      habitId,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    })
    await touch('tasks', taskId)
    return
  }

  // An open card follows the rule it came from, so renaming a routine does not
  // leave yesterday's wording sitting on today's board.
  if (live(existing) && existing.status !== 'done') {
    const drifted = existing.title !== habit.title || existing.estimateMin !== habit.estimateMin
    if (drifted) {
      await db.tasks.update(taskId, {
        title: habit.title,
        estimateMin: habit.estimateMin,
        updatedAt: stamp,
      })
      await touch('tasks', taskId)
    }
  }
}

/**
 * Brings a whole day's routines onto the board. Returns how many cards it added.
 *
 * Called on open, so the day's chores are simply there with the rest of the work.
 * Cheap and idempotent: on the second call of the morning every card already
 * exists and nothing is written.
 */
async function materialiseRoutines(day: string = todayLocal()): Promise<number> {
  return db.transaction(
    'rw',
    [db.tasks, db.buckets, db.habits, db.habitLogs, db.syncOutbox],
    async () => {
      const habits = (await db.habits.toArray()).filter(live)
      const planned = routinesFor(habits, day)

      let added = 0
      for (const routine of planned) {
        const before = await db.tasks.get(routine.taskId)
        await reconcileRoutine(routine.habitId, day)
        if (before === undefined) added += 1
      }

      await sweepStaleRoutineCards(day)
      return added
    },
  )
}

/**
 * Clears routine cards from days that are over and were not kept.
 *
 * A routine is a rule for a particular day. Missing Tuesday's run is a miss —
 * recorded by the absence of a log, and visible as a broken streak — not a job
 * still owed on Wednesday. Left on the board, yesterday's chores would pile up as
 * open work and Reconsider would keep offering to reschedule something that cannot
 * be rescheduled.
 *
 * Only open cards go. A routine that was finished stays exactly where it was
 * finished.
 */
async function sweepStaleRoutineCards(day: string): Promise<void> {
  // IndexedDB cannot index null, so ordinary tasks are simply not in this index:
  // any range over it enumerates the routine cards and nothing else.
  const stale = await db.tasks
    .where('habitId')
    .notEqual('')
    .filter((task) => live(task) && task.status !== 'done' && task.plannedFor < day)
    .toArray()

  const stamp = now()
  for (const card of stale) {
    await db.tasks.update(card.id, { deletedAt: stamp, updatedAt: stamp })
    await touch('tasks', card.id)
  }
}

/**
 * Clears the cards a routine left on days that have not happened yet, including
 * today's if it is still open. Used when a routine is paused or deleted.
 *
 * Finished cards are never touched: they are the record of work that actually got
 * done, and deleting them would quietly rewrite both the board's history and the
 * level earned from it.
 */
async function clearRoutineTasks(habitId: string, fromDay: string): Promise<void> {
  const cards = await db.tasks.where('habitId').equals(habitId).toArray()
  const stamp = now()

  for (const card of cards) {
    if (!live(card) || card.status === 'done') continue
    if (card.plannedFor < fromDay) continue
    await db.tasks.update(card.id, { deletedAt: stamp, updatedAt: stamp })
    await touch('tasks', card.id)
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Every tag in use, with how many live tasks carry it. */
async function listTagCounts(): Promise<Array<{ tag: string; count: number }>> {
  const tasks = await db.tasks.filter(live).toArray()
  const counts = new Map<string, number>()
  for (const task of tasks) {
    for (const tag of task.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** Renames a tag everywhere it appears, without duplicating it on a task. */
async function renameTag(from: string, to: string): Promise<void> {
  await db.transaction('rw', [db.tasks, db.syncOutbox], async () => {
    const stamp = now()
    const tagged = await db.tasks.filter((t) => live(t) && t.tags.includes(from)).toArray()
    for (const task of tagged) {
      const tags = [...new Set(task.tags.map((tag) => (tag === from ? to : tag)))]
      await db.tasks.update(task.id, { tags, updatedAt: stamp })
      await touch('tasks', task.id)
    }
  })
}

async function removeTag(tag: string): Promise<void> {
  await db.transaction('rw', [db.tasks, db.syncOutbox], async () => {
    const stamp = now()
    const tagged = await db.tasks.filter((t) => live(t) && t.tags.includes(tag)).toArray()
    for (const task of tagged) {
      await db.tasks.update(task.id, {
        tags: task.tags.filter((t) => t !== tag),
        updatedAt: stamp,
      })
      await touch('tasks', task.id)
    }
  })
}

// ---------------------------------------------------------------------------
// Trash, backup and search
// ---------------------------------------------------------------------------

export interface TrashedItem {
  kind: 'task' | 'note' | 'bucket' | 'person' | 'habit'
  id: string
  label: string
  deletedAt: string
}

const dead = <T extends { deletedAt: string | null }>(row: T): boolean => row.deletedAt !== null

/**
 * Everything soft-deleted, newest first.
 *
 * This exists because deletes are soft for sync reasons — which means nothing is
 * ever really lost, and a person who cannot see that has no way to find out.
 */
async function listTrash(): Promise<TrashedItem[]> {
  const [tasks, notes, buckets, people, habits] = await Promise.all([
    /*
      Routine cards are left out on purpose.

      A card is the day's instance of a rule, not something anybody wrote, and the
      app clears them constantly — a routine paused, a day missed, a chore skipped.
      Listed here they would bury the notes and tasks somebody actually lost, and
      restoring one would be undone by the next reconciliation anyway. The routine
      itself is the thing worth getting back, and it is listed below.
    */
    db.tasks.filter((task) => dead(task) && task.habitId === null).toArray(),
    db.notes.filter(dead).toArray(),
    db.buckets.filter(dead).toArray(),
    db.people.filter(dead).toArray(),
    db.habits.filter(dead).toArray(),
  ])

  const items: TrashedItem[] = [
    ...tasks.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      label: t.title,
      deletedAt: t.deletedAt ?? '',
    })),
    ...notes.map((n) => ({
      kind: 'note' as const,
      id: n.id,
      label: n.content.slice(0, 60),
      deletedAt: n.deletedAt ?? '',
    })),
    ...buckets.map((b) => ({
      kind: 'bucket' as const,
      id: b.id,
      label: b.name,
      deletedAt: b.deletedAt ?? '',
    })),
    ...people.map((p) => ({
      kind: 'person' as const,
      id: p.id,
      label: p.name,
      deletedAt: p.deletedAt ?? '',
    })),
    ...habits.map((h) => ({
      kind: 'habit' as const,
      id: h.id,
      label: h.title,
      deletedAt: h.deletedAt ?? '',
    })),
  ]

  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

/** Explicit rather than pluralised: "person" would become "persons", not "people". */
const TRASH_TABLES: Record<TrashedItem['kind'], SyncTable> = {
  task: 'tasks',
  note: 'notes',
  bucket: 'buckets',
  person: 'people',
  habit: 'habits',
}

/** Puts a soft-deleted row back. Restoring is an edit, so it syncs like one. */
async function restoreFromTrash(kind: TrashedItem['kind'], id: string): Promise<void> {
  const stamp = now()
  const patch = { deletedAt: null, updatedAt: stamp }

  if (kind === 'task') await db.tasks.update(id, patch)
  else if (kind === 'note') await db.notes.update(id, patch)
  else if (kind === 'bucket') await db.buckets.update(id, patch)
  else if (kind === 'person') await db.people.update(id, patch)
  else await db.habits.update(id, patch)

  await touch(TRASH_TABLES[kind], id)
}

export interface Backup {
  format: 'agentix-backup'
  version: number
  exportedAt: string
  tasks: Task[]
  sessions: TimeSession[]
  notes: Note[]
  buckets: Bucket[]
  people: Person[]
  habits: Habit[]
  habitLogs: HabitLog[]
}

export const BACKUP_VERSION = 1

/**
 * Every row, including soft-deleted ones.
 *
 * Deleted rows are included deliberately: dropping them would turn a restore into
 * a silent purge of the trash, and would break sync's ability to replay a delete.
 * API keys are absent because they live in a different database entirely.
 */
async function exportBackup(): Promise<Backup> {
  const [tasks, sessions, notes, buckets, people, habits, habitLogs] = await Promise.all([
    db.tasks.toArray(),
    db.sessions.toArray(),
    db.notes.toArray(),
    db.buckets.toArray(),
    db.people.toArray(),
    db.habits.toArray(),
    db.habitLogs.toArray(),
  ])

  return {
    format: 'agentix-backup',
    version: BACKUP_VERSION,
    exportedAt: now(),
    tasks,
    sessions,
    notes,
    buckets,
    people,
    habits,
    habitLogs,
  }
}

/** Shape check before anything is written. A bad file must fail before it lands. */
export function isBackup(value: unknown): value is Backup {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Backup>
  return (
    candidate.format === 'agentix-backup' &&
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.tasks) &&
    Array.isArray(candidate.sessions) &&
    Array.isArray(candidate.notes) &&
    Array.isArray(candidate.buckets)
  )
}

/**
 * Replaces everything with the contents of a backup, in one transaction.
 *
 * All or nothing: a file that fails halfway must not leave a half-restored board.
 */
async function importBackup(backup: Backup): Promise<void> {
  // The array form: Dexie's varargs signature stops at five tables.
  await db.transaction(
    'rw',
    [
      db.tasks,
      db.sessions,
      db.notes,
      db.buckets,
      db.people,
      db.habits,
      db.habitLogs,
      db.syncOutbox,
    ],
    async () => {
      await Promise.all([
        db.tasks.clear(),
        db.sessions.clear(),
        db.notes.clear(),
        db.buckets.clear(),
        db.people.clear(),
        db.habits.clear(),
        db.habitLogs.clear(),
      ])
      await db.syncOutbox.clear()
      await Promise.all([
        db.tasks.bulkAdd(backup.tasks),
        db.sessions.bulkAdd(backup.sessions),
        db.notes.bulkAdd(backup.notes),
        db.buckets.bulkAdd(backup.buckets),
        db.people.bulkAdd(backup.people ?? []),
        db.habits.bulkAdd(backup.habits ?? []),
        db.habitLogs.bulkAdd(backup.habitLogs ?? []),
      ])

      // A restore replaces local state wholesale, so every row it wrote is a
      // local change other devices have not seen.
      const stamp = now()
      await db.syncOutbox.bulkPut(
        SYNC_TABLES.flatMap((table) =>
          rowsFor(table, backup).map((row) => ({
            id: `${table}:${row.id}`,
            table,
            rowId: row.id,
            queuedAt: stamp,
          })),
        ),
      )
    },
  )
}

function rowsFor(table: SyncTable, backup: Backup): Array<{ id: string }> {
  if (table === 'tasks') return backup.tasks
  if (table === 'sessions') return backup.sessions
  if (table === 'notes') return backup.notes
  if (table === 'buckets') return backup.buckets
  if (table === 'people') return backup.people ?? []
  if (table === 'habits') return backup.habits ?? []
  return backup.habitLogs ?? []
}

/**
 * Removes every row, permanently.
 *
 * A hard delete, unlike everything else in this file — which is exactly why it
 * lives behind a typed confirmation in the UI. The outbox is cleared too: there
 * is nothing left to push, and pushing tombstones for rows the server never saw
 * would be noise.
 */
async function eraseEverything(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.tasks,
      db.sessions,
      db.notes,
      db.buckets,
      db.people,
      db.habits,
      db.habitLogs,
      db.syncOutbox,
    ],
    async () => {
      await Promise.all([
        db.tasks.clear(),
        db.sessions.clear(),
        db.notes.clear(),
        db.buckets.clear(),
        db.people.clear(),
        db.habits.clear(),
        db.habitLogs.clear(),
        db.syncOutbox.clear(),
      ])
    },
  )
}

export interface SearchHit {
  kind: 'task' | 'note'
  id: string
  title: string
  subtitle: string
}

/** Matches tasks by title or tag and notes by content. Case-insensitive. */
async function search(query: string, limit = 20): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []

  const [tasks, notes] = await Promise.all([
    db.tasks.filter(live).toArray(),
    db.notes.filter(live).toArray(),
  ])

  const taskHits: SearchHit[] = tasks
    .filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.tags.some((tag) => tag.toLowerCase().includes(needle)),
    )
    .map((t) => ({
      kind: 'task' as const,
      id: t.id,
      title: t.title,
      subtitle: t.tags.length > 0 ? `${t.plannedFor} · ${t.tags.join(', ')}` : t.plannedFor,
    }))

  const noteHits: SearchHit[] = notes
    .filter((n) => n.content.toLowerCase().includes(needle))
    .map((n) => ({
      kind: 'note' as const,
      id: n.id,
      title: firstLine(n.content).slice(0, 70),
      subtitle: 'Note',
    }))

  return [...taskHits, ...noteHits].slice(0, limit)
}

function firstLine(text: string): string {
  const index = text.indexOf('\n')
  return index === -1 ? text : text.slice(0, index)
}

// ---------------------------------------------------------------------------

/**
 * The single gateway to storage. Plugins receive this as `ctx.db` and never open a
 * Dexie connection of their own — that is what keeps audit stamps, soft-delete
 * filtering, and the one-running-session rule impossible to bypass.
 */
/* ── Organisations ──────────────────────────────────────────────────────────

   Nothing here is seeded and nothing runs unless an organisation exists. An
   install without one behaves exactly as it did before organisations existed,
   which is the point: a personal database does not quietly become someone
   else's to administer.
*/

/**
 * Creates an organisation and the owner's membership together.
 *
 * One transaction, because an organisation with no owner cannot be administered
 * by anyone — not even to delete it. Writing them separately leaves a window
 * where a crash strands exactly that.
 */
async function createOrganization(input: {
  name: string
  plan: OrgPlan
  seats: number
  ownerEmail: string
  ownerUserId: string | null
  ownerName?: string | null
}): Promise<{ organization: Organization; owner: Membership }> {
  const stamp = now()
  const organization: Organization = {
    id: newId(),
    name: input.name.trim(),
    plan: input.plan,
    seats: input.seats,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }
  const owner: Membership = {
    id: newId(),
    orgId: organization.id,
    userId: input.ownerUserId,
    email: input.ownerEmail.trim().toLowerCase(),
    name: input.ownerName ?? null,
    role: 'owner',
    status: 'active',
    allowedPluginIds: null,
    invitedAt: stamp,
    joinedAt: stamp,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }

  await db.transaction('rw', db.organizations, db.memberships, db.syncOutbox, async () => {
    await db.organizations.add(organization)
    await db.memberships.add(owner)
  })
  await touch('organizations', organization.id)
  await touch('memberships', owner.id)
  return { organization, owner }
}

async function getOrganization(id: string): Promise<Organization | undefined> {
  const row = await db.organizations.get(id)
  return row !== undefined && live(row) ? row : undefined
}

/**
 * The organisation this device belongs to. There is at most one.
 *
 * Returns null rather than undefined when there is none, so a `useLiveQuery`
 * caller can tell "still loading" (undefined) from "there isn't one" (null).
 * Those need different screens, and a single undefined cannot say which.
 */
async function currentOrganization(): Promise<Organization | null> {
  const rows = await db.organizations.toArray()
  const oldest = rows.filter(live).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  return oldest ?? null
}

async function updateOrganization(id: string, patch: OrganizationPatch): Promise<void> {
  await db.organizations.update(id, { ...patch, updatedAt: now() })
  await touch('organizations', id)
}

/**
 * Soft-deletes the organisation and every membership in it.
 *
 * Leaving the memberships behind would keep a roster pointing at nothing, and a
 * later sync would push rows for an organisation that no longer exists.
 */
async function deleteOrganization(id: string): Promise<void> {
  const stamp = now()
  const members = await db.memberships.where('orgId').equals(id).toArray()
  const doomed = members.filter(live)

  await db.transaction('rw', db.organizations, db.memberships, async () => {
    await db.organizations.update(id, { deletedAt: stamp, updatedAt: stamp })
    for (const m of doomed) {
      await db.memberships.update(m.id, { deletedAt: stamp, updatedAt: stamp })
    }
  })
  await touch('organizations', id)
  for (const m of doomed) await touch('memberships', m.id)
}

async function listMemberships(orgId: string): Promise<Membership[]> {
  const rows = await db.memberships.where('orgId').equals(orgId).toArray()
  return rows.filter(live)
}

async function getMembership(id: string): Promise<Membership | undefined> {
  const row = await db.memberships.get(id)
  return row !== undefined && live(row) ? row : undefined
}

/**
 * Invites someone by address.
 *
 * The caller checks the rules — `validateInvite` for the address and
 * `canFillSeat` for the seat — because both produce a sentence the screen has to
 * show, and a thrown error is not a sentence. This writes what it is told to.
 */
async function inviteMember(
  orgId: string,
  email: string,
  role: OrgRole = 'member',
): Promise<Membership> {
  const stamp = now()
  const membership: Membership = {
    id: newId(),
    orgId,
    userId: null,
    email: email.trim().toLowerCase(),
    name: null,
    role,
    status: 'invited',
    allowedPluginIds: null,
    invitedAt: stamp,
    joinedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }
  await db.memberships.add(membership)
  await touch('memberships', membership.id)
  return membership
}

async function updateMembership(id: string, patch: MembershipPatch): Promise<void> {
  await db.memberships.update(id, { ...patch, updatedAt: now() })
  await touch('memberships', id)
}

/** Removing someone is a soft delete, so the seat frees up and the history stays. */
async function removeMembership(id: string): Promise<void> {
  const stamp = now()
  await db.memberships.update(id, { deletedAt: stamp, updatedAt: stamp })
  await touch('memberships', id)
}

/**
 * Turns a pending invitation into a joined member.
 *
 * Matched on the address rather than on a token, because the address is what the
 * invitation was sent to and what the identity provider hands back on sign-in.
 * Returns undefined when there is nothing to claim, which is the ordinary case
 * for someone who simply signed in to their own personal install.
 */
async function claimMembership(
  orgId: string,
  email: string,
  userId: string,
  name?: string | null,
): Promise<Membership | undefined> {
  const wanted = email.trim().toLowerCase()
  const rows = await db.memberships.where('[orgId+email]').equals([orgId, wanted]).toArray()
  const pending = rows.filter(live)[0]
  if (pending === undefined) return undefined

  const stamp = now()
  const patch: MembershipPatch = {
    userId,
    status: pending.status === 'invited' ? 'active' : pending.status,
    joinedAt: pending.joinedAt ?? stamp,
    ...(name !== undefined && name !== null && pending.name === null ? { name } : {}),
  }
  await db.memberships.update(pending.id, { ...patch, updatedAt: stamp })
  await touch('memberships', pending.id)
  return { ...pending, ...patch, updatedAt: stamp }
}

/**
 * Every live task, and every live closed session.
 *
 * The rank surface scores a lifetime, not a window, so it needs the whole set
 * rather than one of the range readers. Both tables stay small — tasks are a
 * personal list, sessions are one per timed stretch — so a full scan filtered to
 * live rows is the honest shape rather than a paginated query pretending the data
 * is bigger than it is.
 */
async function allTasks(): Promise<Task[]> {
  return (await db.tasks.toArray()).filter(live)
}

async function allSessions(): Promise<TimeSession[]> {
  return (await db.sessions.toArray()).filter(live)
}

export const queries = {
  todayLocal,

  createTask,
  updateTask,
  deleteTask,
  getTask,
  listTasksByDay,
  listTasksInRange,
  listRecentTasks,
  allTasks,
  setTaskDone,

  startSession,
  stopRunningSession,
  closeForgottenSessions,
  getRunningSession,
  listSessionsForTask,
  listSessionsForTasks,
  listSessionsInRange,
  allSessions,
  deleteSession,

  createNote,
  updateNote,
  deleteNote,
  getNote,
  listNotes,
  listNotesForTask,

  ensureDefaultBuckets,
  listBuckets,
  createBucket,
  updateBucket,
  deleteBucket,
  reorderBuckets,

  listPeople,
  createPerson,
  updatePerson,
  deletePerson,

  listHabits,
  createHabit,
  updateHabit,
  deleteHabit,
  listHabitLogs,
  setHabitDone,
  materialiseRoutines,

  listTagCounts,
  renameTag,
  removeTag,

  createOrganization,
  getOrganization,
  currentOrganization,
  updateOrganization,
  deleteOrganization,
  listMemberships,
  getMembership,
  inviteMember,
  updateMembership,
  removeMembership,
  claimMembership,

  listOutbox,
  clearOutbox,
  applyRemote,
  readRow,

  listTrash,
  restoreFromTrash,
  exportBackup,
  importBackup,
  eraseEverything,
  search,
}

export type Queries = typeof queries
