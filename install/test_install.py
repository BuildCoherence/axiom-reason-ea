import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from check_scripts import check


HERE = Path(__file__).resolve().parent
RELEASE_URL = "https://github.com/BuildCoherence/axiom-reason-ea/releases/latest/download"
VERSION = "axm v0.0.0-fixture"


def substitute(source, old, new):
    if source.count(old) != 1:
        raise AssertionError(f"expected one test substitution for {old!r}")
    return source.replace(old, new)


class ScriptEncodingTests(unittest.TestCase):
    def test_release_scripts_are_ascii_without_bom(self):
        check([HERE / "install.sh", HERE / "install.ps1"])

    def test_checker_rejects_non_ascii_and_boms(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            path = Path(directory) / "script"
            for payload in (b"# \xff", b"\xef\xbb\xbfhello", b"\xff\xfeh\x00"):
                with self.subTest(payload=payload):
                    path.write_bytes(payload)
                    with self.assertRaisesRegex(ValueError, "ASCII without a BOM"):
                        check([path])


class InstallerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(dir=HERE)
        cls.addClassCleanup(cls.workspace.cleanup)
        root = Path(cls.workspace.name)
        fixture = root / "fixture.go"
        fixture.write_text(
            'package main\nimport ("fmt"; "os")\n'
            'func main() { if len(os.Args) != 2 || os.Args[1] != "--version" '
            '{ os.Exit(2) }; fmt.Println("' + VERSION + '") }\n',
            encoding="ascii",
        )
        binary = root / "axm.exe"
        environment = dict(os.environ, GO111MODULE="off", GOTOOLCHAIN="local", CGO_ENABLED="0")
        environment.pop("GOOS", None)
        environment.pop("GOARCH", None)
        environment.update(GOCACHE=str(root / "go-cache"), TMPDIR=str(root), TEMP=str(root))
        subprocess.run(["go", "build", "-o", str(binary), str(fixture)], env=environment, check=True)
        cls.binary = binary.read_bytes()
        tar_bytes = io.BytesIO()
        with tarfile.open(fileobj=tar_bytes, mode="w:gz") as archive:
            entry = tarfile.TarInfo("axm")
            entry.size = len(cls.binary)
            entry.mode = 0o755
            archive.addfile(entry, io.BytesIO(cls.binary))
        cls.tar = tar_bytes.getvalue()
        zip_bytes = io.BytesIO()
        with zipfile.ZipFile(zip_bytes, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("axm.exe", cls.binary)
        cls.zip = zip_bytes.getvalue()
        cls.powershell = shutil.which(os.environ.get("POWERSHELL", "pwsh"))
        if not cls.powershell:
            raise RuntimeError("PowerShell is required; use nix shell nixpkgs#powershell locally")

    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory(dir=HERE)
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        self.requests = []
        self.assets = {}
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.requests.append(self.path)
                body = owner.assets.get(self.path)
                self.send_response(200 if body is not None else 404)
                self.end_headers()
                if body is not None:
                    self.wfile.write(body)

            def log_message(self, *_args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.addCleanup(self.server.server_close)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.server.shutdown)
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def arrange(self, archive, checksum="valid"):
        payload = self.zip if archive.endswith(".zip") else self.tar
        digest = hashlib.sha256(payload).hexdigest()
        line = f"{digest}  {archive}\n"
        manifest = {
            "valid": line,
            "uppercase": line.upper().replace(archive.upper(), archive),
            "mismatch": f"{'0' * 64}  {archive}\n",
            "missing": f"{digest}  other-archive.zip\n",
            "duplicate": line + line,
            "malformed": f"invalid  {archive}\n",
            "suffix": f"{digest}  prefix_{archive}\n",
            "regex-lookalike": f"{digest}  {archive.replace('.', 'X')}\n",
        }[checksum]
        self.assets = {f"/{archive}": payload, "/checksums.txt": manifest.encode("ascii")}
        self.requests.clear()

    def run_installer(self, kind, os_name="Linux", arch="x86_64", native_arch="", default_dir=False):
        environment = dict(os.environ, HOME=str(self.root), TMPDIR=str(self.root), TEMP=str(self.root))
        if kind == "sh":
            source = (HERE / "install.sh").read_text(encoding="ascii")
            source = substitute(source, RELEASE_URL, self.base_url)
            source = source.replace("'=https'", "'=http,https'")
            tools = self.root / "tools"
            tools.mkdir(exist_ok=True)
            uname = tools / "uname"
            uname.write_text(
                f'#!/bin/sh\ncase "$1" in -s) echo {os_name};; -m) echo {arch};; esac\n',
                encoding="ascii",
            )
            uname.chmod(0o755)
            environment["PATH"] = str(tools) + os.pathsep + environment["PATH"]
            environment.pop("INSTALL_DIR", None)
            destination = self.root / ".local" / "bin" / "axm"
            if not default_dir:
                destination = self.root / "custom bin" / "axm"
                environment["INSTALL_DIR"] = str(destination.parent)
            command = ["sh"]
        else:
            source = (HERE / "install.ps1").read_text(encoding="ascii")
            source = substitute(source, RELEASE_URL, self.base_url)
            # Keep tests out of the user's registry and window-message broadcast.
            source = substitute(source, "        Update-AxmPath $installDir", "        $null = $installDir")
            environment.update(LOCALAPPDATA=str(self.root / "local app data"), PROCESSOR_ARCHITECTURE=arch)
            # Windows defines PROCESSOR_ARCHITEW6432 only inside WOW64 processes; an
            # empty value is not a state a real installer run can see.
            environment.pop("PROCESSOR_ARCHITEW6432", None)
            if native_arch:
                environment["PROCESSOR_ARCHITEW6432"] = native_arch
            destination = self.root / "local app data" / "Programs" / "axm" / "axm.exe"
            command = [self.powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]
        path = self.root / f"install.{kind}"
        path.write_text(source, encoding="ascii")
        if kind == "sh":
            # Exercise the documented curl | sh entry point as stdin, too.
            result = subprocess.run(command, input=source, text=True, env=environment, capture_output=True, timeout=45)
        else:
            result = subprocess.run(command + [str(path)], text=True, env=environment, capture_output=True, timeout=45)
        return result, destination

    def assert_installed(self, result, destination, archive):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.requests, [f"/{archive}", "/checksums.txt"])
        self.assertEqual(destination.read_bytes(), self.binary)
        if os.name != "nt" and destination.suffix == ".exe":
            # Expand-Archive on Unix does not retain executable permissions.
            destination.chmod(0o755)
        self.assertTrue(os.access(destination, os.X_OK))
        version = subprocess.run([str(destination), "--version"], capture_output=True, text=True, check=True)
        self.assertEqual(version.stdout.strip(), VERSION)
        self.assertEqual(list(self.root.glob("axm-install-*")), [])
        self.assertEqual(list(destination.parent.glob(".axm*")), [])

    @unittest.skipIf(os.name == "nt", "POSIX installer runs in the Linux CI job")
    def test_posix_archive_selection_and_executable(self):
        for os_name, arch, expected in (
            ("Linux", "x86_64", "linux_amd64"),
            ("Linux", "amd64", "linux_amd64"),
            ("Linux", "aarch64", "linux_arm64"),
            ("Darwin", "x86_64", "darwin_amd64"),
            ("Darwin", "arm64", "darwin_arm64"),
        ):
            with self.subTest(os=os_name, arch=arch):
                archive = f"axm_{expected}.tar.gz"
                self.arrange(archive)
                result, destination = self.run_installer("sh", os_name, arch)
                self.assert_installed(result, destination, archive)

    def test_windows_archive_selection_and_executable(self):
        for arch, native, expected in (
            ("AMD64", "", "amd64"),
            ("ARM64", "", "arm64"),
            ("x86", "ARM64", "arm64"),
            ("AMD64", "ARM64", "arm64"),
            ("x86", "AMD64", "amd64"),
        ):
            with self.subTest(arch=arch, native=native):
                archive = f"axm_windows_{expected}.zip"
                self.arrange(archive)
                result, destination = self.run_installer("ps1", arch=arch, native_arch=native)
                self.assert_installed(result, destination, archive)

    def test_windows_uppercase_checksum(self):
        archive = "axm_windows_amd64.zip"
        self.arrange(archive, "uppercase")
        result, destination = self.run_installer("ps1", arch="AMD64")
        self.assert_installed(result, destination, archive)

    def test_bad_checksums_never_install_or_replace(self):
        kinds = ("ps1",) if os.name == "nt" else ("sh", "ps1")
        for kind in kinds:
            archive = "axm_windows_amd64.zip" if kind == "ps1" else "axm_linux_amd64.tar.gz"
            for checksum in ("mismatch", "missing", "duplicate", "malformed", "suffix", "regex-lookalike"):
                for existing in (False, True):
                    with self.subTest(kind=kind, checksum=checksum, existing=existing):
                        destination = (
                            self.root / "local app data" / "Programs" / "axm" / "axm.exe"
                            if kind == "ps1" else self.root / "custom bin" / "axm"
                        )
                        destination.unlink(missing_ok=True)
                        if existing:
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            destination.write_bytes(b"previous binary")
                        self.arrange(archive, checksum)
                        arch = "AMD64" if kind == "ps1" else "x86_64"
                        result, actual_destination = self.run_installer(kind, arch=arch)
                        self.assertEqual(actual_destination, destination)
                        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                        self.assertIn("checksum", result.stdout + result.stderr)
                        if existing:
                            self.assertEqual(destination.read_bytes(), b"previous binary")
                        else:
                            self.assertFalse(destination.exists())

    def test_download_failure_never_installs(self):
        kinds = ("ps1",) if os.name == "nt" else ("sh", "ps1")
        for kind in kinds:
            for missing in ("archive", "checksums"):
                with self.subTest(kind=kind, missing=missing):
                    archive = "axm_windows_amd64.zip" if kind == "ps1" else "axm_linux_amd64.tar.gz"
                    self.arrange(archive)
                    del self.assets[f"/{archive}" if missing == "archive" else "/checksums.txt"]
                    result, destination = self.run_installer(kind, arch="AMD64" if kind == "ps1" else "x86_64")
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertFalse(destination.exists())

    def test_unsupported_platform_never_downloads(self):
        cases = [("ps1", "Windows", "x86")]
        if os.name != "nt":
            cases += [("sh", "FreeBSD", "x86_64"), ("sh", "Linux", "riscv64")]
        for kind, os_name, arch in cases:
            with self.subTest(kind=kind, os=os_name, arch=arch):
                result, destination = self.run_installer(kind, os_name, arch)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("unsupported", result.stdout + result.stderr)
                self.assertEqual(self.requests, [])
                self.assertFalse(destination.exists())

    @unittest.skipIf(os.name == "nt", "POSIX installer runs in the Linux CI job")
    def test_default_posix_directory_and_uppercase_checksum(self):
        archive = "axm_linux_amd64.tar.gz"
        self.arrange(archive, "uppercase")
        result, destination = self.run_installer("sh", default_dir=True)
        self.assert_installed(result, destination, archive)
        self.assertEqual(destination, self.root / ".local" / "bin" / "axm")


if __name__ == "__main__":
    unittest.main()
