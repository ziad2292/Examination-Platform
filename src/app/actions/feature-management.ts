"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createAdminClient, hasAdminConfig } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const uuid = z.guid();
const uuidList = z.array(uuid).max(500);

function selectedIds(formData: FormData) {
  return formData.getAll("studentId").map(String);
}

export async function saveExamAssignments(formData: FormData) {
  await requireRole("teacher");
  const examId = uuid.parse(String(formData.get("examId") ?? ""));
  const students = uuidList.parse(selectedIds(formData));
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_exam_student_assignments", {
    target_exam: examId,
    target_students: students,
  });
  if (error) redirect(`/teacher/exams/${examId}?error=assignment_failed`);
  revalidatePath(`/teacher/exams/${examId}`);
  revalidatePath("/student");
  redirect(`/teacher/exams/${examId}?notice=assignments_saved`);
}

export async function saveExamFeatureSettings(formData: FormData) {
  await requireRole("teacher");
  const examId = uuid.parse(String(formData.get("examId") ?? ""));
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_exam_feature_settings", {
    target_exam: examId,
    show_results: formData.get("showResults") === "on",
  });
  if (error) redirect(`/teacher/exams/${examId}?error=settings_failed`);
  revalidatePath(`/teacher/exams/${examId}`);
  redirect(`/teacher/exams/${examId}?notice=settings_saved`);
}

export async function saveSectionSettings(formData: FormData) {
  await requireRole("teacher");
  const examId = uuid.parse(String(formData.get("examId") ?? ""));
  const sectionId = uuid.parse(String(formData.get("sectionId") ?? ""));
  const minutes = z.coerce.number().int().min(1).max(240).parse(formData.get("durationMinutes"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_section_settings", {
    target_section: sectionId,
    new_duration_seconds: minutes * 60,
    new_allow_calculator: formData.get("allowCalculator") === "on",
  });
  if (error) redirect(`/teacher/exams/${examId}?error=section_settings_failed`);
  revalidatePath(`/teacher/exams/${examId}`);
  redirect(`/teacher/exams/${examId}?notice=section_settings_saved`);
}

export async function assignStudentsToTeacher(formData: FormData) {
  await requireRole("superadmin");
  const students = uuidList.parse(selectedIds(formData));
  const teacherId = uuid.parse(formData.get("teacherId"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("change_student_teacher_links", {
    students,
    teacher: teacherId,
    remove_link: formData.get("relationshipAction") === "remove",
  });
  if (error) redirect("/admin/students?notice=teacher_assignment_failed");
  revalidatePath("/admin");
  redirect("/admin/students?notice=teacher_assignment_saved");
}

async function deleteAuthUsers(ids: string[]) {
  const admin = createAdminClient();
  const failures: string[] = [];
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !error.message.toLowerCase().includes("not found")) failures.push(id);
  }
  return failures;
}

export async function bulkDeleteStudents(formData: FormData) {
  await requireRole("superadmin");
  if (!hasAdminConfig()) redirect("/admin?notice=admin_config_missing");
  const students = uuidList.min(1).parse(selectedIds(formData));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_delete_students", {
    target_students: students,
    confirmation_count: students.length,
  });
  if (error) redirect("/admin?notice=bulk_delete_failed");
  const failures = await deleteAuthUsers((data ?? []) as string[]);
  revalidatePath("/admin");
  redirect(`/admin?notice=${failures.length ? "bulk_delete_auth_cleanup" : "bulk_delete_saved"}`);
}

export async function factoryCleanup(formData: FormData) {
  const viewer = await requireRole("superadmin");
  if (!hasAdminConfig()) redirect("/admin?notice=admin_config_missing#danger-zone");
  const scope = z.enum(["exams", "students", "all"]).parse(formData.get("scope"));
  const confirmation = String(formData.get("confirmation") ?? "");
  const password = z.string().min(1).parse(formData.get("password"));
  const operationKey = uuid.parse(String(formData.get("operationKey") ?? ""));
  const supabase = await createClient();
  const verified = await supabase.auth.signInWithPassword({ email: viewer.email, password });
  if (verified.error) redirect("/admin?notice=reauth_failed#danger-zone");
  const { data, error } = await supabase.rpc("admin_factory_cleanup", {
    cleanup_scope: scope,
    confirmation,
    operation_key: operationKey,
  });
  if (error) redirect("/admin?notice=factory_cleanup_failed#danger-zone");
  const failures = await deleteAuthUsers((data ?? []) as string[]);
  revalidatePath("/", "layout");
  redirect(`/admin?notice=${failures.length ? "factory_auth_cleanup" : "factory_cleanup_saved"}#danger-zone`);
}
