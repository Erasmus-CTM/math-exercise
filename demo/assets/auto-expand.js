/*
 * Demo-only convenience script (not part of math-exercise).
 *
 * math-exercise renders a captioned exercise collapsed by default, with a
 * click-to-expand toggle - a genuine, deliberate feature for a real course
 * page with many exercises. For this single-page demo (screenshots, a
 * timed live walkthrough) we instead want every exercise visible right
 * away, so this script sets the same "open" state a real click on the
 * toggle would produce, using only the classes/structure math-exercise's
 * own CSS already documents as its public contract. It does not patch or
 * replace any behaviour of the extension - a user can still click a
 * caption to collapse an exercise again, and that still works normally.
 */
(function () {
  'use strict';

  function expandAll() {
    document.querySelectorAll('.math-exercise-cell').forEach(function (cell) {
      var body = cell.querySelector('.math-exercise-body');
      if (!body) return; // no caption -> not collapsible, already visible
      cell.classList.add('math-exercise-open');
      body.style.display = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', expandAll);
  } else {
    expandAll();
  }
})();
