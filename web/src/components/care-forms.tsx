"use client";
import { useActionState, useState, type ReactNode } from "react";
export type CareState = { message: string; error?: boolean };
export type CareAction = (
  previous: CareState,
  form: FormData,
) => Promise<CareState>;
export function CareForm({
  action: fn,
  button,
  children,
  testId,
}: {
  action: CareAction;
  button: string;
  children: ReactNode;
  testId?: string;
}) {
  const [state, action, pending] = useActionState(fn, { message: "" });
  return (
    <form action={action} className="fields care-fields" data-testid={testId}>
      <p role="status" className={state.error ? "notice" : "caption"}>
        {state.message}
      </p>
      {children}
      <button className="button" disabled={pending}>
        {button}
      </button>
    </form>
  );
}
export function CareField({
  label,
  name,
  type = "text",
  required = true,
  defaultValue,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        step={
          step ??
          (type === "datetime-local"
            ? "0.001"
            : type === "number"
              ? "any"
              : undefined)
        }
      />
    </label>
  );
}
export function RoundForm({
  action,
  items,
  medicines,
}: {
  action: CareAction;
  items: { itemId: string; name: string; category: string; unit: string }[];
  medicines: { itemId: string; name: string; dispensingUnit: string }[];
}) {
  const [kind, setKind] = useState("NONE");
  const [purpose, setPurpose] = useState("WARD");
  const [chosen, setChosen] = useState("");
  const applicable =
    kind === "MEDICINE"
      ? medicines.map((m) => ({ ...m, unit: m.dispensingUnit }))
      : items.filter((i) => i.category === kind.toLowerCase());
  const selected = applicable.find((i) => i.itemId === chosen);
  return (
    <CareForm
      action={action}
      button="Sign round and orders"
      testId="round-form"
    >
      <label>
        Clinical assessment / notes
        <textarea name="notes" required maxLength={5000} />
      </label>
      <label>
        Consultation fee (optional)
        <select name="feeScheduleId">
          <option value="">No consultation fee requested</option>
          {items
            .filter((i) => i.category === "consultation")
            .map((i) => (
              <option value={`${i.itemId}|${i.unit}`} key={i.itemId}>
                {i.name} · {i.unit}
              </option>
            ))}
        </select>
      </label>
      <label>
        Ordered work
        <select
          name="kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setChosen("");
          }}
        >
          <option value="NONE">Round without a new order</option>
          {["MEDICINE", "LAB", "RADIOLOGY", "PROCEDURE", "DIET", "VITALS"].map(
            (k) => (
              <option key={k}>{k}</option>
            ),
          )}
        </select>
      </label>
      {kind !== "NONE" && (
        <>
          {selected && kind === "MEDICINE" ? (
            <>
              <input type="hidden" name="requestedItem" value={selected.name} />
              <p>Prescribed medicine: {selected.name}</p>
            </>
          ) : (
            <CareField
              name="requestedItem"
              label="Requested medicine / work / clinical instructions"
            />
          )}
          {["MEDICINE", "LAB", "RADIOLOGY", "PROCEDURE"].includes(kind) && (
            <>
              <label>
                Configured item (optional when unconfigured)
                <select
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  <option value="">Enter an item identity below</option>
                  {applicable.map((i) => (
                    <option value={i.itemId} key={i.itemId}>
                      {i.name} · {i.unit}
                    </option>
                  ))}
                </select>
              </label>
              {selected ? (
                <>
                  <input type="hidden" name="itemId" value={selected.itemId} />
                  <p className="caption">
                    Item identity: {selected.itemId} · configured unit:{" "}
                    {selected.unit}
                  </p>
                </>
              ) : (
                <CareField
                  label="Requested item code"
                  name="itemId"
                  required={kind !== "MEDICINE"}
                />
              )}
            </>
          )}
          {["LAB", "RADIOLOGY", "PROCEDURE"].includes(kind) && (
            <>
              <CareField
                label="Ordered quantity"
                name="quantity"
                defaultValue="1"
              />
              {selected ? (
                <>
                  <input type="hidden" name="unit" value={selected.unit} />
                  <p>Ordered unit: {selected.unit}</p>
                </>
              ) : (
                <CareField name="unit" label="Ordered billing unit" />
              )}
              <p className="caption">
                Unconfigured work remains recorded with an unresolved billing
                task. Tests remain pending until the laboratory completes them.
              </p>
            </>
          )}
          {kind === "MEDICINE" && (
            <>
              <CareField label="Prescribed dose" name="dose" />
              <CareField label="Prescribed dose unit" name="doseUnit" />
              <CareField label="Route" name="route" />
              <CareField label="Frequency instructions" name="frequency" />
              <CareField
                label="Duration (days)"
                name="durationDays"
                type="number"
                step="1"
              />
              <label>
                Medicine purpose
                <select
                  name="medicationPurpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                >
                  <option value="WARD">Ward administration only</option>
                  <option value="TAKE_HOME">Take-home only</option>
                  <option value="BOTH">Ward and take-home</option>
                </select>
              </label>
              {purpose !== "WARD" && (
                <>
                  <CareField
                    label="Prescribed dispensing quantity"
                    name="dispensingQuantity"
                  />
                  <CareField
                    label="Prescribed dispensing unit"
                    name="dispensingUnit"
                  />
                  <p className="caption">
                    Dose and dispensing units are separate. Enter the actual
                    prescribed stock quantity; no conversion is inferred.
                  </p>
                </>
              )}
            </>
          )}
          {(kind === "VITALS" ||
            (kind === "MEDICINE" && purpose !== "TAKE_HOME")) && (
            <>
              <h3>Explicit clinician schedule</h3>
              <CareField
                label="First scheduled occurrence (UTC)"
                name="startsAt"
                type="datetime-local"
              />
              <CareField
                label="Interval (minutes)"
                name="intervalMinutes"
                type="number"
                step="1"
              />
              <CareField
                label="Number of occurrences"
                name="occurrences"
                type="number"
                step="1"
              />
              <p className="caption">
                Enter clinical instructions. HIMS does not infer a ward or ICU
                protocol.
              </p>
            </>
          )}
        </>
      )}
    </CareForm>
  );
}
