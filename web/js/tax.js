// NMTax: versioned tax pack loader plus calculators.
// Calculators read ONLY the packs (fetched JSON, or the identical embedded
// fallback when fetch is unavailable, for example under file://). Nothing
// here hardcodes a slab, rate, or due date as permanent tax law; the
// embedded copies mirror web/rules/*.json and carry the same verified flag.
// Packs are unverified: every UI using them must show a verify note.
//
// PACK SYNC (W4b, 16 Nov 2026): web/rules/*.json are verbatim copies of
// shared/tax-rules/*.json (copied 16 Nov 2026, byte identical at copy
// time; the shared files were still being revised by a sibling worker
// that morning, so the coordinator should re-verify sameness at merge).
// The shared packs use a flatter schema than the original web-local
// packs (flat GST rates, schedule based due dates, and
// "marginal_relief" instead of "rebate_marginal_relief"), so the loader
// normalizes both shapes into the one shape the calculators already use.
// The normalizers below accept either shape, so older cached packs and
// the embedded fallbacks keep working. No computed value changed in this
// sync: slabs, standard deductions, rebate limits, cess, GST rates,
// the 18% interest input and the penalty estimator inputs are identical
// to the previous web-local packs. What changed is metadata and
// coverage: sources, surcharge brackets (listed in the pack, still
// excluded from the calculator as before), the GST special 3% rate,
// QRMP and TDS return rules, and the GST pack version number (2 in the
// old web-local file, 1 in the shared file). Due-date rule keys changed
// (for example adv_jun is now advance_tax_1), so done-marks saved under
// the old keys no longer match; affected tasks show as not done until
// ticked again. That is a consequence of the shared pack keys, not a
// loader choice.
(function () {
  "use strict";
  // Embedded mirrors of web/rules/*.json (shared pack sync, 16 Nov 2026).
  // Keep in sync when packs change. Injected from the shared JSON files.
  var FALLBACK_AY = {"assessment_year":"2026-27","basic_exemption":{"new_regime":400000,"old_senior_60_79":300000,"old_super_senior_80_plus":500000,"old_under_60":250000},"effective_from":"2026-04-01","financial_year":"2025-26","id":"ay-2026-27","new_regime":{"cess":0.04,"marginal_relief":true,"rebate_limit":1200000,"rebate_max":60000,"slabs":[[0,0],[400000,0.05],[800000,0.1],[1200000,0.15],[1600000,0.2],[2000000,0.25],[2400000,0.3]],"standard_deduction_salaried":75000},"notes":"Slabs, standard deductions, rebate limits and cess were checked against the secondary sources listed above on 2026-11-16 and match across them. They were NOT checked against the CBDT tax reference tables directly, so verified stays false. Surcharge brackets are the commonly published brackets and were not independently verified in this pass. Every UI using this pack must show a verify on the official portal note. The calculator covers resident individuals under 60 only. Senior citizen slabs, special-rate income (capital gains), and marginal relief above the surcharge thresholds are not modelled. New regime marginal relief just above the rebate limit IS modelled: pre-cess tax is capped at the amount by which taxable income exceeds the rebate limit. Home loan interest cap (Rs 200,000) is carried from the previous app values and was not independently verified in this pass.","old_regime":{"cess":0.04,"deductions":{"80C":150000,"80CCD1B":50000,"80D_parents":25000,"80D_parents_senior":50000,"80D_self_family":25000,"80D_self_family_senior":50000,"home_loan_interest":200000},"rebate_limit":500000,"rebate_max":12500,"slabs":[[0,0],[250000,0.05],[500000,0.2],[1000000,0.3]],"standard_deduction_salaried":50000},"sources":[{"accessed":"2026-11-16","publisher":"TaxGuru","title":"Section 202 vs Section 115BAC: New Tax Regime Under Income-tax Act, 2025","url":"https://taxguru.in/income-tax/section-202-section-115bac-tax-regime-income-tax-act-2025.html"},{"accessed":"2026-11-16","publisher":"Indian Pay Calculator","title":"Income Tax Slabs AY 2026-27 (FY 2025-26)","url":"https://www.indianpaycalculator.in/income-tax-slabs"},{"accessed":"2026-11-16","publisher":"BusinessMust","title":"New Tax Regime Slabs 2026-27: Rates, Rebate and Examples","url":"https://www.businessmust.com/new-tax-regime-slabs-2026-27/"},{"accessed":"2026-11-16","publisher":"Finance Tools Academy","title":"Income Tax Guide India FY 2025-26: Slabs and Deductions","url":"https://www.financetoolsacademy.com/learn/income-tax-guide.html"},{"accessed":"2026-11-16","publisher":"Dhanaay","title":"Income Tax Slabs FY 2026-27","url":"http://dhanaay.com/s/income-tax-slabs"}],"surcharge":[{"above":5000000,"rate":0.1},{"above":10000000,"rate":0.15},{"above":20000000,"rate":0.25},{"above":50000000,"rate":0.37}],"surcharge_cap_new_regime":0.25,"verified":false,"version":1};
  var FALLBACK_GST = {"council":"56th GST Council, 3 September 2025","effective_from":"2025-09-22","id":"gst","interest_basis":"Net cash tax: interest is charged on the tax paid in cash after input tax credit, not on the gross liability.","interest_note":"Simple interest at 18% per annum on the net cash tax, pro rated by days delayed divided by 365. The 24% rate applies only when the notice states section 50(3). Estimator only; verify on the GST portal.","interest_pa":0.18,"interest_pa_section_50_3":0.24,"legacy_note":"12% and 28% were withdrawn for most supplies from 22 September 2025. Use them only to verify invoices dated before that date, and only when explicitly requested.","legacy_rates":[12,28],"penalty_no_fraud":{"minimum":10000,"note":"Rough estimator input only, carried from the previous app values; not a demand computation. Verify on the official portal.","rate":0.1},"notes":"Current rates were checked against the secondary sources listed above on 2026-11-16. They agree: from 22 September 2025 the main GST rates are 5% (merit) and 18% (standard), with 40% for a short de-merit list and 0% for exempt supplies, under Notification 9/2025-Central Tax (Rate) following the 56th GST Council decisions. The 12% and 28% rates were withdrawn for most supplies and are kept here as legacy rates for invoices dated before 22 September 2025 only. The notification text itself was not read directly, so verified stays false. The rate for a specific supply depends on its HSN or SAC code and conditions: verify on the CBIC GST rate finder or the GST portal before billing.","notification":"Notification 9/2025-Central Tax (Rate), w.e.f. 22 September 2025","rates":[0,5,18,40],"rates_detail":[{"label":"Exempt / nil rated","rate":0,"status":"current"},{"label":"Merit rate","rate":5,"status":"current"},{"label":"Standard rate","rate":18,"status":"current"},{"label":"De-merit rate (short list: tobacco, pan masala, aerated drinks, luxury cars, yachts, betting and gaming)","rate":40,"status":"current"}],"sources":[{"accessed":"2026-11-16","publisher":"ZoolTools","title":"GST 2.0 Slabs Explained: What Changed in September 2025","url":"https://www.zooltools.com/guides/gst-slabs-explained"},{"accessed":"2026-11-16","publisher":"BookMyCA","title":"GST Rates 2026: 5%, 18% and 40% Slabs After GST 2.0","url":"https://www.bookmyca.in/services/gst/gst-rates-2026"},{"accessed":"2026-11-16","publisher":"FundRaksha","title":"GST Calculator: Add or Remove GST, CGST SGST IGST","url":"https://www.fundraksha.com/calculators/gst-calculator"},{"accessed":"2026-11-16","publisher":"AppSaaz","title":"GST 2.0: the 5%, 18% and 40% rates and what moved for online brands","url":"https://www.getsaaz.app/guides/gst-rates-2025-reform"}],"special_rates":[{"label":"Gold, silver and platinum","rate":3,"status":"current"}],"split":{"interstate":["igst"],"intrastate":["cgst","sgst"],"note":"Intrastate supplies split the tax equally between CGST and SGST. Interstate supplies charge the full tax as IGST."},"verified":false,"version":1};
  var FALLBACK_DUE = {"due_dates":[{"applicable_to":["salaried","freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"tds","frequency":"monthly","key":"tds_deposit","label":"TDS/TCS deposit","rule":"7th of following month","schedule":{"day":7,"kind":"monthly","offset_months":1}},{"applicable_to":["partnership","llp","private_limited","other"],"category":"payroll","frequency":"monthly","key":"pf_esi","label":"PF and ESI deposit","rule":"15th of following month","schedule":{"day":15,"kind":"monthly","offset_months":1}},{"applicable_to":["freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"gst","frequency":"monthly","key":"gstr1","label":"GSTR-1","rule":"11th of following month","schedule":{"day":11,"kind":"monthly","offset_months":1}},{"applicable_to":["freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"gst","frequency":"monthly","key":"gstr3b","label":"GSTR-3B","rule":"20th of following month","schedule":{"day":20,"kind":"monthly","offset_months":1}},{"applicable_to":["freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"gst","frequency":"quarterly","key":"gstr1_qrmp","label":"GSTR-1 (QRMP)","rule":"13th of month after the quarter","schedule":{"day":13,"kind":"quarter_end","offset_months":1}},{"applicable_to":["freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"gst","frequency":"quarterly","key":"gstr3b_qrmp","label":"GSTR-3B (QRMP)","rule":"22nd or 24th of month after the quarter, depending on state (22nd used here as the earlier date)","schedule":{"day":22,"kind":"quarter_end","offset_months":1}},{"applicable_to":["freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"gst","frequency":"yearly","key":"gstr9","label":"GSTR-9 annual return","note":"Annual return for the preceding financial year. Verify applicability and turnover threshold on the GST portal.","rule":"31 December following the financial year","schedule":{"day":31,"kind":"yearly","month":12}},{"applicable_to":["individual","salaried","freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"income_tax","frequency":"yearly","key":"advance_tax_1","label":"Advance tax instalment 1 (15% cumulative)","rule":"15 June","schedule":{"day":15,"kind":"yearly","month":6}},{"applicable_to":["individual","salaried","freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"income_tax","frequency":"yearly","key":"advance_tax_2","label":"Advance tax instalment 2 (45% cumulative)","rule":"15 September","schedule":{"day":15,"kind":"yearly","month":9}},{"applicable_to":["individual","salaried","freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"income_tax","frequency":"yearly","key":"advance_tax_3","label":"Advance tax instalment 3 (75% cumulative)","rule":"15 December","schedule":{"day":15,"kind":"yearly","month":12}},{"applicable_to":["individual","salaried","freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"income_tax","frequency":"yearly","key":"advance_tax_4","label":"Advance tax instalment 4 (100% cumulative)","rule":"15 March","schedule":{"day":15,"kind":"yearly","month":3}},{"applicable_to":["individual","salaried","freelancer","sole_proprietor","other"],"category":"income_tax","frequency":"yearly","key":"itr_individual","label":"ITR filing (individual, no audit)","rule":"31 July","schedule":{"day":31,"kind":"yearly","month":7}},{"applicable_to":["sole_proprietor","partnership","llp","private_limited","other"],"category":"income_tax","frequency":"yearly","key":"tax_audit","label":"Tax audit report","rule":"30 September","schedule":{"day":30,"kind":"yearly","month":9}},{"applicable_to":["sole_proprietor","partnership","llp","private_limited","other"],"category":"income_tax","frequency":"yearly","key":"itr_audit","label":"ITR filing (audit cases)","rule":"31 October","schedule":{"day":31,"kind":"yearly","month":10}},{"applicable_to":["freelancer","sole_proprietor","partnership","llp","private_limited","other"],"category":"tds","frequency":"quarterly","key":"tds_return","label":"TDS return (quarterly)","rule":"31 July, 31 October, 31 January and 31 May for the four quarters","schedule":{"day":31,"kind":"fixed_months","months":[1,5,7,10]}}],"effective_from":"2025-04-01","id":"due-dates","notes":"Standard rules only, checked against the secondary sources listed above on 2026-11-16. Due dates are extended by notification from time to time and a date does not move for a Sunday or holiday unless notified. Every UI using this pack must show a verify on the official portal note. QRMP GSTR-3B is the 22nd or 24th depending on state; this pack uses the 22nd as the earlier date and says so in the rule text. TDS deposit, PF/ESI deposit, and tax audit report entries are carried from the previous app values and were not independently verified in this pass.","sources":[{"accessed":"2026-11-16","publisher":"ComplyKart","title":"GST Return Filing in India: A Practitioner's Guide","url":"https://www.complykart.com/blog/gst-return-filing-complete-guide"},{"accessed":"2026-11-16","publisher":"Indian Business Tools","title":"GST Due Date Calendar: Monthly and Quarterly GSTR-1, 3B, CMP-08","url":"https://www.indianbusinesstools.com/tools/gst-return-due-date-calendar"},{"accessed":"2026-11-16","publisher":"Finance Tools Academy","title":"Income Tax Guide India FY 2025-26: Slabs and Deductions","url":"https://www.financetoolsacademy.com/learn/income-tax-guide.html"},{"accessed":"2026-11-16","publisher":"Dhanaay","title":"Income Tax Slabs FY 2026-27","url":"http://dhanaay.com/s/income-tax-slabs"}],"verified":false,"version":1};

  // Normalize an assessment-year pack: accept both "marginal_relief"
  // (shared) and "rebate_marginal_relief" (previous web-local).
  function normalizeAy(p) {
    if (!p || typeof p !== "object") return p;
    var nr = p.new_regime;
    if (nr) {
      if (nr.rebate_marginal_relief === undefined && nr.marginal_relief !== undefined) {
        nr.rebate_marginal_relief = nr.marginal_relief;
      }
      if (nr.marginal_relief === undefined && nr.rebate_marginal_relief !== undefined) {
        nr.marginal_relief = nr.rebate_marginal_relief;
      }
    }
    return p;
  }

  // Normalize a GST pack: the shared pack is flat (rates, legacy_rates,
  // interest_pa, notification, penalty_no_fraud at top level); the
  // previous web-local pack nested them under "gst". Build the nested
  // view when it is missing so gstRates, gstSplit callers and
  // interestPenalty read one shape. Penalty inputs come from the pack
  // (penalty_no_fraud) when present; the 0.10 / Rs 10,000 figures below
  // are only the fallback when a pack omits them, and stay labeled as a
  // rough estimate wherever they are shown.
  function normalizeGst(p) {
    if (!p || typeof p !== "object") return p;
    var pen = p.penalty_no_fraud || {};
    if (!p.gst) {
      p.gst = {
        rates: p.rates || [0, 5, 18, 40],
        legacy_rates: p.legacy_rates || [12, 28],
        interest_pa: (p.interest_pa === undefined ? 0.18 : p.interest_pa),
        penalty_rate_no_fraud: (pen.rate === undefined ? 0.10 : pen.rate),
        penalty_minimum: (pen.minimum === undefined ? 10000 : pen.minimum),
        rate_notification: p.notification || ""
      };
    } else {
      if (p.gst.rate_notification === undefined && p.notification) p.gst.rate_notification = p.notification;
      if (p.gst.rates === undefined && p.rates) p.gst.rates = p.rates;
      if (p.gst.legacy_rates === undefined && p.legacy_rates) p.gst.legacy_rates = p.legacy_rates;
      if (p.gst.interest_pa === undefined && p.interest_pa !== undefined) p.gst.interest_pa = p.interest_pa;
      if (p.gst.penalty_rate_no_fraud === undefined && pen.rate !== undefined) p.gst.penalty_rate_no_fraud = pen.rate;
      if (p.gst.penalty_minimum === undefined && pen.minimum !== undefined) p.gst.penalty_minimum = pen.minimum;
    }
    if (p.rates === undefined && p.gst.rates) p.rates = p.gst.rates;
    if (p.legacy_rates === undefined && p.gst.legacy_rates) p.legacy_rates = p.gst.legacy_rates;
    if (p.notification === undefined && p.gst.rate_notification) p.notification = p.gst.rate_notification;
    return p;
  }

  function categoryLabel(c) {
    if (c === "gst") return "GST";
    if (c === "income_tax") return "Income tax";
    if (c === "tds") return "TDS";
    if (c === "payroll") return "Payroll";
    if (!c) return "Compliance";
    return String(c).charAt(0).toUpperCase() + String(c).slice(1);
  }
  function defaultNoteFor(key, label) {
    if (key === "gstr1" || key === "gstr1_qrmp") return "Have your sales invoices for the period ready.";
    if (key === "gstr3b" || key === "gstr3b_qrmp") return "Have your sales and purchase records and ITC workings ready. Check GSTR-2B before filing.";
    if (key && key.indexOf("advance_tax") === 0) return "Have your estimated income for the year ready.";
    if (key === "itr_individual") return "Have Form 16, AIS, Form 26AS and bank interest certificates ready.";
    if (key === "itr_audit") return "Have your audited books and tax audit report ready.";
    if (key === "gstr9") return "Have your yearly sales and purchase summaries and filed returns ready.";
    if (key === "tds_return") return "Have your TDS challans and deduction records ready.";
    return "Standard date. Check the official portal for extensions and what to keep ready.";
  }
  // Normalize one due-date rule: shared rules carry a "schedule" object
  // and "applicable_to"; previous web-local rules carried flat day/month,
  // kind and profiles. Output is always the flat shape dueTasks uses.
  // Quarter-end rules resolve to the 13th/22nd of the month after each
  // quarter end (Apr, Jul, Oct, Jan), expressed as fixed_months.
  function normalizeDueEntry(r) {
    if (!r || typeof r !== "object") return r;
    if (!r.schedule) {
      if (!r.profiles && r.applicable_to) r.profiles = r.applicable_to;
      return r;
    }
    var s = r.schedule;
    var out = {
      key: r.key, label: r.label, rule: r.rule,
      category: categoryLabel(r.category),
      note: r.note || defaultNoteFor(r.key, r.label),
      profiles: r.applicable_to || r.profiles || []
    };
    if (s.kind === "monthly") {
      out.kind = "monthly"; out.day = s.day;
    } else if (s.kind === "yearly") {
      out.kind = "annual"; out.day = s.day; out.month = (s.month || 1) - 1;
    } else if (s.kind === "quarter_end") {
      out.kind = "fixed_months"; out.day = s.day; out.months = [3, 6, 9, 0];
    } else if (s.kind === "fixed_months") {
      out.kind = "fixed_months"; out.day = s.day;
      out.months = (s.months || []).map(function (m) { return m - 1; });
    } else {
      out.kind = "monthly"; out.day = s.day || 1;
    }
    return out;
  }
  function normalizeDue(p) {
    if (!p || typeof p !== "object") return p;
    if (Array.isArray(p.due_dates)) p.due_dates = p.due_dates.map(normalizeDueEntry);
    return p;
  }

  var packs = {
    ay: normalizeAy(FALLBACK_AY),
    gst: normalizeGst(FALLBACK_GST),
    due: normalizeDue(FALLBACK_DUE)
  };
  var loadedFrom = "embedded fallback";
  var readyPromise = null;

  function loadOne(path, fallback) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("pack fetch failed");
      return r.json();
    }).then(function (j) {
      return (j && typeof j === "object") ? j : fallback;
    }).catch(function () { return fallback; });
  }
  function load() {
    if (readyPromise) return readyPromise;
    readyPromise = Promise.all([
      loadOne("rules/ay-2026-27.json", FALLBACK_AY),
      loadOne("rules/gst.json", FALLBACK_GST),
      loadOne("rules/due-dates.json", FALLBACK_DUE)
    ]).then(function (res) {
      packs = { ay: normalizeAy(res[0]), gst: normalizeGst(res[1]), due: normalizeDue(res[2]) };
      loadedFrom = "web/rules/*.json (shared pack sync, 16 Nov 2026)";
      return packs;
    });
    return readyPromise;
  }

  function slabTax(income, slabs) {
    var tax = 0;
    for (var i = 0; i < slabs.length; i++) {
      var lower = slabs[i][0], rate = slabs[i][1];
      var upper = (i + 1 < slabs.length) ? slabs[i + 1][0] : Infinity;
      if (income > lower) tax += (Math.min(income, upper) - lower) * rate;
    }
    return tax;
  }
  function money(n) { return "Rs " + Math.round(n).toLocaleString("en-IN"); }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  window.NMTax = {
    ready: load,
    packs: function () { return packs; },
    loadedFrom: function () { return loadedFrom; },
    packSyncNote: function () {
      return "Rule packs synced from the shared tax-rules set on 16 Nov 2026. Pack versions: AY " + (packs.ay.version || 1) + ", GST " + (packs.gst.version || 1) + ", due dates " + (packs.due.version || 1) + ". All packs are unverified, verify on the official portal before you file.";
    },
    verified: function () { return !!(packs.ay && packs.ay.verified && packs.gst && packs.gst.verified && packs.due && packs.due.verified); },
    verifyNote: function () {
      return "Tax figures use rule pack v" + (packs.ay.version || 1) + " (AY " + (packs.ay.assessment_year || "2026-27") + "), not yet verified against the current Finance Act. Verify on gst.gov.in and incometax.gov.in before you file.";
    },
    money: money,
    regimeCompare: function (gross, deductions, salaried) {
      var ay = packs.ay;
      var nt = Math.max(0, gross - (salaried ? ay.new_regime.standard_deduction_salaried : 0));
      var nTax = slabTax(nt, ay.new_regime.slabs);
      if (nt <= ay.new_regime.rebate_limit) nTax = 0;
      else if (ay.new_regime.rebate_marginal_relief || ay.new_regime.marginal_relief) nTax = Math.min(nTax, nt - ay.new_regime.rebate_limit);
      nTax *= (1 + ay.new_regime.cess);
      var ot = Math.max(0, gross - (salaried ? ay.old_regime.standard_deduction_salaried : 0) - deductions);
      var oTax = slabTax(ot, ay.old_regime.slabs);
      if (ot <= ay.old_regime.rebate_limit) oTax = 0;
      oTax *= (1 + ay.old_regime.cess);
      return {
        newTaxable: nt, newTax: nTax, oldTaxable: ot, oldTax: oTax,
        cheaper: nTax <= oTax ? "new" : "old",
        cheaperBy: Math.abs(nTax - oTax),
        assumptions: [
          "Includes 4% cess.",
          "Excludes surcharge (income above Rs 50 lakh), TDS already paid and special-rate income.",
          "New regime rebate applies up to taxable income of Rs 12 lakh, with marginal relief."
        ]
      };
    },
    itrForm: function (answers) {
      var s = answers || {};
      if (s.biz || (s.pre && (s.cg || s.fa || s.big))) return { form: "ITR-3", caveats: ["Business or profession with books needs ITR-3.", "Confirm on the portal or with your CA, some capital gains and foreign income cases have exceptions."] };
      if (s.pre) return { form: "ITR-4 (Sugam)", caveats: ["Presumptive taxation under 44AD/44ADA.", "Confirm on the portal or with your CA."] };
      if (s.fa || s.big || s.cg) return { form: "ITR-2", caveats: ["Foreign assets, directorship, unlisted shares, income above Rs 50 lakh or capital gains need ITR-2.", "Confirm on the portal or with your CA."] };
      if (s.sal) return { form: "ITR-1 (Sahaj)", caveats: ["Salary or pension only, within the ITR-1 limits.", "Confirm on the portal or with your CA."] };
      return { form: "", caveats: ["Tick at least one income type."] };
    },
    gstSplit: function (taxable, rate, interstate) {
      var tax = taxable * rate / 100;
      if (interstate) return { cgst: 0, sgst: 0, igst: tax, total: taxable + tax, tax: tax };
      return { cgst: tax / 2, sgst: tax / 2, igst: 0, total: taxable + tax, tax: tax };
    },
    gstRates: function () { return (packs.gst.gst && packs.gst.gst.rates) || packs.gst.rates || [0, 5, 18, 40]; },
    gstLegacyRates: function () { return (packs.gst.gst && packs.gst.gst.legacy_rates) || packs.gst.legacy_rates || [12, 28]; },
    gstSpecialRates: function () { return packs.gst.special_rates || []; },
    gstRateNotification: function () { return (packs.gst.gst && packs.gst.gst.rate_notification) || packs.gst.notification || ""; },
    interestPenalty: function (amount, days) {
      var g = packs.gst.gst || {};
      var interest = amount * (g.interest_pa || 0.18) * days / 365;
      var penalty = Math.max(amount * (g.penalty_rate_no_fraud || 0.10), g.penalty_minimum || 10000);
      return { interest: interest, penalty: penalty, interestPa: g.interest_pa || 0.18 };
    },
    deductionCaps: function () { return (packs.ay.old_regime && packs.ay.old_regime.deductions) || {}; },
    // Resolve the next occurrence of each due-date rule for a profile type.
    // Returns [{key, label, due: Date, daysLeft, category, note, rule, source}]
    // sorted nearest first. Past annual dates roll to next year; past monthly
    // dates roll to next month; fixed_months rules (quarterly and fixed
    // quarterly returns) resolve to the next listed month, with the day
    // clamped to the end of short months. Saved-case deadlines are merged
    // by callers.
    dueTasks: function (profileType) {
      var rules = (packs.due && packs.due.due_dates) || [];
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var out = [];
      rules.forEach(function (r) {
        var profiles = r.profiles || r.applicable_to;
        if (profiles && profiles.indexOf(profileType) === -1) return;
        var d = null;
        if (r.kind === "monthly") {
          d = new Date(today.getFullYear(), today.getMonth(), r.day);
          if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, r.day);
        } else if (r.kind === "fixed_months" && Array.isArray(r.months) && r.months.length) {
          var best = null;
          [0, 1].forEach(function (yo) {
            r.months.forEach(function (m) {
              var cand = new Date(today.getFullYear() + yo, m, Math.min(r.day, daysInMonth(today.getFullYear() + yo, m)));
              if (cand >= today && (best === null || cand < best)) best = cand;
            });
          });
          d = best;
        } else {
          d = new Date(today.getFullYear(), r.month, r.day);
          if (d < today) d = new Date(today.getFullYear() + 1, r.month, r.day);
        }
        if (!d || isNaN(d)) return;
        out.push({
          key: r.key, label: r.label, due: d,
          daysLeft: Math.round((d - today) / 864e5),
          category: r.category, note: r.note, rule: r.rule,
          source: "local due-date rules"
        });
      });
      out.sort(function (a, b) { return a.due - b.due; });
      return out;
    }
  };
})();
