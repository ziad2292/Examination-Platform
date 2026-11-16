"use client";
import { createContext, useContext, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import type { IntegritySummary } from "@/lib/integrity";
import {
  useIntegrityTransport,
  useIntegrityDetectors,
} from "@/lib/use-exam-integrity";

type Context = {
  summary: IntegritySummary | null;
  ready: boolean;
  setModule: (id: string | null) => void;
  suspend: () => void;
};
const IntegrityContext = createContext<Context | null>(null);
export const useExamIntegrity = () => useContext(IntegrityContext);
export function ExamIntegrityProvider({
  attemptId,
  children,
  initial = null,
}: {
  attemptId: string;
  children: React.ReactNode;
  initial?: IntegritySummary | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const {
    summary,
    ready,
    transportError,
    emit,
    policy,
    moduleId,
    suspended,
    setModule,
    suspend,
  } = useIntegrityTransport(attemptId, initial);
  const path = usePathname();
  useIntegrityDetectors(root, moduleId, suspended, policy, emit, path);
  const value: Context = {
    summary,
    ready,
    setModule,
    suspend,
  };
  return (
    <IntegrityContext.Provider value={value}>
      <div ref={root} data-integrity-surface className="bg-background">
        {summary?.enabled && (
          <section
            aria-label="Assessment integrity status"
            className="mb-6 rounded-xl border border-black/10 bg-white p-4 sm:p-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/5 text-brand">
                  <ShieldCheck size={18} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Monitored assessment</p>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-black/55">
                    Integrity monitoring is enabled. Browser activity is a
                    review indicator, not proof of cheating. No screen, camera,
                    or clipboard contents are collected.
                  </p>
                </div>
              </div>
            </div>
            {(Boolean(summary.count) || summary.overlap || transportError) && (
              <div className="mt-4 space-y-2 border-t border-black/10 pt-4 text-sm leading-6">
                {summary.count ? (
                  <p role="status" className="font-semibold text-red-800">
                    {summary.count} counted incident(s).{" "}
                    {summary.reviewRequired
                      ? "Your attempt is flagged for teacher review; continue your assessment."
                      : "Recorded for teacher review. Continue your assessment."}
                  </p>
                ) : null}
                {summary.overlap && (
                  <p role="status">
                    Another exam session was recently active. Both sessions
                    remain allowed.
                  </p>
                )}
                {transportError && (
                  <p role="status">
                    Monitoring connection unavailable; retrying. Your assessment
                    continues.
                  </p>
                )}
              </div>
            )}
          </section>
        )}
        {children}
      </div>
    </IntegrityContext.Provider>
  );
}
export function IntegrityModuleLifecycle({
  sectionAttemptId,
}: {
  sectionAttemptId: string | null;
}) {
  const context = useExamIntegrity();
  const setModule = context?.setModule;
  useEffect(() => {
    setModule?.(sectionAttemptId);
    return () => setModule?.(null);
  }, [sectionAttemptId, setModule]);
  return null;
}
