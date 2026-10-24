/* Optional figure transport. This never starts or waits for a grading runtime. */
(function (root) {
  'use strict';
  if (root.MathExerciseBoards) return;
  function attach(options) {
    options = options || {};
    var disposed = false, frames = new Map(), pending = null, observer = null;
    function report(error) {
      try {
        if (typeof options.onError === 'function') options.onError(error);
        else root.console.warn('math-exercise: optional variant figure failed', error);
      } catch (_) { /* An optional reporting callback cannot disable Check. */ }
    }
    var ids = Array.from(new Set(Array.isArray(options.boards) ? options.boards : []));
    if (typeof options.label !== 'string' || !options.label || typeof options.getVariant !== 'function' ||
        ids.some(function (id) { return typeof id !== 'string' || !id; })) {
      report(new TypeError('Variant figures need a label, iframe ids and a synchronous getVariant callback.'));
      return {changed: function () { return 0; }, dispose: function () {}};
    }
    function live(frame) { return frame.isConnected && document.getElementById(frame.id) === frame; }
    function send(frame) {
      if (disposed || !live(frame) || !frame.contentWindow) return false;
      try {
        var variant = options.getVariant();
        if (!variant || typeof variant.id !== 'string' || !variant.id ||
            !(variant.n === null || (Number.isSafeInteger(variant.n) && variant.n > 0)) ||
            !Object.prototype.hasOwnProperty.call(variant, 'values')) {
          throw new TypeError('Variant figures need id, positive n or null, and caller-owned values.');
        }
        if (options.title !== undefined) {
          try {
            var title = typeof options.title === 'function' ? options.title(variant, frame) : options.title;
            if (typeof title === 'string' && title.trim()) frame.title = title;
          } catch (error) { report(error); }
        } else if (!frame.getAttribute('title')) frame.title = options.label;
        // '*' is required for sandboxed opaque-origin frames. The destination
        // is this particular live WindowProxy, never all frames or a broadcast.
        frame.contentWindow.postMessage({protocol: 'ctm-variant', label: options.label,
          n: variant.n, id: variant.id, values: variant.values}, '*');
        frame.contentWindow.postMessage({protocol: 'jsxgraph-quarto-assessment', version: 1,
          type: 'layout', assessmentId: frame.id}, '*');
        return true;
      } catch (error) { report(error); return false; }
    }
    function refresh() {
      var changed = false;
      ids.forEach(function (id) {
        var frame = document.getElementById(id), prior = frames.get(id);
        if (!frame || frame.tagName !== 'IFRAME') frame = null;
        if (prior && prior.frame !== frame) {
          prior.frame.removeEventListener('load', prior.load);frames.delete(id);changed = true;
        }
        if (frame && !frames.has(id)) {
          var load = function () { send(frame); schedule(); };
          frame.addEventListener('load', load);frames.set(id, {frame: frame, load: load});changed = true;
        }
      });
      return changed;
    }
    function changed() {
      if (disposed) return 0;
      refresh();var sent = 0;
      frames.forEach(function (entry) { if (send(entry.frame)) sent++; });
      return sent;
    }
    function schedule() {
      if (disposed || pending !== null) return;
      // Rendering-phase resend lets a newly revealed frame measure its box.
      var later = typeof root.requestAnimationFrame === 'function' ? root.requestAnimationFrame.bind(root)
        : function (callback) { return root.setTimeout(callback, 0); };
      pending = later(function () { pending = null;changed(); });
    }
    function ready(event) {
      var data = event.data;
      if (!data || data.protocol !== 'ctm-variant' || data.type !== 'ready' || data.label !== options.label) return;
      // Opaque sibling frames all have origin 'null'; only source proves which
      // configured iframe sent the request. Claimed ids/origins are not proof.
      frames.forEach(function (entry) {
        if (live(entry.frame) && event.source === entry.frame.contentWindow) send(entry.frame);
      });
    }
    root.addEventListener('message', ready);
    root.addEventListener('resize', schedule);
    document.addEventListener('shown.bs.tab', schedule);
    document.addEventListener('shown.bs.collapse', schedule);
    document.addEventListener('toggle', schedule, true);
    if (typeof root.MutationObserver === 'function') {
      observer = new root.MutationObserver(function () { if (!disposed && refresh()) changed(); });
      observer.observe(document, {childList: true, subtree: true});
    }
    changed();
    return {
      changed: changed,
      dispose: function () {
        if (disposed) return;disposed = true;
        if (observer) observer.disconnect();
        if (pending !== null) {
          if (typeof root.cancelAnimationFrame === 'function') root.cancelAnimationFrame(pending);
          else root.clearTimeout(pending);
        }
        frames.forEach(function (entry) { entry.frame.removeEventListener('load', entry.load); });frames.clear();
        root.removeEventListener('message', ready);root.removeEventListener('resize', schedule);
        document.removeEventListener('shown.bs.tab', schedule);document.removeEventListener('shown.bs.collapse', schedule);
        document.removeEventListener('toggle', schedule, true);
      }
    };
  }
  root.MathExerciseBoards = {version: 1, attach: attach};
})(globalThis);
