// NMAuth: mandatory auth gate (contract section 2). GoTrue REST with plain
// fetch, no SDK. Session in localStorage nm_session; nm_token always equals
// the current access token (shim.js already reads nm_token).
// When Supabase config is present, no destination is reachable without a
// valid session. When config is empty (pre-provisioning), the auth screen
// says sign-in is being set up and offers a clearly labeled local mode
// that keeps everything on this device. Local mode disappears the moment
// config is present. No social buttons: email + phone OTP + password only,
// because only those are wired.
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function supabaseUrl() { return (window.SUPABASE_URL || "").replace(/\/$/, ""); }
  function anonKey() { return window.SUPABASE_ANON_KEY || ""; }
  function configured() { return !!(supabaseUrl() && anonKey()); }

  function loadSession() {
    try {
      var raw = localStorage.getItem("nm_session");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveSession(session) {
    try {
      localStorage.setItem("nm_session", JSON.stringify(session));
      localStorage.setItem("nm_token", session.access_token || "");
      localStorage.removeItem("nm_local_mode");
    } catch (e) {}
  }
  function clearSession() {
    try {
      localStorage.removeItem("nm_session");
      localStorage.removeItem("nm_token");
      localStorage.removeItem("nm_local_mode");
    } catch (e) {}
  }
  function isLocalMode() {
    try { return localStorage.getItem("nm_local_mode") === "1" && !configured(); }
    catch (e) { return false; }
  }
  function sessionValid(session) {
    if (!session || !session.access_token) return false;
    if (!session.expires_at) return true;
    return session.expires_at * 1000 > Date.now() + 30000;
  }
  function normalizeSession(data) {
    if (!data || !data.access_token) return null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || "",
      expires_at: data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : 0,
      user_id: (data.user && data.user.id) || "",
      email: (data.user && data.user.email) || ""
    };
  }
  function goTrue(path, body, bearer) {
    var headers = { "Content-Type": "application/json", "apikey": anonKey() };
    if (bearer) headers["Authorization"] = "Bearer " + bearer;
    return fetch(supabaseUrl() + path, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var msg = (j && (j.msg || j.message || j.error_description)) || ("Sign-in failed (" + r.status + ")");
          return { ok: false, status: r.status, error: String(msg), data: j };
        }
        return { ok: true, status: r.status, data: j, error: null };
      });
    }).catch(function () {
      return { ok: false, status: 0, error: "Could not reach the sign-in service. Check your connection and try again.", data: null };
    });
  }
  function migrateLocalCases() {
    if (window.NMStore && NMStore.migrated()) return Promise.resolve({ done: true, reason: "already migrated" });
    var cases = (window.NMStore ? NMStore.cases() : []).slice(0, 20);
    if (!cases.length) {
      if (window.NMStore) NMStore.setMigrated();
      return Promise.resolve({ done: true, reason: "no local cases" });
    }
    if (!window.NMApi) return Promise.resolve({ done: false, reason: "no api" });
    return NMApi.migrateCases(cases).then(function (res) {
      if (res.ok) {
        if (window.NMStore) NMStore.setMigrated();
        return { done: true, reason: "migrated " + cases.length + " cases, local copy kept" };
      }
      return { done: false, reason: res.error || "migration failed, will retry at next sign-in" };
    });
  }
  function refreshSession() {
    var s = loadSession();
    if (!s || !s.refresh_token) return Promise.resolve(null);
    return goTrue("/auth/v1/token?grant_type=refresh_token", { refresh_token: s.refresh_token }).then(function (res) {
      if (!res.ok) return null;
      var ns = normalizeSession(res.data);
      if (!ns) return null;
      if (!ns.email && s.email) ns.email = s.email;
      saveSession(ns);
      return ns;
    });
  }
  function signOutRemote() {
    var s = loadSession();
    if (s && s.access_token && configured()) {
      goTrue("/auth/v1/logout", {}, s.access_token).catch(function () {});
    }
    clearSession();
    if (window.NMApi) NMApi.resetLiveCache();
  }

  var onAuthed = null;
  function enterApp() {
    if (typeof onAuthed === "function") onAuthed();
  }
  function finishSignIn(session) {
    saveSession(session);
    migrateLocalCases();
    enterApp();
  }
  function setMsg(text, kind) {
    var el = $("auth-msg");
    if (!el) return;
    el.className = kind === "err" ? "errbox" : "okbox";
    el.textContent = text;
    el.classList.remove("hid");
  }
  function clearMsg() {
    var el = $("auth-msg");
    if (el) el.classList.add("hid");
  }

  function renderAuth(container, callback) {
    onAuthed = callback;
    if (!configured()) {
      container.innerHTML =
        '<div class="authwrap"><div class="hd"><div class="logo">M</div><div><h1>NoticeMitra · <b>Virtual CA</b></h1>' +
        '<p class="sub">Got a GST notice? Talk for one minute. Get the reply, checklist and deadlines.</p></div></div>' +
        '<div class="authcard"><h2>Sign-in is being set up</h2>' +
        '<p class="sub">Accounts and cloud sync are not switched on yet. You can keep using the app on this device only. Your cases, documents and settings stay on this phone and are not synced anywhere. When sign-in is ready, you will sign in here first, and your saved cases will move to your account.</p>' +
        '<div class="row"><button class="btn" id="auth-local">Continue on this device only</button></div>' +
        '<p class="sub" style="margin-top:10px">This local mode disappears once sign-in is switched on. Nothing here is uploaded.</p></div>' +
        '<p class="dis">Not legal advice. Drafts must be reviewed by your CA before filing. Check dates on gst.gov.in.</p></div>';
      $("auth-local").onclick = function () {
        try { localStorage.setItem("nm_local_mode", "1"); } catch (e) {}
        enterApp();
      };
      return;
    }
    container.innerHTML =
      '<div class="authwrap"><div class="hd"><div class="logo">M</div><div><h1>NoticeMitra · <b>Virtual CA</b></h1>' +
      '<p class="sub">Sign in to continue. Your notices, documents and progress sync to your account.</p></div></div>' +
      '<div class="authcard"><h2>Welcome back</h2>' +
      '<p class="sub">Sign in with your email or phone. New here? Create an account with an email and password.</p>' +
      '<div class="seg" role="tablist">' +
      '<button type="button" data-mode="password" class="on">Password</button>' +
      '<button type="button" data-mode="signup">Create account</button>' +
      '<button type="button" data-mode="emailotp">Email code</button>' +
      '<button type="button" data-mode="phoneotp">Phone code</button></div>' +
      '<div id="auth-forms"></div>' +
      '<div id="auth-msg" class="hid" style="margin-top:10px"></div>' +
      '<p class="sub" style="margin-top:10px">We never ask for your income tax portal or bank passwords or OTPs.</p></div>' +
      '<p class="dis">Not legal advice. Drafts must be reviewed by your CA before filing. Check dates on gst.gov.in.</p></div>';
    var forms = $("auth-forms");
    var mode = "password";
    function showMode(m) {
      mode = m; clearMsg();
      var btns = container.querySelectorAll(".seg button");
      btns.forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-mode") === m); });
      if (m === "password") {
        forms.innerHTML = '<label>Email<input class="in" id="auth-email" type="email" autocomplete="email" placeholder="you@example.com"></label>' +
          '<label>Password<input class="in" id="auth-pass" type="password" autocomplete="current-password" placeholder="Your password"></label>' +
          '<div class="row"><button class="btn" id="auth-go">Sign in</button></div>';
        $("auth-go").onclick = function () {
          var email = $("auth-email").value.trim(), pass = $("auth-pass").value;
          if (!email || !pass) { setMsg("Enter your email and password.", "err"); return; }
          $("auth-go").disabled = true;
          goTrue("/auth/v1/token?grant_type=password", { email: email, password: pass }).then(function (res) {
            $("auth-go").disabled = false;
            if (!res.ok) { setMsg(res.error, "err"); return; }
            var s = normalizeSession(res.data);
            if (!s) { setMsg("Sign-in did not return a session. Please try again.", "err"); return; }
            if (!s.email) s.email = email;
            finishSignIn(s);
          });
        };
      } else if (m === "signup") {
        forms.innerHTML = '<label>Email<input class="in" id="auth-email" type="email" autocomplete="email" placeholder="you@example.com"></label>' +
          '<label>Choose a password<input class="in" id="auth-pass" type="password" autocomplete="new-password" placeholder="At least 6 characters"></label>' +
          '<div class="row"><button class="btn" id="auth-go">Create account</button></div>' +
          '<p class="sub" style="margin-top:8px">We may email you a confirmation link or code. If so, use the Email code tab to finish signing in.</p>';
        $("auth-go").onclick = function () {
          var email = $("auth-email").value.trim(), pass = $("auth-pass").value;
          if (!email || pass.length < 6) { setMsg("Enter an email and a password of at least 6 characters.", "err"); return; }
          $("auth-go").disabled = true;
          goTrue("/auth/v1/signup", { email: email, password: pass }).then(function (res) {
            $("auth-go").disabled = false;
            if (!res.ok) { setMsg(res.error, "err"); return; }
            var s = normalizeSession(res.data);
            if (s) {
              if (!s.email) s.email = email;
              finishSignIn(s);
            } else {
              setMsg("Account created. Check your email for a confirmation code, then use the Email code tab to sign in.", "ok");
              showMode("emailotp");
              var em = $("auth-email"); if (em) em.value = email;
            }
          });
        };
      } else if (m === "emailotp") {
        forms.innerHTML = '<label>Email<input class="in" id="auth-email" type="email" autocomplete="email" placeholder="you@example.com"></label>' +
          '<div class="row"><button class="btn g" id="auth-send" style="flex:1">Send code</button></div>' +
          '<label>Code from the email<input class="in" id="auth-code" inputmode="numeric" placeholder="6 digit code"></label>' +
          '<div class="row"><button class="btn" id="auth-go">Verify and sign in</button></div>';
        $("auth-send").onclick = function () {
          var email = $("auth-email").value.trim();
          if (!email) { setMsg("Enter your email first.", "err"); return; }
          $("auth-send").disabled = true;
          goTrue("/auth/v1/otp", { email: email }).then(function (res) {
            $("auth-send").disabled = false;
            if (!res.ok) setMsg(res.error, "err");
            else setMsg("Code sent to " + email + ". It may take a minute to arrive.", "ok");
          });
        };
        $("auth-go").onclick = function () {
          var email = $("auth-email").value.trim(), code = $("auth-code").value.trim();
          if (!email || !code) { setMsg("Enter your email and the code.", "err"); return; }
          $("auth-go").disabled = true;
          goTrue("/auth/v1/verify", { email: email, token: code, type: "email" }).then(function (res) {
            $("auth-go").disabled = false;
            if (!res.ok) { setMsg(res.error, "err"); return; }
            var s = normalizeSession(res.data);
            if (!s) { setMsg("That code did not sign you in. Request a new code and try again.", "err"); return; }
            if (!s.email) s.email = email;
            finishSignIn(s);
          });
        };
      } else {
        forms.innerHTML = '<label>Phone number<input class="in" id="auth-phone" type="tel" autocomplete="tel" placeholder="+91 98765 43210"></label>' +
          '<div class="row"><button class="btn g" id="auth-send" style="flex:1">Send code</button></div>' +
          '<label>Code from the SMS<input class="in" id="auth-code" inputmode="numeric" placeholder="6 digit code"></label>' +
          '<div class="row"><button class="btn" id="auth-go">Verify and sign in</button></div>';
        $("auth-send").onclick = function () {
          var phone = $("auth-phone").value.trim();
          if (!phone) { setMsg("Enter your phone number first.", "err"); return; }
          $("auth-send").disabled = true;
          goTrue("/auth/v1/otp", { phone: phone }).then(function (res) {
            $("auth-send").disabled = false;
            if (!res.ok) setMsg(res.error, "err");
            else setMsg("Code sent to " + phone + ". It may take a minute to arrive.", "ok");
          });
        };
        $("auth-go").onclick = function () {
          var phone = $("auth-phone").value.trim(), code = $("auth-code").value.trim();
          if (!phone || !code) { setMsg("Enter your phone number and the code.", "err"); return; }
          $("auth-go").disabled = true;
          goTrue("/auth/v1/verify", { phone: phone, token: code, type: "sms" }).then(function (res) {
            $("auth-go").disabled = false;
            if (!res.ok) { setMsg(res.error, "err"); return; }
            var s = normalizeSession(res.data);
            if (!s) { setMsg("That code did not sign you in. Request a new code and try again.", "err"); return; }
            finishSignIn(s);
          });
        };
      }
    }
    container.querySelectorAll(".seg button").forEach(function (b) {
      b.onclick = function () { showMode(b.getAttribute("data-mode")); };
    });
    showMode("password");
  }

  // A 401 from the server means the session is no longer valid: clear it
  // and return to the auth screen. Local mode is unaffected (no session).
  document.addEventListener("nm:unauthorized", function () {
    if (!configured()) return;
    if (isLocalMode()) return;
    clearSession();
    if (typeof window.NMApp !== "undefined" && NMApp.showAuth) NMApp.showAuth();
  });

  window.NMAuth = {
    configured: configured,
    esc: esc,
    loadSession: loadSession,
    saveSession: saveSession,
    clearSession: clearSession,
    isLocalMode: isLocalMode,
    sessionValid: sessionValid,
    refreshSession: refreshSession,
    signOut: signOutRemote,
    migrateLocalCases: migrateLocalCases,
    renderAuth: renderAuth,
    // Boot check: resolves true when the app may open.
    ensureSession: function () {
      if (!configured()) return Promise.resolve(isLocalMode());
      var s = loadSession();
      if (sessionValid(s)) {
        try { localStorage.setItem("nm_token", s.access_token); } catch (e) {}
        return Promise.resolve(true);
      }
      if (s && s.refresh_token) {
        return refreshSession().then(function (ns) { return !!ns; });
      }
      return Promise.resolve(false);
    },
    currentEmail: function () {
      var s = loadSession();
      return s ? (s.email || "") : "";
    }
  };
})();
