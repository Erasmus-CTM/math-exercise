# JSXGraph Quarto assessment bridge

This directory is a focused fork of
[`jsxgraph/jsxgraph-quarto`](https://github.com/jsxgraph/jsxgraph-quarto),
retaining its MIT license. It adds a generic `postMessage` assessment bridge
for sandboxed interactive HTML iframes.

The same bridge carries layout notifications when a collapsed
`math-exercise` is opened. Every JSXGraph board in the iframe is resized and
fully updated after the parent layout settles. This behavior is shared by the
graph editor and by custom graphical-answer boards.

## Added API

Give a block a stable `assessment_id` and register a JSON response provider:

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
is needed only for `ai.render`. `ai.summary` and `ai.render` are optional.

For simple undirected graph-construction exercises, the injected
`JXG.QuartoGraphEditor` API provides a standard free-placement editor and
registers its node/edge response with this bridge. Its shared `summarize`
helper supplies adjacency, degrees, components, isolated vertices, and cycle
rank for AI feedback without sending drawing coordinates. See the
[graph-editor API reference](../../docs/graph-editor.md).

The fork uses the official jsDelivr JSXGraph assets for interactive HTML so it
does not duplicate the large upstream distribution files in this repository.
Static SVG/PDF export still follows the upstream filter implementation and may
require explicitly configured local `src_jxg` and `src_css` paths.
