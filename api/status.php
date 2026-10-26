<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/bootstrap.php';

fp_cors_for_tv();
fp_method('GET');
fp_require_either();

$rid = (string) ($_GET['rid'] ?? '');
if (!fp_valid_rid($rid)) {
    fp_fail(422, 'invalid_rid');
}
$row = fp_find_request($rid);
if (!$row) {
    fp_fail(404, 'not_found');
}
fp_json(['ok' => true] + fp_public_request($row));
