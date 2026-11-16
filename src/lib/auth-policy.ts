import type { Role } from "./types";

export function roleHome(role: Role) {
  return role === "superadmin" ? "/admin" : role === "teacher" ? "/teacher" : "/student";
}

export function canAccessRole(viewerRole: Role | null, requiredRole: Role) {
  return viewerRole === requiredRole;
}

export function safeReturnPath(value: string) {
  // Browsers normalize backslashes and strip controls when interpreting URLs.
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') ||
      [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return '/dashboard';
  }
  return value;
}
