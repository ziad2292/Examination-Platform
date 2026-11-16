import Link from "next/link";
import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { SiteHeader } from "@/components/site-header";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth";
import { roleHome } from "@/lib/auth-policy";

export default async function RegistrationStatus() {
  const viewer = await getViewer();
  if (viewer) redirect(roleHome(viewer.role));
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const { data: status } = user
    ? await db.rpc("my_registration_status")
    : { data: null };
  return (
    <>
      <SiteHeader />
      <main className="shell grid place-items-center py-16">
        <section className="card max-w-lg p-7 sm:p-9">
          <p className="eyebrow">Student registration</p>
          <h1 className="mt-3 text-2xl font-bold">
            {status === "rejected"
              ? "Registration declined"
              : "Awaiting Administrator Approval"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-black/60">
            {status === "rejected"
              ? "Contact your school administrator if you need help with access."
              : "If you just registered, check your email for a verification link. Once your email is verified and an administrator approves your request, sign in to open your student workspace."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="btn-primary" href="/login">
              Sign in
            </Link>
            {user && (
              <form action={signOut}>
                <PendingSubmitButton
                  className="btn-secondary"
                  pendingLabel="Signing out…"
                >
                  Sign out
                </PendingSubmitButton>
              </form>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
