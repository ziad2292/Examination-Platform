export type CleanupScope = "exams" | "students" | "all";

export const cleanupPhrases: Record<CleanupScope, string> = {
  exams: "DELETE ALL EXAMS",
  students: "DELETE ALL STUDENTS",
  all: "DELETE ALL EXAMS AND STUDENTS",
};

export function validSectionDurationMinutes(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 240;
}

export function canRemoveExamAssignment(hasAttempt: boolean) {
  return !hasAttempt;
}

export function cleanupConfirmationMatches(scope: CleanupScope, entered: string) {
  return entered === cleanupPhrases[scope];
}
