<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once FP_ROOT . '/vendor/autoload.php';

use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

function fp_active_subscriptions(): array
{
    return fp_db()->query('SELECT * FROM push_subscriptions WHERE active = 1 ORDER BY id')->fetchAll();
}

function fp_push_log(string $kind, ?string $rid, ?int $subId, bool $success, ?int $http, string $message): void
{
    fp_db()->prepare(
        'INSERT INTO push_log (created_at, kind, rid, subscription_id, success, http_status, message) VALUES (?,?,?,?,?,?,?)'
    )->execute([fp_now(), $kind, $rid, $subId, $success ? 1 : 0, $http, mb_substr($message, 0, 500)]);
    if (!$success) {
        fp_log_error("push $kind sub=$subId http=$http $message");
    }
}

/**
 * يرسل الحمولة إلى كل الاشتراكات الفعّالة عبر Web Push + VAPID.
 * يرجع نتيجة لكل اشتراك: [id, success, http, message].
 * نجاح الإرسال = قبول خدمة Push للرسالة فقط، وليس دليلاً على ظهورها على الهاتف.
 */
function fp_send_push(string $kind, ?string $rid, array $payload, int $ttl = 300): array
{
    $subs = fp_active_subscriptions();
    if (!$subs) {
        return [];
    }
    $public = fp_setting('vapid_public');
    $private = fp_setting('vapid_private');
    if (!$public || !$private) {
        fp_push_log($kind, $rid, null, false, null, 'VAPID keys are not configured');
        return [['id' => null, 'success' => false, 'http' => null, 'message' => 'vapid_not_configured']];
    }

    $webPush = new WebPush([
        'VAPID' => [
            'subject' => fp_setting('vapid_subject', 'mailto:admin@example.com'),
            'publicKey' => $public,
            'privateKey' => $private,
        ],
    ], [], 20);
    $webPush->setReuseVAPIDHeaders(true);

    $byEndpoint = [];
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    foreach ($subs as $s) {
        $byEndpoint[$s['endpoint']] = $s;
        $webPush->queueNotification(
            Subscription::create([
                'endpoint' => $s['endpoint'],
                'publicKey' => $s['p256dh'],
                'authToken' => $s['auth'],
                'contentEncoding' => 'aes128gcm',
            ]),
            $json,
            ['TTL' => $ttl, 'urgency' => 'high']
        );
    }

    $results = [];
    try {
        foreach ($webPush->flush() as $report) {
            $s = $byEndpoint[$report->getEndpoint()] ?? null;
            $id = $s ? (int) $s['id'] : null;
            $resp = $report->getResponse();
            $http = $resp ? $resp->getStatusCode() : null;
            $ok = $report->isSuccess();
            $msg = $ok ? 'accepted by push service' : $report->getReason();
            if (!$ok && $report->isSubscriptionExpired() && $id !== null) {
                fp_db()->prepare('UPDATE push_subscriptions SET active = 0, updated_at = ? WHERE id = ?')
                    ->execute([fp_now(), $id]);
                $msg = 'subscription expired (deactivated): ' . $msg;
            }
            fp_push_log($kind, $rid, $id, $ok, $http, $msg);
            $results[] = ['id' => $id, 'success' => $ok, 'http' => $http, 'message' => $msg];
        }
    } catch (Throwable $e) {
        fp_push_log($kind, $rid, null, false, null, 'exception: ' . $e->getMessage());
        $results[] = ['id' => null, 'success' => false, 'http' => null, 'message' => 'exception'];
    }
    return $results;
}

function fp_any_success(array $results): bool
{
    foreach ($results as $r) {
        if ($r['success']) {
            return true;
        }
    }
    return false;
}

function fp_names(): array
{
    return [
        'child' => fp_setting('child_name', 'عبودة'),
        'parent' => fp_setting('parent_name', 'بابا'),
    ];
}
