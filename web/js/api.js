// NMApi: fetch wrapper for the NoticeMitra server (contract section 3).
// Sends the Supabase JWT (nm_token) as Bearer auth. A 401 from the server
// fires an "nm:unauthorized" event so the auth gate can take over.
// Every method returns {ok, status, data, error} and never throws for
// HTTP errors. Network failure means the server is not reachable: callers
// must show an honest state, never a fake answer.
(function () {
  "use strict";
  function base() { return (window.API_BASE || "").replace(/\/$/, ""); }
  function token() {
    try { return localStorage.getItem("nm_token") || ""; } catch (e) { return ""; }
  }
  var liveCache = null; // null = unknown, true/false = probed
  function probeLive() {
    if (liveCache !== null) return Promise.resolve(liveCache);
    var url = base() + "/health";
    return fetch(url, { method: "GET", cache: "no-cache" }).then(function (r) {
      liveCache = r.ok;
      return liveCache;
    }).catch(function () {
      liveCache = false;
      return false;
    });
  }
  function request(path, options) {
    options = options || {};
    var headers = { "Content-Type": "application/json" };
    var t = token();
    if (t) headers["Authorization"] = "Bearer " + t;
    return fetch(base() + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (r) {
      if (r.status === 401) {
        try { document.dispatchEvent(new CustomEvent("nm:unauthorized")); } catch (e) {}
      }
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
        if (!r.ok) {
          return { ok: false, status: r.status, data: data, error: (data && data.error) || ("Server returned " + r.status) };
        }
        return { ok: true, status: r.status, data: data, error: null };
      });
    }).catch(function (e) {
      return { ok: false, status: 0, data: null, error: "Server not reachable" };
    });
  }
  window.NMApi = {
    base: base,
    token: token,
    request: request,
    probeLive: probeLive,
    resetLiveCache: function () { liveCache = null; },
    isPilotError: function (res) {
      return res && res.status === 503 && res.data && res.data.error === "backend_not_configured";
    },
    getCredits: function () { return request("/api/credits"); },
    orchestrate: function (messages, context) {
      return request("/api/orchestrate", { method: "POST", body: { messages: messages, context: context || {} } });
    },
    noticeAnalyze: function (payload) {
      return request("/api/notice/analyze", { method: "POST", body: payload });
    },
    getCases: function () { return request("/api/cases"); },
    migrateCases: function (cases) {
      return request("/api/cases/migrate", { method: "POST", body: { cases: cases } });
    },
    getDocuments: function () { return request("/api/documents"); },
    getCompliance: function (profile) {
      return request("/api/compliance?profile=" + encodeURIComponent(profile || "individual"));
    },
    getProfile: function () { return request("/api/profile"); },
    getSubscription: function () { return request("/api/subscription"); },
    createInvoice: function (record) {
      return request("/api/invoices", { method: "POST", body: record });
    },
    getTaxRules: function (ay) { return request("/api/tax/rules/" + encodeURIComponent(ay)); }
  };
})();
