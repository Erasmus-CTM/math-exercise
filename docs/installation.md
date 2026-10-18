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
| **Feedback** button (AI feedback or a copyable prompt) | `quarto add Erasmus-CTM/ai-feedback` | Exercises render without the button and rendering prints one message naming this command. Set `math-exercise: {feedback: true}` to make it required, or `false` to silence the message. |
| Graphical answers, diagram context (`jsxgraph:<id>`) | `quarto add jsxgraph/jsxgraph-quarto` and add `jsxgraph` to `filters` | Rendering stops with a message naming this command. |
| Extra Pyodide packages (`#| packages: networkx`) | nothing to install | Loaded in the browser on first Check. |

Install each extension once per project. Do not combine these standalone
installations with the umbrella in the same project: the umbrella already
contains them, and two ai-feedback installations stop rendering with an
explicit message.

---

## Feedback setup

For feedback directly on the page, follow the [shared connection guide](https://github.com/Erasmus-CTM/ai-feedback/blob/main/docs/installation.md#provider-settings-and-data-sent). Without a connection, Feedback prepares a message to copy into an AI chat.
