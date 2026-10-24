# Legacy authoring integration coverage

The active integration fixtures use native `variables` questions or ordinary
pools. They do not invoke the retired `parameters` generator or `variants.lua`.

| Fixture | Retained contract and canonical replacement |
| --- | --- |
| `author-imports.test.mjs` | Actual Quarto registration of built-in, custom, pool and native per-variant checker inputs; native checkers read exact `response.answers`/`response.teacher` context instead of interpolating source. Local/missing/malformed/CDN collector controls remain. |
| `variants-storage-render.test.mjs` | Two fresh native Quarto processes prove deterministic identities, derived values, rendered solution math and question/solution/context mathematical hash changes. The student payload has one canonical native record set and proposal `variant: null`. |
| `storage-revisions-render.test.mjs` | Ordinary pools isolate persistence policy: header ordering, unrelated additions and task reordering preserve identity; checker and each grading option change the revision. |
| `without-ai-render.test.mjs` | Ordinary checked and ungraded pools preserve unset/text/drop/on policy, static text/math and interactive-checker separation. Native authoring requires a real static grader, so an AI-only generated fixture is not a supported replacement. The pre-existing old-libs compatibility branch remains conditional. |

The obsolete claim that every unused generated variable or prose edit changes
content identity is superseded by the B1 contract in
`tests/test_variant_resolver.py`: `test_b1_prose_and_generated_variable_names_do_not_change_content_hash`
and `test_b1_order_operator_raw_prose_answer_and_grading_changes_void_approval`.
The same module exercises exact teacher markers and actual grading.
`native-variants-render.test.mjs` covers required approval, explicit optional/review,
changed hashes and stable approved numbers versus null proposal context.
`native-consumer.test.mjs` and the shared libraries' variant-store tests cover
identity restoration, same-content ties, seen cycles and grade invalidation.
Those existing contracts were not rerun as part of this test-only migration.

Focused migration validation: actual Quarto importer and four collector controls;
ordinary revision fixture; two-process native storage fixture; without-AI
unset/text/drop/on cases. No full site, broad npm campaign, browser grading or
first-visit loading acceptance is claimed.

## Retired generator-only leaves

The removed `test_variants.py`, `variants.test.mjs`, `variants-render.test.mjs`
and `fixtures/variants-pandoc.lua` called only the obsolete Cartesian generator
or its Lua adapter. Their substantive replacement contracts are:

- Exact marker/source transport, rounding and real teacher grading:
  `test_variant_resolver.py`, `native-variants-render.test.mjs` and the five real
  manual source/teacher/authored cases in `test_variant_examples.py`.
- Bounded native execution, require-before-invalid-arithmetic, duplicate-note
  handling, replay and no swallowed failure: checker native generation/batch/
  orchestration tests and component wrapper deadline/fresh-source tests.
- Stable identities, current/changed/gone decisions and stale approval gates:
  native history/orchestration tests, resolver B1 tests, and the actual Quarto
  approval/refusal fixtures. Cartesian fingerprints and copy-selection aliases
  are deliberately not retained.
- Markdown/raw-HTML/TeX transport and fixed field shapes:
  native Quarto render and consumer tests. The matrix example is manually fixed
  2×2 with four scalar fields; ordinary named/dynamic matrix tests are untouched.
- Browser selection, persistence and private context exclusion:
  `native-consumer.test.mjs` and actual controlled consumer/ordinary-pool browser
  leaves, alongside shared chooser/store tests.

`native-examples-render.test.mjs` additionally verifies these five authored
examples refuse a required zero-approved render, then emit review-only null
proposal identities without creating a manifest. The coordinate example grades
explicit scalar x/y fields; its board illustrates the circle and is not a new
native graphical-response protocol. No actual approval or student release is
part of this migration. Existing broader leaves are mapped here, not claimed
as rerun during cleanup.

The CI `rounding-variants --variants .` golden leaf invoked deleted legacy code
and is retired. The triangle now explicitly checks `round(ratio,3)` through
the native generator and canonical numeric grader in both focused example
checks. Native exact rounding/replay catalogue coverage also remains in checker
`test_variants_generation.py`; it was not rerun during this cleanup. CI installs
the verified native distribution and checker wheel before Python discovery. The
approval-less authoring page is excluded from the ordinary website render; a
separate explicit review step writes only `_review-examples`. Ordinary website
rendering and publishing retain required approval.
