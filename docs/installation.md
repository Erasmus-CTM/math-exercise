# Installation and setup

[Start here](../README.md) · [Authoring guide](authoring.md)

## Most courses: the CTM Assessment umbrella

The [CTM Assessment](https://github.com/Erasmus-CTM/ctm-assessment) package
installs math-exercise together with AI feedback, JSXGraph and the Python
extensions at versions tested together. Use it unless you only need
mathematics.

## math-exercise on its own

```sh
quarto add Erasmus-CTM/math-exercise
```

```yaml
filters:
  - math-exercise
```

Requirements: Quarto 1.8.27 (the tested version) and a browser. Students'
browsers download Pyodide 0.27.2 and SymPy from jsDelivr: Pyodide starts loading
in the background when a page with exercises opens and SymPy on the first
**Check**. No `{pyodide}` block is needed; if a Pyodide extension is on the
page, math-exercise reuses its runtime.

Optional dependencies, needed only for some features:

| Feature | Install | If missing |
|---|---|---|
| **Feedback** button (AI feedback or a copyable prompt) | `quarto add Erasmus-CTM/ai-feedback` | Exercises render without the button, and each page with exercises prints one message naming this command. Set `math-exercise: {feedback: true}` to make it required, or `false` to silence the message. |
| Graphical answers, diagram context (`jsxgraph:<id>`) | `quarto add jsxgraph/jsxgraph-quarto` and add `jsxgraph` to `filters` | Not installed, or no block with that `assessment_id`: rendering stops with a message naming the fix. Installed but `jsxgraph` missing from `filters`: a `response:` exercise shows a message on the page; for `context:` the message appears when the learner asks for feedback. |
| Extra Pyodide packages (`#| packages: networkx`) | nothing to install | Loaded in the browser on first Check. |

Invalid exercise source (for example a malformed `mat[...]` or a diagram
reference without its block) stops rendering with a message. Before 0.9.0
these messages were printed but the render continued and published a broken
exercise.

Install each extension once per project. If the CTM Assessment umbrella is
also installed, its copies sit directly under `_extensions/` and a standalone
`quarto add Erasmus-CTM/...` goes under `_extensions/Erasmus-CTM/`; the short
filter name `math-exercise` then selects the umbrella's copy, so use the
qualified name `Erasmus-CTM/math-exercise` for the standalone one. Each
extension uses the ai-feedback installed next to it, so the two sets may use
different ai-feedback versions; only a page that combines filters from both
sets with different versions stops, with a message naming both. The umbrella
also provides JSXGraph: do not add `jsxgraph/jsxgraph-quarto` separately in
that project.

---

## Feedback setup

For feedback directly on the page, follow the [shared connection guide](https://github.com/Erasmus-CTM/ai-feedback/blob/main/docs/installation.md#provider-settings-and-data-sent). Without a connection, Feedback prepares a message to copy into an AI chat.
