# ROLE FEATURES (derived directly from the PDF nodes and arrows, Appendix C)

Every line below comes from a node (shape) placed in that lane of the PDF, or an arrow crossing between lanes. Nothing here is guessed. The app screens for each role are in Section 4A of MASTER_PROMPT_FINAL.md.

## Office Requester or Office Representative

**Steps this role owns (PDF text):**
- Agree on new maintenance date
- Start (start)
- Office needs IT assistance
- Submit service request
- Supply missing information
- Review and verify service result
- Office accepts result? (decision)
- Record confirmation, confirming person, and date
- Record office feedback
- Create new ticket linked to previous service record

**Decisions and where each outcome goes:**
- Office accepts result? [Accepted] goes to Record confirmation, confirming person, and date (Office Requester or Office Representative)
- Office accepts result? [Rejected] goes to Record office feedback (Office Requester or Office Representative)
- Office accepts result? [No response] goes to Keep status: Resolved (System)

**Work this role receives from other lanes:**
- From IT Coordinator: Request missing details then Supply missing information
- From System: Notify office ready for confirmation then Review and verify service result [To Section 3]
- From System: Send follow-up reminder then Office accepts result? [When office responds]
- From System: Issue recurs after closure? then Create new ticket linked to previous service record [Yes]
- From System: Office available? then Agree on new maintenance date [No]
- From IT Technician: Continue maintenance verification then Review and verify service result [Use Section 3 confirmation and closure]

**Work this role hands to other lanes:**
- Office needs IT assistance then Enter telephone, email, walk-in, or on-site request (IT Coordinator)
- Submit service request then Record service request (System)
- Supply missing information then Update existing ticket (System)
- Office accepts result? then Keep status: Resolved (System) [No response]
- Record office feedback then Status: In Progress (System) [Return to Section 2 diagnosis (status In Progress)]
- Record office feedback then Diagnose issue and record findings (IT Technician) [Return to Section 2 diagnosis]
- Record confirmation, confirming person, and date then Status: Closed (System)
- Record confirmation, confirming person, and date then Record maintenance outcome (System) [Maintenance confirmation]
- Create new ticket linked to previous service record then Record service request (System) [Return to Section 1]
- Agree on new maintenance date then Record reschedule (System)

## IT Coordinator

**Steps this role owns (PDF text):**
- Start (start)
- Create maintenance schedule
- Enter telephone, email, walk-in, or on-site request
- Assign technician and coordinate visit
- Review request
- Request missing details
- Details complete? (decision)
- Assess impact and urgency
- Set priority and target completion date
- Assign technician
- Follow up dependency
- Dependency outcome? (decision)
- Record follow-up updates
- Record cancellation reason

**Decisions and where each outcome goes:**
- Details complete? [No] goes to Status: Needs Information (System)
- Details complete? [Yes] goes to Assess impact and urgency (IT Coordinator)
- Dependency outcome? [Resolved] goes to Status: In Progress (System)
- Dependency outcome? [Still pending] goes to Record follow-up updates (IT Coordinator)
- Dependency outcome? [Cannot proceed] goes to Record cancellation reason (IT Coordinator)

**Work this role receives from other lanes:**
- From Office Requester or Office Representative: Office needs IT assistance then Enter telephone, email, walk-in, or on-site request
- From System: Status and audit history then Review request
- From System: Status: Needs Information then Request missing details
- From System: Update existing ticket then Review request [Return to review; no new ticket]
- From System: Status: Assigned then Record cancellation reason [Active request withdrawn]
- From IT Technician: Record dependency, reason, responsible person, and next action then Follow up dependency
- From System: Maintenance Job Record then Assign technician and coordinate visit

**Work this role hands to other lanes:**
- Enter telephone, email, walk-in, or on-site request then Record service request (System)
- Details complete? then Status: Needs Information (System) [No]
- Request missing details then Supply missing information (Office Requester or Office Representative)
- Assign technician then Status: Assigned (System)
- Dependency outcome? then Status: In Progress (System) [Resolved]
- Record cancellation reason then Status: Cancelled (System)
- Create maintenance schedule then Record maintenance schedule: office, assets, category, checklist, frequency, due date, technician (System)
- Assign technician and coordinate visit then Office available? (System)

## IT Technician

**Steps this role owns (PDF text):**
- Perform maintenance checklist using Section 2
- Record task, result, findings, technician, date, and evidence
- Additional fault discovered? (decision)
- Continue maintenance verification
- Review ticket and previous office or asset history
- Coordinate service schedule
- Diagnose issue and record findings
- Parts, approval, or external support needed? (decision)
- Perform repair, installation, configuration, troubleshooting, or other IT service
- Record dependency, reason, responsible person, and next action
- Record diagnosis, actions, parts, costs, labor, dates, and evidence
- Test result
- Service passed testing? (decision)
- Record failed test

**Decisions and where each outcome goes:**
- Additional fault discovered? [Yes] goes to Create linked corrective ticket following Section 1 (System)
- Additional fault discovered? [No] goes to Continue maintenance verification (IT Technician)
- Parts, approval, or external support needed? [No] goes to Perform repair, installation, configuration, troubleshooting, or other IT service (IT Technician)
- Parts, approval, or external support needed? [Yes] goes to Status: On Hold (System)
- Service passed testing? [No] goes to Record failed test (IT Technician)
- Service passed testing? [Yes] goes to Status: Resolved (System)

**Work this role receives from other lanes:**
- From System: Notify technician and requester then Review ticket and previous office or asset history [To Section 2]
- From System: Status: In Progress then Diagnose issue and record findings
- From System: Status: On Hold then Record dependency, reason, responsible person, and next action
- From System: Status: In Progress then Perform repair, installation, configuration, troubleshooting, or other IT service [After dependency resolved]
- From Office Requester or Office Representative: Record office feedback then Diagnose issue and record findings [Return to Section 2 diagnosis]
- From System: Office available? then Perform maintenance checklist using Section 2 [Yes]

**Work this role hands to other lanes:**
- Coordinate service schedule then Status: In Progress (System)
- Parts, approval, or external support needed? then Status: On Hold (System) [Yes]
- Record dependency, reason, responsible person, and next action then Follow up dependency (IT Coordinator)
- Service passed testing? then Status: Resolved (System) [Yes]
- Record diagnosis, actions, parts, costs, labor, dates, and evidence then Status and audit history (System)
- Record diagnosis, actions, parts, costs, labor, dates, and evidence then Office IT Service Register (System)
- Record task, result, findings, technician, date, and evidence then Maintenance Job Record (System) [Continue maintenance documentation]
- Additional fault discovered? then Create linked corrective ticket following Section 1 (System) [Yes]
- Continue maintenance verification then Review and verify service result (Office Requester or Office Representative) [Use Section 3 confirmation and closure]

## System

**Steps this role owns (PDF text):**
- Record reschedule
- Record maintenance schedule: office, assets, category, checklist, frequency, due date, technician (record)
- Check maintenance schedule
- Keep schedule active and wait
- Calculate next due date
- Maintenance due? (decision)
- Check job for schedule occurrence
- Job already exists? (decision)
- Generate linked maintenance job
- Use existing job; do not duplicate
- Maintenance Job Record (record)
- Office available? (decision)
- Create linked corrective ticket following Section 1
- Record service request (record)
- Status: Submitted
- Status and audit history (record)
- Update existing ticket
- Status: Needs Information
- Status: Assigned
- Notify technician and requester
- Status: In Progress
- Status: On Hold
- Status: Resolved
- Notify office ready for confirmation
- Status: Cancelled
- Notify requester
- Preserve records and activity history
- Keep status: Resolved
- Send follow-up reminder
- Status: Closed
- Update office service history and reporting
- Record maintenance outcome
- Issue recurs after closure? (decision)
- Do not mark incomplete or cancelled maintenance successful
- Update office and asset service history
- End (end)
- Office IT Service Register (record)
- Generate Office IT Service Reports
- Filter by office, date range, category, technician, and status
- Cancelled separate from completed totals; authorized office access; role-based IT access; preserve completed records and audit history; office-linked services (note)
- Service history, completed totals, pending and overdue, workload, turnaround, costs, recurring issues, compliance
- Service record retained (end)

**Decisions and where each outcome goes:**
- Maintenance due? [No] goes to Keep schedule active and wait (System)
- Maintenance due? [Yes] goes to Check job for schedule occurrence (System)
- Job already exists? [Yes] goes to Use existing job; do not duplicate (System)
- Job already exists? [No] goes to Generate linked maintenance job (System)
- Office available? [No] goes to Agree on new maintenance date (Office Requester or Office Representative)
- Office available? [Yes] goes to Perform maintenance checklist using Section 2 (IT Technician)
- Issue recurs after closure? [Yes] goes to Create new ticket linked to previous service record (Office Requester or Office Representative)
- Issue recurs after closure? [No] goes to End (System)

**Work this role receives from other lanes:**
- From Office Requester or Office Representative: Submit service request then Record service request
- From IT Coordinator: Enter telephone, email, walk-in, or on-site request then Record service request
- From IT Coordinator: Details complete? then Status: Needs Information [No]
- From Office Requester or Office Representative: Supply missing information then Update existing ticket
- From IT Coordinator: Assign technician then Status: Assigned
- From IT Technician: Coordinate service schedule then Status: In Progress
- From IT Technician: Parts, approval, or external support needed? then Status: On Hold [Yes]
- From IT Coordinator: Dependency outcome? then Status: In Progress [Resolved]
- From IT Coordinator: Record cancellation reason then Status: Cancelled
- From IT Technician: Service passed testing? then Status: Resolved [Yes]
- From IT Technician: Record diagnosis, actions, parts, costs, labor, dates, and evidence then Status and audit history
- From IT Technician: Record diagnosis, actions, parts, costs, labor, dates, and evidence then Office IT Service Register
- From Office Requester or Office Representative: Office accepts result? then Keep status: Resolved [No response]
- From Office Requester or Office Representative: Record office feedback then Status: In Progress [Return to Section 2 diagnosis (status In Progress)]
- From Office Requester or Office Representative: Record confirmation, confirming person, and date then Status: Closed
- From Office Requester or Office Representative: Record confirmation, confirming person, and date then Record maintenance outcome [Maintenance confirmation]
- From Office Requester or Office Representative: Create new ticket linked to previous service record then Record service request [Return to Section 1]
- From IT Coordinator: Create maintenance schedule then Record maintenance schedule: office, assets, category, checklist, frequency, due date, technician
- From IT Coordinator: Assign technician and coordinate visit then Office available?
- From Office Requester or Office Representative: Agree on new maintenance date then Record reschedule
- From IT Technician: Record task, result, findings, technician, date, and evidence then Maintenance Job Record [Continue maintenance documentation]
- From IT Technician: Additional fault discovered? then Create linked corrective ticket following Section 1 [Yes]

**Work this role hands to other lanes:**
- Status and audit history then Review request (IT Coordinator)
- Status: Needs Information then Request missing details (IT Coordinator)
- Update existing ticket then Review request (IT Coordinator) [Return to review; no new ticket]
- Notify technician and requester then Review ticket and previous office or asset history (IT Technician) [To Section 2]
- Status: Assigned then Record cancellation reason (IT Coordinator) [Active request withdrawn]
- Status: In Progress then Diagnose issue and record findings (IT Technician)
- Status: On Hold then Record dependency, reason, responsible person, and next action (IT Technician)
- Status: In Progress then Perform repair, installation, configuration, troubleshooting, or other IT service (IT Technician) [After dependency resolved]
- Notify office ready for confirmation then Review and verify service result (Office Requester or Office Representative) [To Section 3]
- Send follow-up reminder then Office accepts result? (Office Requester or Office Representative) [When office responds]
- Issue recurs after closure? then Create new ticket linked to previous service record (Office Requester or Office Representative) [Yes]
- Maintenance Job Record then Assign technician and coordinate visit (IT Coordinator)
- Office available? then Agree on new maintenance date (Office Requester or Office Representative) [No]
- Office available? then Perform maintenance checklist using Section 2 (IT Technician) [Yes]
