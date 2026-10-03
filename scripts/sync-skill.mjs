import { copyFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/sync-skill.mjs /path/to/installed/fill-commute-expense-pdf");
const root = fileURLToPath(new URL("../skills/fill-commute-expense-pdf/", import.meta.url));
// A positive allowlist, never a recursive copy of a private installed skill.
const files = ["SKILL.md", "agents/openai.yaml", "assets/blank-commute-voucher.pdf", "assets/blank-commute-voucher.docx",
  ...["company-form.md", "input-schema.md", "layout-profile.json", "layout-profile-clean-a4.json", "qa-checklist.md", "workflow-qa.md", "work-ledger-schema.md", "screen-recording-intake.md", "instruction-chains.md"].map(name => `references/${name}`),
  ...["validate_commute_data.py", "instruction_chain.py", "extract_line_frames.py", "test_export_fill_data.py", "export_fill_data.py", "fill_commute_pdf.py", "extract_video_frames.swift", "verify_output.py", "test_validate_commute_data.py", "test_instruction_chain.py"].map(name => `scripts/${name}`)];
for (const name of files) {
  await mkdir(dirname(join(root, name)), { recursive: true });
  await copyFile(join(resolve(source), name), join(root, name));
}
console.log(`Shared skill synchronized: ${files.length} allowlisted files; no private defaults, receipts, frames or real ledger.`);
