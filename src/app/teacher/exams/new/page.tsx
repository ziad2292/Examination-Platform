import { CreateExamForm } from "@/components/create-exam-form";

export default function NewExam() {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">New exam</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Start with the schedule</h1>
      <p className="mt-2 text-black/55">
        Choose the window when students can begin this exam. Times use your current
        timezone.
      </p>
      <CreateExamForm />
    </div>
  );
}
