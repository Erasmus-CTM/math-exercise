# Native build-time variants

The former `parameters`/`derived` generator and its browser selection controls
have been retired on this authoring branch. Legacy syntax fails explicitly;
there is no alias or converter. Write `variables` manually using the exact
native API, then review actual tested proposals before approving them.

The [five source examples](../generated-variants.qmd) each live in
`_includes/variants/`. They use `pick`, named `field-labels`, distinct `note`
values and exact `{@expression@}` mathematical or `{#expression#}` raw markers.
Custom checkers read `response.answers`, `response.variables` and
`response.teacher`; they do not interpolate executable checker source.
The coupled teacher answers are the valid positive split `1,total-1`.
The matrix example has four scalar fields assembled into a fixed 2×2 Matrix;
it does not implement native dynamic named matrices. The circle example grades
two typed coordinates, with a separate illustrative board; it does not promise
native graphical-response context. Ordinary dynamic/named matrix and graphical
assessment examples remain unchanged.

An ordinary render defaults to required approval and refuses zero-approved
questions. `CTM_VARIANTS=review quarto render generated-variants.qmd --profile variants-review` explicitly
renders nonstudent proposals with a review banner and null variant identity.
`CTM_VARIANTS=optional` is the explicit OPEN exception and emits warnings.
Neither route records teacher decisions or invents a variant number zero.
The approval-less authoring page is excluded from the ordinary example website;
CI renders it separately into `_review-examples` as a review artifact only.

Install the authoring-capable CTM pack, including its verified checker wheel and
separate native authoring inventory. Legacy `setup.py` installation alone is
insufficient. For one included question, run from the project directory:

```sh
python _extensions/math-exercise/question-variants.py \
  --project . --file _includes/variants/triangle.qmd \
  --label variant-triangle generate25more
python _extensions/math-exercise/variants-review.py \
  --project . --file _includes/variants/triangle.qmd --label variant-triangle
```

The helper shows the current overview and actual rendered student views. Saving
uses the current source and manifest lease. Downloaded decisions are rechecked
against fresh disk source; changed content needs explicit reapproval. Historical
numbers are retained and never reused. Reject with a reason; do not delete old
history to conceal a changed question.

See [the CLI contract](native-variants-cli.md),
[connected review](variants-connected-review.md), and
[the native adapter](native-variants-authoring.md) for bounded execution,
installed import verification, failure/timeout semantics and remaining browser
and live GitHub acceptance limits. There are no approvals in these examples and
no student deployment is authorized by their focused source/build checks.
