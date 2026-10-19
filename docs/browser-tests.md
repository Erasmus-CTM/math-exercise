# Browser interaction checks

The small Playwright suite checks wiring that native checker tests cannot:
adding vertices and edges, clearing a graph, dragging fixed-x points, adjusting
the period frame, and drawing and submitting a continuous stroke. It uses real
pointer gestures, the rendered example pages, and their actual Pyodide checkers.
It does not call an AI service.

Use standard Playwright `.spec.mjs` files. Shared controls are covered in
`tests/browser/`. A unique exercise can keep its own interaction test beside its
native fixture as `_includes/tests/<exercise>.browser.spec.mjs`; the configuration
discovers both locations. Extension maintainers own the shared control tests;
course authors own tests for their custom interactions. Keep larger mathematical
case collections in the fast per-exercise [question tests](question-tests.md).

From the project root, including in the VS Code terminal:

```bash
npm ci
npx playwright install chromium
CTM_COMPONENT_DEV=1 quarto render
npm run test:browser
```

Install ctm-libs and JSXGraph and the native dependencies needed by the page
before rendering, and render with `CTM_COMPONENT_DEV=1`, as described in the
[development setup](installation.md#development-of-math-exercise) and the
question-test guide. The Playwright configuration starts a local HTTP server for `_site`.
Its failure report includes a screenshot and trace. Add a test or refine an
existing one when changing a gesture, control, or response transport.

The separate **Browser interactions** GitHub action runs on pull requests and
pushes that touch relevant sources, examples, dependencies, or test files. It
can also be started manually. A failure makes the job red and uploads the
failure evidence. Browser tests do not run during an ordinary Quarto render;
build-time question assertions continue to use the independent native runner.
