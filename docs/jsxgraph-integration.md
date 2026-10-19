# JSXGraph in math-exercise

Graphical answers and diagram context use the upstream
[`jsxgraph/jsxgraph-quarto`](https://github.com/jsxgraph/jsxgraph-quarto)
extension (MIT), version 1.1.0 or later. It is a declared dependency, not a copy
in this repository:

```sh
quarto add jsxgraph/jsxgraph-quarto
```

```yaml
filters: [jsxgraph, math-exercise]   # either order
```

[CTM Assessment](https://github.com/Erasmus-CTM/ctm-assessment) contains a
tested version; the commands above are for math-exercise's own development
builds. If an exercise refers to `jsxgraph:<id>`
(`response:` or `context:`) and the extension is not installed, or no JSXGraph
block on the page has `assessment_id="<id>"`, rendering stops with a message
saying what to add.

The bridge itself (`JXG.QuartoAssessment.register`, the graph editor
`JXG.QuartoGraphEditor`, layout refresh when a collapsed exercise opens) is
documented in the upstream README. A minimal registration:

```javascript
JXG.QuartoAssessment.register({
  board: board,
  response: () => ({ any: ['JSON', 'data'] }),
  ai: {
    render: true,
    summary: data => ({ itemCount: data.any.length })
  }
});
```

`response` may return any JSON-serializable value or a Promise of one. `board`
is needed only for `ai.render`. For graph-construction exercises see the
[graph-editor API reference](graph-editor.md).

## Use a diagram as feedback context

Ordinary typed-answer activities can reference a separate applet without
making the applet their answer source:

```yaml
#| context: lesson-context, jsxgraph:diagram-id
```

Give the JSXGraph block `assessment_id="diagram-id"`, register its board and
JSON state with the API above, and enable `ai.render`. Include all relevant
current geometry and view bounds in `response`; it supplies context here, not
the student's answer. Feedback attaches the current rendered board as an image
with role `context` and its state as a context material. The typed answer keeps
role `response`. A missing/unregistered board fails with an explicit message.

A plain-text activity uses `context="jsxgraph:diagram-id"` the same way. Copy
prompt mode shows the diagram image and a download link: attach that image when
pasting into an AI chat. Direct API mode includes it in the provider request.
The sandboxed iframe is accessed through the existing assessment message bridge.
