import { createExam } from "@/app/actions/exams";
import { ExamScheduleFields } from "@/components/exam-schedule-fields";

export default async function NewExam({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">New exam</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Start with the schedule</h1>
      <p className="mt-2 text-black/55">
        Choose the window when students can begin this exam. Times use your current
        timezone.
      </p>
      {error && (
        <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-red-700">
          We couldn’t create the exam. Check the details and try again.
        </p>
      )}
      <form action={createExam} className="stack-form card mt-8 p-6 sm:p-8">
        <label className="block">
          <span className="label">Exam title</span>
          <input className="field" name="title" required minLength={3} placeholder="SAT Mock 1" />
        </label>
        <label className="block">
          <span className="label">Description</span>
          <textarea
            className="field min-h-28"
            name="description"
            maxLength={2000}
            placeholder="Instructions and notes for students"
          />
        </label>
        <label className="block">
          <span className="label">Student instructions</span>
          <textarea
            className="field min-h-32"
            name="instructions"
            maxLength={10000}
            placeholder="Rules, materials, and what students should expect"
          />
        </label>
        <label className="block">
          <span className="label">
            Access code <span className="font-normal text-black/40">(optional)</span>
          </span>
          <input className="field uppercase" name="accessCode" maxLength={24} />
        </label>
        <ExamScheduleFields />
        <button className="btn-primary w-full" type="submit">
          Create and add sections
        </button>
      </form>
    </div>
  );
}
