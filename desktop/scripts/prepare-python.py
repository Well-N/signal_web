"""Build the Windows x64 runtime; run with pipeline/.venv/Scripts/python.exe.

Only the official embedded distribution and locked core dependencies are shipped.
Build prerequisites are bootstrapped into the host interpreter, never the runtime.
The parent packaging script must stage pipeline/src before calling this script.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import sys
import sysconfig
import tempfile
import urllib.request
import zipfile


PYTHON_VERSION = "3.13.9"
PYTHON_URL = "https://www.python.org/ftp/python/3.13.9/python-3.13.9-embed-amd64.zip"
# SHA2_256 messageDigest in the official release's .zip.sigstore bundle:
# https://www.python.org/ftp/python/3.13.9/python-3.13.9-embed-amd64.zip.sigstore
PYTHON_SHA256 = "91d828c2da3a029b41699e918674a0cb379c02cf20dab9c501306885f837402a"
UV_VERSION = "0.13.6"
PYPI_INDEX = "https://pypi.org/simple"
DESKTOP = Path(__file__).resolve().parent.parent
PIPELINE = DESKTOP.parent / "pipeline"
STAGING = DESKTOP / "staging"

PTH = """python313.zip
.
Lib/site-packages
Lib/site-packages/win32
Lib/site-packages/win32/lib
Lib/site-packages/Pythonwin
Lib/site-packages/pywin32_system32
../pipeline
import site
"""

# Keep DLL directory handles alive for the lifetime of every embedded process.
# Explicit _pth entries handle imports even when site does not process wheel .pths.
SITECUSTOMIZE = '''"""DLL search paths for the packaged pywin32 extensions."""
import os
from pathlib import Path

_root = Path(__file__).resolve().parent
_packages = _root / "Lib" / "site-packages"
_dll_directories = [
    os.add_dll_directory(str(_packages / relative))
    for relative in ("win32", "win32/lib", "Pythonwin", "pywin32_system32")
]
import pywin32_bootstrap
'''

SMOKE = r'''
import importlib
import io
from pathlib import Path
import sitecustomize
import sys

root = Path(sys.executable).resolve().parent
assert sys.version_info[:3] == (3, 13, 9), sys.version
assert sys.flags.isolated and not sys.flags.no_site
assert len(sitecustomize._dll_directories) == 4
for name in ("keyring", "mcp", "openai", "trafilatura", "reportlab",
             "ssl", "ctypes", "pywintypes", "pythoncom", "win32api", "win32cred", "jieba"):
    module = importlib.import_module(name)
    assert Path(module.__file__).resolve().is_relative_to(root), (name, module.__file__)
    print("Imported", name, flush=True)
from keyring.backends.Windows import WinVaultKeyring
assert WinVaultKeyring.priority > 0
import keyring
assert isinstance(keyring.get_keyring(), WinVaultKeyring), keyring.get_keyring()
import win32api
assert win32api.GetCurrentProcessId() > 0
from reportlab.pdfgen.canvas import Canvas
output = io.BytesIO()
canvas = Canvas(output)
canvas.drawString(20, 20, "Runtime smoke check")
canvas.save()
assert output.getvalue().startswith(b"%PDF-")
import src.models
expected = root.parent / "pipeline" / "src" / "models.py"
assert Path(src.models.__file__).resolve() == expected.resolve(), src.models.__file__
# Exercise the actual collection import graph and export, including jieba's dictionary.
import src.orchestrator
from src.export.wordcloud import build_wordcloud
from src.export.json_export import export_brief_json
from src.processing.profiles import ProfileRegistry
ProfileRegistry.load(root.parent / "pipeline" / "profiles", "ai-news")
import jieba
assert list(jieba.cut("中文分词用于新闻词云"))
cloud = build_wordcloud([{"title": "人工智能模型", "score": 8,
    "tags": ["中文分词"], "one_liner": "中文分词支持新闻词云。"}])
assert cloud["stories"] == 1 and cloud["words"], cloud
print("Collection imports, profiles, jieba dictionary and word cloud export passed.", flush=True)
assert all(".venv" not in path.lower() for path in sys.path), sys.path
print("Imported src.models from staged pipeline; Windows keyring and PDF checks passed.", flush=True)
'''


def run(args: list[str], *, cwd: Path = PIPELINE, **kwargs) -> subprocess.CompletedProcess:
    print("Running: " + subprocess.list2cmdline([str(arg) for arg in args]), flush=True)
    return subprocess.run(args, cwd=cwd, check=True, **kwargs)


def check_host() -> None:
    if (sys.platform != "win32" or platform.python_implementation() != "CPython"
            or sys.version_info[:2] != (3, 13) or struct.calcsize("P") != 8
            or sysconfig.get_platform() != "win-amd64"
            or sysconfig.get_config_var("Py_GIL_DISABLED")):
        raise RuntimeError("Run this script with standard Windows amd64 CPython 3.13 (cp313).")
    for required in (PIPELINE / "pyproject.toml", PIPELINE / "uv.lock",
                     STAGING / "pipeline" / "src" / "models.py"):
        if not required.is_file():
            raise RuntimeError(f"Required input missing: {required}. Stage pipeline resources first.")
    print(f"Host Python: {sys.version}; embedded Python: {PYTHON_VERSION} amd64", flush=True)


def download_runtime(archive: Path) -> None:
    print(f"Downloading {PYTHON_URL}", flush=True)
    digest = hashlib.sha256()
    with urllib.request.urlopen(PYTHON_URL, timeout=120) as response, archive.open("wb") as output:
        if response.url != PYTHON_URL:
            raise RuntimeError(f"Unexpected runtime redirect: {response.url}")
        while chunk := response.read(1024 * 1024):
            digest.update(chunk)
            output.write(chunk)
    if digest.hexdigest() != PYTHON_SHA256:
        raise RuntimeError(f"Python SHA256 mismatch: expected {PYTHON_SHA256}, got {digest.hexdigest()}")
    print(f"Verified Python SHA256: {PYTHON_SHA256}", flush=True)


def prepare(runtime: Path) -> None:
    archive = runtime / "download.zip"
    download_runtime(archive)
    with zipfile.ZipFile(archive) as distribution:
        # The pinned archive is flat. Reject unexpected paths before extracting.
        for entry in distribution.infolist():
            if "/" in entry.filename or "\\" in entry.filename or ":" in entry.filename:
                raise RuntimeError(f"Unexpected embedded archive entry: {entry.filename}")
        distribution.extractall(runtime)
    archive.unlink()

    # Always bootstrap the host tools explicitly; there is no alternate installer.
    run([sys.executable, "-m", "ensurepip", "--upgrade"])
    pip = [sys.executable, "-m", "pip", "--isolated", "--disable-pip-version-check"]
    run([*pip, "install", "--index-url", PYPI_INDEX, "--only-binary=:all:", f"uv=={UV_VERSION}"])
    requirements = runtime / "build-requirements.txt"
    run([sys.executable, "-m", "uv", "export", "--locked", "--no-dev",
         "--no-emit-project", "--no-header", "--format", "requirements-txt",
         "--output-file", str(requirements)], stdout=subprocess.DEVNULL)
    packages = runtime / "Lib" / "site-packages"
    # sgmllib3k 1.0.0 and jieba 0.42.1 publish only source distributions. This
    # declared exception is intentional; installation failures never trigger retries
    # with relaxed binary policy. All requirements retain uv.lock's SHA256 hashes.
    run([*pip, "install", "--index-url", PYPI_INDEX, "--target", str(packages),
         "--only-binary=:all:", "--no-binary=sgmllib3k,jieba", "--require-hashes",
         "--no-deps", "--no-compile", "-r", str(requirements)])
    requirements.unlink()
    (runtime / "python313._pth").write_text(PTH, encoding="utf-8")
    (runtime / "sitecustomize.py").write_text(SITECUSTOMIZE, encoding="utf-8")
    # Exclude developer Python paths and DLLs from validation, including Anaconda.
    environment = {key: value for key, value in os.environ.items()
                   if not key.upper().startswith("PYTHON")}
    windows = Path(os.environ["SystemRoot"])
    environment["PATH"] = os.pathsep.join(map(str, (runtime, windows / "System32", windows)))
    run([str(runtime / "python.exe"), "-I", "-B", "-X", "utf8", "-c", SMOKE],
        cwd=STAGING, env=environment)


def main() -> None:
    check_host()
    STAGING.mkdir(parents=True, exist_ok=True)
    # Never build through staging junctions or symlinks.
    if STAGING.resolve() != STAGING.absolute():
        raise RuntimeError(f"Staging must be a real directory: {STAGING}")
    target = STAGING / "python"
    lock = STAGING / ".prepare-python.lock"
    with lock.open("x", encoding="utf-8") as handle:
        handle.write(str(os.getpid()))
    try:
        # Immediate sibling placement makes ../pipeline identical before/after publish.
        with tempfile.TemporaryDirectory(prefix=".python-build-", dir=STAGING) as scratch:
            runtime = Path(scratch)
            prepare(runtime)
            if target.exists() or target.is_symlink() or target.is_junction():
                if (target.is_symlink() or target.is_junction()
                        or target.resolve() != STAGING.resolve() / "python"
                        or not target.is_dir()):
                    raise RuntimeError(f"Refusing to remove nonstandard runtime path: {target}")
                # Only replace this exact generated directory after smoke checks pass.
                shutil.rmtree(target)
            runtime.rename(target)
    finally:
        lock.unlink()
    print(f"Prepared and verified self-contained Python runtime: {target}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"Python runtime preparation failed: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
