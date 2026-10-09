import { DomainError } from "../contracts";
import { paise } from "../billing/money";
export function computeResponsibilities(v:{netBillPaise:bigint;eligibleBillPaise:bigint;coPayBps:number;insurerAuthorizedPaise:bigint;verifiedPatientLiabilityPaise?:bigint}) {
  for(const n of [v.netBillPaise,v.eligibleBillPaise,v.insurerAuthorizedPaise,...(v.verifiedPatientLiabilityPaise===undefined?[]:[v.verifiedPatientLiabilityPaise])])paise(n.toString());
  if(v.eligibleBillPaise>v.netBillPaise||!Number.isInteger(v.coPayBps)||v.coPayBps<0||v.coPayBps>10000)throw new DomainError("VALIDATION","Invalid verified eligible bill or co-pay");
  const coPayPaise=(v.eligibleBillPaise*BigInt(v.coPayBps)+5000n)/10000n;
  const nonPayablePaise=v.netBillPaise-v.eligibleBillPaise;
  const eligibleInsurer=v.eligibleBillPaise-coPayPaise;
  const insurerPaise=v.insurerAuthorizedPaise<eligibleInsurer?v.insurerAuthorizedPaise:eligibleInsurer;
  const patientPaise=v.verifiedPatientLiabilityPaise??coPayPaise+nonPayablePaise;
  if(patientPaise<coPayPaise+nonPayablePaise||patientPaise+insurerPaise>v.netBillPaise)throw new DomainError("VALIDATION","Verified patient allocation is below the minimum or over-allocates the bill");
  return {insurerPaise,patientPaise,unallocatedPaise:v.netBillPaise-insurerPaise-patientPaise,coPayPaise,nonPayablePaise};
}
