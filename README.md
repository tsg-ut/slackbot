# slackbot

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/tsg-ut/slackbot?quickstart=1)

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

* Node.js v22.19.0

MacもしくはLinuxでは[asdf](https://asdf-vm.com/)を使用してインストールすることをオススメします。

### セットアップ

1. 開発環境をセットアップするディレクトリに移動しcloneする。
    ```sh
    cd ほげほげ
    git clone --recursive https://github.com/tsg-ut/slackbot.git
    cd slackbot
    ```
    * [GitHub Desktop](https://desktop.github.com/) など、他の方法でcloneしても構いません。
2. [node-gyp](https://github.com/nodejs/node-gyp)でのビルドに必要なライブラリをインストールする。
    * [node-gypのインストールガイド](https://github.com/nodejs/node-gyp?tab=readme-ov-file#installation)に従ってください。
3. 依存パッケージをインストールする
    ```sh
    npm install
    ```
    * もし`ModuleNotFoundError: No module named 'distutils'`というエラーが出た場合、[setuptools](https://pypi.org/project/setuptools/)をインストールする。
        * Mac (Homebrew) の例: `brew install python-setuptools`
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
