// 2B-style reconciliation: compares the purchase register against
// user-entered 2B figures. It never claims portal data; the figures
// come from the request body. Matching is by invoice number plus
// GSTIN, case-insensitive, whitespace-trimmed.
import { round2 } from "./tax.js";

function keyOf(row) {
  const inv = String(row.invoice_no || row.invoice_number || "").trim().toLowerCase();
  const gstin = String(row.gstin || row.vendor_gstin || "").trim().toUpperCase();
  return gstin + "|" + inv;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function reconcilePurchases(registerRows, figures) {
  const register = Array.isArray(registerRows) ? registerRows : [];
  const figs = Array.isArray(figures) ? figures : [];
  const byKey = new Map();
  for (const row of register) {
    const key = keyOf(row);
    if (!key.endsWith("|") && !byKey.has(key)) byKey.set(key, row);
  }
  const mismatches = [];
  const missingPurchases = [];
  let matched = 0;
  let figureTotalTax = 0;
  for (const fig of figs) {
    figureTotalTax += num(fig.tax ?? fig.igst ?? 0) + num(fig.cgst ?? 0) + num(fig.sgst ?? 0);
    const key = keyOf(fig);
    const row = byKey.get(key);
    if (!row) {
      missingPurchases.push({
        invoice_no: String(fig.invoice_no || fig.invoice_number || ""),
        gstin: String(fig.gstin || ""),
        taxable: round2(num(fig.taxable)),
        tax: round2(num(fig.tax ?? 0) + num(fig.cgst ?? 0) + num(fig.sgst ?? 0) + num(fig.igst ?? 0)),
      });
      continue;
    }
    const regTaxable = num(row.taxable);
    const regTax =
      num(row.tax ?? 0) + num(row.cgst ?? 0) + num(row.sgst ?? 0) + num(row.igst ?? 0);
    const figTaxable = num(fig.taxable);
    const figTax =
      num(fig.tax ?? 0) + num(fig.cgst ?? 0) + num(fig.sgst ?? 0) + num(fig.igst ?? 0);
    if (round2(regTaxable) === round2(figTaxable) && round2(regTax) === round2(figTax)) {
      matched++;
    } else {
      mismatches.push({
        invoice_no: String(fig.invoice_no || fig.invoice_number || ""),
        gstin: String(fig.gstin || ""),
        register_taxable: round2(regTaxable),
        register_tax: round2(regTax),
        figure_taxable: round2(figTaxable),
        figure_tax: round2(figTax),
        difference_tax: round2(figTax - regTax),
      });
    }
  }
  const vendorMap = new Map();
  let registerTotalTax = 0;
  for (const row of register) {
    const gstin = String(row.gstin || "UNKNOWN");
    const tax = num(row.tax ?? 0) + num(row.cgst ?? 0) + num(row.sgst ?? 0) + num(row.igst ?? 0);
    registerTotalTax += tax;
    const entry = vendorMap.get(gstin) || {
      gstin,
      vendor: String(row.vendor || row.vendor_name || ""),
      taxable: 0,
      tax: 0,
      count: 0,
    };
    entry.taxable = round2(entry.taxable + num(row.taxable));
    entry.tax = round2(entry.tax + tax);
    entry.count += 1;
    if (!entry.vendor) entry.vendor = String(row.vendor || row.vendor_name || "");
    vendorMap.set(gstin, entry);
  }
  return {
    summary: {
      register_count: register.length,
      figure_count: figs.length,
      matched,
      mismatched: mismatches.length,
      missing: missingPurchases.length,
      register_total_tax: round2(registerTotalTax),
      figure_total_tax: round2(figureTotalTax),
    },
    mismatches,
    missing_purchases: missingPurchases,
    vendor_breakdown: [...vendorMap.values()],
    note: "Figures are user-entered. This comparison does not fetch GST portal data.",
  };
}
