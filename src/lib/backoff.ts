// Exponential backoff with full jitter: a random value in [0, min(cap, base * 2^attempt)).

export function backoffDelay(attempt: number, baseMs = 1000, capMs = 300_000, random: () => number = Math.random): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.min(attempt, 30));
  return Math.floor(random() * ceiling);
}
