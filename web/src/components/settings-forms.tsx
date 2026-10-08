"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatINR } from "@/server/billing/money";
type Version = {
  id: string;
  kind: string;
  version: number;
  payload: Record<string, unknown>;
  actorId: string;
  actorName: string;
  reason: string;
  createdAt: Date;
};
function Field({
  label,
  name,
  type = "text",
  value,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        step={type === "number" ? "0.01" : undefined}
        min={type === "number" ? 0 : undefined}
      />
    </label>
  );
}
function Choice({
  label,
  name,
  choices,
}: {
  label: string;
  name: string;
  choices: string[];
}) {
  return (
    <label>
      {label}
      <select name={name}>
        {choices.map((c) => (
          <option key={c} value={c}>
            {(
              {
                hour: "Per hour",
                "24-hours": "Per 24 hours",
                exact: "Exact elapsed time",
                "started-unit": "Each started billing unit",
                "self-pay": "Self-pay",
                insured: "Insured",
                required: "Deposit required",
                "not-required": "Deposit not required",
                "insurer-limit": "Approved insurer limit",
                "patient-deposit": "Patient deposit",
              } as Record<string, string>
            )[c] ?? c}
          </option>
        ))}
      </select>
    </label>
  );
}
export function SettingsForms({
  hospital,
  versions,
}: {
  hospital: {
    name: string;
    timezone: string;
    identity: Record<string, unknown>;
  } | null;
  versions: Version[];
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function save(e: React.FormEvent<HTMLFormElement>, type: string) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const value: Record<string, unknown> = { type };
    for (const [key, v] of f.entries()) {
      if (key !== "reason" && key !== "expectedVersion")
        value[key] = ["graceMinutes", "percent", "quantityScale"].includes(key) ? Number(v) : v;
    }
    if (["bed-category", "billable-item"].includes(type)) value.active = f.get("active") === "on";
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: Number(f.get("expectedVersion")),
          reason: f.get("reason"),
          value,
        }),
      });
      const data = await response.json();
      setMessage(
        response.ok
          ? "New settings version saved. Previous versions remain unchanged."
          : data.error,
      );
      if (response.ok) router.refresh();
    } catch {
      setMessage("Unable to save. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function section(title: string, type: string, fields: React.ReactNode) {
    return (
      <section className="card">
        <h2>{title}</h2>
        <form className="fields" onSubmit={(e) => save(e, type)}>
          <input
            type="hidden"
            name="expectedVersion"
            value={Math.max(
              0,
              ...versions
                .filter(
                  (v) => v.kind === (["tariff", "billable-item"].includes(type) ? "tariff" : "rule"),
                )
                .map((v) => v.version),
            )}
          />
          {fields}
          <Field label="Reason for change" name="reason" />
          <button className="button" disabled={busy}>
            Save new version
          </button>
        </form>
      </section>
    );
  }
  return (
    <>
      <p role="status">{message}</p>
      {!hospital && (
        <p className="notice">
          Hospital details and financial rules need configuration before
          inpatient charging can begin.
        </p>
      )}
      {section(
        "Hospital details",
        "hospital",
        <>
          <Field label="Hospital name" name="name" value={hospital?.name} />
          <Field
            label="Hospital address"
            name="address"
            value={String(hospital?.identity.address ?? "")}
          />
          <Field
            label="Timezone"
            name="timezone"
            value={hospital?.timezone ?? "Asia/Kolkata"}
          />
        </>,
      )}
      {section(
        "Bed categories",
        "bed-category",
        <>
          <Field label="Category code (e.g. ICU)" name="code" />
          <Field label="Category name" name="name" />
          <label className="checkbox">
            <input type="checkbox" name="active" defaultChecked />
            Category active
          </label>
        </>,
      )}
      {section(
        "Room tariff",
        "tariff",
        <>
          <Field label="Category code" name="category" />
          <Field
            label="Amount (INR per selected billing unit)"
            name="amount"
            type="number"
          />
          <Choice
            label="Billing unit"
            name="basis"
            choices={["hour", "24-hours"]}
          />
          <Choice
            label="Charge rounding"
            name="rounding"
            choices={["exact", "started-unit"]}
          />
          <Field
            label="Grace period (minutes)"
            name="graceMinutes"
            type="number"
            value="0"
          />
          <label>Grace behavior<select name="graceMode"><option value="deduct-once">Deduct grace once from the start of each stay</option></select></label>
          <p>Grace is subtracted once per half-open stay. Remaining elapsed time uses the selected exact or started-unit rounding; no recurring daily grace is assumed.</p>
          <p>An explicitly saved zero room tariff is supported; an absent tariff never implies free accommodation.</p>
        </>,
      )}
      {section(
        "Billable items and prices",
        "billable-item",
        <>
          <Field label="Stable item code" name="code" />
          <Field label="Item name" name="name" />
          <Choice label="Charge category" name="category" choices={["consultation", "procedure", "medicine", "consumable", "lab", "radiology"]} />
          <Choice label="Source department" name="department" choices={["DOCTOR", "PHARMACY", "NURSE", "LAB"]} />
          <Field label="Billing unit (e.g. session, test, tablet)" name="unit" />
          <Field label="Permitted quantity decimal places (0–6)" name="quantityScale" type="number" value="0" />
          <Field label="Unit price (INR)" name="amount" type="number" />
          <label className="checkbox"><input type="checkbox" name="active" defaultChecked />Item active</label>
          <p>Item code, category, source department and unit/scale stay fixed across price versions. Different units require another code; no automatic dose or stock conversions.</p>
          <p>Zero unit price is an explicit administrator policy version. Missing or inactive configuration still blocks posting.</p>
          <p>Doctor consultation/procedure → DOCTOR; medicine → PHARMACY; consumable → NURSE; lab/radiology → LAB. Missing/inactive prices block posting. Tax, bundled packages and doctor-specific fee mappings are not configured here.</p>
        </>,
      )}
      {section(
        "Initial deposit rule",
        "deposit",
        <>
          <Field label="Category code" name="category" />
          <Choice
            label="Payment route"
            name="route"
            choices={["self-pay", "insured"]}
          />
          <Choice
            label="Deposit requirement"
            name="requirement"
            choices={["required", "not-required"]}
          />
          <Field
            label="Fixed initial deposit (INR; zero when not required)"
            name="amount"
            type="number"
          />
          <p>
            Fixed amount rules only. Formula deposits need an approved daily
            reference rate before they can be configured.
          </p>
        </>,
      )}
      {section(
        "Staff follow-up alerts",
        "alert",
        <>
          <Choice
            label="Alert against"
            name="basis"
            choices={["insurer-limit", "patient-deposit"]}
          />
          <Field label="Threshold (%)" name="percent" type="number" />
          <p>
            Alerts request staff follow-up; they do not approve coverage or
            record payment.
          </p>
        </>,
      )}
      <section className="card">
        <h2>Settings version history</h2>
        {!versions.length ? (
          <p>No settings configured.</p>
        ) : (
          versions.map((v) => (
            <details key={v.id}>
              <summary>
                {(
                  {
                    hospital: "Hospital details",
                    "bed-category": "Bed category",
                    tariff: "Room tariff",
                    "billable-item": "Billable item price",
                    deposit: "Deposit rule",
                    alert: "Follow-up alert",
                  } as Record<string, string>
                )[String(v.payload.type)] ?? String(v.payload.type)}{" "}
                · version {v.version}
              </summary>
              <dl>
                {Object.entries(v.payload)
                  .filter(([k]) => k !== "type")
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {(
                          {
                            amount: "Amount (INR)",
                            code: "Category code",
                            category: "Category code",
                            name: "Name",
                            address: "Address",
                            timezone: "Timezone",
                            active: "Active",
                            basis: "Billing unit / alert basis",
                            rounding: "Rounding",
                            graceMinutes: "Grace period (minutes)",
                            graceMode: "Grace behavior",
                            quantityScale: "Permitted decimal places",
                            department: "Source department",
                            unit: "Billing unit",
                            route: "Payment route",
                            requirement: "Requirement",
                            percent: "Threshold (%)",
                          } as Record<string, string>
                        )[key] ?? key}
                      </dt>
                      <dd>
                        {key === "amount"
                          ? formatINR(BigInt(String(value)))
                          : String(value)}
                      </dd>
                    </div>
                  ))}
              </dl>
              <p>Reason: {v.reason}</p>
              <p>
                Staff: {v.actorName} ·{" "}
                {new Date(v.createdAt).toLocaleString(undefined, {
                  timeZone: hospital?.timezone ?? "Asia/Kolkata",
                })}
              </p>
            </details>
          ))
        )}
      </section>
    </>
  );
}
