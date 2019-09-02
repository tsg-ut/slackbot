# better custom response
Slackのカスタムレスポンスをよりいい感じにしたもの

- レスポンスの合計文字数4000文字の制限がない
- 乱数の合計を出したりちょっと複雑な処理が書ける

感じの利点があります

## 使い方

`custom-responses.ts`の`customResponses`にカスタムレスポンスを追加します。
例は

```TypeScript
    {
        input: [/^あほくさ$/],
        outputArray: [":ahokusa-top-left::ahokusa-top-center::ahokusa-top-right:\n:ahokusa-bottom-left::ahokusa-bottom-center::ahokusa-bottom-right:"],
        username: 'あほくさresponse',
        icon_emoji: ':atama:',
    },
```

こんな感じです

- `input`
- `outputArray`と`outputFunction`のどちらか片方

が必要で、

-`shuffle`, `username`, `icon_emoji`

があってもいいです

### input
発火条件を正規表現で書きます。正規表現がわからない場合は `/^[何か]$/` のように書くとだいたい幸せになれます。（完全一致）

本家カスタムレスポンスの発火条件（区切り文字で区切られた内部っぽい？）は謎だったので適当に正規表現でやっていくことになりました。

正規表現を複数入れることができます。 一つだけのときも配列として入れてください。

### output
`outputArray`と`outputFunction`のうちどちらか片方だけを書いてください。 なかったり2つあったりするとだめです。
#### outputArray
レスポンスを文字列の配列として書きます。
レスポンスはデフォルトでは配列の中からランダムに、`shuffle`を`true`にすると配列をランダムな順番に並べて結合したものを返します。

#### outputFunction
正規表現にマッチした文字列とマッチ部分の入った配列を受け取り、レスポンスの文字列を返す関数として書きます。
まあなんかやると書けるのでこれ以上説明しません

### username
レスポンスを返すときのユーザーネームをstringで書きます。何も入れないと`better-custom-response`になります。

### icon_emoji
レスポンスを返す時のアイコンとなる絵文字をstringで書きます。両側をコロン(`:`)で囲んでください。何も入れないと`:slack:`になります。


みなさんのSlack生活の潤いになると:waiwai:です。
