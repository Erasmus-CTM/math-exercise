// math-exercise's adapter for CTM Assessment's shared store. AGPL-3.0-or-later.
// Storage, revision matching and result events belong to CTMStore.
(function (root) {
  'use strict';
  function attach(options) {
    var cell = options.element, store = root.CTMStore;
    if (!store || !cell.dataset.ctmSource) return null;
    var L = root.CTMLocales.table('ui', options.lang || 'en');
    var handle, restoring = false, deferChoice = false;
    var note = document.createElement('div');
    note.className = 'math-saved-answer';
    var last = document.createElement('div');
    last.className = 'math-saved-result';
    cell.append(note, last);

    function fields() {
      var items = options.fields(), counts = Object.create(null);
      items.forEach(function (item) { if (item.key) counts[item.key] = (counts[item.key] || 0) + 1; });
      var used = Object.create(null), prefix = cell.id + '-';
      items.forEach(function (item) { if (item.key && counts[item.key] === 1) used[item.key] = true; });
      return items.map(function (item, index) {
        var key = item.key && counts[item.key] === 1 ? item.key : null;
        if (!key) {
          // DOM ids include the page's exercise ordinal. Only the part local
          // to this exercise identifies a saved field across page edits.
          key = item.element.id.indexOf(prefix) === 0 ? item.element.id.slice(prefix.length) : 'field-' + (index + 1);
          while (used[key]) key = '@field:' + key;
          used[key] = true;
        }
        return {element: item.element, label: item.label, key: key};
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
      var generated = options.generated ? options.generated.read() : [];
      var inputs = {fields: values, matrices: sizes};
      if (generated.length) inputs.generated = generated;
      if (options.generated) {
        var envelope = {v:1,component:'math-exercise',saved:new Date().toISOString(),inputs:inputs,
          source:cell.dataset.ctmSource,variant:options.variant(),seen:options.seen ? options.seen() : []};
        // Leave room for the store-owned timestamp/result/proposal envelope.
        while (inputs.generated && inputs.generated.length && new TextEncoder().encode(JSON.stringify(envelope)).length > 63 * 1024) inputs.generated.pop();
        options.generated.retain(inputs.generated || []);
      }
      if (!filled && !options.variants().length && !Object.keys(sizes).length && !(inputs.generated && inputs.generated.length)) return null;
      return inputs;
    }
    function forget() {
      note.replaceChildren();
      last.replaceChildren();
      deferChoice = false;
      if (options.generated) options.generated.clear();
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
        if (options.generated) options.generated.restore(inputs.generated || []);
        matrices().forEach(function (wrap) {
          var name = wrap.dataset.matrixName, size = inputs.matrices && inputs.matrices[name];
          if (size) wrap.matrixInput.resize(size.rows, size.cols, true);
        });
        // A choice-only P17 record has no answer snapshot. Preserve authored
        // initial values; an explicit fields:{} snapshot still clears them.
        if (Object.prototype.hasOwnProperty.call(inputs, 'fields')) fields().forEach(function (item) {
          var values = inputs.fields || {};
          var key = Object.prototype.hasOwnProperty.call(values, item.key) ? item.key : item.element.id;
          item.element.value = Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : '';
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
      if (options.generated) options.generated.restore(meta.record && meta.record.inputs.generated || []);
      deferChoice = true;
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
      var parts = [], labels = new Map(), matrixIndex = 0;
      fields().forEach(function (item) { labels.set(item.element, item.label); });
      options.question.querySelectorAll('.math-mat, .math-vec, input.math-input, textarea.math-input').forEach(function (element) {
        if (!element.classList.contains('math-mat') && !element.classList.contains('math-vec')) {
          if (!element.closest('.math-mat, .math-vec')) parts.push({kind: 'answer', label: labels.get(element), text: element.value});
          return;
        }
        matrixIndex++;
        var elements = Array.from(element.querySelectorAll('input.math-input, textarea.math-input'));
        var cols = Number(element.dataset.cols || element.style.getPropertyValue('--cols'));
        if (element.classList.contains('math-vec')) cols = element.classList.contains('math-vec-row') ? elements.length : 1;
        var rows = [], values = elements.map(function (input) { return input.value; });
        for (var i = 0; cols > 0 && i < values.length; i += cols) rows.push('[' + values.slice(i, i + cols).join(', ') + ']');
        parts.push({kind: 'answer', label: element.dataset.matrixName || '[' + matrixIndex + ']', text: '[' + rows.join(', ') + ']'});
      });
      if (options.generated) parts = parts.concat(options.generated.exportParts());
      var caption = cell.querySelector('.math-exercise-caption');
      return {title: caption ? caption.textContent.trim() : options.id, parts: parts};
    }
    if (root.CTMCopy && !options.graphical) {
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn btn-light math-copy-answer';
      copy.textContent = L.copyAnswer;
      copy.setAttribute('aria-label', L.copyAnswerLabel(options.id));
      copy.addEventListener('click', function () {
        var text = exportItem().parts.map(function (part) { return part.label + ': ' + part.text; }).join('\n');
        root.CTMCopy.text(text, {label: L.copyAnswerLabel(options.id)});
      });
      (cell.querySelector('.math-exercise-controls') || cell).append(copy);
    }
    handle = store.register({component: 'math-exercise', id: options.id, element: cell,
      source: cell.dataset.ctmSource, save: cell.dataset.ctmSave !== 'false' && !options.graphical,
      variant: options.variant, variants: options.variants, seen: options.seen,
      numberedVariantResults: typeof options.initializeChoice === 'function',
      allowProposals: options.allowProposals === true, proposal: options.proposal, read: read, write: write,
      forget: forget, clear: function () { clearInputs(); forget(); }, exportItem: exportItem});
    if (options.initializeChoice && typeof handle.restoreChoice === 'function') {
      options.initializeChoice(handle.restoreChoice());
    }
    restored(handle.restore());
    function persistChoice() {
      if (!deferChoice && options.choice && typeof handle.choice === 'function') handle.choice(options.choice());
    }
    persistChoice();
    document.addEventListener('ctm:store-enabled', persistChoice);
    return {
      generatedChanged: function () {if (!restoring) handle.flush();},
      changed: function () {
        if (restoring) return;
        deferChoice = false;
        note.replaceChildren();
        if (last.textContent && last.dataset.outdated !== 'true') {
          last.textContent += ' ' + L.outdated;
          last.dataset.outdated = 'true';
        }
        persistChoice();
        handle.changed();
      },
      result: function (value) { deferChoice = false; note.replaceChildren(); last.replaceChildren(); persistChoice(); handle.result(value); },
      choiceChanged: function () {
        if (!restoring) {
          deferChoice = false; persistChoice();
          document.dispatchEvent(new CustomEvent('ctm:store-clear', {detail: {
            component: 'math-exercise', id: options.id, runtimeId: cell.dataset.ctmRuntimeId,
            course: store.course, page: store.page, reason: 'variant'}}));
        }
      },
      beforeVariant: function () {
        var inputs = read();
        return !inputs || !Object.keys(inputs.fields).some(function (key) { return inputs.fields[key].trim(); }) || root.confirm(L.confirmNewVariant);
      },
      exportItem: exportItem
    };
  }
  root.MathExerciseStore = {attach: attach};
})(typeof window !== 'undefined' ? window : globalThis);
