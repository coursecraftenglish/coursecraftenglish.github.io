// Daily Phonics Booklet 1 — interactive pages. Tap the page to hear it; practise with the microphone.
(async function () {
  const D = await (await fetch("data.json?v=2")).json();
  const $ = (s, r = document) => r.querySelector(s);
  const app = $("#app");
  const VDIR = { r: "r", m: "m", o: "o" };
  const TH = window.PH_TH || { w5: { t: -2.6, m: 1.0 }, w4: { t: -4, m: 0.3 }, w3: { t: -6, m: -0.5 }, w2: { t: -9, m: -2 }, s5: -3.5, s4: -5, s3: -7, s2: -10 };
  const key = (w) => w.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const LS = (() => { try { return JSON.parse(localStorage.getItem("ph-b1") || "{}"); } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem("ph-b1", JSON.stringify(LS)); } catch (e) {} };
  const best = (k) => (LS[k] || 0);
  const lessonOf = (n) => D.lessons[n - 1];

  // ---------- audio (Web Audio, so sounds and sentence parts play exactly) ----------
  let ac = null; const bufs = {};
  const ctx = () => { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") ac.resume(); return ac; };
  async function buf(url) { if (!bufs[url]) bufs[url] = fetch(url).then((r) => r.arrayBuffer()).then((b) => new Promise((res, rej) => ctx().decodeAudioData(b, res, rej))); return bufs[url]; }
  let playId = 0, cur = null;
  function stop() { playId++; if (cur) { try { cur.stop(); } catch (e) {} cur = null; } document.querySelectorAll(".hs.on,.w.on").forEach((e) => e.classList.remove("on")); }
  function playBuf(b, from = 0, to = null) { return new Promise((res) => { const s = ctx().createBufferSource(); s.buffer = b; s.connect(ctx().destination); s.onended = res; cur = s; s.start(0, from, to == null ? undefined : Math.max(0.05, to - from)); }); }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const url = (v, kind, x) => `a/${VDIR[v]}/${kind}/${kind === "w" ? key(x) : x}.mp3`;
  // play a list of steps like "s:a", "w:apple", "l:i_tap"
  async function playSteps(v, steps, el, gap = 250) {
    stop(); const id = playId; if (el) el.classList.add("on");
    try { for (const st of steps) { const [k, x] = st.split(":"); const b = await buf(url(v, k, x)); if (id !== playId) return; await playBuf(b); if (id !== playId) return; await wait(gap); } }
    finally { if (el && id === playId) el.classList.remove("on"); }
  }
  async function playSentence(v, sk, spans) {
    stop(); const id = playId; const s = D.sents[sk]; const b = await buf(url(v, "l", sk)); if (id !== playId) return;
    const t0 = ctx().currentTime; const p = playBuf(b);
    const tick = () => { if (id !== playId) return; const t = ctx().currentTime - t0; s.tm.forEach((r, i) => spans && spans[i] && spans[i].classList.toggle("on", t >= r[0] && t < r[1] + 0.05)); if (t < b.duration) requestAnimationFrame(tick); else spans && spans.forEach((x) => x.classList.remove("on")); };
    tick(); await p;
  }
  async function playSentWord(v, sk, i) { stop(); const s = D.sents[sk]; const b = await buf(url(v, "l", sk)); const r = s.tm[i]; await playBuf(b, Math.max(0, r[0] - 0.05), r[1] + 0.08); }
  async function soundOut(v, w) { const it = D.words[w]; if (!it || !it.snd) return; stop(); const id = playId; for (const s of it.snd) { const b = await buf(url(v, "s", s)); if (id !== playId) return; await playBuf(b); await wait(180); } await wait(350); if (id !== playId) return; await playBuf(await buf(url(v, "w", w))); }

  // ---------- views ----------
  function home() {
    stop(); document.title = "Daily Phonics · Booklet 1";
    app.innerHTML = `<div class="top"><span style="width:40px"></span><h1>Daily Phonics · Booklet 1</h1><span style="width:40px"></span></div>
    <div class="wrap"><div class="intro"><h2>How to use</h2><ol>
    <li>Scan the code on a page, or tap a lesson below.</li><li>Tap anything on the page to hear it.</li>
    <li>Tap a word or a sentence. Listen, then tap <b>My turn</b> and read it.</li>
    <li>⭐⭐⭐⭐⭐ = mastered ✓. Fewer stars? Listen again and try again.</li>
    <li>Move on to the next lesson when every word and sentence has 5 stars.</li></ol></div>
    <div class="grid">${D.lessons.map((l) => { const [a, t] = mastery(l); return `<button class="lc ${a === t ? "done" : ""}" data-n="${l.n}"><b>Lesson ${l.n}</b><span>${l.title}</span><div class="bar"><i style="width:${(100 * a) / t}%"></i></div><i>${a} of ${t} mastered</i></button>`; }).join("")}</div></div>`;
    app.querySelectorAll(".lc").forEach((b) => (b.onclick = () => (location.hash = b.dataset.n + "a")));
  }
  const mastery = (l) => [l.practice.filter((k) => best(k) >= 5).length, l.practice.length];
  let L = null, part = "a";
  function lesson(n, p) {
    stop(); L = lessonOf(n); part = p; document.title = `Lesson ${n} · ${L.title}`;
    const [a, t] = mastery(L);
    app.innerHTML = `<div class="top"><button class="ib" id="home" aria-label="All lessons">☰</button><button class="ib" id="prev" aria-label="Previous lesson" ${n === 1 ? "disabled" : ""}>‹</button><h1>Lesson ${n} · ${L.title}</h1><button class="ib" id="next" aria-label="Next lesson" ${n === 32 ? "disabled" : ""}>›</button><span style="width:40px"></span></div>
    <div class="wrap"><div class="seg" role="tablist"><button data-p="a" aria-selected="${p === "a"}">Part 1 · Read</button><button data-p="b" aria-selected="${p === "b"}">Part 2 · Write</button></div>
    <div class="prog">⭐ ${a} of ${t} mastered <div class="bar"><i style="width:${(100 * a) / t}%"></i></div></div>
    <div class="pg"><img src="${L[p.toUpperCase()].img}" alt="Lesson ${n} ${p === "a" ? "Part 1" : "Part 2"} page" draggable="false"></div>
    <p class="tip">Tap anything on the page to hear it. Tap a word or a sentence to practise with the microphone.</p></div>`;
    $("#home").onclick = () => (location.hash = "");
    $("#prev").onclick = () => (location.hash = n - 1 + p); $("#next").onclick = () => (location.hash = n + 1 + p);
    app.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => (location.hash = n + b.dataset.p)));
    const pg = $(".pg");
    for (const h of L[p.toUpperCase()].hs) {
      const b = document.createElement("button"); b.className = "hs pulse"; const [x, y, w, hh] = h.b;
      const pad = 0.6; Object.assign(b.style, { left: x - pad + "%", top: y - pad * 0.75 + "%", width: w + 2 * pad + "%", height: hh + 1.5 * pad + "%" });
      b.setAttribute("aria-label", h.w || h.t); b.onclick = () => tap(h, b); pg.appendChild(b);
      const pk = practiceKey(h); if (pk && best(pk) >= 5) { const c = document.createElement("span"); c.className = "ck"; c.textContent = "✓"; b.appendChild(c); }
    }
  }
  const practiceKey = (h) => (part === "a" ? (h.t === "tile" && !h.snd ? h.w : h.t === "sent" ? h.k : null) : null);
  function tap(h, el) {
    ctx(); const v = L.v;
    switch (h.t) {
      case "head": return playSteps(v, L.head, el, 300);
      case "say": return playSteps(v, ["l:" + L.say], el);
      case "ins": return playSteps(v, ["l:" + (part === "a" ? L.ins : insB(h.lab))], el);
      case "star": return openPractice(firstTodo());
      case "tile": if (h.snd) return playSteps(v, ["s:" + h.snd, "s:" + h.snd], el, 350); return openPractice(h.w);
      case "chain": return openChain(h.ws);
      case "sent": return openPractice(h.k);
      case "trace": return playSteps(v, [L.trace], el);
      case "lscw": return playSteps(v, [(D.words[h.w] || L.mode !== "listen" ? "w:" : "s:") + h.w], el);
      case "test": return playSteps(v, [(L.mode === "listen" ? "s:" : "w:") + h.w], el);
      case "wsent": { const k = L.sents[Math.floor(Math.random() * L.sents.length)]; return k ? playSteps(v, ["l:" + k], el) : null; }
      case "check": return playSteps(v, ["l:i_check"], el);
    }
  }
  const insB = (lab) => ({ "TRACE IT": L.trace.split(":")[1], "LOOK, SAY, COVER, WRITE": "i_lscw", "SPELLING TEST": L.mode === "listen" ? "i_test2" : "i_test", "WRITE A SENTENCE": "i_sent", CHECKPOINT: "i_check" })[lab] || "i_lscw";
  const firstTodo = () => L.practice.find((k) => best(k) < 5) || L.practice[0];
  function openChain(ws) { openPractice(ws[0], ws); }

  // ---------- practice sheet ----------
  let dim = null, list = null, idx = 0;
  function openPractice(k, sub) {
    list = sub || L.practice; idx = Math.max(0, list.indexOf(k));
    dim = document.createElement("div"); dim.className = "dim"; dim.innerHTML = `<div class="sheet" role="dialog" aria-label="My turn"></div>`;
    dim.onclick = (e) => { if (e.target === dim) closeSheet(); }; document.body.appendChild(dim); render();
  }
  function closeSheet() { stop(); recStop = true; if (dim) dim.remove(); dim = null; lesson(L.n, part); }
  function render() {
    const k = list[idx], isS = !!D.sents[k], v = L.v; const sh = $(".sheet", dim); const it = isS ? D.sents[k] : D.words[k];
    const text = isS ? it.words.map((w, i) => `<span class="w" data-i="${i}">${w}</span>`).join(" ") : k;
    sh.innerHTML = `<div class="sh-top"><span>${idx + 1} / ${list.length}${best(k) >= 5 ? '<span class="badge">✓ mastered</span>' : ""}</span><button class="ib" id="x" aria-label="Close">✕</button></div>
    <div class="word ${isS ? "s" : ""}">${text}</div>
    <div class="row"><button class="btn" id="hear">🔊 Listen</button>${!isS && it && it.snd ? '<button class="btn" id="slow">🐢 Sound it out</button>' : ""}</div>
    <button class="mic" id="mic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg><span id="ml">My turn</span></button>
    <div class="load" id="load" hidden></div>
    <div class="stars" id="stars">${starsHTML(best(k))}</div><div class="msg" id="msg">${best(k) ? "Your best so far. Get ⭐⭐⭐⭐⭐ to master it." : "Listen first. Then tap My turn and read it."}</div>
    <div class="row"><button class="btn" id="me" hidden>▶ Hear me</button></div>
    <div class="nav"><button class="btn" id="pv" ${idx === 0 ? "disabled" : ""}>‹ Back</button><button class="btn" id="nx">${idx === list.length - 1 ? "Done" : "Next ›"}</button></div>`;
    $("#x", sh).onclick = closeSheet;
    const spans = [...sh.querySelectorAll(".w")];
    $("#hear", sh).onclick = () => (isS ? playSentence(v, k, spans) : playSteps(v, ["w:" + k]));
    if ($("#slow", sh)) $("#slow", sh).onclick = () => soundOut(v, k);
    spans.forEach((s) => (s.onclick = () => playSentWord(v, k, +s.dataset.i)));
    $("#pv", sh).onclick = () => { idx--; stop(); render(); };
    $("#nx", sh).onclick = () => { if (idx === list.length - 1) return closeSheet(); idx++; stop(); render(); };
    $("#mic", sh).onclick = () => myTurn(k, isS, spans);
    if (!window.PHMT || !PHMT.isReady()) warm();
  }
  const starsHTML = (n) => [1, 2, 3, 4, 5].map((i) => `<span class="${i <= n ? "" : "off"}">⭐</span>`).join("");

  // ---------- microphone ----------
  let stream = null, recStop = false, busy = false, lastUrl = null;
  function warm() {
    const ld = dim && $("#load", dim); if (!ld) return;
    if (window.PHMT && PHMT.isReady()) { ld.hidden = true; return; }
    ld.hidden = false; ld.innerHTML = `Getting the listening helper ready (about 40 MB, only the first time). Your voice stays on this device.<div class="bar"><i style="width:0"></i></div>`;
    PHMT.load((f) => { const i = dim && $("#load i", dim); if (i) i.style.width = Math.round(f * 100) + "%"; }).then(() => { const l = dim && $("#load", dim); if (l) l.hidden = true; }).catch(() => { const l = dim && $("#load", dim); if (l) l.textContent = "The listening helper could not load. Check the internet and try again."; });
  }
  async function record(isS) {
    stream = stream || (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }));
    const c = new (window.AudioContext || window.webkitAudioContext)(); const an = c.createAnalyser(); an.fftSize = 1024; c.createMediaStreamSource(stream).connect(an);
    const rec = new MediaRecorder(stream); const ch = []; rec.ondataavailable = (e) => e.data.size && ch.push(e.data);
    const b = new Float32Array(an.fftSize); let spoke = false, quiet = performance.now(); const t0 = performance.now();
    const maxT = isS ? 9000 : 4000, gapT = isS ? 1100 : 750; recStop = false; rec.start();
    await new Promise((res) => { const tick = () => { an.getFloatTimeDomainData(b); let s = 0; for (const x of b) s += x * x; const rms = Math.sqrt(s / b.length), now = performance.now(); if (rms > 0.02) { spoke = true; quiet = now; } if ((spoke && now - quiet > gapT) || now - t0 > maxT || (!spoke && now - t0 > 4000) || recStop) return res(); requestAnimationFrame(tick); }; tick(); });
    await new Promise((r) => { rec.onstop = r; rec.stop(); }); c.close();
    return { blob: new Blob(ch, { type: rec.mimeType }), spoke };
  }
  async function toMono16k(blob) {
    const c = new (window.AudioContext || window.webkitAudioContext)(); const d = await c.decodeAudioData(await blob.arrayBuffer()); c.close();
    const off = new OfflineAudioContext(1, Math.ceil(d.duration * 16000), 16000); const s = off.createBufferSource(); s.buffer = d; s.connect(off.destination); s.start();
    return (await off.startRendering()).getChannelData(0);
  }
  // 5 stars only when the word fits as well as our three reference voices did AND no look-alike word fits better
  function starsWord(r, th) {
    const [t5, m5] = th || [-3.5, 0];
    if (r.t >= t5 && r.margin >= m5) return 5;
    if (r.t >= t5 - 1.5 && r.margin >= m5 - 1) return 4;
    if (r.t >= t5 - 3 && r.margin >= m5 - 2.5) return 3;
    return r.t >= -10 ? 2 : 1;
  }
  function starsSent(ws) { const lo = Math.min(...ws); return lo >= TH.s5 ? 5 : lo >= TH.s4 ? 4 : lo >= TH.s3 ? 3 : lo >= TH.s2 ? 2 : 1; }
  async function score(k, isS, f32) {
    const h = await PHMT.encode(f32);
    if (isS) { const r = await PHMT.scoreSent(h, D.sents[k]); return { st: starsSent(r.words), words: r.words }; }
    const r = await PHMT.scoreWord(h, D.words[k]); return { st: starsWord(r, D.words[k].th), r };
  }
  window.__phScore = async (u, k) => { await PHMT.load(); const f = await toMono16k(await (await fetch(u)).blob()); const isS = !!D.sents[k]; const t0 = performance.now(); const o = await score(k, isS, f); o.ms = Math.round(performance.now() - t0); return o; };
  const MSG = { 5: ["Perfect! Mastered ✓", "Excellent! Mastered ✓", "You got it! Mastered ✓"], 4: ["So close! Listen once more and try again.", "Almost there! Try again."], 3: ["Good try! Listen, then say it again.", "Keep going! Listen and try again."], 2: ["Listen carefully, then try again.", "Let’s listen again and try."], 1: ["Listen first, then try again.", "Let’s try again together."] };
  async function myTurn(k, isS, spans) {
    const sh = $(".sheet", dim); const btn = $("#mic", sh), lab = $("#ml", sh), msg = $("#msg", sh);
    if (busy) { recStop = true; return; }
    if (!window.PHMT) return;
    if (!PHMT.isReady()) { warm(); msg.textContent = "One moment, getting ready…"; try { await PHMT.load(); } catch (e) { return; } }
    stop(); busy = true; btn.classList.add("rec"); lab.textContent = "Listening… (tap to stop)"; msg.className = "msg"; msg.textContent = isS ? "Read the sentence now." : "Say the word now."; spans.forEach((s) => s.classList.remove("bad"));
    try {
      const { blob, spoke } = await record(isS); btn.classList.remove("rec");
      if (lastUrl) URL.revokeObjectURL(lastUrl); lastUrl = URL.createObjectURL(blob); const me = $("#me", sh); me.hidden = false; me.onclick = () => { const a = new Audio(lastUrl); a.play(); };
      if (!spoke) { msg.textContent = "I could not hear you. Speak a little louder, close to the phone."; return; }
      lab.textContent = "Checking…"; btn.disabled = true;
      const f = await toMono16k(blob); const o = await score(k, isS, f);
      $("#stars", sh).innerHTML = starsHTML(o.st);
      const m = MSG[o.st]; msg.textContent = m[Math.floor(Math.random() * m.length)]; msg.className = "msg" + (o.st === 5 ? " ok" : "");
      if (isS && o.st < 5) o.words.forEach((x, i) => { if (x < TH.s5 && spans[i]) spans[i].classList.add("bad"); });
      if (isS && o.st < 5 && spans.some((s) => s.classList.contains("bad"))) msg.textContent += " Tap the red words to hear them.";
      if (o.st > best(k)) { LS[k] = o.st; save(); }
      if (o.st === 5) { const t = $(".sh-top span", sh); if (t && !t.querySelector(".badge")) t.insertAdjacentHTML("beforeend", '<span class="badge">✓ mastered</span>'); }
      window.__phLast = o;
    } catch (e) {
      console.error(e); msg.textContent = /Permission|NotAllowed/i.test(e && e.name + e.message) ? "Please allow the microphone. If it still does not work, open this page in your phone’s browser." : "Something went wrong. Please try again.";
    } finally { busy = false; btn.classList.remove("rec"); btn.disabled = false; lab.textContent = "My turn"; }
  }

  function route() {
    if (dim) { dim.remove(); dim = null; }
    const m = /^#(\d{1,2})([ab])?$/.exec(location.hash);
    if (m && +m[1] >= 1 && +m[1] <= 32) lesson(+m[1], m[2] || "a"); else home();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route); route();
})();
