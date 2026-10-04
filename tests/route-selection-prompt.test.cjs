const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const Core = require("../commute-core.js");

function state(mode = "personal", targetMonth = "2026-09") {
  return {
    targetMonth,
    people: [{ id: "p1", name: "", entries: [] }, { id: "p2", name: "", entries: [] }],
    workflow: { mode, counts: {}, userApproved: false }
  };
}
const priority = [
  "会社へ通常の通勤経路として合理的に説明できる",
  "長い徒歩・駅間徒歩が少ない",
  "乗換回数が少ない",
  "乗換が単純で、一本の電車・バスに長く乗れる",
  "現場に近い実用的な駅・バス停を使用できる",
  "所要時間",
  "運賃"
];
const improvements = [
  "乗換が1回以上減る", "8〜10分以上の駅間徒歩を避けられる", "複雑な乗換を避けられる",
  "現場までの長い徒歩を合理的なバスで減らせる", "同一路線・同一会社中心など明確に移動が楽になる"
];

test("Prompt A replaces vague cheapest-only guidance with the seven ordered priorities in both modes", () => {
  for (const mode of ["personal", "general"]) {
    const prompt = Core.buildPromptA(state(mode));
    assert.deepEqual([...prompt.matchAll(/^\d\. (.+)$/gm)].map(match => match[1]), priority);
    assert.match(prompt, /交通費の最大化も最小化も目的にしない/);
    assert.match(prompt, /運賃は最後の比較要素であり、最安値を優先してはいけない/);
    assert.doesNotMatch(prompt, /cheapest-onlyにしない/);
    assert.match(prompt, /既存JSON schemaや入力欄は追加・変更しない/);
  }
});

test("Prompt A requires three genuine candidate comparisons and a one-line adoption reason", () => {
  const prompt = Core.buildPromptA(state());
  assert.match(prompt, /可能な限り最低3つの異なる通常の公共交通ルート候補を比較してから1つ/);
  for (const label of ["A", "B", "C"]) assert.ok(prompt.includes(`候補${label}：運賃 / 時間 / 乗換 / 徒歩`));
  assert.match(prompt, /実在する候補が3つ見つからない場合は調査した範囲と不足理由/);
  assert.match(prompt, /架空候補や同一経路の重複で3つに水増ししない/);
  assert.match(prompt, /未取得の値を推測しない/);
  assert.match(prompt, /採用理由を1行で説明できるルートだけ採用/);
  assert.match(prompt, /既存の根拠・メモに、比較候補に対する時間差・乗換や徒歩負担の改善/);
});

test("Prompt A permits higher ordinary fares only with a comfort benefit and a small time difference", () => {
  const prompt = Core.buildPromptA(state());
  assert.match(prompt, /最速ルートまたは安い通常ルートと比較して所要時間差がおおむね15分以内/);
  for (const improvement of improvements) assert.ok(prompt.includes(improvement));
  assert.match(prompt, /次のいずれかがある場合は、多少運賃が高くても快適な通常ルートを優先/);
  assert.match(prompt, /「金額が高い」という理由だけで選んではいけない/);
  assert.match(prompt, /時間差が大きい場合も高額・低乗換だけを理由に自動採用せず/);
});

test("Prompt A excludes premium travel and detours, while comparing bus connections beyond the last mile", () => {
  const prompt = Core.buildPromptA(state());
  assert.match(prompt, /新幹線、有料特急、グリーン車、タクシー、明らかな大回り・不自然な迂回、実在しない交通機関は通常候補から除外/);
  assert.match(prompt, /バスは「現場最寄駅から現場」だけに限定しない/);
  assert.match(prompt, /通常運行している路線バスで主要駅へ接続し、そこから鉄道へ乗り継ぐルートも必ず候補/);
  assert.match(prompt, /現場に近い別の駅やバス停も検索/);
  assert.match(prompt, /短距離徒歩へ金額を増やすためだけのバスを追加しない/);
  assert.match(prompt, /別名の駅同士の徒歩接続も見落とさず調べる/);
  assert.match(prompt, /徒歩を強いることで数百円安くなるだけなら、自動的に安いルートを採用しない/);
});

// User-supplied September 2026 comparison fixtures, NOT verified current fares,
// personal default data, or a production route selector. Only known durations
// and transfer counts are supplied; unknown metrics stay unspecified.
// Cases assert the generated policy covers the reported comfort benefit.
const cases = [
  {
    name: "月島", cheaperFare: 794, comfortableFare: 826, cheaperTransfers: 2, comfortableTransfers: 1,
    benefit: improvements[0], requirements: [/路線バスで主要駅へ接続する経路/, /バス＋鉄道で乗換負担が明確に減り/]
  },
  {
    name: "木場", comfortableFare: 826, legs: [210, 616], benefit: improvements[2],
    requirements: [/通常運行している路線バスで主要駅へ接続/, /そこから鉄道へ乗り継ぐルートも必ず候補/]
  },
  {
    name: "亀有", cheaperFare: 885, comfortableFare: 1002, benefit: improvements[4],
    requirements: [/最安値を優先してはいけない/, /新幹線、有料特急、グリーン車/]
  },
  {
    name: "千住桜木", comfortableFare: 650, legs: [440, 210], benefit: improvements[2],
    requirements: [/現場に近い別の駅やバス停も検索/, /路線バスで主要駅へ接続する経路/]
  },
  {
    name: "三芳町", cheaperFare: 539, comfortableFare: 883, comfortableTransfers: 1,
    legs: [883, 220], combinedFare: 1103, benefit: improvements[0],
    bus: { operator: "ライフバス", fare: 220, icSupported: false },
    requirements: [/IC非対応の路線バス/, /fareTypeを既存の「現金」/, /鉄道：IC／バス：現金/]
  },
  {
    name: "駒込", cheaperFare: 530, comfortableFare: 730, cheaperTransfers: 2, comfortableTransfers: 1,
    cheaperMinutes: 39, comfortableMinutes: [47, 48], benefit: improvements[0], requirements: []
  },
  {
    name: "新井宿", cheaperFare: 790, comfortableFare: 968, avoidedStationWalkMinutes: 13,
    benefit: improvements[1], requirements: [/その徒歩を避けられる通常ルートを必ず比較/]
  }
];
for (const fixture of cases) {
  test(`2026-09 ${fixture.name}: prompt covers comfortable ordinary-route comparison without fixing its fare`, () => {
    const prompt = Core.buildPromptA(state());
    assert.ok(prompt.includes(fixture.benefit));
    assert.match(prompt, /所要時間差がおおむね15分以内/);
    assert.match(prompt, /多少運賃が高くても快適な通常ルートを優先/);
    for (const requirement of fixture.requirements) assert.match(prompt, requirement);
    if (fixture.cheaperFare !== undefined) assert.ok(fixture.comfortableFare > fixture.cheaperFare);
    if (fixture.cheaperTransfers !== undefined) assert.ok(fixture.cheaperTransfers - fixture.comfortableTransfers >= 1);
    if (fixture.comfortableMinutes) {
      fixture.comfortableMinutes.forEach(minutes => assert.ok(minutes - fixture.cheaperMinutes <= 15));
    }
    if (fixture.avoidedStationWalkMinutes) assert.ok(fixture.avoidedStationWalkMinutes >= 10);
    if (fixture.legs) assert.equal(fixture.legs.reduce((sum, value) => sum + value, 0), fixture.combinedFare ?? fixture.comfortableFare);
    if (fixture.bus?.icSupported === false) {
      assert.equal(fixture.bus.operator, "ライフバス");
      assert.equal(fixture.bus.fare, fixture.legs.at(-1));
      assert.match(prompt, /ICと扱わず既存fareTypeの「現金」を使う/);
    }
    assert.ok(!prompt.includes(String(fixture.comfortableFare)));
    assert.match(prompt, /将来の運賃や採用経路へハードコードしない/);
  });
}

test("non-IC bus and mixed payment use existing fareType values and a leg-by-leg memo", () => {
  const prompt = Core.buildPromptA(state());
  assert.match(prompt, /IC非対応の路線バス等は実在する通常運賃・支払方法を確認/);
  assert.match(prompt, /ICと扱わず既存fareTypeの「現金」を使う/);
  assert.match(prompt, /鉄道IC＋バス現金等が同一行に混在する場合はfareTypeを既存の「現金」/);
  assert.match(prompt, /各区間の金額・支払方法を明示/);
  assert.match(prompt, /全区間IC対応と記載したり、新しいfareType値を追加したりしない/);
});

test("future Prompt A does not hardcode historical example fares, sites or a selected route", () => {
  for (const month of ["2026-09", "2027-09", "2099-09"]) {
    const value = state("personal", month);
    const before = JSON.stringify(value);
    const prompt = Core.buildPromptA(value);
    assert.match(prompt, /対象月・適用日の経路と運賃を再調査/);
    for (const fixture of cases) {
      assert.ok(!prompt.includes(fixture.name));
      for (const fare of [fixture.cheaperFare, fixture.comfortableFare, ...(fixture.legs || [])].filter(Number.isFinite)) {
        assert.ok(!new RegExp(`${fare}円`).test(prompt));
      }
    }
    assert.equal(JSON.stringify(value), before);
  }
});

test("Prompt B is byte-identical to its pre-change personal/general generation", () => {
  // Captured before this Prompt A-only change, with the exact state helper above.
  const previousHashes = {
    personal: "154fd8ce89ff461a03feac12e46f2e6f39800ba694d196fbdba228d314f00391",
    general: "d796711884181b21a61dd5ca4d1d7b8d8e97828eecbc45e798db6f48c578a394"
  };
  for (const mode of ["personal", "general"]) {
    const prompt = Core.buildPromptB(state(mode));
    assert.equal(createHash("sha256").update(prompt).digest("hex"), previousHashes[mode]);
    assert.doesNotMatch(prompt, /候補A：|候補B：|候補C：/);
  }
});
