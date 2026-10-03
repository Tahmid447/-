/* Tahmid 通勤伝票スタジオ — ブラウザ内だけで動く静的Webアプリ */
const OLD_STORAGE_KEY = "tahmid-commute-studio-v2";
const LEGACY_STORAGE_KEY = "kb2-commute-studio-v2";
const OLD_BACKUP_KEY = "tahmid-commute-studio-recovery-v1";
const Core = window.CommuteCore;
const modeFromUrl = () => new URLSearchParams(window.location.search).get("mode") === "general" || /\/general\/?$/.test(window.location.pathname) ? "general" : "personal";
let currentMode = modeFromUrl();
const storageKey = () => `tahmid-commute-studio-v3-${currentMode}`;
const backupKey = () => `tahmid-commute-studio-recovery-v3-${currentMode}`;
const draftKey = () => `tahmid-commute-studio-draft-v3-${currentMode}`;
const modeDrafts = new Map();
const PREFERENCES_KEY = "tahmid-commute-studio-preferences-v1";
const COMMON_WORK_TYPES = ["日勤", "夜勤", "研修", "健康診断", "会社用件"];
const TONE_PATTERNS = {
  click: [[410, .025, .02]],
  success: [[620, .08, .045], [830, .10, .035]],
  error: [[190, .10, .04], [150, .08, .025]],
  sample: [[520, .06, .035], [690, .07, .04], [880, .11, .04]],
  print: [[440, .05, .03], [660, .08, .04], [990, .13, .035]]
};
const el = id => document.getElementById(id);
const clone = value => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const textValue = value => value == null ? "" : String(value);
const numberValue = value => {
  const parsed = Number(String(value ?? "").replace(/[¥￥,円\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const escapeHtml = value => textValue(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
})[character]);
const yen = value => new Intl.NumberFormat("ja-JP", {
  style: "currency", currency: "JPY", maximumFractionDigits: 0
}).format(numberValue(value));
const uniqueId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const readStorage = key => {
  try { return localStorage.getItem(key); }
  catch { return null; }
};

function isoMonth(value, fallback = "") {
  const text = textValue(value).trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const reiwa = text.match(/令和\s*(\d+)\s*年\s*(\d+)\s*月/);
  if (reiwa) return `${Number(reiwa[1]) + 2018}-${String(Number(reiwa[2])).padStart(2, "0")}`;
  const western = text.match(/(\d{4})\D+(\d{1,2})/);
  if (western) return `${western[1]}-${String(Number(western[2])).padStart(2, "0")}`;
  return fallback;
}

function isoDate(value, fallback = "") {
  const text = textValue(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const reiwa = text.match(/令和\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);
  if (reiwa) return `${Number(reiwa[1]) + 2018}-${String(Number(reiwa[2])).padStart(2, "0")}-${String(Number(reiwa[3])).padStart(2, "0")}`;
  const western = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (western) return `${western[1]}-${String(Number(western[2])).padStart(2, "0")}-${String(Number(western[3])).padStart(2, "0")}`;
  return fallback;
}

function displayWorkDate(value) {
  const text = textValue(value).trim();
  const iso = text.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (iso) return `${Number(iso[1])}/${Number(iso[2])}`;
  const jp = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (jp) return `${Number(jp[1])}/${Number(jp[2])}`;
  return text;
}

function dateInputValue(value) {
  const text = textValue(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const compact = displayWorkDate(text).match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!compact || !state.targetMonth) return "";
  return `${state.targetMonth.slice(0, 4)}-${String(Number(compact[1])).padStart(2, "0")}-${String(Number(compact[2])).padStart(2, "0")}`;
}

function monthDateBounds() {
  if (!state.targetMonth) return { min: "", max: "" };
  const [year, month] = state.targetMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return { min: `${state.targetMonth}-01`, max: `${state.targetMonth}-${String(lastDay).padStart(2, "0")}` };
}

function reiwaParts(value) {
  const date = textValue(value || "2026-01-01").split("-").map(Number);
  return { year: (date[0] || 2026) - 2018, month: date[1] || 1, day: date[2] || 1 };
}

function japaneseMonth(value) {
  const parts = reiwaParts(`${isoMonth(value, "2026-01")}-01`);
  return `令和${parts.year}年${parts.month}月分`;
}

function japaneseDate(value) {
  const parts = reiwaParts(isoDate(value, "2026-01-01"));
  return `令和${parts.year}年${parts.month}月${parts.day}日`;
}

function blankEntry() {
  return {
    id: uniqueId("entry"),
    date: "",
    workType: "",
    clientName: "",
    siteName: "",
    siteAddress: "",
    nearestStation: "",
    route: "",
    transport: "電車",
    oneWayFare: 0,
    roundTripFare: 0,
    fareType: "IC",
    verificationUrl: "",
    memo: ""
  };
}

function blankPerson(index = 0) {
  return {
    id: uniqueId(`person-${index + 1}`),
    name: "",
    employeeCode: "",
    address: "",
    nearestStations: [],
    hankoName: "",
    showDigitalHanko: false,
    hankoScale: 1,
    notes: "",
    entries: []
  };
}

function blankState() {
  return {
    appVersion: "2.0",
    documentType: "commute_slip",
    targetMonth: "",
    submissionDate: "",
    companyName: "",
    demoMode: false,
    updatedAt: "",
    workflow: { mode: currentMode, counts: {}, userApproved: false, openQuestions: false },
    people: currentMode === "personal" ? [blankPerson(0), blankPerson(1)] : [blankPerson()]
  };
}

function normalizeEntry(entry = {}) {
  const oneWayFare = numberValue(entry.oneWayFare ?? entry.one_way_fare ?? entry.one_way_ic_yen ?? entry["片道運賃"] ?? entry["片道IC運賃"]);
  const roundTripFare = numberValue(entry.roundTripFare ?? entry.round_trip_fare ?? entry.amount ?? entry.payable_yen ?? entry["往復金額"] ?? entry["請求額"]);
  const legacySite = textValue(entry.site ?? entry.workplace ?? entry.company ?? entry["勤務先"] ?? entry["勤務先・現場"]);
  return {
    id: textValue(entry.id || uniqueId("entry")),
    date: /^\d{4}-\d{2}-\d{2}$/.test(textValue(entry.date)) ? entry.date : displayWorkDate(entry.display_date ?? entry.date ?? entry["勤務日"]),
    workType: textValue(entry.workType ?? entry.shift ?? entry.category ?? entry["区分"]),
    clientName: textValue(entry.clientName ?? entry.client_name ?? entry["勤務先名"] ?? legacySite),
    siteName: textValue(entry.siteName ?? entry.site_name ?? entry["現場名"]),
    siteAddress: textValue(entry.siteAddress ?? entry.address ?? entry.location ?? entry.nearest ?? entry["現場住所"] ?? entry["住所・最寄り"]),
    nearestStation: textValue(entry.nearestStation ?? entry.nearest_station ?? entry["現場最寄り駅"] ?? entry["到着駅"]),
    route: textValue(entry.route ?? entry.section ?? entry["通勤区間"] ?? entry["区間"]),
    transport: textValue(entry.transport ?? entry.bus ?? entry["交通手段"] ?? "電車"),
    oneWayFare,
    roundTripFare: roundTripFare || (oneWayFare ? oneWayFare * 2 : 0),
    fareType: textValue(entry.fareType ?? entry.fare_type ?? entry["運賃種別"] ?? "IC"),
    verificationUrl: textValue(entry.verificationUrl ?? entry.verification_url ?? entry["確認リンク"]),
    memo: textValue(entry.memo ?? entry.note ?? entry["備考"]),
    ...(entry.status ? { status: textValue(entry.status) } : {}),
    ...(entry.review && typeof entry.review === "object" ? { review: clone(entry.review) } : {}),
    ...(entry.instructionChain && typeof entry.instructionChain === "object" ? { instructionChain: clone(entry.instructionChain) } : {}),
    ...(entry.serviceId ? { serviceId: textValue(entry.serviceId) } : {}),
    ...(typeof entry.countsAsWork === "boolean" ? { countsAsWork: entry.countsAsWork } : {})
  };
}

function normalizePerson(person = {}, index = 0) {
  const stationsRaw = person.nearestStations ?? person.home_stations ?? person.homeStation ?? person.default_home_station ?? person.home_station ?? person["最寄り駅"] ?? [];
  const stations = Array.isArray(stationsRaw)
    ? stationsRaw.map(textValue).filter(Boolean)
    : textValue(stationsRaw).split(/[、,]/).map(item => item.trim()).filter(Boolean);
  const entriesRaw = person.entries ?? person.rows ?? [];
  return {
    id: textValue(person.id || uniqueId(`person-${index + 1}`)),
    label: textValue(person.label),
    name: textValue(person.name ?? person.employee_name ?? person["氏名"]),
    employeeCode: textValue(person.employeeCode ?? person.code ?? person.employee_code ?? person["社員コード"]),
    address: textValue(person.address ?? person.home_address ?? person["住所"]),
    nearestStations: stations,
    hankoName: textValue(person.hankoName ?? person.hanko_name ?? person["印鑑名"]),
    showDigitalHanko: Boolean(person.showDigitalHanko ?? person.show_digital_hanko ?? false),
    hankoScale: Math.min(1.5, Math.max(1, numberValue(person.hankoScale ?? person.hanko_scale ?? 1) || 1)),
    notes: textValue(person.notes ?? person.note ?? person.memo ?? person["備考"]),
    entries: Array.isArray(entriesRaw) ? entriesRaw.map(normalizeEntry) : []
  };
}

function normalizeData(input) {
  const raw = input && typeof input === "object" ? input : {};
  if (Array.isArray(raw.records)) throw new Error("証拠台帳はそのまま読み込めません。未確認事項を解決し、承認後に既存people/entries形式へ変換してください。");
  if (raw.document?.employee_name && Array.isArray(raw.rows)) {
    const target = raw.document.target_date || {};
    const submitted = raw.document.submission_date || {};
    return {
      appVersion: "2.0",
      documentType: "commute_slip",
      targetMonth: `${Number(target.year || 8) + 2018}-${String(Number(target.month || 1)).padStart(2, "0")}`,
      submissionDate: `${Number(submitted.year || 8) + 2018}-${String(Number(submitted.month || 1)).padStart(2, "0")}-${String(Number(submitted.day || 1)).padStart(2, "0")}`,
      companyName: textValue(raw.companyName ?? raw.company_name),
      demoMode: false,
      updatedAt: "",
      people: [normalizePerson({
        id: raw.document.employee_code,
        name: raw.document.employee_name,
        employeeCode: raw.document.employee_code,
        address: raw.address,
        nearestStations: raw.home_station ? [raw.home_station] : [],
        entries: raw.rows
      })]
    };
  }
  const documentInfo = raw.document || {};
  const peopleRaw = Array.isArray(raw.people) ? raw.people : (raw.person ? [raw.person] : []);
  const people = peopleRaw.length ? peopleRaw.map(normalizePerson) : [blankPerson()];
  if (new Set(people.map(person => person.id)).size !== people.length) throw new Error("対象者IDが重複しています。人物別のデータを確認してください。");
  const counts = {};
  people.forEach(person => {
    const value = raw.workflow?.counts?.[person.id] || {};
    counts[person.id] = { firstHalf: Core.countValue(value.firstHalf), secondHalf: Core.countValue(value.secondHalf) };
  });
  return {
    appVersion: textValue(raw.appVersion ?? raw.app_schema_version ?? raw.schema_version ?? "2.0"),
    documentType: textValue(raw.documentType ?? "commute_slip"),
    targetMonth: isoMonth(raw.targetMonth ?? raw.target_month ?? documentInfo.target_month_iso, ""),
    submissionDate: isoDate(raw.submissionDate ?? raw.submission_date ?? documentInfo.submission_date, ""),
    companyName: textValue(raw.companyName ?? raw.company_name ?? documentInfo.company),
    demoMode: Boolean(raw.demoMode ?? raw.demo_mode ?? false),
    updatedAt: textValue(raw.updatedAt ?? raw.updated_at),
    workflow: { mode: currentMode, counts, userApproved: false, openQuestions: Boolean(raw.workflow?.openQuestions) || raw.status === "needs_confirmation", invalidCounts: Array.isArray(raw.workflow?.invalidCounts) ? raw.workflow.invalidCounts : [] },
    people
  };
}

const sampleState = normalizeData(window.COMMUTE_SAMPLE_DATA || blankState());
let state = blankState();
if (window.COMMUTE_INITIAL_DATA) state = normalizeData(window.COMMUTE_INITIAL_DATA);
let activePersonId = state.people[0].id;
let invalidRows = new Set();
let audioContext = null;
let audioUnlocked = false;
let soundMuted = false;
let soundVolume = .4;
let pendingDestructiveAction = "new";

try {
  const preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
  soundMuted = Boolean(preferences.soundMuted);
  soundVolume = Math.min(1, Math.max(0, numberValue(preferences.soundVolume ?? .4)));
  document.body.dataset.fontSize = ["standard", "large", "xlarge"].includes(preferences.fontSize) ? preferences.fontSize : "standard";
}
catch { document.body.dataset.fontSize = "standard"; }

function activePerson() {
  return state.people.find(person => person.id === activePersonId) || state.people[0];
}

function markEdited(saveBackup = true) {
  state.workflow ||= { mode: currentMode, counts: {}, userApproved: false, openQuestions: false };
  state.workflow.userApproved = false;
  state.updatedAt = new Date().toISOString();
  state.demoMode = false;
  el("lastEdited").textContent = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date(state.updatedAt));
  if (saveBackup) saveRecoveryBackup("自動バックアップ");
  renderPlanning(false);
}

function saveRecoveryBackup(reason = "バックアップ") {
  try {
    localStorage.setItem(backupKey(), JSON.stringify({ reason, savedAt: new Date().toISOString(), data: exportState() }));
  }
  catch { /* 保存できない環境でも編集は継続する */ }
}

function savePreferences() {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ soundMuted, soundVolume, fontSize: document.body.dataset.fontSize || "standard" }));
  }
  catch { /* 設定保存不可でも操作は継続する */ }
}

function unlockAudio() {
  if (audioUnlocked) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) {
    audioContext = new AudioContextClass();
    audioUnlocked = true;
    return;
  }
  try { audioUnlocked = typeof document.createElement("audio").play === "function"; }
  catch { audioUnlocked = false; }
}

function wavToneUrl(kind) {
  const sampleRate = 8000;
  const pattern = TONE_PATTERNS[kind] || TONE_PATTERNS.click;
  const gapSeconds = .018;
  const totalSeconds = pattern.reduce((sum, item) => sum + item[1] + gapSeconds, 0);
  const sampleCount = Math.ceil(totalSeconds * sampleRate);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  writeText(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); writeText(8, "WAVE");
  writeText(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeText(36, "data"); view.setUint32(40, sampleCount * 2, true);
  let cursor = 0;
  pattern.forEach(([frequency, duration, volume]) => {
    const frames = Math.floor(duration * sampleRate);
    for (let index = 0; index < frames; index += 1) {
      const attack = Math.min(1, index / Math.max(1, sampleRate * .008));
      const release = Math.min(1, (frames - index) / Math.max(1, sampleRate * .018));
      const sample = Math.sin(2 * Math.PI * frequency * index / sampleRate) * Math.min(.45, volume * 8) * attack * release;
      view.setInt16(44 + (cursor + index) * 2, Math.round(sample * 32767), true);
    }
    cursor += frames + Math.floor(gapSeconds * sampleRate);
  });
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function playFallbackTone(kind) {
  try {
    const url = wavToneUrl(kind);
    const audio = document.createElement("audio");
    audio.src = url;
    audio.volume = Math.min(1, Math.max(0, soundVolume));
    const release = () => URL.revokeObjectURL(url);
    audio.addEventListener("ended", release, { once: true });
    audio.play().catch(release);
  }
  catch { /* 音声非対応でも操作は継続する */ }
}

function playTone(kind = "click") {
  if (!audioUnlocked || soundMuted || soundVolume <= 0) return;
  if (!audioContext) { playFallbackTone(kind); return; }
  let offset = 0;
  (TONE_PATTERNS[kind] || TONE_PATTERNS.click).forEach(([frequency, duration, volume]) => {
    const now = audioContext.currentTime + offset;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = kind === "error" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume * soundVolume), now + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + .015);
    offset += duration * .72;
  });
}

document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("click", event => {
  if (event.target.closest("button, .file-button, .row-action.verify") && !event.target.closest("#muteBtn")) playTone("click");
});

function showToast(message, kind = "default") {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.toggle("error", kind === "error");
  toast.classList.add("show");
  if (["success", "sample", "print", "error"].includes(kind)) playTone(kind);
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2300);
}

function setStatus(title, detail) {
  el("statusTitle").textContent = title;
  el("statusDetail").textContent = detail;
}

function renderPeople() {
  el("peopleList").innerHTML = state.people.map((person, index) => {
    const visibleName = person.name || Core.labelFor(person, index, currentMode);
    const initial = visibleName.replace(/[\s　]/g, "").slice(0, 1) || "人";
    return `<button class="person-card ${person.id === activePersonId ? "active" : ""}" data-person="${escapeHtml(person.id)}" type="button">
      <span class="person-initial">${escapeHtml(initial)}</span>
      <span><strong>${escapeHtml(visibleName)}</strong><small>${escapeHtml(person.employeeCode || "コード未入力")}</small>${state.demoMode ? '<span class="demo-chip">架空デモ</span>' : ""}</span>
    </button>`;
  }).join("");
  document.querySelectorAll("[data-person]").forEach(button => button.addEventListener("click", () => {
    activePersonId = button.dataset.person;
    invalidRows = new Set();
    render();
  }));
}

function renderPlanning(rebuildInputs = true) {
  state.workflow ||= { mode: currentMode, counts: {}, userApproved: false, openQuestions: false };
  state.workflow.counts ||= {};
  el("modeBadge").textContent = currentMode === "personal" ? "自分・家族用" : "一般の警備員用";
  ["personal", "general"].forEach(mode => el(`${mode}ModeBtn`).setAttribute("aria-pressed", String(currentMode === mode)));
  if (rebuildInputs) el("workCountsForm").innerHTML = state.people.map((person, index) => {
    const counts = state.workflow.counts[person.id] || {};
    const label = Core.labelFor(person, index, currentMode);
    return `<fieldset class="count-person"><legend>${escapeHtml(label)}</legend><label>対象者ラベル<input data-count-person="${escapeHtml(person.id)}" data-count-field="label" value="${escapeHtml(person.label || label)}" placeholder="対象者ラベル／名前" maxlength="80"></label>${[["firstHalf", "前半（1〜15日）"], ["secondHalf", "後半（16〜末日）"]].map(([field, title]) => `<label>${title}<input type="number" min="0" step="1" inputmode="numeric" data-count-person="${escapeHtml(person.id)}" data-count-field="${field}" value="${counts[field] ?? ""}" placeholder="未入力（任意）"></label>`).join("")}</fieldset>`;
  }).join("");
  else el("workCountsForm").querySelectorAll("fieldset").forEach((fieldset, index) => {
    const person = state.people[index];
    if (!person) return;
    const label = Core.labelFor(person, index, currentMode);
    fieldset.querySelector("legend").textContent = label;
    if (!person.label) fieldset.querySelector('[data-count-field="label"]').value = label;
  });
  el("workCountsResult").innerHTML = Core.reconcileWorkCounts(state).flatMap(row => row.halves.map((half, i) => `<tr class="${half.needsConfirmation || half.difference !== null && half.difference !== 0 ? "count-warning" : ""}"><td>${escapeHtml(row.label)}</td><td>${i ? "後半" : "前半"}</td><td>${half.declared ?? "未入力"}</td><td>${half.candidates}</td><td>${half.needsConfirmation}${row.unplaced ? `（期間不明${row.unplaced}）` : ""}</td><td>${half.difference === null ? "未入力" : half.difference > 0 ? `+${half.difference}` : half.difference}</td></tr>`)).join("");
  el("instructionReview").innerHTML = state.people.flatMap((person, index) => person.entries.flatMap(entry => {
    if (!entry.instructionChain && !entry.review && !entry.status) return [];
    const review = Core.reviewFor(entry, person.id);
    return [`<details ${review.status === "needs_confirmation" ? "open" : ""}><summary>${escapeHtml(Core.labelFor(person, index, currentMode))} ${escapeHtml(displayWorkDate(entry.date))} — ${escapeHtml(review.status)}</summary><p>指示現場：${escapeHtml(review.sites.join(" → ") || "記録なし")}／実勤務：${escapeHtml(review.actualSite || "未確認")}／開始日：${escapeHtml(review.serviceDate || "未確認")}</p><ul>${review.questions.map(q => `<li>${escapeHtml(q)}</li>`).join("")}</ul><p>証拠を再確認し、修正済みデータを再読込してください。欄編集だけでは指示履歴の要確認状態は消えません。</p></details>`];
  })).join("");
  el("openQuestions").checked = state.workflow.openQuestions;
  el("reviewApproved").checked = state.workflow.userApproved;
  const blockers = Core.releaseBlockers(state, { approval: false });
  el("approvalStatus").textContent = state.workflow.userApproved ? "承認済み。印刷時も再チェックします。編集すると承認は解除されます。" : blockers.length ? `未承認：${blockers.length}件の未解決事項。Prompt Aで確認してください。` : "未承認：候補表と根拠を照合し、記入承認をチェックしてください。";
  el("chatgptPromptA").textContent = Core.buildPromptA(state);
  el("chatgptPromptB").textContent = Core.buildPromptB(state);
}

el("workCountsForm").addEventListener("input", event => {
  const person = state.people.find(p => p.id === event.target.dataset.countPerson);
  if (!person) return;
  const field = event.target.dataset.countField;
  if (field === "label") person.label = event.target.value;
  else {
    const invalidKey = `${person.id}:${field}`;
    state.workflow.invalidCounts = (state.workflow.invalidCounts || []).filter(key => key !== invalidKey);
    if (!event.target.validity.valid || event.target.value !== "" && Core.countValue(event.target.value) === null) { event.target.setAttribute("aria-invalid", "true"); state.workflow.invalidCounts.push(invalidKey); markEdited(); return; }
    event.target.removeAttribute("aria-invalid");
    state.workflow.counts[person.id] ||= { firstHalf: null, secondHalf: null };
    state.workflow.counts[person.id][field] = Core.countValue(event.target.value);
  }
  markEdited();
  if (field === "label") renderPeople();
});
el("openQuestions").addEventListener("change", event => { state.workflow.openQuestions = event.target.checked; markEdited(); });
el("reviewApproved").addEventListener("change", event => {
  const blockers = Core.releaseBlockers(state, { approval: false });
  if (event.target.checked && blockers.length) { showToast("未解決事項があるため承認できません", "error"); renderValidation(blockers.map(message => ({ level: "error", message }))); state.workflow.userApproved = false; }
  else state.workflow.userApproved = event.target.checked;
  renderPlanning(false);
});

function switchMode(mode, updateUrl = true) {
  if (mode === currentMode) return;
  const draft = exportState();
  modeDrafts.set(currentMode, draft);
  try { localStorage.setItem(draftKey(), JSON.stringify(draft)); } catch { /* memory fallback */ }
  currentMode = mode;
  const saved = modeDrafts.get(mode) || readStorage(draftKey());
  try { state = saved ? normalizeData(typeof saved === "string" ? JSON.parse(saved) : saved) : blankState(); }
  catch { state = blankState(); }
  activePersonId = state.people[0].id;
  invalidRows = new Set();
  if (updateUrl) {
    const url = new URL(window.location.href); url.searchParams.set("mode", mode);
    try { history.pushState(null, "", url); } catch { /* file URL restrictions */ }
  }
  render(); el("validationPanel").hidden = true;
  setStatus(`${mode === "personal" ? "自分・家族用" : "一般の警備員用"}へ切替`, "他モードの保存データは読み込みません");
}
el("personalModeBtn").addEventListener("click", () => switchMode("personal"));
el("generalModeBtn").addEventListener("click", () => switchMode("general"));
window.addEventListener("popstate", () => switchMode(modeFromUrl(), false));
function payableEntries(person) { return person.entries.filter(entry => Core.reviewFor(entry, person.id).status !== "excluded"); }

function rowInput(field, value, type = "text", extra = "") {
  return `<input data-field="${field}" type="${type}" value="${escapeHtml(value)}" ${extra}>`;
}

function workTypeEditor(entry) {
  const isCommon = COMMON_WORK_TYPES.includes(entry.workType);
  const choice = isCommon ? entry.workType : (entry.workType ? "その他" : "");
  const options = ["", ...COMMON_WORK_TYPES, "その他"].map(value => `<option value="${value}" ${value === choice ? "selected" : ""}>${value || "選択"}</option>`).join("");
  return `<div class="work-type-stack"><select data-field="workTypeChoice" aria-label="勤務区分">${options}</select><input class="work-type-custom" data-field="workType" value="${escapeHtml(isCommon ? "" : entry.workType)}" placeholder="その他の区分" ${choice === "その他" ? "" : "hidden"}></div>`;
}

function fareTypeEditor(entry, index) {
  const value = entry.fareType === "現金" ? "現金" : "IC";
  return `<div class="fare-toggle" role="group" aria-label="運賃種別"><button type="button" data-fare-choice="IC" data-row-index="${index}" class="${value === "IC" ? "active" : ""}" aria-pressed="${value === "IC"}">IC</button><button type="button" data-fare-choice="現金" data-row-index="${index}" class="${value === "現金" ? "active" : ""}" aria-pressed="${value === "現金"}">現金</button></div>`;
}

function renderForm() {
  const person = activePerson();
  el("employeeName").value = person.name;
  el("employeeCode").value = person.employeeCode;
  el("targetMonth").value = state.targetMonth;
  el("submissionDate").value = state.submissionDate;
  el("companyName").value = state.companyName;
  el("nearestStations").value = person.nearestStations.join("、");
  el("employeeAddress").value = person.address;
  el("hankoName").value = person.hankoName;
  el("showDigitalHanko").checked = person.showDigitalHanko;
  el("hankoScale").value = Math.round(person.hankoScale * 100);
  el("hankoScaleValue").textContent = `${Math.round(person.hankoScale * 100)}%`;
  el("hankoPreview").textContent = person.hankoName || "印";
  el("hankoPreview").style.setProperty("--hanko-scale", person.hankoScale);
  el("hankoPreview").classList.toggle("disabled", !person.showDigitalHanko);
  el("employeeNote").value = person.notes;

  el("rowsBody").innerHTML = person.entries.map((entry, index) => {
    const verifyLinks = verificationLinksFor(entry, person);
    return `<tr data-row="${index}" class="${invalidRows.has(index) ? "invalid" : ""}">
      <td data-label="勤務日">${rowInput("date", dateInputValue(entry.date), "date", `data-target-month="${escapeHtml(state.targetMonth)}"`)}</td>
      <td data-label="区分">${workTypeEditor(entry)}</td>
      <td data-label="勤務先名">${rowInput("clientName", entry.clientName, "text", 'placeholder="取引先・会社名"')}</td>
      <td data-label="現場名">${rowInput("siteName", entry.siteName, "text", 'placeholder="実際の現場名"')}</td>
      <td data-label="通勤区間">${rowInput("route", entry.route, "text", 'placeholder="駅A ↔ 駅B"')}</td>
      <td data-label="片道運賃">${rowInput("oneWayFare", entry.oneWayFare, "number", 'min="0" step="1"')}</td>
      <td data-label="往復金額">${rowInput("roundTripFare", entry.roundTripFare, "number", 'min="0" step="1"')}</td>
      <td data-label="運賃種別">${fareTypeEditor(entry, index)}</td>
      <td data-label="詳細"><div class="row-details">
        ${rowInput("siteAddress", entry.siteAddress, "text", 'placeholder="現場住所"')}
        ${rowInput("nearestStation", entry.nearestStation, "text", 'placeholder="現場の最寄り駅"')}
        ${rowInput("transport", entry.transport, "text", 'placeholder="交通手段"')}
        ${rowInput("verificationUrl", entry.verificationUrl, "url", 'placeholder="その他の確認URL（任意）"')}
        ${rowInput("memo", entry.memo, "text", 'placeholder="備考"')}
      </div></td>
      <td data-label="操作"><div class="row-actions">
        <button class="row-action" data-edit="${index}" type="button">編集</button>
        <a class="row-action verify google" href="${escapeHtml(verifyLinks.google)}" target="_blank" rel="noopener noreferrer" title="Google Mapsで現場までのルートを確認">Googleで確認</a>
        <a class="row-action verify yahoo" href="${escapeHtml(verifyLinks.yahoo)}" target="_blank" rel="noopener noreferrer" title="Yahoo!路線情報で乗換と運賃を確認">Yahoo!で運賃</a>
        <a class="row-action verify registered" href="${escapeHtml(verifyLinks.registered || "#")}" target="_blank" rel="noopener noreferrer" title="入力したその他の確認URLを開く" ${verifyLinks.registered ? "" : "hidden"}>入力済みURL</a>
        <button class="row-action" data-duplicate-row="${index}" type="button">複製</button>
        <button class="row-action remove" data-remove-row="${index}" type="button">削除</button>
      </div></td>
    </tr>`;
  }).join("");

  el("rowsBody").querySelectorAll("input[data-field], select[data-field]").forEach(input => input.addEventListener("input", event => {
    const rowElement = event.target.closest("tr");
    const index = Number(rowElement.dataset.row);
    const field = event.target.dataset.field;
    const entry = person.entries[index];
    if (field === "workTypeChoice") {
      const custom = rowElement.querySelector(".work-type-custom");
      if (event.target.value === "その他") {
        if (COMMON_WORK_TYPES.includes(entry.workType)) entry.workType = "";
        custom.hidden = false;
        custom.value = entry.workType;
      }
      else {
        entry.workType = event.target.value;
        custom.hidden = true;
        custom.value = "";
      }
    }
    else entry[field] = ["oneWayFare", "roundTripFare"].includes(field) ? numberValue(event.target.value) : event.target.value;
    if (field === "oneWayFare") {
      entry.roundTripFare = entry.oneWayFare * 2;
      rowElement.querySelector('[data-field="roundTripFare"]').value = entry.roundTripFare;
    }
    if (["route", "siteAddress", "siteName", "clientName", "nearestStation", "verificationUrl"].includes(field)) {
      applyVerificationLinks(rowElement, entry, person);
    }
    invalidRows.delete(index);
    rowElement.classList.remove("invalid");
    markEdited();
    setStatus("編集中", "変更はプレビューと合計へ反映されています");
    renderPeople();
    renderSummaryAndPreview();
  }));

  el("rowsBody").querySelectorAll("[data-fare-choice]").forEach(button => button.addEventListener("click", () => {
    const index = Number(button.dataset.rowIndex);
    person.entries[index].fareType = button.dataset.fareChoice;
    button.parentElement.querySelectorAll("button").forEach(item => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    markEdited();
    renderSummaryAndPreview();
    setStatus("編集中", `運賃種別を${button.dataset.fareChoice}へ変更しました`);
  }));

  el("rowsBody").querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => {
    button.closest("tr").querySelector("input")?.focus();
    showToast("この行を直接編集できます");
  }));
  el("rowsBody").querySelectorAll("[data-duplicate-row]").forEach(button => button.addEventListener("click", () => {
    const index = Number(button.dataset.duplicateRow);
    const copy = clone(person.entries[index]);
    copy.status = "needs_confirmation";
    copy.review = { status: "needs_confirmation", questions: ["複製行が独立した実勤務か、対象者・日付・現場を確認してください。"] };
    copy.id = uniqueId("entry");
    person.entries.splice(index + 1, 0, copy);
    markEdited();
    render();
    showToast("勤務を1件複製しました", "success");
  }));
  el("rowsBody").querySelectorAll("[data-remove-row]").forEach(button => button.addEventListener("click", () => {
    saveRecoveryBackup("勤務削除前");
    person.entries.splice(Number(button.dataset.removeRow), 1);
    invalidRows = new Set();
    markEdited(false);
    render();
    showToast("勤務を1件削除しました");
  }));
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  }
  catch {
    return "";
  }
}

function verificationLinksFor(entry, person) {
  const registered = safeHttpUrl(entry.verificationUrl);
  const routeStations = entry.route.split("↔").map(value => value.trim()).filter(Boolean);
  const origin = routeStations[0] || person.nearestStations[0] || "出発駅";
  const destinationStation = entry.nearestStation || routeStations.at(-1) || entry.siteName || entry.clientName || "到着駅";
  const googleDestination = entry.siteAddress || destinationStation;
  return {
    registered,
    google: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(googleDestination)}&travelmode=transit`,
    yahoo: `https://transit.yahoo.co.jp/search/result/${encodeURIComponent(origin)}-${encodeURIComponent(destinationStation)}`
  };
}

function applyVerificationLinks(rowElement, entry, person) {
  const links = verificationLinksFor(entry, person);
  const google = rowElement.querySelector(".row-action.google");
  const yahoo = rowElement.querySelector(".row-action.yahoo");
  const registered = rowElement.querySelector(".row-action.registered");
  google.href = links.google;
  yahoo.href = links.yahoo;
  registered.href = links.registered || "#";
  registered.hidden = !links.registered;
}

function amountDigits(value, blank = false) {
  const amount = Math.max(0, Math.trunc(numberValue(value)));
  const padded = blank ? "      " : String(amount).slice(-6).padStart(6, " ");
  return `<div class="amount-digits">${[...padded].map(digit => `<span>${digit.trim()}</span>`).join("")}</div>`;
}

function fareLine(entry) {
  const oneWay = numberValue(entry.oneWayFare);
  const roundTrip = numberValue(entry.roundTripFare);
  const type = entry.fareType || "IC";
  if (!oneWay && !roundTrip) return "";
  if (oneWay && roundTrip === oneWay * 2) return `${type} ${oneWay}円×2`;
  if (oneWay) return `${type} 片道${oneWay}円／請求${roundTrip}円`;
  return `${type} 請求${roundTrip}円`;
}

function voucherPage(person, entries, pageNumber) {
  const capacity = pageNumber === 1 ? 15 : 17;
  const pageTotal = entries.reduce((sum, entry) => sum + numberValue(entry.roundTripFare), 0);
  const grandTotal = payableEntries(person).reduce((sum, entry) => sum + numberValue(entry.roundTripFare), 0);
  const blankRows = Math.max(0, capacity - entries.length);
  const rows = entries.map(entry => {
    const siteTitle = [entry.clientName, entry.siteName].filter(Boolean).join("・");
    return `<tr class="voucher-row">
      <td class="date-cell">${escapeHtml(displayWorkDate(entry.date))}<br>${escapeHtml(entry.workType)}</td>
      <td class="site-cell"><div class="site-text-wrap"><span class="row-site">${escapeHtml(siteTitle)}</span><span class="row-address">${escapeHtml(entry.siteAddress)}</span></div></td>
      <td class="route-label-cell"><div>区間</div><div>運賃</div></td>
      <td class="route-info-cell"><div class="route-main">${escapeHtml(entry.route)}</div><div class="fare-main">${escapeHtml(fareLine(entry))}</div></td>
      <td class="amount-cell">${amountDigits(entry.roundTripFare)}</td>
    </tr>`;
  }).join("");
  const blanks = Array.from({ length: blankRows }, () => `<tr class="voucher-row blank-row">
    <td class="date-cell"></td><td class="site-cell"></td>
    <td class="route-label-cell"><div>区間</div><div>運賃</div></td>
    <td class="route-info-cell"><div></div><div></div></td>
    <td class="amount-cell">${amountDigits(0, true)}</td>
  </tr>`).join("");
  const target = state.targetMonth ? reiwaParts(`${state.targetMonth}-01`) : { year: "　", month: "　" };
  const submission = state.submissionDate ? reiwaParts(state.submissionDate) : { year: "　", month: "　", day: "　" };
  const seal = person.showDigitalHanko && person.hankoName
    ? `<span class="seal digital" style="--hanko-scale:${person.hankoScale}">${escapeHtml(person.hankoName)}</span>`
    : '<span class="seal">印</span>';
  return `<article class="voucher-page ${pageNumber === 1 ? "page-one" : "page-two"}" data-print-person="${escapeHtml(person.id)}" data-print-page="${pageNumber}">
    ${pageNumber === 1 ? `<div class="voucher-topline">提出月日　令和　${submission.year} 年　${submission.month} 月　${submission.day} 日</div>
      <div class="approval-grid" aria-label="社内承認欄"><div class="approval-cell"><span>所属長</span></div><div class="approval-cell"><span>指令室</span></div><div class="approval-cell"><span>経　理</span></div></div>
      <h3 class="voucher-title">通勤費伝票（令和　${target.year} 年　${target.month} 月分）</h3>` : ""}
    <div class="voucher-form">
      ${pageNumber === 1 ? `<div class="voucher-meta">
        <div class="meta-label">総合計</div><div class="meta-value grand-total-value">${person.entries.length ? grandTotal : ""}</div>
        <div class="meta-label">コード</div><div class="meta-value">${escapeHtml(person.employeeCode)}</div>
        <div class="meta-label">氏名</div><div class="meta-value name">${escapeHtml(person.name)}${seal}</div>
      </div>` : ""}
      <table class="voucher-table">
        <colgroup><col class="date-col"><col class="site-col"><col class="label-col"><col class="route-col"><col class="amount-col"></colgroup>
        <thead><tr><th>勤務月日</th><th>勤　務　先　名</th><th colspan="2">請　求　区　間・運　賃</th><th>金　額</th></tr></thead>
        <tbody>${rows}${blanks}<tr class="voucher-total"><td></td><td></td><td colspan="2" class="page-total-label">頁計</td><td class="amount-cell">${amountDigits(pageTotal, entries.length === 0)}</td></tr></tbody>
      </table>
    </div>
    <div class="voucher-footer">${escapeHtml(state.companyName)}</div>
  </article>`;
}

function pagesForPerson(person) {
  return [
    voucherPage(person, payableEntries(person).slice(0, 15), 1),
    voucherPage(person, payableEntries(person).slice(15, 32), 2)
  ].join("");
}

function renderSummaryAndPreview() {
  const person = activePerson();
  const total = payableEntries(person).reduce((sum, entry) => sum + numberValue(entry.roundTripFare), 0);
  const allTotal = state.people.reduce((peopleSum, item) => peopleSum + payableEntries(item).reduce((sum, entry) => sum + numberValue(entry.roundTripFare), 0), 0);
  el("selectedTotal").textContent = yen(total);
  el("selectedRows").textContent = `${person.entries.length}件`;
  el("allPeopleTotal").textContent = yen(allTotal);
  el("pageCount").textContent = "2ページ（会社様式）";
  const preview = el("previewPages");
  preview.classList.add("updating");
  preview.innerHTML = pagesForPerson(person);
  requestAnimationFrame(() => preview.classList.remove("updating"));
}

function render() {
  if (!state.people.length) state.people = [blankPerson()];
  if (!state.people.some(person => person.id === activePersonId)) activePersonId = state.people[0].id;
  renderPeople();
  renderForm();
  renderSummaryAndPreview();
  renderPlanning();
  el("lastEdited").textContent = state.updatedAt
    ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date(state.updatedAt))
    : "未編集";
}

function validatePeople(people, announce = true) {
  const results = [];
  const scoped = { ...state, people };
  Core.releaseBlockers(scoped).forEach(message => results.push({ level: "error", message }));
  invalidRows = new Set();
  if (!state.targetMonth) results.push({ level: "error", message: "対象月が未入力です。" });
  if (!state.submissionDate) results.push({ level: "error", message: "提出日が未入力です。" });
  if (!state.companyName.trim()) results.push({ level: "error", message: "会社名が未入力です。" });

  people.forEach(person => {
    const label = person.name || "氏名未入力の対象者";
    if (!person.name.trim()) results.push({ level: "error", message: "氏名が未入力です。" });
    if (!person.employeeCode.trim()) results.push({ level: "error", message: `${label}：社員コードが未入力です。` });
    if (!person.entries.length) results.push({ level: "error", message: `${label}：勤務明細がありません。` });
    if (person.entries.length > 32) results.push({ level: "error", message: `${label}：会社様式2ページの上限32件を超えています。` });
    if (person.showDigitalHanko && !person.hankoName.trim()) results.push({ level: "error", message: `${label}：印鑑を表示する場合は印鑑名が必要です。` });
    if (!person.showDigitalHanko) results.push({ level: "warning", message: `${label}：デジタル印鑑は非表示です。必要なら表示をオンにしてください。` });

    const seenDates = new Set();
    person.entries.forEach((entry, index) => {
      if (Core.reviewFor(entry, person.id).status === "excluded") return;
      const rowNumber = index + 1;
      let invalid = false;
      if (!entry.date.trim()) { results.push({ level: "error", message: `${label}・${rowNumber}行目：勤務日が空です。` }); invalid = true; }
      if (!entry.clientName.trim() && !entry.siteName.trim()) { results.push({ level: "error", message: `${label}・${rowNumber}行目：勤務先名または現場名が必要です。` }); invalid = true; }
      if (!entry.route.trim()) { results.push({ level: "error", message: `${label}・${rowNumber}行目：通勤区間が空です。` }); invalid = true; }
      if (entry.route && !entry.route.includes("↔")) results.push({ level: "warning", message: `${label}・${entry.date || rowNumber + "行目"}：往復区間は「↔」表記を推奨します。` });
      if (!(Number.isSafeInteger(Number(entry.oneWayFare)) && Number(entry.oneWayFare) > 0)) { results.push({ level: "error", message: `${label}・${entry.date || rowNumber + "行目"}：片道運賃を正の整数で入力してください。` }); invalid = true; }
      if (!(Number.isSafeInteger(Number(entry.roundTripFare)) && Number(entry.roundTripFare) > 0 && Number(entry.roundTripFare) <= 999999)) { results.push({ level: "error", message: `${label}・${entry.date || rowNumber + "行目"}：往復金額は正の整数で6桁以内にしてください。` }); invalid = true; }
      if (numberValue(entry.oneWayFare) && numberValue(entry.roundTripFare) !== numberValue(entry.oneWayFare) * 2) {
        results.push({ level: "warning", message: `${label}・${entry.date || rowNumber + "行目"}：往復額が片道の2倍ではありません。片道利用・バス加算などの理由を備考で確認してください。` });
      }
      if (entry.verificationUrl && !safeHttpUrl(entry.verificationUrl)) results.push({ level: "warning", message: `${label}・${entry.date || rowNumber + "行目"}：確認リンクの形式を確認してください。` });
      const entryMonth = displayWorkDate(entry.date).match(/^(\d{1,2})\//)?.[1];
      const targetMonthNumber = state.targetMonth ? Number(state.targetMonth.slice(5, 7)) : 0;
      if (entryMonth && targetMonthNumber && Number(entryMonth) !== targetMonthNumber) {
        results.push({ level: "warning", message: `${label}・${entry.date}：対象月外の勤務日です。月外精算として含めるか確認してください。` });
      }
      if (entry.date && seenDates.has(entry.date)) results.push({ level: "warning", message: `${label}：${entry.date}が複数あります。別勤務なら問題ありません。` });
      seenDates.add(entry.date);
      if (invalid && person.id === activePersonId) invalidRows.add(index);
    });

    const total = payableEntries(person).reduce((sum, entry) => sum + numberValue(entry.roundTripFare), 0);
    if (!Number.isSafeInteger(total) || total <= 0 || total > 999999) results.push({ level: "error", message: `${label}：合計金額は正の整数で6桁以内にしてください。` });
  });

  if (state.demoMode) {
    const companyLooksFictional = /架空|サンプル|デモ/.test(state.companyName);
    const peopleLookFictional = people.every(person => /^000\d+$/.test(person.employeeCode) && (!person.address || /サンプル|架空|デモ/.test(person.address)));
    if (!companyLooksFictional || !peopleLookFictional) results.push({ level: "error", message: "デモモードに実在情報らしい内容があります。公開前に架空データへ戻してください。" });
    else results.push({ level: "success", message: "公開用デモは架空の氏名・コード・住所・勤務情報です。" });
  }
  if (people.every(person => person.entries.length <= 32)) results.push({ level: "success", message: "各対象者は1ページ目15件＋2ページ目17件の範囲内で、印刷時に行が途中分割されません。" });

  renderForm();
  renderValidation(results);
  const errors = results.filter(item => item.level === "error");
  const warnings = results.filter(item => item.level === "warning");
  if (errors.length) {
    setStatus("修正が必要です", `${errors.length}件のエラーがあります`);
    if (announce) showToast(`${errors.length}件の修正箇所があります`, "error");
    return { ok: false, results };
  }
  setStatus("データチェック完了", warnings.length ? `${warnings.length}件の確認事項があります` : "印刷準備ができました");
  if (announce) showToast(warnings.length ? "確認事項を表示しました" : "印刷準備ができました", warnings.length ? "default" : "success");
  return { ok: true, results };
}

function renderValidation(results) {
  const panel = el("validationPanel");
  const errors = results.filter(item => item.level === "error").length;
  const warnings = results.filter(item => item.level === "warning").length;
  panel.hidden = false;
  panel.className = `validation-panel surface ${errors ? "error" : warnings ? "warning" : "success-animation"}`;
  el("validationIcon").textContent = errors ? "×" : warnings ? "!" : "✓";
  el("validationTitle").textContent = errors ? `修正が必要：${errors}件` : warnings ? `確認事項：${warnings}件` : "問題なし・印刷準備完了";
  el("validationList").innerHTML = results.map(item => `<li>${item.level === "error" ? "❌" : item.level === "warning" ? "⚠️" : "✅"} ${escapeHtml(item.message)}</li>`).join("");
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

el("employeeForm").addEventListener("input", event => {
  const person = activePerson();
  const personFields = {
    employeeName: "name",
    employeeCode: "employeeCode",
    employeeAddress: "address",
    hankoName: "hankoName",
    employeeNote: "notes"
  };
  if (event.target.id === "targetMonth") {
    state.targetMonth = event.target.value;
    el("rowsBody").querySelectorAll('input[data-field="date"]').forEach((input, index) => { input.value = dateInputValue(person.entries[index].date); });
  }
  else if (event.target.id === "submissionDate") state.submissionDate = event.target.value;
  else if (event.target.id === "companyName") state.companyName = event.target.value;
  else if (event.target.id === "nearestStations") person.nearestStations = event.target.value.split(/[、,]/).map(item => item.trim()).filter(Boolean);
  else if (event.target.id === "showDigitalHanko") person.showDigitalHanko = event.target.checked;
  else if (event.target.id === "hankoScale") person.hankoScale = Math.min(1.5, Math.max(1, numberValue(event.target.value) / 100));
  else if (personFields[event.target.id]) person[personFields[event.target.id]] = event.target.value;
  if (["hankoName", "showDigitalHanko", "hankoScale"].includes(event.target.id)) {
    el("hankoScaleValue").textContent = `${Math.round(person.hankoScale * 100)}%`;
    el("hankoPreview").textContent = person.hankoName || "印";
    el("hankoPreview").style.setProperty("--hanko-scale", person.hankoScale);
    el("hankoPreview").classList.toggle("disabled", !person.showDigitalHanko);
  }
  if (event.target.id === "nearestStations") {
    el("rowsBody").querySelectorAll("tr[data-row]").forEach(row => applyVerificationLinks(row, person.entries[Number(row.dataset.row)], person));
  }
  markEdited();
  renderPeople();
  renderSummaryAndPreview();
  setStatus("編集中", "社員情報をプレビューへ反映しました");
});

el("addRowBtn").addEventListener("click", () => {
  const person = activePerson();
  if (person.entries.length >= 32) {
    showToast("会社様式の上限は2ページ合計32件です", "error");
    return;
  }
  person.entries.push(blankEntry());
  markEdited();
  render();
  el("rowsBody").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  showToast("新しい勤務を追加しました", "success");
});

el("addPersonBtn").addEventListener("click", () => {
  const person = blankPerson(state.people.length);
  state.people.push(person);
  activePersonId = person.id;
  invalidRows = new Set();
  markEdited();
  render();
  el("employeeName").focus();
  showToast("新しい対象者を追加しました", "success");
});

el("duplicatePersonBtn").addEventListener("click", () => {
  const source = activePerson();
  const copy = clone(source);
  copy.id = uniqueId("person-copy");
  copy.name = source.name ? `${source.name}（コピー）` : "複製した対象者";
  copy.employeeCode = "";
  copy.hankoName = "";
  copy.showDigitalHanko = false;
  copy.label = "複製した対象者";
  copy.entries.forEach(entry => { entry.id = uniqueId("entry"); entry.status = "needs_confirmation"; entry.review = { status: "needs_confirmation", questions: ["複製元とは別の対象者の実勤務証拠を確認してください。"] }; });
  state.people.push(copy);
  activePersonId = copy.id;
  markEdited();
  render();
  showToast("複製しました。別の対象者の実勤務を独立して確認してください", "success");
});

el("deletePersonBtn").addEventListener("click", () => {
  const person = activePerson();
  saveRecoveryBackup("対象者削除前");
  state.people = state.people.filter(item => item.id !== person.id);
  if (!state.people.length) state.people = [blankPerson()];
  activePersonId = state.people[0].id;
  invalidRows = new Set();
  markEdited(false);
  render();
  showToast("対象者を削除しました");
});

function loadDemo() {
  state = clone(sampleState);
  activePersonId = state.people[0].id;
  invalidRows = new Set();
  render();
  setStatus("デモデータを表示中", "架空情報なので安全に操作を試せます");
  showToast("架空のデモデータを読み込みました", "sample");
}

function createNewDocument(mode = "new") {
  state = blankState();
  activePersonId = state.people[0].id;
  invalidRows = new Set();
  render();
  setStatus(mode === "reset" ? "入力データをリセットしました" : "新しい伝票を作成中", "社員情報と勤務明細を入力してください");
  showToast(mode === "reset" ? "入力データをリセットしました" : "空の伝票を用意しました", "success");
}

function hasMeaningfulData() {
  return Boolean(state.companyName || state.targetMonth || state.submissionDate || Object.values(state.workflow?.counts || {}).some(count => count.firstHalf !== null && count.firstHalf !== undefined || count.secondHalf !== null && count.secondHalf !== undefined) || state.people.some(person => person.label || person.name || person.employeeCode || person.address || person.nearestStations.length || person.hankoName || person.notes || person.entries.length));
}

function executeDestructiveAction(action) {
  if (action === "demo") loadDemo();
  else createNewDocument(action === "reset" ? "reset" : "new");
  document.querySelector(".workspace").scrollIntoView({ behavior: "smooth" });
}

function requestDestructiveAction(action) {
  pendingDestructiveAction = action;
  if (!hasMeaningfulData()) { executeDestructiveAction(action); return; }
  const labels = {
    new: ["新しい伝票を作成", "現在のデータがあります。保存せずに新しい伝票を作成しますか？"],
    reset: ["入力データをリセット", "現在の入力内容をすべて空欄に戻しますか？"],
    demo: ["デモ用サンプルへ戻す", "現在の入力内容を架空のデモデータに置き換えますか？"]
  };
  el("newDocumentDialogTitle").textContent = labels[action][0];
  el("newDocumentDialogText").textContent = `${labels[action][1]} 実行前の内容は端末内へ自動バックアップされ、「直前のデータを復元」から戻せます。`;
  el("newDocumentDialog").showModal();
}

function confirmDestructiveAction(saveJsonFirst) {
  saveRecoveryBackup(`${pendingDestructiveAction}実行前`);
  if (saveJsonFirst) downloadBlob(`commute-slip-backup-${state.targetMonth || "data"}.json`, `${JSON.stringify(exportState(), null, 2)}\n`, "application/json;charset=utf-8");
  el("newDocumentDialog").close();
  executeDestructiveAction(pendingDestructiveAction);
}

el("loadSampleBtn").addEventListener("click", () => requestDestructiveAction("demo"));
el("heroSampleBtn").addEventListener("click", () => requestDestructiveAction("demo"));
el("newDocumentBtn").addEventListener("click", () => requestDestructiveAction("new"));
el("clearAllBtn").addEventListener("click", () => requestDestructiveAction("reset"));
el("newSaveFirstBtn").addEventListener("click", () => confirmDestructiveAction(true));
el("newDiscardBtn").addEventListener("click", () => confirmDestructiveAction(false));
el("pasteBtn").addEventListener("click", () => { el("pasteArea").value = ""; el("pasteDialog").showModal(); window.setTimeout(() => el("pasteArea").focus(), 40); });
el("heroPasteBtn").addEventListener("click", () => el("pasteBtn").click());
el("guideBtn").addEventListener("click", () => el("guideDialog").showModal());
el("closeValidationBtn").addEventListener("click", () => { el("validationPanel").hidden = true; });
el("validateBtn").addEventListener("click", () => validatePeople([activePerson()]));

el("muteBtn").addEventListener("click", event => {
  unlockAudio();
  soundMuted = !soundMuted;
  event.currentTarget.setAttribute("aria-pressed", String(soundMuted));
  event.currentTarget.textContent = soundMuted ? "音 OFF" : "音 ON";
  savePreferences();
  if (!soundMuted) playTone("success");
  showToast(soundMuted ? "操作音をミュートしました" : "操作音をオンにしました");
});

el("soundVolume").addEventListener("input", event => {
  soundVolume = Math.min(1, Math.max(0, numberValue(event.target.value) / 100));
  el("soundVolumeValue").textContent = `${Math.round(soundVolume * 100)}%`;
  savePreferences();
});
el("soundVolume").addEventListener("change", () => { unlockAudio(); playTone("success"); });

el("fontSizeControl").addEventListener("change", event => {
  document.body.dataset.fontSize = event.target.value;
  savePreferences();
  showToast(`文字サイズを「${event.target.options[event.target.selectedIndex].text}」に変更しました`, "success");
});

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
  }
  catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  showToast(successMessage, "success");
}

el("copyPromptABtn").addEventListener("click", () => copyText(el("chatgptPromptA").textContent.trim(), "確認用プロンプトAをコピーしました"));
el("copyPromptBBtn").addEventListener("click", () => copyText(el("chatgptPromptB").textContent.trim(), "最終JSON用プロンプトBをコピーしました"));
el("copyShareBtn").addEventListener("click", () => copyText(el("shareText").value, "紹介文をコピーしました"));

el("eraseAllStorageBtn").addEventListener("click", () => {
  if (!window.confirm("両モードの保存・下書き・復元データと現在の入力を完全削除します。復元できません。必要なら先にJSON保存してください。削除しますか？")) return;
  try {
    const keys = [OLD_STORAGE_KEY, LEGACY_STORAGE_KEY, OLD_BACKUP_KEY];
    for (const mode of ["personal", "general"]) for (const kind of ["studio-v3", "studio-recovery-v3", "studio-draft-v3"]) keys.push(`tahmid-commute-${kind}-${mode}`);
    keys.forEach(key => localStorage.removeItem(key));
    modeDrafts.clear();
    state = blankState(); activePersonId = state.people[0].id; render();
    el("validationPanel").hidden = true;
    setStatus("両モードの端末内データを削除しました", "復元データも削除済み。ダウンロードしたファイルは別途管理してください。");
    showToast("保存・下書き・復元データを完全削除しました", "success");
  } catch { showToast("端末内データを削除できませんでした。ブラウザのサイトデータ設定をご確認ください", "error"); }
});

el("saveLocalBtn").addEventListener("click", () => {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(exportState()));
    showToast("このブラウザ内に保存しました", "success");
    setStatus("ブラウザ保存済み", "入力内容はこの端末のブラウザ内だけに保存されています");
  }
  catch { showToast("このブラウザでは端末内保存を利用できません。JSON保存をご利用ください", "error"); }
});

el("loadLocalBtn").addEventListener("click", () => {
  const stored = readStorage(storageKey()) || (currentMode === "personal" ? readStorage(OLD_STORAGE_KEY) || readStorage(LEGACY_STORAGE_KEY) : null);
  if (!stored) { showToast("保存されたデータはありません", "error"); return; }
  try {
    saveRecoveryBackup("保存データを開く前");
    state = normalizeData(JSON.parse(stored));
    activePersonId = state.people[0].id;
    invalidRows = new Set();
    render();
    showToast("ブラウザ保存データを開きました", "success");
    setStatus("保存データを編集中", "外部送信は行っていません");
  }
  catch (error) {
    showToast(`保存データを開けません：${error.message}`, "error");
  }
});

el("restoreBackupBtn").addEventListener("click", () => {
  const stored = readStorage(backupKey()) || (currentMode === "personal" ? readStorage(OLD_BACKUP_KEY) : null);
  if (!stored) { showToast("復元できる直前データはありません", "error"); return; }
  try {
    const backup = JSON.parse(stored);
    state = normalizeData(backup.data || backup);
    state.demoMode = false;
    activePersonId = state.people[0].id;
    invalidRows = new Set();
    render();
    setStatus("直前のデータを復元しました", backup.savedAt ? `${new Date(backup.savedAt).toLocaleString("ja-JP")}のバックアップ` : "端末内バックアップ");
    showToast("直前のデータを復元しました", "success");
  }
  catch (error) { showToast(`復元できません：${error.message}`, "error"); }
});

el("clearLocalBtn").addEventListener("click", () => {
  const stored = readStorage(storageKey());
  if (!stored) { showToast("削除する保存データはありません", "error"); return; }
  el("clearSavedDialog").showModal();
});

el("confirmClearLocalBtn").addEventListener("click", () => {
  const stored = readStorage(storageKey());
  if (stored) {
    try { localStorage.setItem(backupKey(), JSON.stringify({ reason: "保存データ削除前", savedAt: new Date().toISOString(), data: JSON.parse(stored) })); }
    catch { /* 削除前退避に失敗しても現在の画面は保持する */ }
  }
  try {
    localStorage.removeItem(storageKey());
  }
  catch {
    el("clearSavedDialog").close();
    showToast("このブラウザでは保存データを削除できません", "error");
    return;
  }
  el("clearSavedDialog").close();
  showToast("ブラウザ保存データを削除しました", "success");
  setStatus("保存データを削除済み", "現在の画面内容は保持し、削除前データを復元用に退避しました");
});

function parseDelimited(text) {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    }
    else if (character === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = "";
    }
    else cell += character;
  }
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function headerKey(value) {
  return textValue(value).replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_・\/／-]/g, "");
}

const csvAliases = {
  personId: ["対象者ID", "personid"],
  reviewMetadata: ["確認メタデータ", "reviewmetadata"],
  workflowMetadata: ["作業設定", "workflowmetadata"],
  companyName: ["会社名", "companyname"],
  targetMonth: ["対象月", "targetmonth"],
  submissionDate: ["提出日", "submissiondate"],
  name: ["対象者", "氏名", "name", "employeename"],
  employeeCode: ["社員コード", "コード", "code", "employeecode"],
  address: ["本人住所", "自宅住所", "address", "homeaddress"],
  nearestStations: ["最寄り駅", "neareststations", "homestation"],
  hankoName: ["印鑑名", "hankoname"],
  showDigitalHanko: ["印鑑表示", "showdigitalhanko"],
  hankoScale: ["印鑑倍率", "印鑑サイズ", "hankoscale"],
  date: ["勤務日", "日付", "date"],
  workType: ["区分", "worktype", "shift", "category"],
  clientName: ["勤務先名", "取引先名", "clientname", "workplace"],
  siteName: ["現場名", "sitename", "site"],
  siteAddress: ["現場住所", "住所最寄り情報", "siteaddress", "location"],
  nearestStation: ["現場最寄り駅", "到着駅", "neareststation", "destinationstation"],
  route: ["通勤区間", "区間", "route"],
  transport: ["交通手段", "transport", "バス利用"],
  oneWayFare: ["片道運賃", "片道ic運賃", "片道", "onewayfare"],
  roundTripFare: ["往復金額", "請求額", "金額", "roundtripfare", "amount"],
  fareType: ["運賃種別", "faretype"],
  verificationUrl: ["確認リンク", "verificationurl"],
  memo: ["備考", "memo", "note"]
};

function csvIndex(headers, field) {
  const wanted = new Set(csvAliases[field].map(headerKey));
  return headers.findIndex(header => wanted.has(headerKey(header)));
}

function stateFromCsv(text) {
  const matrix = parseDelimited(text);
  if (matrix.length < 2) throw new Error("CSVに見出し行と明細行が必要です");
  const headers = matrix[0];
  const indexes = Object.fromEntries(Object.keys(csvAliases).map(field => [field, csvIndex(headers, field)]));
  if (indexes.date < 0 || (indexes.clientName < 0 && indexes.siteName < 0) || indexes.roundTripFare < 0) {
    throw new Error("CSVには勤務日・勤務先名または現場名・往復金額の列が必要です");
  }
  const valueAt = (record, field) => indexes[field] >= 0 ? textValue(record[indexes[field]]).trim() : "";
  const groups = new Map();
  const counts = {};
  let openQuestions = false;
  const parseMetadata = (record, field) => {
    const value = valueAt(record, field);
    if (!value) return {};
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("CSVの確認メタデータはJSONオブジェクトにしてください。");
    return parsed;
  };
  matrix.slice(1).forEach(record => {
    const name = valueAt(record, "name") || "取込対象者";
    const code = valueAt(record, "employeeCode");
    const key = valueAt(record, "personId") || `${name}\u0000${code}`;
    if (!groups.has(key)) {
      groups.set(key, normalizePerson({
        id: valueAt(record, "personId") || uniqueId("import-person"),
        name,
        employeeCode: code,
        address: valueAt(record, "address"),
        nearestStations: valueAt(record, "nearestStations").split(/[、,]/).filter(Boolean),
        hankoName: valueAt(record, "hankoName"),
        showDigitalHanko: /^(true|1|yes|表示|する)$/i.test(valueAt(record, "showDigitalHanko")),
        hankoScale: numberValue(valueAt(record, "hankoScale")) > 10 ? numberValue(valueAt(record, "hankoScale")) / 100 : numberValue(valueAt(record, "hankoScale")) || 1,
        entries: []
      }));
    }
    const planning = parseMetadata(record, "workflowMetadata");
    const person = groups.get(key);
    if (planning.label) person.label = textValue(planning.label);
    if (planning.counts) counts[person.id] = planning.counts;
    if (planning.openQuestions) openQuestions = true;
    groups.get(key).entries.push(normalizeEntry({
      ...parseMetadata(record, "reviewMetadata"),
      date: valueAt(record, "date"),
      workType: valueAt(record, "workType"),
      clientName: valueAt(record, "clientName"),
      siteName: valueAt(record, "siteName"),
      siteAddress: valueAt(record, "siteAddress"),
      nearestStation: valueAt(record, "nearestStation"),
      route: valueAt(record, "route"),
      transport: valueAt(record, "transport") || "電車",
      oneWayFare: valueAt(record, "oneWayFare"),
      roundTripFare: valueAt(record, "roundTripFare"),
      fareType: valueAt(record, "fareType") || "IC",
      verificationUrl: valueAt(record, "verificationUrl"),
      memo: valueAt(record, "memo")
    }));
  });
  const people = [...groups.values()];
  if (!people.length) throw new Error("読み込める明細がありません");
  const first = matrix[1];
  return normalizeData({
    appVersion: "2.0",
    documentType: "commute_slip",
    companyName: valueAt(first, "companyName"),
    targetMonth: valueAt(first, "targetMonth"),
    submissionDate: valueAt(first, "submissionDate"),
    workflow: { mode: currentMode, counts, openQuestions },
    people
  });
}

function extractJson(text) {
  const trimmed = text.trim();
  const candidates = [trimmed];
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.unshift(match[1].trim());
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
    try { return JSON.parse(candidate); }
    catch { /* 次の候補を試す */ }
  }
  return null;
}

function stateFromLooseText(text) {
  if (!text.trim()) throw new Error("データが空です");
  const json = extractJson(text);
  if (json) return normalizeData(Array.isArray(json) ? { people: json } : json);
  return stateFromCsv(text);
}

function applyImportedState(imported, sourceName) {
  if (hasMeaningfulData()) saveRecoveryBackup(`${sourceName}読込前`);
  state = normalizeData(imported);
  state.demoMode = false;
  state.updatedAt = new Date().toISOString();
  activePersonId = state.people[0].id;
  invalidRows = new Set();
  render();
  setStatus(`${sourceName}を読み込みました`, `${state.people.length}名分を編集できます`);
  showToast(`${state.people.length}名分のデータを反映しました`, "success");
}

el("dataFileInput").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try { applyImportedState(stateFromLooseText(await file.text()), file.name); }
  catch (error) { setStatus("読込に失敗しました", error.message); showToast(`読込エラー：${error.message}`, "error"); }
  finally { event.target.value = ""; }
});

el("applyPasteBtn").addEventListener("click", event => {
  event.preventDefault();
  try {
    applyImportedState(stateFromLooseText(el("pasteArea").value), "貼り付けデータ");
    el("pasteDialog").close();
  }
  catch (error) { setStatus("貼り付けデータを読めません", error.message); showToast(`読込エラー：${error.message}`, "error"); }
});

function exportState() {
  return {
    appVersion: "2.0",
    documentType: "commute_slip",
    targetMonth: state.targetMonth ? japaneseMonth(state.targetMonth) : "",
    submissionDate: state.submissionDate ? japaneseDate(state.submissionDate) : "",
    companyName: state.companyName,
    updatedAt: state.updatedAt,
    workflow: clone(state.workflow || { mode: currentMode, counts: {}, userApproved: false, openQuestions: false }),
    people: state.people.map(person => ({
      id: person.id,
      ...(person.label ? { label: person.label } : {}),
      name: person.name,
      employeeCode: person.employeeCode,
      address: person.address,
      nearestStations: [...person.nearestStations],
      hankoName: person.hankoName,
      showDigitalHanko: person.showDigitalHanko,
      hankoScale: person.hankoScale,
      notes: person.notes,
      entries: person.entries.map(entry => ({
        date: entry.date,
        workType: entry.workType,
        clientName: entry.clientName,
        siteName: entry.siteName,
        siteAddress: entry.siteAddress,
        nearestStation: entry.nearestStation,
        route: entry.route,
        transport: entry.transport,
        oneWayFare: entry.oneWayFare,
        roundTripFare: entry.roundTripFare,
        fareType: entry.fareType,
        verificationUrl: entry.verificationUrl,
        memo: entry.memo,
        ...(entry.status ? { status: entry.status } : {}),
        ...(entry.review ? { review: clone(entry.review) } : {}),
        ...(entry.instructionChain ? { instructionChain: clone(entry.instructionChain) } : {}),
        ...(entry.serviceId ? { serviceId: entry.serviceId } : {}),
        ...(typeof entry.countsAsWork === "boolean" ? { countsAsWork: entry.countsAsWork } : {})
      }))
    }))
  };
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  let text = textValue(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const headers = ["会社名", "対象月", "提出日", "対象者", "社員コード", "本人住所", "最寄り駅", "印鑑名", "印鑑表示", "印鑑倍率", "勤務日", "区分", "勤務先名", "現場名", "現場住所", "現場最寄り駅", "通勤区間", "交通手段", "片道運賃", "往復金額", "運賃種別", "確認リンク", "備考", "対象者ID", "確認メタデータ", "作業設定"];
  const records = state.people.flatMap(person => person.entries.map(entry => [
    state.companyName, state.targetMonth ? japaneseMonth(state.targetMonth) : "", state.submissionDate ? japaneseDate(state.submissionDate) : "", person.name, person.employeeCode,
    person.address, person.nearestStations.join("、"), person.hankoName, person.showDigitalHanko ? "表示" : "非表示", person.hankoScale,
    entry.date, entry.workType, entry.clientName, entry.siteName, entry.siteAddress, entry.nearestStation, entry.route, entry.transport,
    entry.oneWayFare, entry.roundTripFare, entry.fareType, entry.verificationUrl, entry.memo, person.id,
    JSON.stringify(Object.fromEntries(["status", "review", "instructionChain", "serviceId", "countsAsWork"].filter(key => key in entry).map(key => [key, entry[key]]))),
    JSON.stringify({ label: person.label || "", counts: state.workflow?.counts?.[person.id] || {}, openQuestions: Boolean(state.workflow?.openQuestions || state.workflow?.invalidCounts?.length) })
  ]));
  return `\uFEFF${[headers, ...records].map(record => record.map(csvCell).join(",")).join("\r\n")}`;
}

el("saveJsonBtn").addEventListener("click", () => {
  downloadBlob(`commute-slip-${state.targetMonth || "data"}.json`, `${JSON.stringify(exportState(), null, 2)}\n`, "application/json;charset=utf-8");
  showToast("編集可能なJSONを保存しました", "success");
});

el("saveCsvBtn").addEventListener("click", () => {
  downloadBlob(`commute-slip-${state.targetMonth || "data"}.csv`, exportCsv(), "text/csv;charset=utf-8");
  showToast("確認用CSVを保存しました", "success");
});

async function makeStandaloneHtml() {
  const inlineData = document.querySelector("#initialData");
  const safeData = JSON.stringify(exportState()).replace(/</g, "\\u003c");
  if (inlineData) {
    const documentClone = document.documentElement.cloneNode(true);
    documentClone.querySelector("#initialData").textContent = `window.COMMUTE_INITIAL_DATA = ${safeData};`;
    documentClone.querySelector("#printRoot").innerHTML = "";
    return `<!doctype html>\n${documentClone.outerHTML}`;
  }
  const [indexText, cssText, appText, coreText] = await Promise.all([
    fetch("index.html").then(response => { if (!response.ok) throw new Error("index.htmlを取得できません"); return response.text(); }),
    fetch("style.css").then(response => { if (!response.ok) throw new Error("style.cssを取得できません"); return response.text(); }),
    fetch("app.js").then(response => { if (!response.ok) throw new Error("app.jsを取得できません"); return response.text(); }),
    fetch("commute-core.js").then(response => { if (!response.ok) throw new Error("commute-core.jsを取得できません"); return response.text(); })
  ]);
  const safeAppText = appText.replace(/<\/script/gi, "<\\/script");
  return indexText
    .replace('<link rel="stylesheet" href="style.css">', `<style>\n${cssText}\n</style>`)
    .replace('<script src="sample-data.js"></script>', `<script>window.COMMUTE_SAMPLE_DATA = ${JSON.stringify(window.COMMUTE_SAMPLE_DATA).replace(/</g, "\\u003c")};<\/script><script id="initialData">window.COMMUTE_INITIAL_DATA = ${safeData};<\/script>`)
    .replace('<script src="commute-core.js"></script>', `<script>\n${coreText.replace(/<\/script/gi, "<\\/script")}\n<\/script>`)
    .replace('<script src="app.js"></script>', `<script>\n${safeAppText}\n<\/script>`);
}

el("saveHtmlBtn").addEventListener("click", async () => {
  try {
    downloadBlob(`commute-slip-${state.targetMonth || "data"}.html`, await makeStandaloneHtml(), "text/html;charset=utf-8");
    showToast("1ファイル版HTMLを保存しました", "success");
  }
  catch (error) { showToast(`HTML保存に失敗しました：${error.message}`, "error"); }
});

function preparePrint(people, label) {
  const validation = validatePeople(people, false);
  if (!validation.ok) {
    showToast("修正が必要なため印刷を開始できません", "error");
    return;
  }
  const printRoot = el("printRoot");
  printRoot.innerHTML = people.map(pagesForPerson).join("");
  printRoot.style.setProperty("--print-scale", el("printScale").value || "1");
  setStatus("印刷準備完了", `${label}・A4縦・${people.length * 2}ページ`);
  showToast("印刷画面を開きます", "print");
  window.setTimeout(() => window.print(), 100);
}

el("printBtn").addEventListener("click", () => preparePrint([activePerson()], activePerson().name || "選択中の対象者"));
el("printAllBtn").addEventListener("click", () => preparePrint(state.people, `全${state.people.length}名`));
el("printScale").addEventListener("change", () => setStatus("印刷倍率を変更しました", `${Math.round(Number(el("printScale").value) * 100)}%で印刷します`));
el("previewScale").addEventListener("change", event => {
  el("previewPages").style.setProperty("--preview-scale", event.target.value);
  setStatus("プレビュー倍率を変更しました", `${Math.round(Number(event.target.value) * 100)}%で画面表示します。印刷倍率には影響しません`);
});
window.addEventListener("afterprint", () => setStatus("印刷画面を閉じました", "必要なら内容を修正して再印刷できます"));

el("muteBtn").setAttribute("aria-pressed", String(soundMuted));
el("muteBtn").textContent = soundMuted ? "音 OFF" : "音 ON";
el("soundVolume").value = Math.round(soundVolume * 100);
el("soundVolumeValue").textContent = `${Math.round(soundVolume * 100)}%`;
el("fontSizeControl").value = document.body.dataset.fontSize || "standard";
render();
setStatus(state.demoMode ? "デモデータを表示中" : "通勤伝票を編集中", state.demoMode ? "架空情報なので安全に操作を試せます" : "入力内容は外部へ送信されません");
