# PDF記入用JSON

これは `fill_commute_pdf.py` が人物別PDFを記入するための内部形式である。承認済みの証拠台帳から `scripts/export_fill_data.py` で生成し、ユーザーへJSONの手入力や録画の書き起こしを求めない。完成表記は承認済みの文字列を保つ。

## Shape

```json
{
  "document": {
    "target_date": {"era": "令和", "year": 8, "month": 7},
    "submission_date": {"era": "令和", "year": 8, "month": 8, "day": 4},
    "employee_code": "000001",
    "employee_name": "テスト　利用者",
    "expected_row_count": 27,
    "expected_page_row_counts": [15, 12],
    "expected_page_totals": [17197, 12124],
    "expected_grand_total": 29321
  },
  "rows": [
    {
      "date": "7/19",
      "shift": "日勤",
      "site": "勤務先B",
      "address": "所在地B",
      "route": "駅A→駅B",
      "fare": "528円（片道）",
      "amount": 528
    },
    {
      "date": "7/19",
      "shift": "夜勤",
      "site": "勤務先C",
      "address": "所在地C",
      "route": "駅B→駅C→駅A",
      "fare": "209円＋616円",
      "amount": 825
    }
  ]
}
```

The example shows how to split one continuous `駅A -> 駅B -> 駅C -> 駅A` journey across two payable work rows. Use the user's actual stations, sites, and fares.

## Rules

- `document.target_date.era` and `document.submission_date.era`: require `令和` for this form.
- `year`, `month`, `day`: use integers. Validate calendar ranges before editing.
- `employee_code`: use a string so leading zeroes survive.
- `employee_name`: preserve exact characters and spacing. Do not silently normalize full-width spaces, long-vowel marks, or name order.
- `expected_*`: include when totals or counts are already confirmed. The scripts fail on a mismatch. Omit only when the user has not supplied a confirmed value.
- `rows`: keep the desired printed order. The bundled profile fills page 1 to its 15-row capacity, then page 2.
- `date`: use the compact value that belongs in the row, normally `M/D`.
- `shift`: use the exact printed label, such as `日勤` or `夜勤`.
- `site` and `address`: keep separate; the script prints them on two lines in the worksite field.
- `route`: preserve route order and arrow semantics. Use `→` for one-way or continuous segments and `⇄` only for an actual round trip.
- `fare`: keep the readable IC-fare expression. It may contain `円`, `×`, `＋`, parentheses, or Japanese parentheses.
- `amount`: require a non-negative integer from 0 through 999999. Never use a string with a comma, a currency suffix, or a formula.

## Page allocation

The supplied profile has 15 rows on page 1 and 17 rows on page 2. A 27-row job therefore allocates 15 rows and 12 rows. Leave remaining page 2 rows blank.

Do not merge two payable occurrences to reduce the row count. Do not split a single occurrence unless the route, worksite, or user-confirmed accounting requires a distinct line.
