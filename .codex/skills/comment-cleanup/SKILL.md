---
name: comment-cleanup
description: Clean up non-load-bearing code comments in a diff, pull request, stack, or selected paths. Use when asked to remove obvious, historical, or redundant comments; do not alter model-facing strings, generated files, or untouched code without an explicit whole-file request.
argument-hint: "[PR, branch, stack, or paths]"
---

# Comment cleanup

This is the Codex entry point for the repository's existing `/comment-cleanup`
workflow. Read `.claude/skills/comment-cleanup/SKILL.md` before editing; it is
the canonical rule set.

## Scope

- With no argument, inspect the current branch's diff against its merge-base
  with `origin/master`, plus uncommitted changes.
- With a PR or branch, inspect that branch's diff against its base.
- With `stack`, inspect each PR in the chain against its own base.
- With paths, inspect comments in those paths.

List candidates before editing. Touch only comments added or changed by the
scope, plus comments in files the scope creates, unless the user explicitly
requests a whole-file pass.

Delete comments that restate names, narrate obvious code, point to sibling
code, or carry history and planning. Shorten comments that contain a real
reason. Keep comments that explain a non-obvious limit, ordering, retry,
timeout, security boundary, invariant, or load-bearing external contract.

Never edit model-facing strings, generated files, lockfiles, vendored code,
README files, docs unless requested, license headers, or lint/type directives.
For a stack, edit each owning branch from the bottom up. Ordinary rebases must
retain cleanup from lower layers; restore an upper-layer tree only during the
canonical conflict procedure.

Verify with the relevant build, lint, and tests. Report deleted and shortened
comment counts and the kinds of comments intentionally kept.
