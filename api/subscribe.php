<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/bootstrap.php';

fp_method('POST');
fp_require_parent();

$in = fp_input();
$sub = $in['subscription'] ?? null;
$endpoint = is_array($sub) ? ($sub['endpoint'] ?? '') : '';
$p256dh = is_array($sub) ? ($sub['keys']['p256dh'] ?? '') : '';
$auth = is_array($sub) ? ($sub['keys']['auth'] ?? '') : '';

if (!is_string($endpoint) || !is_string($p256dh) || !is_string($auth)
    || $endpoint === '' || strlen($endpoint) > 2000
    || !preg_match('/^[A-Za-z0-9_-]{60,120}$/', $p256dh)
    || !preg_match('/^[A-Za-z0-9_-]{16,40}$/', $auth)) {
    fp_fail(422, 'invalid_subscription');
}

$parts = parse_url($endpoint);
$host = strtolower($parts['host'] ?? '');
$allowInsecure = !empty(fp_config()['allow_insecure_endpoints']); // للاختبارات المحلية فقط
if ($host === '' || (!$allowInsecure && (($parts['scheme'] ?? '') !== 'https' || filter_var($host, FILTER_VALIDATE_IP) || $host === 'localhost'))) {
    fp_fail(422, 'invalid_endpoint');
}

$hash = hash('sha256', $endpoint);
$ua = mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
$now = fp_now();
$db = fp_db();

$st = $db->prepare('SELECT id FROM push_subscriptions WHERE endpoint_hash = ?');
$st->execute([$hash]);
$id = $st->fetchColumn();
if ($id === false) {
    $db->prepare('INSERT INTO push_subscriptions (endpoint_hash, endpoint, p256dh, auth, user_agent, active, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)')
        ->execute([$hash, $endpoint, $p256dh, $auth, $ua, $now, $now]);
} else {
    $db->prepare('UPDATE push_subscriptions SET p256dh = ?, auth = ?, user_agent = ?, active = 1, updated_at = ? WHERE id = ?')
        ->execute([$p256dh, $auth, $ua, $now, $id]);
}

fp_json(['ok' => true, 'created' => $id === false]);
