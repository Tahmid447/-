#!/usr/bin/env python3
"""Validate normalized commute-slip data and its approval binding.

Uses only the Python standard library. The release digest covers every
output-affecting section except ``approval`` so a post-approval edit forces a
new approval.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any
from instruction_chain import assess_chain, check_work_counts


SCHEMA_VERSION = "1.0"
OUTPUT_FORMATS = {"pdf", "docx", "html", "json", "csv", "xlsx"}
CATEGORIES = {"day", "night", "training", "medical_exam", "company_business", "other"}
STATUSES = {"confirmed", "needs_confirmation", "excluded"}
CALCULATION_KINDS = {"round_trip", "one_way", "continuous_journey", "custom"}
CONFIDENCE_LEVELS = {"explicit", "inferred"}
YEAR_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _parse_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def release_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Return the output-affecting payload covered by user approval."""

    return {
        key: data.get(key)
        for key in ("schema_version", "document", "people", "records", "reconciliation")
    }


def compute_digest(data: dict[str, Any]) -> str:
    encoded = json.dumps(
        release_payload(data),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_approval_receipt(receipt: Any, expected_digest: str) -> list[str]:
    """Validate a task-local record of the user's explicit approval."""

    errors: list[str] = []
    if not isinstance(receipt, dict):
        return ["approval_receipt: separate receipt object required for release"]
    if receipt.get("receipt_version") != "1.0":
        errors.append("approval_receipt.receipt_version: expected '1.0'")
    if receipt.get("approved_digest") != expected_digest:
        errors.append("approval_receipt.approved_digest: does not cover current data")
    if receipt.get("user_approved") is not True:
        errors.append("approval_receipt.user_approved: true required")
    if _parse_datetime(receipt.get("approved_at")) is None:
        errors.append("approval_receipt.approved_at: valid ISO date-time required")
    source = receipt.get("approval_source")
    if not isinstance(source, dict):
        errors.append("approval_receipt.approval_source: object required")
    else:
        if source.get("kind") not in {"user_message", "signed_record"}:
            errors.append("approval_receipt.approval_source.kind: user_message or signed_record required")
        if not _nonempty_string(source.get("locator")):
            errors.append("approval_receipt.approval_source.locator: required")
        if not _nonempty_string(source.get("approval_text")):
            errors.append("approval_receipt.approval_source.approval_text: required")
    return errors


def validate_document(
    data: Any,
    release: bool = False,
    approval_receipt: Any = None,
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(data, dict):
        return ["root: JSON object required"], warnings

    if data.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version: expected {SCHEMA_VERSION!r}")

    document = data.get("document")
    if not isinstance(document, dict):
        errors.append("document: object required")
        document = {}

    target_month = document.get("target_year_month")
    if not isinstance(target_month, str) or not YEAR_MONTH_RE.fullmatch(target_month):
        errors.append("document.target_year_month: YYYY-MM required")
        target_month = None

    outputs = document.get("requested_outputs")
    if not isinstance(outputs, list) or not outputs:
        errors.append("document.requested_outputs: non-empty array required")
        outputs = []
    else:
        unknown_outputs = sorted({item for item in outputs if item not in OUTPUT_FORMATS})
        if unknown_outputs:
            errors.append(f"document.requested_outputs: unsupported values {unknown_outputs}")

    if release:
        if _parse_date(document.get("submission_date")) is None:
            errors.append("document.submission_date: valid YYYY-MM-DD required for release")
        if "pdf" in outputs and not _nonempty_string(document.get("template_file")):
            errors.append("document.template_file: required when releasing a PDF")

    people = data.get("people")
    if not isinstance(people, list) or not people:
        errors.append("people: non-empty array required")
        people = []

    person_ids: set[str] = set()
    for index, person in enumerate(people):
        path = f"people[{index}]"
        if not isinstance(person, dict):
            errors.append(f"{path}: object required")
            continue
        person_id = person.get("person_id")
        if not _nonempty_string(person_id):
            errors.append(f"{path}.person_id: non-empty string required")
        elif person_id in person_ids:
            errors.append(f"{path}.person_id: duplicate {person_id!r}")
        else:
            person_ids.add(person_id)
        if not _nonempty_string(person.get("name")):
            errors.append(f"{path}.name: non-empty string required")
        if not _nonempty_string(person.get("employee_code")):
            errors.append(f"{path}.employee_code: non-empty string required")
        stations = person.get("home_stations")
        if not isinstance(stations, list) or not stations or not all(_nonempty_string(x) for x in stations):
            errors.append(f"{path}.home_stations: at least one station string required")

    records = data.get("records")
    if not isinstance(records, list):
        errors.append("records: array required")
        records = []

    record_ids: set[str] = set()
    counts: dict[str, int] = defaultdict(int)
    totals: dict[str, int] = defaultdict(int)
    record_dates_by_person: dict[str, set[str]] = defaultdict(set)
    confirmed_categories_by_person_date: dict[tuple[str, str], set[str]] = defaultdict(set)

    for index, record in enumerate(records):
        path = f"records[{index}]"
        if not isinstance(record, dict):
            errors.append(f"{path}: object required")
            continue

        record_id = record.get("record_id")
        if not _nonempty_string(record_id):
            errors.append(f"{path}.record_id: non-empty string required")
        elif record_id in record_ids:
            errors.append(f"{path}.record_id: duplicate {record_id!r}")
        else:
            record_ids.add(record_id)

        person_id = record.get("person_id")
        if person_id not in person_ids:
            errors.append(f"{path}.person_id: unknown person {person_id!r}")

        service_date = _parse_date(record.get("service_date"))
        if service_date is None:
            errors.append(f"{path}.service_date: valid YYYY-MM-DD required")
        elif person_id in person_ids:
            record_dates_by_person[person_id].add(record["service_date"])

        category = record.get("category")
        if category not in CATEGORIES:
            errors.append(f"{path}.category: must be one of {sorted(CATEGORIES)}")

        status = record.get("status")
        if status not in STATUSES:
            errors.append(f"{path}.status: must be one of {sorted(STATUSES)}")
            continue

        if "instruction_chain" in record:
            chain_status, reasons = assess_chain(record["instruction_chain"], person_id)
            if status != "needs_confirmation" and chain_status != status:
                errors.append(f"{path}.instruction_chain: {chain_status}; " + "; ".join(reasons))
            if status == "confirmed" and chain_status == "confirmed":
                actual = [event for event in record["instruction_chain"]["events"] if event.get("kind") in {"departure", "arrival", "start", "end", "next_morning", "actual_site", "user_confirmation"} and event.get("site") and event.get("service_date")]
                site = record.get("worksite", {})
                names = {site.get("company_name"), site.get("site_name"), "・".join(filter(None, [site.get("company_name"), site.get("site_name")]))}
                if any(event["service_date"] != record.get("service_date") or event["site"] not in names for event in actual):
                    errors.append(f"{path}.instruction_chain: actual site/date differs from record")

        evidence = record.get("source_evidence")
        if not isinstance(evidence, list):
            errors.append(f"{path}.source_evidence: array required")
            evidence = []
        for evidence_index, item in enumerate(evidence):
            evidence_path = f"{path}.source_evidence[{evidence_index}]"
            if not isinstance(item, dict):
                errors.append(f"{evidence_path}: object required")
                continue
            for key in ("source_id", "locator", "fact_type", "note"):
                if not _nonempty_string(item.get(key)):
                    errors.append(f"{evidence_path}.{key}: non-empty string required")
            if item.get("confidence") not in CONFIDENCE_LEVELS:
                errors.append(
                    f"{evidence_path}.confidence: must be one of {sorted(CONFIDENCE_LEVELS)}"
                )

        if status == "needs_confirmation":
            if not evidence:
                warnings.append(f"{path}: unresolved row has no source evidence yet")
            if release:
                errors.append(f"{path}: unresolved row blocks release")
            continue

        if not evidence:
            errors.append(f"{path}: confirmed/excluded row requires source evidence")

        if status == "excluded":
            if not _nonempty_string(record.get("notes")):
                errors.append(f"{path}.notes: exclusion reason required")
            continue

        if service_date is not None and category in CATEGORIES and person_id in person_ids:
            confirmed_categories_by_person_date[(person_id, record["service_date"])].add(category)

        if service_date is not None and target_month is not None:
            record_month = f"{service_date.year:04d}-{service_date.month:02d}"
            if record_month != target_month and record.get("outside_target_period_confirmed") is not True:
                errors.append(
                    f"{path}.outside_target_period_confirmed: true required for a month-external row"
                )

        worksite = record.get("worksite")
        if not isinstance(worksite, dict):
            errors.append(f"{path}.worksite: object required for confirmed row")
        elif not any(_nonempty_string(worksite.get(key)) for key in ("company_name", "site_name")):
            errors.append(f"{path}.worksite: company_name or site_name required")

        route = record.get("route")
        if not isinstance(route, dict):
            errors.append(f"{path}.route: object required for confirmed row")
            route = {}
        for key in ("from_station", "to_station", "display_interval"):
            if not _nonempty_string(route.get(key)):
                errors.append(f"{path}.route.{key}: non-empty string required")
        if not _nonempty_string(route.get("rationale")):
            errors.append(f"{path}.route.rationale: non-empty selection reason required")
        bus_used = route.get("bus_used")
        if not isinstance(bus_used, bool):
            errors.append(f"{path}.route.bus_used: boolean required")
        bus_details = route.get("bus_details")
        if not isinstance(bus_details, list):
            errors.append(f"{path}.route.bus_details: array required")
            bus_details = []
        if bus_used is True and not bus_details:
            errors.append(f"{path}.route.bus_details: at least one bus leg required when bus_used is true")
        if bus_used is False and bus_details:
            errors.append(f"{path}.route.bus_details: must be empty when bus_used is false")
        for bus_index, bus in enumerate(bus_details):
            bus_path = f"{path}.route.bus_details[{bus_index}]"
            if not isinstance(bus, dict):
                errors.append(f"{bus_path}: object required")
                continue
            if bus.get("direction") not in {"outbound", "return", "other"}:
                errors.append(f"{bus_path}.direction: outbound, return, or other required")
            for key in ("from_stop", "to_stop"):
                if not _nonempty_string(bus.get(key)):
                    errors.append(f"{bus_path}.{key}: non-empty string required")
            if release and bus.get("verified") is not True:
                errors.append(f"{bus_path}.verified: true required for release")

        fare = record.get("fare")
        if not isinstance(fare, dict):
            errors.append(f"{path}.fare: object required for confirmed row")
            continue

        calculation_kind = fare.get("calculation_kind")
        if calculation_kind not in CALCULATION_KINDS:
            errors.append(
                f"{path}.fare.calculation_kind: must be one of {sorted(CALCULATION_KINDS)}"
            )

        payable = fare.get("payable_yen")
        if not _is_int(payable) or payable < 0:
            errors.append(f"{path}.fare.payable_yen: non-negative integer required")
            payable = None

        components = fare.get("components", [])
        if not isinstance(components, list):
            errors.append(f"{path}.fare.components: array required")
            components = []
        component_total = 0
        for component_index, component in enumerate(components):
            component_path = f"{path}.fare.components[{component_index}]"
            if not isinstance(component, dict):
                errors.append(f"{component_path}: object required")
                continue
            if not _nonempty_string(component.get("label")):
                errors.append(f"{component_path}.label: non-empty string required")
            amount = component.get("amount_yen")
            if not _is_int(amount) or amount < 0:
                errors.append(f"{component_path}.amount_yen: non-negative integer required")
            else:
                component_total += amount

        if components and payable is not None and component_total != payable:
            errors.append(
                f"{path}.fare: component sum {component_total} != payable_yen {payable}"
            )

        one_way = fare.get("one_way_ic_yen")
        if calculation_kind == "round_trip" and not components:
            if not _is_int(one_way) or one_way < 0:
                errors.append(f"{path}.fare.one_way_ic_yen: non-negative integer required")
            elif payable is not None and one_way * 2 != payable:
                errors.append(
                    f"{path}.fare: one_way_ic_yen × 2 ({one_way * 2}) != payable_yen {payable}"
                )
        elif calculation_kind == "one_way" and not components:
            if not _is_int(one_way) or one_way < 0:
                errors.append(f"{path}.fare.one_way_ic_yen: non-negative integer required")
            elif payable is not None and one_way != payable:
                errors.append(
                    f"{path}.fare: one_way_ic_yen {one_way} != payable_yen {payable}"
                )
        elif calculation_kind in {"continuous_journey", "custom"} and not components:
            errors.append(f"{path}.fare.components: required for {calculation_kind}")

        if calculation_kind == "round_trip":
            interval = route.get("display_interval")
            if isinstance(interval, str) and "↔" not in interval:
                errors.append(f"{path}.route.display_interval: round trip must contain ↔")

        if not _nonempty_string(fare.get("calculation_note")):
            errors.append(f"{path}.fare.calculation_note: required")

        source_urls = fare.get("source_urls")
        if not isinstance(source_urls, list) or not all(_nonempty_string(url) for url in source_urls):
            errors.append(f"{path}.fare.source_urls: array of URL strings required")

        if release:
            if fare.get("verified") is not True:
                errors.append(f"{path}.fare.verified: true required for release")
            if not _nonempty_string(fare.get("verification_basis")):
                errors.append(f"{path}.fare.verification_basis: required for release")
            elif fare.get("verification_basis") == "official_source" and not source_urls:
                errors.append(f"{path}.fare.source_urls: official_source requires at least one URL")
            verified_on = fare.get("verified_on")
            if _parse_date(verified_on) is None:
                errors.append(f"{path}.fare.verified_on: valid YYYY-MM-DD required for release")

        if person_id in person_ids and payable is not None:
            counts[person_id] += 1
            totals[person_id] += payable

    reconciliation = data.get("reconciliation")
    if not isinstance(reconciliation, dict):
        errors.append("reconciliation: object required")
        reconciliation = {}

    if "expected_work_counts_by_person" in reconciliation:
        expected_work = reconciliation["expected_work_counts_by_person"]
        if isinstance(expected_work, dict) and set(expected_work) - person_ids:
            errors.append("reconciliation.expected_work_counts_by_person: unknown person")
        work_errors = check_work_counts(records, expected_work, target_month)
        if release:
            errors.extend(work_errors)
        else:
            warnings.extend(work_errors)

    date_sets: dict[str, dict[str, set[str]]] = {}
    for key in (
        "mentioned_work_dates_by_person",
        "source_work_dates_by_person",
        "explicit_non_work_dates_by_person",
    ):
        values_by_person = reconciliation.get(key)
        date_sets[key] = {}
        if not isinstance(values_by_person, dict):
            errors.append(f"reconciliation.{key}: object keyed by person_id required")
            continue
        unknown_people = set(values_by_person) - person_ids
        if unknown_people:
            errors.append(f"reconciliation.{key}: unknown people {sorted(unknown_people)}")
        for person_id in person_ids:
            values = values_by_person.get(person_id)
            if not isinstance(values, list):
                errors.append(f"reconciliation.{key}.{person_id}: array required")
                date_sets[key][person_id] = set()
                continue
            parsed: set[str] = set()
            for index, value in enumerate(values):
                if _parse_date(value) is None:
                    errors.append(
                        f"reconciliation.{key}.{person_id}[{index}]: valid YYYY-MM-DD required"
                    )
                else:
                    parsed.add(value)
            date_sets[key][person_id] = parsed

    if not isinstance(reconciliation.get("known_source_gaps"), list):
        errors.append("reconciliation.known_source_gaps: array required")

    for person_id in person_ids:
        represented = date_sets.get("mentioned_work_dates_by_person", {}).get(person_id, set()) | date_sets.get(
            "source_work_dates_by_person", {}
        ).get(person_id, set())
        non_work = date_sets.get("explicit_non_work_dates_by_person", {}).get(person_id, set())
        actual = record_dates_by_person.get(person_id, set())
        missing_records = represented - actual
        untracked_records = actual - (represented | non_work)
        non_work_conflicts = {
            day
            for day in non_work
            if confirmed_categories_by_person_date.get((person_id, day), set()) & {"day", "night"}
        }
        if release:
            if missing_records:
                errors.append(
                    f"reconciliation.{person_id}: mentioned/source dates lack a record: {sorted(missing_records)}"
                )
            if untracked_records:
                errors.append(
                    f"reconciliation.{person_id}: record dates are absent from evidence date sets: {sorted(untracked_records)}"
                )
            if non_work_conflicts:
                errors.append(
                    f"reconciliation.{person_id}: explicit non-work dates contain day/night rows: {sorted(non_work_conflicts)}"
                )
        else:
            if missing_records:
                warnings.append(
                    f"reconciliation.{person_id}: dates still lack a candidate/excluded record: {sorted(missing_records)}"
                )
            if untracked_records:
                warnings.append(
                    f"reconciliation.{person_id}: record dates are not yet in evidence date sets: {sorted(untracked_records)}"
                )

    expected_counts = reconciliation.get("expected_payable_row_counts")
    expected_totals = reconciliation.get("expected_totals_yen")
    for label, expected, actual in (
        ("expected_payable_row_counts", expected_counts, counts),
        ("expected_totals_yen", expected_totals, totals),
    ):
        if not isinstance(expected, dict):
            errors.append(f"reconciliation.{label}: object required")
            continue
        for person_id in person_ids:
            value = expected.get(person_id)
            if not _is_int(value) or value < 0:
                errors.append(f"reconciliation.{label}.{person_id}: non-negative integer required")
            elif value != actual.get(person_id, 0):
                errors.append(
                    f"reconciliation.{label}.{person_id}: expected {value}, computed {actual.get(person_id, 0)}"
                )

    if release:
        if reconciliation.get("date_reconciliation_complete") is not True:
            errors.append("reconciliation.date_reconciliation_complete: true required for release")
        gaps = reconciliation.get("known_source_gaps")
        if isinstance(gaps, list) and gaps:
            errors.append("reconciliation.known_source_gaps: must be empty for release")

    approval = data.get("approval")
    if not isinstance(approval, dict):
        errors.append("approval: object required")
        approval = {}

    if release:
        if approval.get("confirmation_table_present") is not True:
            errors.append("approval.confirmation_table_present: true required for release")
        if approval.get("status") != "approved":
            errors.append("approval.status: 'approved' required for release")
        if approval.get("user_approved") is not True:
            errors.append("approval.user_approved: true required for release")
        if _parse_datetime(approval.get("approved_at")) is None:
            errors.append("approval.approved_at: valid ISO date-time required for release")
        expected_digest = compute_digest(data)
        if approval.get("data_digest") != expected_digest:
            errors.append("approval.data_digest: mismatch; data changed or digest was not recorded")
        errors.extend(validate_approval_receipt(approval_receipt, expected_digest))

    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("json_file", type=Path)
    parser.add_argument("--release-check", action="store_true")
    parser.add_argument("--print-digest", action="store_true")
    parser.add_argument(
        "--approval-receipt",
        type=Path,
        help="Separate JSON record of the user's explicit approval; required with --release-check",
    )
    args = parser.parse_args(argv)

    try:
        data = json.loads(args.json_file.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"ERROR: file not found: {args.json_file}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON: {exc}", file=sys.stderr)
        return 2

    approval_receipt: Any = None
    if args.approval_receipt is not None:
        try:
            approval_receipt = json.loads(args.approval_receipt.read_text(encoding="utf-8"))
        except FileNotFoundError:
            print(f"ERROR: approval receipt not found: {args.approval_receipt}", file=sys.stderr)
            return 2
        except json.JSONDecodeError as exc:
            print(f"ERROR: invalid approval receipt JSON: {exc}", file=sys.stderr)
            return 2
    elif args.release_check:
        print("ERROR: --approval-receipt is required with --release-check", file=sys.stderr)
        return 2

    errors, warnings = validate_document(
        data,
        release=args.release_check,
        approval_receipt=approval_receipt,
    )
    for warning in warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)

    if args.print_digest:
        print(f"release_digest={compute_digest(data)}")

    if errors:
        print(f"VALIDATION_FAILED errors={len(errors)} warnings={len(warnings)}", file=sys.stderr)
        return 1

    mode = "release" if args.release_check else "structure"
    print(f"VALIDATION_OK mode={mode} warnings={len(warnings)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
