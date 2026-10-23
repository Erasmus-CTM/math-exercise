#!/usr/bin/env python3
"""Component-owned JSON adapter to the installed native variant authoring engine.

Use --stdin for the version-1 JSON interface, or --project/--file/--label with
generate25more, review or apply for local authoring. Native-only code and its
manifest are installed alongside the checker wheel, never in browser wheels.
"""
import sys

if __name__ == "__main__" and not sys.flags.isolated:
    import os
    os.execv(sys.executable, [sys.executable, "-I", __file__] + sys.argv[1:])

import copy
import hashlib
import json
import os
from pathlib import Path

INSTALL = "Install CTM Assessment's native authoring distribution alongside ctm-checkers."
HERE = Path(__file__).resolve().parent


def _folders():
    paths = [HERE.parent / "ctm-checkers"]
    extensions = next((path for path in HERE.parents if path.name == "_extensions"), None)
    if extensions is not None:
        paths += [extensions / "ctm-checkers"] + sorted(extensions.glob("*/ctm-checkers"))
    return list(dict.fromkeys(paths))


def _verify_native(path):
    path = path.resolve()
    manifest = json.loads((path / "native.json").read_text(encoding="utf-8"))
    if manifest.get("version") != 1 or manifest.get("kind") != "native-authoring" or not isinstance(manifest.get("files"), dict):
        raise ValueError("invalid native authoring manifest")
    actual = set()
    for file in path.rglob("*"):
        if file.is_symlink():
            raise ValueError("native authoring source must not contain symlinks")
        if not file.is_file():
            continue
        name = file.relative_to(path).as_posix()
        if name == "native.json" or (file.suffix == ".pyc" and file.parent.name == "__pycache__"):
            continue
        if file.is_symlink() or file.resolve().is_relative_to(path) is False:
            raise ValueError("native authoring source must stay inside its installation")
        actual.add(name)
    if actual != set(manifest["files"]):
        raise ValueError("native authoring file set differs from its manifest")
    for name, expected in manifest["files"].items():
        file = path / name
        if not file.resolve().is_relative_to(path):
            raise ValueError("native authoring path escapes its installation")
        data = file.read_bytes()
        if expected != {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}:
            raise ValueError("native authoring source differs from its manifest: " + name)
    return path


def parse_source(source):
    """One native extraction path shared by stdin and file-authoring callers."""
    import re
    lines, options, index = source.splitlines(), {}, 0
    while index < len(lines):
        match = re.match(r"^#\|\s*([^:]+):\s*(.*?)\s*$", lines[index])
        if not match:
            break
        key, value = match.groups()
        if key in options:
            raise ValueError("duplicate exercise option: " + key)
        index += 1
        if value == "|" or (key == "tests" and not value):
            block = []
            while index < len(lines):
                following = lines[index]
                if following.startswith("#|   "):
                    block.append(following[5:])
                elif re.match(r"^#\|\s*$", following):
                    block.append("")
                else:
                    break
                index += 1
            value = "\n".join(block)
        options[key] = value
    sections, language, part = {"": {"question": [], "solution": []}}, "", "question"
    for line in lines[index:]:
        if re.match(r"^#\|\s*solution\s*$", line):
            part = "solution"
            continue
        language_match = re.match(r"^#\|\s*lang:\s*([A-Za-z][A-Za-z0-9-]*)\s*$", line)
        if language_match:
            language, part = language_match[1], "question"
            if language in sections:
                raise ValueError("duplicate exercise translation: " + language)
            sections[language] = {"question": [], "solution": []}
            continue
        sections[language][part].append(line)
    sections = {language: {key: "\n".join(lines).strip() for key, lines in content.items()}
                for language, content in sections.items()}
    default = sections.pop("")
    if default["solution"]:
        options["solution"] = default["solution"]
    if sections:
        options["translations"] = sections
    return options, default["question"]


def current_source(payload):
    """Re-read the labelled block for file/UI mutations before resolving it."""
    import shutil
    import subprocess
    from ctm_variants.review import _path
    file = _path(payload["projectRoot"], payload.get("sourceFile", payload.get("file", "")))
    if not file.is_file() or file.stat().st_size > 1024 * 1024:
        raise ValueError("sourceFile must name the current authored file inside projectRoot (at most 1 MiB)")
    text = file.read_text(encoding="utf-8")
    quarto = os.environ.get("CTM_VARIANTS_QUARTO") or shutil.which("quarto")
    if not quarto:
        raise ValueError("sourceFile freshness needs Quarto on PATH (or explicit CTM_VARIANTS_QUARTO)")
    # CommonMark preserves Quarto's literal {math-exercise} language class;
    # Pandoc's markdown reader otherwise treats that bare-brace info as inline
    # code. No project/component filter or authored executable code is loaded.
    parsed = subprocess.run([quarto, "pandoc", "--from", "commonmark_x", "--to", "json"],
        input=text, text=True, capture_output=True, timeout=15)
    if parsed.returncode:
        raise ValueError("sourceFile Pandoc extraction failed: " + parsed.stderr[:4096])
    if len(parsed.stdout.encode("utf-8")) > 8 * 1024 * 1024:
        raise ValueError("sourceFile AST exceeds byte budget")
    document = json.loads(parsed.stdout)
    blocks = []
    def walk(node):
        if isinstance(node, dict):
            if node.get("t") == "CodeBlock" and "{math-exercise}" in node["c"][0][1]:
                blocks.append(node["c"][1])
            else:
                for child in node.values():
                    walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)
    walk(document.get("blocks", []))
    found = []
    for raw in blocks:
        options, question = parse_source(raw)
        if options.get("label") == payload["label"]:
            found.append((raw.rstrip("\r\n"), options, question))
    if len(found) != 1:
        raise ValueError("sourceFile must contain exactly one current block with label " + payload["label"])
    source, options, question = found[0]
    return dict(payload, source=source, options=options, question=question)


def install_imports():
    """Resolve only explicit/canonical installations before trusted imports."""
    wheel = Path(os.environ["CTM_CHECKERS_WHEEL"]).resolve() if os.environ.get("CTM_CHECKERS_WHEEL") else None
    native = Path(os.environ["CTM_VARIANTS_NATIVE"]).resolve() if os.environ.get("CTM_VARIANTS_NATIVE") else None
    for folder in _folders():
        if not folder.is_dir():
            continue
        if wheel is None and (folder / "checkers.json").is_file():
            descriptor = json.loads((folder / "checkers.json").read_text(encoding="utf-8"))
            candidate = (folder / descriptor["wheel"]).resolve()
            if not candidate.is_relative_to(folder.resolve()):
                raise ValueError("checker wheel path escapes its installation")
            if candidate.is_file():
                wheel = candidate
        if native is None and (folder / "native-authoring" / "native.json").is_file():
            native = folder / "native-authoring"
    if wheel is None or not wheel.is_file() or native is None:
        raise ValueError(INSTALL)
    descriptor = json.loads((wheel.parent / "checkers.json").read_text(encoding="utf-8"))
    if ((wheel.parent / descriptor["wheel"]).resolve() != wheel
            or descriptor.get("sha256") != hashlib.sha256(wheel.read_bytes()).hexdigest()):
        raise ValueError("checker wheel differs from its canonical descriptor")
    native = _verify_native(native)
    sys.path[:0] = [str(wheel), str(native), str(HERE)]


def request(payload):
    from ctm_variants import history, orchestration
    from ctm_variants.model import classify
    from ctm_variants.review import _path, apply_decisions
    from ctm_checkers.math_exercise.parsing import build_locals
    from ctm_checkers.variants import decode_context, question_context
    from variant_resolver import resolver

    if type(payload) is not dict or payload.get("version") != 1:
        raise ValueError("invalid component variants request/version")
    action = payload.get("action", "resolve")
    if action not in ("resolve", "generate", "decide", "decide-many"):
        raise ValueError("unknown component variants action")
    options = payload.get("options")
    if not isinstance(options, dict) or not isinstance(payload.get("question"), str) or not isinstance(payload.get("source"), str):
        raise ValueError("source, question and parsed options are required")
    extracted_options, extracted_question = parse_source(payload["source"])
    if options != extracted_options or payload["question"] != extracted_question:
        raise ValueError("original source differs from the component-parsed options/question")
    if action != "resolve":
        payload = current_source(payload)
        options = payload["options"]
    if "parameters" in options:
        raise ValueError("legacy parameters syntax was removed; use variables and review the generated candidates")
    source = options.get("variables")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("generated variants require variables source")
    approval, render_mode = payload.get("approval", "required"), payload.get("renderMode", "publish")
    if approval not in ("required", "optional") or render_mode not in ("publish", "preview", "review"):
        raise ValueError("invalid approval/render mode")
    label, file = payload["label"], payload.get("file", "<question>")
    path = _path(payload["projectRoot"], payload["manifest"])
    value, token = history.load(path, label)
    resolve = resolver(payload["question"], options, file=file, label=label)
    from sympy import Symbol
    variables = {name: value for name, value in build_locals(options.get("vars", "")).items()
                 if isinstance(value, Symbol)}
    common = {"variables": variables, "file": file, "label": label, "elapsed_limit": 120}
    reconciled = orchestration.reconcile(value, source, resolve, max_records=1000, **common)
    value, records = reconciled["manifest"], reconciled["records"]
    counters = {key: reconciled[key] for key in ("replayed", "gone")}
    mutation = False
    # A new preview may resolve a bounded tested batch without writing it.
    # Explicit Generate is the only proposal mutation and requires its lease.
    if action == "generate" or (action == "resolve" and not records and not value["proposals"]
                                and (render_mode != "publish" or approval == "optional")):
        generated = orchestration.generate(value, source, resolve, current=records,
            attempt_limit=5000, max_source_records=1000, seed=label, **common)
        value, records = generated["manifest"], generated["records"]
        counters.update({key: generated[key] for key in ("tested", "exhausted", "source_records", "duplicate_ids", "duplicate_notes")})
        if action == "generate":
            if "baseHash" not in payload:
                raise ValueError("generation requires a baseHash lease")
            mutation = True
    elif action in ("decide", "decide-many"):
        if "baseHash" not in payload:
            raise ValueError("deciding requires a baseHash lease")
        selections = [payload.get("decision")] if action == "decide" else payload.get("decisions")
        value = apply_decisions(value, records, selections)
        mutation = True
    target = options.get("variants", 25)
    if target == "all":
        raise ValueError("variants: all is not implemented by the tested batch workflow; use a positive target and Generate 25 more")
    elif isinstance(target, str):
        target = int(target)
    selected = history.publication(value["decisions"], records, approval=approval,
                                   render_mode=render_mode, target=target)
    classified = classify(value["decisions"], records)
    by_candidate = {row["candidate"]["id"]: row for row in classified["entries"] if row["candidate"] is not None}
    output = []
    for candidate in records:
        row = by_candidate.get(candidate["id"])
        entry = row["entry"] if row is not None else None
        current = row is not None and row["state"] in ("current", "moved")
        fields, variables, teacher, _ = decode_context(candidate["data"]["context"])
        identity = {"n": entry["n"], "id": candidate["id"], "hash": candidate["hash"]} if current else None
        output.append({**copy.deepcopy(candidate), "n": entry["n"] if entry else None,
            "state": row["state"] if row else "new", "status": entry["status"] if current else "undecided",
            "question": candidate["data"]["options"]["question"],
            "solution": candidate["data"]["options"].get("solution", ""),
            "options": candidate["data"]["options"], "teacherInputs": candidate["data"]["teacher_inputs"],
            "context": question_context(fields, variables, teacher, identity)})
    if mutation:
        # All generation, decision and publication/response validation finishes
        # before the one leased write. Validation failures do not mutate history.
        # A transport/timeout after commit is uncertain: reload its base hash.
        fresh = current_source(payload)
        if any(fresh[key] != payload[key] for key in ("source", "options", "question")):
            raise ValueError("source changed while variants were resolved; reload before saving")
        token = history.write(path, value, base_hash=payload["baseHash"])
    return {"version": 1, "manifest": value, "baseHash": token, "records": output,
            "deployableIds": selected["ids"], "warnings": selected["warnings"], "counters": counters}


def file_request(payload, command):
    """Build the same version-1 request from current source and explicit files.

    Downloaded review records, source text and project selectors are never
    authoritative. Only the original lease and explicit decisions are carried
    into a fresh component request.
    """
    import re
    from ctm_variants import history
    from ctm_variants.review import _path
    project = str(Path(payload["projectRoot"]).resolve())
    label = payload["label"]
    manifest = payload.get("manifest")
    if manifest is None:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", label) or ".." in label:
            raise ValueError("this label needs an explicit --manifest path inside the project")
        manifest = "_variants/" + label + ".yml"
    path = _path(project, manifest)
    manifest = path.relative_to(Path(project)).as_posix()
    file = _path(project, payload["file"]).relative_to(Path(project)).as_posix()
    request_payload = current_source({"projectRoot": project, "file": file,
        "sourceFile": file, "label": label, "manifest": manifest, "version": 1,
        "approval": "required", "renderMode": "review"})
    value, lease = history.load(path, label)
    if command == "generate25more":
        return dict(request_payload, action="generate", baseHash=lease)
    if command == "review":
        if lease is None or not value["proposals"]:
            raise ValueError("no retained proposals; run generate25more before reviewing decisions")
        return dict(request_payload, action="resolve")
    if command != "apply":
        raise ValueError("unknown file authoring command")
    downloaded_path = Path(payload["requestFile"])
    if not downloaded_path.is_file() or downloaded_path.stat().st_size > 1024 * 1024:
        raise ValueError("downloaded decision request must be a file of at most 1 MiB")
    downloaded = json.loads(downloaded_path.read_text(encoding="utf-8"))
    if (type(downloaded) is not dict or type(downloaded.get("version")) is not int
            or downloaded["version"] != 1 or downloaded.get("label") != label
            or downloaded.get("action") not in ("decide", "decide-many")
            or "baseHash" not in downloaded):
        raise ValueError("downloaded request needs this label, version 1, explicit decisions and its original baseHash")
    if not isinstance(downloaded.get("manifest"), str) or _path(project, downloaded["manifest"]) != path:
        raise ValueError("downloaded manifest differs from the selected --manifest")
    action = downloaded["action"]
    key = "decision" if action == "decide" else "decisions"
    return dict(request_payload, action=action, baseHash=downloaded["baseHash"],
                **{key: downloaded.get(key)})


def review_html(result, payload):
    """Use the shared review UI, prefilled for this explicit local operation."""
    from ctm_variants.review import document
    page = document(result)
    # The existing disconnected UI accepts project/manifest text controls. Keep
    # its exported decision protocol unchanged; --file supplies source context
    # when a downloaded request is applied through this component wrapper.
    defaults = json.dumps({"root": payload["projectRoot"], "path": payload["manifest"]},
                          ensure_ascii=True).replace("<", "\\u003c")
    script = "<script>Object.entries(" + defaults + ").forEach(([id,value])=>{document.getElementById(id).value=value;});</script>"
    return page.rsplit("</html>", 1)[0] + script + "</html>"


def supervised(raw, *, timeout=300, worker_args=()):
    """Bound the whole native request, including bootstrap and child teardown."""
    import signal
    import subprocess
    import tempfile
    import threading
    import time
    output_limit = 16 * 1024 * 1024
    deadline = time.monotonic() + timeout
    reason = []

    def kill(child):
        if os.name != "nt":
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass  # Child exited between the deadline and group cleanup.
        else:
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(child.pid)], timeout=2,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            except (OSError, subprocess.TimeoutExpired):
                pass
            finally:
                try:
                    child.kill()
                except ProcessLookupError:
                    pass

    # Files avoid unbounded communicate() buffers. The watcher aborts a worker
    # crossing the aggregate output budget; the returned buffers are capped.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        child = subprocess.Popen([sys.executable, "-I", str(Path(__file__).resolve()), "--stdin", "--worker", *worker_args],
            stdin=subprocess.PIPE, stdout=output, stderr=errors, start_new_session=os.name != "nt")
        def watch():
            while True:
                if os.fstat(output.fileno()).st_size + os.fstat(errors.fileno()).st_size > output_limit:
                    reason.append("total native request output budget exceeded")
                    kill(child)
                    return
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    reason.append("total native request time budget exceeded")
                    kill(child)
                    return
                try:
                    child.wait(timeout=min(0.05, remaining))
                    if os.fstat(output.fileno()).st_size + os.fstat(errors.fileno()).st_size > output_limit:
                        reason.append("total native request output budget exceeded")
                    return
                except subprocess.TimeoutExpired:
                    pass
        watcher = threading.Thread(target=watch, name="ctm-native-request-budget", daemon=True)
        watcher.start()
        try:
            child.communicate(raw)
        finally:
            if child.stdin is not None:
                child.stdin.close()
            watcher.join()
            if os.name != "nt":
                kill(child)  # Also retire author-created descendants on success.
        output.seek(0)
        errors.seek(0)
        stdout = output.read(output_limit)
        stderr = errors.read(max(0, output_limit - len(stdout)))
        if reason:
            return 1, b"", stderr + ("math-exercise variants: " + reason[0] + "\n").encode()
        return child.returncode, stdout, stderr


def main(argv=None):
    import argparse
    import contextlib
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("generate25more", "review", "apply"))
    parser.add_argument("request_file", nargs="?", type=Path, help="downloaded decision JSON for apply")
    parser.add_argument("--stdin", action="store_true", help="read the version-1 JSON request")
    parser.add_argument("--project", type=Path, help="course project root for file authoring")
    parser.add_argument("--file", help="authored source file inside the project")
    parser.add_argument("--label", help="unique authored exercise label")
    parser.add_argument("--manifest", help="manifest inside the project (default: _variants/LABEL.yml)")
    parser.add_argument("--html", type=Path, help="write a disconnected review HTML file")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--file-command", choices=("generate25more", "review", "apply"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.stdin:
        if args.command or args.request_file or any(value is not None for value in (args.project, args.file, args.label, args.manifest)):
            parser.error("choose --stdin or a file authoring command")
    elif (args.command is None or args.project is None or not args.file or not args.label
          or args.worker or args.file_command):
        parser.error("file authoring needs --project, --file, --label and generate25more, review or apply")
    if args.command == "apply" and args.request_file is None:
        parser.error("apply needs a downloaded decision JSON file")
    if args.command not in (None, "apply") and args.request_file is not None:
        parser.error("only apply accepts a downloaded decision JSON file")
    try:
        if args.stdin:
            raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        else:
            payload = {"projectRoot": str(args.project.resolve()), "file": args.file,
                       "label": args.label, "manifest": args.manifest}
            if args.request_file is not None:
                payload["requestFile"] = str(args.request_file.resolve())
            raw = json.dumps(payload, ensure_ascii=True, allow_nan=False).encode()
        if len(raw) > 1024 * 1024:
            raise ValueError("component variants request exceeds byte limit")
        if not args.worker:
            worker_args = ["--file-command", args.command] if args.command else []
            if args.html is not None:
                worker_args += ["--html", str(args.html.resolve())]
            code, stdout, stderr = supervised(raw, worker_args=worker_args)
            sys.stdout.buffer.write(stdout)
            sys.stderr.buffer.write(stderr)
            return code
        install_imports()
        with contextlib.redirect_stdout(sys.stderr):
            payload = json.loads(raw)
            request_file = payload.get("requestFile") if args.file_command else None
            if args.file_command:
                payload = file_request(payload, args.file_command)
            if args.html is not None:
                from ctm_variants.review import _path
                protected = {_path(payload["projectRoot"], payload["manifest"]),
                             _path(payload["projectRoot"], payload.get("sourceFile", payload["file"]))}
                if request_file:
                    protected.add(Path(request_file).resolve())
                if args.html.resolve() in protected:
                    raise ValueError("review HTML must not replace source, manifest or downloaded decisions")
                args.html.parent.mkdir(parents=True, exist_ok=True)
                if args.html.exists() and not args.html.is_file():
                    raise ValueError("review HTML output must be a file")
            result = request(payload)
            if args.html is not None:
                try:
                    args.html.write_text(review_html(result, payload), encoding="utf-8")
                except OSError as error:
                    raise ValueError("variant operation completed but review HTML could not be written; run review --html again: " + str(error)) from error
        print(json.dumps(result, ensure_ascii=True, allow_nan=False))
        return 0
    except Exception as error:
        print("math-exercise variants: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
