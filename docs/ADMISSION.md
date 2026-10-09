# Admission and physical beds

The admission desk registers a permanent patient identity (UHID), or selects an existing identity, and creates a separate IP code for each stay. Known date of birth or explicitly reported age is supported; an unavailable phone number does not require invented contact details. A shared family phone number does not merge patient identities.

An administrator configures room categories in hospital settings, then creates physical beds in the bed inventory. A reserved or occupied bed cannot be disabled. No beds, patients or financial policies are automatically seeded into the ordinary application.

Admission staff record the named clinician's assessment, admitting doctor, destination, override reason where needed, bed and payment route. Intake provenance identifies both the clinician whose assessment was recorded and the staff member recording it; this is not a clinician's electronic clearance seal. Insurance verification remains external and later insurance records are staff-entered.

Saving an episode creates a **PENDING** reservation. It does not start a room stay, room charging or satisfy a required deposit. Billing activation checks the actual occupancy time, current reservation and configured deposit before starting an **ADMITTED** tariff-pinned stay. [Admin exceptions](EXCEPTIONS.md) can authorize urgent activation while retaining the original deposit obligation. Urgent unknown identity stays explicitly temporary without invented age, date of birth or contact; later attributable identification adds a retained version. Cancelling a pending episode releases its reservation while preserving the UHID, IP code, actor, time and reason. Active admissions cannot be cancelled through this command.

## Access and history

Admission staff can read identity, contact, intake and payment-route fields. The recorded admitting doctor can read identity and clinical intake, without contact details. Administrators see operational identity, bed and status fields. Nursing and other departments use their documented current assignment/purpose scopes; see [care](CARE.md), [Pharmacy](PHARMACY.md), [Lab](LAB.md) and [Insurance](INSURANCE.md). Server commands recheck the current account, role and persisted episode; guessed IDs and client-supplied actor fields never authorize access.

Transactional counters, patient/bed locks, unique holds and actor/action/payload-bound retry keys protect IP uniqueness, one live episode per existing identity, exclusive bed reservations and rollback. Cancelled IP codes are retained. These protections do not establish multihospital tenancy or real-patient readiness.

Worklists retain every ongoing pending/active episode, followed by the latest 50 closed episodes. Closed history never pushes a live reservation out of view. Doctor worklists apply the recorded admitting-doctor scope to both ongoing and closed rows.

## Current limits

Activation, receipts and charges are described in [billing](BILLING.md); signed clinical/nursing corrections are described in [care](CARE.md), with acceptance recorded in the current build status. [Transfers](TRANSFERS.md), [human discharge](DISCHARGE.md) and [accountable exceptions](EXCEPTIONS.md), including urgent temporary identity, are implemented. Versioned final documents and paperwork assistance remain later tasks in the [build plan](superpowers/plans/2026-10-09-hims-inpatient.md). No external insurer or payment integration is included. Configure real hospital policy explicitly before real use; missing policy never means a free stay or waived deposit. See [staff access](STAFF_ACCESS.md), [database setup](DATABASE_SETUP.md) and the [approved design](DESIGN_REFERENCE.md).
