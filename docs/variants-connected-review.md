# Connected local review

After `question-variants.py --project . --file lesson.qmd --label q generate25more`,
start the installed component's helper:

```sh
python _extensions/math-exercise/variants-review.py --project . --file lesson.qmd --label q
```

It prints and opens a random-token URL on `127.0.0.1` with an automatically
selected port. `--no-browser` prints the URL without opening it; `--port NUMBER`
selects a port. Stop with Ctrl-C. The helper shows resolved text previews, not
filter-rendered multilingual cards or live Check. Explicit review rendering
remains separate; ordinary Quarto preview detection is not supplied here.

Each individual or bulk decision is sent to the same-origin helper and saved
through the canonical wrapper. The wrapper rereads the selected authored file,
resolves current candidates, validates the entire batch and performs one leased
atomic manifest write. The browser supplies only the original lease and explicit
decisions; it cannot select project/source/manifest paths or supply trusted
candidate records. The only writable manifest is `_variants/LABEL.yml` for the
known safe label. Existing native restrictions still apply.

Successful save rebuilds the page from current source and manifest. An uncertain
or rejected response leaves decisions disabled and offers **Rebuild review**;
the page does not assert that a dropped response means no write occurred. A
changed source or stale lease must be reviewed afresh. Files are not watched.

Only the capability URL is served. Requests require its exact path and local
Host; decisions also require the exact local Origin and bounded JSON. The helper
serves no project files, offers no CORS exception and logs no request URLs.
The capability is local to this process and should not be shared.

Focused checks: `python -m unittest discover -s tests -p
test_variants_review_server.py`; `tests/browser/variants-review.mjs` uses an actual
installed canonical wrapper/native distribution and Chromium to verify save,
rebuild, stale lease and changed-source rejection. Set `CTM_CHECKERS_EXTENSION`
to the checker payload, `CTM_NATIVE_AUTHORING_SOURCE` to the canonical checkers
checkout and optionally `CTM_PLAYWRIGHT_MODULE` to a Playwright module. No browser
Python, CDN, JSXGraph or grading acceptance is implied.
