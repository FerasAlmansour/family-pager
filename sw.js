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
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var rid = event.notification.data && event.notification.data.rid;
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
