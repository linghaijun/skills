#!/usr/bin/env python3
"""从 Step 3-Checklist.md 机械生成 Jira 可拷贝纯净版。只用标准库。

- `Step 3-Checklist-Jira.txt`：全部条目
- 条目带 `[CP-xxxxx]` Story 标记时，另按 Story 拆分 `Step 3-Checklist-Jira-<Story>.txt`
  （不带标记的归 --main 指定的主票）

纯净版只保留条目本体（标题行 + Given / When / Then，可含 And），去掉：
- `>> 图示:` 行（图片在 Jira checklist 里无法显示）
- `(来源: 代码 gap-check)` 这类括注
- 章节标题、说明、表格等一切非条目内容

用法：
    python scripts/checklist_jira.py --dir <需求目录> [--main CP-58118]
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import OrderedDict
from pathlib import Path

ITEM = re.compile(r"^\* \[(open|done|blocked|waived)\] AC-\d{2,3}\b")
GWT = re.compile(r"^>>\s*(Given|And|When|Then)\s*[:：]")
NOTE = re.compile(r"\s*\(来源[:：][^)]*\)")
STORY = re.compile(r"\[([A-Z][A-Z0-9]+-\d+)\]")


def parse(text: str) -> list[list[str]]:
    items, cur = [], None
    for ln in text.splitlines():
        if ITEM.match(ln):
            if cur:
                items.append(cur)
            cur = [NOTE.sub("", ln).rstrip()]
        elif cur is not None and GWT.match(ln):
            cur.append(ln.rstrip())
        elif cur is not None and ln.startswith(">>"):
            continue  # 图示等非 GWT 行
        elif cur is not None:
            items.append(cur)
            cur = None
    if cur:
        items.append(cur)
    return items


def main() -> int:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description="Checklist → Jira 纯净版")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--main", help="不带 Story 标记的条目归属的主票；不给则从目录名取票号")
    a = ap.parse_args()
    d = Path(a.dir).resolve()
    src = d / "Step 3-Checklist.md"
    if not src.exists():
        print(f"❌ 找不到 {src}", file=sys.stderr)
        return 1
    items = parse(src.read_text(encoding="utf-8-sig"))
    main_key = a.main or (re.search(r"[A-Z][A-Z0-9]+-\d+", d.name) or [None])[0]
    body = lambda xs: "\n\n".join("\n".join(i) for i in xs) + "\n"
    (d / "Step 3-Checklist-Jira.txt").write_text(body(items), encoding="utf-8")
    groups: "OrderedDict[str, list]" = OrderedDict()
    for it in items:
        m = STORY.search(it[0])
        groups.setdefault(m.group(1) if m else (main_key or "MAIN"), []).append(it)
    if len(groups) > 1:
        for k, v in groups.items():
            (d / f"Step 3-Checklist-Jira-{k}.txt").write_text(body(v), encoding="utf-8")
    print(f"共 {len(items)} 条 → Step 3-Checklist-Jira.txt")
    if len(groups) > 1:
        for k, v in groups.items():
            print(f"  {k}: {len(v)} 条 → Step 3-Checklist-Jira-{k}.txt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
