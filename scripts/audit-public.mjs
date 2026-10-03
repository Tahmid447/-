import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
const root = fileURLToPath(new URL("../", import.meta.url));
const extraTerms = JSON.parse(process.env.PRIVATE_SCAN_TERMS || "[]");
const failures = [];
const scanned = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "__pycache__"].includes(entry.name)) continue;
    const path = join(directory, entry.name), name = relative(root, path);
    if (entry.isDirectory()) { await scan(path); continue; }
    if (entry.isSymbolicLink()) { failures.push(`${name}: symlink is not permitted in public package`); continue; }
    if (entry.name === "public-release-audit.json" || entry.name === ".DS_Store") continue;
    if (/^(personal-defaults|approval-receipt).*\.json$|\.(mp4|mov|png|jpg|key|pem)$/i.test(entry.name)) failures.push(`${name}: private/raw media or credential file`);
    const buffer = await readFile(path);
    scanned.push({ name, sha256: createHash("sha256").update(buffer).digest("hex") });
    if (/\.(pdf|docx)$/i.test(name)) {
      if (!/^skills\/fill-commute-expense-pdf\/assets\/blank-commute-voucher\.(pdf|docx)$/.test(name)) failures.push(`${name}: only audited blank form assets allowed`);
      continue;
    }
    const text = buffer.toString("utf8");
    if (/\/Users\/[^/\s]+\/|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{24,}/.test(text)) failures.push(`${name}: home path or credential-shaped content`);
    for (let i = 0; i < extraTerms.length; i++) if (extraTerms[i] && text.includes(extraTerms[i])) failures.push(`${name}: private scan pattern ${i + 1}`);
  }
}
await scan(root);
const sample = JSON.parse(await readFile(join(root, "sample-data.json"), "utf8"));
if (!sample.demoMode || !/架空|サンプル/.test(sample.companyName) || !sample.people.every(p => /^000\d+$/.test(p.employeeCode) && /架空|サンプル/.test(p.address))) failures.push("sample-data.json: fictional-data guard failed");
const source = await readFile(join(root, "app.js"), "utf8");
if (/XMLHttpRequest|sendBeacon|WebSocket|fetch\(\s*[`'"]https?:/i.test(source)) failures.push("app.js: network submission implementation detected");
for (const name of ["commute-slip-app-standalone.html", "commute-slip-blank-template.html"]) {
  const html = await readFile(join(root, name), "utf8");
  const { document } = parseHTML(html);
  if (document.querySelector("script[src], link[rel=stylesheet]") || /window\.COMMUTE_INITIAL_DATA\s*=/.test(document.getElementById("initialData")?.textContent || "")) failures.push(`${name}: not blank-first self-contained public bundle`);
}
const report = { generatedAt: new Date().toISOString(), result: failures.length ? "FAIL" : "PASS", filesScanned: scanned.length, privatePatternCount: extraTerms.length, fictionalDataOnly: true, failures, files: scanned };
await writeFile(join(root, "public-release-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ result: report.result, filesScanned: scanned.length, privatePatternCount: extraTerms.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
