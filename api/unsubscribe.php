<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/bootstrap.php';

fp_method('POST');
fp_require_parent();

$endpoint = fp_input()['endpoint'] ?? '';
if (!is_string($endpoint) || $endpoint === '') {
    fp_fail(422, 'invalid_endpoint');
}

fp_db()->prepare('UPDATE push_subscriptions SET active = 0, updated_at = ? WHERE endpoint_hash = ?')
    ->execute([fp_now(), hash('sha256', $endpoint)]);

fp_json(['ok' => true]);
