# slackbot

TSGのSlackで動くSlackbotたち

自分がOWNERのコードの変更は直接masterにpushして構いません。 ([CODEOWNERS](CODEOWNERS)参照)

push後は必ずデプロイをお願いします。

## デプロイ

1. TSG鯖にSSHで入る
2. `$ sudo -u slackbot bash`
3. `$ cd ~/slackbot`
4. `$ git pull`
5. `$ touch .restart-trigger`

# Licenses

このリポジトリでは以下のライブラリを使用しています。

* Shogi Resource by muchonovski is licensed under a Creative Commons 表示-非営利 2.1 日本 License.
