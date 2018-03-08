# slackbot

TSGのSlackで動くSlackbotたち

自分がOWNERのコードの変更は直接masterにpushして構いません。 ([CODEOWNERS](CODEOWNERS)参照)

push後は必ずデプロイをお願いします。

## 環境構築

### Prerequisites

* Node.js Latest

### セットアップ

```sh
cd /path/to/slackbot
npm install
cp .env.example .env
# .envをいい感じに編集する
```

`SLACK_TOKEN`はSlackの [Legacy tokens](https://api.slack.com/custom-integrations/legacy-tokens) を使用し、`CHANNEL_XXX`系は全部自分宛のDMを指定するのがオススメ。

`IMAGEBIN_KEY`はshogiを開発する時以外は必要ない。必要な場合は https://imagebin.ca/tools.php からAPIキーを取得。

#### shogiのセットアップ

[nine-grids-shogi-analyzer](https://github.com/hakatashi/nine-grids-shogi-analyzer)を実行したら生成される`test.sqlite3`を`slackbot/shogi/boards/test.sqlite3`に配置する。

### 実行

```sh
npm run dev
```

## デプロイ

1. TSG鯖にSSHで入る
2. `$ sudo -u slackbot bash`
3. `$ cd ~/slackbot`
4. `$ git pull`
5. `$ touch .restart-trigger`

# Licenses

このリポジトリでは以下のライブラリを使用しています。

* Shogi Resource by muchonovski is licensed under a Creative Commons 表示-非営利 2.1 日本 License.
