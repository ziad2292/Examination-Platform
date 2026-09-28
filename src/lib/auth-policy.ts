import type { Role } from "./types";

export function roleHome(role: Role) {
  return role === "superadmin" ? "/admin" : role === "teacher" ? "/teacher" : "/student";
}

export function canAccessRole(viewerRole: Role | null, requiredRole: Role) {
  return viewerRole === requiredRole;
}
