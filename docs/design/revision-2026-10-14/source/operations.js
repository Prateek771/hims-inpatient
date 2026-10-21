
let v=await shell('ADMIN','RStart','Inpatient coordination','Choose a fictional role to explore the approved revision. This is a clickable design prototype.',null,0);
await note(v.body,'Separate Figma revision · approved scope','Original HIMS retained as an archive in this copy. Actual application and database are unchanged.');
await metricRow(v.body,[['Core purpose','Coordinate exit','Admissions, beds, money and responsibilities'],['Clinical records','Existing systems','Treatment, inventory and diagnostics stay external'],['Financial truth','Separate balances','Authorization ≠ cash; collection continues after exit']]);
const rr=await row(v.body,'Role workspace links');for(const [label,key]of [['Admin','RAdmin'],['Admission','WPatientSearch'],['Doctor','WDoctorApproval'],['Nurse','WChecklist']])button(rr,label,key,'Primary',281);
const rr2=await row(v.body,'Department role links');for(const [label,key]of [['Billing / Cashier','FLookup'],['Pharmacy','FPharmacy'],['Insurance','FInsurance'],['Other department','FDepartments']])button(rr2,label,key,'Secondary',281);
await note(v.body,'Who actually needs this?','Nurses coordinate readiness, factual vacancy, papers and exit. Doctors can approve digitally or use signed paper verified by the assigned nurse. Desk roles handle charges, authorization and collections.');
button(v.body,'Explore the one-week patient journey','RJourney','Primary',400);

v=await shell('ADMIN','RJourney','One stay, one coordinated journey','Meera Shah · 07–14 October 2026. All sample policy values are fictional.',null,1);await identity(v.body);
await table(v.body,'Patient journey · current evidence at every step',1172,['When','Responsible person','What follows'],[180,230,714],[
['07 Oct 10:00','Admission / Admin','Clinician instruction → suitable bed → ₹30,000 actual deposit → arrival / activation.'],
['Days 2–6','Hospital departments','Care in existing records. HIMS coordinates bed facts, charges / returns and insurance paperwork.'],
['14 Oct 10:00','Doctor / assigned nurse','Clinical approval → clinical papers may be delivered. Nurse publishes checklist.'],
['After approval','Pharmacy / Nursing / Insurance','Complete applicable checks in parallel. Billing prepares concurrently.'],
['10:15','Assigned nurse','Actual vacancy + discharge lounge handover → room-charge cutoff → Vacated but Held.'],
['10:25','Admin / Billing','Current checks + settled patient share + accepted authorization / credit → final financial authorization.'],
['10:45 → 11:05','Nurse → authorized bed staff','Deliver packet → actual exit → closed version → cleaning confirmation → Available.']
]);button(v.body,'View the financial example','FStatement','Primary',350);

v=await shell('ADMIN','RAdmin','Dashboard','Hospital operations by permission · facts and unresolved work, without a universal clinical seal.','RAdmin',2);
await metricRow(v.body,[['Active admissions','12','Fictional morning snapshot'],['Checks in progress','3','Separate department responsibilities'],['Patient exit pending','1','Meera: final financial review'],['Insurer receivable','₹90,000','Accepted payer responsibility; cash ₹0']]);
await table(v.body,'Actionable coordination queue',1172,['Patient / episode','Current state','Owner / next action'],[320,310,494],[
['Meera · IP-2026-00108','Vacated but Held · 10:15','Neha: authorize current final snapshot'],
['Arun · IP-2026-00109','Self-pay · checks pending','Priya: publish current checklist'],
['Sara · IP-2026-00110','Partial cover · patient settled','Sana: record verified authorization; ordinary exit can apply'],
['Dev · IP-2026-00111','Denied cover · settled self-pay','Neha: verify conversion and current checks; ordinary exit can apply']
]);const ar=await row(v.body,'Oversight actions');button(ar,'Open discharge review','FFinalPending','Primary',280);button(ar,'Review optional applicability','FApplicability','Secondary',330);button(ar,'Record controlled exception','RExceptions','Secondary',330);
await note(v.body,'Three distinct clocks','Clinical approval 10:00 · factual vacancy 10:15 · actual exit 10:45. Care continues under instructions and handover. Bed availability also needs turnover confirmation.');

v=await shell('ADMIN','RBeds','Beds and turnover','Ward > Room > Bed · physical suitability and factual status.','RBeds',3);
const br=await row(v.body,'Bed filters');field(br,'Ward','General Ward',378);field(br,'Room','G1',378);field(br,'Bed','G-12',384);
await table(v.body,'Bed register · 14 Oct 10:20 snapshot',1172,['Physical location','Suitability / tariff','Status / fact'],[320,370,434],[
['General > G1 > G-12','Non-AC · not ICU · no isolation requirement','Vacated but Held · Meera · factual vacancy 10:15'],
['General > G1 > G-13','Non-AC · tariff v3 · ₹2,000/day example','Available · verified turnover'],
['ICU > I1 > I-02','ICU capability · separate isolation review','Occupied · no forecast release'],
['Isolation > S1 > S-01','Isolation suitable · AC · tariff v3','Blocked · maintenance reason retained']
]);
await note(v.body,'G-12 becomes Available only after actual exit and turnover','10:45 actual exit; 11:05 authorized cleaning confirmation. Cleaning staff / authorized bed staff record evidence. Vacancy alone never releases the bed.',1172);
const ba=await row(v.body,'Bed actions');button(ba,'View nurse vacancy fact','WVacancy','Secondary',290);button(ba,'Record authorized turnover','RTurnover','Primary',330);button(ba,'Record actual transfer','RTransfer','Secondary',300);

v=await shell('ADMIN','RTurnover','Confirm bed turnover','Authorized bed staff record cleaning; nurse records patient exit separately.','RBeds',4);
await identity(v.body);await note(v.body,'Snapshot after actual exit','Nurse Priya recorded exit at 10:45. Bed G-12 is Cleaning. Finance authorization remains a separate historical event.');
field(v.body,'Cleaning completed at','14 Oct 2026 · 11:05 IST',550);field(v.body,'Recorded by / evidence','Ravi Patel · Bed operations · Cleaning log CL-081',550);field(v.body,'Turnover / safety checks','Completed · linen replaced · relevant restrictions cleared',1100);
button(v.body,'Confirm cleaning and make Available','RBedAvailable','Primary',450);
v=await shell('ADMIN','RBedAvailable','Bed available','Completed factual turnover · preserved admission and discharge history.','RBeds',5);
await note(v.body,'G-12 · Available','Actual vacancy 10:15 → actual exit 10:45 → cleaning completed 11:05. Confirmed by Ravi Patel / Bed operations.',1172,'Good');
await note(v.body,'Financial follow-up stays open','Meera admission is Closed; insurer receivable ₹90,000 remains assigned to Sana. Releasing the cleaned bed does not erase debt.');button(v.body,'Back to bed register','RBeds','Primary',330);

v=await shell('ADMIN','RStaff','Staff and permissions','Named accounts, assigned patients and explicit task permissions. Hospital size never grants clinical powers.','RStaff',6);
await table(v.body,'Authority matrix',1172,['Role / named staff','May record / approve','Must remain separate'],[270,450,404],[
['Aditi · Admission','Identity, reservation, acceptance and activation','No clinical seal or invented payment'],
['Dr Kavita · Doctor','Clinical instruction and discharge approval','Clinical authorizer even when on paper'],
['Priya · assigned Nurse','Paper verification, checklist, nursing, vacancy and exit','No prescription or financial authorization'],
['Neha · Billing / Cashier','Receipts, allocation, refund and final financial review','Allocation is not another receipt'],
['Sana · Insurance','Externally verified payer evidence and collection','Cannot approve coverage for insurer'],
['Arjun · Pharmacy / Nikhil · Department','Own charges, returns, clearance and own report','No hospital-wide seal or stock/diagnostic production']
]);await note(v.body,'Small hospital duty combination','Admin may explicitly assign Reception + Admission + Cashier tasks to a named staff member. Clinical approvals remain with the Doctor and nursing authority with the assigned Nurse.');
button(v.body,'View access audit','RAudit','Secondary',300);

v=await shell('ADMIN','RAudit','Access and change history','Authorized audit readers · login history is separate from attendance.','RStaff',7);
await table(v.body,'Fictional audit history',1172,['Time','Actor','Event / retained evidence'],[180,240,704],[['14 Oct 09:55','Priya · Nurse','Session login; does not prove shift attendance'],['10:02','Priya · Nurse','Verified signed Dr Kavita approval · source 10:00 · recorded 10:02 · v3'],['10:15','Priya · Nurse','Factual vacancy / waiting handover recorded'],['10:25','Neha · Billing','Final financial authorization snapshot v8'],['10:45','Priya · Nurse','Actual exit, packet delivered v8 → closed version v9']]);await note(v.body,'Corrections retain history','Clinical addenda and ledger reversals retain original actor, time, reason and linked versions. Session logout, expiry and revocation stay separately auditable.');button(v.body,'Back to staff permissions','RStaff','Secondary',330);

v=await shell('ADMIN','RExceptions','Controlled exceptions','Admin records authority, reason and follow-up. Exceptions never impersonate professional approvals or erase unpaid amounts.','RExceptions',8);
await table(v.body,'Ordinary versus exception',1172,['Situation','Route','Required follow-up'],[410,200,514],[['Accepted payer authorization, patient settled','Ordinary','Current checks, factual vacancy, final finance, papers, nurse exit'],['Partial cover, patient shortfall settled','Ordinary','Current responsibility and accepted authorization verified'],['Denied cover, settled self-pay conversion','Ordinary','Current self-pay settlement and checks'],['Unpaid patient shortfall / unacceptable credit','Exception','Authorized debt reason, responsible owner, amount and due date'],['Against advice / transfer / death / missing mandatory evidence','Exception','Actual disposition, authorized evidence and follow-up; no fabricated seals']]);
const er=await row(v.body,'Exception controls');field(er,'Authority / reason','Admin Prateek · EX-2026-014 · patient shortfall',560);field(er,'Obligation / owner / due','₹8,000 retained · Neha · 21 Oct',596);
button(v.body,'Review exception copy','RExceptionCopy','Danger',360);
v=await shell('ADMIN','RExceptionCopy','Exception packet preview','Clearly marked exception · distinct from ordinary exit authorization.','RExceptions',9);
await note(v.body,'EXCEPTION · Outstanding obligation ₹8,000','Fictional Arun case · IP-2026-00109. Authorized by Prateek. Patient shortfall retained; owner Neha; follow-up 21 Oct. Missing professional evidence remains explicitly missing.',1172,'Warning');
await table(v.body,'Packet status',1172,['Document','Recorded status','Ownership'],[350,340,434],[['Clinical evidence','Actual source only · never fabricated','Doctor authorizer / nurse verifier retained'],['Financial exception','EX-2026-014 · obligation ₹8,000','Admin authority, reason and follow-up'],['Actual disposition / exit','Nurse factual event, when recorded','No automatic exit from this preview']]);button(v.body,'Return to exception review','RExceptions','Secondary',360);

v=await shell('ADMIN','RSettings','Hospital operating policy','Fictional configuration preview. Production tariffs, credit limits and verification practices need hospital ownership.','RSettings',10);
await table(v.body,'Policy / owner',1172,['Control','Proposed setting','Owner / evidence'],[350,390,384],[['Required checks','Doctor + Nursing + final finance always required','Optional N/A Admin-confirmed with reason'],['Payer authorization / credit','Verified external decision + hospital acceptance','Amount, evidence, collection owner and due date'],['Admission deposit / room tariff','Illustrative ₹30,000 deposit · tariff v3','Admission/Admin activation after actual arrival'],['Departments','Pharmacy / Insurance / services applicable per episode','Nurse proposes; Admin confirms optional N/A'],['Document permissions','Clinical papers after Doctor; final packet after finance','Nurse/Admin delivery; Pharmacy own report'],['AI assistance','Paperwork drafts / missing-document suggestions','Human review; no clinical, coverage, money or autonomous sends']]);
button(v.body,'Review applicability decision','FApplicability','Primary',390);await note(v.body,'Legacy records remain retained','Detailed charts, MAR, inventory and diagnostic production leave active menus. Existing records and signed versions stay in the original and this copy’s archive; actual application is unchanged.');

v=await shell('ADMIN','RTransfer','Record actual bed transfer','Clinical instruction, actual movement and exact room-charge boundaries.','RBeds',11);await identity(v.body);
const tr=await row(v.body,'Transfer source and destination');field(tr,'From','General > G1 > G-12',550);field(tr,'To · suitability verified','General > G2 > G-21 · non-AC',606);
field(v.body,'Clinician instruction / source','Dr Kavita · TR-2026-044 · 10 Oct 2026 15:00',1100);field(v.body,'Actual transfer boundary / handover','10 Oct 15:20 IST · Nurse Priya → Nurse Isha',1100);
await note(v.body,'No duplicate room charge','Source occupancy ends and destination begins at the same factual boundary. Reservation creates no charge. Changed bed facts reopen affected charges and dependent financial approval.');
button(v.body,'View current charge statement','FStatement','Primary',380);
return result('ROOT');
