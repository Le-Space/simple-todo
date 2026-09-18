#!/usr/bin/env python3
"""Move one frozen chapter into the monorepo.

Usage: migrate-chapter.py <chapter> <preview-port> <relay-base-port>

What it does, in order:
  1. materialise refs/archive/<chapter> under apps/<chapter>
  2. drop every file the packages already carry byte-identically, and every file
     the packages carry in an adapted form (the e2e kit and the Aleph tools)
  3. rewrite imports of moved modules to their package specifier
  4. wire package.json, svelte.config.js, vite.config.js, playwright.config.js
  5. write chapter.json with this chapter's ports and its CI spec list

What it deliberately does NOT do: decide anything. Files that exist in a package
in a *different* shape are left in the chapter and listed at the end, because
that is a judgement call — see the Variantenkarte.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

ADAPTED_IN_PACKAGE = {
    # the kit's own modules: the package copies carry monorepo paths
    "check-preview-origin.mjs", "preview-origin.mjs", "consent.mjs", "start-e2e-server.mjs",
    "main-scenario.mjs", "aleph-guest-proxy.mjs", "aleph-provider-contract.mjs",
    "providers.mjs", "run-main.mjs", "aleph-playwright-provider.spec.js",
}
KEEP_IN_CHAPTER = {"agent.mjs"}          # knows the chapter's own UI
ALWAYS_PACKAGE_DIRS = ("scripts/", "static/")


def sha(path: pathlib.Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()



def same_but_for_imports(a: pathlib.Path, b: pathlib.Path) -> bool:
    """Whether two files differ only in where they import from.

    The package copies carry monorepo specifiers (`@simple-todo/...`) where the
    chapter still says `./utils.js`. Comparing raw bytes would call that a
    decision and leave a duplicate behind in every chapter.
    """
    def body(path: pathlib.Path) -> list[str]:
        return [line for line in path.read_text(encoding="utf-8").splitlines()
                if not line.lstrip().startswith("import ")]

    return body(a) == body(b)


def package_index() -> dict[str, list[pathlib.Path]]:
    index: dict[str, list[pathlib.Path]] = {}
    for root in ("packages", "tools"):
        for p in pathlib.Path(root).rglob("*"):
            if p.is_file() and "node_modules" not in str(p):
                index.setdefault(p.name, []).append(p)
    return index


def moved_modules() -> dict[str, tuple[str, str]]:
    moved: dict[str, tuple[str, str]] = {}
    for pkg in ("net", "ui", "todo", "e2e-kit"):
        base = pathlib.Path(f"packages/{pkg}/src")
        for f in base.rglob("*"):
            if f.is_file():
                moved.setdefault(f.name, (pkg, str(f.relative_to(base))))
    return moved


def rewrite_imports(app: pathlib.Path, moved: dict[str, tuple[str, str]]) -> int:
    """Point imports of moved modules at their package.

    Two guards, both learned the hard way: a specifier containing `*` is a glob
    (vitest's `include`) and must never be turned into one concrete file — that
    silently halved a chapter's test count — and a specifier whose target still
    exists in the chapter belongs to the chapter.
    """
    changed = 0
    for f in app.rglob("*"):
        if not f.is_file() or f.suffix not in (".js", ".mjs", ".svelte"):
            continue
        text = original = f.read_text(encoding="utf-8")
        for spec in set(re.findall(r"""['"]((?:\$lib|\.)[^'"]*)['"]""", text)):
            if "*" in spec:
                continue
            name = spec.split("/")[-1]
            if name not in moved:
                continue
            target = (app / "src/lib" / name) if spec.startswith("$lib") else (f.parent / spec)
            if target.exists():
                continue
            pkg, rel = moved[name]
            text = text.replace(f"'{spec}'", f"'@simple-todo/{pkg}/{rel}'")
        if text != original:
            f.write_text(text, encoding="utf-8")
            changed += 1
    return changed


def main() -> int:
    chapter, preview, relay = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    app = pathlib.Path(f"apps/{chapter}")
    if app.exists():
        print(f"apps/{chapter} exists already — remove it first")
        return 1

    app.mkdir(parents=True)
    subprocess.run(f"git archive refs/archive/{chapter} | tar -x -C {app}", shell=True, check=True)
    total = sum(1 for f in app.rglob("*") if f.is_file())

    index, moved = package_index(), moved_modules()
    dropped, decisions = 0, []
    for f in sorted(app.rglob("*")):
        if not f.is_file():
            continue
        rel = str(f.relative_to(app))
        if f.name == "package.json" or rel.startswith("contracts/") or f.name in KEEP_IN_CHAPTER:
            continue
        candidates = index.get(f.name, [])
        if not candidates:
            continue
        if (any(sha(c) == sha(f) for c in candidates)
                or any(same_but_for_imports(c, f) for c in candidates)
                or f.name in ADAPTED_IN_PACKAGE
                or rel.startswith(ALWAYS_PACKAGE_DIRS)):
            f.unlink()
            dropped += 1
        else:
            decisions.append(rel)

    for d in sorted(app.rglob("*"), key=lambda p: -len(str(p))):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()

    changed = rewrite_imports(app, moved)

    manifest = app / "package.json"
    pkg = json.loads(manifest.read_text())
    pnpm_block = pkg.pop("pnpm", None)
    pkg["name"] = f"@simple-todo/{chapter}"
    deps = pkg.setdefault("dependencies", {})
    for name in ("net", "ui", "todo"):
        deps[f"@simple-todo/{name}"] = "workspace:*"
    dev = pkg.setdefault("devDependencies", {})
    for name in ("e2e-kit", "brand", "aleph-tools"):
        dev[f"@simple-todo/{name}"] = "workspace:*"
    scripts = pkg.get("scripts", {})
    for key, old, new in (
        ("check:preview-origin", "e2e/check-preview-origin.mjs", "../../packages/e2e-kit/src/check-preview-origin.mjs"),
        ("test:e2e:remote:main", "e2e/remote/run-main.mjs", "../../packages/e2e-kit/src/remote/run-main.mjs"),
    ):
        if key in scripts:
            scripts[key] = scripts[key].replace(old, new)
    pkg["dependencies"] = dict(sorted(deps.items()))
    pkg["devDependencies"] = dict(sorted(dev.items()))
    manifest.write_text(json.dumps(pkg, indent=2) + "\n")

    svelte = app / "svelte.config.js"
    text = svelte.read_text()
    if "files:" not in text:
        text = text.replace(
            "const config = { kit: { adapter: adapter() } };",
            "const config = {\n\tkit: {\n\t\tadapter: adapter(),\n"
            "\t\t// favicons, manifest and robots.txt are the same bytes in every chapter\n"
            "\t\tfiles: { assets: '../../packages/brand/static' }\n\t}\n};",
        )
        svelte.write_text(text)

    vite = app / "vite.config.js"
    text = vite.read_text()
    if "noExternal" not in text:
        text = text.replace(
            "export default defineConfig({",
            "export default defineConfig({\n"
            "\t// Workspace packages ship source, not a build; SvelteKit has to process\n"
            "\t// them itself when it prerenders.\n"
            "\tssr: { noExternal: [/^@simple-todo\\//] },",
        )
        vite.write_text(text)

    play = app / "playwright.config.js"
    text = play.read_text()
    text = text.replace("command: 'node e2e/start-e2e-server.mjs'",
                        "command: 'node ../../packages/e2e-kit/src/start-e2e-server.mjs'")
    if "PREVIEW_PORT" not in text:
        text = re.sub(r"const previewPort = Number\([^)]*\);", "const previewPort = PREVIEW_PORT;", text)
        text = text.replace(
            "import { defineConfig, devices } from '@playwright/test';",
            "import { defineConfig, devices } from '@playwright/test';\n"
            "// The chapter's own ports, so two chapters can run their suites at once.\n"
            "import { PREVIEW_PORT } from '@simple-todo/e2e-kit/preview-origin.mjs';",
        )
    play.write_text(text)

    (app / "chapter.json").write_text(json.dumps({
        "name": chapter,
        "aleph": {
            "site": f"simple-todo-{chapter}" if chapter != "main" else "simple-todo",
            "domain": f"{chapter}.le-space.de" if chapter != "main" else "simple-todo.le-space.de",
            "deployer": "@le-space/node@0.6.22",
        },
        "ports": {
            "preview": preview, "relayHttp": relay, "relayTcp": relay + 1, "relayWs": relay + 2,
            "relayWebrtc": relay + 3, "relayWebrtcDirect": relay + 6,
        },
        "ci": {"specs": []},
    }, indent=2) + "\n")

    print(f"{chapter}: {total} Dateien → {total - dropped} im Kapitel, {dropped} aus Paketen, "
          f"{changed} Dateien mit angepassten Importen")
    if pnpm_block:
        print(f"  pnpm-Block des Kapitels (gehört in die Wurzel, ggf. auf das Kapitel eingeschränkt):")
        print("   ", json.dumps(pnpm_block.get("overrides", {}), indent=2).replace("\n", "\n    "))
    if decisions:
        print(f"  Entscheidungen — gleicher Name, andere Fassung ({len(decisions)}):")
        for d in decisions:
            print(f"    {d}")
    print("  chapter.json: ci.specs noch leer — aus der tests.yml des Kapitels nachtragen")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
