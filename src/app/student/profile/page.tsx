import Link from "next/link";
import { BookOpen, GraduationCap, UserRound, Users } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatAppDateTime } from "@/lib/date-time";

const panels = [
  { id: "personal", label: "Personal information", icon: UserRound },
  { id: "teachers", label: "My teachers", icon: Users },
  { id: "history", label: "Exam history", icon: BookOpen },
  { id: "grades", label: "Grades & performance", icon: GraduationCap },
];

type History = {
  id: string;
  title: string;
  started_at: string;
  status: string;
  raw_score: number | null;
  total_questions: number | null;
};

export default async function StudentProfile({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string }>;
}) {
  const viewer = await requireRole("student");
  const { panel } = await searchParams;
  const active = panels.find((item) => item.id === panel) ?? panels[0];
  const db = await createClient();
  const { data, error } =
    active.id === "teachers"
      ? await db.rpc("my_assigned_teachers")
      : active.id === "history" || active.id === "grades"
        ? await db.rpc("my_exam_history")
        : { data: null, error: null };
  if (error) throw new Error("Your profile section could not be loaded.");
  const history = (data ?? []) as History[];
  const entries =
    active.id === "grades"
      ? history.filter(
          (row) => row.raw_score !== null && row.total_questions !== null,
        )
      : history;
  return (
    <div>
      <p className="eyebrow">Student workspace</p>
      <h1 className="mt-2 font-bold">My profile</h1>
      <p className="mt-3 text-sm text-black/60">
        Your account, teachers, and assessment activity.
      </p>
      <nav aria-label="Profile sections" className="my-6 flex flex-wrap gap-2">
        {panels.map(({ id, label, icon: Icon }) => (
          <Link
            key={id}
            href={`/student/profile?panel=${id}`}
            aria-current={active.id === id ? "page" : undefined}
            className={active.id === id ? "btn-primary" : "btn-secondary"}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      <section
        className="card overflow-hidden"
        aria-labelledby="profile-section-title"
      >
        <div className="border-b border-black/10 p-5 sm:p-6">
          <h2 className="font-bold" id="profile-section-title">
            {active.label}
          </h2>
        </div>
        {active.id === "personal" && (
          <dl className="grid gap-5 p-5 sm:grid-cols-3 sm:p-6">
            {[
              ["Full name", viewer.full_name],
              ["Email", viewer.email],
              ["Account status", "Approved · Active"],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-sm text-black/55">{label}</dt>
                <dd className="mt-1 break-words font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {active.id === "teachers" &&
          ((data as { id: string; full_name: string }[] | null)?.length ? (
            <ul className="divide-y divide-black/10">
              {(data as { id: string; full_name: string }[]).map((teacher) => (
                <li key={teacher.id} className="flex items-center gap-3 p-5">
                  <Users size={18} className="text-brand" aria-hidden="true" />
                  <span>{teacher.full_name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-6 text-sm text-black/60">
              Your administrator hasn’t assigned a teacher yet.
            </p>
          ))}
        {(active.id === "history" || active.id === "grades") &&
          (entries.length ? (
            <ul className="divide-y divide-black/10">
              {entries.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-5"
                >
                  <div>
                    <Link
                      className="font-semibold text-brand hover:underline"
                      href={`/student/attempts/${row.id}`}
                    >
                      {row.title}
                    </Link>
                    <p className="mt-1 text-sm text-black/55">
                      {formatAppDateTime(row.started_at)}
                    </p>
                  </div>
                  {active.id === "grades" ? (
                    <span className="font-bold text-green-800">
                      {row.raw_score} / {row.total_questions}
                    </span>
                  ) : (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${row.status === "completed" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}
                    >
                      {row.status.replaceAll("_", " ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-6 text-sm text-black/60">
              {active.id === "grades"
                ? "No grades have been released to you yet."
                : "You haven’t started an assessment yet."}
            </p>
          ))}
      </section>
    </div>
  );
}
