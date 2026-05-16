#!/usr/bin/env python3
"""
markview setup script — checks and installs all prerequisites,
then fetches JS and Rust dependencies.

Usage:
    python3 setup.py          # full setup
    python3 setup.py --check  # check prereqs without installing anything

What this does:
  1. Checks (and optionally installs) Rust, Node.js, pnpm
  2. pnpm install  — JS dependencies
  3. cargo fetch   — pre-downloads Rust crates (includes resvg + icon crates)
  4. pnpm build    — compiles the frontend to dist/ so cargo build works
                     standalone (e.g. for IDE / rust-analyzer support)

  App icons are generated automatically from icons/icon.svg the first time
  `cargo build` runs (via build.rs). No manual step required.
"""

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Terminal colours (no external deps)
# ---------------------------------------------------------------------------

_COLOUR = sys.stdout.isatty()

def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _COLOUR else text

def ok(msg: str)   -> None: print(_c("32", f"  ✓  {msg}"))
def info(msg: str) -> None: print(_c("36", f"  →  {msg}"))
def warn(msg: str) -> None: print(_c("33", f"  !  {msg}"))
def fail(msg: str) -> None: print(_c("31", f"  ✗  {msg}"), file=sys.stderr)
def hdr(msg: str)  -> None: print(_c("1",  f"\n{msg}"))

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

WINDOWS = platform.system() == "Windows"
MACOS   = platform.system() == "Darwin"

ROOT = Path(__file__).resolve().parent
APP  = ROOT / "app"

MIN_NODE_MAJOR = 18
MIN_PNPM_MAJOR = 9
MIN_RUST_MINOR = 77  # 1.77


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def version_tuple(v: str) -> tuple[int, ...]:
    """Parse '1.77.2' → (1, 77, 2). Ignores non-numeric suffixes."""
    parts = []
    for seg in v.split("."):
        digits = "".join(c for c in seg if c.isdigit())
        if digits:
            parts.append(int(digits))
    return tuple(parts)


def which(cmd: str) -> str | None:
    return shutil.which(cmd)

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

def check_python() -> bool:
    major, minor = sys.version_info[:2]
    if (major, minor) < (3, 8):
        fail(f"Python 3.8+ required, found {major}.{minor}")
        return False
    ok(f"Python {major}.{minor}")
    return True


def check_rust() -> bool:
    rustc = which("rustc")
    if not rustc:
        return False
    res = run(["rustc", "--version"])
    if res.returncode != 0:
        return False
    # "rustc 1.77.2 (…)"
    parts = res.stdout.split()
    if len(parts) < 2:
        return False
    v = version_tuple(parts[1])
    if len(v) < 2 or v[0] < 1 or (v[0] == 1 and v[1] < MIN_RUST_MINOR):
        warn(f"Rust {parts[1]} found — 1.{MIN_RUST_MINOR}+ required")
        return False
    ok(f"Rust {parts[1]}")
    return True


def check_node() -> bool:
    node = which("node")
    if not node:
        return False
    res = run(["node", "--version"])
    if res.returncode != 0:
        return False
    v = version_tuple(res.stdout.strip().lstrip("v"))
    if not v or v[0] < MIN_NODE_MAJOR:
        warn(f"Node.js {res.stdout.strip()} found — {MIN_NODE_MAJOR}+ required")
        return False
    ok(f"Node.js {res.stdout.strip()}")
    return True


def check_pnpm() -> bool:
    pm = which("pnpm")
    if not pm:
        return False
    res = run(["pnpm", "--version"])
    if res.returncode != 0:
        return False
    v = version_tuple(res.stdout.strip())
    if not v or v[0] < MIN_PNPM_MAJOR:
        warn(f"pnpm {res.stdout.strip()} found — {MIN_PNPM_MAJOR}+ required")
        return False
    ok(f"pnpm {res.stdout.strip()}")
    return True


def check_platform_deps() -> bool:
    """Warn about platform-specific requirements that can't be auto-installed."""
    if MACOS:
        res = run(["xcode-select", "-p"])
        if res.returncode != 0:
            warn("Xcode Command Line Tools not found")
            info("Run:  xcode-select --install")
            return False
        ok("Xcode Command Line Tools")
    if WINDOWS:
        info("Windows: ensure WebView2 Runtime and MSVC Build Tools are installed")
        info("See https://v2.tauri.app/start/prerequisites/ for details")
    return True

# ---------------------------------------------------------------------------
# Installers
# ---------------------------------------------------------------------------

def install_rust() -> bool:
    info("Installing Rust via rustup …")
    if WINDOWS:
        fail("Automated Rust install not supported on Windows via this script")
        info("Download rustup-init.exe from https://rustup.rs and run it")
        return False
    res = subprocess.run(
        ["sh", "-c", "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"],
        cwd=str(ROOT),
    )
    if res.returncode != 0:
        fail("Rust installation failed")
        return False
    # Add cargo bin to PATH for this process
    cargo_bin = Path.home() / ".cargo" / "bin"
    os.environ["PATH"] = str(cargo_bin) + os.pathsep + os.environ.get("PATH", "")
    ok("Rust installed — restart your shell or run: source ~/.cargo/env")
    return True


def install_pnpm() -> bool:
    info("Enabling pnpm via corepack …")
    res = run(["corepack", "enable"])
    if res.returncode != 0:
        info("corepack enable failed; trying npm install -g pnpm …")
        res = run(["npm", "install", "-g", "pnpm"])
        if res.returncode != 0:
            fail("Could not install pnpm automatically")
            info("Run manually:  npm install -g pnpm")
            return False
    ok("pnpm installed")
    return True

# ---------------------------------------------------------------------------
# Dependency fetch
# ---------------------------------------------------------------------------

def pnpm_install() -> bool:
    hdr("Installing JavaScript dependencies")
    res = subprocess.run(["pnpm", "install"], cwd=str(ROOT))
    if res.returncode != 0:
        fail("pnpm install failed")
        return False
    ok("JavaScript dependencies installed")
    return True


def cargo_fetch() -> bool:
    hdr("Fetching Rust crates")
    res = subprocess.run(["cargo", "fetch"], cwd=str(APP))
    if res.returncode != 0:
        fail("cargo fetch failed")
        return False
    ok("Rust crates fetched")
    return True


def frontend_build() -> bool:
    """Build the frontend so dist/ exists for standalone cargo build / IDE support."""
    hdr("Building frontend (creates dist/ for cargo build)")
    dist = ROOT / "dist"
    if dist.exists() and any(dist.iterdir()):
        ok("dist/ already exists — skipping frontend build")
        return True
    res = subprocess.run(["pnpm", "build"], cwd=str(ROOT))
    if res.returncode != 0:
        fail("pnpm build failed")
        return False
    ok("Frontend built to dist/")
    return True



# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="markview environment setup")
    parser.add_argument(
        "--check", action="store_true",
        help="Check prerequisites only, do not install anything",
    )
    args = parser.parse_args()

    hdr("markview — environment check")

    # Python is already running so just report version
    check_python()
    check_platform_deps()

    hdr("Checking prerequisites")

    has_rust = check_rust()
    has_node = check_node()
    has_pnpm = check_pnpm()

    if args.check:
        all_ok = has_rust and has_node and has_pnpm
        print()
        if all_ok:
            ok("All prerequisites satisfied. Run  pnpm dev  to start.")
        else:
            fail("Some prerequisites are missing (see above).")
        return 0 if all_ok else 1

    # Install missing tools
    hdr("Installing missing prerequisites")

    if not has_rust:
        if not install_rust():
            fail("Cannot continue without Rust.")
            return 1
        if not check_rust():
            fail("Rust installed but 'rustc' still not found in PATH.")
            info("Open a new terminal and re-run setup.py, or run: source ~/.cargo/env")
            return 1

    if not has_node:
        fail("Node.js not found — please install Node.js 18+ from https://nodejs.org")
        return 1

    if not has_pnpm:
        if not install_pnpm():
            return 1
        if not check_pnpm():
            fail("pnpm installed but not found in PATH. Open a new terminal and retry.")
            return 1

    # Fetch dependencies and build
    if not pnpm_install():
        return 1

    if not cargo_fetch():
        return 1

    if not frontend_build():
        return 1

    # Done
    print()
    print(_c("1;32", "  Setup complete!"))
    print()
    print("  Start the app:")
    print(_c("36", "    pnpm dev"))
    print()
    print("  Build for distribution:")
    print(_c("36", "    pnpm build"))
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
