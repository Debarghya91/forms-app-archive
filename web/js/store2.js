// NMStore extensions (W4b): registers, notes, bank transactions,
// payee rules, 2B figures, reconcile runs and multi-business data.
// All local-first: every record is saved on the device first, then sent
// to the server by NMSync when a session and the live server exist.
// NMSync.postOrQueue is the only send path; it never claims a sync
// that did not happen. NMCSV parses register and bank CSV files on the
// device and reports bad rows instead of dropping them silently.
// NMUtil holds the small shared helpers the extension UIs need.
(function () {
  "use strict";
  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
  }
  function esc(s) { return window.NMAuth ? NMAuth.esc(s) : String(s == null ? "" : s); }
  function money2(n) {
    return "Rs\u00A0" + (+n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function money0(n) { return "Rs\u00A0" + Math.round(+n || 0).toLocaleString("en-IN"); }
  function monthOf(dateStr) { return String(dateStr || "").slice(0, 7); }
  function currentMonth() { return new Date().toISOString().slice(0, 7); }
  function monthLabel(m) {
    var parts = String(m || "").split("-");
    if (parts.length < 2) return m || "";
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return names[+parts[1] - 1] + " " + parts[0];
  }
  function round2(n) { return Math.round((+n || 0) * 100) / 100; }

  window.NMUtil = {
    esc: esc, uid: uid, money2: money2, money0: money0,
    monthOf: monthOf, currentMonth: currentMonth, monthLabel: monthLabel, round2: round2,
    download: function (filename, text) {
      var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
    copyText: function (text, btn) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          if (btn) btn.textContent = "Copied";
        }).catch(function () {});
      }
    }
  };

  // ---------------- CSV parsing ----------------
  // Parses one CSV document into rows of strings. Handles quoted fields
  // with commas and doubled quotes, CRLF and LF line endings. Empty
  // trailing lines are skipped.
  function parseCsvText(text) {
    var rows = [], row = [], field = "", inQuotes = false;
    var s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
      else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (f) { return String(f).trim() !== ""; });
    }).map(function (r) { return r.map(function (f) { return String(f).trim(); }); });
  }
  function isHeaderRow(cells) {
    var first = (cells[0] || "").toLowerCase();
    return first === "date" || first.indexOf("date") === 0;
  }
  // Accepts YYYY-MM-DD and DD/MM/YYYY (and DD-MM-YYYY). Returns an
  // ISO date string or "" when the value is not a real calendar date.
  function parseDateCell(v) {
    var s = String(v || "").trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      var d1 = new Date(+m[1], +m[2] - 1, +m[3]);
      if (d1.getFullYear() === +m[1] && d1.getMonth() === +m[2] - 1 && d1.getDate() === +m[3]) return s;
      return "";
    }
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      var d2 = new Date(+m[3], +m[2] - 1, +m[1]);
      if (d2.getFullYear() === +m[3] && d2.getMonth() === +m[2] - 1 && d2.getDate() === +m[1]) {
        return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
      }
      return "";
    }
    return "";
  }
  function parseRateCell(v, allowedRates) {
    var s = String(v || "").trim().replace(/%/g, "");
    if (s === "") return null;
    var n = +s;
    if (isNaN(n)) return null;
    if (allowedRates.indexOf(n) === -1) return null;
    return n;
  }
  function parseBoolCell(v) {
    var s = String(v || "").trim().toLowerCase();
    if (s === "" || s === "no" || s === "n" || s === "false" || s === "0" || s === "intrastate" || s === "same state") return false;
    if (s === "yes" || s === "y" || s === "true" || s === "1" || s === "interstate" || s === "other state") return true;
    return null;
  }
  function allowedGstRates() {
    var rates = NMTax.gstRates().concat(NMTax.gstLegacyRates());
    NMTax.gstSpecialRates().forEach(function (sp) { if (rates.indexOf(sp.rate) === -1) rates.push(sp.rate); });
    return rates;
  }
  function computeSplit(row) {
    var split = NMTax.gstSplit(row.taxable, row.rate, !!row.interstate);
    row.cgst = round2(split.cgst);
    row.sgst = round2(split.sgst);
    row.igst = round2(split.igst);
    row.tax = round2(split.tax);
    row.total = round2(split.total);
    return row;
  }

  window.NMCSV = {
    parseText: parseCsvText,
    parseDateCell: parseDateCell,
    // Register CSV columns: date, party, invoice no, taxable value,
    // GST rate, interstate (yes/no). Returns {good, bad}; bad rows carry
    // their 1-based line number and a reason, and are never dropped
    // silently by callers.
    parseRegister: function (text) {
      var rows = parseCsvText(text);
      var allowed = allowedGstRates();
      var good = [], bad = [];
      rows.forEach(function (cells, idx) {
        var line = idx + 1;
        if (idx === 0 && isHeaderRow(cells)) return;
        if (cells.length < 5) { bad.push({ line: line, reason: "needs at least 5 columns: date, party, invoice no, taxable value, GST rate" }); return; }
        var date = parseDateCell(cells[0]);
        if (!date) { bad.push({ line: line, reason: "date not understood (use YYYY-MM-DD or DD/MM/YYYY): " + cells[0] }); return; }
        var party = cells[1] || "";
        if (!party) { bad.push({ line: line, reason: "party name is empty" }); return; }
        var taxable = +String(cells[3]).replace(/,/g, "");
        if (isNaN(taxable) || taxable < 0) { bad.push({ line: line, reason: "taxable value is not a number: " + cells[3] }); return; }
        var rate = parseRateCell(cells[4], allowed);
        if (rate === null) { bad.push({ line: line, reason: "GST rate not in the pack (current, special or legacy): " + cells[4] }); return; }
        var interstate = cells.length > 5 ? parseBoolCell(cells[5]) : false;
        if (interstate === null) { bad.push({ line: line, reason: "interstate column not understood (use yes or no): " + cells[5] }); return; }
        good.push(computeSplit({
          date: date, party: party, invoice: cells[2] || "",
          taxable: round2(taxable), rate: rate, interstate: interstate, unpaid: false
        }));
      });
      return { good: good, bad: bad };
    },
    // Bank CSV columns: date, payee, description, amount. Amount is
    // negative for money out and positive for money in. Category is
    // suggested by rules and stays unreviewed until the user confirms.
    parseTransactions: function (text) {
      var rows = parseCsvText(text);
      var good = [], bad = [];
      rows.forEach(function (cells, idx) {
        var line = idx + 1;
        if (idx === 0 && isHeaderRow(cells)) return;
        if (cells.length < 4) { bad.push({ line: line, reason: "needs 4 columns: date, payee, description, amount" }); return; }
        var date = parseDateCell(cells[0]);
        if (!date) { bad.push({ line: line, reason: "date not understood (use YYYY-MM-DD or DD/MM/YYYY): " + cells[0] }); return; }
        var payee = cells[1] || "";
        if (!payee) { bad.push({ line: line, reason: "payee is empty" }); return; }
        var amount = +String(cells[3]).replace(/,/g, "");
        if (isNaN(amount) || amount === 0) { bad.push({ line: line, reason: "amount is not a non-zero number: " + cells[3] }); return; }
        good.push({ date: date, payee: payee, description: cells[2] || "", amount: round2(amount) });
      });
      return { good: good, bad: bad };
    }
  };

  // ---------------- Store extensions ----------------
  var REG_KEYS = { sales: "nm_reg_sales", purchases: "nm_reg_purchases", expenses: "nm_reg_expenses" };
  var TXN_CATEGORIES = ["Sales income", "Other income", "Food", "Travel", "Rent", "Utilities", "Supplies", "Fees and professional", "Salary and staff", "Transfer", "Uncategorised"];
  var KEYWORDS = [
    [/salary|payroll|wages/, "Salary and staff"],
    [/\brent\b|house rent|office rent/, "Rent"],
    [/electricity|water bill|broadband|internet|mobile recharge|\bjio\b|airtel|vodafone|bsnl/, "Utilities"],
    [/petrol|diesel|\buber\b|\bola\b|flight|hotel|\btaxi\b|toll|railway|irctc/, "Travel"],
    [/swiggy|zomato|restaurant|cafe|food|grocery|bigbasket|dmart|blinkit/, "Food"],
    [/amazon|flipkart|stationery|supplies|office depot|printer/, "Supplies"],
    [/ca fee|legal|consultant|professional fee|bank charges|annual fee|subscription/, "Fees and professional"],
    [/transfer to self|own account|self transfer/, "Transfer"]
  ];

  function listFor(key) {
    var v = read(key, []);
    return Array.isArray(v) ? v : [];
  }
  var ext = {
    TXN_CATEGORIES: TXN_CATEGORIES,
    // ----- businesses -----
    businesses: function () { return listFor("nm_businesses"); },
    ensureDefaultBusiness: function () {
      var list = this.businesses();
      if (list.length) return list;
      var profile = this.getProfile ? this.getProfile() : {};
      var biz = {
        id: uid("biz"),
        name: (profile.businessName || "My business").slice(0, 80),
        gstin: "",
        type: ["sole_proprietor", "partnership", "llp", "private_limited"].indexOf(profile.type) !== -1 ? profile.type : "sole_proprietor"
      };
      write("nm_businesses", [biz]);
      try { localStorage.setItem("nm_active_biz", biz.id); } catch (e) {}
      return [biz];
    },
    activeBusinessId: function () {
      this.ensureDefaultBusiness();
      try {
        var id = localStorage.getItem("nm_active_biz");
        var list = this.businesses();
        if (id && list.some(function (b) { return b.id === id; })) return id;
      } catch (e) {}
      return this.businesses()[0].id;
    },
    activeBusiness: function () {
      var id = this.activeBusinessId();
      var found = this.businesses().filter(function (b) { return b.id === id; })[0];
      return found || this.businesses()[0];
    },
    setActiveBusiness: function (id) {
      var biz = this.businesses().filter(function (b) { return b.id === id; })[0];
      if (!biz) return null;
      try { localStorage.setItem("nm_active_biz", id); } catch (e) {}
      if (this.saveProfile) this.saveProfile({ businessName: biz.name });
      return biz;
    },
    addBusiness: function (biz) {
      var list = this.businesses();
      biz.id = biz.id || uid("biz");
      list.push(biz);
      write("nm_businesses", list);
      return list;
    },
    removeBusiness: function (id) {
      var list = this.businesses().filter(function (b) { return b.id !== id; });
      write("nm_businesses", list);
      if (this.activeBusinessId() === id || !list.length) {
        try { localStorage.removeItem("nm_active_biz"); } catch (e) {}
        if (list.length) this.setActiveBusiness(list[0].id);
      }
      return list;
    },
    businessTypeLabel: function (t) {
      var map = { sole_proprietor: "Sole proprietor", partnership: "Partnership firm", llp: "LLP", private_limited: "Private limited company", other: "Other" };
      return map[t] || "Sole proprietor";
    },
    // ----- registers -----
    regList: function (kind, bizId) {
      var rows = listFor(REG_KEYS[kind] || REG_KEYS.sales);
      if (bizId) rows = rows.filter(function (r) { return !r.biz || r.biz === bizId; });
      return rows.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    },
    regAdd: function (kind, row) {
      var key = REG_KEYS[kind];
      var rows = listFor(key);
      row.id = row.id || uid("reg");
      row.biz = row.biz || this.activeBusinessId();
      computeSplit(row);
      rows.push(row);
      write(key, rows.slice(-500));
      return row;
    },
    regUpdate: function (kind, id, patch) {
      var key = REG_KEYS[kind];
      var rows = listFor(key);
      var found = null;
      rows.forEach(function (r) {
        if (r.id === id) {
          for (var k in patch) r[k] = patch[k];
          computeSplit(r);
          found = r;
        }
      });
      write(key, rows);
      return found;
    },
    regDelete: function (kind, id) {
      var key = REG_KEYS[kind];
      write(key, listFor(key).filter(function (r) { return r.id !== id; }));
    },
    regForMonth: function (kind, bizId, month) {
      return this.regList(kind, bizId).filter(function (r) { return monthOf(r.date) === month; });
    },
    regTotals: function (rows) {
      var t = { count: rows.length, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0 };
      rows.forEach(function (r) {
        t.taxable += +r.taxable || 0; t.cgst += +r.cgst || 0; t.sgst += +r.sgst || 0;
        t.igst += +r.igst || 0; t.tax += +r.tax || 0; t.total += +r.total || 0;
      });
      Object.keys(t).forEach(function (k) { if (k !== "count") t[k] = round2(t[k]); });
      return t;
    },
    regByRate: function (rows) {
      var by = {};
      rows.forEach(function (r) {
        var k = String(r.rate);
        if (!by[k]) by[k] = { rate: r.rate, count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0 };
        by[k].count++;
        by[k].taxable += +r.taxable || 0; by[k].cgst += +r.cgst || 0; by[k].sgst += +r.sgst || 0;
        by[k].igst += +r.igst || 0; by[k].tax += +r.tax || 0; by[k].total += +r.total || 0;
      });
      return Object.keys(by).sort(function (a, b) { return +a - +b; }).map(function (k) { return by[k]; });
    },
    regByParty: function (rows) {
      var by = {};
      rows.forEach(function (r) {
        var k = r.party || "(no party)";
        if (!by[k]) by[k] = { party: k, count: 0, taxable: 0, tax: 0, total: 0, rows: [] };
        by[k].count++;
        by[k].taxable += +r.taxable || 0; by[k].tax += +r.tax || 0; by[k].total += +r.total || 0;
        by[k].rows.push(r);
      });
      return Object.keys(by).sort().map(function (k) { return by[k]; });
    },
    // ----- credit and debit notes -----
    notes: function (bizId) {
      var rows = listFor("nm_notes");
      if (bizId) rows = rows.filter(function (r) { return !r.biz || r.biz === bizId; });
      return rows.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    },
    noteAdd: function (row) {
      var rows = listFor("nm_notes");
      row.id = row.id || uid("note");
      row.biz = row.biz || this.activeBusinessId();
      computeSplit(row);
      rows.push(row);
      write("nm_notes", rows.slice(-300));
      return row;
    },
    noteDelete: function (id) {
      write("nm_notes", listFor("nm_notes").filter(function (r) { return r.id !== id; }));
    },
    notesForMonth: function (bizId, month) {
      return this.notes(bizId).filter(function (r) { return monthOf(r.date) === month; });
    },
    // ----- bank transactions -----
    txns: function (bizId) {
      var rows = listFor("nm_txns");
      if (bizId) rows = rows.filter(function (r) { return !r.biz || r.biz === bizId; });
      return rows.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    },
    txnAdd: function (row) {
      var rows = listFor("nm_txns");
      row.id = row.id || uid("txn");
      row.biz = row.biz || this.activeBusinessId();
      if (row.deductible === undefined) row.deductible = false;
      if (row.reviewed === undefined) row.reviewed = false;
      rows.push(row);
      write("nm_txns", rows.slice(-1000));
      return row;
    },
    txnUpdate: function (id, patch) {
      var rows = listFor("nm_txns");
      var found = null;
      rows.forEach(function (r) {
        if (r.id === id) {
          for (var k in patch) r[k] = patch[k];
          found = r;
        }
      });
      write("nm_txns", rows);
      return found;
    },
    txnDelete: function (id) {
      write("nm_txns", listFor("nm_txns").filter(function (r) { return r.id !== id; }));
    },
    txnsForMonth: function (bizId, month) {
      return this.txns(bizId).filter(function (r) { return monthOf(r.date) === month; });
    },
    payeeRules: function () { return read("nm_payee_rules", {}) || {}; },
    learnPayeeRule: function (payee, category) {
      var rules = this.payeeRules();
      rules[String(payee || "").trim().toLowerCase()] = category;
      write("nm_payee_rules", rules);
      return rules;
    },
    // Rule-based category suggestion. A remembered payee correction wins,
    // then keyword rules, then a sign-based fallback. Returns
    // {category, confident}; uncertain rows stay unreviewed by callers.
    // Nothing here ever sets the tax-deductible flag.
    suggestCategory: function (payee, description, amount) {
      var rules = this.payeeRules();
      var key = String(payee || "").trim().toLowerCase();
      if (rules[key]) return { category: rules[key], confident: true };
      var hay = ((payee || "") + " " + (description || "")).toLowerCase();
      for (var i = 0; i < KEYWORDS.length; i++) {
        if (KEYWORDS[i][0].test(hay)) return { category: KEYWORDS[i][1], confident: true };
      }
      if ((+amount || 0) > 0) return { category: "Other income", confident: false };
      return { category: "Uncategorised", confident: false };
    },
    // Flags computed from the stored rows on every render, so they can
    // never go stale: duplicate (same date, payee and amount twice or
    // more), recurring (same payee and amount in two or more months, or
    // three or more times), unusual (absolute amount over 3x the
    // month median, only when the month has at least 5 rows). Flags are
    // labels for review, never verdicts.
    txnFlags: function (rows) {
      var flags = {};
      function add(id, f) {
        if (!flags[id]) flags[id] = [];
        if (flags[id].indexOf(f) === -1) flags[id].push(f);
      }
      var dupGroups = {};
      rows.forEach(function (r) {
        var k = r.date + "|" + String(r.payee || "").toLowerCase() + "|" + r.amount;
        (dupGroups[k] = dupGroups[k] || []).push(r);
      });
      Object.keys(dupGroups).forEach(function (k) {
        if (dupGroups[k].length > 1) dupGroups[k].forEach(function (r) { add(r.id, "duplicate"); });
      });
      var recGroups = {};
      rows.forEach(function (r) {
        var k = String(r.payee || "").toLowerCase() + "|" + Math.abs(+r.amount || 0);
        (recGroups[k] = recGroups[k] || []).push(r);
      });
      Object.keys(recGroups).forEach(function (k) {
        var g = recGroups[k];
        var months = {};
        g.forEach(function (r) { months[monthOf(r.date)] = true; });
        if (Object.keys(months).length >= 2 || g.length >= 3) g.forEach(function (r) { add(r.id, "recurring"); });
      });
      var byMonth = {};
      rows.forEach(function (r) { (byMonth[monthOf(r.date)] = byMonth[monthOf(r.date)] || []).push(r); });
      Object.keys(byMonth).forEach(function (m) {
        var g = byMonth[m].filter(function (r) { return +r.amount !== 0; });
        if (g.length < 5) return;
        var abs = g.map(function (r) { return Math.abs(+r.amount || 0); }).sort(function (a, b) { return a - b; });
        var median = abs[Math.floor(abs.length / 2)];
        if (!median) return;
        g.forEach(function (r) {
          if (Math.abs(+r.amount || 0) > 3 * median) add(r.id, "unusual");
        });
      });
      return flags;
    },
    // ----- 2B figures and reconcile runs -----
    get2B: function (bizId, month) {
      var all = read("nm_2b", {}) || {};
      return (all[bizId] && all[bizId][month]) || { total: "", vendors: [] };
    },
    save2B: function (bizId, month, figures) {
      var all = read("nm_2b", {}) || {};
      if (!all[bizId]) all[bizId] = {};
      all[bizId][month] = figures;
      write("nm_2b", all);
      return figures;
    },
    saveReconcileRun: function (run) {
      var runs = listFor("nm_reconcile_runs");
      run.id = run.id || uid("rec");
      run.at = run.at || new Date().toISOString();
      runs.push(run);
      write("nm_reconcile_runs", runs.slice(-50));
      return run;
    },
    lastReconcileRun: function (bizId, month) {
      var runs = listFor("nm_reconcile_runs").filter(function (r) { return r.biz === bizId && r.month === month; });
      return runs.length ? runs[runs.length - 1] : null;
    },
    // ----- saved invoice unpaid flag (W4a records have no flag) -----
    setInvoiceUnpaid: function (id, unpaid) {
      var list = this.invoices ? this.invoices() : [];
      var found = null;
      list.forEach(function (inv) {
        if (inv.id === id) { inv.unpaid = !!unpaid; found = inv; }
      });
      write("nm_invoices", list);
      return found;
    },
    wipeW4bKeys: function () {
      ["nm_reg_sales", "nm_reg_purchases", "nm_reg_expenses", "nm_notes", "nm_txns",
       "nm_payee_rules", "nm_2b", "nm_reconcile_runs", "nm_businesses", "nm_active_biz"].forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) {}
      });
    }
  };
  for (var k in ext) NMStore[k] = ext[k];

  // ---------------- Sync ----------------
  // Sends one record now when a signed-in session and the live server
  // exist, else queues it honestly. Network failure and pilot-mode 503
  // queue; other server errors do not queue, because the server already
  // saw and rejected the record. Never activates or confirms anything
  // client-side.
  //
  // Compliance task ids (coordinator alignment, 16 Nov 2026): PATCH
  // /api/compliance/tasks/:id uses the task KEY from GET /api/compliance
  // (keys like advance_tax_1, itr_individual, gstr3b), NOT the local
  // done-mark key, which appends ":" plus the due date so a recurring
  // rule is a fresh task each period. Queued items carry the local key
  // (and the server key when the task came from the server); the sender
  // maps the local key to the server key by stripping the date suffix.
  // Saved-case deadlines ("case-..." keys) are local only and are never
  // PATCHed; stale queue entries for them are dropped on flush.
  var flushing = false;
  function serverKeyFromLocal(localKey, patchId) {
    if (patchId) return patchId;
    var k = String(localKey || "");
    if (k.indexOf("case-") === 0 || k.indexOf("server-") === 0) return "";
    var idx = k.indexOf(":");
    return idx === -1 ? k : k.slice(0, idx);
  }
  function canPost() {
    try {
      return !!(window.NMAuth && NMAuth.configured() && !NMAuth.isLocalMode() && NMAuth.sessionValid(NMAuth.loadSession()));
    } catch (e) { return false; }
  }
  function sendForKind(item) {
    var kind = item.kind, p = item.payload || {};
    if (kind === "invoice") return NMApi.request("/api/invoices", { method: "POST", body: p });
    if (kind === "task_done") {
      var serverKey = serverKeyFromLocal(p.key || p.id || "", p.patchId || "");
      if (!serverKey) return Promise.resolve({ ok: true, status: 200, droppedLocalOnly: true });
      return NMApi.request("/api/compliance/tasks/" + encodeURIComponent(serverKey), { method: "PATCH", body: { done: !!p.done } });
    }
    if (kind === "register_sale") return NMApi.request("/api/registers/sales", { method: "POST", body: p });
    if (kind === "register_purchase") return NMApi.request("/api/registers/purchases", { method: "POST", body: p });
    if (kind === "expense_register") return NMApi.request("/api/expenses", { method: "POST", body: p });
    if (kind === "note") return NMApi.request("/api/notes", { method: "POST", body: p });
    if (kind === "expense_import") return NMApi.request("/api/expenses/import", { method: "POST", body: { rows: p.rows || [p] } });
    if (kind === "profile_sync") return NMApi.request("/api/profile", { method: "PUT", body: p });
    return Promise.resolve({ ok: false, status: -1, error: "unknown queue kind" });
  }
  window.NMSync = {
    canPost: canPost,
    postOrQueue: function (kind, path, method, payload) {
      if (!canPost()) {
        NMStore.enqueue(kind, payload);
        return Promise.resolve({ sent: false, queued: true, reason: "saved on this device, queued to sync when you are signed in and the server is reachable" });
      }
      return NMApi.request(path, { method: method || "POST", body: payload }).then(function (res) {
        if (res.ok) return { sent: true, queued: false, reason: "saved on this device and on your account" };
        if (res.status === 0 || res.status === 503) {
          NMStore.enqueue(kind, payload);
          return { sent: false, queued: true, reason: "saved on this device, queued to sync when the server is reachable" };
        }
        return { sent: false, queued: false, reason: "saved on this device. The server did not accept it (" + (res.error || ("status " + res.status)) + ")." };
      }).catch(function () {
        NMStore.enqueue(kind, payload);
        return { sent: false, queued: true, reason: "saved on this device, queued to sync when the server is reachable" };
      });
    },
    pushTaskDone: function (key, done, patchId) {
      var serverKey = serverKeyFromLocal(key, patchId || "");
      if (!serverKey) return Promise.resolve({ sent: false, queued: false, reason: "local-only deadline, nothing to sync" });
      var payload = { key: key, patchId: serverKey, done: !!done, at: new Date().toISOString() };
      return this.postOrQueue("task_done", "/api/compliance/tasks/" + encodeURIComponent(serverKey), "PATCH", payload);
    },
    flush: function () {
      if (flushing || !canPost()) return Promise.resolve({ flushed: 0, remaining: NMStore.queue().length, reason: "not flushing without a session" });
      flushing = true;
      return NMStore.flushQueue(function (item) {
        return sendForKind(item).then(function (res) { return !!res.ok; }).catch(function () { return false; });
      }).then(function (r) {
        flushing = false;
        return r;
      }).catch(function () {
        flushing = false;
        return { flushed: 0, remaining: NMStore.queue().length, reason: "flush failed" };
      });
    }
  };
  try {
    window.addEventListener("online", function () {
      if (window.NMApi) NMApi.resetLiveCache();
      window.NMSync.flush();
    });
  } catch (e) {}
})();
