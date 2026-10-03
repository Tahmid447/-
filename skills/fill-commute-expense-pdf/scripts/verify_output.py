#!/usr/bin/env python3
"""Verify and render a completed commute-expense PDF."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from pypdf import PdfReader

from fill_commute_pdf import (
    InputError,
    data_sha256,
    load_json,
    sha256_file,
    validate_data,
    validate_layout,
    write_report,
)


SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_LAYOUT = SKILL_DIR / "references" / "layout-profile.json"


def dereference(value: Any) -> Any:
    return value.get_object() if hasattr(value, "get_object") else value


def embedded_fonts(reader: PdfReader) -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for page_number, page in enumerate(reader.pages, start=1):
        resources = dereference(page.get("/Resources", {}))
        fonts = dereference(resources.get("/Font", {})) if resources else {}
        for resource_name, font_reference in fonts.items():
            font = dereference(font_reference)
            candidates = [font]
            descendants = font.get("/DescendantFonts") if font else None
            if descendants:
                candidates.extend(dereference(item) for item in dereference(descendants))
            for candidate in candidates:
                descriptor = candidate.get("/FontDescriptor") if candidate else None
                if not descriptor:
                    continue
                descriptor = dereference(descriptor)
                program = next(
                    (
                        key
                        for key in ("/FontFile", "/FontFile2", "/FontFile3")
                        if descriptor.get(key) is not None
                    ),
                    None,
                )
                if not program:
                    continue
                base_name = str(
                    candidate.get("/BaseFont")
                    or font.get("/BaseFont")
                    or resource_name
                )
                key = f"{base_name}:{program}"
                record = found.setdefault(
                    key,
                    {"base_font": base_name, "font_program": program, "pages": []},
                )
                if page_number not in record["pages"]:
                    record["pages"].append(page_number)
    return list(found.values())


def ensure_fresh_render_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    existing = sorted(path.glob("page-*.png"))
    if existing:
        raise InputError(
            f"Render directory already contains page images; use a fresh directory: {path}"
        )


def render_pdf(pdf_path: Path, render_dir: Path, dpi: int) -> list[Path]:
    executable = shutil.which("pdftoppm")
    if not executable:
        raise InputError("pdftoppm is required for final rendering")
    ensure_fresh_render_dir(render_dir)
    prefix = render_dir / "page"
    process = subprocess.run(
        [executable, "-png", "-r", str(dpi), str(pdf_path), str(prefix)],
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        raise InputError(f"pdftoppm failed: {process.stderr.strip()}")
    images = sorted(render_dir.glob("page-*.png"))
    if not images:
        raise InputError("pdftoppm produced no page images")
    return images


def image_info(paths: list[Path]) -> list[dict[str, Any]]:
    try:
        from PIL import Image
    except ImportError:
        return [
            {"path": str(path), "bytes": path.stat().st_size, "dimensions": None}
            for path in paths
        ]
    result = []
    for path in paths:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            result.append(
                {
                    "path": str(path),
                    "bytes": path.stat().st_size,
                    "dimensions": [image.width, image.height],
                }
            )
    return result


def verify(args: argparse.Namespace) -> dict[str, Any]:
    source_pdf = args.source_pdf.expanduser().resolve()
    output_pdf = args.output_pdf.expanduser().resolve()
    if source_pdf == output_pdf:
        raise InputError("Source and output paths must differ")
    if not source_pdf.is_file() or not output_pdf.is_file():
        raise InputError("Source and output PDFs must both exist")

    data = load_json(args.data.expanduser().resolve())
    layout = load_json(args.layout.expanduser().resolve())
    validate_layout(layout)
    validated = validate_data(data, layout)
    source_reader = PdfReader(str(source_pdf))
    output_reader = PdfReader(str(output_pdf))
    if output_reader.is_encrypted:
        raise InputError("Output PDF is unexpectedly encrypted")
    expected_pages = layout["expected_page_count"]
    if len(source_reader.pages) != expected_pages or len(output_reader.pages) != expected_pages:
        raise InputError("Source and output must both contain exactly two pages")

    dimensions = []
    for index, (source_page, output_page) in enumerate(
        zip(source_reader.pages, output_reader.pages), start=1
    ):
        source_size = (
            float(source_page.mediabox.width),
            float(source_page.mediabox.height),
        )
        output_size = (
            float(output_page.mediabox.width),
            float(output_page.mediabox.height),
        )
        if any(abs(left - right) > 0.01 for left, right in zip(source_size, output_size)):
            raise InputError(f"Page {index} dimensions changed")
        dimensions.append(
            {"page": index, "width": output_size[0], "height": output_size[1]}
        )

    metadata = output_reader.metadata or {}
    source_hash = sha256_file(source_pdf)
    expected_data_hash = data_sha256(data)
    checks = {
        "source_hash_metadata": metadata.get("/CommuteExpenseSourceSHA256")
        == source_hash,
        "data_hash_metadata": metadata.get("/CommuteExpenseDataSHA256")
        == expected_data_hash,
        "row_counts_metadata": metadata.get("/CommuteExpenseRowCounts")
        == json.dumps(validated["row_counts"]),
        "page_totals_metadata": metadata.get("/CommuteExpensePageTotals")
        == json.dumps(validated["page_totals"]),
        "grand_total_metadata": metadata.get("/CommuteExpenseGrandTotal")
        == str(validated["direct_total"]),
        "direct_total_equals_page_checksum": validated["direct_total"]
        == validated["page_checksum"],
        "source_and_output_differ": sha256_file(source_pdf) != sha256_file(output_pdf),
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise InputError(f"Output integrity checks failed: {failed}")

    fonts = embedded_fonts(output_reader)
    if not fonts:
        raise InputError("No embedded font program was found in the output PDF")

    render_dir = args.render_dir.expanduser().resolve()
    rendered = render_pdf(output_pdf, render_dir, args.dpi)
    if len(rendered) != expected_pages:
        raise InputError(
            f"Expected {expected_pages} rendered pages but found {len(rendered)}"
        )

    report = {
        "status": "machine_verified_visual_review_required",
        "source_pdf": str(source_pdf),
        "output_pdf": str(output_pdf),
        "source_sha256": source_hash,
        "output_sha256": sha256_file(output_pdf),
        "data_sha256": expected_data_hash,
        "checks": checks,
        "page_dimensions": dimensions,
        "embedded_fonts": fonts,
        "row_counts": validated["row_counts"],
        "total_rows": len(validated["rows"]),
        "page_totals": validated["page_totals"],
        "direct_total": validated["direct_total"],
        "page_checksum": validated["page_checksum"],
        "render_dpi": args.dpi,
        "rendered_pages": image_info(rendered),
        "visual_review_required": True,
    }
    write_report(args.report, report)
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Verify structure, totals, embedded fonts, and rendering"
    )
    parser.add_argument("--source-pdf", required=True, type=Path)
    parser.add_argument("--output-pdf", required=True, type=Path)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--layout", type=Path, default=DEFAULT_LAYOUT)
    parser.add_argument("--render-dir", required=True, type=Path)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--report", type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.dpi < 180:
        print("ERROR: Final rendering must use at least 180 DPI", file=sys.stderr)
        return 2
    try:
        report = verify(args)
    except (InputError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
