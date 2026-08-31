# Note Taker

Phase 3. Notes, optionally attached to a task, with an AI summary through `ctx.ai`.

## What it reads

- `notes` — every live note, most recently edited first
- `tasks` from the last 7 days, to offer something to attach a note to

## What it writes

- **Notes** — content, the task it belongs to, and `aiSummary`

It never rewrites a note's content. A summary is stored beside the note, never over it.

## Files

```
note-taker/
├── manifest.ts       id, name, icon, version, requiresAI
├── index.tsx         plugin assembly
├── NoteTaker.tsx     the entry component
├── components/       NoteCard, NoteComposer
└── logic/
    ├── notes.ts      validation, sorting, search, counts — pure
    └── prompt.ts     prompt construction and reply cleanup — pure
```

## Why the prompt lives in `logic/`

**A prompt is behaviour, not presentation.** If it sits inline in JSX, the Swift
build re-invents it and the same note gets summarised two different ways on two
devices. `prompt.ts` is the specification: translate it and both platforms send an
identical request.

Two things it handles that are easy to miss:

- **The note is fenced and framed as material, never as instructions.** A note is
  user text going into a prompt, so it can contain something that reads like a
  command. There is a test that an injection attempt stays inside the fence.
- **Replies get cleaned.** Models still open with "Summary:" or wrap the answer in
  quotes despite being told not to. `cleanSummary` strips a wrapper but leaves a
  quotation that is part of the text alone.

## Degrading without a key

This is the phase gate, and the rule is: **no key is a missing feature, not a failure.**

Without a key the plugin still writes, edits, searches, links and deletes notes.
The only difference is that the summarise control becomes a pointer at Settings.
There is no error, and no disabled button that fails to say why.

`ctx.ai.isConfigured()` is read through a live query, so saving a key in Settings
re-enables summarising here without a reload.

## Costs and failures

- Notes shorter than `MIN_SUMMARY_CHARS` (80) cannot be summarised — a summary
  would be longer than the note, and the request is not free.
- Long notes are truncated at `MAX_PROMPT_CHARS` (6000) rather than letting the
  provider refuse an oversized request.
- Only `ProviderError` messages reach the screen. An unknown error is replaced,
  because it may quote the request — and the request carries the key.
