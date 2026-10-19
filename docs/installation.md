# Installation and setup

[Start here](../README.md) · [Authoring guide](authoring.md)

## Install CTM Assessment

math-exercise is a part of [CTM Assessment](https://github.com/Erasmus-CTM/ctm-assessment),
which installs it together with AI feedback, JSXGraph and the Python
extensions at versions tested together. Install and list only the package:

```sh
quarto add https://erasmus-ctm.github.io/ctm-assessment/ctm-assessment.tar.gz
```

```yaml
filters: [ctm-assessment]
```

math-exercise uses CTM Assessment's library ctm-libs for its settings, its
languages, the page's Python runtime and AI feedback. Without the package a
page with math-exercise stops rendering with the install command above.

Requirements: Quarto 1.8.27 or later (the earliest version tested) and a browser. Students'
browsers download Pyodide 0.28.3 and SymPy from jsDelivr: Pyodide starts loading
in the background when a page with exercises opens and SymPy on the first
**Check**. No `{pyodide}` block is needed; if a Pyodide extension is on the
page, math-exercise reuses its runtime. The exercise scripts and styles are
files the browser caches, loaded once per page.

**Quarto 1.10:** this release sends pages with blocks such as
`{math-exercise}`, `{py-exercise}` or `{pyodide-python}` to Jupyter (an
upstream regression, reported). Until it is fixed, add `engine: markdown` to
the front matter of each such page (in `_quarto.yml` it has no effect), or use
Quarto 1.8.

| Feature | What it needs | If it is missing |
|---|---|---|
| **Feedback** button (AI feedback or a copyable prompt) | nothing: AI feedback is part of CTM Assessment | `math-exercise: {feedback: false}` hides the button; a site built without AI feedback (`ai-feedback: enabled: false`) has none. |
| Graphical answers, diagram context (`jsxgraph:<id>`) | the JSXGraph extension, part of CTM Assessment | No block with that `assessment_id`: rendering stops with a message naming the fix. |
| Extra Pyodide packages (`#| packages: networkx`) | nothing to install | Loaded in the browser on first Check. |

Invalid exercise source (for example a malformed `mat[...]` or a diagram
reference without its block) stops rendering with a message. Before 0.9.0
these messages were printed but the render continued and published a broken
exercise.

---

## Feedback setup

For feedback directly on the page, follow the [connection guide](https://github.com/Erasmus-CTM/ctm-libs/blob/main/docs/installation.md#provider-settings-and-data-sent). Without a connection, Feedback prepares a message to copy into an AI chat.

---

## Development of math-exercise

The repository builds and tests math-exercise without the CTM Assessment
package, against a ctm-libs installation (and JSXGraph for graphical answers).
Both are git-ignored here:

```sh
quarto add Erasmus-CTM/ctm-libs@main --no-prompt     # or a checkout: quarto add ../ctm-libs --no-prompt
quarto add jsxgraph/jsxgraph-quarto --no-prompt
CTM_COMPONENT_DEV=1 quarto render
```

`CTM_COMPONENT_DEV=1` tells the component's `ctm-bootstrap.lua` (a copy of
ctm-libs' `bootstrap/ctm-bootstrap.lua`, kept byte-identical) that this is a
development build; without it the render stops because the package is
missing. CI does the same with the ctm-libs commit under test (the
`CTM-Review-Refs` trailer of a review commit, else ctm-libs `main`).

Regression tests: install Node dependencies with `npm ci` and the two
extensions above, then run `npm test`. The tests read ctm-libs' files from
`CTM_LIBS_EXTENSION` (for example `_extensions/Erasmus-CTM/ctm-libs`; without
the variable they look in `_extensions/`) and render their projects with
`CTM_COMPONENT_DEV=1`. Set `JSXGRAPH_EXTENSION` if JSXGraph is installed
outside `_extensions/`. The checker tests also require Python with SymPy 1.13
or later and NetworkX 3.4 or later (CI uses the browser's SymPy 1.13.3).
Install Quarto (or set `QUARTO_BIN`) to run the rendered-document tests; they
are skipped when Quarto is unavailable. CI requires and runs them. The tests
use local renderers and a mocked AI endpoint; no model or credentials are
needed. In VS Code, **Terminal → Run Task…** offers the same commands
(`.vscode/tasks.json`): the default test task runs the tests, the default
build task renders and then tests. For the Playwright tests see the
[browser-test guide](browser-tests.md).
