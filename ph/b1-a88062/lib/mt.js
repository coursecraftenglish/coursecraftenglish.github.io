// Speech check that runs on the device (Whisper tiny.en, int8). No audio leaves the phone.
(function () {
  const SOT = [50257, 50362];
  let ort, enc, dec, melW, ready = null;
  const base = (window.PH_BASE || "") ;

  async function fetchBuf(url, onBytes) {
    let cache = null;
    try { cache = await caches.open("ph-model-v1"); const hit = await cache.match(url); if (hit) { const b = await hit.arrayBuffer(); onBytes(b.byteLength); return b; } } catch (e) { cache = null; }
    const r = await fetch(url); if (!r.ok) throw new Error("load " + url + " " + r.status);
    const parts = []; let n = 0;
    if (r.body && r.body.getReader) { const rd = r.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; onBytes(value.length); } }
    else { const b = new Uint8Array(await r.arrayBuffer()); parts.push(b); n = b.length; onBytes(n); }
    const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    try { if (cache) await cache.put(url, new Response(out.slice().buffer)); } catch (e) {}
    return out.buffer;
  }

  function load(progress) {
    if (ready) return ready;
    ready = (async () => {
      const TOTAL = 10124993 + 2 * 15359429 + 64320; let got = 0;
      const tick = (b) => { got += b; progress && progress(Math.min(1, got / TOTAL)); };
      if (!window.ort) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = base + "lib/ort.wasm.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      ort = window.ort; ort.env.wasm.wasmPaths = new URL(base + "lib/", location.href).href; ort.env.wasm.numThreads = 1;
      const [m, e, d0, d1] = await Promise.all([fetchBuf(base + "m/mel.bin", tick), fetchBuf(base + "m/enc.onnx", tick), fetchBuf(base + "m/dec.onnx.part00", tick), fetchBuf(base + "m/dec.onnx.part01", tick)]);
      melW = new Float32Array(m);
      const dj = new Uint8Array(d0.byteLength + d1.byteLength); dj.set(new Uint8Array(d0), 0); dj.set(new Uint8Array(d1), d0.byteLength);
      const opt = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
      enc = await ort.InferenceSession.create(new Uint8Array(e), opt);
      dec = await ort.InferenceSession.create(dj, opt);
      return true;
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }

  // ---- log-mel exactly like WhisperFeatureExtractor (n_fft 400, hop 160, 80 mels, 30 s) ----
  let COS = null, SIN = null, WIN = null;
  function tables() {
    COS = new Float32Array(201 * 400); SIN = new Float32Array(201 * 400); WIN = new Float32Array(400);
    for (let i = 0; i < 400; i++) WIN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 400);
    for (let k = 0; k < 201; k++) for (let i = 0; i < 400; i++) { const a = (2 * Math.PI * k * i) / 400; COS[k * 400 + i] = Math.cos(a); SIN[k * 400 + i] = Math.sin(a); }
  }
  function logMel(x) {
    if (!COS) tables();
    const N = 480000, F = 3000; const y = new Float32Array(N + 400);
    const L = Math.min(x.length, N);
    const at = (i) => (i >= 0 && i < N ? (i < L ? x[i] : 0) : 0);
    for (let i = 0; i < N + 400; i++) { let j = i - 200; if (j < 0) j = -j; else if (j >= N) j = 2 * (N - 1) - j; y[i] = at(j); }
    const out = new Float32Array(80 * F); const fr = new Float32Array(400), pw = new Float32Array(201);
    const live = Math.min(F, Math.ceil((L + 200) / 160) + 1);
    const ZERO = Math.log10(1e-10);
    for (let t = 0; t < F; t++) {
      if (t >= live && L < N) { for (let m = 0; m < 80; m++) out[m * F + t] = ZERO; continue; }
      const o = t * 160; for (let i = 0; i < 400; i++) fr[i] = y[o + i] * WIN[i];
      for (let k = 0; k < 201; k++) { let re = 0, im = 0; const b = k * 400; for (let i = 0; i < 400; i++) { re += fr[i] * COS[b + i]; im -= fr[i] * SIN[b + i]; } pw[k] = re * re + im * im; }
      for (let m = 0; m < 80; m++) { let s = 0; const b = m * 201; for (let k = 0; k < 201; k++) s += melW[b + k] * pw[k]; out[m * F + t] = Math.log10(Math.max(s, 1e-10)); }
    }
    let mx = -1e9; for (let i = 0; i < out.length; i++) if (out[i] > mx) mx = out[i];
    for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], mx - 8) + 4) / 4;
    return out;
  }

  async function encode(f32) {
    const r = await enc.run({ input_features: new ort.Tensor("float32", logMel(f32), [1, 80, 3000]) });
    return r.last_hidden_state;
  }
  const EMPTY = () => new ort.Tensor("float32", new Float32Array(0), [1, 6, 0, 64]);
  const PK = []; for (let i = 0; i < 4; i++) for (const a of ["decoder", "encoder"]) for (const b of ["key", "value"]) PK.push([i, a, b]);
  function lastRow(L) { const V = L.dims[2], n = L.dims[1]; return L.data.subarray((n - 1) * V, n * V); }
  // decoding state with a key/value cache: one cheap step per new token, shared prefixes computed once
  async function root(h) {
    const feeds = { input_ids: new ort.Tensor("int64", BigInt64Array.from(SOT.map(BigInt)), [1, SOT.length]), encoder_hidden_states: h, use_cache_branch: new ort.Tensor("bool", [false], [1]) };
    for (const [i, a, b] of PK) feeds[`past_key_values.${i}.${a}.${b}`] = EMPTY();
    const r = await dec.run(feeds); const kv = {}; for (const [i, a, b] of PK) kv[`past_key_values.${i}.${a}.${b}`] = r[`present.${i}.${a}.${b}`];
    return { h, enc: kv, memo: new Map([["", { row: Float32Array.from(lastRow(r.logits)), kv }]]) };
  }
  async function node(S, pre) {
    const k = pre.join(","); if (S.memo.has(k)) return S.memo.get(k);
    const p = await node(S, pre.slice(0, -1));
    const feeds = { input_ids: new ort.Tensor("int64", BigInt64Array.from([BigInt(pre[pre.length - 1])]), [1, 1]), encoder_hidden_states: S.h, use_cache_branch: new ort.Tensor("bool", [true], [1]) };
    for (const [i, a, b] of PK) { const n = `past_key_values.${i}.${a}.${b}`; feeds[n] = a === "encoder" ? S.enc[n] : p.kv[n]; }
    const r = await dec.run(feeds); const kv = {}; for (const [i, a, b] of PK) kv[`past_key_values.${i}.${a}.${b}`] = a === "encoder" ? S.enc[`past_key_values.${i}.${a}.${b}`] : r[`present.${i}.${a}.${b}`];
    const o = { row: Float32Array.from(lastRow(r.logits)), kv }; S.memo.set(k, o); return o;
  }
  function lsm1(d, id) { let mx = -1e30; for (let v = 0; v < d.length; v++) if (d[v] > mx) mx = d[v]; let z = 0; for (let v = 0; v < d.length; v++) z += Math.exp(d[v] - mx); return d[id] - mx - Math.log(z); }
  async function seqLP(S, seq) { const out = []; for (let k = 0; k < seq.length; k++) out.push(lsm1((await node(S, seq.slice(0, k))).row, seq[k])); return out; }
  async function fitE(h, variants) { let best = -1e9; for (const s of variants) { const lp = await seqLP(h, s); best = Math.max(best, Math.min(0, ...lp)); } return best; }

  // word: target fit, best competitor fit, margin
  async function scoreWord(h, item) {
    h = await root(h); const t = await fitE(h, item.v); let cmax = -1e9, cw = null;
    for (const c of item.c) { const f = await fitE(h, c.v); if (f > cmax) { cmax = f; cw = c.w; } }
    return { t, cmax, cw, margin: t - cmax };
  }
  // sentence: lowest log-prob inside each word (punctuation and end token belong to the word before)
  async function scoreSent(h, item) {
    const lp = await seqLP(await root(h), item.ids); const w = item.words.map(() => 0);
    item.map.forEach((wi, k) => { w[wi] = Math.min(w[wi], lp[k]); });
    return { words: w };
  }
  window.PHMT = { load, encode, scoreWord, scoreSent, logMel, isReady: () => !!(enc && dec) };
})();
