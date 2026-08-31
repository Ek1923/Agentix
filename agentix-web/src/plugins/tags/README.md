# Tags

Time and completion per tag — the closest thing the data has to a per-project or
per-client breakdown.

## Why it exists

`Task.tags` has been in the locked schema since the beginning with nothing reading
or writing it. This plugin is what makes carrying that field worthwhile, and the
tag editor in Task Manager is what fills it.

## One normalisation, one place

`normaliseTag` lowercases, trims and strips a leading hash. It lives here and the
Task Manager editor imports it, deliberately: a tag typed on a card and a tag
typed anywhere else have to end up identical, or the breakdown quietly splits one
project into two.

Renaming a tag rewrites it on every task in one transaction, and never leaves a
duplicate when the new name already exists on a task.

## Why there is no total

A task with three tags counts **fully** under each of them. That answers "how much
went into this tag", which is the useful question — but it means the columns add
up to more than the real total, so no total is shown. Saying it plainly beats
showing a number that does not reconcile.

## Files

```
tags/
├── manifest.ts
├── index.tsx
├── Tags.tsx
└── logic/
    └── tags.ts   normalisation, per-tag stats, sorting — pure
```
