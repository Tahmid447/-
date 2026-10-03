# Tahmid 通勤伝票スタジオ

勤務データを読み込み、会社様式の通勤費伝票を確認・編集・A4印刷する静的Webアプリです。**初期表示は個人情報・勤務情報とも空欄**です。架空デモは明示操作でのみ表示します。フレームワークや外部解析APIへ移行していません。

## 利用モードと確認の流れ

- 自分・家族用：本人と父の空欄2人から開始。それぞれ前半・後半を任意入力。
- 一般の警備員用：空欄1人から開始。対象者ラベル／名前と任意の前半・後半回数。対象者を追加できます。
- `?mode=personal` / `?mode=general` は単体HTMLやローカルでも使えます。Cloudflare Pagesでは `/personal` / `/general` が上記へリダイレクト。同じコードベースで、他のモードの保存データを自動読込しません。
- 合計勤務回数の入力欄はありません。回数は照合値であり件数合わせは禁止。空欄は未入力で0回とは異なります。
- 「確定候補」は入力済み明細の照合上の呼び方で、実勤務の証明ではありません。変更・対象者・日付・実勤務証拠をPrompt Aで確認します。
- 未解決の確認事項はチェックで保持。既知の要確認・回数差・重要項目欠落が残れば承認できません。編集と再読込は承認を解除します。
- 読込・JSON保存・CSV保存は下書きも扱えます。印刷は内容チェックと承認後のみ。確認用JSONと最終JSONを混同しないでください。

## すぐ試す

1. `commute-slip-app-standalone.html` をブラウザで開きます。
2. 「デモ用サンプルを表示」で、2行の勤務先名・編集・複製・削除を試します。
3. 実際に使うときは「データを貼り付ける」か「ファイルをアップロード」からJSON／CSVを読み込みます。
4. Prompt Aで全資料と候補表、変更履歴、人物別の前半・後半回数を照合し、未解決の質問に回答します。
5. 全体を確認し記入承認をチェックした後、Prompt Bで最終JSONを作ります。不明点があればBはJSONを出さず質問を返すよう指示します。
6. 最終JSONの再読込後も内容を再確認し、承認チェックと「データ内容をチェック」を実行してから印刷します。

印刷画面では **A4・縦、倍率100%、余白なし、背景グラフィックON** を推奨します。プリンター欄で「PDFに保存」を選ぶとPDFになります。環境差で端が欠ける場合だけ95%または90%へ下げてください。

## 公開・プライバシー方針

- 同梱の氏名、社員コード、住所、勤務先、経路、運賃はすべて架空です。
- 入力内容をAPIやサーバーへ送信しません。
- 「現在のデータを保存」を押すと保存データを、入力・削除・リセット前には復元用バックアップを、そのブラウザのローカルストレージへ保存します。
- モード切替時の下書きも自動保存します。モード別保存は誤表示を防ぐ仕組みであり、認証・暗号化・他の利用者からのアクセス制限ではありません。
- 「保存データ削除」で明示保存分を削除できます。画面を新規化・リセットする前は確認画面が出て、JSON保存または直前データの復元ができます。
- 共有端末では「両モードの端末内データを完全削除」を使用してください。復元用データも消します。ダウンロードしたJSON／CSV／HTMLやChatGPTへ送った資料は別途管理します。
- 各行の確認リンクを押した場合だけ、Google Maps、Yahoo!路線情報、または登録済みURLを別タブで開きます。
- 公開前は、実データを読み込んだ状態で保存したHTMLやJSONを公開フォルダへ置かないでください。

## 主な機能

- 会社帳票に近いA4縦2ページ（1ページ目15行、2ページ目17行）
- 承認欄、縦見出し、区間／運賃の二段表示、金額6桁枠、頁計、総合計
- JSON、ChatGPT回答内のJSONコードブロック、CSV、手入力
- 動画・資料の候補確認用と、確認後の最終JSON用に分けた2種類のChatGPTプロンプト
- 複数人の追加・切替・複製・削除と、1名／全員印刷
- 勤務行の追加・複製・削除
- カレンダー日付、勤務区分セレクト（その他は自由入力）、IC／現金トグル
- 取引先・現場名・現場住所・現場最寄り駅を分けた入力
- 片道運賃から往復額を自動計算し、特殊ケースは手動修正可能
- Google Maps、Yahoo!路線情報、登録URLによる経路・運賃確認
- 赤いデジタル印鑑の表示／非表示、100～150%のサイズ調整と即時プレビュー
- 入力チェック、合計、件数、最終編集日時
- JSON、CSV、現在データ入りの単体HTMLを保存
- 新規作成・デモ復帰・リセット前の確認、JSON退避、端末内自動バックアップ、直前データ復元
- Web Audio APIと内蔵WAVフォールバックによる操作音、ON／OFF、音量調整
- 画面文字サイズ3段階、帳票プレビュー85～150%、スマートフォン向けカード入力

## ファイル構成

- `commute-slip-app-standalone.html`：単体で開ける空欄開始版（デモはボタンで表示）
- `commute-slip-blank-template.html`：個人・勤務情報が空の単体版
- `index.html`、`style.css`、`app.js`、`commute-core.js`：分割版と共通確認ロジック
- `skills/fill-commute-expense-pdf/`：個人設定を除いた共有用Skill一式。空欄PDF／Word、参照資料、検証・抽出・帳票生成スクリプト
- `tests/`、`scripts/`：架空データの回帰テスト、公開監査、静的ビルド
- `_redirects`、`_headers`：Cloudflare Pages用設定
- `sample-data.json`、`sample-data.js`：架空デモデータ
- `PUBLIC_RELEASE_CHECKLIST.md`：公開前の確認記録
- `public-release-audit.json`：機械チェック結果
- `BROWSER_QA.md`：実ブラウザでの操作・印刷生成テスト結果

## 推奨JSON形式

```json
{
  "appVersion": "2.0",
  "documentType": "commute_slip",
  "targetMonth": "2026-10",
  "submissionDate": "2026-11-01",
  "companyName": "会社名",
  "people": [
    {
      "name": "氏名",
      "employeeCode": "000001",
      "address": "住所",
      "nearestStations": ["駅A", "駅B"],
      "hankoName": "印鑑名",
      "showDigitalHanko": true,
      "hankoScale": 1.2,
      "notes": "本人の備考",
      "entries": [
        {
          "date": "10月2日",
          "workType": "日勤",
          "clientName": "取引先名",
          "siteName": "現場名",
          "siteAddress": "現場住所",
          "nearestStation": "現場最寄り駅",
          "route": "駅A ↔ 目的駅",
          "transport": "電車",
          "oneWayFare": 320,
          "roundTripFare": 640,
          "fareType": "IC",
          "verificationUrl": "",
          "memo": "根拠メモ"
        }
      ]
    }
  ]
}
```

画面の「確認用プロンプトA」と「最終JSON用プロンプトB」を順に使うと、確認前の推測混入を防ぎやすくなります。ChatGPTの説明文ごと貼り付けても、内部のJSONコードブロックを自動抽出します。

## CSV形式

UTF-8のカンマ区切りまたはタブ区切りに対応します。推奨見出しは次のとおりです。

`会社名,対象月,提出日,対象者,社員コード,本人住所,最寄り駅,印鑑名,印鑑表示,印鑑倍率,勤務日,区分,勤務先名,現場名,現場住所,現場最寄り駅,通勤区間,交通手段,片道運賃,往復金額,運賃種別,確認リンク,備考`

## データチェック

印刷前に、氏名、社員コード、対象月、提出日、勤務日、勤務先／現場、区間、片道・往復運賃、承認、回数差、任意の指示チェーンを検査します。同一人物の同一勤務日や往復矢印の不足は警告。既知のneeds_confirmationは回数一致や承認チェックでは解除できません。

旧JSON・旧CSVのフィールドを維持します。追加情報は任意の`workflow`（mode、counts、openQuestions、userApproved）、人物の`label`、明細の`status`、`review`、`instructionChain`、`serviceId`、`countsAsWork`です。これらを持たない既存データも読めますが証拠確認済みとは見なしません。Skillの証拠台帳は別スキーマであり直接インポートは拒否します。

CSV末尾に任意の対象者ID・確認メタデータ・作業設定を出力し、要確認状態を再読込でも維持します。空欄人物や明細のない対象者まで完全に退避する場合はJSONを使います。HTML保存はHTTP配信した分割版、または単体版で使えます。file://制限で分割版からのHTML保存は利用できない場合があります。

## 配布・公開

手軽な配布には `commute-slip-app-standalone.html` だけで十分です。Web公開にはリポジトリ全体ではなく **`npm run build`で生成した`dist/`だけ**を配信します。外部APIは不要です。

## 開発・検証

Node.js 20以上、Python 3.10以上。Webの実行にnpmライブラリは不要で、DOMテストのみlinkedomを使います。

```sh
npm ci
npm run check
```

`npm test`は共通ロジックとDOM操作、`npm run test:skill`は標準ライブラリのみのSkillテスト、`npm run build`は静的ビルド、`npm run audit`は公開監査。GitHub Actionsも同じ検査を実行します。PRIVATE_SCAN_TERMS環境変数（非公開文字列のJSON配列）で追加監査できます。実名や秘密をテストへ書き込まないでください。

インストール済みSkillとの同期は正の許可リストで行います：`node scripts/sync-skill.mjs /path/to/installed/fill-commute-expense-pdf`。個人設定、実台帳、承認記録、録画、フレームを含めません。

## Cloudflare Pagesへの公開（未デプロイ）

静的HTMLをそのまま維持できるため第一候補はCloudflare Pages。[公式の静的HTML手順](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)に沿って設定します。

1. Workers & Pages → Create application → Pages → Import an existing Git repository。
2. GitHubの`Tahmid447/-`を選択。
3. Production branch：`main`、Framework preset：None、Root directory：空欄（リポジトリルート）。
4. Build command：`npm run build`、Build output directory：`dist`。Node.jsは22系。
5. プレビューで両モード、空欄開始、旧JSON読込、390px画面、印鑑、承認・印刷を確認してから公開。

`_redirects`は`/personal`と`/general`をクエリ別モードへ接続します。[Cloudflareのリダイレクト仕様](https://developers.cloudflare.com/pages/configuration/redirects/)を使用。Skillや個人資料はdist/へ入りません。Next.js化やVercel移行は今回不要です。pushのみではCloudflare公開されません。Git連携後はpushがデプロイを起動するため、公開連携前に確認してください。

公開前チェック：

1. 架空データだけが入っていることを確認する。
2. `PUBLIC_RELEASE_CHECKLIST.md` と `public-release-audit.json` が合格になっていることを確認する。
3. 実データを入れて「HTML保存」したファイルは公開しない。
4. URLを知る人が誰でも開ける場所へ置く場合は、組織の個人情報ルールも確認する。

## 将来のAPI拡張

現在は完全ローカルです。将来、動画解析、経路・IC運賃照会、承認履歴、組織別テンプレート、クラウド共有を追加する場合は、認証、暗号化、権限、保存期間、監査ログ、明示同意を先に設計してください。
