-- math-exercise is a part of CTM Assessment. Its library ctm-libs (settings,
-- languages, the Python runtime, AI feedback, the JSXGraph check) is found by
-- the canonical bootstrap, which stops the render with the install command
-- when CTM Assessment is missing. The checks run in ctm-checkers, the Python
-- checker library of CTM Assessment, which ctm-libs finds (ctm.checkers):
-- in the browser (its page script) and at build time (its wheel, for the
-- authored question tests and the variant generator).
local ctm = dofile(quarto.utils.resolve_path("ctm-bootstrap.lua"))("math-exercise")
-- Quarto replaces the global error() with a logger that lets the render
-- continue; authoring errors must stop the render, so fail through assert.
local function fail(message) assert(false, message) end

-- Without AI feedback on the page these stand-ins keep the rendered data
-- attributes valid.
local noFeedback = {
  selection = function(block, opts) return { exercise = opts.label or block.identifier or "", name = "" } end,
  context = function() return { mode = "none", refs = "", text = "" } end,
}
local feedback = noFeedback

-- Decided per page before any other pass (preparePage). `math-exercise:
-- feedback:` auto (default) and true give every exercise the Feedback button,
-- false none; a build without AI feedback (ai-feedback: enabled: false or
-- CTM_FEEDBACK=off) gives none either. ctm-libs' feedback preparation runs
-- when exercises want feedback or the page has `.ai-feedback` activities
-- (which are prepared even with exercise feedback off).
local feedbackForExercises, feedbackForPage = false, false
-- Whether exercises get AI feedback where it is on (math-exercise: feedback
-- is not false), also in a build without it.
local feedbackWanted = false

----
-- math-exercise.lua
--
-- Quarto filter for interactive math exercises evaluated via SymPy in Pyodide.
-- Works standalone or alongside coatless-quarto/pyodide.
--
-- Single-task syntax:
--
--   ```{math-exercise}
--   #| label: circle
--   #| caption: Area
--   #| vars: r
--   #| mode: equivalent
--   #| reject: (x+1)**2
--   Calculate ... A = _[pi * 9] cm²
--   ```
--
-- Modes (#| mode:):
--   equivalent (default) – any algebraically equivalent expression
--   exact                – only the canonical SymPy form of the answer
--   numeric              – numeric closeness; see tolerance/decplaces/sigfigs
--   string / string_ci   – exact / case-insensitive text comparison
--   set                  – comma-separated list, compared as a multiset
--                          (each item checked via equivalent-mode matching)
--   custom               – author-supplied SymPy/Python checker, run once for
--                          all expression fields in the exercise
--
-- Extra options for mode: numeric (pick at most one; default: small abs. tol.):
--   #| tolerance: 0.5     – absolute, or "5%" for relative to the correct value
--   #| decplaces: 2       – round both sides to N decimal places before comparing
--   #| sigfigs: 3         – round both sides to N significant figures
--
-- Form option (combinable with mode: equivalent/exact) requires the answer be
-- correct AND already written in the given canonical form:
--   #| form: factored | expanded | single_fraction | lowest_terms
--
-- Optional human-readable labels for multi-field feedback:
--   #| field-labels: S, E, M
--
-- Partial credit (opt-in for built-in modes; custom checkers always may score):
--   #| partial-credit: true
--   #| form-credit: 0.5
--
-- Custom checker (trusted author code; student input is parsed separately):
--   #| mode: custom
--   #| packages: networkx                   -- optional Pyodide packages
--   #| response: jsxgraph:board-iframe-id   -- optional external JSON source
--   #| checker: |
--   #|   def check(response, symbols):
--   #|       return {"score": 1.0, "feedback": "Well done."}
--
-- Pool syntax  (#| pool: true, tasks separated by lines containing only ---):
--
--   ```{math-exercise}
--   #| label: circle-pool
--   #| pool: true
--   Task variant A: _[pi*9]
--   ---
--   Task variant B: _[pi*25]
--   ```
--
-- Input field markers:
--   _[answer]   → short  input
--   __[answer]  → medium input
--   ___[answer] → 2-row  textarea
--   vec[a,b,c]  → bracketed vector with one field per component
--   mat[a,b;c,d] → bracketed matrix; semicolons separate rows
--   mat{name=A, rows=3, cols=auto, ...} → named resizable matrix for custom mode
--
-- Vector orientation defaults to a column and can be changed per exercise:
--   #| vecdir: row
--
-- Context for AI feedback (hybrid: automatic + optional explicit):
--
--   By default, every exercise auto-collects the prose (paragraphs, lists,
--   its own section heading) since the last heading as background context
--   for the "Feedback" button's LLM prompt. No authoring changes needed:
--   just explain the scheme in normal text above the exercise(s). This part
--   is resolved here, at render time, from the Pandoc document tree.
--
--   For context that lives outside the current section, or that several
--   exercises across the page should share, tag it explicitly and list its
--   id(s) (comma-separated) on the exercise. This part is resolved lazily,
--   client-side (see math-exercise.js), so blocks may appear anywhere on
--   the page and in any order relative to the exercises that use them:
--
--   ::: {#fp16 .math-exercise-context}
--   IEEE-754 half precision: 1 sign bit, 5 exponent bits (bias 15),
--   10 mantissa bits.
--   :::
--
--   ```{math-exercise}
--   #| label: fp-decode
--   #| context: fp16
--   Decode 0x3C00 as a half-precision float: _[1]
--   ```
--
--   #| context: none   – opt out of context entirely
--
--   Auto-collected context is capped at ~1500 characters (keeping the most
--   recent part); explicit context has a combined 6000-character budget
--   enforced client-side (see MAX_FEEDBACK_CONTEXT_CHARS in the JS file).
----

local hasSetup      = false
local exerciseCount = 0

----
-- Localization (i18n)
--
-- Active UI language, resolved per page by ctm-libs (see Meta below). Every
-- interface text, in Lua and in math-exercise.js, is in ctm-libs' message
-- catalogue (locales/math-exercise.js).
----
local lang = "en"

-- Named uiT (not t) so it does not shadow the local `t` used further below.
local function uiT(key)
  return ctm.locale.text("math-exercise", key, lang)
end

-- This extension's version (its _extension.yml), for its HTML dependency.
local function extensionVersion()
  local f = io.open(quarto.utils.resolve_path("_extension.yml"), "r")
  local version = f and f:read("*a"):match("\nversion:%s*['\"]?([%w%.%-]+)")
  if f then f:close() end
  return version or "0"
end

-- ctm-checkers, once per page: an older ctm-libs has no ctm.checkers, and
-- ctm.checkers.require stops the render when ctm-checkers is missing or has
-- another API level, each with the command that fixes it.
local INSTALL = "quarto add https://erasmus-ctm.github.io/ctm-assessment/ctm-assessment.tar.gz"
local function requireCheckers()
  if not ctm.checkers then
    -- No ctm-libs version in the text: whether ctm.checkers exists decides.
    fail("math-exercise " .. extensionVersion() .. " needs ctm-checkers, which the ctm-libs in " .. ctm.dir
      .. " does not provide. Update CTM Assessment: " .. INSTALL)
  end
  ctm.checkers.require("math-exercise", 1)
end

-- Scripts and styles as cacheable HTML dependencies, once per page: ctm-libs'
-- Python runtime (MathExerciseRuntime), ctm-checkers' page script and the
-- message catalogue (CTMLocales) in the head, then this extension's styles,
-- and its scripts at the end of the body (they read
-- window.__mathExerciseConfig, written before the body).
local function ensureSetup()
  if hasSetup then return end
  hasSetup = true
  requireCheckers()
  ctm.runtime.use()
  ctm.checkers.use()
  ctm.locale.use("math-exercise")
  quarto.doc.add_html_dependency({
    name = "math-exercise",
    version = extensionVersion(),
    stylesheets = {"matrix-input.css", "math-exercise.css"},
    scripts = {
      {path = "matrix-input.js", afterBody = true},
      {path = "math-store.js", afterBody = true},
      {path = "math-exercise.js", afterBody = true},
    },
  })
end

----
-- Parse #| key: value lines; return opts table + remaining content
----
local function parseOptions(raw)
  local opts, lines, source = {}, {}, {}
  for line in (raw .. "\n"):gmatch("([^\r\n]*)\n") do
    table.insert(source, line)
  end

  local i = 1
  while i <= #source do
    local line = source[i]
    local k, v = line:match("^#|%s*(.-):%s*(.-)%s*$")
    if k and v then
      if v == "|" then
        local block = {}
        i = i + 1
        while i <= #source do
          local blockLine = source[i]
          if blockLine:match("^#|%s*$") then
            table.insert(block, "")
          elseif blockLine:sub(1, 5) == "#|   " then
            table.insert(block, blockLine:sub(6))
          else
            break
          end
          i = i + 1
        end
        opts[k] = table.concat(block, "\n")
      else
        opts[k] = v
        i = i + 1
      end
    else
      table.insert(lines, line)
      i = i + 1
    end
  end
  return opts, table.concat(lines, "\n"):match("^%s*(.-)%s*$")
end

----
-- HTML-attribute-safe escaping
----
local function attrEsc(s)
  return s:gsub("&","&amp;"):gsub('"',"&quot;"):gsub("<","&lt;"):gsub(">","&gt;")
end

----
-- JSON helpers
----
-- JSON for an inline <script>: <, > and & as \u escapes, so that text such as
-- "</script>" cannot end the script (as ctm-libs' feedback.lua writes its data).
local function scriptJson(value)
  return (quarto.json.encode(value):gsub("<", "\\u003c"):gsub(">", "\\u003e"):gsub("&", "\\u0026"))
end

local function jsonEsc(s)
  return s:gsub('\\','\\\\'):gsub('"','\\"'):gsub('\n','\\n'):gsub('\r','\\r'):gsub('\t','\\t')
end

-- Build a JSON array of strings safe for use inside a double-quoted HTML attribute
-- (inner " are encoded as &quot; so the HTML parser reconstructs valid JSON for JS)
local function jsonArrAttr(t)
  if #t == 0 then return "[]" end
  local parts = {}
  for _, v in ipairs(t) do
    table.insert(parts, '"' .. jsonEsc(v) .. '"')
  end
  return attrEsc("[" .. table.concat(parts, ",") .. "]")
end

-- Same idea as jsonArrAttr, but for a single string (used for data-context).
local function jsonStrAttr(s)
  return attrEsc('"' .. jsonEsc(s) .. '"')
end

local function splitCsv(s)
  local result = {}
  for item in (s or ""):gmatch("[^,]+") do
    local trimmed = item:match("^%s*(.-)%s*$")
    if trimmed ~= "" then table.insert(result, trimmed) end
  end
  return result
end

-- Split on a separator only at the top nesting level. This preserves commas
-- inside expressions such as atan2(y, x).
local function splitTop(s, sep)
  local parts, depth, current = {}, 0, {}
  for i = 1, #s do
    local ch = s:sub(i, i)
    if ch == "(" or ch == "[" or ch == "{" then
      depth = depth + 1
    elseif ch == ")" or ch == "]" or ch == "}" then
      depth = depth - 1
    end
    if ch == sep and depth == 0 then
      table.insert(parts, table.concat(current):match("^%s*(.-)%s*$"))
      current = {}
    else
      table.insert(current, ch)
    end
  end
  table.insert(parts, table.concat(current):match("^%s*(.-)%s*$"))
  return parts
end

----
-- AI-feedback auto-context helpers
--
-- Keep whole recent blocks: slicing a string can split a formula or UTF-8
-- character. Math is serialized from the AST before any renderer touches it.
----
local function scalarFieldHtml(fid, answer, vars, underscoreCount)
  local base = ' id="'          .. fid             .. '"'
             .. ' data-answer="' .. attrEsc(answer) .. '"'
             .. ' data-vars="'   .. attrEsc(vars)   .. '"'
             .. ' autocomplete="off" autocorrect="off" spellcheck="false"'
  if underscoreCount >= 3 then
    return '<textarea' .. base .. ' class="math-input math-input-large" rows="2"></textarea>'
  elseif underscoreCount == 2 then
    return '<input type="text"' .. base .. ' class="math-input math-input-medium">'
  end
  return '<input type="text"' .. base .. ' class="math-input math-input-small">'
end

local function matrixCellHtml(fid, answer, vars)
  return '<input type="text" id="' .. fid .. '"'
       .. ' data-answer="' .. attrEsc(answer) .. '"'
       .. ' data-vars="'   .. attrEsc(vars)   .. '"'
       .. ' autocomplete="off" autocorrect="off" spellcheck="false"'
       .. ' class="math-input math-mat-cell">'
end

local MAX_DYNAMIC_DIMENSION = 12

local function parseDynamicMatrixSpec(content)
  local spec = {}
  for _, part in ipairs(splitTop(content, ",")) do
    local key, value = part:match("^%s*([%w%-]+)%s*=%s*(.-)%s*$")
    if not key or value == "" then
      fail("math-exercise: mat{...} entries must use key=value")
    end
    if spec[key] ~= nil then
      fail("math-exercise: duplicate mat{...} option " .. key)
    end
    spec[key] = value
  end

  local allowed = {
    name=true, rows=true, cols=true,
    ["initial-rows"]=true, ["initial-cols"]=true,
    ["min-rows"]=true, ["max-rows"]=true,
    ["min-cols"]=true, ["max-cols"]=true,
  }
  for key, _ in pairs(spec) do
    if not allowed[key] then
      fail("math-exercise: unknown mat{...} option " .. key)
    end
  end

  local name = spec.name or ""
  if not name:match("^[A-Za-z][A-Za-z0-9_%-]*$") then
    fail("math-exercise: mat{...} requires name beginning with a letter")
  end

  local function integerOption(key, default)
    if spec[key] == nil then return default end
    local value = tonumber(spec[key])
    if not value or value % 1 ~= 0 or value < 0 or value > MAX_DYNAMIC_DIMENSION then
      fail("math-exercise: " .. key .. " must be an integer from 0 to " .. MAX_DYNAMIC_DIMENSION)
    end
    return value
  end

  local function axis(name)
    local raw = spec[name]
    if raw == nil then fail("math-exercise: mat{...} requires " .. name) end
    if raw ~= "auto" then
      local fixed = integerOption(name, nil)
      return { auto=false, initial=fixed, min=fixed, max=fixed }
    end
    local min = integerOption("min-" .. name, 0)
    local max = integerOption("max-" .. name, 8)
    if min > max then fail("math-exercise: min-" .. name .. " cannot exceed max-" .. name) end
    local initial = integerOption("initial-" .. name, math.min(max, math.max(1, min)))
    if initial < min or initial > max then
      fail("math-exercise: initial-" .. name .. " must lie between min-" .. name .. " and max-" .. name)
    end
    return { auto=true, initial=initial, min=min, max=max }
  end

  return { name=name, rows=axis("rows"), cols=axis("cols") }
end

local function dynamicMatrixCellHtml(exerciseId, spec, row, column, vars)
  local fid = exerciseId .. "-dm-" .. spec.name .. "-" .. row .. "-" .. column
  local label = "dm:" .. spec.name .. ":" .. row .. "," .. column
  local html = '<input type="text" id="' .. fid .. '"'
             .. ' data-answer="" data-vars="' .. attrEsc(vars) .. '"'
             .. ' data-dynamic-matrix-name="' .. attrEsc(spec.name) .. '"'
             .. ' data-matrix-row="' .. row .. '" data-matrix-column="' .. column .. '"'
             .. ' data-structural-label="' .. attrEsc(label) .. '"'
             .. ' autocomplete="off" autocorrect="off" spellcheck="false"'
             .. ' class="math-input math-mat-cell">'
  return html, fid, label
end

local function buildDynamicMatrix(exerciseId, content, vars, mode)
  if mode ~= "custom" then
    fail("math-exercise: mat{...} currently requires mode: custom")
  end
  local spec = parseDynamicMatrixSpec(content)
  local configuredRows, configuredCols = spec.rows.initial, spec.cols.initial
  local rows, cols = configuredRows, configuredCols
  if rows == 0 or cols == 0 then rows, cols = 0, 0 end
  local ids, labels, cells = {}, {}, {}
  for row = 1, rows do
    for column = 1, cols do
      local html, fid, label = dynamicMatrixCellHtml(exerciseId, spec, row, column, vars)
      table.insert(cells, html)
      table.insert(ids, fid)
      table.insert(labels, label)
    end
  end
  local matrix = '<span class="math-mat math-dynamic-mat"'
               .. ' style="--cols:' .. math.max(cols, 1) .. '"'
               .. ' data-matrix-name="' .. attrEsc(spec.name) .. '"'
               .. ' data-rows="' .. rows .. '" data-cols="' .. cols .. '"'
               .. ' data-auto-rows="' .. tostring(spec.rows.auto) .. '"'
               .. ' data-auto-cols="' .. tostring(spec.cols.auto) .. '"'
               .. ' data-min-rows="' .. spec.rows.min .. '" data-max-rows="' .. spec.rows.max .. '"'
               .. ' data-min-cols="' .. spec.cols.min .. '" data-max-cols="' .. spec.cols.max .. '"'
               .. ' data-last-rows="' .. configuredRows .. '" data-last-cols="' .. configuredCols .. '">'
               .. table.concat(cells) .. '</span>'
  local controls = '<span class="math-dynamic-matrix-controls" aria-label="Matrix size controls">'
                 .. '<span class="math-dynamic-axis" data-dynamic-axis="row"><span class="math-dynamic-axis-label"></span>'
                 .. '<button type="button" data-dynamic-action="remove-row">−</button><output></output>'
                 .. '<button type="button" data-dynamic-action="add-row">+</button></span>'
                 .. '<span class="math-dynamic-axis" data-dynamic-axis="col"><span class="math-dynamic-axis-label"></span>'
                 .. '<button type="button" data-dynamic-action="remove-col">−</button><output></output>'
                 .. '<button type="button" data-dynamic-action="add-col">+</button></span>'
                 .. '</span>'
  local html = '<span class="math-dynamic-matrix-wrap" data-matrix-name="' .. attrEsc(spec.name) .. '">'
             .. matrix .. controls .. '</span>'
  return html, ids, labels
end

local function buildVector(exerciseId, count, content, vars, vecdir)
  local components = splitTop(content, ",")
  local ids, labels, cells = {}, {}, {}
  for index, answer in ipairs(components) do
    count = count + 1
    local fid = exerciseId .. "-f" .. count
    table.insert(ids, fid)
    table.insert(labels, "v" .. index)
    table.insert(cells, matrixCellHtml(fid, answer, vars))
  end
  local rowClass = vecdir == "row" and " math-vec-row" or ""
  local html = '<span class="math-vec' .. rowClass .. '" style="--n:' .. #components .. '">'
            .. table.concat(cells) .. '</span>'
  return html, ids, labels, count
end

local function buildMatrix(exerciseId, count, content, vars)
  local rawRows = splitTop(content, ";")
  local rows, columnCount = {}, nil
  for _, rawRow in ipairs(rawRows) do
    local columns = splitTop(rawRow, ",")
    if columnCount == nil then
      columnCount = #columns
    elseif #columns ~= columnCount then
      fail("math-exercise: mat[...] rows must have the same number of columns")
    end
    table.insert(rows, columns)
  end

  local ids, labels, cells = {}, {}, {}
  for row, columns in ipairs(rows) do
    for column, answer in ipairs(columns) do
      count = count + 1
      local fid = exerciseId .. "-f" .. count
      table.insert(ids, fid)
      table.insert(labels, "m" .. row .. "," .. column)
      table.insert(cells, matrixCellHtml(fid, answer, vars))
    end
  end
  local html = '<span class="math-mat" style="--cols:' .. columnCount .. '">'
            .. table.concat(cells) .. '</span>'
  return html, ids, labels, count
end

local function atWordBoundary(text, position)
  if position <= 1 then return true end
  return not text:sub(position - 1, position - 1):match("[%w_]")
end

-- A code span: the next backtick on the same line, with something between.
local function codeSpanEnd(s, i)
  if i > 1 and s:sub(i - 1, i - 1) == "\\" then return nil end   -- \` is a literal backtick
  local k = s:find("`", i + 1, true)
  if not k or k == i + 1 then return nil end
  local newline = s:find("\n", i + 1, true)
  if newline and newline < k then return nil end
  return k
end

-- Exercise bodies are inserted as raw HTML, outside Pandoc's Markdown math
-- parser. Canonical delimiters keep page-level MathJax from consuming a bare
-- \\begin{...} environment and leaving literal dollar signs behind.
-- A literal dollar is emitted as its own element after HTML escaping, so that
-- neither KaTeX auto-render nor MathJax can take it for a math delimiter.
local LITERAL_DOLLAR = "\u{E024}"
local LITERAL_DOLLAR_HTML = '<span class="math-literal-dollar">$</span>'
-- Same rules as normalizeTaskMathDelimiters in math-exercise.js (which redraws
-- tasks): an escaped \$ is literal, and $...$ / $$...$$ need a closing
-- delimiter that is not escaped.
local function normalizeTaskMathDelimiters(text)
  local function unescapedAt(needle, start)
    local found = text:find(needle, start, true)
    while found do
      local slashes, i = 0, found - 1
      while i >= 1 and text:sub(i, i) == "\\" do slashes = slashes + 1; i = i - 1 end
      if slashes % 2 == 0 then return found end
      found = text:find(needle, found + #needle, true)
    end
    return nil
  end
  local output, position = {}, 1
  while position <= #text do
    local char = text:sub(position, position)
    local codeEnd = char == "`" and codeSpanEnd(text, position)
    if codeEnd then
      -- A dollar inside a code span is literal.
      table.insert(output, text:sub(position, codeEnd)); position = codeEnd + 1
    elseif char == "$" and position > 1 and text:sub(position - 1, position - 1) == "\\" then
      -- An escaped dollar becomes a placeholder (see LITERAL_DOLLAR).
      output[#output] = LITERAL_DOLLAR; position = position + 1
    elseif char ~= "$" then
      table.insert(output, char); position = position + 1
    else
      local display = text:sub(position, position + 1) == "$$"
      local delimiter = display and "$$" or "$"
      local close = unescapedAt(delimiter, position + #delimiter)
      if not close then
        table.insert(output, char); position = position + 1
      else
        table.insert(output, (display and "\\[" or "\\(") .. text:sub(position + #delimiter, close - 1) .. (display and "\\]" or "\\)"))
        position = close + #delimiter
      end
    end
  end
  return table.concat(output)
end

-- Replace scalar, vector, and matrix markers with HTML input elements.
-- The third return value contains structural label tokens used by the browser
-- for localized component/cell feedback. Author-supplied field-labels still
-- take precedence.
----
-- Exercise text is Markdown-like plain text: HTML is shown as text (so a<b<c
-- in TeX stays intact), and outside math a small inline Markdown subset is
-- formatted: ***both***, **bold**, *italic*, `code`; \* and \` are literal; a
-- trailing backslash is a line break. Emphasis may contain math. The same
-- rules are in inlineMarkdown()/proseHtml() in math-exercise.js (parity test).
local MATH_SLOT = "\u{E030}"   -- stands for one math span while formatting

local function inlineMarkdown(s)
  local out, i, n = {}, 1, #s
  -- Closing delimiter for emphasis opened just before `from`: on the same
  -- line, not escaped, not after whitespace, not followed by another "*"
  -- (or, for "*", by a letter or digit). Linear in the line length.
  local function closing(delim, from)
    local first = s:sub(from, from)
    if first == "" or first:match("%s") then return nil end
    local newline = s:find("\n", from, true) or (n + 1)
    local j = from + 1
    while true do
      local k = s:find(delim, j, true)
      if not k or k >= newline then return nil end
      local nextChar = s:sub(k + #delim, k + #delim)
      local before = s:sub(k - 1, k - 1)
      if nextChar == "*" or before == "\\" or before:match("%s")
          or (delim == "*" and nextChar:match("[%w]")) then
        j = k + 1
      else
        return k
      end
    end
  end
  while i <= n do
    local c = s:sub(i, i)
    local nextChar = s:sub(i + 1, i + 1)
    local k
    if c == "\\" and (nextChar == "*" or nextChar == "`") then
      table.insert(out, nextChar); i = i + 2
    elseif c == "\\" and nextChar == "\n" then
      i = i + 1   -- Markdown hard line break: the newline already breaks the line
    elseif c == "`" and codeSpanEnd(s, i) then
      k = codeSpanEnd(s, i)
      table.insert(out, "<code>" .. s:sub(i + 1, k - 1) .. "</code>"); i = k + 1
    elseif s:sub(i, i + 2) == "***" and closing("***", i + 3) then
      k = closing("***", i + 3)
      table.insert(out, "<em><strong>" .. inlineMarkdown(s:sub(i + 3, k - 1)) .. "</strong></em>"); i = k + 3
    elseif c == "*" and nextChar == "*" then
      k = closing("**", i + 2)
      if k then table.insert(out, "<strong>" .. inlineMarkdown(s:sub(i + 2, k - 1)) .. "</strong>"); i = k + 2
      else table.insert(out, "**"); i = i + 2 end
    elseif c == "*" and not (i > 1 and s:sub(i - 1, i - 1):match("[%w]")) then
      k = closing("*", i + 1)
      if k then table.insert(out, "<em>" .. inlineMarkdown(s:sub(i + 1, k - 1)) .. "</em>"); i = k + 1
      else table.insert(out, c); i = i + 1 end
    else
      table.insert(out, c); i = i + 1
    end
  end
  return table.concat(out)
end

-- Escapes a run of exercise text and formats inline Markdown outside math
-- (\( \), \[ \], \begin{..} \end{..} after normalizeTaskMathDelimiters) and
-- outside code spans. Each math span is a slot while formatting, so emphasis
-- may contain math.
local function proseHtml(text)
  local plain, maths, position = {}, {}, 1
  while position <= #text do
    local c = text:sub(position, position)
    local codeEnd = c == "`" and codeSpanEnd(text, position)
    local env = text:match("^\\begin{([^}]*)}", position)
    local closer = (text:sub(position, position + 1) == "\\(" and "\\)")
      or (text:sub(position, position + 1) == "\\[" and "\\]")
      or (env and ("\\end{" .. env .. "}"))
    if codeEnd then
      table.insert(plain, text:sub(position, codeEnd)); position = codeEnd + 1
    elseif closer then
      local close = text:find(closer, position + 2, true)
      local stop = close and (close + #closer - 1) or #text
      table.insert(maths, (attrEsc(text:sub(position, stop))))
      table.insert(plain, MATH_SLOT)
      position = stop + 1
    else
      table.insert(plain, c); position = position + 1
    end
  end
  local index = 0
  return (inlineMarkdown(attrEsc(table.concat(plain))):gsub(MATH_SLOT, function()
    index = index + 1
    return maths[index]
  end))
end

-- With `blank`, every marker becomes "…" (an exercise shown as text, without
-- answer fields). With `isHtml` the text is a generated variant's question,
-- which Pandoc has already rendered: its prose stays as it is, as in
-- renderTaskText(..., questionIsHtml) in math-exercise.js.
local function processMarkers(text, exerciseId, vars, vecdir, mode, blank, isHtml)
  if not isHtml then text = normalizeTaskMathDelimiters(text) end
  local count, fieldIds, structuralLabels = 0, {}, {}
  local dynamicNames = {}
  local output, position, prose = {}, 1, {}
  local function flush()
    if #prose > 0 then
      table.insert(output, isHtml and table.concat(prose) or proseHtml(table.concat(prose))); prose = {}
    end
  end

  while position <= #text do
    local rest = text:sub(position)
    local scalarHead = rest:match("^_+%[")
    local vectorHead, matrixHead, dynamicMatrixHead
    if not scalarHead and atWordBoundary(text, position) then
      vectorHead = rest:match("^vec%[")
      if not vectorHead then matrixHead = rest:match("^mat%[") end
      if not vectorHead and not matrixHead then dynamicMatrixHead = rest:match("^mat{") end
    end
    local head = scalarHead or vectorHead or matrixHead or dynamicMatrixHead
    local bracket = head and text:sub(position + #head - 1):match("^%b[]")
    local brace = dynamicMatrixHead and text:sub(position + #dynamicMatrixHead - 1):match("^%b{}")

    if (bracket or brace) and blank then
      table.insert(prose, "…")
      position = position + #head - 1 + #(bracket or brace)
    elseif bracket or brace then
      local balanced = bracket or brace
      -- Inside an answer marker an escaped dollar is a plain dollar.
      local content = balanced:sub(2, -2):gsub(LITERAL_DOLLAR, "$")
      local html, ids, labels
      if scalarHead then
        count = count + 1
        local fid = exerciseId .. "-f" .. count
        html, ids, labels = scalarFieldHtml(fid, content, vars, #scalarHead - 1), { fid }, { "" }
      elseif vectorHead then
        html, ids, labels, count = buildVector(exerciseId, count, content, vars, vecdir)
      elseif matrixHead then
        html, ids, labels, count = buildMatrix(exerciseId, count, content, vars)
      else
        local dynamicSpec = parseDynamicMatrixSpec(content)
        if dynamicNames[dynamicSpec.name] then
          fail("math-exercise: duplicate dynamic matrix name " .. dynamicSpec.name)
        end
        dynamicNames[dynamicSpec.name] = true
        html, ids, labels = buildDynamicMatrix(exerciseId, content, vars, mode)
      end
      flush()
      for _, fid in ipairs(ids) do table.insert(fieldIds, fid) end
      for _, label in ipairs(labels) do table.insert(structuralLabels, label) end
      table.insert(output, html)
      position = position + #head - 1 + #balanced
    else
      table.insert(prose, text:sub(position, position))
      position = position + 1
    end
  end
  flush()

  local html = table.concat(output):gsub(LITERAL_DOLLAR, LITERAL_DOLLAR_HTML)
  -- "{{" before markup would start a Quarto shortcode and swallow the rest.
  html = html:gsub("{{<", "{&#123;<")
  return html, fieldIds, structuralLabels
end

----
-- Split text into pool tasks on lines that contain only ---
----
local function splitTasks(text)
  local tasks   = {}
  local current = {}
  for line in (text .. "\n"):gmatch("([^\r\n]*)\n") do
    if line:match("^%s*---%s*$") then
      local t = table.concat(current, "\n"):match("^%s*(.-)%s*$")
      if t ~= "" then table.insert(tasks, t) end
      current = {}
    else
      table.insert(current, line)
    end
  end
  local t = table.concat(current, "\n"):match("^%s*(.-)%s*$")
  if t ~= "" then table.insert(tasks, t) end
  return tasks
end

----
-- Shared controls HTML (same for single and pool mode)
----
local function controlsHtml()
  local withFeedback = feedbackForExercises
  return table.concat({
    '<div class="math-exercise-controls">',
    '  <button type="button" class="btn btn-primary math-check-btn">&#10003;&nbsp;' .. uiT("checkButton") .. '</button>',
    '  <button type="button" class="btn btn-light math-legend-btn">&#9432;&nbsp;' .. uiT("legendButton") .. '</button>',
    withFeedback and '  <div class="btn-group">' or '',
    withFeedback and ('    <button type="button" class="btn btn-light math-feedback-btn">&#128172;&nbsp;' .. uiT("feedbackButton") .. '</button>') or '',
    withFeedback and ('    <button type="button" class="btn btn-light math-reconfig-btn" title="' .. attrEsc(uiT("reconfigTitle")) .. '">&#9881;</button>') or '',
    withFeedback and '  </div>' or '',
    '</div>',
  }, "\n")
end

----
-- AI-feedback context mode for this exercise.
--   "none"     – #| context: none
--   "explicit" – #| context: id1, id2, ...  (resolved client-side, see JS)
--   "auto"     – no #| context: option, falls back to the auto section text
----

----
-- Exercise cell builder (called from the document-order block walk below so
-- it can read the auto-collected section context).
----
local function buildExercise(el, state)
  ensureSetup()
  exerciseCount = exerciseCount + 1
  local eid = "math-exercise-" .. exerciseCount

  local opts, questionText = parseOptions(el.text)

  -- Tests opt into native build-time checking. They are never sent to the
  -- learner runtime; exercises without tests need no native Python. The
  -- script runs them in ctm-checkers (its wheel on PYTHONPATH).
  if opts["tests"] and opts["tests"]:match("%S") then
    local script = quarto.utils.resolve_path("question-tests.py")
    local python = os.getenv("MATH_EXERCISE_PYTHON") or "python3"
    opts["tests-base"] = quarto.project.directory or pandoc.path.directory(quarto.doc.input_file)
    local ok, result = pcall(pandoc.system.with_environment, ctm.checkers.environment(), function()
      return pandoc.pipe(python, {script, "--stdin"}, quarto.json.encode(opts))
    end)
    if not ok then
      io.stderr:write("math-exercise: author tests failed for " .. (opts["label"] or eid) .. "\n" .. tostring(result) .. "\n")
      io.stderr:flush()
      os.exit(1)
    end
  end

  local variants = dofile(quarto.utils.resolve_path("variants.lua")).generate(el.text, questionText, opts, state.review,
    function() return ctm.checkers.environment() end)
  if variants then opts = variants.options; opts["pool"] = "true" end

  local caption   = opts["caption"]   or nil
  local label     = opts["label"]     or eid
  local vars      = opts["vars"]      or ""
  local mode      = opts["mode"]      or "equivalent"
  local reject    = opts["reject"]    or ""
  local tolerance = opts["tolerance"] or ""
  local decplaces = opts["decplaces"] or ""
  local sigfigs   = opts["sigfigs"]   or ""
  local form      = opts["form"]      or ""
  local checker   = opts["checker"]   or ""
  local packages  = splitCsv(opts["packages"] or "")
  local response  = opts["response"]  or ""
  local diagramRefs = {}
  for ref in ((response .. "," .. (opts["context"] or "") .. "," .. (opts["feedback-context"] or "")):gmatch("jsxgraph:([^,%s\"']+)")) do
    table.insert(diagramRefs, ref)
  end
  if #diagramRefs > 0 then
    state.jsxgraphRefs = state.jsxgraphRefs or {}
    for _, ref in ipairs(diagramRefs) do table.insert(state.jsxgraphRefs, {ref = ref, label = opts["label"] or eid}) end
  end
  local embedResponse = (opts["embed-response"] == "true")
  local partialCredit = (opts["partial-credit"] == "true")
  local formCredit = opts["form-credit"] or "0.5"
  local fieldLabels = splitCsv(opts["field-labels"] or "")
  local initialValues = {}
  if opts["initial-values"] then
    local ok, values = pcall(quarto.json.decode, opts["initial-values"])
    if not ok or type(values) ~= "table" or not opts["initial-values"]:match("^%s*%[") then
      fail("math-exercise: initial-values must be a JSON array of strings")
    end
    for key, value in pairs(values) do
      if type(key) ~= "number" or type(value) ~= "string" then
        fail("math-exercise: initial-values must be a JSON array of strings")
      end
    end
    initialValues = values
  end
  local isPool    = (opts["pool"]     == "true")
  local vecdir    = opts["vecdir"] == "row" and "row" or "col"

  -- An exercise without a static check (custom mode without a checker) is
  -- assessed by AI feedback only. In a build without AI feedback ctm-libs
  -- decides (ai-feedback: without-ai): the question shown as text, or left
  -- out; with without-ai unset it names the exercise in the error that stops
  -- the build. An older ctm-libs has no ctm.policy.withoutAI: the exercise is
  -- rendered as before.
  local withoutAI = ctm.policy and ctm.policy.withoutAI
  if withoutAI and feedbackWanted and mode == "custom" and not checker:match("%S") then
    local decision = withoutAI({component = "math-exercise", kind = "math-exercise in custom mode without a checker",
      name = opts["label"], text = questionText, lang = lang})
    if decision and decision.action == "drop" then return {} end
    if decision then
      -- The question (a pool's first task, a generated exercise's first
      -- variant) without answer fields and controls, then ctm-libs' note.
      local question = variants and variants.variants[1].question or (isPool and splitTasks(questionText)[1]) or questionText
      local body = processMarkers(question, eid, vars, vecdir, mode, true, variants ~= nil):gsub("\n", "<br>\n")
      local html = (caption and ('<div class="math-exercise-caption">' .. caption .. '</div>\n') or '')
        .. '<div class="math-exercise-question">' .. body .. '</div>'
      return pandoc.Div({pandoc.RawBlock("html", html), decision.note}, pandoc.Attr(eid, {"math-exercise-text"}))
    end
  end

  local captionHtml = ""
  if caption then
    captionHtml = '<div class="math-exercise-caption math-exercise-toggle" data-math-exercise-source="'
               .. attrEsc(caption) .. '" role="button" tabindex="0" aria-expanded="false">'
               .. '<span class="math-chevron" aria-hidden="true"></span>'
               .. caption .. '</div>\n'
  end

  -- AI feedback's learning context: mode and explicit references (stand-ins
  -- when the exercises have no feedback), and the prose of the exercise's
  -- section that ctm-libs' feedback preparation recorded. The prose is taken
  -- from ctm-libs also when this component's feedback is off: where the page
  -- was prepared (the package always prepares it) it stays in the page, as before.
  local fc = feedback.context(el, opts)
  local sectionText = ctm.feedback.context(el, opts).text

  -- Base data attributes shared by both modes
  local attrs = 'id="'             .. eid                .. '"'
             .. ' data-label="'     .. attrEsc(label)     .. '"'
             .. ' data-mode="'      .. attrEsc(mode)      .. '"'
             .. ' data-reject="'    .. attrEsc(reject)    .. '"'
             .. ' data-vars="'      .. attrEsc(vars)      .. '"'
             .. ' data-tolerance="' .. attrEsc(tolerance) .. '"'
             .. ' data-decplaces="' .. attrEsc(decplaces) .. '"'
             .. ' data-sigfigs="'   .. attrEsc(sigfigs)   .. '"'
             .. ' data-form="'      .. attrEsc(form)      .. '"'
             .. ' data-checker="'   .. jsonStrAttr(checker) .. '"'
             .. ' data-packages="'  .. jsonArrAttr(packages) .. '"'
             .. ' data-response="'  .. attrEsc(response) .. '"'
             .. ' data-embed-response="' .. tostring(embedResponse) .. '"'
             .. ' data-partial-credit="' .. tostring(partialCredit) .. '"'
             .. ' data-form-credit="' .. attrEsc(formCredit) .. '"'
             .. ' data-field-labels="' .. jsonArrAttr(fieldLabels) .. '"'
             .. ' data-vecdir="' .. vecdir .. '"'
             .. ' data-feedback-policy="' .. attrEsc(quarto.json.encode(feedback.selection(el, opts))) .. '"'
             .. ' data-context-mode="' .. fc.mode .. '"'
             .. ' data-context-refs="' .. attrEsc(fc.refs) .. '"'
             .. ' data-context="'      .. attrEsc('"' .. jsonEsc(sectionText) .. '"') .. '"'

  if ctm.ui and ctm.ui.exercise then
    local saved = ctm.ui.exercise{
      component = "math-exercise", id = opts["label"], block = el,
      source = pandoc.utils.sha1(el.text):sub(1, 16), save = opts["save"]
    }
    for key, value in pairs(saved.attributes or {}) do
      attrs = attrs .. ' ' .. key .. '="' .. attrEsc(tostring(value)) .. '"'
    end
  end

  if opts["initial-values"] then
    attrs = attrs .. ' data-initial-values="' .. jsonArrAttr(initialValues) .. '"'
  end

  local questionHtml

  if isPool then
    local tasks = splitTasks(questionText)
    if variants then
      tasks = {}
      for _, record in ipairs(variants.variants) do tasks[#tasks+1] = record.question end
      attrs = attrs .. ' data-variants="' .. attrEsc(quarto.json.encode(variants)) .. '"'
    end
    local descriptors = {}
    for index, task in ipairs(tasks) do
      local record = variants and variants.variants[index] or nil
      -- Storage identities do not change the checker or legacy variant payload.
      -- Ignore a whole-definition fingerprint: match resolved deployed content.
      local content = record and quarto.json.encode({
        record.question or "", record.checker or "", record.solution or "", record["variant-context"] or ""
      }) or task
      local hash = pandoc.utils.sha1(content):sub(1, 16)
      local descriptor = {id = record and record.id or ("pool:" .. hash), hash = hash}
      -- Legacy generated records have stable ids but no stable number. An
      -- invented position would mask an id match after a deployment reorder.
      descriptor.n = record and record.n or (not record and index or nil)
      descriptors[#descriptors + 1] = descriptor
    end
    attrs = attrs .. ' data-storage-variants="' .. attrEsc(quarto.json.encode(descriptors)) .. '"'
    attrs        = attrs .. ' data-pool="'   .. jsonArrAttr(tasks) .. '"'
                         .. ' data-fields="[]"'
                         .. ' data-structural-field-labels="[]"'
    questionHtml = '<button type="button" class="math-pool-reload" title="' .. attrEsc(uiT("poolReloadTitle")) .. '">&#8635;</button>\n'
                .. '<div class="math-exercise-question"></div>'
  else
    local body, fieldIds, structuralLabels = processMarkers(questionText, eid, vars, vecdir, mode)
    body         = body:gsub("\n", "<br>\n"):gsub("{{<", "{&#123;<")   -- not a shortcode
    attrs        = attrs .. ' data-fields="' .. jsonArrAttr(fieldIds) .. '"'
                         .. ' data-structural-field-labels="' .. jsonArrAttr(structuralLabels) .. '"'
    -- Retain the pre-typesetting HTML, but never copy answer keys into the
    -- AI source. Inputs keep their ids so JS can insert current field labels.
    local source = body:gsub(' data%-answer="[^"]*"', '')
    questionHtml = '<div class="math-exercise-question" data-math-exercise-source="'
      .. attrEsc(source) .. '">' .. body .. '</div>'
  end

  local bodyHtml = table.concat({
    questionHtml,
    embedResponse and '<div class="math-exercise-response-slot"></div>' or '',
    controlsHtml(),
    '<div class="math-legend-panel" style="display:none;"></div>',
    '<div class="math-feedback-area"></div>',
  }, "\n")

  local html
  if caption then
    html = table.concat({
      '<div class="math-exercise-cell" ' .. attrs .. '>',
      captionHtml,
      '<div class="math-exercise-body" aria-hidden="true">',
      bodyHtml,
      '</div>',
      '</div>',
    }, "\n")
  else
    html = table.concat({
      '<div class="math-exercise-cell" ' .. attrs .. '>',
      bodyHtml,
      '</div>',
    }, "\n")
  end

  return pandoc.RawBlock("html", html)
end

----
-- Meta filter: resolve the UI language and hand it to the JavaScript side.
--
-- ctm-libs' resolver (ctm.locale.resolve), in order of precedence:
--   1. `math-exercise: lang: xx`   – explicit override
--   2. `ctm-assessment: lang: xx`  – every component of the project
--   3. Quarto's own `lang:`        – set per profile in a multilingual project
--   4. "en"                        – fallback
--
-- Region subtags are dropped ("de-DE" -> "de", "no" and "nn" -> "nb");
-- unsupported languages fall back to English instead of failing the render.
----
local function Meta(meta)
  if not quarto.doc.is_format("html") then return meta end
  lang = ctm.locale.resolve("math-exercise")

  -- math-exercise.js reads this to pick its language. stop-after:
  -- `math-exercise: stop-after`, `ctm-assessment: stop-after`, 20 seconds.
  quarto.doc.include_text("before-body",
    '<script>window.__mathExerciseConfig = ' ..
    scriptJson({ lang = lang, stopAfter = ctm.runtime.stopAfter("math-exercise") }) .. ';</script>')

  return meta
end

----
-- Document-order block walk
--
-- Needed (instead of a plain per-type CodeBlock filter) so exercise cells can
-- see prose that appeared earlier in the same document: tracks `sectionCtx`,
-- the prose collected since the last heading, in document order.
--
-- Recurses into plain Divs/BlockQuotes (callouts, columns, …) so exercises or
-- headings nested inside them are still found; list/table content is only
-- captured as flattened text (a nested exercise inside a bullet list would
-- be missed – an accepted, documented limitation).
--
-- `.math-exercise-context` divs are explicit-context blocks: their id is
-- referenced from `#| context:`, but resolution happens client-side (JS),
-- not here – this walk only folds their text into sectionCtx (so they also
-- count as ambient auto-context for neighboring exercises) and otherwise
-- adds source metadata to their math, still visible on the page.
----
local function walkBlocks(blocks, state)
  return blocks:walk({CodeBlock = function(b)
    if b.classes:includes("{math-exercise}") then return buildExercise(b, state) end
  end})
end

-- Each referenced diagram must exist on the page and need the JSXGraph filter.
local function checkDiagramReferences(doc, refs)
  if not refs or #refs == 0 then return end
  local present = {}
  doc.blocks:walk({
    CodeBlock = function(b)
      local id = b.attributes["assessment_id"] or b.attributes["iframe_id"]
      if b.classes:includes("jsxgraph") and id then present[id] = "code" end
    end,
    RawBlock = function(b)
      for id in b.text:gmatch('<iframe[^>]-%sid="([^"]+)"') do present[id] = "html" end
    end,
  })
  for _, item in ipairs(refs) do
    if not present[item.ref] then
      assert(false, "math-exercise: exercise " .. item.label .. " refers to jsxgraph:" .. item.ref
        .. ", but this page has no JSXGraph block with assessment_id=\"" .. item.ref .. "\".")
    end
  end
  -- A board whose extension is not installed has already stopped the render
  -- (ctm.deps.requireUsed in preparePage).
end

-- First pass: read the page's settings, stop if the page uses JSXGraph
-- without the extension, and decide whether the page needs AI feedback.
local function preparePage(doc)
  if not quarto.doc.is_format("html") then return doc end
  ctm.settings.load(doc.meta)
  local setting, origin = ctm.settings.choice("math-exercise", "feedback", {"auto", "true", "false"}, {default = "auto"})
  ctm.deps.requireUsed(doc, "math-exercise")
  local exercises = false
  doc.blocks:walk({ CodeBlock = function(b) if b.classes:includes("{math-exercise}") then exercises = true end end })
  feedbackWanted = setting ~= "false"
  local wanted = exercises and feedbackWanted
  if setting == "true" then
    -- Asked for explicitly: a build without AI feedback names it in its message.
    feedbackForExercises = ctm.feedback.request("math-exercise", wanted, "feedback: true" .. (origin and (" in " .. origin) or ""))
  else
    feedbackForExercises = wanted and (ctm.feedback.enabled())
  end
  feedbackForPage = wanted or ctm.deps.uses(doc)["ai-feedback"] == true
  feedback = feedbackForPage and ctm.feedback or noFeedback
  return doc
end

local function Pandoc(doc)
  if not quarto.doc.is_format("html") then return doc end
  if feedbackForPage then doc = ctm.feedback.prepare(doc) end
  doc.meta = Meta(doc.meta)
  local state = { sectionCtx = {}, review = doc.meta["math-exercise-review"] == true }
  doc.blocks = walkBlocks(doc.blocks, state)
  checkDiagramReferences(doc, state.jsxgraphRefs)
  return doc
end

return {
  { Pandoc = preparePage },
  { Pandoc = function(doc)
      if quarto.doc.is_format("html") and ctm.progress and ctm.progress.prepare then
        return ctm.progress.prepare(doc)
      end
      return doc
    end },
  { Callout = function(c)
      if feedbackForPage and quarto.doc.is_format("html") then
        return ctm.feedback.markCallout(c)
      end
      return c
    end },
  { Pandoc = Pandoc },
  { Pandoc = function(doc)
      if quarto.doc.is_format("html") and ctm.ui and ctm.ui.finalize then
        return ctm.ui.finalize(doc)
      end
      return doc
    end },
}
