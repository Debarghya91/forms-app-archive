// NMApp: shell, bottom tab navigation, and boot. Five destinations only;
// there is no drawer and no second nav system. Every destination renders
// fresh on entry and opens at the top. The auth gate owns the first
// screen: when Supabase is configured, no destination renders without a
// valid session; when it is not configured, the auth screen offers the
// clearly labeled local mode instead.
(function () {
  "use strict";
  var DESTS = ["home", "meera", "business", "compliance", "profile"];
  var RENDERERS = {
    home: function (el, opts) { NMHome.render(el, opts); },
    meera: function (el, opts) { NMMeera.render(el, opts); },
    business: function (el, opts) { NMBusiness.render(el, opts); },
    compliance: function (el, opts) { NMCompliance.render(el, opts); },
    profile: function (el, opts) { NMProfile.render(el, opts); }
  };
  var current = null;
  function $(id) { return document.getElementById(id); }
  function show(dest, options) {
    options = options || {};
    if (DESTS.indexOf(dest) === -1) dest = "home";
    // Gate: never render a destination without a session when configured.
    if (NMAuth.configured() && !NMAuth.isLocalMode()) {
      var s = NMAuth.loadSession();
      if (!NMAuth.sessionValid(s)) { showAuth(); return; }
    }
    if (!NMAuth.configured() && !NMAuth.isLocalMode()) { showAuth(); return; }
    current = dest;
    DESTS.forEach(function (d) {
      var v = $("view-" + d);
      if (v) v.classList.toggle("hid", d !== dest);
    });
    document.querySelectorAll("#tabbar button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-dest") === dest);
    });
    var el = $("view-" + dest);
    if (el) RENDERERS[dest](el, options);
    window.scrollTo(0, 0);
    try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e) {}
  }
  function showAuth() {
    current = null;
    var shell = $("app-shell"), tabs = $("tabbar"), auth = $("view-auth");
    if (shell) shell.classList.add("hid");
    if (tabs) tabs.classList.add("hid");
    if (auth) auth.classList.remove("hid");
    window.scrollTo(0, 0);
    NMAuth.renderAuth(auth, function () {
      if (shell) shell.classList.remove("hid");
      if (tabs) tabs.classList.remove("hid");
      if (auth) auth.classList.add("hid");
      show("home");
    });
  }
  function boot() {
    document.querySelectorAll("#tabbar button").forEach(function (b) {
      b.onclick = function () { show(b.getAttribute("data-dest")); };
    });
    NMTax.ready().then(function () {
      return NMAuth.ensureSession();
    }).then(function (allowed) {
      if (allowed) {
        var shell = $("app-shell"), tabs = $("tabbar"), auth = $("view-auth");
        if (shell) shell.classList.remove("hid");
        if (tabs) tabs.classList.remove("hid");
        if (auth) auth.classList.add("hid");
        show("home");
      } else {
        showAuth();
      }
    }).catch(function () { showAuth(); });
  }
  window.NMApp = {
    show: show,
    showAuth: showAuth,
    boot: boot,
    get current() { return current; }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
