"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
              email: data.get("email"),
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
        Email
        <input name="email" type="email" autoComplete="username" required />
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

export function AccountControls() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <section className="card">
      <h2>Your account</h2>
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const response = await fetch("/api/auth/sign-out", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (response.ok) {
              router.replace("/login");
              router.refresh();
            } else setMessage("Unable to sign out. Please try again.");
          } catch {
            setMessage("Unable to connect. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Sign out
      </button>
      <details>
        <summary>Change password</summary>
        <form
          className="fields"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            const form = event.currentTarget;
            const fields = new FormData(form);
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
          <button className="button" disabled={busy}>
            Change password
          </button>
        </form>
      </details>
      <p role="status">{message}</p>
    </section>
  );
}
