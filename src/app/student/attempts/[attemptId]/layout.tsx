import { ExamIntegrityProvider } from "@/components/exam-integrity-provider";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { IntegritySummary } from "@/lib/integrity";
export default async function AttemptLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ attemptId: string }>;
}) {
  await requireRole("student");
  const { attemptId } = await params;
  let initial: IntegritySummary | null = null;
  if (process.env.NEXT_PUBLIC_INTEGRITY_ENABLED === "true") {
    const db = await createClient();
    const { data } = await db.rpc("student_attempt_integrity_policy", {
      target_attempt: attemptId,
    });
    initial = data as IntegritySummary | null;
  }
  return (
    <ExamIntegrityProvider attemptId={attemptId} initial={initial}>
      {children}
    </ExamIntegrityProvider>
  );
}
