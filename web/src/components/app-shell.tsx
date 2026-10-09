"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { StaffRole } from "@/server/contracts";

const sections = [
  "Admissions & beds",
  "Doctor workspace",
  "Nursing workspace",
  "Pharmacy",
  "Lab worklist",
  "Charges & payments",
  "Insurance paperwork",
  "Discharge clearance",
  "Final documents",
  "Admin exceptions",
];

export function AppShell({
  children,
  role,
  hospitalName,
}: {
  children: ReactNode;
  role?: StaffRole;
  hospitalName?: string;
}) {
  const path = usePathname();
  const available =
    role === "ADMISSION"
      ? [{ label: "Admissions & beds", href: "/admissions" }]
      : role === "ADMIN"
        ? [
            { label: "Charges & payments", href: "/billing" },
            { label: "Bed inventory", href: "/admin/beds" },
            { label: "Hospital settings", href: "/admin/settings" },
            { label: "Manage staff", href: "/admin/staff" },
            { label: "Nursing assignments", href: "/admin/care" },
            { label: "Pharmacy", href: "/pharmacy" },
          ]
        : role === "BILLING" ? [{ label: "Charges & payments", href: "/billing" }] : role === "DOCTOR" ? [{ label: "Doctor workspace", href: "/clinical" }, { label: "Nursing records", href: "/nursing" }] : role === "NURSE" ? [{ label: "Nursing workspace", href: "/nursing" }] : role === "PHARMACY" ? [{label:"Pharmacy",href:"/pharmacy"}] : [];
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="workspace">
        <aside className="sidebar">
          <div className="brand">
            <span className="monogram" aria-hidden="true">
              H
            </span>
            <div>
              <strong>HIMS</strong>
              <span>{hospitalName ?? "Hospital workspace"}</span>
            </div>
          </div>
          <p className="sidebar-label">Inpatient workspace</p>
          <nav aria-label="Hospital sections">
            <Link
              className={`nav-item ${path === (role ? "/workspace" : "/") ? "active" : ""}`}
              href={role ? "/workspace" : "/"}
              aria-current={
                path === (role ? "/workspace" : "/") ? "page" : undefined
              }
            >
              {role ? "My workspace" : "Hospital overview"}
            </Link>
            {available.map((item) => (
              <Link
                className={`nav-item ${path === item.href ? "active" : ""}`}
                aria-current={path === item.href ? "page" : undefined}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
            {(role
              ? role === "ADMISSION"
                ? ["Insurance paperwork"]
                : []
              : sections
            ).map((section) => (
              <span className="nav-item" aria-disabled="true" key={section}>
                {section}
              </span>
            ))}
          </nav>
          <p className="sidebar-note">
            Sections become available as the build progresses.
          </p>
        </aside>
        <div className="application">
          <header className="topbar">
            <span>Inpatient care workspace</span>
            <span className="status">
              {role === "ADMISSION"
                ? "Admission desk"
                : (role ?? "Development preview")}
            </span>
          </header>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
