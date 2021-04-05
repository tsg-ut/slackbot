# pwnyaa - Pwnable Devotion Bot

## About
Praise you pwning everyday.  
  
### 新しいCTFへの対応について
新しいCTFに対応する場合には、以下の手順に従ってください。尚、以下に出現する`XXX`は全て対応するCTFの省略名(全て大文字)とします(例: `pwnable.xyz`ならば`XYZ`)。
- `lib/`配下に`XXXManager.ts`を作る。
- 作成したライブラリ内で、以下の3つの関数をexportする。
  - `fetchChallsXXX()`: 該当CTFの全問題を`Challs[]`型で返す。現在のところ問題数以外が使われることはない。
  - `fetchUserProfileXXX(userId: string)`: 該当CTFに登録されている、`userId`で識別されるユーザのプロフィールを`Profile`型で返す。
  - `findUserProfileXXX(username: string)`: 該当CTFから、`username`で識別されるユーザを見つけて`userid`と`username`の組を返す。IDと名前が一致する場合には両方同じで構わない。見つからない場合には`null`を返す。
- `index.ts`の以下の箇所に該当処理を追加する。
  - `const XXX_ID`をexportする。
  - `findUserByName()`に処理を追加する。
  - `fetchUserProfile()`に処理を追加する。
  - `updateChallsXXX()`を追加する。
  - `checkAchievementsXXX()`を追加する。
  - `updateAll()`に処理を追加する。
- `index.test.ts`にテストを追加する。
  - `jest.mock('./lib/KSNManager');`をする。
  - `sampleChallsXXX`を`Challenge[]`型として追加する。
  - `sampleProfileXXX`を`Profile`型として追加する。
  - `fetchChallsXXX()`と`fetchUserProfileXXX()`をmockする。
  - `fakeState`に該当CTFを追加する。
  - `respond to list`テストに該当CTFを追加する。
  - 最低限以下のテストを追加する。
    - `respond to check XXX wihtout joining`
    - `respond to join ksn`
- 必要があれば実績を`achievements.ts`に追加する。