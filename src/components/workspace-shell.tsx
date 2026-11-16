"use client";

import Link from "next/link";
import { Brand } from "@/components/brand";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BookOpenCheck,
  ClipboardList,
  Presentation,
  UserPlus,
  UserCheck,
  Upload,
  ShieldCheck,
  Database,
  UserRound,
  LayoutDashboard,
  Menu,
  Users,
  LogOut,
  X,
} from "lucide-react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { signOut } from "@/app/actions/auth";
import type { Profile } from "@/lib/types";

export function WorkspaceShell({
  viewer,
  children,
  pendingApprovals = 0,
}: {
  viewer: Profile;
  children: React.ReactNode;
  pendingApprovals?: number;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const root = viewer.role === "superadmin" ? "/admin" : `/${viewer.role}`;
  const links: [string, string, typeof LayoutDashboard][] =
    viewer.role === "superadmin"
      ? [
          ["Workspace", root, LayoutDashboard],
          ["Students & assignments", "/admin/students", Users],
          ["Teachers & accounts", "/admin/accounts", Presentation],
          ["Assessments", "/admin/exams", ClipboardList],
          ["Pending approvals", "/admin/approvals", UserCheck],
          ["Create account", "/admin/create", UserPlus],
          ["Bulk import", "/admin/import", Upload],
          ["Integrity policy", "/admin/integrity", ShieldCheck],
          ["Data management", "/admin/data", Database],
        ]
      : viewer.role === "teacher"
        ? [
            ["Assessments", root, BookOpenCheck],
            ["My students", "/teacher/students", Users],
            ["Create assessment", "/teacher/exams/new", ClipboardList],
          ]
        : [["My assessments", root, BookOpenCheck], ["My profile", "/student/profile", UserRound]];
  if (viewer.role === "student" && path.includes("/attempts/"))
    return <main className="shell py-5">{children}</main>;
  return (
    <div className="workspace">
      <button
        className="mobile-menu icon-button"
        onClick={() => setOpen(!open)}
        aria-label="Toggle navigation"
        aria-expanded={open}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      {open && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`workspace-sidebar ${open ? "is-open" : ""}`}>
        <Brand />
        <p className="sidebar-caption">
          {viewer.role === "superadmin"
            ? "Administration"
            : viewer.role === "teacher"
              ? "Teaching workspace"
              : "Student workspace"}
        </p>
        <nav aria-label="Workspace navigation">
          {links.map(([label, href, Icon]) => {
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`sidebar-link ${path === href ? "active" : ""}`}
                aria-current={path === href ? "page" : undefined}
              >
                <Icon size={18} />
                {label}
                {href === "/admin/approvals" && pendingApprovals > 0 && <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-amber-900" aria-label={`${pendingApprovals} pending requests`}>{pendingApprovals}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-account">
          <span className="avatar">{viewer.full_name.slice(0, 1)}</span>
          <div>
            <b>{viewer.full_name}</b>
            <small>{viewer.role}</small>
          </div>
          <form action={signOut}>
            <PendingSubmitButton className="btn-secondary !min-h-9 !px-2" pendingLabel="Signing out…"><LogOut size={16} aria-hidden="true" /><span className="sr-only">Sign out</span></PendingSubmitButton>
          </form>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <span>
            Workspace <span className="text-black/25 mx-2">/</span>{" "}
            {links.find(([, href]) => href === path)?.[0] ??
              "Assessment management"}
          </span>
          <span className="text-xs text-black/40">
            Assessly · Make progress measurable
          </span>
        </header>
        <main className="workspace-content">{children}</main>
      </div>
    </div>
  );
}
