import { test, expect } from "playwright/test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
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
async function open(page, provider = {}) {
  const traffic = [];
  let generated = 0,
    solved = 0;
  await page.route("https://cdn.jsdelivr.net/npm/katex@*/**", async (route) => {
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
  await page.route(
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
      const runtime = {
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
      Object.defineProperty(window, "MathExerciseRuntime", {
        configurable: true,
        get: () => runtime,
        set: () => {},
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
    "unverified",
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
  await child
    .getByRole("button", { name: "Key looks wrong", exact: true })
    .click();
  await expect(child.locator(".math-generated-label")).toContainText(
    "disputed",
  );
  await expect(child.locator(".math-feedback-area")).toContainText(
    "Can’t confirm",
  );
  await expect(
    child.getByRole("button", { name: "Create a replacement" }),
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
  await original
    .locator(".math-generated-problem")
    .getByRole("button", { name: "Key looks wrong", exact: true })
    .click();
  await expect(original.locator(".math-generated-label")).toContainText(
    "could not be re-checked",
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
  await expect(page.locator(".math-similar-controls")).toHaveCount(2);
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
  await child
    .getByRole("button", { name: "Key looks wrong", exact: true })
    .click();
  await expect(child.locator(".math-generated-label")).toContainText(
    "re-checked",
  );
  await expect(child.locator(".math-generated-label")).toContainText("Flagged");
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
    "re-checked",
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
    "unverified",
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
    "unverified",
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
    "unverified",
  );
});
