<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/bootstrap.php';

// إعدادات الأب القابلة للتعديل من التطبيق: ساعات الهدوء. (محمي برمز الأب)
fp_method('POST');
fp_require_parent();

$in = fp_input();
$valid = static fn ($v): bool => is_string($v) && preg_match('/^([01]?\d|2[0-3]):[0-5]\d$/', $v) === 1;

if (array_key_exists('quietOn', $in)) {
    fp_set_setting('quiet_on', $in['quietOn'] ? '1' : '0');
}
foreach (['quietStart' => 'quiet_start', 'quietEnd' => 'quiet_end'] as $field => $key) {
    if (array_key_exists($field, $in)) {
        if (!$valid($in[$field])) {
            fp_fail(422, 'invalid_time');
        }
        fp_set_setting($key, $in[$field]);
    }
}
if (array_key_exists('tzOffset', $in)) {
    $tz = (int) $in['tzOffset'];
    if ($tz < -840 || $tz > 840) {
        fp_fail(422, 'invalid_tz');
    }
    fp_set_setting('quiet_tz', (string) $tz);
}

fp_json(['ok' => true, 'quiet' => [
    'on' => fp_setting('quiet_on', '0') === '1',
    'start' => fp_setting('quiet_start', '22:00'),
    'end' => fp_setting('quiet_end', '07:00'),
]]);
