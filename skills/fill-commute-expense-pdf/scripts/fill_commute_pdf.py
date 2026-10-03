#!/usr/bin/env python3
"""Validate finalized commute data and overlay it on a two-page source PDF."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_LAYOUT = SKILL_DIR / "references" / "layout-profile.json"
FONT_NAME = "CommuteExpenseJapanese"


class InputError(ValueError):
    """Raised when source data or the form is unsafe to process."""


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise InputError(f"JSON file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise InputError(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise InputError(f"Top-level JSON value must be an object: {path}")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def data_sha256(data: dict[str, Any]) -> str:
    encoded = json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def require_object(parent: dict[str, Any], key: str) -> dict[str, Any]:
    value = parent.get(key)
    if not isinstance(value, dict):
        raise InputError(f"{key} must be an object")
    return value


def require_string(parent: dict[str, Any], key: str, context: str) -> str:
    value = parent.get(key)
    if not isinstance(value, str) or not value:
        raise InputError(f"{context}.{key} must be a non-empty string")
    return value


def require_int(parent: dict[str, Any], key: str, context: str) -> int:
    value = parent.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise InputError(f"{context}.{key} must be an integer")
    return value


def validate_layout(layout: dict[str, Any]) -> None:
    if layout.get("expected_page_count") != 2:
        raise InputError("Layout must require exactly two pages")
    pages = layout.get("pages")
    if not isinstance(pages, list) or len(pages) != 2:
        raise InputError("Layout pages must contain exactly two page profiles")
    for page_index, page in enumerate(pages, start=1):
        if not isinstance(page, dict):
            raise InputError(f"Layout page {page_index} must be an object")
        bounds = page.get("row_bounds")
        cells = page.get("amount_cells")
        if not isinstance(bounds, list) or len(bounds) < 2:
            raise InputError(f"Layout page {page_index} needs row boundaries")
        if not isinstance(cells, list) or len(cells) != 7:
            raise InputError(
                f"Layout page {page_index} must define seven boundaries for six amount cells"
            )
        if any(not isinstance(value, (int, float)) for value in bounds + cells):
            raise InputError(f"Layout page {page_index} coordinates must be numeric")
        if any(b >= a for b, a in zip(bounds, bounds[1:])):
            raise InputError(f"Layout page {page_index} row boundaries must increase")
        if any(b >= a for b, a in zip(cells, cells[1:])):
            raise InputError(f"Layout page {page_index} amount boundaries must increase")
    if not isinstance(pages[0].get("metadata"), dict):
        raise InputError("Layout page 1 must define metadata fields")


def allocate_rows(
    rows: list[dict[str, Any]], layout: dict[str, Any]
) -> list[list[dict[str, Any]]]:
    page_rows: list[list[dict[str, Any]]] = []
    offset = 0
    for page in layout["pages"]:
        capacity = len(page["row_bounds"]) - 1
        page_rows.append(rows[offset : offset + capacity])
        offset += capacity
    if offset < len(rows):
        capacity = sum(len(page["row_bounds"]) - 1 for page in layout["pages"])
        raise InputError(f"{len(rows)} rows exceed the form capacity of {capacity}")
    return page_rows


def validate_data(data: dict[str, Any], layout: dict[str, Any]) -> dict[str, Any]:
    validate_layout(layout)
    document = require_object(data, "document")
    target = require_object(document, "target_date")
    submission = require_object(document, "submission_date")

    if require_string(target, "era", "document.target_date") != "令和":
        raise InputError("document.target_date.era must be 令和")
    if require_string(submission, "era", "document.submission_date") != "令和":
        raise InputError("document.submission_date.era must be 令和")
    target_year = require_int(target, "year", "document.target_date")
    target_month = require_int(target, "month", "document.target_date")
    submission_year = require_int(submission, "year", "document.submission_date")
    submission_month = require_int(submission, "month", "document.submission_date")
    submission_day = require_int(submission, "day", "document.submission_date")
    if target_year < 1 or submission_year < 1:
        raise InputError("Reiwa years must be positive")
    if not 1 <= target_month <= 12 or not 1 <= submission_month <= 12:
        raise InputError("Months must be from 1 through 12")
    if not 1 <= submission_day <= 31:
        raise InputError("Submission day must be from 1 through 31")

    employee_code = require_string(document, "employee_code", "document")
    employee_name = require_string(document, "employee_name", "document")
    if employee_code != employee_code.strip():
        raise InputError("document.employee_code must not have surrounding whitespace")
    if employee_name != employee_name.strip():
        raise InputError("document.employee_name must not have surrounding whitespace")

    rows_value = data.get("rows")
    if not isinstance(rows_value, list) or not rows_value:
        raise InputError("rows must be a non-empty array")
    rows: list[dict[str, Any]] = []
    for index, row_value in enumerate(rows_value, start=1):
        context = f"rows[{index - 1}]"
        if not isinstance(row_value, dict):
            raise InputError(f"{context} must be an object")
        row: dict[str, Any] = {}
        for key in ("date", "shift", "site", "address", "route", "fare"):
            row[key] = require_string(row_value, key, context)
        amount = require_int(row_value, "amount", context)
        if not 0 <= amount <= 999999:
            raise InputError(f"{context}.amount must be from 0 through 999999")
        row["amount"] = amount
        rows.append(row)

    page_rows = allocate_rows(rows, layout)
    row_counts = [len(values) for values in page_rows]
    page_totals = [sum(row["amount"] for row in values) for values in page_rows]
    direct_total = 0
    for row in rows:
        direct_total += row["amount"]
    page_checksum = sum(page_totals)
    if direct_total != page_checksum:
        raise InputError(
            f"Direct total {direct_total} does not match page checksum {page_checksum}"
        )

    expected_row_count = document.get("expected_row_count")
    if expected_row_count is not None:
        if isinstance(expected_row_count, bool) or not isinstance(expected_row_count, int):
            raise InputError("document.expected_row_count must be an integer")
        if expected_row_count != len(rows):
            raise InputError(
                f"Expected {expected_row_count} rows but received {len(rows)}"
            )

    expected_row_counts = document.get("expected_page_row_counts")
    if expected_row_counts is not None:
        if expected_row_counts != row_counts:
            raise InputError(
                f"Expected page row counts {expected_row_counts} but calculated {row_counts}"
            )

    expected_page_totals = document.get("expected_page_totals")
    if expected_page_totals is not None:
        if expected_page_totals != page_totals:
            raise InputError(
                f"Expected page totals {expected_page_totals} but calculated {page_totals}"
            )

    expected_grand_total = document.get("expected_grand_total")
    if expected_grand_total is not None:
        if isinstance(expected_grand_total, bool) or not isinstance(
            expected_grand_total, int
        ):
            raise InputError("document.expected_grand_total must be an integer")
        if expected_grand_total != direct_total:
            raise InputError(
                f"Expected grand total {expected_grand_total} but calculated {direct_total}"
            )

    return {
        "document": document,
        "rows": rows,
        "page_rows": page_rows,
        "row_counts": row_counts,
        "page_totals": page_totals,
        "direct_total": direct_total,
        "page_checksum": page_checksum,
    }


def inspect_source(path: Path, layout: dict[str, Any]) -> tuple[PdfReader, dict[str, Any]]:
    if not path.is_file():
        raise InputError(f"Input PDF not found: {path}")
    reader = PdfReader(str(path))
    if reader.is_encrypted:
        raise InputError("Encrypted input PDFs are not supported")
    expected_pages = layout["expected_page_count"]
    if len(reader.pages) != expected_pages:
        raise InputError(
            f"Expected {expected_pages} source pages but found {len(reader.pages)}"
        )
    fields = reader.get_fields() or {}
    signed_fields = [
        str(name) for name, field in fields.items() if str(field.get("/FT")) == "/Sig"
    ]
    if signed_fields:
        raise InputError(f"Refusing to modify a signed PDF: {signed_fields}")

    tolerance = layout.get("aspect_ratio_tolerance", 0.02)
    page_info = []
    for index, (page, page_layout) in enumerate(
        zip(reader.pages, layout["pages"]), start=1
    ):
        rotation = int(page.get("/Rotate", 0) or 0) % 360
        if rotation != 0:
            raise InputError(f"Source page {index} rotation must be 0, found {rotation}")
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        ratio = width / height
        reference_width = page_layout.get(
            "reference_width_px", layout["reference_width_px"]
        )
        reference_ratio = reference_width / layout["reference_height_px"]
        if abs(ratio - reference_ratio) / reference_ratio > tolerance:
            raise InputError(
                f"Source page {index} aspect ratio does not match the layout profile"
            )
        page_info.append({"page": index, "width": width, "height": height})
    return reader, {"page_count": len(reader.pages), "pages": page_info}


def register_font(font_path: Path) -> None:
    if not font_path.is_file():
        raise InputError(f"Japanese font not found: {font_path}")
    if font_path.suffix.lower() != ".ttf":
        raise InputError("Use an embeddable Japanese TrueType .ttf font")
    try:
        pdfmetrics.registerFont(TTFont(FONT_NAME, str(font_path)))
    except Exception as exc:
        raise InputError(f"Could not register Japanese font {font_path}: {exc}") from exc


class PageGeometry:
    def __init__(
        self,
        width: float,
        height: float,
        layout: dict[str, Any],
        page_layout: dict[str, Any],
    ):
        self.width = width
        self.height = height
        reference_width = page_layout.get(
            "reference_width_px", layout["reference_width_px"]
        )
        self.x_scale = width / float(reference_width)
        self.y_scale = height / float(layout["reference_height_px"])

    def x(self, value: float) -> float:
        return value * self.x_scale

    def y(self, value: float) -> float:
        return self.height - value * self.y_scale

    def box(self, values: list[float]) -> tuple[float, float, float, float]:
        x1, x2, top, bottom = values
        return self.x(x1), self.x(x2), self.y(top), self.y(bottom)


def fit_font_size(
    text: str,
    max_width: float,
    preferred: float,
    minimum: float,
    label: str,
    fit_log: list[dict[str, Any]],
) -> float:
    size = preferred
    while size > minimum and pdfmetrics.stringWidth(text, FONT_NAME, size) > max_width:
        size = max(minimum, round(size - 0.2, 2))
    actual_width = pdfmetrics.stringWidth(text, FONT_NAME, size)
    if actual_width > max_width + 0.01:
        raise InputError(
            f"Text cannot fit {label} at minimum size {minimum}: {text!r}"
        )
    fit_log.append(
        {
            "field": label,
            "text": text,
            "font_size": size,
            "minimum": minimum,
            "available_width": round(max_width, 2),
            "text_width": round(actual_width, 2),
        }
    )
    return size


def draw_centered(
    pdf: canvas.Canvas,
    text: str,
    box: tuple[float, float, float, float],
    style: dict[str, float],
    color: Color,
    label: str,
    fit_log: list[dict[str, Any]],
    inset: float = 4.0,
) -> None:
    x1, x2, y_top, y_bottom = box
    size = fit_font_size(
        text,
        x2 - x1 - inset,
        float(style["preferred"]),
        float(style["minimum"]),
        label,
        fit_log,
    )
    pdf.setFont(FONT_NAME, size)
    pdf.setFillColor(color)
    width = pdfmetrics.stringWidth(text, FONT_NAME, size)
    baseline = (y_top + y_bottom) / 2 - size * 0.36
    pdf.drawString((x1 + x2 - width) / 2, baseline, text)


def draw_date(
    pdf: canvas.Canvas,
    row: dict[str, Any],
    x1: float,
    x2: float,
    y_top: float,
    y_bottom: float,
    style: dict[str, float],
    color: Color,
    label: str,
    fit_log: list[dict[str, Any]],
) -> None:
    center = (y_top + y_bottom) / 2
    for value, baseline, suffix in (
        (row["date"], center + 3.7, "date"),
        (row["shift"], center - 7.2, "shift"),
    ):
        size = fit_font_size(
            value,
            x2 - x1 - 3,
            float(style["preferred"]),
            float(style["minimum"]),
            f"{label}.{suffix}",
            fit_log,
        )
        pdf.setFont(FONT_NAME, size)
        pdf.setFillColor(color)
        width = pdfmetrics.stringWidth(value, FONT_NAME, size)
        pdf.drawString((x1 + x2 - width) / 2, baseline, value)


def draw_site(
    pdf: canvas.Canvas,
    row: dict[str, Any],
    x1: float,
    x2: float,
    y_top: float,
    y_bottom: float,
    styles: dict[str, dict[str, float]],
    color: Color,
    label: str,
    fit_log: list[dict[str, Any]],
) -> None:
    center = (y_top + y_bottom) / 2
    for value, baseline, style_key in (
        (row["site"], center + 3.6, "site"),
        (row["address"], center - 7.5, "address"),
    ):
        style = styles[style_key]
        size = fit_font_size(
            value,
            x2 - x1 - 5,
            float(style["preferred"]),
            float(style["minimum"]),
            f"{label}.{style_key}",
            fit_log,
        )
        pdf.setFont(FONT_NAME, size)
        pdf.setFillColor(color)
        width = pdfmetrics.stringWidth(value, FONT_NAME, size)
        pdf.drawString((x1 + x2 - width) / 2, baseline, value)


def draw_amount_digits(
    pdf: canvas.Canvas,
    amount: int,
    cell_boundaries: list[float],
    y_top: float,
    y_bottom: float,
    geometry: PageGeometry,
    style: dict[str, float],
    color: Color,
    label: str,
    fit_log: list[dict[str, Any]],
) -> None:
    digits = str(amount)
    if len(digits) > 6:
        raise InputError(f"{label} exceeds six digits: {amount}")
    centers = [
        (geometry.x(left) + geometry.x(right)) / 2
        for left, right in zip(cell_boundaries, cell_boundaries[1:])
    ]
    cell_width = min(
        geometry.x(right) - geometry.x(left)
        for left, right in zip(cell_boundaries, cell_boundaries[1:])
    )
    size = fit_font_size(
        max(digits, key=lambda digit: pdfmetrics.stringWidth(digit, FONT_NAME, 1)),
        cell_width - 2,
        float(style["preferred"]),
        float(style["minimum"]),
        label,
        fit_log,
    )
    pdf.setFont(FONT_NAME, size)
    pdf.setFillColor(color)
    baseline = (y_top + y_bottom) / 2 - size * 0.36
    for center, digit in zip(centers[-len(digits) :], digits):
        width = pdfmetrics.stringWidth(digit, FONT_NAME, size)
        pdf.drawString(center - width / 2, baseline, digit)


def build_overlay(
    page_width: float,
    page_height: float,
    root_layout: dict[str, Any],
    page_layout: dict[str, Any],
    page_rows: list[dict[str, Any]],
    document: dict[str, Any],
    page_total: int,
    grand_total: int,
    page_index: int,
) -> tuple[Any, list[dict[str, Any]]]:
    geometry = PageGeometry(page_width, page_height, root_layout, page_layout)
    styles = root_layout["styles"]
    ink = Color(*root_layout.get("ink_rgb", [0.03, 0.08, 0.2]), alpha=1)
    fit_log: list[dict[str, Any]] = []
    stream = BytesIO()
    pdf = canvas.Canvas(
        stream, pagesize=(page_width, page_height), pageCompression=1
    )

    metadata = page_layout.get("metadata")
    if metadata:
        target = document["target_date"]
        submission = document["submission_date"]
        for value, box_name, style_key in (
            (str(target["year"]), "target_year_box", "target_date"),
            (str(target["month"]), "target_month_box", "target_date"),
            (str(submission["year"]), "submission_year_box", "submission_date"),
            (str(submission["month"]), "submission_month_box", "submission_date"),
            (str(submission["day"]), "submission_day_box", "submission_date"),
            (document["employee_code"], "code_box", "code"),
            (document["employee_name"], "name_box", "name"),
        ):
            draw_centered(
                pdf,
                value,
                geometry.box(metadata[box_name]),
                styles[style_key],
                ink,
                f"page{page_index + 1}.{box_name}",
                fit_log,
            )
        grand_top, grand_bottom = metadata["grand_total_y"]
        draw_amount_digits(
            pdf,
            grand_total,
            metadata["grand_total_cells"],
            geometry.y(grand_top),
            geometry.y(grand_bottom),
            geometry,
            styles["grand_total"],
            ink,
            "grand_total",
            fit_log,
        )

    x_date = [geometry.x(value) for value in page_layout["date_box"]]
    x_site = [geometry.x(value) for value in page_layout["site_box"]]
    x_route = [geometry.x(value) for value in page_layout["route_box"]]
    bounds = page_layout["row_bounds"]
    for row_number, (row, top, bottom) in enumerate(
        zip(page_rows, bounds, bounds[1:]), start=1
    ):
        y_top = geometry.y(top)
        y_bottom = geometry.y(bottom)
        mid = (y_top + y_bottom) / 2
        label = f"page{page_index + 1}.row{row_number}"
        draw_date(
            pdf,
            row,
            *x_date,
            y_top,
            y_bottom,
            styles["date"],
            ink,
            label,
            fit_log,
        )
        draw_site(
            pdf,
            row,
            *x_site,
            y_top,
            y_bottom,
            styles,
            ink,
            label,
            fit_log,
        )
        draw_centered(
            pdf,
            row["route"],
            (x_route[0], x_route[1], y_top, mid),
            styles["route"],
            ink,
            f"{label}.route",
            fit_log,
        )
        draw_centered(
            pdf,
            row["fare"],
            (x_route[0], x_route[1], mid, y_bottom),
            styles["fare"],
            ink,
            f"{label}.fare",
            fit_log,
        )
        draw_amount_digits(
            pdf,
            row["amount"],
            page_layout["amount_cells"],
            y_top,
            y_bottom,
            geometry,
            styles["amount"],
            ink,
            f"{label}.amount",
            fit_log,
        )

    total_top, total_bottom = page_layout["page_total_y"]
    draw_amount_digits(
        pdf,
        page_total,
        page_layout["amount_cells"],
        geometry.y(total_top),
        geometry.y(total_bottom),
        geometry,
        styles["page_total"],
        ink,
        f"page{page_index + 1}.page_total",
        fit_log,
    )
    pdf.save()
    stream.seek(0)
    return PdfReader(stream).pages[0], fit_log


def write_report(path: Path | None, report: dict[str, Any]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def execute(args: argparse.Namespace, write_output: bool) -> dict[str, Any]:
    input_pdf = args.input_pdf.expanduser().resolve()
    data_path = args.data.expanduser().resolve()
    layout_path = args.layout.expanduser().resolve()
    font_path = args.font.expanduser().resolve()
    data = load_json(data_path)
    layout = load_json(layout_path)
    validated = validate_data(data, layout)
    source_hash_before = sha256_file(input_pdf)
    reader, source_info = inspect_source(input_pdf, layout)
    register_font(font_path)

    overlays = []
    fit_log: list[dict[str, Any]] = []
    for index, (source_page, page_layout, page_rows, page_total) in enumerate(
        zip(
            reader.pages,
            layout["pages"],
            validated["page_rows"],
            validated["page_totals"],
        )
    ):
        overlay, page_fit_log = build_overlay(
            float(source_page.mediabox.width),
            float(source_page.mediabox.height),
            layout,
            page_layout,
            page_rows,
            validated["document"],
            page_total,
            validated["direct_total"],
            index,
        )
        overlays.append(overlay)
        fit_log.extend(page_fit_log)

    report: dict[str, Any] = {
        "status": "validated" if not write_output else "filled",
        "source_pdf": str(input_pdf),
        "source_sha256": source_hash_before,
        "data_sha256": data_sha256(data),
        "layout_profile": layout.get("profile_name"),
        "font": str(font_path),
        "source": source_info,
        "row_counts": validated["row_counts"],
        "total_rows": len(validated["rows"]),
        "page_totals": validated["page_totals"],
        "direct_total": validated["direct_total"],
        "page_checksum": validated["page_checksum"],
        "fit_checks": fit_log,
    }
    if not write_output:
        write_report(args.report, report)
        return report

    output_pdf = args.output_pdf.expanduser().resolve()
    if input_pdf == output_pdf:
        raise InputError("Output PDF must not be the input PDF")
    if output_pdf.exists():
        raise InputError(f"Refusing to overwrite existing output: {output_pdf}")
    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    for page, overlay in zip(writer.pages, overlays):
        page.merge_page(overlay)
    document = validated["document"]
    target = document["target_date"]
    writer.add_metadata(
        {
            "/Title": (
                f"令和{target['year']}年{target['month']}月 通勤費伝票 - "
                f"{document['employee_name']}"
            ),
            "/Author": document["employee_name"],
            "/Subject": "通勤費伝票（頁計・総合計検算済み）",
            "/CommuteExpenseSourceSHA256": source_hash_before,
            "/CommuteExpenseDataSHA256": report["data_sha256"],
            "/CommuteExpenseRowCounts": json.dumps(validated["row_counts"]),
            "/CommuteExpensePageTotals": json.dumps(validated["page_totals"]),
            "/CommuteExpenseGrandTotal": str(validated["direct_total"]),
        }
    )

    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=f".{output_pdf.name}.",
            suffix=".tmp",
            dir=output_pdf.parent,
            delete=False,
        ) as stream:
            temporary_path = Path(stream.name)
            writer.write(stream)
        reopened = PdfReader(str(temporary_path))
        if len(reopened.pages) != layout["expected_page_count"]:
            raise InputError("Written PDF failed page-count verification")
        if sha256_file(input_pdf) != source_hash_before:
            raise InputError("Source PDF changed during processing")
        os.replace(temporary_path, output_pdf)
        temporary_path = None
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()

    report["output_pdf"] = str(output_pdf)
    report["output_sha256"] = sha256_file(output_pdf)
    report["source_unchanged"] = sha256_file(input_pdf) == source_hash_before
    write_report(args.report, report)
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate or fill a two-page Japanese commute-expense PDF"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument("--input-pdf", required=True, type=Path)
        subparser.add_argument("--data", required=True, type=Path)
        subparser.add_argument("--layout", type=Path, default=DEFAULT_LAYOUT)
        subparser.add_argument("--font", required=True, type=Path)
        subparser.add_argument("--report", type=Path)

    validate_parser = subparsers.add_parser(
        "validate", help="Validate source, data, totals, layout, font, and fit"
    )
    add_common(validate_parser)

    fill_parser = subparsers.add_parser(
        "fill", help="Create a separate completed PDF"
    )
    add_common(fill_parser)
    fill_parser.add_argument("--output-pdf", required=True, type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        report = execute(args, write_output=args.command == "fill")
    except (InputError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    summary_keys = (
        "status",
        "source_pdf",
        "output_pdf",
        "row_counts",
        "total_rows",
        "page_totals",
        "direct_total",
        "page_checksum",
        "source_unchanged",
    )
    summary = {key: report[key] for key in summary_keys if key in report}
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
