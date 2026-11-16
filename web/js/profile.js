// NMProfile: Profile destination. Account type selection (the 8 profile
// types from the brief, stored locally, read by Home and Compliance),
// language selection, display details, theme info, the full How it works
// copy, privacy and terms summaries, credits balance, and sign out.
// EXTENSION POINTS for the next worker (do not rewrite this file):
//   #profile-plans    : plans and paywall (free, personal_plus,
//                       business_pro, ca_professional), buy flows via
//                       /api/pay/order + checkout + /api/pay/verify
//   #profile-businesses: multi-business switcher (server /api/profile)
//   #profile-referral : referral code, count, earned, redeem
// Each extension point is an empty section container below. The next
// worker renders into it. No placeholder content is rendered here.
(function () {
  "use strict";
  function esc(s) { return window.NMAuth ? NMAuth.esc(s) : String(s); }
  function $(id) { return document.getElementById(id); }
  window.NMProfile = {
    render: function (el, options) {
      options = options || {};
      var profile = NMStore.getProfile();
      var configured = NMAuth.configured();
      var localMode = NMAuth.isLocalMode();
      var email = NMAuth.currentEmail();
      var cases = NMStore.cases();
      var queueLen = NMStore.queue().length;
      var html = "";
      // Account.
      html += '<div class="panel"><div class="lbl"><span>ACCOUNT</span></div>' +
        '<div class="kv"><span>Status</span><b>' + (localMode ? "On this device only" : (configured ? "Signed in" : "Sign-in being set up")) + '</b></div>' +
        (email ? '<div class="kv"><span>Email</span><b>' + esc(email) + '</b></div>' : "") +
        '<div class="kv"><span>Saved cases</span><b>' + cases.length + ' on this device</b></div>' +
        '<div class="kv"><span>Case migration</span><b>' + (NMStore.migrated() ? "Done" : "Not yet (runs at sign-in)") + '</b></div>' +
        '<div class="kv"><span>Waiting to sync</span><b>' + queueLen + ' record' + (queueLen === 1 ? "" : "s") + '</b></div>' +
        '<div class="row"><button class="btn g" id="pf-signout" style="flex:1">' + (localMode ? "Leave local mode" : "Sign out") + '</button></div>' +
        '<p class="sub" style="margin-top:8px">' + (localMode ? "Leaving local mode returns you to the start screen. Your cases stay on this device." : "Signing out clears your session on this device and returns you to the sign-in screen. Your synced data stays in your account.") + '</p></div>';
      // Account type + language + details.
      html += '<div class="panel"><div class="lbl"><span>MY DETAILS</span></div>' +
        '<label class="sub" style="display:block;margin-top:8px">Account type<select id="pf-type" class="in" style="width:100%;margin-top:4px">' +
        NMStore.PROFILE_TYPES.map(function (t) {
          return '<option value="' + t[0] + '"' + (profile.type === t[0] ? " selected" : "") + '>' + t[1] + '</option>';
        }).join("") + '</select></label>' +
        '<p class="sub">Your account type personalises Home and the compliance calendar. Business types see GST, invoices and expenses first.</p>' +
        '<label class="sub" style="display:block;margin-top:10px">Language<select id="pf-lang" class="in" style="width:100%;margin-top:4px">' +
        NMStore.LANGUAGES.map(function (l) {
          return '<option value="' + l[0] + '"' + (profile.language === l[0] ? " selected" : "") + '>' + l[1] + '</option>';
        }).join("") + '</select></label>' +
        '<label class="sub" style="display:block;margin-top:10px">Your name (optional)<input id="pf-name" class="in" style="width:100%;margin-top:4px" value="' + esc(profile.name) + '" placeholder="Your name"></label>' +
        '<label class="sub" style="display:block;margin-top:10px">Business name (optional)<input id="pf-biz" class="in" style="width:100%;margin-top:4px" value="' + esc(profile.businessName) + '" placeholder="Used on invoices"></label>' +
        '<div class="row"><button class="btn" id="pf-save">Save details</button></div>' +
        '<p class="sub" id="pf-saved" style="margin-top:8px"></p></div>';
      // Theme info.
      html += '<div class="panel"><div class="lbl"><span>APPEARANCE</span></div>' +
        '<p class="sub" style="margin-top:8px">NoticeMitra uses a light theme with a deep green primary colour, chosen for clear reading in daylight. There is no dark theme in this build.</p></div>';
      // Credits.
      html += '<div class="panel"><div class="lbl"><span>AI CALLS AND CREDITS</span></div>' +
        '<div id="pf-credits"><p class="sub" style="margin-top:8px">Checking…</p></div>' +
        '<p class="sub" style="margin-top:8px">You get 20 free AI calls every day. One call is one AI step, for example one specialist answer or one Ask CA reply. Need more? Notice pack: Rs 699 for 300 calls. Pro month: Rs 299 for 150 calls. You are charged only when an AI answer succeeds. If a call fails, nothing is charged.</p></div>';
      // Extension points for the next worker.
      html += '<!-- EXTENSION POINT: plans and paywall --><section id="profile-plans"></section>' +
        '<!-- EXTENSION POINT: multi-business switcher --><section id="profile-businesses"></section>' +
        '<!-- EXTENSION POINT: referral --><section id="profile-referral"></section>';
      // How it works, full copy preserved (privacy panel updated honestly
      // for accounts and sync; see the delivery report).
      html += '<div id="pf-how"><div class="panel why"><div class="lbl"><span>WHAT IS NOTICEMITRA</span></div>' +
        '<p>A virtual CA on your phone for small traders and small businesses. It explains GST notices in simple words, drafts replies, answers tax questions, tracks due dates, makes GST invoices, and prepares your ITR filing sheet. Talk or type in Hinglish, Hindi or English.</p></div>' +
        '<div class="panel"><div class="lbl"><span>WHAT IS FREE, WHAT IS PAID</span></div>' +
        '<p class="sub" style="margin-top:8px">You get 20 free AI calls every day. One call is one AI step, for example one specialist answer or one Ask CA reply. The due dates list and the invoice maker need no AI calls and work on your phone itself.</p>' +
        '<p class="sub">Need more? Notice pack: Rs 699 for 300 calls. Pro month: Rs 299 for 150 calls. You are charged only when an AI answer succeeds. If a call fails, nothing is charged.</p></div>' +
        '<div class="panel"><div class="lbl"><span>YOUR PRIVACY</span></div>' +
        '<p class="sub" style="margin-top:8px">Photos of notices and tax documents are sent to the AI service so they can be read. Answers mask the middle digits of GSTIN numbers.</p>' +
        '<p class="sub">On this device only mode: your saved cases stay on this device and are never uploaded. When you are signed in: your saved cases are copied to your account at first sign-in and then sync to your account, so they are available if you change phones. The app never asks for your income tax portal or bank passwords or OTPs.</p></div>' +
        '<div class="panel"><div class="lbl"><span>IMPORTANT LIMITS</span></div>' +
        '<p class="sub" style="margin-top:8px">This app is not legal advice and is not a licensed CA. Drafts must be reviewed by your CA before filing. Audit, certification and appearing before officers need a practising CA. Always check dates and numbers on gst.gov.in and incometax.gov.in before you file.</p></div></div>';
      // Privacy and terms summaries (short summaries of the legal drafts;
      // the full documents are drafts pending lawyer review).
      html += '<div class="panel"><div class="lbl"><span>PRIVACY SUMMARY</span></div>' +
        '<p class="sub" style="margin-top:8px">What the app handles: text you type or speak, photos of tax documents, and basic usage and payment records. Inputs are sent to the server and then to the AI service to produce drafts, checklists and estimates, and are used only to provide the service. The app does not sell your data. Under the DPDP Act, 2023, you may ask to access, correct or delete your data or withdraw consent. The full privacy policy is a draft pending lawyer review before publishing.</p></div>' +
        '<div class="panel"><div class="lbl"><span>TERMS SUMMARY</span></div>' +
        '<p class="sub" style="margin-top:8px">NoticeMitra is an AI tool. It is not a Chartered Accountant, lawyer or tax authority, and outputs can be wrong or out of date. You are responsible for reviewing every draft, number and date with a qualified CA before filing or replying to any notice, and for verifying on gst.gov.in and incometax.gov.in. You file and e-verify returns yourself on the official portal. The app does not file on your behalf. Packs are prepaid credits. The full terms are a draft pending lawyer review before publishing.</p></div>';
      // Local data controls.
      html += '<div class="panel"><div class="lbl"><span>DATA ON THIS DEVICE</span></div>' +
        '<div class="row"><button class="btn g" id="pf-wipe" style="flex:1">Delete all local data</button></div>' +
        '<p class="sub" style="margin-top:8px">Deletes saved cases, documents, invoices, registers, notes, transactions, businesses, done marks and chat history stored on this device. It does not delete anything already synced to your account.</p></div>';
      html += '<p class="dis">NoticeMitra · Virtual CA for small traders and small businesses.</p>';
      el.innerHTML = html;

      $("pf-save").onclick = function () {
        NMStore.saveProfile({
          type: $("pf-type").value,
          language: $("pf-lang").value,
          name: $("pf-name").value.trim(),
          businessName: $("pf-biz").value.trim()
        });
        $("pf-saved").textContent = "Saved. Home and the compliance calendar now use your new details.";
      };
      $("pf-signout").onclick = function () {
        NMAuth.signOut();
        NMApp.showAuth();
      };
      $("pf-wipe").onclick = function () {
        if (!confirm("Delete all NoticeMitra data stored on this device? This cannot be undone.")) return;
        try {
          ["nm", "nm_vault", "nm_invoices", "nm_tasks_done", "nm_chat", "nm_queue"].forEach(function (k) { localStorage.removeItem(k); });
          if (window.NMStore && NMStore.wipeW4bKeys) NMStore.wipeW4bKeys();
        } catch (e) {}
        NMApp.show("profile");
      };
      // Credits: live when the server is reachable, honest state otherwise.
      var box = $("pf-credits");
      NMApi.probeLive().then(function (live) {
        if (!live) {
          box.innerHTML = '<p class="sub" style="margin-top:8px">Your balance needs the live server, which is not reachable right now. Your 20 free calls a day and any packs you bought are counted on the server, not on this phone.</p>';
          return;
        }
        return NMApi.getCredits().then(function (res) {
          if (!res.ok) {
            box.innerHTML = '<p class="sub" style="margin-top:8px">Could not load your balance (' + esc(res.error || "server error") + '). Please try again later.</p>';
            return;
          }
          var d = res.data || {};
          box.innerHTML = '<div class="kv"><span>Free calls left today</span><b>' + esc(String(d.free_left == null ? "unknown" : d.free_left)) + '</b></div>' +
            '<div class="kv"><span>Pack credits</span><b>' + esc(String(d.credits == null ? "unknown" : d.credits)) + '</b></div>';
        });
      }).catch(function () {
        box.innerHTML = '<p class="sub" style="margin-top:8px">Your balance needs the live server, which is not reachable right now.</p>';
      });
      if (options.section === "how") {
        var target = $("pf-how");
        if (target) setTimeout(function () { target.scrollIntoView(); }, 50);
      }
    }
  };
})();
