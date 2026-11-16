// Hand-verified tax math. Every expected value below was computed by
// hand from the pack figures; the working is in the comment above each
// case. Packs: new slabs 0/4L/8L/12L/16L/20L/24L at 0/5/10/15/20/25/30%,
// std deduction 75k, rebate up to 60k at taxable income up to 12L with
// marginal relief; old slabs 0/2.5L/5L/10L at 0/5/20/30%, std deduction
// 50k, rebate up to 12.5k at taxable income up to 5L; cess 4%.
// Surcharge: 10% above 50L, 15% above 1Cr, 25% above 2Cr, 37% above
// 5Cr, capped at 25% under the new regime.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareRegimes,
  computeGst,
  computeGstInterest,
  recommendItrForm,
  slabTax,
} from "../lib/tax.js";

const AY = "2026-27";

test("slab edges: new regime tax at each band top", () => {
  // 4L: all in the 0% band. 8L: 4L at 5% = 20,000. 12L: 20,000 + 4L
  // at 10% = 60,000. 24L: 20k + 40k + 60k + 80k + 100k = 300,000.
  const slabs = [
    [0, 0],
    [400000, 0.05],
    [800000, 0.1],
    [1200000, 0.15],
    [1600000, 0.2],
    [2000000, 0.25],
    [2400000, 0.3],
  ];
  assert.equal(slabTax(400000, slabs), 0);
  assert.equal(slabTax(800000, slabs), 20000);
  assert.equal(slabTax(1200000, slabs), 60000);
  assert.equal(slabTax(2400000, slabs), 300000);
});

test("rebate edge, new regime: taxable exactly 12L pays nil", () => {
  // Income 12L, not salaried. Slab tax 60,000, rebate 60,000, total 0.
  const r = compareRegimes({ ay: AY, income: 1200000, deductions: {}, salaried: false });
  assert.equal(r.new.taxable_income, 1200000);
  assert.equal(r.new.slab_tax, 60000);
  assert.equal(r.new.rebate, 60000);
  assert.equal(r.new.total, 0);
});

test("rebate edge, new regime: salary 12.75L pays nil after standard deduction", () => {
  // 12,75,000 less 75,000 standard deduction = 12,00,000 taxable.
  // Slab tax 60,000, rebate 60,000, total 0.
  const r = compareRegimes({ ay: AY, income: 1275000, deductions: {}, salaried: true });
  assert.equal(r.new.taxable_income, 1200000);
  assert.equal(r.new.total, 0);
});

test("marginal relief just above the new rebate limit", () => {
  // Income 12,10,000. Slab tax: 20,000 + 40,000 + 10,000 at 15% =
  // 61,500. Marginal relief caps pre-cess tax at the excess over 12L
  // = 10,000, so relief is 51,500. Cess 4% = 400. Total 10,400
  // (not 63,960).
  const r = compareRegimes({ ay: AY, income: 1210000, deductions: {}, salaried: false });
  assert.equal(r.new.slab_tax, 61500);
  assert.equal(r.new.rebate, 0);
  assert.equal(r.new.marginal_relief, 51500);
  assert.equal(r.new.cess, 400);
  assert.equal(r.new.total, 10400);
});

test("rebate edge, old regime: taxable exactly 5L pays nil", () => {
  // Salary 5,50,000 less 50,000 standard deduction = 5,00,000.
  // Slab tax: 2.5L at 5% = 12,500. Rebate 12,500. Total 0.
  const r = compareRegimes({ ay: AY, income: 550000, deductions: {}, salaried: true });
  assert.equal(r.old.taxable_income, 500000);
  assert.equal(r.old.slab_tax, 12500);
  assert.equal(r.old.rebate, 12500);
  assert.equal(r.old.total, 0);
});

test("just above the old rebate limit: no rebate, cess applies", () => {
  // Salary 6,00,000 less 50,000 = 5,50,000 taxable. Slab tax:
  // 12,500 + 50,000 at 20% = 22,500. No rebate. Cess 900. Total 23,400.
  const r = compareRegimes({ ay: AY, income: 600000, deductions: {}, salaried: true });
  assert.equal(r.old.taxable_income, 550000);
  assert.equal(r.old.slab_tax, 22500);
  assert.equal(r.old.rebate, 0);
  assert.equal(r.old.cess, 900);
  assert.equal(r.old.total, 23400);
});

test("cess 4% on a mid-range new regime income", () => {
  // Income 24L. Slab tax 300,000 (see slab edge case). No surcharge
  // below 50L. Cess 12,000. Total 312,000.
  const r = compareRegimes({ ay: AY, income: 2400000, deductions: {}, salaried: false });
  assert.equal(r.new.slab_tax, 300000);
  assert.equal(r.new.surcharge, 0);
  assert.equal(r.new.cess, 12000);
  assert.equal(r.new.total, 312000);
});

test("surcharge is excluded above 50L, new regime", () => {
  // Income 60L. Slab: 300,000 + 36L at 30% = 1,380,000. Surcharge
  // excluded (unverified brackets, no marginal relief modelled).
  // Cess 4% of 1,380,000 = 55,200. Total 1,435,200.
  const r = compareRegimes({ ay: AY, income: 6000000, deductions: {}, salaried: false });
  assert.equal(r.new.slab_tax, 1380000);
  assert.equal(r.new.surcharge, 0);
  assert.equal(r.new.cess, 55200);
  assert.equal(r.new.total, 1435200);
  assert.ok(r.assumptions.some((a) => a.includes("Surcharge excluded")), "assumptions state the exclusion");
});

test("surcharge is excluded at 6Cr, new regime", () => {
  // Income 6Cr. Slab: 300,000 + 576L at 30% = 17,580,000. Surcharge
  // excluded. Cess 4% = 703,200. Total 18,283,200.
  const r = compareRegimes({ ay: AY, income: 60000000, deductions: {}, salaried: false });
  assert.equal(r.new.slab_tax, 17580000);
  assert.equal(r.new.surcharge, 0);
  assert.equal(r.new.cess, 703200);
  assert.equal(r.new.total, 18283200);
});

test("surcharge is excluded at 6Cr, old regime", () => {
  // Income 6Cr, old slabs. Slab: 12,500 + 100,000 + 590L at 30% =
  // 17,812,500. Surcharge excluded. Cess 4% = 712,500. Total
  // 18,525,000.
  const r = compareRegimes({ ay: AY, income: 60000000, deductions: {}, salaried: false });
  assert.equal(r.old.slab_tax, 17812500);
  assert.equal(r.old.surcharge, 0);
  assert.equal(r.old.cess, 712500);
  assert.equal(r.old.total, 18525000);
});

test("deductions are capped at pack limits and ignored under the new regime", () => {
  // Salary 10L, claims 80C 2L (cap 1.5L), 80D 40k (cap 25k), other
  // 10k. Applied: 185,000. Old taxable: 10L - 50k - 185k = 765,000.
  // Slab: 12,500 + 265,000 at 20% = 65,500. Cess 2,620. Total 68,120.
  // New taxable: 10L - 75k = 925,000; slab 32,500; rebate wipes it.
  const r = compareRegimes({
    ay: AY,
    income: 1000000,
    deductions: { "80C": 200000, "80D_self_family": 40000, other: 10000 },
    salaried: true,
  });
  assert.equal(r.old.deductions_applied, 185000);
  assert.equal(r.old.total, 68120);
  assert.equal(r.new.deductions_applied, 0);
  assert.equal(r.new.total, 0);
  assert.equal(r.cheaper_by, "new");
});

test("old regime can win with large deductions", () => {
  // Salary 15L, deductions 80C 1.5L + NPS 50k + 80D 25k + home loan
  // interest 2L + other 3L = 725,000. Old taxable: 15L - 50k - 725k
  // = 725,000. Slab 57,500, cess 2,300, total 59,800. New taxable:
  // 14,25,000. Slab: 20,000 + 40,000 + 225,000 at 15% = 93,750.
  // Cess 3,750, total 97,500. Old wins by 37,700.
  const r = compareRegimes({
    ay: AY,
    income: 1500000,
    deductions: { "80C": 150000, "80CCD1B": 50000, "80D_self_family": 25000, home_loan_interest: 200000, other: 300000 },
    salaried: true,
  });
  assert.equal(r.old.total, 59800);
  assert.equal(r.new.total, 97500);
  assert.equal(r.cheaper_by, "old");
  assert.equal(r.cheaper_amount, 37700);
});

test("unknown assessment year returns null", () => {
  assert.equal(compareRegimes({ ay: "1999-00", income: 100000, deductions: {}, salaried: false }), null);
});

test("GST splits: intrastate halves, interstate is all IGST", () => {
  // 10,000 at 18%: tax 1,800. Intrastate: 900 + 900. Interstate:
  // IGST 1,800. Totals 11,800 in both cases.
  assert.deepEqual(computeGst({ taxable: 10000, rate: 18, interstate: false }), {
    cgst: 900, sgst: 900, igst: 0, total: 11800,
  });
  assert.deepEqual(computeGst({ taxable: 10000, rate: 18, interstate: true }), {
    cgst: 0, sgst: 0, igst: 1800, total: 11800,
  });
  // 10,000 at 5%: tax 500, split 250/250. At 40% interstate: 4,000.
  assert.deepEqual(computeGst({ taxable: 10000, rate: 5, interstate: false }), {
    cgst: 250, sgst: 250, igst: 0, total: 10500,
  });
  assert.deepEqual(computeGst({ taxable: 10000, rate: 40, interstate: true }), {
    cgst: 0, sgst: 0, igst: 4000, total: 14000,
  });
  // Zero rate and the 3% special rate.
  assert.deepEqual(computeGst({ taxable: 10000, rate: 0, interstate: false }), {
    cgst: 0, sgst: 0, igst: 0, total: 10000,
  });
  assert.deepEqual(computeGst({ taxable: 10000, rate: 3, interstate: false }), {
    cgst: 150, sgst: 150, igst: 0, total: 10300,
  });
});

test("GST rounding keeps CGST + SGST equal to the tax", () => {
  // 999 at 18%: tax 179.82, split 89.91 + 89.91, total 1,178.82.
  // 33 at 18%: tax 5.94, split 2.97 + 2.97, total 38.94.
  assert.deepEqual(computeGst({ taxable: 999, rate: 18, interstate: false }), {
    cgst: 89.91, sgst: 89.91, igst: 0, total: 1178.82,
  });
  assert.deepEqual(computeGst({ taxable: 33, rate: 18, interstate: false }), {
    cgst: 2.97, sgst: 2.97, igst: 0, total: 38.94,
  });
});

test("GST legacy rates need an explicit flag; unknown rates are rejected", () => {
  assert.throws(() => computeGst({ taxable: 10000, rate: 12, interstate: false }), (e) => e.code === "legacy_rate");
  assert.throws(() => computeGst({ taxable: 10000, rate: 28, interstate: true }), (e) => e.code === "legacy_rate");
  assert.deepEqual(computeGst({ taxable: 10000, rate: 12, interstate: false, allowLegacy: true }), {
    cgst: 600, sgst: 600, igst: 0, total: 11200,
  });
  assert.throws(() => computeGst({ taxable: 10000, rate: 7, interstate: false }), (e) => e.code === "unknown_rate");
});

test("GST interest estimator: 18% simple, days/365, net cash tax", () => {
  // 50,000 for 30 days: 50,000 x 0.18 x 30/365 = 739.73.
  // 100,000 for a full year: 18,000.
  assert.equal(computeGstInterest({ principal: 50000, days: 30 }), 739.73);
  assert.equal(computeGstInterest({ principal: 100000, days: 365 }), 18000);
  assert.equal(computeGstInterest({ principal: 0, days: 30 }), 0);
});

test("GST interest at 24% needs the section 50(3) flag", () => {
  assert.throws(
    () => computeGstInterest({ principal: 100000, days: 365, ratePa: 0.24 }),
    (e) => e.code === "section_50_3_required"
  );
  assert.equal(computeGstInterest({ principal: 100000, days: 365, ratePa: 0.24, section50_3: true }), 24000);
});

test("ITR form recommendations", () => {
  assert.equal(recommendItrForm({ resident: true, income_sources: ["salary"] }).form, "ITR-1");
  assert.equal(recommendItrForm({ income_sources: ["salary", "capital_gains"] }).form, "ITR-2");
  assert.equal(recommendItrForm({ business: true, presumptive: true }).form, "ITR-4");
  assert.equal(recommendItrForm({ business: true }).form, "ITR-3");
  assert.equal(recommendItrForm({ business: true, capital_gains: true }).form, "ITR-3");
  assert.equal(recommendItrForm({ foreign_assets: true }).form, "ITR-2");
  assert.equal(recommendItrForm({ foreign_assets: true, business: true }).form, "ITR-3");
  assert.equal(recommendItrForm({ is_director: true }).form, "ITR-2");
  assert.equal(recommendItrForm({ total_income: 6000000 }).form, "ITR-2");
  const r = recommendItrForm({});
  assert.ok(r.caveats.length > 0, "caveats are always present");
  assert.ok(r.caveats[0].toLowerCase().includes("verify"), "first caveat tells the user to verify");
});
