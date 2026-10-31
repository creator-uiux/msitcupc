"""Workflow coverage check: the diagram, the roles and the permission map.

The process diagram (`Maintenance System.pdf`, the same content as
`Maintenance System.png`) numbers 29 SOP steps across four swimlanes.  The
application exposes 45 actions in `permissions.json`.  This tool binds the two
together and fails in either direction:

  * every SOP step names the lane that acts, the action it uses and the engine
    function that guards it;
  * every action in the permission map is claimed by at least one step, so no
    control exists that the diagram does not draw;
  * an action's granted roles are exactly the diagram lanes that name it, so a
    role can never hold a move the diagram gives to another lane, and a move
    the diagram draws in one lane can never be granted to another;
  * every named engine guard exists in `server/engine.py`, and every public
    engine action exists in the map, so neither side carries dead wiring;
  * the four lane roles agree with the lanes in `js/flowdata.js`.

Run:  python tools/workflow_coverage_check.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP_PATH = os.path.join(ROOT, "permissions.json")
ENGINE_PATH = os.path.join(ROOT, "server", "engine.py")
FLOW_PATH = os.path.join(ROOT, "js", "flowdata.js")

# Roles that the diagram draws as lanes.  "management" is the System
# Administrator: the diagram gives that lane no ticket step, only step 28
# (system controls and records) and the reading of the records in 29.
LANE_ROLES = ["requester", "coordinator", "technician", "system", "management"]

# sop -> (lanes that act, permission actions, extra engine guards)
#
# A row names the lanes that perform the actions beside it, so a step drawn in
# two lanes with two different moves is two rows (the office asks for the
# withdrawal in 7, the coordinator records the cancellation).  The SOP numbers
# are the diagram's own; a repeated number is the same step read in two lanes.
STEPS = [
    ("1",       ["requester", "coordinator"], ["create_ticket"], []),
    ("1.1",     ["coordinator"],              ["create_ticket"], []),
    ("1.2",     ["requester", "coordinator"], ["create_ticket"], []),
    ("2",       ["system"],                   [],                ["_record_ticket", "next_id"]),
    ("3",       ["coordinator"],              ["request_info"],  []),
    ("3.2",     ["requester"],                ["submit_info"],   []),
    ("3.3",     ["requester"],                ["submit_info", "update_ticket",
                                               "add_comment"],   []),
    ("3.3",     ["coordinator"],              ["submit_info"],   []),
    ("4",       ["coordinator"],              ["assess"],        ["priority_for"]),
    ("5",       ["coordinator"],              ["assess"],        []),
    ("6",       ["coordinator"],              ["assign", "reassign"], ["notify"]),
    ("7",       ["requester"],                ["request_withdrawal"], []),
    ("7",       ["coordinator"],              ["cancel"],        []),
    ("8",       ["technician"],               ["place_hold"],    []),
    ("8.1",     ["coordinator"],              ["follow_up", "add_comment"], []),
    ("8.2",     ["coordinator"],              ["follow_up"],     []),
    ("8.3",     ["coordinator"],              ["resolve_dependency"], []),
    ("8.4",     ["coordinator"],              ["cancel_from_dependency"], []),
    ("9",       ["technician", "coordinator"], ["coordinate"],   ["get_ticket"]),
    ("10",      ["coordinator", "technician"], ["coordinate"],   []),
    ("11",      ["technician"],               ["diagnose"],      []),
    ("12",      ["coordinator"],              ["approve"],       []),
    ("12.1",    ["technician"],               ["place_hold"],    []),
    ("12.2",    ["technician"],               ["start_work", "record_repair"], []),
    ("13",      ["technician"],               ["record_repair", "add_comment"], []),
    ("14",      ["technician"],               ["record_test"],   []),
    ("14.1",    ["technician"],               ["record_test"],   []),
    ("14.2",    ["technician"],               ["record_test"],   ["notify"]),
    ("15",      ["requester"],                ["office_decision"], []),
    ("15.1",    ["requester"],                ["office_decision"], []),
    ("15.2",    ["requester"],                ["office_decision"], []),
    ("15.3",    ["coordinator", "system"],    ["send_reminder"], ["world_tick"]),
    ("16",      ["requester", "coordinator"], ["close"],         ["configured_roles"]),
    ("17",      ["system"],                   [],                ["_audit_status"]),
    ("18",      ["requester", "coordinator"], ["create_linked_ticket"], []),
    ("18.1",    ["system"],                   [],                ["get_ticket"]),
    ("19",      ["coordinator"],              ["create_schedule", "update_schedule",
                                               "set_schedule_active"], []),
    ("20",      ["system", "coordinator"],    ["run_schedule_check"], ["world_tick",
                                                                       "frequency_days"]),
    ("20.1",    ["system"],                   ["run_schedule_check"], []),
    ("20.2",    ["system"],                   ["run_schedule_check"], []),
    ("20.3",    ["system"],                   ["run_schedule_check"], []),
    ("21",      ["coordinator"],              ["reassign_job", "coordinate"], []),
    ("22",      ["requester", "coordinator"], ["confirm_availability"], []),
    ("22.1",    ["requester", "coordinator"], ["reschedule_job"], []),
    ("22.2",    ["technician"],               ["start_work"],    []),
    ("23",      ["technician"],               ["record_checklist_item"], []),
    ("24",      ["technician"],               ["record_checklist_item"], []),
    ("25",      ["technician"],               ["flag_additional_fault"], []),
    ("25.1",    ["technician"],               ["create_fault_ticket"], []),
    ("25.2",    ["technician"],               ["record_checklist_item"], []),
    ("26",      ["technician", "coordinator"], ["record_outcome"], []),
    ("26.1",    ["technician"],               ["record_outcome"], ["_finalize_job_outcome"]),
    ("26.2",    ["system"],                   [],                ["_audit"]),
    ("26.3",    ["system"],                   [],                ["_advance_next_due"]),
    ("27",      ["requester"],                ["job_confirmation"], []),
    ("27",      ["coordinator"],              ["close_job"],     []),
    ("28",      ["management"],               ["save_person", "set_person_active",
                                               "save_office", "set_office_active",
                                               "save_asset", "set_asset_active",
                                               "save_ref", "save_settings"], []),
    ("28.1",    ["system"],                   [],                []),
    ("28.2",    ["system", "management"],     [],                []),
    ("28.3",    ["system"],                   [],                ["_audit"]),
    ("29",      ["system"],                   [],                []),
    ("29.1",    ["requester", "technician", "coordinator"], [], []),
    ("29.2",    ["requester", "technician", "coordinator", "management"], [], []),
]

# Engine entry points that are behaviour rather than a role action, so the
# reverse "every public engine function is an action" rule does not flag them.
ENGINE_HELPERS = [
    "priority_for", "frequency_days", "configured_roles", "can_transition",
    "next_id", "notify", "get_ticket", "get_schedule", "get_job",
    "working_days", "closed_days", "working_due_ms", "world_tick",
    "mark_notifications_read", "reminder_due_ms",
]
# Public functions this tool deliberately does not treat as diagram steps.
ENGINE_IGNORE = ["migrate", "seed", "export_state", "call"]

QUERY_RULES = {
    "28.1": "cancelled_is_not_completed",
    "29.1": "filters",
    "29.2": "summarize",
}

problems = []


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def main():
    del problems[:]
    perm = json.loads(read(MAP_PATH))
    actions = perm["actions"]
    engine = read(ENGINE_PATH)
    flow = read(FLOW_PATH)

    # 1. the step list is complete and no row is duplicated
    ids = [s[0] for s in STEPS]
    rows = [(s, tuple(l), tuple(a)) for s, l, a, _ in STEPS]
    dupes = sorted({r for r in rows if rows.count(r) > 1})
    if dupes:
        problems.append("duplicate SOP rows: %s" % dupes)
    top = sorted({int(i.split(".")[0]) for i in ids})
    if top != list(range(1, 30)):
        problems.append("SOP steps 1 to 29 expected, got %s" % top)

    # 2. every lane role is a role the app knows, or the System worker
    known = set(perm["roles"]) | {"system"}
    for sop, lanes, acts, guards in STEPS:
        for lane in lanes:
            if lane not in known:
                problems.append("step %s names an unknown lane %r" % (sop, lane))

    # 3. every action the steps name exists, is guarded in the engine, and the
    #    lanes that draw it are exactly the roles the map grants it.  An action
    #    can be drawn by several steps in several lanes (the office and the
    #    coordinator both create a ticket), so the comparison is made over the
    #    union of the steps.  "system" is the worker, never a map role.
    claimed = set()
    drawn = {}
    for sop, lanes, acts, guards in STEPS:
        for act in acts:
            if act not in actions:
                problems.append("step %s names action %r that the map does not have"
                                % (sop, act))
                continue
            claimed.add(act)
            drawn.setdefault(act, set()).update(lanes)
            if "def %s(" % act not in engine:
                problems.append("action %r has no guard function in server/engine.py"
                                % act)
        for fn in guards:
            if "def %s(" % fn not in engine:
                problems.append("step %s cites engine guard %r which does not exist"
                                % (sop, fn))

    for act in sorted(drawn):
        granted = set(actions[act])
        if granted != drawn[act]:
            problems.append("action %s: the diagram draws it in %s, the map grants it to %s"
                            % (act, "/".join(sorted(drawn[act])) or "no lane",
                               "/".join(sorted(granted))))

    # 3b. every role a step is drawn for can actually act on that step.  A step
    #     with no action is a record or a report the lanes read, not a move.
    for sop, lanes, acts, _ in STEPS:
        if not acts:
            continue
        for lane in lanes:
            if lane not in perm["roles"]:
                continue
            if not any(lane in actions.get(act, []) for act in acts):
                problems.append("step %s is drawn for %s, which holds none of its "
                                "actions (%s)" % (sop, lane, ", ".join(acts)))

    # 4. nothing in the map is outside the diagram
    unowned = sorted(set(actions) - claimed)
    if unowned:
        problems.append("actions with no SOP step: %s" % unowned)

    # 5. nothing in the engine is outside the map.  A leading underscore is a
    #    private helper, not an entry point a role can reach.
    public = re.findall(r"^def ([a-z][a-z0-9_]*)\(", engine, re.M)
    stray = sorted(set(public) - set(actions) - set(ENGINE_HELPERS) - set(ENGINE_IGNORE))
    if stray:
        problems.append("public engine functions that are not actions: %s" % stray)

    # 6. the lanes the guide draws are the lanes the steps use
    lane_roles = re.findall(r"\{ id: '\w+', name: '[^']+', role: '(\w+)'", flow)
    if sorted(set(lane_roles)) != sorted({"requester", "coordinator", "technician", "system"}):
        problems.append("flowdata lanes disagree: %s" % lane_roles)
    for role in lane_roles:
        if not any(role in lanes for _, lanes, _, _ in STEPS):
            problems.append("lane %s draws no SOP step" % role)

    # 7. the administrator is drawn only on its own controls, and only with the
    #    actions the map actually grants it
    for sop, lanes, acts, _ in STEPS:
        if "management" not in lanes:
            continue
        denied = [act for act in acts if "management" not in actions.get(act, [])]
        if denied:
            problems.append("step %s shows the administrator an action the map denies: %s"
                            % (sop, ", ".join(denied)))
    ticket_actions = [a for a, r in actions.items()
                      if "management" in r and a not in
                      ("save_person", "set_person_active", "save_office",
                       "set_office_active", "save_asset", "set_asset_active",
                       "save_ref", "save_settings")]
    if ticket_actions:
        problems.append("the map grants the administrator ticket work: %s" % ticket_actions)

    print("SOP steps checked: %d (1 to 29, sub-clauses included)" % len(STEPS))
    print("actions in the map: %d, every one claimed by a step: %s"
          % (len(actions), "yes" if not unowned else "no"))
    print("engine guard functions checked: %d"
          % sum(len(a) + len(g) for _, _, a, g in STEPS))
    print("diagram lanes: %s" % ", ".join(lane_roles))
    if problems:
        print("\nWORKFLOW COVERAGE: FAIL (%d)" % len(problems))
        for p in problems:
            print("  !! " + p)
        return 1
    print("\nWORKFLOW COVERAGE: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
