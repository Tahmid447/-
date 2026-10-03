# 正規化データ・スキーマ

通勤伝票へ入る事実と、その根拠・承認状態を一つのJSONへ保存する。社員コードは数値ではなく文字列、金額は円単位の整数、日付はISO形式とする。

## 最上位

| キー | 必須 | 内容 |
|---|---:|---|
| `schema_version` | はい | 現在は `1.0` |
| `document` | はい | 対象年月、提出日、元帳票、出力形式 |
| `people` | はい | 対象者ごとの本人・通勤設定 |
| `records` | はい | 確定、要確認、除外を含む勤務・交通費候補 |
| `reconciliation` | はい | 日付照合、期待件数、期待合計、資料欠落 |
| `approval` | はい | 確認表とユーザー承認、承認対象ダイジェスト |

## `document`

```json
{
  "target_year_month": "YYYY-MM",
  "submission_date": null,
  "template_file": null,
  "requested_outputs": ["pdf", "docx", "html", "json", "csv"]
}
```

- `submission_date` は完成版の前に `YYYY-MM-DD` で確定する。
- `pdf` を出す場合、承認済みの空欄帳票または元PDFを `template_file` で特定する。
- 許容出力は `pdf`, `docx`, `html`, `json`, `csv`, `xlsx`。

## `people[]`

```json
{
  "person_id": "person-1",
  "name": "<氏名>",
  "employee_code": "<文字列の社員コード>",
  "address": "<住所>",
  "home_stations": ["<利用可能駅>"],
  "route_preferences": {
    "home_to_station": "<徒歩・バス等>",
    "bus_walk_threshold_minutes": 15,
    "selection_priority": ["合理性", "歩行負担", "乗換", "所要時間", "費用"]
  }
}
```

- `person_id` はファイル内で一意にする。
- `employee_code` は先頭ゼロを保持するため必ずJSON文字列にする。
- 複数人で同じ勤務がある場合も、最終的には人ごとの `record` を持たせ、例外と合計を独立検査できるようにする。

## `records[]`

```json
{
  "record_id": "row-001",
  "person_id": "person-1",
  "service_date": "YYYY-MM-DD",
  "category": "day",
  "category_label": "日勤",
  "worksite": {
    "company_name": "<会社・取引先>",
    "site_name": "<現場名>",
    "address": "<現場住所>",
    "nearest_station": "<最寄り駅>"
  },
  "route": {
    "from_station": "<出発駅>",
    "to_station": "<到着駅>",
    "display_interval": "<出発駅> ↔ <到着駅>",
    "bus_used": false,
    "bus_details": [
      {
        "direction": "outbound",
        "from_stop": "<乗車停留所>",
        "to_stop": "<降車停留所>",
        "verified": false
      }
    ],
    "rationale": "<経路選択理由>"
  },
  "fare": {
    "calculation_kind": "round_trip",
    "one_way_ic_yen": 0,
    "components": [],
    "payable_yen": 0,
    "calculation_note": "片道IC運賃×2",
    "verified": false,
    "verification_basis": "<official_source/user_confirmed/provided_record等>",
    "source_urls": [],
    "verified_on": null
  },
  "source_evidence": [
    {
      "source_id": "<資料識別子>",
      "locator": "<動画時刻・画像番号・表の行等>",
      "fact_type": "<勤務日・現場・運賃等>",
      "note": "<短い要約>",
      "confidence": "explicit"
    }
  ],
  "status": "needs_confirmation",
  "outside_target_period_confirmed": false,
  "notes": ""
}
```

### 列挙値

- `category`: `day`, `night`, `training`, `medical_exam`, `company_business`, `other`
- `category_label`: 任意。会社帳票へ印字する承認済み表記。省略時は標準の日本語区分名を使う。
- `status`: `confirmed`, `needs_confirmation`, `excluded`
- `fare.calculation_kind`: `round_trip`, `one_way`, `continuous_journey`, `custom`
- `source_evidence[].confidence`: `explicit`, `inferred`

`route.rationale` は確定行で必須。`bus_used: true` のときは、往路・復路を分けた `bus_details` を1件以上記録し、完成版では各便を `verified: true` にする。`bus_used: false` のとき `bus_details` は空配列にする。

### 金額

- `payable_yen` は伝票へ載せる整数円。カンマや `円`、式は入れない。
- 単純往復は `one_way_ic_yen × 2 = payable_yen` とする。
- 電車往復に往路バスだけを加えるなど非対称の場合、`components` に実額を分ける。

```json
"components": [
  {"label": "鉄道往復", "amount_yen": 0},
  {"label": "往路バス", "amount_yen": 0}
]
```

`components` がある場合、その合計は `payable_yen` と一致しなければならない。

- `one_way` で `components` がない場合は `one_way_ic_yen = payable_yen`。
- `continuous_journey` と `custom` は、検算可能な `components` を必須とする。
- すべての確定行で `calculation_note` を記録する。

### 月外行

対象年月外の日を載せるときは、その行を `confirmed` にしたうえで `outside_target_period_confirmed: true` にする。これはユーザーがその月の伝票へ含めることを個別に承認した意味であり、一般承認から推測しない。

### 除外行

`excluded` は照合履歴として残す行で、`notes` に除外理由を書く。伝票件数・合計には含めない。勤務ではない会社用件を精算対象にする場合は除外せず、`company_business` の確定行にする。

## `reconciliation`

```json
{
  "mentioned_work_dates_by_person": {"person-1": []},
  "source_work_dates_by_person": {"person-1": []},
  "explicit_non_work_dates_by_person": {"person-1": []},
  "date_reconciliation_complete": false,
  "known_source_gaps": [],
  "expected_payable_row_counts": {"person-1": 0},
  "expected_totals_yen": {"person-1": 0}
}
```

- `mentioned_work_dates_by_person`: ユーザーが各人について勤務または精算候補として挙げた日。
- `source_work_dates_by_person`: 動画・画像・確定表から各人について抽出した日。
- `explicit_non_work_dates_by_person`: 各人が勤務していないと明示された日。会社用件を含める場合でも、勤務とは別に扱ったことを記録する。
- 日付を全資料と突合できたときだけ `date_reconciliation_complete` を `true` にする。
- 読めない区間や不足資料は `known_source_gaps` に残す。完成版では空でなければならない。
- 期待件数と期待合計は各人の `confirmed` 行だけから独立再計算して一致させる。
- 3つの日付オブジェクトには `people[]` の全 `person_id` をキーとして置く。複数人で日付が同じでも人物別に記録する。
- 各人の `mentioned_work_dates_by_person` と `source_work_dates_by_person` の全日付には、その人の確定・要確認・除外行を対応させる。逆に、その人の全レコード日を2集合または `explicit_non_work_dates_by_person` のいずれかに存在させる。
- 各人の `explicit_non_work_dates_by_person` には、その人の日勤・夜勤確定行を置かない。別人の同日勤務とは競合しない。会社用件など別区分を載せる場合は区分を明示する。

## `approval` と独立承認受領記録

```json
{
  "confirmation_table_present": false,
  "status": "draft",
  "user_approved": false,
  "approved_at": null,
  "data_digest": null
}
```

1. 確認表を提示するまでは `draft` のままにする。
2. 全行を解決して `--print-digest` で承認対象のSHA-256を取得する。
3. ユーザーが確認表全体を明示承認した後だけ、`confirmation_table_present: true`, `status: approved`, `user_approved: true`, `approved_at` と `data_digest` を設定する。
4. 同じダイジェストと、実際の承認メッセージの所在・文面を、作業用の別ファイル `approval-receipt.json` に記録する。検証スクリプトには受領記録を自動生成する機能を持たせない。

```json
{
  "receipt_version": "1.0",
  "approved_digest": "<64桁のSHA-256>",
  "user_approved": true,
  "approved_at": "<ISO日時>",
  "approval_source": {
    "kind": "user_message",
    "locator": "<タスクと承認ターンを特定できる識別子>",
    "approval_text": "<ユーザーの承認文>"
  }
}
```

5. `--approval-receipt approval-receipt.json` を付けて `--release-check` を実行する。承認後に `document`, `people`, `records`, `reconciliation` のどれかが変わると、独立受領記録との不一致になり、更新表への新しい承認が必要になる。受領記録をデータ変更に合わせて再発行してはならない。

## PDF記入用データへの変換

リリース検査後、人物ごとに次を実行する。

```bash
python scripts/export_fill_data.py commute-data.json \
  --approval-receipt approval-receipt.json \
  --person-id person-1 \
  --output fill-person-1.json
```

変換スクリプトはリリース検査を再実行し、確定行だけを元の台帳順で出力する。除外行は帳票へ入れない。1ページ目15行、2ページ目17行で人物別のページ件数・ページ合計・総合計を再計算する。
