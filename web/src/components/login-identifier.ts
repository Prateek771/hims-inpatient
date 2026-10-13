const demoRoles = ["admin", "admission", "doctor", "nurse", "pharmacy", "lab", "insurance", "billing"];

/** A convenience label for an existing demo identity, never a role grant. */
export function loginEmail(identifier: string) {
  const value = identifier.trim();
  const role = value.toLowerCase();
  return demoRoles.includes(role) ? `${role}@hims.test` : value;
}
