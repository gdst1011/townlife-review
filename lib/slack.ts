import crypto from 'crypto';

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;

// 5分以上古いリクエストはリプレイ攻撃と見なして拒否
const MAX_REQUEST_AGE_SECONDS = 60 * 5;

export function verifySlackSignature(
  body: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  if (!timestamp || !signature) return false;

  const requestAge = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (requestAge > MAX_REQUEST_AGE_SECONDS) return false;

  const sigBase = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', SLACK_SIGNING_SECRET);
  const digest = `v0=${hmac.update(sigBase).digest('hex')}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch {
    return false;
  }
}

// Slackはタイムアウト時にリトライしてくる。重複処理を防ぐためイベントIDを記録
// サーバーレス環境ではメモリが揮発するため完全な重複排除ではないが十分な対策
const processedEvents = new Set<string>();

export function isDuplicate(eventId: string): boolean {
  if (processedEvents.has(eventId)) return true;
  processedEvents.add(eventId);
  // メモリリーク防止: 1000件超えたら古いものから削除
  if (processedEvents.size > 1000) {
    const first = processedEvents.values().next().value;
    if (first) processedEvents.delete(first);
  }
  return false;
}
