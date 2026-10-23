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
