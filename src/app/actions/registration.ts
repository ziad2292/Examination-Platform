"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { FormActionState } from "@/lib/form-state";

export async function registerStudent(_: FormActionState, form: FormData): Promise<FormActionState> {
  const input = z
    .object({
      name: z.string().trim().min(2).max(120),
      email: z.email().max(254),
      password: z.string().min(12).max(72),
    })
    .safeParse({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
    });
  if (!input.success) return { ok: false, message: "Check your name, email, and password." };
  const { name, email, password } = input.data;
  const db = await createClient();
  const { error } = await db.auth.signUp({
    email,
    password,
    options: { data: { assessly_registration: "student", full_name: name } },
  });
  if (error && error.code !== "user_already_exists")
    return { ok: false, message: "Registration could not be submitted. Try again shortly." };
  redirect("/registration-status");
}

export async function reviewRegistration(form: FormData) {
  await requireRole("superadmin");
  const input = z
    .object({ student: z.uuid(), decision: z.enum(["approve", "reject"]) })
    .parse({ student: form.get("student"), decision: form.get("decision") });
  const db = await createClient();
  const { error } = await db.rpc("review_student_registration", {
    student: input.student,
    approve: input.decision === "approve",
    note:
      input.decision === "reject"
        ? String(form.get("note") ?? "")
            .trim()
            .slice(0, 1000)
        : null,
  });
  redirect(
    error ? "/admin/approvals?notice=failed" : "/admin/approvals?notice=saved",
  );
}
