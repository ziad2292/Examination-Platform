/** Logs slow upstream steps without student identifiers, tokens, or payloads. */
export async function timedExamStep<T>(route: string, step: string, task: () => PromiseLike<T>): Promise<T> {
  const started = performance.now();
  try {
    return await task();
  } finally {
    const ms = Math.round(performance.now() - started);
    if (ms >= 1500) console.warn("exam_upstream_slow", { route, step, ms });
  }
}
