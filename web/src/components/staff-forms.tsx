"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
const roles = [
  "ADMIN",
  "ADMISSION",
  "DOCTOR",
  "NURSE",
  "PHARMACY",
  "LAB",
  "INSURANCE",
  "BILLING",
];
const labels: Record<string, string> = {
  ADMIN: "Hospital administrator",
  ADMISSION: "Admission desk",
  DOCTOR: "Doctor",
  NURSE: "Nursing",
  PHARMACY: "Pharmacy",
  LAB: "Lab",
  INSURANCE: "Insurance desk",
  BILLING: "Billing",
};
type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  disabled: boolean;
};
function RoleField({ value = "ADMISSION" }: { value?: string }) {
  return (
    <label>
      Staff role
      <select name="role" defaultValue={value}>
        {roles.map((r) => (
          <option key={r} value={r}>
            {labels[r]}
          </option>
        ))}
      </select>
    </label>
  );
}
export function StaffForms({ staff }: { staff: StaffRow[] }) {
  const [message, setMessage] = useState("");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>, row?: StaffRow) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    const body = {
      name: f.get("name"),
      role: f.get("role"),
      reason: f.get("reason"),
      ...(row
        ? {
            id: row.id,
            active: f.get("active") === "on",
            ...(f.get("password") ? { password: f.get("password") } : {}),
          }
        : { email: f.get("email"), password: f.get("password") }),
    };
    try {
      const response = await fetch("/api/admin/staff", {
        method: row ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      setMessage(response.ok ? "Staff account saved." : data.error);
      if (response.ok) {
        router.refresh();
        form.querySelector<HTMLInputElement>('input[name="password"]')!.value =
          "";
      }
    } catch {
      setMessage("Unable to save. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p role="status">{message}</p>
      <section className="card">
        <h2>Staff directory</h2>
        {staff.map((row) => (
          <details key={`${row.id}-${row.role}-${row.disabled}`}>
            <summary>
              {row.name} · {labels[row.role]} ·{" "}
              {row.disabled ? "Disabled" : "Active"}
            </summary>
            <p>{row.email}</p>
            <form className="fields" onSubmit={(e) => save(e, row)}>
              <label>
                Full name
                <input
                  name="name"
                  defaultValue={row.name}
                  required
                  minLength={2}
                  maxLength={100}
                />
              </label>
              <RoleField value={row.role} />
              <label className="checkbox">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={!row.disabled}
                />
                Account active
              </label>
              <label>
                Reset password (optional)
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                />
              </label>
              <label>
                Reason for change
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <p>
                Disabling, role changes and password resets sign out existing
                sessions.
              </p>
              <button className="button" disabled={busy}>
                Save staff changes
              </button>
            </form>
          </details>
        ))}
      </section>
      <section className="card">
        <h2>Create staff account</h2>
        <form className="fields" onSubmit={(e) => save(e)}>
          <label>
            Full name
            <input name="name" required minLength={2} maxLength={100} />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <RoleField />
          <label>
            Initial password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <label>
            Reason for creating account
            <input name="reason" required minLength={3} maxLength={500} />
          </label>
          <button className="button" disabled={busy}>
            Create account
          </button>
        </form>
      </section>
    </>
  );
}
