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

fp_json([
    'ok' => true,
    'names' => $names,
    'vapidPublicKey' => fp_setting('vapid_public', ''),
    'activeSubscriptions' => (int) $db->query('SELECT COUNT(*) FROM push_subscriptions WHERE active = 1')->fetchColumn(),
    'latest' => $latest,
]);
