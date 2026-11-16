// NMBizExt (W4b): fills the five Business extension containers left by
// W4a (#biz-registers, #biz-reconcile, #biz-expenses, #biz-notes,
// #biz-reports). W4a code in business.js is not edited: this file wraps
// NMBusiness.render, calls the original first, then renders into the
// empty containers. Everything is local-first: records save on the
// device, then NMSync tries the server and queues honestly when the
// server is unreachable. Tax splits always come from NMTax and the
// versioned pack. Every return report carries the preparation support
// disclaimer and never claims a filing happened or portal data was used.
// No Excel or PDF import exists in this build, on purpose: CSV only.
(function () {
  "use strict";
  function esc(s) { return NMUtil.esc(s); }
  function $(id) { return document.getElementById(id); }
  function money2(n) { return NMUtil.money2(n); }
  function money0(n) { return NMUtil.money0(n); }
  var PREP_NOTE = "Preparation support only, verify on the GST portal. This is not a filed return and no portal data was used.";
  var REG_TAB = "sales";
  var REG_MONTH = NMUtil.currentMonth();
  var REG_EDIT = null;
  var REC_MONTH = NMUtil.currentMonth();
  var EXP_MONTH = NMUtil.currentMonth();
  var EXP_SEARCH = "";
  var REP_MONTH = NMUtil.currentMonth();
  var PARTY_OPEN = null;

  function rateOptions(selected) {
    var html = "";
    NMTax.gstRates().forEach(function (r) {
      html += '<option value="' + r + '"' + (+selected === r ? " selected" : "") + ">" + r + "%</option>";
    });
    NMTax.gstSpecialRates().forEach(function (sp) {
      html += '<option value="' + sp.rate + '"' + (+selected === sp.rate ? " selected" : "") + ">" + sp.rate + "% (special: " + esc(sp.label) + ")</option>";
    });
    NMTax.gstLegacyRates().forEach(function (r) {
      html += '<option value="' + r + '"' + (+selected === r ? " selected" : "") + ">" + r + "% (legacy)</option>";
    });
    return html;
  }
  function rateLabel(rate) {
    if (NMTax.gstLegacyRates().indexOf(+rate) !== -1) return rate + "% (legacy)";
    var sp = NMTax.gstSpecialRates().filter(function (s) { return +s.rate === +rate; })[0];
    if (sp) return rate + "% (special)";
    return rate + "%";
  }
  function biz() { return NMStore.activeBusiness(); }
  function regKindLabel(kind) {
    return kind === "sales" ? "Sales register" : kind === "purchases" ? "Purchase register" : "Expense register";
  }
  function regSync(kind) {
    if (kind === "sales") return { kind: "register_sale", path: "/api/registers/sales" };
    if (kind === "purchases") return { kind: "register_purchase", path: "/api/registers/purchases" };
    return { kind: "expense_register", path: "/api/expenses" };
  }
  function syncStatus(el, res) {
    if (el) el.textContent = res.reason || "";
  }

  // Shared month arithmetic used by reconciliation and reports.
  function monthSummary(bizId, month) {
    var sales = NMStore.regForMonth("sales", bizId, month);
    var purch = NMStore.regForMonth("purchases", bizId, month);
    var expReg = NMStore.regForMonth("expenses", bizId, month);
    var notes = NMStore.notesForMonth(bizId, month);
    var sTot = NMStore.regTotals(sales);
    var pTot = NMStore.regTotals(purch);
    var eTot = NMStore.regTotals(expReg);
    var salesAdj = 0, itcAdj = 0;
    notes.forEach(function (n) {
      var effect = (n.type === "credit" ? -1 : 1) * (+n.tax || 0);
      if (n.linkScope === "sales") salesAdj += effect;
      else if (n.linkScope === "purchase") itcAdj += effect;
    });
    var outputTax = NMUtil.round2(sTot.tax + salesAdj);
    var itc = NMUtil.round2(pTot.tax + itcAdj);
    return {
      sales: sales, purch: purch, expReg: expReg, notes: notes,
      sTot: sTot, pTot: pTot, eTot: eTot,
      salesAdj: NMUtil.round2(salesAdj), itcAdj: NMUtil.round2(itcAdj),
      outputTax: outputTax, itc: itc,
      netPayable: Math.max(0, NMUtil.round2(outputTax - itc)),
      excessItc: Math.max(0, NMUtil.round2(itc - outputTax))
    };
  }

  // ---------------- Registers ----------------
  function renderRegisters() {
    var box = $("biz-registers");
    if (!box) return;
    var b = biz();
    var kind = REG_TAB;
    var rows = NMStore.regForMonth(kind, b.id, REG_MONTH);
    var totals = NMStore.regTotals(rows);
    var allRows = NMStore.regList(kind, b.id);
    var editRow = REG_EDIT ? allRows.filter(function (r) { return r.id === REG_EDIT; })[0] : null;
    var html = '<div class="panel"><div class="lbl"><span>REGISTERS</span><span>' + esc(b.name) + '</span></div>' +
      '<p class="sub">Sales, purchase and expense registers for the active business. Tax splits are computed from the GST rule pack. Current rates are 0, 5, 18 and 40 percent. Rates marked legacy (12, 28) are for old invoices only. The 3 percent special rate covers gold, silver and platinum.</p>' +
      '<div class="row" role="tablist">' +
      ["sales", "purchases", "expenses"].map(function (k) {
        return '<button type="button" class="btn sm ' + (kind === k ? "" : "g") + '" data-regtab="' + k + '">' + regKindLabel(k) + '</button>';
      }).join("") + '</div>' +
      '<div class="row"><label class="sub">Month <input type="month" id="reg-month" class="in" value="' + REG_MONTH + '"></label></div>' +
      '<div class="stat"><div class="cell"><b>' + rows.length + '</b><span>Rows in ' + NMUtil.monthLabel(REG_MONTH) + '</span></div>' +
      '<div class="cell"><b>' + money0(totals.taxable) + '</b><span>Taxable value</span></div>' +
      '<div class="cell"><b>' + money0(totals.tax) + '</b><span>Tax</span></div>' +
      '<div class="cell"><b>' + money0(totals.total) + '</b><span>Total</span></div></div>' +
      '<p class="sub" style="margin-top:8px">All time for this business: ' + allRows.length + ' rows, total ' + money2(NMStore.regTotals(allRows).total) + '.</p></div>';

    html += '<div class="panel"><div class="lbl"><span>' + (editRow ? "EDIT ROW" : "ADD ROW") + ' · ' + esc(regKindLabel(kind).toUpperCase()) + '</span></div>' +
      '<div class="row"><input id="reg-date" type="date" class="in" value="' + (editRow ? esc(editRow.date) : new Date().toISOString().slice(0, 10)) + '"><input id="reg-party" class="in" placeholder="' + (kind === "sales" ? "Buyer name" : "Seller / party name") + '" value="' + esc(editRow ? editRow.party : "") + '"></div>' +
      '<div class="row"><input id="reg-invoice" class="in" placeholder="Invoice no" value="' + esc(editRow ? editRow.invoice : "") + '"><input id="reg-taxable" type="number" inputmode="decimal" class="in" placeholder="Taxable value Rs" value="' + (editRow ? editRow.taxable : "") + '"></div>' +
      '<div class="row"><select id="reg-rate" class="in">' + rateOptions(editRow ? editRow.rate : 18) + '</select></div>' +
      '<label class="sub"><input type="checkbox" id="reg-inter"' + (editRow && editRow.interstate ? " checked" : "") + '> Other state (IGST, full rate as IGST)</label>' +
      (kind === "sales" ? '<label class="sub" style="margin-left:12px"><input type="checkbox" id="reg-unpaid"' + (editRow && editRow.unpaid ? " checked" : "") + '> Mark as unpaid (shows in payment reminders)</label>' : "") +
      '<p class="sub" id="reg-preview"></p>' +
      '<div class="row"><button class="btn" id="reg-save">' + (editRow ? "Save changes" : "Add row") + '</button>' +
      (editRow ? '<button class="btn g" id="reg-cancel">Cancel edit</button>' : "") + '</div>' +
      '<p class="sub" id="reg-status" style="margin-top:8px"></p></div>';

    html += '<div class="panel"><div class="lbl"><span>ROWS · ' + esc(NMUtil.monthLabel(REG_MONTH)) + '</span></div><div id="reg-list">';
    if (!rows.length) html += '<p class="sub" style="margin-top:8px">No rows this month. Add one above or import a CSV below.</p>';
    rows.forEach(function (r) {
      var split = r.interstate
        ? "IGST " + money2(r.igst)
        : "CGST " + money2(r.cgst) + " + SGST " + money2(r.sgst);
      html += '<div class="cs stack" style="cursor:default"><span><b>' + esc(r.party) + '</b> · ' + esc(r.date) + ' · Inv ' + esc(r.invoice || "-") +
        '<br><span class="sub">Taxable ' + money2(r.taxable) + ' @ ' + rateLabel(r.rate) + ' · ' + split + '</span>' +
        (r.unpaid ? ' <span class="tag ver">UNPAID</span>' : "") + '</span>' +
        '<span class="cs-actions"><b class="dd">' + money2(r.total) + '</b>' +
        '<button class="btn sm g" data-regedit="' + r.id + '">Edit</button>' +
        '<button class="btn sm g" data-regdel="' + r.id + '">Delete</button></span></div>';
    });
    html += '</div></div>';

    html += '<div class="panel"><div class="lbl"><span>CSV IMPORT · ' + esc(regKindLabel(kind).toUpperCase()) + '</span></div>' +
      '<p class="sub" style="margin-top:8px">Expected column order, one row per line: <b>date, party, invoice no, taxable value, GST rate, interstate (yes/no)</b>. Dates as YYYY-MM-DD or DD/MM/YYYY. The first line may be a header row. GST rate must be a pack rate: current, special or legacy. The interstate column is optional and defaults to no.</p>' +
      '<div class="row"><label class="btn g" style="text-align:center;flex:1">Choose CSV file<input id="reg-file" type="file" accept=".csv,text/csv" hidden></label></div>' +
      '<textarea id="reg-paste" placeholder="Or paste CSV rows here, for example:&#10;2026-11-02, Sharma Traders, INV-101, 50000, 18, no"></textarea>' +
      '<div class="row"><button class="btn" id="reg-import">Import pasted CSV</button></div>' +
      '<div class="bub hid" id="reg-import-result"></div>' +
      '<p class="sub" style="margin-top:8px">' + esc(NMTax.verifyNote()) + '</p></div>';
    box.innerHTML = html;

    box.querySelectorAll("[data-regtab]").forEach(function (btn) {
      btn.onclick = function () { REG_TAB = btn.getAttribute("data-regtab"); REG_EDIT = null; renderRegisters(); };
    });
    $("reg-month").onchange = function () { REG_MONTH = $("reg-month").value || NMUtil.currentMonth(); renderRegisters(); };
    function refreshPreview() {
      var tx = +($("reg-taxable").value || 0);
      var rt = +($("reg-rate").value || 0);
      var split = NMTax.gstSplit(tx, rt, $("reg-inter").checked);
      $("reg-preview").textContent = tx
        ? "Tax: " + money2(split.tax) + ($("reg-inter").checked ? " as IGST" : " (CGST " + money2(split.cgst) + " + SGST " + money2(split.sgst) + ")") + " · Total: " + money2(split.total)
        : "Enter a taxable value to see the tax split.";
    }
    ["reg-taxable", "reg-rate", "reg-inter"].forEach(function (id) {
      var el = $(id);
      if (el) { el.oninput = refreshPreview; el.onchange = refreshPreview; }
    });
    refreshPreview();
    $("reg-save").onclick = function () {
      var date = $("reg-date").value;
      var party = $("reg-party").value.trim();
      var taxable = +($("reg-taxable").value || 0);
      var status = $("reg-status");
      if (!date) { status.textContent = "Pick a date."; return; }
      if (!party) { status.textContent = "Enter the party name."; return; }
      if (!(taxable >= 0) || $("reg-taxable").value === "") { status.textContent = "Enter a taxable value of 0 or more."; return; }
      var row = {
        date: date, party: party, invoice: $("reg-invoice").value.trim(),
        taxable: NMUtil.round2(taxable), rate: +$("reg-rate").value,
        interstate: $("reg-inter").checked,
        unpaid: kind === "sales" ? !!($("reg-unpaid") && $("reg-unpaid").checked) : false
      };
      var sync = regSync(kind);
      if (editRow) {
        row.id = editRow.id; row.biz = editRow.biz;
        NMStore.regUpdate(kind, editRow.id, row);
        REG_EDIT = null;
        NMSync.postOrQueue(sync.kind, sync.path, "POST", row).then(function (res) {
          renderRegisters();
          var st = $("reg-status");
          if (st) st.textContent = "Row updated. " + res.reason;
        });
      } else {
        var saved = NMStore.regAdd(kind, row);
        NMSync.postOrQueue(sync.kind, sync.path, "POST", saved).then(function (res) {
          renderRegisters();
          var st = $("reg-status");
          if (st) st.textContent = "Row added. " + res.reason;
        });
      }
    };
    var cancelBtn = $("reg-cancel");
    if (cancelBtn) cancelBtn.onclick = function () { REG_EDIT = null; renderRegisters(); };
    box.querySelectorAll("[data-regedit]").forEach(function (btn) {
      btn.onclick = function () { REG_EDIT = btn.getAttribute("data-regedit"); renderRegisters(); window.scrollTo(0, 0); };
    });
    box.querySelectorAll("[data-regdel]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("Delete this register row? This cannot be undone.")) return;
        NMStore.regDelete(kind, btn.getAttribute("data-regdel"));
        renderRegisters();
      };
    });
    function importText(text) {
      var parsed = NMCSV.parseRegister(text);
      var result = $("reg-import-result");
      result.classList.remove("hid");
      var sync = regSync(kind);
      var added = 0;
      var chain = Promise.resolve();
      parsed.good.forEach(function (row) {
        var saved = NMStore.regAdd(kind, row);
        added++;
        chain = chain.then(function () { return NMSync.postOrQueue(sync.kind, sync.path, "POST", saved); });
      });
      chain.then(function () {
        var lines = ["Imported " + added + " row(s). " + parsed.bad.length + " row(s) had problems and were not imported."];
        parsed.bad.forEach(function (b) { lines.push("Line " + b.line + ": " + b.reason); });
        if (parsed.good.length) lines.push("Imported rows are saved on this device" + (NMSync.canPost() ? " and sent to your account where the server accepted them." : " and queued to sync when you are signed in and the server is reachable."));
        renderRegisters();
        var r2 = $("reg-import-result");
        if (r2) { r2.classList.remove("hid"); r2.textContent = lines.join("\n"); }
      });
      result.textContent = "Importing " + parsed.good.length + " row(s)…";
    }
    $("reg-import").onclick = function () {
      var text = $("reg-paste").value.trim();
      if (!text) {
        var r = $("reg-import-result");
        r.classList.remove("hid");
        r.textContent = "Paste CSV rows first, or choose a CSV file.";
        return;
      }
      importText(text);
    };
    $("reg-file").onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { importText(String(reader.result || "")); };
      reader.readAsText(f);
    };
  }

  // ---------------- Credit and debit notes ----------------
  function renderNotes() {
    var box = $("biz-notes");
    if (!box) return;
    var b = biz();
    var notes = NMStore.notes(b.id);
    var creditTotal = 0, debitTotal = 0;
    notes.forEach(function (n) {
      if (n.type === "credit") creditTotal += +n.total || 0;
      else debitTotal += +n.total || 0;
    });
    var salesInvoices = NMStore.regList("sales", b.id).map(function (r) { return r.invoice; }).filter(Boolean);
    var purchInvoices = NMStore.regList("purchases", b.id).map(function (r) { return r.invoice; }).filter(Boolean);
    var html = '<div class="panel"><div class="lbl"><span>CREDIT AND DEBIT NOTES</span><span>' + esc(b.name) + '</span></div>' +
      '<p class="sub">A credit note reduces what a buyer owes (returns, discounts, rate corrections). A debit note adds to it. Notes linked to sales adjust output tax in the GSTR-3B preparation; notes linked to purchases adjust ITC. Standalone notes are listed but do not adjust either total.</p>' +
      '<div class="stat"><div class="cell"><b>' + money0(creditTotal) + '</b><span>Credit notes total</span></div>' +
      '<div class="cell"><b>' + money0(debitTotal) + '</b><span>Debit notes total</span></div>' +
      '<div class="cell"><b>' + money0(debitTotal - creditTotal) + '</b><span>Net (debit minus credit)</span></div></div></div>' +
      '<div class="panel"><div class="lbl"><span>NEW NOTE</span></div>' +
      '<div class="row"><input id="note-date" type="date" class="in" value="' + new Date().toISOString().slice(0, 10) + '">' +
      '<select id="note-type" class="in"><option value="credit">Credit note</option><option value="debit">Debit note</option></select></div>' +
      '<div class="row"><select id="note-scope" class="in"><option value="sales">Sales invoice</option><option value="purchase">Purchase invoice</option><option value="standalone">Standalone</option></select>' +
      '<select id="note-link" class="in"></select></div>' +
      '<div class="row"><input id="note-reason" class="in" list="note-reasons" placeholder="Reason, for example: goods returned"><datalist id="note-reasons"><option value="Goods returned"></option><option value="Discount given"></option><option value="Rate correction"></option><option value="Short supply"></option><option value="Service not delivered"></option></datalist></div>' +
      '<div class="row"><input id="note-taxable" type="number" inputmode="decimal" class="in" placeholder="Taxable value Rs"><select id="note-rate" class="in">' + rateOptions(18) + '</select></div>' +
      '<label class="sub"><input type="checkbox" id="note-inter"> Other state (IGST)</label>' +
      '<p class="sub" id="note-preview"></p>' +
      '<div class="row"><button class="btn" id="note-save">Add note</button></div>' +
      '<p class="sub" id="note-status" style="margin-top:8px"></p></div>' +
      '<div class="panel"><div class="lbl"><span>NOTES</span><span>' + notes.length + ' SAVED</span></div>';
    if (!notes.length) html += '<p class="sub" style="margin-top:8px">No notes yet.</p>';
    notes.forEach(function (n) {
      html += '<div class="cs stack" style="cursor:default"><span><b>' + (n.type === "credit" ? "Credit" : "Debit") + ' note</b> · ' + esc(n.date) +
        ' · ' + esc(n.linkScope === "standalone" ? "standalone" : ("linked to " + (n.linkedInvoice || "invoice"))) +
        '<br><span class="sub">' + esc(n.reason || "No reason given") + ' · Taxable ' + money2(n.taxable) + ' @ ' + rateLabel(n.rate) + ' · Tax ' + money2(n.tax) + '</span></span>' +
        '<span class="cs-actions"><b class="dd">' + money2(n.total) + '</b>' +
        '<button class="btn sm g" data-notedel="' + n.id + '">Delete</button></span></div>';
    });
    html += '</div>';
    box.innerHTML = html;
    function refreshLinks() {
      var scope = $("note-scope").value;
      var sel = $("note-link");
      var list = scope === "sales" ? salesInvoices : scope === "purchase" ? purchInvoices : [];
      sel.innerHTML = scope === "standalone"
        ? '<option value="">No invoice</option>'
        : (list.length ? list.map(function (inv) { return '<option value="' + esc(inv) + '">' + esc(inv) + '</option>'; }).join("") : '<option value="">No invoices in the register yet</option>');
      sel.disabled = scope === "standalone";
    }
    $("note-scope").onchange = refreshLinks;
    refreshLinks();
    function refreshPreview() {
      var tx = +($("note-taxable").value || 0);
      var split = NMTax.gstSplit(tx, +($("note-rate").value || 0), $("note-inter").checked);
      $("note-preview").textContent = tx ? "Tax: " + money2(split.tax) + " · Total: " + money2(split.total) : "Enter a taxable value to see the tax split.";
    }
    ["note-taxable", "note-rate", "note-inter"].forEach(function (id) {
      var el = $(id);
      if (el) { el.oninput = refreshPreview; el.onchange = refreshPreview; }
    });
    refreshPreview();
    $("note-save").onclick = function () {
      var date = $("note-date").value;
      var taxable = +($("note-taxable").value || 0);
      var status = $("note-status");
      if (!date) { status.textContent = "Pick a date."; return; }
      if ($("note-taxable").value === "" || !(taxable >= 0)) { status.textContent = "Enter a taxable value of 0 or more."; return; }
      var row = {
        date: date, type: $("note-type").value, linkScope: $("note-scope").value,
        linkedInvoice: $("note-scope").value === "standalone" ? "" : $("note-link").value,
        reason: $("note-reason").value.trim(),
        taxable: NMUtil.round2(taxable), rate: +$("note-rate").value,
        interstate: $("note-inter").checked
      };
      var saved = NMStore.noteAdd(row);
      NMSync.postOrQueue("note", "/api/notes", "POST", saved).then(function (res) {
        renderNotes();
        var st = $("note-status");
        if (st) st.textContent = "Note added. " + res.reason;
      });
    };
    box.querySelectorAll("[data-notedel]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("Delete this note? This cannot be undone.")) return;
        NMStore.noteDelete(btn.getAttribute("data-notedel"));
        renderNotes();
      };
    });
  }

  // ---------------- ITC and reconciliation ----------------
  function gstr1Text(b, month, summary) {
    var lines = ["GSTR-1 PREPARATION SUMMARY", "Business: " + b.name + (b.gstin ? " (GSTIN " + b.gstin + ")" : ""), "Month: " + NMUtil.monthLabel(month), ""];
    lines.push("Sales by GST rate:");
    NMStore.regByRate(summary.sales).forEach(function (r) {
      lines.push(rateLabel(r.rate) + ": taxable " + money2(r.taxable) + ", CGST " + money2(r.cgst) + ", SGST " + money2(r.sgst) + ", IGST " + money2(r.igst) + ", total " + money2(r.total) + " (" + r.count + " invoices)");
    });
    lines.push("Total: taxable " + money2(summary.sTot.taxable) + ", tax " + money2(summary.sTot.tax) + ", total " + money2(summary.sTot.total));
    lines.push("", "Sales by party:");
    NMStore.regByParty(summary.sales).forEach(function (p) {
      lines.push(p.party + ": " + p.count + " invoices, taxable " + money2(p.taxable) + ", tax " + money2(p.tax) + ", total " + money2(p.total));
    });
    lines.push("", PREP_NOTE);
    return lines.join("\n");
  }
  function gstr1Csv(b, month, summary) {
    var lines = ["GSTR-1 preparation summary," + b.name + "," + NMUtil.monthLabel(month)];
    lines.push("Rate,Invoices,Taxable value,CGST,SGST,IGST,Total");
    NMStore.regByRate(summary.sales).forEach(function (r) {
      lines.push('"' + rateLabel(r.rate) + '",' + r.count + "," + r.taxable.toFixed(2) + "," + r.cgst.toFixed(2) + "," + r.sgst.toFixed(2) + "," + r.igst.toFixed(2) + "," + r.total.toFixed(2));
    });
    lines.push("Party,Invoices,Taxable value,Tax,Total");
    NMStore.regByParty(summary.sales).forEach(function (p) {
      lines.push('"' + p.party.replace(/"/g, '""') + '",' + p.count + "," + p.taxable.toFixed(2) + "," + p.tax.toFixed(2) + "," + p.total.toFixed(2));
    });
    lines.push("Preparation support only, verify on the GST portal");
    return lines.join("\n");
  }
  function gstr3bText(b, month, summary) {
    var lines = ["GSTR-3B PREPARATION SUMMARY", "Business: " + b.name + (b.gstin ? " (GSTIN " + b.gstin + ")" : ""), "Month: " + NMUtil.monthLabel(month), "",
      "Output tax on sales: " + money2(summary.sTot.tax),
      "Sales note adjustments (credit notes reduce, debit notes add): " + money2(summary.salesAdj),
      "Total output tax: " + money2(summary.outputTax), "",
      "ITC from purchase register: " + money2(summary.pTot.tax),
      "Purchase note adjustments: " + money2(summary.itcAdj),
      "Total ITC available: " + money2(summary.itc), "",
      "Net tax payable (output tax minus ITC, floored at zero): " + money2(summary.netPayable),
      "Excess ITC (ITC above output tax): " + money2(summary.excessItc), "",
      "Expense register total this month (for reference, not part of the 3B math): " + money2(summary.eTot.total), "",
      PREP_NOTE];
    return lines.join("\n");
  }
  function computeReconcile(bizId, month, figures) {
    var purch = NMStore.regForMonth("purchases", bizId, month);
    var byVendor = {};
    purch.forEach(function (r) {
      var k = (r.party || "").trim().toLowerCase();
      if (!byVendor[k]) byVendor[k] = { vendor: r.party, itc: 0, count: 0 };
      byVendor[k].itc += +r.tax || 0;
      byVendor[k].count++;
    });
    var figVendors = {};
    (figures.vendors || []).forEach(function (v) {
      var k = String(v.vendor || "").trim().toLowerCase();
      if (!k) return;
      figVendors[k] = { vendor: v.vendor, itc: +v.itc || 0 };
    });
    var keys = {};
    Object.keys(byVendor).forEach(function (k) { keys[k] = true; });
    Object.keys(figVendors).forEach(function (k) { keys[k] = true; });
    var rows = [], regTotal = 0, twoBTotal = 0, absMismatch = 0;
    var missingPurchases = [], missing2B = [];
    Object.keys(keys).sort().forEach(function (k) {
      var regItc = NMUtil.round2(byVendor[k] ? byVendor[k].itc : 0);
      var twoBItc = NMUtil.round2(figVendors[k] ? figVendors[k].itc : 0);
      var diff = NMUtil.round2(regItc - twoBItc);
      regTotal += regItc; twoBTotal += twoBItc; absMismatch += Math.abs(diff);
      if (!byVendor[k]) missingPurchases.push({ vendor: figVendors[k].vendor, itc: twoBItc });
      if (!figVendors[k]) missing2B.push({ vendor: byVendor[k].vendor, itc: regItc });
      rows.push({ vendor: (byVendor[k] || figVendors[k]).vendor, regItc: regItc, twoBItc: twoBItc, diff: diff, regCount: byVendor[k] ? byVendor[k].count : 0 });
    });
    return {
      rows: rows,
      regTotal: NMUtil.round2(regTotal), twoBTotal: NMUtil.round2(twoBTotal),
      enteredTotal: figures.total === "" || figures.total === null ? null : NMUtil.round2(+figures.total || 0),
      netDiff: NMUtil.round2(regTotal - twoBTotal),
      absMismatch: NMUtil.round2(absMismatch),
      missingPurchases: missingPurchases, missing2B: missing2B
    };
  }
  function renderReconcile() {
    var box = $("biz-reconcile");
    if (!box) return;
    var b = biz();
    var summary = monthSummary(b.id, REC_MONTH);
    var figures = NMStore.get2B(b.id, REC_MONTH);
    // Vendor figures always come from the store, never from module state:
    // add/remove save immediately, so a re-render, a month change or a
    // business switch can never show stale vendor rows.
    var vendorRows = (figures.vendors || []).slice();
    var html = '<div class="panel"><div class="lbl"><span>ITC AND RECONCILIATION</span><span>' + esc(b.name) + '</span></div>' +
      '<div class="row"><label class="sub">Month <input type="month" id="rec-month" class="in" value="' + REC_MONTH + '"></label></div>' +
      '<p class="sub">ITC comes from your purchase register. GSTR-1 and GSTR-3B summaries are preparation support from your own registers. ' + esc(PREP_NOTE) + '</p></div>';

    html += '<div class="panel"><div class="lbl"><span>ITC TRACKING · ' + esc(NMUtil.monthLabel(REC_MONTH)) + '</span></div>';
    var purchByRate = NMStore.regByRate(summary.purch);
    if (!purchByRate.length) html += '<p class="sub" style="margin-top:8px">No purchase rows this month, so no ITC to track yet.</p>';
    purchByRate.forEach(function (r) {
      html += '<div class="kv"><span>ITC @ ' + rateLabel(r.rate) + ' (' + r.count + ' invoice' + (r.count === 1 ? "" : "s") + ')</span><b>' + money2(r.tax) + '</b></div>';
    });
    html += '<div class="kv"><span>ITC from purchase register</span><b>' + money2(summary.pTot.tax) + '</b></div>' +
      '<div class="kv"><span>Purchase note adjustments</span><b>' + money2(summary.itcAdj) + '</b></div>' +
      '<div class="kv"><span>Total ITC available</span><b>' + money2(summary.itc) + '</b></div></div>';

    html += '<div class="panel"><div class="lbl"><span>GSTR-1 PREPARATION</span></div>';
    if (!summary.sales.length) html += '<p class="sub" style="margin-top:8px">No sales rows this month.</p>';
    NMStore.regByRate(summary.sales).forEach(function (r) {
      html += '<div class="kv"><span>Sales @ ' + rateLabel(r.rate) + ' (' + r.count + ')</span><b>' + money2(r.total) + '</b></div>';
    });
    html += '<div class="kv"><span>Total sales</span><b>' + money2(summary.sTot.total) + '</b></div>' +
      '<div class="row"><button class="btn g" id="rec-g1-copy" style="flex:1">Copy summary text</button><button class="btn g" id="rec-g1-csv" style="flex:1">Download CSV</button></div>' +
      '<p class="sub" style="margin-top:8px">' + esc(PREP_NOTE) + '</p></div>';

    html += '<div class="panel"><div class="lbl"><span>GSTR-3B PREPARATION</span></div>' +
      '<div class="kv"><span>Output tax on sales</span><b>' + money2(summary.sTot.tax) + '</b></div>' +
      '<div class="kv"><span>Sales note adjustments</span><b>' + money2(summary.salesAdj) + '</b></div>' +
      '<div class="kv"><span>Total output tax</span><b>' + money2(summary.outputTax) + '</b></div>' +
      '<div class="kv"><span>Total ITC available</span><b>' + money2(summary.itc) + '</b></div>' +
      '<div class="kv"><span>Net tax payable</span><b>' + money2(summary.netPayable) + '</b></div>' +
      '<div class="kv"><span>Excess ITC</span><b>' + money2(summary.excessItc) + '</b></div>' +
      '<div class="row"><button class="btn g" id="rec-g3-copy" style="flex:1">Copy summary text</button><button class="btn g" id="rec-g3-csv" style="flex:1">Download CSV</button></div>' +
      '<p class="sub" style="margin-top:8px">' + esc(PREP_NOTE) + '</p></div>';

    html += '<div class="panel"><div class="lbl"><span>GSTR-2B RECONCILIATION</span></div>' +
      '<p class="sub" style="margin-top:8px">Enter the figures from your GSTR-2B statement on the GST portal. The app compares them with your purchase register and flags mismatches. The app never reads the portal itself.</p>' +
      '<div class="row"><input id="rec-2b-total" type="number" inputmode="decimal" class="in" placeholder="Total ITC as per 2B (Rs)" value="' + esc(String(figures.total === undefined ? "" : figures.total)) + '"></div>' +
      '<div class="row"><input id="rec-vendor" class="in" placeholder="Vendor name"><input id="rec-vendor-itc" type="number" inputmode="decimal" class="in" placeholder="ITC as per 2B (Rs)"></div>' +
      '<div class="row"><button class="btn g" id="rec-add-vendor" style="flex:1">Add vendor figure</button></div>' +
      '<div id="rec-vendor-list">';
    if (!vendorRows.length) html += '<p class="sub">No vendor figures entered yet.</p>';
    vendorRows.forEach(function (v, i) {
      html += '<div class="cs stack" style="cursor:default"><span>' + esc(v.vendor) + '</span><span class="cs-actions"><b class="dd">' + money2(+v.itc || 0) + '</b><button class="btn sm g" data-rec-vdel="' + i + '">Remove</button></span></div>';
    });
    html += '</div>' +
      '<div class="row"><button class="btn" id="rec-run">Run reconciliation</button></div>' +
      '<div id="rec-result"></div>' +
      '<p class="sub" style="margin-top:8px" id="rec-status"></p></div>';
    box.innerHTML = html;

    $("rec-month").onchange = function () {
      REC_MONTH = $("rec-month").value || NMUtil.currentMonth();
      renderReconcile();
    };
    $("rec-g1-copy").onclick = function (e) { NMUtil.copyText(gstr1Text(b, REC_MONTH, monthSummary(b.id, REC_MONTH)), e.target); };
    $("rec-g1-csv").onclick = function () { NMUtil.download("gstr1-preparation-" + REC_MONTH + ".csv", gstr1Csv(b, REC_MONTH, monthSummary(b.id, REC_MONTH))); };
    $("rec-g3-copy").onclick = function (e) { NMUtil.copyText(gstr3bText(b, REC_MONTH, monthSummary(b.id, REC_MONTH)), e.target); };
    $("rec-g3-csv").onclick = function () {
      var s = monthSummary(b.id, REC_MONTH);
      NMUtil.download("gstr3b-preparation-" + REC_MONTH + ".csv", "GSTR-3B preparation summary," + b.name + "," + NMUtil.monthLabel(REC_MONTH) + "\nOutput tax on sales," + s.sTot.tax.toFixed(2) + "\nSales note adjustments," + s.salesAdj.toFixed(2) + "\nTotal output tax," + s.outputTax.toFixed(2) + "\nTotal ITC available," + s.itc.toFixed(2) + "\nNet tax payable," + s.netPayable.toFixed(2) + "\nExcess ITC," + s.excessItc.toFixed(2) + "\nPreparation support only, verify on the GST portal\n");
    };
    $("rec-add-vendor").onclick = function () {
      var v = $("rec-vendor").value.trim();
      var itc = $("rec-vendor-itc").value;
      if (!v) { $("rec-status").textContent = "Enter a vendor name."; return; }
      if (itc === "" || isNaN(+itc)) { $("rec-status").textContent = "Enter the ITC figure for this vendor."; return; }
      var totalVal = $("rec-2b-total").value;
      vendorRows.push({ vendor: v, itc: NMUtil.round2(+itc) });
      NMStore.save2B(b.id, REC_MONTH, { total: totalVal === "" ? "" : NMUtil.round2(+totalVal), vendors: vendorRows });
      renderReconcile();
    };
    box.querySelectorAll("[data-rec-vdel]").forEach(function (btn) {
      btn.onclick = function () {
        var totalVal = $("rec-2b-total").value;
        vendorRows.splice(+btn.getAttribute("data-rec-vdel"), 1);
        NMStore.save2B(b.id, REC_MONTH, { total: totalVal === "" ? "" : NMUtil.round2(+totalVal), vendors: vendorRows });
        renderReconcile();
      };
    });
    $("rec-run").onclick = function () {
      var totalVal = $("rec-2b-total").value;
      var figuresNow = { total: totalVal === "" ? "" : NMUtil.round2(+totalVal), vendors: vendorRows.slice() };
      NMStore.save2B(b.id, REC_MONTH, figuresNow);
      var result = computeReconcile(b.id, REC_MONTH, figuresNow);
      NMStore.saveReconcileRun({ biz: b.id, month: REC_MONTH, mismatchTotal: result.absMismatch, netDiff: result.netDiff, regTotal: result.regTotal, twoBTotal: result.twoBTotal, vendorCount: result.rows.length, missingCount: result.missingPurchases.length });
      var resBox = $("rec-result");
      var h = '<div class="bub" style="margin-top:10px">';
      h += "Reconciliation for " + NMUtil.monthLabel(REC_MONTH) + " (computed on this device from your purchase register and the 2B figures you entered).\n";
      h += "Purchase register ITC: " + money2(result.regTotal) + ". 2B vendor total: " + money2(result.twoBTotal) + ". Net difference (register minus 2B): " + money2(result.netDiff) + ". Total absolute mismatch across vendors: " + money2(result.absMismatch) + ".";
      if (result.enteredTotal !== null) h += "\n2B total you entered: " + money2(result.enteredTotal) + " (vendor figures add to " + money2(result.twoBTotal) + ").";
      h += "</div>";
      h += '<div style="margin-top:8px">';
      if (!result.rows.length) h += '<p class="sub">No purchase rows and no vendor figures for this month, so there is nothing to compare yet.</p>';
      result.rows.forEach(function (r) {
        var flag = Math.abs(r.diff) > 1 ? ' <span class="tag ver">MISMATCH ' + money2(r.diff) + '</span>' : ' <span class="tag ext">MATCHED</span>';
        h += '<div class="kv"><span>' + esc(r.vendor) + ' · register ' + money2(r.regItc) + ' vs 2B ' + money2(r.twoBItc) + flag + '<br><span class="sub">' + (r.regCount ? r.regCount + " invoice(s) in the register" : "no purchase row in the register") + '</span></span><b>' + money2(r.diff) + '</b></div>';
      });
      h += "</div>";
      if (result.missingPurchases.length) {
        h += '<div class="warn"><b>Vendors in 2B with no purchase invoice in the register:</b> ' + esc(result.missingPurchases.map(function (m) { return m.vendor + " (" + money2(m.itc) + ")"; }).join(", ")) + '. Add the missing purchase invoices or check the vendor name spelling.</div>';
      }
      if (result.missing2B.length) {
        h += '<div class="warn"><b>Purchase invoices with no matching 2B entry:</b> ' + esc(result.missing2B.map(function (m) { return m.vendor + " (" + money2(m.itc) + ")"; }).join(", ")) + '. The supplier may not have filed yet, or the vendor name may differ from 2B.</div>';
      }
      h += '<p class="sub" style="margin-top:8px">' + esc(PREP_NOTE) + '</p>';
      h += '<div id="rec-server"></div>';
      resBox.innerHTML = h;
      $("rec-status").textContent = "Reconciliation saved for " + NMUtil.monthLabel(REC_MONTH) + ". Filing readiness in Reports now counts this month as reconciled.";
      renderReports();
      if (NMSync.canPost()) {
        NMApi.request("/api/reconcile", { method: "POST", body: { month: REC_MONTH, twoB: figuresNow } }).then(function (res) {
          var srv = $("rec-server");
          if (!srv) return;
          if (res.ok && res.data) {
            var d = res.data;
            srv.innerHTML = '<div class="okbox">Server check: ' + esc(d.summary ? (typeof d.summary === "string" ? d.summary : JSON.stringify(d.summary)) : "returned " + (d.mismatches ? d.mismatches.length : 0) + " mismatch(es)") + (d.mismatches && d.mismatches.length ? "<br>" + esc(d.mismatches.map(function (m) { return typeof m === "string" ? m : JSON.stringify(m); }).join("; ")) : "") + '</div>';
          } else {
            srv.innerHTML = '<p class="sub">The server reconciliation did not return a result (' + esc(res.error || ("status " + res.status)) + '). The local result above stands.</p>';
          }
        });
      } else {
        var srv2 = $("rec-server");
        if (srv2) srv2.innerHTML = '<p class="sub">Computed locally. Sign in with the live server to also run the server check.</p>';
      }
    };
  }

  // ---------------- Expenses and bank statements ----------------
  function renderExpenses() {
    var box = $("biz-expenses");
    if (!box) return;
    var b = biz();
    var allTxns = NMStore.txns(b.id);
    var flags = NMStore.txnFlags(allTxns);
    var monthTxns = allTxns.filter(function (t) { return NMUtil.monthOf(t.date) === EXP_MONTH; });
    var search = EXP_SEARCH.trim().toLowerCase();
    var shown = monthTxns.filter(function (t) {
      if (!search) return true;
      return ((t.payee || "") + " " + (t.description || "")).toLowerCase().indexOf(search) !== -1;
    });
    var html = '<div class="panel"><div class="lbl"><span>BANK TRANSACTIONS AND EXPENSES</span><span>' + esc(b.name) + '</span></div>' +
      '<p class="sub">Import a bank statement CSV or add transactions by hand. Categories are suggested by rules; corrections are remembered per payee. Rows stay unreviewed until you confirm them. The tax-deductible flag is set by you only: the app never marks a transaction as deductible on its own, because deductibility depends on your books and your CA advice.</p>' +
      '<div class="row"><label class="sub">Month <input type="month" id="exp-month" class="in" value="' + EXP_MONTH + '"></label><input id="exp-search" class="in" placeholder="Search payee or description" value="' + esc(EXP_SEARCH) + '"></div></div>';

    html += '<div class="panel"><div class="lbl"><span>ADD TRANSACTION</span></div>' +
      '<div class="row"><input id="exp-date" type="date" class="in" value="' + new Date().toISOString().slice(0, 10) + '"><input id="exp-payee" class="in" placeholder="Payee"></div>' +
      '<div class="row"><input id="exp-desc" class="in" placeholder="Description (optional)"><input id="exp-amount" type="number" inputmode="decimal" class="in" placeholder="Amount Rs (negative = spent)"></div>' +
      '<div class="row"><select id="exp-cat" class="in">' + NMStore.TXN_CATEGORIES.map(function (c) { return '<option>' + c + '</option>'; }).join("") + '</select></div>' +
      '<label class="sub"><input type="checkbox" id="exp-ded"> I mark this as tax-deductible (manual only, your choice)</label>' +
      '<div class="row"><button class="btn" id="exp-save">Add transaction</button></div>' +
      '<p class="sub" id="exp-status" style="margin-top:8px"></p></div>';

    html += '<div class="panel"><div class="lbl"><span>TRANSACTIONS · ' + esc(NMUtil.monthLabel(EXP_MONTH)) + '</span><span>' + shown.length + ' SHOWN</span></div>';
    if (!shown.length) html += '<p class="sub" style="margin-top:8px">No transactions match. Import a statement below or add one above.</p>';
    shown.forEach(function (t) {
      var fl = flags[t.id] || [];
      var flagHtml = fl.map(function (f) {
        if (f === "duplicate") return '<span class="tag ver">POSSIBLE DUPLICATE</span>';
        if (f === "recurring") return '<span class="tag">RECURRING</span>';
        return '<span class="tag int">UNUSUAL AMOUNT (FLAG, NOT A VERDICT)</span>';
      }).join("");
      html += '<div class="cs" style="cursor:default;flex-direction:column;align-items:stretch;gap:6px"><div style="display:flex;justify-content:space-between;gap:8px"><span><b>' + esc(t.payee) + '</b> · ' + esc(t.date) + '<br><span class="sub">' + esc(t.description || "No description") + '</span></span><b class="dd">' + money2(t.amount) + '</b></div>' +
        '<div>' + flagHtml + (t.reviewed ? "" : ' <span class="tag int">UNREVIEWED</span>') + (t.deductible ? ' <span class="tag ext">DEDUCTIBLE (MANUAL)</span>' : "") + '</div>' +
        '<div class="row" style="margin-top:0"><select class="in" data-exp-cat="' + t.id + '">' + NMStore.TXN_CATEGORIES.map(function (c) { return '<option' + (t.category === c ? " selected" : "") + '>' + c + '</option>'; }).join("") + '</select></div>' +
        '<div class="row" style="margin-top:0"><label class="sub" style="align-self:center"><input type="checkbox" data-exp-ded="' + t.id + '"' + (t.deductible ? " checked" : "") + '> Deductible</label>' +
        '<label class="sub" style="align-self:center"><input type="checkbox" data-exp-rev="' + t.id + '"' + (t.reviewed ? " checked" : "") + '> Reviewed</label>' +
        '<button class="btn sm g" data-exp-del="' + t.id + '">Delete</button></div></div>';
    });
    html += '</div>';

    html += '<div class="panel"><div class="lbl"><span>BANK STATEMENT CSV IMPORT</span></div>' +
      '<p class="sub" style="margin-top:8px">Expected column order, one row per line: <b>date, payee, description, amount</b>. Amount is negative for money out and positive for money in. Dates as YYYY-MM-DD or DD/MM/YYYY. The first line may be a header row. Rows that duplicate an existing transaction (same date, payee and amount) are imported but flagged as possible duplicates, never silently skipped.</p>' +
      '<div class="row"><label class="btn g" style="text-align:center;flex:1">Choose CSV file<input id="exp-file" type="file" accept=".csv,text/csv" hidden></label></div>' +
      '<textarea id="exp-paste" placeholder="Or paste statement rows here, for example:&#10;2026-11-03, Swiggy, Food delivery, -450"></textarea>' +
      '<div class="row"><button class="btn" id="exp-import">Import pasted CSV</button></div>' +
      '<div class="bub hid" id="exp-import-result"></div></div>';

    var income = 0, outgo = 0, unreviewed = 0;
    var byCat = {};
    monthTxns.forEach(function (t) {
      if (+t.amount > 0) income += +t.amount;
      else outgo += Math.abs(+t.amount || 0);
      if (!t.reviewed) unreviewed++;
      var c = t.category || "Uncategorised";
      byCat[c] = (byCat[c] || 0) + (+t.amount || 0);
    });
    var daysInMonth = new Date(+EXP_MONTH.slice(0, 4), +EXP_MONTH.slice(5, 7), 0).getDate();
    var today = new Date();
    var isCurrentMonth = EXP_MONTH === NMUtil.currentMonth();
    var elapsed = isCurrentMonth ? today.getDate() : daysInMonth;
    var projIn = elapsed ? NMUtil.round2(income / elapsed * daysInMonth) : 0;
    var projOut = elapsed ? NMUtil.round2(outgo / elapsed * daysInMonth) : 0;
    var salesTotal = NMStore.regTotals(NMStore.regForMonth("sales", b.id, EXP_MONTH)).total;
    html += '<div class="panel"><div class="lbl"><span>MONTHLY SUMMARY · ' + esc(NMUtil.monthLabel(EXP_MONTH)) + '</span></div>' +
      '<div class="kv"><span>Money in</span><b>' + money2(income) + '</b></div>' +
      '<div class="kv"><span>Money out</span><b>' + money2(outgo) + '</b></div>' +
      '<div class="kv"><span>Net</span><b>' + money2(income - outgo) + '</b></div>' +
      '<div class="kv"><span>Unreviewed transactions</span><b>' + unreviewed + '</b></div>' +
      '<p class="sub" style="margin-top:8px">By category (signed totals):</p>';
    Object.keys(byCat).sort().forEach(function (c) {
      html += '<div class="kv"><span>' + esc(c) + '</span><b>' + money2(byCat[c]) + '</b></div>';
    });
    html += '<div class="kv"><span>Estimated cash flow for the month (money in minus money out, run rate)</span><b>' + money2(projIn - projOut) + '</b></div>' +
      '<p class="sub">Estimate method: ' + (isCurrentMonth ? "month to date totals divided by " + elapsed + " elapsed days, times " + daysInMonth + " days in the month." : "the month is complete, so the estimate equals the actual totals.") + ' This is an estimate from bank transactions only, not a bank balance.</p>' +
      '<div class="lbl" style="margin-top:12px"><span>PROFIT AND LOSS (BANK TRANSACTIONS)</span></div>' +
      '<div class="kv"><span>Income (bank credits)</span><b>' + money2(income) + '</b></div>' +
      '<div class="kv"><span>Expenses (bank debits)</span><b>' + money2(outgo) + '</b></div>' +
      '<div class="kv"><span>Profit / loss</span><b>' + money2(income - outgo) + '</b></div>' +
      '<p class="sub">Sales register total for the month is ' + money2(salesTotal) + '. It is shown for reference and is NOT added here, because register sales may overlap with bank receipts and adding both would double count income.</p></div>';
    box.innerHTML = html;

    $("exp-month").onchange = function () { EXP_MONTH = $("exp-month").value || NMUtil.currentMonth(); renderExpenses(); };
    $("exp-search").oninput = function () { EXP_SEARCH = $("exp-search").value; renderExpenses(); var s = $("exp-search"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } };
    $("exp-save").onclick = function () {
      var date = $("exp-date").value;
      var payee = $("exp-payee").value.trim();
      var amount = $("exp-amount").value;
      var status = $("exp-status");
      if (!date) { status.textContent = "Pick a date."; return; }
      if (!payee) { status.textContent = "Enter the payee."; return; }
      if (amount === "" || isNaN(+amount) || +amount === 0) { status.textContent = "Enter a non-zero amount (negative for money spent)."; return; }
      var row = {
        date: date, payee: payee, description: $("exp-desc").value.trim(),
        amount: NMUtil.round2(+amount), category: $("exp-cat").value,
        deductible: $("exp-ded").checked, reviewed: true
      };
      NMStore.txnAdd(row);
      NMStore.learnPayeeRule(payee, row.category);
      NMSync.postOrQueue("expense_import", "/api/expenses/import", "POST", { rows: [row] }).then(function (res) {
        renderExpenses();
        var st = $("exp-status");
        if (st) st.textContent = "Transaction added. " + res.reason;
      });
    };
    box.querySelectorAll("[data-exp-cat]").forEach(function (sel) {
      sel.onchange = function () {
        var id = sel.getAttribute("data-exp-cat");
        var txn = NMStore.txns().filter(function (t) { return t.id === id; })[0];
        NMStore.txnUpdate(id, { category: sel.value, reviewed: true });
        if (txn) NMStore.learnPayeeRule(txn.payee, sel.value);
        renderExpenses();
      };
    });
    box.querySelectorAll("[data-exp-ded]").forEach(function (cb) {
      cb.onchange = function () { NMStore.txnUpdate(cb.getAttribute("data-exp-ded"), { deductible: cb.checked }); renderExpenses(); };
    });
    box.querySelectorAll("[data-exp-rev]").forEach(function (cb) {
      cb.onchange = function () { NMStore.txnUpdate(cb.getAttribute("data-exp-rev"), { reviewed: cb.checked }); renderExpenses(); };
    });
    box.querySelectorAll("[data-exp-del]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("Delete this transaction? This cannot be undone.")) return;
        NMStore.txnDelete(btn.getAttribute("data-exp-del"));
        renderExpenses();
      };
    });
    function importText(text) {
      var parsed = NMCSV.parseTransactions(text);
      var existing = NMStore.txns(b.id);
      var dupKeys = {};
      existing.forEach(function (t) { dupKeys[t.date + "|" + String(t.payee).toLowerCase() + "|" + t.amount] = true; });
      var added = [], dupCount = 0;
      parsed.good.forEach(function (row) {
        var k = row.date + "|" + row.payee.toLowerCase() + "|" + row.amount;
        if (dupKeys[k]) dupCount++;
        dupKeys[k] = true;
        var suggestion = NMStore.suggestCategory(row.payee, row.description, row.amount);
        var saved = NMStore.txnAdd({
          date: row.date, payee: row.payee, description: row.description, amount: row.amount,
          category: suggestion.category, deductible: false, reviewed: false
        });
        added.push(saved);
      });
      var result = $("exp-import-result");
      result.classList.remove("hid");
      result.textContent = "Importing " + added.length + " transaction(s)…";
      NMSync.postOrQueue("expense_import", "/api/expenses/import", "POST", { rows: added }).then(function (res) {
        var lines = ["Imported " + added.length + " transaction(s). " + dupCount + " flagged as possible duplicates on import. " + parsed.bad.length + " row(s) had problems and were not imported."];
        parsed.bad.forEach(function (b2) { lines.push("Line " + b2.line + ": " + b2.reason); });
        lines.push(res.reason + ". Imported rows stay unreviewed until you confirm their categories. Nothing was marked tax-deductible.");
        renderExpenses();
        var r2 = $("exp-import-result");
        if (r2) { r2.classList.remove("hid"); r2.textContent = lines.join("\n"); }
      });
    }
    $("exp-import").onclick = function () {
      var text = $("exp-paste").value.trim();
      if (!text) {
        var r = $("exp-import-result");
        r.classList.remove("hid");
        r.textContent = "Paste statement rows first, or choose a CSV file.";
        return;
      }
      importText(text);
    };
    $("exp-file").onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { importText(String(reader.result || "")); };
      reader.readAsText(f);
    };
  }

  // ---------------- Reports dashboard ----------------
  function renderReports() {
    var box = $("biz-reports");
    if (!box) return;
    var b = biz();
    var summary = monthSummary(b.id, REP_MONTH);
    var lastRun = NMStore.lastReconcileRun(b.id, REP_MONTH);
    var daysInMonth = new Date(+REP_MONTH.slice(0, 4), +REP_MONTH.slice(5, 7), 0).getDate();
    var isCurrentMonth = REP_MONTH === NMUtil.currentMonth();
    var elapsed = isCurrentMonth ? new Date().getDate() : daysInMonth;
    var forecastOutput = elapsed ? NMUtil.round2(summary.outputTax / elapsed * daysInMonth) : 0;
    var forecastPayable = Math.max(0, NMUtil.round2(forecastOutput - summary.itc));
    var html = '<div class="panel"><div class="lbl"><span>BUSINESS REPORTS</span><span>' + esc(b.name) + '</span></div>' +
      '<div class="row"><label class="sub">Month <input type="month" id="rep-month" class="in" value="' + REP_MONTH + '"></label></div></div>';

    html += '<div class="panel"><div class="lbl"><span>MONTHLY GST SUMMARY · ' + esc(NMUtil.monthLabel(REP_MONTH)) + '</span></div>' +
      '<div class="kv"><span>Sales taxable value</span><b>' + money2(summary.sTot.taxable) + '</b></div>' +
      '<div class="kv"><span>Sales tax</span><b>' + money2(summary.sTot.tax) + '</b></div>' +
      '<div class="kv"><span>Sales total</span><b>' + money2(summary.sTot.total) + '</b></div>' +
      '<div class="kv"><span>Purchase taxable value</span><b>' + money2(summary.pTot.taxable) + '</b></div>' +
      '<div class="kv"><span>ITC available</span><b>' + money2(summary.itc) + '</b></div>' +
      '<div class="kv"><span>Net tax payable</span><b>' + money2(summary.netPayable) + '</b></div>' +
      '<div class="kv"><span>Notes this month</span><b>' + summary.notes.length + '</b></div>' +
      '<p class="sub" style="margin-top:8px">' + esc(PREP_NOTE) + '</p></div>';

    html += '<div class="panel"><div class="lbl"><span>GST LIABILITY FORECAST (ESTIMATE)</span></div>' +
      '<div class="kv"><span>Forecast output tax for the month</span><b>' + money2(forecastOutput) + '</b></div>' +
      '<div class="kv"><span>Less ITC so far</span><b>' + money2(summary.itc) + '</b></div>' +
      '<div class="kv"><span>Forecast net payable</span><b>' + money2(forecastPayable) + '</b></div>' +
      '<p class="sub">Estimate method: output tax recorded so far, divided by ' + elapsed + ' elapsed day(s), times ' + daysInMonth + ' days in the month, minus ITC recorded so far, floored at zero. ' + (isCurrentMonth ? "The month is still running, so this is a run-rate estimate, not a final figure." : "The month is complete, so the forecast equals the recorded figures.") + '</p></div>';

    var salesComplete = summary.sales.length > 0 && summary.sales.every(function (r) { return r.party && r.invoice; });
    var purchComplete = summary.purch.length > 0 && summary.purch.every(function (r) { return r.party && r.invoice; });
    var reconciled = !!lastRun;
    var itcMatched = !!(lastRun && Math.abs(lastRun.mismatchTotal || 0) <= 1);
    var monthTxns = NMStore.txnsForMonth(b.id, REP_MONTH);
    var dupCount = 0;
    var seen = {};
    monthTxns.forEach(function (t) {
      var k = t.date + "|" + String(t.payee).toLowerCase() + "|" + t.amount;
      if (seen[k]) dupCount++;
      seen[k] = true;
    });
    var checks = [
      { ok: salesComplete, label: "Sales register complete", detail: summary.sales.length ? (salesComplete ? summary.sales.length + " rows, every row has a party and invoice number." : "some rows are missing a party or invoice number.") : "no sales rows this month." },
      { ok: purchComplete, label: "Purchase register complete", detail: summary.purch.length ? (purchComplete ? summary.purch.length + " rows, every row has a party and invoice number." : "some rows are missing a party or invoice number.") : "no purchase rows this month." },
      { ok: reconciled, label: "2B reconciled", detail: reconciled ? "a reconciliation run is saved for this month." : "no reconciliation run saved for this month yet. Run one in the reconciliation section." },
      { ok: itcMatched, label: "ITC matched", detail: lastRun ? ("last run mismatch total " + money2(lastRun.mismatchTotal || 0) + (itcMatched ? " (within Rs 1)." : ", above Rs 1.")) : "not checked yet." },
      { ok: dupCount === 0, label: "No duplicate transactions flagged", detail: dupCount ? dupCount + " possible duplicate(s) this month. Review them in Expenses." : "no duplicates detected this month." }
    ];
    html += '<div class="panel"><div class="lbl"><span>FILING READINESS · ' + esc(NMUtil.monthLabel(REP_MONTH)) + '</span></div>' +
      '<p class="sub" style="margin-top:8px">A register counts as complete when it has at least one row for the month and every row has a party and an invoice number. ITC counts as matched when the last reconciliation run for the month shows a mismatch total within Rs 1.</p>';
    checks.forEach(function (c) {
      html += '<div class="kv"><span>' + (c.ok ? "Done: " : "Pending: ") + esc(c.label) + '<br><span class="sub">' + esc(c.detail) + '</span></span><b>' + (c.ok ? "Yes" : "No") + '</b></div>';
    });
    html += '</div>';

    html += '<div class="panel"><div class="lbl"><span>AI MONTHLY BUSINESS REPORT</span></div>' +
      '<p class="sub" style="margin-top:8px">Asks the AI service for a short report from this month summary. Needs the live server.</p>' +
      '<div class="row"><button class="btn" id="rep-ai">Get AI monthly report</button></div>' +
      '<div class="bub hid" id="rep-ai-result"></div></div>';

    var allUnpaidSales = NMStore.regList("sales", b.id).filter(function (r) { return r.unpaid; });
    var savedInvoices = NMStore.invoices();
    html += '<div class="panel"><div class="lbl"><span>PAYMENT REMINDERS</span></div>' +
      '<p class="sub" style="margin-top:8px">Unpaid sales register rows and saved invoices you marked unpaid. Reminders open WhatsApp with a ready message. Nothing is sent automatically.</p>';
    if (!allUnpaidSales.length && !savedInvoices.length) html += '<p class="sub">No unpaid rows and no saved invoices yet.</p>';
    allUnpaidSales.forEach(function (r) {
      var text = "Payment reminder: invoice " + (r.invoice || "(no number)") + " dated " + r.date + " for " + money2(r.total) + " is still unpaid. Please arrange payment at the earliest. Thank you, " + b.name + ".";
      html += '<div class="cs stack" style="cursor:default"><span><b>' + esc(r.party) + '</b> · Inv ' + esc(r.invoice || "-") + ' · ' + esc(r.date) + '</span><span class="cs-actions"><b class="dd">' + money2(r.total) + '</b>' +
        '<button class="btn sm g" data-rem-wa="' + esc(text) + '">WhatsApp</button>' +
        '<button class="btn sm g" data-rem-paid="' + r.id + '">Mark paid</button></span></div>';
    });
    if (savedInvoices.length) {
      html += '<p class="sub" style="margin-top:10px">Saved invoices (tick Unpaid to add one to reminders):</p>';
      savedInvoices.slice(0, 10).forEach(function (inv) {
        var text = "Payment reminder: your invoice dated " + (inv.date || "") + " for " + (inv.total || "") + " is still unpaid. Please arrange payment at the earliest. Thank you, " + b.name + ".";
        html += '<div class="cs stack" style="cursor:default"><span>' + esc(inv.buyer || "Invoice") + ' · ' + esc(inv.date || "") + '</span><span class="cs-actions"><b class="dd">' + esc(inv.total || "") + '</b>' +
          '<label class="sub"><input type="checkbox" data-inv-unpaid="' + inv.id + '"' + (inv.unpaid ? " checked" : "") + '> Unpaid</label>' +
          (inv.unpaid ? '<button class="btn sm g" data-rem-wa="' + esc(text) + '">WhatsApp</button>' : "") + '</span></div>';
      });
    }
    html += '</div>';

    var customers = NMStore.regByParty(NMStore.regList("sales", b.id));
    var suppliers = NMStore.regByParty(NMStore.regList("purchases", b.id));
    function partyList(title, parties, prefix) {
      var h = '<div class="lbl" style="margin-top:12px"><span>' + title + '</span></div>';
      if (!parties.length) h += '<p class="sub">None yet. Parties appear here from your registers.</p>';
      parties.forEach(function (p) {
        var key = prefix + ":" + p.party;
        h += '<button class="cs" data-party="' + esc(key) + '"><span>' + esc(p.party) + ' · ' + p.count + ' invoice(s)</span><b class="dd">' + money2(p.total) + '</b></button>';
        if (PARTY_OPEN === key) {
          p.rows.forEach(function (r) {
            h += '<div class="cs" style="cursor:default"><span>' + esc(r.date) + ' · Inv ' + esc(r.invoice || "-") + ' · taxable ' + money2(r.taxable) + '</span><b class="dd">' + money2(r.total) + '</b></div>';
          });
        }
      });
      return h;
    }
    html += '<div class="panel"><div class="lbl"><span>CUSTOMERS AND SUPPLIERS</span></div>' +
      '<p class="sub" style="margin-top:8px">Derived from your registers. There is no separate address book: parties and totals come from the invoices you already entered.</p>' +
      partyList("CUSTOMERS (FROM SALES REGISTER)", customers, "c") +
      partyList("SUPPLIERS (FROM PURCHASE REGISTER)", suppliers, "s") + '</div>';
    box.innerHTML = html;

    $("rep-month").onchange = function () { REP_MONTH = $("rep-month").value || NMUtil.currentMonth(); renderReports(); };
    $("rep-ai").onclick = function () {
      var result = $("rep-ai-result");
      result.classList.remove("hid");
      result.textContent = "Asking for your monthly report…";
      $("rep-ai").disabled = true;
      var s = monthSummary(b.id, REP_MONTH);
      var summaryText = "Business: " + b.name + ". Month: " + NMUtil.monthLabel(REP_MONTH) +
        ". Sales: " + s.sales.length + " invoices, taxable " + money2(s.sTot.taxable) + ", tax " + money2(s.sTot.tax) + ", total " + money2(s.sTot.total) +
        ". Purchases: " + s.purch.length + " invoices, ITC " + money2(s.itc) +
        ". Net tax payable: " + money2(s.netPayable) + ". Excess ITC: " + money2(s.excessItc) +
        ". Notes: " + s.notes.length + ". Last 2B reconciliation mismatch: " + (lastRun ? money2(lastRun.mismatchTotal || 0) : "not run") + ".";
      NMApi.probeLive().then(function (live) {
        if (!live) {
          result.textContent = "The AI monthly report needs the live server, which is not reachable right now. Your month summary is in the panels above.";
          $("rep-ai").disabled = false;
          return null;
        }
        return NMApi.orchestrate(
          [{ role: "user", content: "Write a short monthly business report from this summary. Cover sales, ITC, the net GST payable, and two practical next steps. Do not invent figures. Say what to verify on the GST portal.\n\n" + summaryText }],
          { profile_type: NMStore.getProfile().type, business: b.name, month: REP_MONTH, summary: summaryText }
        );
      }).then(function (res) {
        if (!res) return;
        $("rep-ai").disabled = false;
        if (res.ok && res.data && res.data.answer) {
          var text = res.data.answer;
          if (res.data.sources && res.data.sources.length) {
            text += "\n\nSources: " + res.data.sources.map(function (src) { return src.title || "Untitled"; }).join("; ");
          }
          result.textContent = text;
        } else if (res.status === 402) {
          result.textContent = "You are out of AI calls for today (20 free calls a day). The Notice pack and Pro month add more. See Profile for details.";
        } else {
          result.textContent = "The AI report did not come back (" + (res.error || ("status " + res.status)) + "). Your month summary is in the panels above.";
        }
      }).catch(function () {
        $("rep-ai").disabled = false;
        result.textContent = "The AI monthly report needs the live server, which is not reachable right now.";
      });
    };
    box.querySelectorAll("[data-rem-wa]").forEach(function (btn) {
      btn.onclick = function () { window.open("https://wa.me/?text=" + encodeURIComponent(btn.getAttribute("data-rem-wa")), "_blank"); };
    });
    box.querySelectorAll("[data-rem-paid]").forEach(function (btn) {
      btn.onclick = function () {
        NMStore.regUpdate("sales", btn.getAttribute("data-rem-paid"), { unpaid: false });
        renderReports();
      };
    });
    box.querySelectorAll("[data-inv-unpaid]").forEach(function (cb) {
      cb.onchange = function () {
        NMStore.setInvoiceUnpaid(cb.getAttribute("data-inv-unpaid"), cb.checked);
        renderReports();
      };
    });
    box.querySelectorAll("[data-party]").forEach(function (btn) {
      btn.onclick = function () {
        var key = btn.getAttribute("data-party");
        PARTY_OPEN = PARTY_OPEN === key ? null : key;
        renderReports();
      };
    });
  }

  // ---------------- Wiring ----------------
  function renderAll() {
    NMStore.ensureDefaultBusiness();
    renderRegisters();
    renderReconcile();
    renderExpenses();
    renderNotes();
    renderReports();
    if (window.NMSync) NMSync.flush();
  }
  window.NMBizExt = {
    renderAll: renderAll,
    renderRegisters: renderRegisters,
    renderReconcile: renderReconcile,
    renderExpenses: renderExpenses,
    renderNotes: renderNotes,
    renderReports: renderReports,
    monthSummary: monthSummary,
    computeReconcile: computeReconcile
  };
  if (window.NMBusiness && NMBusiness.render) {
    var origBusinessRender = NMBusiness.render;
    NMBusiness.render = function (el, options) {
      origBusinessRender.call(this, el, options);
      renderAll();
    };
  }
  // Home overview wording follows the active business: a banner with the
  // active business name and this month figures, added without editing
  // home.js. The rest of Home renders exactly as W4a built it.
  if (window.NMHome && NMHome.render) {
    var origHomeRender = NMHome.render;
    NMHome.render = function (el, options) {
      origHomeRender.call(this, el, options);
      try {
        var b = NMStore.activeBusiness();
        var s = monthSummary(b.id, NMUtil.currentMonth());
        var banner = document.createElement("div");
        banner.className = "panel";
        banner.innerHTML = '<div class="lbl"><span>ACTIVE BUSINESS</span></div>' +
          '<p style="margin:8px 0 0;font-size:15px"><b>' + esc(b.name) + '</b>' + (b.gstin ? ' · GSTIN ' + esc(b.gstin) : "") + ' · ' + esc(NMStore.businessTypeLabel(b.type)) + '</p>' +
          '<p class="sub">This month: sales ' + money2(s.sTot.total) + ', ITC ' + money2(s.itc) + ', net payable ' + money2(s.netPayable) + '. Business figures across the app use this business.</p>' +
          '<div class="row"><button class="btn sm g" id="home-switch-biz">Switch business</button></div>';
        el.insertBefore(banner, el.firstChild);
        var sw = document.getElementById("home-switch-biz");
        if (sw) sw.onclick = function () { NMApp.show("profile"); };
      } catch (e) {}
    };
  }
})();
