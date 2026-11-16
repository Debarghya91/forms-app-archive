// NMCompliance: personalised compliance calendar. Reads the stored
// profile type. When the server is live it fetches
// /api/compliance?profile= and merges the result with local rules and
// saved-case deadlines; offline it computes from the local due-date rules
// in the versioned pack, nearest first, red within 3 days.
// Completion tracking is stored locally (nm_tasks_done) and synced with
// PATCH /api/compliance/tasks/:id (contract section 3 amendment): the
// :id is the task KEY from GET /api/compliance (for example
// advance_tax_1, itr_individual), while the local done-mark key appends
// the due date so a recurring rule is fresh each period. NMSync maps the
// local key to the server key, tries the PATCH at once when signed in
// with a live server, and queues by the local key when offline. Saved
// case deadlines are local only and are never PATCHed. Missed deadlines
// get a warning section. Every task carries a document-requirement note.
(function () {
  "use strict";
  function esc(s) { return window.NMAuth ? NMAuth.esc(s) : String(s); }
  function fmtDate(d) {
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  function taskKey(t) { return t.key + ":" + t.due.toISOString().slice(0, 10); }
  function localTasks(profileType) {
    var tasks = NMTax.dueTasks(profileType).map(function (t) {
      return { key: t.key, label: t.label, due: t.due, daysLeft: t.daysLeft, category: t.category, note: t.note, rule: t.rule, source: t.source, mine: false, patchId: t.key };
    });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    NMStore.cases().forEach(function (c) {
      if (!c.due) return;
      var d = new Date(c.due);
      tasks.push({
        key: "case-" + (c.t || c.due), label: "My notice: " + (c.brief || "").slice(0, 24),
        due: d, daysLeft: Math.round((d - today) / 864e5), category: "Notice",
        note: "Have the notice, your reply draft and the documents on the checklist ready.",
        rule: "Due date from your saved case", source: "saved case", mine: true, patchId: ""
      });
    });
    tasks.sort(function (a, b) { return a.due - b.due; });
    return tasks;
  }
  function renderList(el, tasks, sourceLabel) {
    var done = NMStore.tasksDone();
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var missed = tasks.filter(function (t) { return t.daysLeft < 0 && !done[taskKey(t)]; });
    var upcoming = tasks.filter(function (t) { return t.daysLeft >= 0; });
    var doneCount = tasks.filter(function (t) { return done[taskKey(t)]; }).length;
    var html = "";
    if (missed.length) {
      html += '<div class="warn"><b>Missed deadlines: ' + missed.length + '.</b> ' +
        'These dates have passed and are not marked done. File or reply as soon as you can, and check late fees on the official portal. ' +
        esc(missed.map(function (t) { return t.label; }).join(", ")) + '.</div>';
    }
    html += '<p class="sub" style="margin-top:10px">' + esc(sourceLabel) + ' · ' + doneCount + ' of ' + tasks.length + ' marked done.</p>';
    html += '<div id="task-list">';
    tasks.forEach(function (t) {
      var key = taskKey(t);
      var isDone = !!done[key];
      var urgent = t.daysLeft >= 0 && t.daysLeft <= 3;
      var overdue = t.daysLeft < 0;
      html += '<div class="cs taskrow' + (isDone ? " done" : "") + '" style="cursor:default"><div class="checkline">' +
        '<input type="checkbox" data-task="' + esc(key) + '" data-patch="' + esc(t.patchId || "") + '"' + (isDone ? " checked" : "") + ' aria-label="Mark done: ' + esc(t.label) + '">' +
        '<div><div class="cs-t"><b>' + esc(t.label) + '</b> <span class="tag">' + esc(t.category) + '</span></div>' +
        '<div class="sub">' + esc(t.note || "") + '</div>' +
        '<div class="sub">Rule: ' + esc(t.rule || "") + ' · Source: ' + esc(t.source || "local") + '</div></div></div>' +
        '<b class="dd' + ((urgent || overdue) && !isDone ? " red" : "") + '">' + fmtDate(t.due) + ' · ' + (overdue ? Math.abs(t.daysLeft) + "d overdue" : t.daysLeft + "d") + '</b></div>';
    });
    html += '</div>';
    el.innerHTML = html;
    el.querySelectorAll("[data-task]").forEach(function (cb) {
      cb.onchange = function () {
        var key = cb.getAttribute("data-task");
        var patchId = cb.getAttribute("data-patch") || "";
        NMStore.setTaskDone(key, cb.checked);
        if (window.NMSync) NMSync.pushTaskDone(key, cb.checked, patchId);
        else NMStore.enqueue("task_done", { key: key, patchId: patchId, done: cb.checked, at: new Date().toISOString() });
        // Re-render in place so counts and the missed warning update.
        var tasksNow = localTasks(NMStore.getProfile().type);
        var box = document.getElementById("cal-list");
        if (box) renderList(box, tasksNow, "Standard dates from the local rule pack.");
        if (window.NMApp && NMApp.current === "compliance") { /* counts stay in view */ }
      };
    });
  }
  window.NMCompliance = {
    render: function (el) {
      var profile = NMStore.getProfile();
      var html = '<div class="panel why"><div class="lbl"><span>HOW THIS WORKS</span></div>' +
        '<p>Every important compliance date in one list, nearest first, with the days left. Dates in red need attention within 3 days. Deadlines from your own saved notice cases appear here too.</p>' +
        '<p>Your list is personalised for: <b>' + esc(NMStore.profileTypeLabel(profile.type)) + '</b>. Change your account type in Profile to see a different list.</p></div>' +
        '<div class="panel"><div class="lbl"><span>COMPLIANCE CALENDAR</span><span>NEXT DUE</span></div>' +
        '<div id="cal-list"><p class="sub" style="margin-top:8px">Loading dates…</p></div>' +
        '<p class="sub" style="margin-top:10px">Standard dates. Extensions, QRMP and state rules vary. Verify on gst.gov.in and incometax.gov.in.</p>' +
        '<p class="sub">Tick a task when it is done. Done marks are saved on this device and synced to your account when you are signed in and the server is reachable; otherwise they stay queued and sync on reconnect.</p></div>' +
        '<p class="dis">Not legal advice. Check dates on the official portals before you file.</p>';
      el.innerHTML = html;
      var box = document.getElementById("cal-list");
      var tasks = localTasks(profile.type);
      renderList(box, tasks, "Standard dates from the local rule pack.");
      // When the server is live, fetch its tasks and merge: server tasks
      // first (same keys win), local case deadlines always kept.
      if (window.NMApi) {
        NMApi.probeLive().then(function (live) {
          if (!live) return;
          return NMApi.getCompliance(profile.type).then(function (res) {
            if (!res.ok || !res.data || !Array.isArray(res.data.tasks)) return;
            var today = new Date(); today.setHours(0, 0, 0, 0);
            var serverTasks = res.data.tasks.map(function (t, i) {
              var d = new Date(t.due);
              var serverKey = t.key || t.id || "";
              return {
                key: serverKey || ("server-" + (t.title || i)), label: t.title || "Task", due: d,
                daysLeft: isNaN(d) ? 9999 : Math.round((d - today) / 864e5),
                category: t.category || "Compliance", note: t.note || "",
                rule: t.source || "server", source: "server", mine: false, patchId: serverKey
              };
            }).filter(function (t) { return !isNaN(t.due); });
            var caseTasks = tasks.filter(function (t) { return t.mine; });
            var merged = serverTasks.concat(caseTasks);
            merged.sort(function (a, b) { return a.due - b.due; });
            var boxNow = document.getElementById("cal-list");
            if (boxNow) renderList(boxNow, merged, "Dates from the server, plus your saved case deadlines.");
          });
        }).catch(function () {});
      }
    }
  };
})();
