const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const Core = require("../commute-core.js");
const html = readFileSync(require.resolve("../index.html"), "utf8");
const source = readFileSync(require.resolve("../app.js"), "utf8");
function setup(mode = "personal", storage = new Map()) {
  const dom = parseHTML(html);
  const document = dom.document;
  dom.Element.prototype.scrollIntoView = function () {};
  Object.defineProperty(dom.HTMLInputElement.prototype, "validity", { configurable: true, get() { return { valid: this.type !== "number" || this.value === "" || /^\d+$/.test(this.value) }; } });
  document.querySelectorAll("dialog").forEach(dialog => { dialog.showModal = () => dialog.setAttribute("open", ""); dialog.close = () => dialog.removeAttribute("open"); });
  const location = { href: `https://example.invalid/?mode=${mode}`, search: `?mode=${mode}`, pathname: "/" };
  const window = { document, CommuteCore: Core, COMMUTE_SAMPLE_DATA: JSON.parse(readFileSync(require.resolve("../sample-data.json"))), location, setTimeout: () => 0, clearTimeout: () => {}, addEventListener: () => {}, print: () => {}, confirm: () => true };
  const context = vm.createContext({ window, document, console, Date, Intl, Math, URL, URLSearchParams, structuredClone, requestAnimationFrame: callback => callback(), history: { pushState: (_state, _title, url) => { location.href = String(url); location.search = new URL(url).search; } }, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  vm.runInContext(source, context);
  const run = script => vm.runInContext(script, context);
  const input = (selector, value) => { const element = document.querySelector(selector); element.value = value; element.dispatchEvent(new dom.Event("input", { bubbles: true })); };
  const click = id => document.getElementById(id).click();
  return { document, storage, run, input, click };
}
test("personal blank initial two people; 6/7 count input updates A and father stays blank", () => {
  const app = setup(); assert.equal(app.run("state.people.length"), 2);
  assert.ok(app.run("state.people.every(p => !p.name && !p.employeeCode && !p.address && !p.entries.length)"));
  app.input('[data-count-field="firstHalf"]', "6"); app.input('[data-count-field="secondHalf"]', "7");
  assert.match(app.document.getElementById("chatgptPromptA").textContent, /本人：前半（1〜15日）6／後半（16〜末日）7/);
  assert.match(app.document.getElementById("chatgptPromptA").textContent, /父：前半（1〜15日）未入力/);
  assert.equal(app.run("state.people[0].entries.length"), 0);
});
test("general blank one person and add another; no personal-storage fallback", () => {
  const storage = new Map([["tahmid-commute-studio-v2", JSON.stringify({ people: [{ name: "非公開テスト", employeeCode: "000010" }] })]]);
  const app = setup("general", storage); assert.equal(app.run("state.people.length"), 1); assert.equal(app.run("state.people[0].name"), "");
  app.click("loadLocalBtn"); assert.equal(app.run("state.people[0].name"), "");
  app.click("addPersonBtn"); assert.equal(app.run("state.people.length"), 2);
});
test("mode switch keeps independent drafts and counts", () => {
  const app = setup(); app.input("#employeeName", "架空本人"); app.input('[data-count-field="firstHalf"]', "6");
  app.click("saveLocalBtn"); app.click("generalModeBtn"); assert.equal(app.run("state.people.length"), 1); assert.equal(app.run("state.people[0].name"), "");
  app.input("#employeeName", "架空一般"); app.click("saveLocalBtn"); app.click("personalModeBtn");
  assert.equal(app.run("state.people[0].name"), "架空本人"); assert.equal(app.run("state.workflow.counts[state.people[0].id].firstHalf"), 6);
  assert.ok(app.storage.has("tahmid-commute-studio-v3-general")); assert.ok(app.storage.has("tahmid-commute-studio-v3-personal"));
});
test("old JSON import/export preserves fields, leading zero, dates, stamp and fares", () => {
  const app = setup(); app.run("applyImportedState(sampleState, 'fictional JSON')");
  const exported = JSON.parse(app.run("JSON.stringify(exportState())"));
  const restored = JSON.parse(app.run("JSON.stringify(normalizeData(exportState()))"));
  assert.equal(exported.people[0].employeeCode, "000001"); assert.equal(restored.people[0].entries[0].roundTripFare, exported.people[0].entries[0].roundTripFare);
  assert.equal(restored.people[0].entries[0].nearestStation, exported.people[0].entries[0].nearestStation);
  assert.equal(restored.workflow.userApproved, false);
  assert.equal(app.run("normalizeEntry({date:'2099-09-09'}).date"), "2099-09-09");
  assert.equal(app.run("normalizeEntry({date:'9月9日'}).date"), "9/9");
  assert.equal(app.run("normalizeData({document:{employee_name:'架空利用者', employee_code:'000010',target_date:{year:81,month:9}},rows:[{date:'9/9',site:'架空現場',amount:400}]}).people[0].employeeCode"), "000010");
});
test("metadata survives JSON export; unresolved data cannot be approved or printed", () => {
  const app = setup(); app.run("applyImportedState(sampleState, 'fixture'); state.people[0].entries[0].status = 'needs_confirmation'; render()");
  assert.equal(JSON.parse(app.run("JSON.stringify(exportState())")).people[0].entries[0].status, "needs_confirmation");
  app.document.getElementById("reviewApproved").checked = true;
  app.document.getElementById("reviewApproved").dispatchEvent(new (parseHTML("").Event)("change", { bubbles: true }));
  assert.equal(app.run("state.workflow.userApproved"), false);
  assert.equal(app.run("validatePeople([activePerson()], false).ok"), false);
});
test("CSV roundtrip retains old fields and optional unresolved metadata and counts", () => {
  const app = setup(); app.run("applyImportedState(sampleState,'fixture'); state.people[0].entries[0].status='needs_confirmation'; state.workflow.counts[state.people[0].id]={firstHalf:6, secondHalf:7}");
  const restored = JSON.parse(app.run("JSON.stringify(stateFromCsv(exportCsv()))"));
  assert.equal(restored.people.length, 2); assert.equal(restored.people[0].employeeCode, "000001");
  assert.equal(restored.people[0].entries[0].status, "needs_confirmation");
  assert.equal(restored.people[0].entries[0].roundTripFare, app.run("state.people[0].entries[0].roundTripFare"));
  assert.equal(restored.workflow.counts[restored.people[0].id].firstHalf, 6);
  assert.equal(restored.workflow.userApproved, false);
});
test("excluded entries stay editable but out of voucher and sums", () => {
  const app = setup(); app.run("applyImportedState(sampleState,'fixture'); state.people[0].entries[0].status='excluded'; render()");
  assert.equal(app.run("payableEntries(state.people[0]).length"), app.run("state.people[0].entries.length - 1"));
  assert.equal(app.run("Core.reconcileWorkCounts(state)[0].halves.reduce((sum,h)=>sum+h.candidates,0)"), app.run("payableEntries(state.people[0]).filter(e=>['日勤','夜勤','研修'].includes(e.workType)).length"));
});
test("two company pages remain 15/17, stamp and six-digit cells survive", () => {
  const app = setup(); app.run("applyImportedState(sampleState,'fixture')");
  const preview = app.document.getElementById("previewPages"); assert.equal(preview.querySelectorAll(".voucher-page").length, 2);
  assert.ok(preview.querySelector(".approval-grid")); assert.ok(preview.querySelector(".amount-digits")); assert.ok(preview.querySelector(".seal"));
});
