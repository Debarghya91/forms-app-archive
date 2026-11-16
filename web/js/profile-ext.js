// NMProfileExt (W4b): fills the three Profile extension containers left
// by W4a (#profile-plans, #profile-businesses, #profile-referral).
// W4a code in profile.js is not edited: this file wraps NMProfile.render,
// calls the original first, then renders into the empty containers.
// Plans follow contract section 8. Buy flows call /api/pay/order plus
// the payment checkout plus /api/pay/verify when the server is live, and
// show the honest "payments need the live server" state otherwise.
// Nothing is ever activated client-side: only a server verify response
// followed by a fresh GET /api/subscription can change the shown plan.
// Credit pack identifiers (notice_pack, pro_month) and plan identifiers
// are the pack values sent to /api/pay/order; the contract does not fix
// their spelling, so the server worker must accept these values.
(function () {
  "use strict";
  function esc(s) { return NMUtil.esc(s); }
  function $(id) { return document.getElementById(id); }
  var PLANS = [
    { id: "free", name: "Free", price: "Rs 0", range: null, features: ["20 AI calls a day", "Basic calculators", "Basic invoice maker", "Basic compliance calendar"], cta: null },
    { id: "personal_plus", name: "Personal Plus", price: "Rs 99/month", range: "Rs 99 to Rs 149/month", features: ["Higher AI call cap", "Notice analysis", "Document vault"], cta: "Buy Personal Plus" },
    { id: "business_pro", name: "Business Pro", price: "Rs 299/month", range: "Rs 299 to Rs 499/month", features: ["Registers and ITC workings", "GSTR-2B reconciliation", "Expenses and reports"], cta: "Buy Business Pro" },
    { id: "ca_professional", name: "CA Professional", price: "Rs 999/month", range: "Rs 999 to Rs 1,999/month", features: ["Client dashboard foundation", "Multi-business"], cta: "Buy CA Professional" }
  ];
  var PACKS = [
    { id: "notice_pack", name: "Notice pack", price: "Rs 699", calls: "300 AI calls", cta: "Buy Notice pack" },
    { id: "pro_month", name: "Pro month", price: "Rs 299", calls: "150 AI calls", cta: "Buy Pro month" }
  ];
  var GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

  // One buy flow for plans and credit packs. Steps: probe the server,
  // create the order, open the payment checkout when one is loaded, then
  // verify with the server. Without a checkout object loaded, the order
  // is reported honestly and no payment is taken. Without the server,
  // the button shows the honest no-server state.
  function payFlow(packId, label, btn, statusEl, onDone) {
    btn.disabled = true;
    statusEl.textContent = "Checking the server…";
    NMApi.probeLive().then(function (live) {
      if (!live) {
        statusEl.textContent = "Payments need the live server, which is not reachable right now. Nothing was charged and nothing changed.";
        btn.disabled = false;
        return null;
      }
      statusEl.textContent = "Creating your order…";
      return NMApi.request("/api/pay/order", { method: "POST", body: { pack: packId } });
    }).then(function (res) {
      if (!res) return;
      if (!res.ok || !res.data || !res.data.order_id) {
        statusEl.textContent = "The order could not be created (" + (res.error || "server error") + "). Nothing was charged.";
        btn.disabled = false;
        return;
      }
      var order = res.data;
      if (typeof window.Razorpay !== "function") {
        statusEl.textContent = "Order " + order.order_id + " was created on the server, but the payment checkout is not available in this build, so no payment was taken and nothing was activated. Please try again in the released app.";
        btn.disabled = false;
        return;
      }
      statusEl.textContent = "Opening the payment checkout…";
      var options = {
        key: order.key,
        order_id: order.order_id,
        name: "NoticeMitra",
        description: label,
        handler: function (resp) {
          statusEl.textContent = "Payment received. Asking the server to verify it…";
          NMApi.request("/api/pay/verify", { method: "POST", body: { order_id: order.order_id, payment_id: resp.razorpay_payment_id, signature: resp.razorpay_signature } }).then(function (vres) {
            btn.disabled = false;
            if (vres.ok) {
              statusEl.textContent = "Payment verified by the server. Refreshing your plan and credits…";
              if (typeof onDone === "function") onDone();
            } else {
              statusEl.textContent = "The server could not verify this payment (" + (vres.error || "verification failed") + "). Nothing was activated. If money left your account, contact support with order " + order.order_id + ".";
            }
          });
        },
        modal: { ondismiss: function () { statusEl.textContent = "Payment cancelled. Nothing was charged and nothing changed."; btn.disabled = false; } }
      };
      if (order.amount) options.amount = order.amount;
      try {
        var rzp = new window.Razorpay(options);
        if (rzp.on) rzp.on("payment.failed", function () { statusEl.textContent = "The payment failed. Nothing was charged and nothing changed."; btn.disabled = false; });
        rzp.open();
      } catch (e) {
        statusEl.textContent = "The payment checkout could not open. No payment was taken and nothing was activated.";
        btn.disabled = false;
      }
    }).catch(function () {
      statusEl.textContent = "Payments need the live server, which is not reachable right now. Nothing was charged.";
      btn.disabled = false;
    });
  }

  // ---------------- Plans and paywall ----------------
  function renderPlans() {
    var box = $("profile-plans");
    if (!box) return;
    var html = '<div class="panel"><div class="lbl"><span>MY PLAN</span></div><div id="pf2-sub"><p class="sub" style="margin-top:8px">Checking your plan…</p></div>' +
      '<div class="row"><button class="btn g" id="pf2-restore" style="flex:1">Restore purchase (re-check with server)</button>' +
      '<button class="btn g" id="pf2-cancel" style="flex:1">Cancel plan</button></div>' +
      '<p class="sub" id="pf2-sub-status" style="margin-top:8px"></p></div>';
    html += '<div class="panel"><div class="lbl"><span>PLANS</span><span>LAUNCH PRICING</span></div>' +
      '<p class="sub" style="margin-top:8px">Prices below are launch prices and part of an experiment. The range on each paid plan shows what the price may become. The free plan gives 20 AI calls a day, basic calculators, a basic invoice maker and a basic compliance calendar.</p>';
    PLANS.forEach(function (p) {
      html += '<div class="kv" style="flex-direction:column;align-items:stretch;gap:6px"><span><b>' + esc(p.name) + '</b> · ' + esc(p.price) + (p.range ? ' <span class="sub">(range ' + esc(p.range) + ')</span>' : "") +
        '<br><span class="sub">' + esc(p.features.join(", ")) + '</span></span>' +
        '<span class="cs-actions">' + (p.cta ? '<button class="btn sm" data-plan-buy="' + p.id + '">' + esc(p.cta) + '</button>' : '<span class="tag ext">NO PURCHASE NEEDED</span>') + '</span></div>';
    });
    html += '<p class="sub" id="pf2-pay-status" style="margin-top:8px"></p></div>';
    html += '<div class="panel"><div class="lbl"><span>CREDIT PACKS</span></div>' +
      '<p class="sub" style="margin-top:8px">Prepaid AI calls on top of your plan. You are charged only when an AI answer succeeds. If a call fails, nothing is charged.</p>';
    PACKS.forEach(function (p) {
      html += '<div class="kv" style="flex-direction:column;align-items:stretch;gap:6px"><span><b>' + esc(p.name) + '</b> · ' + esc(p.price) + ' · ' + esc(p.calls) + '</span>' +
        '<span class="cs-actions"><button class="btn sm" data-pack-buy="' + p.id + '">' + esc(p.cta) + '</button></span></div>';
    });
    html += '<p class="sub" style="margin-top:8px">Payments are handled by the server. This app never activates a plan or credits on its own.</p></div>';
    box.innerHTML = html;

    function loadSubscription() {
      var sub = $("pf2-sub");
      NMApi.probeLive().then(function (live) {
        if (!live) {
          sub.innerHTML = '<p class="sub" style="margin-top:8px">Your plan needs the live server, which is not reachable right now. You are on the free plan on this device (20 AI calls a day when the server is live).</p>';
          return null;
        }
        return NMApi.getSubscription();
      }).then(function (res) {
        if (!res) return;
        if (!res.ok) {
          if (NMApi.isPilotError(res)) {
            sub.innerHTML = '<p class="sub" style="margin-top:8px">The server is running but accounts are not configured on it yet, so plan details are not available. You are on the free plan on this device.</p>';
          } else {
            sub.innerHTML = '<p class="sub" style="margin-top:8px">Could not load your plan (' + esc(res.error || "server error") + '). Please try again later.</p>';
          }
          return;
        }
        var d = res.data || {};
        var planName = (PLANS.filter(function (p) { return p.id === d.plan; })[0] || {}).name || (d.plan || "Free");
        sub.innerHTML = '<div class="kv"><span>Plan</span><b>' + esc(planName) + '</b></div>' +
          '<div class="kv"><span>Status</span><b>' + esc(d.status || "unknown") + '</b></div>' +
          (d.expires_at ? '<div class="kv"><span>Expires</span><b>' + esc(String(d.expires_at).slice(0, 10)) + '</b></div>' : "") +
          (d.credits !== undefined && d.credits !== null ? '<div class="kv"><span>Pack credits</span><b>' + esc(String(d.credits)) + '</b></div>' : "");
      }).catch(function () {
        sub.innerHTML = '<p class="sub" style="margin-top:8px">Your plan needs the live server, which is not reachable right now.</p>';
      });
    }
    loadSubscription();
    $("pf2-restore").onclick = function () {
      $("pf2-sub-status").textContent = "Re-checking your subscription with the server…";
      loadSubscription();
      $("pf2-sub-status").textContent = "Restore means re-reading your subscription from the server. It does not change anything on its own.";
    };
    $("pf2-cancel").onclick = function () {
      if (!confirm("Cancel your plan? Your paid features stay until the end of the current period, as decided by the server.")) return;
      var st = $("pf2-sub-status");
      st.textContent = "Checking the server…";
      NMApi.probeLive().then(function (live) {
        if (!live) { st.textContent = "Cancelling needs the live server, which is not reachable right now. Nothing changed."; return null; }
        return NMApi.request("/api/subscription/cancel", { method: "POST", body: {} });
      }).then(function (res) {
        if (!res) return;
        if (res.ok) {
          st.textContent = "Cancel request accepted by the server (status: " + esc(String((res.data && res.data.status) || "cancelled")) + "). Refreshing your plan…";
          loadSubscription();
        } else {
          st.textContent = "The server did not cancel the plan (" + (res.error || "server error") + "). Nothing changed.";
        }
      }).catch(function () { st.textContent = "Cancelling needs the live server, which is not reachable right now."; });
    };
    var payStatus = $("pf2-pay-status");
    box.querySelectorAll("[data-plan-buy]").forEach(function (btn) {
      btn.onclick = function () {
        var plan = PLANS.filter(function (p) { return p.id === btn.getAttribute("data-plan-buy"); })[0];
        payFlow(plan.id, plan.name + " plan, " + plan.price, btn, payStatus, loadSubscription);
      };
    });
    box.querySelectorAll("[data-pack-buy]").forEach(function (btn) {
      btn.onclick = function () {
        var pack = PACKS.filter(function (p) { return p.id === btn.getAttribute("data-pack-buy"); })[0];
        payFlow(pack.id, pack.name + ", " + pack.price, btn, payStatus, loadSubscription);
      };
    });
  }

  // ---------------- Multi-business ----------------
  function renderBusinesses() {
    var box = $("profile-businesses");
    if (!box) return;
    var list = NMStore.ensureDefaultBusiness();
    var activeId = NMStore.activeBusinessId();
    var html = '<div class="panel"><div class="lbl"><span>MY BUSINESSES</span></div>' +
      '<p class="sub" style="margin-top:8px">The active business drives the Business tab figures and the Home overview. Each business keeps its own registers, notes and transactions.</p>';
    list.forEach(function (b) {
      html += '<div class="cs stack" style="cursor:default"><span><b>' + esc(b.name) + '</b> · ' + esc(NMStore.businessTypeLabel(b.type)) + (b.gstin ? '<br><span class="sub">GSTIN ' + esc(b.gstin) + '</span>' : "") + '</span>' +
        '<span class="cs-actions">' +
        (b.id === activeId ? '<b class="dd">Active</b>' : '<button class="btn sm" data-biz-switch="' + b.id + '">Switch</button>') +
        (list.length > 1 ? '<button class="btn sm g" data-biz-del="' + b.id + '">Delete</button>' : "") + '</span></div>';
    });
    html += '</div>';
    html += '<div class="panel"><div class="lbl"><span>ADD A BUSINESS</span></div>' +
      '<div class="row"><input id="pf2-biz-name" class="in" placeholder="Business name"></div>' +
      '<div class="row"><input id="pf2-biz-gstin" class="in" placeholder="GSTIN (optional, 15 characters)"></div>' +
      '<div class="row"><select id="pf2-biz-type" class="in">' +
      [["sole_proprietor", "Sole proprietor"], ["partnership", "Partnership firm"], ["llp", "LLP"], ["private_limited", "Private limited company"], ["other", "Other"]].map(function (t) {
        return '<option value="' + t[0] + '">' + t[1] + '</option>';
      }).join("") + '</select></div>' +
      '<div class="row"><button class="btn" id="pf2-biz-add">Add business</button></div>' +
      '<p class="sub" id="pf2-biz-status" style="margin-top:8px"></p>' +
      '<div id="pf2-biz-server"></div></div>';
    box.innerHTML = html;

    function syncBusinesses(statusText) {
      var payload = { businesses: NMStore.businesses(), active_business_id: NMStore.activeBusinessId() };
      NMSync.postOrQueue("profile_sync", "/api/profile", "PUT", payload).then(function (res) {
        var st = $("pf2-biz-status");
        if (st) st.textContent = (statusText ? statusText + " " : "") + res.reason;
      });
    }
    box.querySelectorAll("[data-biz-switch]").forEach(function (btn) {
      btn.onclick = function () {
        var b = NMStore.setActiveBusiness(btn.getAttribute("data-biz-switch"));
        renderBusinesses();
        syncBusinesses(b ? ("Active business is now " + b.name + ". Business figures and Home now use this business.") : "");
      };
    });
    box.querySelectorAll("[data-biz-del]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("Delete this business? Its registers, notes and transactions stay on this device but will no longer be reachable from the switcher.")) return;
        NMStore.removeBusiness(btn.getAttribute("data-biz-del"));
        renderBusinesses();
        syncBusinesses("Business deleted.");
      };
    });
    $("pf2-biz-add").onclick = function () {
      var name = $("pf2-biz-name").value.trim();
      var gstin = $("pf2-biz-gstin").value.trim().toUpperCase();
      var st = $("pf2-biz-status");
      if (!name) { st.textContent = "Enter a business name."; return; }
      if (gstin && !GSTIN_RE.test(gstin)) { st.textContent = "That GSTIN does not look like a 15 character GSTIN. Check it, or leave it empty."; return; }
      NMStore.addBusiness({ name: name.slice(0, 80), gstin: gstin, type: $("pf2-biz-type").value });
      renderBusinesses();
      syncBusinesses("Business added.");
    };
    // If the server has a different business list, offer it without ever
    // silently overwriting the local list.
    if (NMSync.canPost()) {
      NMApi.getProfile().then(function (res) {
        var srv = $("pf2-biz-server");
        if (!res.ok || !srv || !res.data || !Array.isArray(res.data.businesses) || !res.data.businesses.length) return;
        var serverNames = res.data.businesses.map(function (b) { return b.name; }).join(", ");
        var localNames = NMStore.businesses().map(function (b) { return b.name; }).join(", ");
        if (serverNames === localNames) return;
        srv.innerHTML = '<div class="warn">Your account also lists: ' + esc(serverNames) + '. <button class="btn sm g" id="pf2-biz-adopt">Use the account list instead</button></div>';
        var adopt = $("pf2-biz-adopt");
        if (adopt) adopt.onclick = function () {
          try {
            localStorage.setItem("nm_businesses", JSON.stringify(res.data.businesses.map(function (b) {
              return { id: b.id || NMUtil.uid("biz"), name: b.name || "Business", gstin: b.gstin || "", type: b.type || "sole_proprietor" };
            })));
            localStorage.removeItem("nm_active_biz");
          } catch (e) {}
          renderBusinesses();
        };
      }).catch(function () {});
    }
  }

  // ---------------- Referral ----------------
  function renderReferral() {
    var box = $("profile-referral");
    if (!box) return;
    var html = '<div class="panel"><div class="lbl"><span>REFER AND EARN</span></div>' +
      '<div id="pf2-ref-body"><p class="sub" style="margin-top:8px">Checking your referral details…</p></div>' +
      '<div class="row"><input id="pf2-ref-code" class="in" placeholder="Have a referral code? Enter it here"></div>' +
      '<div class="row"><button class="btn" id="pf2-ref-redeem">Redeem code</button></div>' +
      '<p class="sub" id="pf2-ref-status" style="margin-top:8px"></p></div>';
    box.innerHTML = html;
    var body = $("pf2-ref-body");
    function loadReferral() {
      NMApi.probeLive().then(function (live) {
        if (!live) {
          body.innerHTML = '<p class="sub" style="margin-top:8px">Referrals need the live server, which is not reachable right now. Your code, count and earnings live on the server, not on this phone.</p>';
          return null;
        }
        return NMApi.request("/api/referral");
      }).then(function (res) {
        if (!res) return;
        if (!res.ok) {
          body.innerHTML = '<p class="sub" style="margin-top:8px">Could not load your referral details (' + esc(res.error || "server error") + '). Please try again later.</p>';
          return;
        }
        var d = res.data || {};
        body.innerHTML = '<div class="kv"><span>Your code</span><b>' + esc(d.code || "not assigned yet") + '</b></div>' +
          '<div class="kv"><span>People who joined with your code</span><b>' + esc(String(d.count == null ? 0 : d.count)) + '</b></div>' +
          '<div class="kv"><span>Earned</span><b>' + esc(String(d.earned == null ? 0 : d.earned)) + '</b></div>' +
          (d.code ? '<div class="row"><button class="btn" id="pf2-ref-share">Share my code on WhatsApp</button></div>' : "");
        var share = $("pf2-ref-share");
        if (share) share.onclick = function () {
          var text = "Try NoticeMitra, a virtual CA for small businesses. Use my referral code " + d.code + " when you join.";
          window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
        };
      }).catch(function () {
        body.innerHTML = '<p class="sub" style="margin-top:8px">Referrals need the live server, which is not reachable right now.</p>';
      });
    }
    loadReferral();
    $("pf2-ref-redeem").onclick = function () {
      var code = $("pf2-ref-code").value.trim();
      var st = $("pf2-ref-status");
      if (!code) { st.textContent = "Enter a referral code first."; return; }
      st.textContent = "Checking the server…";
      NMApi.probeLive().then(function (live) {
        if (!live) { st.textContent = "Redeeming needs the live server, which is not reachable right now. Nothing changed."; return null; }
        return NMApi.request("/api/referral/redeem", { method: "POST", body: { code: code } });
      }).then(function (res) {
        if (!res) return;
        if (res.ok) {
          st.textContent = "Code accepted by the server. " + esc((res.data && (res.data.message || res.data.note)) || "Your referral details are refreshing.");
          loadReferral();
        } else {
          st.textContent = "That code was not accepted (" + (res.error || "server error") + "). Nothing changed.";
        }
      }).catch(function () { st.textContent = "Redeeming needs the live server, which is not reachable right now."; });
    };
  }

  window.NMProfileExt = {
    renderPlans: renderPlans,
    renderBusinesses: renderBusinesses,
    renderReferral: renderReferral
  };
  if (window.NMProfile && NMProfile.render) {
    var origProfileRender = NMProfile.render;
    NMProfile.render = function (el, options) {
      origProfileRender.call(this, el, options);
      renderPlans();
      renderBusinesses();
      renderReferral();
      if (window.NMSync) NMSync.flush();
    };
  }
})();
