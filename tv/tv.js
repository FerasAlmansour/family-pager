/* Family Pager — شاشة التلفزيون (Samsung Tizen 5.0 / Chromium 63).
 * ES5 فقط: بلا async/await ولا ?. ولا AbortController. */
(function () {
  'use strict';

  var CFG = window.FP_CONFIG || {};
  var POLL_MS = 3000;
  var POLL_MAX_MS = 20000;
  var GIVE_UP_MS = 16 * 60 * 1000;
  var TOKEN_KEY = 'fp_tv_token';
  var AVATAR_KEY = 'fp_tv_avatar';
  var AVATARS = ['🙂', '🦁', '🐼', '🦄', '🚀', '🐱', '⚽', '🌈'];
  var FIVE_MIN = 300;
  var END_STATES = { seen: 1, coming: 1, five: 1, later: 1, hug: 1, text: 1, quiet: 1 };

  var body = document.body;
  var btn = document.getElementById('btn-main');
  var avatarBtn = document.getElementById('btn-avatar');
  var reasonBtns = document.querySelectorAll('.reason-btn');
  var msgEl = document.getElementById('message');
  var noticeEl = document.getElementById('notice');
  var greetEl = document.getElementById('greeting');
  var stickerEl = document.getElementById('sticker');
  var timerText = document.getElementById('timer-text');
  var timerBar = document.getElementById('timer-bar');

  var names = { child: 'مسعف', parent: 'بابا' };
  var state = 'idle';
  var reason = 'call';
  var replyText = '';
  var pollTimer = null;
  var resetTimer = null;
  var countTimer = null;
  var busy = false;
  var session = 0; // يبطل ردود قديمة بعد الإلغاء

  // ---------- إعداد ----------

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { /* ignore */ }
    return '';
  }

  function getToken() {
    if (CFG.TV_TOKEN) return CFG.TV_TOKEN;
    var m = /[?&]t=([A-Za-z0-9]{8,64})/.exec(location.search);
    if (m) {
      store(TOKEN_KEY, m[1]);
      if (window.history && history.replaceState) history.replaceState(null, '', location.pathname);
      return m[1];
    }
    return store(TOKEN_KEY);
  }

  function apiUrl(name) {
    var base = CFG.API_BASE || '../api/';
    return base + name;
  }

  function request(method, name, data, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, apiUrl(name), true);
    xhr.timeout = 15000;
    xhr.setRequestHeader('X-TV-Token', token);
    if (data) xhr.setRequestHeader('Content-Type', 'application/json');
    var done = false;
    function finish(status, json) { if (!done) { done = true; cb(status, json); } }
    xhr.onload = function () {
      var json = null;
      try { json = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      finish(xhr.status, json);
    };
    xhr.onerror = xhr.ontimeout = function () { finish(0, null); };
    xhr.send(data ? JSON.stringify(data) : null);
  }

  var token = getToken();

  // ---------- نصوص وملصقات ----------

  function T() {
    var p = names.parent;
    var sent = {
      call: 'بعتنا التنبيه ل' + p + ' ❤️',
      hungry: 'خبّرنا ' + p + ' إنك جوعان 🍽️',
      help: 'خبّرنا ' + p + ' إنك بدك مساعدة 🆘',
      play: 'قلنا ل' + p + ' تعال نلعب 🎮',
      night: 'قلنا ل' + p + ' تصبح على خير 🌙'
    };
    return {
      idle: '',
      calling: 'عم ننادي ' + p + '...',
      sent: sent[reason] || sent.call,
      seen: p + ' شاف رسالتك ❤️',
      coming: p + ' جاي لعندك! 🎉',
      five: p + ' بدو خمس دقايق ⏱️',
      later: p + ' بيرد عليك بعد شوي 🙏',
      hug: p + ' بعتلك حضن كبير 🤗',
      text: replyText ? p + ' بيقولك: «' + replyText + '»' : p + ' بعتلك رسالة 💬',
      quiet: p + ' مشغول هلق 🤫 جرّب بعد شوي',
      failed: 'ما قدرنا نوصل ل' + p + ' 😢',
      expired: p + ' لسه ما شاف الرسالة ⏳',
      setup: 'التلفزيون غير مضبوط بعد'
    };
  }

  var STICKERS = {
    calling: '📟', sent: '📨', seen: '✅', coming: '🏃', five: '⏱️', later: '🙏',
    hug: '🤗', text: '💬', quiet: '🤫', failed: '😢', expired: '⏳'
  };

  // ---------- صوت (WebAudio، يُنشأ عند أول ضغطة) ----------

  var audio = null;
  function ensureAudio() {
    if (audio) return audio;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audio = new AC(); } catch (e) { audio = null; }
    return audio;
  }

  function tones(list, gain) {
    var ac = ensureAudio();
    if (!ac) return;
    try {
      if (ac.state === 'suspended' && ac.resume) ac.resume();
      var t0 = ac.currentTime + 0.02;
      for (var i = 0; i < list.length; i++) {
        var o = ac.createOscillator();
        var g = ac.createGain();
        var start = t0 + i * 0.16;
        o.type = 'sine';
        o.frequency.value = list[i];
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(gain || 0.18, start + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
        o.connect(g);
        g.connect(ac.destination);
        o.start(start);
        o.stop(start + 0.36);
      }
    } catch (e) { /* ignore */ }
  }

  var SOUNDS = {
    sent: [660], seen: [523, 659], coming: [523, 659, 784, 1047], five: [587, 587],
    later: [440, 392], hug: [392, 494, 587, 784], text: [784, 988], failed: [330, 262],
    quiet: [392], expired: [330]
  };

  // ---------- عرض ----------

  function stopCountdown() {
    if (countTimer) { clearInterval(countTimer); countTimer = null; }
  }

  function startCountdown() {
    stopCountdown();
    var left = FIVE_MIN;
    function tick() {
      var m = Math.floor(left / 60), s = left % 60;
      timerText.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
      var f = left / FIVE_MIN;
      timerBar.style.webkitTransform = timerBar.style.transform = 'scaleX(' + f + ')';
      if (left <= 0) { stopCountdown(); return; }
      left--;
    }
    tick();
    countTimer = setInterval(tick, 1000);
  }

  function render(next, customMsg) {
    state = next;
    body.setAttribute('data-state', next);
    msgEl.textContent = customMsg || T()[next] || '';
    stickerEl.textContent = STICKERS[next] || '';
    // إعادة تشغيل حركة الملصق
    stickerEl.style.display = 'none';
    void stickerEl.offsetHeight;
    stickerEl.style.display = '';
    if (next === 'idle') {
      btn.textContent = 'نادِ ' + names.parent;
    } else {
      btn.textContent = 'تمام 👍';
    }
    if (next === 'five') startCountdown(); else stopCountdown();
    if (SOUNDS[next]) tones(SOUNDS[next]);
    btn.disabled = false;
    noticeEl.textContent = '';
    focusBtn();
  }

  function focusBtn() {
    if (state === 'calling' || state === 'sent') { try { btn.blur(); } catch (e) { /* ignore */ } return; }
    try { btn.focus(); } catch (e) { /* ignore */ }
  }

  function clearTimers() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
    stopCountdown();
  }

  function toIdle() {
    session++;
    busy = false;
    replyText = '';
    reason = 'call';
    clearTimers();
    render('idle');
  }

  function finishState(next, customMsg, resetAfterMs) {
    clearTimers();
    busy = false;
    render(next, customMsg);
    resetTimer = setTimeout(toIdle, resetAfterMs);
  }

  // ---------- النداء والاستعلام ----------

  function call(why) {
    if (busy) return;
    ensureAudio();
    reason = why || 'call';
    if (!token) { finishState('setup', 'افتح /tv/?t=رمز_التلفزيون مرة واحدة', 60000); return; }
    busy = true;
    var mySession = ++session;
    render('calling');

    request('POST', 'call.php', { reason: reason }, function (status, json) {
      if (mySession !== session) return;
      if (status === 401) { finishState('setup', 'رمز التلفزيون غير صحيح', 60000); return; }
      if (status === 429) { finishState('failed', 'استنى شوي وجرّب كمان مرة ⏳', 10000); return; }
      if (status === 0) { finishState('failed', 'ما في إنترنت على التلفزيون 📡', 12000); return; }
      if (!json || !json.ok) { finishState('failed', null, 12000); return; }
      if (json.reason) reason = json.reason;
      handleStatus(json, mySession, Date.now());
    });
  }

  function handleStatus(json, mySession, startedAt) {
    var s = json.status;
    replyText = json.reply_text || '';
    if (s === 'failed') { finishState('failed', null, 12000); return; }
    if (s === 'five') { finishState('five', null, (FIVE_MIN + 5) * 1000); return; }
    if (s === 'quiet') { finishState('quiet', null, 15000); return; }
    if (END_STATES[s]) { finishState(s, null, s === 'text' ? 40000 : 30000); return; }
    if (s === 'expired') { finishState('expired', null, 20000); return; }
    if (state !== 'sent') render('sent');
    poll(json.rid, mySession, startedAt, 0);
  }

  function poll(rid, mySession, startedAt, errors) {
    var delay = errors === 0 ? POLL_MS : Math.min(POLL_MS * Math.pow(2, errors), POLL_MAX_MS);
    pollTimer = setTimeout(function () {
      if (mySession !== session) return;
      if (Date.now() - startedAt > GIVE_UP_MS) { finishState('expired', null, 20000); return; }
      request('GET', 'status.php?rid=' + encodeURIComponent(rid), null, function (status, json) {
        if (mySession !== session) return;
        if (status === 200 && json && json.ok) {
          noticeEl.textContent = '';
          if (json.status === 'sent' || json.status === 'created') { poll(rid, mySession, startedAt, 0); return; }
          handleStatus(json, mySession, startedAt);
          return;
        }
        if (status === 401 || status === 404) { finishState('failed', null, 12000); return; }
        noticeEl.textContent = 'الإنترنت ضعيف... عم نحاول 📡';
        poll(rid, mySession, startedAt, errors + 1);
      });
    }, delay);
  }

  // ---------- أسماء وصورة وليل ----------

  function avatar() {
    var a = store(AVATAR_KEY);
    return a && AVATARS.indexOf(a) !== -1 ? a : AVATARS[0];
  }

  function renderGreeting() {
    greetEl.textContent = 'أهلاً ' + names.child + ' ❤️';
    avatarBtn.textContent = avatar();
  }

  function cycleAvatar() {
    var next = AVATARS[(AVATARS.indexOf(avatar()) + 1) % AVATARS.length];
    store(AVATAR_KEY, next);
    avatarBtn.textContent = next;
    avatarBtn.className = 'avatar-btn';
    void avatarBtn.offsetWidth;
    avatarBtn.className = 'avatar-btn bump';
    tones([880], 0.1);
  }

  function loadNames() {
    if (!token) return;
    request('GET', 'info.php', null, function (status, json) {
      if (status === 200 && json && json.ok && json.names) {
        names = json.names;
        renderGreeting();
        if (state === 'idle') render('idle');
      }
    });
  }

  function updateNight() {
    var h = new Date().getHours();
    var night = h >= 21 || h < 6;
    var has = /(^|\s)night(\s|$)/.test(body.className);
    if (night && !has) body.className += ' night';
    if (!night && has) body.className = body.className.replace(/(^|\s)night(?=\s|$)/g, '');
  }

  // ---------- ريموت ----------

  btn.addEventListener('click', function () {
    ensureAudio();
    if (state === 'idle') call('call');
    else if (state !== 'calling' && state !== 'sent') toIdle();
  });
  avatarBtn.addEventListener('click', cycleAvatar);
  Array.prototype.forEach.call(reasonBtns, function (b) {
    b.addEventListener('click', function () { if (state === 'idle') call(b.getAttribute('data-reason')); });
  });

  // شبكة التنقل بالأسهم (ترتيب بصري من اليسار إلى اليمين)
  function navRows() {
    var chips = Array.prototype.slice.call(reasonBtns).reverse(); // DOM: من اليمين، لذا نعكس
    return [[avatarBtn], [btn], chips];
  }

  function moveFocus(key) {
    if (state !== 'idle') { focusBtn(); return; }
    var rows = navRows(), r = 0, c = 0, i, j;
    for (i = 0; i < rows.length; i++) for (j = 0; j < rows[i].length; j++) if (rows[i][j] === document.activeElement) { r = i; c = j; }
    if (key === 37) c = Math.max(0, c - 1);
    else if (key === 39) c = Math.min(rows[r].length - 1, c + 1);
    else if (key === 38) { r = Math.max(0, r - 1); c = Math.min(c, rows[r].length - 1); }
    else if (key === 40) { r = Math.min(rows.length - 1, r + 1); c = Math.min(c, rows[r].length - 1); }
    try { rows[r][c].focus(); } catch (e) { /* ignore */ }
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (k === 37 || k === 38 || k === 39 || k === 40) {
      e.preventDefault();
      moveFocus(k);
    } else if (k === 13 && document.activeElement.tagName !== 'BUTTON' && state !== 'calling' && state !== 'sent') {
      e.preventDefault();
      btn.click();
    } else if (k === 10009 || k === 27 || k === 8) { // Back / Esc / Backspace
      e.preventDefault();
      if (state !== 'idle') {
        toIdle();
      } else if (window.tizen && tizen.application) {
        try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* ignore */ }
      }
    }
  });

  // ---------- بدء ----------

  renderGreeting();
  updateNight();
  setInterval(updateNight, 60000);
  render(token ? 'idle' : 'setup', token ? null : 'افتح /tv/?t=رمز_التلفزيون مرة واحدة');
  if (!token) { busy = false; }
  loadNames();
})();
