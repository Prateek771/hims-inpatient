import { requireAdmin, staffContext } from "@/server/access";
import { admissionWorkspace } from "@/server/admissions/commands";
import { AddBedForm, DisableBedForm } from "@/components/admission-forms";

export default async function BedInventoryPage() {
  const staff = await requireAdmin();
  const workspace = await admissionWorkspace(
    staffContext(staff, "bed-inventory-view"),
  );
  return (
    <>
      <p className="eyebrow">Hospital administration</p>
      <h1>Bed inventory</h1>
      <p className="page-description">
        Create physical beds using configured room categories. Reserved and
        occupied beds cannot be disabled.
      </p>
      <section className="card">
        <h2>Add physical bed</h2>
        {!workspace.categories.length && (
          <p>Configure an active room category in Hospital settings first.</p>
        )}
        <AddBedForm categories={workspace.categories} />
      </section>
      <section className="card">
        <h2>Physical beds</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Bed</th>
                <th>Category</th>
                <th>Availability</th>
                <th>Inventory action</th>
              </tr>
            </thead>
            <tbody>
              {workspace.beds.map((b) => (
                <tr key={b.id}>
                  <td>{b.label}</td>
                  <td>{b.category}</td>
                  <td>
                    {!b.active
                      ? "Disabled"
                      : b.admissionId
                        ? "Reserved / occupied"
                        : "Available"}
                  </td>
                  <td>
                    {b.active && !b.admissionId ? (
                      <DisableBedForm bedId={b.id} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!workspace.beds.length && <p>No physical beds configured.</p>}
        </div>
      </section>
    </>
  );
}
