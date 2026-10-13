#!/usr/bin/env python3
"""Step1 需求澄清问答记录的解析 / 写回 / 改动登记 / 待 PM 清单导出。只用标准库。

记录文件 `Step 1-需求澄清问答记录.md` 的格式（一个问题一节）：

    ## 一、范围类

    ### Q6 · Hook 默认选哪一项
    - **状态**：已定
    - **问题描述**：
      背景、现状（证据）、冲突 / 空白点、为什么必须定下来 —— 不看对话也能读懂
    - **候选项**：
      - A. 按 PRD：默认选第一个 AI Hook —— 后果……
      - B. 按原型：默认 Custom —— 后果……
      - C. 需要跟产品经理确认
    - **已选**：A
    - **当前结论**：
      ……
    - **来源**：PRD 3.2；用户（2026-10-12 明确决策）

字段：状态（已定 / 待PM确认 / PM已确认）、问题描述、候选项（可无）、已选（候选项字母，或「自定义」）、
当前结论、来源。多行内容缩进两格续写。

看板保存时调用 update_question(record_change=True)：写回 md，并在 `.qa-changes.json` 追加一条
「待确认」改动。AI 每步开始前跑 `changes`，把改动列给用户确认、同步下游后 `ack`；用户不认可则 `reject`
（把 md 恢复为改动前）。validate_step.py 对「待确认」改动判 FAIL —— 不靠记忆。

用法：
    python scripts/qa_record.py show    --dir <需求目录>
    python scripts/qa_record.py check   --dir <需求目录>
    python scripts/qa_record.py changes --dir <需求目录>
    python scripts/qa_record.py ack     --dir <需求目录> --id <改动id> [--note 已同步 Spec/Checklist]
    python scripts/qa_record.py reject  --dir <需求目录> --id <改动id> [--note ...]
    python scripts/qa_record.py pm      --dir <需求目录> [--format md|csv|text] [--out 文件]
"""
from __future__ import annotations

import argparse
import csv
import datetime
import io
import json
import os
import re
import sys
from pathlib import Path

RECORD = "Step 1-需求澄清问答记录.md"
CHANGES = ".qa-changes.json"
STATUSES = ("已定", "待PM确认", "PM已确认")
PM_PENDING = "待PM确认"
FIELDS = ("状态", "问题描述", "候选项", "已选", "当前结论", "来源")
EDITABLE = ("状态", "已选", "当前结论", "来源")  # 来源也登记：产品确认留痕，驳回时一并恢复
DESC_MIN = 60  # 问题描述少于这么多字，大概率只是一句话标题，读者看不懂

Q_HEAD = re.compile(r"^###\s+([QNX]\d+)\s*[·:：\-]\s*(.+?)\s*$")
G_HEAD = re.compile(r"^##\s+(.+?)\s*$")
F_LINE = re.compile(r"^-\s+\*\*(" + "|".join(FIELDS) + r")\*\*\s*[：:]\s*(.*)$")
OPT_LINE = re.compile(r"^\s{2,}-\s+([A-Z])[.、．]\s*(.*)$")


def now_iso() -> str:
    return datetime.datetime.now().replace(microsecond=0).isoformat()


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8-sig") if p.exists() else ""


def _atomic_write(p: Path, text: str) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:  # 保持 LF，别让 Windows 转成 CRLF 造成整文件 diff
        f.write(text)
    os.replace(tmp, p)


# ------------------------------------------------------------ 解析

def parse(text: str) -> dict:
    """返回 {"groups": [...], "questions": [...], "legacy_pm": n}。

    每个 question：id / title / group / 状态 / 问题描述 / options[{key,text}] / 已选 / 当前结论 / 来源 /
    start / end（行号区间，供写回）。
    legacy_pm：旧版表格格式里状态列为「待PM确认」的行数（兼容未迁移的老记录）。
    """
    lines = text.splitlines()
    groups, qs = [], []
    group = ""
    cur = None
    field = None

    def close(i):
        nonlocal cur
        if cur is not None:
            cur["end"] = i
            for k in ("问题描述", "当前结论", "来源", "状态", "已选"):
                cur[k] = "\n".join(cur[k]).strip() if isinstance(cur[k], list) else cur[k]
            qs.append(cur)
            cur = None

    for i, ln in enumerate(lines):
        m = Q_HEAD.match(ln)
        if m:
            close(i)
            cur = {"id": m.group(1), "title": m.group(2), "group": group, "start": i,
                   "状态": [], "问题描述": [], "options": [], "已选": [], "当前结论": [], "来源": []}
            field = None
            continue
        g = G_HEAD.match(ln)
        if g and not ln.startswith("###"):
            close(i)
            group = g.group(1)
            if group not in groups:
                groups.append(group)
            field = None
            continue
        if cur is None:
            continue
        f = F_LINE.match(ln)
        if f:
            field = f.group(1)
            val = f.group(2).strip()
            if field != "候选项" and val:
                cur[field].append(val)
            continue
        if field == "候选项":
            o = OPT_LINE.match(ln)
            if o:
                cur["options"].append({"key": o.group(1), "text": o.group(2).strip()})
            elif ln.strip() and cur["options"] and ln.startswith("    "):
                cur["options"][-1]["text"] += "\n" + ln.strip()
            continue
        if field and (ln.startswith("  ") or not ln.strip()):
            cur[field].append(ln[2:] if ln.startswith("  ") else "")
    close(len(lines))

    legacy = sum(1 for ln in lines if ln.lstrip().startswith("|") and PM_PENDING in ln)
    return {"groups": groups, "questions": qs, "legacy_pm": legacy if not qs else 0}


def load(req: Path) -> dict:
    return parse(_read(req / RECORD))


# ------------------------------------------------------------ 写回

def _indent(text: str) -> list[str]:
    return ["  " + x if x.strip() else "  " for x in (text or "").strip().splitlines()]


def render_question(q: dict) -> list[str]:
    out = [f"### {q['id']} · {q['title']}", f"- **状态**：{q.get('状态') or '已定'}"]
    out.append("- **问题描述**：")
    out += _indent(q.get("问题描述") or "")
    if q.get("options"):
        out.append("- **候选项**：")
        for o in q["options"]:
            first, *rest = (o["text"] or "").splitlines() or [""]
            out.append(f"  - {o['key']}. {first}")
            out += ["    " + x for x in rest]
        out.append(f"- **已选**：{q.get('已选') or ''}".rstrip())
    out.append("- **当前结论**：")
    out += _indent(q.get("当前结论") or "")
    out.append(f"- **来源**：{q.get('来源') or ''}".rstrip())
    out.append("")
    return out


def update_question(req: Path, qid: str, fields: dict, by: str = "dashboard",
                    record_change: bool = True) -> dict:
    """改一个问题的可编辑字段并写回 md；record_change 时登记一条「待确认」改动。"""
    p = req / RECORD
    text = _read(p)
    data = parse(text)
    q = next((x for x in data["questions"] if x["id"] == qid), None)
    if q is None:
        raise KeyError(f"{qid} 不存在")
    before = {k: q.get(k, "") for k in EDITABLE}
    for k, v in fields.items():
        if k not in EDITABLE:
            raise ValueError(f"字段 {k} 不可编辑（只允许 {EDITABLE}）")
        v = (v or "").strip()
        if k == "状态" and v not in STATUSES:
            raise ValueError(f"状态只能是 {STATUSES}")
        if k == "已选" and v and v != "自定义" and v not in {o["key"] for o in q["options"]}:
            raise ValueError(f"已选 {v} 不是候选项字母，也不是「自定义」")
        q[k] = v
    after = {k: q.get(k, "") for k in EDITABLE}
    if before == after:
        return {"changed": False, "question": _pub(q)}
    lines = text.splitlines()
    # 本节 = [start, end)，end 已包含节末空行；替换后只留一行空行再接下一节
    new = lines[:q["start"]] + render_question(q)[:-1] + [""] + lines[q["end"]:]
    _atomic_write(p, "\n".join(new).rstrip("\n") + "\n")
    change = None
    if record_change:
        log = load_changes(req)
        change = {"id": "c-" + datetime.datetime.now().strftime("%Y%m%d%H%M%S%f")[:-3],
                  "qid": qid, "title": q["title"], "at": now_iso(), "by": by,
                  "before": before, "after": after, "status": "待确认"}
        log["changes"].append(change)
        save_changes(req, log)
    return {"changed": True, "question": _pub(q), "change": change}


def _pub(q: dict) -> dict:
    return {k: v for k, v in q.items() if k not in ("start", "end")}


# ------------------------------------------------------------ 改动日志

def load_changes(req: Path) -> dict:
    p = req / CHANGES
    try:
        d = json.loads(_read(p)) if p.exists() else {}
    except json.JSONDecodeError:
        d = {}
    d.setdefault("changes", [])
    return d


def save_changes(req: Path, d: dict) -> None:
    _atomic_write(req / CHANGES, json.dumps(d, ensure_ascii=False, indent=2))


def pending_changes(req: Path) -> list[dict]:
    return [c for c in load_changes(req)["changes"] if c.get("status") == "待确认"]


def resolve_change(req: Path, cid: str, status: str, note: str = "") -> dict:
    log = load_changes(req)
    c = next((x for x in log["changes"] if x["id"] == cid), None)
    if c is None:
        raise KeyError(f"改动 {cid} 不存在")
    if c.get("status") != "待确认":
        raise ValueError(f"改动 {cid} 已是「{c.get('status')}」")
    if status == "已驳回":
        update_question(req, c["qid"], c["before"], record_change=False)
    c.update(status=status, resolved_at=now_iso(), note=note)
    save_changes(req, log)
    return c


# ------------------------------------------------------------ 产品确认分享（局域网链接 + 令牌）

SHARES = ".pm-share.json"
PM_OPTION = "需要跟产品经理确认"
SHARE_DAYS = 14


def load_shares(req: Path) -> dict:
    p = req / SHARES
    try:
        d = json.loads(_read(p)) if p.exists() else {}
    except json.JSONDecodeError:
        d = {}
    d.setdefault("shares", [])
    return d


def _save_shares(req: Path, d: dict) -> None:
    _atomic_write(req / SHARES, json.dumps(d, ensure_ascii=False, indent=2))


def create_share(req: Path) -> dict:
    """为当前所有「待PM确认」的问题生成一个分享令牌（链接只能看 / 答这几道题）。"""
    import secrets
    qids = [q["id"] for q in pm_items(req)]
    if not qids:
        raise ValueError("没有待产品确认的问题")
    now = datetime.datetime.now()
    s = {"token": secrets.token_urlsafe(18), "qids": qids, "created_at": now.replace(microsecond=0).isoformat(),
         "expires_at": (now + datetime.timedelta(days=SHARE_DAYS)).replace(microsecond=0).isoformat(),
         "status": "active", "answers": []}
    d = load_shares(req)
    d["shares"].append(s)
    _save_shares(req, d)
    return s


def revoke_share(req: Path, token: str) -> None:
    d = load_shares(req)
    for s in d["shares"]:
        if s["token"] == token:
            s["status"] = "revoked"
            s["revoked_at"] = now_iso()
    _save_shares(req, d)


def find_share(req: Path, token: str):
    """令牌有效（未作废、未过期）则返回 share，否则 None。用常数时间比较。"""
    import hmac
    for s in load_shares(req)["shares"]:
        if hmac.compare_digest(s["token"], token or ""):
            if s.get("status") != "active" or s.get("expires_at", "") < now_iso():
                return None
            return s
    return None


def share_view(req: Path, share: dict) -> dict:
    """产品页看到的数据：只含令牌范围内的题；「需要跟产品经理确认」选项换成「自定义」。"""
    qs = {q["id"]: q for q in load(req)["questions"]}
    out = []
    for qid in share["qids"]:
        q = qs.get(qid)
        if not q:
            continue
        opts = [o for o in q["options"] if PM_OPTION not in o["text"]]
        out.append({"id": qid, "title": q["title"], "desc": q["问题描述"], "status": q["状态"],
                    "options": opts, "picked": q["已选"] if q["状态"] == "PM已确认" else "",
                    "conclusion": q["当前结论"] if q["状态"] == "PM已确认" else ""})
    return {"questions": out, "expires_at": share.get("expires_at")}


def pm_answer(req: Path, token: str, qid: str, choice: str, text: str, name: str = "") -> dict:
    """产品在分享页作答：写回 md（状态 PM已确认）+ 登记待确认改动（by=pm:名字）。"""
    share = find_share(req, token)
    if share is None:
        raise PermissionError("链接已失效")
    if qid not in share["qids"]:
        raise PermissionError("该问题不在此链接范围内")
    q = next((x for x in load(req)["questions"] if x["id"] == qid), None)
    if q is None:
        raise KeyError(f"{qid} 不存在")
    text = (text or "").strip()[:4000]
    name = (name or "").strip()[:40]
    keys = {o["key"]: o["text"] for o in q["options"] if PM_OPTION not in o["text"]}
    if choice == "自定义":
        if not text:
            raise ValueError("请填写自定义答复")
        concl = text
    elif choice in keys:
        concl = keys[choice] + (f"\n\n补充说明：{text}" if text else "")
    else:
        raise ValueError("请选择一个选项")
    who = f"产品{('（' + name + '）') if name else ''}"
    mark = f"{who} {now_iso()[:16].replace('T', ' ')} 通过分享链接确认"
    src = (q["来源"] + "；" if q["来源"] else "") + mark
    res = update_question(req, qid, {"已选": choice, "当前结论": concl, "状态": "PM已确认", "来源": src},
                          by=f"pm:{name or 'anonymous'}", record_change=True)
    sd = load_shares(req)
    for s in sd["shares"]:
        if s["token"] == share["token"]:
            s.setdefault("answers", []).append({"qid": qid, "choice": choice, "name": name, "at": now_iso()})
    _save_shares(req, sd)
    return res



# ------------------------------------------------------------ 质量检查 / 导出

def check(req: Path) -> list[tuple[str, str]]:
    """[(级别, 说明)]，级别 FAIL / WARN。供 validate_step 调用。"""
    data = load(req)
    out = []
    for q in data["questions"]:
        if q["状态"] not in STATUSES:
            out.append(("FAIL", f"{q['id']} 状态「{q['状态']}」不在 {STATUSES}"))
        desc = q["问题描述"]
        if not desc:
            out.append(("FAIL", f"{q['id']} 缺「问题描述」"))
        elif len(desc) < DESC_MIN:
            out.append(("WARN", f"{q['id']} 问题描述只有 {len(desc)} 字 —— 要写清背景、现状、冲突与影响，不看对话也能读懂"))
        if q["options"] and not q["已选"]:
            out.append(("WARN", f"{q['id']} 有候选项但没写「已选」"))
        if not q["当前结论"] and q["状态"] != PM_PENDING:
            out.append(("FAIL", f"{q['id']} 状态为「{q['状态']}」却没有「当前结论」"))
    return out


def pm_items(req: Path) -> list[dict]:
    return [_pub(q) for q in load(req)["questions"] if q["状态"] == PM_PENDING]


def export_pm(req: Path, fmt: str = "md") -> str:
    items = pm_items(req)
    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["编号", "问题", "问题描述", "候选项", "当前倾向 / 暂定", "来源"])
        for q in items:
            w.writerow([q["id"], q["title"], q["问题描述"],
                        "\n".join(f"{o['key']}. {o['text']}" for o in q["options"]),
                        q["当前结论"], q["来源"]])
        return "﻿" + buf.getvalue()  # BOM：Excel 直接双击打开不乱码
    out = [f"# 待产品确认问题（{req.name}）", "", f"共 {len(items)} 条，导出时间 {now_iso()}", ""]
    for i, q in enumerate(items, 1):
        out += [f"## {i}. {q['title']}（{q['id']}）", "", q["问题描述"], ""]
        if q["options"]:
            out += ["候选项：", ""] + [f"- {o['key']}. {o['text']}" for o in q["options"]] + [""]
        if q["当前结论"]:
            out += [f"当前倾向：{q['当前结论']}", ""]
    return "\n".join(out) + "\n"


# ------------------------------------------------------------ CLI

def main() -> int:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description="Step1 问答记录工具")
    ap.add_argument("cmd", choices=["show", "check", "changes", "ack", "reject", "pm"])
    ap.add_argument("--dir", required=True)
    ap.add_argument("--id")
    ap.add_argument("--note", default="")
    ap.add_argument("--format", choices=["md", "csv", "text"], default="md")
    ap.add_argument("--out")
    a = ap.parse_args()
    req = Path(a.dir).resolve()

    if a.cmd == "show":
        d = load(req)
        for q in d["questions"]:
            print(f"{q['id']:<4} [{q['状态']}] {q['title']}  已选={q['已选'] or '-'}")
        print(f"\n共 {len(d['questions'])} 题；待PM确认 {sum(q['状态'] == PM_PENDING for q in d['questions'])}")
    elif a.cmd == "check":
        res = check(req)
        for lv, msg in res:
            print(f"{lv}: {msg}")
        print("OK" if not res else f"{len(res)} 项")
        return 1 if any(lv == "FAIL" for lv, _ in res) else 0
    elif a.cmd == "changes":
        pend = pending_changes(req)
        if not pend:
            print("无待确认改动")
            return 0
        print(f"⚠️  {len(pend)} 条看板改动待确认（确认并同步下游后 ack；不认可则 reject 恢复原值）：\n")
        for c in pend:
            print(f"[{c['id']}] {c['qid']} · {c['title']}  ({c['at']}, by {c['by']})")
            for k in EDITABLE:
                if c["before"].get(k) != c["after"].get(k):
                    print(f"   {k}：\n     改前：{c['before'].get(k) or '（空）'}\n     改后：{c['after'].get(k) or '（空）'}")
            print()
        return 3
    elif a.cmd in ("ack", "reject"):
        if not a.id:
            ap.error("需要 --id")
        c = resolve_change(req, a.id, "已确认" if a.cmd == "ack" else "已驳回", a.note)
        print(f"{c['id']} → {c['status']}")
    elif a.cmd == "pm":
        text = export_pm(req, "csv" if a.format == "csv" else "md")
        if a.out:
            Path(a.out).write_text(text, encoding="utf-8")
            print(f"已导出 {a.out}")
        else:
            print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
