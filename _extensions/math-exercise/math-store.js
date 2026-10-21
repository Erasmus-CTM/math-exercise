// math-exercise's adapter for CTM Assessment's shared store. AGPL-3.0-or-later.
// Storage, revision matching and result events belong to CTMStore.
(function (root) {
  'use strict';
  function attach(options) {
    var cell = options.element, store = root.CTMStore;
    if (!store || !cell.dataset.ctmSource) return null;
    var L = root.CTMLocales.table('ui', options.lang || 'en');
    var handle, restoring = false;
    var note = document.createElement('div');
    note.className = 'math-saved-answer';
    var last = document.createElement('div');
    last.className = 'math-saved-result';
    cell.append(note, last);

    function fields() {
      var items = options.fields(), counts = Object.create(null);
      items.forEach(function (item) { if (item.key) counts[item.key] = (counts[item.key] || 0) + 1; });
      return items.map(function (item) {
        // Repeated display labels must not overwrite another response.
        return {element: item.element, label: item.label,
          key: item.key && counts[item.key] === 1 ? item.key : item.element.id};
      });
    }
    function matrices() { return Array.from(options.question.querySelectorAll('.math-dynamic-matrix-wrap')); }
    function read() {
      if (options.graphical) return null;
      var values = Object.create(null), sizes = Object.create(null), filled = false;
      fields().forEach(function (item) { values[item.key] = item.element.value; filled = filled || !!item.element.value.trim(); });
      matrices().forEach(function (wrap) {
        var value = wrap.matrixInput.read();
        sizes[wrap.dataset.matrixName] = {rows: value.rows, cols: value.cols};
      });
      if (!filled && !options.variants().length && !Object.keys(sizes).length) return null;
      return {fields: values, matrices: sizes};
    }
    function clearInputs() {
      restoring = true;
      try {
        matrices().forEach(function (wrap) { wrap.matrixInput.reset(); });
        fields().forEach(function (item) { item.element.value = ''; });
        options.invalidate();
      } finally { restoring = false; }
    }
    function choose(variant) { if (variant) options.select(variant); }
    function write(inputs, meta) {
      restoring = true;
      try {
        choose(meta.variant);
        matrices().forEach(function (wrap) {
          var name = wrap.dataset.matrixName, size = inputs.matrices && inputs.matrices[name];
          if (size) wrap.matrixInput.resize(size.rows, size.cols, true);
        });
        fields().forEach(function (item) {
          item.element.value = inputs.fields && Object.prototype.hasOwnProperty.call(inputs.fields, item.key)
            ? String(inputs.fields[item.key]) : '';
        });
        options.invalidate();
      } finally { restoring = false; }
    }
    function formatOld(inputs) {
      return Object.keys(inputs && inputs.fields || {}).map(function (name) { return name + ': ' + inputs.fields[name]; }).join('\n');
    }
    function savedResult(meta) {
      last.replaceChildren();
      var result = meta.record && meta.record.result;
      if (!result) return;
      var status = {correct: L.statusCorrect, partial: L.statusPartial, wrong: L.statusWrong, invalid: L.statusInvalid}[result.status];
      last.textContent = L.lastChecked(new Date(result.at).toLocaleDateString(), status, Math.round(result.score * 100))
        + (meta.outdated ? ' ' + L.outdated : '');
      last.dataset.outdated = String(!!meta.outdated);
    }
    function restored(meta) {
      note.replaceChildren();
      savedResult(meta);
      if (meta.state !== 'changed' && meta.state !== 'withdrawn') return;
      restoring = true;
      try { choose(meta.variant); clearInputs(); } finally { restoring = false; }
      var message = document.createElement('p');
      message.textContent = meta.state === 'withdrawn' ? L.variantWithdrawn : options.variants().length ? L.variantChanged : L.sourceChanged;
      var details = document.createElement('details'), summary = document.createElement('summary'), old = document.createElement('pre');
      summary.textContent = L.showSaved;
      old.textContent = formatOld(meta.record && meta.record.inputs);
      details.append(summary, old);
      note.append(message, details);
    }
    function exportItem() {
      var parts = [], grouped = new Set();
      options.question.querySelectorAll('.math-mat, .math-vec').forEach(function (matrix, index) {
        var elements = Array.from(matrix.querySelectorAll('input.math-input, textarea.math-input'));
        elements.forEach(function (element) { grouped.add(element); });
        var cols = Number(matrix.dataset.cols || matrix.style.getPropertyValue('--cols'));
        if (matrix.classList.contains('math-vec')) cols = matrix.classList.contains('math-vec-row') ? elements.length : 1;
        var rows = [], values = elements.map(function (element) { return element.value; });
        for (var i = 0; cols > 0 && i < values.length; i += cols) rows.push('[' + values.slice(i, i + cols).join(', ') + ']');
        parts.push({kind: 'answer', label: matrix.dataset.matrixName || '[' + (index + 1) + ']', text: '[' + rows.join(', ') + ']'});
      });
      fields().forEach(function (item) {
        if (!grouped.has(item.element)) parts.push({kind: 'answer', label: item.label, text: item.element.value});
      });
      var caption = cell.querySelector('.math-exercise-caption');
      return {title: caption ? caption.textContent.trim() : options.id, parts: parts};
    }
    handle = store.register({component: 'math-exercise', id: options.id, element: cell,
      source: cell.dataset.ctmSource, save: cell.dataset.ctmSave !== 'false' && !options.graphical,
      variant: options.variant, variants: options.variants, read: read, write: write,
      clear: function () { clearInputs(); note.replaceChildren(); last.replaceChildren(); }, exportItem: exportItem});
    restored(handle.restore());
    return {
      changed: function () {
        if (restoring) return;
        note.replaceChildren(); last.replaceChildren(); handle.changed();
      },
      result: function (value) { note.replaceChildren(); last.replaceChildren(); handle.result(value); },
      beforeVariant: function () {
        var inputs = read();
        return !inputs || !Object.keys(inputs.fields).some(function (key) { return inputs.fields[key].trim(); }) || root.confirm(L.confirmNewVariant);
      },
      exportItem: exportItem
    };
  }
  root.MathExerciseStore = {attach: attach};
})(typeof window !== 'undefined' ? window : globalThis);
