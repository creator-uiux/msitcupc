"""Canonical seed data  --  a faithful port of js/store.js `seed()`.

Relative dates are computed from the current time at seed time, exactly like the
browser does, so the demo dataset looks "live" on first run.
"""
from datetime import datetime, timedelta, timezone

from db import DEFAULT_REF

V = 4


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def seed():
    base = datetime.now(timezone.utc)

    def now():
        return _iso(base)

    def days(n):
        return _iso(base + timedelta(days=n))

    def hours(n):
        return _iso(base + timedelta(hours=n))

    def t(o):
        o.setdefault("createdAt", now())
        o.setdefault("updatedAt", o["createdAt"])
        o.setdefault("history", [])
        o.setdefault("tests", [])
        o.setdefault("comments", [])
        o.setdefault("withdrawal", None)
        o.setdefault("reminders", [])
        o.setdefault("diagnosis", {"findings": "", "actions": "", "parts": "", "cost": 0, "labor": 0, "dates": "", "evidence": []})
        o.setdefault("confirmation", {"state": "none", "person": "", "date": None, "feedback": ""})
        o.setdefault("dependency", None)
        o.setdefault("linkedTo", None)
        o["cancelReason"] = None
        o["closure"] = None
        o["authorizedReason"] = ""
        o["recurring"] = False
        o["reviewed"] = False
        return o

    out = {
        "v": V, "rev": 1, "updatedAt": now(),
        "seq": {"ticket": 144, "sched": 33, "job": 62, "notif": 40, "hist": 500},
        "role": "coordinator", "lastSim": 0,
        "settings": dict(
            {"reminderMinutes": 2, "reminderMode": "business", "tickMs": 9000,
             "simulate": False, "slaDays": 5, "reminderBusinessDays": 3,
             "reminderRepeatDays": 7, "timezone": "Asia/Manila",
             "maxUploadBytes": 10 * 1024 * 1024,
             "authorizedClosureRoles": ["coordinator", "management"],
             "approvalCategories": [],
             "priorityMatrix": {
                 "high": {"high": "critical", "medium": "high", "low": "medium"},
                 "medium": {"high": "high", "medium": "medium", "low": "low"},
                 "low": {"high": "medium", "medium": "low", "low": "low"},
             },
             "roleActions": {}},
            **{k: [list(row) if isinstance(row, list) else row for row in v]
               for k, v in DEFAULT_REF.items()}),
        "offices": [
            {"name": "IT Office", "code": "IT", "location": "Admin Building, Room 101",
             "contactPerson": "K. Ramos", "contactEmail": "k.ramos@upcebu.edu.ph",
             "contactPhone": "+63 917 000 0002", "active": True,
             "createdAt": days(-40), "updatedAt": days(-40)},
            {"name": "Records Office", "code": "REC", "location": "Records Bldg, Room 2",
             "contactPerson": "A. Delos Reyes", "contactEmail": "a.delosreyes@upcebu.edu.ph",
             "contactPhone": "+63 917 000 0001", "active": True,
             "createdAt": days(-40), "updatedAt": days(-40)},
            {"name": "Accounting", "code": "ACC", "location": "Admin Building, Room 105",
             "contactPerson": "R. Villanueva", "contactEmail": "r.villanueva@upcebu.edu.ph",
             "contactPhone": "", "active": True, "createdAt": days(-40), "updatedAt": days(-40)},
            {"name": "Registrar", "code": "REG", "location": "Registrar Bldg, Ground Floor",
             "contactPerson": "P. Ocampo", "contactEmail": "p.ocampo@upcebu.edu.ph",
             "contactPhone": "", "active": True, "createdAt": days(-40), "updatedAt": days(-40)},
            {"name": "HR", "code": "HR", "location": "Admin Building, Room 108",
             "contactPerson": "L. Sarmiento", "contactEmail": "l.sarmiento@upcebu.edu.ph",
             "contactPhone": "", "active": True, "createdAt": days(-40), "updatedAt": days(-40)},
            {"name": "Library", "code": "LIB", "location": "Library Bldg, 2nd Floor",
             "contactPerson": "M. Bataller", "contactEmail": "m.bataller@upcebu.edu.ph",
             "contactPhone": "", "active": True, "createdAt": days(-40), "updatedAt": days(-40)},
            {"name": "SDG", "code": "SDG", "location": "Research Annex, Room 3",
             "contactPerson": "C. Yap", "contactEmail": "c.yap@upcebu.edu.ph",
             "contactPhone": "", "active": True, "createdAt": days(-40), "updatedAt": days(-40)},
            {"name": "Office of the Director", "code": "DIR", "location": "Admin Building, Room 201",
             "contactPerson": "M. Reyes", "contactEmail": "m.reyes@upcebu.edu.ph",
             "contactPhone": "+63 917 000 0004", "active": True,
             "createdAt": days(-40), "updatedAt": days(-40)},
        ],
        "people": [
            {"username": "areyes", "name": "A. Delos Reyes", "role": "requester",
             "office": "Records Office", "email": "a.delosreyes@upcebu.edu.ph",
             "phone": "+63 917 000 0001", "active": True, "prefs": {}},
            {"username": "kramos", "name": "K. Ramos", "role": "coordinator",
             "office": "IT Office", "email": "k.ramos@upcebu.edu.ph",
             "phone": "+63 917 000 0002", "active": True, "prefs": {}},
            {"username": "jtan", "name": "J. Tan", "role": "technician",
             "office": "IT Office", "email": "j.tan@upcebu.edu.ph",
             "phone": "+63 917 000 0003", "active": True, "prefs": {}},
            {"username": "mreyes", "name": "M. Reyes", "role": "management",
             "office": "Office of the Director", "email": "m.reyes@upcebu.edu.ph",
             "phone": "+63 917 000 0004", "active": True, "prefs": {}},
            {"username": "muy", "name": "M. Uy", "role": "technician",
             "office": "IT Office", "email": "m.uy@upcebu.edu.ph",
             "phone": "", "active": True, "prefs": {}},
            {"username": "rvillanueva", "name": "R. Villanueva", "role": "requester",
             "office": "Accounting", "email": "r.villanueva@upcebu.edu.ph",
             "phone": "", "active": True, "prefs": {}},
            {"username": "pocampo", "name": "P. Ocampo", "role": "requester",
             "office": "Registrar", "email": "p.ocampo@upcebu.edu.ph",
             "phone": "", "active": True, "prefs": {}},
            {"username": "mbataller", "name": "M. Bataller", "role": "requester",
             "office": "Library", "email": "m.bataller@upcebu.edu.ph",
             "phone": "", "active": True, "prefs": {}},
            {"username": "lsarmiento", "name": "L. Sarmiento", "role": "requester",
             "office": "HR", "email": "l.sarmiento@upcebu.edu.ph",
             "phone": "", "active": True, "prefs": {}},
            {"username": "cyap", "name": "C. Yap", "role": "requester",
             "office": "SDG", "email": "c.yap@upcebu.edu.ph",
             "phone": "", "active": True, "prefs": {}},
        ],
        "files": [
            {"id": "att-seed-1", "ticketId": "IT-2026-000142", "jobId": None,
             "name": "event-viewer.txt", "mime": "text/plain", "size": 512,
             "by": "A. Delos Reyes", "at": days(-3)},
        ],
        "tickets": [
            t({
                "id": "IT-2026-000143", "office": "Library", "requester": "M. Bataller", "category": "Network and Connectivity",
                "source": "email", "issue": "Wi-Fi drops every few minutes in the periodicals section.",
                "asset": "AP-LIB-04", "attachments": ["wifi-log.txt"], "status": "submitted",
                "impact": None, "urgency": None, "priority": "medium", "target": None, "technician": None,
                "createdAt": days(-0.2),
                "comments": [
                    {"id": "IT-2026-000143-C01", "at": days(-0.15), "by": "M. Bataller",
                     "role": "requester", "visibility": "public",
                     "text": "The drop happens mostly near the periodicals shelves  --  AP-LIB-04 area.",
                     "attachments": []},
                ],
                "history": [{"at": days(-0.2), "by": "M. Bataller", "role": "requester", "status": "submitted", "kind": "status", "text": "Request recorded  --  Status: Submitted."}],
            }),
            t({
                "id": "IT-2026-000137", "office": "Accounting", "requester": "R. Villanueva", "category": "Account Assistance",
                "source": "telephone", "issue": "Payroll module will not open after the update.",
                "asset": "", "attachments": [], "status": "needs_info",
                "impact": "High", "urgency": "Medium", "priority": "high", "target": days(3), "technician": None,
                "createdAt": days(-1.1),
                "history": [
                    {"at": days(-1.1), "by": "R. Villanueva", "role": "requester", "status": "submitted", "kind": "status", "text": "Request recorded  --  Status: Submitted."},
                    {"at": days(-1.0), "by": "K. Ramos", "role": "coordinator", "status": "needs_info", "kind": "status", "text": "Details incomplete  --  requested: exact error message and machine number."},
                ],
            }),
            t({
                "id": "IT-2026-000130", "office": "Registrar", "requester": "P. Ocampo", "category": "Printer and Peripheral",
                "source": "walk-in", "issue": "Grade printing jams on the second tray.",
                "asset": "PRN-REG-02", "attachments": ["jam-photo.jpg"], "status": "assigned",
                "impact": "Medium", "urgency": "Medium", "priority": "medium", "target": days(4), "technician": "J. Tan",
                "createdAt": days(-2), "reviewed": True,
                "history": [
                    {"at": days(-2), "by": "P. Ocampo", "role": "requester", "status": "submitted", "kind": "status", "text": "Request recorded  --  Status: Submitted."},
                    {"at": days(-1.8), "by": "K. Ramos", "role": "coordinator", "status": "submitted", "kind": "note", "text": "Review: details complete. Impact Medium, Urgency Medium."},
                    {"at": days(-1.7), "by": "K. Ramos", "role": "coordinator", "status": "assigned", "kind": "status", "text": "Assigned to J. Tan  --  Status: Assigned. Technician and requester notified."},
                ],
            }),
            t({
                "id": "IT-2026-000142", "office": "Records Office", "requester": "A. Delos Reyes", "category": "Hardware Repair",
                "source": "telephone", "issue": "PC-OF-118 shuts down randomly during encoding.",
                "asset": "PC-OF-118", "attachments": ["event-viewer.txt"], "status": "in_progress",
                "impact": "High", "urgency": "High", "priority": "high", "target": days(-1), "technician": "J. Tan",
                "createdAt": days(-3), "reviewed": True,
                "diagnosis": {"findings": "PSU fan seized; unit overheats under load.", "actions": "Cleaned chassis, tested with bench PSU", "parts": "ATX 600W PSU (to replace)", "cost": 1850, "labor": 1.5, "dates": "Oct 7, 2026", "evidence": ["psu-photo.jpg"]},
                "comments": [
                    {"id": "IT-2026-000142-C01", "at": days(-2.5), "by": "A. Delos Reyes",
                     "role": "requester", "visibility": "public",
                     "text": "Please do the repair after 2 PM  --  the unit is used for encoding in the morning.",
                     "attachments": []},
                    {"id": "IT-2026-000142-C02", "at": days(-0.4), "by": "J. Tan",
                     "role": "technician", "visibility": "internal",
                     "text": "ATX PSU already in stock in the IT store  --  no need to order.",
                     "attachments": []},
                ],
                "history": [
                    {"at": days(-3), "by": "A. Delos Reyes", "role": "requester", "status": "submitted", "kind": "status", "text": "Request recorded  --  Status: Submitted."},
                    {"at": days(-2.9), "by": "K. Ramos", "role": "coordinator", "status": "assigned", "kind": "status", "text": "Assessed High/High, priority high, target " + days(1)[:10] + ". Assigned to J. Tan."},
                    {"at": days(-2.8), "by": "J. Tan", "role": "technician", "status": "in_progress", "kind": "status", "text": "Work started  --  Status: In Progress."},
                    {"at": days(-0.5), "by": "J. Tan", "role": "technician", "status": "in_progress", "kind": "note", "text": "Diagnosis recorded: PSU fan seized; replacement required."},
                ],
            }),
            t({
                "id": "IT-2026-000139", "office": "HR", "requester": "L. Sarmiento", "category": "Software Support",
                "source": "on-site", "issue": "Performance evaluation spreadsheet throws #REF errors.",
                "asset": "", "attachments": ["perf-eval.xlsx"], "status": "on_hold",
                "impact": "Medium", "urgency": "Medium", "priority": "medium", "target": days(5), "technician": "J. Tan",
                "createdAt": days(-4), "reviewed": True,
                "diagnosis": {"findings": "Sheet references external workbook on a decommissioned share.",
                              "actions": "Rebuilt two named ranges; remaining vendor template pending",
                              "parts": "", "cost": 0, "labor": 0.5, "dates": "Oct 6, 2026", "evidence": []},
                "dependency": {
                    "reason": "Vendor template file required from HR head.",
                    "responsible": "HR Director",
                    "nextAction": "Procurement to request template from vendor",
                    "state": "pending", "dueAt": hours(-1),
                    "updates": [{"at": days(-3.5), "text": "Chased vendor  --  promised delivery end of week."}],
                },
                "history": [
                    {"at": days(-4), "by": "L. Sarmiento", "role": "requester", "status": "submitted", "kind": "status", "text": "Request recorded  --  Status: Submitted."},
                    {"at": days(-3.9), "by": "K. Ramos", "role": "coordinator", "status": "assigned", "kind": "status", "text": "Assigned to J. Tan  --  Status: Assigned."},
                    {"at": days(-3.8), "by": "J. Tan", "role": "technician", "status": "in_progress", "kind": "status", "text": "Work started  --  Status: In Progress."},
                    {"at": days(-3.5), "by": "J. Tan", "role": "technician", "status": "on_hold", "kind": "dep", "text": "On hold  --  dependency: vendor template. Responsible: HR Director."},
                ],
            }),
            t({
                "id": "IT-2026-000141", "office": "Accounting", "requester": "R. Villanueva", "category": "Hardware Repair",
                "source": "email", "issue": "Second monitor flickers on the teller station.",
                "asset": "MON-ACC-11", "attachments": [], "status": "resolved",
                "impact": "Medium", "urgency": "Low", "priority": "low", "target": days(2), "technician": "J. Tan",
                "createdAt": days(-2.5), "reviewed": True, "resolvedAt": hours(-3),
                "confirmation": {"state": "pending", "person": "", "date": None, "feedback": ""},
                "diagnosis": {"findings": "Failing HDMI cable and loose VESA mount.", "actions": "Replaced cable, reseated mount", "parts": "HDMI cable 2m", "cost": 180, "labor": 0.5, "dates": "Oct 8, 2026", "evidence": ["after-test.jpg"]},
                "tests": [{"at": hours(-3), "by": "J. Tan", "result": "pass", "note": "30-minute burn-in, no flicker."}],
                "comments": [
                    {"id": "IT-2026-000141-C01", "at": hours(-2), "by": "K. Ramos",
                     "role": "coordinator", "visibility": "public",
                     "text": "Service done and tested  --  please confirm the result so we can close the ticket.",
                     "attachments": []},
                ],
                "history": [
                    {"at": days(-2.5), "by": "R. Villanueva", "role": "requester", "status": "submitted", "kind": "status", "text": "Request recorded  --  Status: Submitted."},
                    {"at": days(-2.4), "by": "K. Ramos", "role": "coordinator", "status": "assigned", "kind": "status", "text": "Assigned to J. Tan  --  Status: Assigned."},
                    {"at": days(-2.3), "by": "J. Tan", "role": "technician", "status": "in_progress", "kind": "status", "text": "Work started  --  Status: In Progress."},
                    {"at": hours(-3), "by": "J. Tan", "role": "technician", "status": "resolved", "kind": "test", "text": "Test passed  --  Status: Resolved. Office notified, ready for confirmation."},
                ],
            }),
            t({
                "id": "IT-2026-000134", "office": "Registrar", "requester": "P. Ocampo", "category": "Network and Connectivity",
                "source": "telephone", "issue": "Enrollment portal very slow during peak hours.",
                "asset": "", "attachments": [], "status": "resolved",
                "impact": "High", "urgency": "Medium", "priority": "high", "target": days(-1), "technician": "J. Tan",
                "createdAt": days(-6), "resolvedAt": days(-4),
                "confirmation": {"state": "pending", "person": "", "date": None, "feedback": ""},
                "diagnosis": {"findings": "Uplink saturated by unmanaged switch in Room 204.",
                              "actions": "Re-segmented VLAN, capped rogue AP",
                              "parts": "", "cost": 0, "labor": 2, "dates": "Oct 4, 2026", "evidence": []},
                "tests": [{"at": days(-4), "by": "J. Tan", "result": "pass", "note": "Throughput restored to 90 Mbps."}],
                "history": [
                    {"at": days(-6), "by": "P. Ocampo", "role": "requester", "status": "submitted", "kind": "status", "text": "Request recorded  --  Status: Submitted."},
                    {"at": days(-5.9), "by": "K. Ramos", "role": "coordinator", "status": "assigned", "kind": "status", "text": "Assigned to J. Tan  --  Status: Assigned."},
                    {"at": days(-5.8), "by": "J. Tan", "role": "technician", "status": "in_progress", "kind": "status", "text": "Work started  --  Status: In Progress."},
                    {"at": days(-4), "by": "J. Tan", "role": "technician", "status": "resolved", "kind": "test", "text": "Test passed  --  Status: Resolved. Office notified, ready for confirmation."},
                ],
            }),
            t({
                "id": "IT-2026-000128", "office": "SDG", "requester": "C. Yap", "category": "Other",
                "source": "email", "issue": "Request for extra monitor  --  later withdrawn, supplied in-house.",
                "asset": "", "attachments": [], "status": "cancelled",
                "impact": "Low", "urgency": "Low", "priority": "low", "target": days(-3), "technician": "J. Tan",
                "createdAt": days(-7),
                "history": [
                    {"at": days(-7), "by": "C. Yap", "role": "requester", "status": "submitted", "kind": "status", "text": "Request recorded  --  Status: Submitted."},
                    {"at": days(-6.9), "by": "K. Ramos", "role": "coordinator", "status": "assigned", "kind": "status", "text": "Assigned to J. Tan."},
                    {"at": days(-6.4), "by": "K. Ramos", "role": "coordinator", "status": "cancelled", "kind": "cancel", "text": "Active request withdrawn  --  Status: Cancelled. Reason recorded. Requester notified; records preserved."},
                ],
            }),
            t({
                "id": "IT-2026-000125", "office": "Records Office", "requester": "A. Delos Reyes", "category": "Hardware Repair",
                "source": "telephone", "issue": "PC-OF-118 thermal shutdowns  --  first occurrence.",
                "asset": "PC-OF-118", "attachments": [], "status": "closed",
                "impact": "Medium", "urgency": "Medium", "priority": "medium", "target": days(-8), "technician": "J. Tan",
                "createdAt": days(-12), "resolvedAt": days(-10), "closedAt": days(-9),
                "confirmation": {"state": "accepted", "person": "A. Delos Reyes", "date": days(-9), "feedback": "Working for two days straight."},
                "diagnosis": {"findings": "Dust buildup; cleaned and reseated heatsink.",
                              "actions": "Cleaned, reapplied thermal paste",
                              "parts": "", "cost": 0, "labor": 1, "dates": "Sep 26, 2026", "evidence": []},
                "tests": [{"at": days(-10), "by": "J. Tan", "result": "pass", "note": "2-hour load test stable."}],
                "history": [
                    {"at": days(-12), "by": "A. Delos Reyes", "role": "requester", "status": "submitted", "kind": "status", "text": "Request recorded  --  Status: Submitted."},
                    {"at": days(-11.8), "by": "K. Ramos", "role": "coordinator", "status": "assigned", "kind": "status", "text": "Assigned to J. Tan."},
                    {"at": days(-11.7), "by": "J. Tan", "role": "technician", "status": "in_progress", "kind": "status", "text": "Work started  --  Status: In Progress."},
                    {"at": days(-10), "by": "J. Tan", "role": "technician", "status": "resolved", "kind": "test", "text": "Test passed  --  Status: Resolved. Office notified."},
                    {"at": days(-9), "by": "A. Delos Reyes", "role": "requester", "status": "resolved", "kind": "confirm", "text": "Office accepted the service result  --  confirmation recorded."},
                    {"at": days(-9), "by": "K. Ramos", "role": "coordinator", "status": "closed", "kind": "status", "text": "Status: Closed after confirmation. Office service history and reporting updated."},
                ],
            }),
        ],
        "schedules": [
            {"id": "SCH-2026-024", "office": "Records Office", "assets": ["PC-OF-118", "PC-OF-119"], "category": "Hardware Repair",
             "checklist": ["Inspect internal dust", "Check PSU and voltages", "Verify storage health", "Update OS and antivirus", "Log asset condition"],
             "frequency": "quarterly", "dueDate": days(0.05), "technician": "J. Tan", "active": True, "lastCheck": None, "nextCheck": days(0.05)},
            {"id": "SCH-2026-018", "office": "HR", "assets": ["UPS-HR-01"], "category": "Hardware Repair",
             "checklist": ["Battery self-test", "Load test", "Replace batteries if below 70%", "Record runtime"],
             "frequency": "monthly", "dueDate": days(-0.01), "technician": "M. Uy", "active": True, "lastCheck": None, "nextCheck": days(-0.01)},
            {"id": "SCH-2026-031", "office": "Accounting", "assets": ["PRN-ACC-01"], "category": "Printer and Peripheral",
             "checklist": ["Clean rollers", "Align printhead", "Firmware check", "Test print"],
             "frequency": "monthly", "dueDate": days(0.1), "technician": "M. Uy", "active": True, "lastCheck": days(-4), "nextCheck": days(0.1)},
            {"id": "SCH-2026-035", "office": "SDG", "assets": ["PC-SDG-02"], "category": "Hardware Repair",
             "checklist": ["Dust inspection", "RAM diagnostics", "OS patch level", "Backup verification"],
             "frequency": "monthly", "dueDate": days(-0.2), "technician": "M. Uy", "active": True, "lastCheck": days(-0.1), "nextCheck": days(-0.2)},
            {"id": "SCH-2026-012", "office": "Library", "assets": ["AP-LIB-01", "AP-LIB-02"], "category": "Network and Connectivity",
             "checklist": ["Firmware update", "Channel survey", "Verify coverage", "Check cabling"],
             "frequency": "quarterly", "dueDate": days(46), "technician": "J. Tan", "active": True, "lastCheck": days(-44), "nextCheck": days(46)},
            {"id": "SCH-2026-027", "office": "Records Office", "assets": ["AP-OF-01"], "category": "Network and Connectivity",
             "checklist": ["Firmware update", "Channel survey", "Verify coverage"],
             "frequency": "semiannual", "dueDate": days(-0.4), "technician": "J. Tan", "active": True, "lastCheck": days(-0.5), "nextCheck": days(-0.4)},
            {"id": "SCH-2026-033", "office": "Records Office", "assets": ["PC-OF-119"], "category": "Hardware Repair",
             "checklist": ["Inspect internal dust", "Check PSU and voltages", "Verify storage health"],
             "frequency": "quarterly", "dueDate": days(20), "technician": "J. Tan", "active": True,
             "lastCheck": days(-1), "nextCheck": days(20)},
        ],
        "jobs": [
            {"id": "MNT-2026-0061", "scheduleId": "SCH-2026-024", "occurrence": "seed-024", "office": "Records Office",
             "assets": ["PC-OF-118", "PC-OF-119"], "technician": "J. Tan", "category": "Hardware Repair",
             "checklist": ["Inspect internal dust", "Check PSU and voltages", "Verify storage health", "Update OS and antivirus", "Log asset condition"],
             "items": [
                 {"task": "Inspect internal dust", "done": True, "result": "Passed", "finding": "Heavy dust on PSU intake", "tech": "J. Tan", "date": days(-0.1), "evidence": ["dust-024.jpg"]},
                 {"task": "Check PSU and voltages", "done": True, "result": "Attention needed", "finding": "PSU fan noise on PC-OF-118", "tech": "J. Tan", "date": days(-0.1), "evidence": []},
                 {"task": "Verify storage health", "done": True, "result": "Passed", "finding": "SMART all green", "tech": "J. Tan", "date": days(-0.1), "evidence": []},
                 {"task": "Update OS and antivirus", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
                 {"task": "Log asset condition", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
             ],
             "status": "in_progress", "availability": "yes", "visitDate": days(-0.1), "reschedules": [],
             "additionalFault": "unknown", "linkedTicketId": None, "outcome": None,
             "confirmation": {"state": "none", "person": "", "date": None}, "nextDue": None, "createdAt": days(-0.5)},
            {"id": "MNT-2026-0057", "scheduleId": "SCH-2026-033", "occurrence": "seed-033",
             "office": "Records Office", "assets": ["PC-OF-119"], "technician": "J. Tan",
             "category": "Hardware Repair",
             "checklist": ["Inspect internal dust", "Check PSU and voltages", "Verify storage health"],
             "items": [
                 {"task": "Inspect internal dust", "done": True, "result": "Passed", "finding": "", "tech": "J. Tan", "date": days(-1), "evidence": []},
                 {"task": "Check PSU and voltages", "done": True, "result": "Passed", "finding": "", "tech": "J. Tan", "date": days(-1), "evidence": []},
                 {"task": "Verify storage health", "done": True, "result": "Passed", "finding": "SMART all green", "tech": "J. Tan", "date": days(-1), "evidence": []},
             ],
             "status": "resolved", "availability": "yes", "visitDate": days(-1), "reschedules": [],
             "additionalFault": "no", "linkedTicketId": None, "outcome": None,
             "workComplete": True,
             "confirmation": {"state": "pending", "person": "", "date": None}, "nextDue": None, "createdAt": days(-2)},
            {"id": "MNT-2026-0058", "scheduleId": "SCH-2026-031", "occurrence": "seed-031", "office": "Accounting",
             "assets": ["PRN-ACC-01"], "technician": "M. Uy", "category": "Printer and Peripheral",
             "checklist": ["Clean rollers", "Align printhead", "Firmware check", "Test print"],
             "items": [
                 {"task": "Clean rollers", "done": True, "result": "Passed", "finding": "", "tech": "M. Uy", "date": days(-4), "evidence": []},
                 {"task": "Align printhead", "done": True, "result": "Passed", "finding": "", "tech": "M. Uy", "date": days(-4), "evidence": []},
                 {"task": "Firmware check", "done": True, "result": "Passed", "finding": "Updated to 4.2.1", "tech": "M. Uy", "date": days(-4), "evidence": []},
                 {"task": "Test print", "done": True, "result": "Passed", "finding": "", "tech": "M. Uy", "date": days(-4), "evidence": []},
             ],
             "status": "closed", "availability": "yes", "visitDate": days(-4), "reschedules": [],
             "additionalFault": "no", "linkedTicketId": None, "outcome": "success",
             "workComplete": True, "closedAt": days(-3),
             "confirmation": {"state": "accepted", "person": "R. Villanueva", "date": days(-3)},
             "nextDue": None, "createdAt": days(-5)},
            {"id": "MNT-2026-0060", "scheduleId": "SCH-2026-035", "occurrence": "seed-035", "office": "SDG",
             "assets": ["PC-SDG-02"], "technician": "M. Uy", "category": "Hardware Repair",
             "checklist": ["Dust inspection", "RAM diagnostics", "OS patch level", "Backup verification"],
             "items": [
                 {"task": "Dust inspection", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
                 {"task": "RAM diagnostics", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
                 {"task": "OS patch level", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
                 {"task": "Backup verification", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
             ],
             "status": "assigned", "availability": "yes", "visitDate": days(-0.1), "reschedules": [],
             "additionalFault": "unknown", "linkedTicketId": None, "outcome": None,
             "confirmation": {"state": "none", "person": "", "date": None}, "nextDue": None, "createdAt": days(-0.2)},
            {"id": "MNT-2026-0059", "scheduleId": "SCH-2026-012", "occurrence": "seed-012", "office": "Library",
             "assets": ["AP-LIB-01", "AP-LIB-02"], "technician": "J. Tan", "category": "Network and Connectivity",
             "checklist": ["Firmware update", "Channel survey", "Verify coverage", "Check cabling"],
             "items": [
                 {"task": "Firmware update", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
                 {"task": "Channel survey", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
                 {"task": "Verify coverage", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
                 {"task": "Check cabling", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
             ],
             "status": "on_hold", "availability": "no", "visitDate": hours(-1),
             "reschedules": [{"from": days(-3), "to": hours(-1), "reason": "Library examination week  --  office unavailable", "at": days(-3)}],
             "additionalFault": "unknown", "linkedTicketId": None, "outcome": None,
             "confirmation": {"state": "none", "person": "", "date": None}, "nextDue": None, "createdAt": days(-3)},
            {"id": "MNT-2026-0062", "scheduleId": "SCH-2026-027", "occurrence": "seed-027", "office": "Records Office",
             "assets": ["AP-OF-01"], "technician": "J. Tan", "category": "Network and Connectivity",
             "checklist": ["Firmware update", "Channel survey", "Verify coverage"],
             "items": [
                 {"task": "Firmware update", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
                 {"task": "Channel survey", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
                 {"task": "Verify coverage", "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []},
             ],
             "status": "submitted", "availability": None, "visitDate": None, "reschedules": [],
             "additionalFault": "unknown", "linkedTicketId": None, "outcome": None,
             "confirmation": {"state": "none", "person": "", "date": None}, "nextDue": None, "createdAt": days(-0.4)},
        ],
        "notifications": [
            {"id": 40, "at": hours(-3), "role": "requester", "office": "Accounting", "kind": "confirm", "ticketId": "IT-2026-000141", "text": "IT-2026-000141 is Resolved  --  ready for your confirmation.", "read": False},
            {"id": 39, "at": hours(-3), "role": "coordinator", "kind": "confirm", "ticketId": "IT-2026-000141", "text": "IT-2026-000141 resolved by J. Tan  --  awaiting office confirmation.", "read": False},
            {"id": 38, "at": days(-0.1), "role": "technician", "kind": "job", "ticketId": None, "jobId": "MNT-2026-0061", "text": "MNT-2026-0061 generated from SCH-2026-024  --  visit coordinated.", "read": False},
            {"id": 37, "at": hours(-1), "role": "coordinator", "kind": "dep", "ticketId": "IT-2026-000139", "text": "Dependency follow-up due for IT-2026-000139 (HR vendor template).", "read": False},
        ],
        "audit": [
            {"at": days(-12), "by": "A. Delos Reyes", "role": "requester",
             "subjectType": "ticket", "subjectId": "IT-2026-000125", "status": "Submitted",
             "kind": "create", "text": "Ticket recorded for A. Delos Reyes (Records Office)  --  Status: Submitted."},
            {"at": days(-11.8), "by": "K. Ramos", "role": "coordinator",
             "subjectType": "ticket", "subjectId": "IT-2026-000125", "status": "Assigned",
             "kind": "status", "text": "Submitted -> Assigned: Assigned to J. Tan."},
            {"at": days(-10), "by": "J. Tan", "role": "technician",
             "subjectType": "ticket", "subjectId": "IT-2026-000125", "status": "Resolved",
             "kind": "test", "text": "In Progress -> Resolved: Service passed testing  --  office confirmation requested."},
            {"at": days(-9), "by": "K. Ramos", "role": "coordinator",
             "subjectType": "ticket", "subjectId": "IT-2026-000125", "status": "Closed",
             "kind": "status", "text": "Resolved -> Closed: Closed after office confirmation."},
            {"at": days(-6.4), "by": "K. Ramos", "role": "coordinator",
             "subjectType": "ticket", "subjectId": "IT-2026-000128", "status": "Cancelled",
             "kind": "cancel", "text": "Assigned -> Cancelled: Cancellation reason: Requester withdrew the request  --  office procured the monitor independently."},
            {"at": days(-40), "by": "M. Reyes", "role": "management",
             "subjectType": "user", "subjectId": "muy", "status": None,
             "kind": "user", "text": "User 'M. Uy' created (role: technician, username: muy)."},
            {"at": days(-40), "by": "M. Reyes", "role": "management",
             "subjectType": "office", "subjectId": "Library", "status": None,
             "kind": "office", "text": "Office 'Library' created."},
            {"at": days(-30), "by": "K. Ramos", "role": "coordinator",
             "subjectType": "schedule", "subjectId": "SCH-2026-024", "status": None,
             "kind": "sched", "text": "Schedule created  --  Records Office Hardware quarterly, first due today."},
            {"at": days(-5), "by": "J. Tan", "role": "technician",
             "subjectType": "job", "subjectId": "MNT-2026-0058", "status": "Resolved",
             "kind": "outcome", "text": "Maintenance work completed  --  checklist complete, handed to the office for Section 3 confirmation."},
            {"at": days(-3), "by": "System", "role": "system",
             "subjectType": "job", "subjectId": "MNT-2026-0058", "status": "Closed",
             "kind": "outcome", "text": "Record maintenance outcome: Successful. Do not mark incomplete or cancelled maintenance successful."},
            {"at": days(-1.5), "by": "M. Reyes", "role": "management",
             "subjectType": "settings", "subjectId": "settings", "status": None,
             "kind": "settings", "text": "Settings updated (reminder interval = 2 min)."},
        ],
    }
    for j in out["jobs"]:
        sc = next((s for s in out["schedules"] if s["id"] == j["scheduleId"]), None)
        if sc and str(j["occurrence"]).startswith("seed-"):
            j["occurrence"] = sc["dueDate"][:10]
    return out
