# slackbot

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?hide_repo_select=false&ref=master&repo=105612722&skip_quickstart=false)

[![Test][action-image]][action-url]
[![Coverage Status][codecov-image]][codecov-url]

[![Coverage Graph][codecov-graph]][codecov-url]

[action-url]: https://github.com/tsg-ut/slackbot/actions?query=workflow%3ATest
[action-image]: https://github.com/tsg-ut/slackbot/workflows/Test/badge.svg
[codecov-url]: https://codecov.io/gh/tsg-ut/slackbot
[codecov-image]: https://codecov.io/gh/tsg-ut/slackbot/branch/master/graph/badge.svg
[codecov-graph]: https://codecov.io/gh/tsg-ut/slackbot/branch/master/graphs/tree.svg?width=888&height=150

TSGのSlackで動くSlackbotたち

## 環境構築

### Prerequisites

* Node.js Latest

### セットアップ

1. 開発環境をセットアップするディレクトリに移動しcloneする。
    ```sh
    cd ほげほげ
    git clone --recursive https://github.com/tsg-ut/slackbot.git
    cd slackbot
    ```
    * [GitHub Desktop](https://desktop.github.com/) など、他の方法でcloneしても構いません。
2. [node-canvas](https://github.com/Automattic/node-canvas)の依存ライブラリをインストールする。
    * [node-canvasのインストールガイド](https://github.com/Automattic/node-canvas#compiling)に従ってください。
    * 特にWindowsを使用している場合は `C:\GTK` 配下にGTKをインストールするのを忘れないでください。
3. 依存パッケージをインストールする
    ```sh
    npm install
    ```
4. `.env` をテンプレートから作成し、編集する。
    ```sh
    cp .env.example .env
    vi .env
    ```
    * テンプレートに詳しい手順が記載されています。

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
