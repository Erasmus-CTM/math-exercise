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
        rendered = render(_answer_input_placeholders(question), variables=variables, file=file, label=label)
        resolved = copy.deepcopy(original)
        resolved.update(question=rendered["text"], tests=copy.deepcopy(tests))
        resolved.pop("variables", None)
        resolved["field-labels"] = list(labels)
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
        teacher_inputs = {}
        for name, key in zip(labels, keys):
            # Answer markers always contain literal input syntax, even when an
            # author selected a LaTeX placeholder in the marker.
            raw = re.sub(r"(?<!\\)\{@(.*?)@\}", r"{#\1#}", key, flags=re.S)
            teacher_inputs[name] = render(raw, variables=variables, file=file, label=label)["text"]
        mode = original.get("mode", "equivalent")
        if mode in ("string", "string_ci", "set"):
            teacher = dict(teacher_inputs)
        else:
            names = []
            for index in range(len(labels)):
                name = "ctmTeacher" + str(index)
                while name in variables or name in names:
                    name += "Value"
                names.append(name)
            source = "\n".join(name + " = " + teacher_inputs[field]
                               for name, field in zip(names, labels))
            values = execute(source, variables=variables, file=file, label=label)["variables"]
            teacher = {field: values[name] for field, name in zip(labels, names)}
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
