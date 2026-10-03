const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../commute-core.js");
function event(kind, site, serviceDate, timestamp = "2099-09-01T12:00:00+09:00") { return { kind, site, serviceDate, timestamp, personId: "p1", locator: "fictional-frame" }; }
function entry(values = {}) { return { id: "e1", date: "9/1", workType: "夜勤", clientName: "架空現場B", siteName: "", route: "架空駅A ↔ 架空駅B", oneWayFare: 200, roundTripFare: 400, ...values }; }
function state(entries = []) { return { targetMonth: "2099-09", people: [{ id: "p1", name: "", entries }, { id: "p2", name: "", entries: [] }], workflow: { mode: "personal", counts: { p1: { firstHalf: 6, secondHalf: 7 } }, userApproved: false } }; }
test("blank differs from declared zero; counts are not targets", () => {
  assert.equal(Core.countValue(""), null); assert.equal(Core.countValue(null), null); assert.equal(Core.countValue("0"), 0); assert.equal(Core.countValue(-1), null);
  const value = state(); const before = JSON.stringify(value);
  const prompt = Core.buildPromptA(value);
  assert.match(prompt, /本人：前半（1〜15日）6／後半（16〜末日）7/);
  assert.match(prompt, /父：前半（1〜15日）未入力／後半（16〜末日）未入力/);
  assert.equal(JSON.stringify(value), before); assert.equal(value.people[0].entries.length, 0);
});
test("changed instruction without actual-site evidence stays unresolved", () => {
  const chain = { events: [event("initial", "架空現場A"), event("change", "架空現場B", undefined, "2099-09-01T13:00:00+09:00"), event("correction", "", undefined, "2099-09-01T13:05:00+09:00")] };
  const result = Core.assessInstructionChain(chain, "p1");
  assert.equal(result.status, "needs_confirmation"); assert.deepEqual(result.sites, ["架空現場A", "架空現場B"]); assert.match(result.questions.join(""), /どちら/);
  assert.match(Core.buildPromptB(state([entry({ instructionChain: chain })])), /最終JSONは出力しない/);
});
test("initial instruction alone also cannot prove actual work", () => assert.equal(Core.assessInstructionChain({ events: [event("initial", "架空現場A")] }, "p1").status, "needs_confirmation"));
test("cancellation excluded from work counts", () => {
  const value = state([entry({ instructionChain: { events: [event("cancel", "架空現場B")] } })]);
  assert.equal(Core.reviewFor(value.people[0].entries[0], "p1").status, "excluded");
  assert.equal(Core.reconcileWorkCounts(value)[0].halves[0].candidates, 0);
});
test("night ends next morning but remains one actual service", () => {
  const chain = { id: "service1", events: [event("initial", "架空現場B"), event("departure", "架空現場B", "2099-09-01", "2099-09-01T20:00:00+09:00"), event("next_morning", "架空現場B", "2099-09-01", "2099-09-02T07:00:00+09:00")] };
  assert.equal(Core.assessInstructionChain(chain, "p1").status, "confirmed");
  const value = state([entry({ instructionChain: chain }), entry({ id: "e2", instructionChain: chain })]);
  assert.equal(Core.reconcileWorkCounts(value)[0].halves[0].candidates, 1);
});
test("conflicting body/date evidence never silently selects following day", () => {
  const chain = { dateConflict: true, events: [event("departure", "架空現場B", "2099-09-09", "2099-09-09T20:00:00+09:00"), event("next_morning", "架空現場B", "2099-09-10", "2099-09-10T07:00:00+09:00")] };
  assert.equal(Core.assessInstructionChain(chain, "p1").status, "needs_confirmation");
});
test("person attribution is independent; father not copied", () => {
  const chain = { events: [event("actual_site", "架空現場B", "2099-09-01")] };
  assert.equal(Core.assessInstructionChain(chain, "p2").status, "needs_confirmation");
  const value = state([entry({ instructionChain: chain })]); assert.equal(Core.reconcileWorkCounts(value)[1].halves[0].candidates, 0);
  assert.match(Core.buildPromptA(value), /他方の勤務／休みを推定しない/);
});
test("matching counts do not resolve unknown actual site", () => {
  const value = state([entry({ review: { status: "needs_confirmation" } })]); value.workflow.counts.p1 = { firstHalf: 1, secondHalf: null }; value.workflow.userApproved = true;
  assert.ok(Core.releaseBlockers(value).some(text => /needs_confirmation/.test(text)));
});
test("ordinary approved candidate with optional blank counts is compatible", () => {
  const value = state([entry()]); value.workflow.counts = {}; value.workflow.userApproved = true;
  assert.deepEqual(Core.releaseBlockers(value), []);
  assert.match(Core.buildPromptB(value), /entriesはルートではなく各people要素/);
});
test("after a new change, earlier departure is insufficient", () => {
  const chain = { events: [event("departure", "架空現場B", "2099-09-01"), event("change", "架空現場B", undefined, "2099-09-01T13:00:00+09:00")] };
  assert.equal(Core.assessInstructionChain(chain, "p1").status, "needs_confirmation");
});
test("date validity; same-day truly distinct services count twice; medical does not", () => {
  assert.equal(Core.serviceDate("2099-02-30", "2099-02"), null);
  const value = state([entry(), entry({ id: "e2" }), entry({ id: "e3", workType: "健康診断" })]);
  assert.equal(Core.reconcileWorkCounts(value)[0].halves[0].candidates, 2);
});
