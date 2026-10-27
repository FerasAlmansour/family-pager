<?php
declare(strict_types=1);

define('FP_ROOT', dirname(__DIR__));
date_default_timezone_set('UTC');
mb_internal_encoding('UTF-8');

const FP_REQUEST_TTL = 900; // بعد 15 دقيقة بلا رد يُعتبر الطلب منتهياً

function fp_config(): array
{
    static $config = null;
    if ($config === null) {
        $path = getenv('FP_CONFIG') ?: FP_ROOT . '/private/config.php';
        if (!is_file($path)) {
            fp_fail(503, 'not_configured', 'private/config.php is missing');
        }
        $config = require $path;
    }
    return $config;
}

function fp_db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $db = fp_config()['db'];
        if (($db['driver'] ?? 'mysql') === 'sqlite') { // للاختبارات المحلية فقط
            $pdo = new PDO('sqlite:' . $db['path']);
        } else {
            $dsn = 'mysql:host=' . $db['host'] . ';dbname=' . $db['name'] . ';charset=utf8mb4';
            $pdo = new PDO($dsn, $db['user'], $db['pass']);
        }
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
        fp_migrate($pdo);
    }
    return $pdo;
}

/** يضيف أعمدة الميزات الجديدة تلقائياً للقواعد القديمة (يتخطى الموجود). */
function fp_migrate(PDO $pdo): void
{
    try {
        $pdo->query('SELECT reason, reply_text FROM pager_requests LIMIT 0');
        return;
    } catch (Throwable $e) {
        // عمود ناقص: نضيف كلاً على حدة
    }
    foreach (['reason VARCHAR(16) NULL', 'reply_text VARCHAR(160) NULL'] as $col) {
        try {
            $pdo->exec('ALTER TABLE pager_requests ADD COLUMN ' . $col);
        } catch (Throwable $e) {
            // موجود مسبقاً أو الجدول غير منشأ بعد
        }
    }
}

const FP_REASONS = ['call', 'hungry', 'help', 'play', 'night'];
const FP_REPLIES = ['seen', 'coming', 'five', 'later', 'hug', 'text'];

/** هل نحن الآن ضمن ساعات الهدوء التي ضبطها الأب؟ */
function fp_quiet_now(): bool
{
    if (fp_setting('quiet_on', '0') !== '1') {
        return false;
    }
    $parse = static function (string $hm): int {
        return preg_match('/^(\d{1,2}):(\d{2})$/', $hm, $m) ? ((int) $m[1] * 60 + (int) $m[2]) : 0;
    };
    $start = $parse((string) fp_setting('quiet_start', '22:00'));
    $end = $parse((string) fp_setting('quiet_end', '07:00'));
    $tz = (int) fp_setting('quiet_tz', '0');
    $now = (((int) floor(time() / 60) + $tz) % 1440 + 1440) % 1440;
    if ($start === $end) {
        return false;
    }
    return $start < $end ? ($now >= $start && $now < $end) : ($now >= $start || $now < $end);
}

function fp_now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function fp_ts(?string $dt): ?int
{
    return $dt === null ? null : (int) strtotime($dt . ' UTC');
}

// ---------- app_settings ----------

function fp_setting(string $key, ?string $default = null): ?string
{
    $st = fp_db()->prepare('SELECT v FROM app_settings WHERE k = ?');
    $st->execute([$key]);
    $row = $st->fetch();
    return $row === false || $row['v'] === null ? $default : $row['v'];
}

function fp_set_setting(string $key, string $value): void
{
    $st = fp_db()->prepare('SELECT 1 FROM app_settings WHERE k = ?');
    $st->execute([$key]);
    if ($st->fetchColumn() === false) {
        fp_db()->prepare('INSERT INTO app_settings (k, v) VALUES (?, ?)')->execute([$key, $value]);
    } else {
        fp_db()->prepare('UPDATE app_settings SET v = ? WHERE k = ?')->execute([$value, $key]);
    }
}

// ---------- HTTP helpers ----------

function fp_json(array $data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fp_fail(int $code, string $error, string $message = ''): never
{
    fp_json(['ok' => false, 'error' => $error, 'message' => $message], $code);
}

function fp_method(string ...$allowed): void
{
    if (!in_array($_SERVER['REQUEST_METHOD'], $allowed, true)) {
        fp_fail(405, 'method_not_allowed');
    }
}

function fp_input(): array
{
    $raw = file_get_contents('php://input', false, null, 0, 65536);
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        fp_fail(400, 'bad_json');
    }
    return $data;
}

/** CORS مطلوب فقط لنسخة Tizen (ملفات محلية تستدعي الخادم). الحماية الفعلية هي رمز التلفزيون. */
function fp_cors_for_tv(): void
{
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type, X-TV-Token');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Max-Age: 600');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

// ---------- auth ----------

function fp_header(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return isset($_SERVER[$key]) ? trim((string) $_SERVER[$key]) : '';
}

function fp_check_secret(string $header, string $setting): bool
{
    $given = fp_header($header);
    $expected = fp_setting($setting, '');
    return $given !== '' && $expected !== '' && hash_equals($expected, $given);
}

function fp_deny(): never
{
    usleep(400000); // يبطّئ التخمين
    fp_fail(401, 'unauthorized');
}

function fp_require_parent(): void
{
    if (!fp_check_secret('X-Parent-Key', 'parent_key')) {
        fp_deny();
    }
}

function fp_require_tv(): void
{
    if (!fp_check_secret('X-TV-Token', 'tv_token')) {
        fp_deny();
    }
}

function fp_require_either(): void
{
    if (!fp_check_secret('X-Parent-Key', 'parent_key') && !fp_check_secret('X-TV-Token', 'tv_token')) {
        fp_deny();
    }
}

// ---------- requests ----------

function fp_valid_rid(string $rid): bool
{
    return (bool) preg_match('/^[0-9a-f]{16}$/', $rid);
}

function fp_public_request(array $row): array
{
    $status = $row['status'];
    if (in_array($status, ['created', 'sent'], true) && time() - (int) fp_ts($row['created_at']) > FP_REQUEST_TTL) {
        $status = 'expired';
    }
    return [
        'rid' => $row['rid'],
        'status' => $status,
        'created_at' => $row['created_at'],
        'responded_at' => $row['responded_at'],
        'reason' => $row['reason'] ?? null,
        'reply_text' => $row['reply_text'] ?? null,
    ];
}

function fp_find_request(string $rid): ?array
{
    $st = fp_db()->prepare('SELECT * FROM pager_requests WHERE rid = ?');
    $st->execute([$rid]);
    $row = $st->fetch();
    return $row === false ? null : $row;
}

function fp_log_error(string $message): void
{
    error_log('[family-pager] ' . $message);
}
