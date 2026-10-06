---
name: comment-cleanup
description: Use when asked to clean up, fix, trim or review code comments, or when invoked as /comment-cleanup. Cuts comments that restate names, narrate the obvious, reference sibling code or carry history, and shortens the rest, across a diff, a PR, a whole PR stack or given paths.
---

# Comment cleanup

A comment is kept only when it tells the reader something the code cannot. Everything else goes,
and what stays is one or two lines.

## 1. Scope

Take the target from the arguments:

- **Nothing given:** the current branch's diff against its merge-base with `origin/develop`, plus
  uncommitted changes.
- **A PR number or branch:** that PR's diff against its base.
- **"stack" or a stack PR:** every PR in the chain, each against its own base branch.
- **Paths:** the comments in those files.

Only touch comments the scope adds or changes, plus comments in files the scope creates. Leave
comments in untouched code alone unless the user asks for a whole-file pass.

List the candidates before editing:

```sh
git diff -U0 <base> <head> -- <paths> | grep -E '^\+\s*(//|/\*|\*|#|\(\*)'
```

## 2. The rules

**Delete** a comment that:

- restates the name of what it sits on (`/** The session's working directory. */` over
  `workdirForSession`, field docs repeating the field name);
- narrates the next line or states what any reader sees at a glance;
- repeats a rule already documented on the interface, type or function it implements;
- points at sibling code to justify itself ("same bound as saveTo.ts", "like render_server",
  "see X's module doc"). Anything can be deleted any day, so a comment states its own facts;
- carries history or planning: ticket ids, "for now", "until PR3", "used to", "ported from",
  "the old tool did X".

**Shorten** a comment that has a real reason buried in it. Keep the reason, drop the preamble,
examples and restated context. Multi-paragraph module docs become the one or two facts a
maintainer needs.

**Keep** a comment that gives:

- why a limit, order, retry or timeout exists;
- why the obvious approach breaks;
- a non-obvious invariant or security boundary;
- a load-bearing pointer the reader must follow, such as a frozen wire contract, cross-language
  test vectors, or a hash pin.

Write what stays in plain, current-state prose (the unslop rules): no em dashes, active voice,
no filler.

## 3. Never touch

- Model-facing strings: tool descriptions, prompt text, schema descriptions. They are behaviour,
  often pinned by tests.
- Generated files, lockfiles, vendored code.
- README and docs, unless the user includes them.
- Lint or type directives (`// eslint-disable-…`, `// @ts-expect-error`, `[@@@ocaml.warning]`),
  license headers, section banners that organise a long file.

## 4. Stacks: edit the owning layer

A comment belongs to the PR that introduced it. For a stack:

1. Clean each layer's own comments on that layer's branch, bottom first, and amend or commit
   there.
2. Cascade each upper layer onto the new lower tip: `git rebase --onto <new lower> <old lower>
   <upper>`.
3. If an upper layer already rewrote the same comment, a conflict follows. Resolve it by
   restoring the upper layer's already-cleaned file from its pre-rebase commit, with a script that
   writes `git show <old upper>:<path>`. Then check that the rebased tree equals the pre-rebase
   one (`git diff --quiet <old upper> HEAD`). dcg blocks `git checkout --theirs`.
4. Push each branch from its own checkout.

## 5. Verify

- Build, lint and tests must pass at every tip you changed. A comment edit must never change
  behaviour, so any test movement means something other than a comment was touched.
- Model-facing pins (prompt hashes, tool schema tests) must not move. If one does, a string was
  edited by mistake.

## 6. Report

Say how many comment lines were deleted and how many shortened, per PR or file, and name the
kinds you kept on purpose. Do not list every edit.
