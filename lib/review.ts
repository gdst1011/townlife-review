import Anthropic from '@anthropic-ai/sdk';
import { WebClient } from '@slack/web-api';
import { REGULATION_PROMPT } from './regulation';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID!;

type SlackFile = {
  id: string;
  mimetype?: string;
  url_private_download?: string;
};

type SlackEvent = {
  type: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  files?: SlackFile[];
  subtype?: string;
  bot_id?: string;
};

// 対応画像MIMEタイプ
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function isSupportedImage(file: SlackFile): boolean {
  return !!file.mimetype && SUPPORTED_IMAGE_TYPES.includes(file.mimetype);
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);

  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  const mediaType = contentType.split(';')[0].trim();
  const buffer = await res.arrayBuffer();
  const data = Buffer.from(buffer).toString('base64');
  return { data, mediaType };
}

async function addReaction(channel: string, timestamp: string, reaction: string): Promise<void> {
  try {
    await slack.reactions.add({ channel, timestamp, name: reaction });
  } catch {
    // リアクション追加失敗は握り潰す（既に付いている場合など）
  }
}

async function removeReaction(channel: string, timestamp: string, reaction: string): Promise<void> {
  try {
    await slack.reactions.remove({ channel, timestamp, name: reaction });
  } catch {}
}

export async function processReview(event: SlackEvent): Promise<void> {
  // 対象チャンネル以外はスキップ
  if (event.channel !== TARGET_CHANNEL_ID) return;

  // ボット自身の投稿やサブタイプ付きメッセージはスキップ
  if (event.bot_id || event.subtype) return;

  const files = event.files?.filter(isSupportedImage) ?? [];
  if (files.length === 0) return;

  const channel = event.channel;
  const messageTs = event.ts!;
  // スレッド返信は元メッセージのtsに投稿する
  const threadTs = event.thread_ts ?? messageTs;

  // 処理中リアクション付与
  await addReaction(channel, messageTs, 'eyes');

  try {
    for (const file of files) {
      if (!file.url_private_download) {
        await slack.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: '⚠️ 画像のダウンロードURLが取得できませんでした。',
        });
        continue;
      }

      let imageData: { data: string; mediaType: string };
      try {
        imageData = await fetchImageAsBase64(file.url_private_download);
      } catch (err) {
        await slack.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: '⚠️ 画像を取得できませんでした。ファイルへのアクセス権限を確認してください。',
        });
        continue;
      }

      // Claude API呼び出し（プロンプトキャッシュ有効化）
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text: REGULATION_PROMPT,
            // @ts-expect-error cache_control is supported but not yet in SDK types
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageData.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                  data: imageData.data,
                },
              },
              {
                type: 'text',
                text: 'この広告クリエイティブ（静止画・バナー）をレギュレーションに基づいてレビューしてください。',
              },
            ],
          },
        ],
      });

      const reviewText = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('\n');

      await slack.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: reviewText,
        mrkdwn: true,
      });
    }

    // 完了リアクションに切り替え
    await removeReaction(channel, messageTs, 'eyes');
    await addReaction(channel, messageTs, 'white_check_mark');
  } catch (err) {
    console.error('[review] Error during processing:', err);
    await removeReaction(channel, messageTs, 'eyes');
    await addReaction(channel, messageTs, 'x');

    try {
      await slack.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: '❌ レビュー処理中にエラーが発生しました。しばらく待ってから再度お試しください。',
      });
    } catch (postErr) {
      console.error('[review] Failed to post error message:', postErr);
    }
  }
}
