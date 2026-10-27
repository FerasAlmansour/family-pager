<?php
declare(strict_types=1);

// صفحة الإعداد المصغّرة. محمية بكلمة السر الموجودة في private/config.php.
require_once __DIR__ . '/../lib/push.php';

header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'");

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
session_set_cookie_params(['httponly' => true, 'samesite' => 'Strict', 'secure' => $https]);
session_start();

function h(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function random_code(int $len): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بلا أحرف متشابهة
    $out = '';
    for ($i = 0; $i < $len; $i++) {
        $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    return $out;
}

function tables_ready(): bool
{
    try {
        fp_db()->query('SELECT 1 FROM app_settings LIMIT 1');
        fp_db()->query('SELECT 1 FROM push_subscriptions LIMIT 1');
        fp_db()->query('SELECT 1 FROM pager_requests LIMIT 1');
        fp_db()->query('SELECT 1 FROM push_log LIMIT 1');
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

$configPath = getenv('FP_CONFIG') ?: FP_ROOT . '/private/config.php';
$msg = '';
$err = '';

if (!is_file($configPath)) {
    echo '<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:sans-serif;padding:2rem">'
        . '<h1>Family Pager — الإعداد</h1><p>الملف <code>private/config.php</code> غير موجود. '
        . 'انسخ <code>private/config.sample.php</code> إلى <code>private/config.php</code> وعدّل بيانات قاعدة البيانات وكلمة السر، ثم أعد تحميل الصفحة.</p>';
    exit;
}
$config = fp_config();
$setupPassword = (string) ($config['setup_password'] ?? '');
if ($setupPassword === '' || strpos($setupPassword, 'CHANGE_ME') === 0) {
    echo '<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:sans-serif;padding:2rem">'
        . '<p>غيّر <code>setup_password</code> في private/config.php أولاً.</p>';
    exit;
}

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
$loggedIn = !empty($_SESSION['auth']);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = (string) ($_POST['action'] ?? '');
    if ($action === 'login') {
        if (hash_equals($setupPassword, (string) ($_POST['password'] ?? ''))) {
            session_regenerate_id(true);
            $_SESSION['auth'] = true;
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
            header('Location: ./');
            exit;
        }
        sleep(1);
        $err = 'كلمة السر غير صحيحة';
    } elseif (!$loggedIn || !hash_equals($_SESSION['csrf'], (string) ($_POST['csrf'] ?? ''))) {
        http_response_code(403);
        exit('Forbidden');
    } else {
        try {
            switch ($action) {
                case 'logout':
                    $_SESSION = [];
                    session_destroy();
                    header('Location: ./');
                    exit;

                case 'create_tables':
                    $sql = (string) file_get_contents(FP_ROOT . '/private/schema.sql');
                    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
                        fp_db()->exec($stmt);
                    }
                    foreach (['parent_key' => 8, 'tv_token' => 24] as $k => $len) {
                        if (!fp_setting($k)) {
                            fp_set_setting($k, random_code($len));
                        }
                    }
                    foreach (['child_name' => 'مسعف', 'parent_name' => 'بابا', 'call_cooldown_seconds' => '20'] as $k => $v) {
                        if (fp_setting($k) === null) {
                            fp_set_setting($k, $v);
                        }
                    }
                    $msg = 'تم إنشاء الجداول والقيم الافتراضية.';
                    break;

                case 'gen_vapid':
                    if (fp_setting('vapid_public') && empty($_POST['confirm_vapid'])) {
                        throw new RuntimeException('أكّد إلغاء الاشتراكات الحالية أولاً.');
                    }
                    $keys = \Minishlink\WebPush\VAPID::createVapidKeys();
                    fp_set_setting('vapid_public', $keys['publicKey']);
                    fp_set_setting('vapid_private', $keys['privateKey']);
                    fp_db()->exec('UPDATE push_subscriptions SET active = 0'); // الاشتراكات القديمة لا تعمل بمفاتيح جديدة
                    $msg = 'تم توليد مفاتيح VAPID. يجب على الأب إعادة تفعيل الإشعارات.';
                    break;

                case 'save_vapid':
                    $pub = trim((string) ($_POST['vapid_public'] ?? ''));
                    $priv = trim((string) ($_POST['vapid_private'] ?? ''));
                    if (!preg_match('/^[A-Za-z0-9_-]{80,100}$/', $pub) || !preg_match('/^[A-Za-z0-9_-]{40,50}$/', $priv)) {
                        throw new RuntimeException('صيغة المفاتيح غير صحيحة (Base64URL).');
                    }
                    fp_set_setting('vapid_public', $pub);
                    fp_set_setting('vapid_private', $priv);
                    fp_db()->exec('UPDATE push_subscriptions SET active = 0');
                    $msg = 'تم حفظ المفاتيح.';
                    break;

                case 'save_settings':
                    $child = trim((string) ($_POST['child_name'] ?? ''));
                    $parent = trim((string) ($_POST['parent_name'] ?? ''));
                    $subject = trim((string) ($_POST['vapid_subject'] ?? ''));
                    $cool = (int) ($_POST['cooldown'] ?? 20);
                    if ($child === '' || mb_strlen($child) > 40 || $parent === '' || mb_strlen($parent) > 40) {
                        throw new RuntimeException('الاسم مطلوب (حتى 40 حرفاً).');
                    }
                    if (!preg_match('~^(mailto:[^\s@]+@[^\s@]+|https://\S+)$~', $subject)) {
                        throw new RuntimeException('VAPID subject يجب أن يكون mailto:you@example.com أو رابط https.');
                    }
                    $parentKey = trim((string) ($_POST['parent_key'] ?? ''));
                    $tvToken = trim((string) ($_POST['tv_token'] ?? ''));
                    if (!preg_match('/^[A-Za-z0-9]{6,64}$/', $parentKey) || !preg_match('/^[A-Za-z0-9]{16,64}$/', $tvToken)) {
                        throw new RuntimeException('رمز الأب 6+ أحرف/أرقام، ورمز التلفزيون 16+ حرفاً/رقماً.');
                    }
                    fp_set_setting('child_name', $child);
                    fp_set_setting('parent_name', $parent);
                    fp_set_setting('vapid_subject', $subject);
                    fp_set_setting('call_cooldown_seconds', (string) max(5, min(600, $cool)));
                    fp_set_setting('parent_key', $parentKey);
                    fp_set_setting('tv_token', $tvToken);
                    $msg = 'تم حفظ الإعدادات.';
                    break;

                case 'random_tv_token':
                    fp_set_setting('tv_token', random_code(24));
                    $msg = 'تم توليد رمز تلفزيون جديد. حدّث رابط التلفزيون.';
                    break;

                case 'test_push':
                    $results = fp_send_push('test', null, [
                        'title' => 'تجربة Family Pager ✅',
                        'body' => 'إشعار تجريبي من صفحة الإعداد.',
                        'rid' => null,
                        'test' => true,
                    ], 120);
                    $msg = $results
                        ? 'نتيجة الإرسال: ' . count(array_filter($results, fn ($r) => $r['success'])) . ' من ' . count($results) . ' قبلتها خدمة Push (انظر السجل).'
                        : 'لا توجد اشتراكات فعّالة.';
                    break;
            }
        } catch (Throwable $e) {
            fp_log_error('setup: ' . $e->getMessage());
            $err = $action === 'create_tables' || $action === 'gen_vapid' ? 'خطأ: ' . $e->getMessage() : $e->getMessage();
        }
    }
    $loggedIn = !empty($_SESSION['auth']);
}

$base = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost')
    . rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/');
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Family Pager — الإعداد</title>
<style>
body{font-family:system-ui,Tahoma,sans-serif;background:#f4f1fb;color:#26214a;margin:0;padding:16px}
main{max-width:760px;margin:0 auto}
section{background:#fff;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 10px #0001}
h1{margin:.2em 0}h2{margin:.1em 0 .6em;font-size:1.15em}
label{display:block;margin:.6em 0 .2em;font-weight:600}
input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c9c3e6;border-radius:10px;font-size:1em}
button{background:#7b5cf0;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:1em;cursor:pointer;margin:.4em .2em 0 0}
button.alt{background:#e8e3fb;color:#3a2d8f}
.ok{color:#0a7d3b}.bad{color:#b3261e}.msg{padding:10px;border-radius:10px;background:#e6f6ec}.err{padding:10px;border-radius:10px;background:#fdeaea}
code,.mono{direction:ltr;unicode-bidi:embed;font-family:ui-monospace,Consolas,monospace;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:.85em}td,th{border-bottom:1px solid #eee;padding:6px;text-align:start}
</style>
</head>
<body><main>
<h1>⚙️ Family Pager — الإعداد</h1>
<?php if ($msg): ?><p class="msg"><?= h($msg) ?></p><?php endif; ?>
<?php if ($err): ?><p class="err"><?= h($err) ?></p><?php endif; ?>

<?php if (!$loggedIn): ?>
<section>
  <h2>تسجيل الدخول</h2>
  <form method="post">
    <input type="hidden" name="action" value="login">
    <label for="password">كلمة سر الإعداد</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <button>دخول</button>
  </form>
</section>
<?php else:
    $csrf = h($_SESSION['csrf']);
    $ready = tables_ready();
    $exts = ['openssl', 'curl', 'mbstring', 'pdo_mysql'];
    ?>
<section>
  <h2>1) فحص الخادم</h2>
  <p>PHP <?= h(PHP_VERSION) ?> — <?= PHP_VERSION_ID >= 80100 ? '<span class="ok">✔</span>' : '<span class="bad">✘ يحتاج 8.1+</span>' ?></p>
  <p>HTTPS — <?= $https ? '<span class="ok">✔</span>' : '<span class="bad">✘ Web Push وPWA يحتاجان HTTPS</span>' ?></p>
  <p><?php foreach ($exts as $e) { echo h($e) . ' ' . (extension_loaded($e) ? '<span class="ok">✔</span>' : '<span class="bad">✘</span>') . ' &nbsp; '; } ?>
     gmp/bcmath <?= (extension_loaded('gmp') || extension_loaded('bcmath')) ? '<span class="ok">✔</span>' : '<span class="bad">(اختياري)</span>' ?></p>
  <p>قاعدة البيانات / الجداول — <?= $ready ? '<span class="ok">✔ جاهزة</span>' : '<span class="bad">✘ غير منشأة بعد</span>' ?></p>
  <form method="post"><input type="hidden" name="csrf" value="<?= $csrf ?>"><input type="hidden" name="action" value="create_tables">
    <button><?= $ready ? 'إعادة فحص/إكمال الجداول' : 'إنشاء الجداول' ?></button></form>
</section>

<?php if ($ready):
    $vapidPub = fp_setting('vapid_public', '');
    $names = fp_names();
    $subs = fp_db()->query('SELECT id, user_agent, active, created_at, updated_at FROM push_subscriptions ORDER BY id DESC LIMIT 10')->fetchAll();
    $logs = fp_db()->query('SELECT * FROM push_log ORDER BY id DESC LIMIT 20')->fetchAll();
    $reqs = fp_db()->query('SELECT rid, status, created_at, responded_at FROM pager_requests ORDER BY id DESC LIMIT 5')->fetchAll();
    ?>
<section>
  <h2>2) مفاتيح VAPID</h2>
  <?php if ($vapidPub): ?>
    <p class="ok">✔ موجودة. المفتاح العام:</p><p class="mono"><?= h($vapidPub) ?></p>
    <p>المفتاح الخاص محفوظ في قاعدة البيانات فقط ولا يُعرض.</p>
  <?php else: ?><p class="bad">✘ غير موجودة</p><?php endif; ?>
  <form method="post">
    <input type="hidden" name="csrf" value="<?= $csrf ?>"><input type="hidden" name="action" value="gen_vapid">
    <?php if ($vapidPub): ?><label><input type="checkbox" name="confirm_vapid" value="1" required> أؤكد: ستُلغى كل اشتراكات الهواتف الحالية</label><?php endif; ?>
    <button><?= $vapidPub ? 'توليد مفاتيح جديدة' : 'توليد مفاتيح VAPID' ?></button></form>
  <details><summary>إدخال مفاتيح موجودة</summary>
  <form method="post"><input type="hidden" name="csrf" value="<?= $csrf ?>"><input type="hidden" name="action" value="save_vapid">
    <label>Public key</label><input type="text" name="vapid_public" autocomplete="off">
    <label>Private key</label><input type="password" name="vapid_private" autocomplete="off">
    <button class="alt">حفظ</button></form></details>
</section>

<section>
  <h2>3) الأسماء والرموز</h2>
  <form method="post"><input type="hidden" name="csrf" value="<?= $csrf ?>"><input type="hidden" name="action" value="save_settings">
    <label>اسم الطفل</label><input type="text" name="child_name" value="<?= h($names['child']) ?>">
    <label>اسم الأب (كما يظهر على التلفزيون)</label><input type="text" name="parent_name" value="<?= h($names['parent']) ?>">
    <label>VAPID subject (mailto: أو https)</label>
    <input type="text" name="vapid_subject" dir="ltr" value="<?= h(fp_setting('vapid_subject', 'mailto:you@' . preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? 'example.com'))) ?>">
    <label>رمز الأب (يُدخل مرة واحدة في تطبيق الآيفون)</label>
    <input type="text" name="parent_key" dir="ltr" value="<?= h(fp_setting('parent_key', '')) ?>" autocomplete="off">
    <label>رمز اتصال التلفزيون</label>
    <input type="text" name="tv_token" dir="ltr" value="<?= h(fp_setting('tv_token', '')) ?>" autocomplete="off">
    <label>أقل فترة بين نداءين (ثوانٍ)</label>
    <input type="text" name="cooldown" dir="ltr" value="<?= h(fp_setting('call_cooldown_seconds', '20')) ?>">
    <button>حفظ</button>
  </form>
  <form method="post"><input type="hidden" name="csrf" value="<?= $csrf ?>"><input type="hidden" name="action" value="random_tv_token"><button class="alt">توليد رمز تلفزيون عشوائي جديد</button></form>
</section>

<section>
  <h2>4) الروابط</h2>
  <p>تطبيق الأب (آيفون): <code><?= h($base) ?>/</code></p>
  <p>صفحة التلفزيون (افتحها مرة واحدة بهذا الرابط، ثم يُحفظ الرمز ويُزال من الشريط):</p>
  <p class="mono"><?= h($base) ?>/tv/?t=<?= h(fp_setting('tv_token', '')) ?></p>
</section>

<section>
  <h2>5) اشتراك الآيفون والاختبار</h2>
  <?php if (!$subs): ?><p class="bad">لا توجد اشتراكات. افتح تطبيق الأب على الآيفون وفعّل الإشعارات.</p>
  <?php else: ?>
  <table><tr><th>#</th><th>الجهاز</th><th>فعّال</th><th>آخر تحديث (UTC)</th></tr>
  <?php foreach ($subs as $s): ?><tr><td><?= (int) $s['id'] ?></td><td dir="ltr"><?= h(mb_substr((string) $s['user_agent'], 0, 60)) ?></td><td><?= $s['active'] ? '✔' : '✘' ?></td><td><?= h($s['updated_at']) ?></td></tr><?php endforeach; ?></table>
  <?php endif; ?>
  <form method="post"><input type="hidden" name="csrf" value="<?= $csrf ?>"><input type="hidden" name="action" value="test_push"><button>إرسال إشعار اختبار</button></form>
</section>

<section>
  <h2>6) آخر الطلبات ونتائج الإرسال</h2>
  <table><tr><th>طلب</th><th>الحالة</th><th>أُنشئ (UTC)</th><th>ردّ (UTC)</th></tr>
  <?php foreach ($reqs as $r): ?><tr><td class="mono"><?= h($r['rid']) ?></td><td><?= h($r['status']) ?></td><td><?= h($r['created_at']) ?></td><td><?= h($r['responded_at']) ?></td></tr><?php endforeach; ?></table>
  <br>
  <table><tr><th>الوقت</th><th>النوع</th><th>اشتراك</th><th>نجاح</th><th>HTTP</th><th>رسالة</th></tr>
  <?php foreach ($logs as $l): ?><tr><td><?= h($l['created_at']) ?></td><td><?= h($l['kind']) ?></td><td><?= h((string) $l['subscription_id']) ?></td><td><?= $l['success'] ? '✔' : '✘' ?></td><td><?= h((string) $l['http_status']) ?></td><td dir="ltr"><?= h($l['message']) ?></td></tr><?php endforeach; ?></table>
  <p><small>"نجاح" = قبلت خدمة Push الرسالة. هذا لا يثبت ظهورها على الهاتف.</small></p>
</section>
<?php endif; ?>

<form method="post"><input type="hidden" name="csrf" value="<?= $csrf ?>"><input type="hidden" name="action" value="logout"><button class="alt">خروج</button></form>
<?php endif; ?>
</main></body></html>
