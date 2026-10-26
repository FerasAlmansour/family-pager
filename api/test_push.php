<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/push.php';

fp_method('POST');
fp_require_parent();

// حد بسيط: إشعار تجريبي واحد كل 5 ثوانٍ
$last = (int) fp_setting('last_test_push', '0');
if (time() - $last < 5) {
    fp_fail(429, 'too_soon');
}
fp_set_setting('last_test_push', (string) time());

$results = fp_send_push('test', null, [
    'title' => 'تجربة Family Pager ✅',
    'body' => 'وصلك هذا الإشعار من خادم PHP عبر Web Push.',
    'rid' => null,
    'test' => true,
], 120);

fp_json([
    'ok' => true,
    'subscriptions' => count($results),
    'accepted' => count(array_filter($results, fn ($r) => $r['success'])),
    'results' => $results,
    'note' => 'القبول يعني أن خدمة Push استلمت الرسالة؛ ظهورها على الهاتف يُتحقق منه يدوياً.',
]);
