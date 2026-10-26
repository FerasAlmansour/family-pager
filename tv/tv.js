/* Family Pager — شاشة التلفزيون (Samsung Tizen 5.0 / Chromium 63).
 * ES5 فقط: بلا async/await ولا ?. ولا AbortController. */
(function () {
  'use strict';

  var CFG = window.FP_CONFIG || {};
  var POLL_MS = 3000;
  var POLL_MAX_MS = 20000;
  var GIVE_UP_MS = 16 * 60 * 1000;
  var TOKEN_KEY = 'fp_tv_token';

  var body = document.body;
  var btn = document.getElementById('btn-main');
  var msgEl = document.getElementById('message');
  var noticeEl = document.getElementById('notice');
  var greetEl = document.getElementById('greeting');

  var names = { child: 'عبودة', parent: 'بابا' };
  var state = 'idle';
  var pollTimer = null;
  var resetTimer = null;
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

  // ---------- نصوص ----------

  function T() {
    var p = names.parent;
    return {
      idle: '',
      calling: 'عم ننادي ' + p + '...',
      sent: 'بعتنا التنبيه ل' + p + ' ❤️',
      seen: p + ' شاف رسالتك ❤️',
      coming: p + ' جاي لعندك! 🎉',
      failed: 'ما قدرنا نوصل ل' + p + ' 😢',
      expired: p + ' لسه ما شاف الرسالة ⏳',
      setup: 'التلفزيون غير مضبوط بعد'
    };
  }

  // ---------- عرض ----------

  function render(next, customMsg) {
    state = next;
    body.setAttribute('data-state', next);
    msgEl.textContent = customMsg || T()[next] || '';
    if (next === 'idle') {
      btn.textContent = 'نادِ ' + names.parent;
    } else {
      btn.textContent = 'تمام 👍';
    }
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
  }

  function toIdle() {
    session++;
    busy = false;
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

  function call() {
    if (busy) return;
    if (!token) { finishState('setup', 'افتح /tv/?t=رمز_التلفزيون مرة واحدة', 60000); return; }
    busy = true;
    var mySession = ++session;
    render('calling');

    request('POST', 'call.php', {}, function (status, json) {
      if (mySession !== session) return;
      if (status === 401) { finishState('setup', 'رمز التلفزيون غير صحيح', 60000); return; }
      if (status === 429) { finishState('failed', 'استنى شوي وجرّب كمان مرة ⏳', 10000); return; }
      if (status === 0) { finishState('failed', 'ما في إنترنت على التلفزيون 📡', 12000); return; }
      if (!json || !json.ok) { finishState('failed', null, 12000); return; }
      handleStatus(json, mySession, Date.now());
    });
  }

  function handleStatus(json, mySession, startedAt) {
    var s = json.status;
    if (s === 'failed') { finishState('failed', null, 12000); return; }
    if (s === 'seen' || s === 'coming') { finishState(s, null, 30000); return; }
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

  // ---------- أسماء ----------

  function loadNames() {
    if (!token) return;
    request('GET', 'info.php', null, function (status, json) {
      if (status === 200 && json && json.ok && json.names) {
        names = json.names;
        greetEl.textContent = 'أهلاً ' + names.child + ' ❤️';
        if (state === 'idle') render('idle');
      }
    });
  }

  // ---------- ريموت ----------

  btn.addEventListener('click', function () {
    if (state === 'idle') call();
    else if (state !== 'calling' && state !== 'sent') toIdle();
  });
  btn.addEventListener('focus', function () { btn.className = 'big-btn focus'; });
  btn.addEventListener('blur', function () { btn.className = 'big-btn'; });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (k === 37 || k === 38 || k === 39 || k === 40) { // أسهم: زر واحد، نعيد التركيز عليه
      e.preventDefault();
      focusBtn();
    } else if (k === 13 && document.activeElement !== btn && state !== 'calling' && state !== 'sent') {
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

  render(token ? 'idle' : 'setup', token ? null : 'افتح /tv/?t=رمز_التلفزيون مرة واحدة');
  if (!token) { busy = false; }
  loadNames();
})();
