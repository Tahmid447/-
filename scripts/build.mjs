import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const names = ["index.html", "style.css", "app.js", "commute-core.js", "sample-data.js", "sample-data.json", "_redirects", "_headers"];
const content = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(root, name), "utf8")])));
function bundle() {
  return content["index.html"].replace('<link rel="stylesheet" href="style.css">', `<style>${content["style.css"]}</style>`)
    .replace('<script src="sample-data.js"></script>', `<script>${content["sample-data.js"].replace(/<\/script/gi, "<\\/script")}</script><script id="initialData">/* Blank start; exported private copies use COMMUTE_INITIAL_DATA here. */</script>`)
    .replace('<script src="commute-core.js"></script>', `<script>${content["commute-core.js"].replace(/<\/script/gi, "<\\/script")}</script>`)
    .replace('<script src="app.js"></script>', `<script>${content["app.js"].replace(/<\/script/gi, "<\\/script")}</script>`);
}
// Deliberately no glob of outputs/: allowlist only. No ledger, videos, skill or PDFs deployed.
await mkdir(join(root, "dist"), { recursive: true });
const allowed = new Set([...names, "commute-slip-app-standalone.html", "commute-slip-blank-template.html"]);
for (const entry of await readdir(join(root, "dist"), { withFileTypes: true })) {
  if (!allowed.has(entry.name) || !entry.isFile()) throw new Error(`Unexpected dist item ${entry.name}; move it out before building. It will not be deployed or silently deleted.`);
}
for (const name of names) await copyFile(join(root, name), join(root, "dist", name));
for (const name of ["commute-slip-app-standalone.html", "commute-slip-blank-template.html"]) {
  await writeFile(join(root, name), bundle());
  await writeFile(join(root, "dist", name), bundle());
}
console.log("Static build complete: dist/ (10 public files), blank first start in both modes.");
