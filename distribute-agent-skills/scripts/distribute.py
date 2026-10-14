#!/usr/bin/env python
"""把源 skills 目录里的指定 skill 分发到本机所有 agent 的 skills 目录。

用法：
    python scripts/distribute.py --dry-run                 # 只列目标，不复制（先跑这个）
    python scripts/distribute.py                           # 分发默认 skill 并逐文件 MD5 校验
    python scripts/distribute.py --skill some-other-skill  # 分发指定 skill（可多次）

🔴 白名单（2026-10-14 起）：本 skill 根目录有 targets.txt 时，**只分发到其中列出的目录**（相对用户目录的 glob，
一行一个），列出且已存在的 skills 目录即使还没装过也会装上；不在名单里的目录一律不碰（旧副本原样留着，不删）。
要按下面的旧规则扫描全部目录，加 --all-targets。

旧规则（--all-targets，或没有 targets.txt 时）：
分发目标 = 用户目录下（深度 ≤ MAX_DEPTH）**已经装了任一待分发 skill** 的 skills 目录，
即「装过的才更新」，不会往新的 agent 目录里铺。以下目录不是分发目标，始终排除：
  - 源目录本身（默认 ~/.claude/skills，即本脚本所在 skill 的上级目录）
  - IdeaProjects/ 下各仓库内的 `.claude/skills` 等随仓库提交，默认不碰（需要时用 --include-repos）
  - IdeaProjects/skills* 备份目录（如 `skills - Copy`）始终排除；**`IdeaProjects/skills` 本仓库默认纳入**
    （可用 --no-include-skills-repo 关掉）
  - ai.opencode.desktop：只有旧版、从未参与分发，未经用户确认不覆盖
  - 目录名不是 skills 的（如 ~/.trae-cn/worktrees 下的同名 git 工作区）
如需额外排除，用 --exclude 传 glob（按目标目录全路径匹配，可多次）。

只覆盖、不删除：目标里多出的文件原样保留（删除会被权限拦，也可能删掉对方本地改动）。
源里已删掉、目标里还留着的文件会在结尾列为「残留」，默认**只提示不动手**。
用户看过残留清单、确认可删后，加 --prune 再跑一次：复制全部成功且 MD5 全一致后才删残留（连带清空的目录），
有任何 MD5 不一致都不删。残留也可能是别的工具在副本里新加的本地文件，所以必须先看清单再 --prune。
跳过 __pycache__。复制后逐文件比对 MD5，任何不一致都以非 0 退出。

🔴 复制前先做「目标被别处改过」检查（2026-10-14 加：另一个会话直接改了 ~/.cursor 下的副本，
分发用源版本覆盖，改动丢失且无法恢复）。命中任一条就**一个文件都不复制**，列清单后退出码 3：
  - 改动：目标文件内容与源不同（忽略 CRLF/LF 差异），且在上次分发到该目标之后被修改过
  - 新增：目标里有、源里没有的文件，且是上次分发之后才出现的
处理：把要保留的改动合回源 skill 再分发；确认不要就加 --force 覆盖（新增文件仍不删，只提示）。
「上次分发时间」记在本 skill 的 .last-distribute.json（每个 目标/skill 一条）；没有记录时，
改动按「目标文件比源文件新」判断，新增文件只提示、不拦。
"""

import argparse
import fnmatch
import hashlib
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

# 默认分发对象：两个 workflow + CDP 取证 + 系统化排障/Jira 闭环 + PM Sprint 看板（Jira）
# + 本分发工具自身（放最后，其他 agent 工具里也能直接用它分发；用户 2026-10-10 / 2026-10-14 要求）
DEFAULT_SKILLS = (
    "ai-driven-fullstack-workflow",
    "ai-driven-backend-workflow",
    "cdp-drive-real-chrome",
    "debugging-systematic-jira",
    "pm-sprint-update-jira",
    "distribute-agent-skills",
)
ALWAYS_EXCLUDES = ("*/IdeaProjects/skills*", "*/ai.opencode.desktop/*")
REPO_EXCLUDES = ("*/IdeaProjects/*",)  # 仓库内副本，--include-repos 时放开
SKILLS_REPO = "*/IdeaProjects/skills"  # 用户的 skills 仓库；默认纳入 allow（备份 skills - Copy 等仍由 ALWAYS_EXCLUDES 挡住）
MAX_DEPTH = 5  # 已知最深的目标是 ~/.config/kimchi/harness/skills（4 层）
PRUNE = {"node_modules", ".git", ".m2", ".gradle", ".npm", ".cache", "__pycache__",
         ".venv", ".venvs", "site-packages", "Temp", "Packages"}


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


STATE_FILE = Path(os.environ.get("DISTRIBUTE_STATE") or Path(__file__).resolve().parents[1] / ".last-distribute.json")
LOCAL_ONLY = {".last-distribute.json", ".last-distribute.tmp", ".commit-trailer"}  # 本机状态 / 本机配置，不参与分发
MTIME_SLACK = 2.0  # 秒；文件系统时间精度与复制耗时的余量


def load_state() -> dict:
    try:
        import json
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    import json
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    os.replace(tmp, STATE_FILE)


def same_content(a: Path, b: Path) -> bool:
    """忽略 CRLF / LF 差异比较内容（有的 agent 工具会改换行符，不算别人的改动）。"""
    try:
        return a.read_bytes().replace(b"\r\n", b"\n") == b.read_bytes().replace(b"\r\n", b"\n")
    except OSError:
        return False


def find_conflicts(src_dir: Path, dst_dir: Path, last: float | None) -> list[tuple[str, Path]]:
    """目标在上次分发之后被别处改过的文件：[(「改动」/「新增」, 路径)]。"""
    out = []
    if not dst_dir.is_dir():
        return out
    src_rel = {f.relative_to(src_dir) for f in skill_files(src_dir)}
    for f in skill_files(dst_dir):
        rel = f.relative_to(dst_dir)
        mt = f.stat().st_mtime
        if rel in src_rel:
            s = src_dir / rel
            if same_content(s, f):
                continue
            newer = mt > last + MTIME_SLACK if last is not None else mt > s.stat().st_mtime + MTIME_SLACK
            if newer:
                out.append(("改动", f))
        elif last is not None and mt > last + MTIME_SLACK:
            out.append(("新增", f))
    return out


def find_targets(home: Path, src: Path, skills, excludes: list[str], allow: list[str]) -> list[Path]:
    found = set()
    base_depth = len(home.parts)
    for root, dirs, _ in os.walk(home):
        here = Path(root)
        if len(here.parts) - base_depth >= MAX_DEPTH:
            dirs[:] = []
        else:
            dirs[:] = [d for d in dirs if d not in PRUNE]
        # 只认名为 skills 的目录：~/.trae-cn/worktrees 下有同名的 git 工作区，不是 skill 安装目录
        if here.name == "skills" and any(s in dirs for s in skills):
            found.add(here)
            dirs[:] = [d for d in dirs if d not in skills]
    src_r = src.resolve()
    out = []
    for t in sorted(found):
        posix = t.as_posix()
        if t.resolve() == src_r:
            continue
        if not any(fnmatch.fnmatch(posix, g) for g in allow) and any(fnmatch.fnmatch(posix, g) for g in excludes):
            continue
        out.append(t)
    return out


TARGETS_FILE = Path(__file__).resolve().parents[1] / "targets.txt"


def load_allowlist():
    """targets.txt → glob 列表（相对用户目录）；文件不存在返回 None"""
    if not TARGETS_FILE.exists():
        return None
    out = []
    for line in TARGETS_FILE.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip().replace("\\", "/").strip("/")
        if line:
            out.append(line)
    return out


def allowlisted_targets(home: Path, src: Path, globs, include_skills_repo: bool) -> list[Path]:
    """白名单模式：名单里存在的 skills 目录（不要求已装过本 skill）；源目录本身跳过"""
    src_r = src.resolve()
    out = set()
    for g in globs:
        if g == "IdeaProjects/skills" and not include_skills_repo:
            continue
        for d in home.glob(g):
            if d.is_dir() and d.resolve() != src_r:
                out.add(d)
    return sorted(out)


TRAILER_FILE = Path(__file__).resolve().parents[1] / ".commit-trailer"


def commit_trailer() -> str:
    """提交消息末尾的署名行：环境变量 → 本 skill 目录的 `.commit-trailer`（本机私有、不分发）→ 空。

    🔴 不写死模型名。写死的问题不是「措辞不好看」：模型名随版本变，改一次脚本就永久把
    一个**跟当前会话不符**的名字写进公开仓库历史（本仓库历史里 6 次提交都是同一个旧名）。
    要用署名就自己配一条（值就是整行，如 `Co-Authored-By: X <x@example.com>`）；
    没配就不加这行 —— 宁可没有署名，也不要写一个假的名字。
    """
    t = (os.environ.get("SKILLS_COMMIT_TRAILER") or "").strip()
    if not t:
        try:
            # utf-8-sig：PowerShell 5.1 的 `Set-Content -Encoding utf8` 会带 BOM，
            # 不剥掉的话 BOM 会混进提交消息里。
            t = TRAILER_FILE.read_text(encoding="utf-8-sig").strip()
        except OSError:
            t = ""
    return t


def commit_repo(repo: Path, skills) -> None:
    """只提交本次分发涉及的 skill 目录（commit -- <paths>），不碰仓库里的其他改动。永不 push。"""
    paths = list(skills)
    subprocess.run(["git", "-C", str(repo), "add", "-A", "--", *paths], check=True)
    status = subprocess.run(["git", "-C", str(repo), "status", "--porcelain", "--", *paths],
                            check=True, capture_output=True, text=True).stdout.strip()
    if not status:
        print(f"\n{repo}：分发后无改动，不提交")
        return
    trailer = commit_trailer()
    msg = f"Distribute skills from ~/.claude/skills: {', '.join(paths)}" + (f"\n\n{trailer}" if trailer else "")
    subprocess.run(["git", "-C", str(repo), "commit", "-q", "-m", msg, "--", *paths], check=True)
    head = subprocess.run(["git", "-C", str(repo), "log", "-1", "--oneline"],
                          check=True, capture_output=True, text=True).stdout.strip()
    print(f"\n{repo}：已本地提交（未 push）：{head}")
    if trailer:
        print(f"  署名行：{trailer}")
    else:
        print(f"  未加署名行（想加就设 SKILLS_COMMIT_TRAILER，或把整行写进 {TRAILER_FILE}）")


def skill_files(skill_dir: Path):
    for p in skill_dir.rglob("*"):
        if p.is_file() and "__pycache__" not in p.parts and p.name not in LOCAL_ONLY:
            yield p


def main() -> int:
    # Windows 控制台默认 cp1252/GBK，打印中文会 UnicodeEncodeError；统一按 UTF-8 输出
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skill", action="append", default=[],
                    help=f"要分发的 skill 名，可多次；默认 {' + '.join(DEFAULT_SKILLS)}")
    ap.add_argument("--src", type=Path, default=Path(__file__).resolve().parents[2],
                    help="源 skills 目录（默认本脚本所在 skill 的上级目录）")
    ap.add_argument("--home", type=Path, default=Path.home(), help="搜索根目录（默认用户目录）")
    ap.add_argument("--exclude", action="append", default=[], help="额外排除的目标 glob，可多次")
    ap.add_argument("--all-targets", action="store_true",
                    help="忽略 targets.txt 白名单，按旧规则扫描全部装过 skill 的目录")
    ap.add_argument("--dry-run", action="store_true", help="只列目标与冲突，不复制")
    ap.add_argument("--force", action="store_true",
                    help="目标在上次分发后被别处改过也照样覆盖（先确认那些改动不要了；新增文件仍不删）")
    ap.add_argument("--include-repos", action="store_true",
                    help="同时更新 IdeaProjects 各仓库内的 skill 副本（备份目录 IdeaProjects/skills* 仍排除）")
    ap.add_argument("--include-skills-repo", action=argparse.BooleanOptionalAction, default=True,
                    help="是否更新 IdeaProjects/skills 本仓库（默认开；--no-include-skills-repo 关掉；skills - Copy 等备份仍排除）")
    ap.add_argument("--prune", action="store_true",
                    help="复制全部成功（MD5 0 不一致）后删除残留文件（源里没有、目标里还有的）。先不带本参数跑一次看清单，确认后再加")
    ap.add_argument("--commit-skills-repo", action="store_true",
                    help="分发后在 IdeaProjects/skills 里本地 commit 本次分发的 skill（依赖默认开启的 include-skills-repo；永不 push）")
    args = ap.parse_args()
    if args.commit_skills_repo and not args.include_skills_repo:
        ap.error("--commit-skills-repo 需要 include-skills-repo（默认已开；勿同时传 --no-include-skills-repo）")

    skills = tuple(args.skill) or DEFAULT_SKILLS
    for s in skills:
        if not (args.src / s / "SKILL.md").exists():
            sys.exit(f"源目录缺少 {s}/SKILL.md：{args.src}")

    excludes = list(ALWAYS_EXCLUDES) + ([] if args.include_repos else list(REPO_EXCLUDES)) + args.exclude
    allow = [SKILLS_REPO] if args.include_skills_repo else []
    globs = None if args.all_targets else load_allowlist()
    if globs is not None:
        targets = allowlisted_targets(args.home, args.src, globs, args.include_skills_repo)
        targets = [t for t in targets if not any(fnmatch.fnmatch(t.as_posix(), g) for g in args.exclude)]
        print(f"目标来源：白名单 {TARGETS_FILE.name}（{len(globs)} 条；--all-targets 改为全量扫描）")
    else:
        targets = find_targets(args.home, args.src, skills, excludes, allow)
        print("目标来源：全量扫描（装过任一待分发 skill 的 skills 目录）")
    print(f"源：{args.src}")
    print(f"分发：{', '.join(skills)}")
    print(f"目标 {len(targets)} 个：")
    for t in targets:
        print(f"  {t}")

    # 🔴 复制前检查：目标在上次分发之后被别处改过 → 不复制，交给用户决定
    state = load_state()
    conflicts = []
    for t in targets:
        for s in skills:
            conflicts += [(kind, p) for kind, p in find_conflicts(args.src / s, t / s, state.get(f"{t.as_posix()}|{s}"))]
    if conflicts:
        print(f"\n⚠️  {len(conflicts)} 个目标文件在上次分发之后被别处改过（改动 = 内容与源不同；新增 = 源里没有）：")
        for kind, p in conflicts[:60]:
            print(f"  [{kind}] {p}")
        if len(conflicts) > 60:
            print(f"  ...（其余 {len(conflicts) - 60} 个略）")
        if not args.force:
            print("\n未复制任何文件。要保留的改动先合回源 skill 再分发；确认不要就加 --force 覆盖（新增文件不会被删）。")
            return 3
        print("\n--force：照样覆盖上面的「改动」文件（「新增」文件保留不动）")
    if args.dry_run:
        return 0

    copied = bad = skipped_same = 0
    orphans = []
    for t in targets:
        for s in skills:
            src_dir, dst_dir = args.src / s, t / s
            # 目标是 junction 指回源（或同一物理目录）时，copyfile 会 SameFileError——已是最新，跳过
            try:
                if src_dir.resolve() == dst_dir.resolve():
                    for f in skill_files(src_dir):
                        skipped_same += 1
                    continue
            except OSError:
                pass
            expected = set()
            for f in skill_files(src_dir):
                rel = f.relative_to(src_dir)
                expected.add(rel)
                dst = dst_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                try:
                    if f.resolve() == dst.resolve():
                        skipped_same += 1
                        continue
                except OSError:
                    pass
                try:
                    shutil.copyfile(f, dst)
                except shutil.SameFileError:
                    skipped_same += 1
                    continue
                copied += 1
                if md5(f) != md5(dst):
                    bad += 1
                    print(f"MD5 不一致：{dst}")
            for f in skill_files(dst_dir):
                if f.relative_to(dst_dir) not in expected:
                    orphans.append(f)
    same_note = f"（另跳过同文件/junction {skipped_same} 个）" if skipped_same else ""
    print(f"复制 {copied} 个文件，MD5 不一致 {bad} 个{same_note}")
    if not bad:
        now = time.time()
        for t in targets:
            for s in skills:
                state[f"{t.as_posix()}|{s}"] = now
        save_state(state)
    if args.commit_skills_repo:
        if bad:
            print("MD5 不一致，跳过提交")
        for t in targets:
            if t.parent.name == "IdeaProjects" and t.name == "skills":
                commit_repo(t, skills)
    if orphans and args.prune and not bad and not args.dry_run:
        removed, failed = 0, []
        for f in orphans:
            try:
                f.unlink()
                removed += 1
                parent = f.parent
                while parent.name != "skills" and parent.exists() and not any(parent.iterdir()):
                    parent.rmdir()
                    parent = parent.parent
            except OSError as e:
                failed.append(f"{f}: {e}")
        print(f"\n已清理残留 {removed} 个，失败 {len(failed)} 个")
        for x in failed[:20]:
            print(f"  {x}")
        return 1 if failed else 0
    if orphans:
        print(f"\n残留 {len(orphans)} 个（源里没有、目标里还留着；默认不删。看过清单、确认可删后加 --prune 重跑）：")
        for f in orphans[:40]:
            print(f"  {f}")
        if len(orphans) > 40:
            print(f"  ...（其余 {len(orphans) - 40} 个略）")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
