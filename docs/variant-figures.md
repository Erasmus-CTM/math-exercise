# Optional figures for variants

`#| boards: tangent-board` names an **iframe id**, not a surrounding section.
With the pinned JSXGraph producer, author `assessment_id="tangent-board"`
on the `.jsxgraph` block (`iframe_id` is also supported). The producer puts
that id directly on the iframe; an ordinary Markdown heading such as
`#ui-board` only identifies its enclosing section. The helper deliberately
does not guess among a section's descendant frames.

For example, a question labelled `tangent` can name its figure with:

```markdown
#| boards: tangent-board
```

The authored figure listens without waiting for Python or speech:

```javascript
window.addEventListener('message', function (event) {
  if (event.source !== parent || event.data?.protocol !== 'ctm-variant' ||
      event.data.label !== 'tangent') return;
  updateFigure(event.data.values); // The figure's own rendering function.
});
parent.postMessage({protocol: 'ctm-variant', type: 'ready', label: 'tangent'}, '*');
```

The component attaches `MathExerciseBoards` with `{label, boards: [ids],
getVariant, title?}`. `getVariant()` supplies `{n, id, values}` synchronously;
`n` is a positive approved number or null for a proposal. `title` can be a
localized string or `(variant, iframe) => string`. Without one, an existing
authored title is preserved, falling back to the question label only if empty.
The returned `changed()` resends current values; `dispose()` removes listeners.

Each destination receives `{protocol: 'ctm-variant', label, n, id, values}`
unchanged, on initial binding, load, selection and a validated ready request.
Ready requires the correct label **and the exact live iframe WindowProxy**;
another opaque-origin sibling cannot claim the destination's id. A ready
request resends only to its own configured frame. Removed/replaced frames do
not remain destinations; lazy inserted frames are discovered without waiting.

Tab, collapse and native details reveals schedule a rendering-phase resend,
including the existing JSXGraph assessment layout notification. The transport
does not inspect or await JSXGraph, MathJax, speech, Python, packages or Check.
Missing frames and callback/postMessage errors remain optional local failures.
The caller owns the public values projection; this helper neither decodes the
exact grading context nor invents a numeric codec.

Focused checks include four source/DOM cases and a real Chromium two-frame
fixture using this exact script without CDN dependencies. The browser fixture
proves source-spoof isolation, structured-clone values/null preservation,
details/tab layout resends, optional callback containment and disposal. It
does not load JSXGraph or a grading engine and does not establish first-visit,
full course figure migration or real Python grading acceptance.
