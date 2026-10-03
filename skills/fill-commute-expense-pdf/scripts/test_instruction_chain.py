import unittest
from instruction_chain import assess_chain, check_work_counts
from validate_commute_data import validate_document, compute_digest
from test_validate_commute_data import release_fixture, approval_receipt


def event(kind, site="架空現場B", service_date=None, hour=12, day=1):
    return {"kind": kind, "site": site, "service_date": service_date, "person_id": "person-1", "timestamp": f"2099-09-{day:02d}T{hour:02d}:00:00+09:00", "locator": "fictional-frame"}


class ChainTests(unittest.TestCase):
    def test_initial_and_changed_site_without_actual_evidence(self):
        status, reasons = assess_chain({"events": [event("initial", "架空現場A"), event("change", hour=13), event("correction", "", hour=14)]}, "person-1")
        self.assertEqual(status, "needs_confirmation")
        self.assertTrue(any("actual site" in reason for reason in reasons))

    def test_cancel_excluded(self):
        self.assertEqual(assess_chain({"events": [event("initial"), event("rain_cancel", hour=13)]}, "person-1"), ("excluded", []))

    def test_night_one_service_next_morning(self):
        self.assertEqual(assess_chain({"events": [event("initial"), event("departure", service_date="2099-09-01", hour=20), event("next_morning", service_date="2099-09-01", hour=7, day=2)]}, "person-1"), ("confirmed", []))
        records = [{"record_id": "a", "service_id": "same", "person_id": "person-1", "category": "night", "status": "confirmed", "service_date": "2099-09-01"}, {"record_id": "b", "service_id": "same", "person_id": "person-1", "category": "night", "status": "confirmed", "service_date": "2099-09-01"}]
        self.assertEqual(check_work_counts(records, {"person-1": {"first_half": 1, "second_half": None}}, "2099-09"), [])

    def test_people_independent(self):
        self.assertEqual(assess_chain({"events": [event("actual_site", service_date="2099-09-01")]}, "person-2")[0], "needs_confirmation")

    def test_blank_counts_are_not_zero(self):
        records = [{"record_id": "a", "person_id": "p", "category": "day", "status": "confirmed", "service_date": "2099-09-01"}]
        self.assertEqual(check_work_counts(records, {"p": {"first_half": None}}, "2099-09"), [])
        self.assertTrue(check_work_counts(records, {"p": {"first_half": 0}}, "2099-09"))

    def test_date_conflict(self):
        self.assertEqual(assess_chain({"date_conflict": True, "events": [event("actual_site", service_date="2099-09-09")]}, "person-1")[0], "needs_confirmation")

    def test_release_matching_count_does_not_confirm_changed_site(self):
        data = release_fixture()
        data["reconciliation"]["expected_work_counts_by_person"] = {"person-1": {"first_half": 1, "second_half": None}}
        data["records"][0]["instruction_chain"] = {"events": [event("initial", "架空現場A"), event("change", hour=13)]}
        data["approval"]["data_digest"] = compute_digest(data)
        errors, _ = validate_document(data, release=True, approval_receipt=approval_receipt(data))
        self.assertTrue(any("instruction_chain: needs_confirmation" in error for error in errors))

    def test_release_count_mismatch(self):
        data = release_fixture()
        data["reconciliation"]["expected_work_counts_by_person"] = {"person-1": {"first_half": 6, "second_half": 7}}
        data["approval"]["data_digest"] = compute_digest(data)
        errors, _ = validate_document(data, release=True, approval_receipt=approval_receipt(data))
        self.assertTrue(any("never manufacture" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
