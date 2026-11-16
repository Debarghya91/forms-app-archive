// Tax calculators. Every figure comes from the versioned JSON packs
// in shared/tax-rules; nothing here hardcodes a slab, rate, or due
// date. Packs are loaded once and cached; a missing pack is a 404 at
// the route layer, never a silent fallback to invented figures.
import fs from "fs";
import path from "path";
import { SHARED_DIR } from "./config.js";

const packCache = new Map();

function packPath(name) {
  return path.join(SHARED_DIR, "tax-rules", name + ".json");
}

export function loadPack(name) {
  if (packCache.has(name)) return packCache.get(name);
  const raw = fs.readFileSync(packPath(name), "utf8");
  const pack = JSON.parse(raw);
  packCache.set(name, pack);
  return pack;
}

export function clearPackCache() {
  packCache.clear();
}

// Normalize ":ay" values: "2026-27" or "ay-2026-27" -> the AY pack;
// "gst" and "due-dates" -> their packs. Returns null when unknown.
export function packNameForAy(ay) {
  if (typeof ay !== "string") return null;
  const v = ay.trim().toLowerCase();
  if (v === "gst" || v === "due-dates" || v === "due_dates") {
    return v === "due_dates" ? "due-dates" : v;
  }
  const year = v.replace(/^ay-/, "");
  if (/^\d{4}-\d{2}$/.test(year)) return "ay-" + year;
  return null;
}

export function getPack(ay) {
  const name = packNameForAy(ay);
  if (!name) return null;
  try {
    return loadPack(name);
  } catch {
    return null;
  }
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Progressive slab tax. Slabs are [[lowerBound, rate], ...] where each
// rate applies from its bound up to the next bound.
export function slabTax(taxable, slabs) {
  let tax = 0;
  for (let i = 0; i < slabs.length; i++) {
    const lower = slabs[i][0];
    const rate = slabs[i][1];
    const upper = i + 1 < slabs.length ? slabs[i + 1][0] : Infinity;
    const inBand = Math.max(0, Math.min(taxable, upper) - lower);
    tax += inBand * rate;
  }
  return tax;
}

export function surchargeRate(income, surcharge, cap) {
  let rate = 0;
  for (const band of surcharge || []) {
    if (income > band.above) rate = band.rate;
  }
  if (typeof cap === "number") rate = Math.min(rate, cap);
  return rate;
}

// One regime computation. Returns the full breakdown so callers and
// tests can check every step. Rebate: when taxable income is at or
// below the rebate limit, the rebate wipes out slab tax up to
// rebate_max. New-regime marginal relief: just above the rebate
// limit, pre-cess tax is capped at the excess over the limit.
export function computeRegimeTax({ regime, income, salaried, deductionTotal, pack }) {
  const gross = Math.max(0, income);
  const std = salaried ? regime.standard_deduction_salaried || 0 : 0;
  const deductions = Math.max(0, deductionTotal || 0);
  const taxable = Math.max(0, gross - std - deductions);
  const slabAmount = slabTax(taxable, regime.slabs);
  let tax = slabAmount;
  let rebate = 0;
  let marginalRelief = 0;
  if (taxable <= regime.rebate_limit) {
    rebate = Math.min(tax, regime.rebate_max);
    tax -= rebate;
  } else if (regime.marginal_relief) {
    const excess = taxable - regime.rebate_limit;
    if (tax > excess) {
      marginalRelief = tax - excess;
      tax = excess;
    }
  }
  // Surcharge is EXCLUDED from computed totals: the pack surcharge
  // brackets are unverified and surcharge marginal relief is not
  // modelled, so applying them would misstate totals near the
  // thresholds. The client and SEO calculators exclude surcharge
  // too; all three surfaces must agree. surchargeRate stays
  // exported for future use once brackets are verified and marginal
  // relief is modelled. The surcharge field stays 0 in the response.
  const surcharge = 0;
  const cess = round2(tax * regime.cess);
  const total = round2(tax + cess);
  return {
    taxable_income: round2(taxable),
    standard_deduction: std,
    deductions_applied: round2(deductions),
    slab_tax: round2(slabAmount),
    rebate: round2(rebate),
    marginal_relief: round2(marginalRelief),
    surcharge,
    cess,
    total,
  };
}

// Cap each claimed deduction at the pack cap. Unknown keys are kept
// under "other" only when the caller passes them as other; arbitrary
// keys are ignored so a typo cannot invent a deduction.
export function cappedDeductions(deductions, pack) {
  const caps = (pack.old_regime && pack.old_regime.deductions) || {};
  const input = deductions && typeof deductions === "object" ? deductions : {};
  const applied = {};
  let total = 0;
  for (const [key, cap] of Object.entries(caps)) {
    const claimed = Number(input[key]) || 0;
    const allowed = Math.max(0, Math.min(claimed, cap));
    if (allowed > 0) applied[key] = allowed;
    total += allowed;
  }
  const other = Number(input.other) || 0;
  if (other > 0) {
    applied.other = other;
    total += other;
  }
  return { applied, total };
}

export function compareRegimes({ ay, income, deductions, salaried }) {
  const pack = getPack(ay);
  if (!pack) return null;
  const capped = cappedDeductions(deductions, pack);
  const newRegime = {
    ...pack.new_regime,
    surcharge_cap: pack.surcharge_cap_new_regime,
  };
  const oldRegime = { ...pack.old_regime, surcharge_cap: undefined };
  const next = computeRegimeTax({
    regime: newRegime,
    income,
    salaried,
    deductionTotal: 0,
    pack,
  });
  const old = computeRegimeTax({
    regime: oldRegime,
    income,
    salaried,
    deductionTotal: capped.total,
    pack,
  });
  const cheaperBy = next.total < old.total ? "new" : old.total < next.total ? "old" : "equal";
  const assumptions = [
    "Resident individual under 60; senior citizen slabs are not modelled.",
    "New regime: only the standard deduction applies; Chapter VI-A deductions are ignored.",
    "Old regime: deductions capped at pack limits; HRA and home loan interest pass through only under 'other'.",
    "No special-rate income (capital gains).",
    "Surcharge excluded: pack surcharge brackets are unverified and surcharge marginal relief is not modelled. Totals above Rs 50 lakh understate tax; verify on the official portal.",
    "Pack verified flag is " + String(pack.verified) + "; verify on the official portal before filing.",
  ];
  return {
    new: next,
    old,
    cheaper_by: cheaperBy,
    cheaper_amount: round2(Math.abs(next.total - old.total)),
    assumptions,
    ay: pack.assessment_year,
  };
}

// GST split. The rate must be a current rate from the gst pack
// (0, 5, 18, 40, or the special 3% rate). Legacy rates (12, 28) are
// accepted only when allowLegacy is true, for invoices dated before
// 22 September 2025. Any other rate is rejected: GST rates are
// discrete, and silently computing at an invented rate would mislead.
export function computeGst({ taxable, rate, interstate, allowLegacy }) {
  const pack = loadPack("gst");
  const current = new Set([...(pack.rates || []), ...(pack.special_rates || []).map((r) => r.rate)]);
  const legacy = new Set(pack.legacy_rates || []);
  if (!current.has(rate) && !(allowLegacy && legacy.has(rate))) {
    const err = new Error(
      legacy.has(rate)
        ? "legacy rate requires explicit confirmation"
        : "unknown gst rate"
    );
    err.code = legacy.has(rate) ? "legacy_rate" : "unknown_rate";
    throw err;
  }
  const base = Math.max(0, taxable);
  const tax = round2((base * rate) / 100);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (interstate) {
    igst = tax;
  } else {
    cgst = round2(tax / 2);
    sgst = round2(tax - cgst);
  }
  return { cgst, sgst, igst, total: round2(base + tax) };
}

// Simple interest estimator: principal * rate * days / 365, on the
// net cash tax (tax paid in cash after input tax credit). The standard
// rate is 18% per annum. The 24% rate applies only when the notice
// states section 50(3): passing a rate above 18% without the
// section50_3 flag is rejected rather than silently computed.
export function computeGstInterest({ principal, days, ratePa, section50_3 }) {
  const pack = loadPack("gst");
  const rate = typeof ratePa === "number" ? ratePa : pack.interest_pa;
  if (rate > pack.interest_pa && !section50_3) {
    const err = new Error("24% interest applies only when the notice states section 50(3)");
    err.code = "section_50_3_required";
    throw err;
  }
  return round2(Math.max(0, principal) * rate * Math.max(0, days) / 365);
}

// ITR form recommendation. Rule-based, conservative: anything
// complex lands on ITR-3 or a verify caveat. Never a filing.
export function recommendItrForm(answers) {
  const a = answers && typeof answers === "object" ? answers : {};
  const caveats = [
    "This is a guide only, not a filing. Verify the form on the income tax portal before filing.",
  ];
  const truthy = (v) => v === true || v === "yes" || v === "true";
  const sources = Array.isArray(a.income_sources) ? a.income_sources.map(String) : [];
  const has = (...keys) => keys.some((k) => truthy(a[k]) || sources.includes(k));
  let form = "ITR-1";
  if (has("foreign_assets", "foreign_income", "foreign")) {
    form = has("business", "business_income") ? "ITR-3" : "ITR-2";
    caveats.push("Foreign assets or foreign income need the schedule for foreign assets; ITR-1 cannot be used.");
  } else if (has("director", "is_director", "unlisted_shares")) {
    form = has("business", "business_income") ? "ITR-3" : "ITR-2";
    caveats.push("Directorship or unlisted shares rule out ITR-1.");
  } else if (has("business", "business_income", "profession")) {
    if (truthy(a.presumptive) && !has("capital_gains")) {
      form = "ITR-4";
      caveats.push("ITR-4 applies only within the presumptive scheme limits; check turnover and eligibility on the portal.");
    } else {
      form = "ITR-3";
      if (has("capital_gains")) caveats.push("Business income with capital gains needs ITR-3.");
    }
  } else if (has("capital_gains", "more_than_one_house", "house_property_multiple")) {
    form = "ITR-2";
  } else if (Number(a.total_income) > 5000000) {
    form = "ITR-2";
    caveats.push("Total income above Rs 50 lakh rules out ITR-1.");
  }
  if (!truthy(a.resident) && a.resident !== undefined) {
    caveats.push("Non-resident rules differ; confirm the form and schedules on the portal.");
  }
  return { form, caveats };
}
