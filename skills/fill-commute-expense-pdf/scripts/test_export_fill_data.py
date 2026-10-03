#!/usr/bin/env python3
"""Behavior tests for export_fill_data.py."""

from __future__ import annotations

import unittest

from export_fill_data import ExportError, build_fill_data
from test_validate_commute_data import approval_receipt, release_fixture
from validate_commute_data import compute_digest


class ExportTests(unittest.TestCase):
    def test_exports_approved_person(self) -> None:
        ledger = release_fixture()
        output = build_fill_data(
            ledger,
            approval_receipt(ledger),
            "person-1",
        )
        self.assertEqual(output["document"]["target_date"], {
            "era": "令和",
            "year": 81,
            "month": 1,
        })
        self.assertEqual(output["document"]["expected_page_row_counts"], [1, 0])
        self.assertEqual(output["document"]["expected_page_totals"], [420, 0])
        self.assertEqual(output["document"]["expected_grand_total"], 420)
        self.assertEqual(output["rows"][0]["shift"], "日勤")
        self.assertEqual(output["rows"][0]["amount"], 420)

    def test_preserves_approved_category_label(self) -> None:
        ledger = release_fixture()
        ledger["records"][0]["category_label"] = "現任研修"
        ledger["approval"]["data_digest"] = compute_digest(ledger)
        output = build_fill_data(
            ledger,
            approval_receipt(ledger),
            "person-1",
        )
        self.assertEqual(output["rows"][0]["shift"], "現任研修")

    def test_rejects_post_approval_change(self) -> None:
        ledger = release_fixture()
        receipt = approval_receipt(ledger)
        ledger["records"][0]["fare"]["payable_yen"] = 421
        with self.assertRaisesRegex(ExportError, "release validation failed"):
            build_fill_data(ledger, receipt, "person-1")

    def test_rejects_unknown_person(self) -> None:
        ledger = release_fixture()
        with self.assertRaisesRegex(ExportError, "person_id not found"):
            build_fill_data(ledger, approval_receipt(ledger), "missing")


if __name__ == "__main__":
    unittest.main(verbosity=2)
