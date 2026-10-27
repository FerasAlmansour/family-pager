<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/push.php';

fp_cors_for_tv();
fp_method('POST');
fp_require_tv();

$in = fp_input();
$reason = (string) ($in['reason'] ?? 'call');
if (!in_array($reason, FP_REASONS, true)) {
    $reason = 'call';
}

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

// ساعات الهدوء: نسجّل الطلب دون إزعاج الهاتف، والتلفزيون يعرض «مشغول»
if (fp_quiet_now()) {
    $db->prepare('INSERT INTO pager_requests (rid, status, created_at, reason) VALUES (?, ?, ?, ?)')
        ->execute([$rid, 'quiet', fp_now(), $reason]);
    fp_json(['ok' => true, 'reused' => false] + fp_public_request(fp_find_request($rid)), 200);
}

$db->prepare('INSERT INTO pager_requests (rid, status, created_at, reason) VALUES (?, ?, ?, ?)')
    ->execute([$rid, 'created', fp_now(), $reason]);

$child = fp_names()['child'];
$titles = [
    'call' => $child . ' عم يناديك ❤️',
    'hungry' => $child . ' جوعان 🍽️',
    'help' => $child . ' بده مساعدة 🆘',
    'play' => $child . ' بده يلعب معك 🎮',
    'night' => $child . ' بيقولك تصبح على خير 🌙',
];
$results = fp_send_push('call', $rid, [
    'title' => $titles[$reason],
    'body' => 'اضغط لتفتح الرسالة وتردّ عليه',
    'rid' => $rid,
    'reason' => $reason,
], 300);

if (fp_any_success($results)) {
    $db->prepare('UPDATE pager_requests SET status = ?, sent_at = ? WHERE rid = ?')->execute(['sent', fp_now(), $rid]);
} else {
    $db->prepare('UPDATE pager_requests SET status = ? WHERE rid = ?')->execute(['failed', $rid]);
}

$row = fp_find_request($rid);
fp_json(['ok' => true, 'reused' => false] + fp_public_request($row), 200);
