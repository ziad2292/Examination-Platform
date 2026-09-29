const statuses = new Set(["draft", "published", "closed", "archived"]);
const phases = new Set(["upcoming", "active", "closed"]);

export function normalizeExamFilters(input: { q?: string; status?: string; phase?: string; from?: string; to?: string }) {
  return {
    titleSearch: (input.q ?? "").trim().slice(0, 120),
    status: statuses.has(input.status ?? "") ? input.status! : "",
    phase: phases.has(input.phase ?? "") ? input.phase! : "",
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(input.from ?? "") ? input.from! : "",
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(input.to ?? "") ? input.to! : "",
  };
}

export function latestAttemptsByStudent<T extends { student_id: string; generation: number }>(attempts: T[]) {
  const latest = new Map<string, T>();
  for (const attempt of attempts) {
    const current = latest.get(attempt.student_id);
    if (!current || attempt.generation > current.generation) latest.set(attempt.student_id, attempt);
  }
  return [...latest.values()];
}

export function summarizeLiveStatus(
  totalStudents: number,
  attempts: { status: "in_progress" | "completed" | "expired" }[],
) {
  return {
    notStarted: Math.max(0, totalStudents - attempts.length),
    inProgress: attempts.filter((attempt) => attempt.status === "in_progress").length,
    completed: attempts.filter((attempt) => attempt.status === "completed").length,
    problem: attempts.filter((attempt) => attempt.status === "expired").length,
  };
}
