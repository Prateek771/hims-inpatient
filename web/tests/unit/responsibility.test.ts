import { describe, expect, it } from "vitest";
import { computeResponsibilities } from "../../src/server/insurance/responsibility";
describe("staff verified responsibility arithmetic",()=>{
  const base={netBillPaise:11500000n,eligibleBillPaise:10000000n,coPayBps:1000,insurerAuthorizedPaise:9000000n};
  it("counts co-pay once and never turns authorization into cash",()=>{
    expect(computeResponsibilities(base)).toEqual({insurerPaise:9000000n,patientPaise:2500000n,unallocatedPaise:0n,coPayPaise:1000000n,nonPayablePaise:1500000n});
  });
  it("retains approval shortfalls until staff verify who owes them",()=>{
    expect(computeResponsibilities({...base,insurerAuthorizedPaise:5000000n})).toMatchObject({insurerPaise:5000000n,patientPaise:2500000n,unallocatedPaise:4000000n});
    expect(computeResponsibilities({...base,insurerAuthorizedPaise:5000000n,verifiedPatientLiabilityPaise:6500000n})).toMatchObject({patientPaise:6500000n,unallocatedPaise:0n});
    expect(computeResponsibilities({...base,insurerAuthorizedPaise:0n})).toMatchObject({insurerPaise:0n,unallocatedPaise:9000000n});
  });
  it("rounds half-up to paise, caps insurer and rejects inconsistent allocations",()=>{
    expect(computeResponsibilities({netBillPaise:5n,eligibleBillPaise:5n,coPayBps:1000,insurerAuthorizedPaise:100n})).toMatchObject({coPayPaise:1n,insurerPaise:4n});
    for(const change of [{eligibleBillPaise:12000000n},{coPayBps:10001},{netBillPaise:-1n},{verifiedPatientLiabilityPaise:2500001n},{verifiedPatientLiabilityPaise:2499999n}])expect(()=>computeResponsibilities({...base,...change})).toThrow();
  });
});
