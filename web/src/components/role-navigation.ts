import type { StaffRole } from "@/server/contracts";

const navigation: Record<StaffRole, { label: string; href: string }[]> = {
  ADMIN: [
    { label: "Patients & admissions", href: "/overview" },
    { label: "Beds", href: "/admin/beds" },
    { label: "Payments & insurance", href: "/billing" },
    { label: "Medicine bills & returns", href: "/pharmacy" },
    { label: "Discharge", href: "/discharge" },
    { label: "Staff & settings", href: "/admin/staff" },
  ],
  DOCTOR: [
    { label: "Retained records", href: "/history" },
  ],
  NURSE: [
    { label: "My patients", href: "/nursing" },
    { label: "Discharge", href: "/discharge" },
    { label: "Doctor availability", href: "/availability" },
    { label: "Exceptions", href: "/exceptions" },
  ],
  ADMISSION: [
    { label: "Admissions", href: "/admissions" },
    { label: "Doctor availability", href: "/availability" },
    { label: "Insurance", href: "/insurance" },
    { label: "Exceptions", href: "/exceptions" },
  ],
  PHARMACY: [
    { label: "Medicine bills & returns", href: "/pharmacy" },
    { label: "Discharge", href: "/discharge" },
    { label: "Exceptions", href: "/exceptions" },
  ],
  LAB: [
    { label: "Retained records", href: "/history" },
  ],
  INSURANCE: [
    { label: "Cases", href: "/insurance" },
    { label: "Exceptions", href: "/exceptions" },
  ],
  BILLING: [
    { label: "Billing", href: "/billing" },
    { label: "Insurance", href: "/insurance" },
    { label: "Discharge", href: "/discharge" },
    { label: "Documents", href: "/documents" },
    { label: "Exceptions", href: "/exceptions" },
  ],
};

export function roleNavigation(role: StaffRole) { return navigation[role]; }
export function roleHome(role: StaffRole) { return navigation[role][0].href; }
