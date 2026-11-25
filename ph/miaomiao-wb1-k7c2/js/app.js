(function () {
  'use strict';
  var DATA = null, KEY = 'ph-mm1', prog = {};
  var $app = document.getElementById('app'), $sheet = document.getElementById('sheet'), $toast = document.getElementById('toast');
  var UNITC = { 1: '#f28c28', 2: '#2f8fe0', 3: '#3aa64a', 4: '#8f4fd1' };
  var UNITN = { 1: 'Unit 1 · c says /k/', 2: 'Unit 2 · s at the end (cats)', 3: 'Unit 3 · action words + s (runs)', 4: 'Unit 4 · g says /g/' };

  /* ---------- progress ---------- */
  function loadProg() { try { prog = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { prog = {}; } }
  function saveProg() { try { localStorage.setItem(KEY, JSON.stringify(prog)); } catch (e) {} }
  function best(id) { return prog[id] || 0; }
  function setBest(id, s) { if (s > best(id)) { prog[id] = s; saveProg(); } }
  function mastered(id) { return best(id) >= 5; }

  /* ---------- helpers ---------- */
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function toast(t, ms) {
    $toast.textContent = t; $toast.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { $toast.hidden = true; }, ms || 2600);
  }
  function pageByN(n) { for (var i = 0; i < DATA.pages.length; i++) if (DATA.pages[i].n === n) return DATA.pages[i]; return null; }
  function starsHTML(n) { var s = ''; for (var i = 1; i <= 5; i++) s += '<span class="' + (i <= n ? 'on' : '') + '">★</span>'; return s; }

  /* ---------- groups (days) ---------- */
  function groups() {
    var g = [], map = {};
    DATA.pages.forEach(function (p) {
      var key, label;
      if (!p.unit) { key = 'front'; label = 'Start here'; }
      else if (p.type === 'READ' || p.type === 'STORY' || p.type === 'WRITE') { var d = /Day (\d)/.exec(p.day)[1]; key = 'u' + p.unit + 'd' + d; label = 'Day ' + d; }
      else if (p.type === 'CHECK') { key = 'u' + p.unit + 'c'; label = 'Check'; }
      else { key = 'u' + p.unit + 'r'; label = 'Try again'; }
      if (!map[key]) { map[key] = { key: key, unit: p.unit, label: label, pages: [] }; g.push(map[key]); }
      map[key].pages.push(p);
    });
    return g;
  }
  function groupOf(p) { var G = groups(); for (var i = 0; i < G.length; i++) if (G[i].pages.indexOf(p) >= 0) return G[i]; }
  function groupItems(gr) { var it = []; gr.pages.forEach(function (p) { p.items.forEach(function (x) { if (it.indexOf(x) < 0) it.push(x); }); }); return it; }
  function itemKey(x) { return x.indexOf('w:') === 0 ? x : x; }
  function countDone(items) { return items.filter(function (x) { return mastered(itemKey(x)); }).length; }
  function tabName(p) {
    return { COVER: 'Cover', 'HOW_TO_USE (grown-up)': 'How to use', MY_PATH: 'My Path', READ: 'Read', STORY: 'Story', WRITE: 'Write', CHECK: 'Check', RETAKE_PRACTICE: 'Try again', RETAKE_CHECK: 'Try again check' }[p.type] || p.type;
  }
  function pageTitle(p) {
    if (!p.unit) return 'Workbook 1 · ' + tabName(p);
    return p.day.replace(' · ', ' · ');
  }

  /* ---------- audio ---------- */
  var player = new Audio(); player.preload = 'auto';
  var playToken = 0, rafId = 0;
  function stopAudio() { playToken++; try { player.pause(); } catch (e) {} cancelAnimationFrame(rafId); clearHL(); }
  function clearHL() { document.querySelectorAll('.hl').forEach(function (e) { e.classList.remove('hl'); }); document.querySelectorAll('.hs.playing').forEach(function (e) { e.classList.remove('playing'); }); }
  function playSrc(src, from, to, onTime) {
    var tok = playToken;
    return new Promise(function (res) {
      var url = src;
      function go() {
        if (tok !== playToken) return res(false);
        // always start at `from` (or 0): a clip that was paused mid-way or ended must not resume where it stopped
        var p = player.play();
        if (p && p.catch) p.catch(function () { res(false); });
        try { if (from || player.currentTime > 0.05 || player.ended) player.currentTime = from || 0; } catch (e) {}
        function loop() {
          if (tok !== playToken) return res(false);
          var t = player.currentTime;
          if (onTime) onTime(t);
          if ((to && t >= to) || player.ended) { if (to) player.pause(); return res(true); }
          rafId = requestAnimationFrame(loop);
        }
        rafId = requestAnimationFrame(loop);
      }
      if (player.getAttribute('data-src') !== url) {
        player.setAttribute('data-src', url); player.src = url;
        var ok = false;
        player.oncanplay = function () { if (!ok) { ok = true; go(); } };
        player.onerror = function () { res(false); };
        player.load();
      } else go();
    });
  }
  function playList(list, gap) {
    stopAudio(); var tok = playToken, i = 0;
    function next() {
      if (tok !== playToken || i >= list.length) return Promise.resolve();
      return playSrc(list[i++]).then(function () {
        return new Promise(function (r) { setTimeout(r, gap || 300); });
      }).then(next);
    }
    return next();
  }
  /* sentence playback with word highlighting */
  function playSentence(s, spans, wordIdx) {
    stopAudio();
    var off = s.seg ? s.seg[0] : 0, end = s.seg ? s.seg[1] : 0;
    if (wordIdx != null) {
      var tm = s.tm[wordIdx];
      spans[wordIdx].classList.add('hl');
      return playSrc(s.a, off + Math.max(0, tm[0] - 0.06), off + tm[1] + 0.08).then(clearHL);
    }
    return playSrc(s.a, off, end || 0, function (t) {
      var rt = t - off;
      for (var i = 0; i < spans.length; i++) {
        var on = s.tm[i] && rt >= s.tm[i][0] - 0.02 && rt < s.tm[i][1] + 0.05;
        spans[i].classList.toggle('hl', !!on);
      }
    }).then(clearHL);
  }

  /* ---------- recorder ---------- */
  var rec = null;
  function record(kind, onStop) {
    var maxS = kind === 'word' ? 5 : 16, tail = kind === 'word' ? 1.0 : 1.6;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('nomic'));
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC();
      try { if (ctx.resume) ctx.resume(); } catch (e) {}   // iOS / WeChat may start the context suspended
      var src = ctx.createMediaStreamSource(stream);
      var proc = ctx.createScriptProcessor(4096, 1, 1);
      var chunks = [], t0 = ctx.currentTime, speech = false, lastLoud = 0, floor = 0.01, n = 0, stopped = false;
      proc.onaudioprocess = function (e) {
        if (stopped) return;
        var x = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(x));
        var s = 0; for (var i = 0; i < x.length; i++) s += x[i] * x[i]; var r = Math.sqrt(s / x.length);
        var t = ctx.currentTime - t0; n++;
        if (t < 0.3) { floor = Math.max(floor, r); return; }
        if (r > Math.max(0.02, floor * 2.5)) { speech = true; lastLoud = t; }
        if ((speech && t - lastLoud > tail) || t > maxS || (!speech && t > 6)) stop();
      };
      src.connect(proc); proc.connect(ctx.destination);
      function stop() {
        if (stopped) return; stopped = true;
        try { proc.disconnect(); src.disconnect(); } catch (e) {}
        stream.getTracks().forEach(function (t) { t.stop(); });
        var len = chunks.reduce(function (a, c) { return a + c.length; }, 0), all = new Float32Array(len), o = 0;
        chunks.forEach(function (c) { all.set(c, o); o += c.length; });
        var buf = ctx.createBuffer(1, Math.max(1, len), ctx.sampleRate); buf.copyToChannel ? buf.copyToChannel(all, 0) : buf.getChannelData(0).set(all);
        rec = null;
        try { ctx.close(); } catch (e) {}
        onStop(buf, speech);
      }
      rec = { stop: stop };
      return rec;
    });
  }
  var lastRec = null;
  function hearMe() {
    if (!lastRec) return;
    stopAudio();
    var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
    try { if (ctx.resume) ctx.resume(); } catch (e) {}
    var s = ctx.createBufferSource(); s.buffer = lastRec; s.connect(ctx.destination); s.start();
    s.onended = function () { try { ctx.close(); } catch (e) {} };
  }
  function ensureModel(msgEl) {
    if (window.MT.ready()) return Promise.resolve();
    if (msgEl) msgEl.textContent = 'Getting the listening helper ready (first time only, about 52 MB)…';
    return window.MT.load(function (f, got, total) {
      if (!msgEl) return;
      msgEl.textContent = got != null ?
        'Getting the listening helper ready (first time only): ' + (got / 1e6).toFixed(1) + ' of ' + Math.round(total / 1e6) + ' MB' :
        'Getting the listening helper ready… ' + Math.round(f * 100) + '%';
    }).then(function () { if (msgEl) msgEl.textContent = ''; })
      .catch(function (e) { var x = new Error('model'); x.kind = 'model'; x.cause = e; throw x; });
  }
  var IN_WECHAT = /MicroMessenger/i.test(navigator.userAgent || '');
  var OPEN_IN_BROWSER = 'In WeChat, tap ··· (top right) and choose “Open in browser”.';
  /* the right message for each way the microphone or the listening helper can fail */
  function micMessage(e) {
    if (e && e.kind === 'model') return 'The listening helper could not download. Check the internet (Wi-Fi is best) and tap My turn again.';
    var n = e ? (e.message === 'nomic' ? 'nomic' : (e.name || e.message || '')) : '';
    if (n === 'nomic') return IN_WECHAT ? 'WeChat’s browser cannot use the microphone. ' + OPEN_IN_BROWSER + ' Then allow the microphone.' :
      'This browser cannot use the microphone. Open this page in Safari or Chrome.';
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError')
      return IN_WECHAT ? 'The microphone is blocked in WeChat. ' + OPEN_IN_BROWSER + ' Then tap “Allow”.' :
        'The microphone is blocked. Allow the microphone for this page in the browser settings, then tap My turn again.';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError')
      return 'No microphone was found on this device.';
    if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError')
      return 'The microphone is busy (another app or call may be using it). Close it and tap My turn again.';
    return IN_WECHAT ? 'The microphone could not start. ' + OPEN_IN_BROWSER : 'The microphone could not start. Tap My turn again, or open this page in Safari or Chrome.';
  }
  function micError(e, msgEl) {
    var t = micMessage(e);
    if (msgEl) msgEl.textContent = t; else toast(t, 6000);
  }
  /* My turn: 1) is there a microphone API, 2) may we use the microphone, 3) only then download the 52 MB helper, 4) record */
  var micOK = false;
  function checkMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('nomic'));
    if (micOK) return Promise.resolve();
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      s.getTracks().forEach(function (t) { t.stop(); }); micOK = true;
    });
  }
  function startMic(loadEl, msgEl, kind, onStop) {
    var micErr = function (e) { if (e && e.kind !== 'model') e.kind = e.kind || 'mic'; throw e; };
    var pre = window.MT.ready() ? Promise.resolve() : checkMic().catch(micErr).then(function () { return ensureModel(loadEl); });
    return pre.then(function () { return record(kind, onStop).catch(micErr); })
      .catch(function (e) { if (loadEl && loadEl !== msgEl) loadEl.textContent = ''; micError(e, msgEl); return null; });
  }
  function feedback(stars, isSent) {
    if (stars >= 5) return ['Mastered! Great reading!', true];
    if (stars === 4) return [isSent ? 'So close! Try the red words again.' : 'So close! Listen once more and try again.', false];
    if (stars === 3) return [isSent ? 'Good try. Listen, then read it again.' : 'Good try. Listen, then say it again.', false];
    return ['Let’s listen first, then try again.', false];
  }

  /* ---------- practice sheet ---------- */
  function openPractice(list, idx, onClose) {
    stopAudio();
    $sheet.hidden = false; $sheet.innerHTML = '';
    var cur = idx;
    function close() { if (rec) rec.stop(); stopAudio(); $sheet.hidden = true; $sheet.innerHTML = ''; if (onClose) onClose(); }
    $sheet.onclick = function (e) { if (e.target === $sheet) close(); };
    function render() {
      stopAudio(); lastRec = null;
      var id = list[cur], isSent = id.indexOf('w:') !== 0;
      var item = isSent ? DATA.sents[id] : DATA.words[id.slice(2)];
      var panel = el('div', { class: 'panel' });
      panel.appendChild(el('div', { class: 'phead' }, [
        el('span', { class: 'cnt', text: (cur + 1) + ' of ' + list.length + (mastered(id) ? '  ✓ mastered' : '') }),
        el('button', { class: 'x', text: 'Close ✕', onclick: close })
      ]));
      var spans = [];
      if (isSent) {
        var line = el('div', { class: 'sent' });
        item.tok.forEach(function (t, i) {
          var sp = el('span', { text: t, onclick: function () { playSentence(item, spans, i); } });
          spans.push(sp); line.appendChild(sp); line.appendChild(document.createTextNode(' '));
        });
        panel.appendChild(line);
      } else panel.appendChild(el('div', { class: 'big', text: item.w }));
      var stars = el('div', { class: 'stars', html: starsHTML(best(id)) });
      var msg = el('div', { class: 'msg' });
      var load = el('div', { class: 'load' });
      var listen = el('button', { text: '🔊 Listen', onclick: function () { if (isSent) playSentence(item, spans); else playList([item.a]); } });
      var mic = el('button', { class: 'mic', text: '🎤 My turn' });
      var hear = el('button', { text: '▶ Hear me', onclick: hearMe }); hear.disabled = true;
      mic.onclick = function () {
        if (rec) { rec.stop(); return; }
        stopAudio(); msg.textContent = ''; msg.className = 'msg';
        startMic(load, msg, isSent ? 'sent' : 'word', function (buf, heard) {
            mic.classList.remove('rec'); mic.textContent = '🎤 My turn';
            lastRec = buf; hear.disabled = false;
            if (!heard) { msg.textContent = 'I didn’t hear you. Tap My turn and read it out loud.'; return; }
            msg.textContent = 'Listening…'; mic.disabled = true;
            window.MT.to16k(buf).then(function (x) {
              return isSent ? window.MT.scoreSent(x, item) : window.MT.scoreWord(x, item);
            }).then(function (r) {
              mic.disabled = false;
              setBest(id, r.stars);
              stars.innerHTML = starsHTML(r.stars);
              var f = feedback(r.stars, isSent); msg.textContent = f[0]; msg.className = 'msg' + (f[1] ? ' good' : '');
              if (isSent) spans.forEach(function (sp, i) { sp.classList.toggle('low', r.stars < 5 && r.words[i] < -3.5); });
              panel.querySelector('.cnt').textContent = (cur + 1) + ' of ' + list.length + (mastered(id) ? '  ✓ mastered' : '');
            }).catch(function () { mic.disabled = false; msg.textContent = 'Something went wrong. Tap My turn and try again.'; });
        }).then(function (r) { if (r) { mic.classList.add('rec'); mic.textContent = '⏹ Stop'; } });
      };
      panel.appendChild(el('div', { class: 'acts' }, [listen, mic]));
      panel.appendChild(load);
      panel.appendChild(stars); panel.appendChild(msg);
      panel.appendChild(el('div', { class: 'acts' }, [hear]));
      if (isSent) panel.appendChild(el('div', { class: 'tip', text: 'Tap a word to hear it.' }));
      var back = el('button', { text: '◀ Back', onclick: function () { if (cur > 0) { cur--; render(); } } });
      var next = el('button', { text: 'Next ▶', onclick: function () { if (cur < list.length - 1) { cur++; render(); } else close(); } });
      back.disabled = cur === 0;
      panel.appendChild(el('div', { class: 'pnav' }, [back, next]));
      $sheet.innerHTML = ''; $sheet.appendChild(panel);
      if (isSent) playSentence(item, spans); else playList([item.a]);
    }
    render();
  }

  /* ---------- story reader ---------- */
  function openStory(p, onClose) {
    stopAudio();
    var st = p.story;
    $sheet.hidden = false; $sheet.innerHTML = '';
    function close() { if (rec) rec.stop(); stopAudio(); $sheet.hidden = true; $sheet.innerHTML = ''; if (onClose) onClose(); }
    $sheet.onclick = function (e) { if (e.target === $sheet) close(); };
    var panel = el('div', { class: 'panel story' });
    panel.appendChild(el('div', { class: 'phead' }, [el('span', { class: 'cnt', text: 'Story' }), el('button', { class: 'x', text: 'Close ✕', onclick: close })]));
    panel.appendChild(el('h2', { text: st.title, onclick: function () { playList([st.ta]); } }));
    var load = el('div', { class: 'load' });
    var blocks = [];
    var playAll = el('button', { text: '🔊 Listen to the story' });
    panel.appendChild(el('div', { class: 'acts' }, [playAll]));
    panel.appendChild(load);
    st.ids.forEach(function (sid) {
      var s = DATA.sents[sid], spans = [];
      var box = el('div', { class: 'sb' + (mastered(sid) ? ' done' : '') });
      var line = el('div');
      s.tok.forEach(function (t, i) {
        var sp = el('span', { text: t, onclick: function () { playSentence(s, spans, i); } });
        spans.push(sp); line.appendChild(sp); line.appendChild(document.createTextNode(' '));
      });
      box.appendChild(line);
      var stars = el('span', { class: 'st', html: starsHTML(best(sid)) });
      var m = el('span', { class: 'm' });
      var lb = el('button', { text: '🔊', 'aria-label': 'Listen', onclick: function () { playSentence(s, spans); } });
      var mic = el('button', { class: 'mic', text: '🎤 My turn' });
      mic.onclick = function () {
        if (rec) { rec.stop(); return; }
        stopAudio(); m.textContent = '';
        startMic(load, m, 'sent', function (buf, heard) {
            mic.classList.remove('rec'); mic.textContent = '🎤 My turn'; lastRec = buf;
            if (!heard) { m.textContent = 'I didn’t hear you.'; return; }
            m.textContent = 'Listening…'; mic.disabled = true;
            window.MT.to16k(buf).then(function (x) { return window.MT.scoreSent(x, s); }).then(function (r) {
              mic.disabled = false; setBest(sid, r.stars);
              stars.innerHTML = starsHTML(r.stars);
              m.textContent = r.stars >= 5 ? 'Mastered!' : 'Try the red words again.';
              m.style.color = r.stars >= 5 ? 'var(--ok)' : 'var(--bad)';
              spans.forEach(function (sp, i) { sp.classList.toggle('low', r.stars < 5 && r.words[i] < -3.5); });
              box.classList.toggle('done', mastered(sid));
            }).catch(function () { mic.disabled = false; m.textContent = 'Something went wrong. Try again.'; });
        }).then(function (r) { if (r) { mic.classList.add('rec'); mic.textContent = '⏹ Stop'; } });
      };
      var hb = el('button', { text: '▶ Hear me', onclick: hearMe });
      box.appendChild(el('div', { class: 'row' }, [lb, mic, hb, stars, m]));
      panel.appendChild(box);
      blocks.push({ s: s, spans: spans });
    });
    playAll.onclick = function () {
      stopAudio(); var tok = playToken, all = [];
      blocks.forEach(function (b) { all = all.concat(b.spans.map(function (sp, i) { return { sp: sp, a: b.s.seg[0] + b.s.tm[i][0] - 0.05, b: b.s.seg[0] + b.s.tm[i][1] - 0.05 }; })); });
      var lastBox = null;
      playSrc(st.a, 0, 0, function (t) {
        if (tok !== playToken) return;
        for (var i = 0; i < all.length; i++) {
          var on = t >= all[i].a && t < all[i].b + 0.05;
          all[i].sp.classList.toggle('hl', on);
          if (on) {   // keep the lit sentence in view while the story plays
            var bx = all[i].sp.closest('.sb');
            if (bx && bx !== lastBox) { lastBox = bx; try { bx.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { bx.scrollIntoView(); } }
          }
        }
      }).then(clearHL);
    };
    panel.appendChild(el('div', { class: 'tip', text: 'Tap any word to hear it. Read each sentence with 🎤 My turn.' }));
    $sheet.appendChild(panel);
  }

  /* ---------- views ---------- */
  function setAcc(u) { document.documentElement.style.setProperty('--acc', UNITC[u] || '#f28c28'); }
  function home() {
    stopAudio(); setAcc(1); document.title = 'Miao Miao · Phonics & Spelling · Workbook 1';
    var w = el('div', { class: 'wrap' });
    $app.innerHTML = '';
    $app.appendChild(el('div', { class: 'top' }, [el('h1', { text: 'Phonics & Spelling · Workbook 1' })]));
    w.appendChild(el('div', { class: 'hero' }, [el('h1', { text: 'Hello, Miao Miao!' }), el('p', { text: 'Listen, read, and get 5 stars. CourseCraft English' })]));
    var ol = el('ol');
    ['Scan the QR code on a workbook page, or tap a day below. The same page opens here.',
      'Tap any part of the page to hear it: the sound, the words, the sentences and the instructions. On a Story page, tap the story box to open the story.',
      'Tap a word or a sentence. Listen, then tap 🎤 My turn and read it out loud. The first time, My turn downloads about 52 MB (once only), so use Wi-Fi.',
      '5 stars = mastered (a green ✓ on the page). Fewer stars? Listen again and try again until the bar is full.',
      'If the microphone does not work in WeChat, tap ··· (top right) and choose “Open in browser”. Then allow the microphone.'
    ].forEach(function (t) { ol.appendChild(el('li', { text: t })); });
    w.appendChild(el('div', { class: 'howto' }, [el('h2', { text: 'How to use this page (for grown-ups)' }), ol]));
    var G = groups(), units = {};
    G.forEach(function (g) { var u = g.unit || 0; (units[u] = units[u] || []).push(g); });
    Object.keys(units).sort().forEach(function (u) {
      u = +u; var card = el('div', { class: 'unit' });
      card.appendChild(el('h2', { text: u ? UNITN[u] : 'Start here', style: 'background:' + (UNITC[u] || '#f28c28') }));
      var grid = el('div', { class: 'grid' });
      units[u].forEach(function (g) {
        if (!u) {
          g.pages.forEach(function (p) { grid.appendChild(el('a', { class: 'day', href: '#p' + p.n }, [el('b', { text: tabName(p) }), el('small', { text: 'page ' + p.n })])); });
          return;
        }
        var it = groupItems(g), done = countDone(it);
        var pct = it.length ? Math.round(done / it.length * 100) : 0;
        var sub = g.pages.map(tabName).join(' · ');
        var a = el('a', { class: 'day', href: '#p' + g.pages[0].n }, [el('b', { text: g.label }), el('small', { text: sub })]);
        if (it.length) { a.appendChild(el('div', { class: 'bar' }, [el('i', { style: 'width:' + pct + '%' })])); a.appendChild(el('div', { class: 'bartxt', text: done + ' of ' + it.length + ' mastered' })); }
        else a.appendChild(el('div', { class: 'bartxt', text: 'listen only' }));
        grid.appendChild(a);
      });
      card.appendChild(grid); w.appendChild(card);
    });
    w.appendChild(el('p', { class: 'tip', text: 'Progress is saved on this phone.' }));
    $app.appendChild(w);
    window.scrollTo(0, 0);
  }
  function page(n) {
    stopAudio();
    var p = pageByN(n); if (!p) return home();
    setAcc(p.unit || 1);
    var g = groupOf(p);
    document.title = pageTitle(p) + ' · Miao Miao';
    $app.innerHTML = '';
    $app.appendChild(el('div', { class: 'top' }, [
      el('button', { class: 'btn-home', text: '⌂ Home', onclick: function () { location.hash = ''; } }),
      el('h1', { text: p.unit ? pageTitle(p) : 'Workbook 1' })
    ]));
    var w = el('div', { class: 'wrap' });
    if (g.pages.length > 1) {
      var tabs = el('div', { class: 'tabs' });
      g.pages.forEach(function (q) { tabs.appendChild(el('a', { href: '#p' + q.n, class: q === p ? 'on' : '', text: tabName(q) })); });
      w.appendChild(tabs);
    } else w.appendChild(el('div', { style: 'height:10px' }));
    var it = groupItems(g);
    var barI = el('i'), barT = el('span');
    function upd() { var d = countDone(it); barI.style.width = (it.length ? d / it.length * 100 : 0) + '%'; barT.textContent = d + ' of ' + it.length + ' mastered'; }
    if (it.length) { w.appendChild(el('div', { class: 'mast' }, [el('span', { text: 'Today:' }), el('div', { class: 'bar' }, [barI]), barT])); upd(); }
    var box = el('div', { class: 'pagebox' });
    var img = el('img', { src: 'img/p' + p.n + '.jpg?v=1', alt: 'Workbook page ' + p.n });
    box.appendChild(img);
    var pageList = p.items.filter(function (x) { return x.indexOf('st:') !== 0; });
    var hsEls = [];
    function refreshChecks() {
      hsEls.forEach(function (o) {
        var id = o.h.k === 'w' ? 'w:' + o.h.id : o.h.id;
        var has = o.e.querySelector('.ck');
        if ((o.h.k === 'w' || o.h.k === 's') && mastered(id)) { if (!has) o.e.appendChild(el('span', { class: 'ck', text: '✓' })); }
        if (o.h.k === 'story') {
          var all = p.story.ids.every(mastered);
          if (all && !has) o.e.appendChild(el('span', { class: 'ck', text: '✓' }));
        }
      });
      upd();
    }
    p.hs.forEach(function (h, i) {
      var b = el('button', { class: 'hs pulse', 'data-k': h.k, 'data-i': i, 'aria-label': h.l || h.k, style: 'left:' + h.b[0] + '%;top:' + h.b[1] + '%;width:' + h.b[2] + '%;height:' + h.b[3] + '%;animation-delay:' + (Math.min(i, 30) * 0.03) + 's' });
      b.addEventListener('click', function () {
        if (h.k === 'a') { b.classList.add('playing'); playList(h.src, 250).then(function () { b.classList.remove('playing'); }); }
        else if (h.k === 'w') openPractice(pageList, pageList.indexOf('w:' + h.id), refreshChecks);
        else if (h.k === 's') openPractice(pageList, pageList.indexOf(h.id), refreshChecks);
        else if (h.k === 'story') openStory(p, refreshChecks);
      });
      box.appendChild(b); hsEls.push({ e: b, h: h });
    });
    w.appendChild(box);
    refreshChecks();
    w.appendChild(el('p', { class: 'tip', text: p.type === 'STORY' ? 'Tap the story to listen and read it with 🎤 My turn.' : p.items.length ? 'Tap the page to hear it. Tap a word or sentence for 🎤 My turn.' : 'Tap the page to hear the instructions.' }));
    if (p.lines) w.appendChild(linesBlock(p));
    if (p.dict) w.appendChild(grownBlock(p));
    var idx = DATA.pages.indexOf(p), prev = DATA.pages[idx - 1], next = DATA.pages[idx + 1];
    w.appendChild(el('div', { class: 'nav' }, [
      prev ? el('a', { href: '#p' + prev.n, text: '◀ Page ' + prev.n }) : el('span'),
      next ? el('a', { href: '#p' + next.n, text: 'Page ' + next.n + ' ▶' }) : el('span')
    ]));
    $app.appendChild(w);
    growTargets(box, hsEls);
    window.scrollTo(0, 0);
  }
  /* phone tap targets: any hotspot smaller than 28 px grows to 28 px around its centre,
     but never past the midpoint to a neighbour it did not already overlap */
  function growTargets(box, list) {
    var W = box.clientWidth; if (!W) return;
    var H = W * 3508 / 2480, mh = 28 / H * 100, mw = 28 / W * 100;
    var R = list.map(function (o) { var b = o.h.b; return { x0: b[0], y0: b[1], x1: b[0] + b[2], y1: b[1] + b[3] }; });
    function ov(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0) > 0; }
    R.forEach(function (a, i) {
      var h = a.y1 - a.y0, w = a.x1 - a.x0, top = a.y0, bot = a.y1, lef = a.x0, rig = a.x1;
      var tLim = 0, bLim = 100, lLim = 0, rLim = 100;
      R.forEach(function (b, j) {
        if (i === j) return;
        if (ov(a.x0, a.x1, b.x0, b.x1) && ov(a.y0, a.y1, b.y0, b.y1)) {
          var inside = (b.x0 <= a.x0 && b.x1 >= a.x1 && b.y0 <= a.y0 && b.y1 >= a.y1) || (a.x0 <= b.x0 && a.x1 >= b.x1 && a.y0 <= b.y0 && a.y1 >= b.y1);
          if (inside) return;   // a word inside a big instruction panel may grow inside it
          // already touching: never grow further towards it
          if ((b.y0 + b.y1) < (a.y0 + a.y1)) tLim = Math.max(tLim, a.y0); else bLim = Math.min(bLim, a.y1);
          if ((b.x0 + b.x1) < (a.x0 + a.x1)) lLim = Math.max(lLim, a.x0); else rLim = Math.min(rLim, a.x1);
          return;
        }
        if (ov(a.x0, a.x1, b.x0, b.x1)) {
          if (b.y1 <= a.y0) tLim = Math.max(tLim, (b.y1 + a.y0) / 2);
          if (b.y0 >= a.y1) bLim = Math.min(bLim, (a.y1 + b.y0) / 2);
        }
        if (ov(a.y0, a.y1, b.y0, b.y1)) {
          if (b.x1 <= a.x0) lLim = Math.max(lLim, (b.x1 + a.x0) / 2);
          if (b.x0 >= a.x1) rLim = Math.min(rLim, (a.x1 + b.x0) / 2);
        }
      });
      if (h < mh) { top = Math.max(tLim, a.y0 - (mh - h) / 2); bot = Math.min(bLim, a.y1 + (mh - h) / 2); }
      if (w < mw) { lef = Math.max(lLim, a.x0 - (mw - w) / 2); rig = Math.min(rLim, a.x1 + (mw - w) / 2); }
      if (top !== a.y0 || bot !== a.y1 || lef !== a.x0 || rig !== a.x1) {
        var e = list[i].e.style;
        e.left = lef + '%'; e.top = top + '%'; e.width = (rig - lef) + '%'; e.height = (bot - top) + '%';
      }
    });
  }
  /* How-to page: the same lines as a big tappable list (the printed lines are tiny on a phone) */
  function linesBlock(p) {
    var wrap = el('div', { class: 'lines' });
    wrap.appendChild(el('h3', { text: 'Tap a line to hear it' }));
    p.lines.forEach(function (l) {
      var b = el('button', { class: 'line' + (l.h ? ' lh' : ''), type: 'button', text: l.t });
      b.addEventListener('click', function () { b.classList.add('playing'); playList(l.src, 250).then(function () { b.classList.remove('playing'); }); });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function grownBlock(p) {
    var wrap = el('div');
    var fill = el('i', { class: 'fill' });
    var btn = el('button', { class: 'grown', type: 'button' }, [fill, el('span', { text: '🔒 For grown-ups: dictation (press and hold)' })]);
    var timer = null, start = 0, raf = 0, panel = null;
    function down(e) {
      e.preventDefault(); start = Date.now();
      (function step() {
        var f = Math.min(1, (Date.now() - start) / 1200); fill.style.width = f * 100 + '%';
        if (f >= 1) { up(); open(); return; }
        raf = requestAnimationFrame(step);
      })();
    }
    function up() { cancelAnimationFrame(raf); fill.style.width = '0'; }
    var autoClose = 0;
    function shut() { clearTimeout(autoClose); if (panel) { if (panel.isConnected) stopAudio(); panel.remove(); panel = null; } }
    function open() {
      if (panel) { shut(); return; }
      panel = el('div', { class: 'dict' });
      panel.appendChild(el('div', { class: 'dhead' }, [el('h3', { text: 'Dictation (grown-up plays it, she writes)' }), el('button', { class: 'dclose', type: 'button', text: 'Close ✕', onclick: shut })]));
      // hide the answers again after 60 s without a tap, so she does not see them
      var arm = function () { clearTimeout(autoClose); autoClose = setTimeout(shut, 60000); };
      panel.addEventListener('pointerdown', arm); arm();
      panel.appendChild(el('p', { text: p.type === 'WRITE' ? 'Play each word, then the sentence. She writes them on the practice test lines.' : 'For each number: play the word, then the sentence, then the word again. She writes only the word.' }));
      p.dict.forEach(function (r, i) {
        var row = el('div', { class: 'drow' });
        row.appendChild(el('b', { text: r.w ? (i + 1) + '.' : '' }));
        row.appendChild(el('span', { class: 't', text: r.w ? r.w + (r.s ? ' — ' + r.s : '') : 'Sentence: ' + r.s }));
        if (r.w && r.s) row.appendChild(el('button', { text: '▶ word · sentence · word', onclick: function () { playList([r.wa, r.sa, r.wa], 700); } }));
        if (r.w) row.appendChild(el('button', { text: '▶ word', onclick: function () { playList([r.wa]); } }));
        if (r.s) row.appendChild(el('button', { text: '▶ sentence', onclick: function () { playList([r.sa]); } }));
        panel.appendChild(row);
      });
      wrap.appendChild(panel);
    }
    btn.addEventListener('pointerdown', down);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, up); });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    wrap.appendChild(btn);
    return wrap;
  }
  function route() {
    $sheet.hidden = true; $sheet.innerHTML = '';
    var m = /^#p0*(\d+)/i.exec(location.hash);
    if (m) page(+m[1]); else home();
  }

  /* test hook: score a reference clip on this device */
  window.__phScore = function (url, key) {
    return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
      var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
      return new Promise(function (res, rej) { ctx.decodeAudioData(ab, res, rej); });
    }).then(window.MT.to16k).then(function (x) {
      return key.indexOf('w:') === 0 ? window.MT.scoreWord(x, DATA.words[key.slice(2)]) : window.MT.scoreSent(x, DATA.sents[key]);
    });
  };

  loadProg();
  fetch('data.json?v=2').then(function (r) { return r.json(); }).then(function (d) {
    DATA = d; window.__phData = d;
    window.addEventListener('hashchange', route);
    route();
  }).catch(function () { $app.textContent = 'Could not load the page. Check the internet and reload.'; });
})();
