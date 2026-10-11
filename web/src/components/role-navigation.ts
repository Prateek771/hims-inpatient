import type { StaffRole } from "@/server/contracts";

const navigation: Record<StaffRole, { label: string; href: string }[]> = {
  ADMIN: [
    { label: "Home", href: "/overview" },
    { label: "Beds", href: "/admin/beds" },
    { label: "Staff", href: "/admin/staff" },
    { label: "Assignments", href: "/admin/care" },
    { label: "Billing", href: "/billing" },
    { label: "Pharmacy", href: "/pharmacy" },
    { label: "Insurance", href: "/insurance" },
    { label: "Discharge", href: "/discharge" },
    { label: "Documents", href: "/documents" },
    { label: "Exceptions", href: "/exceptions" },
    { label: "Settings", href: "/admin/settings" },
  ],
  DOCTOR: [
    { label: "Patients", href: "/clinical" },
    { label: "Discharge", href: "/discharge" },
    { label: "Exceptions", href: "/exceptions" },
  ],
  NURSE: [
    { label: "My shift", href: "/nursing" },
    { label: "Discharge", href: "/discharge" },
    { label: "Exceptions", href: "/exceptions" },
  ],
  ADMISSION: [
    { label: "Admissions", href: "/admissions" },
    { label: "Insurance", href: "/insurance" },
    { label: "Exceptions", href: "/exceptions" },
  ],
  PHARMACY: [
    { label: "Medicines", href: "/pharmacy" },
    { label: "Discharge", href: "/discharge" },
    { label: "Exceptions", href: "/exceptions" },
  ],
  LAB: [
    { label: "Lab", href: "/lab" },
    { label: "Exceptions", href: "/exceptions" },
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
