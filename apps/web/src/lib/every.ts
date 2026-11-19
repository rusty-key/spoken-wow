/**
 * Background work on a timer: `round` every `everyMs`, never over a round still running, and
 * never keeping the process alive. A failed round is logged with `failure` and the next tries
 * again.
 */
export function every(everyMs: number, failure: string, round: () => Promise<unknown>): { stop: () => void } {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await round();
    } catch (error) {
      console.error(failure, error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
