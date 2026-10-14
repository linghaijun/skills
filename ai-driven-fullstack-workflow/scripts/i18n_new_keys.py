"""Step13 末尾：整理本需求前端新增的多语言 key，生成《Step 13-多语言新增key清单.md》骨架。

用法：
    python i18n_new_keys.py --repo <前端 git 仓库> --base <分支起点 commit / ref> \
        --langs <翻译库目录，可多次> --out <需求目录>/Step 13-多语言新增key清单.md [--locales en,zh_CN,ja]

例（creative-management-all）：
    python i18n_new_keys.py --repo vuen-crossretail/packages/creativehub --base 91e9f8c \
        --langs vuen-crossretail/packages/langs --langs vuen-crossretail/packages/langsCommon \
        --out "creative-management/docs/develop/<需求目录>/Step 13-多语言新增key清单.md"

做什么：
  1. 取 `git diff <base> HEAD`（只看 .vue/.js/.ts）新增行里的 `$t("...")` / `$t('...')`，排除 base 里已经在用的 key
  2. 逐个查 <langs>/*/<locale>.json（不含 backup 目录）：三种语言是否都有
  3. 线上翻译库没有的**编码 key**（如 cmcMid99，可能只在 backup 目录）单独列出 —— 页面会直接显示编码本身，属于缺陷，退出码 2
  4. 列出本分支删掉、HEAD 里已不再使用的 key（供本地化评估下线）
输出的「建议中文 / 建议日文 / 备注」列留空，由 agent 补建议译文（标明仅供参考）。
翻译库通常是 localization 仓库的 subtree，前端不手改，补词在 localization 仓库做。
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

KEY_RE = re.compile(r"""\$t\(\s*(["'`])((?:\\.|(?!\1).)+?)\1""")
EXTS = ("*.vue", "*.js", "*.ts", "*.jsx", "*.tsx")
# 编码风格 key：字母前缀 + 数字（CreativeHub70 / cmcMid99 / date86），区别于直接用英文原文当 key
CODE_KEY_RE = re.compile(r"[A-Za-z]+(?:key)?\d+")


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", check=True).stdout


def used_keys(repo: Path, ref: str | None) -> set[str]:
    args = ["grep", "-h", "-oE", r"\$t\(\s*[\"'][^\"']+[\"']"] + ([ref] if ref else []) + ["--", *EXTS]
    try:
        out = git(repo, *args)
    except subprocess.CalledProcessError:
        return set()
    return {re.sub(r"^\$t\(\s*[\"']|[\"']$", "", x) for x in out.splitlines()}


def load_locale(dirs: list[Path], locale: str, backup: bool) -> dict[str, str]:
    m: dict[str, str] = {}
    for d in dirs:
        for f in d.rglob(f"{locale}.json"):
            if ("backup" in f.parts) != backup:
                continue
            try:
                m.update(json.loads(f.read_text(encoding="utf-8")))
            except (OSError, ValueError) as e:
                print(f"[warn] 读不了 {f}: {e}", file=sys.stderr)
    return m


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True, type=Path)
    ap.add_argument("--base", required=True, help="本需求分支的起点（merge-base / 合入点 commit）")
    ap.add_argument("--langs", required=True, action="append", type=Path, help="翻译库目录，可多次")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--locales", default="en,zh_CN,ja")
    a = ap.parse_args()
    locales = [x.strip() for x in a.locales.split(",") if x.strip()]

    diff = git(a.repo, "diff", a.base, "HEAD", "-U0", "--", *EXTS)
    added, removed, where, cur = set(), set(), defaultdict(set), ""
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            cur = line[6:]
        elif line.startswith("+") and not line.startswith("+++"):
            for m in KEY_RE.finditer(line):
                added.add(m.group(2))
                where[m.group(2)].add(cur.split("/")[-1])
        elif line.startswith("-") and not line.startswith("---"):
            removed |= {m.group(2) for m in KEY_RE.finditer(line)}
    base_keys, head_keys = used_keys(a.repo, a.base), used_keys(a.repo, None)
    new = sorted(k for k in added if k not in base_keys and "${" not in k)
    gone = sorted(k for k in removed if k not in head_keys and "${" not in k)

    live = {loc: load_locale(a.langs, loc, backup=False) for loc in locales}
    bak = {loc: load_locale(a.langs, loc, backup=True) for loc in locales}
    missing, ready, backup_only = [], [], []
    for k in new:
        have = [loc for loc in locales if live[loc].get(k)]
        if len(have) == len(locales):
            ready.append(k)
        elif CODE_KEY_RE.fullmatch(k) and not have:
            # 编码 key（如 cmcMid99）线上没有 → 页面直接显示编码本身；英文原文 key 缺翻译只会显示英文，归入第 1 节
            backup_only.append(k)
        else:
            missing.append((k, have))

    L = [f"# 多语言新增 key 清单（交本地化）", "",
         f"> 生成：{datetime.date.today()}｜脚本 `i18n_new_keys.py`｜仓库 `{a.repo.as_posix()}`｜范围 `{a.base}..HEAD` 新出现的 `$t()`",
         f"> 翻译库：{', '.join(p.as_posix() for p in a.langs)}（不含 backup 目录）｜语言：{', '.join(locales)}",
         "> 「建议中文 / 建议日文」由 agent 补，仅供本地化参考；翻译库是 subtree 的，补词在 localization 仓库做，前端不手改。", ""]
    L += [f"## 1. 需要补翻译的 key（{len(missing)} 个）", "",
          "未补之前，缺的语言会直接显示 key 原文（英文 key 显示英文；编码 key 显示编码本身）。", "",
          "| # | key | 已有语言 | 出现位置 | 建议中文 | 建议日文 | 备注 |", "|---|---|---|---|---|---|---|"]
    L += [f"| {i} | `{k}` | {', '.join(h) or '无'} | {'、'.join(sorted(where[k]))} |  |  |  |" for i, (k, h) in enumerate(missing, 1)]
    if not missing:
        L.append("| - | 无新增 | | | | | |")
    L += ["", f"## 2. 已就绪（{len(ready)} 个）", ""] + [f"- `{k}`（{'、'.join(sorted(where[k]))}）" for k in ready] + (["- 无"] if not ready else [])
    L += ["", f"## 3. 🔴 线上翻译库没有的编码 key（{len(backup_only)} 个，页面会直接显示编码本身，需改用已上线的 key）", ""]
    L += [f"- `{k}`（{'、'.join(sorted(where[k]))}）" + (f"：只在 backup 目录有，原文「{next(bak[l][k] for l in locales if bak[l].get(k))}」" if any(bak[l].get(k) for l in locales) else "：翻译库里找不到") for k in backup_only] or ["- 无"]
    L += ["", f"## 4. 本分支不再使用的 key（{len(gone)} 个，供本地化评估下线，前端不处理）", ""]
    L += [f"- `{k}`：{live[locales[0]].get(k, '（翻译库本来就没有）')}" for k in gone] or ["- 无"]
    L += ["", "## 5. 风险提示（agent 补）", "", "- 替换了原本已翻译 key 的地方（补词前中 / 日文会退回英文）：", ""]
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text("\n".join(L), encoding="utf-8")
    print(f"新增 {len(new)}：缺翻译 {len(missing)} / 已就绪 {len(ready)} / 仅 backup {len(backup_only)}；不再使用 {len(gone)} → {a.out}")
    return 2 if backup_only else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
