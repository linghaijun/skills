#!/usr/bin/env python3
"""按 Jira 号在后端仓里建需求文档目录：docs/develop/{Sprint}-{票号}-{标题}/

用法（AI 先用 Atlassian MCP getJiraIssue 取 summary 与 Sprint 字段，再调本脚本）：

    py scripts/init_workdir.py --project <后端仓根> --jira CP-58118 \
        --sprint "26Q4-Sprint1 - Nova" --title "[Creative Hub] - 图片/Creative生成 - 支持AI生成Hook 与Scene 2个独立信息"

- 同一票号的目录已存在（docs/develop 下任一层名里含该票号，排除 archived/ tools/）→ 直接复用，不新建。
  这是为了防止同一需求被建出「…信息」「…信息2」两个目录、文档散落两处。
- 命中多个 → 退出码 2，列出候选，由用户决定用哪个。
- --dry-run 只打印将要建的路径。
- 最后一行固定输出 `DIR=<绝对路径>`，供 AI 解析。

只用标准库。
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ILLEGAL = re.compile(r'[/\\:*?"<>|]')
EXCLUDE = {"archived", "tools"}
TITLE_MAX = 80  # Windows 路径长度有限，标题过长时截断


def clean_sprint(raw: str) -> str:
    # Jira Sprint 名形如「26Q4-Sprint1 - Nova」：只取团队名之前那段
    s = raw.split(" - ")[0].strip()
    return ILLEGAL.sub("-", s)


def clean_title(raw: str) -> str:
    t = raw.strip()
    # 去掉开头的 [Creative Hub] 这类标签和随后的 " - "
    t = re.sub(r"^(\s*\[[^\]]*\]\s*-?\s*)+", "", t)
    t = ILLEGAL.sub("", t)
    t = re.sub(r"\s+", " ", t).strip(" -.")
    if len(t) > TITLE_MAX:
        t = t[:TITLE_MAX].rstrip(" -.")
    return t


def find_existing(develop: Path, jira: str) -> list[Path]:
    pat = re.compile(rf"(?<![A-Za-z0-9]){re.escape(jira)}(?!\d)", re.I)
    return sorted(p for p in develop.iterdir()
                  if p.is_dir() and p.name not in EXCLUDE and pat.search(p.name))


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="按 Jira 号建/复用需求文档目录")
    ap.add_argument("--project", required=True, help="后端仓根目录（其下有 docs/develop）")
    ap.add_argument("--jira", required=True, help="Story 票号，如 CP-58118（不要给 Epic）")
    ap.add_argument("--sprint", required=True, help="Jira Sprint 字段原值，如「26Q4-Sprint1 - Nova」")
    ap.add_argument("--title", required=True, help="Jira summary 原文")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    jira = args.jira.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9]+-\d+", jira):
        print(f"❌ 票号格式不对: {args.jira}", file=sys.stderr)
        raise SystemExit(1)
    sprint = clean_sprint(args.sprint)
    title = clean_title(args.title)
    if not sprint or not title:
        print("❌ Sprint 或标题清洗后为空，请向用户确认后重传", file=sys.stderr)
        raise SystemExit(1)

    develop = Path(args.project).resolve() / "docs" / "develop"
    if not develop.is_dir():
        print(f"❌ 不存在 {develop}，--project 是否指向后端仓根？", file=sys.stderr)
        raise SystemExit(1)

    existing = find_existing(develop, jira)
    if len(existing) > 1:
        print(f"⚠️  {jira} 已有 {len(existing)} 个目录，请用户指定用哪个：")
        for p in existing:
            print(f"   - {p.name}")
        raise SystemExit(2)
    if existing:
        print(f"♻️  已存在，直接复用：{existing[0].name}")
        print(f"DIR={existing[0]}")
        return

    target = develop / f"{sprint}-{jira}-{title}"
    if args.dry_run:
        print(f"[dry-run] 将创建：{target.name}")
    else:
        target.mkdir(parents=False, exist_ok=False)
        print(f"✅ 已创建：{target.name}")
    print(f"DIR={target}")


if __name__ == "__main__":
    main()
