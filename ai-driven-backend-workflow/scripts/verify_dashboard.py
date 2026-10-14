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

前端资源在 scripts/dashboard/（index.html / app.css / app.js / pm.html）；Python 只负责数据 + 服务 + 生成时内联。

服务模式（--serve，推荐）：
  - 内容随磁盘实时更新：按「需求目录 + 关键文件 mtime 签名」缓存快照，页面每 5s 只发 1 个请求
    （/api/list 或 /api/req/<目录>?rev=，未变化返回 {unchanged:true}）；页面不可见时暂停。
  - 快照里每个 AC 只带证据计数 + 前 8 个预览；完整清单 /api/req/<目录>/evidence?ac=AC-NN 按需取，
    同一子目录 >50 个文件（录帧）折叠成一条。
  - 只监听 127.0.0.1 且校验 Host；静态文件只放行需求目录下 UI/ tests/ figma/ 与证据类后缀。
  - 服务模式不写 index.html / 验证进度看板.html（GET / 返回轻量外壳页）。

静态产物（不带 --serve）：
  - <需求目录>/验证进度看板.html：内联 css/js + 该需求完整数据（含完整证据清单），双击 file:// 可开。
  - <develop>/index.html：内联总览（证据只带预览）。

用法：
  py scripts/verify_dashboard.py --dir docs/develop/<需求目录>
  py scripts/verify_dashboard.py --all --develop docs/develop
  py scripts/verify_dashboard.py --dir docs/develop/<需求目录> --serve --port 8787
  py scripts/verify_dashboard.py --dir docs/develop/<需求目录> --no-index   # 不刷新外层总览

退出码：0 正常（含降级）；2 用法/前置错误（目录不存在）。
"""

from __future__ import annotations

import argparse
import contextlib
import datetime
import functools
import gzip
import hashlib
import html as html_mod
import json
import os
import re
import shutil
import socket
import tempfile
import threading
import sys
import time
import traceback
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

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


def _shared_verdict(text: str):
    """结论判定复用 `verify_state` 的那一套（表格行 / 顶层 `- 结论：` / 裸 emoji / 兜底）。

    原来这里自带第三套正则（优先级不同、还会产出英文 `NOT_RUN`）：同一个 RESULT.md 在
    门禁、登记脚本、看板三处可能判成不同结论。统一入口，不可导入时返回 None 走本地兜底。
    """
    try:
        import sys as _sys
        from pathlib import Path as _Path
        _sys.path.insert(0, str(_Path(__file__).resolve().parent))
        from verify_state import _verdict_text, classify_verdict
        if _verdict_text is None or classify_verdict is None:
            return None
        return classify_verdict(_verdict_text(text))
    except Exception:                                      # noqa: BLE001
        return None


def summarize_result(text: str) -> dict:
    """从 RESULT.md 提取结论/环境/降级/摘要。"""
    verdict = None
    for line in text.splitlines():
        if re.match(r"^\s*\|\s*结论\s*\|", line):
            verdict = line
            break
    probe = (verdict or text[:800])
    up = probe.upper()
    v = _shared_verdict(probe)
    if v == "待验证":
        v = "NOT_RUN"        # 看板内部沿用这个值（app.js 渲染时显示「待验证」）
    if v is None:            # verify_state 不可导入：本地兜底，口径与上面一致
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
                        size = p.stat().st_size
                    except OSError:
                        size = 0
                    # rel 不再重复「需求目录/tests/AC-NN/evidence/」长前缀：前端用 dir_rel 拼
                    entry["evidence"].append({
                        "p": p.relative_to(ev).as_posix(), "t": classify_evidence(p), "s": size,
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
            if e["t"] in ("image", "video"):
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
                f"py scripts/verify_state.py reclaim --dir <需求目录> --ac {a['token']} "
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
            media = [e for e in a.get("evidence", []) if e["t"] in ("image", "video")]
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
            "py scripts/verify_state.py init --dir <需求目录>")
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
    """Step1 问答记录 → 看板数据。服务模式下每次请求现场解析，保证看到的是磁盘上的最新内容。

    .qa-changes.json / .pm-share.json 损坏时 qa_record 会改名备份；这里把备份文件列进 errors，页面报红。
    """
    if qa_record is None or not (req / qa_record.RECORD).exists():
        return {"exists": False, "questions": [], "groups": [], "pending": [], "legacy_pm": 0, "errors": []}
    d = qa_record.load(req)
    log = qa_record.load_changes(req)
    sh = qa_record.load_shares(req)
    errors = []
    for x in (log, sh):
        if x.get("corrupt"):
            errors.append(f"{x['corrupt']['file']}：{x['corrupt']['error']}")
    for name in getattr(qa_record, "corrupt_backups", lambda _r: [])(req):
        msg = f"发现损坏备份 {name}（原文件不是合法 JSON，已改名留档；其中登记的改动 / 分享未计入）—— 人工核对后删除该文件"
        if not any(name in e for e in errors):
            errors.append(msg)
    return {"exists": True, "groups": d["groups"], "legacy_pm": d["legacy_pm"],
            "questions": [qa_record._pub(q) for q in d["questions"]],
            "pending": [c for c in log["changes"] if c.get("status") == "待确认"],
            "errors": errors,
            "shares": [{"token": s["token"], "url": (PM_BASE + "/pm/" + s["token"]) if PM_BASE else "",
                        "created_at": s.get("created_at"), "expires_at": s.get("expires_at"),
                        "qids": s.get("qids", []), "answers": len(s.get("answers", []))}
                       for s in sh["shares"] if s.get("status") == "active" and s.get("token")]}


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


def looks_like_req(p: Path) -> bool:
    try:
        return p.is_dir() and ((p / ".workflow-state.json").exists()
                               or (p / "tests").is_dir()
                               or any(p.glob("Step *-Checklist.md"))
                               or any(p.glob("Step 1-*.md")))
    except OSError:
        return False


def discover_requirements(develop: Path, excludes):
    out, skipped = [], []
    ex = {e.lower() for e in excludes}
    for p in sorted(develop.iterdir(), key=lambda x: x.name.lower()):
        if not p.is_dir() or p.name.startswith(".") or p.name.lower() in ex:
            continue
        (out if looks_like_req(p) else skipped).append(p)
    return out, skipped


# ------------------------------------------------------------ 证据精简（快照只放预览，完整清单按需取）

EV_PREVIEW = 8      # 每个 AC 在快照里带的预览条数
EV_GROUP_MIN = 50   # 同一子目录文件数超过它就折叠成一个条目（录帧原图等）
FC_ORDER = ["未终验", "终验中", "终验通过", "终验不通过", "豁免"]
FINISHED = {"通过", "失败", "阻塞", "部分", "走读证据", "跳过"}
DECIDED5 = {"通过", "失败", "阻塞", "部分", "走读证据"}
OUT_NAME = "验证进度看板.html"


def _ev_parent(p: str) -> str:
    return p.rsplit("/", 1)[0] if "/" in p else ""


def compact_evidence(items: list):
    """完整证据清单 → (折叠后的清单, {子目录: [文件…]})。"""
    by: dict = {}
    for e in items:
        by.setdefault(_ev_parent(e["p"]), []).append(e)
    big = {d for d, xs in by.items() if d and len(xs) > EV_GROUP_MIN}
    out, seen = [], set()
    for e in items:
        d = _ev_parent(e["p"])
        if d in big:
            if d not in seen:
                seen.add(d)
                xs = by[d]
                out.append({"g": d, "t": "group", "n": len(xs), "s": sum(x["s"] for x in xs),
                            "img": sum(1 for x in xs if x["t"] == "image")})
        else:
            out.append(e)
    return out, {d: by[d] for d in big}


def preview_evidence(items: list) -> list:
    """预览：优先不在录帧大目录里的图片 / 视频，再补其他文件，最多 EV_PREVIEW 条。"""
    if len(items) <= EV_PREVIEW:
        return list(items)
    by: dict = {}
    for e in items:
        by.setdefault(_ev_parent(e["p"]), []).append(e)
    small = [e for e in items if not (_ev_parent(e["p"]) and len(by[_ev_parent(e["p"])]) > EV_GROUP_MIN)]
    pick = [e for e in small if e["t"] in ("image", "video")]
    pick += [e for e in small if e["t"] not in ("image", "video")]
    pick += [e for e in items if e not in small and e["t"] == "image"]
    return pick[:EV_PREVIEW]


def publish_snapshot(snap: dict, full: bool = False):
    """内部快照（evidence 为完整清单）→ (对外快照, {AC: (折叠清单, 分组)})。

    full=True（单需求静态页）把完整清单内联进 ev_all / ev_groups，file:// 下证据页也完整可用。
    """
    pub = dict(snap)
    acs, evmap = [], {}
    for a in snap.get("acs") or []:
        items = a.get("evidence") or []
        b = {k: v for k, v in a.items() if k != "evidence"}
        if isinstance(b.get("result"), dict):  # RESULT.md 前 2500 字前端不用（原文点按钮现取），占快照四成体积
            b["result"] = {k: v for k, v in b["result"].items() if k != "head"}
        b["ev_n"] = len(items)
        b["ev_media"] = sum(1 for e in items if e["t"] in ("image", "video"))
        b["ev"] = preview_evidence(items)
        coll, groups = compact_evidence(items)
        if full:
            b["ev_all"], b["ev_groups"] = coll, groups
        evmap[a["token"]] = (coll, groups)
        acs.append(b)
    pub["acs"] = acs
    return pub, evmap


# ------------------------------------------------------------ 列表摘要（总览表 / 轮询用）

def ui_risks(pub: dict, ttl: float = 20.0, now=None) -> list:
    """与前端 risks() 同口径（总览表的「高风险」数要和详情页一致）。返回 [(level, ac)]。"""
    now = now or datetime.datetime.now().astimezone()

    def stale(x):
        t = parse_ts(x)
        if t is None:
            return True
        if t.tzinfo is None:
            t = t.replace(tzinfo=now.tzinfo)
        return (now - t).total_seconds() / 60 > ttl

    out = []
    acs = pub.get("acs") or []
    for a in acs:
        st, tok, fs = a.get("status"), a.get("token"), a.get("final_status") or "未终验"
        if st in ("失败", "阻塞"):
            out.append(("high", tok, None))
        if st in BUSY and stale(a.get("updated_at")):
            out.append(("high", tok, None))
        if st == "通过" and a.get("ck") == "open":
            out.append(("medium", tok, "r1"))
        if a.get("ck") == "done" and st in ("失败", "阻塞"):
            out.append(("medium", tok, "r2"))
        if st == "通过" and a.get("has_dir") and not a.get("ev_n"):
            out.append(("medium", tok, "r3"))
        if a.get("has_dir") and not (a.get("has_replay") or a.get("has_script")):
            out.append(("low", tok, "r4"))
        if fs == "终验不通过":
            out.append(("high", tok, None))
        if fs == "终验中" and stale(a.get("final_at")):
            out.append(("low", tok, None))
        if st in FINISHED and fs == "未终验":
            out.append(("low", tok, "r5"))
    if not any(a.get("has_dir") for a in acs) and any(a.get("status") in DECIDED5 for a in acs):
        out.append(("medium", None, None))
    for r in pub.get("regressions") or []:
        if not r.get("ok"):
            out.append(("medium", r.get("token"), None))
    for n, _t in pub.get("step_spec") or []:
        i = (pub.get("steps") or {}).get(str(n)) or {}
        if (i.get("consecutive_fails") or 0) > 2:
            out.append(("high", None, None))
    groups, flat = {}, []
    for x in out:
        if x[2] and x[1]:
            groups.setdefault(x[2], []).append(x)
        else:
            flat.append(x)
    for its in groups.values():
        flat.extend(its if len(its) <= 5 else [(its[0][0], None, None)])
    return [(x[0], x[1]) for x in flat]


def next_step(steps: dict, step_spec, step_files=None):
    """流程下一步（总览「下一步」列）：已通过的最高步之后、第一个未通过的步骤；全部走完 → None。

    读的是 .workflow-state.json 的 steps[n].passed（与 compute_metrics 的 steps_ok 同口径）。
    最高通过步之前未通过的步骤（旧需求常没记 Step 1 / 10）不当成「下一步」，放进 gaps 供悬浮提示。
    没有任何步骤记录（缺 .workflow-state.json）时，按顶层 `Step N-*` 产出文件推断已到哪一步（inferred=True）。
    """
    spec = [(int(n), t) for n, t in (step_spec or [])]
    if not spec:
        return None
    ok = {n for n, _ in spec if ((steps or {}).get(str(n)) or {}).get("passed")}
    inferred = False
    if ok:
        top = max(ok)
    else:
        nums = [int(k) for k in (step_files or {}) if str(k).isdigit()]
        top, inferred = (max(nums), True) if nums else (0, False)
    gaps = [n for n, _ in spec if n < top and n not in ok] if not inferred else []
    for n, title in spec:
        if n > top and n not in ok:
            return {"n": n, "name": title, "gaps": gaps, "inferred": inferred}
    return None


def _iso(ts) -> str:
    if not ts:
        return ""
    return datetime.datetime.fromtimestamp(ts).astimezone().isoformat(timespec="seconds")


def summarize(pub: dict, rev: str = "", last=None) -> dict:
    acs = pub.get("acs") or []
    total = len(acs)
    cnt = {s: 0 for s in STATUSES}
    ck = {"open": 0, "done": 0, "blocked": 0, "waived": 0, "none": 0}
    fc = {s: 0 for s in FC_ORDER}
    fc_base = ev_n = 0
    for a in acs:
        st = a.get("status") or "待验证"
        cnt[st if st in cnt else "待验证"] += 1
        k = a.get("ck") or "none"
        ck[k] = ck.get(k, 0) + 1
        f = a.get("final_status") or "未终验"
        fc[f if f in fc else "未终验"] += 1
        if st in FINISHED:
            fc_base += 1
        ev_n += a.get("ev_n") or 0
    decided = cnt["通过"] + cnt["失败"] + cnt["阻塞"] + cnt["部分"]
    impl = ck["done"] / total if total else 0.0
    pr = cnt["通过"] / decided if decided else None
    regs = pub.get("regressions") or []
    rd = sum(1 for r in regs if r.get("ok"))
    rr = rd / len(regs) if regs else None
    rs = ui_risks(pub)
    qa = pub.get("qa") or {}
    qs = qa.get("questions") or []
    pend = qa.get("pending") or []
    ho = pub.get("handover") or {}
    m = re.match(r"^(\d{2}Q\d-Sprint\d+)", pub.get("folder") or "")
    return {
        "folder": pub.get("folder"), "id": pub.get("id"), "name": pub.get("name"),
        "branch": pub.get("branch"), "sprint": m.group(1) if m else (pub.get("branch") or ""),
        "workflow": pub.get("workflow"), "rev": rev, "last_change": _iso(last),
        "generated_at": pub.get("generated_at"),
        "handover": {"status": ho.get("status") or "未进入", "matched": ho.get("matched") or 0,
                     "total_map": ho.get("total_map") or 0, "unmatched": ho.get("unmatched") or 0,
                     "parentIssue": ho.get("parentIssue")},
        "total": total, "cnt": cnt, "ck": ck, "fc": fc, "fc_base": fc_base,
        "impl": impl, "pass_rate": pr, "progress": 0.5 * impl + 0.3 * (pr or 0.0) + 0.2 * (rr or 0.0),
        "regs_done": rd, "regs_total": len(regs),
        "busy": cnt["验证中"] + cnt["修复中"], "fail": cnt["失败"] + cnt["阻塞"],
        "risk_high": sum(1 for r in rs if r[0] == "high"), "risk_total": len(rs),
        "evidence_files": ev_n,
        "qa_total": len(qs), "qa_pm": sum(1 for q in qs if q.get("状态") == "待PM确认"),
        "qa_pending": len(pend), "qa_errors": len(qa.get("errors") or []),
        "pm_changes": [{"id": c.get("id"), "qid": c.get("qid"), "title": c.get("title") or "",
                        "at": c.get("at"), "by": c.get("by"),
                        "concl": str((c.get("after") or {}).get("当前结论") or "")[:90]}
                       for c in pend if str(c.get("by") or "").startswith("pm:")],
        "next_step": next_step(pub.get("steps") or {}, pub.get("step_spec") or [], pub.get("step_files")),
        "error": None,
    }


def error_summary(req: Path, rev: str, last, msg: str) -> dict:
    rid, name = _split_name(req.name)
    return {"folder": req.name, "id": rid or req.name, "name": name, "sprint": "", "workflow": "",
            "rev": rev, "last_change": _iso(last), "error": msg, "total": 0,
            "cnt": {s: 0 for s in STATUSES}, "ck": {}, "fc": {s: 0 for s in FC_ORDER}, "fc_base": 0,
            "handover": {"status": "未进入", "matched": 0, "total_map": 0, "unmatched": 0},
            "impl": 0, "pass_rate": None, "progress": 0, "regs_done": 0, "regs_total": 0,
            "busy": 0, "fail": 0, "risk_high": 0, "risk_total": 0, "evidence_files": 0,
            "qa_total": 0, "qa_pm": 0, "qa_pending": 0, "qa_errors": 0, "pm_changes": [], "next_step": None}


# ------------------------------------------------------------ 变化签名 + 快照缓存（服务模式）

SIG_SKIP = {OUT_NAME, "index.html"}
SIG_DEEP = {"tests", "ui", "figma"}


def req_signature(req: Path):
    """需求目录的变化签名：顶层文件 + tests/ UI/ figma/ 全部条目的 (名, mtime, size)。

    Windows 上 scandir 自带 stat 信息，6000 个证据文件也只要几十毫秒，远快于重建快照。
    返回 (rev, 最后一次数据变化的时间戳)。生成物（验证进度看板.html）不计入。
    """
    h = hashlib.sha1()
    last = 0.0

    def walk(d: str, rel: str, deep: bool):
        nonlocal last
        try:
            it = list(os.scandir(d))
        except OSError:
            return
        it.sort(key=lambda e: e.name)
        for e in it:
            if e.name in SIG_SKIP or (e.name.startswith(".") and e.name.endswith(".tmp")):
                continue
            try:
                st = e.stat()
                isdir = e.is_dir()
            except OSError:
                continue
            if isdir:
                h.update(f"{rel}{e.name}/|{st.st_mtime_ns}\n".encode("utf-8", "replace"))
                if deep or e.name.lower() in SIG_DEEP:
                    walk(e.path, f"{rel}{e.name}/", True)
            else:
                h.update(f"{rel}{e.name}|{st.st_mtime_ns}|{st.st_size}\n".encode("utf-8", "replace"))
                last = max(last, st.st_mtime)

    walk(str(req), "", False)
    return h.hexdigest()[:12], last


class Hub:
    """服务模式的数据中心：快照按 (需求目录, 签名) 缓存；签名没变就直接复用，不重扫证据。"""
    MAX_AGE = 600.0     # 兜底：签名覆盖不到的变化（极少）最迟 10 分钟反映
    ERR_AGE = 30.0      # 构建失败的条目 30 秒后重试
    SIG_TTL = 1.0       # 同一秒内的多次请求复用签名

    def __init__(self, develop: Path, workflow=None, ttl: float = 20.0):
        self.develop, self.workflow, self.ttl = develop, workflow, ttl
        self._g = threading.Lock()
        self._locks: dict = {}
        self._entries: dict = {}
        self._sigs: dict = {}
        self._arch = (None, [])

    def _lock(self, key: str):
        with self._g:
            return self._locks.setdefault(key, threading.Lock())

    def sig(self, req: Path):
        now = time.time()
        c = self._sigs.get(req.name)
        if c and now - c[0] < self.SIG_TTL:
            return c[1], c[2]
        rev, last = req_signature(req)
        self._sigs[req.name] = (now, rev, last)
        return rev, last

    def entry(self, req: Path) -> dict:
        rev, last = self.sig(req)
        with self._lock(req.name):
            e = self._entries.get(req.name)
            age = time.time() - e["built"] if e else 0
            if e and e["rev"] == rev and age < (self.ERR_AGE if e["error"] else self.MAX_AGE):
                return e
            try:
                snap = build_snapshot(req, self.workflow, self.ttl)
                pub, ev = publish_snapshot(snap)
                e = {"rev": rev, "last": last, "pub": pub, "ev": ev, "error": None, "built": time.time()}
                e["summary"] = summarize(pub, rev, last)
            except Exception as ex:  # 单个需求出错不影响整体，但必须显式报出来
                msg = f"{type(ex).__name__}: {ex}"
                print(f"[verify-dashboard] [error] 构建 {req.name} 失败：{msg}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                e = {"rev": rev, "last": last, "pub": None, "ev": {}, "error": msg, "built": time.time(),
                     "summary": error_summary(req, rev, last, msg)}
            self._entries[req.name] = e
            return e

    def archived(self) -> list:
        a = self.develop / ARCHIVE_DIR
        try:
            key = a.stat().st_mtime_ns if a.is_dir() else 0
        except OSError:
            key = 0
        if self._arch[0] != key:
            self._arch = (key, discover_archived(self.develop))
        return self._arch[1]

    def reqs(self) -> list:
        return discover_requirements(self.develop, EXCLUDE_DEFAULT)[0]

    def list_rev(self, reqs=None) -> str:
        reqs = self.reqs() if reqs is None else reqs
        parts = [r.name + "@" + self.sig(r)[0] for r in reqs]
        parts += ["A:" + a["folder"] + "@" + (a.get("archived_at") or "") for a in self.archived()]
        return hashlib.sha1("|".join(parts).encode("utf-8", "replace")).hexdigest()[:12]

    def list_payload(self) -> dict:
        reqs = self.reqs()
        ents = [self.entry(r) for r in reqs]
        return {"rev": self.list_rev(reqs), "ui": asset_ver(), "generated_at": now_iso(), "develop": str(self.develop),
                "reqs": [e["summary"] for e in ents], "archived": self.archived(),
                "errors": [{"folder": r.name, "msg": e["error"]} for r, e in zip(reqs, ents) if e["error"]]}

    def invalidate(self, folder: str) -> None:
        """写操作之后调用：丢掉签名缓存，下一次请求立刻看到新内容（否则 1 秒内会读到旧 rev）。"""
        self._sigs.pop(folder, None)


HUB = None  # 服务模式的 Hub；PM 局域网页作答后也要用它失效缓存


def _invalidate(folder: str) -> None:
    if HUB is not None:
        HUB.invalidate(folder)


# ------------------------------------------------------------ 前端资源（scripts/dashboard/）

DASH_DIR = Path(__file__).resolve().parent / "dashboard"
# skills 根目录（本脚本在 <skills>/<skill>/scripts/ 下）：首页「复制续跑命令」拼 validate_step.py 绝对路径用
SKILLS_DIR = str(Path(__file__).resolve().parents[2])
DASH_ASSETS = {"app.css": "text/css; charset=utf-8", "app.js": "application/javascript; charset=utf-8"}


def dash_text(name: str) -> str:
    """模板 / 前端资源每次现读：改 dashboard/* 不用重启服务。"""
    p = DASH_DIR / name
    if not p.is_file():
        raise FileNotFoundError(f"看板前端资源缺失：{p}（scripts/dashboard/ 要与 verify_dashboard.py 一起分发）")
    return p.read_text(encoding="utf-8")


def asset_ver() -> str:
    try:
        return str(max(int((DASH_DIR / n).stat().st_mtime) for n in DASH_ASSETS))
    except OSError:
        return "0"


def render_page(payload: dict, title: str, inline: bool = True) -> str:
    """inline=True：css/js/数据全部内联（静态产物，file:// 可开）；False：引用 /__dash/ 资源的轻量外壳。"""
    tpl = dash_text("index.html")
    if inline:
        css = "<style>\n" + dash_text("app.css") + "\n</style>"
        js = "<script>\n" + dash_text("app.js").replace("</script", "<\\/script") + "\n</script>"
    else:
        v = asset_ver()
        css = f'<link rel="stylesheet" href="/__dash/app.css?v={v}">'
        js = f'<script src="/__dash/app.js?v={v}"></script>'
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    # 逐段拼接：数据 / 脚本里即便恰好出现占位符字样也不会被二次替换
    out = []
    for chunk in re.split(r"(__TITLE__|<!--__CSS__-->|<!--__JS__-->|__DATA__)", tpl):
        out.append({"__TITLE__": html_mod.escape(title), "<!--__CSS__-->": css,
                    "<!--__JS__-->": js, "__DATA__": data}.get(chunk, chunk))
    return "".join(out)


def _title_one(snap: dict) -> str:
    return f"验证进度看板 · {snap.get('id', '')} {snap.get('name', '')}".strip()


TITLE_INDEX = "所有进行中需求 · 验证进度看板"


def static_one_payload(develop: Path, req: Path, workflow=None, ttl: float = 20.0) -> dict:
    snap = build_snapshot(req, workflow, ttl)
    pub, _ = publish_snapshot(snap, full=True)
    rev, last = req_signature(req)
    sm = summarize(pub, rev, last)
    return {"mode": "static", "is_index": False, "single": req.name, "base": "../",
            "skills_dir": SKILLS_DIR, "develop": str(develop), "generated_at": pub["generated_at"],
            "list": {"rev": rev, "reqs": [sm], "archived": [], "errors": []},
            "detail": {req.name: {"rev": rev, "snap": pub}}}


def static_index_payload(develop: Path, workflow=None, ttl: float = 20.0, focus: Path = None) -> dict:
    reqs, _ = discover_requirements(develop, EXCLUDE_DEFAULT)
    sums, detail, errors = [], {}, []
    for r in reqs:
        rev, last = req_signature(r)
        try:
            snap = build_snapshot(r, workflow if (focus is None or r == focus) else None, ttl)
            pub, _ = publish_snapshot(snap)
            sums.append(summarize(pub, rev, last))
            detail[r.name] = {"rev": rev, "snap": pub}
        except Exception as e:  # 单个需求出错不影响整体，但要在页面顶部红条里显示
            msg = f"{type(e).__name__}: {e}"
            print(f"[verify-dashboard] [error] 构建 {r.name} 失败：{msg}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            sums.append(error_summary(r, rev, last, msg))
            errors.append({"folder": r.name, "msg": msg})
    return {"mode": "static", "is_index": True, "base": "", "skills_dir": SKILLS_DIR, "develop": str(develop),
            "generated_at": now_iso(),
            "list": {"rev": "", "reqs": sums, "archived": discover_archived(develop), "errors": errors},
            "detail": detail}


# 兼容旧调用
def build_index_payload(develop: Path, workflow=None, ttl: float = 20.0, focus: Path = None) -> dict:
    return static_index_payload(develop, workflow, ttl, focus)


def build_one(req: Path, workflow, ttl) -> dict:
    return build_snapshot(req, workflow, ttl)


# ------------------------------------------------------------ 输出

def _atomic_write(path: Path, text: str):
    """同目录唯一临时文件（mkstemp）+ os.replace：并发生成不会互相覆盖同一个 .tmp。"""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".", suffix=".tmp")  # 短名：深目录下别撞 MAX_PATH
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        for i in range(6):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if i == 5:
                    raise
                time.sleep(0.05 * (i + 1))
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


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
                    "has_page": (p / OUT_NAME).exists()})
    out.sort(key=lambda x: x["archived_at"] or "", reverse=True)
    return out


def write_req_page(develop: Path, req: Path, out_name: str = OUT_NAME, workflow=None, ttl: float = 20.0) -> Path:
    payload = static_one_payload(develop, req, workflow, ttl)
    snap = payload["detail"][req.name]["snap"]
    _atomic_write(req / out_name, render_page(payload, _title_one(snap), inline=True))
    return req / out_name


def write_index_page(develop: Path, workflow=None, ttl: float = 20.0, focus: Path = None):
    payload = static_index_payload(develop, workflow, ttl, focus)
    if not payload["list"]["reqs"] and not payload["list"]["archived"]:
        # 🔴 扫不到需求时**不要**覆盖总览 —— 否则一次异常扫描就把整个看板清成「没有发现需求目录」
        print("[verify-dashboard] [warn] 未发现任何需求目录，index.html 保持原样（不覆盖）", file=sys.stderr)
        return None
    _atomic_write(develop / "index.html", render_page(payload, TITLE_INDEX, inline=True))
    return develop / "index.html"


def _req_guard(req: Path):
    return qa_record.req_lock(req) if qa_record is not None else contextlib.nullcontext()


def archive_req(develop: Path, folder: str) -> dict:
    """归档：先刷新该需求自己的看板页（留存最终快照）→ 目录移到 archived/ → 标记「已完成」。

    移动失败（文件被占用等）时不留半截状态：标记写在移动成功之后。
    """
    src = develop / folder
    dst = develop / ARCHIVE_DIR / folder
    with _req_guard(src):
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
    with _req_guard(dst):
        if dst.exists():
            raise ValueError(f"develop/ 下已有同名目录：{folder}")
        shutil.move(str(src), str(dst))
        st = _read_state(dst)
        ar = st.pop("archived", None)
        st.setdefault("archive_history", []).append({"archived": ar, "restored_at": now_iso()})
        _write_state(dst, st)


def write_outputs(develop: Path, req: Path, snapshot: dict, out_name: str,
                  also_index: bool, workflow=None, ttl: float = 20.0) -> list:
    """单需求静态页 + （可选）外层总览。snapshot 参数仅为兼容旧调用，内部会按 full 证据重建。"""
    written = [write_req_page(develop, req, out_name, workflow, ttl)]
    if also_index:
        idx = write_index_page(develop, workflow, ttl, focus=req)
        if idx:
            written.append(idx)
    return written


# ------------------------------------------------------------ HTTP 服务

POST_LIMIT = 1_000_000
PM_POST_LIMIT = 100_000
# 静态文件白名单：需求目录下这些子目录整体放行；其余位置只放行证据类后缀
OPEN_SUBDIRS = {"ui", "tests", "figma"}
EVIDENCE_SUFFIX = (MEDIA_EXT | VIDEO_EXT | {".svg", ".md", ".markdown", ".rst", ".txt", ".text", ".log",
                                            ".har", ".json", ".csv", ".sql", ".xls", ".xlsx", ".pdf"})
# 点文件默认拒绝（.pm-share.json 里有分享令牌）；这几个是旧版静态页轮询用的状态文件，放行
DOT_ALLOW = {".verify-state.json", ".handover-state.json", ".workflow-state.json"}


def content_length(headers, limit: int):
    """合法返回 0..limit 的整数；缺省视为 0；非法 / 负数 / 超限 / chunked 返回 None（调用方回 400）。"""
    if (headers.get("Transfer-Encoding") or "").strip():
        return None
    raw = headers.get("Content-Length")
    if raw is None or not raw.strip():
        return 0
    try:
        n = int(raw.strip())
    except ValueError:
        return None
    return n if 0 <= n <= limit else None


def static_allowed(develop: Path, parts: list) -> bool:
    """parts 已 unquote。只放行 <需求目录>/ 或 archived/<需求目录>/ 下的证据类文件。"""
    if not parts:
        return False
    for p in parts:
        if p in ("", ".", "..") or any(c in p for c in "/\\:\x00") or (p.startswith(".") and p not in DOT_ALLOW):
            return False
    if parts[0].lower() == ARCHIVE_DIR:
        if len(parts) < 3:
            return False
        base, rest = develop / ARCHIVE_DIR / parts[1], parts[2:]
        if not base.is_dir():
            return False
    else:
        if parts[0].lower() in {e.lower() for e in EXCLUDE_DEFAULT}:
            return False
        base, rest = develop / parts[0], parts[1:]
        if not looks_like_req(base):
            return False
    if not rest:
        return False
    if rest[0].lower() in OPEN_SUBDIRS and len(rest) >= 2:
        return True
    if len(rest) == 1 and rest[0] == OUT_NAME:
        return True
    return Path(rest[-1]).suffix.lower() in EVIDENCE_SUFFIX


class DashHandler(SimpleHTTPRequestHandler):
    """看板服务（只监听 127.0.0.1，校验 Host）：
    GET  /                                   轻量外壳页（总览摘要内联；资源走 /__dash/）
    GET  /<需求目录>/验证进度看板.html          单需求外壳页（服务模式动态生成，不落盘）
    GET  /__dash/app.css|app.js              前端资源（每次现读 scripts/dashboard/）
    GET  /api/list?rev=                      全部需求摘要（rev 未变返回 {unchanged:true}）
    GET  /api/req/<需求目录>?rev=             单需求快照（rev 未变返回 {unchanged:true}）
    GET  /api/req/<需求目录>/evidence?ac=AC-NN[&dir=子目录]   完整证据清单
    GET  /api/snapshot?folder= · /api/reqs · /api/ping        兼容旧前端
    POST /api/qa/save                        {folder, qid, fields, rev}：rev 不一致 409
    POST /api/req/archive|unarchive · /api/pm/share|revoke
    """
    develop: Path = Path(".")
    hub: "Hub" = None
    allowed_hosts: set = set()
    out_name: str = OUT_NAME
    _cc = None

    def log_request(self, code="-", size="-"):  # 轮询 / 缩略图很频繁：只记 5xx（常驻服务的日志在 tools/dashboard.log）
        try:
            if int(code) >= 500:
                super().log_request(code, size)
        except (TypeError, ValueError):
            pass

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        if self._cc:
            self.send_header("Cache-Control", self._cc)
        super().end_headers()

    # ---- 发送
    def _send(self, code: int, body: bytes, ctype: str, cache: str = "no-store") -> None:
        if len(body) > 1024 and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            body = gzip.compress(body, 5)
            enc = True
        else:
            enc = False
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", cache)
        if enc:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _html(self, html: str, code: int = 200) -> None:
        self._send(code, html.encode("utf-8"), "text/html; charset=utf-8")

    def _deny(self, code: int, msg: str) -> None:
        self._send(code, msg.encode("utf-8"), "text/plain; charset=utf-8")

    # ---- 校验
    def _host_ok(self) -> bool:
        return (self.headers.get("Host") or "").strip().lower() in self.allowed_hosts

    def _req_dir(self, folder: str):
        if not folder or folder.startswith(".") or any(c in folder for c in "/\\:\x00"):
            return None
        if folder.lower() in {e.lower() for e in EXCLUDE_DEFAULT}:
            return None
        p = (self.develop / folder).resolve()
        return p if p.parent == self.develop.resolve() and p.is_dir() else None

    # ---- 页面
    def _shell_index(self) -> str:
        lp = self.hub.list_payload()
        payload = {"mode": "serve", "is_index": True, "base": "/", "skills_dir": SKILLS_DIR, "develop": str(self.develop),
                   "generated_at": lp["generated_at"], "list": lp}
        return render_page(payload, TITLE_INDEX, inline=False)

    def _shell_single(self, d: Path) -> str:
        e = self.hub.entry(d)
        payload = {"mode": "serve", "is_index": False, "single": d.name, "base": "/",
                   "skills_dir": SKILLS_DIR, "develop": str(self.develop), "generated_at": now_iso(),
                   "list": {"rev": "", "reqs": [e["summary"]], "archived": [],
                            "errors": [{"folder": d.name, "msg": e["error"]}] if e["error"] else []},
                   "detail": {d.name: {"rev": e["rev"], "snap": e["pub"]}} if e["pub"] else {}}
        return render_page(payload, _title_one(e["pub"] or {"id": d.name, "name": ""}), inline=False)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self._cc = None
        if not self._host_ok():
            return self._deny(403, "forbidden host")
        u = urlparse(self.path)
        q = parse_qs(u.query)
        parts = [unquote(x) for x in u.path.split("/") if x]
        try:
            if u.path == "/api/ping":
                return self._json(200, {"ok": True})
            if u.path in ("/", "/index.html"):
                return self._html(self._shell_index())
            if len(parts) == 2 and parts[0] == "__dash":
                if parts[1] not in DASH_ASSETS:
                    return self._deny(404, "not found")
                return self._send(200, dash_text(parts[1]).encode("utf-8"), DASH_ASSETS[parts[1]], "no-cache")
            if u.path == "/api/list":
                lp = self.hub.list_payload()
                if q.get("rev", [""])[0] == lp["rev"]:
                    return self._json(200, {"ok": True, "unchanged": True, "rev": lp["rev"], "ui": asset_ver()})
                return self._json(200, dict(lp, ok=True))
            if u.path == "/api/reqs":
                return self._json(200, {"active": [r.name for r in self.hub.reqs()],
                                        "archived": [a["folder"] for a in self.hub.archived()]})
            if u.path == "/api/snapshot":
                d = self._req_dir(q.get("folder", [""])[0])
                if d is None:
                    return self._json(404, {"ok": False, "error": "unknown folder"})
                e = self.hub.entry(d)
                return self._json(500 if e["error"] else 200, e["pub"] or {"ok": False, "error": e["error"]})
            if len(parts) in (3, 4) and parts[:2] == ["api", "req"]:
                d = self._req_dir(parts[2])
                if d is None:
                    return self._json(404, {"ok": False, "error": "unknown folder"})
                e = self.hub.entry(d)
                if len(parts) == 4:
                    if parts[3] != "evidence":
                        return self._json(404, {"ok": False, "error": "not found"})
                    coll, groups = e["ev"].get(norm_ac(q.get("ac", [""])[0]), ([], {}))
                    sub = q.get("dir", [None])[0]
                    if sub is not None:
                        if sub not in groups:
                            return self._json(404, {"ok": False, "error": "unknown dir"})
                        return self._json(200, {"ok": True, "rev": e["rev"], "items": groups[sub]})
                    return self._json(200, {"ok": True, "rev": e["rev"], "items": coll})
                lr = self.hub.list_rev()
                if e["error"]:
                    return self._json(500, {"ok": False, "error": e["error"], "rev": e["rev"], "list_rev": lr})
                if q.get("rev", [""])[0] == e["rev"]:
                    return self._json(200, {"ok": True, "unchanged": True, "rev": e["rev"], "list_rev": lr, "ui": asset_ver()})
                return self._json(200, {"ok": True, "rev": e["rev"], "list_rev": lr,
                                        "summary": e["summary"], "snap": e["pub"]})
            if parts and parts[0] == "api":
                return self._json(404, {"ok": False, "error": "not found"})
            if len(parts) == 2 and parts[1] == self.out_name:
                d = self._req_dir(parts[0])
                if d is not None:
                    return self._html(self._shell_single(d))
        except FileNotFoundError as e:
            return self._deny(500, str(e))
        # ---- 静态文件：白名单 + 不列目录 + 路径不能逃出 develop
        if not static_allowed(self.develop, parts):
            return self._deny(403, "forbidden")
        target = self.develop.joinpath(*parts).resolve()
        root = self.develop.resolve()
        if root not in target.parents:
            return self._deny(403, "forbidden")
        if target.is_dir():
            return self._deny(403, "directory listing disabled")
        if not target.is_file():
            return self._deny(404, "not found")
        self._cc = "no-cache"
        return super().do_GET() if self.command == "GET" else super().do_HEAD()

    def list_directory(self, path):  # 双保险：任何情况下都不列目录
        self.send_error(403, "directory listing disabled")
        return None

    def do_POST(self):
        self._cc = None
        if not self._host_ok():
            return self._deny(403, "forbidden host")
        u = urlparse(self.path)
        # 防跨站：浏览器带 Origin 时必须与本服务同源
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc.lower() != (self.headers.get("Host") or "").lower():
            return self._json(403, {"ok": False, "error": "cross-origin rejected"})
        n = content_length(self.headers, POST_LIMIT)
        if n is None:
            return self._json(400, {"ok": False, "error": f"bad Content-Length（0..{POST_LIMIT}）"})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}
            if not isinstance(body, dict):
                raise ValueError("body 必须是 JSON 对象")
        except Exception as e:
            return self._json(400, {"ok": False, "error": f"bad body: {e}"})
        if u.path in ("/api/req/archive", "/api/req/unarchive"):
            folder = str(body.get("folder", ""))
            if not folder or folder.startswith(".") or any(c in folder for c in "/\\:\x00"):
                return self._json(400, {"ok": False, "error": "bad folder"})
            try:
                if u.path.endswith("/archive"):
                    if self._req_dir(folder) is None:
                        return self._json(404, {"ok": False, "error": "unknown folder"})
                    info = archive_req(self.develop, folder)
                else:
                    if not (self.develop / ARCHIVE_DIR / folder).is_dir():
                        return self._json(404, {"ok": False, "error": "unknown archived folder"})
                    unarchive_req(self.develop, folder)
                    info = {}
                self.hub.invalidate(folder)
                return self._json(200, {"ok": True, "info": info})
            except (ValueError, OSError) as e:
                return self._json(409, {"ok": False, "error": f"{type(e).__name__}: {e}（目录可能被编辑器 / 终端占用）"})
        if u.path in ("/api/pm/share", "/api/pm/revoke"):
            d = self._req_dir(str(body.get("folder", "")))
            if d is None or qa_record is None:
                return self._json(404, {"ok": False, "error": "unknown folder"})
            if not PM_BASE:
                return self._json(503, {"ok": False, "error": "产品确认服务未启动（局域网端口不可用）"})
            try:
                if u.path.endswith("/share"):
                    s = qa_record.create_share(d)
                    _invalidate(d.name)
                    return self._json(200, {"ok": True, "url": PM_BASE + "/pm/" + s["token"], "qa": load_qa(d)})
                qa_record.revoke_share(d, str(body.get("token", "")))
                _invalidate(d.name)
                return self._json(200, {"ok": True, "qa": load_qa(d)})
            except ValueError as e:
                return self._json(400, {"ok": False, "error": str(e)})
        if u.path != "/api/qa/save":
            return self._json(404, {"ok": False, "error": "not found"})
        if qa_record is None:
            return self._json(501, {"ok": False, "error": "qa_record.py missing"})
        try:
            d = self._req_dir(str(body.get("folder", "")))
            if d is None:
                return self._json(404, {"ok": False, "error": "unknown folder"})
            fields = body.get("fields") or {}
            if not isinstance(fields, dict):
                raise ValueError("fields 必须是对象")
            res = qa_record.update_question(d, str(body.get("qid", "")), fields, by="dashboard",
                                            record_change=True, expect_rev=(body.get("rev") or None))
            _invalidate(d.name)
            return self._json(200, {"ok": True, "changed": res["changed"],
                                    "change": res.get("change"), "qa": load_qa(d)})
        except qa_record.RevConflict as e:
            return self._json(409, {"ok": False, "conflict": True, "error": f"已被他人修改，请刷新（{e}）",
                                    "qa": load_qa(d)})
        except (KeyError, ValueError) as e:
            return self._json(400, {"ok": False, "error": str(e)})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
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

    def _send(self, code, body, ctype, cache="no-store"):
        DashHandler._send(self, code, body, ctype, cache)

    def _json(self, code, obj):
        DashHandler._json(self, code, obj)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_HEAD(self):
        self.send_error(405)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_GET(self):
        parts = [x for x in urlparse(self.path).path.split("/") if x]
        if len(parts) == 2 and parts[0] == "pm":
            req, s = _find_share_req(self.develop, parts[1])
            if not req:
                body = "<!DOCTYPE html><meta charset=utf-8><body style='font-family:sans-serif;padding:40px'>链接已失效或不存在，请联系需求负责人重新生成。</body>"
                return self._send(404, body.encode("utf-8"), "text/html; charset=utf-8")
            try:
                return self._send(200, dash_text("pm.html").encode("utf-8"), "text/html; charset=utf-8")
            except FileNotFoundError as e:
                return self._send(500, str(e).encode("utf-8"), "text/plain; charset=utf-8")
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
        if origin and urlparse(origin).netloc.lower() != (self.headers.get("Host") or "").lower():
            return self._json(403, {"ok": False, "error": "cross-origin rejected"})
        n = content_length(self.headers, PM_POST_LIMIT)
        if n is None:
            return self._json(400, {"ok": False, "error": f"bad Content-Length（0..{PM_POST_LIMIT}）"})
        req, s = _find_share_req(self.develop, parts[2])
        if not req:
            return self._json(404, {"ok": False, "error": "链接已失效或不存在"})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}
            if not isinstance(body, dict):
                raise ValueError("body 必须是 JSON 对象")
            qa_record.pm_answer(req, parts[2], str(body.get("qid", "")), str(body.get("choice", "")),
                                str(body.get("text", "")), str(body.get("name", "")))
            _invalidate(req.name)
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


def serve(develop: Path, port: int, page_rel: str = "", pm_port: int = 8786,
          workflow=None, ttl: float = 20.0, out_name: str = OUT_NAME):
    DashHandler.develop = develop
    global HUB
    HUB = DashHandler.hub = Hub(develop, workflow, ttl)
    DashHandler.allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    DashHandler.out_name = out_name
    if pm_port:
        start_pm_server(develop, pm_port)
    handler = functools.partial(DashHandler, directory=str(develop))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    # 预热快照缓存：第一次打开页面不用等全部需求现扫
    threading.Thread(target=lambda: DashHandler.hub.list_payload(), daemon=True).start()
    url = f"http://127.0.0.1:{port}/" + "/".join(quote(x) for x in page_rel.split("/") if x)
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
    ap.add_argument("--out", default=OUT_NAME, help="单需求页面文件名")
    ap.add_argument("--ttl", type=float, default=20.0, help="「验证中/修复中」判僵尸的分钟数")
    ap.add_argument("--no-index", action="store_true", help="不刷新外层 index.html")
    ap.add_argument("--serve", action="store_true", help="起本地服务（实时；服务模式不写静态产物）")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--pm-port", type=int, default=8786, help="产品确认页的局域网端口（0 = 不开）")
    ap.add_argument("--open", action="store_true", help="生成后用浏览器打开")
    args = ap.parse_args()

    files, snap_metrics = [], None
    if args.dir:
        req = Path(args.dir).resolve()
        if not req.is_dir():
            print(f"[verify-dashboard] 目录不存在：{req}", file=sys.stderr)
            return 2
        develop = req.parent
        if not args.serve:
            payload = static_one_payload(develop, req, args.workflow, args.ttl)
            snap = payload["detail"][req.name]["snap"]
            _atomic_write(req / args.out, render_page(payload, _title_one(snap), inline=True))
            files = [req / args.out]
            snap_metrics = snap["metrics"]
            if not args.no_index:
                idx = write_index_page(develop, args.workflow, args.ttl, focus=req)
                if idx:
                    files.append(idx)
    elif args.all or args.develop:
        develop = Path(args.develop or ".").resolve()
        if not develop.is_dir():
            print(f"[verify-dashboard] 目录不存在：{develop}", file=sys.stderr)
            return 2
        reqs, skipped = discover_requirements(develop, EXCLUDE_DEFAULT)
        if not args.serve:
            for r in reqs:
                try:
                    files.append(write_req_page(develop, r, args.out, args.workflow, args.ttl))
                except Exception as e:
                    print(f"[verify-dashboard] [error] 生成 {r.name} 失败：{type(e).__name__}: {e}", file=sys.stderr)
                    traceback.print_exc(file=sys.stderr)
            idx = write_index_page(develop, args.workflow, args.ttl)
            if idx:
                files.append(idx)
        if skipped:
            print(f"[verify-dashboard] 跳过非需求目录：{[p.name for p in skipped]}")
    else:
        print("[verify-dashboard] 需要 --dir 或 --all/--develop", file=sys.stderr)
        return 2

    if files:
        print(f"[verify-dashboard] 已生成 {len(files)} 个文件：")
        for f in files:
            print(f"  - {f}")
    if snap_metrics:
        print(f"[verify-dashboard] AC {snap_metrics['total']} 条 · 整体进度 {snap_metrics['progress']*100:.0f}%")

    if args.open and not args.serve:
        target = (Path(args.dir).resolve() / args.out) if args.dir else (develop / "index.html")
        webbrowser.open(target.as_uri())
    if args.serve:
        page = f"{Path(args.dir).resolve().name}/{args.out}" if args.dir else ""
        if args.open:
            webbrowser.open(f"http://127.0.0.1:{args.port}/" + "/".join(quote(x) for x in page.split("/") if x))
        serve(develop, args.port, page, args.pm_port, args.workflow, args.ttl, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
