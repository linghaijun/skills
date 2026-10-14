#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""上下文压缩（/compact 或自动压缩）之后的续跑提示 —— 给 Claude Code 的 SessionStart(compact) hook 用。

只用标准库。stdout 会被 Claude Code 当作上下文注入压缩后的对话；**没有进行中的需求就什么都不输出**。
任何异常都静默退出 0：hook 失败不能影响会话。

做的事：
1. 在 cwd、cwd/*/ 下找 docs/develop/，挑最近 48h 有状态更新的需求目录（.workflow-state.json /
   tests/.verify-state.json / .handover-state.json 的 mtime，排除 archived / tools / tests）
2. 对最近的 1~2 个需求跑 validate_step.py --status 拿续跑点
3. 打印：看板链接（目录名已 URL 编码）+ 续跑点 + 压缩后必做的三件事

用法（.claude/settings.json）：
  "hooks": {"SessionStart": [{"matcher": "compact", "hooks": [{"type": "command",
      "command": "python \"$HOME/.claude/skills/ai-driven-fullstack-workflow/scripts/compact_resume.py\""}]}]}
其他 agent 工具没有 /compact 与 SessionStart(compact)，不用配置，也不需要这个脚本。
"""

import os
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

RECENT_HOURS = 48
STATE_FILES = (".workflow-state.json", "tests/.verify-state.json", ".handover-state.json", ".qa-changes.json")
SKIP = {"archived", "tools", "tests"}
HERE = Path(__file__).resolve().parent


def develop_roots(cwd: Path):
    seen = []
    for cand in [cwd / "docs" / "develop", *cwd.glob("*/docs/develop")]:
        if cand.is_dir() and cand.resolve() not in seen:
            seen.append(cand.resolve())
    # cwd 本身就在 docs/develop/<需求>/ 里
    for p in [cwd, *cwd.parents]:
        if p.name == "develop" and p.parent.name == "docs" and p.resolve() not in seen:
            seen.append(p.resolve())
            break
    return seen


def latest_mtime(req: Path) -> float:
    ts = [(req / f).stat().st_mtime for f in STATE_FILES if (req / f).exists()]
    return max(ts) if ts else 0.0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cwd = Path(os.getcwd())
    cutoff = time.time() - RECENT_HOURS * 3600
    reqs = []
    for root in develop_roots(cwd):
        for d in root.iterdir():
            if d.is_dir() and d.name not in SKIP and not d.name.startswith("."):
                m = latest_mtime(d)
                if m >= cutoff:
                    reqs.append((m, d))
    if not reqs:
        return 0
    reqs.sort(reverse=True)
    reqs = reqs[:2]

    out = ["【上下文刚被压缩 · 工作流续跑提示】（ai-driven-*-workflow 的 SessionStart(compact) hook 自动注入）",
           "压缩后必做：",
           "1. 重新 Read 正在执行的 workflow 的 SKILL.md 和当前步的 step 文件 —— 压缩摘要不等于规则原文，门控 / 红线以文件为准",
           "2. 下一条回复先给用户看板链接（见下）",
           "3. 只信磁盘：压缩前没落盘的结论、取证、子 agent 结果都视为丢失，需要时重新取证；先跑 `qa_record.py changes` 看有无待确认改动",
           ""]
    for m, d in reqs:
        link = "http://127.0.0.1:8787/index.html#/" + urllib.parse.quote(d.name)
        out.append(f"需求：{d.name}（状态最后更新 {time.strftime('%m-%d %H:%M', time.localtime(m))}）")
        out.append(f"看板：[{d.name.split('-', 3)[-1][:40]}]({link})")
        try:
            r = subprocess.run([sys.executable, str(HERE / "validate_step.py"), "--dir", str(d), "--status"],
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
            lines = [ln for ln in r.stdout.splitlines() if ln.strip()]
            keep = [ln for ln in lines if "续跑点" in ln or "最后" in ln or "❌" in ln or "FAIL" in ln]
            out.extend("  " + ln.strip() for ln in (keep or lines[-3:]))
        except Exception as e:  # noqa: BLE001 —— hook 不能失败
            out.append(f"  （validate_step --status 未能运行：{e}；手动跑一次拿续跑点）")
        out.append("")
    print("\n".join(out).rstrip())
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        sys.exit(0)
