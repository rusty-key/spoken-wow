/** How long stop() waits for a round still running: under pm2's kill_timeout (deploy/web/ecosystem.config.js). */
export const DRAIN_MS = 20_000;

/**
 * Background work on a timer: `round` every `everyMs`, never over a round still running, and
 * never keeping the process alive. A failed round is logged with `failure` and the next tries
 * again. stop() starts no more rounds and resolves once the one running ends, or after `waitMs`.
 */
export function every(
  everyMs: number,
  failure: string,
  round: () => Promise<unknown>,
): { stop: (waitMs?: number) => Promise<void> } {
  let running: Promise<void> | null = null;
  let stopped = false;
  const tick = () => {
    if (running || stopped) return;
    running = round()
      .then(
        () => {},
        (error) => console.error(failure, error),
      )
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return {
    stop: async (waitMs = DRAIN_MS) => {
      stopped = true;
      clearInterval(timer);
      if (!running) return;
      let late: NodeJS.Timeout | undefined;
      await Promise.race([running, new Promise<void>((resolve) => (late = setTimeout(resolve, waitMs)))]);
      clearTimeout(late);
    },
  };
}
