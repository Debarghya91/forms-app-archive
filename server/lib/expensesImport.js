// Expense import: rule-based categorisation plus duplicate flagging.
// Uncertain rows stay "unreviewed" and are never marked tax
// deductible. The optional AI pass from the contract is not
// implemented in this version; rule-based results plus the unreviewed
// bucket are the honest v1 behaviour.
const CATEGORY_RULES = [
  { category: "fuel", keywords: ["petrol", "diesel", "fuel", "cng", "hpcl", "iocl", "bpcl", "shell petrol"] },
  { category: "travel", keywords: ["flight", "train", "irctc", "hotel", "cab", "ola", "uber", "taxi", "metro", "toll", "fastag", "airline"] },
  { category: "rent", keywords: ["rent", "lease", "landlord"] },
  { category: "utilities", keywords: ["electricity", "water bill", "internet", "broadband", "telephone", "mobile bill", "gas bill"] },
  { category: "software", keywords: ["subscription", "saas", "software", "domain", "hosting", "cloud", "google workspace", "microsoft 365", "zoho"] },
  { category: "office_supplies", keywords: ["stationery", "printing", "paper", "office supplies", "amazon", "flipkart"] },
  { category: "meals", keywords: ["restaurant", "food", "swiggy", "zomato", "catering", "cafe", "coffee"] },
  { category: "professional_fees", keywords: ["ca fees", "chartered accountant", "legal", "advocate", "consultant", "audit fees", "registration fees"] },
  { category: "repairs", keywords: ["repair", "maintenance", "service charge", "amc"] },
  { category: "marketing", keywords: ["advertising", "ads", "marketing", "promotion", "google ads", "meta ads"] },
  { category: "salaries", keywords: ["salary", "wages", "payroll", "stipend"] },
];

export function categorizeExpense(row) {
  const hay = [row.vendor, row.description, row.narration, row.category_hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => hay.includes(k))) return rule.category;
  }
  return "unreviewed";
}

function dupKey(row) {
  const date = String(row.date || "").slice(0, 10);
  const vendor = String(row.vendor || "").trim().toLowerCase();
  const amount = Number(row.amount) || 0;
  return date + "|" + vendor + "|" + amount.toFixed(2);
}

// Categorize a batch. existingKeys is the set of dup keys already in
// the database; rows duplicating an existing record or an earlier row
// in the same batch are flagged and must not be imported.
export function categorizeBatch(rows, existingKeys) {
  const seen = new Set(existingKeys || []);
  const categorized = [];
  let duplicates = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const category = categorizeExpense(row);
    const key = dupKey(row);
    const duplicate = seen.has(key);
    if (duplicate) duplicates++;
    else seen.add(key);
    categorized.push({
      date: row.date || null,
      vendor: row.vendor || null,
      amount: Number(row.amount) || 0,
      description: row.description || null,
      category,
      review_status: category === "unreviewed" ? "unreviewed" : "categorized",
      duplicate,
    });
  }
  return { categorized, duplicates_flagged: duplicates };
}
