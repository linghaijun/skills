#!/usr/bin/env python
"""提测状态登记（与 tests/.verify-state.json 验证态分离）。

需求级状态（互斥终态只有两个）:
    待匹配 → 已匹配待确认 → 已提测 | 无需提测

用法（🔴 `--dir` 是主解析器参数，**必须写在子命令之前**，写在后面会直接报
`the following arguments are required: --dir`；step-14 文档里的调用都是这个顺序）:
    py handover_state.py --dir docs/develop/xxx init     --parent CP-57189
    py handover_state.py --dir docs/develop/xxx status
    py handover_state.py --dir docs/develop/xxx set-mapping --json mapping.json
    py handover_state.py --dir docs/develop/xxx decide   --status 已提测
    py handover_state.py --dir docs/develop/xxx decide   --status 无需提测 --note "用户说不提测"
    py handover_state.py --dir docs/develop/xxx record-jira --key CP-1 --transition ok --assign ok
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

STATE_FILE = ".handover-state.json"
STATUSES = ["待匹配", "已匹配待确认", "已提测", "无需提测"]
FINAL = {"已提测", "无需提测"}
DEFAULT_ASSIGNEE = "biao.mu@pacvue.com"
DEFAULT_TARGET_STATUS = "Testing"


def die(msg: str, code: int = 1) -> int:
    print("ERROR: " + msg, file=sys.stderr)
    return code


def now_iso() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def state_path(d: Path) -> Path:
    return d / STATE_FILE


def load(d: Path) -> dict:
    p = state_path(d)
    if not p.exists():
        return {
            "version": 1,
            "parentIssue": None,
            "assigneeEmail": DEFAULT_ASSIGNEE,
            "targetStatus": DEFAULT_TARGET_STATUS,
            "status": "待匹配",
            "matchedAt": None,
            "decidedAt": None,
            "note": "",
            "mapping": [],
            "jiraActions": [],
        }
    return json.loads(p.read_text(encoding="utf-8"))


def save(d: Path, state: dict) -> None:
    d.mkdir(parents=True, exist_ok=True)
    state_path(d).write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def cmd_init(args: argparse.Namespace) -> int:
    d = Path(args.dir)
    st = load(d)
    if st.get("status") in FINAL and not args.force:
        return die("已是终态「" + st["status"] + "」，重开需 --force")
    st["parentIssue"] = args.parent
    st["assigneeEmail"] = args.assignee or DEFAULT_ASSIGNEE
    st["targetStatus"] = args.target_status or DEFAULT_TARGET_STATUS
    if st.get("status") in FINAL and args.force:
        st["status"] = "待匹配"
        st["matchedAt"] = None
        st["decidedAt"] = None
        st["mapping"] = []
        st["jiraActions"] = []
        st["note"] = ""
    elif st.get("status") not in STATUSES:
        st["status"] = "待匹配"
    save(d, st)
    print("init ok: parent=" + args.parent + " status=" + st["status"])
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    d = Path(args.dir)
    if not state_path(d).exists():
        print("尚无 .handover-state.json（未进入 Step14）")
        return 0
    st = load(d)
    print("parent=" + str(st.get("parentIssue")))
    print("status=" + str(st.get("status")) + ("  [终态]" if st.get("status") in FINAL else ""))
    print("assignee=" + str(st.get("assigneeEmail")))
    print("targetStatus=" + str(st.get("targetStatus")))
    mapping = st.get("mapping") or []
    matched = sum(1 for m in mapping if m.get("subtaskKey"))
    unmatched = sum(1 for m in mapping if not m.get("subtaskKey"))
    print("mapping: total=" + str(len(mapping)) + " matched=" + str(matched) + " unmatched=" + str(unmatched))
    if st.get("note"):
        print("note=" + st["note"])
    actions = st.get("jiraActions") or []
    if actions:
        ok_t = sum(1 for a in actions if a.get("transition") == "ok")
        ok_a = sum(1 for a in actions if a.get("assign") == "ok")
        print("jiraActions: n=" + str(len(actions)) + " transition_ok=" + str(ok_t) + " assign_ok=" + str(ok_a))
    return 0


def cmd_set_mapping(args: argparse.Namespace) -> int:
    d = Path(args.dir)
    st = load(d)
    if st.get("status") in FINAL and not args.force:
        return die("终态「" + st["status"] + "」不可改映射，需 --force")
    raw = Path(args.json).read_text(encoding="utf-8")
    data = json.loads(raw)
    if isinstance(data, dict) and "mapping" in data:
        mapping = data["mapping"]
        if data.get("parentIssue"):
            st["parentIssue"] = data["parentIssue"]
    elif isinstance(data, list):
        mapping = data
    else:
        return die("JSON 须为 mapping 数组，或含 mapping 字段的对象")
    norm = []
    for row in mapping:
        ac = row.get("ac") or row.get("AC") or row.get("acNN")
        if not ac:
            return die("mapping 行缺少 ac")
        if not str(ac).startswith("AC-"):
            ac = "AC-" + str(ac).lstrip("0") if str(ac).isdigit() else ac
        norm.append(
            {
                "ac": ac,
                "subtaskKey": row.get("subtaskKey") or row.get("key") or "",
                "subtaskSummary": row.get("subtaskSummary") or row.get("summary") or "",
                "match": row.get("match") or ("exact" if row.get("subtaskKey") else "unmatched"),
                "note": row.get("note") or "",
            }
        )
    st["mapping"] = norm
    st["matchedAt"] = now_iso()
    st["status"] = "已匹配待确认"
    save(d, st)
    matched = sum(1 for m in norm if m.get("subtaskKey"))
    print("set-mapping ok: n=" + str(len(norm)) + " matched=" + str(matched) + " status=已匹配待确认")
    return 0


def cmd_decide(args: argparse.Namespace) -> int:
    d = Path(args.dir)
    st = load(d)
    if args.status not in FINAL:
        return die("--status 只能是 已提测 或 无需提测")
    if st.get("status") in FINAL and not args.force:
        return die("已是终态「" + st["status"] + "」，改判需 --force")
    if args.status == "已提测" and st.get("status") == "待匹配" and not args.force:
        return die("尚未匹配完成（status=待匹配），不能直接已提测")
    if args.status == "无需提测" and st.get("status") == "已提测" and not args.force:
        return die("已提测不能直接改成无需提测（需 --force）")
    st["status"] = args.status
    st["decidedAt"] = now_iso()
    if args.note:
        st["note"] = args.note
    save(d, st)
    print("decide ok: status=" + args.status + " [终态]")
    return 0


def cmd_record_jira(args: argparse.Namespace) -> int:
    d = Path(args.dir)
    st = load(d)
    actions = list(st.get("jiraActions") or [])
    actions.append(
        {
            "subtaskKey": args.key,
            "transition": args.transition,
            "assign": args.assign,
            "detail": args.detail or "",
            "at": now_iso(),
        }
    )
    st["jiraActions"] = actions
    save(d, st)
    print("record-jira ok: " + args.key)
    return 0


def main() -> int:
    # Windows 管道下 stdout 默认 cp1252，打印中文（含 --help）会 UnicodeEncodeError
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="提测状态（与验证态分离）")
    ap.add_argument("--dir", required=True, help="docs/develop/{...} 目录")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init")
    p.add_argument("--parent", required=True)
    p.add_argument("--assignee", default=DEFAULT_ASSIGNEE)
    p.add_argument("--target-status", default=DEFAULT_TARGET_STATUS)
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("status")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("set-mapping")
    p.add_argument("--json", required=True, help="mapping JSON 文件路径")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_set_mapping)

    p = sub.add_parser("decide")
    p.add_argument("--status", required=True, choices=sorted(FINAL))
    p.add_argument("--note", default="")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_decide)

    p = sub.add_parser("record-jira")
    p.add_argument("--key", required=True)
    p.add_argument("--transition", required=True, choices=["ok", "fail", "skip"])
    p.add_argument("--assign", required=True, choices=["ok", "fail", "skip"])
    p.add_argument("--detail", default="")
    p.set_defaults(func=cmd_record_jira)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
