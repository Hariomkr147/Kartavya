import type { Role } from "@/types/api";

export function roleHomePath(role: Role): string {
  switch (role) {
    case "CITIZEN":
      return "/citizen";
    case "OFFICER":
      return "/officer";
    case "ADMIN":
      return "/admin";
  }
}
