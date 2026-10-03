"""Optional evidence-chain and half-month checks; standard library only."""
from datetime import date, datetime

INSTRUCTIONS = {"initial", "change", "correction", "rechange"}
ACTUAL = {"departure", "arrival", "start", "end", "next_morning", "actual_site", "user_confirmation"}
CANCEL = {"cancel", "rain_cancel", "absence", "vehicle_cancel"}


def assess_chain(chain, person_id):
    if not isinstance(chain, dict) or not isinstance(chain.get("events"), list):
        return "needs_confirmation", ["instruction_chain.events: array required"]
    events = chain["events"]
    reasons = []
    if not events:
        reasons.append("empty instruction chain")
    last_time = None
    for event in events:
        if not isinstance(event, dict):
            return "needs_confirmation", ["event object required"]
        try:
            timestamp = datetime.fromisoformat(event.get("timestamp", "").replace("Z", "+00:00"))
            if last_time is not None and timestamp < last_time:
                reasons.append("events must be in timestamp order")
            last_time = timestamp
        except (ValueError, TypeError):
            reasons.append("valid timestamp and matching time zones required")
        if event.get("person_id") != person_id and person_id not in event.get("person_ids", []):
            reasons.append("person attribution unresolved")
        if not event.get("locator"):
            reasons.append("source locator required")
    actual = [(i, e) for i, e in enumerate(events) if e.get("kind") in ACTUAL and e.get("site") and e.get("service_date")]
    cancellations = [i for i, e in enumerate(events) if e.get("kind") in CANCEL]
    instructions = [(i, e) for i, e in enumerate(events) if e.get("kind") in INSTRUCTIONS]
    if cancellations:
        if not actual and not any(i > cancellations[-1] for i, _ in instructions) and not reasons:
            return "excluded", []
        reasons.append("cancellation versus reinstruction/actual work unresolved")
    sites = {e["site"] for _, e in actual}
    dates = {e["service_date"] for _, e in actual}
    if len(sites) != 1:
        reasons.append("actual site unresolved; neither initial nor latest instruction proves work")
    if len(dates) != 1 or chain.get("date_conflict"):
        reasons.append("service start date unresolved; next morning is not a second shift")
    for value in dates:
        try:
            date.fromisoformat(value)
        except (ValueError, TypeError):
            reasons.append("invalid service_date")
    if chain.get("person_conflict"):
        reasons.append("person conflict")
    instruction_sites = {e.get("site") for _, e in instructions if e.get("site")}
    if sites and instruction_sites and not sites <= instruction_sites:
        reasons.append("actual site absent from instruction history")
    if instructions and actual and not any(i > instructions[-1][0] for i, _ in actual):
        reasons.append("no actual evidence after final change")
    return ("needs_confirmation" if reasons else "confirmed"), reasons


def check_work_counts(records, expected, target_month):
    errors = []
    if not isinstance(expected, dict):
        return ["expected_work_counts_by_person: object required"]
    for person_id, half_counts in expected.items():
        if not isinstance(half_counts, dict):
            errors.append(f"{person_id}: half counts object required")
            continue
        seen = set()
        counts = [0, 0]
        unresolved = [0, 0]
        for record in records:
            if not isinstance(record, dict) or record.get("person_id") != person_id or record.get("status") == "excluded":
                continue
            counted = record.get("counts_as_work", record.get("category") in {"day", "night", "training"})
            if not counted:
                continue
            value = record.get("service_date", "")
            if not isinstance(value, str) or value[:7] != target_month:
                continue
            try:
                day = date.fromisoformat(value).day
            except ValueError:
                errors.append(f"{person_id}: unplaced service date")
                continue
            half = 0 if day <= 15 else 1
            identity = record.get("service_id") or record.get("instruction_chain", {}).get("id") or record.get("record_id")
            if identity in seen:
                continue
            seen.add(identity)
            if record.get("status") == "confirmed":
                counts[half] += 1
            else:
                unresolved[half] += 1
        for i, key in enumerate(("first_half", "second_half")):
            declared = half_counts.get(key)
            if declared is None:
                continue
            if type(declared) is not int or declared < 0:
                errors.append(f"{person_id}.{key}: null or non-negative integer required")
            elif counts[i] != declared or unresolved[i]:
                errors.append(f"{person_id}.{key}: declared {declared}, candidates {counts[i]}, needs_confirmation {unresolved[i]}; never manufacture rows to match")
    return errors
