# Brann Bronzebeard

The Spoken Discord server's bot. He stays connected to Discord, so he sees each message as it
arrives instead of polling on a schedule.

- **Support.** He reads every channel he can see. When someone asks for help with something
  [`docs/support/FAQ.md`](../../docs/support/FAQ.md) answers, he opens a thread under the question
  and answers there, in the language it was asked in. The asker can keep talking to him in that
  thread, or press **Continue in DMs**, and rates his answer with 👍 or 👎. When the FAQ has no answer he stays silent in a channel,
  and in a thread or DM he says he doesn't know and points to the bugs forum.
- **Issues.** Each post in `#bugs` and each message a moderator marks with 🐛 becomes a
  GitHub issue as soon as it appears (`src/issues.mjs`, which calls `scripts/lib/forum-issues.mjs`).
  A closed issue is still reported by `.github/workflows/forum-issues.yaml`, because Discord cannot
  see GitHub.

## What he answers, and what he leaves alone

`src/support.mjs` holds the rules, and `src/support.test.mjs` tests them.

- He only answers from the FAQ. **To teach him something, add an entry to the FAQ.** It ships
  with the next deploy.
- He ignores bots, moderators (they are the ones answering), messages under 15 characters, and
  a reply from one player to another. Mention him (`@Brann`) to ask him directly anyway.
- He answers each player in a channel at most once a minute, and keeps out while someone else is
  helping them: replied to or mentioned them in the last ten minutes.
- In his thread he talks only with the person who asked, and stops once a moderator posts there.
- Messages are untrusted text. The model has no tools, and his posts ping nobody but the asker.

## How the FAQ improves

Three parts, so the FAQ keeps up with the players and the code:

- **Feedback.** Each answer in a channel or a thread carries 👍 **Helped** and 👎 **Didn't help**.
  Only the asker can press them. The two buttons then become one disabled button with the verdict,
  so the answer itself records it (`src/feedback.mjs`).
- **The FAQ check** (`src/faq-check.mjs`, in `make lint` and CI). Every `/sp…` command in the FAQ
  must be one the addons handle, and every **bold** name must be text in the addons' or the
  Manager's English strings. Renaming a setting or a command fails the PR that renames it, until
  the FAQ follows. A bold name that is not UI text (a pack, an app) goes on `KNOWN` in the check.
- **The weekly sweep** (`src/sweep.mjs`, `.github/workflows/faq-sweep.yaml`, Mondays). Claude Opus
  reads the past week of every channel and thread Brann can see, the verdicts on his answers, and
  the merges and changelog of that week. It proposes FAQ changes as a pull request: questions he
  left alone that a moderator answered, answers marked "Didn't help" or corrected by a moderator,
  and settings or commands that changed. The PR links the Discord messages and commits behind
  each change and quotes no player, since the repository is public. A quiet week opens nothing.
  CI does not run on that PR, so the sweep runs the FAQ check itself and the PR warns when it fails.

To try the sweep without opening anything:

```sh
node apps/brann/src/sweep.mjs --days 7 --dry-run
```

It needs `DISCORD_BOT_TOKEN` and `ANTHROPIC_API_KEY` (from the environment or the repo-root
`.env`). A week costs about a dollar.

## Cost

He sends each message he considers to Claude, with the FAQ as the system prompt. The FAQ is
cached, so after the first call a message costs a tenth of its FAQ tokens plus its own.
`BRANN_DAILY_CALLS` caps the calls per UTC day. When he reaches it he logs a warning and stops
answering until midnight.

## Trying him in Discord

He never answers a moderator unasked, so a moderator testing him in an ordinary channel gets
silence. Set `BRANN_TEST_CHANNEL=test` and restart him: in `#test` (and its threads) a moderator is
a player, and `pm2 logs brann` shows each decision, such as `#test rusty: skip: too short`,
`asking the model (channel)`, or `no answer: the FAQ does not cover it`.

At startup he names any key that is not one plain word, such as a key copied with its "…" from a
console's short form. A broken Discord token stops him; a broken Anthropic or GitHub key turns off
support answers or issue filing.

## Trying him on a channel's history

`src/replay.mjs` runs a channel's recent messages through the same rules and the same model call,
and prints which ones he would answer and what he would say. It posts nothing and files nothing.

```sh
node apps/brann/src/replay.mjs general            # the last 100 messages
node apps/brann/src/replay.mjs general --all      # and why each other message was skipped
```

It reads `BRANN_DISCORD_TOKEN` or `DISCORD_BOT_TOKEN`, and `BRANN_ANTHROPIC_API_KEY` or
`ANTHROPIC_API_KEY`, from the environment or the repo-root `.env`. Each message he would consider
is one model call.

## Running

On the droplet he is the pm2 app `brann` in `deploy/web/ecosystem.config.js`. He ships in each
release under `release-tools/apps/brann`, and every deploy restarts him. There must be exactly
one of him: a second process would answer every question twice.

His environment comes from `/srv/spoken/shared/app.env`:

| Variable | |
|---|---|
| `BRANN_DISCORD_TOKEN` | the bot's token. Required |
| `BRANN_ANTHROPIC_API_KEY` | unset: no support answers |
| `BRANN_GITHUB_TOKEN` | fine-grained, `issues: write` on this repository. Unset: no issue filing |
| `BRANN_GITHUB_REPOSITORY` | default `rusty-key/spoken-wow` |
| `BRANN_MODEL` | default `claude-sonnet-5-5` |
| `BRANN_SUPPORT` | `on` (default), `dry` (log what he would answer, post nothing) or `off` |
| `BRANN_DAILY_CALLS` | model calls a UTC day, default 1000 |
| `BRANN_TEST_CHANNEL` | a channel name, such as `test`. There he treats moderators as players and logs every decision, skips included |

In the [Discord developer portal](https://discord.com/developers/applications), the bot needs the
**Message Content** intent switched on. In the server it needs View Channels, Send Messages, Send
Messages in Threads, Create Public Threads, Read Message History and Manage Threads
(for the forum's tags).

Locally:

```sh
BRANN_DISCORD_TOKEN=… BRANN_ANTHROPIC_API_KEY=… BRANN_SUPPORT=dry node apps/brann/src/index.mjs
```

The token is the server's real bot. Locally, run him only with `BRANN_SUPPORT=dry` and without
`BRANN_GITHUB_TOKEN`, so the droplet's copy is the only one that posts or files.
