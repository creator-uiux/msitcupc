/* features.js -- GENERATED FILE, do not edit by hand.
 *
 * Source of truth: features.json at the repository root.
 * Rebuild with: python tools/build_features.py
 * Verify with:   python tools/feature_parity_check.py
 *
 * Every flag is OFF unless the owner asks for the capability. A flag
 * only hides presentation; permissions and the backend stay the
 * authority for what a role may do.
 */
(function (global) {
  'use strict';
  var FLAGS = {
  "dashboardKpiSparklines": false,
  "demoIntakeSimulation": false,
  "designGallery": false,
  "maintenancePlanner": false,
  "notificationPopupsToggle": false,
  "profilePasswordChange": false,
  "requestIdempotencyField": false,
  "rolesReferencePage": false,
  "ticketJumpPicker": false,
  "ticketsBoardView": false,
  "workspaceCommandPalette": false
};
  function on(name) { return FLAGS[name] === true; }
  global.Features = {
    flags: FLAGS,
    on: on,
    off: function (name) { return !on(name); },
    all: function () {
      var out = {};
      for (var k in FLAGS) {
        if (Object.prototype.hasOwnProperty.call(FLAGS, k)) out[k] = FLAGS[k];
      }
      return out;
    }
  };
})(window);
