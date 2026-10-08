import { bootstrapAdmin } from "./bootstrap";
const demo = process.env.HIMS_BOOTSTRAP_DEMO === "true";
await bootstrapAdmin(
  {
    name: demo
      ? "Development administrator"
      : process.env.HIMS_BOOTSTRAP_ADMIN_NAME,
    email: demo ? "admin@hims.test" : process.env.HIMS_BOOTSTRAP_ADMIN_EMAIL,
    password: demo
      ? process.env.HIMS_DEMO_PASSWORD
      : process.env.HIMS_BOOTSTRAP_ADMIN_PASSWORD,
    role: "ADMIN",
    reason: demo
      ? "Owner authorized local development administrator initialization"
      : "Owner authorized first hospital administrator initialization",
  },
  demo,
);
console.log("Staff initialization completed");
process.exit(0);
