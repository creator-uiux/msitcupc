# Report definitions

One definition per metric, computed in exactly one place and mirrored between
`server/query.py` (live mode) and `js/query.js` (offline mode) so both modes
report identical numbers.

## Status vocabulary

The eight canonical statuses and their labels:

| Internal | Label | Terminal |
|---|---|---|
| submitted | Submitted | no |
| needs_info | Needs Information | no |
| assigned | Assigned | no |
| in_progress | In Progress | no |
| on_hold | On Hold | no |
| resolved | Resolved | no |
| closed | Closed | yes |
| cancelled | Cancelled | yes |

Open states are the six non terminal statuses. Resolved is open: it means the
technician finished and testing passed, and the office confirmation is still
outstanding.

## Core metrics

| Metric | Definition |
|---|---|
| Open tickets | Count of tickets whose status is one of the six open states |
| Completed | Count of tickets with status Closed |
| Awaiting confirmation | Count of tickets with status Resolved and confirmation state pending |
| Overdue | Count of open tickets past their due point. Due point is the target date when set, otherwise intake plus the service level window the System Administrator configured on Settings (5 calendar days by default). Resolved tickets are excluded because the technician work is done |
| Turnaround hours | resolvedAt minus createdAt in hours, averaged over tickets that have a resolvedAt. Cancelled tickets are excluded because they have no resolvedAt |
| Time to closure hours | closedAt minus createdAt in hours, averaged over Closed tickets |
| Resolved within target | Count of tickets with both a target date and a resolvedAt where the resolved date is on or before the target date |
| Preventive compliance | Closed maintenance jobs whose outcome is Successful, divided by the maintenance occurrences that came due in the period. An Incomplete or Cancelled job counts as non compliant. A job may only carry the Successful outcome once it is Closed and every checklist item is done |
| Cost total | Sum of diagnosis cost plus labor across tickets in range |
| Recurring | Count of tickets flagged recurring |

## The eight reports

| # | Report | Basis |
|---|---|---|
| 1 | Ticket volume by office | Count of tickets grouped by office |
| 2 | Ticket volume by category | Count of tickets grouped by category |
| 3 | Ticket volume by source | Count of tickets grouped by source |
| 4 | Turnaround by category | Average turnaround hours grouped by category |
| 5 | Overdue tickets | List of open tickets past due point |
| 6 | Status distribution | Count of tickets grouped by the eight statuses |
| 7 | Priority distribution | Count of tickets grouped by priority |
| 8 | Preventive compliance | Closed jobs with the Successful outcome divided by the occurrences due, per schedule |

Reports 1 to 8 share the same date range and office filter as the reports
screen. CSV export produces one row per grouped key with the metric column,
using these definitions and not any client side fallback.

## Notes on earlier inconsistencies

- The reports note previously said turnaround equals resolved minus created while
  the KPI and table used closed minus created. Both are now distinct metrics with
  their own names and columns.
- The five day fallback is now applied wherever a target date is absent, in one
  place (`due_ms`), so the KPI and the table agree.
- Resolved is explicitly reported as a separate, awaiting confirmation, bucket
  rather than folded into completed.
- A maintenance job follows the same rule as a ticket.  The technician
  completing the checklist moves the job to Resolved and hands it to the
  office; the office confirmation closes it, and the system writes the
  outcome at that point.  An open job therefore never carries the
  Successful outcome, and a cancelled or incomplete job never carries it at
  all.
