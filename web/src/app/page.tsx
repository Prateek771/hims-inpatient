import { AppShell } from "@/components/app-shell";

const sections = [
  [
    "Admission & beds",
    "Admission desk",
    "Patient identity, admission code, destination and bed.",
  ],
  [
    "Clinical care",
    "Doctors, nurses, pharmacy & lab",
    "Rounds, shifts, treatment, medicines and tests.",
  ],
  [
    "Charges & insurance",
    "Billing & insurance staff",
    "Running charges, receipts and externally verified insurance records.",
  ],
  [
    "Discharge clearance",
    "Doctor, pharmacy, nursing & billing",
    "Four human reviews with clear ownership of pending work.",
  ],
  [
    "Final documents",
    "Discharge staff & admin",
    "Clinical summary, itemized statement and current clearance seals.",
  ],
];

export default function Home() {
  return (
    <AppShell>
      <p className="eyebrow">Hospital overview</p>
      <h1>A clear view of today</h1>
      <p className="page-description">
        See what needs attention, who owns it and where a patient is waiting.
      </p>
      <section className="notice" aria-labelledby="setup-heading">
        <h2 id="setup-heading">Workspace setup in progress</h2>
        <a className="button" href="/login">
          Staff sign in
        </a>
        <p>
          Staff sign in is available. Patient records and hospital workflows
          will be added in the next stages.
        </p>
      </section>
      <section className="card" aria-labelledby="sections-heading">
        <h2 id="sections-heading">
          One patient journey, clear team responsibilities
        </h2>
        <ul className="section-list">
          {sections.map(([title, owner, description]) => (
            <li key={title}>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <span className="owner">{owner}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card" aria-labelledby="design-heading">
        <h2 id="design-heading">Approved hospital workspace design</h2>
        <p>
          Review the agreed role screens and patient journey while the working
          sections are built.
        </p>
        <a
          className="button"
          href="https://www.figma.com/proto/I4LQwHYp5IKZq0JQPZyM7X/HIMS-Inpatient-Prototype?node-id=4-2&starting-point-node-id=4%3A2"
        >
          Review approved prototype
        </a>
      </section>
    </AppShell>
  );
}
