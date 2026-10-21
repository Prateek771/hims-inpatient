// Native finance/department content only. Shared helpers are prepended by the caller.
if (figma.fileKey !== 'IuHawGiBaoUkOQsz7gtrdK') throw Error('Wrong revision target');
let seq=S.phase==='support'?12:0;
async function view(role,key,title,sub,nav=key,action){const oldNav=roles.BILLING.nav;if(key==='FReceiptRecord'||key==='FReceiptSaved')roles.BILLING.nav=[['Cashier','FCashier'],['Final review','FFinalReady']];const s=await shell(role,key,title,sub,nav,seq,action);roles.BILLING.nav=oldNav;s.root.x=100+(seq%3)*1560;s.root.y=100+Math.floor(seq/3)*1360;seq++;return s;}
async function actions(parent,list){const r=await row(parent,'Available actions');for(const [label,target,kind]of list)button(r,label,target,kind||'Secondary');return r;}
const statementRows=[
 ['Gross confirmed charges','₹1,20,000','External source records + room stay'],
 ['Accepted medicine returns','− ₹5,000','Return RET-108-05 · Pharmacy 10:08'],
 ['Net bill','₹1,15,000','Room cutoff: factual vacancy 10:15'],
 ['Patient responsibility','₹25,000','₹10,000 co-pay + ₹15,000 non-payables'],
 ['Actual patient deposit received','₹30,000','Receipt DEP-108-01 · 07 Oct 10:00'],
 ['Allocated existing deposit','₹25,000','Allocation AL-108-01 · no new receipt'],
 ['Actual refund recorded','₹5,000','Refund RF-108-01 · receipt/evidence retained'],
 ['Patient amount still due','₹0','Patient settled; insurer receivable remains'],
 ['Verified insurer authorization','₹90,000','External approval AUTH-108-90'],
 ['Insurer receipts as of 10:20','₹0','Authorization is separate from cash'],
 ['Accepted insurer receivable','₹90,000','Insurance desk · follow up by 21 Oct']
];
const matrix=[
 ['Doctor','Approved','Dr Kavita Menon','10:00','Clinical source CL-108-v1'],
 ['Pharmacy','Cleared','Arjun Rao','10:08','Return + charge reconciliation v2'],
 ['Nursing','Ready','Priya Das','10:12','Readiness and handover v1'],
 ['Insurance','Check cleared','Sana Khan','10:11','AUTH-108-90 · evidence verified 09:50'],
 ['Lab','Cleared','Nikhil Sen','10:09','Report delivery reference LAB-108'],
 ['Radiology','Admin N/A','Prateek Yadav','10:06','No service or pending work; NA-108'],
 ['Billing','Authorized','Neha Gupta','10:25','Final financial snapshot FIN-108-v1']
];
if(S.phase!=='support'){
  {
    const s=await view('BILLING','FLookup','Find a patient episode','Use a permanent UHID or a stay-specific IP number. Confirm identity before opening money records.');
    const c=await card(s.body,'UHID / IP lookup',1172,'An identifier locates a record; access still follows the staff role.');
    const r=await row(c,'Typed search',1140);field(r,'UHID or IP number','MGH-00127',770);button(r,'Find patient','FStatement','Primary',330);
    await identity(s.body);await note(s.body,'One matching patient · current episode confirmed','Meera Shah · UHID MGH-00127 · IP-2026-00108 · admitted 07 Oct 2026, 10:00. This IP selects this stay, not all previous admissions.',1172,'Good');
    await table(s.body,'Current financial work',1172,['Patient / episode','Position','Next step'],[390,370,364],[['Meera · IP-2026-00108','Patient settled · insurer ₹90,000 pending','Final review / collection owner'],['Rohan · IP-2026-00111','Partial cover · patient share paid','Ordinary review if all checks current'],['Asha · IP-2026-00113','Denied cover · self-pay paid','Ordinary self-pay review'],['Leela · IP-2026-00115','₹8,000 unapproved patient shortfall','Ordinary blocked · Admin exception']]);
    await actions(s.body,[['View / print statement','FStatement','Primary'],['Open discharge review','FFinalPending'],['Charges and returns','FCharges'],['Record payments','FCashier']]);
  }
  {
    const s=await view('BILLING','FStatement','As-of financial statement','14 Oct 2026, 10:20 · printable statement for this episode; final authorization is a separate action.','FStatement',['View / Print','FPrintAsOf']);
    await identity(s.body);await metricRow(s.body,[['Net bill','₹1,15,000','₹1,20,000 less ₹5,000 returns'],['Actual cash retained','₹25,000','₹30,000 less ₹5,000 refund'],['Patient due','₹0','Existing deposit allocated once'],['Insurer receivable','₹90,000','Insurer receipt still ₹0']]);
    await note(s.body,'As-of statement · not exit authorization','Factual vacancy was recorded at 10:15. Charges are reconciled to that cutoff; the 10:25 financial authorization has not yet been issued in this snapshot. The bed is vacated but held.',1172,'Info');
    await table(s.body,'Explainable financial position',1172,['Line','INR','Reference / meaning'],[360,180,584],statementRows.slice(0,7));
    await actions(s.body,[['View full printable statement','FPrintAsOf','Primary'],['Source charges','FCharges'],['Receipt and refund evidence','FEvidence'],['Final review','FFinalPending']]);
  }
  {
    const s=await view('BILLING','FCharges','Patient charges and accepted returns','Staff confirm source records from existing department systems or paper. No live integration is assumed.','FCharges',['Record source entry','FChargeEntry']);
    await identity(s.body);await note(s.body,'Source-linked entries · history retained','Every entry has this IP, department, event time, source reference, actor and evidence. Duplicate references are rejected. Corrections use linked reversals or adjustments.',1172,'Info');
    await table(s.body,'Confirmed charge history',1172,['Source / department','Event time','Amount','Evidence / status'],[380,170,150,424],[['ROOM-108 · Room stay','07–14 Oct; cutoff 10:15','₹42,000','Exact occupied stay segments'],['MED-108 · Pharmacy','13 Oct 18:30','₹28,000','External medicine charge list'],['LAB-108 · Laboratory','13 Oct 09:15','₹15,000','Confirmed source service record'],['CARE-108 · Procedures / care','14 Oct 08:45','₹35,000','Staff-confirmed source charges'],['RET-108-05 · Pharmacy return','14 Oct 10:08','− ₹5,000','Accepted; linked to MED-108']]);
    await metricRow(s.body,[['Gross charges','₹1,20,000','Confirmed source events'],['Accepted returns','− ₹5,000','Do not prove a cash refund'],['Net bill','₹1,15,000','Deterministic reconciliation']]);
    await actions(s.body,[['Record charge / return','FChargeEntry','Primary'],['View source evidence','FEvidence'],['Review statement','FStatement']]);
  }
  {
    const s=await view('BILLING','FCashier','Cashier: deposit, allocation and refund','Record actual hospital-channel transactions. Applying a deposit to a bill does not create a second receipt.','FCashier');
    await identity(s.body);await metricRow(s.body,[['Deposit received','₹30,000','DEP-108-01 · actual receipt'],['Allocated deposit','₹25,000','Applied to patient responsibility'],['Refund recorded','₹5,000','RF-108-01 · actual transaction'],['Patient due','₹0','Patient responsibility settled']]);
    await table(s.body,'Cash and allocation history',1172,['Record','Time / user','INR','Evidence'],[350,270,140,364],[['Deposit receipt DEP-108-01','07 Oct 10:00 · Cashier','₹30,000','Hospital receipt book / UTR'],['Allocation AL-108-01','14 Oct 10:18 · Neha Gupta','₹25,000','Existing deposit applied once'],['Refund authority RF-AUTH-108','14 Oct 10:18 · Neha Gupta','₹5,000','Approved final settlement'],['Actual refund RF-108-01','14 Oct 10:20 · Cashier','₹5,000','Bank ref RF-20261014-108']]);
    await note(s.body,'Medicine returns and cash refunds are distinct','The accepted ₹5,000 return reduces the bill. The ₹5,000 refund has its own authorization and actual transaction evidence. Pharmacy cannot spend deposits or block medicines for insufficient cash.',1172,'Info');
    await actions(s.body,[['Review allocation / refund','FCashierConfirm','Primary'],['View receipt evidence','FEvidence'],['Financial review','FFinalReady']]);
  }
  {
    const s=await view('BILLING','FFinalPending','Final review: required items pending','Earlier snapshot · 14 Oct 2026, 10:10. Billing can prepare while departments work independently.','FFinalPending');
    await identity(s.body);await note(s.body,'Ordinary financial authorization is pending','Still needed at 10:10: Insurance discharge check (completed later at 10:11), assigned-nurse readiness and handover, factual bed vacancy and final room-charge reconciliation. Checks follow doctor approval in parallel. Accepted insurer receivable is not a cash-receipt blocker.',1172,'Warning');
    await table(s.body,'Current independent checks',1172,['Requirement','Status','Owner / next action'],[350,210,564],[['Doctor clinical approval','Approved · 10:00','Dr Kavita Menon · CL-108-v1'],['Pharmacy reconciliation','Cleared · 10:08','Arjun Rao · accepted returns reviewed'],['Nursing readiness / handover','Pending','Priya Das · finish own readiness check'],['Lab source/report delivery','Cleared · 10:09','Nikhil Sen · source reference retained'],['Actual vacancy / room cutoff','Bed still occupied','Assigned nurse records the real event'],['Financial snapshot','Provisional','Reconcile after factual vacancy']]);
    await metricRow(s.body,[['Provisional net bill','₹1,15,000','Review after actual vacancy'],['Verified insurer amount','₹90,000','Approval is not cash'],['Insurer cash received','₹0','Accepted AR may permit exit']]);
    await actions(s.body,[['View / print draft','FPrintAsOf'],['Review department checks','FDepartments'],['Nurse vacancy workflow','WVacancy'],['View ready example','FFinalReady','Primary']]);
  }
  {
    const s=await view('BILLING','FFinalReady','Final financial authorization','14 Oct 2026, 10:25 · required checks current, patient settled and insurer receivable accepted.','FFinalPending',['Review authorized packet','FPacket']);
    await identity(s.body);await metricRow(s.body,[['Final net bill','₹1,15,000','Actual vacancy cutoff 10:15'],['Patient responsibility','₹25,000','Settled · patient due ₹0'],['Insurer received','₹0','Verified authorization is not cash'],['Accepted receivable','₹90,000','Owner Sana Khan · due 21 Oct']]);
    await note(s.body,'Ordinary financial authorization · payer collection pending','Neha Gupta reviewed FIN-108-v1 at 10:25. Hospital acceptance of AUTH-108-90 covers ₹90,000 receivable. The patient is settled; the hospital still awaits ₹90,000 from the insurer. No exception is needed solely for that approved receivable.',1172,'Good');
    await table(s.body,'Required review facts',1172,['Fact','Current evidence / decision'],[360,764],[['Doctor + independent department checks','Current approvals; no other role signs for a department'],['Factual vacancy / handover','Priya Das · 10:15 · waiting lounge with attendant; bed held'],['Patient money','₹30,000 received − ₹5,000 refund = ₹25,000 retained'],['Insurer obligation','₹90,000 verified and hospital-accepted; ₹0 receipt at exit'],['Final authorization','Neha Gupta · 10:25 · FIN-108-v1; does not record actual exit']]);
    await actions(s.body,[['View authorized packet','FPacket','Primary'],['Review parallel checks','FDepartments'],['Partial / denied cases','FFinancialCases'],['Continue nurse exit','WAwaitFinance']]);
  }
  {
    const s=await view('BILLING','FPacket','Discharge case: documents and versions','Deliver current authorized papers before departure. Clinical papers keep their own approval and authorship.','FPacket',['View / Print packet','FPacketPrint']);
    await identity(s.body);await note(s.body,'Pre-exit authorized · 14 Oct 10:25','Packet PKT-108-PRE-v1 includes the final financial authorization and current independent checks. Patient settled; insurer receivable ₹90,000; actual insurer receipt ₹0. This issued snapshot is retained.',1172,'Good');
    await table(s.body,'Packet component documents',1172,['Component','Source / version','Delivery access'],[330,430,364],[['Identity and stay record','MGH-00127 / IP-2026-00108','Purpose-limited Nurse / Admin'],['Clinical summary / prescription','Dr Kavita Menon · CL-108-v1','Approved clinical source papers'],['Department statuses','Current checks · FIN-108-v1','Attributed department facts'],['Financial position + receipts/refund','₹1,15,000 net; ₹25,000 patient settled','Billing facts + receipt evidence'],['Insurer receivable evidence','AUTH-108-90 · ₹90,000 pending','Obligation and collection owner']]);
    await table(s.body,'Retained immutable versions',1172,['Version','Issued / status','Financial snapshot'],[330,390,404],[['ST-108-ASOF-v1','14 Oct 10:20 · As-of statement','No final exit authorization'],['PKT-108-PRE-v1','14 Oct 10:25 · Pre-exit authorized','Insurer cash ₹0; AR ₹90,000'],['PKT-108-CLOSED-v2','14 Oct 10:45 · Closed on actual exit','Original exit facts retained']]);
    await actions(s.body,[['View / print authorized packet','FPacketPrint','Primary'],['View source evidence','FEvidence'],['Clinical paper delivery','WAwaitFinance'],['Actual nurse exit','WActualExit']]);
  }
  {
    const s=await view('PHARMACY','FPharmacy','Pharmacy reconciliation and clearance','Confirm your own patient-linked charges, accepted returns and pending items against existing records.','FPharmacy',['Own reconciliation report','FPharmacyReport']);
    await identity(s.body,1172,true);await note(s.body,'Your department check · no pharmacy cash gate','Doctor approval was recorded at 10:00. Pharmacy reviews source records independently; it cannot issue the hospital financial authorization or stop medicine supply because deposits are low.',1172,'Info');
    await table(s.body,'External medicine reconciliation',1172,['Source / item','Reconciliation','INR','Evidence'],[330,280,150,364],[['MED-108 · medicine charges','Source records confirmed','₹28,000','Existing pharmacy list'],['RET-108-05 · unused medicines','Return accepted · 10:08','− ₹5,000','Linked source and acceptance'],['Net medicine charges','₹28,000 − ₹5,000','₹23,000','Reconciled against billing'],['Pending discrepancies','None in current snapshot','—','Arjun Rao · PH-108-v2']]);
    const c=await card(s.body,'Pharmacy-owned clearance',1172,'Arjun Rao · 14 Oct 10:08 · PH-108-v2');await badge(c,'Cleared · current evidence','Good',290);await tx(c,'Remarks: accepted returns and source charges reconciled. No pending medicine-charge discrepancy. A later relevant return reopens this check and dependent finance authorization; the doctor approval is retained.',1140);
    await actions(s.body,[['Print pharmacy report','FPharmacyReport','Primary'],['View source evidence','FEvidence'],['Department coordination','FDepartments']]);
  }
  {
    const s=await view('INSURANCE','FInsurance','Insurance authorization and claim documents','Staff record decisions verified outside HIMS. Keep cover, accepted credit and actual cash distinct.','FInsurance');
    await identity(s.body,1172,true);await metricRow(s.body,[['Verified authorization','₹90,000','AUTH-108-90 · external evidence'],['Patient responsibility','₹25,000','Co-pay and non-payables'],['Insurer cash received','₹0','No approval counted as a receipt']]);
    const c=await card(s.body,'Verified external payer decision',1172,'Stated payer decision: 13 Oct 16:00 · verified / recorded by Sana Khan: 14 Oct 09:50');
    const r=await row(c,'Authorization details',1140);field(r,'External decision / reference','Approved · AUTH-108-90',554);field(r,'Amount and evidence','₹90,000 · approval-letter-v1.pdf',554);
    await tx(c,'Discharge check: Sana Khan confirmed current cover and claim-document references at 10:11, after doctor approval. Hospital acceptance: Neha Gupta reviewed FIN-108-v1 at 10:25; ₹90,000 receivable, owner Sana Khan, due 21 Oct. Acceptance does not impersonate payer approval.',1140);
    await table(s.body,'Claim-document worklist',1172,['Required source','Status','Owner / reference'],[370,220,534],[['Verified authorization letter','Attached / verified','Sana Khan · AUTH-108-90'],['Signed clinical summary / prescription','Approved source retained','Dr Kavita Menon · CL-108-v1'],['Itemized bill / returns','Reconciled source','Neha Gupta · FIN-108-v1'],['Patient receipt / refund evidence','Attached','DEP-108-01 / RF-108-01'],['Collection follow-up','Staff review due 21 Oct','Sana Khan · manual log']]);
    await actions(s.body,[['Review evidence','FEvidence','Primary'],['Record verified decision','FInsuranceSaved'],['Collection follow-up','FCollections'],['Financial review','FFinalReady']]);
  }
  {
    const s=await view('INSURANCE','FCollections','Post-exit insurer collections','Closed episode · actual exit 14 Oct 10:45. A receivable remains collectible after patient exit.','FCollections',['Record actual payer receipt','FReceiptRecord']);
    await identity(s.body,1172,true);await metricRow(s.body,[['Patient due','₹0','Patient settlement retained'],['Accepted payer AR','₹90,000','AUTH-108-90 / FIN-108-v1'],['Payer receipts so far','₹0','At exit and current pending state']]);
    await note(s.body,'Closed admission · collection still pending','Sana Khan owns the ₹90,000 insurer receivable; follow-up due 21 Oct. Record actual received money with reference and evidence. Ordinary post-exit collection does not require an exception.',1172,'Warning');
    await table(s.body,'Manual collection follow-up',1172,['Time','Recorded work','Owner / next step'],[200,560,364],[['14 Oct 11:00','Retained approved receivable and claim evidence','Sana Khan · due 21 Oct'],['15 Oct 12:00 · later example','₹90,000 actual receipt can settle AR','Billing records bank reference'],['Issued document versions','Pre-exit and closed packets remain unchanged','New receipt record appended']]);
    await actions(s.body,[['Record payer receipt','FReceiptRecord','Primary'],['View settled example','FReceiptSaved'],['Retained exit packet','FPacketPrint'],['Authorization evidence','FEvidence']]);
  }
  {
    const s=await view('LAB','FDepartments','Department coordination: independent checks','Doctor approval opens parallel checks. Each participant records only their own department facts.','FDepartments');
    await identity(s.body,1172,true);await note(s.body,'Parallel checks · department ownership retained','Nursing coordinates readiness; Billing prepares concurrently. Final authorization waits for all required checks and factual room cutoff. This view is the department/Admin coordination snapshot.',1172,'Info');
    await table(s.body,'Current clearance matrix · 14 Oct 10:25',1172,['Department','State','User','Time','Remarks / reference'],[160,150,220,100,494],matrix);
    const c=await card(s.body,'Own department: Laboratory source delivery',1172,'Nikhil Sen · 14 Oct 10:09 · LAB-108');await tx(c,'Relevant source report references and delivery handover were confirmed. No pending report/service item in this episode. This is a coordination clearance, not native sample collection or diagnostic production.',1140);
    await actions(s.body,[['Confirm own department','FDepartmentSaved','Primary'],['Review optional applicability','FApplicability'],['Pharmacy own reconciliation','FPharmacy'],['Financial review','FFinalReady']]);
  }
  {
    const s=await view('ADMIN','FApplicability','Optional department applicability','Nursing proposes optional N/A; Admin decides with a reason and the source facts. Mandatory checks stay required.','RAdmin');
    await identity(s.body,1172,true);await note(s.body,'Doctor, Nursing and financial authorization cannot be N/A','N/A is an administrative applicability decision, not another profession’s clearance. Relevant new work reopens the decision and affected dependent approval.',1172,'Info');
    await table(s.body,'Applicable departments and pending work',1172,['Department','Relevant work','Current decision'],[280,540,304],[['Doctor','Clinical approval required','Required'],['Nursing readiness / exit','Patient readiness and actual exit','Required'],['Final finance','Settlement / accepted obligations','Required'],['Laboratory','LAB-108 source/report handover','Applicable · own check cleared'],['Radiology','No service, order or pending handover','Nurse proposal · Admin review']]);
    const c=await card(s.body,'Radiology N/A proposal',1172,'Priya Das proposed 14 Oct 10:03 · Admin-only decision');const r=await row(c,'Proposal and decision',1140);field(r,'Evidence reviewed','No radiology source service or pending item',554);field(r,'Admin reason','No relevant work for this IP; reconsider if added',554);
    await actions(s.body,[['Admin confirms N/A','FApplicabilitySaved','Primary'],['Check source evidence','FEvidence'],['View mandatory checks','FDepartments'],['Exception with unmet work','RExceptions']]);
  }
}
if(S.phase==='support'){
  {
    const s=await view('BILLING','FPrintAsOf','Print preview: as-of statement','ST-108-ASOF-v1 · 14 Oct 2026, 10:20 · patient identity and financial facts only.','FStatement');await identity(s.body);
    await note(s.body,'As-of statement · not an exit-authorized packet','The issued statement reflects this time only. Clinical papers may be delivered after doctor approval; ordinary exit needs current final authorization and nursing exit confirmation.',1172,'Info');
    await table(s.body,'Full financial statement',1172,['Line','INR','Source / explanation'],[350,170,604],statementRows);
    await actions(s.body,[['Back to statement','FStatement','Primary'],['View authorized packet','FPacketPrint']]);
  }
  {
    const s=await view('BILLING','FEvidence','Source evidence and document references','Fictional evidence preview · role access remains limited to the purpose of the current task.','FCharges');await identity(s.body,1172,true);
    await table(s.body,'Retained source evidence',1172,['Reference','Source / verified by','Retained version'],[330,480,314],[['AUTH-108-90','External approval letter · Sana Khan','approval-letter-v1.pdf'],['DEP-108-01','Actual deposit receipt · Cashier','₹30,000 receipt / UTR'],['RET-108-05','Accepted medicine return · Arjun Rao','return-note-v2.pdf'],['RF-108-01','Actual refund reference · Cashier','₹5,000 bank evidence'],['CL-108-v1','Doctor authoritative signed papers','Source author and version'],['LAB-108','Department report handover · Nikhil Sen','External report reference']]);
    await note(s.body,'Example evidence retained','Patient / IP, source author, verifier, stated event time and recording time remain attributable. These cards demonstrate protected evidence delivery; no real patient file is uploaded.',1172,'Info');
    await actions(s.body,[['Back to charges','FCharges','Primary'],['Insurance decision','FInsurance'],['Receipt history','FCashier'],['Discharge packet','FPacket']]);
  }
  {
    const s=await view('BILLING','FChargeEntry','Record an external charge or accepted return','Draft source entry for this IP. Reuse the original source reference and linked charge; never silently overwrite history.','FCharges');await identity(s.body);
    const c=await card(s.body,'Source entry review',1172,'Illustrative return draft; existing RET-108-05 is already accepted, so a repeat source is prevented.');
    const r=await row(c,'Source and linked charge',1140);field(r,'Entry type / department','Accepted return · Pharmacy',554);field(r,'Unique source reference','RET-108-05',554);
    const r2=await row(c,'Source amount',1140);field(r2,'Original source charge','MED-108 · ₹28,000',554);field(r2,'Accepted return / source time','₹5,000 · 14 Oct 10:08',554);field(c,'Evidence / acceptance reason','Return note v2 · unused medicines accepted by Arjun Rao',1140,true);
    await note(s.body,'Duplicate source entry blocked','RET-108-05 already exists for IP-2026-00108. Review the existing entry; a correction must use a linked adjustment with actor and reason.',1172,'Warning');
    await actions(s.body,[['View existing source entry','FCharges','Primary'],['View accepted-return evidence','FEvidence']]);
  }
  {
    const s=await view('BILLING','FCashierConfirm','Allocation and refund recorded','Existing deposit applied once; separate authorized refund evidence retained.','FCashier');await identity(s.body);await note(s.body,'Patient responsibility settled · insurer receivable remains','AL-108-01 allocates ₹25,000 from the ₹30,000 deposit. RF-108-01 records the actual ₹5,000 refund, authorized separately. Neither action creates another deposit receipt.',1172,'Good');
    await table(s.body,'Transaction confirmation',1172,['Fact','Recorded value'],[370,754],[['Deposit / actual receipt','₹30,000 · DEP-108-01 · 07 Oct 10:00'],['Allocation / existing deposit','₹25,000 · AL-108-01 · 14 Oct 10:18'],['Refund authority','₹5,000 · RF-AUTH-108 · Neha Gupta'],['Actual refund / evidence','₹5,000 · RF-108-01 · bank ref RF-20261014-108'],['Retained patient cash / due','₹25,000 retained · patient due ₹0'],['Insurer cash / receivable','₹0 received · ₹90,000 accepted AR']]);
    await actions(s.body,[['Back to cashier','FCashier','Primary'],['View evidence','FEvidence'],['Final financial review','FFinalReady']]);
  }
  {
    const s=await view('PHARMACY','FPharmacyReport','Print preview: pharmacy reconciliation','PH-108-v2 · Arjun Rao · 14 Oct 2026, 10:08. This department report is not the hospital exit packet.','FPharmacy');await identity(s.body,1172,true);
    await table(s.body,'Pharmacy-owned report',1172,['Record','Reconciled fact'],[370,754],[['External source medicine charges','MED-108 · ₹28,000'],['Accepted return','RET-108-05 · − ₹5,000 · linked source / acceptance'],['Net medicine charges','₹23,000'],['Pending source discrepancies','None at this snapshot'],['Own clearance','Arjun Rao · 14 Oct 10:08 · PH-108-v2'],['Printing scope','Pharmacy reconciliation only; no final hospital seal']]);
    await note(s.body,'Clinical instructions continue to control medicine supply','This report adds no stock, MAR or prescribing system and creates no cash gate. A later material charge/return change reopens the affected pharmacy review and dependent finance approval.',1172,'Info');
    await actions(s.body,[['Back to reconciliation','FPharmacy','Primary'],['View accepted return evidence','FEvidence']]);
  }
  {
    const s=await view('INSURANCE','FInsuranceSaved','Verified decision recorded','Recorded by Sana Khan; payer author and staff verifier remain separate.','FInsurance');await identity(s.body,1172,true);await note(s.body,'External authorization retained · no cash received','AUTH-108-90 verifies ₹90,000 coverage. Stated payer decision: 13 Oct 16:00; verified and recorded: 14 Oct 09:50. Hospital acceptance is separately recorded in FIN-108-v1 at 10:25.',1172,'Good');
    await table(s.body,'Decision and collection responsibility',1172,['Field','Current value'],[370,754],[['Verified payer amount','₹90,000 · approval-letter-v1.pdf'],['Actual insurer receipt','₹0 at ordinary exit'],['Patient responsibility / due','₹25,000 / ₹0 after cashier settlement'],['Accepted receivable','₹90,000 · accepted current evidence'],['Manual follow-up owner / date','Sana Khan · due 21 Oct; no automatic sender'],['Uncovered or changed amounts','Retain obligations; review affected financial authorization']]);
    await actions(s.body,[['Back to insurance','FInsurance','Primary'],['View receivable','FCollections'],['Review financial acceptance','FFinalReady']]);
  }
  {
    const s=await view('BILLING','FReceiptRecord','Record a post-exit payer receipt','Billing / Cashier records actual received money through the hospital’s existing channel; the closed IP remains collectible.','FCashier');await identity(s.body,1172,true);
    const c=await card(s.body,'Actual receipt evidence',1172,'Later example · 15 Oct 2026, 12:00. No exception is needed to collect this accepted receivable.');
    const r=await row(c,'Receipt amount and time',1140);field(r,'Amount actually received','₹90,000',554);field(r,'Actual bank receipt time','15 Oct 2026 · 12:00 IST',554);
    const r2=await row(c,'Reference and actor',1140);field(r2,'Bank / external transaction reference','UTR-20261015-108-90000',554);field(r2,'Recorded by / receipt reference','Neha Gupta · INS-RCPT-108-01',554);field(c,'Evidence / receivable allocation','Bank receipt evidence v1 · against AUTH-108-90 receivable',1140,true);
    await note(s.body,'Issued packet versions remain immutable','Append this receipt and update current AR. Pre-exit packet 10:25 and closed packet 10:45 keep the original insurer-receipt ₹0 snapshot; neither is rewritten.',1172,'Info');
    await actions(s.body,[['Review recorded receipt example','FReceiptSaved','Primary'],['Cancel to collections','FCollections']]);
  }
  {
    const s=await view('BILLING','FReceiptSaved','Post-exit receipt: receivable settled','Billing / Cashier · INS-RCPT-108-01 · actual bank receipt 15 Oct 2026, 12:00 · recorded by Neha Gupta.','FCashier');await identity(s.body,1172,true);await metricRow(s.body,[['Payer receipt recorded','₹90,000','UTR-20261015-108-90000'],['Current payer AR','₹0','Accepted receivable settled'],['Total cash after refund','₹1,15,000','₹90,000 + ₹30,000 − ₹5,000'],['Patient due','₹0','Original patient settlement retained']]);
    await note(s.body,'Current collections updated · old packets preserved','Neha Gupta recorded the receipt with bank evidence. PKT-108-PRE-v1 and PKT-108-CLOSED-v2 still show ₹0 insurer cash at exit and ₹90,000 receivable then. This receipt is a new attributable record.',1172,'Good');
    await table(s.body,'Append-only receipt and retained documents',1172,['Record','Time','Facts preserved'],[360,250,514],[['Pre-exit authorized packet','14 Oct 10:25','Insurer receipt ₹0 / AR ₹90,000'],['Closed packet','14 Oct 10:45','Actual exit / original financial snapshot'],['Actual insurer receipt','15 Oct 12:00','₹90,000 received / current AR ₹0'],['Any later correction','Separate attributable record','Linked reversal or adjustment; retain original']]);
    await actions(s.body,[['Return to collection worklist','FCollections','Primary'],['View original exit packet','FPacketPrint'],['View source authorization','FEvidence']]);
  }
  {
    const s=await view('LAB','FDepartmentSaved','Own department clearance recorded','Nikhil Sen · 14 Oct 10:09 · Laboratory source delivery confirmation.','FDepartments');await identity(s.body,1172,true);await note(s.body,'Laboratory coordination check cleared','LAB-108 report references and delivery handover are reconciled; no pending source report/service item in the current episode. This records only the Laboratory check.',1172,'Good');
    await table(s.body,'Attributable department confirmation',1172,['Field','Retained fact'],[370,754],[['Department / staff','Laboratory · Nikhil Sen'],['Source reference','LAB-108 · external report handover'],['Status / time','Cleared · 14 Oct 10:09'],['Remarks','Source report delivered; no unresolved service item'],['Change rule','New relevant report/service work reopens this check and dependent approvals']]);
    await actions(s.body,[['Back to department matrix','FDepartments','Primary'],['Optional applicability','FApplicability']]);
  }
  {
    const s=await view('ADMIN','FApplicabilitySaved','Admin confirmed optional N/A','NA-108 · Radiology only · reason and actual authority retained.','RAdmin');await identity(s.body,1172,true);await note(s.body,'Not applicable · Admin confirmed','Prateek Yadav confirmed at 10:06: no relevant radiology service or pending work exists for this IP. Priya Das proposed at 10:03. This is not a radiology professional clearance.',1172,'Good');
    await table(s.body,'Applicability decision and controls',1172,['Decision fact','Record'],[370,754],[['Optional department','Radiology'],['Nurse proposal','Priya Das · 14 Oct 10:03 · no relevant service/pending item'],['Admin confirmation','Prateek Yadav · 14 Oct 10:06 · NA-108'],['Recorded reason','No radiology source service or pending handover for this IP'],['Mandatory exclusions','Doctor, Nursing and final finance cannot be N/A'],['New relevant work','Reopen applicability and affected dependent approval']]);
    await actions(s.body,[['Back to applicability','FApplicability','Primary'],['View independent checks','FDepartments'],['Unmet-work exception','RExceptions']]);
  }
  {
    const s=await view('BILLING','FPacketPrint','Print preview: pre-exit authorized packet','PKT-108-PRE-v1 · issued 14 Oct 2026, 10:25 · immutable authorized snapshot.','FPacket');await identity(s.body);
    await note(s.body,'Ordinary authorized exit position · insurer money pending','Final authorization: Neha Gupta 10:25. Doctor approval: 10:00. Factual vacancy: 10:15; bed held. Patient due ₹0; accepted insurer receivable ₹90,000; insurer receipt ₹0. Actual exit is pending in this issued version; the nurse records it separately.',1172,'Good');
    await table(s.body,'Approved component papers and responsibilities',1172,['Component / amount','Retained source / fact'],[370,754],[['Clinical summary / prescription','Dr Kavita Menon · authoritative CL-108-v1'],['Department checks','Pharmacy 10:08 / Nursing 10:12 / Lab 10:09 / Insurance check 10:11'],['Net bill','₹1,20,000 gross − ₹5,000 accepted returns = ₹1,15,000'],['Patient money','₹30,000 actual deposit − ₹5,000 actual refund; ₹25,000 allocated'],['Insurer obligation','₹90,000 accepted receivable; ₹0 actual receipt at this snapshot'],['Collection owner / due','Sana Khan · 21 Oct · AUTH-108-90'],['Delivery authority','Purpose-limited Nurse / Admin; Pharmacy prints its own report only'],['Later closed / receipt record','Closed version on exit; later receipt appended without replacing this packet']]);
    await actions(s.body,[['Back to document versions','FPacket','Primary'],['Nurse actual exit','WActualExit'],['Later receipt example','FReceiptSaved']]);
  }
  {
    const s=await view('BILLING','FFinancialCases','Partial cover, denial and patient shortfall','Patient dues require settlement or a recorded exception. Insurer receivables require acceptable authorization or hospital-accepted credit.','FFinalPending');
    await table(s.body,'Financial route examples',1172,['Case','Current money / authority','Route'],[270,544,310],[['Meera · verified cover','₹25,000 patient settled; ₹90,000 accepted AR; insurer cash ₹0','Ordinary; collection pending'],['Partial verified cover','Remaining patient share fully settled; accepted payer AR retained','Ordinary if checks current'],['Denied payer cover','Staff-recorded self-pay conversion; full patient bill settled','Ordinary self-pay'],['Hospital-accepted insurer credit','Payer obligation evidenced and accepted; patient share settled','Ordinary; insurer AR retained'],['Unpaid / unapproved shortfall','Patient amount unpaid or no acceptable cover / credit evidence','Ordinary blocked; Admin exception'],['Missing mandatory evidence','Absent doctor / nursing / required current check','Ordinary blocked; actual exception status']]);
    await note(s.body,'An exception never fabricates approval or erases debt','Admin records the actual unmet requirement, authority, reason, evidence and follow-up owner. Partial cover or denial alone does not force an exception when patient responsibility is settled and payer obligations, if any, have acceptable authorization or hospital-accepted credit.',1172,'Info');
    await actions(s.body,[['Back to final review','FFinalReady','Primary'],['Admin exceptions','RExceptions'],['Insurance decisions','FInsurance']]);
  }
}
const frames=[];const counts={};const images=[];const fonts=new Set();const nodes=[];
for(const [key,id]of Object.entries(F)){const root=await figma.getNodeByIdAsync(id);const all=[root,...root.findAll(()=>true)];nodes.push(...all.map(n=>n.id));for(const n of all){counts[n.type]=(counts[n.type]||0)+1;if('fills'in n&&Array.isArray(n.fills)&&n.fills.some(p=>p.type==='IMAGE'))images.push({id:n.id,name:n.name});if(n.type==='TEXT')for(const seg of n.getStyledTextSegments(['fontName']))fonts.add(seg.fontName.family);}frames.push({key,id,name:root.name,x:root.x,y:root.y,width:root.width,height:root.height});}
return {...result('finance'),createdNodeIds:[...new Set(nodes)],frameEvidence:frames,countsByType:counts,imageFilledNodes:images,fontFamilies:[...fonts],phase:S.phase||'principal'};
