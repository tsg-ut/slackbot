# 20の扉 (Twenty Questions) Bot

「20の扉」ゲームを遊ぶことができるSlackbotです。

## 概要

このbotは、プレイヤーが「はい」「いいえ」で答えられる質問をAIにすることで、お題の単語を当てるゲームを提供します。プレイヤーは最大20回の質問をすることができ、なるべく少ない質問回数で正解を当てることを目指します。

## ゲームの流れ

1. **ゲーム開始**: ユーザーが#sandboxチャンネルに「20の扉」というメッセージを投稿すると、ゲームが開始します
   - すでに進行中のゲームがある場合はエラーメッセージが表示されます

2. **お題の選定**: ゲーム開始時に、AIが簡単で具体的な名詞をお題として選びます
   - tahoiya/lib.jsのgetCandidateWords関数から200単語をサンプリングして選定するプロセスを10回繰り返す
   - 10回の選定で得られた10個の単語候補から、AIが最終的に最適な1つを選定

3. **参加**: プレイヤーは「参加する」ボタンをクリックしてモーダルを開きます
   - モーダルには質問履歴とAIの回答が表示されます
   - 答えの試行も履歴に表示され、✅または❌のアイコンで正誤が示されます
   - 質問入力フィールド（最大30文字）と「質問を送信」ボタン
   - 答え入力フィールド（最大15文字）と「答えを送信」ボタン

4. **質問**: プレイヤーは「はい」「いいえ」で答えられる質問を入力します（最大30文字）
   - 質問の送信方法は2通り:
     - 質問フィールドの下の「質問を送信」ボタンをクリック
     - モーダル右上の「質問を送信」ボタンをクリック（またはEnterキー）
   - AIが「はい」「いいえ」「どちらかと言えばはい」「どちらかと言えばいいえ」「わかりません」「答えられません」のいずれかで回答
   - 「はい」「いいえ」で答えられません質問（例：「答えはなんですか？」）には「答えられません」と回答されます
   - AIの回答フォーマットが検証され、不正な場合は「答えられません」に置換されます
   - 質問するたびに質問回数が1増えます
   - AIの回答を受け取るとモーダルが自動的に更新され、質問履歴に追加されます

5. **回答**: プレイヤーが答えを当てるフィールドに入力し、「答えを送信」ボタンを押すと、AIが正誤を判定します
   - 回答試行も質問回数としてカウントされます
   - 回答の結果は質問履歴に追加され、正誤が視覚的に表示されます
   - 正解した場合、質問回数に基づいてランキングが更新されます
   - モーダルは自動的に更新され、最新の状態が表示されます
   - 正解済み/ゲーム終了後は、入力フィールドが非表示になり、結果のみが表示されます

6. **ゲーム終了**:
   - 正解した場合: お祝いメッセージがゲーム開始メッセージへのスレッド返信として投稿され、ランキングに記録されます
   - 20回の質問を使い切った場合: ゲーム終了メッセージと共に正解がスレッド返信として表示されます
   - 30分経過した場合: ゲームが終了し、最終ランキングがスレッド返信として表示されます
   - すべてのゲーム結果メッセージはブロードキャストされ、チャンネルに表示されます

## 技術的詳細

### アーキテクチャ

- **クラスベース設計**: HelloWorldボットのパターンに従った実装
- **State管理**: lib/stateモジュールを使用した永続化
- **Firestore保存**: 終了したゲームはFirestoreのtwenty_questions_gamesコレクションに保存
- **AI統合**: lib/openai.tsを使用してgpt-4o-miniモデルで処理

### ファイル構成

```
twenty-questions/
├── TwentyQuestions.ts            # メインのbotクラス
├── TwentyQuestions.test.ts       # メインクラスのユニットテスト
├── index.ts                       # エントリーポイント
├── views/
│   ├── gameStatusMessage.ts      # ゲーム状態表示用のブロック
│   ├── gameStatusMessage.test.ts # ゲーム状態表示のユニットテスト
│   ├── playerModal.ts            # プレイヤー用モーダル
│   ├── playerModal.test.ts       # プレイヤーモーダルのユニットテスト
│   ├── gameLogModal.ts           # ゲームログモーダル
│   └── gameLogModal.test.ts      # ゲームログモーダルのユニットテスト
└── README.md                     # このファイル
```

### 主要な型定義

```typescript
interface Question {
  question: string;
  answer: string;
  timestamp: number;
  isAnswerAttempt?: boolean;  // 答えを当てる試行かどうか
  isCorrect?: boolean;         // 正解かどうか
}

interface GameState {
  id: string;
  topic: string;
  status: 'active' | 'finished';
  startedAt: number;
  finishedAt: number | null;
  players: {[userId: string]: PlayerState};
  statusMessageTs: string | null;
}

interface PlayerState {
  userId: string;
  questions: Question[];       // 質問と回答の履歴（答えの試行も含む）
  questionCount: number;
  isFinished: boolean;
  score: number | null;
}

interface FinishedGame {
  id: string;
  topic: string;
  startedAt: firestore.Timestamp;
  finishedAt: firestore.Timestamp;
  players: {
    userId: string;
    questionCount: number;
    score: number | null;
    questions: Question[];     // プレイヤーの質問ログも保存
  }[];
}
```

## テスト

### テストの実行

```bash
npm test -- twenty-questions
```

### テストカバレッジ

- **TwentyQuestions.test.ts** (3 tests): メインのbotクラスの動作をテスト
  - 初期化処理
  - ゲーム開始処理
  - 重複開始の防止

- **playerModal.test.ts** (6 tests): プレイヤーモーダルの表示をテスト
  - 質問入力フィールドの表示/非表示
  - 答え入力フィールドの表示
  - 質問履歴の表示
  - 送信ボタンのテキスト変化
  - 答えの試行履歴の表示

- **gameLogModal.test.ts** (8 tests): ゲームログモーダルの表示をテスト
  - ゲーム不在時のメッセージ
  - お題の表示
  - プレイヤー一覧の表示順序
  - プレイヤーステータスの表示
  - 質問履歴の表示
  - 答えの試行の表示

- **gameStatusMessage.test.ts** (10 tests): ゲーム状態メッセージの表示をテスト
  - ゲーム不在時のメッセージ
  - アクティブ/終了状態の表示
  - ボタンの表示（参加、ログ確認）
  - ランキングの表示
  - 正解者/未正解者の表示分離
  - ゲームルールの表示

全27テストがTypeScriptの型安全性を保ちながら実装されています。

## 使用技術

- TypeScript
- Slack Web API
- OpenAI API (gpt-4o-mini)
- Firestore
- async-mutex (並行処理制御)
- lodash (ユーティリティ関数)
