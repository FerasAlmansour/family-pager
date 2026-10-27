<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/bootstrap.php';

// حالة التطبيق للأب: الأسماء، المفتاح العام VAPID، آخر طلب. (محمي برمز الأب)
fp_method('GET');
fp_require_parent();

$db = fp_db();
$names = [
    'child' => fp_setting('child_name', 'عبودة'),
    'parent' => fp_setting('parent_name', 'بابا'),
];

$latest = null;
$rid = (string) ($_GET['rid'] ?? '');
if ($rid !== '') {
    if (!fp_valid_rid($rid)) {
        fp_fail(422, 'invalid_rid');
    }
    $row = fp_find_request($rid);
    $latest = $row ? fp_public_request($row) : null;
} else {
    $row = $db->query('SELECT * FROM pager_requests ORDER BY id DESC LIMIT 1')->fetch();
    $latest = $row ? fp_public_request($row) : null;
}

// إحصاءات آخر 7 أيام
$st = $db->prepare('SELECT created_at, responded_at FROM pager_requests WHERE created_at > ? AND status <> ?');
$st->execute([gmdate('Y-m-d H:i:s', time() - 7 * 86400), 'quiet']);
$total = 0;
$answered = 0;
$sum = 0;
foreach ($st->fetchAll() as $r) {
    $total++;
    if ($r['responded_at'] !== null) {
        $answered++;
        $sum += max(0, (int) fp_ts($r['responded_at']) - (int) fp_ts($r['created_at']));
    }
}

fp_json([
    'ok' => true,
    'stats' => ['total' => $total, 'answered' => $answered, 'avgSeconds' => $answered ? (int) round($sum / $answered) : null],
    'quiet' => [
        'on' => fp_setting('quiet_on', '0') === '1',
        'start' => fp_setting('quiet_start', '22:00'),
        'end' => fp_setting('quiet_end', '07:00'),
    ],
    'names' => $names,
    'vapidPublicKey' => fp_setting('vapid_public', ''),
    'activeSubscriptions' => (int) $db->query('SELECT COUNT(*) FROM push_subscriptions WHERE active = 1')->fetchColumn(),
    'latest' => $latest,
]);
