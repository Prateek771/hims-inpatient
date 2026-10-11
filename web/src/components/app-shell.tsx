"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { StaffRole } from "@/server/contracts";
import type { Staff } from "@/server/access";
import { AccountControls } from "./account-controls";
import { HospitalTimeProvider } from "./hospital-time-context";
import { roleHome, roleNavigation } from "./role-navigation";

export function AppShell({ children, role, staff, hospitalName, timezone = "Asia/Kolkata", asOf }: {
  children: ReactNode;
  role: StaffRole;
  staff: Staff;
  hospitalName?: string;
  timezone?: string;
  asOf: string;
}) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigation = roleNavigation(role);
  function isActive(href: string) {
    return path === href || path.startsWith(`${href}/`)
      || (role === "DOCTOR" && href === "/clinical" && path === "/nursing")
      || (role === "ADMISSION" && href === "/admissions" && path.startsWith("/patients/"))
      || (role === "ADMIN" && href === "/admin/beds" && path.startsWith("/patients/"));
  }

  return (
    <HospitalTimeProvider timezone={timezone}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="workspace">
        <aside className="sidebar">
          <div className="brand"><strong>HIMS</strong><span>{hospitalName ?? "Hospital workspace"}</span></div>
          <p className="sidebar-label">{role}</p>
          <button className="navigation-toggle button" type="button" aria-expanded={menuOpen} aria-controls="role-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? "Close menu" : "Open menu"}</button>
          <nav id="role-navigation" aria-label="Hospital sections" data-open={menuOpen}>
            {navigation.map((item) => (
              <Link className={`nav-item ${isActive(item.href) ? "active" : ""}`} aria-current={isActive(item.href) ? "page" : undefined} href={item.href} key={item.href} onClick={() => setMenuOpen(false)}>{item.label}</Link>
            ))}
          </nav>
          <div className="sidebar-footer"><p>{staff.name}</p><p className="sidebar-note">Need help? Contact your hospital administrator.</p></div>
        </aside>
        <div className="application">
          <header className="topbar">
            <Link className="topbar-context" href={roleHome(role)}>{role === "ADMIN" ? "Hospital operations" : `${navigation[0].label} · authorized worklist`}</Link>
            <time className="topbar-time" dateTime={asOf} title="Time this workspace was opened">{new Intl.DateTimeFormat("en-IN", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(asOf))}</time>
            <AccountControls key={staff.id} staff={staff} />
          </header>
          <main id="main-content" tabIndex={-1}>{children}</main>
        </div>
      </div>
    </HospitalTimeProvider>
  );
}
