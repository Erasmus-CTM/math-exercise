import { test, expect } from "playwright/test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
// These cases control provider/grader boundaries. COI activation/reload is
// exercised by P13's real worker acceptance, not by this structural fixture.
test.use({ serviceWorkers: "block" });
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const root = path.dirname(repoRoot);
const ciSource = path.join(repoRoot, "_ctm-checkers-source", "src");
const checkerSource =
  process.env.CTM_CHECKERS_SOURCE ||
  (existsSync(ciSource) ? ciSource : path.join(root, "ctm-checkers", "src"));
const derivative = (power = 3, recipe = true) => ({
  question: `Differentiate $f(x)=x^${power}$. $f'(x)=$ _[1]`,
  fields: [
    {
      answer: `${power}*x^${power - 1}`,
      ...(recipe
        ? { recipe: { op: "diff", expr: `x^${power}`, var: "x" } }
        : {}),
    },
  ],
  mode: "equivalent",
  vars: "x",
  change: "A fresh power function.",
});
async function report(child) {
  if (!(await child.locator(".math-generated-report").isVisible()))
    await child.locator(".math-generated-more summary").click();
  await child
    .getByRole("button", {
      name: "I think the expected answer is wrong",
      exact: true,
    })
    .filter({ visible: true })
    .click();
}
async function open(page, provider = {}) {
  const traffic = [];
  let generated = 0,
    solved = 0;
  await page.context().route("https://cdn.jsdelivr.net/npm/katex@*/**", async (route) => {
    const relative = new URL(route.request().url()).pathname.replace(
      /^\/npm\/katex@[^/]+\//,
      "",
    );
    const file = path.join(repoRoot, "node_modules", "katex", relative);
    const type = file.endsWith(".css")
      ? "text/css"
      : file.endsWith(".mjs")
        ? "text/javascript"
        : "application/octet-stream";
    await route.fulfill({ body: readFileSync(file), contentType: type });
  });
  await page.context().route(
    "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/**",
    async (route) => {
      const name = path.basename(new URL(route.request().url()).pathname),
        runtime = path.join(repoRoot, "node_modules", "pyodide", name),
        cached = path.join(repoRoot, "test-results", "similar-runtime", name);
      const file = existsSync(runtime) ? runtime : cached;
      const type =
        name.endsWith(".js") || name.endsWith(".mjs")
          ? "text/javascript"
          : name.endsWith(".json")
            ? "application/json"
            : name.endsWith(".wasm")
              ? "application/wasm"
              : "application/octet-stream";
      await route.fulfill({
        body: readFileSync(file),
        contentType: type,
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await page.exposeFunction("__ctmCheck", async (name, request) => {
    const run = spawnSync(
      process.env.CTM_TEST_PYTHON || "python",
      [
        "-c",
        'import sys,json; from ctm_checkers.browser import call; data=json.load(sys.stdin); print(call(data["name"], {"_ctm_request":json.dumps(data["request"])}))',
      ],
      {
        input: JSON.stringify({ name, request }),
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONPATH: [checkerSource, process.env.PYTHONPATH || ""].join(
            path.delimiter,
          ),
        },
      },
    );
    if (run.status !== 0) throw new Error(run.stderr);
    return run.stdout.trim();
  });
  await page.addInitScript(
    ({ realPython }) => {
      sessionStorage.setItem(
        "ai-feedback-config-v1",
        JSON.stringify({
          mode: "api",
          baseUrl: "https://provider.invalid/v1",
          model: "fast-test",
          generatorModel: "reasoning-test",
          apiKey: "mock-only",
          storage: "session",
        }),
      );
      window.__pythonCalls = 0;
      window.__resultEvents = [];
      document.addEventListener("ctm:result", (event) =>
        window.__resultEvents.push(event.detail),
      );
      if (realPython) return;
      const py = {
        loadPackage: async () => {
          window.__pythonCalls++;
        },
        runPythonAsync: async () => {
          throw Error("Unexpected Python source execution");
        },
      };
      const stubs = {
        ensurePyodide: async () => py,
        ensureGuard: async () => {},
        ensureCheckers: async () => {},
        callCheckers: async (py, name, request) => {
          window.__pythonCalls++;
          return window.__ctmCheck(name, request);
        },
        stopCount: () => 0,
        whenSlow: () => () => {},
        trackInitialUI: (promise) => {
          window.__mathReady = promise;
        },
        whenInitialUIReady: () => Promise.resolve(),
        canStop: () => false,
      };
      let runtime;
      Object.defineProperty(window, "MathExerciseRuntime", {
        configurable: true,
        get: () => runtime,
        set: (value) => { runtime = Object.assign(value, stubs); },
      });
    },
    { realPython: provider.realPython === true },
  );
  await page.route("**/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    traffic.push(body);
    const solver = body.messages.some((message) =>
      message.content?.startsWith(
        "Solve this mathematical problem independently",
      ),
    );
    const text = solver
      ? await (provider.solve?.(++solved, body) ||
          JSON.stringify({ answers: ["3*x^2"] }))
      : body.max_tokens === 16384
        ? await (provider.generate?.(++generated, body) ||
            JSON.stringify(derivative()))
        : "Consider the exponent in the power rule.";
    await route
      .fulfill({
        json: {
          choices: [{ finish_reason: "stop", message: { content: text } }],
        },
      })
      .catch(() => {});
  });
  await page.goto(process.env.CTM_SIMILAR_PAGE || "/similar-problems.html", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => !!window.MathExercise?.setupCell);
  if (!provider.realPython)
    await page.waitForFunction(() => !!window.__mathReady);
  if (provider.expand !== false)
    for (const toggle of await page.locator(".math-similar-toggle").all())
      if ((await toggle.getAttribute("aria-expanded")) === "false")
        await toggle.click();
  return {
    traffic,
    original: page
      .locator('.math-exercise-cell[data-label="similar-derivative"]')
      .first(),
  };
}

test("computed key, Check, score isolation, copy and restore without AI/Python", async ({
  page,
}) => {
  const { traffic, original } = await open(page);
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1);
  await child.locator(".math-input").fill("3*x^2");
  await child.locator(".math-check-btn").click();
  await expect(child.locator(".math-feedback-area")).toContainText("Correct");
  expect(await page.evaluate(() => window.__resultEvents)).toEqual([]);
  await page.evaluate(() => {
    window.__copied = "";
    window.CTMCopy.text = (text) => {
      window.__copied = text;
    };
  });
  await original.locator(".math-copy-answer").click();
  expect(await page.evaluate(() => window.__copied)).toContain("Differentiate");
  const calls = traffic.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  await expect(
    original.locator(".math-generated-problem .math-input"),
  ).toHaveValue("3*x^2");
  expect(traffic.length).toBe(calls);
  expect(await page.evaluate(() => window.__pythonCalls)).toBe(0);
});

test("independent solve labels an unverified key and preserves author guidance", async ({
  page,
}) => {
  const { traffic, original } = await open(page, {
    generate: () => JSON.stringify(derivative(3, false)),
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-generated-label")).toContainText(
    /unverified/i,
  );
  expect(traffic).toHaveLength(2);
  expect(traffic[0].messages[0].content).toContain("Keep problems");
  expect(traffic[0].messages[0].content).toContain("product or chain rule");
  const solver = JSON.parse(traffic[1].messages[1].content);
  expect(solver.fields).toBe(1);
  expect(solver).not.toHaveProperty("answer");
  expect(solver).not.toHaveProperty("key");
});

test("two rejected candidates never reach the panel or store", async ({
  page,
}) => {
  const { traffic, original } = await open(page, {
    generate: () =>
      JSON.stringify({
        ...derivative(),
        fields: [
          { answer: "9", recipe: { op: "diff", expr: "x^3", var: "x" } },
        ],
      }),
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-similar-status")).toContainText(
    "Could not create",
  );
  await expect(original.locator(".math-generated-problem")).toHaveCount(0);
  expect(traffic).toHaveLength(2);
});

test("cancel discards a late provider reply", async ({ page }) => {
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  const { original } = await open(page, {
    generate: async () => {
      await blocked;
      return JSON.stringify(derivative());
    },
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(
    original.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await original.getByRole("button", { name: "Cancel", exact: true }).click();
  release();
  await expect(original.locator(".math-generated-problem")).toHaveCount(0);
  await expect(
    original.getByRole("button", { name: "Harder", exact: true }),
  ).toBeEnabled();
});

test("local flag re-check disputes a computed key, changes wrong verdict and survives reload", async ({
  page,
}) => {
  const { original, traffic } = await open(page, {
    solve: () => JSON.stringify({ answers: ["4*x^2"] }),
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1);
  await child.locator(".math-input").fill("0");
  await child.locator(".math-check-btn").click();
  await expect(child.locator(".math-feedback-area")).toContainText(
    "Not correct",
  );
  await report(child);
  await expect(child.locator(".math-generated-label")).toContainText(
    "disputed",
  );
  await expect(child.locator(".math-feedback-area")).toContainText(
    "Can’t confirm",
  );
  await expect(
    child.getByRole("button", { name: "Create another problem" }),
  ).toBeVisible();
  expect(traffic).toHaveLength(2);
  expect(JSON.stringify(traffic[1].messages)).not.toContain('"response"');
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(original.locator(".math-generated-label")).toContainText(
    "disputed",
  );
  expect(traffic).toHaveLength(2);
  expect(await page.evaluate(() => window.__pythonCalls)).toBe(0);
});

test("same direction uses the same checked flow; copy mode disables actions", async ({
  page,
}) => {
  const { original, traffic } = await open(page);
  await original
    .getByRole("button", { name: "Another one like this", exact: true })
    .click();
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  expect(JSON.parse(traffic[0].messages[1].content).direction).toBe("same");
  await page.evaluate(() =>
    window.AIFeedback.saveConfig({
      ...window.AIFeedback.loadConfig(),
      mode: "copy",
    }),
  );
  await expect(
    original.getByRole("button", { name: "Harder", exact: true }),
  ).toBeDisabled();
  await report(original.locator(".math-generated-problem"));
  await expect(original.locator(".math-generated-label")).toContainText(
    "could not be checked again",
  );
  expect(traffic).toHaveLength(1);
});

test("fixed matrix keys use component selections", async ({ page }) => {
  await open(page, {
    generate: () =>
      JSON.stringify({
        question:
          "Transpose $\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$: mat[1,2;3,4]",
        mode: "equivalent",
        vars: "",
        fields: [1, 3, 2, 4].map((answer, index) => ({
          answer: String(answer),
          recipe: {
            op: "transpose",
            expr: "Matrix([[1,2],[3,4]])",
            select: [Math.floor(index / 2), index % 2],
          },
        })),
      }),
  });
  const original = page
    .locator('.math-exercise-cell[data-label="similar-matrix"]')
    .first();
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(
    original.locator(".math-generated-problem .math-input"),
  ).toHaveCount(4);
});

test("authored checker rejects six-coordinate givens even with an agreeing independence answer", async ({
  page,
}) => {
  const make = (A) => ({
    question: "Are the columns of $A={{A}}$ independent? Enter 1 or 0: _[1]",
    mode: "custom",
    vars: "",
    checker: "original",
    data: { A },
    fields: [{ answer: "1" }],
  });
  const { traffic } = await open(page, {
    generate: (attempt) =>
      JSON.stringify(
        make(
          attempt === 1
            ? [[1], [0], [0], [0], [0], [0]]
            : [
                [1, 0],
                [0, 1],
                [0, 0],
              ],
        ),
      ),
    solve: () => JSON.stringify({ answers: ["1"] }),
  });
  const original = page
    .locator('.math-exercise-cell[data-label="similar-independence"]')
    .first();
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  expect(traffic.filter((body) => body.max_tokens === 16384)).toHaveLength(2);
});

for (const profile of ["exam", "without-ai", "default-off"])
  test(`${profile} cannot revive saved generated problems`, async ({
    page,
  }) => {
    const { original, traffic } = await open(page);
    await original.getByRole("button", { name: "Harder", exact: true }).click();
    await expect(original.locator(".math-generated-problem")).toHaveCount(1);
    const fixture = path.join(
      repoRoot,
      "_site",
      `similar-${profile}`,
      "similar-problems.html",
    );
    await page.route("**/similar-problems.html", (route) =>
      route.fulfill({
        body: readFileSync(fixture, "utf8").replaceAll(
          '\"similar-problems_files/',
          '\"similar-' + profile + "/similar-problems_files/",
        ),
        contentType: "text/html",
      }),
    );
    const calls = traffic.length;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.MathExercise?.setupCell);
    await expect(page.locator(".math-check-btn").first()).toBeEnabled();
    await expect(page.locator(".math-similar-controls")).toHaveCount(0);
    await expect(page.locator(".math-generated-problem")).toHaveCount(0);
    expect(traffic.length).toBe(calls);
  });

test("exercise false overrides course opt-in", async ({ page }) => {
  await open(page);
  const fixture = path.join(
    repoRoot,
    "_site",
    "similar-exercise-off",
    "similar-problems.html",
  );
  await page.route("**/similar-problems.html", (route) =>
    route.fulfill({
      body: readFileSync(fixture, "utf8").replaceAll(
        '\"similar-problems_files/',
        '\"similar-exercise-off/similar-problems_files/',
      ),
      contentType: "text/html",
    }),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const first = page
    .locator('.math-exercise-cell[data-label="similar-derivative"]')
    .first();
  await expect(first.locator(".math-similar-controls")).toHaveCount(0);
  await expect(page.locator(".math-similar-controls")).toHaveCount(3);
});

test("hostile prose stays escaped on generation and changed-source restore", async ({
  page,
}) => {
  const candidate = derivative();
  candidate.question =
    '<img src=x onerror="window.__unsafe=true"> ' + candidate.question;
  const { original, traffic } = await open(page, {
    generate: () => JSON.stringify(candidate),
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  await expect(original.locator(".math-generated-problem img")).toHaveCount(0);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage).filter((key) =>
      key.startsWith("ctm|1|"),
    )) {
      let r;
      try {
        r = JSON.parse(localStorage.getItem(key));
      } catch {
        continue;
      }
      if (r?.inputs?.generated) {
        r.source = "changed";
        localStorage.setItem(key, JSON.stringify(r));
      }
    }
  });
  const calls = traffic.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  await expect(original.locator(".math-generated-problem img")).toHaveCount(0);
  expect(await page.evaluate(() => !!window.__unsafe)).toBe(false);
  expect(traffic.length).toBe(calls);
  expect(await page.evaluate(() => window.__pythonCalls)).toBe(0);
});

for (const large of [false, true])
  test(`retention enforces ${large ? "UTF-8 byte" : "ten-problem count"} limit`, async ({
    page,
  }) => {
    const { original } = await open(page, {
      generate: (attempt) => {
        const spec = derivative(attempt + 2);
        if (large) spec.question += "\n" + "ø".repeat(4500);
        return JSON.stringify(spec);
      },
    });
    for (let index = 0; index < 12; index++) {
      await original
        .getByRole("button", { name: "Harder", exact: true })
        .click();
      await expect(
        original.getByRole("button", { name: "Harder", exact: true }),
      ).toBeEnabled();
    }
    const count = await original.locator(".math-generated-problem").count();
    expect(count).toBeGreaterThan(0);
    if (large) expect(count).toBeLessThan(10);
    else expect(count).toBe(10);
    const sizes = await page.evaluate(() =>
      Object.keys(localStorage).flatMap((key) => {
        try {
          const text = localStorage.getItem(key),
            r = JSON.parse(text);
          return r?.inputs?.generated
            ? [new TextEncoder().encode(text).length]
            : [];
        } catch {
          return [];
        }
      }),
    );
    expect(sizes).toHaveLength(1);
    expect(sizes[0]).toBeLessThanOrEqual(64 * 1024);
  });

test("an agreeing re-check retains the flag, including in copy/export, without another reload request", async ({
  page,
}) => {
  const { original, traffic } = await open(page);
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1);
  await report(child);
  await expect(child.locator(".math-generated-label")).toContainText(
    "independent solution matched",
  );
  await expect(child.locator(".math-generated-label")).toContainText(
    "Reported by you",
  );
  await page.evaluate(() => {
    window.__copied = "";
    window.CTMCopy.text = (text) => (window.__copied = text);
  });
  await original.locator(".math-copy-answer").click();
  expect(await page.evaluate(() => window.__copied)).toContain(
    '"flagged":true',
  );
  expect(
    await page.evaluate(() =>
      window.CTMStore.exportItems()
        .map((item) => item.parts)
        .flat()
        .some((part) => part.text?.includes('"flagged":true')),
    ),
  ).toBe(true);
  const calls = traffic.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(original.locator(".math-generated-label")).toContainText(
    "independent solution matched",
  );
  expect(traffic.length).toBe(calls);
});

test("changing the original variant cancels generation and discards late output", async ({
  page,
}) => {
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  const { original } = await open(page, {
    generate: async () => {
      await blocked;
      return JSON.stringify(derivative());
    },
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(
    original.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await original.evaluate((cell) =>
    cell.dispatchEvent(
      new CustomEvent("math-exercise:variant-change", { bubbles: true }),
    ),
  );
  release();
  await expect(original.locator(".math-generated-problem")).toHaveCount(0);
  await expect(
    original.getByRole("button", { name: "Harder", exact: true }),
  ).toBeEnabled();
});

test("computed generation and grading run in the real browser Pyodide runtime", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { original } = await open(page, { realPython: true });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1, { timeout: 90000 });
  await child.locator(".math-input").fill("3*x^2");
  await child.locator(".math-check-btn").click();
  await expect(child.locator(".math-feedback-area")).toContainText("Correct", {
    timeout: 30000,
  });
  expect(await page.evaluate(() => window.__resultEvents)).toEqual([]);
});

test("practice feedback does not change the original teaching hint counter or create separate saved practice keys", async ({
  page,
}) => {
  const { original } = await open(page);
  await original.locator(".math-exercise-question .math-input").fill("0");
  await original.locator(".math-feedback-btn").click();
  await expect(original.locator(".ai-feedback-output")).toContainText(
    "power rule",
  );
  const before = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith("ai-feedback-hints-"))
        .map((key) => [key, sessionStorage.getItem(key)]),
    ),
  );
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1);
  await child.locator(".math-input").fill("0");
  await child.locator(".math-feedback-btn").click();
  await expect(child.locator(".ai-feedback-output")).toContainText(
    "power rule",
  );
  const after = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith("ai-feedback-hints-"))
        .map((key) => [key, sessionStorage.getItem(key)]),
    ),
  );
  expect(after).toEqual(before);
  expect(await page.evaluate(() => sessionStorage.getItem("null|policy"))).toBe(
    null,
  );
});

test("restored practice retains its own grading options after the original changes", async ({
  page,
}) => {
  const { original, traffic } = await open(page);
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  const html = readFileSync(
    path.join(repoRoot, "_site", "similar-problems.html"),
    "utf8",
  )
    .replace('data-reject=""', 'data-reject="3*x^2"')
    .replace(/data-ctm-source="[^"]+"/, 'data-ctm-source="0000000000000000"');
  await page.route("**/similar-problems.html", (route) =>
    route.fulfill({ body: html, contentType: "text/html" }),
  );
  const calls = traffic.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1);
  expect(traffic.length).toBe(calls);
  expect(await page.evaluate(() => window.__pythonCalls)).toBe(0);
  await child.locator(".math-input").fill("3*x^2");
  await child.locator(".math-check-btn").click();
  await expect(child.locator(".math-feedback-area")).toContainText("Correct");
});

test("clearing practice during an in-flight check cannot restore saved work", async ({
  page,
}) => {
  const { original } = await open(page);
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1);
  await page.evaluate(() => {
    const check = window.__ctmCheck;
    window.__ctmCheck = async (name, request) => {
      if (name === "math_exercise.check" && request.student === "0") {
        const result = await new Promise(
          (resolve) => (window.__finishCheck = resolve),
        );
        window.__checkSettled = true;
        return result;
      }
      return check(name, request);
    };
  });
  await child.locator(".math-input").fill("0");
  await child.locator(".math-check-btn").click();
  await page.waitForFunction(() => !!window.__finishCheck);
  await page.evaluate(() => {
    window.CTMStore.clearPage();
    window.__finishCheck(JSON.stringify({ status: "wrong", score: 0 }));
  });
  await page.waitForFunction(() => window.__checkSettled);
  await expect(original.locator(".math-generated-problem")).toHaveCount(0);
  const saved = await page.evaluate(() =>
    Object.keys(localStorage).flatMap((key) => {
      try {
        const value = JSON.parse(localStorage.getItem(key));
        return value?.component === "math-exercise" ? [value] : [];
      } catch {
        return [];
      }
    }),
  );
  expect(saved).toHaveLength(0);
});

test("JSON code fences and harmless variable formatting retain computed-key checking", async ({
  page,
}) => {
  const { original } = await open(page, {
    generate: () => {
      const spec = derivative();
      delete spec.mode;
      spec.vars = ["x"];
      return "```json\n" + JSON.stringify(spec) + "\n```";
    },
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  await expect(original.locator(".math-generated-label")).not.toContainText(
    /unverified/i,
  );
  expect(await page.evaluate(() => window.__pythonCalls)).toBeGreaterThan(0);
});

test("format repair names the failed contract and offers concrete scalar and matrix schemas", async ({
  page,
}) => {
  const { original, traffic } = await open(page, {
    generate: (n) =>
      JSON.stringify({
        ...derivative(),
        ...(n === 1 ? { mode: "matrix" } : {}),
      }),
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  expect(traffic).toHaveLength(2);
  expect(traffic[1].messages[0].content).toContain(
    "Unsupported problem mode or fields",
  );
  const prompt = JSON.parse(traffic[0].messages[1].content);
  expect(prompt.outputExamples).toHaveLength(2);
  expect(prompt.outputExamples[1].fields[3].recipe.select).toEqual([1, 1]);
});

test("persistent format failures show their reason without calling Python or admitting a problem", async ({
  page,
}) => {
  const { original, traffic } = await open(page, {
    generate: () => JSON.stringify({ ...derivative(), mode: "matrix" }),
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-similar-status")).toContainText(
    "Could not create",
  );
  await original.locator(".math-similar-status summary").click();
  await expect(original.locator(".math-similar-status pre")).toHaveText(
    "Unsupported problem mode or fields",
  );
  await expect(original.locator(".math-generated-problem")).toHaveCount(0);
  expect(traffic).toHaveLength(4);
  expect(
    traffic[2].messages.some(
      (m) => m.role === "assistant" && m.content.includes("matrix"),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.__pythonCalls)).toBe(0);
});

test("finite JSON numeric answers still require computed agreement", async ({
  page,
}) => {
  const { original } = await open(page, {
    generate: () =>
      JSON.stringify({
        question: "Differentiate $f(x)=3x$. _[1]",
        fields: [{ answer: 3, recipe: { op: "diff", expr: "3*x", var: "x" } }],
        vars: ["x"],
      }),
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  await expect(original.locator(".math-generated-label")).not.toContainText(
    /unverified/i,
  );
});

test("independent re-solve accepts a JSON fence without weakening answer comparison", async ({
  page,
}) => {
  const { original } = await open(page, {
    generate: () => JSON.stringify(derivative(3, false)),
    solve: () => '```json\n{"answers":["3*x^2"]}\n```',
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  await expect(original.locator(".math-generated-label")).toContainText(
    /unverified/i,
  );
});

test("implicit multiplication remains a mathematical answer after Check and AI feedback", async ({
  page,
}) => {
  const { original } = await open(page, { realPython: true });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1, { timeout: 90000 });
  await child.locator(".math-input").fill("21x");
  await child.locator(".math-check-btn").click();
  await expect(child.locator(".math-feedback-area")).toContainText(
    "Not correct",
  );
  await expect(child.locator(".math-generated-saved")).toHaveText("wrong");
  await child.locator(".math-feedback-btn").click();
  await expect(child.locator(".ai-feedback-output")).toContainText(
    "power rule",
  );
  await expect(child.locator(".math-generated-saved")).toHaveText("wrong");
  await child.locator(".math-input").fill("3x^2");
  await child.locator(".math-check-btn").click();
  await expect(child.locator(".math-feedback-area")).toContainText("Correct");
  await expect(child.locator(".math-generated-saved")).toHaveText("correct");
  expect(await page.evaluate(() => window.__resultEvents)).toEqual([]);
});

test("generated grading inherits the original mode rather than the model preference", async ({
  page,
}) => {
  const { original } = await open(page, {
    generate: () => JSON.stringify({ ...derivative(), mode: "numeric" }),
  });
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1);
  await expect(child).toHaveAttribute("data-mode", "equivalent");
});

test("compact practice disclosure preserves work and exposes maintenance with keyboard focus", async ({
  page,
}) => {
  const { original } = await open(page, { expand: false });
  const trigger = original.locator(".math-similar-toggle"),
    panel = original.locator(".math-similar-panel");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  await expect(original.locator(".ai-feedback-gear")).toHaveCount(1);
  await expect(original.locator(".math-copy-answer")).toHaveAccessibleName(
    "Copy answers including generated practice",
  );
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  expect(
    await panel.locator(".math-similar-controls button").allTextContents(),
  ).toEqual(["Easier", "Another one like this", "Harder"]);
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1);
  await expect(child.locator(".math-input")).toBeFocused();
  await expect(
    child.getByRole("button", {
      name: "I think the expected answer is wrong",
      exact: true,
    }),
  ).toBeHidden();
  await child.locator(".math-input").fill("42");
  await trigger.click();
  await expect(panel).toBeHidden();
  await trigger.click();
  await expect(child.locator(".math-input")).toHaveValue("42");
  await child.locator(".math-generated-more summary").focus();
  await page.keyboard.press("Enter");
  await expect(
    child.getByRole("button", {
      name: "I think the expected answer is wrong",
      exact: true,
    }),
  ).toBeVisible();
  await child.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(child).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("copy-mode explanation is visible inside practice and mobile controls stay within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 850 });
  const { original } = await open(page, { expand: false });
  await page.evaluate(() =>
    window.AIFeedback.saveConfig({
      ...window.AIFeedback.loadConfig(),
      mode: "copy",
    }),
  );
  await original.locator(".math-similar-toggle").click();
  await expect(original.locator(".math-similar-copy-notice")).toContainText(
    "Generating problems requires Direct API",
  );
  await expect(
    original.getByRole("button", { name: "Harder", exact: true }),
  ).toBeDisabled();
  const boxes = await original
    .locator(".math-exercise-controls button,.math-similar-controls button")
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => n.getClientRects().length)
        .map((n) => ({
          left: n.getBoundingClientRect().left,
          right: n.getBoundingClientRect().right,
        })),
    );
  expect(boxes.every((box) => box.left >= 0 && box.right <= 375)).toBe(true);
});

test("shared Settings stack keeps original navigation credit during practice-only saves", async ({
  page,
}) => {
  const { original } = await open(page);
  await original.locator(".math-exercise-question .math-input").fill("2*x");
  await original.locator(".math-check-btn").first().click();
  await expect(original.locator(".math-feedback-area").first()).toContainText(
    "Correct",
  );
  const tile = page.locator(".ctm-question-tile").first();
  await expect(tile).toHaveAttribute("data-status", "correct");
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1);
  await expect(tile).toHaveAttribute("data-status", "correct");
  await child.locator(".math-input").fill("0");
  await child.locator(".math-check-btn").click();
  await expect(child.locator(".math-generated-saved")).toHaveText("wrong");
  await expect(tile).toHaveAttribute("data-status", "correct");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(tile).toHaveAttribute("data-status", "correct");
});

test("restoring practice-only work leaves the original navigation unattempted", async ({
  page,
}) => {
  const { original } = await open(page);
  const tile = page.locator(".ctm-question-tile").first();
  await expect(tile).toHaveAttribute("data-status", "unattempted");
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  await expect(tile).toHaveAttribute("data-status", "unattempted");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(tile).toHaveAttribute("data-status", "unattempted");
});

test("combined preview puts saved answers inside the shared Settings dialog", async ({
  page,
}) => {
  await open(page, { expand: false });
  await expect(page.locator(".ctm-save-bar")).toBeHidden();
  await expect(page.locator(".ctm-settings-toolbar")).toBeVisible();
  await page.locator(".ctm-settings-toolbar .ctm-icon-button").first().click();
  await expect(page.locator("#ctm-settings")).toBeVisible();
  await expect(page.locator("#ctm-settings .ctm-save-bar")).toBeVisible();
  await expect(
    page.locator("#ctm-settings #ai-feedback-settings"),
  ).toBeVisible();
  await expect(page.locator("dialog#ai-feedback-settings")).toHaveCount(0);
  await page.locator("#ctm-settings .ctm-settings-close").click();
  await expect(page.locator(".ctm-save-bar")).toBeHidden();
});

test("flat matrix slots with explicit cell recipes render as a proper grid and restore without AI or Python", async ({
  page,
}) => {
  const flat =
    "Find the inverse of $A=\\operatorname{diag}(2,3,4)$. $A^{-1}=$ " +
    Array.from({ length: 9 }, (_, i) => `_[${i + 1}]`).join(" ") +
    ".";
  const answers = ["1/2", "0", "0", "0", "1/3", "0", "0", "0", "1/4"];
  const { traffic } = await open(page, {
    generate: () =>
      JSON.stringify({
        question: flat,
        mode: "equivalent",
        vars: "",
        fields: answers.map((answer, i) => ({
          answer,
          recipe: {
            op: "inv",
            expr: "Matrix([[2,0,0],[0,3,0],[0,0,4]])",
            select: [Math.floor(i / 3), i % 3],
          },
        })),
      }),
  });
  const original = page
    .locator('.math-exercise-cell[data-label="similar-matrix"]')
    .first();
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem"),
    grid = child.locator(".math-mat");
  await expect(grid).toHaveCount(1);
  await expect(grid.locator(".math-input")).toHaveCount(9);
  expect(await grid.evaluate((el) => el.style.getPropertyValue("--cols"))).toBe(
    "3",
  );
  await expect(
    child.locator(".math-input:not(.math-mat .math-input)"),
  ).toHaveCount(0);
  const count = traffic.length;
  await page.evaluate((flat) => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("ctm|1|") || key.includes("|~")) continue;
      const r = JSON.parse(localStorage.getItem(key));
      if (!r?.inputs?.generated?.length) continue;
      r.inputs.generated[0].spec.question = flat;
      r.inputs.generated[0].inputs.fields["1"] = "1/2";
      localStorage.setItem(key, JSON.stringify(r));
    }
  }, flat);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(grid.locator(".math-input")).toHaveCount(9);
  await expect(grid.locator(".math-input").first()).toHaveValue("1/2");
  expect(traffic).toHaveLength(count);
  expect(await page.evaluate(() => window.__pythonCalls)).toBe(0);
});

test("a matrix response with ambiguous scalar blanks is repaired into the required fixed widget", async ({
  page,
}) => {
  const good = {
    question: "Find the inverse of $I_2$. mat[1,2;3,4]",
    mode: "equivalent",
    vars: "",
    fields: ["1", "0", "0", "1"].map((answer, i) => ({
      answer,
      recipe: {
        op: "inv",
        expr: "Matrix([[1,0],[0,1]])",
        select: [Math.floor(i / 2), i % 2],
      },
    })),
  };
  const { traffic } = await open(page, {
    generate: (n) =>
      JSON.stringify(
        n === 1
          ? {
              ...good,
              question: "Find the inverse of $I_2$. _[1] _[2] _[3] _[4]",
              fields: good.fields.map(({ answer }) => ({ answer })),
            }
          : good,
      ),
  });
  const original = page
    .locator('.math-exercise-cell[data-label="similar-matrix"]')
    .first();
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(
    original.locator(".math-generated-problem .math-mat .math-input"),
  ).toHaveCount(4);
  expect(traffic).toHaveLength(2);
  expect(traffic[1].messages[0].content).toContain("fixed mat[...] grid");
  expect(JSON.parse(traffic[0].messages[1].content).answerInput.kind).toBe(
    "matrix",
  );
});

const tangent = (data, question) => ({
  question:
    question || "Find the tangent to $h(x)={{h}}$ at $x={{x0}}$. $y=$ _[1]",
  mode: "custom",
  vars: "x",
  checker: "original",
  data,
  fields: [{ answer: "x-1" }],
});
const tangentCell = (page) =>
  page.locator('.math-exercise-cell[data-label="similar-tangent"]').first();

test("similar-data binds new checker givens, grades with them and restores without AI/Python", async ({
  page,
}) => {
  const { traffic } = await open(page, {
    generate: () =>
      JSON.stringify(tangent({ h: "x^2*log(x)", x0: "1" })),
    solve: () => JSON.stringify({ answers: ["x - 1"] }),
  });
  const original = tangentCell(page);
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1);
  const prompt = JSON.parse(traffic[0].messages[1].content);
  expect(Object.keys(prompt.checkers[0].data)).toEqual(["h", "x0"]);
  expect(prompt.checkers[0].data.x0).toContain("exact real number");
  expect(prompt.checkers[0].data.h).toContain("SymPy expression in x");
  expect(prompt.checkers[0].restrictions).toContain("{{h}}");
  // The question shows the bound values, rendered from ctm-checkers' LaTeX.
  const tex = () =>
    child.locator(".math-exercise-question").evaluate((node) => node.textContent);
  expect(await tex()).toContain("x^{2} \\log");
  expect(await tex()).not.toContain("{{");
  // The authored checker grades with the bound givens, not the original ones.
  await child.locator(".math-input").fill("2*x - E");
  await child.locator(".math-check-btn").click();
  await expect(child.locator(".math-feedback-area")).not.toContainText("Correct!");
  await child.locator(".math-input").fill("x - 1");
  await child.locator(".math-check-btn").click();
  await expect(child.locator(".math-feedback-area")).toContainText("Correct");
  const calls = traffic.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(tangentCell(page).locator(".math-generated-problem")).toHaveCount(1);
  expect(
    await tangentCell(page)
      .locator(".math-generated-problem .math-exercise-question")
      .evaluate((node) => node.textContent),
  ).toContain("x^{2} \\log");
  expect(traffic.length).toBe(calls);
  expect(await page.evaluate(() => window.__pythonCalls)).toBe(0);
});

test("similar-data rejects givens of another kind and names the reason for repair", async ({
  page,
}) => {
  const { traffic } = await open(page, {
    generate: (n) =>
      JSON.stringify(
        tangent(n === 1 ? { h: "x^2*log(x)", x0: "x" } : { h: "x^2*log(x)", x0: "1" }),
      ),
    solve: () => JSON.stringify({ answers: ["x - 1"] }),
  });
  const original = tangentCell(page);
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  await expect(original.locator(".math-generated-problem")).toHaveCount(1);
  const generation = traffic.filter((body) => body.max_tokens === 16384);
  expect(generation).toHaveLength(2);
  expect(JSON.stringify(generation[1].messages)).toContain(
    "x0 must be an exact real number",
  );
});

for (const [name, candidate, python] of [
  ["a missing given", tangent({ h: "x^2*log(x)" }), false],
  ["an undeclared given", tangent({ h: "x^2*log(x)", x0: "1", k: "2" }), false],
  [
    "a given written into the question",
    tangent({ h: "x^2*log(x)", x0: "1" }, "Find the tangent to $h(x)=x^2\\ln x$ at $x={{x0}}$. $y=$ _[1]"),
    false,
  ],
  ["an unsupported function", tangent({ h: "cot(x)", x0: "1" }), true],
])
  test(`similar-data never admits ${name}`, async ({ page }) => {
    const { traffic } = await open(page, {
      generate: () => JSON.stringify(candidate),
      solve: () => JSON.stringify({ answers: ["x - 1"] }),
    });
    const original = tangentCell(page);
    await original.getByRole("button", { name: "Harder", exact: true }).click();
    await expect(original.locator(".math-similar-status")).toContainText(
      "Could not create",
    );
    await expect(original.locator(".math-generated-problem")).toHaveCount(0);
    // The data contract is checked before Python; only admitted shapes reach
    // ctm-checkers, which rejects values outside the exact-value codec.
    expect((await page.evaluate(() => window.__pythonCalls)) > 0).toBe(python);
    expect(traffic.filter((body) => body.max_tokens === 16384).length).toBeGreaterThanOrEqual(2);
  });

test("similar-data generation and grading run in the real browser Pyodide runtime", async ({
  page,
}) => {
  test.setTimeout(150000);
  await open(page, {
    realPython: true,
    generate: () => JSON.stringify(tangent({ h: "x^2*log(x)", x0: "1" })),
    solve: () => JSON.stringify({ answers: ["x - 1"] }),
  });
  const original = tangentCell(page);
  await original.getByRole("button", { name: "Harder", exact: true }).click();
  const child = original.locator(".math-generated-problem");
  await expect(child).toHaveCount(1, { timeout: 120000 });
  await child.locator(".math-input").fill("x - 1");
  await child.locator(".math-check-btn").click();
  await expect(child.locator(".math-feedback-area")).toContainText("Correct", {
    timeout: 30000,
  });
});
