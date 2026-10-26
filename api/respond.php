<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/bootstrap.php';

fp_method('POST');
fp_require_parent();

$in = fp_input();
$rid = (string) ($in['rid'] ?? '');
$response = (string) ($in['response'] ?? '');
if (!fp_valid_rid($rid) || !in_array($response, ['seen', 'coming'], true)) {
    fp_fail(422, 'invalid_input');
}

$row = fp_find_request($rid);
if (!$row) {
    fp_fail(404, 'not_found');
}
// "جاي لعندك" نهائية؛ "شفت الرسالة" يمكن ترقيتها إلى "جاي لعندك"
if ($row['status'] === 'coming' || ($row['status'] === 'seen' && $response === 'seen')) {
    fp_json(['ok' => true, 'unchanged' => true] + fp_public_request($row));
}

fp_db()->prepare('UPDATE pager_requests SET status = ?, responded_at = ? WHERE rid = ?')
    ->execute([$response, fp_now(), $rid]);
fp_json(['ok' => true, 'unchanged' => false] + fp_public_request(fp_find_request($rid)));
