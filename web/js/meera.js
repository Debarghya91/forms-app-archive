// NMMeera: Meera AI destination. Two modes: Chat (the evolved assistant,
// replaces the Ask CA view, keeps its explainer copy) and Notice (Meera +
// the 6-specialist team, moved here from the old Notice view).
// Chat sends profile type, saved-case summaries and history to
// /api/orchestrate when the server is live, falls back to /api/ai through
// the existing shim, and shows an honest state when there is no server.
// Notice calls /api/notice/analyze when live, else the 6-call shim flow.
// Server outputs keep their extracted / interpretation / needs-verification
// labels when present. No fake answers, ever.
(function () {
  "use strict";
  function esc(s) { return window.NMAuth ? NMAuth.esc(s) : String(s); }
  function $(id) { return document.getElementById(id); }
  var MODE = "chat";
  var PENDING_CASE_T = null;
  var PENDING_PREFILL = "";
  var NOTICE_PHOTO = null; // File chosen in Notice mode
  var CHAT_PHOTO = null; // File chosen in Chat mode

  var SPECIALISTS = [
    ["decode", "📖", "Notice decoder", "Explain in simple Hinglish: which form/section this is, what the department alleges, and the amount at stake. Max 90 words.", "Explains in simple words what the notice means and what is at stake."],
    ["reply", "✍️", "Reply drafter", "Draft a polite, formal reply to the officer ready to paste into the GST portal, with [placeholders] for facts we lack. Max 160 words.", "Writes a polite reply draft, ready to paste in the GST portal."],
    ["docs", "📎", "Documents checklist", "Checklist of exact documents/returns/ledger extracts to attach for this notice. Short bullets.", "Lists the exact papers to attach with your reply."],
    ["dates", "📅", "Deadline planner", "Day-by-day plan from today until the reply deadline (use the notice date if given, else say assumed 15 days). Short bullets.", "A day by day plan from today until the reply deadline."],
    ["risk", "⚠️", "Risk & penalty", "Plain estimate of worst case (tax + interest + penalty logic), what lowers it, and 2 things NOT to do. Say if unsure.", "Rough estimate of tax, interest and penalty, and two things not to do."],
    ["ca", "💬", "CA brief (WhatsApp)", "A WhatsApp message under 90 words the trader can send to their CA summarising the case and asking for a quote and a review.", "A short message to send your CA on WhatsApp for a review."]
  ];
  var DEMO = "Mujhe GST department se notice aaya hai, form DRC-01 ya ASMT-10 jaisa. Kehte hain March ke GSTR-3B aur GSTR-2B mein ITC ka mismatch hai, kareeb 1.8 lakh ka. Main Surat mein kapde ka trader hun, mere supplier ne shayad return late file kiya. 7 din mein jawab dena hai.";

  function langName() {
    var lang = NMStore.getProfile().language;
    return { hi: "simple Hindi (Devanagari)", en: "simple English", hg: "Hinglish (Hindi in Roman script)" }[lang] || "Hinglish (Hindi in Roman script)";
  }
  function copyButton(text) {
    var c = document.createElement("button");
    c.className = "cp"; c.textContent = "Copy";
    c.onclick = function () {
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { c.textContent = "Copied"; }).catch(function () {});
    };
    return c;
  }
  function b64(file) {
    return new Promise(function (resolve) {
      var f = new FileReader();
      f.onload = function () { resolve(f.result.split(",")[1]); };
      f.readAsDataURL(file);
    });
  }
  function attachDictation(btnId, inputId) {
    if (!window.claude || !claude.use) return;
    claude.use("dictation").then(function (d) {
      if (!d) return;
      var m = $(btnId);
      if (!m) return;
      m.hidden = false;
      var on = false;
      d.onFinal(function (r) {
        var input = $(inputId);
        if (input) input.value += (input.value ? " " : "") + r.text;
      });
      d.onState(function (s) {
        on = s.state === "listening";
        m.textContent = on ? "Stop" : "Speak";
      });
      m.onclick = function () { if (on) d.stop(); else d.start().catch(function () {}); };
    }).catch(function () {});
  }

  // ---------------- Chat mode ----------------
  function chatContext() {
    var cases = NMStore.cases().slice(0, 5).map(function (c) {
      return { brief: (c.brief || "").slice(0, 120), due: c.due || "", amount: c.amt || "" };
    });
    return { profile_type: NMStore.getProfile().type, cases: cases };
  }
  function renderChat(el) {
    var hist = NMStore.chatHistory();
    var html = '<div class="panel why"><div class="lbl"><span>HOW THIS WORKS</span></div>' +
      '<p>Ask any business tax question in Hinglish, Hindi or English: GST, income tax, TDS, bookkeeping, payroll, MSME and ROC basics. Type your question and tap Ask. You get practical steps, the forms involved, and the usual due dates. You can also attach a photo of a document and it will be read for you.</p></div>' +
      '<div class="panel"><div class="lbl"><span>ASK MEERA, YOUR VIRTUAL CA</span><span>GST · TAX · TDS · ROC</span></div>' +
      '<div id="chat-log"></div>' +
      '<div id="chat-photo-note" class="sub hid" style="margin-top:8px"></div>' +
      '<textarea id="chat-q" placeholder="e.g. Mera turnover 38 lakh hai, GST registration zaruri hai? Employee ka TDS kab katna hai?"></textarea>' +
      '<div class="row"><label class="btn g" style="text-align:center">Photo<input id="chat-pic" type="file" accept="image/*" hidden></label>' +
      '<button class="btn g" id="chat-mic" hidden>Speak</button>' +
      '<button class="btn" id="chat-send">Ask</button></div>' +
      '<div class="row"><button class="btn g" id="chat-clear" style="flex:1">Clear chat</button></div>' +
      '<p class="sub">AI assistant, not a licensed CA. Audit, certification and appearing before officers need a practising CA.</p></div>' +
      '<p class="dis">Meera answers from the live server when it is reachable. If the server is not reachable, she says so instead of guessing.</p>';
    el.innerHTML = html;
    var log = $("chat-log");
    function bub(text, me, sources) {
      var d = document.createElement("div");
      d.className = "bub" + (me ? " me" : "");
      d.textContent = text;
      if (sources && sources.length) {
        sources.forEach(function (s) {
          var c = document.createElement("div");
          c.className = "cite";
          c.innerHTML = "<b>Source:</b> " + esc(s.title || "Untitled") + (s.publisher ? " · " + esc(s.publisher) : "") + (s.date ? " · " + esc(s.date) : "");
          d.appendChild(c);
        });
      }
      log.appendChild(d);
      return d;
    }
    hist.forEach(function (m) { bub(m.content, m.role === "user"); });
    if (PENDING_PREFILL) {
      $("chat-q").value = PENDING_PREFILL;
      PENDING_PREFILL = "";
    }
    $("chat-clear").onclick = function () {
      NMStore.clearChatHistory();
      log.innerHTML = "";
    };
    $("chat-pic").onchange = function (e) {
      CHAT_PHOTO = e.target.files[0] || null;
      var note = $("chat-photo-note");
      if (CHAT_PHOTO) {
        note.textContent = "Photo attached: " + CHAT_PHOTO.name + ". It will be read with your question.";
        note.classList.remove("hid");
      } else note.classList.add("hid");
    };
    attachDictation("chat-mic", "chat-q");
    $("chat-send").onclick = function () {
      var q = $("chat-q").value.trim();
      if (!q || $("chat-send").disabled) return;
      var photo = CHAT_PHOTO;
      CHAT_PHOTO = null;
      $("chat-photo-note").classList.add("hid");
      $("chat-q").value = "";
      bub(q, true);
      hist.push({ role: "user", content: q });
      NMStore.saveChatHistory(hist);
      var waiting = bub("Thinking…");
      $("chat-send").disabled = true;
      var sys = "You are Meera, a virtual CA assistant for small Indian businesses covering GST, income tax, TDS, bookkeeping, payroll, MSME and ROC basics. Reply in " + langName() + ". Give practical steps, relevant forms and usual due dates. State your assumptions. Never invent section numbers, rates or figures; say what to verify on the official portal. Say clearly when a practising CA must sign, certify or represent. Keep under 150 words unless asked for more.";
      var messages = hist.slice(-9).map(function (x, i) {
        return i === 0 ? { role: "user", content: sys + "\n\n" + x.content } : x;
      });
      function viaShim() {
        return claude.use("sample").then(function (sample) {
          if (!sample) throw new Error("no sample");
          var opts = { cache: false };
          if (photo) opts.images = [photo];
          return sample(messages, opts).then(function (r) { return { text: r.text, sources: [] }; });
        });
      }
      function finish(text, sources) {
        waiting.textContent = text;
        if (sources && sources.length) {
          waiting.textContent = "";
          waiting.appendChild(document.createTextNode(text));
          sources.forEach(function (s) {
            var c = document.createElement("div");
            c.className = "cite";
            c.innerHTML = "<b>Source:</b> " + esc(s.title || "Untitled") + (s.publisher ? " · " + esc(s.publisher) : "") + (s.date ? " · " + esc(s.date) : "");
            waiting.appendChild(c);
          });
        }
        hist.push({ role: "assistant", content: text });
        NMStore.saveChatHistory(hist);
        $("chat-send").disabled = false;
      }
      function honestState() {
        waiting.textContent = "AI needs the live server, and it is not reachable right now. Your question is saved in this chat. Please try again when the server is live. For urgent notice replies, use the Notice mode checklists and speak to your CA.";
        hist.pop();
        NMStore.saveChatHistory(hist);
        $("chat-send").disabled = false;
      }
      NMApi.probeLive().then(function (live) {
        if (!live) return viaShim().then(function (r) { finish(r.text, r.sources); }).catch(honestState);
        var payload = { messages: messages, context: chatContext() };
        if (photo) {
          return b64(photo).then(function (data) {
            payload.context.image = { media_type: photo.type || "image/jpeg", data: data };
            return NMApi.orchestrate(payload.messages, payload.context);
          });
        }
        return NMApi.orchestrate(payload.messages, payload.context);
      }).then(function (res) {
        if (!res) return;
        if (res.ok && res.data && res.data.answer) {
          finish(res.data.answer, res.data.sources || []);
        } else if (res.status === 402) {
          waiting.textContent = "You are out of AI calls for today (20 free calls a day). The Notice pack and Pro month add more. See Profile for details.";
          hist.pop(); NMStore.saveChatHistory(hist);
          $("chat-send").disabled = false;
        } else {
          viaShim().then(function (r) { finish(r.text, r.sources); }).catch(honestState);
        }
      }).catch(function () {
        viaShim().then(function (r) { finish(r.text, r.sources); }).catch(honestState);
      });
    };
  }

  // ---------------- Notice mode ----------------
  var busy = 0;
  function buildTeam() {
    var ags = $("ags");
    if (!ags) return;
    ags.innerHTML = "";
    SPECIALISTS.forEach(function (sp) {
      var el = document.createElement("div");
      el.className = "ag"; el.id = "a-" + sp[0];
      el.innerHTML = '<button type="button" class="ah"><div class="ic">' + sp[1] + '</div><span class="t"></span><span class="st">QUEUED</span></button><div class="ab"></div>';
      var ts = el.querySelector(".t");
      ts.textContent = sp[2];
      var sm = document.createElement("small");
      sm.textContent = sp[4];
      ts.appendChild(sm);
      el.querySelector(".ah").onclick = function () { el.classList.toggle("open"); };
      ags.appendChild(el);
    });
  }
  function setSt(id, s, cls) {
    var e = $("a-" + id);
    if (!e) return;
    var st = e.querySelector(".st");
    st.textContent = s;
    st.className = "st " + (cls || "");
  }
  function setCard(id, text, tag) {
    var e = $("a-" + id);
    if (!e) return;
    var b = e.querySelector(".ab");
    b.innerHTML = "";
    if (tag) {
      var t = document.createElement("span");
      t.className = "tag " + tag.cls;
      t.textContent = tag.label;
      b.appendChild(t);
      b.appendChild(document.createElement("br"));
    }
    b.appendChild(document.createTextNode(text || ""));
    if (text) b.appendChild(copyButton(text));
    e.classList.add("open");
    setSt(id, "READY", "ok");
  }
  function wk() {
    var w = $("wk"), nd = $("nd");
    if (w) w.textContent = busy + " WORKING";
    if (nd) nd.className = "node" + (busy ? " run" : "");
  }
  function say(who, text) {
    var chat = $("notice-chat");
    if (!chat) return;
    var m = document.createElement("div");
    m.className = "msg";
    m.innerHTML = "<small></small><span></span>";
    m.querySelector("small").textContent = who;
    m.querySelector("span").textContent = text;
    chat.appendChild(m);
  }
  function calcEstimator() {
    var a = +($("amt") ? $("amt").value : 0) || 0;
    var d = +($("late") ? $("late").value : 0) || 0;
    var cr = $("cr");
    if (!cr) return;
    if (!a) { cr.textContent = "Enter tax amount above and days."; return; }
    var est = NMTax.interestPenalty(a, d);
    cr.textContent = "Est. interest at " + Math.round(est.interestPa * 100) + "% p.a.: " + NMTax.money(est.interest) +
      " · Est. penalty if no fraud: " + NMTax.money(est.penalty) + " (rough estimate, verify with your CA)";
  }
  function listCases() {
    var el = $("cs");
    if (!el) return;
    var c = NMStore.cases();
    el.innerHTML = c.length ? "" : '<p class="sub">No saved cases yet.</p>';
    c.forEach(function (x, idx) {
      var d = document.createElement("div");
      d.className = "cs";
      var n = x.due ? Math.ceil((new Date(x.due) - new Date()) / 864e5) : null;
      var l = document.createElement("span");
      l.textContent = (x.brief || "").slice(0, 48) + "…";
      var b = document.createElement("b");
      b.className = "dd";
      b.textContent = n === null ? "no date" : (n < 0 ? "overdue" : n + " days left");
      if (n !== null && n <= 3) b.style.color = "#c92a2a";
      var del = document.createElement("button");
      del.className = "btn sm g"; del.textContent = "Delete";
      del.onclick = function (ev) {
        ev.stopPropagation();
        NMStore.deleteCase(idx);
        listCases();
        if (window.NMApp) NMApp.refreshTabBadge && NMApp.refreshTabBadge();
      };
      var wrap = document.createElement("span");
      wrap.style.display = "flex"; wrap.style.gap = "8px"; wrap.style.alignItems = "center";
      wrap.appendChild(b); wrap.appendChild(del);
      d.appendChild(l); d.appendChild(wrap);
      d.onclick = function () { loadCase(x); };
      el.appendChild(d);
    });
  }
  function loadCase(x) {
    $("in").value = x.brief || "";
    $("due").value = x.due || "";
    $("amt").value = x.amt || "";
    buildTeam();
    SPECIALISTS.forEach(function (sp) {
      var text = x.res ? (x.res[sp[0]] || "") : "";
      if (text) setCard(sp[0], text, null);
    });
    calcEstimator();
    window.scrollTo(0, 0);
  }
  function saveCurrentCase() {
    var res = {};
    SPECIALISTS.forEach(function (sp) {
      var e = $("a-" + sp[0]);
      var ab = e ? e.querySelector(".ab") : null;
      res[sp[0]] = ab ? ab.textContent.replace(/Copy$/, "").replace(/Copied$/, "").trim() : "";
    });
    NMStore.saveCase({
      t: Date.now(), due: $("due").value, amt: $("amt").value,
      brief: $("in").value, res: res, status: "open"
    });
    listCases();
  }
  function runSpecialist(sample, id, task, brief) {
    setSt(id, "WORKING"); busy++; wk();
    var card = $("a-" + id);
    if (card) card.classList.add("open");
    return sample("You are the '" + id + "' specialist agent in a GST notice helper for small Indian traders. Reply in " + langName() + ". Never invent section numbers, amounts or dates; use [placeholders] and say what to verify. TASK: " + task + "\n\nTODAY:" + new Date().toDateString() + " DUE DATE:" + ($("due").value || "unknown") + " TAX AMOUNT:" + ($("amt").value || "unknown") + "\n\nBRIEF:\n" + brief, { modelTier: "quick" })
      .then(function (r) { setCard(id, r.text.trim(), null); })
      .catch(function (e) { setSt(id, (e && e.code === "rate_limited") ? "BUSY·RETRY" : "FAILED", "er"); })
      .then(function () { busy--; wk(); });
  }
  function runViaServer(brief) {
    var payload = { brief: brief, due_date: $("due").value || null, amount: $("amt").value || null };
    function call(extra) {
      if (extra) payload.images = [extra];
      return NMApi.noticeAnalyze(payload);
    }
    var p = NOTICE_PHOTO
      ? b64(NOTICE_PHOTO).then(function (data) { return call({ media_type: NOTICE_PHOTO.type || "image/jpeg", data: data }); })
      : call(null);
    return p.then(function (res) {
      if (!res.ok || !res.data) return false;
      var d = res.data;
      var extracted = (d.extracted || []).map(function (f) { return (f.fact || "") + (f.source ? " (" + f.source + ")" : ""); }).join("\n");
      var interp = (d.interpretation || []).join("\n");
      var needs = (d.needs_verification || []).join("\n");
      setCard("decode", [extracted, interp ? "Interpretation:\n" + interp : "", needs ? "Needs verification:\n" + needs : ""].filter(Boolean).join("\n\n") || "No facts returned.", { cls: "ext", label: "EXTRACTED + INTERPRETATION" });
      setCard("reply", d.draft_reply || "No draft returned.", { cls: "int", label: "INTERPRETATION, REVIEW WITH YOUR CA" });
      setCard("docs", (d.checklist || []).join("\n") || "No checklist returned.", null);
      var deadlineLine = d.deadline ? "Reply deadline: " + d.deadline : ($("due").value ? "Reply due date you entered: " + $("due").value : "No deadline given. The usual reply window is short, check the notice itself.");
      var daysLine = "";
      var dueVal = d.deadline || $("due").value;
      if (dueVal) {
        var n = Math.ceil((new Date(dueVal) - new Date()) / 864e5);
        daysLine = isNaN(n) ? "" : "\nDays left: " + (n < 0 ? "overdue by " + Math.abs(n) : n) + ".";
      }
      setCard("dates", deadlineLine + daysLine, { cls: "ver", label: "VERIFY THE DATE ON THE NOTICE" });
      setCard("risk", (d.risks || []).join("\n") || "No risk notes returned.", { cls: "int", label: "INTERPRETATION" });
      setCard("ca", d.ca_brief || "No CA brief returned.", null);
      if (needs) say("MEERA", "Some points need verification. They are marked on the cards. Please check them on the notice or with your CA.");
      return true;
    }).catch(function () { return false; });
  }
  function runViaShim(brief) {
    return claude.use("sample").then(function (sample) {
      if (!sample) { say("MEERA", "AI is not available in this view."); return false; }
      $("mp").textContent = "Six specialists working in parallel";
      var mpOk = false;
      var mp = sample("You are Meera, a warm voice assistant for Indian small traders facing GST notices. In 2 short sentences, same language style as the user: reassure, name the key issue you heard, and say the team is starting. No legal promises.\n\nUSER:\n" + brief, { modelTier: "quick" })
        .then(function (r) { mpOk = true; say("MEERA", r.text.trim()); })
        .catch(function () {});
      return Promise.all([mp].concat(SPECIALISTS.map(function (sp) { return runSpecialist(sample, sp[0], sp[3], brief); }))).then(function () {
        var failed = SPECIALISTS.filter(function (sp) {
          var e = $("a-" + sp[0]);
          return e && e.querySelector(".st").textContent === "FAILED";
        }).length;
        if (failed === SPECIALISTS.length) {
          // Every call failed: the server is not reachable. Say so plainly
          // instead of leaving FAILED cards and a false "team started" note.
          say("MEERA", "AI needs the live server, and it is not reachable right now. Your notice text is still here. Please try again when the server is live, and speak to your CA about urgent deadlines.");
          return false;
        }
        if (!mpOk) say("MEERA", "Samajh gayi. Team kaam par lag gayi hai.");
        return true;
      });
    }).catch(function () {
      say("MEERA", "AI needs the live server, and it is not reachable right now. Your notice text is still here. Please try again when the server is live, and speak to your CA about urgent deadlines.");
      SPECIALISTS.forEach(function (sp) { setSt(sp[0], "NO SERVER", "er"); });
      return false;
    });
  }
  function renderNotice(el) {
    var profile = NMStore.getProfile();
    var html = '<div class="panel why"><div class="lbl"><span>HOW THIS WORKS</span></div>' +
      '<p>Meera is your manager. Tell her about the notice in your own words, or upload a photo of it. When you tap Call the team, six specialists start at the same time and each one writes its own part.</p>' +
      '<ol><li>Speak or type what the notice says, and add the due date and tax amount if you know them.</li>' +
      '<li>Tap Call the team. Each specialist card below fills in as its work finishes. Tap a card to read it.</li>' +
      '<li>Read every result, copy what you need, and show the drafts to your CA before you file anything.</li></ol></div>' +
      '<div class="panel"><div class="lbl"><span>TALK TO MEERA</span><span id="stt">IDLE</span></div>' +
      '<textarea id="in" placeholder="Speak or type: what notice did you get, from whom, what does it say, your business type…"></textarea>' +
      '<div class="row"><select id="lang" class="in"><option value="hg">Hinglish</option><option value="hi">Hindi</option><option value="en">English</option></select>' +
      '<input id="due" type="date" class="in" title="Reply due date"><input id="amt" type="number" inputmode="numeric" placeholder="Tax Rs" class="in" style="max-width:90px"></div>' +
      '<div class="row"><label class="btn g" style="text-align:center;flex:1">Upload notice photo<input id="pic" type="file" accept="image/*" hidden></label></div>' +
      '<div class="row"><button class="btn g" id="mic" hidden>Speak</button><button class="btn g" id="demo">Play demo</button><button class="btn" id="go">Call the team</button></div>' +
      '<div id="notice-chat"></div></div>' +
      '<div class="panel"><div class="lbl"><span>THE TEAM</span><span id="wk">0 WORKING</span></div>' +
      '<div class="mgr"><div class="node" id="nd">M</div><div><b>Manager</b><div class="sub" id="mp">One call. Six specialists at once.</div></div></div>' +
      '<div id="ags"></div></div>' +
      '<div class="row"><button class="btn g" id="wa" style="flex:1">Send CA brief on WhatsApp</button></div>' +
      '<div class="panel"><div class="lbl"><span>INTEREST &amp; PENALTY ESTIMATOR</span></div><div class="row"><input id="late" type="number" inputmode="numeric" class="in" placeholder="Days since ITC claimed"></div><p class="sub" id="cr">Enter tax amount above and days.</p><p class="sub">' + esc(NMTax.verifyNote()) + '</p></div>' +
      '<div class="panel"><div class="lbl"><span>MY CASES</span><span>SAVED ON THIS DEVICE</span></div><div id="cs"></div></div>' +
      '<p class="dis">Not legal advice. Drafts must be reviewed by your CA before filing. Check dates on gst.gov.in. AI assistant, not a licensed CA.</p>';
    el.innerHTML = html;
    buildTeam();
    $("lang").value = profile.language;
    $("lang").onchange = function () { NMStore.saveProfile({ language: $("lang").value }); };
    $("demo").onclick = function () { $("in").value = DEMO; };
    $("amt").oninput = calcEstimator;
    $("late").oninput = calcEstimator;
    listCases();
    attachDictation("mic", "in");
    $("wa").onclick = function () {
      var ab = $("a-ca") ? $("a-ca").querySelector(".ab") : null;
      var t = ab ? ab.textContent.replace(/Copy$/, "").replace(/Copied$/, "").trim() : "";
      if (t) window.open("https://wa.me/?text=" + encodeURIComponent(t), "_blank");
      else say("MEERA", "Run Call the team first, so there is a CA brief to send.");
    };
    $("pic").onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      NOTICE_PHOTO = f;
      $("stt").textContent = "READING PHOTO";
      claude.use("sample").then(function (s) {
        if (!s) throw new Error("no sample");
        return s.limits().then(function (l) {
          if (!l || !l.images) throw new Error("no images");
          return s("Extract the key facts from this GST notice image: form/section, period, amount, due date, allegation. Mask GSTIN middle digits. Plain text.", { images: [f], modelTier: "quick" });
        });
      }).then(function (r) {
        $("in").value += ($("in").value ? "\n" : "") + r.text;
        var dueMatch = r.text.match(/(\d{4}-\d{2}-\d{2})/);
        if (dueMatch && !$("due").value) $("due").value = dueMatch[1];
        NMStore.addVaultItem({ id: "doc-" + Date.now(), name: "Notice photo: " + f.name, kind: "notice photo", date: new Date().toISOString().slice(0, 10) });
      }).catch(function () {
        say("MEERA", "Could not read that photo here. Please type the details. The photo is kept for the team run if the server is live.");
      }).then(function () { $("stt").textContent = "IDLE"; });
    };
    $("go").onclick = function () {
      var brief = $("in").value.trim();
      if (!brief || busy) return;
      $("notice-chat").innerHTML = "";
      buildTeam();
      $("go").disabled = true;
      $("stt").textContent = "CALL LIVE";
      say("YOU", brief);
      $("mp").textContent = "Reading your notice…";
      NMApi.probeLive().then(function (live) {
        if (live) return runViaServer(brief).then(function (ok) { return ok ? true : runViaShim(brief); });
        return runViaShim(brief);
      }).then(function (ran) {
        if (ran) {
          $("mp").textContent = "Notice pack ready. Review with your CA.";
          $("stt").textContent = "CALL ENDED";
          saveCurrentCase();
        } else {
          $("mp").textContent = "The team could not run. AI needs the live server.";
          $("stt").textContent = "IDLE";
        }
        $("go").disabled = false;
      });
    };
    if (PENDING_CASE_T) {
      var wanted = PENDING_CASE_T;
      PENDING_CASE_T = null;
      var found = NMStore.cases().filter(function (c) { return String(c.t) === String(wanted); })[0];
      if (found) loadCase(found);
    }
  }

  window.NMMeera = {
    render: function (el, options) {
      options = options || {};
      if (options.mode) MODE = options.mode;
      if (options.caseT) PENDING_CASE_T = options.caseT;
      if (options.prefill) { PENDING_PREFILL = options.prefill; MODE = "chat"; }
      busy = 0;
      var shell = '<div class="modebar">' +
        '<button type="button" id="mode-chat" class="btn ' + (MODE === "chat" ? "on" : "off") + '">Chat with Meera</button>' +
        '<button type="button" id="mode-notice" class="btn ' + (MODE === "notice" ? "on" : "off") + '">Notice team</button></div>' +
        '<div id="meera-body"></div>';
      el.innerHTML = shell;
      var body = $("meera-body");
      $("mode-chat").onclick = function () { MODE = "chat"; NMMeera.render(el, {}); window.scrollTo(0, 0); };
      $("mode-notice").onclick = function () { MODE = "notice"; NMMeera.render(el, {}); window.scrollTo(0, 0); };
      if (MODE === "notice") renderNotice(body);
      else renderChat(body);
    },
    prefillChat: function (text) { PENDING_PREFILL = text; MODE = "chat"; }
  };
})();
