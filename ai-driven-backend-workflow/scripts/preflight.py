#!/usr/bin/env python
"""开跑前的环境体检。只用标准库。

为什么需要它：原流程的环境冒烟在 Step 11.4，跑完 10 步才发现环境不通，前面的
产出全部作废。本脚本在 Step 1 之前跑一次，把「撞上才知道」的坑提前暴露。

用法:
    py preflight.py                    # 全量检查
    py preflight.py --skip db,browser  # 跳过某些组
    py preflight.py --json             # 机器可读输出

退出码: 0=可以开工; 1=有 BLOCK 项，必须先修
WARN 项不阻塞，但会打印出来，Agent 应在 Spec 里记一笔。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

BLOCK, WARN, OK, SKIP = "BLOCK", "WARN", "OK", "SKIP"

results: list[tuple[str, str, str, str]] = []  # (group, name, status, detail)


def record(group: str, name: str, status: str, detail: str = "") -> None:
    results.append((group, name, status, detail))


def _run(cmd: list[str], timeout: int = 60) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           errors="replace")
        return p.returncode, (p.stdout + p.stderr).strip()
    except FileNotFoundError:
        return 127, "命令不存在"
    except subprocess.TimeoutExpired:
        return 124, f"超时 {timeout}s"
    except OSError as e:
        return 1, str(e)


# ------------------------------------------------------------------ 工具链

def check_java() -> None:
    java_home = os.environ.get("JAVA_HOME", "")
    if not java_home:
        record("toolchain", "JAVA_HOME", WARN, "未设置；Git Bash 里必须用 POSIX 路径")
    else:
        record("toolchain", "JAVA_HOME", OK, java_home)

    exe = shutil.which("java") or (str(Path(java_home) / "bin" / "java") if java_home else "java")
    code, out = _run([exe, "-version"])
    if code != 0:
        record("toolchain", "java", BLOCK, f"无法执行: {out[:120]}")
        return
    line = out.splitlines()[0] if out else ""
    if '"17' in line or " 17." in line:
        record("toolchain", "java 版本", OK, line)
    else:
        record("toolchain", "java 版本", BLOCK,
               f"需要 JDK 17（JDK 21 会因 Lombok 1.18.22 编译失败），实际: {line}")


def check_maven(project: Path) -> None:
    mvnw = project / ("mvnw.cmd" if os.name == "nt" else "mvnw")
    if mvnw.exists():
        record("toolchain", "maven wrapper", OK, str(mvnw))
        return
    mvn = shutil.which("mvn") or shutil.which("mvn.cmd")
    if mvn:
        record("toolchain", "maven", OK, mvn)
    else:
        record("toolchain", "maven", WARN, "未找到 mvnw 或 mvn；后端构建步骤会失败")


def check_node() -> None:
    for tool in ("node", "pnpm"):
        path = shutil.which(tool)
        if path:
            code, out = _run([path, "--version"])
            record("toolchain", tool, OK if code == 0 else WARN, out.splitlines()[0] if out else "")
        else:
            record("toolchain", tool, WARN, "未找到；前端步骤会失败")


def check_python() -> None:
    """解释器可用性：**真的跑一遍文档会用的调用形式**。

    Windows 商店版 `python.exe` 是个假别名：`shutil.which` 找得到、执行却直接失败
    （2026-10-14 实测本机 `python -V` → "Program 'python.exe' failed to run"）。
    旧实现只 record 了"正在跑这个脚本的解释器"版本 → preflight 报绿，而照文档敲的每条
    命令都失败，且 compact hook 是静默失败的（文档命令与 hook 都写 `python ...`）。
    所以这里逐个真跑 python / python3 / py，并对比文档实际写的是哪个。
    """
    record("toolchain", "当前解释器", OK, f"{sys.executable} ({sys.version.split()[0]})")
    usable, broken = [], []
    for cmd in ("python", "python3", "py"):
        exe = shutil.which(cmd)
        if not exe:
            continue
        code, out = _run([exe, "-V"], timeout=20)
        (usable if (code == 0 and out) else broken).append(cmd)
    if not usable:
        record("toolchain", "文档命令用的解释器", BLOCK,
               f"python / python3 / py 都跑不起来（{broken}），但文档命令与 hook 都写 `python scripts/...`："
               "先修 PATH，再开工")
    elif "python" in usable:
        record("toolchain", "文档命令用的解释器", OK,
               "python → " + _run([shutil.which("python"), "-V"])[1].splitlines()[0])
    else:
        record("toolchain", "文档命令用的解释器", WARN,
               f"`python` 在本机跑不起来（{broken or '未安装'}），可用的是 {' / '.join(usable)} —— "
               f"文档示例与 hook 里的解释器要用 `{usable[0]}`，否则每条命令都失败、且 hook 静默失效")
    # Windows 控制台默认 cp1252，打印中文会 UnicodeEncodeError
    enc = (sys.stdout.encoding or "").lower()
    if os.name == "nt" and enc not in ("utf-8", "utf8"):
        record("toolchain", "控制台编码", WARN,
               f"{enc}；脚本打印中文会 UnicodeEncodeError，需 reconfigure 成 utf-8")


# ------------------------------------------------------------------ 仓库

def check_repos(project: Path) -> None:
    if not (project / ".git").exists():
        record("repo", "git 仓库", WARN, f"{project} 不是 git 仓库（多仓结构下可能正常）")
        return
    code, out = _run(["git", "-C", str(project), "status", "--porcelain"])
    if code != 0:
        record("repo", "git status", BLOCK, out[:150])
        return
    dirty = [l for l in out.splitlines() if l.strip()]
    record("repo", "工作区", OK if not dirty else WARN,
           "干净" if not dirty else f"{len(dirty)} 个未提交改动（流程要求 Step13 前不提交，先确认这些是别的改动）")

    code, branch = _run(["git", "-C", str(project), "branch", "--show-current"])
    record("repo", "当前分支", OK, branch)


def check_docs_dir(project: Path) -> None:
    """在**已存在**的 docs/develop 上做写探针。

    原来无条件 `mkdir(parents=True)`：从错的仓根跑（`--project` 默认 `.`）会凭空建出一棵
    `docs/develop`，之后需求目录就建在那里 —— 本机实测同一个工作区出现过两棵 docs/develop。
    目录不存在时不再是「创建」，而是提醒确认 `--project` 指向的是不是后端仓根；
    真正创建需求目录是拿到 Jira 号后 `init_workdir.py` 的事。
    """
    d = project / "docs" / "develop"
    if not d.is_dir():
        record("docs", "docs/develop", WARN,
               f"{d} 不存在 —— 确认 --project 是否指向后端仓根；"
               "preflight 不再代建（免得建在错的仓），拿到 Jira 号后由 init_workdir.py 创建")
        return
    try:
        probe = d / ".preflight-write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        record("docs", "docs/develop 可写", OK, str(d))
    except OSError as e:
        record("docs", "docs/develop 可写", BLOCK, str(e))


# ------------------------------------------------------------------ 数据库

def check_db(project: Path) -> None:
    """只在 sql-mcp 存在时检查；不存在算 SKIP，不是错误。"""
    candidates = [project.parent / "sql-mcp", Path.home() / "IdeaProjects" / "sql-mcp"]
    root = next((c for c in candidates if (c / "query.py").exists()), None)
    if root is None:
        record("db", "sql-mcp", SKIP, "未找到 query.py，跳过数据库检查")
        return

    py = root / ".venvs" / "query" / ("Scripts" if os.name == "nt" else "bin") / \
        ("python.exe" if os.name == "nt" else "python")
    if not py.exists():
        record("db", "query venv", WARN, f"缺 {py}；数据核对（Step11.5）不可用")
        return

    code, out = _run([str(py), str(root / "query.py"), "mysql", "SELECT 1"], timeout=90)
    record("db", "mysql 连通", OK if code == 0 else WARN,
           "可连" if code == 0 else out.splitlines()[-1][:150] if out else "失败")


# ------------------------------------------------------------------ 浏览器

def check_browser(project: Path) -> None:
    launch = project / ".claude" / "launch.json"
    if launch.exists():
        record("browser", "launch.json", OK, str(launch))
    else:
        record("browser", "launch.json", WARN,
               "缺失；Step11.4 实机验证要先配 dev server 启动项")


# ------------------------------------------------------------------ 主流程

GROUPS = {
    "toolchain": lambda p: (check_java(), check_maven(p), check_node(), check_python()),
    "repo": check_repos,
    "docs": check_docs_dir,
    "db": check_db,
    "browser": check_browser,
}


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="开发流程环境体检")
    ap.add_argument("--project", default=".", help="项目根目录")
    ap.add_argument("--skip", default="", help="跳过的组，逗号分隔: toolchain,repo,docs,db,browser")
    ap.add_argument("--json", action="store_true", help="机器可读输出")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    skip = {s.strip() for s in args.skip.split(",") if s.strip()}

    for name, fn in GROUPS.items():
        if name in skip:
            record(name, "(整组)", SKIP, "--skip 指定")
            continue
        try:
            fn(project)
        except Exception as e:                      # noqa: BLE001 - 体检不该因单项炸掉
            record(name, "(执行异常)", WARN, f"{type(e).__name__}: {e}")

    blocks = [r for r in results if r[2] == BLOCK]
    warns = [r for r in results if r[2] == WARN]

    if args.json:
        print(json.dumps({
            "project": str(project),
            "ok": not blocks,
            "results": [{"group": g, "name": n, "status": s, "detail": d}
                        for g, n, s, d in results],
        }, ensure_ascii=False, indent=2))
    else:
        print(f"环境体检 @ {project}\n")
        icon = {OK: "✅", WARN: "⚠️ ", BLOCK: "❌", SKIP: "－"}
        for g, n, s, d in results:
            print(f"  {icon[s]} [{g}] {n}{'  ' + d if d else ''}")
        print()
        if blocks:
            print(f"❌ {len(blocks)} 项阻塞，必须先修再开工：")
            for g, n, _, d in blocks:
                print(f"   - [{g}] {n}: {d}")
        elif warns:
            print(f"✅ 无阻塞项，可以开工（{len(warns)} 项警告，建议在 Spec 里记一笔）")
        else:
            print("✅ 全部通过，可以开工")

    raise SystemExit(1 if blocks else 0)


if __name__ == "__main__":
    main()
