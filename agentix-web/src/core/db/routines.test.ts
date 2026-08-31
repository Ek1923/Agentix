import { beforeEach, describe, expect, it } from 'vitest'
import { shiftDay } from '../dates'
import { habitTaskId } from '../habits'
import { db } from './db'
import { queries } from './queries'

const today = () => queries.todayLocal()

/** The weekday number of a day key, for building a routine that is not due today. */
function weekdayOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year!, month! - 1, date!).getDay()
}

async function dailyRoutine(title = 'Stretch', estimateMin: number | null = null) {
  return queries.createHabit(title, [], estimateMin, 'slate')
}

const cardFor = async (habitId: string, day = today()) => db.tasks.get(habitTaskId(habitId, day))

beforeEach(async () => {
  await db.open()
  await Promise.all([
    db.tasks.clear(),
    db.sessions.clear(),
    db.buckets.clear(),
    db.habits.clear(),
    db.habitLogs.clear(),
    db.syncOutbox.clear(),
  ])
  await queries.ensureDefaultBuckets()
})

describe('routines reaching the board', () => {
  it('gives a routine due today a card, with the routine on it', async () => {
    const habit = await dailyRoutine('Stretch', 15)

    const card = await cardFor(habit.id)
    expect(card).toBeDefined()
    expect(card!.title).toBe('Stretch')
    expect(card!.estimateMin).toBe(15)
    expect(card!.habitId).toBe(habit.id)
    expect(card!.plannedFor).toBe(today())
    expect(card!.status).toBe('todo')
  })

  it('writes one card however often the day is materialised', async () => {
    const habit = await dailyRoutine()

    expect(await queries.materialiseRoutines()).toBe(0)
    await queries.materialiseRoutines()

    const cards = await db.tasks.where('habitId').equals(habit.id).toArray()
    expect(cards).toHaveLength(1)
  })

  it('leaves a routine that is not due today alone', async () => {
    const notToday = (weekdayOf(today()) + 3) % 7
    const habit = await queries.createHabit('Weekly review', [notToday], null, 'slate')

    expect(await cardFor(habit.id)).toBeUndefined()
  })

  it('leaves a paused routine alone', async () => {
    const habit = await dailyRoutine()
    await queries.updateHabit(habit.id, { archivedAt: new Date().toISOString() })

    const card = await cardFor(habit.id)
    expect(card?.deletedAt).not.toBeNull()
  })

  it('arrives already ticked when the routine was kept before the card was made', async () => {
    const habit = await dailyRoutine()
    await db.tasks.clear() // as if this device had not opened yet today
    await queries.setHabitDone(habit.id, today(), true)

    await queries.materialiseRoutines()

    const card = await cardFor(habit.id)
    expect(card!.status).toBe('done')
    expect(card!.completedAt).not.toBeNull()
  })

  it('does not bring back a card that was skipped', async () => {
    const habit = await dailyRoutine()
    await queries.deleteTask(habitTaskId(habit.id, today()))

    await queries.materialiseRoutines()

    const card = await cardFor(habit.id)
    expect(card!.deletedAt).not.toBeNull()
  })
})

describe('ticking it in either place', () => {
  it('records the routine as kept when the card is finished', async () => {
    const habit = await dailyRoutine()

    await queries.setTaskDone(habitTaskId(habit.id, today()), true)

    const logs = await queries.listHabitLogs(today(), today())
    expect(logs.filter((log) => log.deletedAt === null)).toHaveLength(1)
  })

  it('takes the day back when the card is reopened', async () => {
    const habit = await dailyRoutine()
    const cardId = habitTaskId(habit.id, today())

    await queries.setTaskDone(cardId, true)
    await queries.setTaskDone(cardId, false)

    const logs = await queries.listHabitLogs(today(), today())
    expect(logs.filter((log) => log.deletedAt === null)).toHaveLength(0)
  })

  it('records the day when the card is finished by moving it to a done column', async () => {
    // How the board actually finishes work: a bucket move, not setTaskDone.
    const habit = await dailyRoutine()
    const done = (await queries.listBuckets()).find((b) => b.impliesStatus === 'done')!

    await queries.updateTask(habitTaskId(habit.id, today()), {
      bucketId: done.id,
      status: 'done',
      completedAt: new Date().toISOString(),
    })

    const logs = await queries.listHabitLogs(today(), today())
    expect(logs.filter((log) => log.deletedAt === null)).toHaveLength(1)
  })

  it('takes the day back when the card is dragged out of the done column', async () => {
    const habit = await dailyRoutine()
    const cardId = habitTaskId(habit.id, today())
    const buckets = await queries.listBuckets()
    const done = buckets.find((b) => b.impliesStatus === 'done')!
    const todo = buckets.find((b) => b.impliesStatus !== 'done')!

    await queries.updateTask(cardId, { bucketId: done.id, status: 'done', completedAt: null })
    await queries.updateTask(cardId, { bucketId: todo.id, status: 'todo', completedAt: null })

    const logs = await queries.listHabitLogs(today(), today())
    expect(logs.filter((log) => log.deletedAt === null)).toHaveLength(0)
  })

  it('ticks the card when the routine is ticked in its own plugin', async () => {
    const habit = await dailyRoutine()

    await queries.setHabitDone(habit.id, today(), true)

    const card = await cardFor(habit.id)
    expect(card!.status).toBe('done')
    expect(card!.completedAt).not.toBeNull()
  })

  it('unticks the card when the routine is unticked', async () => {
    const habit = await dailyRoutine()
    await queries.setHabitDone(habit.id, today(), true)

    await queries.setHabitDone(habit.id, today(), false)

    const card = await cardFor(habit.id)
    expect(card!.status).not.toBe('done')
    expect(card!.completedAt).toBeNull()
  })

  it('stops the clock on a routine, like any other finished work', async () => {
    const habit = await dailyRoutine()
    const cardId = habitTaskId(habit.id, today())
    await queries.startSession(cardId)

    await queries.setHabitDone(habit.id, today(), true)

    expect(await queries.getRunningSession()).toBeUndefined()
  })
})

describe('editing the routine behind the card', () => {
  it('renames an open card with it', async () => {
    const habit = await dailyRoutine('Strech')

    await queries.updateHabit(habit.id, { title: 'Stretch' })

    expect((await cardFor(habit.id))!.title).toBe('Stretch')
  })

  it('leaves a finished card as it was done', async () => {
    const habit = await dailyRoutine('Stretch')
    await queries.setTaskDone(habitTaskId(habit.id, today()), true)

    await queries.updateHabit(habit.id, { title: 'Stretch properly' })

    expect((await cardFor(habit.id))!.title).toBe('Stretch')
  })

  it('takes today off the board when the routine no longer falls on today', async () => {
    const habit = await dailyRoutine()
    const notToday = (weekdayOf(today()) + 3) % 7

    await queries.updateHabit(habit.id, { daysOfWeek: [notToday] })

    expect((await cardFor(habit.id))!.deletedAt).not.toBeNull()
  })

  it('clears the open card when the routine is deleted, and keeps what was done', async () => {
    const kept = await dailyRoutine('Kept')
    const open = await dailyRoutine('Open')
    await queries.setTaskDone(habitTaskId(kept.id, today()), true)

    await queries.deleteHabit(kept.id)
    await queries.deleteHabit(open.id)

    expect((await cardFor(kept.id))!.deletedAt).toBeNull()
    expect((await cardFor(open.id))!.deletedAt).not.toBeNull()
  })
})

describe('days that are over', () => {
  it('sweeps an unkept routine card once its day has passed', async () => {
    const habit = await dailyRoutine()
    const yesterday = shiftDay(today(), -1)
    await queries.materialiseRoutines(yesterday)

    await queries.materialiseRoutines()

    expect((await cardFor(habit.id, yesterday))!.deletedAt).not.toBeNull()
  })

  it('leaves a routine that was actually kept in the record', async () => {
    const habit = await dailyRoutine()
    const yesterday = shiftDay(today(), -1)
    await queries.materialiseRoutines(yesterday)
    await queries.setTaskDone(habitTaskId(habit.id, yesterday), true)

    await queries.materialiseRoutines()

    expect((await cardFor(habit.id, yesterday))!.deletedAt).toBeNull()
  })

  it('never sweeps ordinary work, however old', async () => {
    const old = await queries.createTask({ title: 'Still owed', plannedFor: shiftDay(today(), -9) })

    await queries.materialiseRoutines()

    expect((await queries.getTask(old.id))?.deletedAt).toBeNull()
  })
})

describe('a routine card belongs to its day', () => {
  it('refuses to be moved to another one', async () => {
    const habit = await dailyRoutine()
    const cardId = habitTaskId(habit.id, today())

    await queries.updateTask(cardId, { plannedFor: shiftDay(today(), 1) })

    expect((await db.tasks.get(cardId))!.plannedFor).toBe(today())
  })

  it('still takes every other edit', async () => {
    const habit = await dailyRoutine()
    const cardId = habitTaskId(habit.id, today())

    await queries.updateTask(cardId, { plannedFor: shiftDay(today(), 1), priority: 2 })

    const card = await db.tasks.get(cardId)
    expect(card!.plannedFor).toBe(today())
    expect(card!.priority).toBe(2)
  })

  it('leaves ordinary tasks free to move', async () => {
    const task = await queries.createTask({ title: 'Move me' })
    const tomorrow = shiftDay(today(), 1)

    await queries.updateTask(task.id, { plannedFor: tomorrow })

    expect((await queries.getTask(task.id))!.plannedFor).toBe(tomorrow)
  })
})

describe('the trash', () => {
  it('does not fill up with routine cards the app cleared itself', async () => {
    const habit = await dailyRoutine('Swept routine')
    const task = await queries.createTask({ title: 'A real loss' })
    await queries.deleteTask(task.id)

    await queries.deleteHabit(habit.id)

    const trash = await queries.listTrash()
    expect(trash.map((item) => item.label)).toContain('A real loss')
    // The routine itself is restorable; the card it made for today is not a thing
    // anybody lost.
    expect(trash.filter((item) => item.kind === 'task').map((item) => item.label)).toEqual([
      'A real loss',
    ])
    expect(trash.some((item) => item.kind === 'habit' && item.label === 'Swept routine')).toBe(
      true,
    )
  })
})
