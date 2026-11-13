"use client";

import { useState } from "react";
import { UserRoundCog } from "lucide-react";
import {
  assignStudentsToTeacher,
  bulkDeleteStudents,
} from "@/app/actions/feature-management";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";

type Student = {
  id: string;
  full_name: string;
  email: string;
  student_teachers: { teacher_id: string }[];
};
type Teacher = { id: string; full_name: string; is_active: boolean };

export function AdminStudentManager({
  students,
  teachers,
  configured,
}: {
  students: Student[];
  teachers: Teacher[];
  configured: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(1);
  const [teacherQuery, setTeacherQuery] = useState("");
  const matchingTeachers = teachers.filter((teacher) =>
    teacher.full_name.toLowerCase().includes(teacherQuery.trim().toLowerCase()),
  );
  const filtered = students.filter(
    (s) =>
      `${s.full_name} ${s.email}`.toLowerCase().includes(query.toLowerCase()) &&
      (!owner ||
        (owner === "unassigned"
          ? !s.student_teachers.length
          : s.student_teachers.some((link) => link.teacher_id === owner))),
  );
  const visible = filtered.slice((page - 1) * 20, page * 20);
  const allSelected =
    visible.length > 0 && visible.every((student) => selected.has(student.id));
  const hidden = [...selected].map((id) => (
    <input key={id} type="hidden" name="studentId" value={id} />
  ));
  return (
    <section className="card mt-8 overflow-hidden" id="student-management">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            <UserRoundCog size={19} className="text-brand" />
            Teacher assignments and bulk actions
          </h2>
          <p className="mt-1 text-sm text-black/60">
            Select students on this filtered page, then add or remove a teacher
            assignment or delete the selection.
          </p>
        </div>
        <span className="rounded-full bg-black/[.04] px-3 py-1 text-xs font-bold">
          {selected.size} selected
        </span>
      </div>
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
        <input
          className="field"
          aria-label="Search students"
          placeholder="Search name or email"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="field"
          aria-label="Filter by teacher"
          value={owner}
          onChange={(e) => {
            setOwner(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All teachers</option>
          <option value="unassigned">Unassigned students</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name}
            </option>
          ))}
        </select>
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-end gap-3 border-y border-black/10 bg-green-50/60 p-4">
          <form
            action={assignStudentsToTeacher}
            className="flex flex-1 flex-wrap items-end gap-3"
          >
            {hidden}
            <label className="min-w-40 flex-1">
              <span className="label">Search teachers</span>
              <input
                className="field"
                value={teacherQuery}
                onChange={(event) => setTeacherQuery(event.target.value)}
                placeholder="Filter by name"
              />
            </label>
            <label className="min-w-52 flex-1">
              <span className="label">Teacher</span>
              <select
                className="field"
                name="teacherId"
                aria-label="Teacher"
                required
              >
                <option value="">Choose teacher</option>
                {matchingTeachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.full_name}{teacher.is_active ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Assignment action</span>
              <select className="field" name="relationshipAction">
                <option value="add">Add teacher</option>
                <option value="remove">Remove teacher</option>
              </select>
            </label>
            <PendingSubmitButton
              className="btn-secondary"
              pendingLabel="Saving…"
            >
              Apply assignment
            </PendingSubmitButton>
          </form>
          <form action={bulkDeleteStudents}>
            {hidden}
            <ConfirmSubmitButton
              className="btn-danger min-h-11"
              label={`Delete ${selected.size} students`}
              pendingLabel="Deleting students…"
              requiredText={`DELETE ${selected.size} STUDENTS`}
              confirmation={`Permanently delete ${selected.size} selected student accounts, attempts, answers, and exam assignments. Teachers and administrators are never included.`}
              disabled={!configured}
            />
          </form>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-black/[.025] text-xs uppercase tracking-wide text-black/60">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all students on this page"
                  checked={allSelected}
                  onChange={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      visible.forEach((s) => {
                        if (allSelected) next.delete(s.id);
                        else next.add(s.id);
                      });
                      return next;
                    })
                  }
                />
              </th>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Assigned teachers</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((student) => (
              <tr className="border-t border-black/10" key={student.id}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${student.full_name}`}
                    checked={selected.has(student.id)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(student.id)) next.delete(student.id);
                        else next.add(student.id);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="px-4 py-3">
                  <b>{student.full_name}</b>
                  <span className="block text-xs text-black/60">
                    {student.email}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {(student.student_teachers
                    .map(
                      (link) =>
                        teachers.find(
                          (teacher) => teacher.id === link.teacher_id,
                        )?.full_name ?? "Former teacher",
                    )
                    .join(", ") ||
                    null) ?? <span className="text-amber-700">Unassigned</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <p className="p-8 text-center text-black/60">
            No students match the current filters.
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-black/10 p-4">
        <button
          className="btn-secondary"
          type="button"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span className="text-xs text-black/60">
          {filtered.length} matching · Page {page} of{" "}
          {Math.max(1, Math.ceil(filtered.length / 20))}
        </span>
        <button
          className="btn-secondary"
          type="button"
          disabled={page * 20 >= filtered.length}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
