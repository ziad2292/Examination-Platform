import Link from "next/link";
import { StudentRegistrationForm } from "@/components/student-registration-form";
import { SiteHeader } from "@/components/site-header";

export default function Register() {
  return (
    <>
      <SiteHeader />
      <main className="shell grid flex-1 place-items-center py-14">
        <section className="card w-full max-w-md p-7 sm:p-9">
          <p className="eyebrow">Student registration</p>
          <h1 className="mt-2 text-3xl font-bold">Request an account</h1>
          <p className="mt-3 text-sm leading-6 text-black/60">
            Verify your email, then wait for an administrator to approve your
            access.
          </p>
          <StudentRegistrationForm />
          <Link
            href="/login"
            className="mt-5 inline-block text-sm font-semibold text-brand underline"
          >
            Back to sign in
          </Link>
        </section>
      </main>
    </>
  );
}
