"""Math component adapter for the installed native variants authoring engine.

This module owns marker/field interpretation and B1 identity. Generation,
history and real grading remain in ctm-checkers' native-only authoring package.
"""
import copy
import hashlib
import json
import re


GRADING_DEFAULTS = {
    "mode": "equivalent", "vars": "", "reject": "", "tolerance": "",
    "decplaces": "", "sigfigs": "", "form": "", "partial-credit": False,
    "form-credit": "0.5", "response": "", "packages": [],
}


def _answer_input_placeholders(question):
    """Use input placeholders inside the existing component's balanced markers."""
    output, position = [], 0
    while position < len(question):
        match = re.search(r"(?:_+|(?<![A-Za-z0-9_])(?:vec|mat))\[", question[position:])
        if match is None:
            output.append(question[position:])
            break
        start = position + match.end()
        output.append(question[position:start])
        end, depth = start, 1
        while end < len(question) and depth:
            if question[end] == "[": depth += 1
            elif question[end] == "]": depth -= 1
            end += 1
        content = question[start:end-1] if depth == 0 else question[start:]
        output.append(re.sub(r"(?<!\\)\{@(.*?)@\}", r"{#\1#}", content, flags=re.S))
        if depth == 0:
            output.append("]")
        position = end
    return "".join(output)


def _board_value(value):
    """Public figure data; grading retains its separate exact-context codec."""
    import math
    import sympy as sp
    from ctm_variants.placeholders import _input
    if value is None:
        return None
    if isinstance(value, (str, bool)):
        return value
    if isinstance(value, (int, sp.Integer)):
        number = int(value)
        return number if abs(number) <= 2**53 - 1 else str(number)
    if isinstance(value, sp.Rational):
        try:
            number = float(value)
        except OverflowError:
            return _input(value)
        return number if math.isfinite(number) and sp.Rational(number) == value else _input(value)
    if isinstance(value, sp.MatrixBase):
        return [[_board_value(item) for item in row] for row in value.tolist()]
    if isinstance(value, (list, tuple)):
        return [_board_value(item) for item in value]
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        return {key: _board_value(item) for key, item in value.items()}
    return _input(value)


def teacher_display_projection(values):
    """Late review-only presentation of decoded exact values; no parsing/eval."""
    import sympy as sp
    from ctm_variants.review import teacher_display
    displays = {}
    for field, value in values.items():
        if not isinstance(value, (sp.Basic, sp.MatrixBase, int, float)):
            continue
        try:
            mathml = '<math xmlns="http://www.w3.org/1998/Math/MathML">' + sp.mathml(value, printer="presentation") + '</math>'
            latex = sp.latex(value).replace("<", r"\lt ").replace(">", r"\gt ")
            display = teacher_display({"mathml": mathml, "latex": latex})
        except Exception:
            # A presentation failure cannot change a tested answer. The shared
            # overview retains its escaped canonical input as the fallback.
            display = None
        if display is not None:
            displays[field] = display
    return displays


def _identity_parts(rendered):
    """Order mathematical spans and raw prose values without hashing prose offsets."""
    events = [(item["span"]["start"], item["span"]["end"], "math", item["input"])
              for item in rendered["math_segments"]]
    for item in rendered["resolutions"]:
        if item["kind"] == "raw" and not item["in_math"]:
            events.append((item["span"]["start"], item["span"]["end"], "raw", item["input"]))
    events.sort(key=lambda item: (item[0], item[1]))
    return [json.dumps([kind, value], ensure_ascii=False, separators=(",", ":"))
            for _, _, kind, value in events]


def validate_pool(question, options, base, *, file="<question>", label="<exercise>"):
    """Check every handwritten task through the ordinary canonical grader.

    This read-only CI leaf generates no values, identities, approvals or files.
    Ordinary Quarto pool rendering never invokes it.
    """
    from ctm_checkers.math_exercise.authored import _teacher_fields, run_question
    from ctm_checkers.testing import Raw, _expect

    if options.get("pool") not in (True, "true") or "variables" in options:
        raise ValueError(f"{file}: {label}: handwritten pool checking needs pool: true without variables")
    tasks = [part.strip() for part in re.split(r"(?m)^---[ \t]*$", question)]
    if not tasks or len(tasks) > 1000 or any(not part for part in tasks):
        raise ValueError(f"{file}: {label}: pool needs 1..1000 nonempty tasks")
    reports = []
    for number, task in enumerate(tasks, 1):
        try:
            keys = _teacher_fields(task)
            labels = options.get("field-labels", "")
            labels = [value.strip() for value in labels.split(",")] if isinstance(labels, str) and labels else list(labels)
            labels = labels or [str(index) for index in range(1, len(keys) + 1)]
            automatic = {"name": "teacher answers", "answers": {
                name: Raw(value) for name, value in zip(labels, keys)}, "expect": "correct"}
            resolved = dict(options, question=task)
            teacher = run_question(dict(resolved, tests=[automatic]), base)[0]
            for field, actual in teacher["actual"].get("fields", {}).items():
                _expect(actual, "correct", "teacher answers/" + str(field))
            authored = run_question(resolved, base) if options.get("tests") else []
            if authored is None:
                # The unchanged legacy assertion runner succeeds without a
                # report value. Preserve that contract with an explicit receipt.
                authored = [{"name": "legacy authored tests", "passed": True}]
            reports.append({"n": number, "teacher": teacher, "tests": authored})
        except Exception as error:
            raise ValueError(f"{file}: {label}: pool task {number}: {error}") from error
    return {"version": 1, "kind": "pool", "label": label, "passed": True,
            "count": len(reports), "tasks": reports}


def resolver(question, options, *, file="<question>", label="<exercise>"):
    """Return execution->{neutral candidate}; the native collector grades it.

    A scalar or fixed-vector/matrix marker must have one default-language field
    label per extracted answer. Placeholder interpretation uses the supervised
    native renderer and exact evaluator; no authored string reaches sympify.
    """
    from ctm_checkers.math_exercise.authored import _teacher_fields, _tests
    from ctm_checkers.variants import question_context
    from ctm_variants.generation import execute, _key
    from ctm_variants.model import candidate, snapshot
    from ctm_variants.placeholders import render, _input

    original = copy.deepcopy(options)
    labels = original.get("field-labels", [])
    labels = [value.strip() for value in labels.split(",")] if isinstance(labels, str) else labels
    if (not isinstance(labels, list) or not labels or any(not isinstance(value, str) or not value for value in labels)
            or len(set(labels)) != len(labels)):
        raise ValueError(f"{file}: {label}: variables require unique default-language field-labels")
    keys = _teacher_fields(question)
    if len(keys) != len(labels):
        raise ValueError(f"{file}: {label}: field-labels must match the answer markers in order")
    tests = _tests(original.get("tests", []))
    if not isinstance(tests, list):
        raise ValueError(f"{file}: {label}: generated variants need declarative tests")

    def resolve(execution):
        variables = execution["variables"]
        def teacher_for(marker_keys):
            if len(marker_keys) != len(labels):
                raise ValueError(f"{file}: {label}: translated answer markers must match default-language field-labels")
            inputs = {}
            for name, key in zip(labels, marker_keys):
                raw = re.sub(r"(?<!\\)\{@(.*?)@\}", r"{#\1#}", key, flags=re.S)
                inputs[name] = render(raw, variables=variables, file=file, label=label)["text"]
            if original.get("mode", "equivalent") in ("string", "string_ci", "set"):
                return inputs, dict(inputs)
            names = []
            for index in range(len(labels)):
                name = "ctmTeacher" + str(index)
                while name in variables or name in names:
                    name += "Value"
                names.append(name)
            source = "\n".join(name + " = " + inputs[field] for name, field in zip(names, labels))
            values = execute(source, variables=variables, file=file, label=label)["variables"]
            return inputs, {field: values[name] for field, name in zip(labels, names)}
        rendered = render(_answer_input_placeholders(question), variables=variables, file=file, label=label)
        resolved = copy.deepcopy(original)
        resolved.update(question=rendered["text"], tests=copy.deepcopy(tests))
        resolved.pop("variables", None)
        resolved["field-labels"] = list(labels)
        if original.get("boards"):
            resolved["board-values"] = {name: _board_value(value) for name, value in variables.items()}
        identity = _identity_parts(rendered)
        covered = {tuple(identity)}
        for name in ("solution", "note", "context-text"):
            if name in original:
                result = render(original[name], variables=variables, file=file, label=label)
                resolved[name] = result["text"]
                # Note is the human description, not additional student content.
                if name != "note":
                    parts = _identity_parts(result)
                    identity.extend(parts)
                    covered.add(tuple(parts))
        if "translations" in original:
            translated = {}
            for language, content in original["translations"].items():
                translated[language] = {}
                for name in ("question", "solution"):
                    result = render(_answer_input_placeholders(content.get(name, "")),
                                    variables=variables, file=file, label=label)
                    translated[language][name] = result["text"]
                    parts = _identity_parts(result)
                    # An unchanged translation of already-covered mathematics
                    # does not duplicate content identity. New mathematical
                    # values/operators remain approval-relevant.
                    if parts and tuple(parts) not in covered:
                        identity.extend(parts)
                        covered.add(tuple(parts))
            resolved["translations"] = translated
        teacher_inputs, teacher = teacher_for(keys)
        for language, content in original.get("translations", {}).items():
            _, translated_teacher = teacher_for(_teacher_fields(content["question"]))
            if translated_teacher != teacher:
                raise ValueError(f"{file}: {label}: translation {language} has different teacher answers from the default language")
        canonical_teacher = {field: value if isinstance(value, str) else _input(value)
                             for field, value in teacher.items()}
        canonical_variables = {}
        for name, value in variables.items():
            try:
                canonical_variables[name] = _input(value)
            except ValueError:
                from ctm_checkers.variants import encode
                canonical_variables[name] = json.dumps(encode(value), sort_keys=True, separators=(",", ":"))
        grading = {key: copy.deepcopy(original.get(key, default)) for key, default in GRADING_DEFAULTS.items()}
        grading["partial-credit"] = grading["partial-credit"] in (True, "true")
        grading["checker"] = hashlib.sha256(original.get("checker", "").encode("utf-8")).hexdigest()
        approved = snapshot(identity, canonical_teacher, grading, canonical_variables)
        context = question_context(labels, variables, teacher)
        note = resolved.get("note", rendered["canonical_text"])
        return candidate(_key(execution["choices"]), approved, note=note,
                         data={"options": resolved, "context": context, "teacher_inputs": teacher_inputs})
    return resolve
