#!/usr/bin/env python3
"""Export one person's approved commute ledger to fill_commute_pdf.py JSON."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

from validate_commute_data import validate_document


PAGE_CAPACITIES = (15, 17)
CATEGORY_LABELS = {
    "day": "日勤",
    "night": "夜勤",
    "training": "研修",
    "medical_exam": "健康診断",
    "company_business": "会社用件",
    "other": "その他",
}


class ExportError(ValueError):
    """Raised when an approved ledger cannot be exported safely."""


def load_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ExportError(f"{label} not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ExportError(f"{label} is not valid JSON: {exc}") from exc


def parse_date(value: str, label: str) -> date:
    try:
        parsed = date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ExportError(f"{label} must be a valid ISO date") from exc
    if parsed < date(2019, 5, 1):
        raise ExportError(f"{label} is outside the Reiwa era")
    return parsed


def reiwa_year(value: date) -> int:
    return value.year - 2018


def worksite_label(worksite: dict[str, Any]) -> str:
    company = str(worksite.get("company_name") or "").strip()
    site = str(worksite.get("site_name") or "").strip()
    if company and site and company != site:
        return f"{company}・{site}"
    result = company or site
    if not result:
        raise ExportError("confirmed record is missing a worksite label")
    return result


def allocate(values: list[int]) -> tuple[list[int], list[int]]:
    if len(values) > sum(PAGE_CAPACITIES):
        raise ExportError(
            f"{len(values)} confirmed rows exceed the two-page capacity "
            f"of {sum(PAGE_CAPACITIES)}"
        )
    counts: list[int] = []
    totals: list[int] = []
    offset = 0
    for capacity in PAGE_CAPACITIES:
        count = min(capacity, max(0, len(values) - offset))
        counts.append(count)
        totals.append(sum(values[offset : offset + count]))
        offset += count
    return counts, totals


def build_fill_data(
    ledger: dict[str, Any],
    approval_receipt: dict[str, Any],
    person_id: str,
) -> dict[str, Any]:
    errors, warnings = validate_document(
        ledger,
        release=True,
        approval_receipt=approval_receipt,
    )
    if errors:
        joined = "\n".join(f"- {error}" for error in errors)
        raise ExportError(f"release validation failed:\n{joined}")
    for warning in warnings:
        print(f"WARNING: {warning}", file=sys.stderr)

    people = ledger["people"]
    person = next(
        (candidate for candidate in people if candidate.get("person_id") == person_id),
        None,
    )
    if person is None:
        raise ExportError(f"person_id not found: {person_id}")

    document = ledger["document"]
    target = parse_date(f"{document['target_year_month']}-01", "target month")
    submission = parse_date(document["submission_date"], "submission date")

    output_rows: list[dict[str, Any]] = []
    amounts: list[int] = []
    for record in ledger["records"]:
        if record.get("person_id") != person_id or record.get("status") != "confirmed":
            continue
        service_date = parse_date(record["service_date"], "service date")
        worksite = record["worksite"]
        address = str(worksite.get("address") or "").strip()
        if not address:
            raise ExportError(
                f"{record.get('record_id', '<unknown>')} is missing the worksite address"
            )
        category = record["category"]
        category_label = record.get("category_label") or CATEGORY_LABELS[category]
        amount = record["fare"]["payable_yen"]
        output_rows.append(
            {
                "date": f"{service_date.month}/{service_date.day}",
                "shift": category_label,
                "site": worksite_label(worksite),
                "address": address,
                "route": record["route"]["display_interval"],
                "fare": record["fare"]["calculation_note"],
                "amount": amount,
            }
        )
        amounts.append(amount)

    if not output_rows:
        raise ExportError(f"person_id has no confirmed payable rows: {person_id}")

    page_counts, page_totals = allocate(amounts)
    return {
        "document": {
            "target_date": {
                "era": "令和",
                "year": reiwa_year(target),
                "month": target.month,
            },
            "submission_date": {
                "era": "令和",
                "year": reiwa_year(submission),
                "month": submission.month,
                "day": submission.day,
            },
            "employee_code": person["employee_code"],
            "employee_name": person["name"],
            "expected_row_count": len(output_rows),
            "expected_page_row_counts": page_counts,
            "expected_page_totals": page_totals,
            "expected_grand_total": sum(amounts),
        },
        "rows": output_rows,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ledger", type=Path)
    parser.add_argument("--approval-receipt", required=True, type=Path)
    parser.add_argument("--person-id", required=True)
    parser.add_argument("--output", required=True, type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        ledger = load_json(args.ledger, "ledger")
        receipt = load_json(args.approval_receipt, "approval receipt")
        output = build_fill_data(ledger, receipt, args.person_id)
        destination = args.output.expanduser().resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("x", encoding="utf-8") as stream:
            json.dump(output, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    except (ExportError, FileExistsError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(
        f"EXPORT_OK person_id={args.person_id} "
        f"rows={output['document']['expected_row_count']} "
        f"total={output['document']['expected_grand_total']} "
        f"output={destination}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
