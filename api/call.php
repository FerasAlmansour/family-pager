<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/push.php';

fp_cors_for_tv();
fp_method('POST');
fp_require_tv();

$db = fp_db();
$cooldown = max(5, (int) fp_setting('call_cooldown_seconds', '20'));
$now = time();

// منع النداءات المتكررة: ضغطة ثانية خلال فترة الانتظار تعيد الطلب نفسه
$last = $db->query('SELECT * FROM pager_requests ORDER BY id DESC LIMIT 1')->fetch();
if ($last && $last['status'] !== 'failed' && $now - (int) fp_ts($last['created_at']) < $cooldown) {
    fp_json(['ok' => true, 'reused' => true] + fp_public_request($last));
}

// سقف ساعي لحماية الهاتف من الإزعاج
$since = gmdate('Y-m-d H:i:s', $now - 3600);
$st = $db->prepare('SELECT COUNT(*) FROM pager_requests WHERE created_at > ?');
$st->execute([$since]);
if ((int) $st->fetchColumn() >= 12) {
    fp_fail(429, 'rate_limited');
}

$rid = bin2hex(random_bytes(8));
$db->prepare('INSERT INTO pager_requests (rid, status, created_at) VALUES (?, ?, ?)')
    ->execute([$rid, 'created', fp_now()]);

$names = fp_names();
$results = fp_send_push('call', $rid, [
    'title' => $names['child'] . ' عم يناديك ❤️',
    'body' => 'اضغط لتفتح الرسالة وتردّ عليه',
    'rid' => $rid,
], 300);

if (fp_any_success($results)) {
    $db->prepare('UPDATE pager_requests SET status = ?, sent_at = ? WHERE rid = ?')->execute(['sent', fp_now(), $rid]);
} else {
    $db->prepare('UPDATE pager_requests SET status = ? WHERE rid = ?')->execute(['failed', $rid]);
}

$row = fp_find_request($rid);
fp_json(['ok' => true, 'reused' => false] + fp_public_request($row), 200);
