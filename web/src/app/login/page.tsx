import { LoginForm } from "@/components/account-controls";
export default function LoginPage() {
  return (
    <main className="login">
      <p className="eyebrow">HIMS · Hospital staff</p>
      <h1>Staff sign in</h1>
      <p className="page-description">
        Use the account provided by your hospital administrator.
      </p>
      <section className="card">
        <LoginForm />
      </section>
      <p className="page-description">
        Need access or a password reset? Contact your hospital administrator.
      </p>
    </main>
  );
}
