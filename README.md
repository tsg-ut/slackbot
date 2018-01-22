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

