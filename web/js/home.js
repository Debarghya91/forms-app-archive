// NMHome: Home destination. Welcome, personalised overview from the
// stored profile type, pending compliance actions, upcoming deadlines,
// outstanding notices, recent documents, quick actions, and rule-based
// recommendations from Meera. Every number comes from real local or
// server state. No invented figures.
(function () {
  "use strict";
  function esc(s) { return window.NMAuth ? NMAuth.esc(s) : String(s); }
  function fmtDate(d) {
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  function greeting() {
    var h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }
  function caseDaysLeft(c) {
    if (!c.due) return null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.ceil((new Date(c.due) - today) / 864e5);
  }
  window.NMHome = {
    render: function (el) {
      var profile = NMStore.getProfile();
      var cases = NMStore.cases();
      var vault = NMStore.vault();
      var tasks = NMTax.dueTasks(profile.type);
      var done = NMStore.tasksDone();
      var openCases = cases.filter(function (c) { return c.status !== "done"; });
      var overdue = openCases.filter(function (c) { var n = caseDaysLeft(c); return n !== null && n < 0; });
      var dueSoon = openCases.filter(function (c) { var n = caseDaysLeft(c); return n !== null && n >= 0 && n <= 3; });
      var pendingTasks = tasks.filter(function (t) { return !done[t.key + ":" + t.due.toISOString().slice(0, 10)]; });
      var nextTasks = pendingTasks.slice(0, 3);
      var isBusiness = ["freelancer", "sole_proprietor", "partnership", "llp", "private_limited"].indexOf(profile.type) !== -1;
      var name = profile.name ? ", " + profile.name : "";
      var html = "";
      html += '<div class="panel"><h2>' + greeting() + esc(name) + '</h2>' +
        '<p class="sub">You are set up as: <b>' + esc(NMStore.profileTypeLabel(profile.type)) + '</b>. ' +
        (isBusiness ? "Your overview shows GST, invoices and expenses first. Change this any time in Profile."
          : "Your overview shows ITR and notices first. Change this any time in Profile.") + '</p>' +
        '<div class="stat">' +
        '<div class="cell"><b>' + openCases.length + '</b><span>Open notices</span></div>' +
        '<div class="cell"><b>' + overdue.length + '</b><span>Overdue</span></div>' +
        '<div class="cell"><b>' + pendingTasks.length + '</b><span>Pending tasks</span></div>' +
        '<div class="cell"><b>' + vault.length + '</b><span>Documents</span></div></div></div>';

      // Meera recommendations, rule based from state.
      var recs = [];
      if (overdue.length) recs.push({ text: "Reply to your notice: " + overdue.length + " notice" + (overdue.length > 1 ? "s are" : " is") + " past the due date.", go: "meera", label: "Open Meera AI" });
      else if (dueSoon.length) recs.push({ text: "A notice reply is due within 3 days. Start the draft now so your CA has time to review it.", go: "meera", label: "Open Meera AI" });
      if (!cases.length) recs.push({ text: "No notices saved yet. Upload a notice photo and Meera will explain it in simple words.", go: "meera", label: "Upload a notice photo" });
      if (nextTasks.length && nextTasks[0].daysLeft <= 3) recs.push({ text: "Next deadline: " + nextTasks[0].label + " in " + nextTasks[0].daysLeft + " day" + (nextTasks[0].daysLeft === 1 ? "" : "s") + ". See what to keep ready.", go: "compliance", label: "See deadlines" });
      if (isBusiness && !vault.length) recs.push({ text: "Save your first document, for example a GST notice or an invoice, so it is easy to find later.", go: "business", label: "Go to Business" });
      if (!recs.length) recs.push({ text: "All caught up. Ask Meera any tax question, or check your upcoming deadlines.", go: "meera", label: "Ask Meera" });
      html += '<div class="panel"><div class="lbl"><span>MEERA RECOMMENDS</span></div>';
      recs.forEach(function (r, i) {
        html += '<p style="margin:8px 0 0;font-size:14px">' + esc(r.text) + '</p>' +
          '<div class="row"><button class="btn sm" data-rec="' + i + '">' + esc(r.label) + '</button></div>';
      });
      html += '</div>';

      // Quick actions, all working.
      html += '<div class="panel"><div class="lbl"><span>QUICK ACTIONS</span></div><div class="qa">' +
        '<button class="btn" data-nav="meera">Ask Meera</button>' +
        '<button class="btn" data-nav="meera-notice">Analyse a notice</button>' +
        '<button class="btn g" data-nav="business">Make an invoice</button>' +
        '<button class="btn g" data-nav="compliance">Due dates</button>' +
        '<button class="btn g" data-nav="business-itr">ITR tools</button>' +
        '<button class="btn g" data-nav="profile">My account</button></div></div>';

      // Upcoming deadlines.
      html += '<div class="panel"><div class="lbl"><span>UPCOMING DEADLINES</span><span>NEAREST FIRST</span></div>';
      if (!nextTasks.length) {
        html += '<p class="sub" style="margin-top:8px">No pending deadlines. Nice work.</p>';
      } else {
        nextTasks.forEach(function (t) {
          html += '<button class="cs" data-nav="compliance"><span>' + esc(t.label) + '</span><b class="dd' + (t.daysLeft <= 3 ? " red" : "") + '">' + fmtDate(t.due) + ' · ' + t.daysLeft + 'd</b></button>';
        });
      }
      html += '<p class="sub" style="margin-top:8px">Standard dates. Extensions, QRMP and state rules vary. Verify on gst.gov.in and incometax.gov.in.</p></div>';

      // Outstanding notices.
      html += '<div class="panel"><div class="lbl"><span>OUTSTANDING NOTICES</span><span>' + openCases.length + ' OPEN</span></div>';
      if (!openCases.length) {
        html += '<p class="sub" style="margin-top:8px">No saved notices. When Meera analyses a notice, it appears here with its due date.</p>';
      } else {
        openCases.slice(0, 5).forEach(function (c) {
          var n = caseDaysLeft(c);
          var label = n === null ? "no date" : (n < 0 ? "overdue" : n + " days left");
          html += '<button class="cs" data-case="' + esc(String(c.t || "")) + '"><span>' + esc((c.brief || "").slice(0, 48)) + '</span><b class="dd' + (n !== null && n <= 3 ? " red" : "") + '">' + label + '</b></button>';
        });
      }
      html += '</div>';

      // Recent documents.
      html += '<div class="panel"><div class="lbl"><span>RECENT DOCUMENTS</span><span id="home-doc-note">ON THIS DEVICE</span></div><div id="home-docs">';
      if (!vault.length) {
        html += '<p class="sub" style="margin-top:8px">No documents saved yet. Photos you attach in Meera AI and invoices you save are listed here.</p>';
      } else {
        vault.slice(0, 5).forEach(function (v) {
          html += '<div class="cs" style="cursor:default"><span>' + esc(v.name || "Document") + '</span><b class="dd">' + esc(v.kind || "") + '</b></div>';
        });
      }
      html += '</div><div class="row"><button class="btn g" id="home-add-doc" style="flex:1">Save a document note</button></div></div>';

      // How it works, short form, full copy lives in Profile.
      html += '<div class="panel why"><div class="lbl"><span>HOW IT WORKS</span></div>' +
        '<p>A virtual CA on your phone for small traders and small businesses. It explains GST notices in simple words, drafts replies, answers tax questions, tracks due dates, makes GST invoices, and prepares your ITR filing sheet. Talk or type in Hinglish, Hindi or English.</p>' +
        '<div class="row"><button class="btn g" data-nav="profile-how" style="flex:1">Read the full How it works, free calls and privacy notes</button></div></div>';

      html += '<p class="dis">Not legal advice. Drafts must be reviewed by your CA before filing. Check dates on gst.gov.in.</p>';
      el.innerHTML = html;

      el.querySelectorAll("[data-nav]").forEach(function (b) {
        b.onclick = function () {
          var target = b.getAttribute("data-nav");
          if (target === "meera-notice") { NMApp.show("meera", { mode: "notice" }); }
          else if (target === "business-itr") { NMApp.show("business", { section: "itr" }); }
          else if (target === "profile-how") { NMApp.show("profile", { section: "how" }); }
          else NMApp.show(target);
        };
      });
      el.querySelectorAll("[data-rec]").forEach(function (b) {
        b.onclick = function () {
          var r = recs[+b.getAttribute("data-rec")];
          if (r.go === "meera") NMApp.show("meera", { mode: "notice" });
          else NMApp.show(r.go);
        };
      });
      el.querySelectorAll("[data-case]").forEach(function (b) {
        b.onclick = function () { NMApp.show("meera", { mode: "notice", caseT: b.getAttribute("data-case") }); };
      });
      var addDoc = el.querySelector("#home-add-doc");
      if (addDoc) addDoc.onclick = function () {
        var nameInput = prompt("Document name, for example: GSTR-3B March workings");
        if (!nameInput) return;
        NMStore.addVaultItem({ id: "doc-" + Date.now(), name: nameInput.slice(0, 80), kind: "note", date: new Date().toISOString().slice(0, 10) });
        NMApp.show("home");
      };
      // When signed in, also list server documents and merge counts honestly.
      if (window.NMApi && window.NMAuth && NMAuth.configured() && !NMAuth.isLocalMode()) {
        NMApi.getDocuments().then(function (res) {
          var note = el.querySelector("#home-doc-note");
          var box = el.querySelector("#home-docs");
          if (!res.ok || !box) return;
          var docs = (res.data && res.data.documents) || [];
          if (note) note.textContent = "ON THIS DEVICE + YOUR ACCOUNT";
          if (docs.length) {
            var extra = "";
            docs.slice(0, 5).forEach(function (d) {
              extra += '<div class="cs" style="cursor:default"><span>' + esc(d.name || "Document") + '</span><b class="dd">synced</b></div>';
            });
            if (!vault.length) box.innerHTML = extra;
            else box.innerHTML += extra;
          }
        });
      }
    }
  };
})();
