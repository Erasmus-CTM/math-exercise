(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Locales – add new languages here
  //
  // The active language comes from window.__mathExerciseConfig, which the Lua
  // filter fills from `math-exercise: lang:` or Quarto's own `lang:`.
  // When adding a language, also add its code to `supportedLangs` in
  // math-exercise.lua (that file holds the button labels it renders itself).
  // ---------------------------------------------------------------------------

  var LOCALES = {
    en: {
      // Legend: [LaTeX, input syntax, meaning]
      legend: [
        ['x^2',             'x^2 \\text{ or } x{**}2',   'Power'],
        ['\\sqrt{x}',       'sqrt(x)',                   'Square root'],
        ['\\sqrt[n]{x}',    'root(x, n)',                'n-th root'],
        ['\\dfrac{a}{b}',   'a/b',                       'Fraction'],
        ['\\pi',            'pi',                        'Pi'],
        ['e',               'E',                         "Euler's number e"],
        ['\\sin(x)',        'sin(x)',                    'Sine'],
        ['\\cos(x)',        'cos(x)',                    'Cosine'],
        ['\\tan(x)',        'tan(x)',                    'Tangent'],
        ['\\ln(x)',         'ln(x)',                     'Natural logarithm'],
        ['\\log_a(x)',      'log(x, a)',                 'Log to base a'],
        ['|x|',             'Abs(x)',                    'Absolute value'],
        ['\\infty',         'inf &nbsp;or&nbsp; oo',     'Infinity'],
        ['\\int f\\,dx',    'integrate(f, x)',           'Integral'],
        ['\\dfrac{d}{dx}f', 'diff(f, x)',                'Derivative'],
      ],
      legendOps:
        'Basic operators:&nbsp;<code>+</code>&nbsp;<code>-</code>&nbsp;<code>*</code>&nbsp;<code>/</code>' +
        '&nbsp;&nbsp;|&nbsp;&nbsp;Brackets:&nbsp;<code>(</code>&nbsp;<code>)</code>' +
        '&nbsp;&nbsp;|&nbsp;&nbsp;Power:&nbsp;<code>^</code>&nbsp;or&nbsp;<code>**</code>',
      legendThExpr:    'Expression',
      legendThInput:   'Input',
      legendThMeaning: 'Meaning',

      // Error messages
      errSyntax:   'Syntax error: check that all brackets are closed and no operator is missing.',
      errUnknownName: function (name) {
        return 'Unknown name &bdquo;' + name + '&ldquo; – use the input help (e.g. <code>pi</code> instead of <code>π</code>).';
      },
      errNameGeneric: 'Unknown name – use the input help for the correct spelling.',
      errDivZero:  'Division by zero: the expression is undefined at this point.',
      errType:     'Type error: make sure numbers and variables are combined correctly.',
      errGeneric:  'The input could not be processed – use the input help for the correct spelling.',

      // Check results
      fieldPrefix:  function (n) { return 'Field&nbsp;' + n + ': '; },
      resEmpty:     'Please enter an answer.',
      resCorrect:   'Correct!',
      resWrong:     'Not correct – try again.',
      resRejected:  'Mathematically correct, but not simplified yet. Keep transforming the expression.',
      resNotExact:  'Mathematically correct, but not in the requested form. Rewrite the expression exactly as asked.',
      resNotForm:   function (form) {
        var names = { factored: 'factored form', expanded: 'expanded form',
          single_fraction: 'a single fraction', lowest_terms: 'lowest terms' };
        return 'Mathematically correct, but not written in ' + (names[form] || 'the required form') +
          '. Rewrite the expression accordingly.';
      },

      // Status
      loadingHelp:     '&#9203; Loading help&hellip;',
      checking:        '&#9203; Checking&hellip;',
      fetchingFeedback:'&#9203; Fetching feedback&hellip;',
      needAnswerFirst: 'Please enter an answer first, then request feedback.',

      // AI prompts – the length limit must stay in every language, otherwise
      // the answer gets cut off mid-sentence.
      promptBase: 'Answer in English. At most about 250 words, so the answer stays complete.',
      promptHint1: 'You are a friendly mathematics tutor. The student has worked on a task. Gently point out the possible mistake without revealing the solution. Give only a small nudge. ',
      promptHint2: 'You are a friendly mathematics tutor. The student is asking for help a second time. Give a concrete hint towards the solution approach, without showing the full solution. ',
      promptHint3: 'You are a friendly mathematics tutor. The student has asked for help several times. Explain the complete solution path step by step now, clearly and understandably. ',

      // Settings modal
      modalTitle:      'Set up AI feedback',
      modalClose:      'Close',
      modalHint:       'The credentials are stored only locally in your browser.',
      modalFillAll:    'Please fill in base URL, API key and model.',
      fieldPreset:     'Provider preset',
      fieldModel:      'Model',
      presetPlaceholder: '– choose a template or fill in yourself –',
      presetCerebras:  'Cerebras (free tier)',
      presetOpenrouter:'OpenRouter (free models · shared limit)',
      presetOpenai:    'OpenAI (paid)',
      presetOllama:    'Ollama (local, no key)',
      phBaseUrl:       'e.g. https://api.cerebras.ai/v1',
      phApiKey:        'API key (stays local in the browser)',
      phModel:         'e.g. gpt-oss-120b',
      fetchModelsBtn:  'Fetch models',
      fetchModelsBusy: 'loading …',
      modelChoose:     function (count) { return '– choose model (' + count + ' found) –'; },
      freeModelsOnly:  ' show free models only',
      modelFree:       'free',
      modelPaid:       'paid!',
      modelListSelect: 'Choose a model – it will be copied to the model field.',
      modelListNoPricing: '⚠️ This provider does not supply pricing information. Check the provider’s website to see whether the model is free.',
      errNeedBaseUrl:  'Please enter a base URL first (or choose a template).',
      errNoModels:     'The response did not contain any models.',
      errModelListFailed: function (msg) { return 'Model list could not be loaded: ' + msg; },
      modelHintKeyNeeded: function (url) {
        return 'API key required to fetch models. <a href="' + url +
          '" target="_blank" rel="noopener">Available models at the provider →</a>';
      },
      infoBtn:    'ℹ️ How do I get credentials?',
      saveBtn:    'Save & load feedback',
      cancelBtn:  'Cancel',
      reconfigBtn:'Change configuration',
      promptTask: 'Task:',
      promptAnswer: 'My answer:',
      feedbackTitle: 'Feedback',
      feedbackAttempt: function (n) { return 'Attempt&nbsp;' + n; },
      errorPrefix: 'Error:',

      helpBox:
        '<b>Set up AI access – works with any OpenAI-compatible API.</b><br>' +
        'You need three things: a <b>base URL</b>, an <b>API key</b> and a <b>model</b>.<br><br>' +
        '<b>Providers with a free quota (examples):</b><br>' +
        '&bull; <b>Cerebras</b> – base URL <code>https://api.cerebras.ai/v1</code>, ' +
          'key: <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener">cloud.cerebras.ai</a>; ' +
          'model e.g. <code>gpt-oss-120b</code><br>' +
        '&bull; <b>OpenRouter</b> – base URL <code>https://openrouter.ai/api/v1</code>, ' +
          'key: <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>; ' +
          'free models (suffix <code>:free</code>, ' +
          '<a href="https://openrouter.ai/models?max_price=0" target="_blank" rel="noopener">list</a>), ' +
          'e.g. <code>meta-llama/llama-3.3-70b-instruct:free</code><br>' +
        '&bull; <b>Ollama (local)</b> – base URL <code>http://localhost:11434/v1</code>, no key<br>' +
        '<br><i>All entries stay local in your browser only.</i>',
    },

    de: {
      // Legend: [LaTeX, input syntax, meaning]
      legend: [
        ['x^2',             'x^2 \\text{ oder } x{**}2', 'Potenz'],
        ['\\sqrt{x}',       'sqrt(x)',                   'Quadratwurzel'],
        ['\\sqrt[n]{x}',    'root(x, n)',                'n-te Wurzel'],
        ['\\dfrac{a}{b}',   'a/b',                       'Bruch'],
        ['\\pi',            'pi',                        'Kreiszahl π'],
        ['e',               'E',                         'Eulersche Zahl e'],
        ['\\sin(x)',        'sin(x)',                    'Sinus'],
        ['\\cos(x)',        'cos(x)',                    'Kosinus'],
        ['\\tan(x)',        'tan(x)',                    'Tangens'],
        ['\\ln(x)',         'ln(x)',                     'Nat. Logarithmus'],
        ['\\log_a(x)',      'log(x, a)',                 'Log. zur Basis a'],
        ['|x|',             'Abs(x)',                    'Betrag'],
        ['\\infty',         'inf &nbsp;oder&nbsp; oo',   'Unendlich'],
        ['\\int f\\,dx',    'integrate(f, x)',           'Integral'],
        ['\\dfrac{d}{dx}f', 'diff(f, x)',                'Ableitung'],
      ],
      legendOps:
        'Grundrechenzeichen:&nbsp;<code>+</code>&nbsp;<code>-</code>&nbsp;<code>*</code>&nbsp;<code>/</code>' +
        '&nbsp;&nbsp;|&nbsp;&nbsp;Klammern:&nbsp;<code>(</code>&nbsp;<code>)</code>' +
        '&nbsp;&nbsp;|&nbsp;&nbsp;Potenz:&nbsp;<code>^</code>&nbsp;oder&nbsp;<code>**</code>',
      legendThExpr:    'Ausdruck',
      legendThInput:   'Eingabe',
      legendThMeaning: 'Bedeutung',

      // Error messages
      errSyntax:   'Syntax-Fehler: Prüfe ob alle Klammern geschlossen sind und kein Operatorzeichen fehlt.',
      errUnknownName: function (name) {
        return 'Unbekannte Bezeichnung &bdquo;' + name + '&ldquo; – nutze die Eingabe-Hilfe (z.&nbsp;B. <code>pi</code> statt <code>π</code>).';
      },
      errNameGeneric: 'Unbekannte Bezeichnung – nutze die Eingabe-Hilfe für korrekte Schreibweisen.',
      errDivZero:  'Division durch Null: der Ausdruck ist an dieser Stelle nicht definiert.',
      errType:     'Typ-Fehler: Stelle sicher, dass Zahlen und Variablen korrekt kombiniert sind.',
      errGeneric:  'Die Eingabe konnte nicht verarbeitet werden – nutze die Eingabe-Hilfe für korrekte Schreibweisen.',

      // Check results
      fieldPrefix:  function (n) { return 'Feld&nbsp;' + n + ': '; },
      resEmpty:     'Bitte eine Antwort eingeben.',
      resCorrect:   'Richtig!',
      resWrong:     'Nicht korrekt – versuche es noch einmal.',
      resRejected:  'Mathematisch korrekt, aber noch nicht vereinfacht. Forme den Ausdruck weiter um.',
      resNotExact:  'Mathematisch korrekt, aber nicht in der gesuchten Form. Schreibe den Ausdruck genau so um, wie gefordert.',
      resNotForm:   function (form) {
        var names = { factored: 'faktorisierter Form', expanded: 'ausmultiplizierter Form',
          single_fraction: 'einem einzigen Bruch', lowest_terms: 'vollständig gekürzter Form' };
        return 'Mathematisch korrekt, aber nicht in ' + (names[form] || 'der geforderten Form') +
          ' geschrieben. Forme den Ausdruck entsprechend um.';
      },

      // Status
      loadingHelp:     '&#9203; Lade Hilfe&hellip;',
      checking:        '&#9203; Überprüfe&hellip;',
      fetchingFeedback:'&#9203; Hole Feedback&hellip;',
      needAnswerFirst: 'Bitte zuerst eine Antwort eingeben, dann Feedback anfordern.',

      // AI prompts – the length limit must stay in every language, otherwise
      // the answer gets cut off mid-sentence.
      promptBase: 'Antworte auf Deutsch. Höchstens etwa 250 Wörter, damit die Antwort vollständig bleibt.',
      promptHint1: 'Du bist ein freundlicher Mathematik-Tutor. Der Schüler hat eine Aufgabe bearbeitet. Weise sanft auf den möglichen Fehler hin, ohne die Lösung zu verraten. Gib nur einen kleinen Denkanstoß. ',
      promptHint2: 'Du bist ein freundlicher Mathematik-Tutor. Der Schüler fragt zum zweiten Mal nach Hilfe. Gib einen konkreten Hinweis auf den Lösungsansatz, ohne die vollständige Lösung zu zeigen. ',
      promptHint3: 'Du bist ein freundlicher Mathematik-Tutor. Der Schüler hat bereits mehrfach um Hilfe gebeten. Erkläre den vollständigen Lösungsweg jetzt Schritt für Schritt, klar und verständlich. ',

      // Settings modal
      modalTitle:      'KI-Feedback einrichten',
      modalClose:      'Schließen',
      modalHint:       'Die Zugangsdaten werden nur lokal in Ihrem Browser gespeichert.',
      modalFillAll:    'Bitte Base URL, API Key und Modell ausfüllen.',
      fieldPreset:     'Anbieter-Vorlage',
      fieldModel:      'Modell',
      presetPlaceholder: '– Vorlage wählen oder selbst eintragen –',
      presetCerebras:  'Cerebras (Gratis-Tier)',
      presetOpenrouter:'OpenRouter (Gratis-Modelle · geteiltes Limit)',
      presetOpenai:    'OpenAI (kostenpflichtig)',
      presetOllama:    'Ollama (lokal, kein Key)',
      phBaseUrl:       'z. B. https://api.cerebras.ai/v1',
      phApiKey:        'API Key (bleibt lokal im Browser)',
      phModel:         'z. B. gpt-oss-120b',
      fetchModelsBtn:  'Modelle abrufen',
      fetchModelsBusy: 'lädt …',
      modelChoose:     function (count) { return '– Modell wählen (' + count + ' gefunden) –'; },
      freeModelsOnly:  ' nur kostenlose Modelle anzeigen',
      modelFree:       'gratis',
      modelPaid:       'kostenpflichtig!',
      modelListSelect: 'Wähle ein Modell – es wird ins Modell-Feld übernommen.',
      modelListNoPricing: '⚠️ Dieser Anbieter liefert keine Preisinfo. Prüfe auf der Anbieterseite, ob das Modell kostenlos ist.',
      errNeedBaseUrl:  'Bitte zuerst eine Base URL eingeben (oder eine Vorlage wählen).',
      errNoModels:     'Die Antwort enthielt keine Modelle.',
      errModelListFailed: function (msg) { return 'Modell-Liste konnte nicht geladen werden: ' + msg; },
      modelHintKeyNeeded: function (url) {
        return 'API-Key nötig für Modellabruf. <a href="' + url +
          '" target="_blank" rel="noopener">Verfügbare Modelle beim Anbieter →</a>';
      },
      infoBtn:    'ℹ️ Wie komme ich an Zugangsdaten?',
      saveBtn:    'Speichern & Feedback laden',
      cancelBtn:  'Abbrechen',
      reconfigBtn:'Konfiguration ändern',
      promptTask: 'Aufgabe:',
      promptAnswer: 'Meine Antwort:',
      feedbackTitle: 'Feedback',
      feedbackAttempt: function (n) { return 'Versuch&nbsp;' + n; },
      errorPrefix: 'Fehler:',

      helpBox:
        '<b>KI-Zugang einrichten – funktioniert mit jeder OpenAI-kompatiblen API.</b><br>' +
        'Du brauchst drei Angaben: <b>Base URL</b>, <b>API Key</b> und ein <b>Modell</b>.<br><br>' +
        '<b>Anbieter mit kostenlosem Kontingent (Beispiele):</b><br>' +
        '&bull; <b>Cerebras</b> – Base URL <code>https://api.cerebras.ai/v1</code>, ' +
          'Key: <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener">cloud.cerebras.ai</a>; ' +
          'Modell z. B. <code>gpt-oss-120b</code><br>' +
        '&bull; <b>OpenRouter</b> – Base URL <code>https://openrouter.ai/api/v1</code>, ' +
          'Key: <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>; ' +
          'Gratis-Modelle (Endung <code>:free</code>, ' +
          '<a href="https://openrouter.ai/models?max_price=0" target="_blank" rel="noopener">Liste</a>), ' +
          'z. B. <code>meta-llama/llama-3.3-70b-instruct:free</code><br>' +
        '&bull; <b>Ollama (lokal)</b> – Base URL <code>http://localhost:11434/v1</code>, kein Key<br>' +
        '<br><i>Alle Eingaben bleiben nur lokal in deinem Browser.</i>',
    },
  };

  // Active locale. Unknown language -> English (never undefined).
  var ME_CFG = window.__mathExerciseConfig || { lang: 'en' };
  var L = LOCALES[ME_CFG.lang] || LOCALES.en;

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Sanitizes LLM output: escapes HTML first (prevents XSS), then re-adds
  // a minimal subset of markdown as safe HTML tags.
  function simpleMarkdown(text) {
    return escHtml(text)
      .replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([\s\S]*?)\*/g,     '<em>$1</em>')
      .replace(/`([^`]*)`/g,          '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  // Loads a script exactly once. If its tag already exists but has not finished
  // loading, wait for its load event instead of resolving immediately. Otherwise,
  // a second extension could access globals that do not exist yet.
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (existing.dataset.qLoaded === '1') { resolve(); return; }
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () {
          reject(new Error('Failed to load: ' + src));
        });
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { s.dataset.qLoaded = '1'; resolve(); };
      s.onerror = function () { reject(new Error('Failed to load: ' + src)); };
      document.head.appendChild(s);
    });
  }

  // ---------------------------------------------------------------------------
  // Pyodide bootstrap  (reuse coatless instance if present)
  // ---------------------------------------------------------------------------

  async function ensurePyodide() {
    if (typeof qpyodideInstance !== 'undefined') {
      window.mainPyodide = await qpyodideInstance; return;
    }
    if (typeof mainPyodide !== 'undefined') return;
    // Standalone mode. Use a shared promise so math-exercise and py-exercise on
    // the same page do not start two Pyodide instances or interfere while loading.
    var cdn = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';
    if (!globalThis.__qExercisePyodide) {
      globalThis.__qExercisePyodide = (async function () {
        await loadScript(cdn + 'pyodide.js');
        return await loadPyodide({ indexURL: cdn });
      })();
    }
    window.mainPyodide = await globalThis.__qExercisePyodide;
  }

  // ---------------------------------------------------------------------------
  // KaTeX  (legend rendering – loaded independently of page math)
  // ---------------------------------------------------------------------------

  var katexReady = false;
  var katexLib = null;
  var renderMathInElementFn = null;
  var KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/';

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

  var sympyReady = false;

  async function ensureSympy() {
    if (sympyReady) return;
    await mainPyodide.loadPackage('sympy');
    await mainPyodide.runPythonAsync([
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
      'def _sigfigs_round(x, n):',
      '    if x == 0: return 0.0',
      '    d = n - int(floor(log10(abs(x)))) - 1',
      '    return round(x, d)',
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
      '        return round(sv, n) == round(cv, n)',
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
      'def _math_check():',
      '    try:',
      '        mode = _math_mode',
      '        if mode in ("string", "string_ci"):',
      '            s, c = _math_student, _math_correct',
      '            if mode == "string_ci": s, c = s.lower(), c.lower()',
      '            return {"status": "correct" if s == c else "wrong"}',
      '',
      '        _local = _build_locals()',
      '',
      '        if mode == "set":',
      '            s_items = [parse_expr(p, local_dict=_local, transformations=_math_tf) for p in _split_top(_math_student)]',
      '            c_items = [parse_expr(p, local_dict=_local, transformations=_math_tf) for p in _split_top(_math_correct)]',
      '            if len(s_items) != len(c_items):',
      '                return {"status": "wrong"}',
      '            unmatched = list(c_items)',
      '            for si in s_items:',
      '                found = None',
      '                for ci in unmatched:',
      '                    d = simplify(si - ci)',
      '                    if d == 0 or (d.is_number and abs(complex(d.evalf())) < 1e-8):',
      '                        found = ci',
      '                        break',
      '                if found is None:',
      '                    return {"status": "wrong"}',
      '                unmatched.remove(found)',
      '            return {"status": "correct"}',
      '',
      '        _ms = parse_expr(_math_student, local_dict=_local, transformations=_math_tf)',
      '        _mc = parse_expr(_math_correct,  local_dict=_local, transformations=_math_tf)',
      '',
      '        if mode == "numeric":',
      '            sv, cv = complex(_ms.evalf()), complex(_mc.evalf())',
      '            if abs(sv.imag) > 1e-9 or abs(cv.imag) > 1e-9:',
      '                return {"status": "wrong"}',
      '            ok = _num_equal(sv.real, cv.real)',
      '            return {"status": "correct" if ok else "wrong"}',
      '',
      '        _d  = simplify(_ms - _mc)',
      '        _eq = (_d == 0) or (_d.is_number and abs(complex(_d.evalf())) < 1e-10)',
      '        if not _eq:',
      '            return {"status": "wrong"}',
      '        if mode == "exact":',
      '            if str(_ms) != str(_mc):',
      '                return {"status": "not_exact"}',
      '            # SymPy auto-reduces Rationals on parse, so an un-reduced',
      '            # numeric fraction (e.g. "2/4" inside "1/4 + 2/4") is',
      '            # invisible to the string check above; "exact" is meant to',
      '            # be the strictest mode, so catch it on the raw text too.',
      '            if not _ms.free_symbols and _numeric_not_reduced(_math_student):',
      '                return {"status": "not_exact"}',
      '        if _math_form.strip():',
      '            if _math_form == "lowest_terms" and not _ms.free_symbols:',
      '                if _numeric_not_reduced(_math_student):',
      '                    return {"status": "not_form"}',
      '            elif _ms != _canon_form(_ms, _math_form):',
      '                return {"status": "not_form"}',
      '        if _math_reject.strip():',
      '            _mr  = parse_expr(_math_reject, local_dict=_local, transformations=_math_tf)',
      '            if str(_ms) == str(_mr):',
      '                return {"status": "rejected"}',
      '        return {"status": "correct"}',
      '    except Exception as _me:',
      '        return {"status": "error", "message": str(_me)}',
    ].join('\n'));
    sympyReady = true;
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
  // Task-text renderer  (used by pool mode: parses _[answer] markers in JS)
  // ---------------------------------------------------------------------------

  function renderTaskText(text, exerciseId, vars) {
    var count = 0, fieldIds = [];
    var html = text.replace(/(_+)\[([^\]]*)\]/g, function (_, underscores, answer) {
      count++;
      var fid  = exerciseId + '-f' + count;
      fieldIds.push(fid);
      var n    = underscores.length;
      var base = ' id="' + fid + '"'
               + ' data-answer="' + escHtml(answer) + '"'
               + ' data-vars="'   + escHtml(vars)   + '"'
               + ' autocomplete="off" autocorrect="off" spellcheck="false"';
      if (n >= 3) return '<textarea' + base + ' class="math-input math-input-large" rows="2"></textarea>';
      if (n >= 2) return '<input type="text"' + base + ' class="math-input math-input-medium">';
      return '<input type="text"' + base + ' class="math-input math-input-small">';
    });
    return { html: html.replace(/\n/g, '<br>\n'), fieldIds: fieldIds };
  }

  // ---------------------------------------------------------------------------
  // SymPy checker
  // ---------------------------------------------------------------------------

  // Calls the _math_check() helper defined once in ensureSympy() and returns
  // its result as a JSON status string.
  var CHECK_PY = '_mj.dumps(_math_check())';

  async function checkField(el, mode, opts) {
    var val = el.value.trim();
    if (!val) return { status: 'empty' };
    opts = opts || {};
    mainPyodide.globals.set('_math_student',   val);
    mainPyodide.globals.set('_math_correct',   el.dataset.answer || '');
    mainPyodide.globals.set('_math_vars',      el.dataset.vars   || '');
    mainPyodide.globals.set('_math_mode',      mode || 'equivalent');
    mainPyodide.globals.set('_math_reject',    opts.reject    || '');
    mainPyodide.globals.set('_math_tolerance', opts.tolerance || '');
    mainPyodide.globals.set('_math_decplaces', opts.decplaces || '');
    mainPyodide.globals.set('_math_sigfigs',   opts.sigfigs   || '');
    mainPyodide.globals.set('_math_form',      opts.form      || '');
    return JSON.parse(await mainPyodide.runPythonAsync(CHECK_PY));
  }

  // ---------------------------------------------------------------------------
  // LLM / AI-Feedback  (OpenAI-compatible API, config stored in localStorage)
  // ---------------------------------------------------------------------------

  var LLM_CFG_KEY = 'math-exercise-llm-config';
  var LLM_CNT_NS  = 'math-fb-cnt';

  function loadCfg()    { try { return JSON.parse(localStorage.getItem(LLM_CFG_KEY) || 'null'); } catch(e) { return null; } }
  function saveCfg(cfg) { try { localStorage.setItem(LLM_CFG_KEY, JSON.stringify(cfg)); } catch(e) {} }
  function getCnt(lbl)  { try { return parseInt(localStorage.getItem(LLM_CNT_NS + '|' + location.pathname + '|' + lbl) || '0'); } catch(e) { return 0; } }
  function incCnt(lbl)  { var n = getCnt(lbl) + 1; try { localStorage.setItem(LLM_CNT_NS + '|' + location.pathname + '|' + lbl, String(n)); } catch(e) {} return n; }

  // ---------------------------------------------------------------------------
  // Provider presets
  // ---------------------------------------------------------------------------

  var ME_PRESETS = {
    cerebras:   { label: L.presetCerebras,   baseUrl: 'https://api.cerebras.ai/v1',   model: 'gpt-oss-120b',                           modelsUrl: 'https://inference-docs.cerebras.ai/introduction' },
    openrouter: { label: L.presetOpenrouter, baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', modelsUrl: 'https://openrouter.ai/models?max_price=0' },
    openai:     { label: L.presetOpenai,     baseUrl: 'https://api.openai.com/v1',    model: 'gpt-4o-mini',                            modelsUrl: 'https://platform.openai.com/docs/models' },
    ollama:     { label: L.presetOllama,     baseUrl: 'http://localhost:11434/v1',    model: '' },
  };

  // ---------------------------------------------------------------------------
  // Config modal (singleton)
  // ---------------------------------------------------------------------------

  var _modal = null;
  var _meFetchedModels = [];

  function meMakeField(labelText, controlEl) {
    var wrap = document.createElement('div');
    wrap.className = 'math-modal-field';
    var span = document.createElement('span');
    span.textContent = labelText;
    wrap.appendChild(span);
    wrap.appendChild(controlEl);
    return wrap;
  }

  function meFreeModel(m) {
    if (typeof m.id === 'string' && m.id.endsWith(':free')) return true;
    var p = m.pricing;
    if (p && ('prompt' in p || 'completion' in p))
      return Number(p.prompt || 0) === 0 && Number(p.completion || 0) === 0;
    return null;
  }

  function getModal() {
    if (_modal) return _modal;

    var backdrop = document.createElement('div');
    backdrop.className = 'math-modal-backdrop';
    backdrop.style.display = 'none';

    var dialog = document.createElement('div');
    dialog.className = 'math-modal';
    dialog.setAttribute('role', 'dialog');

    // --- Header ---
    var header = document.createElement('div');
    header.className = 'math-modal-header';
    var title = document.createElement('strong');
    title.textContent = L.modalTitle;
    var closeBtn = document.createElement('button');
    closeBtn.className = 'math-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', L.modalClose);
    closeBtn.innerHTML = '&times;';
    header.appendChild(title);
    header.appendChild(closeBtn);

    // --- Body ---
    var body = document.createElement('div');
    body.className = 'math-modal-body';

    var hint = document.createElement('p');
    hint.className = 'math-modal-hint';
    hint.textContent = L.modalHint;
    body.appendChild(hint);

    // Preset dropdown
    var presetSel = document.createElement('select');
    presetSel.className = 'math-modal-input';
    presetSel.add(new Option(L.presetPlaceholder, ''));
    for (var pk in ME_PRESETS) presetSel.add(new Option(ME_PRESETS[pk].label, pk));
    body.appendChild(meMakeField(L.fieldPreset, presetSel));

    // Base URL
    var urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'math-modal-input';
    urlInput.placeholder = L.phBaseUrl;
    urlInput.autocomplete = 'off';
    body.appendChild(meMakeField('Base URL', urlInput));

    // API Key
    var keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'math-modal-input';
    keyInput.placeholder = L.phApiKey;
    keyInput.autocomplete = 'off';
    body.appendChild(meMakeField('API Key', keyInput));

    // Model input + fetch button
    var modelInput = document.createElement('input');
    modelInput.type = 'text';
    modelInput.className = 'math-modal-input';
    modelInput.placeholder = L.phModel;
    modelInput.autocomplete = 'off';

    var fetchBtn = document.createElement('button');
    fetchBtn.type = 'button';
    fetchBtn.className = 'btn btn-light btn-sm';
    fetchBtn.textContent = L.fetchModelsBtn;

    var modelRow = document.createElement('div');
    modelRow.className = 'math-modal-inputrow';
    modelRow.appendChild(modelInput);
    modelRow.appendChild(fetchBtn);
    body.appendChild(meMakeField(L.fieldModel, modelRow));

    // Model hint (link when auto-fetch fails)
    var modelHintEl = document.createElement('div');
    modelHintEl.className = 'math-modal-model-hint';
    modelHintEl.style.display = 'none';
    body.appendChild(modelHintEl);

    // Model list (shown after successful fetch)
    var modelListDiv = document.createElement('div');
    modelListDiv.className = 'math-modal-modellist';
    modelListDiv.style.display = 'none';

    var modelListInfo = document.createElement('div');
    modelListInfo.className = 'math-modal-modellist-info';

    var freeOnlyLabel = document.createElement('label');
    var freeOnlyCb = document.createElement('input');
    freeOnlyCb.type = 'checkbox';
    freeOnlyCb.checked = true;
    freeOnlyLabel.appendChild(freeOnlyCb);
    freeOnlyLabel.appendChild(document.createTextNode(L.freeModelsOnly));

    var modelPicker = document.createElement('select');
    modelPicker.className = 'math-modal-input';

    modelListDiv.appendChild(modelListInfo);
    modelListDiv.appendChild(freeOnlyLabel);
    modelListDiv.appendChild(modelPicker);
    body.appendChild(modelListDiv);

    function renderModelList() {
      var hasPricing = _meFetchedModels.some(function (m) { return m.free !== null; });
      freeOnlyLabel.style.display = hasPricing ? 'block' : 'none';
      var models = _meFetchedModels;
      if (hasPricing && freeOnlyCb.checked)
        models = models.filter(function (m) { return m.free === true; });
      models = models.slice().sort(function (a, b) {
        return (b.free === true) - (a.free === true) || a.id.localeCompare(b.id);
      });
      modelPicker.innerHTML = '';
      modelPicker.add(new Option(L.modelChoose(models.length), ''));
      models.forEach(function (m) {
        var suffix = m.free === true ? ' – ' + L.modelFree
                   : m.free === false ? ' – ' + L.modelPaid
                   : '';
        modelPicker.add(new Option(m.id + suffix, m.id));
      });
      modelListInfo.textContent = hasPricing ? L.modelListSelect : L.modelListNoPricing;
      modelListDiv.style.display = 'block';
    }

    freeOnlyCb.onchange = renderModelList;
    modelPicker.onchange = function () {
      if (modelPicker.value) modelInput.value = modelPicker.value;
    };

    async function doFetchModels(isAuto) {
      var baseUrl = urlInput.value.trim();
      if (!baseUrl) {
        if (isAuto) return;
        modelListInfo.textContent = L.errNeedBaseUrl;
        freeOnlyLabel.style.display = 'none';
        modelPicker.innerHTML = '';
        modelListDiv.style.display = 'block';
        return;
      }
      var origLabel = fetchBtn.textContent;
      fetchBtn.disabled = true;
      fetchBtn.textContent = L.fetchModelsBusy;
      try {
        var headers = {};
        var key = keyInput.value.trim();
        if (key) headers['Authorization'] = 'Bearer ' + key;
        var resp = await fetch(baseUrl.replace(/\/+$/, '') + '/models', { headers: headers });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);
        var data = await resp.json();
        var list = Array.isArray(data.data) ? data.data
                 : Array.isArray(data.models) ? data.models : [];
        _meFetchedModels = list
          .map(function (m) { return { id: m.id || m.name, free: meFreeModel(m) }; })
          .filter(function (m) { return typeof m.id === 'string' && m.id; });
        if (_meFetchedModels.length === 0) throw new Error(L.errNoModels);
        var freeOnes = _meFetchedModels.filter(function (m) { return m.free === true; });
        var pool = freeOnes.length > 0 ? freeOnes : _meFetchedModels;
        modelInput.value = pool[Math.floor(Math.random() * pool.length)].id;
        modelHintEl.style.display = 'none';
        modelHintEl.innerHTML = '';
        renderModelList();
      } catch (err) {
        if (isAuto) {
          var preset = ME_PRESETS[presetSel.value];
          if (preset && preset.modelsUrl) {
            modelHintEl.innerHTML = L.modelHintKeyNeeded(preset.modelsUrl);
            modelHintEl.style.display = '';
          }
          return;
        }
        modelListInfo.textContent = L.errModelListFailed(err.message || err);
        freeOnlyLabel.style.display = 'none';
        modelPicker.innerHTML = '';
        modelListDiv.style.display = 'block';
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = origLabel;
      }
    }

    fetchBtn.addEventListener('click', function () { doFetchModels(false); });

    presetSel.addEventListener('change', function () {
      var preset = ME_PRESETS[presetSel.value];
      if (preset) {
        urlInput.value = preset.baseUrl;
        modelInput.value = '';
        modelHintEl.style.display = 'none';
        modelHintEl.innerHTML = '';
        _meFetchedModels = [];
        modelListDiv.style.display = 'none';
        doFetchModels(true);
      }
    });

    // Info button + help box
    var infoBtn = document.createElement('button');
    infoBtn.type = 'button';
    infoBtn.className = 'btn btn-light btn-sm math-modal-info-btn';
    infoBtn.textContent = L.infoBtn;

    var helpDiv = document.createElement('div');
    helpDiv.className = 'math-modal-help';
    helpDiv.style.display = 'none';
    helpDiv.innerHTML = L.helpBox;

    infoBtn.addEventListener('click', function () {
      helpDiv.style.display = helpDiv.style.display === 'none' ? 'block' : 'none';
    });

    body.appendChild(infoBtn);
    body.appendChild(helpDiv);

    // --- Footer ---
    var footer = document.createElement('div');
    footer.className = 'math-modal-footer';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = L.saveBtn;

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-light';
    cancelBtn.textContent = L.cancelBtn;

    footer.appendChild(saveBtn);
    footer.appendChild(cancelBtn);

    // --- Assemble ---
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // --- Behaviour ---
    function close() { backdrop.style.display = 'none'; backdrop._cb = null; }

    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });

    saveBtn.addEventListener('click', function () {
      var cfg = {
        baseUrl: urlInput.value.trim(),
        apiKey:  keyInput.value.trim(),
        model:   modelInput.value.trim(),
        preset:  presetSel.value,
      };
      if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
        hint.textContent = L.modalFillAll;
        hint.style.color = '#dc3545';
        return;
      }
      hint.textContent = L.modalHint;
      hint.style.color = '';
      saveCfg(cfg);
      var cb = backdrop._cb;
      close();
      if (cb) cb(cfg);
    });

    // Store named refs on the backdrop element for showModal()
    backdrop._urlInput   = urlInput;
    backdrop._keyInput   = keyInput;
    backdrop._modelInput = modelInput;
    backdrop._presetSel  = presetSel;
    backdrop._hint       = hint;

    _modal = backdrop;
    return backdrop;
  }

  function showModal(cb) {
    var m = getModal(), cfg = loadCfg();
    if (cfg) {
      m._urlInput.value   = cfg.baseUrl || '';
      m._keyInput.value   = cfg.apiKey  || '';
      m._modelInput.value = cfg.model   || '';
      if (cfg.preset) m._presetSel.value = cfg.preset;
    }
    m._hint.textContent = L.modalHint;
    m._hint.style.color = '';
    m._cb = cb;
    m.style.display = 'flex';
  }

  // ---------------------------------------------------------------------------
  // LLM call
  // ---------------------------------------------------------------------------

  function sysPrompt(n) {
    var base = L.promptBase;
    if (n <= 1) return L.promptHint1 + base;
    if (n <= 2) return L.promptHint2 + base;
    return L.promptHint3 + base;
  }

  async function callLLM(question, answer, n, cfg) {
    var resp = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: sysPrompt(n) },
          { role: 'user',   content: L.promptTask + '\n' + question + '\n\n' + L.promptAnswer + '\n' + answer },
        ],
        max_tokens: 2000,
      }),
    });
    if (!resp.ok) { var t = await resp.text(); throw new Error('API ' + resp.status + ': ' + t.slice(0, 200)); }
    return (await resp.json()).choices[0].message.content;
  }

  // ---------------------------------------------------------------------------
  // Exercise cell setup
  // ---------------------------------------------------------------------------

  function setupCell(cell) {
    var vars   = cell.dataset.vars   || '';
    var mode   = cell.dataset.mode   || 'equivalent';
    var reject = cell.dataset.reject || '';
    var label  = cell.dataset.label  || cell.id;
    var checkOpts = {
      reject:    reject,
      tolerance: cell.dataset.tolerance || '',
      decplaces: cell.dataset.decplaces || '',
      sigfigs:   cell.dataset.sigfigs   || '',
      form:      cell.dataset.form      || ''
    };

    var poolRaw   = cell.dataset.pool;
    var poolTasks = poolRaw ? JSON.parse(poolRaw) : null;
    var poolKey   = 'math-pool|' + location.pathname + '|' + label;

    // Pool: pick a stored or random task index, then render the question
    if (poolTasks) {
      var idx;
      try { idx = parseInt(sessionStorage.getItem(poolKey)); } catch(e) {}
      if (isNaN(idx) || idx < 0 || idx >= poolTasks.length) {
        idx = Math.floor(Math.random() * poolTasks.length);
        try { sessionStorage.setItem(poolKey, String(idx)); } catch(e) {}
      }
      var r = renderTaskText(poolTasks[idx], cell.id, vars);
      var qDiv = cell.querySelector('.math-exercise-question');
      qDiv.innerHTML = r.html;
      cell.dataset.fields = JSON.stringify(r.fieldIds);
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
        bodyEl.style.display = open ? '' : 'none';
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
      checkBtn.disabled = true;
      fbDiv.innerHTML = '<div class="math-fb-checking">' + L.checking + '</div>';
      try {
        await ensureSympy();
        var parts = [];
        for (var i = 0; i < fieldIds.length; i++) {
          var el     = document.getElementById(fieldIds[i]);
          if (!el) continue;
          var prefix = fieldIds.length > 1 ? L.fieldPrefix(i + 1) : '';
          var res    = await checkField(el, mode, checkOpts);
          el.classList.remove('math-input-ok', 'math-input-wrong', 'math-input-err');
          if      (res.status === 'empty')    { parts.push('<div class="math-fb-empty">'  + prefix + L.resEmpty + '</div>'); }
          else if (res.status === 'correct')  { el.classList.add('math-input-ok');    parts.push('<div class="math-fb-ok">&#10003;&nbsp;'  + prefix + L.resCorrect + '</div>'); }
          else if (res.status === 'wrong')    { el.classList.add('math-input-wrong'); parts.push('<div class="math-fb-wrong">&#10007;&nbsp;' + prefix + L.resWrong + '</div>'); }
          else if (res.status === 'rejected') { el.classList.add('math-input-wrong'); parts.push('<div class="math-fb-wrong">&#10007;&nbsp;' + prefix + L.resRejected + '</div>'); }
          else if (res.status === 'not_exact'){ el.classList.add('math-input-wrong'); parts.push('<div class="math-fb-wrong">&#10007;&nbsp;' + prefix + L.resNotExact + '</div>'); }
          else if (res.status === 'not_form') { el.classList.add('math-input-wrong'); parts.push('<div class="math-fb-wrong">&#10007;&nbsp;' + prefix + L.resNotForm(checkOpts.form) + '</div>'); }
          else                                { el.classList.add('math-input-err');   parts.push('<div class="math-fb-err">&#9888;&nbsp;'    + prefix + friendlyError(res.message) + '</div>'); }
        }
        fbDiv.innerHTML = parts.join('');
      } catch (err) {
        fbDiv.innerHTML = '<div class="math-fb-err">&#9888;&nbsp;' + friendlyError(String(err)) + '</div>';
      } finally { checkBtn.disabled = false; }
    }

    function attachKeyListeners() {
      fieldIds.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.tagName === 'INPUT')
          el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runCheck(); } });
      });
    }

    checkBtn.addEventListener('click', runCheck);
    attachKeyListeners();

    // ---- Pool reload ----
    if (reloadBtn && poolTasks) {
      reloadBtn.addEventListener('click', function () {
        var cur;
        try { cur = parseInt(sessionStorage.getItem(poolKey)); } catch(e) {}
        var next = cur;
        if (poolTasks.length > 1) {
          while (next === cur) { next = Math.floor(Math.random() * poolTasks.length); }
        }
        try { sessionStorage.setItem(poolKey, String(next)); } catch(e) {}

        var r = renderTaskText(poolTasks[next], cell.id, vars);
        var qDivR = cell.querySelector('.math-exercise-question');
        qDivR.innerHTML = r.html;
        cell.dataset.fields = JSON.stringify(r.fieldIds);
        fieldIds = r.fieldIds;
        renderMathInQuestion(qDivR);

        attachKeyListeners();
        fbDiv.innerHTML = '';
      });
    }

    // ---- AI Feedback ----
    if (feedbackBtn) {
      feedbackBtn.addEventListener('click', function () {
        var answers = fieldIds.map(function (id) {
          var el = document.getElementById(id); return el ? el.value.trim() : '';
        }).filter(Boolean).join(' | ');
        if (!answers) {
          fbDiv.innerHTML = '<div class="math-fb-empty">' + L.needAnswerFirst + '</div>';
          return;
        }
        var qDiv   = cell.querySelector('.math-exercise-question');
        var capEl  = cell.querySelector('.math-exercise-caption');
        var clone  = qDiv.cloneNode(true);
        clone.querySelectorAll('input, textarea').forEach(function (el) {
          var s = document.createElement('span');
          s.textContent = '[' + (el.value || '?') + ']';
          el.parentNode.replaceChild(s, el);
        });
        var question = (capEl ? capEl.textContent + '\n' : '') + clone.textContent.replace(/\s+/g, ' ').trim();

        async function doFeedback(cfg) {
          var n = incCnt(label);
          feedbackBtn.disabled = true;
          fbDiv.innerHTML = '<div class="math-fb-checking">' + L.fetchingFeedback + '</div>';
          try {
            var reply = await callLLM(question, answers, n, cfg);
            fbDiv.innerHTML =
              '<div class="math-fb-llm">'
              + '<div class="math-fb-llm-header">&#128161;&nbsp;' + L.feedbackTitle
              + (n > 1 ? ' <span class="math-fb-llm-cnt">(' + L.feedbackAttempt(n) + ')</span>' : '')
              + '</div>'
              + '<div class="math-fb-llm-body">' + simpleMarkdown(reply) + '</div>'
              + '</div>';
          } catch (err) {
            fbDiv.innerHTML =
              '<div class="math-fb-err">&#9888;&nbsp;' + L.errorPrefix + ' ' + escHtml(String(err))
              + '&nbsp;&nbsp;<button type="button" class="btn btn-sm btn-light math-fb-reconfig">&#9881;&nbsp;' + L.reconfigBtn + '</button>'
              + '</div>';
            var fbRecfg = fbDiv.querySelector('.math-fb-reconfig');
            if (fbRecfg) fbRecfg.addEventListener('click', function () { showModal(function (c) { doFeedback(c); }); });
          } finally { feedbackBtn.disabled = false; }
        }

        var cfg = loadCfg();
        if (cfg) { doFeedback(cfg); }
        else      { showModal(function (c) { doFeedback(c); }); }
      });
    }

    if (reconfigBtn) {
      reconfigBtn.addEventListener('click', function () { showModal(function () {}); });
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

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
