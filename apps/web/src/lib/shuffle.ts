/** `random` is injectable so a test can fix the order. */
export function shuffle<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const shuffled = [...list];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
