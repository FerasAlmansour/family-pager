/* Family Pager — تطبيق الأب (iPhone PWA). Vanilla JS. */
(function () {
  'use strict';

  var KEY_STORE = 'fp_parent_key';
  var $ = function (id) { return document.getElementById(id); };
  var state = { key: '', vapid: '', names: { child: 'عبودة', parent: 'بابا' }, reg: null, sub: null, latest: null };

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

  // ---------- واجهة ----------

  function renderSupport() {
    var el = $('support-status');
    var enable = $('btn-enable'), test = $('btn-test');
    enable.disabled = test.disabled = true;

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

  function renderLatest() {
    var r = state.latest;
    $('latest-empty').hidden = !!r;
    $('latest-body').hidden = !r;
    if (!r) return;
    var text = {
      created: state.names.child + ' عم يناديك ❤️',
      sent: state.names.child + ' عم يناديك ❤️',
      seen: '✅ أخبرته أنك شفت الرسالة',
      coming: '❤️ أخبرته أنك جاي لعندك',
      failed: 'تعذّر إرسال هذا النداء إلى هاتفك',
      expired: 'انتهت صلاحية هذا النداء'
    }[r.status] || r.status;
    $('latest-text').textContent = text;
    $('latest-time').textContent = fmtTime(r.created_at);
    var open = r.status === 'sent' || r.status === 'created' || r.status === 'seen';
    $('latest-actions').hidden = !open;
    $('btn-seen').hidden = r.status === 'seen';
    $('btn-seen').disabled = $('btn-coming').disabled = false;
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

  function respond(response) {
    var r = state.latest;
    if (!r) return;
    $('btn-seen').disabled = $('btn-coming').disabled = true;
    api('api/respond.php', 'POST', { rid: r.rid, response: response }).then(function (d) {
      if (d.ok) {
        state.latest = { rid: d.rid, status: d.status, created_at: d.created_at, responded_at: d.responded_at };
        say($('action-status'), response === 'coming' ? '❤️ وصلت رسالتك للتلفزيون.' : '✅ وصلت رسالتك للتلفزيون.', 'ok');
      } else {
        say($('action-status'), '❌ تعذّر إرسال الرد (' + (d.error || d.httpStatus) + ').', 'bad');
      }
      renderLatest();
    }).catch(function () {
      say($('action-status'), '❌ لا يوجد اتصال بالإنترنت.', 'bad');
      $('btn-seen').disabled = $('btn-coming').disabled = false;
    });
  }

  // ---------- بدء التشغيل ----------

  function ridFromUrl() {
    var m = /[?&]r=([0-9a-f]{16})/.exec(location.search);
    return m ? m[1] : '';
  }

  function init() {
    state.key = storeGet();

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
    $('btn-seen').addEventListener('click', function () { respond('seen'); });
    $('btn-coming').addEventListener('click', function () { respond('coming'); });

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
