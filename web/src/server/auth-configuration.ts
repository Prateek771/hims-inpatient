/** Explicit origin keeps session cookies and CSRF checks bound to the intended host. */
export function authConfiguration() {
  try {
    const origin = new URL(process.env.BETTER_AUTH_URL ?? "");
    const secret = process.env.BETTER_AUTH_SECRET ?? "";
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback)) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || secret.trim().length < 32) throw new Error();
    return { baseURL: origin.origin, secret };
  } catch {
    throw new Error("Authentication configuration unavailable");
  }
}
