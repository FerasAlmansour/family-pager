<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/push.php';

// أسماء العرض للتلفزيون. (محمي برمز التلفزيون)
fp_cors_for_tv();
fp_method('GET');
fp_require_tv();

fp_json(['ok' => true, 'names' => fp_names()]);
