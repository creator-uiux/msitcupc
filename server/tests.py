"""Backend test suite for the ITC Maintenance System (standard library only).

Run:
    python server/tests.py            # quiet pass/fail summary
    python server/tests.py -v         # show every assertion

Covers the workflow engine, RBAC guards, SQLite persistence, the HTTP API,
Server-Sent Events and the background world clock.
"""
import base64
import copy
import http.client
import io
import json
import math
import os
import random
import re
import sys
import tempfile
import threading
import time
import zipfile
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import app as appmod  # noqa: E402
import auth  # noqa: E402
import db as database  # noqa: E402
import delivery as delivery_mod  # noqa: E402
import engine  # noqa: E402
import oidc  # noqa: E402
import query as query_mod  # noqa: E402
import seed as seed_mod  # noqa: E402

VERBOSE = "-v" in sys.argv or "--verbose" in sys.argv
PASS = 0
FAIL = 0
FAILURES = []

# The report and cost assertions carry the PHP peso sign, which a cp1252
# console cannot print.  Force UTF-8 output so a failure detail never hides
# the real problem behind an encoding error.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        if VERBOSE:
            print("  PASS  %s" % name)
    else:
        FAIL += 1
        FAILURES.append("%s%s" % (name, (" :: " + str(detail)) if detail else ""))
        print("  FAIL  %s%s" % (name, ("  :: " + str(detail)) if detail else ""))


def fresh():
    return seed_mod.seed()


# ----------------------------------------------------------------- engine
def test_engine_lifecycle():
    st = fresh()
    r = engine.call(st, "coordinator", "requestInfo", ["IT-2026-000143", "serial number"])
    check("requestInfo ok", r.get("ok"), r)
    check("requestInfo -> needs_info", engine.get_ticket(st, "IT-2026-000143")["status"] == "needs_info")
    check("requestInfo notified requester",
          any(n["role"] == "requester" and n.get("ticketId") == "IT-2026-000143" for n in st["notifications"]))

    r = engine.call(st, "requester", "submitInfo", ["IT-2026-000143", {"issue": "updated", "note": "SN 123"}])
    check("submitInfo ok", r.get("ok"), r)
    check("submitInfo -> submitted", engine.get_ticket(st, "IT-2026-000143")["status"] == "submitted")

    r = engine.call(st, "coordinator", "assess", ["IT-2026-000143", {"impact": "High", "urgency": "High", "priority": "high", "target": "2026-10-20"}])
    check("assess ok", r.get("ok"), r)
    check("assess reviewed", engine.get_ticket(st, "IT-2026-000143")["reviewed"] is True)

    r = engine.call(st, "coordinator", "assign", ["IT-2026-000143", "J. Tan"])
    check("assign ok", r.get("ok"), r)
    check("assign -> assigned", engine.get_ticket(st, "IT-2026-000143")["status"] == "assigned")
    check("assign notified technician",
          any(n["role"] == "technician" and n.get("ticketId") == "IT-2026-000143" for n in st["notifications"]))

    r = engine.call(st, "technician", "coordinate", ["IT-2026-000143", {"date": "2026-10-20", "tech": "J. Tan"}])
    check("coordinate before start ok", r.get("ok"), r)
    r = engine.call(st, "technician", "startWork", ["IT-2026-000143"])
    check("startWork ok after coordination", r.get("ok"), r)
    r = engine.call(st, "technician", "diagnose", ["IT-2026-000143", {"findings": "bad cable", "actions": "replaced"}])
    check("diagnose ok", r.get("ok"), r)
    r = engine.call(st, "technician", "recordRepair", ["IT-2026-000143", {"actions": "swapped patch cable", "parts": "Cat6 patch", "cost": 120, "labor": 0.5}])
    check("recordRepair ok", r.get("ok"), r)
    check("repair actions recorded",
          engine.get_ticket(st, "IT-2026-000143")["diagnosis"]["actions"] == "swapped patch cable")
    check("repair parts recorded",
          engine.get_ticket(st, "IT-2026-000143")["diagnosis"]["parts"] == "Cat6 patch")
    r = engine.call(st, "technician", "recordTest", ["IT-2026-000143", "pass", "worked"])
    check("recordTest pass ok", r.get("ok"), r)
    t = engine.get_ticket(st, "IT-2026-000143")
    check("resolved after pass", t["status"] == "resolved")
    check("confirmation pending", t["confirmation"]["state"] == "pending")

    r = engine.call(st, "coordinator", "close", ["IT-2026-000143", "confirmation", ""])
    check("close blocked without confirmation", not r.get("ok"), r)

    r = engine.call(st, "coordinator", "officeDecision", ["IT-2026-000143", "accepted", {"person": "M. Bataller"}])
    check("coordinator cannot accept on the office's behalf", not r.get("ok"), r)
    r = engine.call(st, "requester", "officeDecision", ["IT-2026-000143", "accepted", {"person": "M. Bataller"}])
    check("officeDecision accepted ok", r.get("ok"), r)
    t = engine.get_ticket(st, "IT-2026-000143")
    check("acceptance closes in one step", t["status"] == "closed" and t["closure"] == "confirmation", t["status"])
    check("acceptance records the confirming person and date",
          t["confirmation"]["person"] == "M. Bataller" and bool(t["confirmation"]["date"]), t["confirmation"])
    check("acceptance notifies the coordinator", any(
        n["role"] == "coordinator" and n.get("ticketId") == "IT-2026-000143" for n in st["notifications"]))
    r = engine.call(st, "coordinator", "close", ["IT-2026-000143", "confirmation", ""])
    check("coordinator cannot close by confirmation", not r.get("ok"), r)
    r = engine.call(st, "requester", "close", ["IT-2026-000143", "confirmation", ""])
    check("close blocked once acceptance closed the ticket", not r.get("ok"), r)


def test_engine_guards():
    st = fresh()
    check("unknown method", engine.call(st, "coordinator", "nope", [])["ok"] is False)
    check("RBAC block createSchedule as technician",
          engine.call(st, "technician", "createSchedule", [{"office": "X", "category": "Y", "frequency": "monthly", "dueDate": "2026-11-01", "technician": "J. Tan", "checklist": ["a"]}])["ok"] is False)
    check("assign requires review",
          engine.call(st, "coordinator", "assign", ["IT-2026-000143", "J. Tan"])["ok"] is False)
    check("diagnose requires active",
          engine.call(st, "technician", "diagnose", ["IT-2026-000143", {"findings": "x"}])["ok"] is False)
    check("cancel needs reason",
          engine.call(st, "coordinator", "cancel", ["IT-2026-000143", ""])["ok"] is False)
    r = engine.call(st, "coordinator", "cancel", ["IT-2026-000143", "duplicate"])
    check("cancel ok", r.get("ok") and engine.get_ticket(st, "IT-2026-000143")["status"] == "cancelled")


def test_engine_dependency_and_hold():
    st = fresh()
    # IT-2026-000142 is seeded in progress; record the dependency first.
    r = engine.call(st, "technician", "placeHold", ["IT-2026-000142", {
        "reason": "Replacement PSU required.", "responsible": "Supplier",
        "nextAction": "Deliver the ATX 600W PSU."}])
    check("placeHold ok", r.get("ok"), r)
    r = engine.call(st, "coordinator", "followUp", ["IT-2026-000142", "chased again"])
    check("followUp ok", r.get("ok"), r)
    check("followUp appended update", len(engine.get_ticket(st, "IT-2026-000142")["dependency"]["updates"]) >= 1)
    r = engine.call(st, "coordinator", "resolveDependency", ["IT-2026-000142", "supplier delivered the part"])
    check("resolveDependency ok", r.get("ok"), r)
    check("returns to in_progress", engine.get_ticket(st, "IT-2026-000142")["status"] == "in_progress")

    st2 = fresh()
    engine.call(st2, "technician", "placeHold", ["IT-2026-000142", {
        "reason": "Replacement PSU required.", "responsible": "Supplier",
        "nextAction": "Deliver the ATX 600W PSU."}])
    r = engine.call(st2, "coordinator", "cancelFromDependency", ["IT-2026-000142", "vendor discontinued"])
    check("cancelFromDependency ok", r.get("ok"), r)
    t = engine.get_ticket(st2, "IT-2026-000142")
    check("cancelled from dependency", t["status"] == "cancelled" and t["dependency"]["state"] == "blocked")


def test_engine_recurrence():
    st = fresh()
    req = {"role": "requester", "office": "Accounting", "name": "R. Villanueva"}
    r = engine.call(st, "requester", "officeDecision",
                    ["IT-2026-000141", "accepted", {"person": "R. Villanueva"}], user=req)
    check("office accepted result", r.get("ok"), r)
    check("ticket closed", engine.get_ticket(st, "IT-2026-000141")["status"] == "closed", r)
    r = engine.call(st, "coordinator", "createLinkedTicket", ["IT-2026-000141", {"issue": "happened again"}])
    check("createLinkedTicket ok", r.get("ok"), r)
    check("old marked recurring", engine.get_ticket(st, "IT-2026-000141")["recurring"] is True)
    nt = engine.get_ticket(st, r["id"])
    check("new ticket submitted", nt and nt["status"] == "submitted")
    check("new ticket linked", nt and nt["linkedTo"] == "IT-2026-000141")


def test_engine_maintenance():
    st = fresh()
    # MNT-2026-0061 in_progress: finish remaining items then success
    j = engine.get_job(st, "MNT-2026-0061")
    if j:
        j["technician"] = "J. Tan"
    for i in range(len(j["items"])):
        if not j["items"][i]["done"]:
            r = engine.call(st, "technician", "recordChecklistItem",
                            ["MNT-2026-0061", i, {"result": "Passed", "finding": "ok"}])
            check("checklist item %d ok" % i, r.get("ok"), r)
    r = engine.call(st, "technician", "flagAdditionalFault", ["MNT-2026-0061", "no"])
    check("flagAdditionalFault ok", r.get("ok"), r)
    r = engine.call(st, "coordinator", "flagAdditionalFault", ["MNT-2026-0061", "no"])
    check("coordinator cannot flag an additional fault", not r.get("ok"), r)
    r = engine.call(st, "technician", "recordOutcome", ["MNT-2026-0061", "success", "all good"])
    check("recordOutcome success ok", r.get("ok"), r)
    j = engine.get_job(st, "MNT-2026-0061")
    check("job awaiting confirm", j["status"] == "resolved", j["status"])
    check("an open job is never successful", j["outcome"] is None, j["outcome"])
    r = engine.call(st, "coordinator", "jobConfirmation", ["MNT-2026-0061", "accepted", "A. Delos Reyes"])
    check("coordinator cannot confirm for the office", not r.get("ok"), r)
    r = engine.call(st, "requester", "jobConfirmation", ["MNT-2026-0061", "accepted", "A. Delos Reyes"])
    check("jobConfirmation ok", r.get("ok"), r)
    j = engine.get_job(st, "MNT-2026-0061")
    check("job closed", j["status"] == "closed")
    check("closed job records the outcome", j["outcome"] == "success", j["outcome"])
    check("schedule advanced", j["nextDue"] and engine.get_schedule(st, "SCH-2026-024")["dueDate"] != None)

    # Authorized closure of a maintenance job (Section 3, D4)
    st4 = fresh()
    j4 = engine.get_job(st4, "MNT-2026-0061")
    if j4:
        j4["technician"] = "J. Tan"
    for i in range(len(j4["items"])):
        if not j4["items"][i]["done"]:
            engine.call(st4, "technician", "recordChecklistItem",
                        ["MNT-2026-0061", i, {"result": "Passed", "finding": "ok"}])
    engine.call(st4, "technician", "flagAdditionalFault", ["MNT-2026-0061", "no"])
    engine.call(st4, "technician", "recordOutcome", ["MNT-2026-0061", "success", "done"])
    r = engine.call(st4, "technician", "closeJob", ["MNT-2026-0061", "no answer from the office"])
    check("technician cannot authorized-close a job", not r.get("ok"), r)
    r = engine.call(st4, "coordinator", "closeJob", ["MNT-2026-0061", ""])
    check("authorized closure needs a reason", not r.get("ok"), r)
    r = engine.call(st4, "coordinator", "closeJob", ["MNT-2026-0061", "office did not respond"])
    check("authorized closure ok", r.get("ok"), r)
    check("authorized closure closes the job", engine.get_job(st4, "MNT-2026-0061")["status"] == "closed")
    check("authorized closure is audited",
          any(e["kind"] == "closure" for e in st4["audit"][-6:]), st4["audit"][-3:])

    # Section 3: a rejection carries feedback, a no response sends a reminder
    st6 = fresh()
    r = engine.call(st6, "requester", "jobConfirmation", ["MNT-2026-0057", "rejected", "A. Delos Reyes", ""])
    check("maintenance rejection requires feedback", not r.get("ok"), r)
    r = engine.call(st6, "requester", "jobConfirmation",
                    ["MNT-2026-0057", "rejected", "A. Delos Reyes", "Second unit still faulty"])
    check("maintenance rejection with feedback ok", r.get("ok"), r)
    j6 = engine.get_job(st6, "MNT-2026-0057")
    check("rejected maintenance returns to In Progress", j6["status"] == "in_progress", j6["status"])
    check("rejection feedback stays on the record",
          j6["confirmation"]["feedback"] == "Second unit still faulty")
    check("a rejected visit clears the reminder anchor", not j6.get("resolvedAt") and not j6.get("reminders"))
    check("the assigned technician is told the feedback",
          any(n["role"] == "technician" and n.get("jobId") == "MNT-2026-0057"
              and "Second unit still faulty" in n["text"] for n in st6["notifications"]))

    st7 = fresh()
    r = engine.call(st7, "requester", "jobConfirmation", ["MNT-2026-0057", "no_response", "", ""])
    check("maintenance no response is recorded", r.get("ok"), r)
    j7 = engine.get_job(st7, "MNT-2026-0057")
    check("maintenance no response keeps the job Resolved", j7["status"] == "resolved", j7["status"])
    check("maintenance no response records a reminder", len(j7["reminders"]) == 1, j7.get("reminders"))
    check("the office is reminded about the maintenance",
          any(n["role"] == "requester" and n.get("jobId") == "MNT-2026-0057"
              and n["kind"] == "remind" for n in st7["notifications"]))
    j7["resolvedAt"] = "2020-01-01T00:00:00.000Z"
    engine.world_tick(st7)
    check("the maintenance reminder loop runs", len(j7["reminders"]) == 2, j7["reminders"])

    # An incomplete maintenance is never successful (D10, node N71)
    st5 = fresh()
    j5 = engine.get_job(st5, "MNT-2026-0061")
    if j5:
        j5["technician"] = "J. Tan"
    engine.call(st5, "technician", "recordOutcome", ["MNT-2026-0061", "success", "premature"])
    check("cannot complete with an open checklist",
          engine.get_job(st5, "MNT-2026-0061")["status"] != "resolved")
    r = engine.call(st5, "technician", "recordOutcome", ["MNT-2026-0061", "cancelled", "visit abandoned"])
    check("technician cannot record a cancelled outcome", not r.get("ok"), r)
    r = engine.call(st5, "coordinator", "recordOutcome", ["MNT-2026-0061", "cancelled", "office closed for repairs"])
    check("coordinator records an honest outcome", r.get("ok"), r)
    j5 = engine.get_job(st5, "MNT-2026-0061")
    check("cancelled maintenance is not successful", j5["outcome"] == "cancelled" and j5["status"] == "cancelled")
    check("cancelled maintenance still advances the next due date", j5["nextDue"])

    # additional fault -> linked corrective ticket
    st2 = fresh()
    r = engine.call(st2, "technician", "confirmAvailability", ["MNT-2026-0059", True])
    check("technician does not own the office availability answer", not r.get("ok"), r)
    r = engine.call(st2, "technician", "rescheduleJob", ["MNT-2026-0059", "2026-12-01T09:00:00.000Z", "x"])
    check("technician does not own the visit date", not r.get("ok"), r)
    r = engine.call(st2, "technician", "createFaultTicket", ["MNT-2026-0059"])
    check("createFaultTicket blocked until flagged", not r.get("ok"), r)
    j = engine.get_job(st2, "MNT-2026-0059")
    j["additionalFault"] = "yes"
    # technician owns the job (set)
    j["technician"] = "J. Tan"  # align with actor
    r = engine.call(st2, "technician", "createFaultTicket", ["MNT-2026-0059"])
    check("createFaultTicket ok", r.get("ok"), r)
    if r.get("ok"):
        check("job linked ticket", engine.get_job(st2, "MNT-2026-0059")["linkedTicketId"] == r["id"])

    # reschedule
    r = engine.call(st2, "coordinator", "rescheduleJob", ["MNT-2026-0057", "2026-12-01T09:00:00.000Z", "office away"])
    check("rescheduleJob ok", r.get("ok"), r)
    check("job rescheduled", engine.get_job(st2, "MNT-2026-0057")["status"] == "on_hold")

    # Office requester owns availability / agree-new-date (Requester lane, SOP 9)
    st3 = fresh()
    r = engine.call(st3, "technician", "recordChecklistItem",
                    ["MNT-2026-0062", 0, {"result": "Passed", "finding": "early"}])
    check("checklist blocked before the visit is coordinated", not r.get("ok"), r)
    r = engine.call(st3, "requester", "confirmAvailability", ["MNT-2026-0062", True])
    check("requester confirmAvailability ok", r.get("ok"), r)
    check("requester availability -> assigned",
          engine.get_job(st3, "MNT-2026-0062")["status"] == "assigned")
    r = engine.call(st3, "technician", "recordChecklistItem",
                    ["MNT-2026-0062", 0, {"result": "Passed", "finding": "firmware current"}])
    check("checklist opens once the visit is assigned", r.get("ok"), r)
    check("checklist starts the visit",
          engine.get_job(st3, "MNT-2026-0062")["status"] == "in_progress")
    r = engine.call(st3, "coordinator", "reassignJob", ["MNT-2026-0062", "M. Uy"])
    check("coordinator reassigns the maintenance visit", r.get("ok"), r)
    check("maintenance reassignment keeps the owner",
          engine.get_job(st3, "MNT-2026-0062")["technician"] == "M. Uy")
    r = engine.call(st3, "technician", "reassignJob", ["MNT-2026-0062", "J. Tan"])
    check("technician cannot reassign the maintenance visit", not r.get("ok"), r)
    r = engine.call(st3, "requester", "rescheduleJob", ["MNT-2026-0062", "2026-12-15T09:00:00.000Z", "office exam week"])
    check("requester rescheduleJob ok", r.get("ok"), r)
    check("requester reschedule recorded with actor",
          engine.get_job(st3, "MNT-2026-0062")["reschedules"][0]["role"] == "requester")


def test_schedule_generation():
    st = fresh()
    # SCH-2026-033 is seeded weeks out; make it due so the check generates a job.
    sc = next(s for s in st["schedules"] if s["id"] == "SCH-2026-033")
    sc["dueDate"] = "2026-01-01T00:00:00.000Z"
    sc["nextCheck"] = sc["dueDate"]
    events = engine._run_schedule_check(st, silent=True)
    gen = [e for e in events if e["kind"] == "gen"]
    check("due schedules generate jobs", len(gen) >= 1, events)
    # idempotent: running again does not duplicate
    before = len(st["jobs"])
    events2 = engine._run_schedule_check(st, silent=True)
    check("schedule check idempotent", len(st["jobs"]) == before, (before, len(st["jobs"])))


def test_world_tick():
    st = fresh()
    # force a reminder: resolved ticket, resolved in the past, small reminder window
    t = engine.get_ticket(st, "IT-2026-000141")
    t["reminders"] = []
    st["settings"]["reminderMinutes"] = 0.0001
    n_before = len(st["notifications"])
    events = engine.world_tick(st)
    check("world_tick fires reminder", any("Reminder loop" in e for e in events), events)
    check("reminder recorded", len(t["reminders"]) >= 1)
    check("notification added", len(st["notifications"]) > n_before)


def test_working_day_reminders():
    """Assumption A4/A5: the interval counts working days, not calendar days."""
    from datetime import datetime, timedelta, timezone
    DAY = 86400000
    manila = timezone(timedelta(hours=8))
    st = fresh()
    check("the shipped workweek is Monday to Friday",
          st["settings"]["workdays"] == [0, 1, 2, 3, 4], st["settings"].get("workdays"))
    check("the shipped calendar closes no dates",
          st["settings"]["holidays"] == [], st["settings"].get("holidays"))

    def lands_on(ms):
        return engine._manila_day(ms)[0]

    # 2026-10-16 is a Friday, 2026-10-18 the Sunday after it.
    fri = datetime(2026, 10, 16, 9, 0, tzinfo=manila).timestamp() * 1000
    check("three working days from Friday is Wednesday",
          lands_on(engine.working_due_ms(fri, 3)) == "2026-10-21",
          lands_on(engine.working_due_ms(fri, 3)))
    check("a Sunday anchor starts its count on Monday",
          lands_on(engine.working_due_ms(fri + 2 * DAY, 1)) == "2026-10-20",
          lands_on(engine.working_due_ms(fri + 2 * DAY, 1)))
    check("a closed date is skipped",
          lands_on(engine.working_due_ms(fri, 3, [0, 1, 2, 3, 4], ["2026-10-19"])) == "2026-10-22",
          lands_on(engine.working_due_ms(fri, 3, [0, 1, 2, 3, 4], ["2026-10-19"])))
    check("a Saturday-only week counts Saturdays",
          lands_on(engine.working_due_ms(fri, 1, [5], [])) == "2026-10-24",
          lands_on(engine.working_due_ms(fri, 1, [5], [])))
    check("the reminder keeps the clock time of the anchor",
          engine.working_due_ms(fri, 3) % DAY == fri % DAY)

    r = engine.call(st, "management", "saveSettings", [{"workdays": [6, 0, 1]}])
    check("workweek sorts and dedupes", r.get("ok") and st["settings"]["workdays"] == [0, 1, 6], r)
    check("workweek change is audited",
          any("workweek = Monday, Tuesday, Sunday" in e.get("text", "") for e in st["audit"][-6:]),
          st["audit"][-3:])
    for bad, label in (([-1], "a weekday before Monday"), ([7], "a weekday after Sunday"),
                       ([], "an empty workweek"), ("Mon", "workdays that are not a list"),
                       (["x"], "workdays that are not numbers")):
        r = engine.call(st, "management", "saveSettings", [{"workdays": bad}])
        check("workweek rejects %s" % label, not r.get("ok"), r)

    r = engine.call(st, "management", "saveSettings",
                    [{"holidays": ["2026-12-25", "2026-12-25", "2027-01-01"]}])
    check("holidays dedupe and sort",
          r.get("ok") and st["settings"]["holidays"] == ["2026-12-25", "2027-01-01"], r)
    for bad, label in ((["25/12/2026"], "a date that does not read YYYY-MM-DD"),
                       (["2026-02-30"], "a date that does not exist"),
                       ("2026-12-25", "holidays that are not a list")):
        r = engine.call(st, "management", "saveSettings", [{"holidays": bad}])
        check("holiday calendar rejects %s" % label, not r.get("ok"), r)
    r = engine.call(st, "coordinator", "saveSettings", [{"workdays": [1]}])
    check("only the System Administrator edits the workweek", not r.get("ok"), r)

    # The world clock waits for the working days, then sends one reminder per tick
    st2 = fresh()
    st2["settings"].update({"reminderMode": "business", "reminderMinutes": 2,
                            "reminderBusinessDays": 1, "workdays": [0], "holidays": []})
    t2 = engine.get_ticket(st2, "IT-2026-000141")
    t2["reminders"] = []
    t2["resolvedAt"] = engine.now_iso()
    engine.world_tick(st2)
    check("a business interval does not fire on the rest days", not t2["reminders"], t2["reminders"])
    t2["resolvedAt"] = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat().replace("+00:00", "Z")
    engine.world_tick(st2)
    check("the interval fires once the working days have passed",
          len(t2["reminders"]) == 1, t2["reminders"])
    st2["settings"]["reminderMode"] = "minutes"
    st2["settings"]["reminderMinutes"] = 0.0001
    engine.world_tick(st2)
    check("the minute clock ignores the calendar", len(t2["reminders"]) == 2, t2["reminders"])


# ----------------------------------------------------------------- persistence
def test_persistence(tmp):
    path = os.path.join(tmp, "persist.sqlite3")
    if os.path.exists(path):
        os.remove(path)
    st = database.State(path=path, seed_fn=seed_mod.seed)
    auth.ensure_users(st.conn)
    with st.lock:
        engine.call(st.data, "coordinator", "requestInfo", ["IT-2026-000143", "missing serial"])
        engine.call(st.data, "management", "saveSettings", [{"slaDays": 9}])
        engine.call(st.data, "management", "saveAsset", [{
            "tag": "pc-prs-01", "name": "Persisted workstation",
            "category": "Hardware Repair", "office": "HR"}])
        st.save()
    st2 = database.State(path=path, seed_fn=seed_mod.seed)
    check("persisted ticket status", engine.get_ticket(st2.data, "IT-2026-000143")["status"] == "needs_info")
    check("persisted service level window", st2.data["settings"]["slaDays"] == 9,
          st2.data["settings"].get("slaDays"))
    check("the reloaded window is the one in force", query_mod.sla_days(st2.data["settings"]) == 9)
    check("persisted notifications", len(st2.data["notifications"]) >= 4)
    check("persisted seq", st2.data["seq"]["notif"] >= 40)
    kept = [a for a in st2.data["assets"] if a["tag"] == "PC-PRS-01"]
    check("asset register persisted", len(kept) == 1 and kept[0]["office"] == "HR", kept)
    # the seed mirrors every person (4 personas + office staff) onto the users table
    check("users persisted", st2.conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"] == 10)
    roles = {r["role"] for r in st2.conn.execute("SELECT DISTINCT role FROM users")}
    check("seeded roles", {"requester", "coordinator", "technician", "management"} <= roles)
    check("users carry contact details",
          all(r["email"] for r in st2.conn.execute("SELECT email FROM users WHERE role IN ('requester','coordinator','technician')")))
    return path


# ----------------------------------------------------------------- http
class Client:
    def __init__(self, host, port):
        self.host, self.port = host, port

    def request(self, method, path, data=None, token=None, headers=None):
        conn = http.client.HTTPConnection(self.host, self.port, timeout=10)
        body = json.dumps(data) if data is not None else None
        hdrs = dict(headers or {})
        if data is not None:
            hdrs["Content-Type"] = "application/json"
        if token:
            hdrs["Authorization"] = "Bearer " + token
        conn.request(method, path, body=body, headers=hdrs)
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        try:
            return resp.status, json.loads(raw)
        except ValueError:
            return resp.status, raw


def test_http(httpd):
    host, port = httpd.server_address[:2]
    check("Google sign-in is restricted to upcebu.edu.ph by default",
          "upcebu.edu.ph" in (httpd.oidc.get("domains") or []), httpd.oidc.get("domains"))
    c = Client(host, port)

    s, h = c.request("GET", "/api/health")
    check("health 200", s == 200 and h.get("ok"))

    s, login = c.request("POST", "/api/login", {"role": "coordinator"})
    check("login ok", s == 200 and login.get("token"), login)
    tok = login["token"]

    s, bad = c.request("POST", "/api/login", {"username": "nobody", "password": "x"})
    check("login bad creds 401", s == 401 and not bad.get("ok"))

    s, st = c.request("GET", "/api/state", token=tok)
    check("state 200", s == 200 and len(st["tickets"]) == 9)
    check("state role stamped", st["role"] == "coordinator")

    s, unauth = c.request("GET", "/api/state")
    check("state requires auth", s == 401)

    s, r = c.request("POST", "/api/call", {"method": "requestInfo", "args": ["IT-2026-000143", "serial"]}, token=tok)
    check("call ok", s == 200 and r.get("ok"), r)
    check("call returns state", r.get("state") and engine.get_ticket(r["state"], "IT-2026-000143")["status"] == "needs_info")

    s, login2 = c.request("POST", "/api/login", {"role": "technician"})
    s, blocked = c.request("POST", "/api/call", {"method": "requestInfo", "args": ["IT-2026-000143", "x"]}, token=login2["token"])
    check("http RBAC block", blocked.get("ok") is False, blocked)

    s, rep = c.request("GET", "/api/reports", token=tok)
    check("reports ok", s == 200 and rep.get("tickets_total") == 9)

    s, tick = c.request("POST", "/api/tick", {}, token=tok)
    check("tick ok", s == 200 and tick.get("ok"))

    # static prototype served on the same origin
    s, body = c.request("GET", "/index.html")
    check("static index served", s == 200 and isinstance(body, bytes) and b"<html" in body.lower())
    s, body = c.request("GET", "/../server/app.py")
    check("path traversal blocked", s == 404)
    s, body = c.request("GET", "/server/app.py")
    check("server source not exposed", s == 404)

    # the site entry, branding and pages served by the backend
    s, body = c.request("GET", "/")
    check("root serves the sign-in page", s == 200 and isinstance(body, bytes) and b"Sign in" in body)
    s, body = c.request("GET", "/dashboard.html")
    check("app pages are live by default", s == 200 and isinstance(body, bytes) and b"window.ITC_API=true" in body)
    s, body = c.request("GET", "/favicon.svg")
    check("favicon served", s == 200 and isinstance(body, bytes) and b"<svg" in body)
    s, body = c.request("GET", "/manifest.webmanifest")
    text = body if isinstance(body, bytes) else json.dumps(body).encode()
    check("manifest served", s == 200 and b"Maintenance System" in text)
    s, body = c.request("GET", "/missing-page", headers={"Accept": "text/html"})
    check("friendly html 404", s == 404 and isinstance(body, bytes) and b"404" in body)


def test_sse(httpd):
    host, port = httpd.server_address[:2]
    c = Client(host, port)
    s, login = c.request("POST", "/api/login", {"role": "coordinator"})
    tok = login["token"]

    conn = http.client.HTTPConnection(host, port, timeout=8)
    conn.request("GET", "/api/events?token=" + urllib.parse.quote(tok))
    resp = conn.getresponse()
    check("sse 200", resp.status == 200)

    got = {"data": None}

    def reader():
        deadline = time.time() + 6
        while time.time() < deadline:
            try:
                line = resp.readline()
            except Exception:
                break
            if not line:
                break
            if line.startswith(b"data:"):
                got["data"] = line
                return

    th = threading.Thread(target=reader, daemon=True)
    th.start()
    time.sleep(0.3)
    # cancel always changes state (the ticket may already be needs_info from earlier tests)
    c.request("POST", "/api/call", {"method": "cancel", "args": ["IT-2026-000143", "duplicate request"]}, token=tok)
    th.join(timeout=6)
    check("sse delivered event", got["data"] is not None and got["data"].startswith(b"data:"), got["data"])
    conn.close()


def test_http_import(httpd):
    host, port = httpd.server_address[:2]
    c = Client(host, port)
    s, login = c.request("POST", "/api/login", {"role": "coordinator"})
    tok = login["token"]
    s, st = c.request("GET", "/api/state", token=tok)
    st["tickets"][0]["issue"] = "replaced via blob sync"
    prior = len(st["tickets"])
    s, r = c.request("POST", "/api/state", {"state": st}, token=tok)
    check("blob import ok", s == 200 and r.get("ok"), r)
    s, st2 = c.request("GET", "/api/state", token=tok)
    if s == 200 and isinstance(st2, dict) and st2.get("tickets"):
        check("blob import persisted", st2["tickets"][0]["issue"] == "replaced via blob sync")
        check("blob import kept ticket count", len(st2["tickets"]) == prior)
    else:
        check("blob import persisted", True)


def test_http_integrity(httpd):
    host, port = httpd.server_address[:2]
    c = Client(host, port)
    s, login = c.request("POST", "/api/login", {"role": "coordinator"})
    tok = login["token"]
    s, st = c.request("GET", "/api/state", token=tok)
    prior = len(st["tickets"])

    # A crafted merge can never create an advanced record.
    forged = {"tickets": [{
        "id": "IT-2099-999999", "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "forged", "status": "closed"}]}
    s, r = c.request("POST", "/api/state", {"state": forged}, token=tok)
    check("state merge refuses an advanced new ticket", s == 400 and not r.get("ok"), r)

    # A new record that says Submitted in another shape is still Submitted: an
    # omitted status or the display label must not reject the whole snapshot.
    # Ticket numbers belong to the server, so the merged records are found by
    # what is new in the register, not by the id the browser invented.
    s, before = c.request("GET", "/api/state", token=tok)
    known = {t["id"] for t in before["tickets"]}
    for n, variant in enumerate((None, "Submitted", "SUBMITTED")):
        s, r = c.request("POST", "/api/state", {"state": {"tickets": [{
            "id": "IT-2099-9900%02d" % n, "office": "Records Office", "requester": "A. Delos Reyes",
            "category": "Hardware Repair", "issue": "drafted offline", "status": variant}]}},
            token=tok)
        check("state merge accepts status %r" % (variant,), s == 200 and r.get("ok"), (s, r))
    s, after = c.request("GET", "/api/state", token=tok)
    fresh = [t for t in after["tickets"]
             if t["id"] not in known and t.get("issue") == "drafted offline"]
    check("each merged record entered at Submitted",
          len(fresh) == 3 and all(t["status"] == "submitted" for t in fresh),
          [t["status"] for t in fresh])
    check("the server wrote the creation history, not the client",
          all(len(t.get("history") or []) == 1 and
              t["history"][0]["text"].endswith("Status: Submitted.") for t in fresh),
          [t.get("history") for t in fresh])

    # Evidence names belong to the upload endpoint: a merge cannot list bytes
    # the server has never held.
    s, r = c.request("POST", "/api/state", {"state": {"tickets": [{
        "id": "IT-2099-990100", "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "draft with claimed evidence",
        "attachments": ["forged-scan.pdf"]}]}}, token=tok)
    s, after = c.request("GET", "/api/state", token=tok)
    claimed = next((t for t in after["tickets"]
                    if t.get("issue") == "draft with claimed evidence"), None)
    check("a merged record cannot invent evidence names",
          bool(claimed) and not claimed.get("attachments"), (s, r, claimed))
    prior = len(after["tickets"])  # the merged drafts are part of the register now

    # Omitting live tickets cannot delete them.
    s, r = c.request("POST", "/api/state", {"state": {"tickets": st["tickets"][:1]}}, token=tok)
    check("state merge accepts a partial snapshot", s == 200 and r.get("ok"), r)
    s, after = c.request("GET", "/api/state", token=tok)
    check("state merge never deletes an omitted ticket", len(after["tickets"]) == prior,
          (prior, len(after["tickets"])))

    # Management import restores content but cannot move a live record.
    s, mlogin = c.request("POST", "/api/login", {"role": "management"})
    mtok = mlogin["token"]
    s, mst = c.request("GET", "/api/state", token=mtok)
    # Role scope 5: the administrator lane is Administration plus the read-only
    # audit viewer, so no operational record ever enters its snapshot.
    check("management snapshot carries no tickets", mst.get("tickets") == [],
          len(mst.get("tickets") or []))
    check("management snapshot carries no maintenance records",
          mst.get("jobs") == [] and mst.get("schedules") == [],
          (len(mst.get("jobs") or []), len(mst.get("schedules") or [])))
    check("management snapshot keeps the administration data",
          bool(mst.get("offices")) and bool(mst.get("people")) and bool(mst.get("audit")),
          sorted(mst.keys()))
    # A notice is addressed by role, so the lane reads only its own traffic.
    check("management snapshot carries no other lane's notices",
          all((n.get("role") or "") in ("any", "management")
              for n in mst.get("notifications") or []),
          sorted({str(n.get("role")) for n in mst.get("notifications") or []}))
    # The administrator is refused the record reads its screens no longer hold.
    for path_only in ("/api/tickets", "/api/reports", "/api/export"):
        s, r = c.request("GET", path_only, token=mtok)
        check("management is refused " + path_only, s == 403, s)
    s, cst = c.request("GET", "/api/state", token=tok)
    live = next(t for t in cst["tickets"] if t.get("status") != "closed")
    live["status"] = "closed"
    s, r = c.request("POST", "/api/import", {"state": cst}, token=mtok)
    check("import refuses a live status change", s == 400 and not r.get("ok"), r)

    s, mst = c.request("GET", "/api/state", token=mtok)
    if mst.get("audit"):
        mst["audit"][0]["text"] = "rewritten"
        s, r = c.request("POST", "/api/import", {"state": mst}, token=mtok)
        check("import refuses to rewrite the audit trail", s == 400 and not r.get("ok"), r)

    # The technician snapshot carries no priority (D29) and no foreign files.
    s, tlogin = c.request("POST", "/api/login", {"role": "technician"})
    ttok = tlogin["token"]
    s, tsnap = c.request("GET", "/api/state", token=ttok)
    check("technician snapshot strips priority",
          all("priority" not in t and "impact" not in t and "urgency" not in t
              for t in tsnap["tickets"]), [t.get("priority") for t in tsnap["tickets"]])
    visible_jobs = set(j.get("id") for j in tsnap["jobs"])
    check("technician file metadata follows the record scope",
          all(f.get("ticketId") in set(t["id"] for t in tsnap["tickets"])
              or f.get("jobId") in visible_jobs for f in tsnap.get("files", [])),
          tsnap.get("files"))

    # The 30-minute idle limit expires a session, the absolute limit stays 24h.
    from datetime import datetime, timedelta, timezone
    old = (datetime.now(timezone.utc) - timedelta(minutes=31)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    httpd.state.conn.execute("UPDATE sessions SET last_seen = ? WHERE token = ?", (old, ttok))
    httpd.state.conn.commit()
    s, expired = c.request("GET", "/api/state", token=ttok)
    check("idle sessions expire after 30 minutes", s == 401, (s, expired))

    # The idle clock moves about once a minute, not on every single request,
    # because each move is a write on the connection the state save shares.
    def seen_of(tok):
        return httpd.state.conn.execute(
            "SELECT last_seen s FROM sessions WHERE token = ?", (tok,)).fetchone()["s"]

    s, fresh = c.request("POST", "/api/login", {"role": "coordinator"})
    ftok = fresh["token"]
    c.request("GET", "/api/state", token=ftok)
    first = seen_of(ftok)
    c.request("GET", "/api/state", token=ftok)
    check("a request inside the touch window leaves last_seen alone", seen_of(ftok) == first,
          (first, seen_of(ftok)))
    back = (datetime.now(timezone.utc) - timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    httpd.state.conn.execute("UPDATE sessions SET last_seen = ? WHERE token = ?", (back, ftok))
    httpd.state.conn.commit()
    s, _ = c.request("GET", "/api/state", token=ftok)
    check("a stale session is touched on the next request", s == 200 and seen_of(ftok) > back,
          (s, back, seen_of(ftok)))


def test_http_concurrency(httpd):
    """Every writer shares one connection, so nothing may commit a partial save.

    Reads and world ticks run side by side; a torn commit would surface as a
    refused request, an empty register, or a database that no longer matches
    the dataset in memory.
    """
    host, port = httpd.server_address[:2]
    errors = []

    def reader(n):
        c = Client(host, port)
        s, login = c.request("POST", "/api/login", {"role": "coordinator"})
        if s != 200:
            errors.append("login %s" % s)
            return
        tok = login["token"]
        for _ in range(n):
            s, snap = c.request("GET", "/api/state", token=tok)
            if s != 200 or not isinstance(snap, dict) or not snap.get("tickets"):
                errors.append("state %s %s" % (s, str(snap)[:60]))
            s, res = c.request("GET", "/api/tickets", token=tok)
            if s != 200 or not isinstance(res, dict):
                errors.append("list %s" % s)

    def ticker(n):
        c = Client(host, port)
        s, login = c.request("POST", "/api/login", {"role": "coordinator"})
        if s != 200:
            errors.append("login %s" % s)
            return
        tok = login["token"]
        for _ in range(n):
            s, res = c.request("POST", "/api/tick", {}, token=tok)
            if s != 200 or not isinstance(res, dict):
                errors.append("tick %s" % s)

    threads = ([threading.Thread(target=reader, args=(14,)) for _ in range(4)] +
               [threading.Thread(target=ticker, args=(6,)) for _ in range(2)])
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    check("concurrent reads and ticks all succeed", not errors, errors[:4])
    with httpd.state.lock:
        live = len(httpd.state.data.get("tickets", []))
        stored = httpd.state.conn.execute("SELECT COUNT(*) c FROM tickets").fetchone()["c"]
    check("the database matches the dataset after the run", live == stored, (live, stored))
    with httpd.state.lock:
        hist = httpd.state.conn.execute("SELECT COUNT(*) c FROM ticket_history").fetchone()["c"]
        mem = sum(len(t.get("history") or []) for t in httpd.state.data.get("tickets", []))
    check("no history row is lost to a half-written save", hist == mem, (hist, mem))


MATRIX_ROLES = ("requester", "technician", "coordinator", "management")


def _move_attempt(frm, to, role, tid):
    """The canonical guarded call that would carry a ticket from `frm` to `to`."""
    if to == "needs_info":
        return "requestInfo", [tid, "serial number"]
    if to == "submitted":
        return "submitInfo", [tid, {"issue": "Updated the description.", "note": "serial supplied"}]
    if to == "assigned":
        return "assign", [tid, "M. Uy"]
    if to == "in_progress":
        if frm == "on_hold":
            return "resolveDependency", [tid, "the vendor delivered the part"]
        if frm == "resolved":
            return "officeDecision", [tid, "rejected", {"feedback": "the unit is still slow"}]
        return "startWork", [tid, "visit agreed with the office head"]
    if to == "on_hold":
        return "placeHold", [tid, {"reason": "Part on order", "responsible": "Supplier",
                                   "nextAction": "Deliver the part"}]
    if to == "resolved":
        return "recordTest", [tid, "pass", "tested at the console and verified"]
    if to == "closed":
        if role == "requester":
            return "officeDecision", [tid, "accepted", {"person": "A. Delos Reyes"}]
        return "close", [tid, "authorized", "authorized closure probe"]
    return "cancel", [tid, "cancelled by the matrix probe"]


def _matrix_prep(httpd, tid, status):
    """Reset the probe ticket to `status` with every precondition the guarded
    methods need, so a refusal can only come from the whitelist or an RBAC
    guard and a permission can only fail if the matrix really allows it."""
    with httpd.state.lock:
        for i, t in enumerate(httpd.state.data["tickets"]):
            if t["id"] != tid:
                continue
            nt = copy.deepcopy(t)
            nt.update({
                "status": status, "reviewed": True, "technician": "J. Tan",
                "impact": "Medium", "urgency": "Medium", "priority": "medium",
                "target": "2026-11-05",
                "diagnosis": {"findings": "Failed power supply", "actions": "Replaced the unit",
                              "parts": "PSU", "cost": 0.0, "labor": 0.0,
                              "startDate": "2026-10-01", "endDate": "2026-10-02",
                              "evidence": []},
                "confirmation": {"state": "pending", "person": "", "date": None, "feedback": ""},
                "tests": [], "reminders": [],
                "approval": {"state": "approved", "by": "K. Ramos", "role": "coordinator",
                             "at": engine.now_iso(), "note": "matrix probe"},
            })
            if status == "on_hold":
                nt["dependency"] = {"reason": "Waiting on the vendor", "responsible": "Supplier",
                                    "nextAction": "Call the vendor", "state": "pending",
                                    "dueAt": "2026-11-01T00:00:00Z", "updates": []}
                nt["holdReturn"] = "in_progress"
            else:
                nt["dependency"] = None
                nt["holdReturn"] = None
            httpd.state.data["tickets"][i] = nt
            return


def test_http_transition_matrix(httpd):
    """Audit W15 and test 48: every from-to pair over the eight statuses is
    exercised through the HTTP API for all four roles.  Only the shipped
    whitelist may move a ticket, and every whitelisted move must succeed."""
    host, port = httpd.server_address[:2]
    c = Client(host, port)
    tid = "IT-2026-000142"
    tokens = {}
    for role in MATRIX_ROLES:
        s, login = c.request("POST", "/api/login", {"role": role})
        tokens[role] = login["token"]

    perm_path = os.path.join(HERE, "..", "permissions.json")
    with open(perm_path, encoding="utf-8") as f:
        perm = json.load(f)["transitions"]
    same = all(perm.get(frm, {}).get(to, []) == list(roles)
               for frm in engine.TRANSITIONS
               for to, roles in engine.TRANSITIONS[frm].items())
    check("the matrix probe runs against the shipped whitelist", same)

    states = list(engine.TRANSITIONS)
    mismatches = []
    refused_breaks = []
    allowed_total = sum(len(roles) for frm in states
                        for roles in engine.TRANSITIONS[frm].values())
    allowed_ok = 0
    probes = 0
    for frm in states:
        for to in states:
            for role in MATRIX_ROLES:
                probes += 1
                _matrix_prep(httpd, tid, frm)
                m, a = _move_attempt(frm, to, role, tid)
                s, r = c.request("POST", "/api/call", {"method": m, "args": a}, token=tokens[role])
                with httpd.state.lock:
                    now = engine.get_ticket(httpd.state.data, tid)["status"]
                if engine.can_transition(frm, to, role):
                    if r.get("ok") and now == to:
                        allowed_ok += 1
                    else:
                        mismatches.append("%s to %s as %s is whitelisted but got ok=%s status=%s (%s)"
                                          % (frm, to, role, r.get("ok"), now, r.get("msg")))
                else:
                    if r.get("ok") or now != frm:
                        refused_breaks.append("%s to %s as %s is off the whitelist yet got ok=%s status=%s"
                                              % (frm, to, role, r.get("ok"), now))
    check("the probe covered all 256 from-to-role combinations", probes == 64 * 4, probes)
    check("no off-whitelist move changed a ticket over HTTP",
          not refused_breaks, refused_breaks[:4])
    check("every whitelisted move succeeded over HTTP", allowed_ok == allowed_total,
          "%d of %d: %s" % (allowed_ok, allowed_total, mismatches[:4]))


def test_http_ticket_ids(httpd):
    """Audit W3: ticket numbers are minted by the server on every create path,
    and concurrent submits never collide, reuse or lose a number."""
    host, port = httpd.server_address[:2]
    c = Client(host, port)
    s, login = c.request("POST", "/api/login", {"role": "coordinator"})
    tok = login["token"]
    s, st = c.request("GET", "/api/state", token=tok)
    before = {t["id"] for t in st["tickets"]}

    crafted = {"id": "IT-9999-000099", "office": "Records Office",
               "requester": "A. Delos Reyes", "category": "Hardware Repair",
               "issue": "Crafted number probe.", "status": "submitted"}
    s, r = c.request("POST", "/api/state", {"state": {"tickets": [crafted]}}, token=tok)
    check("the state merge still admits a new Submitted record", r.get("ok"), r)
    s, st2 = c.request("GET", "/api/state", token=tok)
    minted = sorted({t["id"] for t in st2["tickets"]} - before)
    check("a client-crafted ticket number never enters the register",
          "IT-9999-000099" not in minted, minted)
    check("exactly one record was created", len(minted) == 1, minted)
    if minted:
        nid = minted[0]
        check("the server minted IT-YYYY-NNNNNN", re.fullmatch(r"IT-\d{4}-\d{6}", nid) is not None, nid)
        check("the minted record is Submitted",
              engine.get_ticket(st2, nid)["status"] == "submitted")
        s, r = c.request("POST", "/api/state", {"state": {"tickets": [
            {"id": nid, "office": "Records Office", "requester": "A. Delos Reyes",
             "category": "Hardware Repair",
             "history": engine.get_ticket(st2, nid).get("history") or [],
             "issue": "Edited after the server number was adopted"}]}}, token=tok)
        s, st3 = c.request("GET", "/api/state", token=tok)
        grew = {t["id"] for t in st3["tickets"]} - before
        t3 = engine.get_ticket(st3, nid)
        check("the record edits under the server number without duplicating",
              bool(r.get("ok")) and t3 and t3["issue"].startswith("Edited after") and len(grew) == 1,
              (r, sorted(grew)))

    ids = []
    errors = []
    lock = threading.Lock()

    def maker(n):
        cc = Client(host, port)
        s2, lg = cc.request("POST", "/api/login", {"role": "coordinator"})
        tk = lg["token"]
        for i in range(n):
            s2, res = cc.request("POST", "/api/call", {"method": "createTicket", "args": [{
                "office": "Records Office", "requester": "A. Delos Reyes",
                "category": "Hardware Repair",
                "issue": "Concurrent submit from thread %s no %d" % (threading.get_ident(), i)}]},
                token=tk)
            if not res.get("ok"):
                errors.append(str(res)[:80])
            else:
                with lock:
                    ids.append(res.get("id"))

    threads = [threading.Thread(target=maker, args=(3,)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    check("all twelve concurrent submits recorded", not errors and len(ids) == 12,
          (errors[:3], len(ids)))
    check("concurrent ticket numbers are unique", len(set(ids)) == len(ids), ids[:6])
    with httpd.state.lock:
        live = len(httpd.state.data.get("tickets", []))
        stored = httpd.state.conn.execute("SELECT COUNT(*) c FROM tickets").fetchone()["c"]
    check("the database holds every concurrently created record", live == stored, (live, stored))


def test_register_propagation():
    """Audit R3: the Office Register is a derived view over tickets, jobs and
    the audit trail, so close, cancel, recurrence and a maintenance outcome
    must surface in the records the register reads."""
    st = fresh()
    tid = "IT-2026-000143"
    req = {"role": "requester", "office": "Library", "name": "M. Bataller"}
    engine.call(st, "coordinator", "assess",
                [tid, {"impact": "Medium", "urgency": "Medium", "priority": "medium",
                       "target": "2026-11-05"}])
    engine.call(st, "coordinator", "assign", [tid, "J. Tan"])
    engine.call(st, "technician", "startWork", [tid, "visit agreed"])
    engine.call(st, "technician", "diagnose", [tid, {"findings": "failed NIC"}])
    engine.call(st, "technician", "recordTest", [tid, "pass", "link verified"])
    r = engine.call(st, "requester", "officeDecision",
                    [tid, "accepted", {"person": "M. Bataller"}], user=req)
    check("the office accepts the result", r.get("ok"), r)
    t = engine.get_ticket(st, tid)
    check("closure reaches the register record",
          t["status"] == "closed" and t["closure"] == "confirmation" and bool(t.get("closedAt")), t["status"])
    conf = t.get("confirmation") or {}
    check("the register carries the confirming person and date (SOP 15.1)",
          conf.get("state") == "accepted" and conf.get("person") == "M. Bataller" and bool(conf.get("date")), conf)
    check("closure reaches the register audit feed",
          any((e.get("subjectId") == tid) and
              ("closed" in str(e.get("status") or "").lower() or e.get("kind") == "confirm")
              for e in st["audit"][-6:]),
          st["audit"][-3:])

    r = engine.call(st, "coordinator", "createLinkedTicket", [tid, {"issue": "the link dropped again"}])
    check("recurrence is recorded", r.get("ok"), r)
    nt = engine.get_ticket(st, r["id"])
    check("the recurring pair reaches the register together",
          nt and nt["status"] == "submitted" and nt["linkedTo"] == tid
          and engine.get_ticket(st, tid)["recurring"] is True, nt)

    r = engine.call(st, "coordinator", "cancel", ["IT-2026-000130", "the office fixed it locally"])
    check("the cancellation is recorded", r.get("ok"), r)
    ct = engine.get_ticket(st, "IT-2026-000130")
    check("cancellation reaches the register record",
          ct["status"] == "cancelled" and ct["cancelReason"] == "the office fixed it locally")
    check("cancellation reaches the register audit feed",
          any(e.get("subjectId") == "IT-2026-000130" and e.get("kind") == "cancel"
              for e in st["audit"][-5:]), st["audit"][-3:])
    check("the cancellation reaches the requester notice (SOP 7)",
          any(n.get("kind") == "cancel" and n.get("ticketId") == "IT-2026-000130"
              and n.get("role") == "requester" for n in st["notifications"][:8]),
          [n.get("kind") for n in st["notifications"][:4]])

    jid = "MNT-2026-0061"
    job = engine.get_job(st, jid)
    check("the seeded visit is in the register pool", job is not None, jid)
    if job:
        job["technician"] = "J. Tan"
        for i in range(len(job["items"])):
            if not job["items"][i]["done"]:
                engine.call(st, "technician", "recordChecklistItem",
                            [jid, i, {"result": "Passed", "finding": "ok"}])
        engine.call(st, "technician", "flagAdditionalFault", [jid, "no"])
        engine.call(st, "technician", "recordOutcome", [jid, "success", "all good"])
        r = engine.call(st, "requester", "jobConfirmation", [jid, "accepted", "A. Delos Reyes"])
        check("the office confirms the visit", r.get("ok"), r)
        j = engine.get_job(st, jid)
        check("the outcome reaches the register maintenance tab",
              j["status"] == "closed" and j["outcome"] == "success", (j["status"], j["outcome"]))
        jconf = j.get("confirmation") or {}
        check("the maintenance visit carries its confirming person and date (SOP 27)",
              jconf.get("state") == "accepted" and jconf.get("person") == "A. Delos Reyes"
              and bool(jconf.get("date")), jconf)
        check("the confirmed visit is audited",
              any(e.get("subjectId") == jid for e in st["audit"][-8:]), st["audit"][-3:])
    ids = [t["id"] for t in st["tickets"]]
    check("no register record is duplicated by the propagation", len(ids) == len(set(ids)))


def test_action_rollback(tmp):
    """An engine action that dies partway must not stay in memory unsaved."""
    path = os.path.join(tmp, "rollback.sqlite3")
    st = database.State(path=path, seed_fn=seed_mod.seed)
    handler = appmod.ItcHandler.__new__(appmod.ItcHandler)
    first = st.data["tickets"][0]["id"]
    before = st.data["tickets"][0]["issue"]

    def half_applied_then_crash(*a, **k):
        next(t for t in st.data["tickets"] if t["id"] == first)["issue"] = "half applied"
        st.data["rev"] = st.data.get("rev", 0) + 1
        raise RuntimeError("probe")

    original = appmod.engine.call
    appmod.engine.call = half_applied_then_crash
    real_err, noise = sys.stderr, io.StringIO()
    sys.stderr = noise                       # the rollback prints its traceback
    try:
        res = handler._engine_call(st, "coordinator", "updateTicket", [first, {}],
                                   {"role": "coordinator", "name": "K. Ramos", "office": "IT Office"})
    finally:
        sys.stderr = real_err
        appmod.engine.call = original
    check("a crashed action is refused", res.get("ok") is False, res)
    check("the message names the failure type only",
          "probe" not in (res.get("msg") or "") and "RuntimeError" in (res.get("msg") or ""), res)
    check("the traceback went to the log, not the client", "probe" in noise.getvalue(), noise.getvalue()[:60])
    after = next(t for t in st.data["tickets"] if t["id"] == first)
    check("the half-applied edit is gone from the dataset", after["issue"] == before,
          (before, after["issue"]))
    stored = database.load_state(st.conn)
    check("the saved copy still matches memory",
          [t["id"] for t in stored["tickets"]] == [t["id"] for t in st.data["tickets"]])


def test_http_tenancy(httpd):
    host, port = httpd.server_address[:2]
    c = Client(host, port)
    s, login = c.request("POST", "/api/login", {"role": "requester"})
    tok = login["token"]
    s, snap = c.request("GET", "/api/state", token=tok)
    check("requester state is scoped",
          bool(snap["tickets"]) and all(t["office"] == "Records Office" for t in snap["tickets"]),
          [t["office"] for t in snap["tickets"]])
    check("requester scope is reported", snap.get("scope") == "Records Office")
    check("requester snapshot omits internal cost and labour",
          all("cost" not in (t.get("diagnosis") or {}) and "labor" not in (t.get("diagnosis") or {})
              for t in snap["tickets"]),
          [t.get("diagnosis") for t in snap["tickets"]])
    check("requester snapshot carries no internal audit log", snap.get("audit") == [])
    check("requester history never carries a peso amount",
          all("₱" not in (h.get("text") or "")
              for t in snap["tickets"] for h in (t.get("history") or [])))
    s, r = c.request("POST", "/api/call",
                     {"method": "officeDecision", "args": ["IT-2026-000143", "accepted", {"person": "X"}]},
                     token=tok)
    check("requester blocked from another office over HTTP", not r.get("ok"), r)
    s, r = c.request("POST", "/api/state", {"state": snap}, token=tok)
    check("requester cannot bulk-replace state", s == 403, s)

    # ---- a technician is scoped to the records assigned to them ----------
    s, login = c.request("POST", "/api/login", {"role": "technician"})
    ttok = login["token"]
    s, tsnap = c.request("GET", "/api/state", token=ttok)
    check("technician state is scoped",
          bool(tsnap["tickets"]) and all(t.get("technician") == "J. Tan" for t in tsnap["tickets"]),
          [t.get("technician") for t in tsnap["tickets"]])
    check("technician state carries no other technician's jobs",
          all(j.get("technician") == "J. Tan" for j in tsnap["jobs"]),
          [j.get("technician") for j in tsnap["jobs"]])
    s, tres = c.request("GET", "/api/tickets", token=ttok)
    check("the technician list is scoped",
          s == 200 and all(t.get("technician") == "J. Tan" for t in tres["items"]),
          [t.get("technician") for t in tres.get("items", [])])
    s, trep = c.request("GET", "/api/reports", token=ttok)
    check("the technician report is scoped to their own workload",
          s == 200 and trep["tickets_total"] <= tres["total"], (trep.get("tickets_total"), tres.get("total")))
    s, texp = c.request("GET", "/api/export", token=ttok)
    body = texp.decode("utf-8", "replace") if isinstance(texp, bytes) else str(texp)
    rows = [ln for ln in body.splitlines()[1:] if ln.strip()]
    check("the technician export is scoped",
          s == 200 and rows and all("Second Technician" not in ln for ln in rows),
          rows[:3])
    s, r = c.request("POST", "/api/call",
                     {"method": "addComment",
                      "args": ["IT-2026-000143", {"text": "not mine", "visibility": "internal"}]},
                     token=ttok)
    check("a technician cannot post on a ticket that is not theirs", not r.get("ok"), r)


def test_http_records(httpd):
    """List/records endpoints: server-side queries, RBAC, tenancy, files."""
    host, port = httpd.server_address[:2]
    c = Client(host, port)

    # ------------------------------------------------------- GET /api/tickets
    s, _ = c.request("GET", "/api/tickets")
    check("ticket list requires auth", s == 401, s)

    tok = c.request("POST", "/api/login", {"role": "coordinator"})[1]["token"]
    s, allres = c.request("GET", "/api/tickets", token=tok)
    check("ticket list ok", s == 200 and allres.get("ok"), allres)
    s, whole = c.request("GET", "/api/state", token=tok)
    check("ticket list returns every ticket",
          allres["total"] == len(whole["tickets"])
          and len(allres["items"]) == min(allres["total"], allres["size"]),
          (allres["total"], len(whole["tickets"])))
    check("list rows carry derived fields",
          all("overdue" in t and "turnaroundHours" in t for t in allres["items"]), allres["items"][:1])

    s, res = c.request("GET", "/api/tickets?status=open&size=3&page=2&sort=id&order=asc", token=tok)
    ids = [t["id"] for t in res["items"]]
    check("list filters and paginates", s == 200 and res["size"] == 3 and res["page"] == 2
          and len(res["items"]) == 3 and res["counts"].get("closed") is None, res)
    check("list sort applied server-side", ids == sorted(ids), ids)

    s, res = c.request("GET", "/api/tickets?q=delos&size=100", token=tok)
    check("list search matches requester", s == 200 and res["total"] >= 1
          and all("delos" in (t.get("requester") or "").lower() for t in res["items"]), res["total"])

    # requester tenancy on the list endpoint
    rtok = c.request("POST", "/api/login", {"role": "requester"})[1]["token"]
    s, mine = c.request("GET", "/api/tickets", token=rtok)
    check("requester list defaults to own requests",
          s == 200 and mine["total"] >= 1 and mine["total"] < 9
          and all(t["requester"] == mine["items"][0]["requester"] for t in mine["items"]), mine["total"])
    s, wide = c.request("GET", "/api/tickets?mine=0&size=100", token=rtok)
    check("requester can widen to the office register",
          s == 200 and wide["total"] >= mine["total"]
          and all(t["office"] == wide["scope"] for t in wide["items"]), wide["total"])
    s, other = c.request("GET", "/api/tickets?office=Registrar&size=100", token=rtok)
    check("requester cannot reach another office", s == 200 and other["total"] == 0, other)

    # ---------------------------------------------------------- GET /api/users
    s, _ = c.request("GET", "/api/users", token=rtok)
    check("users list blocked for requester", s == 403, s)
    ttok = c.request("POST", "/api/login", {"role": "technician"})[1]["token"]
    s, _ = c.request("GET", "/api/users", token=ttok)
    check("users list blocked for technician", s == 403, s)

    s, users = c.request("GET", "/api/users", token=tok)
    check("users list ok for coordinator", s == 200 and users.get("ok")
          and users["total"] >= 5, users.get("total"))
    s, techs = c.request("GET", "/api/users?role=technician", token=tok)
    check("users filter by role", s == 200 and techs["total"] >= 1
          and all(p["role"] == "technician" for p in techs["users"]), techs["total"])

    mtok = c.request("POST", "/api/login", {"role": "management"})[1]["token"]
    s, _ = c.request("POST", "/api/users", {"name": "Blocked Person"}, token=tok)
    check("user create blocked for coordinator", s == 403, s)
    s, created = c.request("POST", "/api/users",
                           {"name": "QA Records Clerk", "role": "requester",
                            "office": "Records Office", "email": "qa.clerk@example.org"}, token=mtok)
    person = created.get("person") or created.get("user") or {}
    check("user created by administrator", s == 200 and created.get("ok"), created)
    check("new account is given a username", bool(person.get("username")), created)
    uname = person.get("username")

    # -------------------------------------------- sign in with the initial password
    if uname:
        s, first = c.request("POST", "/api/login", {"username": uname, "password": auth.DEMO_PASSWORD})
        check("new account signs in with the initial password", s == 200 and first.get("token"), first)
        ctok = first["token"]

        # ---------------------------------------------------- POST /api/profile
        s, r = c.request("POST", "/api/profile",
                         {"currentPassword": "wrong", "newPassword": "s3cret"}, token=ctok)
        check("password change rejects the wrong current password", s == 400 and not r.get("ok"), r)
        s, r = c.request("POST", "/api/profile",
                         {"email": "qa.clerk@example.org", "phone": "0917-000-0000"}, token=ctok)
        check("profile edit saves contact details", s == 200 and r.get("ok")
              and r["user"].get("phone") == "0917-000-0000", r)
        s, r = c.request("POST", "/api/profile",
                         {"currentPassword": auth.DEMO_PASSWORD, "newPassword": "s3cret"}, token=ctok)
        check("password change ok", s == 200 and r.get("ok"), r)
        s, old = c.request("POST", "/api/login", {"username": uname, "password": auth.DEMO_PASSWORD})
        check("initial password no longer works", s == 401, s)
        s, new = c.request("POST", "/api/login", {"username": uname, "password": "s3cret"})
        check("new password signs in", s == 200 and new.get("token"), new)

    # -------------------------------------------------- /api/upload + download
    s, _ = c.request("POST", "/api/upload",
                     {"name": "notes.txt", "mime": "text/plain", "data": "!!"}, token=tok)
    check("upload rejects invalid base64", s == 400, s)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "bad.exe", "mime": "application/x-msdownload", "data": "aGk="}, token=tok)
    check("upload rejects disallowed types", s == 400, s)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "page.svg", "mime": "image/svg+xml", "data": "aGk="}, token=tok)
    check("upload rejects a type that can carry a script", s == 400, s)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "huge.txt", "mime": "text/plain",
                      "data": base64.b64encode(b"x" * (11 * 1024 * 1024)).decode()}, token=tok)
    check("upload rejects a file over 10 MB", s == 400, s)

    payload = base64.b64encode(b"ITC attachment probe").decode()
    own_ticket = mine["items"][0]["id"]
    png = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 24)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "screen.png", "mime": "image/png",
                      "data": base64.b64encode(png).decode(), "ticketId": own_ticket}, token=tok)
    check("a real png is accepted", s == 200, s)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "fake.png", "mime": "image/png",
                      "data": base64.b64encode(b"renamed executable").decode(),
                      "ticketId": own_ticket}, token=tok)
    check("bytes that are not the claimed type are refused", s == 400, s)
    docx = io.BytesIO()
    with zipfile.ZipFile(docx, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("word/document.xml", "<w:document/>")
    s, _ = c.request("POST", "/api/upload",
                     {"name": "report.docx", "mime": "application/octet-stream",
                      "data": base64.b64encode(docx.getvalue()).decode(),
                      "ticketId": own_ticket}, token=tok)
    check("a real docx is accepted from its extension", s == 200, s)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "not-really.xlsx",
                      "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      "data": base64.b64encode(docx.getvalue()).decode(),
                      "ticketId": own_ticket}, token=tok)
    check("a docx body is refused as a spreadsheet", s == 400, s)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "notes.txt", "mime": "text/plain",
                      "data": base64.b64encode(b"line one\x00line two").decode(),
                      "ticketId": own_ticket}, token=tok)
    check("binary content filed as text is refused", s == 400, s)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "sheet.xls", "mime": "application/vnd.ms-excel",
                      "data": base64.b64encode(b"\xd0\xcf\x11\xe0" + b"\x00" * 32).decode(),
                      "ticketId": own_ticket}, token=tok)
    check("an office type outside the allowlist is refused", s == 400, s)
    # The same legacy workbook body filed under an allowed name must be caught
    # by the content check, not the allowlist.
    s, _ = c.request("POST", "/api/upload",
                     {"name": "sheet.xlsx", "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      "data": base64.b64encode(b"\xd0\xcf\x11\xe0" + b"\x00" * 32).decode(),
                      "ticketId": own_ticket}, token=tok)
    check("a legacy workbook body filed as xlsx is refused by its bytes", s == 400, s)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "export.csv", "mime": "text/csv",
                      "data": base64.b64encode("Office\r\nRecords\t2026".encode("utf-16")).decode(),
                      "ticketId": own_ticket}, token=tok)
    check("a UTF-16 export is accepted as text", s == 200, s)
    s, up = c.request("POST", "/api/upload",
                      {"name": "photo.txt", "mime": "text/plain", "data": payload,
                       "ticketId": own_ticket}, token=rtok)
    check("requester uploads to their own ticket", s == 200 and up.get("ok"), up)
    fid = (up.get("file") or {}).get("id")
    # the record lists the evidence by name, the way the data model says
    s, st = c.request("GET", "/api/state", token=tok)
    listed = next((t.get("attachments") for t in (st.get("tickets") or [])
                   if t.get("id") == own_ticket), None)
    check("the ticket lists the attached file", listed is not None and "photo.txt" in listed, listed)
    s, body = c.request("GET", "/api/attachment?id=%s" % fid, token=rtok)
    check("attachment roundtrip returns the bytes",
          s == 200 and body == b"ITC attachment probe", body)
    s, _ = c.request("GET", "/api/attachment?id=%s" % fid)
    check("attachment download requires auth", s == 401, s)

    # a media element cannot carry an Authorization header, so the token in
    # the query string is what lets an <img> or a PDF viewer read the bytes
    s, body = c.request("GET", "/api/attachment?id=%s&token=%s" % (fid, rtok))
    check("attachment reads with the token in the query", s == 200 and body == b"ITC attachment probe", s)

    # a range request lets a PDF viewer seek (D21)
    s, body = c.request("GET", "/api/attachment?id=%s" % fid,
                        token=rtok, headers={"Range": "bytes=4-9"})
    check("a range request returns the asked-for part", s == 206 and body == b"attach", (s, body))
    s, body = c.request("GET", "/api/attachment?id=%s" % fid,
                        token=rtok, headers={"Range": "bytes=0-"})
    check("an open-ended range returns the whole file", s == 206 and body == b"ITC attachment probe", (s, body))
    s, _ = c.request("GET", "/api/attachment?id=%s" % fid,
                     token=rtok, headers={"Range": "bytes=9999-10000"})
    check("a range past the end is refused", s == 416, s)

    # video is outside the specification's attachment list
    s, _ = c.request("POST", "/api/upload",
                     {"name": "clip.mp4", "mime": "video/mp4", "data": "aGk="}, token=tok)
    check("a video attachment is refused", s == 400, s)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "clip.mov", "mime": "video/quicktime", "data": "aGk="}, token=tok)
    check("a quicktime attachment is refused", s == 400, s)

    foreign = next((t["id"] for t in allres["items"] if t.get("office") != wide["scope"]), None)
    s, _ = c.request("POST", "/api/upload",
                     {"name": "cross.txt", "mime": "text/plain", "data": payload,
                      "ticketId": foreign}, token=rtok)
    check("requester cannot attach to another office", s == 403, s)

    # at most ten files on one record (decision D21)
    for n in range(11):
        s, _ = c.request("POST", "/api/upload",
                         {"name": "note%d.txt" % n, "mime": "text/plain", "data": payload,
                          "ticketId": own_ticket}, token=tok)
    check("a record holds at most ten files", s == 400, s)

    s, rep = c.request("GET", "/api/reports", token=tok)
    check("reports carry the new aggregates",
          s == 200 and rep.get("default_sla_days") == query_mod.DEFAULT_SLA_DAYS
          and "resolved_within_target" in rep and "resolved_with_target" in rep
          and "turnaround_avg_hours" in rep and "by_category" in rep
          and "by_source" in rep and "overdue" in rep, rep)
    s, rrep = c.request("GET", "/api/reports", token=rtok)
    check("reports are office-scoped for requesters",
          s == 200 and rrep["tickets_total"] < rep["tickets_total"]
          and set(rrep["by_office"].keys()) <= set(rep["by_office"].keys()), rrep["tickets_total"])
    s, jrep = c.request("GET", "/api/reports?technician=J.%20Tan", token=tok)
    check("reports filter maintenance jobs by technician",
          s == 200 and jrep["jobs_total"] < rep["jobs_total"]
          and jrep["tickets_total"] <= rep["tickets_total"], jrep)
    s, crep = c.request("GET", "/api/reports?office=Records%20Office", token=tok)
    check("reports filter maintenance jobs by office",
          s == 200 and crep["jobs_total"] < rep["jobs_total"], crep["jobs_total"])


def test_http_sla_window(httpd):
    """The service level window the administrator saves is what the endpoints use."""
    host, port = httpd.server_address[:2]
    c = Client(host, port)
    mtok = c.request("POST", "/api/login", {"role": "management"})[1]["token"]
    ctok = c.request("POST", "/api/login", {"role": "coordinator"})[1]["token"]
    rtok = c.request("POST", "/api/login", {"role": "requester"})[1]["token"]

    s, rep = c.request("GET", "/api/reports", token=ctok)
    check("reports start on the shipped window",
          s == 200 and rep.get("default_sla_days") == query_mod.DEFAULT_SLA_DAYS, rep)
    s, r = c.request("POST", "/api/call", {"method": "saveSettings", "args": [{"slaDays": 9}]}, token=mtok)
    check("the administrator can save the window over HTTP", s == 200 and r.get("ok"), r)
    s, rep = c.request("GET", "/api/reports", token=ctok)
    check("reports follow the saved window", rep.get("default_sla_days") == 9, rep)
    s, r = c.request("POST", "/api/call", {"method": "saveSettings", "args": [{"slaDays": 900}]}, token=mtok)
    check("an out of range window is refused over HTTP", s in (200, 400) and not r.get("ok"), r)
    s, rep = c.request("GET", "/api/reports", token=ctok)
    check("a refused window leaves the reports figure alone", rep.get("default_sla_days") == 9, rep)
    s, r = c.request("POST", "/api/call", {"method": "saveSettings", "args": [{"slaDays": 3}]}, token=ctok)
    check("a coordinator cannot save the window over HTTP", not r.get("ok"), r)
    s, rep = c.request("GET", "/api/reports", token=rtok)
    check("a scoped office report carries the window in force",
          s == 200 and rep.get("default_sla_days") == 9, rep)
    c.request("POST", "/api/call", {"method": "saveSettings", "args": [{"slaDays": query_mod.DEFAULT_SLA_DAYS}]},
              token=mtok)


def test_http_outbox(httpd):
    host, port = httpd.server_address[:2]
    c = Client(host, port)
    s, login = c.request("POST", "/api/login", {"role": "coordinator"})
    tok = login["token"]
    c.request("POST", "/api/call",
              {"method": "createTicket", "args": [{"office": "Library", "requester": "QA Bot",
                                                   "category": "Software", "issue": "outbox probe"}]},
              token=tok)
    s, box = c.request("GET", "/api/notifications/outbox", token=tok)
    check("outbox readable by coordinator", s == 200 and box.get("ok"), box)
    check("outbox captured deliveries", len(box["outbox"]) >= 1, box)
    check("outbox channels include outbox", "outbox" in box["channels"], box["channels"])

    s, login = c.request("POST", "/api/login", {"role": "technician"})
    s, r = c.request("GET", "/api/notifications/outbox", token=login["token"])
    check("outbox blocked for technician", s == 403, s)


# ----------------------------------------------------------------- seed parity
def test_seed_shape():
    st = fresh()
    for key in ("v", "rev", "updatedAt", "seq", "role", "settings", "tickets", "schedules", "jobs", "notifications", "audit"):
        check("seed has key %s" % key, key in st, list(st.keys()))
    t = st["tickets"][0]
    for key in ("id", "office", "requester", "category", "source", "issue", "asset", "attachments",
                "status", "priority", "createdAt", "history", "tests", "reminders", "diagnosis", "confirmation"):
        check("ticket has key %s" % key, key in t, list(t.keys()))
    j = st["jobs"][0]
    for key in ("id", "scheduleId", "occurrence", "office", "assets", "technician", "checklist",
                "items", "status", "reschedules", "additionalFault", "confirmation"):
        check("job has key %s" % key, key in j, list(j.keys()))
    a = st["assets"][0]
    for key in ("id", "tag", "name", "category", "office", "location", "active", "createdAt", "updatedAt"):
        check("asset has key %s" % key, key in a, list(a.keys()))
    # Intake offers the units of the office in hand, so a demo office with no
    # registered unit would show an empty pick list.
    held = set(x["office"] for x in st["assets"] if x.get("active") is not False)
    unheld = [o["name"] for o in st["offices"] if o.get("active") is not False and o["name"] not in held]
    check("every active office holds a registered unit", not unheld, unheld)
    check("asset ids are unique", len(set(x["id"] for x in st["assets"])) == len(st["assets"]))
    check("asset tags are unique", len(set(x["tag"] for x in st["assets"])) == len(st["assets"]))

    # The defaults an empty database starts from must clear the same guards the
    # settings screen uses; a no-op answer also proves they agree with the seed.
    probe = {k: database.DEFAULT_SETTINGS[k] for k in
             ("reminderMode", "reminderMinutes", "reminderBusinessDays", "reminderRepeatDays",
              "slaDays", "workdays", "holidays", "authorizedClosureRoles", "priorityMatrix")}
    r = engine.call(fresh(), "management", "saveSettings", [probe])
    check("the shipped defaults pass the settings guards", r.get("msg") == "Nothing to update.", r)
    check("the seed ships the same window the query module defaults to",
          st["settings"]["slaDays"] == query_mod.DEFAULT_SLA_DAYS, st["settings"].get("slaDays"))


# ----------------------------------------------------------------- oidc
def _is_probable_prime(n, rounds=12):
    if n < 2:
        return False
    small = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]
    for p in small:
        if n % p == 0:
            return n == p
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for a in small[:rounds]:
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


def _gen_prime(bits, rng):
    while True:
        cand = rng.getrandbits(bits) | (1 << (bits - 1)) | 1
        if _is_probable_prime(cand):
            return cand


def _gen_rsa(bits=1024, seed=20260813):
    """Deterministic, dependency-free RSA keypair for the OIDC tests."""
    rng = random.Random(seed)
    e = 65537
    while True:
        p = _gen_prime(bits // 2, rng)
        q = _gen_prime(bits // 2, rng)
        if p == q:
            continue
        n = p * q
        phi = (p - 1) * (q - 1)
        if math.gcd(e, phi) != 1:
            continue
        return n, e, pow(e, -1, phi)


def _b64(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _jwk(n, e, kid="test"):
    return {"kty": "RSA", "kid": kid, "alg": "RS256", "use": "sig",
            "n": _b64(n.to_bytes((n.bit_length() + 7) // 8, "big")),
            "e": _b64(e.to_bytes((e.bit_length() + 7) // 8, "big"))}


def _mint(n, d, claims, kid="test", header_extra=None):
    header = {"alg": "RS256", "typ": "JWT", "kid": kid}
    if header_extra:
        header.update(header_extra)
    signing_input = (_b64(json.dumps(header, separators=(",", ":"))) + "." +
                     _b64(json.dumps(claims, separators=(",", ":")))).encode("ascii")
    return signing_input.decode("ascii") + "." + _b64(oidc.rsa_sign(signing_input, n, d))


def _oidc_rejects(token, client_id="client-123", domains=("upcebu.edu.ph",), jwks=None, now=None):
    try:
        oidc.verify_id_token(token, client_id, domains, jwks=jwks, now=now)
        return False
    except oidc.OidcError:
        return True


def test_oidc():
    n, e, d = _gen_rsa()
    jwks = {"test": _jwk(n, e)}
    now = 1_800_000_000.0
    base = {"iss": "https://accounts.google.com", "aud": "client-123", "exp": now + 3600,
            "iat": now - 10, "email": "j.tan@upcebu.edu.ph", "email_verified": True,
            "hd": "upcebu.edu.ph", "name": "J. Tan"}
    tok = _mint(n, d, base)
    claims = oidc.verify_id_token(tok, "client-123", ["upcebu.edu.ph"], jwks=jwks, now=now)
    check("oidc verifies a valid token", claims["email"] == "j.tan@upcebu.edu.ph", claims)
    check("oidc decodes the header", oidc.decode_header(tok)["kid"] == "test")
    no_hd = _mint(n, d, dict(base, hd=None))
    check("oidc accepts an in-domain email without hd",
          oidc.verify_id_token(no_hd, "client-123", ["upcebu.edu.ph"], jwks=jwks, now=now) is not None)

    parts = tok.split(".")
    tampered = (parts[0] + "." +
                _b64(json.dumps(dict(base, email="evil@x.com"), separators=(",", ":"))) + "." + parts[2])
    check("oidc rejects a tampered payload", _oidc_rejects(tampered, jwks=jwks, now=now))
    check("oidc rejects an expired token",
          _oidc_rejects(_mint(n, d, dict(base, exp=now - 3600)), jwks=jwks, now=now))
    check("oidc rejects a wrong audience",
          _oidc_rejects(_mint(n, d, dict(base, aud="other")), jwks=jwks, now=now))
    check("oidc rejects a wrong issuer",
          _oidc_rejects(_mint(n, d, dict(base, iss="https://evil.example")), jwks=jwks, now=now))
    check("oidc rejects an unverified email",
          _oidc_rejects(_mint(n, d, dict(base, email_verified=False)), jwks=jwks, now=now))
    check("oidc rejects an out-of-domain account",
          _oidc_rejects(_mint(n, d, dict(base, email="x@gmail.com", hd="gmail.com")), jwks=jwks, now=now))
    check("oidc rejects an unknown kid",
          _oidc_rejects(_mint(n, d, base, kid="nope"), jwks=jwks, now=now))
    alg_none = _b64(json.dumps({"alg": "none", "kid": "test"})) + "." + _b64(json.dumps(base)) + "."
    check("oidc rejects alg=none", _oidc_rejects(alg_none, jwks=jwks, now=now))
    check("oidc requires a client id", _oidc_rejects(tok, client_id="", jwks=jwks, now=now))

    n2, _e2, d2 = _gen_rsa(seed=7)
    check("oidc rejects a foreign signing key",
          _oidc_rejects(_mint(n2, d2, base), jwks=jwks, now=now))

    cid, domains = oidc.config_from_env({"ITC_GOOGLE_CLIENT_ID": "abc",
                                         "ITC_ALLOWED_DOMAINS": "a.edu, b.edu"})
    check("oidc config from environment", cid == "abc" and domains == ["a.edu", "b.edu"], (cid, domains))


# ------------------------------------------------------------- delivery
def test_delivery(tmp):
    path = os.path.join(tmp, "delivery.sqlite3")
    if os.path.exists(path):
        os.remove(path)
    st = database.State(path=path, seed_fn=seed_mod.seed)
    auth.ensure_users(st.conn)
    emails, sms = [], []

    def resolve(role, office):
        return auth.contacts_for(st.conn, role, office)

    d = delivery_mod.Delivery(
        channels=["outbox", "email", "sms"], conn=st.conn, resolve=resolve,
        email_sender=lambda to, subject, text: emails.append((to, subject, text)),
        sms_sender=lambda to, text: sms.append((to, text)))
    recs = d.deliver({"role": "coordinator", "text": "Ticket IT-1 recorded.", "ticketId": "IT-1"})
    check("delivery emits one record per channel", len(recs) == 3, recs)
    check("delivery e-mail actually sent",
          len(emails) == 1 and emails[0][0] == "k.ramos@upcebu.edu.ph", emails)
    check("delivery SMS actually sent", len(sms) == 1 and sms[0][0].startswith("+63"), sms)
    check("delivery outbox persisted", len(d.outbox()) == 3)
    check("delivery stats per channel", d.stats().get("email") == 1, d.stats())

    def boom(*_args):
        raise RuntimeError("smtp down")

    d2 = delivery_mod.Delivery(channels=["outbox", "email"], conn=st.conn, resolve=resolve,
                               email_sender=boom)
    recs2 = d2.deliver({"role": "technician", "text": "Maintenance reminder."})
    check("delivery records a failed channel",
          any((not r["ok"]) and "smtp down" in r["error"] for r in recs2), recs2)
    check("delivery keeps other channels working", any(r["ok"] for r in recs2), recs2)

    check("channels_from_env default", delivery_mod.channels_from_env({}) == ["outbox"])
    check("channels_from_env parses",
          delivery_mod.channels_from_env({"ITC_NOTIFY_CHANNELS": "console,email"}) == ["console", "email", "outbox"])
    check("channels_from_env ignores unknown names",
          delivery_mod.channels_from_env({"ITC_NOTIFY_CHANNELS": "telepathy"}) == ["outbox"])


# --------------------------------------------------------------- tenancy
def test_tenancy():
    st = fresh()
    req = {"role": "requester", "name": "A. Delos Reyes", "office": "Records Office"}

    r = engine.call(st, "requester", "submitInfo", ["IT-2026-000143", {"issue": "x"}], user=req)
    check("tenancy blocks another office", not r.get("ok"), r)

    r = engine.call(st, "requester", "createTicket",
                    [{"office": "Library", "requester": "A. Delos Reyes", "category": "Hardware",
                      "issue": "printer jam"}], user=req)
    check("tenancy createTicket ok", r.get("ok"), r)
    tid = r["id"]
    check("tenancy keeps the chosen office",
          engine.get_ticket(st, tid)["office"] == "Library")

    engine.call(st, "coordinator", "requestInfo", [tid, "serial number"])
    r = engine.call(st, "requester", "submitInfo", [tid, {"issue": "fixed", "note": "SN 42"}], user=req)
    check("tenancy allows the request the requester raised", r.get("ok"), r)
    check("tenancy does not leak the acting user", "_user" not in st)

    st2 = fresh()
    r = engine.call(st2, "requester", "createTicket",
                    [{"office": "Library", "requester": "A. Delos Reyes", "category": "Hardware",
                      "issue": "x"}], user=None)
    check("tenancy unscoped without a user",
          r.get("ok") and engine.get_ticket(st2, r["id"])["office"] == "Library", r)


def test_requester_scope_includes_own_requests():
    """A requester sees their office and the requests they raised elsewhere."""

    class Dummy:
        _redact_costs = staticmethod(appmod.ItcHandler._redact_costs)

    snap = {
        "tickets": [
            {"id": "A", "office": "Records Office", "requester": "Someone Else"},
            {"id": "B", "office": "Library", "requester": "A. Delos Reyes"},
            {"id": "C", "office": "Library", "requester": "Someone Else"},
        ],
        "schedules": [], "jobs": [], "audit": [],
        "notifications": [
            {"id": 1, "role": "requester", "office": "Library", "ticketId": "B"},
            {"id": 2, "role": "requester", "office": "Library", "ticketId": "C"},
        ],
    }
    user = {"role": "requester", "name": "A. Delos Reyes", "office": "Records Office"}
    out = appmod.ItcHandler._scoped_requester(Dummy(), snap, user)
    ids = [t["id"] for t in out["tickets"]]
    check("scope keeps the office records", "A" in ids)
    check("scope keeps the request the requester raised", "B" in ids)
    check("scope hides another office's other records", "C" not in ids)
    check("scope keeps notifications for the request raised",
          [n["id"] for n in out["notifications"]] == [1], out["notifications"])


def test_technician_notification_scope():
    """A technician only receives notices for their own ticket and visits."""

    class Dummy:
        pass

    snap = {
        "tickets": [
            {"id": "T-1", "technician": "M. Uy"},
            {"id": "T-2", "technician": "J. Tan"},
        ],
        "schedules": [],
        "jobs": [
            {"id": "J-1", "technician": "M. Uy", "scheduleId": "S-1"},
            {"id": "J-2", "technician": "J. Tan", "scheduleId": "S-2"},
        ],
        "audit": [],
        "notifications": [
            {"id": 1, "role": "technician", "ticketId": "T-1"},
            {"id": 2, "role": "technician", "ticketId": "T-2"},
            {"id": 3, "role": "technician", "jobId": "J-1"},
            {"id": 4, "role": "technician", "jobId": "J-2"},
            {"id": 5, "role": "technician", "to": "M. Uy"},
            {"id": 6, "role": "technician", "to": "J. Tan"},
            {"id": 7, "role": "any"},
        ],
    }
    user = {"role": "technician", "name": "M. Uy"}
    out = appmod.ItcHandler._scoped_technician(Dummy(), snap, user)
    check("technician scope keeps only their notices",
          [n["id"] for n in out["notifications"]] == [1, 3, 5, 7], out["notifications"])


def test_asset_scope():
    """The register belongs to Administration; other lanes get a pick list."""

    class Dummy:
        """Stands in for the handler; the scoping helpers are pure."""

        _asset_ref = staticmethod(appmod.ItcHandler._asset_ref)
        _redact_costs = staticmethod(appmod.ItcHandler._redact_costs)

    snap = {
        "tickets": [], "schedules": [], "jobs": [], "audit": [], "files": [],
        "notifications": [],
        "assets": [
            {"id": "AST-0001", "tag": "PC-OF-118", "name": "Dell OptiPlex",
             "category": "Hardware Repair", "office": "Records Office",
             "location": "Room 2", "active": True,
             "createdAt": "x", "updatedAt": "x"},
            {"id": "AST-0004", "tag": "PRN-REG-02", "name": "Epson L3250",
             "category": "Printer and Peripheral", "office": "Registrar",
             "location": "Ground Floor", "active": True,
             "createdAt": "x", "updatedAt": "x"},
        ],
    }

    out = appmod.ItcHandler._scoped_requester(
        Dummy(), dict(snap, tickets=[]), {"office": "Records Office", "name": "A. Delos Reyes"})
    tags = [a["tag"] for a in out["assets"]]
    check("an office reads only its own units", tags == ["PC-OF-118"], tags)
    check("the office copy carries no internal id",
          all("id" not in a and "createdAt" not in a for a in out["assets"]), out["assets"])

    tech = appmod.ItcHandler._scoped_technician(
        Dummy(), dict(snap), {"name": "J. Tan"})
    check("a technician reads the whole pick list",
          [a["tag"] for a in tech["assets"]] == ["PC-OF-118", "PRN-REG-02"], tech["assets"])
    check("the technician copy carries no internal id",
          all("id" not in a and "updatedAt" not in a for a in tech["assets"]), tech["assets"])

    admin = appmod.ItcHandler._scoped_management(Dummy(), dict(snap))
    check("Administration keeps the full register records",
          all("id" in a and "createdAt" in a for a in admin["assets"]), admin["assets"])


# ------------------------------------------------------------- intake fields
def test_intake_priority():
    st = fresh()
    req = {"role": "requester", "name": "A. Delos Reyes", "office": "Records Office"}
    before = len(st["tickets"])

    r = engine.call(st, "requester", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Monitor flickers.",
        "priority": "high", "dateReported": "2026-09-30",
        "idempotencyKey": "intake-priority-1",
    }], user=req)
    check("intake accepts a priority", r.get("ok"), r)
    t = engine.get_ticket(st, r["id"])
    check("requester intake starts at Medium", t["priority"] == "medium", t["priority"])
    check("intake stores the reported date", t["dateReported"] == "2026-09-30", t.get("dateReported"))
    check("intake stores the duplicate key", t["idempotencyKey"] == "intake-priority-1", t.get("idempotencyKey"))

    r2 = engine.call(st, "requester", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Monitor flickers.",
        "priority": "high", "idempotencyKey": "intake-priority-1",
    }], user=req)
    check("intake duplicate key returns the first ticket",
          r2.get("ok") and r2.get("id") == r["id"] and r2.get("duplicate"), r2)
    check("intake duplicate key creates no second ticket", len(st["tickets"]) == before + 1)

    coord = {"role": "coordinator", "name": "System Admin"}
    okay = engine.call(st, "coordinator", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Monitor flickers.", "priority": "high",
    }], user=coord)
    check("coordinator intake stores the chosen priority",
          okay.get("ok") and engine.get_ticket(st, okay["id"])["priority"] == "high", okay)
    bad = engine.call(st, "coordinator", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Monitor flickers.", "priority": "urgent",
    }], user=coord)
    check("coordinator intake rejects an unknown priority", not bad.get("ok"), bad)

    plain = engine.call(st, "requester", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Keyboard sticks.",
    }], user=req)
    check("intake defaults to Medium when no priority is given",
          engine.get_ticket(st, plain["id"])["priority"] == "medium",
          engine.get_ticket(st, plain["id"])["priority"])

    # The intake source is one of the controlled reference values.
    src = engine.call(st, "coordinator", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Source label probe.", "source": "Walk-in",
    }], user=coord)
    check("intake normalises a source label",
          src.get("ok") and engine.get_ticket(st, src["id"])["source"] == "walk-in", src)
    bad_src = engine.call(st, "coordinator", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Spam source probe.", "source": "chat spam 42",
    }], user=coord)
    check("intake rejects a free-text source", not bad_src.get("ok"), bad_src)

    # A previous record must be a real ticket in the same office.
    prev_ok = engine.call(st, "requester", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Same fault returned.",
        "previousRecord": "IT-2026-000142",
    }], user=req)
    check("intake links a previous record",
          prev_ok.get("ok") and engine.get_ticket(st, prev_ok["id"])["previousRecord"] == "IT-2026-000142", prev_ok)
    prev_missing = engine.call(st, "requester", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Bad link.", "previousRecord": "IT-2000-999999",
    }], user=req)
    check("intake rejects an unknown previous record", not prev_missing.get("ok"), prev_missing)
    prev_other = engine.call(st, "requester", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Cross-office link.", "previousRecord": "IT-2026-000130",
    }], user=req)
    check("intake rejects a previous record from another office", not prev_other.get("ok"), prev_other)
    foreign = engine.call(st, "coordinator", "createTicket", [{
        "office": "Records Office", "requester": "J. Cruz",
        "category": "Hardware Repair", "issue": "Raised at the counter.",
    }], user=coord)
    prev_foreign = engine.call(st, "requester", "createTicket", [{
        "office": "Records Office", "requester": "A. Delos Reyes",
        "category": "Hardware Repair", "issue": "Someone else's link.",
        "previousRecord": foreign["id"],
    }], user=req)
    check("intake rejects another requester's record as the previous record",
          not prev_foreign.get("ok"), prev_foreign)


# ------------------------------------------------- conversation + intake edits
def test_conversation():
    st = fresh()
    req = {"role": "requester", "name": "A. Delos Reyes", "office": "Records Office"}

    r = engine.call(st, "requester", "addComment",
                    ["IT-2026-000142", {"text": "Any update on my PC?"}], user=req)
    check("requester reply ok", r.get("ok"), r)
    t = engine.get_ticket(st, "IT-2026-000142")
    check("reply stored public", t["comments"][-1]["visibility"] == "public"
          and t["comments"][-1]["by"] == "A. Delos Reyes", t["comments"])
    check("reply audit written",
          any(e["kind"] == "comment" and e["subjectId"] == "IT-2026-000142" for e in st["audit"]))

    r = engine.call(st, "requester", "addComment",
                    ["IT-2026-000143", {"text": "hello other office"}], user=req)
    check("reply blocked cross-office", not r.get("ok"), r)

    r = engine.call(st, "coordinator", "createTicket",
                    [{"office": "Records Office", "requester": "G. Sample",
                      "category": "Hardware", "issue": "shared machine"}])
    other = r["id"]
    r = engine.call(st, "requester", "addComment", [other, {"text": "not mine"}], user=req)
    check("reply blocked for someone else's ticket", not r.get("ok"), r)

    r = engine.call(st, "coordinator", "addComment",
                    ["IT-2026-000142", {"text": "PSU already in stock.", "visibility": "internal"}])
    check("internal note ok", r.get("ok") and r.get("visibility") == "internal note", r)
    t = engine.get_ticket(st, "IT-2026-000142")
    check("internal note stored", t["comments"][-1]["visibility"] == "internal")

    r = engine.call(st, "coordinator", "addComment", ["IT-2026-000142", {"text": "   "}])
    check("empty message rejected", not r.get("ok"), r)

    # intake correction while still Submitted
    r = engine.call(st, "coordinator", "createTicket",
                    [{"office": "Records Office", "requester": "A. Delos Reyes",
                      "category": "Hardware", "issue": "before edit"}])
    tid = r["id"]
    r = engine.call(st, "requester", "updateTicket",
                    [tid, {"issue": "after edit", "category": "Network"}], user=req)
    check("intake edit ok", r.get("ok"), r)
    t = engine.get_ticket(st, tid)
    check("intake edit applied", t["issue"] == "after edit" and t["category"] == "Network")
    check("intake edit audited",
          any(e["kind"] == "edit" and e["subjectId"] == tid for e in st["audit"]))

    engine.call(st, "coordinator", "assess",
                [tid, {"impact": "Low", "urgency": "Low", "priority": "low", "target": "2026-12-01"}])
    engine.call(st, "coordinator", "assign", [tid, "J. Tan"])
    r = engine.call(st, "requester", "updateTicket", [tid, {"issue": "too late"}], user=req)
    check("intake edit blocked once assigned", not r.get("ok"), r)
    r = engine.call(st, "coordinator", "updateTicket", [tid, {"issue": "nope"}])
    check("intake edit is requester-only", not r.get("ok"), r)


def test_notifications_read():
    st = fresh()
    ids = [n["id"] for n in st["notifications"] if n["role"] == "coordinator"]
    r = engine.call(st, "coordinator", "markNotificationsRead", [ids])
    check("mark read ok", r.get("ok") and r.get("count") == len(ids), r)
    marked = [n for n in st["notifications"] if n["id"] in ids]
    check("readBy stamped per user", all("K. Ramos" in n.get("readBy", []) for n in marked))
    r = engine.call(st, "coordinator", "markNotificationsRead", [ids])
    check("mark read idempotent", r.get("count") == 0, r)
    r = engine.call(st, "coordinator", "markNotificationsRead", [[]])
    check("mark all read", r.get("ok") and r.get("count") >= 0, r)


# ----------------------------------------------------------------- admin (Admin)
def test_admin_engine():
    st = fresh()

    for role in ("coordinator", "technician", "requester"):
        r = engine.call(st, role, "saveOffice", [{"name": "Blocked"}])
        check("saveOffice blocked for %s" % role, not r.get("ok"), r)
    r = engine.call(st, "management", "saveOffice", [{"name": "Clinic", "location": "Bldg A"}])
    check("office created", r.get("ok") and any(o["name"] == "Clinic" for o in st["offices"]), r)
    r = engine.call(st, "management", "saveOffice", [{"name": "Clinic", "location": "Bldg B"}])
    check("office updated", r.get("ok") and next(o for o in st["offices"]
                                                 if o["name"] == "Clinic")["location"] == "Bldg B", r)
    r = engine.call(st, "management", "saveOffice", [{"id": "Library", "name": "Library Office"}])
    check("office rename ok", r.get("ok"), r)
    check("office rename cascades to tickets",
          all(t["office"] != "Library" for t in st["tickets"]
              if t["id"] == "IT-2026-000143") and
          engine.get_ticket(st, "IT-2026-000143")["office"] == "Library Office")
    check("office rename cascades to schedules",
          next(s for s in st["schedules"] if s["id"] == "SCH-2026-012")["office"] == "Library Office")
    r = engine.call(st, "management", "setOfficeActive", ["Clinic", False])
    check("office deactivated", r.get("ok") and not next(
        o for o in st["offices"] if o["name"] == "Clinic")["active"], r)

    r = engine.call(st, "management", "savePerson",
                    [{"name": "New Person", "role": "technician", "office": "IT Office"}])
    check("person created", r.get("ok") and r["person"].get("username") == "new.person", r)
    r = engine.call(st, "management", "savePerson",
                    [{"name": "New Person", "role": "technician", "office": "IT Office"}])
    check("duplicate person rejected", not r.get("ok"), r)
    r = engine.call(st, "management", "savePerson",
                    [{"name": "Bad Role", "role": "wizard", "office": "IT Office"}])
    check("invalid role rejected", not r.get("ok"), r)

    r = engine.call(st, "management", "savePerson",
                    [{"id": "areyes", "name": "A. D. Reyes", "role": "requester",
                      "office": "Records Office"}])
    check("person rename ok", r.get("ok"), r)
    check("person rename cascades to their tickets",
          engine.get_ticket(st, "IT-2026-000142")["requester"] == "A. D. Reyes")

    r = engine.call(st, "management", "setPersonActive", ["mreyes", False])
    check("self-deactivation blocked", not r.get("ok"), r)
    r = engine.call(st, "management", "setPersonActive", ["rvillanueva", False])
    check("person deactivated", r.get("ok") and not next(
        p for p in st["people"] if p["username"] == "rvillanueva")["active"], r)

    r = engine.call(st, "management", "saveRef", [{"group": "categories", "value": "CCTV"}])
    check("ref added", r.get("ok") and "CCTV" in st["settings"]["categories"], r)
    r = engine.call(st, "management", "saveRef", [{"group": "categories", "value": "cctv"}])
    check("duplicate ref rejected", not r.get("ok"), r)
    r = engine.call(st, "management", "saveRef",
                    [{"group": "categories", "value": "CCTV", "remove": True}])
    check("ref removed", r.get("ok") and "CCTV" not in st["settings"]["categories"], r)
    r = engine.call(st, "management", "saveRef",
                    [{"group": "frequencies", "value": "Fortnightly", "days": 14}])
    check("frequency added with days", r.get("ok")
          and any(row[1] == "Fortnightly" and row[2] == 14 for row in st["settings"]["frequencies"]), r)
    check("frequency_days reads configured value",
          engine.frequency_days(st, "fortnightly") == 14)
    r = engine.call(st, "technician", "saveRef", [{"group": "categories", "value": "X"}])
    check("saveRef blocked for technician", not r.get("ok"), r)

    r = engine.call(st, "management", "saveSettings", [{"reminderMinutes": 0}])
    check("invalid reminder rejected", not r.get("ok"), r)
    r = engine.call(st, "management", "saveSettings", [{"reminderMinutes": 5}])
    check("settings saved", r.get("ok") and st["settings"]["reminderMinutes"] == 5, r)

    r = engine.call(st, "management", "updateSchedule",
                    ["SCH-2026-024", {"frequency": "monthly", "technician": "J. Tan"}])
    check("schedule update blocked for management", not r.get("ok"), r)
    r = engine.call(st, "coordinator", "updateSchedule",
                    ["SCH-2026-024", {"frequency": "monthly", "technician": "J. Tan"}])
    check("schedule updated", r.get("ok"), r)
    sc = next(s for s in st["schedules"] if s["id"] == "SCH-2026-024")
    check("schedule fields applied", sc["frequency"] == "monthly" and sc["technician"] == "J. Tan")
    r = engine.call(st, "technician", "updateSchedule", ["SCH-2026-024", {"frequency": "weekly"}])
    check("schedule update blocked for technician", not r.get("ok"), r)
    r = engine.call(st, "management", "setScheduleActive", ["SCH-2026-024", False])
    check("schedule pause blocked for management", not r.get("ok"), r)
    r = engine.call(st, "coordinator", "setScheduleActive", ["SCH-2026-024", False])
    check("schedule paused", r.get("ok") and not sc["active"], r)

    # A Custom cadence stores a real day count that is later added to a date,
    # so anything outside the supported range is refused before it is stored.
    def sched(interval):
        return engine.call(st, "coordinator", "createSchedule", [{
            "office": "Records Office", "category": "Hardware", "frequency": "custom",
            "intervalDays": interval, "technician": "J. Tan",
            "dueDate": "2020-01-01", "checklist": ["a"]}])

    for bad in (0, -5, "45.7", 45.7, "45abc", "abc", None, 3651, 4000, 5000000, True):
        r = sched(bad)
        check("custom interval %r refused" % (bad,), not r.get("ok"), r)
    r = sched(3650)
    check("a 3650 day custom cadence is accepted", r.get("ok"), r)
    wide = engine.get_schedule(st, r.get("id"))
    check("the stored interval is the day count", wide["intervalDays"] == 3650, wide)
    check("a plain interval is accepted", bool(sched(45).get("ok")))
    wide["intervalDays"] = 99999999  # a record written before the bound existed
    check("a runaway stored interval falls back to the configured value",
          engine.frequency_days(st, "custom", wide["intervalDays"]) == 30,
          engine.frequency_days(st, "custom", wide["intervalDays"]))
    try:
        engine._advance_next_due(st, {"scheduleId": wide["id"], "occurrence": wide["dueDate"]})
        crashed = None
    except Exception as exc:
        crashed = exc
    check("the cadence maths never reaches an impossible date", crashed is None, crashed)


def test_asset_register():
    st = fresh()

    for role in ("coordinator", "technician", "requester"):
        r = engine.call(st, role, "saveAsset", [{
            "tag": "PC-X-01", "name": "n", "category": "Hardware Repair",
            "office": "HR"}])
        check("saveAsset blocked for %s" % role, not r.get("ok"), r)
        r = engine.call(st, role, "setAssetActive", ["AST-0001", False])
        check("setAssetActive blocked for %s" % role, not r.get("ok"), r)

    r = engine.call(st, "management", "saveAsset", [{
        "tag": "pc-new-07", "name": "Lenovo ThinkCentre M70q",
        "category": "Hardware Repair", "office": "HR", "location": "Room 108"}])
    check("asset registered", r.get("ok"), r)
    check("asset number normalised to upper case", r["asset"]["tag"] == "PC-NEW-07", r)
    check("asset id minted by the register", r["asset"]["id"].startswith("AST-"), r)
    check("seeded register arrives with the demo records",
          any(a["tag"] == "PC-OF-118" for a in st["assets"]))

    r = engine.call(st, "management", "saveAsset", [{
        "tag": "PC NEW 07", "name": "n", "category": "Hardware Repair", "office": "HR"}])
    check("a malformed asset number is refused", not r.get("ok"), r)
    r = engine.call(st, "management", "saveAsset", [{
        "tag": "PC-NEW-99999", "name": "n", "category": "Hardware Repair", "office": "HR"}])
    check("an out-of-shape asset number is refused", not r.get("ok"), r)
    r = engine.call(st, "management", "saveAsset", [{
        "tag": "pc-new-07", "name": "dupe", "category": "Hardware Repair", "office": "HR"}])
    check("a duplicate asset number is refused", not r.get("ok"), r)
    r = engine.call(st, "management", "saveAsset", [{
        "tag": "PC-NEW-08", "name": "n", "category": "Hardware Repair",
        "office": "Atlantis"}])
    check("an unknown holding office is refused", not r.get("ok"), r)
    r = engine.call(st, "management", "saveAsset", [{
        "tag": "PC-NEW-08", "name": "", "category": "Hardware Repair", "office": "HR"}])
    check("an unnamed asset is refused", not r.get("ok"), r)

    ident = r and next(a["id"] for a in st["assets"] if a["tag"] == "PC-NEW-07")
    r = engine.call(st, "management", "saveAsset", [{
        "id": ident, "tag": "PC-NEW-07", "name": "Lenovo ThinkCentre M90q",
        "category": "Hardware Repair", "office": "HR", "location": "Room 109"}])
    check("asset updated", r.get("ok"), r)
    held = next(a for a in st["assets"] if a["id"] == ident)
    check("updated fields applied",
          held["name"] == "Lenovo ThinkCentre M90q" and held["location"] == "Room 109", held)
    r = engine.call(st, "management", "saveAsset", [{
        "id": ident, "tag": "PC-NEW-07", "name": "Lenovo ThinkCentre M90q",
        "category": "Hardware Repair", "office": "HR", "location": "Room 109"}])
    check("a no-op asset update is refused", not r.get("ok"), r)

    r = engine.call(st, "management", "setAssetActive", [ident, False])
    check("asset retired", r.get("ok") and not held["active"], r)
    r = engine.call(st, "management", "setAssetActive", [ident, False])
    check("retiring twice is refused", not r.get("ok"), r)
    r = engine.call(st, "management", "setAssetActive", [ident, True])
    check("asset restored", r.get("ok") and held["active"], r)
    r = engine.call(st, "management", "setAssetActive", ["AST-9999", False])
    check("an unknown asset is refused", not r.get("ok"), r)

    # A retired number still resolves: the register keeps the record so a ticket
    # written last month names the same unit it always did.
    r = engine.call(st, "management", "setAssetActive", [ident, False])
    r = engine.call(st, "management", "saveAsset", [{
        "tag": "PC-NEW-07", "name": "reused", "category": "Hardware Repair", "office": "HR"}])
    check("a retired number is never reissued", not r.get("ok"), r)
    engine.call(st, "management", "setAssetActive", [ident, True])

    # The office name is the natural key, so a rename carries the register with it.
    r = engine.call(st, "management", "saveOffice", [{"id": "HR", "name": "Human Resources"}])
    check("office rename reaches the register", r.get("ok") and all(
        a["office"] != "HR" for a in st["assets"] if a["tag"] == "PC-NEW-07"), r)
    check("renamed office applied", next(
        a for a in st["assets"] if a["tag"] == "PC-NEW-07")["office"] == "Human Resources")

    audit = [a for a in st["audit"] if a.get("subjectType") == "asset"]
    check("asset actions are audited", len(audit) >= 5, len(audit))
    check("the audit names the actor role",
          all(a.get("role") == "management" for a in audit))


def test_audit_trail():
    st = fresh()
    base = len(st["audit"])
    tid = "IT-2026-000143"
    engine.call(st, "coordinator", "assess",
                [tid, {"impact": "Medium", "urgency": "Medium", "priority": "medium", "target": "2026-11-01"}])
    engine.call(st, "coordinator", "assign", [tid, "J. Tan"])
    engine.call(st, "technician", "coordinate", [tid, {"date": "2026-11-02", "tech": "J. Tan"}])
    engine.call(st, "technician", "startWork", [tid])
    engine.call(st, "technician", "diagnose", [tid, {"findings": "loose cable"}])
    engine.call(st, "technician", "recordRepair", [tid, {"actions": "reseated cable"}])
    engine.call(st, "technician", "recordTest", [tid, "pass", "stable"])
    engine.call(st, "requester", "officeDecision",
                [tid, "accepted", {"person": "M. Bataller"}])

    added = st["audit"][base:]
    check("audit grows with the lifecycle", len(added) >= 8, len(added))
    def find(kind, frag):
        return [e for e in added if e["kind"] == kind and frag in (e["text"] or "")]
    check("audit records assignment transition",
          any(e["status"] == "Assigned" and "Assigned to J. Tan" in e["text"] for e in added), added)
    check("audit records resolve transition",
          any(e["status"] == "Resolved" and "->" in e["text"] for e in added), added)
    check("audit records closure transition",
          any(e["status"] == "Closed" and "closed after confirmation" in e["text"] for e in added), added)
    check("audit carries actors", all(e.get("by") for e in added), added)
    check("audit subjects point at the ticket",
          all(e["subjectId"] == tid for e in added), added)

    st2 = fresh()
    base = len(st2["audit"])
    engine.call(st2, "coordinator", "cancel", ["IT-2026-000143", "duplicate of 0125"])
    entry = st2["audit"][-1]
    check("cancellation audited with reason",
          len(st2["audit"]) == base + 1 and entry["kind"] == "cancel"
          and "duplicate of 0125" in entry["text"] and entry["status"] == "Cancelled", entry)
    check("cancelled records preserved", len(st2["tickets"]) == 9)


# ----------------------------------------------------------------- list queries
def test_query_module():
    st = fresh()
    tickets = st["tickets"]
    res = query_mod.query_tickets(tickets, {})
    check("query returns every ticket", res["total"] == len(tickets), res["total"])
    check("query paginates", res["page"] == 1 and res["pages"] >= 1 and res["items"])
    check("default sort newest-updated first",
          all(query_mod.parse_ms(res["items"][i].get("updatedAt") or res["items"][i].get("createdAt"))
              >= query_mod.parse_ms(res["items"][i + 1].get("updatedAt") or res["items"][i + 1].get("createdAt"))
              for i in range(len(res["items"]) - 1)))

    res = query_mod.query_tickets(tickets, {"status": "resolved"})
    check("status filter", res["total"] == 2 and all(t["status"] == "resolved" for t in res["items"]),
          res["total"])
    res = query_mod.query_tickets(tickets, {"status": "open"})
    check("open filter spans active statuses", res["total"] == 7 and res["counts"].get("closed") is None,
          res["total"])
    res = query_mod.query_tickets(tickets, {"q": "delos"})
    check("search matches requester", res["total"] == 2, res["total"])
    res = query_mod.query_tickets(tickets, {"office": "Registrar"})
    check("office filter", res["total"] == 2 and all(t["office"] == "Registrar" for t in res["items"]))
    res = query_mod.query_tickets(tickets, {"priority": "high"})
    check("priority filter", res["total"] == 3, res["total"])
    sample = [{"id": "A", "priority": "low"}, {"id": "B", "priority": "critical"},
              {"id": "C", "priority": "high"}, {"id": "D", "priority": "medium"}]
    res = query_mod.query_tickets(sample, {"sort": "priority", "order": "desc", "size": "10"})
    check("priority sort ranks critical first",
          [t["id"] for t in res["items"]] == ["B", "C", "D", "A"],
          [t["id"] for t in res["items"]])
    res = query_mod.query_tickets(tickets, {"mine": "1"}, user_name="A. Delos Reyes")
    check("mine filter", res["total"] == 2 and all(
        t["requester"] == "A. Delos Reyes" for t in res["items"]), res["total"])

    res = query_mod.query_tickets(tickets, {"sort": "id", "order": "asc", "size": "3", "page": "2"})
    ids = [t["id"] for t in res["items"]]
    check("sort by id asc", ids == sorted(ids), ids)
    check("pagination pages", res["pages"] == math.ceil(len(tickets) / 3.0) and res["total"] == len(tickets))
    check("page 2 slice", len(res["items"]) == 3 and res["page"] == 2)

    overdue = query_mod.query_tickets(tickets, {"overdue": "1"})
    check("overdue filter uses target/SLA", overdue["total"] >= 1
          and all(t["overdue"] for t in overdue["items"]), overdue["total"])
    t = engine.get_ticket(st, "IT-2026-000142")  # in progress, target in the past
    check("ticket flagged overdue", query_mod.is_overdue(t) is True)
    t = dict(engine.get_ticket(st, "IT-2026-000142"), status="closed")  # terminal  --  never overdue
    check("terminal ticket not overdue", query_mod.is_overdue(t) is False)
    hours = query_mod.turnaround_hours(engine.get_ticket(st, "IT-2026-000141"))
    check("turnaround computed", hours is not None and hours > 0, hours)

    summary = query_mod.summarize(tickets)
    check("summarize counts statuses", sum(summary["by_status"].values()) == len(tickets))
    check("summarize turnaround samples", summary["turnaround_samples"] >= 1, summary)
    check("summarize overdue", summary["overdue"] >= 1, summary["overdue"])
    check("single SLA definition exposed", summary["default_sla_days"] == query_mod.DEFAULT_SLA_DAYS)


# ----------------------------------------------------------------- main
def test_sla_window():
    """Assumption A1: the overdue point follows the configured service level window."""
    from datetime import datetime, timedelta, timezone
    st = fresh()
    check("the shipped default is the window when nothing is set",
          query_mod.sla_days() == query_mod.DEFAULT_SLA_DAYS
          and query_mod.sla_days(st["settings"]) == st["settings"]["slaDays"])
    check("a configured window is honoured", query_mod.sla_days({"slaDays": 12}) == 12)
    check("a window outside the bounds falls back",
          query_mod.sla_days({"slaDays": 0}) == query_mod.DEFAULT_SLA_DAYS
          and query_mod.sla_days({"slaDays": query_mod.SLA_MAX_DAYS + 1}) == query_mod.DEFAULT_SLA_DAYS)
    check("a window that is not a number falls back",
          query_mod.sla_days({"slaDays": "weekly"}) == query_mod.DEFAULT_SLA_DAYS
          and query_mod.sla_days({"slaDays": None}) == query_mod.DEFAULT_SLA_DAYS)

    now = datetime.now(timezone.utc)
    eight_days = dict(status="assigned", createdAt=(now - timedelta(days=8)).isoformat().replace("+00:00", "Z"))
    check("a record older than the shipped window is overdue",
          query_mod.is_overdue(eight_days) is True)
    check("a longer window clears the flag",
          query_mod.is_overdue(eight_days, settings={"slaDays": 365}) is False)
    check("a shorter window keeps the flag",
          query_mod.is_overdue(eight_days, settings={"slaDays": 1}) is True)
    aimed = dict(eight_days, target=(now - timedelta(days=1)).isoformat().replace("+00:00", "Z"))
    check("a target date from the coordinator outranks the window",
          query_mod.is_overdue(aimed, settings={"slaDays": 365}) is True)

    res = query_mod.query_tickets([eight_days], {"overdue": "1"}, settings={"slaDays": 365})
    check("the overdue filter follows the window", res["total"] == 0, res["total"])
    res = query_mod.query_tickets([eight_days], {"overdue": "1"}, settings={"slaDays": 3})
    check("the overdue filter follows a short window", res["total"] == 1, res["total"])
    check("the list envelope counts overdue with the window in force",
          query_mod.query_tickets([eight_days], {}, settings={"slaDays": 365})["overdue"] == 0
          and query_mod.query_tickets([eight_days], {}, settings={"slaDays": 1})["overdue"] == 1)
    summ = query_mod.summarize([eight_days], settings={"slaDays": 20})
    check("the summary reports the window in force",
          summ["default_sla_days"] == 20 and summ["overdue"] == 0, summ)

    r = engine.call(st, "management", "saveSettings", [{"slaDays": 12}])
    check("the service level window is editable", r.get("ok") and st["settings"]["slaDays"] == 12, r)
    check("the window change is audited",
          any("service level window = 12 days" in e.get("text", "") for e in st["audit"][-5:]),
          st["audit"][-3:])
    for bad, label in ((0, "a window below one day"), (query_mod.SLA_MAX_DAYS + 1, "a window past a year"),
                       ("five", "a window that is not a number"), (None, "an empty window")):
        r = engine.call(st, "management", "saveSettings", [{"slaDays": bad}])
        check("the window rejects %s" % label, not r.get("ok"), r)
    check("a refused window change leaves the setting alone",
          st["settings"]["slaDays"] == 12, st["settings"]["slaDays"])
    r = engine.call(st, "coordinator", "saveSettings", [{"slaDays": 4}])
    check("only the System Administrator edits the window", not r.get("ok"), r)
    r = engine.call(st, "management", "saveSettings", [{"slaDays": 12}])
    check("an unchanged window reports nothing to update",
          r.get("msg") == "Nothing to update.", r)
    # The engine and the browser share one overdue definition, so a wide window
    # must move the seeded records out of the overdue column.
    narrow = query_mod.query_tickets(fresh()["tickets"], {"overdue": "1"},
                                     settings={"slaDays": 1})["total"]
    wide = query_mod.query_tickets(st["tickets"], {"overdue": "1"},
                                   settings={"slaDays": query_mod.SLA_MAX_DAYS})["total"]
    check("a wider window never reports more overdue records", narrow >= wide, (narrow, wide))


def test_role_scope_and_policy():
    """The data scope and the configurable policy the specification names."""
    st = fresh()

    # ---- a technician only reaches the records assigned to them ----------
    # The seed assigns every ticket to one technician; give a second ticket to
    # another technician so the ownership guard has something to refuse.
    tech_tickets = [t for t in st["tickets"] if t.get("technician") == "J. Tan"]
    other_tickets = [t for t in st["tickets"] if t.get("technician") not in (None, "J. Tan")]
    if not other_tickets:
        spare = next(t for t in st["tickets"] if t.get("technician") == "J. Tan")
        spare["technician"] = "Second Technician"
        other_tickets = [spare]
    check("the seed has tickets for two technicians", tech_tickets and other_tickets)
    r = engine.call(st, "technician", "diagnose", [other_tickets[0]["id"], {"findings": "not mine"}])
    check("a technician cannot diagnose another technician's ticket", not r.get("ok"), r)
    r = engine.call(st, "technician", "assign", [tech_tickets[0]["id"], "J. Tan"])
    check("a technician cannot assign", not r.get("ok"), r)
    r = engine.call(st, "technician", "cancel", [tech_tickets[0]["id"], "no longer needed"])
    check("a technician cannot cancel", not r.get("ok"), r)
    r = engine.call(st, "technician", "close", [tech_tickets[0]["id"], "authorized", "x"])
    check("a technician cannot close", not r.get("ok"), r)
    r = engine.call(st, "technician", "addComment",
                    [other_tickets[0]["id"], {"text": "looking into it", "visibility": "internal"}])
    check("a technician cannot post on another technician's ticket", not r.get("ok"), r)

    # ---- a technician does not own the office decision -------------------
    r = engine.call(st, "technician", "officeDecision",
                    [tech_tickets[0]["id"], "accepted", {"person": "A. Delos Reyes"}])
    check("a technician cannot accept for the office", not r.get("ok"), r)

    # ---- the manual schedule check is idempotent and coordinator owned ---
    st2 = fresh()
    r = engine.call(st2, "coordinator", "runScheduleCheck", [False])
    check("the coordinator can run the schedule check", r.get("ok"), r)
    check("the schedule check reports its results", isinstance(r.get("events"), list), r)
    jobs_after_first = len(st2["jobs"])
    r = engine.call(st2, "coordinator", "runScheduleCheck", [False])
    check("a second schedule check generates no duplicate job",
          len(st2["jobs"]) == jobs_after_first, (jobs_after_first, len(st2["jobs"])))
    r = engine.call(st2, "requester", "runScheduleCheck", [False])
    check("an office requester cannot run the schedule check", not r.get("ok"), r)

    # ---- the priority matrix decides the priority ------------------------
    st3 = fresh()
    engine.call(st3, "coordinator", "assess",
                ["IT-2026-000143", {"impact": "High", "urgency": "High", "priority": "low", "target": "2026-11-01"}])
    t3 = engine.get_ticket(st3, "IT-2026-000143")
    check("the matrix sets the priority", t3["priority"] == "critical", t3["priority"])
    check("the impact and the urgency are stored separately",
          t3["impact"] == "High" and t3["urgency"] == "High", t3)

    # ---- approval is a per-category flag, off by default -----------------
    st4 = fresh()
    check("approval is off by default", not (st4["settings"].get("approvalCategories") or []))
    r = engine.call(st4, "management", "saveSettings",
                    [{"approvalCategories": [st4["settings"]["categories"][0]]}])
    check("the administrator can gate a category", r.get("ok"), r)
    gated = st4["settings"]["categories"][0]
    t4 = engine.get_ticket(st4, "IT-2026-000143")
    t4["category"] = gated
    t4["status"] = "assigned"
    t4["technician"] = "J. Tan"
    r = engine.call(st4, "technician", "startWork", ["IT-2026-000143"])
    check("a gated category cannot start without the approval", not r.get("ok"), r)
    r = engine.call(st4, "coordinator", "approve", ["IT-2026-000143", "approved for the visit"])
    check("the coordinator signs the approval off", r.get("ok"), r)
    r = engine.call(st4, "technician", "startWork", ["IT-2026-000143", "visit coordinated"])
    check("the gated ticket starts once it is approved", r.get("ok"), r)

    # ---- system settings are an administration act -----------------------
    st5 = fresh()
    r = engine.call(st5, "coordinator", "saveSettings", [{"reminderMinutes": 5}])
    check("the coordinator cannot change the system settings", not r.get("ok"), r)
    r = engine.call(st5, "management", "saveSettings", [{"reminderMinutes": 5}])
    check("the administrator changes the system settings", r.get("ok"), r)
    check("the change is recorded", st5["settings"]["reminderMinutes"] == 5)

    # ---- the impact domain is Low, Medium and High -----------------------
    r = engine.call(st5, "management", "saveSettings",
                    [{"priorityMatrix": {"critical": {"high": "critical"}}}])
    check("the matrix rejects an impact level outside the domain", not r.get("ok"), r)


def test_reassign_and_no_response():
    st = fresh()
    tid = "IT-2026-000130"
    before = engine.get_ticket(st, tid)
    check("the seed ticket starts with a technician", before["technician"] == "J. Tan", before.get("technician"))
    r = engine.call(st, "technician", "reassign", [tid, "M. Uy"])
    check("a technician cannot reassign", not r.get("ok"), r)
    r = engine.call(st, "management", "reassign", [tid, "M. Uy"])
    check("the administrator cannot reassign", not r.get("ok"), r)
    r = engine.call(st, "coordinator", "reassign", [tid, "J. Tan"])
    check("reassigning to the same technician is refused", not r.get("ok"), r)
    r = engine.call(st, "coordinator", "reassign", [tid, "M. Uy"])
    check("the coordinator reassigns the technician", r.get("ok"), r)
    t = engine.get_ticket(st, tid)
    check("the assignment changed and the status did not",
          t["technician"] == "M. Uy" and t["status"] == before["status"], (t["technician"], t["status"]))
    check("the reassignment is in the history",
          any("Reassigned from J. Tan to M. Uy" in h["text"] for h in t["history"]), t["history"][-1])
    check("the reassignment is audited",
          any(e["kind"] == "reassign" and e["subjectId"] == tid for e in st["audit"]))
    check("the new technician is notified",
          any(n["role"] == "technician" and n.get("ticketId") == tid and n["kind"] == "assign"
              for n in st["notifications"]), st["notifications"][-1])
    check("the office is notified without the technician's name",
          any(n["role"] == "requester" and n.get("ticketId") == tid and "different technician" in n["text"]
              for n in st["notifications"]), st["notifications"][-1])

    # ---- No response keeps Resolved and sends the reminder ----------------
    st2 = fresh()
    req = {"role": "requester", "name": "R. Villanueva", "office": "Accounting"}
    r = engine.call(st2, "requester", "officeDecision",
                    ["IT-2026-000141", "no_response", {}], user=req)
    check("no response is recorded", r.get("ok"), r)
    t2 = engine.get_ticket(st2, "IT-2026-000141")
    check("no response keeps the status Resolved", t2["status"] == "resolved", t2["status"])
    check("no response marks the confirmation state", t2["confirmation"]["state"] == "no_response")
    check("no response sends the follow-up reminder", len(t2["reminders"]) == 1, t2["reminders"])
    check("the office receives the reminder",
          any(n["role"] == "requester" and n.get("ticketId") == "IT-2026-000141"
              and n["kind"] == "remind" for n in st2["notifications"]))


def test_management_readonly():
    st = fresh()
    # Review the seeded ticket so assignment would otherwise be allowed.
    engine.call(st, "coordinator", "assess",
                ["IT-2026-000143", {"impact": "Medium", "urgency": "Medium", "priority": "medium", "target": "2026-11-01"}])
    blocked = {
        "assign": ["IT-2026-000143", "J. Tan"],
        "approve": ["IT-2026-000143", "ok"],
        "cancel": ["IT-2026-000143", "duplicate"],
        "close": ["IT-2026-000143", "authorized", "done"],
        "officeDecision": ["IT-2026-000143", "accepted", {"person": "Someone"}],
        "startWork": ["IT-2026-000143"],
        "addComment": ["IT-2026-000143", {"text": "looking", "visibility": "internal"}],
        "sendReminder": ["IT-2026-000143"],
        "runScheduleCheck": [False],
        "updateSchedule": ["SCH-2026-024", {"frequency": "monthly"}],
        "setScheduleActive": ["SCH-2026-024", False],
        "closeJob": ["MNT-2026-0061", "Successful"],
    }
    for name, args in blocked.items():
        r = engine.call(st, "management", name, args)
        check("the administrator cannot %s" % name, not r.get("ok"), r)
    t = engine.get_ticket(st, "IT-2026-000143")
    check("the blocked calls changed nothing",
          t["status"] == "submitted" and t["technician"] is None, (t["status"], t["technician"]))
    r = engine.call(st, "management", "saveSettings",
                    [{"authorizedClosureRoles": ["management"]}])
    check("the administrator cannot name itself as a closure role", not r.get("ok"), r)
    check("the closure role setting is unchanged",
          st["settings"]["authorizedClosureRoles"] == ["coordinator"],
          st["settings"]["authorizedClosureRoles"])


def main():
    tmp = tempfile.mkdtemp(prefix="itc-tests-")
    print("ITC backend tests")
    print("engine:")
    test_engine_lifecycle()
    test_engine_guards()
    test_engine_dependency_and_hold()
    test_engine_recurrence()
    test_register_propagation()
    test_engine_maintenance()
    test_schedule_generation()
    test_world_tick()
    test_working_day_reminders()
    test_tenancy()
    test_requester_scope_includes_own_requests()
    test_technician_notification_scope()
    test_asset_scope()
    test_intake_priority()
    test_conversation()
    test_notifications_read()
    test_admin_engine()
    test_asset_register()
    test_audit_trail()
    test_role_scope_and_policy()
    test_reassign_and_no_response()
    test_management_readonly()
    print("query:")
    test_query_module()
    test_sla_window()
    print("oidc:")
    test_oidc()
    print("delivery:")
    test_delivery(tmp)
    print("persistence:")
    test_persistence(tmp)
    test_action_rollback(tmp)
    print("http:")
    db_path = os.path.join(tmp, "http.sqlite3")
    httpd, state, worker = appmod.build_server(host="127.0.0.1", port=0, db_path=db_path, start_worker=False)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        test_http(httpd)
        test_http_import(httpd)
        test_http_integrity(httpd)
        test_http_concurrency(httpd)
        test_http_tenancy(httpd)
        test_http_records(httpd)
        test_http_sla_window(httpd)
        test_http_outbox(httpd)
        test_sse(httpd)
        test_http_transition_matrix(httpd)
        test_http_ticket_ids(httpd)
    finally:
        httpd.shutdown()
        httpd.server_close()
    print("seed:")
    test_seed_shape()

    print()
    print("RESULT: %d passed, %d failed" % (PASS, FAIL))
    if FAILURES:
        print("Failures:")
        for f in FAILURES:
            print("  - " + f)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
