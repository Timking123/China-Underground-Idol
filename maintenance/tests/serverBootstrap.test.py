#!/usr/bin/env python3
"""在 Linux 临时树执行真实 Bash 控制流；系统账户、网络和提权工具全部替换为桩。"""

import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1]
TOOLS = (
    "id", "stat", "getent", "useradd", "mkdir", "chown", "node", "runuser",
    "ssh-keygen", "readlink", "ln", "apt-get", "npm", "git",
)
STUB = r'''#!/usr/bin/python3
import json, os, pathlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
state_file = root / "state.json"
state = json.loads(state_file.read_text())
command, args = pathlib.Path(sys.argv[0]).name, sys.argv[1:]
user = os.environ.get("SIMULATED_IDOL_USER") == "1"
base, home = str(root / "fs/srv/china-underground-idol/maintenance"), str(root / "fs/var/lib/idol-maint")
for variable in ("LD_PRELOAD", "LD_LIBRARY_PATH", "PYTHONPATH", "PYTHONHOME", "NODE_OPTIONS", "BASH_ENV", "ENV"):
    assert variable not in os.environ, (command, "未清理环境", variable)
with (root / "calls.jsonl").open("a") as log:
    log.write(json.dumps([command, "user" if user else "root", args]) + "\n")
def save(): state_file.write_text(json.dumps(state))
def require_user(): assert user, (command, "不得以 root 访问用户树")
if command == "id":
    print(1001 if user else 0)
elif command == "getent":
    if not state["account"]: sys.exit(2)
    print("idol-maint:x:1001:1001::" + home + ":/usr/sbin/nologin")
elif command == "useradd":
    assert not user and not state["account"] and "--no-create-home" in args
    state["account"] = True
    save()
elif command == "stat":
    path = args[-1]
    if not user:
        assert not path.startswith(base + "/") and not path.startswith(home + "/"), path
    info = os.lstat(path)
    default = 1001 if path == base or path.startswith(base + "/") or path == home or path.startswith(home + "/") else 0
    uid, gid = state["owners"].get(path, [default, default])
    print(args[1].replace("%u", str(uid)).replace("%g", str(gid)).replace("%a", oct(info.st_mode & 0o7777)[2:]))
elif command == "mkdir":
    path = args[-1]
    if not user:
        assert path in (str(root / "fs/srv/china-underground-idol"), base, home), path
    else:
        assert path.startswith(base + "/") or path == home + "/.ssh", path
    os.mkdir(path, int(args[args.index("-m") + 1], 8))
    state["owners"][path] = [1001, 1001] if user else [0, 0]
    if not user: state["created"].append(path)
    save()
elif command == "chown":
    path = args[-1]
    assert not user and path in (base, home) and path in state["created"]
    assert not os.path.islink(path) and not os.listdir(path), "只允许交付新建空叶子"
    assert args[-2] == "1001:1001"
    state["owners"][path] = [1001, 1001]
    state["created"].remove(path)
    save()
elif command == "runuser":
    assert not user and args[:3] == ["-u", "idol-maint", "--"]
    child = args[3:]
    assert child[:2] == ["/usr/bin/env", "-i"]
    child.insert(2, "SIMULATED_IDOL_USER=1")
    os.execv(child[0], child)
elif command == "node":
    if not user:
        assert args == ["-p", 'process.versions.node.split(".")[0]'], "root 不得执行用户树中的 JS"
        print(state.get("node_major", "22"))
    else:
        assert args == [base + "/vendor/node_modules/playwright/cli.js", "install", "chromium"]
        assert os.environ["PLAYWRIGHT_BROWSERS_PATH"] == base + "/vendor/browsers"
        pathlib.Path(base + "/vendor/browsers").mkdir(mode=0o700, exist_ok=True)
elif command == "npm":
    require_user()
    assert args == ["install", "--prefix", base + "/vendor", "--ignore-scripts", "--no-audit", "--no-fund"]
    pathlib.Path(base + "/vendor/node_modules").mkdir(mode=0o700, exist_ok=True)
elif command == "ssh-keygen":
    require_user()
    path = pathlib.Path(args[args.index("-f") + 1])
    assert str(path) == home + "/.ssh/github-idol"
    path.write_text("synthetic-private-key\n")
    pathlib.Path(str(path) + ".pub").write_text("synthetic-public-key\n")
elif command == "ln":
    require_user()
    assert args == ["-s", "--", base + "/vendor/node_modules", base + "/vendor/npm/node_modules"]
    os.symlink(args[-2], args[-1])
elif command == "readlink":
    require_user()
    print(os.readlink(args[-1]))
elif command == "apt-get":
    assert not user and args[:4] == ["install", "-y", "--no-install-recommends", "ca-certificates"]
    assert "libasound2t64" in args and "libatk-bridge2.0-0t64" in args
    assert all(repr(arg).count("/") == 0 and "$" not in arg for arg in args)
elif command == "git":
    require_user()
    assert args == ["ls-remote", "git@github.com:Timking123/China-Underground-Idol.git", "refs/heads/main"]
    print("synthetic-main-sha\trefs/heads/main")
else:
    raise AssertionError("未允许的命令: " + command)
'''


class Sandbox:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="idol-bootstrap-test-")
        self.root = Path(self.temp.name)
        self.fs = self.root / "fs"
        self.base = self.fs / "srv/china-underground-idol/maintenance"
        self.home = self.fs / "var/lib/idol-maint"
        self.outside = self.root / "outside"
        for path in (self.fs, self.fs / "srv", self.fs / "var", self.fs / "var/lib", self.outside):
            path.mkdir(mode=0o755)
        self.victim = self.outside / "victim"
        self.victim.write_text("sentinel-must-not-change\n", encoding="utf-8")
        self.victim.chmod(0o640)
        self.sentinel = self.snapshot(self.victim)
        self.state = self.root / "state.json"
        self.state.write_text(json.dumps({"account": False, "owners": {}, "created": []}), encoding="utf-8")
        self.log = self.root / "calls.jsonl"
        self.log.touch()
        tool_dir = self.root / "tools"
        tool_dir.mkdir()
        for name in TOOLS:
            tool = tool_dir / name
            tool.write_text(STUB, encoding="utf-8")
            tool.chmod(0o755)
        self.scripts = {}
        for name in ("bootstrap-server.sh", "configure-git.sh"):
            text = (SOURCE / name).read_text(encoding="utf-8")
            text = text.replace("for parent in / ", f"for parent in {self.fs} ")
            text = text.replace("for dir in / ", f"for dir in {self.fs} ")
            text = text.replace("/srv", str(self.fs / "srv")).replace("/var", str(self.fs / "var"))
            for tool in TOOLS:
                text = re.sub(r"/usr/(?:s?bin)/" + re.escape(tool) + r"\b", str(tool_dir / tool), text)
            script = self.root / name
            script.write_text(text, encoding="utf-8")
            self.scripts[name] = script

    def close(self):
        self.temp.cleanup()

    @staticmethod
    def snapshot(path):
        return (path.read_bytes(), path.stat().st_mode, path.stat().st_mtime_ns)

    def run(self, script):
        environment = {"PATH": "/deliberately/untrusted", "NODE_OPTIONS": "--invalid-option", "PYTHONPATH": "/invalid", "ENV": "/invalid"}
        return subprocess.run(["/bin/bash", str(self.scripts[script])], env=environment, text=True, capture_output=True, timeout=20)

    def initialize(self):
        for script in ("bootstrap-server.sh", "configure-git.sh"):
            result = self.run(script)
            if result.returncode:
                raise AssertionError(result.stderr)
        self.log.write_text("", encoding="utf-8")

    def calls(self):
        return [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]

    def owner(self, path, uid):
        state = json.loads(self.state.read_text(encoding="utf-8"))
        state["owners"][str(path)] = [uid, uid]
        self.state.write_text(json.dumps(state), encoding="utf-8")

    def symlink(self, path, directory=False):
        if path.is_symlink():
            path.unlink()
        elif path.exists():
            path.rename(self.outside / "saved-original")
        path.symlink_to(self.outside if directory else self.victim, target_is_directory=directory)


@unittest.skipUnless(os.name == "posix" and Path("/bin/bash").exists(), "需要 Linux Bash，可在 WSL Ubuntu 运行")
class ServerBootstrapTests(unittest.TestCase):
    def sandbox(self, initialized=True):
        box = Sandbox()
        self.addCleanup(box.close)
        if initialized:
            box.initialize()
        return box

    def assert_stopped(self, box, script):
        result = box.run(script)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("bootstrap" if script == "bootstrap-server.sh" else "configure-git", result.stderr)
        self.assertNotIn("git", [call[0] for call in box.calls()], result.stderr)
        self.assertNotIn("apt-get", [call[0] for call in box.calls()], result.stderr)
        self.assertEqual(box.snapshot(box.victim), box.sentinel)

    def test_fresh_and_double_run_preserve_credentials(self):
        box = self.sandbox(initialized=False)
        for script in ("bootstrap-server.sh", "configure-git.sh"):
            result = box.run(script)
            self.assertEqual(result.returncode, 0, result.stderr)
        files = [box.home / ".ssh" / name for name in ("github-idol", "github-idol.pub", "config", "known_hosts")]
        before = [box.snapshot(path) for path in files]
        for script in ("bootstrap-server.sh", "configure-git.sh"):
            result = box.run(script)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(before, [box.snapshot(path) for path in files])
        commands = [call[0] for call in box.calls()]
        self.assertEqual(commands.count("useradd"), 1)
        self.assertEqual(commands.count("chown"), 2)
        self.assertEqual(commands.count("ssh-keygen"), 1)
        self.assertEqual(commands.count("npm"), 2)
        self.assertEqual(commands.count("git"), 2)

    def test_legacy_safe_home_and_manifest_modes(self):
        box = self.sandbox()
        box.home.chmod(0o755)
        (box.base / "vendor/package.json").chmod(0o644)
        for script in ("bootstrap-server.sh", "configure-git.sh"):
            result = box.run(script)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("chown", [call[0] for call in box.calls()])

    def test_original_root_primitives_fail_privilege_oracle(self):
        # 复现修复前的两个危险调用；工具桩必须拒绝它们，避免空洞的安全绿灯。
        for command in ("node", "chown"):
            with self.subTest(command=command):
                box = self.sandbox()
                tool = box.root / "tools" / command
                if command == "node":
                    invocation = f'{tool} "{box.base}/vendor/node_modules/playwright/cli.js" install-deps chromium'
                else:
                    box.symlink(box.home / ".ssh/config")
                    invocation = f'{tool} idol-maint:idol-maint "{box.home}/.ssh/config"'
                script = box.scripts["bootstrap-server.sh"]
                script.write_text("unset LD_PRELOAD LD_LIBRARY_PATH PYTHONPATH PYTHONHOME NODE_OPTIONS BASH_ENV ENV\n" + invocation + "\n", encoding="utf-8")
                result = box.run("bootstrap-server.sh")
                self.assertEqual(result.returncode, 1)
                self.assertIn("AssertionError", result.stderr)
                self.assertEqual(box.calls()[0][:2], [command, "root"])
                self.assertEqual(box.snapshot(box.victim), box.sentinel)

    def test_bootstrap_rejects_leaf_and_intermediate_symlinks(self):
        cases = ("base", "home", "parent", "vendor", "vendor/npm", "vendor/node_modules", "vendor/browsers", "ssh", "key", "public-key", "package", "npm-link")
        for case in cases:
            with self.subTest(case=case):
                box = self.sandbox()
                locations = {"base": box.base, "home": box.home, "parent": box.base.parent, "ssh": box.home / ".ssh", "key": box.home / ".ssh/github-idol", "public-key": box.home / ".ssh/github-idol.pub", "package": box.base / "vendor/package.json", "npm-link": box.base / "vendor/npm/node_modules"}
                path = locations.get(case, box.base / case)
                box.symlink(path, directory=case not in ("key", "public-key", "package"))
                self.assert_stopped(box, "bootstrap-server.sh")

    def test_configure_rejects_leaf_and_intermediate_symlinks(self):
        for case in ("home", "parent", ".ssh", ".ssh/github-idol", ".ssh/config", ".ssh/known_hosts"):
            with self.subTest(case=case):
                box = self.sandbox()
                path = box.home if case == "home" else box.home.parent if case == "parent" else box.home / case
                box.symlink(path, directory=case in ("home", "parent", ".ssh"))
                self.assert_stopped(box, "configure-git.sh")

    def test_bootstrap_rejects_owner_and_mode_mismatch(self):
        for case in ("base", "home", "parent", "vendor", "ssh", "package", "key"):
            for fault in ("owner", "mode"):
                with self.subTest(case=case, fault=fault):
                    box = self.sandbox()
                    path = {"base": box.base, "home": box.home, "parent": box.base.parent, "vendor": box.base / "vendor", "ssh": box.home / ".ssh", "package": box.base / "vendor/package.json", "key": box.home / ".ssh/github-idol"}[case]
                    if fault == "owner":
                        box.owner(path, 1999)
                    else:
                        path.chmod(0o777)
                    self.assert_stopped(box, "bootstrap-server.sh")

    def test_configure_rejects_owner_and_mode_mismatch(self):
        for case in ("home", "parent", ".ssh", ".ssh/github-idol", ".ssh/config", ".ssh/known_hosts"):
            for fault in ("owner", "mode"):
                with self.subTest(case=case, fault=fault):
                    box = self.sandbox()
                    path = box.home if case == "home" else box.home.parent if case == "parent" else box.home / case
                    if fault == "owner":
                        box.owner(path, 1999)
                    else:
                        path.chmod(0o777)
                    self.assert_stopped(box, "configure-git.sh")

    def test_configuration_conflict_never_overwrites(self):
        for name in ("config", "known_hosts"):
            with self.subTest(name=name):
                box = self.sandbox()
                path = box.home / ".ssh" / name
                path.write_text("existing-different-configuration\n", encoding="utf-8")
                before = box.snapshot(path)
                self.assert_stopped(box, "configure-git.sh")
                self.assertEqual(before, box.snapshot(path))


if __name__ == "__main__":
    unittest.main(verbosity=2)
