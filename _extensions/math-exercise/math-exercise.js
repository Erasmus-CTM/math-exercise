(function () {
  'use strict';
  // Interface texts: ctm-libs' message catalogue (locales/math-exercise.js),
  // compiled for the page's language (an unknown language gives English).
  // The feedback interface and prompts live in ctm-libs' AI feedback.
  var ME_CFG = window.__mathExerciseConfig || { lang: 'en' };
  var L = CTMLocales.table('math-exercise', ME_CFG.lang);

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function promptXmlEsc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function displayErrorMessage(err) {
    var msg = err && typeof err.message === 'string' ? err.message : String(err || '');
    var prefixes = ['Error:', L.errorPrefix];
    var changed = true;
    while (changed) {
      changed = false;
      prefixes.forEach(function (prefix) {
        if (prefix && msg.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()) {
          msg = msg.slice(prefix.length).trim();
          changed = true;
        }
      });
    }
    return msg;
  }

  function simpleMarkdown(text) { return window.AIFeedback.renderMarkdown(text); }

  // ---------------------------------------------------------------------------
  // Pyodide bootstrap  (reuse coatless instance if present)
  // ---------------------------------------------------------------------------

  async function ensurePyodide() {
    return globalThis.MathExerciseRuntime.ensurePyodide();
  }

  // ---------------------------------------------------------------------------
  // KaTeX  (legend rendering – loaded independently of page math)
  // ---------------------------------------------------------------------------

  var katexReady = false;
  var katexLib = null;
  var renderMathInElementFn = null;
  var KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16/';

  async function ensureKatex() {
    if (katexReady) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = KATEX + 'dist/katex.min.css';
    document.head.appendChild(link);
    // Loaded as ES modules (jsDelivr's `+esm` build), not classic <script>
    // tags. Reason: KaTeX's classic UMD bundles register themselves through
    // Monaco's global AMD loader (vs/loader.js, injected here for the code
    // editor) instead of setting window.katex / window.renderMathInElement,
    // and RequireJS throws "Can only have one anonymous define call per
    // script file" when they do. Dynamic import() uses a separate module
    // system AMD detection can't see, so it sidesteps the collision instead
    // of racing Monaco's own concurrent module loads (a "temporarily hide
    // define.amd" workaround was tried first and broke Monaco's lazily
    // loaded markdown renderer for hover tooltips).
    var katexMod      = await import(KATEX + '+esm');
    var autoRenderMod = await import(KATEX + 'contrib/auto-render/+esm');
    katexLib = katexMod.default;
    renderMathInElementFn = autoRenderMod.default;
    katexReady = true;
  }

  var KATEX_DELIMITERS = [
    { left: '$$', right: '$$', display: true  },
    { left: '$',  right: '$',  display: false },
    { left: '\\(', right: '\\)', display: false },
    { left: '\\[', right: '\\]', display: true  },
  ];

  function renderMathInQuestion(el) {
    if (!el || typeof renderMathInElementFn !== 'function') return;
    renderMathInElementFn(el, { delimiters: KATEX_DELIMITERS, throwOnError: false });
  }

  // ---------------------------------------------------------------------------
  // SymPy  (lazy – first Check click)
  // ---------------------------------------------------------------------------

  // A Pyodide runtime can be replaced on the page (pyodide-interaktiv's Stop or
  // restart terminates its worker). SymPy setup and package loads therefore
  // belong to one runtime object and are repeated for a new one.
  var sympyRuntime = null;
  var packageLoads = new WeakMap();
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('qpyodide-runtime-restart', function () {
      sympyRuntime = null; sympyLoading = null;
    });
  }

  function parsePackageList(value) {
    var packages = Array.isArray(value) ? value : [];
    var seen = Object.create(null);
    return packages.map(function (name) { return String(name || '').trim(); })
      .filter(function (name) {
        if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
          if (name) throw new Error('Invalid Pyodide package name: ' + name);
          return false;
        }
        var key = name.toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
  }

  async function ensurePackages(packages) {
    var requested = parsePackageList(packages);
    if (!requested.length) return;
    var py = await ensurePyodide();
    var loads = packageLoads.get(py);
    if (!loads) { loads = Object.create(null); packageLoads.set(py, loads); }
    await Promise.all(requested.map(function (name) {
      var key = name.toLowerCase();
      if (!loads[key]) {
        loads[key] = py.loadPackage(name).catch(function (error) {
          delete loads[key];
          throw error;
        });
      }
      return loads[key];
    }));
  }

  var sympyLoading = null;
  // Resolves to the runtime on which SymPy and the checker helpers are ready.
  async function ensureSympy() {
    var py = await ensurePyodide();
    if (sympyRuntime === py) return py;
    if (!sympyLoading || sympyLoading.runtime !== py) {
      var loading = initializeSympy(py).then(function () { sympyRuntime = py; return py; },
        function (error) { if (sympyLoading === loading) sympyLoading = null; throw error; });
      loading.runtime = py;
      sympyLoading = loading;
    }
    return sympyLoading;
  }
  // The checker runtime lives in its own module, not in the interpreter's
  // global namespace: learner code in other cells on the page (for example
  // pyodide-interaktiv) shares that namespace and may rebind names such as
  // `symbols`, `Matrix` or `sqrt`.
  var MATH_MODULE = '_ctm_math_exercise';
  function runtimeCall(name) {
    return '__import__("' + MATH_MODULE + '")._math_run("' + name + '", globals())';
  }
  async function initializeSympy(py) {
    await py.loadPackage('sympy');
    var source = [
      'from sympy import *',
      'from sympy.parsing.sympy_parser import (',
      '    parse_expr, standard_transformations,',
      '    implicit_multiplication_application, convert_xor',
      ')',
      '_math_tf = standard_transformations + (',
      '    implicit_multiplication_application, convert_xor,',
      ')',
      'import json as _mj',
      'import re as _mre',
      'from math import log10, floor, gcd',
      '',
      '_FRAC_RE = _mre.compile(r"(-?\\d+)\\s*/\\s*(-?\\d+)")',
      '',
      'def _numeric_not_reduced(raw):',
      '    # True if raw contains any literal int/int fraction that is not fully',
      '    # reduced (e.g. the "2/4" inside "1/4 + 2/4"). SymPy auto-reduces',
      '    # Rationals as soon as they are parsed/combined, so this has to scan',
      '    # the original text, not the parsed expression.',
      '    for _m in _FRAC_RE.finditer(raw):',
      '        num, den = int(_m.group(1)), int(_m.group(2))',
      '        if den != 0 and gcd(abs(num), abs(den)) != 1:',
      '            return True',
      '    return False',
      '',
      'def _split_top(s, sep=","):',
      '    parts = []',
      '    depth = 0',
      '    cur = ""',
      '    for ch in s:',
      '        if ch in "([{": depth += 1',
      '        elif ch in ")]}": depth -= 1',
      '        if ch == sep and depth == 0:',
      '            parts.append(cur)',
      '            cur = ""',
      '        else:',
      '            cur += ch',
      '    parts.append(cur)',
      '    return [p.strip() for p in parts if p.strip() != ""]',
      '',
      '# Rounds the decimal value (15 significant digits, so binary noise in a',
      '# computed key such as 1.05*1.9 does not count) half away from zero:',
      '# round(5.395, 2) is 5.39 for the binary float, but 5.40 here.',
      'def _round_places(x, d):',
      '    from decimal import Decimal, ROUND_HALF_UP, InvalidOperation',
      '    try:',
      '        return float(Decimal(format(float(x), \'.15g\')).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP))',
      '    except (InvalidOperation, ValueError, OverflowError):',
      '        return round(x, d)',
      '',
      'def _sigfigs_round(x, n):',
      '    if x == 0: return 0.0',
      '    d = n - int(floor(log10(abs(x)))) - 1',
      '    return _round_places(x, d)',
      '',
      'def _parse_tol(spec, ref):',
      '    spec = spec.strip()',
      '    if spec.endswith("%"):',
      '        return abs(ref) * float(spec[:-1]) / 100.0',
      '    return float(spec)',
      '',
      'def _canon_form(expr, form):',
      '    if form == "factored":        return factor(expr)',
      '    if form == "expanded":        return expand(expr)',
      '    if form == "single_fraction": return together(expr)',
      '    if form == "lowest_terms":    return cancel(expr)',
      '    return expr',
      '',
      'def _num_equal(sv, cv):',
      '    if _math_decplaces.strip():',
      '        n = int(_math_decplaces)',
      '        return _round_places(sv, n) == _round_places(cv, n)',
      '    if _math_sigfigs.strip():',
      '        n = int(_math_sigfigs)',
      '        return _sigfigs_round(sv, n) == _sigfigs_round(cv, n)',
      '    if _math_tolerance.strip():',
      '        return abs(sv - cv) <= _parse_tol(_math_tolerance, cv)',
      '    return abs(sv - cv) <= 1e-8 * max(1.0, abs(cv))',
      '',
      'def _build_locals():',
      '    _local = {}',
      '    if _math_vars.strip():',
      '        for _v in _math_vars.replace(",", " ").split():',
      '            _v = _v.strip()',
      '            if _v: _local[_v] = symbols(_v)',
      '    _local.setdefault("inf", oo)',
      '    return _local',
      '',
      'def graph_from_response(response, *, directed=False):',
      '    """Validate graph-editor JSON and return a NetworkX graph."""',
      '    import math as _graph_math',
      '    import networkx as nx',
      '',
      '    if not isinstance(response, dict):',
      '        raise ValueError("Graph response must be an object")',
      '    expected = "directed-graph" if directed else "undirected-graph"',
      '    if response.get("representation") != expected:',
      '        raise ValueError(f"Expected {expected} response")',
      '    nodes = response.get("nodes")',
      '    edges = response.get("edges")',
      '    if not isinstance(nodes, list) or not isinstance(edges, list):',
      '        raise ValueError("Graph response needs node and edge lists")',
      '',
      '    graph = nx.DiGraph() if directed else nx.Graph()',
      '    known = set()',
      '    for node in nodes:',
      '        if not isinstance(node, dict):',
      '            raise ValueError("Every graph node must be an object")',
      '        node_id = node.get("id")',
      '        if type(node_id) is not int or node_id in known:',
      '            raise ValueError("Graph node identifiers must be unique integers")',
      '        try:',
      '            x, y = float(node["x"]), float(node["y"])',
      '        except (KeyError, TypeError, ValueError):',
      '            raise ValueError("Every graph node needs numeric x and y coordinates")',
      '        if not _graph_math.isfinite(x) or not _graph_math.isfinite(y):',
      '            raise ValueError("Graph node coordinates must be finite")',
      '        known.add(node_id)',
      '        graph.add_node(node_id, x=x, y=y)',
      '',
      '    seen = set()',
      '    for edge in edges:',
      '        if not isinstance(edge, list) or len(edge) != 2:',
      '            raise ValueError("Every graph edge must contain two endpoints")',
      '        source, target = edge',
      '        if source not in known or target not in known or source == target:',
      '            raise ValueError("Graph edges need two distinct known endpoints")',
      '        key = (source, target) if directed else tuple(sorted((source, target)))',
      '        if key in seen:',
      '            raise ValueError("Graph response contains a duplicate edge")',
      '        seen.add(key)',
      '        graph.add_edge(source, target)',
      '    return graph',
      '',
      'def assess_basis(matrix, *, axis, target_dimension, belongs, name, space_name="space"):',
      '    """Assess a row- or column-basis submission without privileging vector order.',
      '',
      '    ``belongs(vector)`` decides only whether a nonzero vector belongs to the',
      '    target space.  This helper owns rank, dependence, scoring, assessment',
      '    colors, and standard feedback so individual checkers do not duplicate them.',
      '    """',
      '    if axis not in ("rows", "columns"):',
      '        raise ValueError("Basis assessment axis must be rows or columns")',
      '    target_dimension = int(target_dimension)',
      '    if target_dimension < 0:',
      '        raise ValueError("Basis target dimension cannot be negative")',
      '    if not callable(belongs):',
      '        raise TypeError("Basis membership test must be callable")',
      '',
      '    count = matrix.rows if axis == "rows" else matrix.cols',
      '    singular = "row" if axis == "rows" else "column"',
      '    vectors = [matrix[i, :] for i in range(count)] if axis == "rows" else [matrix[:, i] for i in range(count)]',
      '',
      '    if target_dimension == 0:',
      '        statuses = ["incorrect"] * count',
      '        return {',
      '            "score": 1.0 if count == 0 else 0.0,',
      '            "show_score": False,',
      '            "feedback": "" if count == 0 else f"The {space_name} is trivial, so its basis is empty. Remove every {singular}.",',
      '            "assessment": {name: {axis: statuses}},',
      '        }',
      '',
      '    locally_valid = []',
      '    valid_vectors = []',
      '    for vector in vectors:',
      '        zero = vector == zeros(*vector.shape)',
      '        valid = (not zero) and bool(belongs(vector))',
      '        locally_valid.append(valid)',
      '        if valid:',
      '            valid_vectors.append(vector)',
      '',
      '    if valid_vectors:',
      '        family = Matrix.vstack(*valid_vectors) if axis == "rows" else Matrix.hstack(*valid_vectors)',
      '        rank = int(family.rank())',
      '    else:',
      '        rank = 0',
      '    valid_count = len(valid_vectors)',
      '    dependent = rank < valid_count',
      '    statuses = [',
      '        ("dependent" if dependent else "correct") if valid else "incorrect"',
      '        for valid in locally_valid',
      '    ]',
      '',
      '    if count == 0:',
      '        score = 0.0',
      '    else:',
      '        coverage = min(rank, target_dimension) / target_dimension',
      '        validity = valid_count / count',
      '        independence = rank / valid_count if valid_count else 0.0',
      '        score = float(coverage * validity * independence)',
      '',
      '    invalid_count = count - valid_count',
      '    plural = singular + "s"',
      '    if score >= 1.0 - 1e-9:',
      '        feedback = ""',
      '    elif count == 0:',
      '        feedback = f"Add one or more basis {plural} for the {space_name}."',
      '    elif invalid_count and dependent:',
      '        feedback = (f"The red {plural} are zero or outside the {space_name}. "',
      '                    f"The yellow {plural} belong to the {space_name}, but together they are linearly dependent. "',
      '                    f"Remove or replace the red {plural}, choose an independent subset of the yellow {plural}, "',
      '                    f"and check that the result spans the whole {space_name}.")',
      '    elif invalid_count:',
      '        feedback = f"Remove or replace the red {plural}; each is zero or outside the {space_name}."',
      '        if rank < target_dimension:',
      '            feedback += f" Then add independent {plural} until the family spans the whole {space_name}."',
      '    elif dependent and rank == target_dimension:',
      '        feedback = (f"Every yellow {singular} belongs to the {space_name}, but the family is linearly dependent. "',
      '                    f"Remove one or more yellow {plural} until an independent basis remains.")',
      '    elif dependent:',
      '        feedback = (f"Every yellow {singular} belongs to the {space_name}, but the family is linearly dependent. "',
      '                    f"Choose an independent subset, then add independent {plural} until it spans the whole {space_name}.")',
      '    else:',
      '        feedback = (f"The green {plural} are valid and independent. "',
      '                    f"Add more independent {plural} until they span the whole {space_name}.")',
      '',
      '    return {"score": score, "show_score": False, "feedback": feedback, "assessment": {name: {axis: statuses}}}',
      '',
      'def _math_check():',
      '    try:',
      '        mode = _math_mode',
      '        if mode in ("string", "string_ci"):',
      '            s, c = _math_student, _math_correct',
      '            if mode == "string_ci": s, c = s.lower(), c.lower()',
      '            ok = s == c',
      '            return {"status": "correct" if ok else "wrong", "score": 1.0 if ok else 0.0}',
      '',
      '        _local = _build_locals()',
      '',
      '        if mode == "set":',
      '            s_items = [parse_expr(p, local_dict=_local, transformations=_math_tf) for p in _split_top(_math_student)]',
      '            c_items = [parse_expr(p, local_dict=_local, transformations=_math_tf) for p in _split_top(_math_correct)]',
      '            unmatched = list(c_items)',
      '            matched = 0',
      '            for si in s_items:',
      '                found = None',
      '                for ci in unmatched:',
      '                    d = simplify(si - ci)',
      '                    if d == 0 or (d.is_number and abs(complex(d.evalf())) < 1e-8):',
      '                        found = ci',
      '                        break',
      '                if found is not None:',
      '                    unmatched.remove(found)',
      '                    matched += 1',
      '            exact = matched == len(c_items) == len(s_items)',
      '            if exact:',
      '                return {"status": "correct", "score": 1.0}',
      '            extra = len(s_items) - matched',
      '            score = (max(0.0, matched - extra) / len(c_items)) if (_math_partial_credit and c_items) else 0.0',
      '            return {"status": "partial" if score > 0 else "wrong", "score": score}',
      '',
      '        _ms = parse_expr(_math_student, local_dict=_local, transformations=_math_tf)',
      '        _mc = parse_expr(_math_correct,  local_dict=_local, transformations=_math_tf)',
      '',
      '        if mode == "numeric":',
      '            sv, cv = complex(_ms.evalf()), complex(_mc.evalf())',
      '            if abs(sv.imag) > 1e-9 or abs(cv.imag) > 1e-9:',
      '                return {"status": "wrong", "score": 0.0}',
      '            ok = _num_equal(sv.real, cv.real)',
      '            return {"status": "correct" if ok else "wrong", "score": 1.0 if ok else 0.0}',
      '',
      '        _d  = simplify(_ms - _mc)',
      '        _eq = (_d == 0) or (_d.is_number and abs(complex(_d.evalf())) < 1e-10)',
      '        if not _eq:',
      '            return {"status": "wrong", "score": 0.0}',
      '        if mode == "exact":',
      '            if str(_ms) != str(_mc):',
      '                return {"status": "not_exact", "score": _math_form_credit if _math_partial_credit else 0.0}',
      '            # SymPy auto-reduces Rationals on parse, so an un-reduced',
      '            # numeric fraction (e.g. "2/4" inside "1/4 + 2/4") is',
      '            # invisible to the string check above; "exact" is meant to',
      '            # be the strictest mode, so catch it on the raw text too.',
      '            if not _ms.free_symbols and _numeric_not_reduced(_math_student):',
      '                return {"status": "not_exact", "score": _math_form_credit if _math_partial_credit else 0.0}',
      '        if _math_form.strip():',
      '            if _math_form == "lowest_terms" and not _ms.free_symbols:',
      '                if _numeric_not_reduced(_math_student):',
      '                    return {"status": "not_form", "score": _math_form_credit if _math_partial_credit else 0.0}',
      '            elif _ms != _canon_form(_ms, _math_form):',
      '                return {"status": "not_form", "score": _math_form_credit if _math_partial_credit else 0.0}',
      '        if _math_reject.strip():',
      '            _mr  = parse_expr(_math_reject, local_dict=_local, transformations=_math_tf)',
      '            if str(_ms) == str(_mr):',
      '                return {"status": "rejected", "score": 0.0}',
      '        return {"status": "correct", "score": 1.0}',
      '    except Exception as _me:',
      '        return {"status": "error", "message": str(_me)}',
      '',
      'def _normalize_custom_result(result):',
      '    feedback = ""',
      '    assessment = {}',
      '    show_score = True',
      '    if isinstance(result, bool):',
      '        score = 1.0 if result else 0.0',
      '    elif isinstance(result, (int, float)):',
      '        score = float(result)',
      '    elif isinstance(result, dict):',
      '        feedback = str(result.get("feedback", ""))',
      '        assessment = result.get("assessment", {})',
      '        show_score = bool(result.get("show_score", True))',
      '        if not isinstance(assessment, dict):',
      '            raise TypeError("Custom checker assessment must be a dictionary")',
      '        if "score" in result:',
      '            score = float(result["score"])',
      '        elif "correct" in result:',
      '            score = 1.0 if bool(result["correct"]) else 0.0',
      '        else:',
      '            raise ValueError("Custom checker result needs score or correct")',
      '    else:',
      '        raise TypeError("Custom checker must return bool, number, or dict")',
      '    if not 0.0 <= score <= 1.0:',
      '        raise ValueError("Custom checker score must be between 0 and 1")',
      '    status = "correct" if score >= 1.0 - 1e-9 else ("wrong" if score <= 1e-9 else "partial")',
      '    return {"status": status, "score": score, "show_score": show_score, "feedback": feedback, "assessment": assessment}',
      '',
      'def _math_check_custom():',
      '    try:',
      '        if not _math_checker.strip():',
      '            raise ValueError("mode custom requires a checker")',
      '        _local = _build_locals()',
      '        response = _mj.loads(_math_response_json)',
      '        if isinstance(response, dict) and response.get("kind") == "expressions":',
      '            raw_values = response.get("raw", [])',
      '            response["expressions"] = [parse_expr(v, local_dict=_local, transformations=_math_tf) for v in raw_values]',
      '            for name, item in response.get("inputs", {}).items():',
      '                if not isinstance(item, dict) or item.get("type") != "matrix":',
      '                    continue',
      '                rows, cols = int(item.get("rows", -1)), int(item.get("cols", -1))',
      '                if rows < 0 or cols < 0:',
      '                    raise ValueError(f"Invalid matrix dimensions for {name}")',
      '                matrix_raw = item.get("raw", [])',
      '                if len(matrix_raw) != rows * cols:',
      '                    raise ValueError(f"Matrix {name} has inconsistent dimensions")',
      '                matrix_expressions = [parse_expr(v, local_dict=_local, transformations=_math_tf) for v in matrix_raw]',
      '                item["expressions"] = matrix_expressions',
      '                item["matrix"] = Matrix(rows, cols, matrix_expressions)',
      '        checker_symbols = {k: v for k, v in _local.items() if isinstance(v, Symbol)}',
      '        namespace = dict(globals())',
      '        exec(_math_checker, namespace)',
      '        checker = namespace.get("check")',
      '        if not callable(checker):',
      '            raise ValueError("Custom checker must define check(expressions, symbols)")',
      '        return _normalize_custom_result(checker(response, checker_symbols))',
      '    except Exception as _me:',
      '        return {"status": "error", "message": str(_me)}',
      '',
      '_MATH_INPUTS = ("_math_student", "_math_correct", "_math_vars", "_math_mode", "_math_reject",',
      '                "_math_tolerance", "_math_decplaces", "_math_sigfigs", "_math_form",',
      '                "_math_partial_credit", "_math_form_credit", "_math_response_json", "_math_checker")',
      '',
      'try:',
      '    import _ctm_guard',
      'except ImportError:  # native test runners (question-tests.py) have no page to protect',
      '    _ctm_guard = None',
      '',
      'def _learner_strings(request):',
      '    # Only what this request brought: earlier requests leave other inputs behind.',
      '    if "_math_student" in request and request.get("_math_mode") not in ("string", "string_ci"):',
      '        yield request["_math_student"] or ""  # string answers are never evaluated',
      '    try:',
      '        response = _mj.loads(request.get("_math_response_json") or "null")',
      '    except ValueError:',
      '        return',
      '    if isinstance(response, dict):',
      '        yield from response.get("raw", []) or []',
      '        for item in (response.get("inputs") or {}).values():',
      '            if isinstance(item, dict):',
      '                yield from item.get("raw", []) or []',
      '',
      'def _math_run(name, caller):',
      '    # Move this request\'s inputs out of the shared namespace into the module.',
      '    request = {key: caller.pop(key) for key in _MATH_INPUTS if key in caller}',
      '    globals().update(request)',
      '    # Learner answers are parsed by SymPy (which evaluates Python): no dunder',
      '    # access. Author data (variants, checkers) is not restricted.',
      '    if any("__" in str(text) for text in _learner_strings(request)):',
      '        raise ValueError("SyntaxError: unsupported input")',
      '    # Whatever the parsed answer or checker does, other components on the',
      '    # page keep their interpreter state.',
      '    state = _ctm_guard.snapshot() if _ctm_guard else None',
      '    try:',
      '        return _mj.dumps(globals()[name]())',
      '    finally:',
      '        if state is not None:',
      '            _ctm_guard.restore(state)',
    ].join('\n');
    await globalThis.MathExerciseRuntime.ensureGuard(py);
    await globalThis.MathExerciseRuntime.installModule(py, MATH_MODULE, source);
  }

  // ---------------------------------------------------------------------------
  // Legend
  // ---------------------------------------------------------------------------

  var LEGEND = L.legend;

  async function buildLegend(container) {
    await ensureKatex();
    var rows = LEGEND.map(function (item) {
      var math;
      try { math = katexLib.renderToString(item[0], { throwOnError: false }); }
      catch (e) { math = escHtml(item[0]); }
      return '<tr>'
        + '<td class="math-legend-math">'  + math + '</td>'
        + '<td><code class="math-legend-code">' + item[1] + '</code></td>'
        + '<td class="math-legend-desc">'  + item[2] + '</td>'
        + '</tr>';
    }).join('');
    container.innerHTML =
      '<div class="math-legend-inner">'
      + '<p class="math-legend-ops">'
      + L.legendOps
      + '</p>'
      + '<table class="math-legend-table"><thead><tr>'
      + '<th>' + L.legendThExpr + '</th><th>' + L.legendThInput + '</th><th>' + L.legendThMeaning + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Convert low-level errors into localized, human-readable messages
  // ---------------------------------------------------------------------------

  function friendlyError(raw) {
    var msg = String(raw || '');
    if (/did not finish loading|Failed to load: https?:/.test(msg))
      return L.errRuntime;
    if (/stopped by the learner/i.test(msg))
      return L.errStopped;
    if (/SyntaxError/i.test(msg))
      return L.errSyntax;
    var nm = msg.match(/name ['"]([\w]+)['"] is not defined/);
    if (nm)
      return L.errUnknownName(nm[1]);
    if (/NameError/i.test(msg))
      return L.errNameGeneric;
    if (/ZeroDivisionError/i.test(msg) || /\bzoo\b/.test(msg))
      return L.errDivZero;
    if (/TypeError/i.test(msg))
      return L.errType;
    return L.errGeneric;
  }

  // ---------------------------------------------------------------------------
  // Task-text renderer. Pool exercises are rendered in the browser, so this
  // mirrors the scalar/vector/matrix parser in math-exercise.lua.
  // ---------------------------------------------------------------------------

  function splitTop(text, separator) {
    var parts = [], depth = 0, current = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === separator && depth === 0) { parts.push(current.trim()); current = ''; }
      else current += ch;
    }
    parts.push(current.trim());
    return parts;
  }

  function scalarFieldHtml(fid, answer, vars, underscoreCount) {
    var base = ' id="' + fid + '"'
             + ' data-answer="' + escHtml(answer) + '"'
             + ' data-vars="'   + escHtml(vars)   + '"'
             + ' autocomplete="off" autocorrect="off" spellcheck="false"';
    if (underscoreCount >= 3) return '<textarea' + base + ' class="math-input math-input-large" rows="2"></textarea>';
    if (underscoreCount === 2) return '<input type="text"' + base + ' class="math-input math-input-medium">';
    return '<input type="text"' + base + ' class="math-input math-input-small">';
  }

  function matrixCellHtml(fid, answer, vars) {
    return '<input type="text" id="' + fid + '"'
         + ' data-answer="' + escHtml(answer) + '"'
         + ' data-vars="'   + escHtml(vars)   + '"'
         + ' autocomplete="off" autocorrect="off" spellcheck="false"'
         + ' class="math-input math-mat-cell">';
  }

  function buildVector(exerciseId, count, content, vars, vecdir) {
    var components = splitTop(content, ',');
    var ids = [], labels = [], cells = [];
    components.forEach(function (answer, index) {
      count++;
      var fid = exerciseId + '-f' + count;
      ids.push(fid);
      labels.push('v' + (index + 1));
      cells.push(matrixCellHtml(fid, answer, vars));
    });
    var rowClass = vecdir === 'row' ? ' math-vec-row' : '';
    return {
      html: '<span class="math-vec' + rowClass + '" style="--n:' + components.length + '">' + cells.join('') + '</span>',
      ids: ids, labels: labels, count: count
    };
  }

  function buildMatrix(exerciseId, count, content, vars) {
    var rows = splitTop(content, ';').map(function (row) { return splitTop(row, ','); });
    var columnCount = rows.length ? rows[0].length : 0;
    if (!columnCount || rows.some(function (row) { return row.length !== columnCount; })) {
      throw new Error('math-exercise: mat[...] rows must have the same number of columns');
    }
    var ids = [], labels = [], cells = [];
    rows.forEach(function (row, rowIndex) {
      row.forEach(function (answer, columnIndex) {
        count++;
        var fid = exerciseId + '-f' + count;
        ids.push(fid);
        labels.push('m' + (rowIndex + 1) + ',' + (columnIndex + 1));
        cells.push(matrixCellHtml(fid, answer, vars));
      });
    });
    return {
      html: '<span class="math-mat" style="--cols:' + columnCount + '">' + cells.join('') + '</span>',
      ids: ids, labels: labels, count: count
    };
  }

  var MAX_DYNAMIC_DIMENSION = 12;

  function parseDynamicMatrixSpec(content) {
    var raw = {};
    splitTop(content, ',').forEach(function (part) {
      var match = /^\s*([\w-]+)\s*=\s*(.*?)\s*$/.exec(part);
      if (!match || !match[2]) throw new Error('math-exercise: mat{...} entries must use key=value');
      if (Object.prototype.hasOwnProperty.call(raw, match[1]))
        throw new Error('math-exercise: duplicate mat{...} option ' + match[1]);
      raw[match[1]] = match[2];
    });
    var allowed = {
      name: true, rows: true, cols: true,
      'initial-rows': true, 'initial-cols': true,
      'min-rows': true, 'max-rows': true,
      'min-cols': true, 'max-cols': true,
    };
    Object.keys(raw).forEach(function (key) {
      if (!allowed[key]) throw new Error('math-exercise: unknown mat{...} option ' + key);
    });
    var name = raw.name || '';
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name))
      throw new Error('math-exercise: mat{...} requires name beginning with a letter');

    function integerOption(key, fallback) {
      if (raw[key] === undefined) return fallback;
      var value = Number(raw[key]);
      if (!Number.isInteger(value) || value < 0 || value > MAX_DYNAMIC_DIMENSION)
        throw new Error('math-exercise: ' + key + ' must be an integer from 0 to ' + MAX_DYNAMIC_DIMENSION);
      return value;
    }
    function axis(axisName) {
      if (raw[axisName] === undefined) throw new Error('math-exercise: mat{...} requires ' + axisName);
      if (raw[axisName] !== 'auto') {
        var fixed = integerOption(axisName, null);
        return { auto: false, initial: fixed, min: fixed, max: fixed };
      }
      var min = integerOption('min-' + axisName, 0);
      var max = integerOption('max-' + axisName, 8);
      if (min > max) throw new Error('math-exercise: min-' + axisName + ' cannot exceed max-' + axisName);
      var initial = integerOption('initial-' + axisName, Math.min(max, Math.max(1, min)));
      if (initial < min || initial > max)
        throw new Error('math-exercise: initial-' + axisName + ' must lie between min-' + axisName + ' and max-' + axisName);
      return { auto: true, initial: initial, min: min, max: max };
    }
    return { name: name, rows: axis('rows'), cols: axis('cols') };
  }

  function matrixEditorOptions(exerciseId, vars, onChange) {
    return {idPrefix:exerciseId, vars:vars, labels:L, zeroDimensions:'canonical', onChange:onChange};
  }

  function buildDynamicMatrix(exerciseId, content, vars, mode) {
    if (mode !== 'custom') throw new Error('math-exercise: mat{...} currently requires mode: custom');
    return window.MatrixInput.create(matrixEditorOptions(exerciseId,vars)).renderHTML(parseDynamicMatrixSpec(content));
  }

  function matchBalanced(text, position, open, close) {
    if (text.charAt(position) !== open) return null;
    var depth = 0;
    for (var i = position; i < text.length; i++) {
      if (text.charAt(i) === open) depth++;
      else if (text.charAt(i) === close && --depth === 0) return text.slice(position, i + 1);
    }
    return null;
  }

  // Raw exercise bodies bypass Pandoc's Markdown math handling. Normalize
  // paired dollar delimiters before inserting HTML so a page-level MathJax
  // pass cannot claim a bare \\begin{...} environment and strand the dollars.
  // Same placeholder as math-exercise.lua: a literal dollar becomes its own
  // element, so neither KaTeX auto-render nor MathJax treats it as a delimiter.
  var LITERAL_DOLLAR = '\uE024';
  var LITERAL_DOLLAR_HTML = '<span class="math-literal-dollar">$</span>';
  // A code span: the next backtick on the same line, with something between;
  // \` is a literal backtick. Returns the closing index or -1.
  function codeSpanEnd(s, i) {
    if (i > 0 && s.charAt(i - 1) === '\\') return -1;
    var k = s.indexOf('`', i + 1);
    if (k < 0 || k === i + 1) return -1;
    var newline = s.indexOf('\n', i + 1);
    return newline >= 0 && newline < k ? -1 : k;
  }

  function normalizeTaskMathDelimiters(text) {
    var output = '', position = 0;
    function unescapedAt(needle, start) {
      var found = text.indexOf(needle, start);
      while (found >= 0) {
        var slashes = 0;
        for (var i = found - 1; i >= 0 && text.charAt(i) === '\\'; i--) slashes++;
        if (slashes % 2 === 0) return found;
        found = text.indexOf(needle, found + needle.length);
      }
      return -1;
    }
    while (position < text.length) {
      var codeEnd = text.charAt(position) === '`' ? codeSpanEnd(text, position) : -1;
      if (codeEnd >= 0) {
        // A dollar inside a code span is literal.
        output += text.slice(position, codeEnd + 1); position = codeEnd + 1;
        continue;
      }
      if (text.charAt(position) === '$' && position > 0 && text.charAt(position - 1) === '\\') {
        // Escaped dollar: placeholder, turned into its own element after escaping.
        output = output.slice(0, -1) + LITERAL_DOLLAR; position++;
        continue;
      }
      if (text.charAt(position) !== '$') {
        output += text.charAt(position++);
        continue;
      }
      var display = text.slice(position, position + 2) === '$$';
      var delimiter = display ? '$$' : '$';
      var close = unescapedAt(delimiter, position + delimiter.length);
      if (close < 0) { output += text.charAt(position++); continue; }
      output += (display ? '\\[' : '\\(') + text.slice(position + delimiter.length, close) +
        (display ? '\\]' : '\\)');
      position = close + delimiter.length;
    }
    return output;
  }

  // Exercise text is Markdown-like plain text: HTML is shown as text (so a<b<c
  // in TeX stays intact), and outside math a small inline Markdown subset is
  // formatted: ***both***, **bold**, *italic*, `code`; \* and \` are literal; a
  // trailing backslash is a line break. Emphasis may contain math. Same rules
  // as inlineMarkdown()/proseHtml() in math-exercise.lua (parity test).
  var MATH_SLOT = '';   // stands for one math span while formatting
  var SPACE = /[ \t\r\n\f\v]/, WORD = /[A-Za-z0-9]/;

  function inlineMarkdown(s) {
    var out = '', i = 0, n = s.length;
    // Closing delimiter for emphasis opened just before `from`: on the same
    // line, not escaped, not after whitespace, not followed by another "*"
    // (or, for "*", by a letter or digit). Linear in the line length.
    function closing(delim, from) {
      if (from >= n || SPACE.test(s.charAt(from))) return -1;
      var newline = s.indexOf('\n', from); if (newline < 0) newline = n;
      var j = from + 1;
      for (;;) {
        var k = s.indexOf(delim, j);
        if (k < 0 || k >= newline) return -1;
        var next = s.charAt(k + delim.length), before = s.charAt(k - 1);
        if (next === '*' || before === '\\' || SPACE.test(before) || (delim === '*' && WORD.test(next))) j = k + 1;
        else return k;
      }
    }
    while (i < n) {
      var c = s.charAt(i), next = s.charAt(i + 1), k;
      if (c === '\\' && (next === '*' || next === '`')) { out += next; i += 2; }
      else if (c === '\\' && next === '\n') i++;   // Markdown hard line break: the newline already breaks the line
      else if (c === '`' && (k = codeSpanEnd(s, i)) >= 0) { out += '<code>' + s.slice(i + 1, k) + '</code>'; i = k + 1; }
      else if (s.slice(i, i + 3) === '***' && (k = closing('***', i + 3)) >= 0) {
        out += '<em><strong>' + inlineMarkdown(s.slice(i + 3, k)) + '</strong></em>'; i = k + 3;
      } else if (c === '*' && next === '*') {
        k = closing('**', i + 2);
        if (k >= 0) { out += '<strong>' + inlineMarkdown(s.slice(i + 2, k)) + '</strong>'; i = k + 2; }
        else { out += '**'; i += 2; }
      } else if (c === '*' && !(i > 0 && WORD.test(s.charAt(i - 1)))) {
        k = closing('*', i + 1);
        if (k >= 0) { out += '<em>' + inlineMarkdown(s.slice(i + 1, k)) + '</em>'; i = k + 1; }
        else { out += c; i++; }
      } else { out += c; i++; }
    }
    return out;
  }

  // Escapes a run of exercise text and formats inline Markdown outside math
  // (\( \), \[ \], \begin{..} \end{..} after normalizeTaskMathDelimiters) and
  // outside code spans. Each math span is a slot while formatting, so emphasis
  // may contain math.
  function proseHtml(text) {
    var plain = '', maths = [], position = 0;
    while (position < text.length) {
      var c = text.charAt(position), codeEnd = c === '`' ? codeSpanEnd(text, position) : -1;
      var two = text.slice(position, position + 2);
      var env = /^\\begin\{([^}]*)\}/.exec(text.slice(position, position + 200));
      var closer = two === '\\(' ? '\\)' : two === '\\[' ? '\\]' : env ? '\\end{' + env[1] + '}' : null;
      if (codeEnd >= 0) { plain += text.slice(position, codeEnd + 1); position = codeEnd + 1; }
      else if (closer) {
        var close = text.indexOf(closer, position + 2);
        var stop = close >= 0 ? close + closer.length : text.length;
        maths.push(escHtml(text.slice(position, stop)));
        plain += MATH_SLOT;
        position = stop;
      } else { plain += c; position++; }
    }
    var index = 0;
    return inlineMarkdown(escHtml(plain)).replace(//g, function () { return maths[index++]; });
  }

  function renderTaskText(text, exerciseId, vars, vecdir, mode, questionIsHtml) {
    // Generated variants have already been rendered by Pandoc; preserve their
    // markup and source annotations. Ordinary exercise bodies are plain text.
    if (!questionIsHtml) text = normalizeTaskMathDelimiters(text);
    mode = mode || 'equivalent';
    var count = 0, fieldIds = [], structuralLabels = [], output = [], position = 0, prose = '';
    var dynamicNames = {};
    function flush() {
      if (prose) { output.push(questionIsHtml ? prose : proseHtml(prose)); prose = ''; }
    }
    while (position < text.length) {
      var scalar = /^_+\[/.exec(text.slice(position));
      var boundary = !scalar && (position === 0 || !/[\w]/.test(text.charAt(position - 1)));
      var vector = !scalar && boundary && text.slice(position, position + 4) === 'vec[';
      var matrix = !scalar && !vector && boundary && text.slice(position, position + 4) === 'mat[';
      var dynamicMatrix = !scalar && !vector && !matrix && boundary && text.slice(position, position + 4) === 'mat{';
      var headLength = scalar ? scalar[0].length : (vector || matrix || dynamicMatrix ? 4 : 0);
      var bracket = headLength && !dynamicMatrix ? matchBalanced(text, position + headLength - 1, '[', ']') : null;
      var brace = dynamicMatrix ? matchBalanced(text, position + headLength - 1, '{', '}') : null;
      var balanced = bracket || brace;

      // Task prose and TeX are text, never HTML (see proseHtml); generated
      // controls below remain markup. In particular, a<b<c must reach the
      // math renderer.
      if (!balanced) { prose += text.charAt(position++); continue; }
      flush();

      // Inside an answer marker an escaped dollar is a plain dollar.
      var content = balanced.slice(1, -1).split(LITERAL_DOLLAR).join('$'), rendered;
      if (scalar) {
        count++;
        var fid = exerciseId + '-f' + count;
        output.push(scalarFieldHtml(fid, content, vars, scalar[0].length - 1));
        fieldIds.push(fid);
        structuralLabels.push('');
      } else if (vector || matrix) {
        rendered = vector
          ? buildVector(exerciseId, count, content, vars, vecdir)
          : buildMatrix(exerciseId, count, content, vars);
        output.push(rendered.html);
        fieldIds = fieldIds.concat(rendered.ids);
        structuralLabels = structuralLabels.concat(rendered.labels);
        count = rendered.count;
      } else {
        var spec = parseDynamicMatrixSpec(content);
        if (dynamicNames[spec.name]) throw new Error('math-exercise: duplicate dynamic matrix name ' + spec.name);
        dynamicNames[spec.name] = true;
        rendered = buildDynamicMatrix(exerciseId, content, vars, mode);
        output.push(rendered.html);
        fieldIds = fieldIds.concat(rendered.ids);
        structuralLabels = structuralLabels.concat(rendered.labels);
      }
      position += headLength - 1 + balanced.length;
    }
    flush();
    return {
      html: output.join('').split(LITERAL_DOLLAR).join(LITERAL_DOLLAR_HTML).replace(/\n/g, '<br>\n'),
      fieldIds: fieldIds,
      structuralLabels: structuralLabels
    };
  }

  // Pool questions are replaced on every draw. Save this draw's source before
  // typesetting, without answer keys; input ids remain for current field labels.
  function setQuestionContent(el, rendered) {
    el.dataset.mathExerciseSource = rendered.html.replace(/ data-answer="[^"]*"/g, '');
    el.innerHTML = rendered.html;
  }

  function localizeStructuralLabel(token) {
    if (!token) return '';
    if (/^v\d+$/.test(token)) return L.vecComponent(token.slice(1));
    var dynamicMatrix = /^dm:([A-Za-z][A-Za-z0-9_-]*):(\d+),(\d+)$/.exec(token);
    if (dynamicMatrix) return L.dynamicMatCell(dynamicMatrix[1], dynamicMatrix[2], dynamicMatrix[3]);
    var matrix = /^m(\d+),(\d+)$/.exec(token);
    return matrix ? L.matCell(matrix[1], matrix[2]) : '';
  }

  function dynamicSpecFromElement(matrix) {
    return {
      name: matrix.dataset.matrixName,
      rows: {
        auto: matrix.dataset.autoRows === 'true',
        initial: Number(matrix.dataset.lastRows),
        min: Number(matrix.dataset.minRows),
        max: Number(matrix.dataset.maxRows),
      },
      cols: {
        auto: matrix.dataset.autoCols === 'true',
        initial: Number(matrix.dataset.lastCols),
        min: Number(matrix.dataset.minCols),
        max: Number(matrix.dataset.maxCols),
      },
    };
  }

  function collectDynamicMatrixInputs(root) {
    var inputs = {};
    root.querySelectorAll('.math-dynamic-mat').forEach(function (matrix) {
      var name = matrix.dataset.matrixName;
      if (matrix.parentElement.matrixInput) {
        var value = matrix.parentElement.matrixInput.read();
        value.raw = value.raw.map(function (raw) { return raw.trim(); });
        inputs[name] = value; return;
      }
      var rows = Number(matrix.dataset.rows), cols = Number(matrix.dataset.cols);
      var raw = [];
      for (var row = 1; row <= rows; row++) {
        for (var column = 1; column <= cols; column++) {
          var selector = 'input[data-matrix-row="' + row + '"][data-matrix-column="' + column + '"]';
          var input = matrix.querySelector(selector);
          raw.push(input ? input.value.trim() : '');
        }
      }
      inputs[name] = { type: 'matrix', rows: rows, cols: cols, raw: raw };
    });
    return inputs;
  }

  function resizedDynamicMatrixShape(matrix, spec, action) {
    return window.MatrixInput.create({zeroDimensions:'canonical'}).resizedShape(matrix, spec, action);
  }

  function initializeDynamicMatrices(root, exerciseId, vars, onChange) {
    var wraps = root.querySelectorAll('.math-dynamic-matrix-wrap');
    var names = Object.create(null);
    // Validate the complete question before attaching any editors or handlers.
    wraps.forEach(function (wrap) {
      var matrix = wrap.querySelector('.math-dynamic-mat');
      if (!matrix) return;
      var name = matrix.dataset.matrixName;
      if (names[name]) throw new Error('math-exercise: duplicate dynamic matrix name ' + name);
      names[name] = true;
    });
    wraps.forEach(function (wrap) {
      window.MatrixInput.create(matrixEditorOptions(exerciseId,vars,onChange)).mount(wrap);
    });
  }

  // ---------------------------------------------------------------------------
  // External response bridge
  //
  // Sandboxed JSXGraph data-URL iframes have an opaque origin, so the parent
  // cannot read their DOM directly. The transport therefore uses postMessage,
  // validates the responding window/request id, and otherwise leaves the JSON
  // payload completely application-defined.
  // ---------------------------------------------------------------------------

  var ASSESSMENT_PROTOCOL = 'jsxgraph-quarto-assessment';
  var ASSESSMENT_VERSION = 1;
  var MAX_ASSESSMENT_JSON_BYTES = 1024 * 1024;
  var assessmentSequence = 0;

  function notifyExternalLayout(iframe) {
    if (!iframe || iframe.tagName !== 'IFRAME' || !iframe.contentWindow) return false;
    iframe.contentWindow.postMessage({
      protocol: ASSESSMENT_PROTOCOL,
      version: ASSESSMENT_VERSION,
      type: 'layout',
      assessmentId: iframe.id
    }, '*');
    return true;
  }

  function scheduleExternalLayout(iframe) {
    notifyExternalLayout(iframe);
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(function () {
        notifyExternalLayout(iframe);
        window.requestAnimationFrame(function () { notifyExternalLayout(iframe); });
      });
    } else {
      window.setTimeout(function () { notifyExternalLayout(iframe); }, 0);
    }
  }

  function requestExternalResponse(sourceSpec, includeAI) {
    var match = /^jsxgraph:(.+)$/.exec(sourceSpec || '');
    if (!match) return Promise.reject(new Error('Unsupported response source: ' + sourceSpec));
    var iframeId = match[1].trim();
    var iframe = document.getElementById(iframeId);
    if (!iframe || iframe.tagName !== 'IFRAME' || !iframe.contentWindow) {
      return Promise.reject(new Error('JSXGraph response iframe not found: ' + iframeId));
    }

    var requestId = 'math-exercise-' + Date.now() + '-' + (++assessmentSequence);
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = window.setTimeout(function () {
        finish(new Error('Timed out waiting for JSXGraph response: ' + iframeId));
      }, 5000);

      function finish(err, value) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (err) reject(err); else resolve(value);
      }

      function onMessage(event) {
        if (event.source !== iframe.contentWindow) return;
        var message = event.data;
        if (!message || message.protocol !== ASSESSMENT_PROTOCOL ||
            message.version !== ASSESSMENT_VERSION || message.type !== 'response' ||
            message.requestId !== requestId || message.assessmentId !== iframeId) return;
        if (message.error) {
          finish(new Error(String(message.error)));
          return;
        }
        try {
          var serialized = JSON.stringify(message.payload);
          if (typeof serialized !== 'string') throw new Error('Assessment response is not JSON-serializable');
          var byteLength = typeof TextEncoder !== 'undefined'
            ? new TextEncoder().encode(serialized).length
            : serialized.length;
          if (byteLength > MAX_ASSESSMENT_JSON_BYTES) {
            throw new Error('Assessment response exceeds the 1 MB transport limit');
          }
          finish(null, { response: message.payload, ai: message.ai || null });
        } catch (err) {
          finish(err);
        }
      }

      window.addEventListener('message', onMessage);
      iframe.contentWindow.postMessage({
        protocol: ASSESSMENT_PROTOCOL,
        version: ASSESSMENT_VERSION,
        type: 'request',
        assessmentId: iframeId,
        requestId: requestId,
        includeAI: !!includeAI
      }, '*');
    });
  }

  async function collectCustomResponse(fieldIds, opts, includeAI, structuredInputs) {
    if (opts.responseSource) return requestExternalResponse(opts.responseSource, includeAI);
    var values = fieldIds.map(function (id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    });
    var hasStructuredInput = structuredInputs && Object.keys(structuredInputs).length > 0;
    var response = { kind: 'expressions', raw: values, inputs: structuredInputs || {} };
    if ((!values.length && !hasStructuredInput) || values.some(function (value) { return value === ''; })) {
      return { empty: true, response: response, ai: null };
    }
    return { response: response, ai: null };
  }

  function externalAISummary(ai) {
    if (!ai || ai.summary === undefined || ai.summary === null) return '';
    var text = typeof ai.summary === 'string' ? ai.summary : JSON.stringify(ai.summary);
    return String(text || '').slice(0, 4000);
  }

  function normalizedAssessmentStatus(value) {
    if (value === true) return 'correct';
    if (value === false) return 'incorrect';
    if (typeof value === 'number') return value >= 1 - 1e-9 ? 'correct' : (value <= 1e-9 ? 'incorrect' : 'partial');
    var status = String(value || '').toLowerCase();
    if (status === 'wrong') return 'incorrect';
    return /^(correct|dependent|partial|incorrect|empty|invalid)$/.test(status) ? status : '';
  }

  function structuredGroupStatus(assessment, name, axis, index) {
    var matrix = assessment && assessment[name];
    var values = matrix && matrix[axis];
    return Array.isArray(values) ? normalizedAssessmentStatus(values[index - 1]) : '';
  }

  function applyCustomAssessment(questionDiv, result) {
    var assessment = result.assessment || {};
    questionDiv.querySelectorAll('.math-dynamic-matrix-wrap').forEach(function (wrap) {
      if (!wrap.matrixInput) return;
      var matrix = assessment[wrap.dataset.matrixName] || {};
      var shape = wrap.matrixInput.read();
      function axisStatuses(values, bound) {
        return Array.isArray(values) ? values.slice(0, bound).map(normalizedAssessmentStatus) : [];
      }
      wrap.matrixInput.setState({
        status: result.status === 'wrong' ? 'incorrect' : result.status,
        rows: axisStatuses(matrix.rows, shape.rows),
        columns: axisStatuses(matrix.columns, shape.cols),
      });
    });
    questionDiv.querySelectorAll('input.math-input').forEach(function (input) {
      if (input.dataset.dynamicMatrixName && input.closest('.math-dynamic-matrix-wrap').matrixInput) return;
      input.classList.remove('math-input-ok', 'math-input-dependent', 'math-input-partial', 'math-input-wrong', 'math-input-err');
      var status = '';
      if (input.dataset.dynamicMatrixName) {
        status = structuredGroupStatus(
          assessment, input.dataset.dynamicMatrixName, 'columns', Number(input.dataset.matrixColumn)
        ) || structuredGroupStatus(
          assessment, input.dataset.dynamicMatrixName, 'rows', Number(input.dataset.matrixRow)
        );
      }
      status = status || result.status;
      if (status === 'correct') input.classList.add('math-input-ok');
      else if (status === 'dependent') input.classList.add('math-input-dependent');
      else if (status === 'partial') input.classList.add('math-input-partial');
      else if (status === 'error' || status === 'invalid') input.classList.add('math-input-err');
      else if (status !== 'empty') input.classList.add('math-input-wrong');
    });
  }

  function structuredAssessmentXml(structuredAssessment) {
    return Object.keys(structuredAssessment || {}).map(function (name) {
      var assessment = structuredAssessment[name];
      var groups = [];
      ['rows', 'columns'].forEach(function (axis) {
        var values = assessment && assessment[axis];
        if (!Array.isArray(values)) return;
        values.forEach(function (value, index) {
          var status = normalizedAssessmentStatus(value);
          if (status) groups.push('<' + axis.slice(0, -1) + ' index="' + (index + 1) +
            '" status="' + status + '"/>');
        });
      });
      return groups.length ? '<matrix name="' + promptXmlEsc(name) + '">' + groups.join('') + '</matrix>' : '';
    }).filter(Boolean).join('\n');
  }

  function expressionAnswersXml(responses, structuredInputs) {
    var parts = responses.filter(function (field) {
      return !(field.element && field.element.dataset.dynamicMatrixName);
    }).map(function (field) {
      return '<field label="' + promptXmlEsc(field.label) + '">' +
        promptXmlEsc(field.value) + '</field>';
    });
    Object.keys(structuredInputs || {}).forEach(function (name) {
      var matrix = structuredInputs[name];
      var entries = [];
      for (var row = 0; row < matrix.rows; row++) {
        var values = matrix.raw.slice(row * matrix.cols, (row + 1) * matrix.cols);
        entries.push('<row index="' + (row + 1) + '">' +
          values.map(function (value, column) {
            return '<entry column="' + (column + 1) + '">' + promptXmlEsc(value) + '</entry>';
          }).join('') + '</row>');
      }
      parts.push('<matrix name="' + promptXmlEsc(name) + '" rows="' + matrix.rows +
        '" columns="' + matrix.cols + '">' + entries.join('') + '</matrix>');
    });
    return parts.join('\n');
  }

  // ---------------------------------------------------------------------------
  // SymPy checker
  // ---------------------------------------------------------------------------

  // Calls the _math_check() helper defined once in ensureSympy() and returns
  // its result as a JSON status string.
  var CHECK_PY = runtimeCall('_math_check');
  var CHECK_CUSTOM_PY = runtimeCall('_math_check_custom');

  // Python globals are shared: keep each set-globals/evaluate transaction together.
  var assessmentQueue = Promise.resolve();
  function assessmentTransaction(run) {
    var result=assessmentQueue.then(run);assessmentQueue=result.catch(function(){});return result;
  }
  function checkField(el, mode, opts) {var field={value:el.value,dataset:Object.assign({},el.dataset)}, options=JSON.parse(JSON.stringify(opts||{}));return assessmentTransaction(function(){return checkFieldNow(field,mode,options);});}
  function checkCustom(response, opts) {var answer=JSON.parse(JSON.stringify(response)),options=JSON.parse(JSON.stringify(opts));return assessmentTransaction(function(){return checkCustomNow(answer,options);});}
  async function checkFieldNow(el, mode, opts) {
    var val = el.value.trim();
    if (!val) return { status: 'empty', score: 0.0 };
    opts = opts || {};
    return runOnCurrentRuntime(async function (py) {
      await Promise.all([
        py.globals.set('_math_student',   val),
        py.globals.set('_math_correct',   el.dataset.answer || ''),
        py.globals.set('_math_vars',      el.dataset.vars   || ''),
        py.globals.set('_math_mode',      mode || 'equivalent'),
        py.globals.set('_math_reject',    opts.reject    || ''),
        py.globals.set('_math_tolerance', opts.tolerance || ''),
        py.globals.set('_math_decplaces', opts.decplaces || ''),
        py.globals.set('_math_sigfigs',   opts.sigfigs   || ''),
        py.globals.set('_math_form',      opts.form      || ''),
        py.globals.set('_math_partial_credit', !!opts.partialCredit),
        py.globals.set('_math_form_credit', Number(opts.formCredit)),
      ]);
      return JSON.parse(await py.runPythonAsync(CHECK_PY));
    });
  }

  // A check that was running when the runtime was replaced (Stop/restart) is
  // repeated once on the new runtime instead of reporting a spurious error.
  // The first check also covers SymPy's multi-second setup, so a restart
  // during setup is retried as well.
  // A check stopped from any button on the page (runtime.stopCount) is not repeated.
  // `math-exercise: stop-after:` / `ctm-assessment: stop-after:` (seconds, default 20).
  var SLOW_CHECK_MS = (typeof window !== 'undefined' && window.__mathExerciseSlowCheckMs) ||
    (Number(ME_CFG.stopAfter) > 0 ? Number(ME_CFG.stopAfter) * 1000 : 20000);
  // Checks in progress, told when Python reloads during a retry: loading is
  // timed by the load limit, not by stop-after. A check counts as loading while
  // any retry reloads (its Python calls wait behind that reload).
  var reloadHooks = new Set(), activeReloads = 0;
  function stoppedSince(epoch) { return epoch !== globalThis.MathExerciseRuntime.stopCount(); }
  async function runOnCurrentRuntime(run, packages) {
    var epoch = globalThis.MathExerciseRuntime.stopCount();
    var attempted = await ensurePyodide(), ready = null;
    try {
      ready = await ensureSympy();
      return await run(ready);
    } catch (error) {
      if (stoppedSince(epoch)) throw new Error('math-exercise: stopped by the learner');
      // Learner code elsewhere on the page removed the checker module: install again.
      var missing = /No module named '_ctm_|has no attribute '_math_run'/.test(String(error));
      if (missing) {
        globalThis.MathExerciseRuntime.forgetModules(ready || attempted);
        sympyRuntime = null; sympyLoading = null;
      }
      var current;
      activeReloads++;
      try {
        reloadHooks.forEach(function (hook) { hook(); });
        current = await ensureSympy();
        // The exercise's packages reload within the same loading window.
        if (packages) await ensurePackages(packages);
      } catch (reloadError) {
        // Stop pressed (here or in another exercise) while Python reloaded.
        if (stoppedSince(epoch)) throw new Error('math-exercise: stopped by the learner');
        throw reloadError;
      } finally {
        activeReloads--;
        reloadHooks.forEach(function (hook) { hook(); });
      }
      if (stoppedSince(epoch)) throw new Error('math-exercise: stopped by the learner');
      if (current === (ready || attempted) && !missing) throw error;
      return run(current);
    }
  }
  // Prepares SymPy and the exercise's packages, with the same retry.
  function prepareRuntime(packages) {
    return runOnCurrentRuntime(function () { return ensurePackages(packages); }, packages);
  }

  async function checkCustomNow(response, opts) {
    if (opts.variant) {
      if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Generated custom responses must be objects');
      response = Object.assign({}, response, {variant: opts.variant});
    }
    return runOnCurrentRuntime(async function (py) {
      await ensurePackages(opts.packages);
      await Promise.all([
        py.globals.set('_math_response_json', JSON.stringify(response)),
        py.globals.set('_math_vars', opts.vars || ''),
        py.globals.set('_math_checker', opts.checker || ''),
      ]);
      return JSON.parse(await py.runPythonAsync(CHECK_CUSTOM_PY));
    }, opts.packages);
  }

  // Domain extraction delegates shared context and math-safe serialization.
  // Without ai-feedback on the page (feedback off) a plain text snapshot is
  // enough: these texts only detect edits and build feedback requests.
  function contextText(root, labels) {
    if (window.AIFeedback) return window.AIFeedback.contextText(root, labels);
    return root ? root.textContent.trim() : '';
  }
  function questionText(cell, ids, label) {
    if (window.AIFeedback) return window.AIFeedback.questionText(cell, ids, label);
    var question = cell.querySelector('.math-exercise-question');
    return question ? question.textContent.trim() : '';
  }
  function resolveContexts(cell) {
    var text = '';
    try { text = JSON.parse(cell.dataset.context || '""'); } catch (_) {}
    var materials = window.AIFeedback.contextMaterials({mode:cell.dataset.contextMode || 'auto', refs:cell.dataset.contextRefs || '', text});
    if (cell.dataset.contextMode !== 'none' && cell.mathExercise?.getVariant()?.context) {
      materials.push({id:cell.dataset.label + '-variant', title:'Variant context', text:cell.mathExercise.getVariant().context});
    }
    return materials;
  }

  // ---------------------------------------------------------------------------
  // Exercise cell setup
  // ---------------------------------------------------------------------------

  function setupVariantReview(cell, generated) {
    var panel=document.createElement('details');panel.className='math-variant-review ai-feedback-ignore';
    var summary=document.createElement('summary');summary.textContent='Review variants ('+generated.variants.length+')'+(generated.staleReview?' — previous approval is outdated':'');panel.append(summary);
    var runners=[], table=document.createElement('table'), selected=new Set(generated.variants.filter(v=>v.included).map(v=>v.id));
    var heading=document.createElement('tr');['Include','Variant','Parameters','Tests'].forEach(function(text){var th=document.createElement('th');th.textContent=text;heading.append(th);});table.append(heading);
    generated.variants.forEach(function(record,index){
      var tr=document.createElement('tr'),choose=document.createElement('td'),input=document.createElement('input');input.type='checkbox';input.checked=selected.has(record.id);input.setAttribute('aria-label','Include '+record.id);
      input.addEventListener('change',function(){if(input.checked)selected.add(record.id);else selected.delete(record.id);});choose.append(input);tr.append(choose);
      var label=document.createElement('td'),inspect=document.createElement('button');inspect.type='button';inspect.textContent=(index+1)+' · '+record.id;inspect.addEventListener('click',function(){cell.mathExercise.selectVariant(record.id);});label.append(inspect);tr.append(label);
      var params=document.createElement('td');params.textContent=JSON.stringify(record.parameters);tr.append(params);
      var tests=document.createElement('td'),run=document.createElement('button');run.type='button';run.textContent=record.tests.length?'Run '+record.tests.length+' tests':'No authored tests';run.disabled=!record.tests.length;
      var result=document.createElement('span');result.setAttribute('role','status');
      var runTests=async function(){
        run.disabled=true;result.textContent=' Running…';
        try{
          for(var fixture of record.tests){
            var actual=(await cell.mathExercise.checkFixture(record,fixture)).map(x=>x.status);
            var expected=Array.isArray(fixture.expected)?fixture.expected:[fixture.expected];
            if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error((fixture.name||'Fixture')+': expected '+expected+', got '+actual);
          }
          result.textContent=' Passed';
        }catch(error){result.textContent=' Failed: '+error.message;}finally{run.disabled=false;}
      };run.addEventListener('click',runTests);if(record.tests.length)runners.push(runTests);tests.append(run,result);tr.append(tests);table.append(tr);
    });panel.append(table);
    var runAll=document.createElement('button');runAll.type='button';runAll.textContent='Run all authored tests';runAll.disabled=!runners.length;
    runAll.addEventListener('click',async function(){runAll.disabled=true;try{for(var run of runners)await run();}finally{runAll.disabled=false;}});panel.append(runAll);
    var exportButton=document.createElement('button');exportButton.type='button';exportButton.textContent='Copy selection';
    var output=document.createElement('textarea');output.rows=5;output.readOnly=true;output.setAttribute('aria-label','Selection options to replace in the exercise QMD');
    exportButton.addEventListener('click',function(){
      if(!selected.size){output.value='Select at least one variant.';return;}
      output.value='#| reviewed-fingerprint: '+generated.fingerprint+'\n#| include-variants: '+JSON.stringify(Array.from(selected).sort())+'\n';
      output.focus();output.select();
      if(navigator.clipboard)navigator.clipboard.writeText(output.value).catch(function(){});
    });panel.append(exportButton,output);cell.append(panel);
  }

  function setupCell(cell) {
    var vars   = cell.dataset.vars   || '';
    var mode   = cell.dataset.mode   || 'equivalent';
    var reject = cell.dataset.reject || '';
    var label  = cell.dataset.label  || cell.id;
    var vecdir = cell.dataset.vecdir || 'col';
    var configuredFieldLabels = [];
    try { configuredFieldLabels = JSON.parse(cell.dataset.fieldLabels || '[]'); } catch (e) {}
    var structuralFieldLabels = [];
    try { structuralFieldLabels = JSON.parse(cell.dataset.structuralFieldLabels || '[]'); } catch (e) {}
    var checker = '';
    try { checker = JSON.parse(cell.dataset.checker || '""'); } catch (e) {}
    var packages = [];
    try { packages = JSON.parse(cell.dataset.packages || '[]'); } catch (e) {}
    var formCredit = Number(cell.dataset.formCredit || '0.5');
    if (!Number.isFinite(formCredit) || formCredit < 0 || formCredit > 1) formCredit = 0.5;
    var checkOpts = {
      reject:    reject,
      tolerance: cell.dataset.tolerance || '',
      decplaces: cell.dataset.decplaces || '',
      sigfigs:   cell.dataset.sigfigs   || '',
      form:      cell.dataset.form      || '',
      vars:       vars,
      checker:    checker,
      packages:   packages,
      responseSource: cell.dataset.response || '',
      partialCredit: cell.dataset.partialCredit === 'true',
      formCredit: formCredit
    };

    if (cell.dataset.embedResponse === 'true' && checkOpts.responseSource.indexOf('jsxgraph:') === 0) {
      var assessmentId = checkOpts.responseSource.slice('jsxgraph:'.length);
      var responseFrame = document.getElementById(assessmentId);
      var responseSlot = cell.querySelector('.math-exercise-response-slot');
      if (responseFrame && responseFrame.tagName === 'IFRAME' && responseSlot) {
        responseSlot.appendChild(responseFrame);
        responseFrame.addEventListener('load', function () {
          scheduleExternalLayout(responseFrame);
        });
      } else {
        console.warn('math-exercise: could not embed JSXGraph response "' + assessmentId + '".');
      }
    }

    var generated = cell.dataset.variants ? JSON.parse(cell.dataset.variants) : null;
    function currentVariant() {
      if (!generated) return null;
      var record = generated.variants[idx];
      return JSON.parse(JSON.stringify({id:record.id, parameters:record.parameters, derived:record.derived,
        fingerprint:record.fingerprint, context:record['variant-context']}));
    }
    function publishVariant() {
      if (!generated) return;
      var record = generated.variants[idx];
      checkOpts.variant = currentVariant();
      checkOpts.checker = record.checker;
      cell.dataset.variantId = record.id;
      try { sessionStorage.setItem(poolKey + '|id', record.id); } catch (_) {}
      var target = generated.solutionTarget && document.getElementById(generated.solutionTarget);
      if (!target && record.solution) {
        var details = cell.querySelector('.math-variant-solution');
        if (!details) {
          details = document.createElement('details'); details.className='math-variant-solution ai-feedback-ignore';
          var summary=document.createElement('summary');summary.textContent='Løsningsforslag / Solution';details.append(summary);
          target=document.createElement('div');target.className='math-variant-solution-body';details.append(target);cell.append(details);
        } else target=details.querySelector('.math-variant-solution-body');
        details.open=false;
      }
      if (target) {
        target.classList.add('ai-feedback-ignore');
        if(window.MathJax?.typesetClear)window.MathJax.typesetClear([target]);
        target.innerHTML=record.solution;
        renderMathInQuestion(target);
      }
      cell.dispatchEvent(new CustomEvent('math-exercise:variant-change', {bubbles:true, detail:{label:label, variant:currentVariant()}}));
    }
    var poolRaw   = cell.dataset.pool;
    var poolTasks = poolRaw ? JSON.parse(poolRaw) : null;
    var poolKey   = 'math-pool|' + location.pathname + '|' + label;

    // Pool: pick a stored or random task index, then render the question
    if (poolTasks) {
      var idx;
      try {
        idx = generated ? generated.variants.findIndex(function(v){return v.id === sessionStorage.getItem(poolKey + '|id');})
          : parseInt(sessionStorage.getItem(poolKey));
      } catch(e) {}
      if (isNaN(idx) || idx < 0 || idx >= poolTasks.length) {
        idx = Math.floor(Math.random() * poolTasks.length);
        try { sessionStorage.setItem(poolKey, String(idx)); } catch(e) {}
      }
      var r = renderTaskText(poolTasks[idx], cell.id, vars, vecdir, mode, !!generated);
      var qDiv = cell.querySelector('.math-exercise-question');
      setQuestionContent(qDiv, r);
      cell.dataset.fields = JSON.stringify(r.fieldIds);
      cell.dataset.structuralFieldLabels = JSON.stringify(r.structuralLabels);
      structuralFieldLabels = r.structuralLabels;
      renderMathInQuestion(qDiv);
    } else {
      renderMathInQuestion(cell.querySelector('.math-exercise-question'));
    }

    // Collapsible (only when caption toggle exists)
    var toggleEl = cell.querySelector('.math-exercise-toggle');
    var bodyEl   = cell.querySelector('.math-exercise-body');
    if (toggleEl && bodyEl) {
      function toggleOpen() {
        var open = cell.classList.toggle('math-exercise-open');
        toggleEl.setAttribute('aria-expanded', String(open));
        bodyEl.setAttribute('aria-hidden', String(!open));
        if (open && responseFrame) scheduleExternalLayout(responseFrame);
      }
      toggleEl.addEventListener('click', toggleOpen);
      toggleEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOpen(); }
      });
    }

    var fieldIds    = JSON.parse(cell.dataset.fields || '[]');
    var checkBtn    = cell.querySelector('.math-check-btn');
    var legendBtn   = cell.querySelector('.math-legend-btn');
    var feedbackBtn  = cell.querySelector('.math-feedback-btn');
    var reconfigBtn  = cell.querySelector('.math-reconfig-btn');
    var reloadBtn    = cell.querySelector('.math-pool-reload');
    var legendPanel = cell.querySelector('.math-legend-panel');
    var fbDiv       = cell.querySelector('.math-feedback-area');
    var legendBuilt = false;
    var questionDiv = cell.querySelector('.math-exercise-question');
    var structuralLabelById = {};
    var checkedEvidence = null;
    var feedbackHandle = null;
    var revision = 0;
    var visualKey = null, visual = null;
    function invalidateFeedback() {
      revision++;
      checkedEvidence = null;
      if (output && feedbackHandle) output.replaceChildren();
      if (feedbackHandle) feedbackHandle.cancel();
    }
    function localSnapshot() {
      refreshFields();
      return JSON.stringify({ task: questionText(cell, fieldIds, fieldLabel),
        variant: poolTasks ? idx : null,
        fields: fieldIds.map(function (id, i) { return [id, fieldLabel(i), document.getElementById(id).value.trim()]; }),
        matrices: collectDynamicMatrixInputs(questionDiv), options: checkOpts, revision: revision });
    }
    function safeResult(result) {
      var status = normalizedAssessmentStatus(result.status);
      if (!status && /^(rejected|not_exact|not_form)$/.test(result.status)) status = result.score > 0 ? 'partial' : 'incorrect';
      var value = { status: status || 'invalid' };
      if (typeof result.score === 'number' && Number.isFinite(result.score)) value.score = result.score;
      var allowed = {};
      Object.keys(collectDynamicMatrixInputs(questionDiv)).forEach(function (name) {
        if (result.assessment && result.assessment[name]) allowed[name] = result.assessment[name];
      });
      var matrices = structuredAssessmentXml(allowed);
      if (matrices) value.matrices = matrices;
      return value;
    }


    function rememberCurrentLabels() {
      fieldIds.forEach(function (id, index) {
        structuralLabelById[id] = structuralFieldLabels[index] || '';
      });
    }

    function refreshFields() {
      var ids = [], labels = [];
      questionDiv.querySelectorAll('input.math-input, textarea.math-input').forEach(function (input) {
        ids.push(input.id);
        labels.push(input.dataset.structuralLabel || structuralLabelById[input.id] || '');
      });
      fieldIds = ids;
      structuralFieldLabels = labels;
      rememberCurrentLabels();
      cell.dataset.fields = JSON.stringify(fieldIds);
      cell.dataset.structuralFieldLabels = JSON.stringify(structuralFieldLabels);
    }

    function clearAssessmentAfterResize() {
      invalidateFeedback();
      questionDiv.querySelectorAll('.math-input').forEach(function (input) {
        input.classList.remove('math-input-ok', 'math-input-dependent', 'math-input-partial', 'math-input-wrong', 'math-input-err');
      });
      fbDiv.innerHTML = '';
    }

    function setupDynamicMatrices() {
      initializeDynamicMatrices(questionDiv, cell.id, vars, function () {
        refreshFields();
        attachKeyListeners();
        clearAssessmentAfterResize();
      });
      refreshFields();
    }

    rememberCurrentLabels();
    setupDynamicMatrices();

    function fillInitialValues() {
      var values = JSON.parse(cell.dataset.initialValues || '[]');
      if (!values.length) return;
      if (values.length !== fieldIds.length) {
        throw new Error('math-exercise: initial-values must match the number of answer fields in ' + label);
      }
      fieldIds.forEach(function(id, index) { document.getElementById(id).value = values[index]; });
    }
    fillInitialValues();

    function fieldLabel(index) {
      var supplied = configuredFieldLabels[index];
      if (typeof supplied === 'string' && supplied.trim()) return supplied.trim();
      var structural = localizeStructuralLabel(structuralFieldLabels[index]);
      if (structural) return structural;
      return fieldIds.length === 1 ? L.feedbackFieldSingle : L.feedbackFieldNumbered(index + 1);
    }

    function warnExtraFieldLabels() {
      if (configuredFieldLabels.length > fieldIds.length && typeof console !== 'undefined' && console.warn) {
        console.warn(L.warnExtraFieldLabels, label);
      }
    }
    warnExtraFieldLabels();

    // ---- Legend toggle ----
    legendBtn.addEventListener('click', async function () {
      if (legendPanel.style.display === 'none') {
        legendPanel.style.display = '';
        legendBtn.classList.add('active');
        if (!legendBuilt) {
          legendPanel.innerHTML = '<div class="math-fb-checking">' + L.loadingHelp + '</div>';
          await buildLegend(legendPanel);
          legendBuilt = true;
        }
      } else {
        legendPanel.style.display = 'none';
        legendBtn.classList.remove('active');
      }
    });

    // ---- Check ----
    async function runCheck() {
      if (checkBtn.disabled) return;
      feedbackHandle?.reset('run');
      refreshFields();
      if (feedbackHandle) feedbackHandle.cancel();
      checkedEvidence = null;
      var checkSnapshot = localSnapshot();
      var results = [];
      checkBtn.disabled = true;
      if (feedbackBtn) feedbackBtn.disabled = true;
      fbDiv.innerHTML = '<div class="math-fb-checking">' + L.checking + '</div>';
      var cancelSlow = function () {}, phase = null, stopNote = null;
      var offerStop = function (loading) {
          var note = stopNote = document.createElement('div');
          note.className = 'math-fb-checking';
          note.textContent = (loading ? L.slowLoad : L.slowCheck) + ' ';
          var stopBtn = document.createElement('button');
          stopBtn.type = 'button';
          stopBtn.className = 'btn btn-sm btn-outline-danger math-stop-btn';
          stopBtn.textContent = L.stop;
          stopBtn.addEventListener('click', function () {
            globalThis.MathExerciseRuntime.stop('Stopped by the learner');
          });
          note.appendChild(stopBtn);
          fbDiv.replaceChildren(note);
      };
      // Loading is timed by the load limit (a load that never finishes can
      // still be stopped), the check itself by stop-after.
      var timePhase = function (loading) {
        // The same phase keeps its timer; a new one starts its own and takes
        // back a Stop note that belonged to the previous phase.
        if (loading === phase) return;
        phase = loading;
        if (stopNote && stopNote.isConnected) fbDiv.innerHTML = '<div class="math-fb-checking">' + L.checking + '</div>';
        stopNote = null;
        cancelSlow();
        cancelSlow = globalThis.MathExerciseRuntime.whenSlow(
          loading ? globalThis.MathExerciseRuntime.loadTimeout : SLOW_CHECK_MS,
          function () { offerStop(loading); });
      };
      // A reload during another check's retry ends with that check's own phase.
      var stillLoading = true;
      var onReload = function () { timePhase(activeReloads > 0 || stillLoading); };
      reloadHooks.add(onReload);
      try {
        timePhase(true);
        await prepareRuntime(checkOpts.packages);
        stillLoading = false;
        timePhase(activeReloads > 0);
        var parts = [];
        var fieldElements = fieldIds.map(function (id) { return document.getElementById(id); });
        if (mode === 'custom') {
          var transport = await collectCustomResponse(fieldIds, checkOpts, false, collectDynamicMatrixInputs(questionDiv));
          if (checkSnapshot !== localSnapshot()) return;
          var custom = transport.empty ? { status: 'empty', score: 0 } : await checkCustom(transport.response, checkOpts);
          if (checkSnapshot !== localSnapshot()) return;
          checkedEvidence = { snapshot: checkSnapshot, graph: JSON.stringify(transport.response), results: [safeResult(custom)] };
          applyCustomAssessment(questionDiv, custom);
          var customMessage = custom.feedback ? ' ' + escHtml(custom.feedback) : '';
          var customPct = Math.round((Number(custom.score) || 0) * 100);
          if (custom.status === 'correct')
            parts.push('<div class="math-fb-ok">&#10003;&nbsp;' + L.resCorrect + customMessage + '</div>');
          else if (custom.status === 'partial')
            parts.push('<div class="math-fb-partial">' +
              (custom.show_score === false ? L.resPartialNoScore : L.resPartial(customPct)) + customMessage + '</div>');
          else if (custom.status === 'wrong')
            parts.push('<div class="math-fb-wrong">&#10007;&nbsp;' + L.resWrong + customMessage + '</div>');
          else if (custom.status === 'empty')
            parts.push('<div class="math-fb-empty">' + L.resEmpty + '</div>');
          else
            parts.push('<div class="math-fb-err">&#9888;&nbsp;' + friendlyError(custom.message) + '</div>');
          fbDiv.innerHTML = parts.join('');
          return;
        }
        var totalScore = 0;
        var scoredFields = 0;
        for (var i = 0; i < fieldIds.length; i++) {
          var el     = document.getElementById(fieldIds[i]);
          if (!el) continue;
          var prefix = fieldIds.length > 1 ? escHtml(fieldLabel(i)) + ': ' : '';
          var res    = await checkField(el, mode, checkOpts);
          if (checkSnapshot !== localSnapshot()) return;
          results.push({ label: fieldLabel(i), result: safeResult(res) });
          el.classList.remove('math-input-ok', 'math-input-dependent', 'math-input-partial', 'math-input-wrong', 'math-input-err');
          if (typeof res.score === 'number') { totalScore += res.score; scoredFields++; }
          if      (res.status === 'empty')    { parts.push('<div class="math-fb-empty">'  + prefix + L.resEmpty + '</div>'); }
          else if (res.status === 'correct')  { el.classList.add('math-input-ok');    parts.push('<div class="math-fb-ok">&#10003;&nbsp;'  + prefix + L.resCorrect + '</div>'); }
          else if (res.status === 'partial')  { el.classList.add('math-input-partial'); parts.push('<div class="math-fb-partial">' + prefix + L.resPartial(Math.round(res.score * 100)) + '</div>'); }
          else if (res.status === 'wrong')    { el.classList.add('math-input-wrong'); parts.push('<div class="math-fb-wrong">&#10007;&nbsp;' + prefix + L.resWrong + '</div>'); }
          else if (res.status === 'rejected') { el.classList.add('math-input-wrong'); parts.push('<div class="math-fb-wrong">&#10007;&nbsp;' + prefix + L.resRejected + '</div>'); }
          else if (res.status === 'not_exact'){ el.classList.add(res.score > 0 ? 'math-input-partial' : 'math-input-wrong'); parts.push('<div class="' + (res.score > 0 ? 'math-fb-partial' : 'math-fb-wrong') + '">' + prefix + L.resNotExact + (res.score > 0 ? ' ' + L.resPartial(Math.round(res.score * 100)) : '') + '</div>'); }
          else if (res.status === 'not_form') { el.classList.add(res.score > 0 ? 'math-input-partial' : 'math-input-wrong'); parts.push('<div class="' + (res.score > 0 ? 'math-fb-partial' : 'math-fb-wrong') + '">' + prefix + L.resNotForm(checkOpts.form) + (res.score > 0 ? ' ' + L.resPartial(Math.round(res.score * 100)) : '') + '</div>'); }
          else                                { el.classList.add('math-input-err');   parts.push('<div class="math-fb-err">&#9888;&nbsp;'    + prefix + friendlyError(res.message) + '</div>'); }
        }
        if (checkOpts.partialCredit && fieldIds.length > 1 && scoredFields === fieldIds.length) {
          parts.push('<div class="math-fb-score">' + L.resScore(Math.round(100 * totalScore / scoredFields)) + '</div>');
        }
        checkedEvidence = { snapshot: checkSnapshot, results: results };
        fbDiv.innerHTML = parts.join('');
      } catch (err) {
        fbDiv.innerHTML = '<div class="math-fb-err">&#9888;&nbsp;' + friendlyError(String(err)) + '</div>';
      } finally {
        reloadHooks.delete(onReload);
        cancelSlow();
        // A check abandoned after an edit returns early: its Stop note goes too.
        if (stopNote && stopNote.isConnected) stopNote.remove();
        checkBtn.disabled = false;
        if (feedbackBtn) feedbackBtn.disabled = !feedbackHandle;
      }
    }

    function attachKeyListeners() {
      fieldIds.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.tagName === 'INPUT' && el.dataset.mathEnterListener !== 'true') {
          el.dataset.mathEnterListener = 'true';
          el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runCheck(); } });
        }
      });
    }

    questionDiv.addEventListener('input', clearAssessmentAfterResize);
    checkBtn.addEventListener('click', runCheck);
    attachKeyListeners();

    // Author-facing hint: a JSXGraph block that the jsxgraph filter did not
    // process (extension installed but not listed in `filters`) has no iframe.
    if (checkOpts.responseSource.indexOf('jsxgraph:') === 0) {
      var diagramId = checkOpts.responseSource.slice('jsxgraph:'.length).trim();
      var diagram = document.getElementById(diagramId);
      if (!diagram || diagram.tagName !== 'IFRAME') {
        fbDiv.innerHTML = '<div class="math-fb-err">&#9888;&nbsp;JSXGraph diagram "' + escHtml(diagramId) +
          '" is not available. Add <code>jsxgraph</code> to the page\'s <code>filters</code>.</div>';
      }
    }

    // Selection is shared by random reload and author review; always invalidates old feedback.
    function selectTask(next) {
      if (!poolTasks || !Number.isInteger(next) || next < 0 || next >= poolTasks.length) throw new Error('Invalid variant selection');
      invalidateFeedback();
      if (feedbackHandle) feedbackHandle.reset();
      idx = next;
      try { sessionStorage.setItem(poolKey, String(next)); } catch(e) {}
      var r = renderTaskText(poolTasks[next], cell.id, vars, vecdir, mode, !!generated);
      questionDiv.querySelectorAll('.math-dynamic-matrix-wrap').forEach(function (wrap) { if (wrap.matrixInput) wrap.matrixInput.destroy(); });
      setQuestionContent(questionDiv, r);
      cell.dataset.fields = JSON.stringify(r.fieldIds);
      cell.dataset.structuralFieldLabels = JSON.stringify(r.structuralLabels);
      fieldIds = r.fieldIds; structuralFieldLabels = r.structuralLabels; structuralLabelById = {};
      rememberCurrentLabels(); setupDynamicMatrices(); fillInitialValues(); warnExtraFieldLabels();
      renderMathInQuestion(questionDiv); attachKeyListeners(); fbDiv.innerHTML = '';
      publishVariant();
    }
    if (reloadBtn && poolTasks) reloadBtn.addEventListener('click', function () {
      var next = idx;
      if (poolTasks.length > 1) next = (idx + 1 + Math.floor(Math.random() * (poolTasks.length - 1))) % poolTasks.length;
      selectTask(next);
    });
    if (generated) {
      cell.mathExercise = {
        getVariant: currentVariant,
        selectVariant: function(id) {selectTask(generated.variants.findIndex(function(v){return v.id===id;}));},
        checkFixture: async function(record, fixture) {
          await prepareRuntime(checkOpts.packages);
          var options=Object.assign({}, checkOpts, {checker:record.checker,
            variant:JSON.parse(JSON.stringify({id:record.id, parameters:record.parameters, derived:record.derived, fingerprint:record.fingerprint, context:record['variant-context']}))});
          if(mode==='custom') return [await checkCustom(fixture.response || {kind:'expressions', raw:fixture.answers || [], inputs:{}}, options)];
          var rendered=renderTaskText(record.question, cell.id+'-review', vars, vecdir, mode, true);
          var box=document.createElement('div');box.innerHTML=rendered.html;
          var fields=Array.from(box.querySelectorAll('input[data-answer],textarea[data-answer]'));
          if(fields.length!==(fixture.answers || []).length) throw new Error('Fixture answer count does not match fields');
          var results=[];
          for(var i=0;i<fields.length;i++){fields[i].value=fixture.answers[i];results.push(await checkField(fields[i],mode,options));}
          return results;
        }
      };
      publishVariant();
      if(generated.review) setupVariantReview(cell, generated);
    }

    // ---- Shared AI Feedback adapter: collection never invokes Python ----
    if (feedbackBtn) {
      var F = window.AIFeedback;
      var output = document.createElement('div');
      output.className = 'ai-feedback-output';
      fbDiv.after(output);
      output.setAttribute('aria-live', 'polite');
      feedbackHandle = F.attach({
        contextRefs: function () { return cell.dataset.contextMode === 'none' ? '' : cell.dataset.contextRefs; },
        integration: 'math-exercise', policySelection: JSON.parse(cell.dataset.feedbackPolicy || '{}'), requestOptions: {imageFallback:'text'}, id: 'math-' + label, button: feedbackBtn, output: output,
        uiLanguage: L.outputLanguageCode,
        getRequest: async function (state) {
          var before = localSnapshot();
          var structuredInputs = collectDynamicMatrixInputs(questionDiv);
          var responses = fieldIds.map(function (id, i) {
            return { label: fieldLabel(i), value: document.getElementById(id).value.trim(), element: document.getElementById(id) };
          });
          var zeroSized = Object.keys(structuredInputs).some(function (name) {
            return structuredInputs[name].rows === 0 || structuredInputs[name].cols === 0;
          });
          if (!checkOpts.responseSource && !zeroSized && !responses.some(function (field) { return field.value; })) throw new Error(L.needAnswerFirst);
          var external = checkOpts.responseSource ? await collectCustomResponse(fieldIds, checkOpts, true, structuredInputs) : null;
          if (before !== localSnapshot()) throw new Error('The response changed. Request feedback again.');
          var evidence = checkedEvidence && checkedEvidence.snapshot === before &&
            (!external || checkedEvidence.graph === JSON.stringify(external.response)) ? checkedEvidence.results : [];
          var ai = external && external.ai;
          var key = external ? JSON.stringify([external.response, externalAISummary(ai)]) : null;
          if (key !== visualKey) { visualKey = key; visual = ai && ai.image; }
          if (ai) ai = { summary: ai.summary, image: visual };
          return {
            _responseIdentity: external ? JSON.stringify(external.response) : before,
            profile: 'mathematics', task: questionText(cell, fieldIds, fieldLabel),
            materials: resolveContexts(cell),
            responses: [{ id: 'answer', format: 'text', value: external
              ? (externalAISummary(ai) || 'Interactive graphical response submitted; no textual summary is available.')
              : expressionAnswersXml(responses, structuredInputs) }],

            evidence: evidence.map(function (result) { return { label: 'Private check assessment', text: JSON.stringify(result) }; }),
            attachments: ai && ai.image && /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(ai.image)
              ? [{ id: 'graph', role: 'response', label: 'Current graph', dataUrl: ai.image }] : [],
            feedback: {language: L.outputLanguageCode}
          };
        }
      });
      questionDiv.addEventListener('input', function () { output.replaceChildren(); });
      if (reloadBtn) reloadBtn.addEventListener('click', function () { feedbackHandle.reset(); });
    }
    if (reconfigBtn) reconfigBtn.replaceWith(window.AIFeedback.settingsButton(L.outputLanguageCode));

  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  // Deliberately absent in normal pages.  The repository's Node regression
  // test enables this flag before loading the bundle so it can exercise the
  // real prompt and retry code without making a network request.
  if (window.__mathExerciseTestMode) {
    window.__mathExerciseTestApi = {
      locale: L,
      simpleMarkdown: simpleMarkdown,
      displayErrorMessage: displayErrorMessage,
      splitTop: splitTop,
      parseDynamicMatrixSpec: parseDynamicMatrixSpec,
      dynamicSpecFromElement: dynamicSpecFromElement,
      initializeDynamicMatrices: initializeDynamicMatrices,
      applyCustomAssessment: applyCustomAssessment,
      resizedDynamicMatrixShape: resizedDynamicMatrixShape,
      renderTaskText: renderTaskText,
      setQuestionContent: setQuestionContent,
      contextText: contextText,
      questionText: questionText,
      resolveContexts: resolveContexts,
      setupCell: setupCell,
      normalizeTaskMathDelimiters: normalizeTaskMathDelimiters,
      localizeStructuralLabel: localizeStructuralLabel,
      expressionAnswersXml: expressionAnswersXml,
      structuredAssessmentXml: structuredAssessmentXml,
      structuredGroupStatus: structuredGroupStatus,
      parsePackageList: parsePackageList,
      ensurePackages: ensurePackages,
      ensureSympy: ensureSympy,
      checkField: checkField,
      runtimeCall: runtimeCall,
      notifyExternalLayout: notifyExternalLayout,
      scheduleExternalLayout: scheduleExternalLayout,
    };
  }

  document.addEventListener('DOMContentLoaded', async function () {
    var cells = document.querySelectorAll('.math-exercise-cell');
    if (!cells.length) return;
    // KaTeX rendering must not depend on Pyodide: Pyodide is only needed lazily
    // on the first Check click (ensureSympy()), but if ensurePyodide() rejects
    // (slow/broken network, no other Pyodide extension on the page), a shared
    // Promise.all would previously also block/kill math rendering entirely.
    await ensureKatex();
    cells.forEach(setupCell);
    ensurePyodide().catch(function (e) {
      console.warn('math-exercise: Pyodide preload failed (will retry on the first check):', e);
    });
  });

})();
