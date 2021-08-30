# golfbot

## 機能

現在、AtCoder と Anarchy Golf が使えます。

- ユーザ登録
- コンテストの開催
  - 形式、問題、言語、コンテスト時間を選んで投稿
  - 開始時に通知
  - ユーザが短縮したときに通知
  - 終了時に参加者のコードを通知

## 導入

- 環境変数 `CHANNEL_SIG_CODEGOLF` を設定する
- Slack API の **Slash Commands** で `/golfbot` を登録する
- Slack API の **Beta Features** で **Time picker element** をオンにする
