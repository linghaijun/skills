#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证进度看板生成器（Step 11.4 / Step 10.4 收尾用）。只用标准库。

产出两个自包含 HTML（无 CDN、双击可开）：
  1. 单需求页面  <需求目录>/验证进度看板.html
  2. 外层总览页  <需求目录的父目录>/index.html   —— 总览所有未归档/非工具需求，可切换查看

数据源（全部可选，缺失即降级，绝不阻断）：
  - <需求目录>/tests/.verify-state.json   用例状态登记（由 scripts/verify_state.py 维护）→ **轮询实时刷新**
  - <需求目录>/.handover-state.json        提测状态（与验证态分离；handover_state.py）→ **轮询刷新 status**
  - <需求目录>/.workflow-state.json        流程各步是否通过（validate_step.py --record）
  - <需求目录>/Step 3-Checklist.md         AC 清单（[open]/[done]/[blocked] + GWT）
  - <需求目录>/tests/AC-NN/                case.md / REPLAY.md 或 script/ / evidence/ / RESULT.md
  - <需求目录>/Step *-回归验证清单.md       R-NN 回归项
  - <需求目录>/Step *-测试矩阵.md           测试用例矩阵（可选）

实时 vs 快照：
  - **实时**（页面每 5s 轮询）：用例状态 / 会话 / 窗口 / 时间戳（registry）；提测终态 status（handover）。
  - **快照**（重跑本脚本才更新）：证据文件清单、Checklist 原文、流程步骤、回归项、RESULT 摘要、
    AC↔Subtask 映射表（浏览器 fetch 无法列目录、也无法解析 md，只能生成时固化）。

打开方式：
  - 双击（file://）：能看，但 fetch 被浏览器拦截 → 自动降级为「生成时快照」并给出提示横幅。
  - 起本地服务（推荐，可实时刷新）：
        python scripts/verify_dashboard.py --dir <需求目录> --serve
    然后打开打印出来的 http://127.0.0.1:<port>/... 或 /index.html

用法：
  python scripts/verify_dashboard.py --dir docs/develop/<需求目录>
  python scripts/verify_dashboard.py --all --develop docs/develop
  python scripts/verify_dashboard.py --dir docs/develop/<需求目录> --serve --port 8787
  python scripts/verify_dashboard.py --dir docs/develop/<需求目录> --no-index   # 不刷新外层总览

退出码：0 正常（含降级）；2 用法/前置错误（目录不存在）。
"""

from __future__ import annotations

import argparse
import datetime
import functools
import json
import os
import re
import shutil
import socket
import threading
import sys
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:  # Step1 问答记录（同目录共用脚本）；缺失时看板照常工作，只是没有「需求问答」页签
    import qa_record
except ImportError:  # pragma: no cover
    qa_record = None

# ------------------------------------------------------------ 常量

AC_RE = re.compile(r"^AC-(\d{1,3})\b", re.I)
ITEM_RE = re.compile(r"^\s*[*\-\u2022]\s*\[(open|done|blocked|waived)\]\s*(AC-\d{1,3})\b(.*)$", re.I)
ITEM_RE2 = re.compile(r"^\s*[*\-\u2022]\s*(AC-\d{1,3})\b.*?\[(open|done|blocked|waived)\]", re.I)
GWT_RE = re.compile(r"^\s*>>\s*(Given|And|When|Then)\s*[:：]\s*(.*)$", re.I)
FIG_RE = re.compile(r"^\s*>>\s*图示\s*[:：]\s*(.*)$")
FIG_PATH_RE = re.compile(r"UI/[^）)\s]+\.(?:png|jpe?g|gif|webp)", re.I)
UI_IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
TAG_RE = re.compile(r"\[(前端|后端|前后端|运维|数据)\]")
PRIO_RE = re.compile(r"\bP([012])\b")
R_RE = re.compile(r"\bR-(\d{1,3})\b")


def norm_ac(t: str) -> str:
    """AC 编号归一成两位（AC-1 / ac-01 → AC-01）。

    目录名可能是 AC-1（历史遗留），Checklist 里是 AC-01 —— 不归一就会各占一行、
    且 registry 里回填的状态挂不到 Checklist 那条上。
    """
    m = re.search(r"(\d{1,3})", str(t))
    return "AC-%02d" % int(m.group(1)) if m else str(t).upper()
DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")

STATUSES = ["待验证", "验证中", "修复中", "通过", "失败", "阻塞", "部分", "走读证据", "跳过"]
DONE_LIKE = {"通过"}
BUSY = {"验证中", "修复中"}
NONTERMINAL = {"待验证", "验证中", "修复中"}

STEP_SPEC = {
    "fullstack": [
        (1, "需求澄清 Q&A"), (2, "Spec"), (3, "Checklist"), (4, "技术方案"), (5, "DDL"),
        (6, "API 契约"), (7, "前端设计"), (8, "测试矩阵"), (9, "任务拆解"), (10, "逐条编码"),
        (11, "测试/自检/实机验证"), (12, "AI Review"), (13, "全局一致性审查"),
        (14, "AC↔Subtask 提测"),
    ],
    "backend": [
        (1, "需求澄清 Q&A"), (2, "Spec"), (3, "Checklist"), (4, "技术方案"), (5, "DDL"),
        (6, "API 契约"), (7, "测试矩阵"), (8, "任务拆解"), (9, "逐条编码"),
        (10, "测试/自检/实机验证"), (11, "AI Review"), (12, "全局一致性审查"),
        (13, "AC↔Subtask 提测"),
    ],
}
HANDOVER_FILE = ".handover-state.json"
HANDOVER_FINAL = {"已提测", "无需提测"}
EXCLUDE_DEFAULT = ["archived", "tools"]

MEDIA_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v"}
DATA_EXT = {".csv", ".xls", ".xlsx"}  # .txt 归 md 文本预览；xlsx 仍 other（二进制）
HAR_EXT = {".har", ".json"}
TEXT_EXT = {".md", ".markdown", ".txt", ".text", ".rst"}


# ------------------------------------------------------------ 小工具

def now_iso() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def load_json_retry(p: Path, tries: int = 3, delay: float = 0.12):
    """并发下可能读到半截 JSON（另一个会话正在写）——重试几次。返回 (data|None, err|None)。"""
    last = None
    for i in range(tries):
        if not p.exists():
            return None, "未找到"
        try:
            return json.loads(p.read_text(encoding="utf-8")), None
        except (OSError, ValueError) as e:
            last = str(e)
            time.sleep(delay)
    return None, last


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(str(s).strip())
    except ValueError:
        return None


def is_busy_stale(case: dict, ttl: float, now=None) -> bool:
    now = now or datetime.datetime.now().astimezone()
    if case.get("status") not in BUSY:
        return False
    t = parse_ts(case.get("updated_at"))
    if t is None:
        return True
    if t.tzinfo is None:
        t = t.replace(tzinfo=now.tzinfo)
    return (now - t).total_seconds() / 60 > ttl


def human_size(n) -> str:
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "-"
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return "-"


def classify_evidence(p: Path) -> str:
    e = p.suffix.lower()
    if e in VIDEO_EXT:
        return "video"
    if e in MEDIA_EXT:
        return "image"
    if e == ".har":
        return "har"
    if e in HAR_EXT:
        return "json"
    if e == ".log":
        return "log"
    if e in TEXT_EXT:
        return "md"  # 文本内联预览（与 RESULT.md 按钮同一分支）
    if e in DATA_EXT:
        return "data"
    return "other"


# ------------------------------------------------------------ 解析

def parse_checklist(text: str):
    """返回 (items, width, unnumbered)。

    兼容 `* [open] AC-01 PREFIX - 描述` 与 `* AC-01 ... [open]`；
    旧格式（只有前缀、无 AC-NN，如 `* [open] intra-collection-all-pairs - 描述`）
    计入 unnumbered —— 看板无法按 AC 聚合，会显式提示。
    """
    items, cur, width, unnumbered = [], None, 2, 0
    for raw in text.splitlines():
        m = ITEM_RE.match(raw)
        if m:
            ck, token, rest = m.group(1).lower(), m.group(2).upper(), m.group(3)
        else:
            m2 = ITEM_RE2.match(raw)
            if not m2:
                g = GWT_RE.match(raw)
                if g and cur is not None:
                    cur["gwt"].append(f"{g.group(1)}: {g.group(2).strip()}")
                f = FIG_RE.match(raw)
                if f and cur is not None:
                    cur["fig_text"] = f.group(1).strip()
                    cur["figs"] = FIG_PATH_RE.findall(f.group(1))
                continue
            token, ck, rest = m2.group(1).upper(), m2.group(2).lower(), raw[m2.end():]
        body = rest.strip().lstrip("-–—·:：").strip()
        if m is None:
            unnumbered += 1
        prefix, title = "", body
        pm = re.match(r"^\{?([A-Z][A-Z0-9_]{1,40})\}?\s*[-:：]?\s*(.*)$", body)
        if pm and pm.group(2).strip():
            prefix, title = pm.group(1), pm.group(2).strip()
        tags = TAG_RE.findall(body)
        pm2 = PRIO_RE.search(body)
        width = 3 if len(token.split("-")[1]) >= 3 else width
        cur = {
            "token": token, "num": int(token.split("-")[1]), "ck": ck,
            "prefix": prefix, "title": title or body, "tags": tags,
            "priority": f"P{pm2.group(1)}" if pm2 else None, "gwt": [],
            "fig_text": "", "figs": [],
        }
        items.append(cur)
    # 去重（同 AC 重复定义取首条）
    seen, out = set(), []
    for it in items:
        if it["token"] in seen:
            continue
        seen.add(it["token"])
        out.append(it)
    return out, width, unnumbered


def case_priority(req: Path, sc: dict):
    """从 tests/AC-NN/case.md 读「优先级：P0」；读不到返回 None。"""
    rel = (sc or {}).get("dir_rel")
    if not rel:
        return None
    m = re.search(r"优先级\s*[:：]\s*(P[012])", read_text(req / "tests" / rel.split("/")[-1] / "case.md"))
    return m.group(1) if m else None


def load_registry(req: Path):
    data, err = load_json_retry(req / "tests" / ".verify-state.json")
    if err:
        return {}, err
    cases = (data or {}).get("cases") or {}
    out = {}
    for k, v in cases.items():
        if not isinstance(v, dict):
            continue
        out[k.upper()] = {
            "status": v.get("status") or "待验证",
            "session": v.get("session"), "window": v.get("window"),
            "engine": v.get("engine"), "started_at": v.get("started_at"),
            "finished_at": v.get("finished_at"), "created_at": v.get("created_at"),
            "updated_at": v.get("updated_at"), "note": v.get("note") or "",
            # 证据终验字段（漏读会让看板把所有 AC 都显示成「未终验」）
            "final_status": v.get("final_status"), "final_by": v.get("final_by"),
            "final_at": v.get("final_at"), "final_note": v.get("final_note"),
        }
    return out, None


def latest_jira_by_key(actions) -> dict:
    """同一 subtask 多次 record-jira 时取最后一条。"""
    out: dict[str, dict] = {}
    for act in actions or []:
        if not isinstance(act, dict):
            continue
        key = (act.get("subtaskKey") or act.get("key") or "").strip()
        if key:
            out[key] = act
    return out


def resolve_ac_handover(demand_status: str, subtask_key: str, jira_by_key: dict) -> str:
    """Subtask 级提测态（用例明细列）。需求级 status 只作门控/「无需提测」总开关。"""
    ds = demand_status or "未进入"
    if ds == "未进入":
        return "未进入"
    if ds == "无需提测":
        return "无需提测"
    if not subtask_key:
        return "未匹配"
    act = jira_by_key.get(subtask_key)
    if act:
        t, a = act.get("transition"), act.get("assign")
        if t == "ok" or a == "ok":
            if (t and t != "ok") or (a and a != "ok"):
                return "提测失败"
            return "已提测"
        return "提测失败"
    if ds == "已提测":
        # 需求已终态但本 subtask 无动作记录（漏记 / 无可流转时的空跑）
        return "待补记"
    if ds == "已匹配待确认":
        return "待提测"
    if ds == "待匹配":
        return "待匹配"
    return ds


def load_handover(req: Path) -> dict:
    """提测状态（与验证态分离）。缺失时给空壳，看板降级显示「未进入」。

    需求级 ``status`` 仍是流程门控；用例列展示的是 Subtask 级
    （``resolve_ac_handover``：看映射 Key + ``jiraActions``）。
    """
    data, err = load_json_retry(req / HANDOVER_FILE)
    if err or not data:
        return {
            "status": "未进入",
            "parentIssue": None,
            "assigneeEmail": "",
            "targetStatus": "Testing",
            "mapping": [],
            "by_ac": {},
            "jiraActions": [],
            "jira_by_key": {},
            "note": "",
            "matched": 0,
            "total_map": 0,
            "unmatched": 0,
            "exists": False,
            "error": err,
        }
    mapping = data.get("mapping") or []
    jira_actions = data.get("jiraActions") or []
    jira_by_key = latest_jira_by_key(jira_actions)
    by_ac: dict[str, dict] = {}
    for row in mapping:
        if not isinstance(row, dict):
            continue
        ac = row.get("ac") or row.get("AC") or ""
        if not ac:
            continue
        key = (row.get("subtaskKey") or row.get("key") or "").strip()
        by_ac[norm_ac(ac)] = {
            "subtaskKey": key,
            "subtaskSummary": row.get("subtaskSummary") or row.get("summary") or "",
            "match": row.get("match") or "",
            "note": row.get("note") or "",
            "handoverStatus": resolve_ac_handover(
                data.get("status") or "待匹配", key, jira_by_key
            ),
        }
    matched = sum(1 for v in by_ac.values() if v["subtaskKey"])
    return {
        "status": data.get("status") or "待匹配",
        "parentIssue": data.get("parentIssue"),
        "assigneeEmail": data.get("assigneeEmail") or "",
        "targetStatus": data.get("targetStatus") or "Testing",
        "matchedAt": data.get("matchedAt"),
        "decidedAt": data.get("decidedAt"),
        "note": data.get("note") or "",
        "mapping": mapping,
        "by_ac": by_ac,
        "jiraActions": jira_actions,
        "jira_by_key": jira_by_key,
        "matched": matched,
        "total_map": len(by_ac),
        "unmatched": max(0, len(by_ac) - matched),
        "exists": True,
        "error": None,
    }


def load_steps(req: Path):
    data, err = load_json_retry(req / ".workflow-state.json")
    if err:
        return {}, None
    return (data or {}).get("steps") or {}, (data or {}).get("last_step")


def detect_workflow(req: Path, forced=None) -> str:
    if forced in STEP_SPEC:
        return forced
    names = {p.name for p in req.glob("Step *-*.md")}
    fs = ("Step 8-回归验证清单.md" in names or "Step 8-前端测试验证指标矩阵.md" in names
          or "Step 9-tasks.md" in names or "Step 7-前端页面与组件设计文档.md" in names)
    be = ("Step 7-回归验证清单.md" in names or "Step 7-单元测试验证指标矩阵.md" in names
          or "Step 8-tasks.md" in names)
    if be and not fs:
        return "backend"
    if fs and not be:
        return "fullstack"
    return "fullstack"


def summarize_result(text: str) -> dict:
    """从 RESULT.md 提取结论/环境/降级/摘要。"""
    verdict = None
    for line in text.splitlines():
        if re.match(r"^\s*\|\s*结论\s*\|", line):
            verdict = line
            break
    probe = (verdict or text[:800])
    up = probe.upper()
    v = None
    if re.search(r"NOT_RUN|未执行|未测|待测试环境执行", up):
        v = "NOT_RUN"
    elif re.search(r"\bPASS\b|通过", up):
        v = "通过"
    elif re.search(r"\bFAIL\b|失败", up):
        v = "失败"
    elif re.search(r"BLOCKED|阻塞", up):
        v = "阻塞"
    elif re.search(r"PARTIAL|部分", up):
        v = "部分"
    env = next((l.strip() for l in text.splitlines() if re.match(r"^\s*\|\s*环境\s*\|", l)), "")
    dg = next((l.strip() for l in text.splitlines() if "证据降级" in l), "")
    return {
        "verdict": v,
        "verdict_line": re.sub(r"[|*`]", "", verdict).strip() if verdict else "",
        "env": re.sub(r"^\s*\|\s*环境\s*\|\s*|\s*\|\s*$", "", env).strip(),
        "downgrade": dg[:200],
        "head": text[:2500],
    }


def scan_tests(req: Path, tokens):
    """每个 AC 的 tests/AC-NN 目录内容。tokens: 规范 token（AC-01）。"""
    tests = req / "tests"
    out = {}
    dirs = {}
    if tests.is_dir():
        for p in tests.iterdir():
            if p.is_dir() and AC_RE.match(p.name):
                dirs[p.name.upper()] = p
    for token in tokens:
        num = int(token.split("-")[1])
        d = dirs.get(token)
        if d is None:
            d = next((p for k, p in dirs.items()
                      if int(k.split("-")[1]) == num), None)
        entry = {"has_dir": bool(d), "dir_rel": None, "has_replay": False, "has_script": False,
                 "evidence": [], "result": None}
        if d:
            entry["dir_rel"] = f"{req.name}/tests/{d.name}"
            entry["has_replay"] = (d / "REPLAY.md").exists()
            entry["has_script"] = (d / "script").is_dir()
            ev = d / "evidence"
            if ev.is_dir():
                files = [p for p in ev.rglob("*") if p.is_file()]
                files.sort(key=lambda p: str(p).lower())
                for p in files:
                    try:
                        stt = p.stat()
                        size, mtime = stt.st_size, stt.st_mtime
                    except OSError:
                        size, mtime = 0, 0
                    rel = f"{req.name}/tests/{d.name}/evidence/{p.relative_to(ev).as_posix()}"
                    entry["evidence"].append({
                        "rel": rel, "name": p.name, "type": classify_evidence(p),
                        "size": size, "mtime": mtime,
                    })
            rp = d / "RESULT.md"
            if rp.exists():
                entry["result"] = summarize_result(read_text(rp))
        out[token] = entry
    return out


def _strip_md_cell(s: str) -> str:
    return re.sub(r"[*`]", "", s or "").strip()


def load_regressions(req: Path):
    """解析《回归验证清单》表格行，取「结论」列（最后一格）判定。

    常见格式（7 列）：
    `| **R-01** | 受影响功能 | 改了什么 | 期望行为 | 验证方式 | 谁来验 | 结论 |`
    结论标记：✅/PASS=通过；🟡=部分（待实机）；⬜/NOT_RUN=未跑；WAIVED=人工豁免。
    """
    hits = sorted(req.glob("Step *-回归验证清单.md"))
    if not hits:
        return [], None
    src = hits[0]
    text = read_text(src)
    out, seen = [], set()
    for line in text.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        m = R_RE.search(cells[0])
        if not m:
            continue
        token = f"R-{int(m.group(1)):02d}"
        if token in seen:
            continue
        seen.add(token)
        cell = cells[-1]
        up = cell.upper()
        # 结论写在最后一列；兼容「✅ 通过」「⚠️ 部分」「有条件通过」等常见回填写法
        if "WAIVED" in up:
            kind = "waived"
        elif "✅" in cell or re.search(r"\bPASS\b", up) or re.search(r"通过", cell):
            # 「有条件通过」也算通过（附带条件写在 note 里，不挡门禁）
            if "部分" in cell or "PARTIAL" in up or "🟡" in cell:
                kind = "partial"
            else:
                kind = "pass"
        elif "🟡" in cell or "PARTIAL" in up or "部分" in cell:
            kind = "partial"
        elif "⬜" in cell or "NOT_RUN" in up or "未跑" in cell or "未验证" in cell:
            kind = "not_run"
        else:
            kind = "unknown"
        # 7 列含「谁来验」；6 列无该列时结论仍是最后一格
        impact = _strip_md_cell(cells[1]) if len(cells) > 1 else ""
        because = _strip_md_cell(cells[2]) if len(cells) > 3 else ""
        expect = _strip_md_cell(cells[3]) if len(cells) > 4 else ""
        how = _strip_md_cell(cells[4]) if len(cells) > 5 else ""
        who = _strip_md_cell(cells[5]) if len(cells) > 6 else ""
        note = _strip_md_cell(cell)
        # partial / waived 都算「有结论」—— 风险提示只打 unknown / not_run
        out.append({
            "token": token,
            "text": impact[:160],
            "because": because[:280],
            "expect": expect[:280],
            "how": how[:200],
            "who": who[:80],
            "note": note[:600],
            "verdict": kind,
            "ok": kind in ("pass", "waived", "partial"),
        })
    return out, src.name


# ------------------------------------------------------------ 指标

def compute_metrics(acs, steps, step_spec, regressions, ttl, now=None):
    now = now or datetime.datetime.now().astimezone()
    total = len(acs)
    cnt = {s: 0 for s in STATUSES}
    unknown = 0
    ck = {"open": 0, "done": 0, "blocked": 0, "waived": 0, "none": 0}
    ev_files = ev_media = 0
    for a in acs:
        st = a.get("status") or "待验证"
        if st in cnt:
            cnt[st] += 1
        else:
            unknown += 1
        ck[a.get("ck") or "none"] = ck.get(a.get("ck") or "none", 0) + 1
        for e in a.get("evidence", []):
            ev_files += 1
            if e["type"] in ("image", "video"):
                ev_media += 1
    decided = cnt["通过"] + cnt["失败"] + cnt["阻塞"] + cnt["部分"]
    impl = ck["done"] / total if total else 0.0
    coverage = (total - cnt["待验证"]) / total if total else 0.0
    pass_rate = cnt["通过"] / decided if decided else None
    regr_done = sum(1 for r in regressions if r["ok"])
    regr_rate = regr_done / len(regressions) if regressions else None
    steps_ok = sum(1 for n, _ in step_spec if (steps.get(str(n)) or {}).get("passed"))
    progress = 0.5 * impl + 0.3 * (pass_rate or 0.0) + 0.2 * (regr_rate or 0.0)

    dur, wall, work, inflight = [], None, 0.0, 0.0
    starts, finishes = [], []
    for a in acs:
        s, f, u = parse_ts(a.get("started_at")), parse_ts(a.get("finished_at")), parse_ts(a.get("updated_at"))
        if s:
            starts.append(s)
        if f:
            finishes.append(f)
        if s and (f or u):
            e = f or u
            if e.tzinfo is None:
                e = e.replace(tzinfo=now.tzinfo)
            if s.tzinfo is None:
                s = s.replace(tzinfo=now.tzinfo)
            sec = max(0.0, (e - s).total_seconds())
            dur.append((a["token"], sec, bool(f)))
            work += sec
        if a.get("status") in BUSY and s:
            if s.tzinfo is None:
                s = s.replace(tzinfo=now.tzinfo)
            inflight = max(inflight, (now - s).total_seconds())
    if starts and finishes:
        wall = max(0.0, (max(finishes) - min(starts)).total_seconds())
    return {
        "total": total, "counts": cnt, "unknown": unknown, "ck": ck,
        "impl": impl, "coverage": coverage, "pass_rate": pass_rate,
        "regr_total": len(regressions), "regr_done": regr_done, "regr_rate": regr_rate,
        "steps_ok": steps_ok, "steps_total": len(step_spec),
        "progress": progress, "evidence_files": ev_files, "evidence_media": ev_media,
        "work_seconds": work, "wall_seconds": wall, "inflight_seconds": inflight,
        "durations": dur,
    }


def detect_risks(req_name, acs, regressions, steps, step_spec, ttl, max_attempts=2, now=None):
    now = now or datetime.datetime.now().astimezone()
    any_dir = any(a.get("has_dir") for a in acs)
    risks = []

    def add(level, ac, text, cmd="", rule=None):
        risks.append({"level": level, "ac": ac, "text": text, "cmd": cmd, "rule": rule})

    for a in acs:
        st = a.get("status")
        # 只对「已判定」的 AC 追究证据/复跑入口 —— 未验的 AC 本来就没有，报了就是噪音
        decided = st in ("通过", "失败", "阻塞", "部分", "走读证据")
        if st in ("失败", "阻塞"):
            add("high", a["token"], f"验证{st}：{a.get('note') or '见 RESULT.md'}")
        if st in BUSY and is_busy_stale(a, ttl, now):
            add("high", a["token"], f"「{st}」超过 {int(ttl)} 分钟无更新（可能已中断），可回收",
                f"python scripts/verify_state.py reclaim --dir <需求目录> --ac {a['token']} "
                f"--session <你的会话> --window <你的窗口>")
        if st == "通过" and a.get("ck") == "open":
            add("medium", a["token"], "registry 已「通过」但 Checklist 仍 [open]（回写漏了）",
                rule="registry 已通过但 Checklist 未回写 [done]")
        if a.get("ck") == "done" and st in ("失败", "阻塞"):
            add("medium", a["token"], f"Checklist 已 [done] 但 registry 是「{st}」，互相矛盾",
                rule="Checklist 已 [done] 但 registry 结论相反")
        if decided and not a.get("has_dir") and any_dir:
            add("medium", a["token"], f"已判「{st}」但 tests/AC-NN/ 目录不存在（未留证=未测）",
                rule="已判定但缺 tests/AC-NN 目录")
        if decided and a.get("has_dir"):
            media = [e for e in a.get("evidence", []) if e["type"] in ("image", "video")]
            if not a.get("evidence"):
                add("medium", a["token"], f"已判「{st}」但 evidence/ 为空（未留证=未测）",
                    rule="已判定但 evidence/ 为空")
            elif not media and not (a.get("result") or {}).get("downgrade"):
                add("low", a["token"], "无截图/录屏且未写「证据降级」理由",
                    rule="无截图/录屏且未写「证据降级」理由")
            if not a.get("has_replay") and not a.get("has_script"):
                add("low", a["token"], "缺复跑入口（REPLAY.md 或 script/ 二选一）",
                    rule="缺复跑入口（REPLAY.md 或 script/）")
    if not any_dir and any(a.get("status") in ("通过", "失败", "阻塞", "部分", "走读证据") for a in acs):
        add("medium", None, "该需求没有 tests/AC-NN 证据目录（旧式产出：结论来自 Step 1x 报告，未按 AC 归档证据）")
    unreg = [a["token"] for a in acs if a.get("has_dir") and a.get("status") == "待验证"
             and a.get("ck") in ("open", None)]
    if unreg:
        add("low", None, f"{len(unreg)} 条有证据目录但未登记状态：{', '.join(unreg[:8])}",
            "python scripts/verify_state.py init --dir <需求目录>")
    unjust = [r for r in regressions if not r.get("ok")]
    if unjust:
        by = {}
        for r in unjust:
            by[r.get("verdict", "unknown")] = by.get(r.get("verdict", "unknown"), 0) + 1
        label = {"partial": "🟡 待实机", "not_run": "⬜ 未跑", "unknown": "无结论", "waived": "豁免无记录"}
        detail = "、".join(f"{label.get(k, k)} {v}" for k, v in by.items())
        add("medium", None, f"{len(unjust)} 条回归项未完成（{detail}）：未验证的 R-NN 与未实现 AC 同等对待")
    for n, title in step_spec:
        info = steps.get(str(n)) or {}
        if info.get("consecutive_fails", 0) > max_attempts:
            add("high", None, f"Step{n}（{title}）连续失败 {info['consecutive_fails']} 次 —— 须停手问人")
    # 同类逐条风险过多时折叠成一条 —— 同一规则刷 30 行，人就不看了（告警等于没有）
    grouped, flat = {}, []
    for r in risks:
        if r.get("rule") and r.get("ac"):
            grouped.setdefault(r["rule"], []).append(r)
        else:
            flat.append(r)
    for rule, items in grouped.items():
        if len(items) <= 5:
            flat.extend(items)
        else:
            toks = [i["ac"] for i in items]
            flat.append({"level": items[0]["level"], "ac": None,
                         "text": f"{len(items)} 条「{rule}」：{', '.join(toks[:8])}"
                                 + (" …" if len(toks) > 8 else ""), "cmd": "", "rule": None})
    return flat


# ------------------------------------------------------------ 快照

PM_BASE = ""  # 产品确认页的局域网地址，serve() 启动时填


def load_qa(req: Path) -> dict:
    """Step1 问答记录 → 看板数据。服务模式下每次请求现场解析，保证看到的是磁盘上的最新内容。"""
    if qa_record is None or not (req / qa_record.RECORD).exists():
        return {"exists": False, "questions": [], "groups": [], "pending": [], "legacy_pm": 0}
    d = qa_record.load(req)
    return {"exists": True, "groups": d["groups"], "legacy_pm": d["legacy_pm"],
            "questions": [qa_record._pub(q) for q in d["questions"]],
            "pending": qa_record.pending_changes(req),
            "shares": [{"token": s["token"], "url": (PM_BASE + "/pm/" + s["token"]) if PM_BASE else "",
                        "created_at": s.get("created_at"), "expires_at": s.get("expires_at"),
                        "qids": s.get("qids", []), "answers": len(s.get("answers", []))}
                       for s in qa_record.load_shares(req)["shares"] if s.get("status") == "active"]}


STEP_FILE_RE = re.compile(r"^Step\s*(\d+)(?:\.\d+)*\s*[-－_.\s]")


def _file_type(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext in MEDIA_EXT:
        return "image"
    if ext in VIDEO_EXT:
        return "video"
    if ext in (".md", ".markdown", ".rst"):
        return "md"
    return "log"  # .sql / .txt / .json 等按纯文本展示


def collect_step_files(req: Path) -> dict:
    """需求目录顶层 `Step N-*.{md,sql,txt,...}` 按步号归组，供「流程步骤」点击查看产出物。"""
    out = {}
    try:
        files = sorted(x for x in req.iterdir() if x.is_file())
    except OSError:
        return out
    for x in files:
        m = STEP_FILE_RE.match(x.name)
        if not m or x.suffix.lower() in (".html",):
            continue
        out.setdefault(str(int(m.group(1))), []).append(
            {"rel": f"{req.name}/{x.name}", "name": x.name, "type": _file_type(x.name)})
    for v in out.values():  # 主文档（.md）排前面，默认先看它
        v.sort(key=lambda f: (f["type"] != "md", f["name"]))
    return out


def build_snapshot(req: Path, workflow=None, ttl=20.0) -> dict:
    workflow = detect_workflow(req, workflow)
    step_spec = STEP_SPEC[workflow]
    cases, reg_err = load_registry(req)
    steps, last_step = load_steps(req)
    handover = load_handover(req)
    ho_by_ac = handover.get("by_ac") or {}

    ck_path = req / "Step 3-Checklist.md"
    ck_text = read_text(ck_path) if ck_path.exists() else ""
    ck_items, width, unnumbered = parse_checklist(ck_text)

    tests = req / "tests"
    dir_tokens = []
    if tests.is_dir():
        dir_tokens = sorted({norm_ac(p.name) for p in tests.iterdir()
                             if p.is_dir() and AC_RE.match(p.name)})
    ck_map = {}
    for it in ck_items:
        it["token"] = norm_ac(it["token"])
        ck_map.setdefault(it["token"], it)
    reg_map = {}
    for k, v in cases.items():
        reg_map.setdefault(norm_ac(k), v)
    all_tokens = []
    for t in (list(ck_map) + list(reg_map) + dir_tokens):
        if t not in all_tokens:
            all_tokens.append(t)
    all_tokens.sort(key=lambda t: int(t.split("-")[1]))

    scan = scan_tests(req, all_tokens)
    acs = []
    for token in all_tokens:
        ck = ck_map.get(token)
        reg = reg_map.get(token) or {}
        sc = scan.get(token) or {}
        ho = ho_by_ac.get(token) or {}
        acs.append({
            "token": token, "num": int(token.split("-")[1]),
            "ck": ck["ck"] if ck else None,
            "title": (ck["title"] if ck else "") or token,
            "prefix": ck["prefix"] if ck else "",
            # 标题行没写时兜底：[前端]/[后端] 标签多写在 Then 行；优先级写在 tests/AC-NN/case.md「优先级：P0」
            "tags": (ck["tags"] or sorted(set(TAG_RE.findall(" ".join(ck["gwt"]))))) if ck else [],
            "priority": (ck["priority"] if ck else None) or case_priority(req, sc),
            "gwt": "\n".join(ck["gwt"]) if ck else "",
            "fig_text": ck.get("fig_text", "") if ck else "",
            "figs": [f"{req.name}/{x}" for x in ck.get("figs", [])] if ck else [],
            "status": reg.get("status") or "待验证",
            "registered": token in reg_map,
            "session": reg.get("session"), "window": reg.get("window"),
            "engine": reg.get("engine"),
            "started_at": reg.get("started_at"), "finished_at": reg.get("finished_at"),
            "created_at": reg.get("created_at"), "updated_at": reg.get("updated_at"),
            "note": reg.get("note") or "",
            "final_status": reg.get("final_status") or "未终验",
            "final_by": reg.get("final_by"), "final_at": reg.get("final_at"),
            "final_note": reg.get("final_note") or "",
            "subtaskKey": ho.get("subtaskKey") or "",
            "subtaskSummary": ho.get("subtaskSummary") or "",
            "subtaskMatch": ho.get("match") or ("unmatched" if handover.get("exists") else ""),
            "handoverStatus": ho.get("handoverStatus") or resolve_ac_handover(
                handover.get("status") or "未进入",
                ho.get("subtaskKey") or "",
                handover.get("jira_by_key") or {},
            ),
            "has_dir": sc.get("has_dir", False), "dir_rel": sc.get("dir_rel"),
            "has_replay": sc.get("has_replay", False),
            "has_script": sc.get("has_script", False),
            "evidence": sc.get("evidence", []), "result": sc.get("result"),
        })

    regressions, regr_file = load_regressions(req)
    metrics = compute_metrics(acs, steps, step_spec, regressions, ttl)
    risks = detect_risks(req.name, acs, regressions, steps, step_spec, ttl)

    parts = req.name.split("-")
    branch = parts[0] if parts else ""
    rid, name = _split_name(req.name)   # 按 split("-") 永远匹配不到「CP-58118」这种带连字符的票号
    if handover.get("parentIssue") and not rid:
        rid = handover["parentIssue"]

    # 前端不需要完整 by_ac（已摊到每条 AC）；去掉以免 payload 膨胀
    # 保留 mapping + jiraActions 供前端按 Subtask 重算用例列；by_ac / jira_by_key 可由前端推导
    ho_pub = {k: v for k, v in handover.items() if k not in ("by_ac", "jira_by_key")}
    ho_pub["mapping_n"] = handover.get("total_map") or 0

    return {
        "folder": req.name, "name": name, "id": rid or req.name, "branch": branch,
        "workflow": workflow, "path": str(req),
        "registry_rel": f"{req.name}/tests/.verify-state.json",
        "handover_rel": f"{req.name}/{HANDOVER_FILE}",
        "handover": ho_pub,
        "has_checklist": ck_path.exists(), "registry_error": reg_err,
        "qa": load_qa(req),
        "ui_images": sorted((f"{req.name}/UI/{x.name}" for x in (req / "UI").iterdir()
                             if x.suffix.lower() in UI_IMG_EXT), key=lambda s: s) if (req / "UI").is_dir() else [],
        "unnumbered": unnumbered, "has_ac_ids": bool(ck_items),
        "has_tests_dir": tests.is_dir(),
        "generated_at": now_iso(),
        "step_spec": [[n, t] for n, t in step_spec],
        "steps": steps, "last_step": last_step, "step_files": collect_step_files(req),
        "acs": acs, "metrics": metrics, "risks": risks, "regressions": regressions,
        "regression_rel": (f"{req.name}/{regr_file}" if regr_file else None),
        "regression_file": regr_file,
        "counts": {"risks_high": sum(1 for r in risks if r["level"] == "high"),
                   "risks_total": len(risks)},
    }


def discover_requirements(develop: Path, excludes):
    out, skipped = [], []
    ex = {e.lower() for e in excludes}
    for p in sorted(develop.iterdir(), key=lambda x: x.name.lower()):
        if not p.is_dir() or p.name.startswith(".") or p.name.lower() in ex:
            continue
        looks = ((p / ".workflow-state.json").exists()
                 or (p / "tests").is_dir()
                 or any(p.glob("Step *-Checklist.md"))
                 or any(p.glob("Step 1-*.md")))
        (out if looks else skipped).append(p)
    return out, skipped


# ------------------------------------------------------------ HTML 模板

PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1f2328;--muted:#6b7280;--line:#e5e7eb;--head:#0f172a;
--pend:#6b7280;--run:#2563eb;--fix:#d97706;--pass:#16a34a;--fail:#dc2626;--blk:#9333ea;
--part:#0d9488;--ro:#0891b2;--skip:#9ca3af;--hi:#dc2626;--mid:#d97706;--lo:#ca8a04;
--track:#eef1f5}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--card:#171b21;--fg:#e6e8eb;--muted:#9aa4b1;
--line:#2a313a;--head:#e6e8eb;--track:#242b34;--pend:#9ca3af;--run:#60a5fa;--fix:#fbbf24;
--pass:#4ade80;--fail:#f87171;--blk:#c084fc;--part:#2dd4bf;--ro:#22d3ee;--skip:#6b7280;
--hi:#f87171;--mid:#fbbf24;--lo:#facc15}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
font:14px/1.55 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
a{color:var(--run);text-decoration:none}a:hover{text-decoration:underline}
.top{position:sticky;top:0;z-index:20;background:var(--card);border-bottom:1px solid var(--line);
padding:10px 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.top h1{font-size:16px;margin:0;color:var(--head);max-width:min(560px,45vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.clip{display:inline-block;max-width:min(560px,45vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
.top .sp{flex:1}
#rsel{width:min(420px,40vw);max-width:100%;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
select,button,input{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);
border-radius:8px;padding:5px 8px}
button{cursor:pointer}button:hover{border-color:var(--run)}
.live{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--pass);display:inline-block}
.dot.down{background:var(--fail)}.dot.warn{background:var(--fix)}.dot.idle{background:var(--skip)}
main{padding:16px 20px 60px;max-width:1500px;margin:0 auto}
.tabs{display:flex;gap:6px;border-bottom:1px solid var(--line);margin:14px 0 16px;flex-wrap:wrap}
.tabs button{border:none;background:none;padding:8px 12px;color:var(--muted);border-bottom:2px solid transparent}
.tabs button.on{color:var(--fg);border-bottom-color:var(--run);font-weight:600}
.grid{display:grid;gap:12px}
.cards{grid-template-columns:repeat(auto-fill,minmax(168px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;
border-left:4px solid var(--line)}
.card.tone-pass{border-left-color:var(--pass)}.card.tone-fail{border-left-color:var(--fail)}
.card.tone-run{border-left-color:var(--run)}.card.tone-fix{border-left-color:var(--fix)}
.card.tone-blk{border-left-color:var(--blk)}.card.tone-ho{border-left-color:#0ea5e9}
.card.tone-mute{border-left-color:var(--pend)}
.card .k{font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.2px}
.card .v{font-size:28px;font-weight:800;margin-top:4px;color:var(--head);line-height:1.15;
font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.card .v .den{font-size:15px;font-weight:600;color:var(--muted);margin-left:2px}
.card .v-pass,.card.tone-pass .v{color:var(--pass)}
.card .v-fail,.card.tone-fail .v{color:var(--fail)}
.card .v-run,.card.tone-run .v{color:var(--run)}
.card .v-fix,.card.tone-fix .v{color:var(--fix)}
.card .v-blk,.card.tone-blk .v{color:var(--blk)}
.card .v-ho,.card.tone-ho .v{color:#0284c7}
@media (prefers-color-scheme:dark){.card .v-ho,.card.tone-ho .v{color:#38bdf8}}
.card .s{font-size:11px;color:var(--muted);margin-top:4px}
.statn{font-weight:800;font-variant-numeric:tabular-nums;font-size:15px}
.statn.pass{color:var(--pass)}.statn.fail{color:var(--fail)}.statn.run{color:var(--run)}
.statn.fix{color:var(--fix)}.statn.mute{color:var(--muted)}.statn.ho{color:#0284c7}
.agg-row{display:flex;flex-wrap:wrap;gap:10px 18px;margin:10px 0 4px;align-items:baseline}
.agg-row .item{display:flex;flex-direction:column;gap:2px;min-width:72px}
.agg-row .item .lab{font-size:11px;color:var(--muted);font-weight:600}
.agg-row .item .num{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1}
.ho-banner{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;padding:10px 14px;
border-radius:10px;border:1px solid var(--line);background:rgba(14,165,233,.08);margin-bottom:12px}
.ho-banner .big{font-size:18px;font-weight:800}
.b-ho-pend{color:#0369a1;border-color:#0ea5e9;background:rgba(14,165,233,.12)}
.b-ho-wait{color:#92400e;background:rgba(217,119,6,.18);border-color:var(--fix)}
.b-ho-ok{color:#fff;background:#0284c7;border-color:#0284c7}
.b-ho-skip{color:#fff;background:#64748b;border-color:#64748b}
.b-ho-none{color:var(--muted);border-color:var(--line)}
.subkey{font-family:ui-monospace,Consolas,monospace;font-weight:700;color:#0369a1;
font-size:12.5px;white-space:nowrap}
@media (prefers-color-scheme:dark){.subkey{color:#7dd3fc}.b-ho-pend{color:#7dd3fc}}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px}
.panel h3{margin:0 0 10px;font-size:14px;color:var(--head)}
.bar{height:10px;background:var(--track);border-radius:6px;overflow:hidden;display:flex}
.bar>i{height:100%;display:block}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:8px;
align-items:center}
.legend span{display:inline-flex;align-items:center;gap:4px}
.legend .ln{font-weight:800;font-variant-numeric:tabular-nums;color:var(--fg);font-size:13px}
.legend i{width:9px;height:9px;border-radius:2px;display:inline-block;margin-right:2px;
background-color:rgba(128,128,128,.22);flex-shrink:0}
.bar>i{background-color:transparent}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid transparent;
white-space:nowrap;transition:background-color .25s,color .25s}
.b-pend{color:var(--pend);border-color:var(--pend)}
.b-run{color:#fff;background:var(--run);border-color:var(--run)}
.b-run::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#fff;
margin-right:5px;animation:pulse 1.2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
.b-fix{color:#1f2328;background:var(--fix);border-color:var(--fix)}
.b-pass{color:#fff;background:var(--pass);border-color:var(--pass)}
.b-fail{color:#fff;background:var(--fail);border-color:var(--fail)}
.b-blk{color:#fff;background:var(--blk);border-color:var(--blk)}
.b-part{color:#fff;background:var(--part);border-color:var(--part)}
.b-ro{color:var(--ro);border:1px dashed var(--ro)}
.b-skip{color:var(--skip);border-color:var(--skip);text-decoration:line-through}
.b-unk{color:var(--muted);border-color:var(--line)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;position:sticky;top:52px;background:var(--card);z-index:5}
tbody tr:hover{background:rgba(127,127,127,.07)}
tr.detail td{background:rgba(127,127,127,.05)}
.mono{font-family:ui-monospace,Consolas,monospace}
.muted{color:var(--muted)}.small{font-size:12px}
.risk{border-left:3px solid var(--line);padding:6px 10px;margin:6px 0;border-radius:0 8px 8px 0;
background:rgba(127,127,127,.06)}
.risk.high{border-color:var(--hi)}.risk.medium{border-color:var(--mid)}.risk.low{border-color:var(--lo)}
.risk .txt{font-size:13px}.risk code{font-size:12px;display:block;margin-top:4px;color:var(--muted);
word-break:break-all}
.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.thumbs a{display:block;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--card)}
.thumbs img{display:block;width:150px;height:96px;object-fit:cover}
.thumbs .cap{font-size:11px;color:var(--muted);padding:3px 6px;max-width:150px;overflow:hidden;
text-overflow:ellipsis;white-space:nowrap}
.evfile{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:8px;
padding:3px 8px;margin:3px 4px 0 0;font-size:12px}
.tl{position:relative;height:22px;background:var(--track);border-radius:6px;margin:3px 0}
.tl>span{position:absolute;top:0;bottom:0;border-radius:6px;min-width:3px}
pre.gwt{white-space:pre-wrap;background:rgba(127,127,127,.07);border-radius:8px;padding:8px 10px;
font-size:12px;margin:6px 0;font-family:ui-monospace,Consolas,monospace}
.banner{border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;border:1px solid var(--line)}
.banner.warn{background:rgba(217,119,6,.12);border-color:var(--fix)}
.banner.err{background:rgba(220,38,38,.12);border-color:var(--fail)}
.stepbar{display:flex;flex-wrap:wrap;gap:6px}
.stepchip{border:1px solid var(--line);border-radius:8px;padding:4px 8px;font-size:12px;background:none;color:inherit;font-family:inherit}
button.stepchip{cursor:pointer}button.stepchip:hover{background:rgba(127,127,127,.12)}
.stepchip.sel{outline:2px solid var(--run);outline-offset:1px}
.stepchip .fc{opacity:.65;margin-left:4px}
.stepfiles{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.stepfiles button{border:1px dashed var(--line);border-radius:6px;padding:4px 8px;font-size:12px;background:none;color:inherit;cursor:pointer}
.stepfiles button:hover{border-style:solid}
.stepchip.ok{border-color:var(--pass);color:var(--pass)}
.stepchip.no{border-color:var(--fail);color:var(--fail)}
.stepchip.none{color:var(--muted)}
.pf{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.hint{font-size:12px;color:var(--muted)}
.evlink{cursor:pointer}
.evlink:hover{text-decoration:underline;color:var(--run)}
.det{display:flex;flex-direction:column;gap:12px}
.det-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 10px;
background:rgba(127,127,127,.08);border-radius:10px}
.det-actions .lbl{font-size:12px;color:var(--muted)}
.det-actions .lbl.sep{margin-left:12px;padding-left:12px;border-left:1px solid var(--line)}
.btn{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:5px 12px;
font-size:12.5px;cursor:pointer;color:var(--fg);transition:border-color .15s,color .15s}
.btn:hover{border-color:var(--run);color:var(--run)}
.btn.primary{background:var(--run);border-color:var(--run);color:#fff}
.btn.primary:hover{color:#fff;filter:brightness(1.08)}
.chip{display:inline-block;padding:1px 9px;border-radius:999px;border:1px solid var(--line);font-size:12px}
.chip.ok{border-color:var(--pass);color:var(--pass)}
.chip.bad{border-color:var(--fail);color:var(--fail)}
.chip.mute{color:var(--muted)}
.det-grid{display:grid;grid-template-columns:minmax(300px,1.1fr) minmax(280px,1fr);gap:12px}
@media(max-width:1100px){.det-grid{grid-template-columns:1fr}}
.det-sec{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.det-sec h4{margin:0 0 8px;font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.3px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0;font-size:12.5px}
.kv dt{color:var(--muted);white-space:nowrap}
.kv dd{margin:0;word-break:break-word}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:100;display:none;backdrop-filter:blur(2px)}
.modal.open{display:flex;align-items:center;justify-content:center;padding:5vh 4vw}
.modal-box{background:var(--card);border:1px solid var(--line);border-radius:12px;max-width:1400px;
width:100%;display:flex;flex-direction:column;height:88vh;max-height:88vh;overflow:hidden}
.modal-head{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);
background:var(--card);border-radius:12px 12px 0 0;font-size:13px}
.modal-head .ttl{font-weight:600;word-break:break-all;font-family:ui-monospace,Consolas,monospace}
.modal-head .sp{flex:1}
.ev-foot{display:none;align-items:center;justify-content:center;gap:16px;padding:10px 14px;
border-top:1px solid var(--line);flex:none}
.ev-foot button{width:44px;height:44px;border-radius:50%;border:1px solid var(--line);background:var(--card);
color:inherit;font-size:26px;line-height:40px;padding:0;cursor:pointer;user-select:none}
.ev-foot button:hover:not(:disabled){border-color:var(--accent,#4c8bf5);color:var(--accent,#4c8bf5)}
.ev-foot button:disabled{opacity:.3;cursor:default}
.ev-foot .ev-pos{font-size:14px;min-width:64px;text-align:center}
.ev-pos{font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted,#888);white-space:nowrap}
.modal-body{padding:12px 14px;overflow:auto;flex:1;min-height:0}
.modal-body img{max-width:100%;height:auto;display:block;margin:0 auto;background:#fff;border-radius:6px}
.modal-body video{max-width:100%;max-height:74vh;display:block;margin:0 auto;background:#000;border-radius:6px}
.modal-body pre{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.55;margin:0;
background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;max-height:72vh;overflow:auto;
font-family:ui-monospace,Consolas,monospace}
.view-toggle{display:none;gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.view-toggle button{border:none;border-radius:0;background:transparent;padding:4px 10px;font-size:12px}
.view-toggle button.on{background:var(--run);color:#fff}
.md-view{font-size:13.5px;line-height:1.65;max-height:72vh;overflow:auto;padding:4px 2px}
.md-view h1,.md-view h2,.md-view h3,.md-view h4{margin:1.1em 0 .45em;line-height:1.3;color:var(--head)}
.md-view h1{font-size:1.45em}.md-view h2{font-size:1.25em;border-bottom:1px solid var(--line);padding-bottom:.25em}
.md-view h3{font-size:1.1em}.md-view h4{font-size:1em}
.md-view p{margin:.55em 0}.md-view ul,.md-view ol{margin:.45em 0 .45em 1.3em;padding:0}
.md-view li{margin:.2em 0}.md-view hr{border:none;border-top:1px solid var(--line);margin:1em 0}
.md-view blockquote{margin:.6em 0;padding:.35em .9em;border-left:3px solid var(--run);color:var(--muted);
background:rgba(127,127,127,.06)}
.md-view code{font-family:ui-monospace,Consolas,monospace;font-size:.92em;background:rgba(127,127,127,.12);
padding:.1em .35em;border-radius:4px}
.md-view pre.md-code{background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;overflow:auto;
margin:.7em 0}.md-view pre.md-code code{background:none;padding:0;font-size:12px}
.md-view table{border-collapse:collapse;margin:.7em 0;font-size:12.5px;width:100%}
.md-view th,.md-view td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
.md-view th{background:rgba(127,127,127,.08);font-weight:600}
.md-view a{color:var(--run)}
details summary{cursor:pointer;color:var(--muted)}
.qa-card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0;background:var(--card)}
.qa-card.pm{border-left:4px solid var(--fix)}.qa-card.chg{border-left:4px solid var(--run)}
.qa-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.qa-head .qid{font-weight:800;font-variant-numeric:tabular-nums}
.qa-head .qt{font-weight:600;flex:1;min-width:200px}
.qa-sec{margin-top:8px}.qa-sec .lab{font-size:12px;color:var(--muted);font-weight:600;margin-bottom:2px}
.qa-txt{line-height:1.65}
.qa-opts{list-style:none;margin:2px 0;padding:0}.qa-opts li{padding:4px 8px;border-radius:6px;margin:2px 0;border:1px solid transparent}
.qa-opts li.on{border-color:var(--pass);background:rgba(22,163,74,.08);font-weight:600}
.qa-opts li .mk{display:inline-block;width:18px;color:var(--pass)}
.qa-card.editing{border-color:var(--run);box-shadow:0 0 0 1px var(--run)}
.qa-opts.pick li label{cursor:pointer;display:block}.qa-opts.pick li:hover{background:rgba(127,127,127,.07)}
.qa-ta{width:100%;min-height:80px;font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--run);border-radius:8px;padding:6px 8px}
.qa-save{border-color:var(--run)!important;color:var(--run);font-weight:600}
.qa-form{margin-top:10px;padding:10px;border:1px dashed var(--run);border-radius:8px}
.qa-form textarea{width:100%;min-height:90px;font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
.qa-form label{display:block;margin:3px 0;cursor:pointer}
.qa-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.st-已定{color:var(--pass);border-color:var(--pass)}.st-待PM确认{color:var(--fix);border-color:var(--fix)}.st-PM已确认{color:var(--ro);border-color:var(--ro)}
.figbar{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 8px}
.figbar .fig{flex:0 0 auto;width:190px;cursor:pointer;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--card)}
.figbar .fig:hover{border-color:var(--run)}
.figbar img{width:100%;height:110px;object-fit:cover;object-position:top left;display:block}
.figbar .cap{font-size:12px;padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.figac{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
.figac .fig{width:min(760px,100%);cursor:zoom-in;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.figac img{width:100%;display:block}
</style></head>
<body>
<header class="top">
  <h1 id="title">验证进度看板</h1>
  <span id="switcher"></span>
  <span class="sp"></span>
  <span class="live"><span class="dot idle" id="dot"></span><span id="liveTxt">初始化…</span></span>
  <button id="refresh">立即刷新</button>
  <button id="theme">主题</button>
</header>
<main id="app"></main>
<div id="modal" class="modal" onclick="if(event.target===this)closeModal()">
  <div class="modal-box">
    <div class="modal-head">
      <span class="ttl" id="modal-title"></span>
      <span class="sp"></span>
      <span class="view-toggle" id="modal-view-toggle">
        <button type="button" id="btn-md-preview" class="on" onclick="setMdView('preview')">预览</button>
        <button type="button" id="btn-md-source" onclick="setMdView('source')">原文</button>
      </span>
      <a id="modal-raw" href="#" target="_blank" rel="noopener">新标签打开 ↗</a>
      <button onclick="closeModal()">关闭 ✕</button>
    </div>
    <div class="modal-body" id="modal-body"></div>
    <div class="ev-foot" id="modal-nav">
      <button type="button" id="nav-prev" onclick="navStep(-1)" title="上一个（←）">‹</button>
      <span class="ev-pos" id="modal-pos"></span>
      <button type="button" id="nav-next" onclick="navStep(1)" title="下一个（→）">›</button>
    </div>
  </div>
</div>
<script type="application/json" id="payload">__DATA__</script>
<script>
const BASE="__BASE__";
const PAYLOAD=JSON.parse(document.getElementById('payload').textContent);
const REQS=PAYLOAD.reqs||[];
const MULTI=REQS.length>1||!!PAYLOAD.is_index;
const ARCH=PAYLOAD.archived||[];
const POLL_MS=parseInt(new URLSearchParams(location.search).get('interval')||'5000',10);
const STATUS_ORDER=["待验证","验证中","修复中","通过","失败","阻塞","部分","走读证据","跳过"];
const ST_CLS={"待验证":"b-pend","验证中":"b-run","修复中":"b-fix","通过":"b-pass","失败":"b-fail",
"阻塞":"b-blk","部分":"b-part","走读证据":"b-ro","跳过":"b-skip"};
// 证据终验：独立于验证状态的维度（只核对证据内容是否支撑结论，不重跑浏览器）
const FC_ORDER=["未终验","终验中","终验通过","终验不通过","豁免"];
const FC_CLS={"未终验":"b-unk","终验中":"b-run","终验通过":"b-pass","终验不通过":"b-fail","豁免":"b-ro"};
// 需求级门控：未进入/待匹配/已匹配待确认/已提测/无需提测
// Subtask 级用例列额外：未匹配/待提测/提测失败/待补记
const HO_CLS={"未进入":"b-ho-none","待匹配":"b-ho-pend","已匹配待确认":"b-ho-wait",
"待提测":"b-ho-wait","未匹配":"b-ho-none","待补记":"b-ho-wait",
"已提测":"b-ho-ok","无需提测":"b-ho-skip","提测失败":"b-fail"};
// 终验通过 = 「证据支撑结论」，不等于 AC 通过：阻塞 / 失败 / 部分 的终验通过要把结论带出来，
// 否则看板上阻塞项也是一片绿色「终验通过」，读者会误以为功能已过
function fbadge(s,st){s=s||"未终验";
if(s==="终验通过"&&st&&st!=="通过")return '<span class="badge b-run" title="证据支撑「'+esc(st)+'」这一结论，不代表 AC 通过">'+esc(st)+'成立</span>';
return '<span class="badge '+(FC_CLS[s]||"b-unk")+'">'+esc(s)+'</span>';}
function hbadge(s){s=s||"未进入";return '<span class="badge '+(HO_CLS[s]||"b-ho-none")+'">'+esc(s)+'</span>';}
function latestJiraByKey(acts){const out={};(acts||[]).forEach(a=>{
const k=(a&&(a.subtaskKey||a.key)||"").trim();if(k)out[k]=a;});return out;}
function resolveAcHo(demand,subKey,jiraByKey){
const ds=demand||"未进入";if(ds==="未进入")return"未进入";if(ds==="无需提测")return"无需提测";
if(!subKey)return"未匹配";const act=jiraByKey[subKey];
if(act){const t=act.transition,a=act.assign;
if(t==="ok"||a==="ok"){if((t&&t!=="ok")||(a&&a!=="ok"))return"提测失败";return"已提测";}
return"提测失败";}
if(ds==="已提测")return"待补记";if(ds==="已匹配待确认")return"待提测";
if(ds==="待匹配")return"待匹配";return ds;}
function applyHandover(req){const ho=req.handover||{};const ds=ho.status||"未进入";
const jbk=latestJiraByKey(ho.jiraActions);const by={};
(ho.mapping||[]).forEach(row=>{if(!row)return;const ac=normAc(row.ac||row.AC||"");
if(!ac)return;by[ac]={subtaskKey:(row.subtaskKey||row.key||"").trim(),
subtaskSummary:row.subtaskSummary||row.summary||"",match:row.match||""};});
(req.acs||[]).forEach(a=>{const m=by[a.token]||by[normAc(a.token)];
if(m){a.subtaskKey=m.subtaskKey||a.subtaskKey||"";a.subtaskSummary=m.subtaskSummary||a.subtaskSummary||"";
if(m.match)a.subtaskMatch=m.match;}
a.handoverStatus=resolveAcHo(ds,a.subtaskKey||"",jbk);});}
function fchip(s){return '<button class="'+(state.filter.fc.has(s)?'on':'')+
'" onclick="ffc(this.dataset.s)" data-s="'+esc(s)+'">'+fbadge(s)+'</button>';}
function hoTone(s){return ({"已提测":"ho","无需提测":"mute","已匹配待确认":"fix","待匹配":"run","未进入":"mute"})[s]||"mute";}
const CK_LABEL={open:"open",done:"done",blocked:"blocked",waived:"waived（放行）",none:"—"};
const state={arch:false,sel:0,tab:"overview",filter:{status:new Set(),fc:new Set(),q:"",risk:false,ev:false,rv:new Set()},
  open:new Set(),openR:new Set(),registry:{},lastSig:null,served:location.protocol.startsWith('http'),fail:0,noReg:false,view:"all",
  api:null,snapSig:{},qaEdit:null,qaMsg:"",tick:0};
const REGR_V={pass:["通过","b-pass"],partial:["部分","b-fix"],not_run:["未跑","b-skip"],
waived:["豁免","b-ro"],unknown:["无结论","b-unk"]};
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",
">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
// 逐段编码：路径里可能有空格、中文、&、[]（需求目录名就带 &）
function evUrl(rel){return BASE+String(rel).split('/').map(encodeURIComponent).join('/');}
let modalText=null, modalIsMd=false, mdViewMode='preview';
function mdInline(s){s=esc(s);const code=[];
// 代码片段先挖出来，避免 snake_case / *ptr 被当成强调吃掉
s=s.replace(/`([^`]+)`/g,(_,c)=>{code.push('<code>'+c+'</code>');return '\u0000'+(code.length-1)+'\u0000';});
s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
s=s.replace(/(^|[^\w])__([^_]+)__(?!\w)/g,'$1<strong>$2</strong>');
s=s.replace(/\*([^*\s][^*]*)\*/g,'<em>$1</em>');
s=s.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g,'$1<em>$2</em>');
s=s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
return s.replace(/\u0000(\d+)\u0000/g,(_,i)=>code[+i]);}
function mdIsSep(line){return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line||'');}
function mdToHtml(src){
src=String(src||'').replace(/\r\n?/g,'\n');
const fences=[];
src=src.replace(/```([\w-]*)\n([\s\S]*?)```/g,(_,lang,code)=>{
const i=fences.length;fences.push('<pre class="md-code"><code>'+esc(code.replace(/\n$/,''))+'</code></pre>');
return '\n%%F'+i+'%%\n';});
const lines=src.split('\n');let html='',i=0;
const isBlockStart=l=>{const t=(l||'').trim();
return !t||/^%%F\d+%%$/.test(t)||/^#{1,6}\s/.test(l)||/^(-{3,}|\*{3,}|_{3,})$/.test(t)||
/^\|/.test(t)||/^>\s?/.test(l)||/^[-*+]\s+/.test(l)||/^\d+\.\s+/.test(l);};
while(i<lines.length){
const line=lines[i], trim=line.trim();
const fm=/^%%F(\d+)%%$/.exec(trim);
if(fm){html+=fences[+fm[1]]||'';i++;continue;}
if(!trim){i++;continue;}
const hm=/^(#{1,6})\s+(.*)$/.exec(line);
if(hm){const n=hm[1].length;html+='<h'+n+'>'+mdInline(hm[2])+'</h'+n+'>';i++;continue;}
if(/^(-{3,}|\*{3,}|_{3,})$/.test(trim)){html+='<hr>';i++;continue;}
if(/^\|/.test(trim)&&i+1<lines.length&&mdIsSep(lines[i+1].trim())){
const rows=[];while(i<lines.length&&/^\|/.test(lines[i].trim())){rows.push(lines[i]);i++;}
if(rows.length>=2){const split=r=>r.replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
const head=split(rows[0]);const bodyRows=rows.slice(2).map(split);
html+='<table><thead><tr>'+head.map(c=>'<th>'+mdInline(c)+'</th>').join('')+'</tr></thead><tbody>'+
bodyRows.map(r=>'<tr>'+r.map(c=>'<td>'+mdInline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
continue;}
if(/^>\s?/.test(line)){const buf=[];while(i<lines.length&&/^>\s?/.test(lines[i])){buf.push(lines[i].replace(/^>\s?/,''));i++;}
html+='<blockquote>'+mdInline(buf.join(' '))+'</blockquote>';continue;}
if(/^[-*+]\s+/.test(line)||/^\d+\.\s+/.test(line)){const ordered=/^\d+\.\s+/.test(line);
const tag=ordered?'ol':'ul';const buf=[];
while(i<lines.length&&(ordered?/^\d+\.\s+/.test(lines[i]):/^[-*+]\s+/.test(lines[i]))){
buf.push(lines[i].replace(ordered?/^\d+\.\s+/:/^[-*+]\s+/,''));i++;}
html+='<'+tag+'>'+buf.map(x=>'<li>'+mdInline(x)+'</li>').join('')+'</'+tag+'>';continue;}
const para=[line];i++;
while(i<lines.length&&!isBlockStart(lines[i])){para.push(lines[i]);i++;}
html+='<p>'+mdInline(para.join(' '))+'</p>';}
return html||'<p class="muted">（空文件）</p>';}
function setMdView(mode){mdViewMode=mode==='source'?'source':'preview';
const p=document.getElementById('btn-md-preview'),s=document.getElementById('btn-md-source');
if(p)p.classList.toggle('on',mdViewMode==='preview');
if(s)s.classList.toggle('on',mdViewMode==='source');
renderModalText();}
function renderModalText(){const body=document.getElementById('modal-body');if(!body||modalText==null)return;
if(modalIsMd&&mdViewMode==='preview'){body.innerHTML='<div class="md-view">'+mdToHtml(modalText)+'</div>';}
else{body.innerHTML='<pre></pre>';body.firstChild.textContent=modalText;}}
function openEv(relEnc,type,title,keepNav){
  const rel=decodeURIComponent(relEnc||''), url=evUrl(rel), name=title||rel.split('/').pop();
  if(!keepNav){navList=buildNav(rel);navIdx=navList.findIndex(x=>x.rel===rel);}
  showNav();
  const m=document.getElementById('modal'), body=document.getElementById('modal-body');
  const tog=document.getElementById('modal-view-toggle');
  document.getElementById('modal-title').textContent=name;
  document.getElementById('modal-raw').href=url;
  modalText=null;modalIsMd=false;mdViewMode='preview';
  if(tog)tog.style.display='none';
  m.classList.add('open');
  if(type==='image'){body.innerHTML='<img alt="" src="'+url+'">';return;}
  if(type==='video'){body.innerHTML='<video controls autoplay preload="metadata" src="'+url+'"></video>';return;}
  // 快照漏标类型时：按扩展名兜底（evidence 里的 .md 曾被标成 other）
  const ext=(name.split('.').pop()||'').toLowerCase();
  const asText=type==='json'||type==='har'||type==='log'||type==='data'||type==='md'
    ||['md','markdown','txt','text','rst','csv','log','json','har','sql'].includes(ext);
  const isMd=type==='md'||['md','markdown','rst'].includes(ext);
  if(asText){
    body.innerHTML='<div class="muted">加载中…</div>';
    fetch(url,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text();})
      .then(t=>{modalText=t;modalIsMd=isMd;mdViewMode='preview';
        if(tog){tog.style.display=isMd?'inline-flex':'none';
          const bp=document.getElementById('btn-md-preview'),bs=document.getElementById('btn-md-source');
          if(bp)bp.classList.toggle('on',true);if(bs)bs.classList.toggle('on',false);}
        renderModalText();})
      .catch(e=>{body.innerHTML='<div class="banner warn">无法内联预览（'+esc(e.message)+'）。'+
        (location.protocol==='file:'?'<br>file:// 下浏览器禁止读取本地文件：请用 http 打开看板（导航页 /develop/ 或 8787），或点右上角「新标签打开 ↗」。':'')+
        '</div>';});
    return;
  }
  body.innerHTML='<div class="banner warn">该类型不支持内联预览（如 Excel / 压缩包 / 二进制）：请点右上角「新标签打开 ↗」。</div>';
}
// 同一 AC 内左右切换：RESULT / REPLAY / case.md + 全部 evidence（不受缩略图 12 张截断影响）
let navList=[], navIdx=-1;
function acOfRel(rel){const req=REQS[state.sel];if(!req)return null;
  return (req.acs||[]).find(a=>a.dir_rel&&rel.startsWith(a.dir_rel+'/'))||null;}
function buildNav(rel){
  // 标注图（需求目录 UI/ 下）：整组可左右切换
  const req0=REQS[state.sel];const ims=(req0&&req0.ui_images)||[];
  if(ims.includes(rel))return ims.map(r=>({rel:r,type:'image',title:String(r).split('/').pop().replace(/\.(png|jpe?g|gif|webp)$/i,'')}));
  const sf=(req0&&req0.step_files)||{};
  for(const k in sf){if(sf[k].some(f=>f.rel===rel))return sf[k].map(f=>({rel:f.rel,type:f.type,title:f.name}));}
  const a=acOfRel(rel);if(!a)return [];
  const L=[{rel:a.dir_rel+'/RESULT.md',type:'md',title:'RESULT.md · '+a.token}];
  if(a.has_replay)L.push({rel:a.dir_rel+'/REPLAY.md',type:'md',title:'REPLAY.md · '+a.token});
  L.push({rel:a.dir_rel+'/case.md',type:'md',title:'case.md · '+a.token});
  (a.evidence||[]).forEach(e=>L.push({rel:e.rel,type:e.type,title:e.name}));
  return L;}
function showNav(){const nav=document.getElementById('modal-nav'),pos=document.getElementById('modal-pos');
  const pv=document.getElementById('nav-prev'),nx=document.getElementById('nav-next');if(!nav)return;
  const on=navList.length>=2&&navIdx>=0;
  nav.style.display=on?'flex':'none';
  if(!on)return;pos.textContent=(navIdx+1)+' / '+navList.length;
  pv.disabled=navIdx<=0;nx.disabled=navIdx>=navList.length-1;}
function navStep(d){const j=navIdx+d;if(j<0||j>=navList.length)return;navIdx=j;const x=navList[j];
  openEv(encodeURIComponent(x.rel),x.type,x.title,true);}
function closeModal(){navList=[];navIdx=-1;showNav();const m=document.getElementById('modal');m.classList.remove('open');
  const b=document.getElementById('modal-body');if(b)b.innerHTML='';
  const tog=document.getElementById('modal-view-toggle');if(tog)tog.style.display='none';
  modalText=null;modalIsMd=false;}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();
  if(!document.getElementById('modal').classList.contains('open'))return;
  if(e.key==='ArrowLeft'){e.preventDefault();navStep(-1);}else if(e.key==='ArrowRight'){e.preventDefault();navStep(1);}});
document.addEventListener('click',e=>{const t=e.target.closest('[data-ev]');if(!t)return;
  e.preventDefault();e.stopPropagation();openEv(t.dataset.ev,t.dataset.type,t.dataset.title||'');});
function pct(x){return x==null?"—":(x*100).toFixed(0)+"%";}
function badge(s){const c=ST_CLS[s]||"b-unk";return '<span class="badge '+c+'">'+esc(s)+'</span>';}
function dur(s){s=Math.max(0,Math.round(s));if(s<60)return s+"s";const m=Math.floor(s/60);
if(m<60)return m+"m"+(s%60?(s%60)+"s":"");const h=Math.floor(m/60);return h+"h"+(m%60)+"m";}
function ts(x){if(!x)return"—";const d=new Date(x);if(isNaN(d))return esc(x);const p=n=>String(n).padStart(2,'0');
return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes());}
function ago(x){if(!x)return"";const d=new Date(x);if(isNaN(d))return"";const s=(Date.now()-d)/1000;
return s<60?Math.round(s)+"s 前":s<3600?Math.round(s/60)+"m 前":Math.round(s/3600)+"h 前";}
function normAc(t){const m=/(\d{1,3})/.exec(t||'');return m?'AC-'+String(+m[1]).padStart(2,'0'):String(t||'').toUpperCase();}
function mergeRegistry(req){const reg=state.registry[req.folder]||{};const cases=reg.cases||{};
const byTok={};Object.keys(cases).forEach(k=>{byTok[normAc(k)]=cases[k];});
req.acs.forEach(a=>{const c=byTok[a.token]||byTok[normAc(a.token)];if(c){a.status=c.status||a.status;
a.session=c.session;a.window=c.window;a.engine=c.engine;a.started_at=c.started_at; a.finished_at=c.finished_at;
a.updated_at=c.updated_at;a.note=c.note||a.note;a.live=true;
a.final_status=c.final_status||a.final_status;a.final_by=c.final_by;a.final_at=c.final_at;
a.final_note=c.final_note||a.final_note;}});}
function metrics(req){const cs=req.acs;const total=cs.length;const cnt={};STATUS_ORDER.forEach(s=>cnt[s]=0);
let ck={open:0,done:0,blocked:0,waived:0,none:0},ev=0,med=0;
cs.forEach(a=>{cnt[a.status]!==undefined?cnt[a.status]++:cnt["待验证"]++;
ck[a.ck||"none"]=(ck[a.ck||"none"]||0)+1;(a.evidence||[]).forEach(e=>{ev++;if(e.type==='image'||e.type==='video')med++;});});
const decided=cnt["通过"]+cnt["失败"]+cnt["阻塞"]+cnt["部分"];
// 终验：只统计「已完结」的 AC（待验证/验证中/修复中 没什么可终验的）
const fc={};FC_ORDER.forEach(s=>fc[s]=0);let fcBase=0;
cs.forEach(a=>{const s=a.final_status||"未终验";fc[s]!==undefined?fc[s]++:fc["未终验"]++;
if(["通过","失败","阻塞","部分","走读证据","跳过"].includes(a.status))fcBase++;});
const impl=total?ck.done/total:0, coverage=total?(total-cnt["待验证"])/total:0;
const passRate=decided?cnt["通过"]/decided:null;
const regs=req.regressions||[];const rd=regs.filter(r=>r.ok).length;const rr=regs.length?rd/regs.length:null;
const stepsOk=(req.step_spec||[]).filter(([n])=>((req.steps||{})[String(n)]||{}).passed).length;
const progress=0.5*impl+0.3*(passRate||0)+0.2*(rr||0);
let work=0,wall=null,inflight=0,start=[],finish=[];
cs.forEach(a=>{const s=a.started_at?new Date(a.started_at):null,e=a.finished_at?new Date(a.finished_at):(a.updated_at?new Date(a.updated_at):null);
if(s&&!isNaN(s))start.push(s);if(a.finished_at&&!isNaN(new Date(a.finished_at)))finish.push(new Date(a.finished_at));
if(s&&e&&!isNaN(s)&&!isNaN(e))work+=Math.max(0,(e-s)/1000);
if((a.status==="验证中"||a.status==="修复中")&&s&&!isNaN(s))inflight=Math.max(inflight,(Date.now()-s)/1000);});
if(start.length&&finish.length)wall=(Math.max(...finish)-Math.min(...start))/1000;
return {total,cnt,ck,impl,coverage,passRate,regs,rd,rr,stepsOk,progress,ev,med,work,wall,inflight,fc,fcBase};}
function risks(req){const ttl=20,out=[];const now=Date.now();
req.acs.forEach(a=>{const st=a.status;
if(st==="失败"||st==="阻塞")out.push({l:"high",ac:a.token,t:"验证"+st+"："+(a.note||"见 RESULT.md")});
if((st==="验证中"||st==="修复中")){const u=a.updated_at?new Date(a.updated_at):null;
if(!u||isNaN(u)||(now-u)/60000>ttl)out.push({l:"high",ac:a.token,t:"「"+st+"」超过 "+ttl+" 分钟无更新（可能已中断），可 reclaim"});}
if(st==="通过"&&a.ck==="open")out.push({l:"medium",ac:a.token,r:"registry 已通过但 Checklist 未回写 [done]",t:"registry 已「通过」但 Checklist 仍 [open]（回写漏了）"});
if(a.ck==="done"&&(st==="失败"||st==="阻塞"))out.push({l:"medium",ac:a.token,r:"Checklist 已 [done] 但 registry 结论相反",t:"Checklist 已 [done] 但 registry 是「"+st+"」"});
if(st==="通过"&&a.has_dir&&!(a.evidence||[]).length)out.push({l:"medium",ac:a.token,r:"已判定但 evidence/ 为空",t:"判「通过」但 evidence/ 为空（未留证=未测）"});
if(a.has_dir&&!(a.has_replay||a.has_script))out.push({l:"low",ac:a.token,r:"缺复跑入口（REPLAY.md 或 script/）",t:"缺复跑入口（REPLAY.md 或 script/）"});
// 终验维度：不通过=高风险；「已完结却未终验」=低（看得到但不进高风控）
if(a.final_status==="终验不通过")out.push({l:"high",ac:a.token,t:"证据终验不通过："+(a.final_note||"证据不支撑结论")});
if(a.final_status==="终验中"){const u=a.final_at?new Date(a.final_at):null;
if(!u||isNaN(u)||(now-u)/60000>ttl)out.push({l:"low",ac:a.token,t:"「终验中」超过 "+ttl+" 分钟无更新（可能已中断），可重新 final"});}
if(["通过","失败","阻塞","部分","走读证据","跳过"].includes(a.status)&&(a.final_status||"未终验")==="未终验")
out.push({l:"low",ac:a.token,r:"已完结但未终验",t:"已完结但未终验（终验只核对证据内容，不用重跑浏览器）"});});
const ANYDIR=req.acs.some(x=>x.has_dir);
if(!ANYDIR&&req.acs.some(x=>["通过","失败","阻塞","部分","走读证据"].includes(x.status)))out.push({l:"medium",ac:null,t:"该需求没有 tests/AC-NN 证据目录（旧式产出：结论来自 Step 1x 报告，未按 AC 归档证据）"});
(req.regressions||[]).forEach(r=>{if(!r.ok)out.push({l:"medium",ac:r.token,t:"回归项无结论（未验证的 R-NN 与未实现 AC 同等对待）"});});
(req.step_spec||[]).forEach(([n,t])=>{const i=(req.steps||{})[String(n)]||{};
if((i.consecutive_fails||0)>2)out.push({l:"high",ac:null,t:"Step"+n+"（"+t+"）连续失败 "+i.consecutive_fails+" 次 —— 须停手问人"});});
const G={},F=[];out.forEach(x=>{(x.r&&x.ac)?(G[x.r]=G[x.r]||[]).push(x):F.push(x)});
Object.keys(G).forEach(k=>{const its=G[k];if(its.length<=5)F.push.apply(F,its);
else F.push({l:its[0].l,ac:null,t:its.length+" 条「"+k+"」："+its.slice(0,8).map(i=>i.ac).join(", ")+(its.length>8?" …":"")});});
return F;}
function bar(items){const total=items.reduce((s,i)=>s+i[1],0)||1;
return '<div class="bar">'+items.filter(i=>i[1]>0).map(i=>'<i style="width:'+(i[1]/total*100)+'%;background:'+i[2]+'"></i>').join('')+'</div>';}
function legend(items){return '<div class="legend">'+items.filter(i=>i[1]>0).map(i=>
'<span><i style="background:'+i[2]+'"></i>'+esc(i[0])+' <b class="ln">'+i[1]+'</b></span>').join('')+'</div>';}
// 「跳过」(NOT_RUN) 与「待验证」都是灰，实心色在小色块上几乎分不出，且深浅色主题下两者正好反色 ——
// 给「跳过」用斜纹：既能一眼区分，又不依赖颜色（色盲/打印同样可读）。
const HATCH="repeating-linear-gradient(45deg,var(--skip) 0 2px,transparent 2px 4px)";
const COL={"待验证":"var(--pend)","验证中":"var(--run)","修复中":"var(--fix)","通过":"var(--pass)",
"失败":"var(--fail)","阻塞":"var(--blk)","部分":"var(--part)","走读证据":"var(--ro)","跳过":HATCH};

function card(k,v,s,tone){return '<div class="card'+(tone?' tone-'+tone:'')+'"><div class="k">'+esc(k)+
'</div><div class="v'+(tone?' v-'+tone:'')+'">'+v+'</div><div class="s">'+esc(s||"")+'</div></div>';}
function frac(a,b){return a+'<span class="den">/'+b+'</span>';}
function sn(n,tone){return '<span class="statn '+(tone||'')+'">'+n+'</span>';}
function handoverOf(req){return req.handover||{status:"未进入",matched:0,total_map:0,unmatched:0,exists:false};}

function render(){const app=document.getElementById('app');const req=REQS[state.sel];
{const rs=document.getElementById('rsel');if(rs&&String(rs.value)!==String(state.sel)){rs.value=state.sel;rs.title=rs.options[rs.selectedIndex]?rs.options[rs.selectedIndex].title:'';}}
if(!req){if(PAYLOAD.is_index){state.view='all';app.innerHTML=renderAll();return;}app.innerHTML='<div class="panel">没有发现需求目录。</div>';return;}
REQS.forEach(r=>{mergeRegistry(r);applyHandover(r);});
let h="";
if(!state.served)h+='<div class="banner warn">以 <b>file://</b> 打开：浏览器会拦截本地 JSON 请求，<b>实时刷新不可用</b>，当前显示生成时快照（'+ts(PAYLOAD.generated_at)+'）。<br>起本地服务即可实时刷新：<code>python -m http.server 8787 --directory "'+esc(PAYLOAD.develop||'')+'"</code>，再访问 http://127.0.0.1:8787/index.html</div>';
if(state.noReg&&REQS.some(r=>r.has_tests_dir))h+='<div class="banner warn">尚未生成用例状态登记 <code>tests/.verify-state.json</code>，当前显示生成时快照。运行 <code>python scripts/verify_state.py init --dir "&lt;需求目录&gt;"</code> 后即可实时刷新。</div>';
else if(state.fail>=2)h+='<div class="banner err">连续 '+state.fail+' 次拉取用例状态失败，显示的数据可能过期。<button onclick="poll(true)">重试</button></div>';
if(MULTI&&state.view==="all"){app.innerHTML=h+renderAll();return;}
if(!req.acs.length)h+='<div class="banner warn"><b>该需求暂无可聚合的用例。</b>'+
(!req.has_checklist?'未找到 Step 3-Checklist.md。':(req.has_ac_ids?'':'Checklist 未使用 AC-NN 编号（旧格式：'+req.unnumbered+' 条只有前缀无编号），看板无法按 AC 聚合。'))+
(req.has_tests_dir?'':' 也没有 tests/ 证据目录（尚未进入实机验证）。')+'</div>';
if(MULTI){const fullName=(req.id?req.id+' · ':'')+req.name;
h+='<div class="pf"><button onclick="back()">← 全部需求</button><b class="clip" title="'+esc(fullName)+'">'+
esc(fullName)+'</b>'+
'<a class="evfile" style="margin-left:10px" target="_blank" href="'+evUrl(req.folder+'/验证进度看板.html')+'">在独立页打开 ↗</a></div>';}
const _rd=(req.regressions||[]).filter(r=>r.ok).length,_rn=(req.regressions||[]).length;
const _qa=req.qa||{},_qpm=(_qa.questions||[]).filter(q=>q["状态"]==="待PM确认").length,_qch=(_qa.pending||[]).length;
h+='<div class="tabs">'+[["overview","总览"],["qa","需求问答"+(_qa.exists?" "+(_qa.questions||[]).length:"")+(_qpm?" · 待PM "+_qpm:"")+(_qch?" · 待确认改动 "+_qch:"")],["cases","用例明细"],["evidence","证据"],
["regression","回归"+(_rn?" "+_rd+"/"+_rn:"")],["timeline","时间线"],["guide","说明"]]
.map(([k,t])=>'<button class="'+(state.tab===k?'on':'')+'" onclick="tab(\''+k+'\')">'+t+'</button>').join('')+'</div>';
h+='<div id="tabbody"></div>';
app.innerHTML=h;
const tb=document.getElementById('tabbody');
const VIEWS={overview:viewOverview,qa:viewQa,cases:viewCases,evidence:viewEvidence,regression:viewRegression,timeline:viewTimeline,guide:viewGuide};
try{tb.innerHTML=(VIEWS[state.tab]||viewOverview)(req);}
catch(e){tb.innerHTML='<div class="banner err"><b>渲染出错</b>：'+esc(e&&e.message||e)+
'<br><span class="muted small">'+esc((e&&e.stack||'').split('\n').slice(0,3).join(' | '))+'</span></div>';}
window.__dashErr=null;}

function reqRow(r){const m=metrics(r);const rs=risks(r);const ho=handoverOf(r);
const enc=encodeURIComponent(r.folder);
const hi=rs.filter(x=>x.l==="high").length;
return '<tr><td><a class="clip" href="#/'+enc+'" title="'+esc((r.id?r.id+' ':'')+(r.name||r.folder))+'"><b>'+esc(r.id||'')+'</b> '+esc(r.name||r.folder)+'</a>'+
'<div class="small muted mono clip" style="display:block" title="'+esc(r.folder)+'">'+esc(r.folder)+'</div></td>'+
'<td>'+esc(r.workflow)+'</td>'+
'<td>'+hbadge(ho.status)+
'<div class="small" style="margin-top:4px">Subtask '+sn(ho.matched||0,'ho')+' / '+(ho.total_map||0)+
(ho.unmatched?' · 未匹配 '+sn(ho.unmatched,'fail'):'')+'</div></td>'+
'<td style="min-width:200px">'+bar(STATUS_ORDER.map(s=>[s,m.cnt[s],COL[s]]))+legend(STATUS_ORDER.map(s=>[s,m.cnt[s],COL[s]]))+'</td>'+
'<td><div class="agg-row" style="margin:0">'+
'<div class="item"><span class="lab">进度</span><span class="num">'+pct(m.progress)+'</span></div>'+
'<div class="item"><span class="lab">实现</span><span class="num pass">'+m.ck.done+'</span><span class="muted small">/'+m.total+'</span></div>'+
'<div class="item"><span class="lab">通过</span><span class="num pass">'+m.cnt["通过"]+'</span></div>'+
'<div class="item"><span class="lab">终验</span><span class="num ho">'+m.fc["终验通过"]+'</span><span class="muted small">/'+m.fcBase+'</span></div>'+
'</div></td>'+
'<td>'+esc(ts(r.generated_at))+'</td>'+
'<td>'+(m.total===0?'<span class="badge b-unk">无 AC 条目</span>':(m.cnt["验证中"]+m.cnt["修复中"]?'<span class="badge b-run">'+(m.cnt["验证中"]+m.cnt["修复中"])+' 进行中</span> ':''))+
(hi?'<span class="badge b-fail">'+hi+' 高风险</span>':(m.total?'<span class="muted small">无高风险</span>':''))+'</td>'+
'<td>'+(canAdmin()?'<button data-f="'+esc(r.folder)+'" onclick="archiveReq(this.dataset.f)" title="标记已完成并移到 archived/">归档</button>':'<span class="muted small">—</span>')+'</td></tr>';}

function canAdmin(){return state.served&&state.api===true;}
async function reqAction(kind,folder){
try{const r=await fetch(BASE+'api/req/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder})});
 const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));location.reload();}
catch(e){alert((kind==='archive'?'归档':'恢复')+'失败：'+(e&&e.message||e));}}
function archiveReq(folder){if(confirm('归档「'+folder+'」？\n\n· 该需求标记为「已完成」\n· 目录移到 docs/develop/archived/\n· 可在「已归档」里查看或恢复'))reqAction('archive',folder);}
function unarchiveReq(folder){if(confirm('恢复「'+folder+'」到进行中？'))reqAction('unarchive',folder);}
function archTabs(){return '<div class="tabs" style="margin-top:0">'+
'<button class="'+(state.arch?'':'on')+'" onclick="state.arch=false;render()">进行中（'+REQS.length+'）</button>'+
'<button class="'+(state.arch?'on':'')+'" onclick="state.arch=true;render()">已归档（'+ARCH.length+'）</button></div>'+
(state.served&&state.api===false?'<div class="banner warn">当前是普通静态服务：归档 / 恢复按钮不可用。用 <code>python scripts/verify_dashboard.py --all --develop docs/develop --serve</code> 打开。</div>':'');}
function renderArchived(){
return archTabs()+'<div class="panel"><h3>已归档需求（'+ARCH.length+'）</h3>'+
'<table><thead><tr><th>需求</th><th>状态</th><th>归档时间</th><th>操作</th></tr></thead><tbody>'+
(ARCH.length?ARCH.map(a=>'<tr><td>'+(a.has_page?'<a target="_blank" href="'+evUrl('archived/'+a.folder+'/验证进度看板.html')+'"><b>'+esc(a.id||'')+'</b> '+esc(a.name||a.folder)+'</a>':'<b>'+esc(a.id||'')+'</b> '+esc(a.name||a.folder))+
'<div class="small muted mono">'+esc(a.folder)+'</div></td>'+
'<td>'+(a.completed?'<span class="badge b-pass">'+esc(a.completed)+'</span>':'<span class="muted small">—</span>')+'</td>'+
'<td>'+esc(ts(a.archived_at))+'</td>'+
'<td>'+(canAdmin()?'<button data-f="'+esc(a.folder)+'" onclick="unarchiveReq(this.dataset.f)">恢复</button>':'<span class="muted small">—</span>')+'</td></tr>').join('')
:'<tr><td colspan="4" class="muted">暂无已归档需求。</td></tr>')+'</tbody></table>'+
'<div class="hint" style="margin-top:8px">点需求名查看归档时留存的看板（只读快照）。</div></div>';}
function renderAll(){if(state.arch)return renderArchived();const rows=REQS.map(reqRow).join("");
const all=REQS.map(r=>metrics(r));
const hos=REQS.map(r=>handoverOf(r));
const agg={total:all.reduce((s,m)=>s+m.total,0),done:all.reduce((s,m)=>s+m.ck.done,0),
pass:all.reduce((s,m)=>s+m.cnt["通过"],0),busy:all.reduce((s,m)=>s+m.cnt["验证中"]+m.cnt["修复中"],0),
fail:all.reduce((s,m)=>s+m.cnt["失败"]+m.cnt["阻塞"],0),
fcPass:all.reduce((s,m)=>s+m.fc["终验通过"],0),fcBase:all.reduce((s,m)=>s+m.fcBase,0),
hoDone:hos.filter(h=>h.status==="已提测").length,
hoSkip:hos.filter(h=>h.status==="无需提测").length,
hoWait:hos.filter(h=>h.status==="已匹配待确认"||h.status==="待匹配").length,
subMatched:hos.reduce((s,h)=>s+(h.matched||0),0)};
return archTabs()+'<div class="panel"><h3>全部需求总览（'+REQS.length+' 个进行中需求）</h3>'+
'<div class="grid cards">'+
card("需求数",REQS.length,"进行中","run")+
card("AC 总数",agg.total,"Checklist / 目录合计","")+
card("实现完成",frac(agg.done,agg.total),pct(agg.total?agg.done/agg.total:0),"pass")+
card("验证通过",agg.pass,"registry = 通过","pass")+
card("失败/阻塞",agg.fail,"需关注","fail")+
card("证据终验",frac(agg.fcPass,agg.fcBase),"已完结且终验通过","ho")+
card("进行中用例",agg.busy,"验证中 + 修复中","run")+
card("已提测",agg.hoDone,"handover 终态","ho")+
card("无需提测",agg.hoSkip,"终态 · 不改 Jira","mute")+
card("待确认提测",agg.hoWait,"已匹配待确认 / 待匹配","fix")+
card("已匹配 Subtask",agg.subMatched,"跨需求合计","ho")+
'</div>'+
'<table style="margin-top:14px"><thead><tr><th>需求</th><th>工作流</th><th>提测</th><th>用例状态分布</th><th>关键数字</th><th>快照时间</th><th>状态</th><th>操作</th></tr></thead><tbody>'+
rows+'</tbody></table>'+
'<div class="hint" style="margin-top:8px">点<b>需求名</b>进入该需求详情；数字颜色：绿=通过/完成，蓝=进行中/提测，橙=待确认，红=失败。</div></div>';}

function viewOverview(req){const m=metrics(req);const rs=risks(req);const ho=handoverOf(req);
const ckItems=[["done",m.ck.done,"var(--pass)"],["open",m.ck.open,"var(--pend)"],["blocked",m.ck.blocked,"var(--blk)"],["waived",m.ck.waived||0,"var(--fix,#d4a017)"]];
const subMatched=req.acs.filter(a=>a.subtaskKey).length;
const subMiss=req.acs.filter(a=>!a.subtaskKey).length;
return '<div class="ho-banner">'+
'<span class="big">提测 '+hbadge(ho.status)+'</span>'+
'<span>父票 <b class="mono">'+(ho.parentIssue?esc(ho.parentIssue):'—')+'</b></span>'+
'<span>Subtask 已匹配 <b class="statn ho">'+subMatched+'</b> / '+req.acs.length+
(subMiss?' · 未匹配 <b class="statn fail">'+subMiss+'</b>':'')+'</span>'+
(ho.assigneeEmail?'<span class="muted small">默认转交 '+esc(ho.assigneeEmail)+' → '+esc(ho.targetStatus||'Testing')+'</span>':'')+
(ho.note?'<span class="muted small">'+esc(ho.note)+'</span>':'')+
'</div>'+
'<div class="grid cards">'+
card("需求交付进度",pct(m.progress),"实现50% + 通过率30% + 回归20%","run")+
card("AC 总数",m.total,"Checklist / 目录合计","")+
card("实现完成",frac(m.ck.done,m.total),"Checklist [done]","pass")+
card("验证通过",m.cnt["通过"],"registry = 通过","pass")+
card("进行中",m.cnt["验证中"]+m.cnt["修复中"],"验证中 "+m.cnt["验证中"]+" · 修复中 "+m.cnt["修复中"],"run")+
card("待验证",m.cnt["待验证"],"","mute")+
card("失败/阻塞",m.cnt["失败"]+" / "+m.cnt["阻塞"],"","fail")+
card("提测状态",hbadge(ho.status),"与验证态分离 · .handover-state.json",hoTone(ho.status))+
card("Subtask 匹配",frac(subMatched,req.acs.length),subMiss?"未匹配 "+subMiss:"全部已挂号","ho")+
card("验证覆盖率",pct(m.coverage),"已开始的 AC 占比","run")+
card("验证通过率",pct(m.passRate),"已判定的通过占比","pass")+
card("证据终验",frac(m.fc["终验通过"],m.fcBase),
"未终验 "+m.fc["未终验"]+" · 终验中 "+m.fc["终验中"]+" · 不通过 "+m.fc["终验不通过"]+" · 豁免 "+m.fc["豁免"],"ho")+
card("回归项",frac(m.rd,m.regs.length),"R-NN 有结论","pass")+
card("流程步骤",frac(m.stepsOk,(req.step_spec||[]).length),"validate_step","run")+
card("证据文件",m.ev,"媒体 "+m.med,"")+
card("累计验证工时",dur(m.work),"各 AC 耗时之和","")+
card("墙钟时长",m.wall==null?"—":dur(m.wall),"最早开始→最晚结束","")+
card("进行中已耗时",dur(m.inflight),"最长的一条","fix")+
'</div>'+
'<div class="panel"><h3>需求整体进度</h3>'+
'<div class="bar" style="height:16px"><i style="width:'+(m.progress*100)+'%;background:linear-gradient(90deg,var(--run),var(--pass))"></i></div>'+
'<div class="legend"><span>实现 '+(m.impl*100).toFixed(0)+'%</span><span>通过率 '+pct(m.passRate)+'</span><span>回归 '+pct(m.rr)+'</span></div>'+
'<div style="margin-top:10px">'+bar(ckItems)+legend(ckItems.map(i=>[i[0]==='done'?'Checklist done':i[0]==='open'?'Checklist open':'blocked',i[1],i[2]]))+'</div>'+
'<div style="margin-top:12px">'+bar(STATUS_ORDER.map(s=>[s,m.cnt[s],COL[s]]))+legend(STATUS_ORDER.map(s=>[s,m.cnt[s],COL[s]]))+'</div></div>'+
'<div class="panel"><h3>流程步骤（'+esc(req.workflow)+'）</h3><div class="stepbar">'+
(req.step_spec||[]).map(([n,t])=>{const i=(req.steps||{})[String(n)]||{};
const cls=i.passed?"ok":(i.consecutive_fails?"no":"none");const mark=i.passed?"✅":(i.consecutive_fails?"❌":"○");
const fs=(req.step_files||{})[String(n)]||[];const lab=mark+' Step'+n+' '+esc(t);
if(!fs.length)return '<span class="stepchip '+cls+'" title="'+esc(ts(i.at))+'（暂无产出物）">'+lab+'</span>';
return '<button type="button" class="stepchip '+cls+(state.stepOpen===n?' sel':'')+'" title="'+esc(ts(i.at))+' · 点击查看产出物" onclick="stepClick('+n+')">'+lab+(fs.length>1?'<span class="fc">·'+fs.length+'</span>':'')+'</button>';}).join('')+
'</div>'+stepFilesRow(req)+'</div>'+
renderRegr(req)+renderRisks(rs);}

function stepFileList(n){const r=REQS[state.sel];return ((r&&r.step_files)||{})[String(n)]||[];}
function stepClick(n){const fs=stepFileList(n);if(!fs.length)return;
  if(fs.length===1){state.stepOpen=null;openEv(encodeURIComponent(fs[0].rel),fs[0].type,fs[0].name);return;}
  state.stepOpen=state.stepOpen===n?null:n;render();}
function stepFilesRow(req){const n=state.stepOpen;if(n==null)return '';const fs=((req.step_files||{})[String(n)])||[];if(!fs.length)return '';
  return '<div class="stepfiles"><span class="muted">Step'+n+' 产出物：</span>'+fs.map((f,k)=>'<button type="button" onclick="stepFileOpen('+n+','+k+')">'+esc(f.name)+'</button>').join('')+'</div>';}
function stepFileOpen(n,k){const f=stepFileList(n)[k];if(f)openEv(encodeURIComponent(f.rel),f.type,f.name);}
function renderRegr(req){const rs=req.regressions||[];if(!rs.length)return '';
return '<div class="panel"><h3>回归验证清单 R-NN（'+rs.filter(r=>r.ok).length+' / '+rs.length+' 完成）</h3>'+
'<table><thead><tr><th>项</th><th>受影响功能</th><th>结论</th></tr></thead><tbody>'+
rs.map(r=>{const v=REGR_V[r.verdict]||REGR_V.unknown;return '<tr><td class="mono">'+esc(r.token)+'</td><td>'+esc(r.text)+
'</td><td><span class="badge '+v[1]+'">'+v[0]+'</span></td></tr>';}).join('')+'</tbody></table>'+
'<div class="hint" style="margin-top:8px"><button class="btn" onclick="tab(\'regression\')">打开「回归」页签看完整内容 →</button>'+
' <span class="muted">AC = 新需求是否做对；R = 既有功能有没有被改坏</span></div></div>';}
function filteredRegr(req){const f=state.filter.rv;const rs=req.regressions||[];
if(!f||!f.size)return rs;return rs.filter(r=>f.has(r.verdict));}
function viewRegression(req){const all=req.regressions||[];
if(!all.length)return '<div class="panel muted">未找到《回归验证清单》（Step *-回归验证清单.md）。'+
'<div class="hint" style="margin-top:6px">R-NN 回答「既有功能有没有被弄坏」，与 AC-NN（新需求验收）独立编号。</div></div>';
const list=filteredRegr(req);
const by={};all.forEach(r=>{by[r.verdict]=(by[r.verdict]||0)+1;});
const done=all.filter(r=>r.ok).length;
const rchip=k=>{const v=REGR_V[k]||REGR_V.unknown;return '<button class="'+(state.filter.rv.has(k)?'on':'')+
'" onclick="frv(\''+k+'\')"><span class="badge '+v[1]+'">'+v[0]+'</span> <b>'+(by[k]||0)+'</b></button>';};
const rows=list.map(r=>{const v=REGR_V[r.verdict]||REGR_V.unknown;const open=state.openR.has(r.token);
return '<tr onclick="toggleR(\''+r.token+'\')" style="cursor:pointer">'+
'<td class="mono"><b>'+esc(r.token)+'</b></td>'+
'<td>'+esc(r.text||"—")+'</td>'+
'<td class="small">'+esc(r.who||"—")+'</td>'+
'<td><span class="badge '+v[1]+'">'+v[0]+'</span></td>'+
'<td class="small muted">'+(r.note?(esc(r.note).slice(0,80)+(r.note.length>80?"…":"")):"—")+'</td>'+
'</tr>'+(open?'<tr class="detail"><td colspan="5"><div class="det det-grid">'+
'<div class="det-sec"><h4>因为改了什么</h4><div class="small">'+(r.because?esc(r.because):'<span class="muted">—</span>')+'</div></div>'+
'<div class="det-sec"><h4>期望不变的行为</h4><div class="small">'+(r.expect?esc(r.expect):'<span class="muted">—</span>')+'</div></div>'+
'<div class="det-sec"><h4>验证方式</h4><div class="small">'+(r.how?esc(r.how):'<span class="muted">—</span>')+'</div></div>'+
'<div class="det-sec"><h4>结论说明</h4><div class="small">'+(r.note?esc(r.note):'<span class="muted">尚未回填</span>')+'</div></div>'+
'</div></td></tr>':'');}).join('');
return '<div class="panel">'+
'<div class="ho-banner" style="margin-bottom:12px">'+
'<span class="big">回归项 '+done+' / '+all.length+' 有结论</span>'+
'<span class="hint">AC = 新需求做对了吗；<b>R = 既有功能有没有被改坏</b>（编号独立）</span>'+
(req.regression_rel?'<button class="btn" data-ev="'+encodeURIComponent(req.regression_rel)+'" data-type="md" data-title="'+esc(req.regression_file||'回归验证清单')+'">打开清单原文</button>':'')+
'</div>'+
'<div class="grid cards" style="margin-bottom:12px">'+
card("有结论",done+"/"+all.length,"pass / partial / waived","pass")+
card("通过",by.pass||0,"verdict=pass","pass")+
card("部分",by.partial||0,"附条件 / 待补","fix")+
card("未跑 / 无结论",(by.not_run||0)+(by.unknown||0),"挡门禁","fail")+
'</div>'+
'<div class="pf"><b>筛选：</b>'+Object.keys(REGR_V).map(rchip).join("")+
'<span class="sp" style="flex:1"></span><span class="hint">'+list.length+' / '+all.length+' 条 · 点击行展开</span></div>'+
'<table><thead><tr><th>R</th><th>受影响的既有功能</th><th>谁来验</th><th>结论</th><th>说明</th></tr></thead><tbody>'+
rows+(list.length?'':'<tr><td colspan="5" class="muted">无匹配回归项。</td></tr>')+
'</tbody></table></div>';}

function renderRisks(rs){if(!rs.length)return '<div class="panel"><h3>风险提示</h3><div class="muted">未发现风险项。</div></div>';
return '<div class="panel"><h3>风险提示（'+rs.length+'）</h3>'+rs.map(r=>'<div class="risk '+r.l+'">'+
'<div class="txt">'+(r.ac?'<b class="mono">'+esc(r.ac)+'</b> ':'')+esc(r.t)+'</div>'+
(r.cmd?'<code>'+esc(r.cmd)+'</code>':'')+'</div>').join('')+'</div>';}

function filtered(req){const f=state.filter;
return req.acs.filter(a=>{if(f.status.size&&!f.status.has(a.status))return false;
if(f.fc.size&&!f.fc.has(a.final_status||"未终验"))return false;
if(f.risk&&!["失败","阻塞","验证中","修复中"].includes(a.status)&&a.final_status!=="终验不通过")return false;
if(f.ev&&!(a.evidence||[]).length)return false;
if(f.q){const q=f.q.toLowerCase();
if(!((a.token+" "+(a.subtaskKey||"")+" "+(a.handoverStatus||"")+" "+a.title+" "+a.prefix+" "+a.note+" "+a.gwt).toLowerCase().includes(q)))return false;}
return true;});}

function figName(rel){return String(rel).split('/').pop().replace(/\.(png|jpe?g|gif|webp)$/i,'');}
function figGallery(req){const ims=req.ui_images||[];if(!ims.length)return '';
return '<div class="panel"><div class="pf"><b>一页读懂 · 标注图（'+ims.length+'）</b><span class="hint">点图放大；图上每个编号下写了「对应 AC」。展开下面任一条 AC，也会显示它对应的图</span></div>'+
'<div class="figbar">'+ims.map(r=>'<div class="fig" data-ev="'+encodeURIComponent(r)+'" data-type="image" data-title="'+esc(figName(r))+'"><img loading="lazy" src="'+evUrl(r)+'" alt=""><div class="cap">'+esc(figName(r))+'</div></div>').join('')+'</div></div>';}
function viewCases(req){const list=filtered(req);const ho=handoverOf(req);
const chip=s=>'<button class="'+(state.filter.status.has(s)?'on':'')+'" onclick="fstat(\''+s+'\')">'+badge(s)+'</button>';
const rows=list.map(a=>{
const evc=(a.evidence||[]).length;
const durS=(()=>{const s=a.started_at?new Date(a.started_at):null;
const e=a.finished_at?new Date(a.finished_at):(a.updated_at?new Date(a.updated_at):null);
if(!s||!e||isNaN(s)||isNaN(e))return "—";return dur((e-s)/1000)+(a.finished_at?"":" <span class='muted small'>≈</span>");})();
return '<tr onclick="toggle(\''+a.token+'\')" style="cursor:pointer">'+
'<td class="mono"><b>'+esc(a.token)+'</b></td>'+
'<td>'+(a.subtaskKey?'<span class="subkey">'+esc(a.subtaskKey)+'</span>':'<span class="muted small">—</span>')+'</td>'+
'<td>'+hbadge(a.handoverStatus||"未进入")+'</td>'+
'<td>'+badge(a.status)+'</td>'+
'<td>'+fbadge(a.final_status,a.status)+'</td>'+
'<td>'+esc(a.priority||"—")+'</td>'+
'<td>'+esc(a.prefix||"—")+'</td>'+
'<td>'+esc((a.tags||[]).join("/")||"—")+'</td>'+
'<td>'+esc(a.title)+'</td>'+
'<td class="small mono">'+esc(a.session||"—")+'</td>'+
'<td class="small mono">'+esc(a.window||"—")+'</td>'+
'<td class="small">'+ts(a.started_at)+'</td>'+
'<td class="small mono">'+durS+'</td>'+
'<td class="mono">'+(evc?evc+' <span class="muted small">('+(a.evidence.filter(e=>e.type==='image'||e.type==='video').length)+' 媒体)</span>':'<span class="muted">0</span>')+'</td>'+
'</tr>'+detailRow(a);}).join("");
return figGallery(req)+'<div class="panel"><div class="pf">'+
'<b>需求提测门控</b> '+hbadge(ho.status)+
'<span class="hint" style="margin-left:8px">「提测」列=Subtask 级</span>'+
'<b style="margin-left:12px">筛选：</b>'+["待验证","验证中","修复中","通过","失败","阻塞"].map(chip).join("")+
'<b style="margin-left:10px">终验：</b>'+FC_ORDER.map(fchip).join("")+
'<label class="hint"><input type="checkbox" '+(state.filter.risk?'checked':'')+' onchange="frisk(this.checked)"> 只看风险</label>'+
'<label class="hint"><input type="checkbox" '+(state.filter.ev?'checked':'')+' onchange="fev(this.checked)"> 只看有证据</label>'+
'<input placeholder="搜索 AC / Subtask / 描述 / GWT" value="'+esc(state.filter.q)+'" oninput="fq(this.value)" style="min-width:220px">'+
'<span class="sp" style="flex:1"></span><span class="hint">'+list.length+' / '+req.acs.length+' 条</span></div>'+
'<table><thead><tr><th>AC</th><th>Subtask</th><th>提测状态</th><th>状态</th><th>终验</th><th>优先级</th><th>前缀</th><th>归属</th><th>场景</th>'+
'<th>会话</th><th>窗口</th><th>开始</th><th>耗时</th><th>证据</th></tr></thead><tbody>'+rows+
(list.length?'':'<tr><td colspan="14" class="muted">无匹配用例。</td></tr>')+'</tbody></table></div>';}

function detailRow(a){if(!state.open.has(a.token))return "";
const ev=(a.evidence||[]);const imgs=ev.filter(e=>e.type==='image').slice(0,12);
const vids=ev.filter(e=>e.type==='video');const other=ev.filter(e=>e.type!=='image'&&e.type!=='video');
const r=a.result||{};
const vCls=r.verdict==='通过'?'ok':(r.verdict==='失败'?'bad':'mute');
const acts=a.dir_rel?('<div class="det-actions"><span class="lbl">原文</span>'+
'<button class="btn primary" data-ev="'+encodeURIComponent(a.dir_rel+'/RESULT.md')+'" data-type="md" data-title="RESULT.md · '+esc(a.token)+'">RESULT.md</button>'+
(a.has_replay?'<button class="btn" data-ev="'+encodeURIComponent(a.dir_rel+'/REPLAY.md')+'" data-type="md" data-title="REPLAY.md · '+esc(a.token)+'">REPLAY.md</button>':'')+
'<button class="btn" data-ev="'+encodeURIComponent(a.dir_rel+'/case.md')+'" data-type="md" data-title="case.md · '+esc(a.token)+'">case.md</button>'+
'<span class="lbl sep">结果</span><span class="chip '+vCls+'">'+(r.verdict?esc(r.verdict):'未判定')+'</span>'+
(a.has_replay?'':'<span class="chip bad">缺复跑入口</span>')+'</div>')
:('<div class="det-actions"><span class="lbl">该 AC 没有 tests/AC-NN 目录，没有原文可看</span></div>');
const kv='<dl class="kv">'+
'<dt>Subtask</dt><dd>'+(a.subtaskKey?'<span class="subkey">'+esc(a.subtaskKey)+'</span>'+
(a.subtaskSummary?' <span class="muted small">'+esc(a.subtaskSummary)+'</span>':'')+
(a.subtaskMatch?' <span class="muted small">· '+esc(a.subtaskMatch)+'</span>':''):
'<span class="muted">未匹配</span>')+'</dd>'+
'<dt>提测（Subtask）</dt><dd>'+hbadge(a.handoverStatus||"未进入")+'</dd>'+
'<dt>状态</dt><dd>'+badge(a.status)+'</dd>'+
'<dt>证据终验</dt><dd>'+fbadge(a.final_status,a.status)+
(a.final_by?' <span class="muted small">'+esc(a.final_by)+' · '+ts(a.final_at)+'</span>':'')+
(a.final_note?'<div class="small">'+esc(a.final_note)+'</div>':'')+'</dd>'+
'<dt>会话 / 窗口</dt><dd class="mono">'+esc(a.session||"—")+' / '+esc(a.window||"—")+(a.engine?' · '+esc(a.engine):'')+'</dd>'+
'<dt>开始 / 结束</dt><dd class="mono">'+ts(a.started_at)+' / '+ts(a.finished_at||a.updated_at)+'</dd>'+
'<dt>备注</dt><dd>'+esc(a.note||"—")+'</dd>'+
(r.env?'<dt>环境</dt><dd>'+esc(r.env)+'</dd>':'')+
(r.verdict_line?'<dt>RESULT 结论</dt><dd>'+esc(r.verdict_line)+'</dd>':'')+
(r.downgrade?'<dt>证据降级</dt><dd class="muted">'+esc(r.downgrade)+'</dd>':'')+
'</dl>';
return '<tr class="detail"><td colspan="14"><div class="det">'+acts+
'<div class="det-grid">'+
'<div class="det-sec"><h4>验收原文（GWT）</h4>'+(a.gwt?'<pre class="gwt">'+esc(a.gwt)+'</pre>':'<div class="muted small">Checklist 中未找到该条 GWT</div>')+
(a.fig_text?'<h4 style="margin-top:10px">图示 <span class="muted small" style="font-weight:400">看图中红框标的编号；点图放大</span></h4><div class="small"><b>'+esc(a.fig_text.replace(/（UI\/[^）]*）/g,''))+'</b></div>'+
 ((a.figs||[]).length?'<div class="figac">'+a.figs.map(r=>'<div class="fig" data-ev="'+encodeURIComponent(r)+'" data-type="image" data-title="'+esc(a.token+' · '+figName(r))+'"><img loading="lazy" src="'+evUrl(r)+'" alt=""></div>').join('')+'</div>':''):'')+'</div>'+
'<div class="det-sec"><h4>执行信息</h4>'+kv+'</div>'+
'</div>'+
'<div class="det-sec"><h4>证据（'+ev.length+' 个'+(imgs.length+vids.length?'，媒体 '+(imgs.length+vids.length):'')+'）</h4>'+
(imgs.length?'<div class="thumbs">'+imgs.map(e=>'<span class="evlink" data-ev="'+encodeURIComponent(e.rel)+'" data-type="image"><img loading="lazy" src="'+evUrl(e.rel)+'" alt=""><div class="cap">'+esc(e.name)+'</div></span>').join('')+'</div>':'')+
(vids.length?'<div class="thumbs">'+vids.map(e=>'<div class="evfile">🎬 <span class="evlink" data-ev="'+encodeURIComponent(e.rel)+'" data-type="video">'+esc(e.name)+'</span> <span class="muted">'+humanSize(e.size)+'</span></div>').join('')+'</div>':'')+
(other.length?'<div style="margin-top:6px">'+other.map(e=>'<span class="evfile">'+(e.type==='har'?'📦':e.type==='log'?'📜':'📄')+' <span class="evlink" data-ev="'+encodeURIComponent(e.rel)+'" data-type="'+e.type+'">'+esc(e.name)+'</span> <span class="muted">'+humanSize(e.size)+'</span></span>').join('')+'</div>':'')+
(!ev.length?'<div class="muted small">evidence/ 为空 —— 按门禁口径「未留证 = 未测」</div>':'')+
'</div></div></td></tr>';}

function humanSize(n){n=+n||0;const u=["B","KB","MB","GB"];let i=0;while(n>=1024&&i<3){n/=1024;i++;}
return (i?n.toFixed(1):n)+u[i];}

function viewEvidence(req){const grp=req.acs.filter(a=>(a.evidence||[]).length);
if(!grp.length)return '<div class="panel muted">还没有任何证据文件（快照生成时 evidence/ 为空）。</div>';
return grp.map(a=>{const imgs=(a.evidence||[]).filter(e=>e.type==='image');
const rest=(a.evidence||[]).filter(e=>e.type!=='image');
const meta=[a.prefix,a.priority,(a.tags||[]).join('/')].filter(Boolean).join(' · ');
const acBody=
'<div class="det-sec" style="margin:10px 0 12px">'+
'<h4>验收内容（Checklist）</h4>'+
'<div class="small" style="margin-bottom:6px"><b>'+esc(a.title||a.token)+'</b>'+
(meta?' <span class="muted">· '+esc(meta)+'</span>':'')+
(a.subtaskKey?' <span class="subkey" style="margin-left:6px">'+esc(a.subtaskKey)+'</span>':'')+
'</div>'+
(a.gwt?'<pre class="gwt">'+esc(a.gwt)+'</pre>':'<div class="muted small">Checklist 中未找到该条 GWT</div>')+
(a.dir_rel?'<div class="det-actions" style="margin-top:8px">'+
'<button class="btn" data-ev="'+encodeURIComponent(a.dir_rel+'/case.md')+'" data-type="md" data-title="case.md · '+esc(a.token)+'">case.md</button>'+
(a.has_replay?'<button class="btn" data-ev="'+encodeURIComponent(a.dir_rel+'/REPLAY.md')+'" data-type="md" data-title="REPLAY.md · '+esc(a.token)+'">REPLAY.md</button>':'')+
'</div>':'')+
'</div>';
return '<div class="panel"><h3>'+esc(a.token)+' '+badge(a.status)+' '+fbadge(a.final_status,a.status)+
' <span class="muted small">'+esc(a.title)+'</span></h3>'+
(a.dir_rel?'<div class="det-actions" style="margin-bottom:8px"><span class="lbl">结果</span>'+
'<button class="btn primary" data-ev="'+encodeURIComponent(a.dir_rel+'/RESULT.md')+'" data-type="md" data-title="RESULT.md · '+esc(a.token)+'">RESULT.md</button></div>':'')+
acBody+
'<div class="det-sec"><h4>证据文件（'+(a.evidence||[]).length+'）</h4>'+
(imgs.length?'<div class="thumbs">'+imgs.map(e=>'<span class="evlink" data-ev="'+encodeURIComponent(e.rel)+'" data-type="image"><img loading="lazy" src="'+evUrl(e.rel)+'" alt=""><div class="cap">'+esc(e.name)+'</div></span>').join('')+'</div>':'')+
(rest.length?'<div style="margin-top:6px">'+rest.map(e=>'<span class="evfile">'+(e.type==='video'?'🎬':e.type==='har'?'📦':e.type==='log'?'📜':'📄')+
' <span class="evlink" data-ev="'+encodeURIComponent(e.rel)+'" data-type="'+e.type+'">'+esc(e.name)+'</span> <span class="muted">'+humanSize(e.size)+'</span></span>').join('')+'</div>':'')+
'</div></div>';}).join('');}

function viewTimeline(req){const ds=req.acs.filter(a=>a.started_at).map(a=>{
const s=new Date(a.started_at);const e=a.finished_at?new Date(a.finished_at):(a.updated_at?new Date(a.updated_at):null);
return {a,s,e};}).filter(x=>!isNaN(x.s));
if(!ds.length)return '<div class="panel muted">还没有任何 AC 被认领（无 started_at）。</div>';
const t0=Math.min(...ds.map(x=>+x.s));const t1=Math.max(Date.now(),...ds.map(x=>x.e?+x.e:+Date.now()));
const span=Math.max(1,t1-t0);
const rows=ds.sort((x,y)=>x.s-y.s).map(({a,s,e})=>{const left=(+s-t0)/span*100;
const w=((e?(+e-+s):(Date.now()-+s))/span*100);
return '<div style="margin:6px 0"><div class="small mono">'+esc(a.token)+' '+esc(a.session||"")+' '+esc(a.window||"")+
' <span class="muted">'+(e?dur((e-s)/1000):dur((Date.now()-s)/1000)+"（进行中）")+'</span></div>'+
'<div class="tl"><span style="left:'+left+'%;width:'+Math.max(0.6,w)+'%;background:'+COL[a.status]+'"></span></div></div>';}).join("");
return '<div class="panel"><h3>时间线（'+ts(new Date(t0).toISOString())+' → 现在）</h3>'+rows+
'<div class="hint">进行中的条延伸到“现在”；颜色=当前状态。刷新随轮询自动更新。</div></div>';}

function viewGuide(req){const m=metrics(req);
return '<div class="panel"><h3>状态枚举</h3><div class="legend">'+
STATUS_ORDER.map(s=>'<span>'+badge(s)+'</span>').join('')+'</div>'+
'<div class="hint">只有 <b>通过</b> 对应 Checklist <b>[done]</b>；<b>验证中/修复中</b> 仍属 [open]。'+
'生命周期：待验证 → 验证中 →（发现问题）修复中 → 验证中（复验）→ 通过/失败/…<br>'+
'<b>跳过</b> = 明确不做 / 不适用（斜纹）；<b>⬜ NOT_RUN（本轮没跑、待执行）算「待验证」，不是跳过</b>。</div>'+
'<div class="hint" style="margin-top:10px"><b>证据终验</b>（独立维度，不重跑浏览器）：'+
FC_ORDER.map(s=>fbadge(s)).join(" ")+
'<br>全部 AC 跑完、证据采集完之后，逐条核对<b>证据内容是否支撑结论</b>：截图里是否真有期望值、证据时间/环境是否对得上这条 AC、'+
'<code>evidence/</code> 是否非空且能打开。<b>已完结的 AC 都应过一遍</b>；终验不通过按「发现问题」处理（先看证据缺什么，'+
'必要时才重新 claim 做实机复验）。<b>终验通过不改变验证状态</b>，Checklist 仍按 status 回写。'+
'<div class="mono small" style="margin-top:6px">python scripts/verify_state.py final --dir "&lt;需求目录&gt;" --ac ALL --session s1 --status 终验中</div></div></div>'+
'<div class="panel"><h3>提测状态（与验证态分离）</h3>'+
'<div class="hint" style="margin-bottom:6px"><b>需求门控</b>（总览横幅）：</div>'+
'<div class="legend" style="margin-bottom:8px">'+
["未进入","待匹配","已匹配待确认","已提测","无需提测"].map(s=>'<span>'+hbadge(s)+'</span>').join('')+'</div>'+
'<div class="hint" style="margin-bottom:6px"><b>用例「提测」列 = Subtask 级</b>（mapping Key + <code>jiraActions</code>）：</div>'+
'<div class="legend" style="margin-bottom:8px">'+
["未匹配","待提测","已提测","提测失败","待补记","无需提测"].map(s=>'<span>'+hbadge(s)+'</span>').join('')+'</div>'+
'<div class="hint">需求终态只有 <b>已提测</b> / <b>无需提测</b>。用户说不提测 → 全员「无需提测」，不改 Jira。'+
' 真正改 Jira 是按 Sub-task 逐条 transition/assign，结果进 <code>jiraActions</code>。</div></div>'+
'<div class="panel"><h3>数据来源与刷新</h3><ul class="small">'+
'<li><b>实时（每 '+Math.round(POLL_MS/1000)+'s 轮询）</b>：<code>tests/.verify-state.json</code>（用例状态）+ <code>.handover-state.json</code>（mapping / jiraActions / 门控 status）。</li>'+
'<li><b>快照（重跑生成器才更新）</b>：证据文件清单、Checklist、流程步骤、回归项、RESULT 摘要。</li>'+
'<li>生成时间：'+esc(ts(PAYLOAD.generated_at))+'；当前打开方式：'+(state.served?'http（可实时）':'file://（仅快照）')+'。</li>'+
'<li>刷新快照：<code>python scripts/verify_dashboard.py --dir "'+esc(req.path||req.folder)+'"</code></li>'+
'<li>实时服务：<code>python scripts/verify_dashboard.py --dir "<'+'需求目录>" --serve</code></li></ul></div>'+
'<div class="panel"><h3>本次快照统计</h3><div class="small muted">AC '+m.total+' · Subtask 已匹配 '+
req.acs.filter(a=>a.subtaskKey).length+' · 提测 '+esc((req.handover||{}).status||'未进入')+
' · 证据文件 '+m.ev+'（媒体 '+m.med+'）· 回归项 '+m.regs.length+' · 风险 '+risks(req).length+'</div></div>';}


// ================= 需求问答（Step1 记录）=================
const QA_ST=["已定","待PM确认","PM已确认"];
function qaLines(s){return String(s||"").split('\n').map(x=>mdInline(x)).join('<br>');}
function qaBadge(s){return '<span class="badge st-'+esc(s)+'">'+esc(s||'—')+'</span>';}
function qaCanEdit(){return state.served&&state.api===true;}
function qaCard(req,q,ro){const ed=!ro&&state.qaEdit===q.id;const pend=(req.qa.pending||[]).filter(c=>c.qid===q.id);
const opts=q.options||[];
let h='<div class="qa-card'+(q["状态"]==="待PM确认"?' pm':'')+(pend.length?' chg':'')+(ed?' editing':'')+'"'+(ro?'':' id="qa-'+esc(q.id)+'"')+'>'+
'<div class="qa-head"><span class="qid">'+esc(q.id)+'</span><span class="qt">'+esc(q.title)+'</span>'+
(ed?'<select id="qa-st" title="状态">'+QA_ST.map(s=>'<option'+(q["状态"]===s?' selected':'')+'>'+s+'</option>').join('')+'</select>':qaBadge(q["状态"]))+
(pend.length?'<span class="badge b-run">改动待 AI 确认</span>':'')+
(ed?'<button onclick="qaCancel()">取消</button><button class="qa-save" onclick="qaSave()">保存</button>'
   :(qaCanEdit()?'<button onclick="qaEdit(\''+esc(q.id)+'\')">'+(ro?'去编辑':'编辑')+'</button>':''))+'</div>'+
(ed&&state.qaMsg?'<div class="banner err" style="margin-top:6px">'+esc(state.qaMsg)+'</div>':'')+
'<div class="qa-sec"><div class="lab">问题描述</div><div class="qa-txt">'+(q["问题描述"]?qaLines(q["问题描述"]):'<span class="muted">（未写问题描述）</span>')+'</div></div>';
if(opts.length){
 h+='<div class="qa-sec"><div class="lab">候选项'+(ed?'（点选即改）':'（✓ 为当前所选）')+'</div><ul class="qa-opts'+(ed?' pick':'')+'">';
 if(ed){h+=opts.map(o=>'<li class="'+(q["已选"]===o.key?'on':'')+'"><label><input type="radio" name="qa-sel" value="'+esc(o.key)+'"'+(q["已选"]===o.key?' checked':'')+
   ' onchange="qaPick(this.value)"> <b>'+esc(o.key)+'.</b> '+qaLines(o.text)+'</label></li>').join('')+
   '<li class="'+(q["已选"]==="自定义"?'on':'')+'"><label><input type="radio" name="qa-sel" value="自定义"'+(q["已选"]==="自定义"?' checked':'')+' onchange="qaPick(this.value)"> <b>自定义</b>（在下方「当前结论」里写）</label></li>';}
 else{h+=opts.map(o=>'<li class="'+(q["已选"]===o.key?'on':'')+'"><span class="mk">'+(q["已选"]===o.key?'✓':'')+'</span><b>'+esc(o.key)+'.</b> '+qaLines(o.text)+'</li>').join('')+
   (q["已选"]==="自定义"?'<li class="on"><span class="mk">✓</span><b>自定义</b>（见当前结论）</li>':'');}
 h+='</ul></div>';}
const chg=(req.qa.pending||[]).filter(c=>c.qid===q.id).slice(-1)[0];
const repick=chg&&chg.after["已选"]!==chg.before["已选"]&&chg.after["当前结论"]===chg.before["当前结论"];
h+='<div class="qa-sec"><div class="lab">当前结论'+(ed?'（不用改：保存后 AI 按你的选择更新）':'')+'</div>'+
 '<div class="qa-txt">'+(q["当前结论"]?qaLines(q["当前结论"]):'<span class="muted">—</span>')+'</div>'+
 (repick&&!ed?'<div class="small" style="color:var(--run);margin-top:4px">已改选 '+esc(chg.after["已选"])+'，结论待 AI 确认后更新</div>':'')+
 (ed?'<div id="qa-custom" style="margin-top:8px;'+(q["已选"]==="自定义"?'':'display:none')+'"><div class="lab">自定义答复（必填，即为新的结论）</div>'+
   '<textarea id="qa-concl" class="qa-ta">'+(q["已选"]==="自定义"?esc(q["当前结论"]||''):'')+'</textarea></div>':'')+'</div>'+
'<div class="qa-sec"><div class="lab">来源</div><div class="qa-txt small">'+qaLines(q["来源"])+'</div></div>';
return h+'</div>';}
function qaCur(){const req=REQS[state.sel];return ((req.qa||{}).questions||[]).find(x=>x.id===state.qaEdit);}
function qaPick(v){const q=qaCur();if(!q)return;
document.querySelectorAll('#qa-'+q.id+' .qa-opts.pick li').forEach(li=>{const r=li.querySelector('input');li.classList.toggle('on',!!(r&&r.checked));});const o=(q.options||[]).find(x=>x.key===v);const st=document.getElementById('qa-st');
const cb=document.getElementById('qa-custom');if(cb){cb.style.display=v==='自定义'?'':'none';if(v==='自定义'){const ta=document.getElementById('qa-concl');if(ta)ta.focus();}}
if(o){if(/需要跟产品经理确认/.test(o.text))st.value="待PM确认";else if(st.value==="待PM确认")st.value="已定";}
else if(v==='自定义'&&st.value==="待PM确认")st.value="已定";}
function qaEdit(id){state.qaEdit=id;state.qaMsg="";render();const el=document.getElementById('qa-'+id);if(el)el.scrollIntoView({block:'center'});}
function qaCancel(){state.qaEdit=null;state.qaMsg="";render();}
async function qaSave(){const req=REQS[state.sel];const q=qaCur();if(!q)return;
const sel=document.querySelector('input[name="qa-sel"]:checked');
const fields={"状态":document.getElementById('qa-st').value};
if(sel)fields["已选"]=sel.value;
if(sel&&sel.value==='自定义'){const v=(document.getElementById('qa-concl').value||'').trim();
 if(!v){state.qaMsg='选择「自定义」时请填写自定义答复';render();return;}fields["当前结论"]=v;}
try{const r=await fetch(BASE+'api/qa/save',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({folder:req.folder,qid:q.id,fields})});const j=await r.json();
 if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));
 req.qa=j.qa;state.qaEdit=null;state.qaMsg="";render();
}catch(e){state.qaMsg='保存失败：'+(e&&e.message||e);render();}}
function qaPmText(req,fmt){const items=((req.qa||{}).questions||[]).filter(q=>q["状态"]==="待PM确认");
if(fmt==='csv'){const c=v=>'"'+String(v||'').replace(/"/g,'""')+'"';
 return '﻿'+[["编号","问题","问题描述","候选项","当前倾向 / 暂定","来源"].map(c).join(',')].concat(items.map(q=>[q.id,q.title,q["问题描述"],
 (q.options||[]).map(o=>o.key+'. '+o.text).join('\n'),q["当前结论"],q["来源"]].map(c).join(','))).join('\r\n');}
let s='# 待产品确认问题（'+(req.id||'')+' '+(req.name||'')+'）\n\n共 '+items.length+' 条\n\n';
items.forEach((q,i)=>{s+='## '+(i+1)+'. '+q.title+'（'+q.id+'）\n\n'+q["问题描述"]+'\n\n';
 if((q.options||[]).length)s+='候选项：\n\n'+q.options.map(o=>'- '+o.key+'. '+o.text).join('\n')+'\n\n';
 if(q["当前结论"])s+='当前倾向：'+q["当前结论"]+'\n\n';});return s;}
function qaDownload(fmt){const req=REQS[state.sel];const txt=qaPmText(req,fmt);
const blob=new Blob([txt],{type:fmt==='csv'?'text/csv;charset=utf-8':'text/markdown;charset=utf-8'});
const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='待产品确认-'+(req.id||req.folder)+'.'+(fmt==='csv'?'csv':'md');
document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);}
async function qaCopy(btn){const txt=qaPmText(REQS[state.sel],'md');
try{await navigator.clipboard.writeText(txt);}catch(e){
 const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}
btn.textContent='已复制 ✓';setTimeout(()=>{btn.textContent='复制';},1600);}
function pmShares(req){const ss=(req.qa||{}).shares||[];if(!ss.length)return '';
return '<div class="qa-sec"><div class="lab">已生成的产品确认链接（局域网内可打开；产品选择确认后，会作为「待 AI 确认」的改动回到这里）</div>'+
ss.map(s=>'<div class="qa-tools" style="margin:4px 0"><input readonly value="'+esc(s.url)+'" style="flex:1;min-width:260px" onclick="this.select()">'+
'<button data-u="'+esc(s.url)+'" onclick="pmCopy(this)">复制链接</button>'+
'<span class="small muted">'+esc((s.qids||[]).join('、'))+' · 已答 '+(s.answers||0)+' 次 · 有效至 '+esc(ts(s.expires_at))+'</span>'+
(qaCanEdit()?'<button data-t="'+esc(s.token)+'" onclick="pmRevoke(this.dataset.t)">作废</button>':'')+'</div>').join('')+'</div>';}
async function pmPost(path,body){const req=REQS[state.sel];
const r=await fetch(BASE+'api/pm/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({folder:req.folder},body||{}))});
const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));req.qa=j.qa;render();return j;}
async function pmShare(){try{const j=await pmPost('share');try{await navigator.clipboard.writeText(j.url);}catch(e){}
alert('已生成并复制链接：\n'+j.url+'\n\n发给产品即可（需与你在同一内网 / VPN，且你的电脑开着）。');}catch(e){alert('生成失败：'+(e&&e.message||e));}}
async function pmRevoke(t){if(!confirm('作废这个链接？作废后产品将无法再打开。'))return;try{await pmPost('revoke',{token:t});}catch(e){alert('作废失败：'+(e&&e.message||e));}}
async function pmCopy(btn){const u=btn.dataset.u;try{await navigator.clipboard.writeText(u);}catch(e){const ta=document.createElement('textarea');ta.value=u;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}
btn.textContent='已复制 ✓';setTimeout(()=>{btn.textContent='复制链接';},1500);}
function notifyBtn(){if(!('Notification' in window))return '';
if(Notification.permission==='granted')return '<span class="small muted">🔔 桌面通知已开启</span>';
if(Notification.permission==='denied')return '<span class="small muted">桌面通知被浏览器禁止（在地址栏左侧的站点设置里允许）</span>';
return '<button onclick="Notification.requestPermission().then(()=>render())">🔔 开启桌面通知（产品确认后提醒我）</button>';}
function viewQa(req){const qa=req.qa||{};const qs=qa.questions||[];
if(!qa.exists)return '<div class="panel">尚无 <code>Step 1-需求澄清问答记录.md</code>。</div>';
if(!qs.length)return '<div class="banner warn">问答记录还是旧版表格格式（待PM确认 '+(qa.legacy_pm||0)+' 行），看板无法逐题展示与编辑。按 step-01 的「一个问题一节」格式迁移后即可。</div>';
let h='';
if(!qaCanEdit())h+='<div class="banner warn"><b>只读</b>：编辑保存需要通过看板服务打开 —— <code>python scripts/verify_dashboard.py --dir "&lt;需求目录&gt;" --serve</code>'+(state.served&&state.api===false?'（当前是普通静态服务，没有保存接口）':'')+'</div>';
const pend=qa.pending||[];
if(pend.length)h+='<div class="banner warn"><b>'+pend.length+' 条看板改动等待 AI 确认</b>：'+pend.map(c=>esc(c.qid)+'（'+esc(ts(c.at))+'）').join('、')+
'。回到对话里告诉 AI「看板改了」，AI 会逐条列出改前 / 改后跟你确认，同步 Spec / Checklist 等下游后再标记为已确认。</div>';
const cnt={};QA_ST.forEach(s=>cnt[s]=qs.filter(q=>q["状态"]===s).length);
h+='<div class="agg-row">'+QA_ST.map(s=>'<div class="item"><span class="lab">'+s+'</span><span class="num">'+cnt[s]+'</span></div>').join('')+
'<div class="item"><span class="lab">共</span><span class="num">'+qs.length+'</span></div></div>';
const pm=qs.filter(q=>q["状态"]==="待PM确认");
h+='<div class="panel"><div class="qa-tools"><h3 style="margin:0">待产品确认（'+pm.length+'）</h3>'+notifyBtn()+'<span style="flex:1"></span>'+
'<button onclick="qaCopy(this)"'+(pm.length?'':' disabled')+'>复制</button><button onclick="qaDownload(\'md\')"'+(pm.length?'':' disabled')+'>导出 .md</button>'+
'<button onclick="qaDownload(\'csv\')"'+(pm.length?'':' disabled')+'>导出 .csv（Excel）</button>'+
(qaCanEdit()?'<button onclick="pmShare()"'+(pm.length?'':' disabled')+' style="border-color:var(--run);color:var(--run);font-weight:600">生成产品确认链接</button>':'')+'</div>'+
pmShares(req)+
(pm.length?pm.map(q=>qaCard(req,q,true)).join(''):'<div class="muted" style="margin-top:6px">无待产品确认的问题。</div>')+'</div>';
const pmDone=pmChanges(req);
if(pmDone.length){const byQ={};pmDone.forEach(c=>{byQ[c.qid]=c;});
 h+='<div class="panel" style="border-left:4px solid var(--ro)"><div class="qa-tools"><h3 style="margin:0">产品已确认（待处理 '+Object.keys(byQ).length+'）</h3><span style="flex:1"></span>'+
 '<span class="small muted">回到对话告诉 AI「产品确认了」，AI 逐条跟你确认后同步下游</span></div>'+
 Object.values(byQ).map(c=>{const q=qs.find(x=>x.id===c.qid);if(!q)return '';
  return '<div class="small" style="margin:10px 0 -4px;color:var(--ro)"><b>'+esc(String(c.by||'').replace(/^pm:/,'')||'产品')+'</b> 于 '+esc(ts(c.at))+' 确认</div>'+qaCard(req,q,true);}).join('')+'</div>';}
const groups=(qa.groups||[]).filter(g=>qs.some(q=>q.group===g));
if(qs.some(q=>!q.group))groups.unshift('');
groups.forEach(g=>{const list=qs.filter(q=>(q.group||'')===g);
 h+='<div class="panel"><h3>'+esc(g||'未分组')+'（'+list.length+'）</h3>'+list.map(q=>qaCard(req,q)).join('')+'</div>';});
return h;}

// ================= 服务模式：现场重建快照，内容随磁盘实时更新 =================
function snapSig(s){const c=Object.assign({},s);delete c.generated_at;return JSON.stringify(c);}
async function pollReqs(){if(!state.served||!PAYLOAD.is_index||state.view!=="all")return;
try{const r=await fetch(BASE+'api/reqs?t='+Date.now(),{cache:'no-store'});
 if(!r.ok||!(r.headers.get('content-type')||'').includes('json')){if(state.api===null)state.api=false;return;}
 const j=await r.json();state.api=true;
 const a=REQS.map(x=>x.folder).sort().join('|'),b=(j.active||[]).slice().sort().join('|');
 const c=ARCH.map(x=>x.folder).sort().join('|'),d=(j.archived||[]).slice().sort().join('|');
 if(a!==b||c!==d)location.reload();}catch(e){}}
async function pollSnap(){if(!state.served||state.api===false)return false;
const idx=(MULTI&&state.view==="all")?((state.tick%3===1||document.hidden)?REQS.map((_,i)=>i):[]):[state.sel];
let changed=false;
for(const i of idx){const r=REQS[i];if(!r)continue;
 try{const res=await fetch(BASE+'api/snapshot?folder='+encodeURIComponent(r.folder)+'&t='+Date.now(),{cache:'no-store'});
  if(res.status===404&&state.api===null){state.api=false;return false;}
  if(!res.ok)continue;const ct=res.headers.get('content-type')||'';if(!ct.includes('json')){state.api=false;return false;}
  const s=await res.json();state.api=true;const sig=snapSig(s);
  const prev=state.snapSig[r.folder]!==undefined?state.snapSig[r.folder]:snapSig(r);
  state.snapSig[r.folder]=sig;
  if(prev!==sig){REQS[i]=Object.assign(r,s);changed=true;}
 }catch(e){}}
return changed;}

const TABS=["overview","qa","cases","evidence","regression","timeline","guide"];
function syncHash(){const r=REQS[state.sel];if(!r)return;
const h=(state.view==="all"&&MULTI)?"#":"#/"+encodeURIComponent(r.folder)+(state.tab&&state.tab!=="overview"?"/"+state.tab:"");
if(location.hash!==h)history.replaceState(null,"",h||location.pathname+location.search);}
function tab(k){state.tab=k;state.qaEdit=null;syncHash();render();}
function sel(i){state.sel=i;state.tab="overview";state.view="one";syncHash();render();}
function back(){state.view="all";history.replaceState(null,"","#");render();}
function fromHash(){const parts=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean).map(x=>{try{return decodeURIComponent(x);}catch(e){return x;}});
const i=parts.length?REQS.findIndex(r=>r.folder===parts[0]):-1;
state.tab=(parts[1]&&TABS.includes(parts[1]))?parts[1]:"overview";
if(i>=0){state.sel=i;state.view="one";return true;}
if(!MULTI&&REQS.length){state.sel=0;return true;}
state.view="all";return false;}
window.addEventListener('hashchange',()=>{fromHash();state.qaEdit=null;render();});
function toggle(t){state.open.has(t)?state.open.delete(t):state.open.add(t);render();}
function toggleR(t){state.openR.has(t)?state.openR.delete(t):state.openR.add(t);render();}
function fstat(s){state.filter.status.has(s)?state.filter.status.delete(s):state.filter.status.add(s);render();}
function ffc(s){state.filter.fc.has(s)?state.filter.fc.delete(s):state.filter.fc.add(s);render();}
function frv(s){state.filter.rv.has(s)?state.filter.rv.delete(s):state.filter.rv.add(s);render();}
function frisk(v){state.filter.risk=v;render();}
function fev(v){state.filter.ev=v;render();}
function fq(v){state.filter.q=v;render();}

function setLive(cls,txt){const d=document.getElementById('dot');if(d)d.className='dot '+cls;
const t=document.getElementById('liveTxt');if(t)t.textContent=txt;}
let inFlight=false;
function pmChanges(r){return ((r.qa||{}).pending||[]).filter(c=>String(c.by||'').startsWith('pm:'));}
const BASE_TITLE=document.title;
function checkPmNotify(){const all=[];REQS.forEach(r=>pmChanges(r).forEach(c=>all.push([r,c])));
if(state.seenChg===undefined){state.seenChg=new Set(all.map(x=>x[1].id));}
else{all.forEach(([r,c])=>{if(state.seenChg.has(c.id))return;state.seenChg.add(c.id);
 if('Notification' in window&&Notification.permission==='granted'){
  const n=new Notification('产品已确认 '+c.qid+' · '+(r.id||''),{body:(c.title||'')+'\n'+String((c.after||{})["当前结论"]||'').slice(0,90),tag:c.id});
  n.onclick=()=>{window.focus();const i=REQS.indexOf(r);if(i>=0){state.sel=i;state.view="one";state.tab="qa";syncHash();render();}n.close();};}});}
const pend=new Set(all.map(x=>x[1].qid+'@'+x[0].folder)).size;
document.title=(pend?'('+pend+') ':'')+BASE_TITLE;}
async function poll(manual){if(inFlight)return;
// 后台标签页也要检查（否则收不到产品确认的通知），只是降频到约 30 秒一次
if(!manual&&document.hidden){state.hidTick=(state.hidTick||0)+1;if(state.hidTick%6)return;}
inFlight=true;
let ok=0,miss=0,fail=0,last="";
for(const r of REQS){try{const ac=new AbortController();const to=setTimeout(()=>ac.abort(),4000);
const res=await fetch(BASE+r.registry_rel+'?t='+Date.now(),{cache:'no-store',signal:ac.signal});clearTimeout(to);
if(res.status===404){miss++;}
else if(!res.ok)throw new Error('HTTP '+res.status);
else{state.registry[r.folder]=await res.json();last=state.registry[r.folder].updated_at||last;ok++;}
}catch(e){fail++;}
if(r.handover_rel){try{const ac2=new AbortController();const to2=setTimeout(()=>ac2.abort(),3000);
const hr=await fetch(BASE+r.handover_rel+'?t='+Date.now(),{cache:'no-store',signal:ac2.signal});clearTimeout(to2);
if(hr.ok){const hj=await hr.json();r.handover=Object.assign(r.handover||{},{
status:hj.status||(r.handover&&r.handover.status)||"未进入",
parentIssue:hj.parentIssue,assigneeEmail:hj.assigneeEmail,targetStatus:hj.targetStatus,
note:hj.note||"",matchedAt:hj.matchedAt,decidedAt:hj.decidedAt,exists:true,
mapping:hj.mapping||(r.handover&&r.handover.mapping)||[],
jiraActions:hj.jiraActions||(r.handover&&r.handover.jiraActions)||[],
matched:(hj.mapping||[]).filter(x=>x&&x.subtaskKey).length,
total_map:(hj.mapping||[]).length,
unmatched:(hj.mapping||[]).filter(x=>!(x&&x.subtaskKey)).length});
applyHandover(r);
}}catch(e){/* handover 可选 */}}}
inFlight=false;state.fail=(fail&&!ok)?state.fail+1:0;
state.noReg=(!ok&&miss>0&&!fail);
if(!state.served){setLive('warn','快照 '+ts(PAYLOAD.generated_at));}
else if(ok){setLive('','实时 · 状态更新 '+ago(last));}
else if(state.noReg){if(state.api===true)setLive('','实时 · 内容随磁盘更新');else setLive('warn','无 status 登记');}
else{setLive('down','拉取失败');}
const sig=REQS.map(r=>r.acs.map(a=>a.token+a.status+(a.handoverStatus||'')+(a.updated_at||'')).join()+'|'+(r.handover&&r.handover.status)+'|'+(r.handover&&(r.handover.jiraActions||[]).length)).join('|')+state.fail+'|'+state.served+'|'+state.noReg;
state.tick++;const apiBefore=state.api;await pollReqs();const snapChanged=(await pollSnap())||state.api!==apiBefore;
checkPmNotify();
if(state.served&&state.api===true&&!ok&&!fail)setLive('','实时 · 内容随磁盘更新');
if(state.qaEdit)return;
if(manual||snapChanged||sig!==state.lastSig){state.lastSig=sig;render();}}

document.getElementById('refresh').onclick=()=>poll(true);
document.getElementById('theme').onclick=()=>{const b=document.body;const cur=b.getAttribute('data-t');
b.setAttribute('data-t',cur==='light'?'dark':cur==='dark'?'':'light');};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll(false);});
(function init(){const sw=document.getElementById('switcher');
if(REQS.length>1){sw.innerHTML='<select id="rsel">'+REQS.map((r,i)=>'<option value="'+i+'" title="'+esc((r.id?r.id+' · ':'')+r.name)+'"'+(i===state.sel?' selected':'')+'>'+
esc((r.id?r.id+' · ':'')+r.name)+'</option>').join('')+'</select>';
const rs=document.getElementById('rsel');rs.onchange=e=>{sel(+e.target.value);rs.title=rs.options[rs.selectedIndex].title;};rs.title=rs.options[rs.selectedIndex]?rs.options[rs.selectedIndex].title:'';}
{const tt=document.getElementById('title');tt.textContent=(MULTI?'所有进行中需求 · 验证进度看板':'验证进度看板 · '+(REQS[0]?REQS[0].id+' '+REQS[0].name:''));tt.title=tt.textContent;}
fromHash();
render();checkPmNotify();poll(false);setInterval(()=>poll(false),POLL_MS);})();
</script></body></html>"""


def render_page(payload: dict, base: str, title: str) -> str:
    data = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    return (PAGE.replace("__TITLE__", title).replace("__BASE__", base)
            .replace("__DATA__", data))


# ------------------------------------------------------------ 输出

def _atomic_write(path: Path, text: str):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def build_one(req: Path, workflow, ttl) -> dict:
    return build_snapshot(req, workflow, ttl)


ARCHIVE_DIR = "archived"
STATE_FILE = ".workflow-state.json"


def _split_name(folder: str):
    """目录名 {Sprint}-{票号}-{标题} → (票号, 标题)；与 build_snapshot 同口径。"""
    parts = folder.split("-")
    rid = next((p for p in parts if re.match(r"^[A-Z]{2,6}-\d+$", p)), "")
    m = re.search(r"[A-Z]{2,6}-\d+", folder)
    if m:
        rid = m.group(0)
        return rid, folder[m.end():].lstrip("-").strip() or folder
    return rid, folder


def _read_state(d: Path) -> dict:
    try:
        return json.loads((d / STATE_FILE).read_text(encoding="utf-8-sig"))
    except Exception:
        return {}


def _write_state(d: Path, st: dict) -> None:
    _atomic_write(d / STATE_FILE, json.dumps(st, ensure_ascii=False, indent=2))


def discover_archived(develop: Path) -> list:
    a = develop / ARCHIVE_DIR
    out = []
    if not a.is_dir():
        return out
    for p in a.iterdir():
        if not p.is_dir() or p.name.startswith("."):
            continue
        ar = _read_state(p).get("archived") or {}
        rid, name = _split_name(p.name)
        out.append({"folder": p.name, "id": rid, "name": name,
                    "archived_at": ar.get("at") or "", "completed": ar.get("status") or "",
                    "has_page": (p / "验证进度看板.html").exists()})
    out.sort(key=lambda x: x["archived_at"] or "", reverse=True)
    return out


def build_index_payload(develop: Path, workflow=None, ttl: float = 20.0, focus: Path = None) -> dict:
    snaps = []
    reqs, _skipped = discover_requirements(develop, EXCLUDE_DEFAULT)
    for r in reqs:
        try:
            snaps.append(build_one(r, workflow if (focus is None or r == focus) else None, ttl))
        except Exception as e:  # 单个需求出错不影响整体
            print(f"[warn] 构建 {r.name} 失败：{e}", file=sys.stderr)
    return {"generated_at": now_iso(), "develop": str(develop), "reqs": snaps,
            "archived": discover_archived(develop), "is_index": True}


def write_req_page(develop: Path, req: Path, out_name: str = "验证进度看板.html", snap: dict = None) -> Path:
    snap = snap or build_snapshot(req)
    page = render_page({"generated_at": snap["generated_at"], "develop": str(develop), "reqs": [snap]},
                       "../", f"验证进度看板 · {snap['id']} {snap['name']}")
    _atomic_write(req / out_name, page)
    return req / out_name


def archive_req(develop: Path, folder: str) -> dict:
    """归档：先刷新该需求自己的看板页（留存最终快照）→ 目录移到 archived/ → 标记「已完成」。

    移动失败（文件被占用等）时不留半截状态：标记写在移动成功之后。
    """
    src = develop / folder
    dst = develop / ARCHIVE_DIR / folder
    if dst.exists():
        raise ValueError(f"archived/ 下已有同名目录：{folder}")
    try:
        write_req_page(develop, src)
    except Exception as e:  # 快照失败不阻止归档
        print(f"[warn] 归档前刷新看板失败：{e}", file=sys.stderr)
    (develop / ARCHIVE_DIR).mkdir(exist_ok=True)
    shutil.move(str(src), str(dst))
    st = _read_state(dst)
    st["archived"] = {"at": now_iso(), "status": "已完成"}
    _write_state(dst, st)
    return st["archived"]


def unarchive_req(develop: Path, folder: str) -> None:
    src = develop / ARCHIVE_DIR / folder
    dst = develop / folder
    if dst.exists():
        raise ValueError(f"develop/ 下已有同名目录：{folder}")
    shutil.move(str(src), str(dst))
    st = _read_state(dst)
    ar = st.pop("archived", None)
    st.setdefault("archive_history", []).append({"archived": ar, "restored_at": now_iso()})
    _write_state(dst, st)


def write_outputs(develop: Path, req: Path, snapshot: dict, out_name: str,
                  also_index: bool, workflow=None, ttl: float = 20.0) -> list:
    written = []
    # 1) 单需求页面（BASE 指向 develop：'../'）
    page = render_page({"generated_at": snapshot["generated_at"], "develop": str(develop),
                        "reqs": [snapshot]}, "../",
                       f"验证进度看板 · {snapshot['id']} {snapshot['name']}")
    one = req / out_name
    _atomic_write(one, page)
    written.append(one)
    # 2) 外层总览页（BASE='' ，所有需求）
    if also_index:
        payload = build_index_payload(develop, workflow, ttl, focus=req)
        if not payload["reqs"] and not payload["archived"]:
            # 🔴 扫不到需求时**不要**覆盖总览 —— 否则一次异常扫描就把整个看板清成
            # 「没有发现需求目录」，而且不报错（静默失效）。宁可保留旧总览。
            print("[verify-dashboard] [warn] 未发现任何需求目录，index.html 保持原样（不覆盖）",
                  file=sys.stderr)
            return written
        idx = render_page(payload, "", "所有进行中需求 · 验证进度看板")
        _atomic_write(develop / "index.html", idx)
        written.append(develop / "index.html")
    return written


PM_PAGE = r"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>需求确认</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1f2328;--muted:#6b7280;--line:#e5e7eb;--acc:#2563eb;--ok:#16a34a;--warn:#d97706;--err:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--card:#171b21;--fg:#e6e8eb;--muted:#9aa4b1;--line:#2a313a;--acc:#60a5fa;--ok:#4ade80;--warn:#fbbf24;--err:#f87171}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:20px 16px 60px}h1{font-size:20px;margin:0 0 4px}.muted{color:var(--muted)}.small{font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:14px 0}
.card.done{border-left:4px solid var(--ok)}.head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.qid{font-weight:800}.qt{font-weight:700;flex:1}
.lab{font-size:12px;color:var(--muted);font-weight:600;margin:10px 0 4px}
.opt{display:block;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0;cursor:pointer}
.opt:hover{border-color:var(--acc)}.opt.on{border-color:var(--acc);background:rgba(37,99,235,.08)}
textarea,input[type=text]{width:100%;font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
textarea{min-height:80px}button{font:inherit;border:1px solid var(--acc);background:var(--acc);color:#fff;border-radius:8px;padding:7px 16px;cursor:pointer}
button:disabled{opacity:.5;cursor:default}.badge{font-size:12px;border:1px solid;border-radius:999px;padding:1px 8px}
.ok{color:var(--ok);border-color:var(--ok)}.wait{color:var(--warn);border-color:var(--warn)}.err{color:var(--err)}
.top{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px}
</style></head><body><main id="app"><div class="muted">加载中…</div></main>
<script>
const TOKEN=location.pathname.split('/').filter(Boolean).pop();
let DATA=null,PICK={},MSG={},NAME=localStorage.getItem('pm_name')||'';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function lines(s){return esc(s).split('\n').join('<br>');}
async function load(){try{const r=await fetch('/pm/api/'+encodeURIComponent(TOKEN),{cache:'no-store'});const j=await r.json();
 if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));DATA=j;render();}
 catch(e){document.getElementById('app').innerHTML='<div class="card err">无法打开：'+esc(e.message)+'</div>';}}
function render(){const qs=DATA.questions||[];const done=qs.filter(q=>q.status==='PM已确认').length;
let h='<div class="top"><h1>需求确认</h1><div><b>'+esc(DATA.req_id)+'</b> '+esc(DATA.req_name)+'</div>'+
'<div class="muted small">共 '+qs.length+' 个问题，已确认 '+done+' 个 · 链接有效期至 '+esc((DATA.expires_at||'').replace('T',' ').slice(0,16))+'</div>'+
'<div class="lab">你的名字（选填，会记录在确认记录里）</div><input type="text" id="nm" value="'+esc(NAME)+'" oninput="NAME=this.value;localStorage.setItem(\'pm_name\',NAME)" placeholder="例如 Linda"></div>';
qs.forEach(q=>{const d=q.status==='PM已确认';const sel=PICK[q.id]!==undefined?PICK[q.id]:(q.picked||'');
 h+='<div class="card'+(d?' done':'')+'"><div class="head"><span class="qid">'+esc(q.id)+'</span><span class="qt">'+esc(q.title)+'</span>'+
 (d?'<span class="badge ok">已确认</span>':q.status==='待PM确认'?'<span class="badge wait">待确认</span>':'<span class="badge">'+esc(q.status)+'</span>')+'</div>'+
 '<div class="lab">问题说明</div><div>'+lines(q.desc)+'</div><div class="lab">请选择</div>'+
 q.options.map(o=>'<label class="opt'+(sel===o.key?' on':'')+'"><input type="radio" name="o-'+q.id+'" value="'+esc(o.key)+'"'+(sel===o.key?' checked':'')+
   ' onchange="PICK[\''+q.id+'\']=this.value;render()"> <b>'+esc(o.key)+'.</b> '+lines(o.text)+'</label>').join('')+
 '<label class="opt'+(sel==='自定义'?' on':'')+'"><input type="radio" name="o-'+q.id+'" value="自定义"'+(sel==='自定义'?' checked':'')+
   ' onchange="PICK[\''+q.id+'\']=this.value;render()"> <b>自定义</b>（以上都不合适，直接写你的答复）</label>'+
 '<div class="lab">'+(sel==='自定义'?'你的答复（必填）':'补充说明（选填）')+'</div><textarea id="t-'+q.id+'">'+esc(MSG[q.id]||(d&&q.picked==='自定义'?q.conclusion:''))+'</textarea>'+
 '<div style="margin-top:10px;display:flex;gap:10px;align-items:center"><button onclick="submitQ(\''+q.id+'\')"'+(sel?'':' disabled')+'>'+(d?'修改确认':'确认')+'</button>'+
 '<span class="small muted" id="s-'+q.id+'">'+(d?'已确认，可修改后重新提交':'')+'</span></div></div>';});
document.getElementById('app').innerHTML=h;}
async function submitQ(qid){const choice=PICK[qid]!==undefined?PICK[qid]:((DATA.questions.find(x=>x.id===qid)||{}).picked||'');
const text=document.getElementById('t-'+qid).value;MSG[qid]=text;const st=document.getElementById('s-'+qid);
if(choice==='自定义'&&!text.trim()){st.innerHTML='<span class="err">请填写你的答复</span>';return;}
st.textContent='提交中…';
try{const r=await fetch('/pm/api/'+encodeURIComponent(TOKEN)+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({qid,choice,text,name:NAME})});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));
 delete PICK[qid];delete MSG[qid];DATA=j.view;render();const s2=document.getElementById('s-'+qid);if(s2)s2.innerHTML='<span class="ok">已提交，谢谢！</span>';}
catch(e){st.innerHTML='<span class="err">提交失败：'+esc(e.message)+'</span>';}}
load();
</script></body></html>"""


class DashHandler(SimpleHTTPRequestHandler):
    """静态文件 + 接口（只监听 127.0.0.1）：
    GET  /api/snapshot?folder=<需求目录名>  现场重建该需求快照（问答 / Checklist / 流程 / 证据都读磁盘最新）
    POST /api/qa/save                        {folder, qid, fields}：改问答，并登记一条「待确认」改动
    GET  /api/ping
    """
    develop: Path = Path(".")

    def log_message(self, fmt, *args):  # 轮询很频繁，接口请求不刷屏
        if "/api/" not in (self.path or ""):
            super().log_message(fmt, *args)

    def _json(self, code: int, obj) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _req_dir(self, folder: str):
        if not folder or folder.startswith(".") or any(c in folder for c in "/\\:"):
            return None
        p = (self.develop / folder).resolve()
        return p if p.parent == self.develop.resolve() and p.is_dir() else None

    def _html(self, html: str) -> None:
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/ping":
            return self._json(200, {"ok": True})
        if u.path in ("/", "/index.html"):
            # 总览每次访问现场生成：新建 / 归档的需求立刻可见，不用手动重跑生成器
            html = render_page(build_index_payload(self.develop), "", "所有进行中需求 · 验证进度看板")
            try:
                _atomic_write(self.develop / "index.html", html)
            except Exception:
                pass
            return self._html(html)
        if u.path == "/api/reqs":
            reqs, _ = discover_requirements(self.develop, EXCLUDE_DEFAULT)
            return self._json(200, {"active": [r.name for r in reqs],
                                    "archived": [a["folder"] for a in discover_archived(self.develop)]})
        if u.path == "/api/snapshot":
            d = self._req_dir(parse_qs(u.query).get("folder", [""])[0])
            if d is None:
                return self._json(404, {"ok": False, "error": "unknown folder"})
            try:
                return self._json(200, build_snapshot(d))
            except Exception as e:  # 快照失败不影响静态页
                return self._json(500, {"ok": False, "error": str(e)})
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        # 防跨站：浏览器带 Origin 时必须与本服务同源
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host"):
            return self._json(403, {"ok": False, "error": "cross-origin rejected"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(min(n, 1_000_000)).decode("utf-8") or "{}")
        except Exception as e:
            return self._json(400, {"ok": False, "error": f"bad body: {e}"})
        if u.path in ("/api/req/archive", "/api/req/unarchive"):
            folder = str(body.get("folder", ""))
            if not folder or folder.startswith(".") or any(c in folder for c in "/\\:"):
                return self._json(400, {"ok": False, "error": "bad folder"})
            try:
                if u.path.endswith("/archive"):
                    if self._req_dir(folder) is None or folder.lower() in EXCLUDE_DEFAULT:
                        return self._json(404, {"ok": False, "error": "unknown folder"})
                    info = archive_req(self.develop, folder)
                else:
                    if not (self.develop / ARCHIVE_DIR / folder).is_dir():
                        return self._json(404, {"ok": False, "error": "unknown archived folder"})
                    unarchive_req(self.develop, folder)
                    info = {}
                return self._json(200, {"ok": True, "info": info})
            except (ValueError, OSError) as e:
                return self._json(409, {"ok": False, "error": f"{type(e).__name__}: {e}（目录可能被编辑器 / 终端占用）"})
        if u.path in ("/api/pm/share", "/api/pm/revoke"):
            d = self._req_dir(body.get("folder", ""))
            if d is None or qa_record is None:
                return self._json(404, {"ok": False, "error": "unknown folder"})
            if not PM_BASE:
                return self._json(503, {"ok": False, "error": "产品确认服务未启动（局域网端口不可用）"})
            try:
                if u.path.endswith("/share"):
                    s = qa_record.create_share(d)
                    return self._json(200, {"ok": True, "url": PM_BASE + "/pm/" + s["token"], "qa": load_qa(d)})
                qa_record.revoke_share(d, str(body.get("token", "")))
                return self._json(200, {"ok": True, "qa": load_qa(d)})
            except ValueError as e:
                return self._json(400, {"ok": False, "error": str(e)})
        if u.path != "/api/qa/save":
            return self._json(404, {"ok": False, "error": "not found"})
        if qa_record is None:
            return self._json(501, {"ok": False, "error": "qa_record.py missing"})
        try:
            d = self._req_dir(body.get("folder", ""))
            if d is None:
                return self._json(404, {"ok": False, "error": "unknown folder"})
            res = qa_record.update_question(d, str(body.get("qid", "")), body.get("fields") or {},
                                            by="dashboard", record_change=True)
            return self._json(200, {"ok": True, "changed": res["changed"],
                                    "change": res.get("change"), "qa": load_qa(d)})
        except (KeyError, ValueError) as e:
            return self._json(400, {"ok": False, "error": str(e)})
        except Exception as e:
            return self._json(500, {"ok": False, "error": str(e)})


def _find_share_req(develop: Path, token: str):
    if qa_record is None or not token:
        return None, None
    reqs, _ = discover_requirements(develop, EXCLUDE_DEFAULT)
    for r in reqs:
        s = qa_record.find_share(r, token)
        if s:
            return r, s
    return None, None


def _pm_view(req: Path, share: dict) -> dict:
    v = qa_record.share_view(req, share)
    rid, name = _split_name(req.name)
    v.update(ok=True, req_id=rid, req_name=name)
    return v


class PMHandler(SimpleHTTPRequestHandler):
    """局域网只开放产品确认页：GET /pm/<token>、GET /pm/api/<token>、POST /pm/api/<token>/answer。其余一律 404。"""
    develop: Path = Path(".")

    def log_message(self, *args):
        pass

    def _json(self, code, obj):
        DashHandler._json(self, code, obj)

    def do_GET(self):
        parts = [x for x in urlparse(self.path).path.split("/") if x]
        if len(parts) == 2 and parts[0] == "pm":
            req, s = _find_share_req(self.develop, parts[1])
            if not req:
                body = "<!DOCTYPE html><meta charset=utf-8><body style='font-family:sans-serif;padding:40px'>链接已失效或不存在，请联系需求负责人重新生成。</body>".encode("utf-8")
                self.send_response(404)
            else:
                body = PM_PAGE.encode("utf-8")
                self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if len(parts) == 3 and parts[:2] == ["pm", "api"]:
            req, s = _find_share_req(self.develop, parts[2])
            if not req:
                return self._json(404, {"ok": False, "error": "链接已失效或不存在"})
            return self._json(200, _pm_view(req, s))
        self.send_error(404)

    def do_POST(self):
        parts = [x for x in urlparse(self.path).path.split("/") if x]
        if not (len(parts) == 4 and parts[:2] == ["pm", "api"] and parts[3] == "answer"):
            return self.send_error(404)
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host"):
            return self._json(403, {"ok": False, "error": "cross-origin rejected"})
        req, s = _find_share_req(self.develop, parts[2])
        if not req:
            return self._json(404, {"ok": False, "error": "链接已失效或不存在"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(min(n, 100_000)).decode("utf-8") or "{}")
            qa_record.pm_answer(req, parts[2], str(body.get("qid", "")), str(body.get("choice", "")),
                                str(body.get("text", "")), str(body.get("name", "")))
            s2 = qa_record.find_share(req, parts[2]) or s
            return self._json(200, {"ok": True, "view": _pm_view(req, s2)})
        except PermissionError as e:
            return self._json(403, {"ok": False, "error": str(e)})
        except (KeyError, ValueError) as e:
            return self._json(400, {"ok": False, "error": str(e)})
        except Exception as e:
            return self._json(500, {"ok": False, "error": str(e)})


def lan_ip() -> str:
    """本机在局域网里的主 IP（UDP connect 不发包，只为让系统选出出口网卡）。"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def start_pm_server(develop: Path, port: int):
    global PM_BASE
    PMHandler.develop = develop
    try:
        httpd = ThreadingHTTPServer(("0.0.0.0", port), PMHandler)
    except OSError as e:
        print(f"[serve] 产品确认服务未启动（端口 {port}：{e}）")
        return None
    PM_BASE = f"http://{lan_ip()}:{port}"
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print(f"[serve] 产品确认页（局域网）：{PM_BASE}/pm/<令牌>")
    return httpd


def serve(develop: Path, port: int, page_rel: str = "index.html", pm_port: int = 8786):
    # directory= 让 SimpleHTTPRequestHandler 从 develop 根提供文件；
    # Python 3.8+ 用 UTF-8 解码路径，中文目录名可用。
    DashHandler.develop = develop
    if pm_port:
        start_pm_server(develop, pm_port)
    handler = functools.partial(DashHandler, directory=str(develop))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://127.0.0.1:{port}/" + "/".join(quote(x) for x in page_rel.split("/"))
    print(f"[serve] {develop}")
    print(f"[serve] 打开：{url}")
    print("[serve] Ctrl+C 结束")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] 已停止")


# ------------------------------------------------------------ main

def main() -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows 控制台默认 cp1252/gbk，打印中文会崩
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description="验证进度看板生成器")
    ap.add_argument("--dir", help="单个需求目录（其父目录即外层 develop 目录）")
    ap.add_argument("--develop", help="develop 外层目录（配合 --all）")
    ap.add_argument("--all", action="store_true", help="为 develop 下所有需求重建页面与外层总览")
    ap.add_argument("--workflow", choices=["fullstack", "backend"], help="强制工作流（默认自动探测）")
    ap.add_argument("--out", default="验证进度看板.html", help="单需求页面文件名")
    ap.add_argument("--ttl", type=float, default=20.0, help="「验证中/修复中」判僵尸的分钟数")
    ap.add_argument("--no-index", action="store_true", help="不刷新外层 index.html")
    ap.add_argument("--serve", action="store_true", help="生成后起本地服务（可实时刷新）")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--pm-port", type=int, default=8786, help="产品确认页的局域网端口（0 = 不开）")
    ap.add_argument("--open", action="store_true", help="生成后用浏览器打开")
    args = ap.parse_args()

    if args.dir:
        req = Path(args.dir).resolve()
        if not req.is_dir():
            print(f"[verify-dashboard] 目录不存在：{req}", file=sys.stderr)
            return 2
        develop = req.parent
        snap = build_one(req, args.workflow, args.ttl)
        files = write_outputs(develop, req, snap, args.out, not args.no_index,
                              args.workflow, args.ttl)
    elif args.all or args.develop:
        develop = Path(args.develop or ".").resolve()
        if not develop.is_dir():
            print(f"[verify-dashboard] 目录不存在：{develop}", file=sys.stderr)
            return 2
        reqs, skipped = discover_requirements(develop, EXCLUDE_DEFAULT)
        snaps = []
        for r in reqs:
            snaps.append(build_one(r, args.workflow, args.ttl))
        for r, s in zip(reqs, snaps):
            page = render_page({"generated_at": s["generated_at"], "develop": str(develop),
                                "reqs": [s]}, "../", f"验证进度看板 · {s['id']} {s['name']}")
            _atomic_write(r / args.out, page)
        files = [r / args.out for r in reqs]
        arch = discover_archived(develop)
        if snaps or arch:                         # 同 write_outputs：空扫描不覆盖总览
            idx = render_page({"generated_at": now_iso(), "develop": str(develop), "reqs": snaps,
                               "archived": arch, "is_index": True},
                              "", "所有进行中需求 · 验证进度看板")
            _atomic_write(develop / "index.html", idx)
            files.append(develop / "index.html")
        else:
            print("[verify-dashboard] [warn] 未发现任何需求目录，index.html 保持原样（不覆盖）",
                  file=sys.stderr)
        if skipped:
            print(f"[verify-dashboard] 跳过非需求目录：{[p.name for p in skipped]}")
    else:
        print("[verify-dashboard] 需要 --dir 或 --all/--develop", file=sys.stderr)
        return 2

    m = (snap["metrics"] if args.dir else
         {"total": sum(s["metrics"]["total"] for s in snaps),
          "progress": (sum(s["metrics"]["progress"] for s in snaps) / len(snaps) if snaps else 0)})
    print(f"[verify-dashboard] 已生成 {len(files)} 个文件：")
    for f in files:
        print(f"  - {f}")
    if args.dir:
        print(f"[verify-dashboard] AC {m['total']} 条 · 整体进度 {m['progress']*100:.0f}%")

    target = (Path(args.dir).resolve() / args.out) if args.dir else (Path(args.develop or ".").resolve() / "index.html")
    if args.open:
        webbrowser.open(target.as_uri())
    if args.serve:
        if args.dir:
            rq = Path(args.dir).resolve()
            serve(rq.parent, args.port, f"{rq.name}/{args.out}", args.pm_port)
        else:
            serve(target.parent, args.port, pm_port=args.pm_port)
    return 0


if __name__ == "__main__":
    sys.exit(main())