#!/usr/bin/env python3
"""
sync-integration-skills.py — keep ~/.claude/skills/{fergus,xero}.md in sync
with the route catalog in app/api/agent/{fergus,xero}/.

What it does:
  1. Scans every route.ts under each integration's agent folder.
  2. Extracts the HTTP methods exported (GET/POST/PATCH/PUT/DELETE).
  3. Re-generates the auto-managed "Endpoint catalog" block in the skill .md
     (between BEGIN-AUTO-GENERATED-* and END-AUTO-GENERATED-* markers).
  4. Surfaces a stderr warning if non-skill fergus/xero files have
     uncommitted changes — i.e. you edited code but didn't update the
     manually-maintained sections.

Wired up via a Stop hook in .claude/settings.json so it runs at the end
of every Claude Code session.

Idempotent: re-running with no changes does nothing (no file mtime bump).
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

DASHBOARD_DIR = Path(os.environ.get("DASHBOARD_DIR", "/Users/claudia/Desktop/nexley-dashboard"))
# Operator's local skill copy (read by Mac-side Claude Code sessions)
SKILLS_DIR = Path(os.environ.get("SKILLS_DIR", str(Path.home() / ".claude" / "skills")))
# VPS template — canonical source of truth, deployed to every client VPS
TEMPLATE_SKILLS_DIR = Path(os.environ.get(
    "TEMPLATE_SKILLS_DIR",
    "/Users/claudia/Clawdbot/templates/ai-employee-vps/.claude/skills",
))
QUIET = os.environ.get("QUIET") == "1"

INTEGRATIONS = ("fergus", "xero")

EXPORT_RE = re.compile(r"^export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(", re.MULTILINE)


def log(msg: str) -> None:
    if not QUIET:
        print(f"[sync-integration-skills] {msg}", file=sys.stderr)


def fs_to_url(repo_relative: Path) -> str:
    """app/api/agent/fergus/jobs/[job_id]/line-items/route.ts
       -> /api/agent/fergus/jobs/{job_id}/line-items"""
    p = str(repo_relative)
    if p.startswith("app"):
        p = p[len("app"):]
    if p.endswith("/route.ts"):
        p = p[: -len("/route.ts")]
    # Convert [param] → {param}
    p = re.sub(r"\[([^\]]+)\]", r"{\1}", p)
    return p


def methods_in(route_file: Path) -> list[str]:
    try:
        text = route_file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    seen = []
    for m in EXPORT_RE.findall(text):
        if m not in seen:
            seen.append(m)
    return seen


def build_catalog(integration: str) -> str:
    routes_dir = DASHBOARD_DIR / "app" / "api" / "agent" / integration
    if not routes_dir.is_dir():
        return f"_(no routes directory at `{routes_dir}`)_"

    rows = []
    route_files = sorted(routes_dir.rglob("route.ts"))
    for rf in route_files:
        rel = rf.relative_to(DASHBOARD_DIR)
        url = fs_to_url(rel)
        for method in methods_in(rf):
            rows.append((method, url, str(rel)))

    if not rows:
        return "_(no exported routes found)_"

    lines = ["| Method | Path | Source |", "|--------|------|--------|"]
    for method, url, source in rows:
        lines.append(f"| `{method}` | `{url}` | `{source}` |")
    lines.append("")
    lines.append(f"_{len(rows)} endpoint(s) across {len(route_files)} route file(s)._")
    return "\n".join(lines)


def update_skill(integration: str, skill_path: Path) -> bool:
    """Returns True if file changed."""
    if not skill_path.is_file():
        log(f"skill file not found: {skill_path} (skipping {integration})")
        return False

    upper = integration.upper()
    begin = f"<!-- BEGIN-AUTO-GENERATED-{upper}-ENDPOINTS -->"
    end = f"<!-- END-AUTO-GENERATED-{upper}-ENDPOINTS -->"

    original = skill_path.read_text(encoding="utf-8")

    if begin not in original or end not in original:
        log(f"WARN: markers missing in {skill_path}; skipping (re-add the BEGIN/END markers and rerun)")
        return False

    new_block = (
        f"{begin}\n"
        f"<!-- Maintained by scripts/sync-integration-skills.py — do not edit by hand. -->\n"
        f"\n"
        f"{build_catalog(integration)}\n"
        f"\n"
        f"{end}"
    )

    pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end), re.DOTALL)
    updated = pattern.sub(new_block, original, count=1)

    if updated == original:
        log(f"{skill_path.name} unchanged")
        return False

    skill_path.write_text(updated, encoding="utf-8")
    log(f"updated {skill_path}")
    return True


def check_skill_freshness(integration: str, skill_path: Path) -> None:
    """Warn (stderr only, non-blocking) when code is newer than the skill."""
    if shutil.which("git") is None:
        return
    if not (DASHBOARD_DIR / ".git").is_dir():
        return

    code_paths = [
        f"app/api/agent/{integration}",
        f"lib/integrations/{integration}.ts",
        f"lib/integrations/{integration}-input.ts",
        f"lib/integrations/{integration}-poller.ts",
    ]
    args = ["git", "-C", str(DASHBOARD_DIR), "diff", "--name-only", "HEAD", "--"] + code_paths
    try:
        out = subprocess.check_output(args, stderr=subprocess.DEVNULL).decode().strip().splitlines()
    except subprocess.CalledProcessError:
        return

    if not out:
        return

    skill_mtime = skill_path.stat().st_mtime
    stale = False
    for f in out:
        fp = DASHBOARD_DIR / f
        if not fp.is_file():
            continue
        if fp.stat().st_mtime > skill_mtime:
            stale = True
            break

    if stale:
        sys.stderr.write(
            f"\n[sync-integration-skills] ⚠️  {integration} code has uncommitted changes\n"
            f"    newer than {skill_path}.\n\n"
            f"    The auto-generated endpoint catalog has been refreshed.\n"
            f"    Update the manually-maintained sections (Detailed payloads,\n"
            f"    Lessons learned, Workflows) to reflect what just changed,\n"
            f"    then commit the skill alongside the code.\n\n"
        )


def mirror_to_template(integration: str, source: Path) -> bool:
    """Mirror SKILLS_DIR/<integration>.md → TEMPLATE_SKILLS_DIR/<integration>.md.
    The template is the canonical copy that gets deployed to every client VPS.
    Keeping these in lockstep means operator skill edits propagate to the fleet
    on the next deploy/push.

    Returns True if the template copy changed.
    """
    if not TEMPLATE_SKILLS_DIR.exists():
        log(f"template dir missing: {TEMPLATE_SKILLS_DIR} (skipping mirror)")
        return False
    target = TEMPLATE_SKILLS_DIR / f"{integration}.md"
    if not source.is_file():
        return False
    src_text = source.read_text(encoding="utf-8")
    if target.is_file() and target.read_text(encoding="utf-8") == src_text:
        return False
    target.write_text(src_text, encoding="utf-8")
    log(f"mirrored {source.name} → {target}")
    return True


def main() -> int:
    if not DASHBOARD_DIR.is_dir():
        log(f"DASHBOARD_DIR not found: {DASHBOARD_DIR} — exiting cleanly")
        return 0
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)

    any_changed = False
    template_changed = False
    for integration in INTEGRATIONS:
        skill_path = SKILLS_DIR / f"{integration}.md"
        if update_skill(integration, skill_path):
            any_changed = True
        check_skill_freshness(integration, skill_path)
        # Mirror operator's copy into the VPS template so the fleet stays in sync.
        if mirror_to_template(integration, skill_path):
            template_changed = True

    if any_changed:
        log("endpoint catalogs refreshed")
    if template_changed:
        sys.stderr.write(
            "\n[sync-integration-skills] 📡 VPS template skills updated.\n"
            "    Run `bash /Users/claudia/Clawdbot/scripts/push-integration-skills-to-fleet.sh`\n"
            "    to propagate to live client VPSes (or wait for the next per-client\n"
            "    integration-connect to enqueue it automatically).\n\n"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
