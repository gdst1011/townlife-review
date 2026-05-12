import { waitUntil } from '@vercel/functions';
import { verifySlackSignature, isDuplicate } from '@/lib/slack';
import { processReview } from '@/lib/review';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // URL Verification（Slack Events API登録時のchallenge確認）
  if (body.type === 'url_verification') {
    return Response.json({ challenge: body.challenge });
  }

  // Slack署名検証
  const timestamp = req.headers.get('x-slack-request-timestamp');
  const signature = req.headers.get('x-slack-signature');

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // イベントコールバック以外は無視
  if (body.type !== 'event_callback') {
    return new Response('OK', { status: 200 });
  }

  const event = body.event as Record<string, unknown>;

  // message以外のイベントは無視
  if (event?.type !== 'message') {
    return new Response('OK', { status: 200 });
  }

  // 重複イベント対策（Slackのリトライ防止）
  const eventId = body.event_id as string | undefined;
  if (eventId && isDuplicate(eventId)) {
    return new Response('OK', { status: 200 });
  }

  // Vercel Hobbyプランのタイムアウト対策:
  // 即座に200を返してからバックグラウンドでレビューを実行する
  waitUntil(
    processReview(event as Parameters<typeof processReview>[0]).catch((err) => {
      console.error('[route] Unhandled error in processReview:', err);
    })
  );

  return new Response('OK', { status: 200 });
}
