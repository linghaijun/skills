#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""AC ↔ Subtask 匹配（Step14 / 后端 Step13）。只用标准库。

Agent 用 Atlassian MCP 拉好父票下 Sub-task 后，把结果落成 JSON 喂给本脚本；
本脚本读 Checklist、按约定规则匹配、写出映射表，并可一键写入 `.handover-state.json`
（状态 → `已匹配待确认`）。**不调 Jira、不写 transition** —— 那是用户确认提测之后的事。

用法:
    # 1) Agent 把 Jira 结果写成 subtasks.json（见下方格式）
    # 2) 匹配 + 落盘 + 写入 handover-state
    python handover_match.py --dir docs/develop/xxx --parent CP-57189 \\
        --subtasks subtasks.json --apply

    # 只出映射、不改 .handover-state.json
    python handover_match.py --dir docs/develop/xxx --parent CP-57189 \\
        --subtasks subtasks.json

    # 从 stdin 读 subtasks JSON
    python handover_match.py --dir docs/develop/xxx --parent CP-57189 \\
        --subtasks - --apply < subtasks.json

subtasks.json 格式（任选其一）:
    {"parentIssue":"CP-57189","issues":[{"key":"CP-1","summary":"AC-01 ...","status":"Open","assignee":"X"}]}
    [{"key":"CP-1","summary":"AC-01 ...","fields":{"summary":"...","status":{"name":"Open"},"assignee":{"displayName":"X"}}}]
    # 也接受 Atlassian MCP searchJiraIssuesUsingJql 的 issues 数组原样粘贴

产出:
    Step {N}-AC-Subtask映射.md
    Step {N}-mapping.json          # 供 handover_state.py set-mapping
    （--apply 时）.handover-state.json status=已匹配待确认
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

AC_HEAD_RE = re.compile(
    r"^\*\s*\[(done|open|blocked|waived)\]\s*(AC-(\d{1,3}))\s+(.+)$", re.I
)
AC_TOKEN_RE = re.compile(r"\bAC-(\d{1,3})\b", re.I)
# Checklist 文首「AC-NN ↔ Jira」表行：| AC-01 | CP-xxxxx | ...
MAP_ROW_RE = re.compile(
    r"^\|\s*(AC-(\d{1,3}))\s*\|\s*([A-Z][A-Z0-9]+-\d+)\s*\|", re.I
)
STEP_N = {"fullstack": 14, "backend": 13}


def die(msg: str, code: int = 1) -> int:
    print("ERROR: " + msg, file=sys.stderr)
    return code


def norm_ac(n: int | str) -> str:
    if isinstance(n, str):
        m = re.search(r"(\d{1,3})", n)
        if not m:
            return str(n).upper()
        n = int(m.group(1))
    return "AC-%02d" % int(n)


def detect_workflow(d: Path, forced: str | None) -> str:
    if forced in STEP_N:
        return forced
    names = {p.name for p in d.glob("Step *-*.md")}
    fs = (
        "Step 8-回归验证清单.md" in names
        or "Step 9-tasks.md" in names
        or "Step 7-前端页面与组件设计文档.md" in names
    )
    be = (
        "Step 7-回归验证清单.md" in names
        or "Step 8-tasks.md" in names
    ) and not fs
    return "backend" if be else "fullstack"


def parse_checklist(path: Path) -> tuple[list[dict], dict[str, str]]:
    """返回 (acs, front_map)。front_map: AC-NN → Issue Key（文首表）。"""
    text = path.read_text(encoding="utf-8", errors="replace")
    front: dict[str, str] = {}
    for ln in text.splitlines()[:160]:
        m = MAP_ROW_RE.match(ln.strip())
        if m:
            front[norm_ac(m.group(2))] = m.group(3).upper()
    acs: list[dict] = []
    seen: set[str] = set()
    for ln in text.splitlines():
        m = AC_HEAD_RE.match(ln)
        if not m:
            continue
        ac = norm_ac(m.group(3))
        if ac in seen:
            continue
        seen.add(ac)
        title = m.group(4).strip()
        acs.append({"ac": ac, "status": m.group(1).lower(), "title": title})
    return acs, front


def _field(obj: dict, *keys, default=""):
    for k in keys:
        if k in obj and obj[k] is not None:
            return obj[k]
    return default


def normalize_issues(raw) -> list[dict]:
    """把各种 Jira / MCP 形状归一成 {key, summary, status, assignee, description}。"""
    if isinstance(raw, dict):
        if "issues" in raw:
            items = raw["issues"]
        elif "mapping" in raw:
            # 已是 mapping 输出，转回 issues 形
            items = [
                {
                    "key": r.get("subtaskKey") or r.get("key"),
                    "summary": r.get("subtaskSummary") or r.get("summary"),
                    "status": "",
                    "assignee": "",
                }
                for r in raw["mapping"]
                if r.get("subtaskKey") or r.get("key")
            ]
        else:
            items = [raw]
    elif isinstance(raw, list):
        items = raw
    else:
        raise ValueError("subtasks JSON 须为数组或含 issues 的对象")

    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        fields = it.get("fields") if isinstance(it.get("fields"), dict) else {}
        key = (_field(it, "key") or _field(fields, "key") or "").strip()
        summary = (
            _field(it, "summary")
            or _field(fields, "summary")
            or _field(it, "subtaskSummary")
            or ""
        ).strip()
        st = _field(it, "status") or _field(fields, "status") or ""
        if isinstance(st, dict):
            st = st.get("name") or st.get("status") or ""
        asg = _field(it, "assignee") or _field(fields, "assignee") or ""
        if isinstance(asg, dict):
            asg = asg.get("displayName") or asg.get("emailAddress") or asg.get("accountId") or ""
        desc = _field(it, "description") or _field(fields, "description") or ""
        if isinstance(desc, dict):
            desc = json.dumps(desc, ensure_ascii=False)
        if not key and not summary:
            continue
        out.append(
            {
                "key": key,
                "summary": summary,
                "status": str(st),
                "assignee": str(asg),
                "description": str(desc)[:2000],
            }
        )
    return out


def ac_from_summary(summary: str) -> str | None:
    m = re.match(r"^\s*AC-(\d{1,3})\b", summary or "", re.I)
    return norm_ac(m.group(1)) if m else None


def acs_in_text(text: str) -> list[str]:
    return [norm_ac(n) for n in AC_TOKEN_RE.findall(text or "")]


def _title_sim(a: str, b: str) -> float:
    """极简相似度：词集合 Jaccard（够用；不做模糊 NLP）。"""
    def toks(s: str) -> set[str]:
        s = re.sub(r"^AC-\d{1,3}\s+", "", s or "", flags=re.I)
        parts = re.split(r"[\s\-_/|，,：:]+", s.lower())
        return {p for p in parts if len(p) >= 2}

    ta, tb = toks(a), toks(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def match_all(
    acs: list[dict],
    issues: list[dict],
    front_map: dict[str, str],
) -> tuple[list[dict], list[str]]:
    """返回 (mapping rows, warnings)。"""
    by_key = {i["key"].upper(): i for i in issues if i.get("key")}
    # summary 以 AC-NN 开头 → 一对一候选
    prefix_owner: dict[str, str] = {}  # ac -> key
    claimed: set[str] = set()
    warnings: list[str] = []

    for iss in issues:
        ac = ac_from_summary(iss["summary"])
        if not ac:
            continue
        if ac in prefix_owner:
            warnings.append(
                f"{ac} 被多条 summary 前缀命中：{prefix_owner[ac]} 与 {iss['key']}（保留先到）"
            )
            continue
        prefix_owner[ac] = iss["key"]

    mapping = []
    for row in acs:
        ac = row["ac"]
        note_parts = []
        key = ""
        match = "unmatched"
        summary = ""
        iss = None

        # 1) Checklist 文首映射
        if ac in front_map and front_map[ac].upper() in by_key:
            key = front_map[ac].upper()
            iss = by_key[key]
            match = "frontmap"
            note_parts.append("from Checklist 文首映射表")
        # 2) summary 以 AC-NN 开头
        elif ac in prefix_owner:
            key = prefix_owner[ac]
            iss = by_key.get(key.upper()) or next(
                (i for i in issues if i["key"] == key), None
            )
            match = "exact"
        # 3) summary / description 含 AC-NN
        else:
            hits = [
                i
                for i in issues
                if ac in acs_in_text(i["summary"])
                or ac in acs_in_text(i.get("description") or "")
            ]
            if len(hits) == 1:
                iss = hits[0]
                key = iss["key"]
                match = "contains"
            elif len(hits) > 1:
                warnings.append(
                    f"{ac} contains 命中多条 {[h['key'] for h in hits]}，改试 fuzzy / 留 unmatched"
                )

        # 4) fuzzy（仅当仍无 key）
        if not key:
            best, best_s = None, 0.0
            for i in issues:
                if i["key"] in claimed:
                    continue
                s = _title_sim(row["title"], i["summary"])
                if s > best_s:
                    best, best_s = i, s
            if best and best_s >= 0.55:
                iss = best
                key = best["key"]
                match = "fuzzy"
                note_parts.append(f"titleSim={best_s:.2f}")

        if key and key in claimed and match != "unmatched":
            warnings.append(f"{ac} 候选 {key} 已被其他 AC 占用 → unmatched")
            key, iss, match = "", None, "unmatched"
            note_parts.append("冲突：subtask 已被占用")

        if iss and key:
            claimed.add(key)
            summary = iss["summary"]
            note_parts.append(f"jiraStatus={iss.get('status') or '—'}")
            if iss.get("assignee"):
                note_parts.append(f"assignee={iss['assignee']}")
            # 标题微差提示
            jira_rest = re.sub(r"^AC-\d{1,3}\s+", "", summary, flags=re.I).strip()
            if jira_rest and jira_rest != row["title"] and match in ("exact", "frontmap"):
                note_parts.append("titleDiff")

        mapping.append(
            {
                "ac": ac,
                "subtaskKey": key,
                "subtaskSummary": summary,
                "match": match if key else "unmatched",
                "note": "; ".join(note_parts)
                if note_parts
                else ("Jira 无对应 subtask" if not key else ""),
            }
        )

    orphan = [
        i["key"]
        for i in issues
        if i.get("key") and i["key"] not in claimed
    ]
    if orphan:
        warnings.append("未挂到任何 AC 的 Sub-task: " + ", ".join(orphan[:20])
                        + (" …" if len(orphan) > 20 else ""))
    return mapping, warnings


def write_outputs(
    d: Path,
    parent: str,
    step: int,
    acs: list[dict],
    issues: list[dict],
    mapping: list[dict],
    warnings: list[str],
) -> tuple[Path, Path]:
    matched = sum(1 for m in mapping if m["subtaskKey"])
    unmatched = [m["ac"] for m in mapping if not m["subtaskKey"]]
    title_diff = [m["ac"] for m in mapping if "titleDiff" in (m.get("note") or "")]

    payload = {"parentIssue": parent, "mapping": mapping}
    json_path = d / f"Step {step}-mapping.json"
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    md_rows = []
    for m in mapping:
        md_rows.append(
            f"| {m['ac']} | {m['subtaskKey']} | {m['subtaskSummary']} | {m['match']} | {m['note']} |"
        )
    md = [
        f"# Step {step} - AC ↔ Subtask 映射",
        "",
        f"父票：{parent}",
        f"匹配时间：{datetime.date.today().isoformat()}",
        f"来源：Checklist {len(acs)} 条 + Jira Sub-task {len(issues)} 条",
        f"生成：`scripts/handover_match.py`",
        "",
        "| AC-NN | Subtask Key | Summary | match | note |",
        "|---|---|---|---|---|",
        *md_rows,
        "",
        "## 覆盖率",
        "",
        f"- Checklist AC：{len(acs)}",
        f"- Jira Sub-task：{len(issues)}",
        f"- 已匹配：{matched}",
        f"- 未匹配：{len(unmatched)}"
        + (("（" + ", ".join(unmatched) + "）") if unmatched else ""),
        f"- 标题与 Checklist 不完全一致：{len(title_diff)}"
        + (("（" + ", ".join(title_diff) + "）") if title_diff else ""),
    ]
    if warnings:
        md += ["", "## 警告", ""] + [f"- {w}" for w in warnings]
    md += [
        "",
        "## 提测执行",
        "",
        "（待用户确认是否提测）",
        "",
        "提测状态：`已匹配待确认`（与验证态分离，见 `.handover-state.json`）",
        "",
    ]
    md_path = d / f"Step {step}-AC-Subtask映射.md"
    md_path.write_text("\n".join(md), encoding="utf-8")
    return md_path, json_path


def apply_handover(d: Path, parent: str, json_path: Path) -> int:
    """调用同目录 handover_state.py init + set-mapping。"""
    import subprocess

    script = Path(__file__).resolve().parent / "handover_state.py"
    if not script.exists():
        return die("未找到 handover_state.py（应与本脚本同目录）")
    py = sys.executable
    r1 = subprocess.run(
        [py, str(script), "--dir", str(d), "init", "--parent", parent],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if r1.returncode != 0:
        print(r1.stdout)
        print(r1.stderr, file=sys.stderr)
        return die("handover_state init 失败")
    print(r1.stdout.strip())
    r2 = subprocess.run(
        [py, str(script), "--dir", str(d), "set-mapping", "--json", str(json_path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(r2.stdout.strip())
    if r2.returncode != 0:
        print(r2.stderr, file=sys.stderr)
        return die("handover_state set-mapping 失败")
    return 0


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="AC ↔ Subtask 匹配（提测前）")
    ap.add_argument("--dir", required=True, help="docs/develop/{...} 需求目录")
    ap.add_argument("--parent", required=True, help="父票 key，如 CP-57189")
    ap.add_argument(
        "--subtasks",
        required=True,
        help="Sub-task JSON 文件路径，或 - 表示 stdin",
    )
    ap.add_argument(
        "--workflow",
        choices=["fullstack", "backend"],
        help="决定产出 Step 14 / Step 13 文件名（默认自动探测）",
    )
    ap.add_argument(
        "--step",
        type=int,
        help="覆盖步号（默认 fullstack=14 / backend=13）",
    )
    ap.add_argument(
        "--apply",
        action="store_true",
        help="匹配后执行 handover_state init + set-mapping（→ 已匹配待确认）",
    )
    ap.add_argument(
        "--allow-empty",
        action="store_true",
        help="JQL 已确认父票下没有 Sub-task 时用：映射全员 unmatched，仍进入「已匹配待确认」等用户裁决",
    )
    ap.add_argument(
        "--checklist",
        help="Checklist 路径（默认 <dir>/Step 3-Checklist.md）",
    )
    args = ap.parse_args()

    d = Path(args.dir).resolve()
    if not d.is_dir():
        return die(f"目录不存在: {d}")
    ck = Path(args.checklist) if args.checklist else d / "Step 3-Checklist.md"
    if not ck.exists():
        return die(f"未找到 Checklist: {ck}")

    if args.subtasks == "-":
        raw_text = sys.stdin.read()
    else:
        sp = Path(args.subtasks)
        if not sp.exists():
            return die(f"未找到 subtasks JSON: {sp}")
        raw_text = sp.read_text(encoding="utf-8")
    try:
        raw = json.loads(raw_text)
    except json.JSONDecodeError as e:
        return die(f"subtasks JSON 无效: {e}")

    parent = args.parent.strip().upper()
    if isinstance(raw, dict) and raw.get("parentIssue"):
        # 文件里写了父票则以 CLI 为准，仅告警不一致
        pi = raw["parentIssue"]
        pi_key = pi.get("key") if isinstance(pi, dict) else pi
        if str(pi_key).upper() != parent:
            print(
                f"WARN: JSON parentIssue={raw['parentIssue']} 与 --parent {parent} 不一致，以 CLI 为准",
                file=sys.stderr,
            )

    try:
        issues = normalize_issues(raw)
    except ValueError as e:
        return die(str(e))
    if not issues and not args.allow_empty:
        return die("subtasks 为空 —— 先用 Jira JQL 拉父票下 Sub-task 再喂进来；"
                   "若 JQL 已确认父票下确实没有 Sub-task，加 --allow-empty（全员 unmatched，见 step-14 §与其它步骤的边界）")

    acs, front = parse_checklist(ck)
    if not acs:
        return die("Checklist 里没有解析到 AC 条目（期望 `* [done|open|blocked|waived] AC-NN ...`）")

    mapping, warnings = match_all(acs, issues, front)
    wf = detect_workflow(d, args.workflow)
    step = args.step or STEP_N[wf]
    md_path, json_path = write_outputs(
        d, parent, step, acs, issues, mapping, warnings
    )

    matched = sum(1 for m in mapping if m["subtaskKey"])
    print(f"checklist={len(acs)} subtasks={len(issues)} matched={matched} "
          f"unmatched={len(acs) - matched}")
    print(f"wrote {md_path.name}")
    print(f"wrote {json_path.name}")
    for w in warnings:
        print(f"WARN: {w}", file=sys.stderr)

    if args.apply:
        rc = apply_handover(d, parent, json_path)
        if rc:
            return rc
        print("handover status → 已匹配待确认")
    else:
        print("提示: 加 --apply 可写入 .handover-state.json（已匹配待确认）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
