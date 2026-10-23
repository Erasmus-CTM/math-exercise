#!/usr/bin/env python3
"""One-question, token-bound loopback review; native wrapper owns all writes."""
import sys
if __name__ == "__main__" and not sys.flags.isolated:
    import os
    os.execv(sys.executable, [sys.executable, "-I", __file__] + sys.argv[1:])

import argparse
import http.server
import json
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import webbrowser
import hashlib
import importlib.util
import mimetypes
import os
import shutil
import signal
import time
from urllib.parse import unquote

LIMIT = 1024 * 1024


class Review:
    def __init__(self, project, source, label, language="en"):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", label) or ".." in label:
            raise ValueError("label must be a safe manifest filename")
        self.project = str(Path(project).resolve(strict=True))
        source_path = (Path(self.project) / source).resolve(strict=True)
        self.source = source_path.relative_to(self.project).as_posix()
        if not source_path.is_file():
            raise ValueError("source must be a project file")
        self.label = label
        if language not in ("en", "de", "nb"):
            raise ValueError("review language must be en, de or nb")
        self.language = language
        self.manifest = "_variants/" + label + ".yml"
        self.wrapper = Path(__file__).with_name("question-variants.py")
        self.preview_directory = tempfile.TemporaryDirectory(prefix="ctm-student-review-")
        self.preview_cache = {}
        self.preview_choices = {}
        self.preview_outputs = {}

    def component(self):
        spec = importlib.util.spec_from_file_location("ctm_component_review", self.wrapper)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.install_imports()
        return module

    def source_payload(self):
        return self.component().current_source(dict(projectRoot=self.project,
            file=self.source, sourceFile=self.source, label=self.label))

    def run(self, *arguments):
        result = subprocess.run([sys.executable, "-I", str(self.wrapper), "--project", self.project,
            "--file", self.source, "--label", self.label, *map(str, arguments)],
            cwd=self.wrapper.parent, capture_output=True, timeout=330)
        if result.returncode:
            raise ValueError(result.stderr.decode("utf-8", "replace")[-8000:] or "native review failed")
        return result

    def page(self, endpoint):
        response = json.loads(self.run("review").stdout)
        payload = self.source_payload()
        languages = ["default"] + list(payload["options"].get("translations", {}))
        if any(language not in ("default", "en", "de", "nb") for language in languages):
            raise ValueError("student review currently supports default, en, de and nb")
        previews = {}
        self.preview_choices = {}
        self.preview_outputs = {}
        for record in response["records"]:
            slug = hashlib.sha256(record["id"].encode()).hexdigest()
            self.preview_choices[slug] = (record["id"], languages)
            previews[record["id"]] = [dict(language=language,
                url=endpoint + "previews/" + slug + "/" + language + "/index.html")
                for language in languages]
        from ctm_variants.review import document
        return document(response, connected_endpoint=endpoint, student_previews=previews,
            language=self.language).encode("utf-8")

    def copy_extensions(self, target):
        """Copy installed packages, never arbitrary project resources."""
        base = Path(self.project) / "_extensions"
        total = 0
        for name in ("math-exercise", "ctm-libs", "ctm-checkers", "ctm-assessment"):
            candidates = ([self.wrapper.parent] if name == "math-exercise" else [])
            candidates += [self.wrapper.parent.parent / name, base / name]
            candidates += list(base.glob("*/" + name))
            selector = {"ctm-libs": "CTM_LIBS_EXTENSION", "ctm-checkers": "CTM_CHECKERS_EXTENSION"}.get(name)
            if selector and os.environ.get(selector):
                candidates.append(Path(os.environ[selector]))
            source = next((path for path in candidates if (path / "_extension.yml").is_file()), None)
            if source is None:
                if name == "ctm-assessment" and os.environ.get("CTM_COMPONENT_DEV") == "1":
                    continue
                raise ValueError("student review needs installed " + name)
            files = list(source.rglob("*"))
            if any(path.is_symlink() for path in files) or len(files) > 4096:
                raise ValueError("student review requires ordinary installed package files")
            total += sum(path.stat().st_size for path in files if path.is_file())
            if total > 128 * 1024 * 1024:
                raise ValueError("student review package copy exceeds byte budget")
            shutil.copytree(source, target / "_extensions" / name)

    def render_student(self, identifier, language):
        """Render one tested candidate with the actual component, on demand."""
        response = json.loads(self.run("review").stdout)
        if not any(record["id"] == identifier for record in response["records"]):
            raise ValueError("review candidate changed; rebuild review")
        payload = self.source_payload()
        manifest = (Path(self.project) / self.manifest).read_bytes()
        key = hashlib.sha256((payload["source"] + identifier + language).encode() + manifest).hexdigest()
        if key in self.preview_cache:
            return self.preview_cache[key]
        root = Path(self.preview_directory.name) / key
        root.mkdir()
        try:
            self.copy_extensions(root)
            (root / "_variants").mkdir()
            (root / self.manifest).write_bytes(manifest)
            # A sufficiently long fence preserves the exact canonical block.
            fence = "`" * max(3, max((len(run) + 1 for run in re.findall(r"`+", payload["source"])), default=3))
            environment = dict(os.environ, CTM_VARIANTS="review",
                CTM_VARIANTS_REVIEW_CANDIDATE=identifier, CTM_VARIANTS_REVIEW_LANGUAGE=language)
            quarto = environment.get("CTM_VARIANTS_QUARTO") or shutil.which("quarto")
            if not quarto:
                raise ValueError("student review needs Quarto on PATH")
            inspected = self.render_command([quarto, "inspect", self.source], self.project,
                environment, timeout=30, output_limit=8 * 1024 * 1024, return_output=True)
            original = json.loads(inspected)["formats"]["html"]["metadata"]
            metadata = {"format": {"html": {"toc": False}}, "filters": ["math-exercise"],
                "execute": {"enabled": False}, "lang": original.get("lang", "en") if language == "default" else language,
                "ai-feedback": {"enabled": False}, "math-exercise": {"feedback": False}}
            if language == "default":
                for component in ("ctm-assessment", "math-exercise"):
                    settings = original.get(component, {})
                    if isinstance(settings, dict) and "lang" in settings:
                        metadata.setdefault(component, {})["lang"] = settings["lang"]
            # JSON is a YAML subset; no authored metadata/filter is executed.
            (root / "preview.qmd").write_text("---\n" + json.dumps(metadata) + "\n---\n\n"
                + fence + "{math-exercise}\n" + payload["source"] + "\n" + fence + "\n", encoding="utf-8")
            self.render_command([quarto, "render", "preview.qmd", "--output-dir", "site", "--output", "index.html"], root, environment)
            output = root / "site"
            if not (output / "index.html").is_file():
                raise ValueError("student review render produced no HTML")
            # Retain generated artifacts only; never serve copied packages,
            # the synthetic source or the copied authoring manifest.
            for path in root.iterdir():
                if path != output:
                    shutil.rmtree(path) if path.is_dir() else path.unlink()
            total = sum(path.stat().st_size for path in Path(self.preview_directory.name).rglob("*") if path.is_file())
            if total > 256 * 1024 * 1024:
                raise ValueError("student preview session exceeds 256 MiB; restart review")
            self.preview_cache[key] = output
            return output
        except Exception:
            shutil.rmtree(root, ignore_errors=True)
            raise

    @staticmethod
    def render_command(command, root, environment, *, timeout=330, output_limit=16 * 1024 * 1024, return_output=False):
        """Watch total render time/output and retire POSIX descendants."""
        with tempfile.TemporaryFile() as log:
            child = subprocess.Popen(command, cwd=root, env=environment,
                stdout=log, stderr=log, start_new_session=os.name != "nt")
            failure = None
            deadline = time.monotonic() + timeout
            try:
                while child.poll() is None:
                    if time.monotonic() >= deadline:
                        failure = "student review render time budget exceeded"
                        break
                    if os.fstat(log.fileno()).st_size > output_limit:
                        failure = "student review render output budget exceeded"
                        break
                    time.sleep(0.05)
            finally:
                if os.name != "nt":
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                elif child.poll() is None:
                    try:
                        subprocess.run(["taskkill", "/F", "/T", "/PID", str(child.pid)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2, check=False)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
                    finally:
                        child.kill()
                child.wait(timeout=5)
            if failure or child.returncode or os.fstat(log.fileno()).st_size > output_limit:
                log.seek(max(0, os.fstat(log.fileno()).st_size - 8000))
                raise ValueError((failure or "student review render failed") + ": " + log.read(8000).decode("utf-8", "replace"))
            if return_output:
                log.seek(0)
                return log.read(output_limit)

    def preview(self, suffix):
        parts = unquote(suffix).split("/")
        if len(parts) < 3 or any(part in ("", ".", "..") or "\\" in part for part in parts):
            raise ValueError("invalid student preview route")
        slug, language, *asset = parts
        choice = self.preview_choices.get(slug)
        if choice is None or language not in choice[1]:
            raise ValueError("unknown student preview")
        key = (slug, language)
        if asset == ["index.html"]:
            self.preview_outputs[key] = self.render_student(choice[0], language)
        output = self.preview_outputs.get(key)
        if output is None:
            raise ValueError("open the student preview before requesting its assets")
        path = output.joinpath(*asset)
        if (any(parent.is_symlink() for parent in [path, *path.parents] if parent.is_relative_to(output))
                or not path.resolve().is_relative_to(output.resolve()) or not path.is_file()
                or path.stat().st_size > 16 * 1024 * 1024):
            raise ValueError("student preview asset is unavailable")
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return path.read_bytes(), content_type

    def decide(self, value):
        if (type(value) is not dict or set(value) != {"baseHash", "decisions"}
                or not isinstance(value["baseHash"], str) or not isinstance(value["decisions"], list)
                or not value["decisions"]):
            raise ValueError("expected the current lease and a nonempty decision batch")
        request = dict(value, version=1, action="decide-many", label=self.label, manifest=self.manifest)
        with tempfile.TemporaryDirectory(prefix="ctm-review-") as directory:
            path = Path(directory) / "decisions.json"
            path.write_text(json.dumps(request, allow_nan=False), encoding="utf-8")
            # apply reconstructs options and records from the current source,
            # validates the whole batch, then performs one leased atomic write.
            self.run("apply", path)

    def generate(self, value):
        if (type(value) is not dict or set(value) != {"action", "baseHash"}
                or value["action"] != "generate25more" or not isinstance(value["baseHash"], str)):
            raise ValueError("expected Generate25more with the original page lease")
        self.run("generate25more", "--base-hash", value["baseHash"])


def server(review, port=0):
    token = secrets.token_urlsafe(32)
    route = "/" + token + "/"

    class Handler(http.server.BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *args):
            pass  # Do not copy the capability token into request logs.

        def reply(self, code, body, content_type="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def valid(self, write=False):
            origin = "http://127.0.0.1:" + str(self.server.server_port)
            allowed = self.path == route or (not write and self.path.startswith(route + "previews/") and "?" not in self.path)
            if (self.headers.get_all("Host") != [origin[7:]] or not allowed
                    or (write and self.headers.get_all("Origin") != [origin])
                    or (not write and self.headers.get("Origin") not in (None, origin))):
                self.reply(403, b'{"error":"invalid local review origin or route"}')
                return False
            return True

        def do_GET(self):
            if not self.valid():
                return
            try:
                if self.path == route:
                    self.reply(200, review.page(route), "text/html; charset=utf-8")
                else:
                    body, content_type = review.preview(self.path[len(route + "previews/"):])
                    self.reply(200, body, content_type)
            except Exception as error:
                self.reply(409, json.dumps({"error": str(error)}).encode())

        def do_POST(self):
            if not self.valid(write=True):
                return
            try:
                lengths = self.headers.get_all("Content-Length") or []
                if (len(lengths) != 1 or not lengths[0].isdigit()
                        or not 0 < int(lengths[0]) <= LIMIT
                        or self.headers.get("Transfer-Encoding") is not None
                        or self.headers.get("Content-Type") != "application/json"):
                    raise ValueError("expected bounded application/json request")
                raw = self.rfile.read(int(lengths[0]))
                if len(raw) != int(lengths[0]):
                    raise ValueError("incomplete request")
                value = json.loads(raw)
                if isinstance(value, dict) and value.get("action") == "generate25more":
                    review.generate(value)
                else:
                    review.decide(value)
                self.reply(200, b'{"saved":true}')
            except Exception as error:
                self.reply(409, json.dumps({"error": str(error)}).encode())

    instance = http.server.HTTPServer(("127.0.0.1", port), Handler)
    instance.review_url = "http://127.0.0.1:" + str(instance.server_port) + route
    return instance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--file", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--language", choices=("en", "de", "nb"), default="en")
    args = parser.parse_args()
    review = Review(args.project, args.file, args.label, args.language)
    try:
        with server(review, args.port) as instance:
            print("Connected local variant review: " + instance.review_url, flush=True)
            print("Stop with Ctrl-C. Decisions use the canonical current-source validator; no files are watched.", flush=True)
            if not args.no_browser:
                webbrowser.open(instance.review_url)
            try:
                instance.serve_forever()
            except KeyboardInterrupt:
                pass
    finally:
        review.preview_directory.cleanup()


if __name__ == "__main__":
    main()
