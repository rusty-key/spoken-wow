// Discord to GitHub issues, on Discord's events instead of a 15-minute schedule. The filing itself
// is scripts/lib/forum-issues.mjs, unchanged in what it files and how it avoids filing twice; this
// only decides when it runs.
//
// A gateway can miss events while it reconnects, and the bot is down during a deploy, so the full
// sweeps run at startup and every hour as well. They file only what has no issue yet.
//
// Everything goes through one queue. Two sweeps side by side would each see a post without an
// issue and file it twice, the race the workflow's concurrency group used to prevent.

import { file, isForum, reaction, reactions } from "../../../scripts/lib/forum-issues.mjs";

const SWEEP_EVERY = 60 * 60 * 1000;
// A forum post's thread arrives before its first message can be read.
const POST_SETTLE = 5000;

export function issueFiler({ api, gh, log = console }) {
  let queue = Promise.resolve();
  const run = (what, job) => {
    queue = queue.then(job).catch((error) => log.error(`issues: ${what} failed: ${error.message}`));
  };
  const sweep = () => {
    run("forum sweep", () => file(api, gh));
    run("🐛 sweep", () => reactions(api, gh));
  };

  return {
    start() {
      sweep();
      setInterval(sweep, SWEEP_EVERY).unref();
    },
    /** A thread was created; a new forum post gets its issue. */
    onThreadCreate(thread, newlyCreated) {
      if (!newlyCreated || !thread.parent || !isForum(thread.parent)) return;
      setTimeout(() => run(`forum post ${thread.id}`, () => file(api, gh)), POST_SETTLE).unref();
    },
    /** A moderator added a 🐛: the message is filed. */
    onReactionAdd(channelId, messageId) {
      run(`🐛 on ${messageId}`, () => reaction(api, gh, channelId, messageId));
    },
  };
}
