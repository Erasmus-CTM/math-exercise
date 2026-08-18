/*
 * Demo-only progress dashboard.
 *
 * This is NOT part of the math-exercise extension. It is a small,
 * presentation-layer script that ships with this demo only. It works purely
 * by observing the DOM state that math-exercise already produces on its own
 * exercise cells (the "math-input-ok" class it adds to a field after a
 * correct check) - it never calls into, patches, or depends on any internal
 * API of the extension.
 *
 * It exists to illustrate, for this funding-application demo, what a
 * course-wide progress/assessment view could look like on top of
 * math-exercise. Whether such a view ships for real is future work.
 */
(function () {
  'use strict';

  function isCellSolved(cell) {
    var fields = cell.querySelectorAll('.math-input');
    if (!fields.length) return false;
    for (var i = 0; i < fields.length; i++) {
      if (!fields[i].classList.contains('math-input-ok')) return false;
    }
    return true;
  }

  function init() {
    var panel = document.getElementById('demo-progress-panel');
    if (!panel) return;

    // Tracked by math-exercise's own `#| label:` option (via its data-label
    // attribute) rather than the element id, because the element id is an
    // auto-incrementing sequence number assigned by the Lua filter, not a
    // stable handle this demo should depend on.
    // data-track format: "label:Human-readable title,label2:Title 2,..."
    var tracked = (panel.dataset.track || '')
      .split(',')
      .map(function (s) {
        var parts = s.split(':');
        return { label: (parts[0] || '').trim(), title: (parts[1] || '').trim() };
      })
      .filter(function (t) { return t.label; });
    if (!tracked.length) return;

    var fill    = panel.querySelector('.demo-progress-fill');
    var countEl = panel.querySelector('.demo-progress-count');
    var listEl  = panel.querySelector('.demo-progress-list');

    var items = tracked.map(function (t) {
      var cell = document.querySelector('.math-exercise-cell[data-label="' + t.label + '"]');
      var li = document.createElement('li');
      li.className = 'demo-progress-item';
      li.innerHTML = '<span class="demo-dot"></span><span class="demo-label"></span>';
      li.querySelector('.demo-label').textContent = t.title || t.label;
      listEl.appendChild(li);
      return { cell: cell, el: li };
    });

    function refresh() {
      var done = 0;
      items.forEach(function (item) {
        var solved = item.cell && isCellSolved(item.cell);
        item.el.classList.toggle('is-done', !!solved);
        if (solved) done++;
      });
      var pct = Math.round((done / items.length) * 100);
      fill.style.width = pct + '%';
      countEl.textContent = done + ' / ' + items.length;
    }

    refresh();

    var observer = new MutationObserver(refresh);
    items.forEach(function (item) {
      if (!item.cell) return;
      observer.observe(item.cell, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true,
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
