#!/usr/bin/env python3
"""Behavior tests for validate_commute_data.py."""

from __future__ import annotations

import unittest

from validate_commute_data import compute_digest, validate_document


def release_fixture() -> dict:
    data = {
        "schema_version": "1.0",
        "document": {
            "target_year_month": "2099-01",
            "submission_date": "2099-02-01",
            "template_file": None,
            "requested_outputs": ["json", "csv"],
        },
        "people": [
            {
                "person_id": "person-1",
                "name": "テスト利用者",
                "employee_code": "000001",
                "address": "テスト住所",
                "home_stations": ["出発駅"],
                "route_preferences": {
                    "home_to_station": "徒歩",
                    "bus_walk_threshold_minutes": 15,
                    "selection_priority": ["合理性", "歩行負担"],
                },
            }
        ],
        "records": [
            {
                "record_id": "row-001",
                "person_id": "person-1",
                "service_date": "2099-01-15",
                "category": "day",
                "worksite": {
                    "company_name": "取引先A",
                    "site_name": "警備現場A",
                    "address": "現場住所",
                    "nearest_station": "到着駅",
                },
                "route": {
                    "from_station": "出発駅",
                    "to_station": "到着駅",
                    "display_interval": "出発駅 ↔ 到着駅",
                    "bus_used": False,
                    "bus_details": [],
                    "rationale": "合理的な直通経路",
                },
                "fare": {
                    "calculation_kind": "round_trip",
                    "one_way_ic_yen": 210,
                    "components": [],
                    "payable_yen": 420,
                    "calculation_note": "210×2",
                    "verified": True,
                    "verification_basis": "user_confirmed",
                    "source_urls": [],
                    "verified_on": "2099-01-10",
                },
                "source_evidence": [
                    {
                        "source_id": "source-1",
                        "locator": "frame-001",
                        "fact_type": "勤務日・現場",
                        "note": "勤務指示を確認",
                        "confidence": "explicit",
                    }
                ],
                "status": "confirmed",
                "outside_target_period_confirmed": False,
                "notes": "",
            }
        ],
        "reconciliation": {
            "mentioned_work_dates_by_person": {"person-1": ["2099-01-15"]},
            "source_work_dates_by_person": {"person-1": ["2099-01-15"]},
            "explicit_non_work_dates_by_person": {"person-1": []},
            "date_reconciliation_complete": True,
            "known_source_gaps": [],
            "expected_payable_row_counts": {"person-1": 1},
            "expected_totals_yen": {"person-1": 420},
        },
        "approval": {
            "confirmation_table_present": True,
            "status": "approved",
            "user_approved": True,
            "approved_at": "2099-01-31T12:00:00+09:00",
            "data_digest": None,
        },
    }
    data["approval"]["data_digest"] = compute_digest(data)
    return data


def approval_receipt(data: dict) -> dict:
    return {
        "receipt_version": "1.0",
        "approved_digest": data["approval"]["data_digest"],
        "user_approved": True,
        "approved_at": "2099-01-31T12:00:00+09:00",
        "approval_source": {
            "kind": "user_message",
            "locator": "test-thread-turn-1",
            "approval_text": "この確認表の内容で作成してよい",
        },
    }


class ValidatorTests(unittest.TestCase):
    def test_valid_release(self) -> None:
        data = release_fixture()
        errors, _ = validate_document(data, release=True, approval_receipt=approval_receipt(data))
        self.assertEqual(errors, [])

    def test_post_approval_edit_breaks_digest_and_total(self) -> None:
        data = release_fixture()
        receipt = approval_receipt(data)
        data["records"][0]["fare"]["payable_yen"] = 421
        errors, _ = validate_document(data, release=True, approval_receipt=receipt)
        self.assertTrue(any("one_way_ic_yen" in error for error in errors))
        self.assertTrue(any("expected_totals_yen" in error for error in errors))
        self.assertTrue(any("data_digest" in error for error in errors))

    def test_month_external_row_needs_specific_confirmation(self) -> None:
        data = release_fixture()
        data["records"][0]["service_date"] = "2099-02-15"
        data["approval"]["data_digest"] = compute_digest(data)
        errors, _ = validate_document(data, release=True, approval_receipt=approval_receipt(data))
        self.assertTrue(any("outside_target_period_confirmed" in error for error in errors))

    def test_unresolved_row_blocks_release(self) -> None:
        data = release_fixture()
        data["records"][0]["status"] = "needs_confirmation"
        data["reconciliation"]["expected_payable_row_counts"]["person-1"] = 0
        data["reconciliation"]["expected_totals_yen"]["person-1"] = 0
        data["approval"]["data_digest"] = compute_digest(data)
        errors, _ = validate_document(data, release=True, approval_receipt=approval_receipt(data))
        self.assertTrue(any("unresolved row blocks release" in error for error in errors))

    def test_component_sum_must_match(self) -> None:
        data = release_fixture()
        fare = data["records"][0]["fare"]
        fare["components"] = [
            {"label": "鉄道往復", "amount_yen": 400},
            {"label": "往路バス", "amount_yen": 100},
        ]
        errors, _ = validate_document(data, release=False)
        self.assertTrue(any("component sum" in error for error in errors))

    def test_rebased_data_digest_does_not_replace_approval_receipt(self) -> None:
        data = release_fixture()
        original_receipt = approval_receipt(data)
        data["records"][0]["route"]["to_station"] = "別の駅"
        data["approval"]["data_digest"] = compute_digest(data)
        errors, _ = validate_document(data, release=True, approval_receipt=original_receipt)
        self.assertTrue(any("approval_receipt.approved_digest" in error for error in errors))

    def test_date_sets_must_cover_records_and_source_dates(self) -> None:
        data = release_fixture()
        data["reconciliation"]["mentioned_work_dates_by_person"]["person-1"] = ["2099-01-20"]
        data["reconciliation"]["source_work_dates_by_person"]["person-1"] = ["2099-01-20"]
        data["approval"]["data_digest"] = compute_digest(data)
        errors, _ = validate_document(data, release=True, approval_receipt=approval_receipt(data))
        self.assertTrue(any("lack a record" in error for error in errors))
        self.assertTrue(any("absent from evidence date sets" in error for error in errors))

    def test_one_way_arithmetic_must_match(self) -> None:
        data = release_fixture()
        fare = data["records"][0]["fare"]
        fare["calculation_kind"] = "one_way"
        fare["payable_yen"] = 999
        data["reconciliation"]["expected_totals_yen"]["person-1"] = 999
        data["approval"]["data_digest"] = compute_digest(data)
        errors, _ = validate_document(data, release=True, approval_receipt=approval_receipt(data))
        self.assertTrue(any("one_way_ic_yen" in error for error in errors))

    def test_bus_requires_details_and_route_rationale(self) -> None:
        data = release_fixture()
        data["records"][0]["route"]["bus_used"] = True
        data["records"][0]["route"]["rationale"] = ""
        data["approval"]["data_digest"] = compute_digest(data)
        errors, _ = validate_document(data, release=True, approval_receipt=approval_receipt(data))
        self.assertTrue(any("route.rationale" in error for error in errors))
        self.assertTrue(any("at least one bus leg" in error for error in errors))

    def test_each_person_needs_own_date_record(self) -> None:
        data = release_fixture()
        data["people"].append({
            "person_id": "person-2",
            "name": "テスト利用者2",
            "employee_code": "000002",
            "address": "テスト住所2",
            "home_stations": ["出発駅"],
            "route_preferences": {},
        })
        reconciliation = data["reconciliation"]
        reconciliation["mentioned_work_dates_by_person"]["person-2"] = ["2099-01-15"]
        reconciliation["source_work_dates_by_person"]["person-2"] = ["2099-01-15"]
        reconciliation["explicit_non_work_dates_by_person"]["person-2"] = []
        reconciliation["expected_payable_row_counts"]["person-2"] = 0
        reconciliation["expected_totals_yen"]["person-2"] = 0
        data["approval"]["data_digest"] = compute_digest(data)
        errors, _ = validate_document(data, release=True, approval_receipt=approval_receipt(data))
        self.assertTrue(any("reconciliation.person-2" in error and "lack a record" in error for error in errors))


if __name__ == "__main__":
    unittest.main(verbosity=2)
