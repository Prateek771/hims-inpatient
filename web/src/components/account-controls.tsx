"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { Staff } from "@/server/access";
import { loginEmail } from "./login-identifier";

export function LoginForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="fields"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        const data = new FormData(event.currentTarget);
        try {
          const response = await fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: loginEmail(String(data.get("email") ?? "")),
              password: data.get("password"),
            }),
          });
          if (response.ok) {
            router.replace("/workspace");
            router.refresh();
          } else
            setMessage(
              response.status === 429
                ? "Too many attempts. Please wait a minute."
                : "Unable to sign in. Check your details or contact your hospital administrator.",
            );
        } catch {
          setMessage("Unable to connect. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Email or role
        <input name="email" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button className="button" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p role="alert">{message}</p>
    </form>
  );
}

type Appearance = {
  accent: "teal" | "blue" | "purple";
  density: "comfortable" | "compact";
  motion: "subtle" | "none";
};
const defaultAppearance: Appearance = { accent: "teal", density: "comfortable", motion: "subtle" };
const sessionAppearance = new Map<string, string>();
const appearanceEvent = "hims-appearance";

function readAppearance(key: string) {
  try { return sessionAppearance.get(key) ?? localStorage.getItem(key) ?? ""; }
  catch { return sessionAppearance.get(key) ?? ""; }
}
function subscribeAppearance(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key) sessionAppearance.delete(event.key);
    else sessionAppearance.clear();
    callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(appearanceEvent, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(appearanceEvent, callback);
  };
}
function parseAppearance(raw: string): Appearance {
  try {
    const value = JSON.parse(raw);
    return {
      accent: ["teal", "blue", "purple"].includes(value?.accent) ? value.accent : defaultAppearance.accent,
      density: ["comfortable", "compact"].includes(value?.density) ? value.density : defaultAppearance.density,
      motion: ["subtle", "none"].includes(value?.motion) ? value.motion : defaultAppearance.motion,
    };
  } catch { return defaultAppearance; }
}

const roleNames: Record<Staff["role"], string> = {
  ADMIN: "Admin", ADMISSION: "Admission", DOCTOR: "Doctor", NURSE: "Nurse",
  PHARMACY: "Pharmacy", LAB: "Lab", INSURANCE: "Insurance", BILLING: "Billing",
};

export function AccountControls({ staff }: { staff: Staff }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const profile = useRef<HTMLDialogElement>(null);
  const customize = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const storageKey = `hims:appearance:${staff.id}`;
  const rawAppearance = useSyncExternalStore(
    subscribeAppearance,
    () => readAppearance(storageKey),
    () => "",
  );
  const appearance = parseAppearance(rawAppearance);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = appearance.accent;
    root.dataset.density = appearance.density;
    root.dataset.motion = appearance.motion;
    return () => {
      delete root.dataset.accent;
      delete root.dataset.density;
      delete root.dataset.motion;
    };
  }, [staff.id, appearance.accent, appearance.density, appearance.motion]);

  function updateAppearance(next: Appearance) {
    const raw = JSON.stringify(next);
    sessionAppearance.set(storageKey, raw);
    try {
      localStorage.setItem(storageKey, raw);
      setStorageMessage("Saved for your account on this browser.");
    } catch {
      setStorageMessage("Applied for this session. Browser storage is unavailable.");
    }
    window.dispatchEvent(new Event(appearanceEvent));
  }

  return (
    <div className="account-controls">
      <button type="button" className="button secondary account-trigger" aria-haspopup="dialog" onClick={() => customize.current?.showModal()}>Customize</button>
      <button type="button" className="button quiet account-trigger" aria-haspopup="dialog" aria-label={`Profile for ${staff.name}`} onClick={() => profile.current?.showModal()}>{staff.name} <span aria-hidden="true">▾</span></button>
      <dialog ref={profile} className="account-dialog" aria-labelledby="profile-heading" onClick={(event) => { if (event.target === event.currentTarget) profile.current?.close(); }}>
        <div className="account-dialog-content">
          <div className="account-heading"><h2 id="profile-heading">Profile</h2><button type="button" className="button quiet" onClick={() => profile.current?.close()}>Close</button></div>
          <p className="account-subtitle">{staff.name} · {roleNames[staff.role]}</p>
          <div className="fields account-identity">
            <label>Name · managed by hospital admin<input value={staff.name} readOnly /></label>
            <label>Role · managed by hospital admin<input value={roleNames[staff.role]} readOnly /></label>
            <label>Email<input type="email" value={staff.email} readOnly /></label>
          </div>
          <p className="caption">Staff ID: {staff.id}</p>
        <form
          className="fields"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const fields = new FormData(form);
            if (fields.get("newPassword") !== fields.get("confirmPassword")) {
              setMessage("New passwords must match.");
              return;
            }
            setBusy(true);
            setMessage("");
            try {
              const response = await fetch("/api/auth/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  currentPassword: fields.get("currentPassword"),
                  newPassword: fields.get("newPassword"),
                }),
              });
              setMessage(
                response.ok
                  ? "Password changed. Other sessions signed out."
                  : "Password could not be changed. Check your current password and use at least 12 characters.",
              );
              if (response.ok) form.reset();
            } catch {
              setMessage("Unable to connect. Please try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
          <div className="account-actions">
            <button className="button secondary" disabled={busy}>{busy ? "Working…" : "Change password"}</button>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setMessage("");
                try {
                  const response = await fetch("/api/auth/sign-out", {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
                  });
                  if (response.ok) {
                    profile.current?.close();
                    router.replace("/login");
                    router.refresh();
                  } else setMessage("Unable to sign out. Please try again.");
                } catch { setMessage("Unable to connect. Please try again."); }
                finally { setBusy(false); }
              }}
            >Logout</button>
          </div>
        </form>
          <p role="status">{message}</p>
        </div>
      </dialog>
      <dialog ref={customize} className="account-dialog" aria-labelledby="customize-heading" onClick={(event) => { if (event.target === event.currentTarget) customize.current?.close(); }}>
        <div className="account-dialog-content">
          <div className="account-heading"><h2 id="customize-heading">Customize my view</h2><button type="button" className="button quiet" onClick={() => customize.current?.close()}>Close</button></div>
          <p className="account-subtitle">{staff.name} · {roleNames[staff.role]}</p>
          <fieldset className="accent-options"><legend>Personal appearance</legend>{([
            ["teal", "Hospital teal"], ["blue", "Reporting blue"], ["purple", "Soft purple"],
          ] as const).map(([accent, label]) => <label key={accent} className="accent-option"><input type="radio" name="appearance-accent" value={accent} checked={appearance.accent === accent} onChange={() => updateAppearance({ ...appearance, accent })} /><span className={`accent-swatch accent-${accent}`} aria-hidden="true" /><span>{label}</span></label>)}</fieldset>
          <div className="fields">
            <label>Density<select value={appearance.density} onChange={(event) => updateAppearance({ ...appearance, density: event.target.value as Appearance["density"] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
            <label>Motion<select value={appearance.motion} onChange={(event) => updateAppearance({ ...appearance, motion: event.target.value as Appearance["motion"] })}><option value="subtle">Subtle · respect device preference</option><option value="none">None</option></select></label>
          </div>
          <div className="notice"><h3>Your view only</h3><p>Hospital rules, patient records and professional access remain controlled by their existing owners.</p></div>
          <p role="status">{storageMessage}</p>
          <button type="button" className="button account-done" onClick={() => customize.current?.close()}>Done</button>
        </div>
      </dialog>
    </div>
  );
}
