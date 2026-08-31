import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ListTodo } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Task } from '../../core/db/types'
import type { PluginContext } from '../../core/plugin-host/types'
import { useSettings } from '../../core/settings/store'
import { EmptyState } from '../../ui/components/EmptyState'
import { feedback } from '../../ui/feedback'
import { AddColumn, BoardColumn } from './components/BoardColumn'
import { TaskCard } from './components/TaskCard'
import { TaskComposer, type ComposerInput } from './components/TaskComposer'
import { TaskDetail } from './components/TaskDetail'
import {
  countBoard,
  feedbackForBucket,
  groupIntoBuckets,
  moveToBucket,
  tasksIn,
} from './logic/board'
import { collectTags } from '../tags/logic/tags'
import { groupSessionsByTask } from './logic/tasks'
import { formatDuration, totalDurationMs } from './logic/time'
import { useTicker } from './useTicker'

export function TaskManager({ ctx }: { ctx: PluginContext }) {
  const today = ctx.db.todayLocal()
  const [dragging, setDragging] = useState(false)
  const defaultPriority = useSettings((s) => s.defaultPriority)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  // useLiveQuery, not useEffect: Dexie pushes changes, so a task added or a timer
  // started anywhere — including another tab — re-renders this without a refetch.
  const tasks = useLiveQuery(() => ctx.db.listTasksByDay(today), [today])
  const running = useLiveQuery(() => ctx.db.getRunningSession(), [])
  const people = useLiveQuery(() => ctx.db.listPeople(), [], [])

  // Seeding is a write, so it cannot live inside useLiveQuery: Dexie runs a live
  // query's body in a read-only transaction and a readwrite one there throws.
  // This is initialisation, not data fetching — the read below is still live.
  useEffect(() => {
    void ctx.db.ensureDefaultBuckets()
  }, [ctx.db])

  const buckets = useLiveQuery(() => ctx.db.listBuckets(), [])

  const sessions = useLiveQuery(
    async () => {
      const forDay = await ctx.db.listTasksByDay(today)
      return ctx.db.listSessionsForTasks(forDay.map((t) => t.id))
    },
    [today],
    [],
  )

  // Tick only while something is actually running.
  const nowIso = useTicker(running !== undefined && running !== null)

  // An empty list means the seed has not landed yet. The built-in columns cannot
  // be deleted, so a board with no columns is never a real state.
  if (tasks === undefined || buckets === undefined || buckets.length === 0) return null

  const board = groupIntoBuckets(tasks, buckets)
  const counts = countBoard(tasks)
  const byTask = groupSessionsByTask(sessions)
  const trackedMs = totalDurationMs(sessions, nowIso)
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) : undefined
  const knownTags = collectTags(tasks)

  const doneBucket = buckets.find((b) => b.impliesStatus === 'done')
  const openBucket = buckets.find((b) => b.impliesStatus !== 'done')

  async function addTask(input: ComposerInput) {
    await ctx.db.createTask({
      ...input,
      plannedFor: today,
      bucketId: buckets![0]!.id,
      status: buckets![0]!.impliesStatus,
    })
    feedback('light')
  }

  async function moveTask(taskId: string, bucketId: string) {
    const bucket = buckets!.find((b) => b.id === bucketId)
    const task = await ctx.db.getTask(taskId)
    if (!bucket || !task) return

    const patch = moveToBucket(task, bucket, new Date().toISOString())
    // Null means it is already in that column. Writing anyway would bump
    // updatedAt and let a no-op win a future sync merge.
    if (!patch) return

    // Finishing a task closes its clock; leaving a timer running on finished work
    // would keep accruing time against it.
    if (bucket.impliesStatus === 'done' && running?.taskId === taskId) {
      await ctx.db.stopRunningSession()
    }

    await ctx.db.updateTask(taskId, patch)
    feedback(feedbackForBucket(bucket))
  }

  async function toggleDone(task: Task) {
    const target = task.status === 'done' ? openBucket : doneBucket
    if (target) await moveTask(task.id, target.id)
  }

  async function startTimer(taskId: string) {
    // startSession closes any other running session inside its own transaction,
    // so no check is needed here — and none would be safe if there were two tabs.
    await ctx.db.startSession(taskId)

    const task = await ctx.db.getTask(taskId)
    const inProgress = buckets!.find((b) => b.impliesStatus === 'active')
    // Starting work moves the card into the in-progress column when one exists.
    // Stopping does not move it back: pausing is not the same as never starting.
    if (task && inProgress && task.bucketId !== inProgress.id) {
      await moveTask(taskId, inProgress.id)
    }
  }

  async function removeTask(taskId: string) {
    if (running?.taskId === taskId) await ctx.db.stopRunningSession()
    await ctx.db.deleteTask(taskId)
    setOpenTaskId(null)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-base text-ink">Today</h2>
        {counts.total > 0 && (
          <p className="text-xs text-muted">
            {counts.done} of {counts.total} done
            {trackedMs > 0 && ` · ${formatDuration(trackedMs)} tracked`}
          </p>
        )}
      </div>

      {counts.total > 0 && (
        <div
          className="h-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={counts.percentDone}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress today"
        >
          <motion.div
            className="h-full rounded-full bg-ok"
            initial={false}
            animate={{ width: `${counts.percentDone}%` }}
            transition={{ type: 'spring', stiffness: 200, damping: 30 }}
          />
        </div>
      )}

      <TaskComposer
        people={people}
        defaultPriority={defaultPriority}
        onAdd={addTask}
        onCreatePerson={async (name, colorId) => {
          await ctx.db.createPerson(name, colorId)
        }}
      />

      {counts.total === 0 ? (
        <EmptyState
          icon={<ListTodo className="size-8" aria-hidden />}
          title="Nothing planned for today."
          body="Add a task above. Give it an estimate and the timer will tell you later how close you were."
        />
      ) : null}

      <div className="agentix-scroll flex items-stretch gap-3 overflow-x-auto pb-2">
        {buckets.map((bucket, index) => (
          <BoardColumn
            key={bucket.id}
            bucket={bucket}
            count={tasksIn(board, bucket.id).length}
            canMoveLeft={index > 0}
            canMoveRight={index < buckets.length - 1}
            isDragging={dragging}
            // The last column cannot go: a board with nowhere to put a task is
            // not a state worth being able to reach.
            canDelete={buckets.length > 1}
            onDropTask={(taskId, target) => void moveTask(taskId, target)}
            onRename={async (name) => {
              await ctx.db.updateBucket(bucket.id, { name })
            }}
            onRecolour={async (colorId) => {
              await ctx.db.updateBucket(bucket.id, { colorId })
            }}
            onMove={async (direction) => {
              // Reordering rewrites every column's order in one transaction, so
              // two columns can never end up claiming the same position.
              const ids = buckets!.map((b) => b.id)
              const from = index
              const to = index + direction
              const [moved] = ids.splice(from, 1)
              ids.splice(to, 0, moved!)
              await ctx.db.reorderBuckets(ids)
            }}
            onDelete={async () => {
              await ctx.db.deleteBucket(bucket.id)
            }}
          >
            {tasksIn(board, bucket.id).map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                buckets={buckets}
                sessions={byTask.get(task.id) ?? []}
                assignees={people.filter((p) => task.assigneeIds.includes(p.id))}
                isTracking={running?.taskId === task.id}
                nowIso={nowIso}
                onOpen={() => setOpenTaskId(task.id)}
                onToggleDone={() => void toggleDone(task)}
                onRename={async (title) => {
                  await ctx.db.updateTask(task.id, { title })
                }}
                onMove={(bucketId) => moveTask(task.id, bucketId)}
                onDelete={() => removeTask(task.id)}
                onStart={() => void startTimer(task.id)}
                onStop={() => void ctx.db.stopRunningSession()}
                onDragStart={() => setDragging(true)}
                onDragEnd={() => setDragging(false)}
              />
            ))}
          </BoardColumn>
        ))}

        <AddColumn
          onCreate={async (name) => {
            await ctx.db.createBucket(name)
          }}
        />
      </div>

      {openTask && (
        <TaskDetail
          task={openTask}
          buckets={buckets}
          people={people}
          sessions={byTask.get(openTask.id) ?? []}
          nowIso={nowIso}
          onClose={() => setOpenTaskId(null)}
          onPatch={async (patch) => {
            await ctx.db.updateTask(openTask.id, patch)
          }}
          onMoveToBucket={(bucketId) => moveTask(openTask.id, bucketId)}
          onDelete={() => removeTask(openTask.id)}
          onCreatePerson={async (name, colorId) => {
            await ctx.db.createPerson(name, colorId)
          }}
          knownTags={knownTags}
        />
      )}
    </div>
  )
}
