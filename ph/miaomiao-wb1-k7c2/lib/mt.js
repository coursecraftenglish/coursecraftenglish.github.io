/* On-device speech check: Whisper tiny.en (int8 ONNX) + onnxruntime-web, all files self-hosted.
   No audio leaves the phone. Same math as speech/mt.py (Python reference). */
(function () {
  'use strict';
  var SOT = 50257, NOTS = 50362, EOT = 50256, PREFIX = [SOT, NOTS];
  var BASE = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/lib\/mt\.js.*$/, '') : './';
  var VER = 'mt-v1';
  var enc = null, dec = null, MEL = null, loading = null;
  var COS = null, SIN = null, WIN = null;

  /* download with byte progress (so a slow phone connection does not look frozen); cached with the Cache API */
  function readAll(r, onBytes) {
    if (!r.body || !r.body.getReader) return r.arrayBuffer().then(function (ab) { onBytes(ab.byteLength); return ab; });
    var rd = r.body.getReader(), parts = [], n = 0;
    function pump() {
      return rd.read().then(function (x) {
        if (x.done) { var out = new Uint8Array(n), o = 0; parts.forEach(function (p) { out.set(p, o); o += p.length; }); return out.buffer; }
        parts.push(x.value); n += x.value.length; onBytes(x.value.length); return pump();
      });
    }
    return pump();
  }
  function fetchCached(url, onBytes) {
    var full = BASE + url;
    function net(c) {
      return fetch(full).then(function (r) {
        if (!r.ok) throw new Error(url);
        return readAll(r, onBytes).then(function (ab) {
          if (!c) return ab;
          return c.put(full, new Response(ab.slice(0))).catch(function () {}).then(function () { return ab; });
        });
      });
    }
    if (!('caches' in window)) return net(null);
    return caches.open(VER).then(function (c) {
      return c.match(full).then(function (hit) {
        if (hit) return hit.arrayBuffer().then(function (ab) { onBytes(ab.byteLength); return ab; });
        return net(c);
      });
    }, function () { return net(null); });
  }

  // sizes of the files downloaded the first time (for the progress message); the real bytes are counted as they arrive
  var FILES = [['m/enc.onnx', 10124993], ['m/dec.1', 16000000], ['m/dec.2', 14718858], ['m/mel.bin', 64320], ['lib/ort-wasm-simd-threaded.wasm', 11246032]];
  var TOTAL = FILES.reduce(function (a, f) { return a + f[1]; }, 0);
  function load(progress) {
    if (loading) return loading;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = BASE + 'lib/';
    var got = 0, last = 0;
    function onBytes(k) {
      got += k; var now = Date.now();
      if (progress && (now - last > 150 || got >= TOTAL)) { last = now; progress(Math.min(1, got / TOTAL), Math.min(got, TOTAL), TOTAL); }
    }
    loading = Promise.all(FILES.map(function (f) { return fetchCached(f[0], onBytes); })).then(function (b) {
      var d = new Uint8Array(b[1].byteLength + b[2].byteLength);
      d.set(new Uint8Array(b[1]), 0); d.set(new Uint8Array(b[2]), b[1].byteLength);
      MEL = new Float32Array(b[3]);
      ort.env.wasm.wasmBinary = b[4];   // the 11 MB engine is counted in the progress and cached like the model
      var opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      return ort.InferenceSession.create(new Uint8Array(b[0]), opt).then(function (e) {
        enc = e;
        return ort.InferenceSession.create(d, opt);
      }).then(function (s) { dec = s; return true; });
    });
    loading.catch(function () { loading = null; });
    return loading;
  }

  /* log-mel exactly like WhisperFeatureExtractor (n_fft 400, hop 160, 80 mels, 30 s) */
  function logmel(x) {
    var N = 480000, NF = 3000, nb = 201;
    if (!COS) {
      COS = new Float64Array(nb * 400); SIN = new Float64Array(nb * 400); WIN = new Float64Array(400);
      for (var n = 0; n < 400; n++) WIN[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / 400);
      for (var k = 0; k < nb; k++) for (var m = 0; m < 400; m++) {
        COS[k * 400 + m] = Math.cos(2 * Math.PI * k * m / 400); SIN[k * 400 + m] = Math.sin(2 * Math.PI * k * m / 400);
      }
    }
    var L = Math.min(x.length, N);
    var pad = new Float64Array(N + 400);
    for (var i = 0; i < L; i++) pad[200 + i] = x[i];
    for (i = 1; i <= 200; i++) { pad[200 - i] = (i < L ? x[i] : 0); pad[200 + N - 1 + i] = 0; }
    var out = new Float32Array(80 * NF);
    var lastFrame = Math.min(NF - 1, Math.ceil((L + 400) / 160));
    var fr = new Float64Array(400), pw = new Float64Array(nb), mx = -1e9;
    var logs = new Float64Array(80 * NF);
    for (var f = 0; f < NF; f++) {
      if (f <= lastFrame) {
        for (n = 0; n < 400; n++) fr[n] = pad[f * 160 + n] * WIN[n];
        for (k = 0; k < nb; k++) {
          var re = 0, im = 0, o = k * 400;
          for (n = 0; n < 400; n++) { re += fr[n] * COS[o + n]; im -= fr[n] * SIN[o + n]; }
          pw[k] = re * re + im * im;
        }
      }
      for (var b = 0; b < 80; b++) {
        var s = 0;
        if (f <= lastFrame) { var mo = b * nb; for (k = 0; k < nb; k++) s += MEL[mo + k] * pw[k]; }
        var v = Math.log10(Math.max(s, 1e-10));
        logs[b * NF + f] = v; if (v > mx) mx = v;
      }
    }
    for (i = 0; i < logs.length; i++) out[i] = (Math.max(logs[i], mx - 8) + 4) / 4;
    return out;
  }

  function encode(x) {
    var feats = new ort.Tensor('float32', logmel(x), [1, 80, 3000]);
    return enc.run({ input_features: feats }).then(function (r) { return r.last_hidden_state; });
  }

  function emptyKV() { return new ort.Tensor('float32', new Float32Array(0), [1, 6, 0, 64]); }
  function logsoftmaxRow(data, off, V) {
    var mx = -1e30, i; for (i = 0; i < V; i++) if (data[off + i] > mx) mx = data[off + i];
    var s = 0; for (i = 0; i < V; i++) s += Math.exp(data[off + i] - mx);
    var ls = Math.log(s) + mx;
    return function (t) { return data[off + t] - ls; };
  }
  function decFull(hid, ids) {
    var feed = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(function (v) { return BigInt(v); })), [1, ids.length]),
      encoder_hidden_states: hid,
      use_cache_branch: new ort.Tensor('bool', [false], [1])
    };
    for (var l = 0; l < 4; l++) ['decoder.key', 'decoder.value', 'encoder.key', 'encoder.value'].forEach(function (k) { feed['past_key_values.' + l + '.' + k] = emptyKV(); });
    return dec.run(feed).then(function (r) {
      var lg = r.logits, V = lg.dims[2], T = lg.dims[1], rows = [];
      for (var t = 0; t < T; t++) rows.push(logsoftmaxRow(lg.data, t * V, V));
      var kv = {};
      Object.keys(r).forEach(function (n) { if (n.indexOf('present.') === 0) kv[n.replace('present.', 'past_key_values.')] = r[n]; });
      return { rows: rows, kv: kv };
    });
  }
  function decStep(hid, tok, kv) {
    var feed = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from([BigInt(tok)]), [1, 1]),
      encoder_hidden_states: hid,
      use_cache_branch: new ort.Tensor('bool', [true], [1])
    };
    Object.keys(kv).forEach(function (k) { feed[k] = kv[k]; });
    return dec.run(feed).then(function (r) {
      var lg = r.logits, V = lg.dims[2], T = lg.dims[1];
      var nkv = {};
      Object.keys(kv).forEach(function (k) {
        nkv[k] = k.indexOf('.decoder.') > 0 ? r[k.replace('past_key_values.', 'present.')] : kv[k];
      });
      return { row: logsoftmaxRow(lg.data, (T - 1) * V, V), kv: nkv };
    });
  }
  /* min token log-prob of each sequence; trie walk with shared prefixes */
  function seqScores(hid, seqs) {
    return decFull(hid, PREFIX).then(function (r0) {
      var cache = { '': { row: r0.rows[r0.rows.length - 1], kv: r0.kv } };
      var res = [];
      var chain = Promise.resolve();
      seqs.forEach(function (s, si) {
        chain = chain.then(function () {
          var mn = 0, j = 0;
          function next() {
            if (j >= s.length) { res[si] = mn; return; }
            var key = s.slice(0, j).join(',');
            var p = cache[key] ? Promise.resolve(cache[key]) : (function () {
              var pk = s.slice(0, j - 1).join(',');
              return decStep(hid, s[j - 1], cache[pk].kv).then(function (x) { cache[key] = x; return x; });
            })();
            return p.then(function (node) { var v = node.row(s[j]); if (v < mn) mn = v; j++; return next(); });
          }
          return next();
        });
      });
      return chain.then(function () { return res; });
    });
  }
  function wordScore(hid, w) {
    var all = w.v.slice(); w.c.forEach(function (c) { all = all.concat(c); });
    return seqScores(hid, all).then(function (sc) {
      var nv = w.v.length, t = Math.max.apply(null, sc.slice(0, nv)), k = nv, best = -1e9, bw = null;
      w.c.forEach(function (c, i) { var m = Math.max.apply(null, sc.slice(k, k + c.length)); if (m > best) { best = m; bw = w.cw ? w.cw[i] : i; } k += c.length; });
      var margin = w.c.length ? t - best : 5;
      return { t: t, m: margin, rival: bw };
    });
  }
  function starsWord(t, m, t5, m5) {
    if (t >= t5 && m >= m5) return 5;
    if (t >= t5 - 1.5 && m >= m5 - 1) return 4;
    if (t >= t5 - 3 && m >= m5 - 2.5) return 3;
    if (t >= -10) return 2;
    return 1;
  }
  function sentScores(hid, s) {
    function one(ids, wm) {
      return decFull(hid, PREFIX.concat(ids)).then(function (r) {
        var P = PREFIX.length;
        var tl = ids.map(function (tok, i) { return r.rows[P - 1 + i](tok); });
        return wm.map(function (m) { return m.length ? Math.min.apply(null, m.map(function (i) { return tl[i]; })) : 0; });
      });
    }
    return one(s.ids, s.wm).then(function (ws) {
      if (!s.alt) return ws;
      return one(s.alt.ids, s.alt.wm).then(function (w2) { return ws.map(function (a, i) { return Math.max(a, w2[i]); }); });
    }).then(function (ws) {
      /* rival sentences: the key word must beat its closest competitor (cats vs cat) */
      var chain = Promise.resolve();
      (s.rv || []).forEach(function (rv) {
        chain = chain.then(function () {
          return one(rv.ids, rv.wm).then(function (wr) { if (ws[rv.i] <= wr[rv.i]) ws[rv.i] = Math.min(ws[rv.i], -5.5); });
        });
      });
      return chain.then(function () {
        (s.fl || []).forEach(function (i) { ws[i] = Math.max(ws[i], -3.0); });   /* names and animal sounds never fail a sentence */
        return ws;
      });
    });
  }
  function starsSent(ws) {
    var m = Math.min.apply(null, ws);
    return m >= -3.5 ? 5 : m >= -5 ? 4 : m >= -7 ? 3 : m >= -10 ? 2 : 1;
  }
  /* trim silence, keep 0.25 s margins */
  function trim(x) {
    var win = 320, th = 0, i, e = [], mx = 0;
    for (i = 0; i + win <= x.length; i += win) {
      var s = 0; for (var j = i; j < i + win; j++) s += x[j] * x[j];
      s = Math.sqrt(s / win); e.push(s); if (s > mx) mx = s;
    }
    th = Math.max(0.008, mx * 0.08);
    var a = 0, b = e.length - 1;
    while (a < e.length && e[a] < th) a++;
    while (b > a && e[b] < th) b--;
    if (a >= e.length) return x;
    var st = Math.max(0, a * win - 4000), en = Math.min(x.length, (b + 1) * win + 4000);
    return x.subarray(st, en);
  }
  function scoreWord(x16, w) {
    return load().then(function () { return encode(trim(x16)); }).then(function (hid) { return wordScore(hid, w); })
      .then(function (r) { r.stars = starsWord(r.t, r.m, w.t5, w.m5); return r; });
  }
  function scoreSent(x16, s) {
    return load().then(function () { return encode(trim(x16)); }).then(function (hid) { return sentScores(hid, s); })
      .then(function (ws) { return { words: ws, stars: starsSent(ws) }; });
  }
  function to16k(buf) {
    var len = Math.ceil(buf.duration * 16000);
    var oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, len, 16000);
    var src = oc.createBufferSource(); src.buffer = buf; src.connect(oc.destination); src.start();
    return oc.startRendering().then(function (r) { return r.getChannelData(0).slice(); });
  }
  window.MT = { load: load, scoreWord: scoreWord, scoreSent: scoreSent, to16k: to16k, logmel: logmel, trim: trim, ready: function () { return !!dec; } };
})();
