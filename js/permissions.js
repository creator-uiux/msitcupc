/* permissions.js -- GENERATED FILE, do not edit by hand.
 *
 * Source of truth: permissions.json at the repository root.
 * Rebuild with: python tools/build_permissions.py
 * Verify with:   python tools/permission_parity_check.py
 *
 * The backend reads permissions.json directly for its action guards and
 * its transition matrix, so the frontend and the backend are driven by
 * one map (specification 4A.1).
 */
(function (global) {
  'use strict';
  var P = {
  "_comment": "Single permission map for the IT Service and Maintenance Management System. The backend reads it for action guards and the transition matrix; js/permissions.js is generated from it for the frontend. tools/permission_parity_check.py verifies the three never drift apart.",
  "roles": [
    "requester",
    "technician",
    "coordinator",
    "management"
  ],
  "pages": {
    "index.html": [
      "requester",
      "technician",
      "coordinator",
      "management"
    ],
    "dashboard.html": [
      "requester",
      "technician",
      "coordinator"
    ],
    "tickets.html": [
      "requester",
      "technician",
      "coordinator"
    ],
    "ticket.html": [
      "requester",
      "technician",
      "coordinator"
    ],
    "register.html": [
      "requester",
      "technician",
      "coordinator"
    ],
    "reports.html": [
      "requester",
      "technician",
      "coordinator"
    ],
    "flow.html": [
      "requester",
      "technician",
      "coordinator",
      "management"
    ],
    "roles.html": [
      "requester",
      "technician",
      "coordinator",
      "management"
    ],
    "notifications.html": [
      "requester",
      "technician",
      "coordinator",
      "management"
    ],
    "profile.html": [
      "requester",
      "technician",
      "coordinator",
      "management"
    ],
    "request.html": [
      "requester",
      "coordinator"
    ],
    "review.html": [
      "coordinator"
    ],
    "technician.html": [
      "technician"
    ],
    "maintenance.html": [
      "technician",
      "coordinator"
    ],
    "visits.html": [
      "requester"
    ],
    "confirm.html": [
      "requester",
      "coordinator"
    ],
    "users.html": [
      "management"
    ],
    "offices.html": [
      "management"
    ],
    "assets.html": [
      "management"
    ],
    "settings.html": [
      "management"
    ],
    "audit.html": [
      "management"
    ]
  },
  "actions": {
    "create_ticket": [
      "requester",
      "coordinator"
    ],
    "submit_info": [
      "requester",
      "coordinator"
    ],
    "office_decision": [
      "requester"
    ],
    "create_linked_ticket": [
      "requester",
      "coordinator"
    ],
    "request_info": [
      "coordinator"
    ],
    "assess": [
      "coordinator"
    ],
    "assign": [
      "coordinator"
    ],
    "reassign": [
      "coordinator"
    ],
    "approve": [
      "coordinator"
    ],
    "coordinate": [
      "coordinator",
      "technician"
    ],
    "request_withdrawal": [
      "requester"
    ],
    "cancel": [
      "coordinator"
    ],
    "follow_up": [
      "coordinator"
    ],
    "resolve_dependency": [
      "coordinator"
    ],
    "cancel_from_dependency": [
      "coordinator"
    ],
    "start_work": [
      "technician"
    ],
    "diagnose": [
      "technician"
    ],
    "record_repair": [
      "technician"
    ],
    "place_hold": [
      "technician"
    ],
    "record_test": [
      "technician"
    ],
    "close": [
      "coordinator",
      "requester"
    ],
    "send_reminder": [
      "coordinator",
      "system"
    ],
    "create_schedule": [
      "coordinator"
    ],
    "reschedule_job": [
      "coordinator",
      "requester"
    ],
    "reassign_job": [
      "coordinator"
    ],
    "confirm_availability": [
      "coordinator",
      "requester"
    ],
    "record_checklist_item": [
      "technician"
    ],
    "create_fault_ticket": [
      "technician"
    ],
    "flag_additional_fault": [
      "technician"
    ],
    "record_outcome": [
      "technician",
      "coordinator"
    ],
    "run_schedule_check": [
      "coordinator",
      "system"
    ],
    "close_job": [
      "coordinator"
    ],
    "job_confirmation": [
      "requester"
    ],
    "add_comment": [
      "coordinator",
      "technician",
      "requester"
    ],
    "update_ticket": [
      "requester"
    ],
    "save_office": [
      "management"
    ],
    "set_office_active": [
      "management"
    ],
    "save_asset": [
      "management"
    ],
    "set_asset_active": [
      "management"
    ],
    "save_person": [
      "management"
    ],
    "set_person_active": [
      "management"
    ],
    "save_ref": [
      "management"
    ],
    "update_schedule": [
      "coordinator"
    ],
    "set_schedule_active": [
      "coordinator"
    ],
    "save_settings": [
      "management"
    ]
  },
  "transitions": {
    "submitted": {
      "needs_info": [
        "coordinator"
      ],
      "assigned": [
        "coordinator"
      ],
      "cancelled": [
        "coordinator"
      ]
    },
    "needs_info": {
      "submitted": [
        "requester",
        "coordinator"
      ],
      "cancelled": [
        "coordinator"
      ]
    },
    "assigned": {
      "in_progress": [
        "technician"
      ],
      "cancelled": [
        "coordinator"
      ]
    },
    "in_progress": {
      "on_hold": [
        "technician"
      ],
      "resolved": [
        "technician"
      ],
      "cancelled": [
        "coordinator"
      ]
    },
    "on_hold": {
      "in_progress": [
        "coordinator"
      ],
      "cancelled": [
        "coordinator"
      ]
    },
    "resolved": {
      "closed": [
        "requester",
        "coordinator"
      ],
      "in_progress": [
        "requester"
      ],
      "cancelled": [
        "coordinator"
      ]
    },
    "closed": {},
    "cancelled": {}
  }
};
  global.Permissions = P;
  global.PermissionMap = {
    pages: P.pages,
    actions: P.actions,
    transitions: P.transitions,
    roles: P.roles,
    /* role -> pages it may open */
    pagesForRole: function (role) {
      var out = [];
      for (var k in P.pages) {
        if (P.pages[k].indexOf(role) > -1) out.push(k);
      }
      return out;
    },
    /* role -> actions it may invoke */
    actionsForRole: function (role) {
      var out = [];
      for (var k in P.actions) {
        if (P.actions[k].indexOf(role) > -1) out.push(k);
      }
      return out;
    },
    /* status transition whitelist, same shape as the backend table */
    canTransition: function (from, to, role) {
      var row = P.transitions[from] || {};
      return (row[to] || []).indexOf(role) > -1;
    },
    /* may this role invoke this backend action?  The UI gates every
       button with the same map the backend enforces, so the screen
       can never offer a control the server would refuse. */
    can: function (role, action) {
      return (P.actions[action] || []).indexOf(role) > -1;
    },
    /* the same question, asked with the camelCase method name the
       browser code uses (recordOutcome -> record_outcome). */
    canMethod: function (role, method) {
      var key = String(method || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      return (P.actions[key] || []).indexOf(role) > -1;
    }
  };
})(window);
