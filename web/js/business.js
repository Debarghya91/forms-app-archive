// NMBusiness: Business destination. This wave moves in the EXISTING
// invoice maker and ITR tools, working, with their explainer copy, and
// computes everything from the versioned tax packs (NMTax).
// EXTENSION POINTS for the next worker (do not rewrite this file):
//   #biz-registers  : sales and purchase registers, ITC workings
//   #biz-reconcile  : 2B-style reconciliation against user-entered figures
//   #biz-expenses   : expense capture, import, categorisation
//   #biz-notes      : credit and debit notes
//   #biz-reports    : monthly summaries and exports
// Each extension point is an empty section container below. The next
// worker renders into it and adds its own nav anchor in render().
(function () {
  "use strict";
  function esc(s) { return window.NMAuth ? NMAuth.esc(s) : String(s); }
  function $(id) { return document.getElementById(id); }
  var FORM_CHECKS = [
    ["sal", "Salary / pension"],
    ["pre", "Presumptive business (44AD/44ADA)"],
    ["biz", "Regular business or profession with books"],
    ["cg", "Capital gains (shares, MF, property)"],
    ["fa", "Foreign assets, company director or unlisted shares"],
    ["big", "Total income above Rs 50 lakh"]
  ];
  function money2(n) {
    return "Rs " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function invoiceText() {
    var g = function (id) { return $(id) ? $(id).value : ""; };
    var q = +g("iq") || 0, r = +g("ir") || 0, p = +g("ig");
    var tx = q * r;
    var split = NMTax.gstSplit(tx, p, $("is").checked);
    var tax = $("is").checked
      ? "IGST @" + p + "%: " + money2(split.igst)
      : "CGST @" + (p / 2) + "%: " + money2(split.cgst) + "\nSGST @" + (p / 2) + "%: " + money2(split.sgst);
    return "TAX INVOICE\nDate: " + new Date().toLocaleDateString("en-IN") +
      "\nFrom: " + (g("sn") || "[Seller]") + " GSTIN " + (g("sg") || "[GSTIN]") +
      "\nTo: " + (g("bn") || "[Buyer]") +
      "\n\n" + (g("it") || "[Item]") + " (HSN " + (g("hs") || "-") + ")" +
      "\n" + q + " x " + money2(r) + " = " + money2(tx) +
      "\n" + tax + "\nTOTAL: " + money2(split.total);
  }
  function formAnswers() {
    var s = {};
    document.querySelectorAll("#fc input").forEach(function (c) { s[c.value] = c.checked; });
    return s;
  }
  function runFormFinder() {
    var res = NMTax.itrForm(formAnswers());
    var r = $("fr");
    r.classList.remove("hid");
    r.textContent = res.form
      ? "Likely form: " + res.form + ". " + res.caveats.join(" ")
      : "Tick at least one income type.";
    return res.form;
  }
  function runRegimeCompare() {
    var g = +($("tg").value || 0);
    var d = +($("td").value || 0);
    var s = $("ts").checked;
    var res = NMTax.regimeCompare(g, d, s);
    var r = $("tr");
    r.classList.remove("hid");
    r.textContent = g
      ? "New regime: taxable " + NMTax.money(res.newTaxable) + ", tax " + NMTax.money(res.newTax) +
      "\nOld regime: taxable " + NMTax.money(res.oldTaxable) + ", tax " + NMTax.money(res.oldTax) +
      "\n" + (res.cheaper === "new" ? "New" : "Old") + " regime is cheaper by " + NMTax.money(res.cheaperBy) + "." +
      "\n" + res.assumptions.join(" ") + " Confirm with your CA."
      : "Enter your yearly income.";
    return r.textContent;
  }
  function langName() {
    var lang = NMStore.getProfile().language;
    return { hi: "simple Hindi (Devanagari)", en: "simple English", hg: "Hinglish (Hindi in Roman script)" }[lang] || "Hinglish (Hindi in Roman script)";
  }
  window.NMBusiness = {
    render: function (el, options) {
      options = options || {};
      var profile = NMStore.getProfile();
      var rates = NMTax.gstRates();
      var legacyRates = NMTax.gstLegacyRates();
      var rateOpts = rates.map(function (r) {
        return '<option value="' + r + '"' + (r === 18 ? " selected" : "") + '>' + r + '</option>';
      }).join("") + legacyRates.map(function (r) {
        return '<option value="' + r + '">' + r + ' (legacy)</option>';
      }).join("");
      var html = "";
      // Invoice maker (moved in working, explainer copy preserved).
      html += '<div class="panel why"><div class="lbl"><span>HOW THIS WORKS</span><span>INVOICE</span></div>' +
        '<p>Fill in your business, the buyer, and one item. The invoice text below updates as you type. Same state sale: the rate splits into CGST and SGST, half each. Other state sale: tick the box and the full rate becomes IGST. Then copy the text or send it on WhatsApp.</p></div>' +
        '<div class="panel" id="biz-invoice"><div class="lbl"><span>GST INVOICE MAKER</span></div>' +
        '<div class="row"><input id="sn" class="in" placeholder="Your business name" value="' + esc(profile.businessName) + '"><input id="sg" class="in" placeholder="Your GSTIN"></div>' +
        '<div class="row"><input id="bn" class="in" placeholder="Buyer name"></div>' +
        '<div class="row"><input id="it" class="in" placeholder="Item"><input id="hs" class="in" placeholder="HSN" style="max-width:80px"></div>' +
        '<div class="row"><input id="iq" type="number" class="in" placeholder="Qty"><input id="ir" type="number" class="in" placeholder="Rate Rs"><select id="ig" class="in">' + rateOpts + '</select></div>' +
        '<label class="sub"><input type="checkbox" id="is"> Other state (IGST)</label>' +
        '<p class="sub">Current rates are 0, 5, 18 and 40 percent (Notification 9/2025-Central Tax (Rate), w.e.f. 22 Sep 2025). Rates marked legacy (12, 28) are for old invoices only.</p>' +
        '<pre class="inv" id="io"></pre>' +
        '<div class="row"><button class="btn g" id="ic" style="flex:1">Copy</button><button class="btn g" id="isave" style="flex:1">Save invoice</button><button class="btn" id="iw">Send on WhatsApp</button></div>' +
        '<p class="sub" id="isave-note" style="margin-top:8px">GST rates come from rule pack v' + (NMTax.packs().gst.version || 1) + '. ' + esc(NMTax.verifyNote()) + '</p></div>';
      // Saved invoices.
      var saved = NMStore.invoices();
      html += '<div class="panel"><div class="lbl"><span>SAVED INVOICES</span><span>' + saved.length + ' SAVED</span></div><div id="inv-list">';
      if (!saved.length) html += '<p class="sub" style="margin-top:8px">No saved invoices yet. Saving keeps the invoice text on this device, and on your account when signed in and the server is reachable.</p>';
      else saved.slice(0, 10).forEach(function (inv) {
        html += '<div class="cs" style="cursor:default"><span>' + esc(inv.buyer || "Invoice") + ' · ' + esc(inv.date || "") + '</span><b class="dd">' + esc(inv.total || "") + '</b></div>';
      });
      html += '</div></div>';
      // ITR tools (moved in working, explainer copy preserved).
      html += '<div class="panel why" id="biz-itr"><div class="lbl"><span>HOW THIS WORKS</span><span>ITR</span></div>' +
        '<p>Three steps to a filing sheet. First, upload photos of Form 16, AIS, 26AS or interest certificates and the team reads the numbers. Second, answer the income questions to find your ITR form. Third, compare the new and old regimes. The filing sheet then collects the numbers to enter on the income tax portal.</p></div>' +
        '<div class="panel"><div class="lbl"><span>AUTOPILOT</span><span>FORM 16 · AIS · BILLS</span></div>' +
        '<p class="sub">Upload photos of Form 16, AIS or 26AS, and interest certificates. The team reads them, picks your form, compares regimes and writes your filing sheet.</p>' +
        '<div class="row"><label class="btn" style="text-align:center">Upload documents<input id="ap" type="file" accept="image/*" multiple hidden></label></div>' +
        '<p class="sub" id="aps"></p><div class="bub hid" id="apr"></div>' +
        '<div class="row"><button class="btn g" id="apc" style="flex:1">Copy filing sheet</button><button class="btn" id="apo">Open e-filing portal</button></div></div>' +
        '<div class="panel"><div class="lbl"><span>1 · WHICH ITR FORM?</span><span>AY 2026-27</span></div><div id="fc" style="margin-top:8px"></div>' +
        '<div class="row"><button class="btn" id="fbtn">Find my form</button></div><div class="bub hid" id="fr"></div></div>' +
        '<div class="panel"><div class="lbl"><span>2 · NEW vs OLD REGIME</span></div>' +
        '<div class="row"><input id="tg" type="number" inputmode="numeric" class="in" placeholder="Yearly income Rs"><input id="td" type="number" inputmode="numeric" class="in" placeholder="Old-regime deductions Rs"></div>' +
        '<label class="sub"><input type="checkbox" id="ts" checked> Salaried (standard deduction)</label>' +
        '<p class="sub">Deductions = 80C, 80D, HRA, home loan interest etc. added together.</p>' +
        '<div class="row"><button class="btn" id="tbtn">Compare tax</button></div><div class="bub hid" id="tr"></div>' +
        '<p class="sub" style="margin-top:8px">' + esc(NMTax.verifyNote()) + '</p></div>' +
        '<div class="panel"><div class="lbl"><span>3 · FILING STEPS</span></div>' +
        '<p class="sub" style="white-space:pre-wrap">Keep ready: PAN linked to Aadhaar, Form 16, AIS and Form 26AS, bank interest certificates, capital gains statements, rent and investment proofs, and for business your profit and loss and bank statements.\n\nOn incometax.gov.in: log in, e-File, Income Tax Returns, File ITR, pick AY 2026-27, check the pre-filled data against AIS, choose the regime, pay any balance tax, submit, then e-verify (Aadhaar OTP or net banking) within 30 days.\n\nMissed the due date? A belated return is usually allowed until 31 Dec with a late fee. Verify on the portal.</p>' +
        '<div class="row"><button class="btn g" id="ia" style="flex:1">Ask Virtual CA about my ITR</button></div></div>';
      // Extension point containers for the next worker. Empty on purpose:
      // no placeholder tabs, no dead buttons, nothing rendered until the
      // next worker fills them.
      html += '<!-- EXTENSION POINT: registers (sales, purchases, ITC) --><section id="biz-registers"></section>' +
        '<!-- EXTENSION POINT: reconciliation --><section id="biz-reconcile"></section>' +
        '<!-- EXTENSION POINT: expenses --><section id="biz-expenses"></section>' +
        '<!-- EXTENSION POINT: credit and debit notes --><section id="biz-notes"></section>' +
        '<!-- EXTENSION POINT: reports --><section id="biz-reports"></section>';
      html += '<p class="dis">Not legal advice. Check numbers on gst.gov.in and incometax.gov.in before you file.</p>';
      el.innerHTML = html;

      // Invoice wiring.
      var invPanel = $("biz-invoice");
      function refreshInv() { $("io").textContent = invoiceText(); }
      invPanel.addEventListener("input", refreshInv);
      invPanel.addEventListener("change", refreshInv);
      refreshInv();
      $("ic").onclick = function () {
        if (navigator.clipboard) navigator.clipboard.writeText(invoiceText()).then(function () { $("ic").textContent = "Copied"; }).catch(function () {});
      };
      $("iw").onclick = function () { window.open("https://wa.me/?text=" + encodeURIComponent(invoiceText()), "_blank"); };
      $("isave").onclick = function () {
        var text = invoiceText();
        var q = +$("iq").value || 0, r = +$("ir").value || 0, p = +$("ig").value;
        var split = NMTax.gstSplit(q * r, p, $("is").checked);
        var record = {
          id: "inv-" + Date.now(), date: new Date().toISOString().slice(0, 10),
          buyer: $("bn").value || "", seller: $("sn").value || "",
          item: $("it").value || "", total: money2(split.total), text: text
        };
        NMStore.saveInvoice(record);
        var note = $("isave-note");
        note.textContent = "Invoice saved on this device.";
        if (window.NMApi && window.NMAuth && NMAuth.configured() && !NMAuth.isLocalMode()) {
          NMApi.createInvoice(record).then(function (res) {
            if (res.ok) note.textContent = "Invoice saved on this device and on your account.";
            else { NMStore.enqueue("invoice", record); note.textContent = "Invoice saved on this device. It will sync when the server is reachable."; }
          });
        }
      };
      // Form finder wiring.
      FORM_CHECKS.forEach(function (fc) {
        var l = document.createElement("label");
        l.className = "sub"; l.style.display = "block";
        var cb = document.createElement("input");
        cb.type = "checkbox"; cb.value = fc[0];
        l.appendChild(cb);
        l.appendChild(document.createTextNode(" " + fc[1]));
        $("fc").appendChild(l);
      });
      $("fbtn").onclick = runFormFinder;
      $("tbtn").onclick = runRegimeCompare;
      $("ia").onclick = function () {
        var f = NMTax.itrForm(formAnswers()).form;
        var g = $("tg").value;
        var q = "Help me file my ITR for AY 2026-27. " + (f ? "Likely form: " + f + ". " : "") + (g ? "Total income about Rs " + g + ". " : "") + "Walk me through the steps, documents, and what to check in AIS and Form 26AS.";
        NMApp.show("meera", { prefill: q });
      };
      $("apc").onclick = function () {
        var t = $("apr").textContent;
        if (t && navigator.clipboard) navigator.clipboard.writeText(t).then(function () { $("apc").textContent = "Copied"; }).catch(function () {});
      };
      $("apo").onclick = function () { window.open("https://www.incometax.gov.in/iec/foportal/", "_blank"); };
      $("ap").onchange = function (e) {
        var fs = Array.prototype.slice.call(e.target.files || []);
        if (!fs.length) return;
        var st = $("aps"), r = $("apr");
        r.classList.add("hid");
        st.textContent = "Reading " + fs.length + " document(s)…";
        claude.use("sample").then(function (s) {
          if (!s) throw new Error("AI is not available in this view.");
          return s.limits().then(function (l) {
            if (!l || !l.images) throw new Error("Photo reading is not available in this view.");
            var prompt = 'Extract from this Indian tax document as JSON with keys doc (form16, ais, 26as, interest, capgains, rent or other), salary, tds, interest_income, capital_gains, deductions_80C, deductions_80D, hra, home_loan_interest, business_income, notes. Use null when absent. Numbers in rupees without commas. Return only JSON.';
            return Promise.all(fs.map(function (f) { return s.json(prompt, { images: [f], modelTier: "quick" }); })).then(function (F) {
              var caps = NMTax.deductionCaps();
              var m = {};
              ["salary", "tds"].forEach(function (x) { m[x] = Math.max.apply(null, [0].concat(F.map(function (b) { return +b[x] || 0; }))); });
              ["interest_income", "capital_gains", "deductions_80C", "deductions_80D", "hra", "home_loan_interest", "business_income"].forEach(function (x) {
                m[x] = F.reduce(function (a, b) { return a + (+b[x] || 0); }, 0);
              });
              st.textContent = "Read " + fs.length + " document(s). Computing…";
              var gross = m.salary + m.interest_income + m.business_income;
              var ded = Math.min(m.deductions_80C, caps["80C"] || 150000) + m.deductions_80D + m.hra + Math.min(m.home_loan_interest, caps.home_loan_interest || 200000);
              document.querySelectorAll("#fc input").forEach(function (c) {
                c.checked = (c.value === "sal" && m.salary > 0) || (c.value === "cg" && m.capital_gains > 0) || (c.value === "biz" && m.business_income > 0);
              });
              $("tg").value = gross; $("td").value = ded; $("ts").checked = m.salary > 0;
              var form = runFormFinder();
              var regimeText = runRegimeCompare();
              return s("You are an ITR preparer for an Indian taxpayer. Reply in " + langName() + ". Write a short filing sheet for incometax.gov.in (AY 2026-27): the likely form, the numbers to enter on each schedule or screen, the TDS credit to claim, the expected refund or balance tax using the regime result, and the mismatches to check against AIS and Form 26AS. Use [verify] where unsure and never invent numbers. Under 220 words.\nEXTRACTED: " + JSON.stringify(m) + "\nFORM: " + form + "\nREGIME RESULT: " + regimeText, { modelTier: "default" });
            });
          });
        }).then(function (out) {
          r.classList.remove("hid");
          r.textContent = out.text.trim() + "\n\nCheck that Form 16 and AIS salary were not double counted. Review every number before filing.";
          st.textContent = "Autopilot done. The form and regime results are filled in below.";
        }).catch(function (x) {
          var msg = (x && x.message) || "";
          if (!msg || msg === "Request failed" || msg === "error") msg = "Could not read the documents. AI needs the live server. Try clearer photos when the server is reachable.";
          st.textContent = msg;
        });
      };
      if (options.section === "itr") {
        var target = $("biz-itr");
        if (target) setTimeout(function () { target.scrollIntoView(); }, 50);
      }
    }
  };
})();
