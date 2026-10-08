export function GET() {
  return Response.json(
    { status: "ok", service: "hims-inpatient" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
