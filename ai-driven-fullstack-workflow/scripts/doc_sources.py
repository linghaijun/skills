#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
需求源文档（PRD 等）的版本跟踪：登记 GitHub / Confluence 上的文档 → 拉最新版 → 与上次快照比对 →
有变化就存成新版本（v1、v2…，带上游版本号）并生成差异文件，交给 AI 做后续的影响分析。

落盘（需求目录下）：
  源文档/sources.json                    登记表：每个来源的链接、类型、版本列表、最后检查日期
  源文档/README.md                       索引：名称 / 类型 / 当前版本 / 上游版本 / 最后检查 / 变更记录
  源文档/<名称>/<文档标题>_v<N>_<日期>_<时分>_<上游版本>.md   每个版本的快照（原文，换行统一为 LF）
      文档标题：GitHub 取文件名，Confluence 取页面标题（add / ingest 的 --title 可改）；文件名非法字符换成 -
      时间：上游版本时间（GitHub 提交时间 / Confluence 页面版本时间，换成本机时区）；本地基线用文件修改时间
  源文档/<名称>/<文档标题>_差异_v<N-1>-v<N>.md                  相邻版本差异（统一 diff + 末尾影响分析）

同一文档的多个来源（如 GitHub 与 Confluence 各有一份）：
  add / group 时用 --group 归到同一组，并用 --canonical 指定需求目录里的「原文档」（如 PRD.md）。
  每次 check / ingest 后按各来源当前版本的上游时间（换成本机时区比较）选出最新的一份，
  写进原文档（文件首行注释写明来源 / 版本 / 上游时间）；最新来源切换时提示，附两边时间与正文相似度。
  原文档被手改过（内容与任何快照都对不上）时，覆盖前先备份到 源文档/_原文档备份/。
  组内不是最新的来源（镜像）的变更，verify 只给 WARN，不要求重复做影响分析。

两类来源：
  github      https://github.com/<owner>/<repo>/blob/<branch>/<path>
              脚本直接拉：本地缓存仓 ~/.cache/doc-sources/<owner>__<repo>（部分克隆，不检出文件），
              git fetch 后 `git show` 读内容，上游版本 = 该文件最近一次提交的短 SHA。用本机 git 凭据，不读令牌。
  confluence  https://<site>.atlassian.net/wiki/spaces/<space>/pages/<id>/...
              脚本不联网：AI 用 Atlassian MCP getConfluenceContent 读（先 detail=summary 看 version.number，
              有变化再 detail=full + content_format=markdown 取正文写到临时文件），再调 ingest 交给脚本存版本。

用法：
  py doc_sources.py add    --dir <需求目录> --url <链接> [--name 名称] [--title 文档标题] [--note 说明] [--start-version N] [--baseline 本地文件]
                           [--group 组名] [--canonical 原文档相对路径]
  py doc_sources.py check  --dir <需求目录> [--daily] [--source 名称]
  py doc_sources.py ingest --dir <需求目录> --source 名称 --upstream-version <版本号> [--file 正文文件] [--upstream-time 时间] [--title 页面标题]
  py doc_sources.py status --dir <需求目录>
  py doc_sources.py group  --dir <需求目录> --source 名称 --group 组名 [--canonical 原文档相对路径]   # 已登记的来源归组
  py doc_sources.py migrate --dir <需求目录>    # 老登记的快照 / 差异文件按当前命名规则改名（一次性，可重复跑）
  py doc_sources.py verify --dir <需求目录>     # 影响分析是否填完；「同步位置」里的文档是否都带了「需求变更 <名称> v<N>」标记

check 输出末行：`RESULT changed=<名称,...> pending=<名称:上次上游版本,...> unchanged=<...> errors=<...>`
  changed 有值 → 读对应 diff 文件做影响分析（references/doc-sources.md 第四节）
  pending 有值 → Confluence 来源，按上面说明用 MCP 读后调 ingest
  --daily：今天已检查过的来源直接跳过（每天第一次处理需求时调用，后续调用是空操作）
退出码：0 正常（不论有没有变化）；1 参数 / 登记错误；2 拉取失败（errors 有值）
"""
import argparse
import datetime as dt
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

DIR_NAME = "源文档"
# 受需求变更影响的步骤文档，在改动处必须带的标记（verify 按它检查）
MARK = "需求变更 {name} v{n}"
CACHE = Path.home() / ".cache" / "doc-sources"


# ---------------------------------------------------------------- 工具
def today():
    return dt.date.today().isoformat()


def now():
    return dt.datetime.now().isoformat(timespec="seconds")


def norm(text: str) -> str:
    """比对用的规范化：统一换行、去行尾空白、去首尾空行 —— 只因换行符 / 空白不同不算变更"""
    lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(lines).strip() + "\n"


def digest(text: str) -> str:
    return hashlib.sha256(norm(text).encode("utf-8")).hexdigest()[:16]


def local_time(iso: str) -> dt.datetime:
    """上游时间（ISO，带时区 / Z / 不带）→ 本机时区；解析不了返回现在"""
    try:
        # 不带时区的（拉取时间 / 本地文件时间）按本机时区算；一律返回带时区的时间，才能互相比较
        return dt.datetime.fromisoformat((iso or "").strip().replace("Z", "+00:00")).astimezone()
    except ValueError:
        return dt.datetime.now().astimezone()


def stamp(iso: str) -> str:
    """文件名里的时间：2026-10-13_0950"""
    return local_time(iso).strftime("%Y-%m-%d_%H%M")


def show_time(iso: str) -> str:
    return local_time(iso).strftime("%Y-%m-%d %H:%M") if iso else "—"


def similarity(a: str, b: str) -> int:
    """正文相似度（%）：去掉 Markdown 符号与空白后按字符比；Confluence 转换有损，只作参考，不用来判新旧"""
    strip = lambda s: re.sub(r"[#*|`>_\-\s]+", "", s)  # noqa: E731
    return round(difflib.SequenceMatcher(None, strip(a), strip(b), autojunk=False).ratio() * 100)


def title_part(s: str) -> str:
    """文件名里的文档标题：保留空格与中文，只把文件系统不允许的字符（含全角斜杠）换成 -"""
    s = re.sub(r'[\\/:*?"<>|\uFF0F\r\n\t]+', "-", s or "").strip(" .-")
    return s[:80] or "doc"


def doc_title(src) -> str:
    return title_part(src.get("title") or src["name"])


def snapshot_name(src, n, upstream, when) -> str:
    return f"{doc_title(src)}_v{n}_{stamp(when)}_{safe_name(upstream)}.md"


def diff_name(src, a, b) -> str:
    return f"{doc_title(src)}_差异_v{a}-v{b}.md"


def safe_name(s: str) -> str:
    s = re.sub(r'[\\/:*?"<>|\s]+', "-", s).strip("-")
    return s[:80] or "doc"


def parse_url(url: str):
    u = urllib.parse.urlparse(url.strip())
    if u.netloc == "github.com":
        m = re.match(r"^/([^/]+)/([^/]+)/blob/([^/]+)/(.+)$", u.path)
        if not m:
            sys.exit(f"GitHub 链接需形如 https://github.com/<owner>/<repo>/blob/<branch>/<path>：{url}")
        owner, repo, branch, path = m.groups()
        path = urllib.parse.unquote(path)
        return {"type": "github", "owner": owner, "repo": repo, "branch": branch, "path": path,
                "default_name": Path(path).stem, "title": Path(path).stem}
    if u.netloc.endswith("atlassian.net") and "/wiki/" in u.path:
        m = re.search(r"/pages/(\d+)(?:/([^/?#]+))?", u.path)
        if not m:
            sys.exit(f"Confluence 链接需含 /pages/<id>/：{url}")
        title = urllib.parse.unquote_plus(m.group(2) or m.group(1))
        return {"type": "confluence", "page_id": m.group(1), "site": u.netloc, "default_name": title, "title": title}
    sys.exit(f"只支持 GitHub（github.com/.../blob/...）和 Confluence（*.atlassian.net/wiki/...）链接：{url}")


# ---------------------------------------------------------------- 登记表
class Registry:
    def __init__(self, req_dir: str):
        self.req = Path(req_dir).resolve()
        if not self.req.is_dir():
            sys.exit(f"需求目录不存在：{self.req}")
        self.root = self.req / DIR_NAME
        self.file = self.root / "sources.json"
        self.data = json.loads(self.file.read_text(encoding="utf-8")) if self.file.exists() else {"sources": []}

    def find(self, name):
        return next((s for s in self.data["sources"] if s["name"] == name), None)

    def save(self):
        self.root.mkdir(parents=True, exist_ok=True)
        for line in self.sync_groups():
            print(line)
        self.file.write_text(json.dumps(self.data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        self.write_readme()

    def snapshot_text(self, src, ver) -> str:
        return (self.root / src["name"] / ver["file"]).read_text(encoding="utf-8")

    def sync_groups(self):
        """每组按当前版本的上游时间选最新来源，写进原文档；返回要打印的提示"""
        out = []
        groups = self.data.setdefault("groups", {})
        names = {s.get("group") for s in self.data["sources"] if s.get("group")}
        for g in sorted(names):
            info = groups.setdefault(g, {})
            members = [s for s in self.data["sources"] if s.get("group") == g and s["versions"]]
            if not members:
                continue
            cur = lambda s: s["versions"][-1]  # noqa: E731
            when = lambda s: local_time(cur(s).get("upstream_time") or cur(s)["fetched_at"])  # noqa: E731
            latest = max(members, key=when)
            lv = cur(latest)
            key = f"{latest['name']}#v{lv['n']}"
            others = [s for s in members if s is not latest]
            if others:
                text = self.snapshot_text(latest, lv)
                desc = "；".join(f"{s['name']} v{cur(s)['n']}（上游 {show_time(cur(s).get('upstream_time'))}，"
                                f"与最新相似度 {similarity(text, self.snapshot_text(s, cur(s)))}%）" for s in others)
                out.append(f"[同文档 {g}] 最新：{latest['name']} v{lv['n']}（上游 {show_time(lv.get('upstream_time'))}）；其他：{desc}")
            prev = info.get("latest")
            if prev and prev.split("#")[0] != latest["name"]:
                out.append(f"[最新来源切换] 组 {g}：{prev.split('#')[0]} → {latest['name']} —— 两边不一致，请确认以哪份为准、是否提醒产品同步另一边")
            canon = info.get("canonical")
            if canon and info.get("latest") != key:
                out.extend(self.write_canonical(g, info, latest, lv))
            info["latest"] = key
            info["latest_at"] = lv.get("upstream_time") or lv["fetched_at"]
        return out

    def write_canonical(self, g, info, src, ver):
        """最新版本写进原文档；原文档被手改过（与任何快照都不同）先备份"""
        path = self.req / info["canonical"]
        body = self.snapshot_text(src, ver)
        if path.exists():
            existing = path.read_text(encoding="utf-8")
            old_body = existing.split("\n", 1)[1] if existing.startswith("<!-- doc_sources") else existing
            known = {v["hash"] for s in self.data["sources"] for v in s["versions"]}
            if digest(old_body) not in known:
                bak = self.root / "_原文档备份" / f"{path.stem}_{dt.datetime.now().strftime('%Y-%m-%d_%H%M%S')}{path.suffix}"
                bak.parent.mkdir(parents=True, exist_ok=True)
                bak.write_text(existing, encoding="utf-8")
                yield f"[原文档备份] {info['canonical']} 有未入库的改动，已备份到 {DIR_NAME}/_原文档备份/{bak.name}"
        head = (f"<!-- doc_sources：组 {g} 的最新版本，来自 {src['name']} v{ver['n']}@{ver['upstream']}"
                f"（上游 {show_time(ver.get('upstream_time'))}，写入 {show_time(now())}）；勿手改，改动会在下次同步时被覆盖（覆盖前会备份） -->\n")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(head + body, encoding="utf-8")
        yield f"[原文档更新] {info['canonical']} ← {src['name']} v{ver['n']}@{ver['upstream']}（上游 {show_time(ver.get('upstream_time'))}）"

    def write_readme(self):
        rows = []
        for s in self.data["sources"]:
            cur = s["versions"][-1] if s["versions"] else None
            log = "；".join(f"v{v['n']} {v['upstream']}（上游 {show_time(v.get('upstream_time'))}，拉取 {show_time(v['fetched_at'])}）"
                           for v in s["versions"])
            rows.append(f"| {s['name']} | {s.get('group') or '—'} | {s['type']} | [链接]({s['url']}) | "
                        f"{('v' + str(cur['n']) + ' → ' + DIR_NAME + '/' + s['name'] + '/' + cur['file']) if cur else '—'} | "
                        f"{cur['upstream'] if cur else '—'} | {show_time(cur.get('upstream_time')) if cur else '—'} | "
                        f"{s.get('last_checked') or '—'} | {log or '—'} | {s.get('note') or ''} |")
        body = ["# 需求源文档", "",
                "> 由 `doc_sources.py` 维护，请勿手改表格；说明写在 `--note`。版本快照与差异见各来源子目录。", "",
                "| 名称 | 分组 | 类型 | 链接 | 当前版本 | 上游版本 | 上游时间 | 最后检查 | 版本记录 | 说明 |",
                "|---|---|---|---|---|---|---|---|---|---|", *rows, ""]
        groups = self.data.get("groups") or {}
        if groups:
            body += ["## 同一文档的多个来源", "", "| 分组 | 原文档 | 当前最新 | 上游时间 |", "|---|---|---|---|"]
            for g, info in sorted(groups.items()):
                body.append(f"| {g} | {info.get('canonical') or '（未指定）'} | {info.get('latest', '—').replace('#', ' ')} | "
                            f"{show_time(info.get('latest_at'))} |")
            body.append("")
        (self.root / "README.md").write_text("\n".join(body), encoding="utf-8")

    def record(self, src, content: str, upstream: str, upstream_time: str = "", author: str = "", message: str = ""):
        """内容与当前版本不同才落新版本；返回 (是否变化, 新版本或 None)"""
        src["last_checked"] = today()
        h = digest(content)
        cur = src["versions"][-1] if src["versions"] else None
        if cur and cur["hash"] == h:
            if cur["upstream"] != upstream:  # 上游有新提交 / 新版本号，但正文没变（如只改了别的文件、空编辑）
                cur.setdefault("same_content_upstreams", [])
                if upstream not in cur["same_content_upstreams"]:
                    cur["same_content_upstreams"].append(upstream)
            return False, None
        n = (cur["n"] + 1) if cur else src.get("start_version", 1)
        sub = self.root / src["name"]
        sub.mkdir(parents=True, exist_ok=True)
        fname = snapshot_name(src, n, upstream, upstream_time or now())
        (sub / fname).write_text(norm(content), encoding="utf-8")
        ver = {"n": n, "upstream": upstream, "upstream_time": upstream_time, "author": author, "message": message,
               "hash": h, "fetched_at": now(), "file": fname}
        if cur:
            old = (sub / cur["file"]).read_text(encoding="utf-8")
            diff = list(difflib.unified_diff(old.split("\n"), norm(content).split("\n"),
                                             f"v{cur['n']}@{cur['upstream']}", f"v{n}@{upstream}", n=2, lineterm=""))
            add = sum(1 for d in diff if d.startswith("+") and not d.startswith("+++"))
            rem = sum(1 for d in diff if d.startswith("-") and not d.startswith("---"))
            dname = diff_name(src, cur["n"], n)
            (sub / dname).write_text(
                f"# {src['name']}：v{cur['n']} → v{n}\n\n"
                f"- 上游：{cur['upstream']}（{show_time(cur.get('upstream_time'))}）→ {upstream}（{show_time(upstream_time)}{'，' + author if author else ''}）\n"
                f"- 拉取时间：{show_time(now())}\n"
                f"{'- 提交说明：' + message + chr(10) if message else ''}"
                f"- 规模：+{add} / -{rem} 行\n- 后续：按 references/doc-sources.md 第四节做影响分析，结论写进本文件末尾「影响分析」；"
                f"受影响的步骤文档在改动处标「{MARK.format(name=src['name'], n=n)}」并填进「同步位置」，最后跑 verify\n\n"
                "```diff\n" + "\n".join(diff) + "\n```\n\n## 影响分析\n\n"
                "| # | 改动 | 当前实现 / 流程产出 | 结论 | 同步位置 |\n|---|---|---|---|---|\n"
                "| 1 | （待填） |  | ✅ 一致 / ❌ 需新做 / ⚠️ 冲突需定 / — 纯文档 | 相对需求目录的文档路径，多个用 、 分隔；无则 — |\n",
                encoding="utf-8")
            ver["diff"] = dname
            ver["added"], ver["removed"] = add, rem
        src["versions"].append(ver)
        return True, ver


# ---------------------------------------------------------------- GitHub
def git(*args, cwd=None, check=True):
    base = ["git", "-c", "core.quotepath=false"]
    if os.name == "nt":  # 本机 ~/.gitconfig 的 credential.helper 可能指向已删的程序，单次覆盖为 GCM
        base += ["-c", "credential.helper=", "-c", "credential.helper=manager"]
    r = subprocess.run(base + (["-C", str(cwd)] if cwd else []) + list(args), capture_output=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:2])} 失败：{r.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return r.stdout


def fetch_github(src):
    repo_dir = CACHE / f"{src['owner']}__{src['repo']}"
    url = f"https://github.com/{src['owner']}/{src['repo']}"
    if not (repo_dir / ".git").exists():
        repo_dir.parent.mkdir(parents=True, exist_ok=True)
        git("clone", "--filter=blob:none", "--no-checkout", url, str(repo_dir))
    git("fetch", "--filter=blob:none", "origin", src["branch"], cwd=repo_dir)
    ref = f"origin/{src['branch']}"
    log = git("log", "-1", "--format=%h%x1f%cI%x1f%an%x1f%s", ref, "--", src["path"], cwd=repo_dir).decode("utf-8").strip()
    if not log:
        raise RuntimeError(f"分支 {src['branch']} 上找不到文件（可能被移动 / 改名）：{src['path']}")
    sha, ctime, author, msg = log.split("\x1f")
    content = git("show", f"{sha}:{src['path']}", cwd=repo_dir).decode("utf-8")
    return content, sha, ctime, author, msg


# ---------------------------------------------------------------- 子命令
def cmd_add(a):
    reg = Registry(a.dir)
    info = parse_url(a.url)
    name = safe_name(a.name or info.pop("default_name"))
    info.pop("default_name", None)
    if reg.find(name):
        sys.exit(f"已登记同名来源：{name}（换 --name）")
    if any(s["url"] == a.url.strip() for s in reg.data["sources"]):
        sys.exit("该链接已登记")
    if a.title:
        info["title"] = a.title
    if a.group:
        info["group"] = a.group
        if a.canonical:
            reg.data.setdefault("groups", {}).setdefault(a.group, {})["canonical"] = a.canonical
    src = {"name": name, "url": a.url.strip(), **info, "note": a.note or "", "start_version": a.start_version,
           "added_at": now(), "last_checked": None, "versions": []}
    reg.data["sources"].append(src)
    if a.baseline:
        # 用已有的本地文件当首个版本（如之前手动下载的 PRD），上游版本标为 local
        content = Path(a.baseline).read_text(encoding="utf-8")
        # 时间用本地文件的修改时间（代表这一版的大致时间），不用登记时间
        mtime = dt.datetime.fromtimestamp(Path(a.baseline).stat().st_mtime).astimezone().isoformat(timespec="seconds")
        reg.record(src, content, "local", mtime, message=f"基线：{Path(a.baseline).name}")
        src["last_checked"] = None  # 基线不算检查过，紧接着 check 会与上游比
    reg.save()
    print(f"已登记 {name}（{src['type']}）→ {reg.root / 'sources.json'}")
    if src["type"] == "github":
        print("下一步：py doc_sources.py check --dir <需求目录> 拉取首个版本")
    else:
        print("下一步：用 Atlassian MCP 读该页（见脚本头部说明），再 ingest")


def cmd_check(a):
    reg = Registry(a.dir)
    if not reg.data["sources"]:
        print("没有登记任何源文档（先 add）")
        print("RESULT changed= pending= unchanged= errors=")
        return 0
    changed, pending, unchanged, errors, skipped = [], [], [], [], []
    for src in reg.data["sources"]:
        if a.source and src["name"] != a.source:
            continue
        if a.daily and src.get("last_checked") == today():
            skipped.append(src["name"])
            continue
        cur = src["versions"][-1] if src["versions"] else None
        if src["type"] == "confluence":
            pending.append(f"{src['name']}:{cur['upstream'] if cur else '无'}")
            print(f"[待 MCP] {src['name']} page_id={src['page_id']} 上次上游版本={cur['upstream'] if cur else '无'}")
            continue
        try:
            content, sha, ctime, author, msg = fetch_github(src)
        except Exception as e:  # noqa: BLE001 —— 单个来源失败不影响其他来源
            errors.append(src["name"])
            print(f"[失败] {src['name']}：{e}")
            continue
        ok, ver = reg.record(src, content, sha, ctime, author, msg)
        if ok:
            changed.append(src["name"])
            where = f"，差异：{DIR_NAME}/{src['name']}/{ver['diff']}" if ver.get("diff") else "（首个版本）"
            print(f"[变更] {src['name']} → v{ver['n']}@{sha}（{ctime} {author}：{msg}）{where}")
        else:
            unchanged.append(src["name"])
            print(f"[未变] {src['name']} v{cur['n']}@{cur['upstream']}（上游最新提交 {sha}）")
    reg.save()
    if skipped:
        print(f"[今日已检查，跳过] {', '.join(skipped)}")
    print(f"RESULT changed={','.join(changed)} pending={','.join(pending)} unchanged={','.join(unchanged)} errors={','.join(errors)}")
    return 2 if errors else 0


def cmd_ingest(a):
    reg = Registry(a.dir)
    src = reg.find(a.source)
    if not src:
        sys.exit(f"未登记：{a.source}")
    if a.title and a.title != src.get("title"):
        src["title"] = a.title  # 已有版本的文件名不动，跑 migrate 才统一改名
    cur = src["versions"][-1] if src["versions"] else None
    up = str(a.upstream_version)
    if not a.file:
        # 只报了上游版本号：与上次相同 = 未变；不同则必须给正文
        if cur and up in [cur["upstream"], *cur.get("same_content_upstreams", [])]:
            src["last_checked"] = today()
            reg.save()
            print(f"[未变] {src['name']} 上游版本 {up}")
            print(f"RESULT changed= pending= unchanged={src['name']} errors=")
            return 0
        sys.exit(f"上游版本 {up} 与记录（{cur['upstream'] if cur else '无'}）不同，需用 --file 提供正文")
    content = Path(a.file).read_text(encoding="utf-8")
    ok, ver = reg.record(src, content, up, a.upstream_time or "", a.author or "", a.message or "")
    reg.save()
    if ok:
        where = f"，差异：{DIR_NAME}/{src['name']}/{ver['diff']}" if ver.get("diff") else "（首个版本）"
        print(f"[变更] {src['name']} → v{ver['n']}@{up}{where}")
        print(f"RESULT changed={src['name']} pending= unchanged= errors=")
    else:
        print(f"[未变] {src['name']} 正文与 v{cur['n']} 相同（上游版本 {up}）")
        print(f"RESULT changed= pending= unchanged={src['name']} errors=")
    return 0


def cmd_status(a):
    reg = Registry(a.dir)
    if not reg.data["sources"]:
        print("没有登记任何源文档")
        return 0
    for s in reg.data["sources"]:
        cur = s["versions"][-1] if s["versions"] else None
        stale = "" if s.get("last_checked") == today() else "  ← 今日未检查"
        print(f"{s['name']} [{s['type']}] 当前 {('v' + str(cur['n']) + '@' + cur['upstream']) if cur else '无版本'}"
              f"，最后检查 {s.get('last_checked') or '从未'}{stale}")
    return 0


def parse_impact(diff_text: str):
    """差异文件末尾「影响分析」表 → [(序号, 改动, 结论, [同步位置...])]；只认 5 列及以上的数据行"""
    sec = diff_text.split("## 影响分析", 1)
    rows = []
    if len(sec) < 2:
        return rows
    for line in sec[1].splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) < 5 or cells[0] == "#" or set(cells[0]) <= set("-: "):
            continue
        places = [x.strip().strip("`").strip() for x in re.split(r"、|<br>|；|;|，", cells[4])]
        places = [x for x in places if x and x not in ("—", "-", "无") and not x.startswith("相对需求目录")]
        rows.append((cells[0], cells[1], cells[3], places))
    return rows


def cmd_migrate(a):
    """老登记的快照 / 差异文件按当前命名规则改名（文件内容不动；引用了旧差异路径的文档需自行更新）"""
    reg = Registry(a.dir)
    n = 0
    for s in reg.data["sources"]:
        prev = None
        for v in s["versions"]:
            wants = [("file", snapshot_name(s, v["n"], v["upstream"], v.get("upstream_time") or v["fetched_at"]))]
            if v.get("diff") and prev:
                wants.append(("diff", diff_name(s, prev["n"], v["n"])))
            for key, want in wants:
                if v[key] == want:
                    continue
                old, new = reg.root / s["name"] / v[key], reg.root / s["name"] / want
                if old.exists():
                    old.rename(new)
                print(f"{s['name']}：{v[key]} → {want}")
                v[key] = want
                n += 1
            prev = v
    reg.save()
    print(f"改名 {n} 个")
    return 0


def cmd_group(a):
    reg = Registry(a.dir)
    src = reg.find(a.source)
    if not src:
        sys.exit(f"未登记：{a.source}")
    src["group"] = a.group
    if a.canonical:
        reg.data.setdefault("groups", {}).setdefault(a.group, {})["canonical"] = a.canonical
        reg.data["groups"][a.group].pop("latest", None)  # 换了原文档：下次 save 重新写入
    reg.save()
    print(f"{src['name']} → 组 {a.group}" + (f"，原文档 {a.canonical}" if a.canonical else ""))
    return 0


def cmd_verify(a):
    """影响分析是否填完；❌ / ⚠️ 条目是否写了同步位置；同步位置里的文档是否都带了标记。FAIL 退出码 1"""
    reg = Registry(a.dir)
    fails, warns, ok = [], [], 0
    for s in reg.data["sources"]:
        legacy = any(k in (s.get("note") or "") for k in ("老版本", "历史"))
        # 同组里不是最新的来源（镜像）：影响分析以最新来源为准，这边只提示
        g = (reg.data.get("groups") or {}).get(s.get("group") or "", {})
        legacy = legacy or bool(s.get("group") and g.get("latest", "").split("#")[0] not in ("", s["name"]))
        for v in s["versions"]:
            if not v.get("diff"):
                continue
            label = f"{s['name']} v{v['n']}"
            f = reg.root / s["name"] / v["diff"]
            if not f.exists():
                fails.append(f"{label}：差异文件缺失 {v['diff']}")
                continue
            rows = parse_impact(f.read_text(encoding="utf-8"))
            if not rows or any("待填" in r[1] for r in rows):
                # 老版本 / 历史对照的来源只提示，不拦
                (warns if legacy else fails).append(f"{label}：影响分析未填（{DIR_NAME}/{s['name']}/{v['diff']}）")
                continue
            mark = MARK.format(name=s["name"], n=v["n"])
            for no, change, verdict, places in rows:
                if ("❌" in verdict or "⚠" in verdict) and not places:
                    fails.append(f"{label} #{no}「{change[:30]}」结论为 {verdict}，但没写同步位置")
                for pl in places:
                    doc = reg.req / pl
                    if not doc.exists():
                        fails.append(f"{label} #{no}：同步位置不存在 {pl}")
                    elif mark not in doc.read_text(encoding="utf-8", errors="replace"):
                        fails.append(f"{label} #{no}：{pl} 里没有标记「{mark}」")
                    else:
                        ok += 1
    for w in warns:
        print(f"⚠️  {w}")
    for x in fails:
        print(f"❌ {x}")
    print(f"{'✅ 通过' if not fails else '❌ 未通过'}：已标注 {ok} 处，FAIL {len(fails)}，WARN {len(warns)}")
    return 1 if fails else 0


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="需求源文档版本跟踪（GitHub / Confluence）")
    sp = p.add_subparsers(dest="cmd", required=True)
    x = sp.add_parser("add")
    x.add_argument("--dir", required=True)
    x.add_argument("--url", required=True)
    x.add_argument("--name")
    x.add_argument("--title", help="文档标题（快照文件名的开头）；默认 GitHub 取文件名、Confluence 取 URL 里的页面名")
    x.add_argument("--note")
    x.add_argument("--start-version", type=int, default=1, help="首个版本号，与已有的本地手动版本衔接（如已有 -v2.md 就填 2）")
    x.add_argument("--baseline", help="已有本地文件作为首个版本（上游版本记为 local）")
    x.add_argument("--group", help="同一文档的多个来源用同一组名")
    x.add_argument("--canonical", help="该组的原文档（相对需求目录），最新版本写进这里")
    x = sp.add_parser("check")
    x.add_argument("--dir", required=True)
    x.add_argument("--daily", action="store_true")
    x.add_argument("--source")
    x = sp.add_parser("ingest")
    x.add_argument("--dir", required=True)
    x.add_argument("--source", required=True)
    x.add_argument("--upstream-version", required=True)
    x.add_argument("--file")
    x.add_argument("--upstream-time")
    x.add_argument("--author")
    x.add_argument("--message")
    x.add_argument("--title", help="页面真实标题（MCP 返回的 title），更新登记里的文档标题")
    x = sp.add_parser("status")
    x.add_argument("--dir", required=True)
    x = sp.add_parser("verify")
    x.add_argument("--dir", required=True)
    x = sp.add_parser("group")
    x.add_argument("--dir", required=True)
    x.add_argument("--source", required=True)
    x.add_argument("--group", required=True)
    x.add_argument("--canonical")
    x = sp.add_parser("migrate")
    x.add_argument("--dir", required=True)
    a = p.parse_args()
    return {"add": cmd_add, "check": cmd_check, "ingest": cmd_ingest, "status": cmd_status, "verify": cmd_verify,
            "migrate": cmd_migrate, "group": cmd_group}[a.cmd](a) or 0


if __name__ == "__main__":
    sys.exit(main())
