#!/usr/bin/env python
"""【DEPRECATED】请改用独立 skill `distribute-agent-skills`（~/.claude/skills/distribute-agent-skills/scripts/distribute.py）。
本文件仅为历史兼容保留、不再维护，两份可能已不一致；文档一律指向独立 skill。

把两个 workflow skill 从源目录分发到本机所有 agent 的 skills 目录。

用法：
    python scripts/distribute.py              # 分发并逐文件 MD5 校验
    python scripts/distribute.py --dry-run    # 只列出目标，不复制

分发目标 = 用户目录下（深度 ≤ MAX_DEPTH）已经装了任一 workflow skill 的 skills 目录，
即「装过的才更新」，不会往新的 agent 目录里铺。以下目录不是分发目标，始终排除：
  - 源目录本身（默认 ~/.claude/skills，即本脚本所在 skill 的上级目录）
  - IdeaProjects/ 下的一切：`skills*` 是用户的独立副本 / 备份；各仓库自带的 `.claude/skills` 等
    随仓库提交，要不要同步由用户逐仓决定（需要时用 --include-repos 显式带上）
  - ai.opencode.desktop：只有旧版、从未参与分发，未经用户确认不覆盖
  - 目录名不是 skills 的（如 ~/.trae-cn/worktrees 下的同名 git 工作区）
如需额外排除，用 --exclude 传 glob（按目标目录全路径匹配，可多次）。

只覆盖、不删除：目标里多出的文件原样保留（删除会被权限拦，也可能删掉对方本地改动）。
跳过 __pycache__。复制后逐文件比对 MD5，任何不一致都以非 0 退出。
"""

import argparse
import fnmatch
import hashlib
import os
import shutil
import sys
from pathlib import Path

SKILLS = ("ai-driven-fullstack-workflow", "ai-driven-backend-workflow", "cdp-drive-real-chrome", "distribute-agent-skills")  # cdp：workflow 浏览器取证依赖；distribute 自身放最后
ALWAYS_EXCLUDES = ("*/IdeaProjects/skills*", "*/ai.opencode.desktop/*")
REPO_EXCLUDES = ("*/IdeaProjects/*",)  # 仓库内副本，--include-repos 时放开
MAX_DEPTH = 5  # 已知最深的目标是 ~/.config/kimchi/harness/skills（4 层）
PRUNE = {"node_modules", ".git", ".m2", ".gradle", ".npm", ".cache", "__pycache__",
         ".venv", ".venvs", "site-packages", "Temp", "Packages"}


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def find_targets(home: Path, src: Path, excludes: list[str]) -> list[Path]:
    found = set()
    base_depth = len(home.parts)
    for root, dirs, _ in os.walk(home):
        here = Path(root)
        if len(here.parts) - base_depth >= MAX_DEPTH:
            dirs[:] = []
        else:
            dirs[:] = [d for d in dirs if d not in PRUNE]
        # 只认名为 skills 的目录：~/.trae-cn/worktrees 下有同名的 git 工作区，不是 skill 安装目录
        if here.name == "skills" and any(s in dirs for s in SKILLS):
            found.add(here)
            dirs[:] = [d for d in dirs if d not in SKILLS]
    src_r = src.resolve()
    out = []
    for t in sorted(found):
        posix = t.as_posix()
        if t.resolve() == src_r or any(fnmatch.fnmatch(posix, g) for g in excludes):
            continue
        out.append(t)
    return out


def skill_files(skill_dir: Path):
    for p in skill_dir.rglob("*"):
        if p.is_file() and "__pycache__" not in p.parts:
            yield p


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=Path(__file__).resolve().parents[2],
                    help="源 skills 目录（默认本脚本所在 skill 的上级目录）")
    ap.add_argument("--home", type=Path, default=Path.home(), help="搜索根目录（默认用户目录）")
    ap.add_argument("--exclude", action="append", default=[], help="额外排除的目标 glob，可多次")
    ap.add_argument("--dry-run", action="store_true", help="只列目标，不复制")
    ap.add_argument("--include-repos", action="store_true",
                    help="同时更新 IdeaProjects 各仓库内的 skill 副本（备份目录 IdeaProjects/skills* 仍排除）")
    args = ap.parse_args()

    for s in SKILLS:
        if not (args.src / s / "SKILL.md").exists():
            sys.exit(f"源目录缺少 {s}/SKILL.md：{args.src}")

    excludes = list(ALWAYS_EXCLUDES) + ([] if args.include_repos else list(REPO_EXCLUDES)) + args.exclude
    targets = find_targets(args.home, args.src, excludes)
    print(f"源：{args.src}")
    print(f"目标 {len(targets)} 个：")
    for t in targets:
        print(f"  {t}")
    if args.dry_run:
        return 0

    copied = bad = 0
    for t in targets:
        for s in SKILLS:
            src_dir = args.src / s
            for f in skill_files(src_dir):
                dst = t / s / f.relative_to(src_dir)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, dst)
                copied += 1
                if md5(f) != md5(dst):
                    bad += 1
                    print(f"MD5 不一致：{dst}")
    print(f"复制 {copied} 个文件，MD5 不一致 {bad} 个")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
