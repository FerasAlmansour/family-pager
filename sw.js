/* Family Pager service worker: استقبال Web Push وفتح الطلب عند الضغط على الإشعار. */
'use strict';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  // iOS يشترط عرض إشعار مع كل push، لذلك نعرض دائماً (حتى لو فشل تحليل الحمولة).
  var title = data.title || 'Family Pager';
  var options = {
    body: data.body || 'عندك رسالة جديدة',
    icon: 'icons/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    tag: data.rid ? 'fp-' + data.rid : 'fp-test',
    renotify: true,
    data: { rid: data.rid || null, test: !!data.test }
  };
  // أزرار الردّ السريع (تظهر على Android وسطح المكتب؛ iOS لا يدعم أزرار الإشعار)
  if (data.rid) {
    options.actions = [
      { action: 'coming', title: 'جاي لعندك ❤️' },
      { action: 'five', title: 'خمس دقايق ⏱️' }
    ];
  }
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    data.rid && self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge(1).catch(function () {}) : null
  ]));
});

function readParentKey() {
  return new Promise(function (resolve) {
    try {
      var open = indexedDB.open('fp', 1);
      open.onupgradeneeded = function () { open.result.createObjectStore('kv'); };
      open.onerror = function () { resolve(''); };
      open.onsuccess = function () {
        var get = open.result.transaction('kv').objectStore('kv').get('parent_key');
        get.onsuccess = function () { resolve(get.result || ''); };
        get.onerror = function () { resolve(''); };
      };
    } catch (e) { resolve(''); }
  });
}

function quickRespond(rid, response) {
  return readParentKey().then(function (key) {
    if (!key) return false;
    return fetch(new URL('api/respond.php', self.registration.scope).href, {
      method: 'POST',
      headers: { 'X-Parent-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rid: rid, response: response })
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  });
}

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var rid = event.notification.data && event.notification.data.rid;

  if (rid && (event.action === 'coming' || event.action === 'five')) {
    event.waitUntil(quickRespond(rid, event.action).then(function (ok) {
      if (self.navigator && self.navigator.clearAppBadge) self.navigator.clearAppBadge().catch(function () {});
      if (!ok) return self.registration.showNotification('تعذّر إرسال الرد', { body: 'افتح التطبيق وردّ من هناك.', dir: 'rtl', lang: 'ar', icon: 'icons/icon-192.png' });
    }));
    return;
  }
  var target = new URL(rid ? './?r=' + encodeURIComponent(rid) : './', self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) {
          c.postMessage({ type: 'open-request', rid: rid });
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
