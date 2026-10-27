/* Family Pager — تطبيق الأب (iPhone PWA). Vanilla JS. */
(function () {
  'use strict';

  var KEY_STORE = 'fp_parent_key';
  var PREF_STORE = 'fp_prefs';
  var HIST_STORE = 'fp_history';
  var $ = function (id) { return document.getElementById(id); };

  var STATUS = {
    seen: ['✅', 'أخبرته أنك شفت الرسالة'],
    coming: ['❤️', 'أخبرته أنك جاي لعندك'],
    five: ['⏱️', 'أخبرته أنك تحتاج خمس دقايق'],
    later: ['🙏', 'أخبرته أنك ستردّ بعد شوي'],
    hug: ['🤗', 'أرسلت له حضناً كبيراً'],
    text: ['💬', 'أرسلت له رسالة']
  };
  var HISTORY_LABEL = {
    seen: 'شفت الرسالة', coming: 'جاي لعندك', five: 'خمس دقايق', later: 'بعد شوي', hug: 'حضن كبير', text: 'رسالة'
  };
  var REASON = {
    call: ['❤️', 'عم يناديك'],
    hungry: ['🍽️', 'جوعان'],
    help: ['🆘', 'بده مساعدة'],
    play: ['🎮', 'بده يلعب معك'],
    night: ['🌙', 'بيقولك تصبح على خير']
  };

  var state = { key: '', vapid: '', names: { child: 'مسعف', parent: 'بابا' }, reg: null, sub: null, latest: null };

  var isStandalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var pushCapable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function storeGet() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function storeSet(v) { try { localStorage.setItem(KEY_STORE, v); } catch (e) { /* ignore */ } }

  function say(el, text, cls) {
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  function api(path, method, body) {
    return fetch(path, {
      method: method || 'GET',
      headers: { 'X-Parent-Key': state.key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: 'bad_response' }; }).then(function (data) {
        data.httpStatus = res.status;
        return data;
      });
    });
  }

  function urlBase64ToUint8Array(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  // ---------- تفضيلات ومؤثرات ----------

  var prefs = { accent: 'blue', theme: 'auto', motion: true, haptic: true };
  try {
    var saved = JSON.parse(localStorage.getItem(PREF_STORE) || '{}');
    for (var pk in saved) prefs[pk] = saved[pk];
  } catch (e) { /* ignore */ }
  function savePrefs() { try { localStorage.setItem(PREF_STORE, JSON.stringify(prefs)); } catch (e) { /* ignore */ } }

  function applyPrefs() {
    var root = document.documentElement, i;
    root.setAttribute('data-accent', prefs.accent);
    if (prefs.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prefs.theme);
    root.setAttribute('data-motion', prefs.motion ? 'on' : 'off');
    var sw = $('swatches').children;
    for (i = 0; i < sw.length; i++) sw[i].setAttribute('aria-checked', String(sw[i].getAttribute('data-c') === prefs.accent));
    var sg = $('seg-theme').children;
    for (i = 0; i < sg.length; i++) sg[i].setAttribute('aria-checked', String(sg[i].getAttribute('data-v') === prefs.theme));
    $('sw-motion').checked = prefs.motion;
    $('sw-haptic').checked = prefs.haptic;
  }

  function haptic(pattern) {
    if (prefs.haptic && navigator.vibrate) { try { navigator.vibrate(pattern || 12); } catch (e) { /* ignore */ } }
  }

  var toastTimer = null;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function motionOk() {
    return prefs.motion && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // قصاصات احتفالية خفيفة على canvas
  function confetti(emojis) {
    if (!motionOk()) return;
    var c = $('fx'), ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    var parts = [], i;
    for (i = 0; i < 36; i++) {
      parts.push({
        x: innerWidth / 2, y: innerHeight * 0.55,
        vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 13 - 4,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        e: emojis[i % emojis.length], s: 18 + Math.random() * 16
      });
    }
    var start = performance.now();
    (function frame(now) {
      var t = now - start;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(function (p) {
        p.vy += 0.38; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t / 1700);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.font = p.s + 'px serif';
        ctx.fillText(p.e, 0, 0);
        ctx.restore();
      });
      if (t < 1700) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(start);
  }

  // سجل محلي بآخر الردود
  function histGet() { try { return JSON.parse(localStorage.getItem(HIST_STORE) || '[]'); } catch (e) { return []; } }
  function histAdd(item) {
    var h = histGet().filter(function (x) { return !(x.rid === item.rid && x.status === item.status); });
    h.unshift(item);
    try { localStorage.setItem(HIST_STORE, JSON.stringify(h.slice(0, 10))); } catch (e) { /* ignore */ }
  }

  // ---------- واجهة ----------

  function renderSupport() {
    var el = $('support-status');
    var enable = $('btn-enable'), test = $('btn-test');
    enable.disabled = test.disabled = true;
    $('card-setup').classList.remove('compact');

    if (!state.key || !state.verified) { say(el, 'أدخل رمز الأب الصحيح أولاً.', 'warn'); return; }
    if (!pushCapable) {
      if (isIOS && !isStandalone) say(el, '⚠️ على الآيفون يعمل Web Push فقط بعد إضافة التطبيق إلى الشاشة الرئيسية وفتحه منها (iOS 16.4+).', 'warn');
      else say(el, '❌ هذا المتصفح لا يدعم Web Push.', 'bad');
      return;
    }
    if (isIOS && !isStandalone) {
      say(el, '⚠️ افتح التطبيق من أيقونته على الشاشة الرئيسية لتفعيل الإشعارات.', 'warn');
      return;
    }
    if (!state.vapid) { say(el, '⚠️ الخادم لا يملك مفاتيح VAPID بعد. أكمل صفحة الإعداد.', 'warn'); return; }
    if (Notification.permission === 'denied') {
      say(el, '❌ الإذن مرفوض. فعّله من إعدادات iOS ← الإشعارات ← Pager.', 'bad');
      return;
    }
    if (Notification.permission === 'granted' && state.sub) {
      say(el, '✅ الإشعارات مفعّلة على هذا الجهاز.', 'ok');
      enable.disabled = false;
      enable.textContent = 'إعادة تسجيل الاشتراك';
      test.disabled = false;
      $('card-setup').classList.add('compact');
      return;
    }
    say(el, 'الإشعارات غير مفعّلة بعد.', 'warn');
    enable.disabled = false;
    enable.textContent = 'تفعيل الإشعارات';
  }

  function renderKeyCard() {
    var ok = !!state.key && state.verified;
    $('key-hint').textContent = ok ? '✅ الرمز محفوظ ومقبول.' : 'أدخل الرمز الظاهر في صفحة الإعداد (مرة واحدة فقط).';
    $('key-input').value = ok ? '' : state.key;
    $('key-form').hidden = ok;
  }

  function renderGuide() {
    $('card-guide').hidden = isStandalone && !!state.sub;
  }

  function fmtTime(dt) {
    if (!dt) return '';
    var d = new Date(dt.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? dt : d.toLocaleString('ar', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  }

  var lastRid = '';

  function renderLatest() {
    var r = state.latest;
    $('latest-empty').hidden = !!r;
    $('latest-body').hidden = !r;
    var pill = $('latest-pill');
    pill.hidden = !r;
    if (!r) return;

    var known = STATUS[r.status];
    var why = REASON[r.reason] || REASON.call;
    var callText = state.names.child + ' ' + why[1] + ' ' + why[0];
    var text = known ? known[0] + ' ' + (r.status === 'text' && r.reply_text ? '«' + r.reply_text + '»' : known[1]) : ({
      created: callText,
      sent: callText,
      quiet: '🤫 وصل نداء خلال ساعات الهدوء (' + why[1] + ')',
      failed: 'تعذّر إرسال هذا النداء إلى هاتفك',
      expired: 'انتهت صلاحية هذا النداء'
    }[r.status] || r.status);
    var waiting = r.status === 'sent' || r.status === 'created';
    setBadge(waiting ? 1 : 0);

    $('latest-text').textContent = text;
    $('latest-time').textContent = fmtTime(r.created_at);
    $('card-latest').classList.toggle('live-on', waiting);
    pill.textContent = waiting ? 'ينتظر ردّك' : (known ? 'تم الرد' : 'منتهٍ');
    pill.className = 'pill' + (waiting ? ' live' : (known ? ' done' : ''));
    $('latest-avatar').textContent = known ? known[0] : why[0];
    $('compose').hidden = !(waiting || (known && r.status !== 'coming'));

    // "جاي لعندك" نهائية؛ غيرها يمكن تغييره
    $('latest-actions').hidden = !(waiting || (known && r.status !== 'coming'));
    var btns = document.querySelectorAll('.reply'), i;
    for (i = 0; i < btns.length; i++) {
      btns[i].disabled = false;
      btns[i].classList.toggle('chosen', btns[i].getAttribute('data-r') === r.status);
    }
    if (lastRid !== r.rid) {
      lastRid = r.rid;
      var av = $('latest-avatar');
      av.classList.remove('pop');
      void av.offsetWidth;
      av.classList.add('pop');
    }
  }

  // شارة الأيقونة بعدد النداءات المنتظرة
  function setBadge(n) {
    try {
      if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) { /* ignore */ }
  }

  function fmtDuration(sec) {
    if (sec === null || sec === undefined) return '—';
    if (sec < 60) return sec + ' ث';
    if (sec < 3600) return Math.round(sec / 60) + ' د';
    return Math.round(sec / 3600) + ' س';
  }

  function renderStats() {
    var s = state.stats;
    $('card-stats').hidden = !s || !s.total;
    if (!s) return;
    $('st-total').textContent = s.total;
    $('st-answered').textContent = s.answered;
    $('st-avg').textContent = fmtDuration(s.avgSeconds);
  }

  function renderQuiet() {
    var q = state.quiet;
    $('card-quiet').hidden = !state.verified;
    if (!q) return;
    $('sw-quiet').checked = q.on;
    $('quiet-start').value = q.start;
    $('quiet-end').value = q.end;
    $('quiet-times').classList.toggle('off', !q.on);
  }

  function saveQuiet() {
    var body = {
      quietOn: $('sw-quiet').checked,
      quietStart: $('quiet-start').value || '22:00',
      quietEnd: $('quiet-end').value || '07:00',
      tzOffset: -new Date().getTimezoneOffset()
    };
    api('api/settings.php', 'POST', body).then(function (d) {
      if (d.ok) { state.quiet = d.quiet; renderQuiet(); toast(d.quiet.on ? '🤫 فُعّلت ساعات الهدوء' : 'أُوقفت ساعات الهدوء'); }
      else toast('❌ تعذّر حفظ الإعداد');
    }).catch(function () { toast('❌ لا يوجد اتصال بالإنترنت'); });
  }

  // نحفظ رمز الأب في IndexedDB ليستطيع الـ Service Worker الردّ من أزرار الإشعار
  function shareKeyWithWorker() {
    try {
      var open = indexedDB.open('fp', 1);
      open.onupgradeneeded = function () { open.result.createObjectStore('kv'); };
      open.onsuccess = function () {
        var tx = open.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(state.key, 'parent_key');
      };
    } catch (e) { /* ignore */ }
  }

  function renderHistory() {
    var h = histGet(), ul = $('history');
    $('card-history').hidden = !h.length;
    ul.innerHTML = '';
    h.forEach(function (x, i) {
      var li = document.createElement('li');
      li.style.animationDelay = (i * 0.05) + 's';
      var em = document.createElement('span'), tx = document.createElement('span'), tm = document.createElement('span');
      em.className = 'em'; tx.className = 'tx'; tm.className = 'tm';
      em.textContent = (STATUS[x.status] || ['•'])[0];
      tx.textContent = HISTORY_LABEL[x.status] || x.status;
      tm.textContent = fmtTime(x.at);
      li.appendChild(em); li.appendChild(tx); li.appendChild(tm);
      ul.appendChild(li);
    });
  }

  // ---------- بيانات ----------

  function loadState(rid) {
    if (!state.key) { state.verified = false; renderAll(); return Promise.resolve(); }
    return api('api/state.php' + (rid ? '?rid=' + encodeURIComponent(rid) : '')).then(function (d) {
      if (d.httpStatus === 401) {
        state.verified = false;
        say($('action-status'), '❌ رمز الأب غير صحيح.', 'bad');
      } else if (d.ok) {
        state.verified = true;
        state.vapid = d.vapidPublicKey || '';
        state.names = d.names || state.names;
        state.latest = d.latest;
        state.stats = d.stats || null;
        state.quiet = d.quiet || null;
        shareKeyWithWorker();
      } else {
        say($('action-status'), '❌ تعذّر الاتصال بالخادم (' + (d.error || d.httpStatus) + ').', 'bad');
      }
      renderAll();
    }).catch(function () {
      say($('action-status'), '❌ لا يوجد اتصال بالإنترنت.', 'bad');
    });
  }

  function renderAll() {
    renderKeyCard();
    renderSupport();
    renderGuide();
    renderLatest();
    renderStats();
    renderQuiet();
    renderHistory();
  }

  function refreshSubscription() {
    if (!pushCapable || !state.reg) return Promise.resolve();
    return state.reg.pushManager.getSubscription().then(function (s) { state.sub = s; });
  }

  // ---------- إجراءات ----------

  function enable() {
    var out = $('action-status');
    say(out, 'جارٍ التفعيل…');
    // طلب الإذن يتم هنا فقط، كنتيجة مباشرة لضغطة المستخدم.
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('permission_' + perm);
      return state.reg.pushManager.getSubscription();
    }).then(function (existing) {
      return existing || state.reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.vapid)
      });
    }).then(function (sub) {
      state.sub = sub;
      return api('api/subscribe.php', 'POST', { subscription: sub.toJSON() });
    }).then(function (d) {
      if (!d.ok) throw new Error('server_' + (d.error || d.httpStatus));
      say(out, '✅ تم حفظ الاشتراك على الخادم. جرّب التنبيه التجريبي الآن.', 'ok');
      toast('✅ تم تفعيل الإشعارات');
      haptic([10, 40, 10]);
      renderAll();
    }).catch(function (e) {
      var m = String(e && e.message || e);
      say(out, m.indexOf('permission_') === 0
        ? '❌ لم يُمنح إذن الإشعارات.'
        : '❌ فشل الاشتراك: ' + m, 'bad');
      renderAll();
    });
  }

  function sendTest() {
    var out = $('action-status');
    $('btn-test').disabled = true;
    say(out, 'جارٍ الإرسال من الخادم…');
    api('api/test_push.php', 'POST', {}).then(function (d) {
      if (d.httpStatus === 429) { say(out, 'انتظر ثواني قليلة ثم أعد المحاولة.', 'warn'); return; }
      if (!d.ok) { say(out, '❌ فشل: ' + (d.error || d.httpStatus), 'bad'); return; }
      if (!d.subscriptions) { say(out, '⚠️ لا توجد اشتراكات فعّالة على الخادم. اضغط «تفعيل الإشعارات».', 'warn'); return; }
      say(out, d.accepted > 0
        ? '📤 قبلت خدمة Push الرسالة (' + d.accepted + '/' + d.subscriptions + '). تحقق من وصول الإشعار على الهاتف.'
        : '❌ رفضت خدمة Push الرسالة. راجع سجل الإرسال في صفحة الإعداد.', d.accepted > 0 ? 'ok' : 'bad');
    }).catch(function () {
      say(out, '❌ لا يوجد اتصال بالإنترنت.', 'bad');
    }).then(function () { renderSupport(); });
  }

  function setReplyBusy(on) {
    var btns = document.querySelectorAll('.reply'), i;
    for (i = 0; i < btns.length; i++) btns[i].disabled = on;
  }

  function respond(response, text) {
    var r = state.latest;
    if (!r) return;
    haptic(15);
    setReplyBusy(true);
    api('api/respond.php', 'POST', { rid: r.rid, response: response, text: text || '' }).then(function (d) {
      if (d.ok) {
        state.latest = { rid: d.rid, status: d.status, created_at: d.created_at, responded_at: d.responded_at, reason: d.reason, reply_text: d.reply_text };
        $('compose-input').value = '';
        histAdd({ rid: d.rid, status: d.status, at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
        toast((STATUS[d.status] || [''])[0] + ' وصلت رسالتك للتلفزيون');
        haptic([10, 40, 10]);
        if (d.status === 'coming') confetti(['❤️', '💖', '✨']);
        else if (d.status === 'hug') confetti(['🤗', '💞', '🌸']);
        else if (d.status === 'seen') confetti(['✅', '✨']);
      } else {
        toast('❌ تعذّر إرسال الرد');
        var card = $('card-latest');
        card.classList.add('shake');
        setTimeout(function () { card.classList.remove('shake'); }, 500);
      }
      renderAll();
    }).catch(function () {
      toast('❌ لا يوجد اتصال بالإنترنت');
      setReplyBusy(false);
    });
  }

  // ---------- بدء التشغيل ----------

  function ridFromUrl() {
    var m = /[?&]r=([0-9a-f]{16})/.exec(location.search);
    return m ? m[1] : '';
  }

  function init() {
    state.key = storeGet();
    applyPrefs();

    $('key-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('key-input').value.trim();
      if (!v) return;
      state.key = v;
      storeSet(v);
      loadState().then(function () { if (!state.verified) { storeSet(''); } });
    });
    $('btn-enable').addEventListener('click', enable);
    $('btn-test').addEventListener('click', sendTest);

    Array.prototype.forEach.call(document.querySelectorAll('.reply'), function (b) {
      b.addEventListener('click', function () { respond(b.getAttribute('data-r')); });
    });
    $('compose').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('compose-input').value.trim();
      if (v) respond('text', v);
    });
    $('chips').addEventListener('click', function (e) {
      var t = e.target.getAttribute && e.target.getAttribute('data-t');
      if (t) respond('text', t);
    });
    $('sw-quiet').addEventListener('change', saveQuiet);
    $('quiet-start').addEventListener('change', saveQuiet);
    $('quiet-end').addEventListener('change', saveQuiet);
    $('btn-clear-history').addEventListener('click', function () {
      try { localStorage.removeItem(HIST_STORE); } catch (e) { /* ignore */ }
      renderHistory();
      haptic(10);
    });

    $('swatches').addEventListener('click', function (e) {
      var c = e.target.getAttribute && e.target.getAttribute('data-c');
      if (c) { prefs.accent = c; savePrefs(); applyPrefs(); haptic(8); }
    });
    $('seg-theme').addEventListener('click', function (e) {
      var v = e.target.getAttribute && e.target.getAttribute('data-v');
      if (v) { prefs.theme = v; savePrefs(); applyPrefs(); haptic(8); }
    });
    $('sw-motion').addEventListener('change', function () { prefs.motion = this.checked; savePrefs(); applyPrefs(); });
    $('sw-haptic').addEventListener('change', function () { prefs.haptic = this.checked; savePrefs(); applyPrefs(); haptic(15); });
    window.addEventListener('scroll', function () {
      $('navbar').classList.toggle('on', window.scrollY > 50);
    }, { passive: true });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) loadState();
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'open-request') loadState(e.data.rid);
      });
    }

    var rid = ridFromUrl();
    if (rid && history.replaceState) history.replaceState(null, '', location.pathname);

    renderAll();
    var ready = Promise.resolve();
    if ('serviceWorker' in navigator) {
      ready = navigator.serviceWorker.register('sw.js').then(function () {
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        state.reg = reg;
        return refreshSubscription();
      }).catch(function () {
        say($('support-status'), '❌ تعذّر تسجيل Service Worker (يتطلب HTTPS).', 'bad');
      });
    }
    ready.then(function () { return loadState(rid); }).then(function () {
      // إن كان الاشتراك موجوداً محلياً، جدّده على الخادم (يعالج تغيّر الاشتراك بصمت)
      if (state.verified && state.sub && Notification.permission === 'granted') {
        api('api/subscribe.php', 'POST', { subscription: state.sub.toJSON() });
      }
    });
  }

  init();
})();
