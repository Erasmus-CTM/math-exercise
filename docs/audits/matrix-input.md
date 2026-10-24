> Current location (step 6): the editor now lives in ctm-libs at
> `ui/ctm-matrix-input.{js,css}` and is registered by `ctm.matrix.use()`.
> This audit retains its original paths as historical evidence.

# Reusable matrix input audit

Base: `4eaca0577249f88b9a712d4b553d92d7fedddf83`.

The existing dynamic editor was extracted into `matrix-input.js` and `matrix-input.css`; the math-exercise adapter retains its canonical empty-matrix and checker feedback policies. The component preserves raw strings and has no Python or grading dependency.

An independent Sol xhigh audit reviewed the implementation before its pull request. Three findings were fixed and re-reviewed: duplicate names must fail before mounting; legacy checker assessment arrays must be clipped/type-checked by the adapter; permanently zero-sized opposite axes must disable impossible restoration controls. The final audit reported no remaining blocking findings.

Validation: 58 focused Node tests passed across editor API/DOM, adapter, vector/matrix, shared feedback and context regressions. Full rendered-site and browser checks run in GitHub Actions; local render attempts were affected by the host Quarto/Jupyter configuration.
