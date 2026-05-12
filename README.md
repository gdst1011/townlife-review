# タウンライフすまいみっけ 広告レビュー Slack Bot

Slackチャンネルに投稿された広告画像を Claude Sonnet 4.6 (Vision) で自動レビューするBot。

## アーキテクチャ

```
Slack → POST /api/slack
  ├─ 署名検証 (HMAC-SHA256 + タイムスタンプ)
  ├─ 即座に 200 OK 返却 (Vercel Hobbyプランのタイムアウト対策)
  └─ waitUntil() でバックグラウンド処理:
       ├─ 👀 リアクション付与
       ├─ Slack File API で画像取得 → Base64化
       ├─ Claude API にレギュレーション + 画像を送信 (プロンプトキャッシュ有効)
       ├─ 結果をスレッドに返信
       └─ ✅ または ❌ リアクションに切り替え
```

## セットアップ

### 1. Slack App を作成

https://api.slack.com/apps → Create New App → From scratch

**Bot Token Scopes** (OAuth & Permissions):
- `chat:write`
- `reactions:write`
- `files:read`

**Event Subscriptions**:
- Request URL: `https://<your-vercel-url>/api/slack`
- Subscribe to bot events: `message.channels`

### 2. 環境変数

`.env.local.example` をコピーして `.env.local` を作成:

```bash
cp .env.local.example .env.local
```

| 変数名 | 取得元 |
|---|---|
| `SLACK_BOT_TOKEN` | Slack App → OAuth & Permissions → Bot User OAuth Token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack App → Basic Information → Signing Secret |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| `TARGET_CHANNEL_ID` | Slackチャンネルの詳細 → チャンネルID (`C...`) |

### 3. Vercel デプロイ

```bash
vercel deploy
```

または Vercel Dashboard から GitHub リポジトリをインポート。

### 4. BotをSlackチャンネルに招待

```
/invite @<bot-name>
```

## 出力フォーマット例

```
⭕ 総合判定: 承認

---

⚠️ 総合判定: 条件付き承認（要修正）

❌ NG項目
• 該当ルール: 項目1 - 住宅ローンの月々の返済金額
• 理由: 「5万円台」は注文住宅の最低金額「6万円台」を下回っています
• 修正案: 「6万円台」以上に変更してください

⚠️ 要修正項目
• 「※建物代のみ」の注釈が必要です

✅ 修正後チェックリスト
• [ ] 月額表示を「6万円台」以上に修正
• [ ] 「※建物代のみ」注釈を追加
```
