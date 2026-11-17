import Image from "next/image";
import { LoginForm } from "@/components/account-controls";

const features = [
  { title: "Patient management", text: "Admission to discharge", icon: "M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Zm-3-9h2l1-2 2 4 1-2h1" },
  { title: "Billing & insurance", text: "Settlement and cover", icon: "M5 19V9m5 10V5m5 14v-7m5 7V8M3 19h18" },
  { title: "AI-assisted paperwork", text: "Staff stay in control", icon: "M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 7h10v10H7V7Zm3 3h4v4h-4v-4Z" },
  { title: "Secure access", text: "Role-based access", icon: "M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.500 7-10V6l-7-3Zm-3 9 2 2 4-4" },
];

/** Public landing and sign-in. The form comes first in the document so keyboard users reach it immediately. */
export default function LoginPage() {
  return (
    <div className="landing">
      <main className="landing-main">
        <section className="landing-copy" aria-labelledby="landing-headline">
          <h1 id="landing-headline">Smarter Healthcare<br />Starts With <span>Saavantus</span></h1>
          <p className="landing-lead">An AI-powered healthcare platform to streamline operations, enhance patient care and drive better clinical outcomes.</p>
          <ul className="landing-features">
            {features.map((feature) => (
              <li key={feature.title}>
                <span className="landing-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={feature.icon} /></svg>
                </span>
                <strong>{feature.title}</strong>
                <span>{feature.text}</span>
              </li>
            ))}
          </ul>
          <p className="landing-tagline">Innovating for a Healthier Tomorrow</p>
        </section>

        <div className="landing-doctor" aria-hidden="true">
          <Image src="/brand/doctor.jpg" alt="" width={372} height={705} priority unoptimized />
        </div>

        <section className="login-card" aria-labelledby="login-heading">
          <div className="login-card-brand">
            <Image src="/brand/saavantus-mark.png" alt="" width={76} height={68} unoptimized />
            <span>Saavantus<sup>®</sup></span>
          </div>
          <h2 id="login-heading">Healthcare Portal</h2>
          <p className="login-subtitle">Sign in to access your healthcare workspace</p>
          <LoginForm />
          <p className="login-help">Need access or a password reset? Contact your hospital administrator.</p>
        </section>
      </main>

      <header className="landing-header">
        <a className="landing-logo" href="https://www.saavantus.com" rel="noopener">
          <Image src="/brand/saavantus-mark.png" alt="" width={76} height={68} unoptimized />
          <span><strong>Saavantus<sup>®</sup></strong><small>AI | Automation | Digital Transformation</small></span>
        </a>
        <a className="landing-site" href="https://www.saavantus.com" rel="noopener">www.saavantus.com <span aria-hidden="true">→</span></a>
      </header>

      <footer className="landing-footer">
        <p>Demonstration environment · fictional patients and data only</p>
        <p className="landing-footer-tag">Better Insights. Better Care.</p>
      </footer>
    </div>
  );
}
