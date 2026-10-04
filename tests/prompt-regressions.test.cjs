const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../commute-core.js");

// Fictional equivalents of reported September cases; no private workplace data.
// These test structured evidence and generated prompt contracts, not an LLM run.
function event(personId, day, kind, values = {}) {
  return {
    personId, kind, site: "架空現場B", serviceDate: `2099-09-${day}`,
    timestamp: `2099-09-${day}T20:00:00+09:00`, locator: "fictional-source",
    ...values
  };
}
function entry(personId, day, events, values = {}) {
  return {
    id: `${personId}-${day}`, date: `9/${Number(day)}`, workType: "夜勤",
    clientName: "架空現場B", siteName: "", route: "", oneWayFare: null,
    roundTripFare: null, instructionChain: { id: `${personId}-${day}`, events },
    ...values
  };
}
function state(first = [], second = [], mode = "personal") {
  return {
    targetMonth: "2099-09",
    people: [{ id: "p1", name: "", entries: first }, { id: "p2", name: "", entries: second }],
    workflow: { mode, counts: {}, userApproved: false }
  };
}

test("9/1: explicit actual-site confirmation resolves the changed instruction", () => {
  const instructions = [
    event("p1", "01", "initial", { site: "架空現場A", serviceDate: undefined, timestamp: "2099-09-01T12:00:00+09:00" }),
    event("p1", "01", "change", { serviceDate: undefined, timestamp: "2099-09-01T13:00:00+09:00" })
  ];
  assert.equal(Core.assessInstructionChain({ events: instructions }, "p1").status, "needs_confirmation");
  const confirmed = [...instructions, event("p1", "01", "user_confirmation")];
  const result = Core.assessInstructionChain({ events: confirmed }, "p1");
  assert.equal(result.status, "confirmed");
  assert.equal(result.actualSite, "架空現場B");
  assert.deepEqual(result.questions, []);
  const prompt = Core.buildPromptA(state());
  assert.match(prompt, /変更後の実勤務証拠またはユーザーの明示確認がない場合のみneeds_confirmation/);
  assert.match(prompt, /明示確認済みなら、その現場をconfirmedとし同じ質問を繰り返さない/);
});

test("9/9: reconciled body-date typo keeps both people's night work on its start date", () => {
  const rows = ["p1", "p2"].map(personId => entry(personId, "09", [
    event(personId, "09", "initial", { bodyDate: "2099-09-10", text: "今晩", serviceDate: undefined, timestamp: "2099-09-09T12:00:00+09:00" }),
    event(personId, "09", "departure", { timestamp: "2099-09-09T19:00:00+09:00" }),
    event(personId, "09", "start"),
    event(personId, "09", "next_morning", { text: "昨晩の下番", timestamp: "2099-09-10T07:00:00+09:00" })
  ]));
  const value = state([rows[0]], [rows[1]]);
  rows.forEach((row, index) => {
    const result = Core.reviewFor(row, `p${index + 1}`);
    assert.equal(result.status, "confirmed");
    assert.equal(result.serviceDate, "2099-09-09");
    assert.deepEqual(result.questions, []);
  });
  Core.reconcileWorkCounts(value).forEach(row => {
    assert.equal(row.halves[0].candidates, 1);
    assert.equal(row.halves[0].needsConfirmation, 0);
  });
  assert.match(Core.buildPromptA(value), /誤記を十分解決できるなら、根拠を残し前日の勤務開始日をconfirmed/);
  // Unresolved contradictory service dates still require an answer.
  assert.equal(Core.assessInstructionChain({ events: [event("p1", "09", "start"), event("p1", "10", "next_morning")] }, "p1").status, "needs_confirmation");
});

test("9/10: father's car message does not demote confirmed work or stop fare research", () => {
  const row = entry("p2", "10", [event("p2", "10", "departure", { text: "今日は車で通勤します" })], {
    transport: "車（実際の移動）", review: { routeUnknown: true, fareUnknown: true }
  });
  const value = state([], [row]);
  const before = JSON.stringify(value);
  assert.equal(Core.reviewFor(row, "p2").status, "confirmed");
  assert.deepEqual(Core.reviewFor(row, "p2").questions, []);
  const half = Core.reconcileWorkCounts(value)[1].halves[0];
  assert.equal(half.candidates, 1);
  assert.equal(half.needsConfirmation, 0);
  assert.ok(Core.releaseBlockers(value).some(message => /経路・運賃/.test(message)));
  assert.ok(!Core.releaseBlockers(value).some(message => /needs_confirmation/.test(message)));
  assert.match(Core.buildPromptA(value), /それだけで交通費0円、車通勤精算、needs_confirmation、公共交通ルートの削除にしない/);
  assert.equal(JSON.stringify(value), before);
});

test("9/17: a vehicle problem alone is neither absence nor proof of work", () => {
  const problem = event("p2", "17", "vehicle_problem", { text: "タイヤパンク", serviceDate: undefined, timestamp: "2099-09-17T18:00:00+09:00" });
  assert.equal(Core.assessInstructionChain({ events: [problem] }, "p2").status, "needs_confirmation");
  assert.equal(Core.assessInstructionChain({ events: [problem, event("p2", "17", "start")] }, "p2").status, "confirmed");
  assert.match(Core.buildPromptA(state()), /車両問題だけから自動的に欠勤・excludedと推測しない/);
});

test("9/17: user-confirmed absence excludes only father, not self", () => {
  const self = entry("p1", "17", [event("p1", "17", "user_confirmation")]);
  const father = entry("p2", "17", [
    event("p2", "17", "vehicle_problem", { serviceDate: undefined, timestamp: "2099-09-17T18:00:00+09:00" }),
    event("p2", "17", "absence", { text: "ユーザー確認：勤務していない", serviceDate: undefined })
  ]);
  const value = state([self], [father]);
  assert.equal(Core.reviewFor(self, "p1").status, "confirmed");
  assert.equal(Core.reviewFor(father, "p2").status, "excluded");
  const counts = Core.reconcileWorkCounts(value);
  assert.equal(counts[0].halves[1].candidates, 1);
  assert.equal(counts[1].halves[1].candidates, 0);
  assert.equal(counts[1].halves[1].needsConfirmation, 0);
});

test("9/26: both confirmed festival workers stay confirmed despite car travel and late finish", () => {
  const rows = ["p1", "p2"].map(personId => entry(personId, "26", [
    event(personId, "26", "user_confirmation", { site: "架空まつり現場", text: "二人とも勤務、車で移動", timestamp: "2099-09-26T23:00:00+09:00" })
  ], {
    workType: "日勤", clientName: "架空まつり現場", transport: "車（実際の移動）",
    memo: "22:30終了。実際の復路バス利用は不明。", review: { routeUnknown: true, fareUnknown: true }
  }));
  const value = state([rows[0]], [rows[1]]);
  rows.forEach((row, index) => {
    assert.equal(Core.reviewFor(row, `p${index + 1}`).status, "confirmed");
    assert.deepEqual(Core.reviewFor(row, `p${index + 1}`).questions, []);
  });
  Core.reconcileWorkCounts(value).forEach(row => {
    assert.equal(row.halves[1].candidates, 1);
    assert.equal(row.halves[1].needsConfirmation, 0);
  });
  const prompt = Core.buildPromptA(value);
  assert.match(prompt, /復路も現場→バス→駅として対称的に標準往復額を計算/);
  assert.match(prompt, /実際の復路バス利用有無、勤務終了時刻や最終バスに間に合ったかだけを理由に標準復路バスを削除しない/);
  assert.match(prompt, /帰りのバスに乗れたか」という不要な質問をしない/);
  assert.match(prompt, /通常存在するバス路線・停留所・運賃は自分で確認/);
});

test("confirmed work and fare-pending are separate; final output still waits for verified fare", () => {
  const row = entry("p1", "10", [event("p1", "10", "user_confirmation")], { review: { routeUnknown: true, fareUnknown: true } });
  const value = state([row]);
  value.workflow.userApproved = true;
  value.workflow.counts.p1 = { firstHalf: 1, secondHalf: 0 };
  assert.equal(Core.reviewFor(row, "p1").status, "confirmed");
  assert.equal(Core.reconcileWorkCounts(value)[0].halves[0].difference, 0);
  assert.notDeepEqual(Core.releaseBlockers(value), []);
  const prompt = Core.buildPromptA(value);
  assert.match(prompt, /勤務状態はconfirmedのままにしneeds_confirmationへ変更しない/);
  assert.match(prompt, /交通費の調査完了まで最終JSONは保留/);
  assert.match(prompt, /勤務状態（confirmed・needs_confirmation・excluded）／交通費調査状況/);
  assert.match(prompt, /ユーザーへ質問する前に、自分で資料・時系列・ルート情報から解決可能か再確認/);
  assert.match(prompt, /ユーザーへ質問せず自分で調査/);
  // Synthetic verified standard route, not a real fare quote or fare calculator.
  const ready = structuredClone(value);
  Object.assign(ready.people[0].entries[0], {
    route: "架空駅A ↔ 架空駅B ↔ 架空バス停", transport: "電車・バス",
    oneWayFare: 500, roundTripFare: 1000, review: { routeUnknown: false, fareUnknown: false }
  });
  assert.deepEqual(Core.releaseBlockers(ready), []);
  assert.equal(Core.reviewFor(ready.people[0].entries[0], "p1").status, "confirmed");
});

test("door-to-door prompt includes reasonable bus/walk tradeoffs, not cheapest-only or inflated fares", () => {
  const prompt = Core.buildPromptA(state());
  assert.match(prompt, /自宅→自宅最寄り駅は徒歩/);
  assert.match(prompt, /電車＋必要な場合はバス＋徒歩/);
  assert.match(prompt, /cheapest-onlyにしない/);
  assert.match(prompt, /徒歩負担・乗換回数・現場に近い駅/);
  assert.match(prompt, /徒歩15分以上程度で通常のバス利用が合理的ならバス/);
  assert.match(prompt, /短距離徒歩へ金額を増やすためだけのバスを追加しない/);
  assert.match(prompt, /検索リンクだけで運賃確認済みにせず/);
  assert.match(prompt, /適用日・実在路線・停留所・運賃の根拠/);
});

test("Personal policy does not leak into General mode's company-specific reimbursement", () => {
  for (const build of [Core.buildPromptA, Core.buildPromptB]) {
    const personal = build(state());
    const general = build(state([], [], "general"));
    assert.match(personal, /Personal Mode：明示済みの会社精算ルール/);
    assert.doesNotMatch(personal, /実際に使っていない電車・バスの水増しは禁止|実費基準の場合/);
    assert.match(general, /General Mode：会社ごとの精算基準/);
    assert.match(general, /Personal Modeの標準ルート精算を勝手に適用しない/);
    assert.match(general, /実費基準の場合は実際に利用した区間/);
    assert.doesNotMatch(general, /このルールは明示済みなので再質問しない|会社申請は標準往復ルート基準。/);
  }
});

test("declared 6/7 and 5/5 are reconciliation values, never fabricated work rows", () => {
  const value = state();
  value.workflow.counts = { p1: { firstHalf: 6, secondHalf: 7 }, p2: { firstHalf: 5, secondHalf: 5 } };
  const before = JSON.stringify(value);
  for (const build of [Core.buildPromptA, Core.buildPromptB]) {
    const prompt = build(value);
    assert.match(prompt, /本人：前半（1〜15日）6／後半（16〜末日）7/);
    assert.match(prompt, /父：前半（1〜15日）5／後半（16〜末日）5/);
    assert.match(prompt, /数に合わせた追加・削除・複製・推測は禁止/);
  }
  Core.reconcileWorkCounts(value).forEach(row => row.halves.forEach(half => assert.equal(half.candidates, 0)));
  assert.equal(JSON.stringify(value), before);
});

test("Prompt B preserves approved public route despite car evidence and retains its schema", () => {
  const prompt = Core.buildPromptB(state());
  assert.match(prompt, /Prompt Aで承認された標準公共交通ルートを、実際に車で移動したという資料だけを理由に変更・削除しない/);
  assert.match(prompt, /当日の帰宅手段や実際の復路バス利用有無・終便だけで承認済みの標準往復額を減らさない/);
  assert.match(prompt, /経路・運賃だけが調査中なら自分で調査を続け、JSONを保留/);
  assert.match(prompt, /明示承認不足が1つでもあれば最終JSONは出力しない/);
  assert.match(prompt, /entriesはルートではなく各people要素の中/);
  assert.deepEqual(prompt.match(/^people要素：([^。]+)。/m)[1].split("、"), [
    "id", "name", "employeeCode（文字列で先頭0を保持）", "address", "nearestStations（配列）",
    "hankoName", "showDigitalHanko", "hankoScale", "notes", "entries"
  ]);
  assert.deepEqual(prompt.match(/^entries要素：([^。]+)。/m)[1].split("、"), [
    "date", "workType", "clientName", "siteName", "siteAddress", "nearestStation", "route", "transport",
    "oneWayFare", "roundTripFare", "fareType", "verificationUrl", "memo"
  ]);
  assert.match(prompt, /新しい必須フィールドを追加しない/);
});
