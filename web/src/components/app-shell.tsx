import type { ReactNode } from "react";
import Link from "next/link";

const sections = [
  "Admissions & beds", "Doctor workspace", "Nursing workspace", "Pharmacy",
  "Lab worklist", "Charges & payments", "Insurance paperwork", "Discharge clearance",
  "Final documents", "Admin exceptions",
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="workspace">
        <aside className="sidebar">
          <div className="brand"><span className="monogram" aria-hidden="true">H</span><div><strong>HIMS</strong><span>Hospital workspace</span></div></div>
          <p className="sidebar-label">Inpatient workspace</p>
          <nav aria-label="Hospital sections">
            <Link className="nav-item active" href="/" aria-current="page">Hospital overview</Link>
            {sections.map((section) => <span className="nav-item" aria-disabled="true" key={section}>{section}</span>)}
          </nav>
          <p className="sidebar-note">Sections become available as the build progresses.</p>
        </aside>
        <div className="application">
          <header className="topbar"><span>Inpatient care workspace</span><span className="status">Development preview</span></header>
          <main id="main-content" tabIndex={-1}>{children}</main>
        </div>
      </div>
    </>
  );
}
