# 指示チェーンと独立勤務の照合

資料を対象者ごとに最初から最後まで確認する。最終指示だけを抜き出さない。下記は任意の台帳拡張であり、旧schema_version 1.0データとの互換を維持する。Web用JSONは別形式で、ここでの証拠台帳を直接Webへ読み込まない。

## 状態判断

1. 初回、変更、訂正、再変更の会社・現場・予定時刻を原文の位置と共に残す。
2. 中止、雨天中止、欠勤、車両問題を分離する。明示中止・欠勤はexcluded。車両問題や曖昧な取消はneeds_confirmation。
3. 出発／到着／開始／終了／翌朝／現場固有の発言、または本人の具体的確認を、その人と勤務開始日と実勤務先へ結び付ける。単なる「お疲れさま」は現場確定の根拠にならない。
4. 最後の変更後の実勤務証拠がなければneeds_confirmation。変更前後を示し「どちらで働いたか」を尋ねる。実勤務証拠が矛盾すれば最新の発言だけを採用しない。
5. 同一チェーンの翌朝報告・往路復路交通費を追加勤務として数えない。別人の台帳にコピーする際もその人の証拠を必要とする。

## 任意のrecords拡張

```json
{
  "service_id": "service-a",
  "counts_as_work": true,
  "instruction_chain": {
    "id": "service-a",
    "date_conflict": false,
    "person_conflict": false,
    "events": [
      {"kind": "initial", "timestamp": "2099-09-01T12:00:00+09:00", "person_id": "person-1", "site": "架空取引先A・現場A", "body_date": "2099-09-01", "locator": "画像01"},
      {"kind": "change", "timestamp": "2099-09-01T13:00:00+09:00", "person_id": "person-1", "site": "架空取引先B・現場B", "locator": "画像02"},
      {"kind": "next_morning", "timestamp": "2099-09-02T07:00:00+09:00", "person_id": "person-1", "site": "架空取引先B・現場B", "service_date": "2099-09-01", "locator": "画像03"}
    ]
  }
}
```

共有指示はperson_ids配列で明示する。kindはinitial/change/correction/rechange/cancel/rain_cancel/absence/vehicle_cancel/departure/arrival/start/end/next_morning/actual_site/user_confirmation。車両問題自体はvehicle_problemとして記録し、vehicle_cancelは明示された中止に限定する。
eventsは元の送信時系列順。timestamp、body_date、service_dateを混同しない。locatorは必須。service_dateは抽出時に証拠から解決した開始日であり、timestampから機械的に作らない。

## 半月別照合

reconciliationに任意のexpected_work_counts_by_personを追加できる：

```json
{"expected_work_counts_by_person":{"person-1":{"first_half":6,"second_half":7},"person-2":{"first_half":null,"second_half":null}}}
```

0は明示された0勤務。null／省略は申告なし。day/night/trainingを勤務として数え、medical_exam/company_businessは精算のみ。otherはcounts_as_workで明示する。複数交通費行はservice_idで一つにまとめ、同日独立勤務は別service_id。旧expected_payable_row_countsは精算行数であり、この勤務回数へ流用しない。確定候補と要確認を分ける。回数一致でも現場未確認ならリリース不可。

## 必須の回帰事例（架空データ）

- 9/1：架空A・現場A 22時→架空B・現場B 20時→変更の依頼のみ、実勤務証拠なし：needs_confirmation、どちらの現場か質問。
- 9/9「今晩」出発、9/10朝「昨晩」終了、本文日付9/10：勤務開始日9/9が証拠で解決されるまで要確認。終了を別勤務にしない。
- 中止：excludedで勤務回数0。中止後の再指示・実勤務との関係不明なら要確認。
- 件数一致でも現場不明：最終JSON不可。
- 本人のみの出発：「父は休み」と推定しない。

Webはcommute-core.js、Skillはinstruction_chain.pyとvalidate_commute_data.pyで任意メタデータを検査する。自動検査は元資料の読解や明示承認を代替しない。
