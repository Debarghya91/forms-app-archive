// NMStore: local persistence plus an honest offline sync queue.
// Keys: nm (cases, same shape as the previous version), nm_profile,
// nm_tasks_done, nm_vault, nm_invoices, nm_chat, nm_queue, nm_migrated.
// The sync queue stores records locally and reports honestly when it
// cannot send them. It never claims a sync happened when it did not.
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
  var PROFILE_TYPES = [
    ["individual", "Individual"],
    ["salaried", "Salaried employee"],
    ["freelancer", "Freelancer"],
    ["sole_proprietor", "Sole proprietor"],
    ["partnership", "Partnership firm"],
    ["llp", "LLP"],
    ["private_limited", "Private limited company"],
    ["other", "Other"]
  ];
  var LANGUAGES = [
    ["hg", "Hinglish"],
    ["hi", "Hindi"],
    ["en", "English"]
  ];
  window.NMStore = {
    PROFILE_TYPES: PROFILE_TYPES,
    LANGUAGES: LANGUAGES,
    profileTypeLabel: function (type) {
      for (var i = 0; i < PROFILE_TYPES.length; i++) {
        if (PROFILE_TYPES[i][0] === type) return PROFILE_TYPES[i][1];
      }
      return "Individual";
    },
    cases: function () {
      var c = read("nm", []);
      return Array.isArray(c) ? c : [];
    },
    saveCase: function (entry) {
      var c = this.cases();
      c.unshift(entry);
      write("nm", c.slice(0, 20));
      return this.cases();
    },
    deleteCase: function (index) {
      var c = this.cases();
      c.splice(index, 1);
      write("nm", c);
      return c;
    },
    updateCase: function (index, patch) {
      var c = this.cases();
      if (!c[index]) return c;
      for (var k in patch) c[index][k] = patch[k];
      write("nm", c);
      return c;
    },
    getProfile: function () {
      var p = read("nm_profile", null);
      if (!p || typeof p !== "object") p = {};
      return {
        type: p.type || "individual",
        language: p.language || "hg",
        name: p.name || "",
        businessName: p.businessName || ""
      };
    },
    saveProfile: function (patch) {
      var p = this.getProfile();
      for (var k in patch) p[k] = patch[k];
      write("nm_profile", p);
      return p;
    },
    tasksDone: function () { return read("nm_tasks_done", {}) || {}; },
    setTaskDone: function (key, done) {
      var d = this.tasksDone();
      if (done) d[key] = new Date().toISOString().slice(0, 10);
      else delete d[key];
      write("nm_tasks_done", d);
      return d;
    },
    vault: function () {
      var v = read("nm_vault", []);
      return Array.isArray(v) ? v : [];
    },
    addVaultItem: function (item) {
      var v = this.vault();
      v.unshift(item);
      write("nm_vault", v.slice(0, 50));
      return this.vault();
    },
    removeVaultItem: function (id) {
      var v = this.vault().filter(function (x) { return x.id !== id; });
      write("nm_vault", v);
      return v;
    },
    invoices: function () {
      var v = read("nm_invoices", []);
      return Array.isArray(v) ? v : [];
    },
    saveInvoice: function (record) {
      var v = this.invoices();
      v.unshift(record);
      write("nm_invoices", v.slice(0, 50));
      return this.invoices();
    },
    chatHistory: function () {
      var v = read("nm_chat", []);
      return Array.isArray(v) ? v : [];
    },
    saveChatHistory: function (items) {
      write("nm_chat", items.slice(-20));
    },
    clearChatHistory: function () { write("nm_chat", []); },
    queue: function () {
      var q = read("nm_queue", []);
      return Array.isArray(q) ? q : [];
    },
    enqueue: function (kind, payload) {
      var q = this.queue();
      q.push({ kind: kind, payload: payload, queued_at: Date.now() });
      write("nm_queue", q.slice(-100));
      return q.length;
    },
    // Honest flush: without a live server and a session this is a no-op
    // that says so. Callers must surface the returned reason, never
    // present a queued record as synced.
    flushQueue: function (sender) {
      var q = this.queue();
      if (!q.length) return Promise.resolve({ flushed: 0, remaining: 0, reason: "queue empty" });
      if (typeof sender !== "function") {
        return Promise.resolve({ flushed: 0, remaining: q.length, reason: "no server connection, records stay on this device" });
      }
      var self = this;
      var remaining = [];
      var flushed = 0;
      var chain = Promise.resolve();
      q.forEach(function (item) {
        chain = chain.then(function () {
          return sender(item).then(function (ok) {
            if (ok) flushed++; else remaining.push(item);
          }).catch(function () { remaining.push(item); });
        });
      });
      return chain.then(function () {
        write("nm_queue", remaining);
        return { flushed: flushed, remaining: remaining.length, reason: remaining.length ? "some records could not be sent and stay queued" : "all queued records sent" };
      });
    },
    migrated: function () {
      try { return localStorage.getItem("nm_migrated") === "1"; } catch (e) { return false; }
    },
    setMigrated: function () {
      try { localStorage.setItem("nm_migrated", "1"); } catch (e) {}
    }
  };
})();
