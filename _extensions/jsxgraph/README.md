# JSXGraph Quarto assessment bridge

This directory is a focused fork of
[`jsxgraph/jsxgraph-quarto`](https://github.com/jsxgraph/jsxgraph-quarto),
retaining its MIT license. It adds a generic `postMessage` assessment bridge
for sandboxed interactive HTML iframes.

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
registers its node/edge response with this bridge. See the
[graph-editor API reference](../../docs/graph-editor.qmd).

The fork uses the official jsDelivr JSXGraph assets for interactive HTML so it
does not duplicate the large upstream distribution files in this repository.
Static SVG/PDF export still follows the upstream filter implementation and may
require explicitly configured local `src_jxg` and `src_css` paths.
