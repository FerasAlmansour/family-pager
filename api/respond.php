<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/bootstrap.php';

fp_method('POST');
fp_require_parent();

$in = fp_input();
$rid = (string) ($in['rid'] ?? '');
$response = (string) ($in['response'] ?? '');
if (!fp_valid_rid($rid) || !in_array($response, ['seen', 'coming', 'five', 'later', 'hug'], true)) {
    fp_fail(422, 'invalid_input');
}

$text = trim(preg_replace('/\s+/u', ' ', (string) ($in['text'] ?? '')) ?? '');
$text = mb_substr($text, 0, 120);
if ($response === 'text' && $text === '') {
    fp_fail(422, 'empty_text');
}

$row = fp_find_request($rid);
if (!$row) {
    fp_fail(404, 'not_found');
}
// "جاي لعندك" نهائية؛ غيرها يمكن استبداله بردّ آخر، وتكرار الردّ نفسه لا يغيّر شيئاً
if ($row['status'] === 'coming' || ($row['status'] === $response && $response !== 'text')) {
    fp_json(['ok' => true, 'unchanged' => true] + fp_public_request($row));
}

fp_db()->prepare('UPDATE pager_requests SET status = ?, responded_at = ?, reply_text = ? WHERE rid = ?')
    ->execute([$response, fp_now(), $text !== '' ? $text : null, $rid]);
fp_json(['ok' => true, 'unchanged' => false] + fp_public_request(fp_find_request($rid)));
