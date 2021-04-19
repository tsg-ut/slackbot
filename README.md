# slackbot

[![Test][action-image]][action-url]
[![Coverage Status][codecov-image]][codecov-url]

[![Coverage Graph][codecov-graph]][codecov-url]

[action-url]: https://github.com/tsg-ut/slackbot/actions?query=workflow%3ATest
[action-image]: https://github.com/tsg-ut/slackbot/workflows/Test/badge.svg
[codecov-url]: https://codecov.io/gh/tsg-ut/slackbot
[codecov-image]: https://codecov.io/gh/tsg-ut/slackbot/branch/master/graph/badge.svg
[codecov-graph]: https://codecov.io/gh/tsg-ut/slackbot/branch/master/graphs/tree.svg?width=888&height=150

TSGのSlackで動くSlackbotたち

自分がOWNERのコードの変更は直接masterにpushして構いません。 ([CODEOWNERS](CODEOWNERS)参照)

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

## 実行

```sh
npm run dev
```

### 必要なBOTのみ実行する

```sh
npm run dev -- --only [bot id]
```

## テスト実行

```sh
npm test
```

### 必要なテストのみ実行する

```sh
npm test -- [regex pattern]
```

## デプロイ

自動デプロイです。[deploy](deploy)参照。

# Licenses

このリポジトリでは以下のライブラリを使用しています。

* Shogi Resource by muchonovski licensed under Creative Commons 表示-非営利 2.1 日本 License.
* Hayaoshi SE by OtoLogic licensed under Creative Commons 表示 4.0 国際 License.
