# PDF coverage checklist (Maintenance System PDF vs MASTER_PROMPT_FINAL.md)

Status: DONE means it is already written in the prompt. Section numbers refer to MASTER_PROMPT_FINAL.md.

## A. Diagram elements
| PDF item | Status | Where in the prompt |
|---|---|---|
| 4 swimlanes (Office Requester or Representative, IT Coordinator, IT Technician, System) | DONE | Section 4, Appendix C |
| 84 shapes with exact text (81 process nodes plus legend and notes) | DONE | Appendix C.1 (N00 to N80) |
| 10 decision diamonds | DONE | Appendix B.1, C.1 |
| 2 Start shapes, End and Service record retained | DONE | Appendix B.1, C.1 |
| 8 status boxes (Submitted, Needs Information, Assigned, In Progress, On Hold, Resolved, Closed, Cancelled) | DONE | Section 6 |
| Data stores (Record service request, Status and audit history, Office IT Service Register, Maintenance Job Record, Record maintenance schedule) | DONE | Appendix C.1, F |
| All arrows and edge labels (107 edges, 104 real arrowheads all matched) | DONE | Appendix B.2 to B.6, C.2 |
| Legend box and its two connectors (drawing artifact) | DONE (marked: do not implement) | Appendix B.1, C |
| 3 links with arrowheads hidden behind labels | DONE (final decision) | Appendix B.6, D17 |
| Notes: "Resolved means technician testing passed", "Return to review; no new ticket", "Active request withdrawn", system-controls annotation | DONE | Sections 6, 8, Appendix B.5 |

## B. SOP steps 1 to 29
| SOP | Status | Where |
|---|---|---|
| 1, 1.1, 1.2 Intake channels and captured fields | DONE | Section 7, Appendix D5 |
| 2 Ticket linked to previous record, status Submitted | DONE | Sections 6, 7, Appendix F |
| 3, 3.1 to 3.3 Completeness, Needs Information, no duplicate ticket | DONE | Sections 6.1, 7, D18 |
| 4, 5 Impact, urgency, priority, target date | DONE | Section 7, D6 |
| 6 Assign technician, notify technician and requester | DONE | Sections 7, 12, Appendix H |
| 7 Withdrawal, cancellation reason, notify, preserve | DONE | Sections 6.1, 9, D1, D2, D15 |
| 8, 8.1 to 8.4 On Hold dependency and all outcomes | DONE | Sections 6.1, 8, Appendix B.3 |
| 9, 10 Review history, coordinate schedule | DONE | Section 8 |
| 11, 12, 12.1, 12.2 Diagnose, parts or approval or support decision | DONE | Section 8, D8 |
| 13 Record diagnosis, actions, parts, costs, labor, dates, evidence | DONE | Section 8, Appendix F |
| 14, 14.1, 14.2 Testing, failed test, Resolved and notify office | DONE | Sections 6, 8 |
| 15, 15.1 to 15.3 Accept, reject, no response and reminder | DONE | Sections 6.2, 9, D9 |
| 16 Close after confirmation or authorized closure | DONE | Section 6.3, D4 |
| 17 Update office service history and reporting | DONE | Sections 9, 13G |
| 18, 18.1 Recurrence creates new linked ticket | DONE | Section 9, Appendix B.4 |
| 19 Maintenance schedule fields | DONE | Section 10, Appendix F |
| 20, 20.1 to 20.3 Schedule check, occurrence check, reuse or generate job | DONE | Section 10.1 (occurrence key), D22 |
| 21 Assign maintenance technician and coordinate visit | DONE | Section 10, 4A |
| 22, 22.1, 22.2 Availability, reschedule, agreed date | DONE | Section 10, D16 |
| 23, 24 Checklist and task-level records with evidence | DONE | Section 10, Appendix F |
| 25, 25.1, 25.2 Additional fault and linked corrective ticket | DONE | Section 10, Appendix G |
| 26, 26.1 to 26.3 Outcome, not successful if incomplete or cancelled, next due date | DONE | Section 10.1, D10, D11 |
| 27 Section 3 closure for maintenance | DONE | Section 10 |
| 28, 28.1 to 28.3 Controls, cancelled separate, office access, audit preserved | DONE | Sections 11, 15, 4A, D12 |
| 29, 29.1, 29.2 Reports, filters, report contents | DONE | Section 13H, D12 |

## C. Additions beyond the PDF (all marked as decisions)
| Item | Status | Where |
|---|---|---|
| Role-based features and Workflow Guide | DONE | Section 4A |
| Light, dark, and System themes | DONE | Section 14.12 |
| Mobile app fit (installable PWA) | DONE | Section 14.13 |
| UI polish and eye comfort | DONE | Section 14.14 |
| Reference screens (ticket list, details, dashboard) | DONE, from owner descriptions only | Appendix E |
| Data model, operations, defaults, templates, seed data, deployment | DONE | Appendices F to H |
| Decisions where the PDF is silent (D1 to D22) | DONE | Appendix D |
| 88 tests and 31-item final audit | DONE | Sections 17, 21 |

## D. Not yet possible
| Item | Reason |
|---|---|
| Owner screenshots | Not uploaded in this chat. Appendix E is built from the written descriptions. |
| Proof that the built app works | Only OpenCode can build and test it. The prompt makes it write TRACEABILITY.md and KNOWN_LIMITATIONS.md. |
