#!/usr/bin/env python3
"""
Figma 设计稿缓存：把 Figma 链接里的节点读下来，落到需求目录 figma/<节点>/，供 Step1 / Step7 / Step10 反复对照。

每个节点：
  screenshot.png  2x 截图（REST /v1/images）
  design.md       层级结构 + 文案 + 色值 / 描边 / 圆角 / 字号 / auto-layout 间距 + 用到的组件
  node.json       原始节点数据（需要精确值时查它）
总索引 figma/README.md：节点 → 名称 → 区域 → 对应 AC → 摘要链接，外加「关键样式」「与文档的差异」两段骨架。
重跑时保留索引里已人工填写的「区域 / 对应 AC」两列与后面两段内容，只刷新节点数据。

令牌：环境变量 FIGMA_API_KEY（或 FIGMA_TOKEN），Figma 个人访问令牌。只读取，不打印、不落盘。
不依赖 figma MCP 插件：插件常处于 needs_auth，有令牌时直接走 REST API。

用法：
  python figma_cache.py --dir "docs/develop/<需求目录>" --urls "<figma 链接1>" "<figma 链接2>" ...
  python figma_cache.py --dir "..." --urls-file links.txt      # 每行一个链接
  python figma_cache.py --dir "..." --refresh                  # 按索引里已有节点重拉
"""
import argparse, json, os, pathlib, re, sys, time, urllib.error, urllib.parse, urllib.request

API = "https://api.figma.com/v1"


def token():
    t = os.environ.get("FIGMA_API_KEY") or os.environ.get("FIGMA_TOKEN") or ""
    if not t:
        sys.exit("未找到 Figma 令牌：请设置环境变量 FIGMA_API_KEY（Figma > Settings > Personal access tokens）")
    return t


def get(url, tok, raw=False, tries=4):
    for i in range(tries):
        req = urllib.request.Request(url, headers={} if raw else {"X-Figma-Token": tok})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
                return data if raw else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < tries - 1:
                time.sleep(int(e.headers.get("Retry-After", "10")))
                continue
            sys.exit(f"HTTP {e.code} {url.split('?')[0]}: {e.read()[:300]!r}")
        except urllib.error.URLError as e:
            if i < tries - 1:
                time.sleep(3)
                continue
            sys.exit(f"网络错误 {url.split('?')[0]}: {e}")


def parse_url(u):
    """https://www.figma.com/design/<key>/<name>?node-id=13535-44175 → (key, "13535-44175")"""
    m = re.search(r"figma\.com/(?:design|file|proto)/([A-Za-z0-9]+)", u)
    q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
    node = (q.get("node-id") or [""])[0].replace(":", "-")
    if not m or not node:
        return None
    return m.group(1), node


def color(c, opacity=1):
    if not c:
        return ""
    r, g, b = (round(c[k] * 255) for k in "rgb")
    a = c.get("a", 1) * opacity
    h = f"#{r:02X}{g:02X}{b:02X}"
    return h if a >= 0.999 else f"{h} @{round(a * 100)}%"


def paints(n, key):
    out = []
    for f in n.get(key) or []:
        if f.get("visible") is False:
            continue
        out.append(color(f.get("color"), f.get("opacity", 1)) if f.get("type") == "SOLID" else f.get("type", "").lower())
    return ", ".join(out)


def describe(n):
    parts = []
    bb = n.get("absoluteBoundingBox") or {}
    if bb:
        parts.append(f"{round(bb.get('width', 0))}×{round(bb.get('height', 0))}")
    if n.get("layoutMode") not in (None, "NONE"):
        pad = [n.get(k, 0) for k in ("paddingTop", "paddingRight", "paddingBottom", "paddingLeft")]
        parts.append(f"auto-layout {n['layoutMode'].lower()} gap {n.get('itemSpacing', 0)}" + (f" pad {'/'.join(str(round(p)) for p in pad)}" if any(pad) else ""))
    if paints(n, "fills"):
        parts.append(f"fill {paints(n, 'fills')}")
    if paints(n, "strokes"):
        parts.append(f"stroke {paints(n, 'strokes')} {n.get('strokeWeight', '')}px")
    if n.get("cornerRadius"):
        parts.append(f"radius {n['cornerRadius']}")
    elif n.get("rectangleCornerRadii"):
        parts.append(f"radius {'/'.join(str(x) for x in n['rectangleCornerRadii'])}")
    if n.get("opacity") not in (None, 1):
        parts.append(f"opacity {n['opacity']}")
    if n.get("type") == "TEXT":
        st = n.get("style") or {}
        parts.append(f"font {st.get('fontFamily', '')} {st.get('fontWeight', '')} {st.get('fontSize', '')}/{round(st.get('lineHeightPx', 0))}")
    if n.get("type") == "INSTANCE" and n.get("componentId"):
        parts.append(f"component {n['componentId']}")
    return " · ".join(p for p in parts if p)


def walk(n, depth, lines, texts, max_depth):
    if n.get("visible") is False:
        return
    line = f"{'  ' * depth}- **{n.get('name', '')}** `{n.get('type', '')}`"
    d = describe(n)
    if d:
        line += f" — {d}"
    if n.get("type") == "TEXT":
        chars = n.get("characters") or ""
        line += f" — 「{chars.replace(chr(10), '⏎')[:200]}」"
        texts.append(chars)
    lines.append(line)
    if depth < max_depth:
        for c in n.get("children") or []:
            walk(c, depth + 1, lines, texts, max_depth)


def read_index(readme):
    """保留已人工填写的「区域 / 对应 AC」两列与表格之后的内容"""
    kept, tail = {}, ""
    if not readme.exists():
        return kept, tail
    text = readme.read_text(encoding="utf-8")
    for m in re.finditer(r"^\| (\d+-\d+) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|", text, re.M):
        kept[m.group(1)] = (m.group(3).strip(), m.group(4).strip())
    i = text.find("\n## 关键样式")
    if i > -1:
        tail = text[i:]
    return kept, tail


def main():
    ap = argparse.ArgumentParser(description="缓存 Figma 节点（截图 + 结构摘要 + 原始数据）到需求目录 figma/")
    ap.add_argument("--dir", required=True, help="需求目录（docs/develop/<...>）")
    ap.add_argument("--urls", nargs="*", default=[], help="Figma 链接（带 node-id），可多个")
    ap.add_argument("--urls-file", help="文本文件，每行一个链接")
    ap.add_argument("--refresh", action="store_true", help="按 figma/README.md 里已有节点重新拉取")
    ap.add_argument("--max-depth", type=int, default=12, help="design.md 层级展开深度")
    args = ap.parse_args()

    out = pathlib.Path(args.dir) / "figma"
    out.mkdir(parents=True, exist_ok=True)
    readme = out / "README.md"
    kept, tail = read_index(readme)

    urls = list(args.urls)
    if args.urls_file:
        urls += [l.strip() for l in pathlib.Path(args.urls_file).read_text(encoding="utf-8").splitlines() if l.strip()]
    targets = {}  # node -> fileKey（同一节点只读一次）
    for u in urls:
        parsed = parse_url(u)
        if not parsed:
            print(f"跳过（不是带 node-id 的 Figma 链接）: {u}")
            continue
        targets.setdefault(parsed[1], parsed[0])
    if args.refresh and readme.exists():
        for m in re.finditer(r"figma\.com/design/([A-Za-z0-9]+)/\?node-id=(\d+-\d+)", "".join((out / n / "design.md").read_text(encoding="utf-8") for n in kept if (out / n / "design.md").exists())):
            targets.setdefault(m.group(2), m.group(1))
    if not targets:
        sys.exit("没有可读取的节点：--urls 需要带 node-id 的 Figma 链接")

    tok = token()
    by_file = {}
    for node, key in targets.items():
        by_file.setdefault(key, []).append(node)

    rows = []
    for file_key, nodes in by_file.items():
        ids = ",".join(n.replace("-", ":") for n in nodes)
        data = get(f"{API}/files/{file_key}/nodes?ids={ids}&geometry=omit", tok)
        imgs = get(f"{API}/images/{file_key}?ids={ids}&format=png&scale=2", tok).get("images", {})
        file_name = data.get("name", "")
        for nid in nodes:
            key = nid.replace("-", ":")
            entry = (data.get("nodes") or {}).get(key)
            d = out / nid
            d.mkdir(exist_ok=True)
            if not entry or not entry.get("document"):
                (d / "design.md").write_text(f"# {nid}\n\n读取失败：节点不存在或令牌无权限\n", encoding="utf-8")
                rows.append((nid, "（读取失败）", ""))
                print("MISS", nid)
                continue
            doc = entry["document"]
            comps = entry.get("components") or {}
            (d / "node.json").write_text(json.dumps(entry, ensure_ascii=False, indent=1), encoding="utf-8")
            shot = ""
            if imgs.get(key):
                (d / "screenshot.png").write_bytes(get(imgs[key], tok, raw=True))
                shot = "screenshot.png"
            lines, texts = [], []
            walk(doc, 0, lines, texts, args.max_depth)
            raw = json.dumps(doc)
            comp_names = sorted({comps[c]["name"] for c in comps if c in raw})
            md = [f"# {doc.get('name', '')}（node {nid}）", "",
                  f"- Figma：https://www.figma.com/design/{file_key}/?node-id={nid}（文件：{file_name}）",
                  f"- 尺寸 / 外观：{describe(doc)}",
                  f"- 缓存时间：{time.strftime('%Y-%m-%d %H:%M')}（REST API，原始数据见 node.json）", ""]
            if shot:
                md += [f"![](./{shot})", ""]
            if comp_names:
                md += ["## 用到的组件", ""] + [f"- {c}" for c in comp_names] + [""]
            md += ["## 文案（按出现顺序）", ""] + [f"- {t}" for t in texts if t.strip()] + [""]
            md += ["## 层级结构", ""] + lines + [""]
            (d / "design.md").write_text("\n".join(md), encoding="utf-8")
            rows.append((nid, doc.get("name", ""), describe(doc)))
            print("OK", nid, doc.get("name", ""), f"{len(lines)} nodes", "shot" if shot else "no-shot")

    # 本次未重拉、但索引里已有的节点照旧保留
    seen = {r[0] for r in rows}
    for nid, (region, ac) in kept.items():
        if nid not in seen and (out / nid / "design.md").exists():
            rows.append((nid, "（沿用上次缓存）", ""))

    index = ["# Figma 设计稿缓存", "",
             f"由 `figma_cache.py` 生成（{time.strftime('%Y-%m-%d %H:%M')}）。每个节点目录含 `screenshot.png`（2x）、`design.md`（摘要）、`node.json`（原始数据）。",
             "「区域」「对应 AC」两列与下方两段由 AI 看完截图后填写，重跑脚本时保留。设计稿与文档冲突时，把冲突列进「与文档的差异」并交用户裁决，不得静默取舍。", "",
             "| 节点 | Figma 名称 | 区域 | 对应 AC | 摘要 |", "|---|---|---|---|---|"]
    for nid, name, _ in rows:
        region, ac = kept.get(nid, ("（待填：看截图写页面区域与状态）", "（待填）"))
        index.append(f"| {nid} | {name} | {region} | {ac} | [design.md](./{nid}/design.md) |")
    if not tail:
        tail = """
## 关键样式（从 design.md / node.json 提取，实现以此为准）

| 元素 | 规格 |
|---|---|
| （待填：字段标题 / 按钮 / 选项 / 进度条 / 卡片等的色值、尺寸、圆角、字号、间距） | |

## 与文档 / 已写代码的差异（待用户确认）

| # | 位置 | 设计稿 | 现有文档 / 代码 | 建议 |
|---|---|---|---|---|
| | | | | |
"""
    readme.write_text("\n".join(index) + "\n" + tail, encoding="utf-8")
    print("done", out)


if __name__ == "__main__":
    main()
