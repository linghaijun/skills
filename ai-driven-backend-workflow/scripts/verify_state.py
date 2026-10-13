#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""浏览器实机验证步骤（fullstack Step 11.4 / backend Step 10.4）的**用例状态登记**：多会话 / 多浏览器并行时用。只用标准库。

为什么需要它：11.4 允许多个会话（主会话 + 子 agent）或多个浏览器实例同时验不同 AC。
并发下有两件事靠「心里记着」解决不了：
  1. 同一条 AC 被两个会话同时验 —— 重复劳动，且两边证据互相覆盖；
  2. 窗口串扰 —— A 会话的工具调用打到 B 会话的标签页上。

于是把「谁在验哪条 AC、用的是哪个窗口」写成一份**共享登记文件**
`tests/.verify-state.json`，认领 / 收尾 / 回收都走本脚本（锁文件 + 读-改-写），
不依赖会话之间的口头约定。手动直接编辑该 JSON 也可，但并发下会丢更新。

状态枚举（与 Checklist 回写对应）:
    待验证 | 验证中 | 修复中 | 通过 | 失败 | 阻塞 | 部分 | 走读证据 | 跳过
    - 阻塞 -> Checklist 回写 [blocked]（须附原因并回写 Spec）
    - 待验证 / 验证中 / 修复中 / 失败 / 部分 / 走读证据 / 跳过 -> Checklist 保持 [open]
    - 通过                                                          -> Checklist 回写 [done]
    证据终验（不重跑浏览器，只核对证据内容是否支撑结论）:
        未终验 | 终验中 | 终验通过 | 终验不通过 | 豁免（证据不足、用户明确放行；必须 --note 写放行范围与用户原话）
    生命周期：待验证 -> 验证中 ->（发现问题）修复中 -> 验证中（复验）-> 通过/失败/...

窗口标识规范（**每个会话必须登记自己打开的那个窗口**）:
    内置浏览器        tab:<tabId>
    自拉 Chrome + CDP cdp:<port>/<targetId>
    多实例（方案 A）  cdp:<port>/<targetId>@profile:<user-data-dir 简写>
                      —— 端口、账号、profile 一一对应，见 playbook 2.1 / 12

用法（示例都是一行，Windows 下直接用）:
    python verify_state.py init    --dir docs/develop/xxx [--acs AC-01,AC-02] [--from-result]   # 按 tests/AC-NN/RESULT.md 结论回填历史状态
    python verify_state.py list    --dir docs/develop/xxx
    python verify_state.py mine    --dir docs/develop/xxx --session s1
    python verify_state.py claim   --dir docs/develop/xxx --ac AC-01 --session s1 --window tab:1234
    python verify_state.py fix     --dir docs/develop/xxx --ac AC-01 --session s1 --note "问题摘要"
    python verify_state.py finish  --dir docs/develop/xxx --ac AC-01 --session s1 --status 通过
    python verify_state.py reclaim --dir docs/develop/xxx --ac AC-01 --session s2 --window tab:9999
    python verify_state.py final   --dir docs/develop/xxx --ac ALL  --session s1 --status 终验中
    python verify_state.py final   --dir docs/develop/xxx --ac AC-01 --session s1 --status 终验通过 --note "证据支撑结论"

退出码:
    0 = 正常
    1 = 冲突（该 AC 被别的会话占用 / 尚未超时不许抢 / 需 --force）
    2 = 用法或前置错误（目录不存在、未 init、状态非法、锁超时）
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import time
from contextlib import contextmanager
from pathlib import Path

AC_RE = re.compile(r"^AC-\d{1,3}$")
REG_REL = Path("tests") / ".verify-state.json"
LOCK_REL = Path("tests") / ".verify-state.lock"

STATUSES = ["待验证", "验证中", "修复中", "通过", "失败", "阻塞", "部分", "走读证据", "跳过"]
# FINAL = 除生命周期非终态（待验证 / 验证中 / 修复中）之外的判定态
FINAL_STATUSES = [s for s in STATUSES if s not in ("待验证", "验证中", "修复中")]

# 证据终验（终验）：全部 AC 跑完、证据采集完之后，**只看证据内容是否支撑结论**，
# 不重跑浏览器。解决的问题是「有证据文件」不等于「证据真能证明这条 AC」。
#   未终验 -> 终验中 -> 终验通过 / 终验不通过 / 豁免（用户放行，与「通过」分开计数）
FC_STATUSES = ["未终验", "终验中", "终验通过", "终验不通过", "豁免"]
FC_FINAL = ("终验通过", "终验不通过", "豁免")
FC_DONE = ("通过", "失败", "阻塞", "部分", "走读证据", "跳过")   # 这些状态才谈得上终验


def now() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def die(msg: str, code: int = 2) -> int:
    print("[verify-state] " + msg, file=sys.stderr)
    return code


@contextmanager
def file_lock(path: Path, timeout: float = 3.0):
    """跨进程互斥：用 O_EXCL 建锁文件。拿到锁才允许读-改-写登记文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + timeout
    fd = None
    while True:
        try:
            fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
            break
        except FileExistsError:
            if time.time() > deadline:
                raise TimeoutError("登记文件被占用（" + str(path) + "），请稍后重试")
            time.sleep(0.05)
    try:
        yield
    finally:
        os.close(fd)
        try:
            os.remove(str(path))
        except OSError:
            pass


def load(d: Path) -> dict:
    p = d / REG_REL
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    return {"cases": {}}


def save(d: Path, st: dict) -> None:
    st["updated_at"] = now()
    p = d / REG_REL
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, p)  # 原子替换：并发下别的会话不会读到半截 JSON


def age_minutes(ts) -> float:
    try:
        t = datetime.datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return float("inf")
    return (datetime.datetime.now().astimezone() - t).total_seconds() / 60


def ac_key(ac: str) -> int:
    return int(ac.split("-")[1])


def resolve_dir(raw: str) -> Path:
    d = Path(raw)
    if not d.is_dir():
        raise SystemExit(die("目录不存在: " + str(d) + "（--dir 指向需求目录 docs/develop/xxx）"))
    return d


def _ac_dir(tests: Path, ac: str):
    """定位 AC 目录，容忍 AC-1 / ac-07 / AC-007 等不规范写法。"""
    if not tests.is_dir():
        return None
    want = int(ac.split("-")[1])
    for p in tests.iterdir():
        if p.is_dir():
            m = re.match(r"(?i)^AC-0*(\d{1,3})$", p.name)
            if m and int(m.group(1)) == want:
                return p
    return None


# 结论判定（实测口径，别想当然）：
#   1) 单元格常以 emoji 开头标终态，且可能叙述「❌ FAIL（首测）→ 修复 → ✅ PASS」，
#      所以 **取最后一个 emoji** 才是最终状态（AC-26 这类修复后复验通过的要算「通过」）。
#   2) 🔴 `⬜` / `NOT_RUN` / `未执行` 是「本轮没跑、待测试环境执行」= **未验 → 待验证**，
#      **不是**「跳过」。`跳过` 只留给明确「不做 / 不适用 / N/A」。
#   3) 没有 emoji 时（如 `- 结论：**通过**`）才退回按词判定，取最靠前的词。
_EMOJI_VERDICT = [("✅", "通过"), ("❌", "失败"), ("⛔", "阻塞"), ("🚫", "阻塞"),
                  ("🟡", "部分"), ("⚠", "部分"), ("⬜", "待验证"), ("⬛", "待验证")]
_WORD_VERDICT = [("PASS", "通过"), ("FAIL", "失败"), ("BLOCKED", "阻塞"), ("PARTIAL", "部分"),
                 ("走读", "走读证据"), ("跳过", "跳过"), ("本期不做", "跳过"), ("不适用", "跳过"),
                 ("N/A", "跳过"), ("NOT_RUN", "待验证"), ("未执行", "待验证"), ("未测", "待验证"),
                 ("未验", "待验证"), ("通过", "通过"), ("失败", "失败"), ("阻塞", "阻塞"), ("部分", "部分")]


def classify_verdict(cell: str):
    """把结论单元格/行文本判成一个状态；判不出返回 None（保持「待验证」，不乱猜）。"""
    if not cell:
        return None
    up = cell.upper()
    emo = [(up.find(e), st) for e, st in _EMOJI_VERDICT if up.find(e) >= 0]
    if emo:
        return max(emo)[1]
    words = sorted((up.find(k), i, st) for i, (k, st) in enumerate(_WORD_VERDICT) if up.find(k) >= 0)
    return words[0][2] if words else None


def _verdict_text(text: str):
    """从 RESULT.md 提取「结论」文本。实测存在 3 种格式，按可靠度依次尝试：

    1. 表格行：`| 结论 | ✅ **PASS** |`（Chewy / 新增Video）
    2. 独立标记行：标题下裸写 `✅ **通过**`（Walmart 风格）
    3. 项目符号行：`- 结论：**通过**`（Amazon 风格，取**最后一条** —— 后面的才是最终结论）
    都找不到返回 None（→ 保持待验证，不乱猜）。
    """
    lines = text.splitlines()
    for line in lines:                                    # 1)
        if re.match(r"^\s*\|\s*结论\s*\|", line):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            return cells[-1] if cells else ""
    for line in lines[:15]:                               # 2)
        s = line.strip()
        if re.match(r"^[*`_>\s]*(✅|⬜|❌|🟡|🚫)", s):
            return s
    hits = [l for l in lines if re.search(r"结论\s*[:：]", l)]   # 3)
    if hits:
        return re.sub(r"^[\s>*\-•]*\**结论\**\s*[:：]\s*", "", hits[-1]).strip()
    return None


def verdict_from_result(path: Path):
    """从 RESULT.md 的「结论」行判定状态与时间（历史回填用）。返回 (status|None, mtime_iso|None)。"""
    if not path.exists():
        return None, None
    cell = _verdict_text(path.read_text(encoding="utf-8", errors="replace"))
    status = classify_verdict(cell) if cell is not None else None
    ts = datetime.datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat(timespec="seconds")
    return status, ts


def report_verdicts(req: Path) -> dict:
    """从《Step 1x-浏览器实机验证报告.md》的逐条表格提取 AC → 状态。

    旧式产出（早期流程）没有 `tests/AC-NN/` 四件套，验证结论只写在报告里，
    典型表格：`| AC-02 | 操作路径 | … | ✅ |`（AC 列可能是 `AC-18/19` 合并写法）。
    """
    out = {}
    for p in sorted(req.glob("Step *-浏览器实机验证报告.md")):
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip().startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 3 or not re.search(r"AC-\d", cells[0]):
                continue
            st = classify_verdict(cells[-1])
            if st is None:
                continue
            for n in re.findall(r"AC-(\d{1,3})", cells[0]):
                out.setdefault("AC-%02d" % int(n), st)
    return out


def resolve_ac(st: dict, ac: str) -> str:
    """把 --ac 解析到登记里的实际键：容忍 AC-1 / AC-01 / ac-007 等写法。

    登记键名来自 `tests/AC-NN` 目录名，历史目录可能不补零（实测整份登记是 AC-1..AC-32），
    看板侧已做归一，CLI 侧也必须互通，否则 `--ac AC-01` 找不到 `AC-1`。
    """
    if ac in st["cases"]:
        return ac
    try:
        want = int(ac.split("-")[1])
    except (IndexError, ValueError):
        return ac
    for k in st["cases"]:
        if re.match(r"(?i)^AC-0*" + str(want) + r"$", k):
            return k
    return ac


def get_case(st: dict, ac: str) -> dict:
    ac = resolve_ac(st, ac)
    case = st["cases"].get(ac)
    if case is None:
        raise SystemExit(die(ac + " 未登记，先跑 verify_state.py init --dir ..."))
    return case


# ------------------------------------------------------------ 子命令

def cmd_init(args) -> int:
    d = resolve_dir(args.dir)
    st = load(d)
    if args.acs:
        acs = [a.strip() for a in args.acs.split(",") if a.strip()]
    else:
        tests = d / "tests"
        acs = ([p.name for p in tests.iterdir()
                if p.is_dir() and AC_RE.match(p.name)] if tests.exists() else [])
    if not acs:
        return die("没有可登记的 AC：tests/ 下无 AC-* 目录，也没传 --acs")
    bad = [a for a in acs if not AC_RE.match(a)]
    if bad:
        return die("AC 写法非法规整（应为 AC-01 两位零填充）: " + str(bad))
    added = backfilled = 0
    tests = d / "tests"
    report_map = report_verdicts(d) if args.from_result else {}
    for ac in acs:
        if ac in st["cases"] and not args.force:
            continue
        entry = {"status": "待验证", "session": None, "window": None,
                 "engine": None, "started_at": None, "updated_at": None,
                 "created_at": now(), "finished_at": None,
                 "duration_seconds": None, "note": "",
                 "final_status": "未终验", "final_by": None,
                 "final_at": None, "final_note": ""}
        if args.from_result:
            status = ts = None
            src = "RESULT.md"
            ac_dir = _ac_dir(tests, ac)
            if ac_dir is not None:
                status, ts = verdict_from_result(ac_dir / "RESULT.md")
            if status is None and ac in report_map:          # 回退：旧式《浏览器实机验证报告》
                status, ts, src = report_map[ac], None, "Step 1x-浏览器实机验证报告"
            if status:
                entry.update(status=status, session="backfill", window=None,
                             engine=None, updated_at=ts, finished_at=ts,
                             note="回填自 " + src + "（历史无计时，started_at 为空）")
                backfilled += 1
            elif ac in st["cases"]:
                # 读不出结论时不要把已有状态冲成「待验证」（--force 重跑的安全性）
                continue
        st["cases"][ac] = entry
        added += 1
    with file_lock(d / LOCK_REL):
        save(d, st)
    print("登记就绪：新增 " + str(added) + " 条（其中回填 " + str(backfilled)
          + " 条；来源见各条 note），共 " + str(len(st["cases"])) + " 条 -> " + str(d / REG_REL))
    return 0


def cmd_list(args) -> int:
    d = resolve_dir(args.dir)
    st = load(d)
    if not st["cases"]:
        return die("登记为空，先跑 init")
    print("用例验证状态 @ " + str(d) + "（TTL " + str(args.ttl) + " 分钟，验证中/修复中超过 TTL 可 reclaim）")
    print("")
    print("| AC-NN | 状态 | 终验 | 会话 | 窗口标识 | 引擎 | 开始 | 备注 |")
    print("|---|---|---|---|---|---|---|---|")
    for ac in sorted(st["cases"], key=ac_key):
        c = st["cases"][ac]
        stale = (c["status"] in ("验证中", "修复中") and c.get("session")
                 and age_minutes(c.get("updated_at")) > args.ttl)
        status = c["status"] + (" [超时可回收]" if stale else "")
        fc = c.get("final_status") or "未终验"
        if fc == "终验中" and c.get("final_by"):
            fc += "(" + str(c.get("final_by")) + ")"
        print("| " + ac + " | " + status + " | " + fc + " | " + str(c.get("session") or "-")
              + " | " + str(c.get("window") or "-") + " | " + str(c.get("engine") or "-")
              + " | " + str(c.get("started_at") or "-") + " | " + (c.get("note") or "") + " |")
    return 0


def cmd_mine(args) -> int:
    d = resolve_dir(args.dir)
    st = load(d)
    cs = st["cases"]
    owned = [(ac, cs[ac]) for ac in sorted(cs, key=ac_key)
             if cs[ac].get("session") == args.session
             and cs[ac]["status"] in ("验证中", "修复中")]
    fin = [(ac, cs[ac]) for ac in sorted(cs, key=ac_key)
           if cs[ac].get("final_by") == args.session
           and cs[ac].get("final_status") == "终验中"]
    if not owned and not fin:
        print("会话 " + args.session + " 当前没有「验证中/修复中」，也没有「终验中」的 AC")
        return 0
    if owned:
        print("会话 " + args.session + " 当前占用（实机验证）：")
        for ac, c in owned:
            print("  " + ac + "  window=" + str(c.get("window")) + "  engine="
                  + str(c.get("engine")) + "  started=" + str(c.get("started_at")))
        print("")
        print("[!] 只操作上面这些窗口；工具调用每次显式带你自己的 tabId，禁止碰其他会话的窗口。")
    if fin:
        print("会话 " + args.session + " 当前占用（证据终验，不重跑浏览器）：")
        for ac, c in fin:
            print("  " + ac + "  since=" + str(c.get("final_at")))
    return 0


def cmd_claim(args) -> int:
    d = resolve_dir(args.dir)
    if not AC_RE.match(args.ac):
        return die("--ac 写法非法: " + args.ac + "（应为 AC-01）")
    with file_lock(d / LOCK_REL):
        st = load(d)
        c = get_case(st, args.ac)
        if c["status"] in ("验证中", "修复中") and c.get("session") != args.session \
                and age_minutes(c.get("updated_at")) < args.ttl:
            return die(args.ac + " 已被会话 " + str(c.get("session")) + " 认领"
                       + "（window=" + str(c.get("window")) + "，" 
                       + str(round(age_minutes(c.get("updated_at")))) + " 分钟前）。"
                       + "换一条，或等超时后 reclaim。", 1)
        if c["status"] in FINAL_STATUSES and not args.force:
            return die(args.ac + " 已完结（" + c["status"] + "）。要重验加 --force。", 1)
        c.update(status="验证中", session=args.session, window=args.window,
                 engine=args.engine, started_at=now(), updated_at=now(),
                 note=args.note or "")
        save(d, st)
    print(args.ac + " 已认领：session=" + args.session + " window=" + args.window
          + " -> 状态=验证中")
    return 0


def cmd_fix(args) -> int:
    d = resolve_dir(args.dir)
    with file_lock(d / LOCK_REL):
        st = load(d)
        c = get_case(st, args.ac)
        if c["status"] not in ("验证中", "修复中"):
            return die(args.ac + " 当前是「" + c["status"]
                       + "」，只有「验证中」才能转「修复中」。", 1)
        if c.get("session") != args.session and not args.force:
            return die(args.ac + " 由会话 " + str(c.get("session")) + " 认领，你（"
                       + args.session + "）不能改。确需接管加 --force。", 1)
        c.update(status="修复中", updated_at=now(),
                 note=args.note or c.get("note") or "")
        save(d, st)
    print(args.ac + " -> 修复中（session=" + str(c.get("session")) + " window="
          + str(c.get("window")) + "）。修完用 claim 回到「验证中」复验。")
    return 0


def cmd_finish(args) -> int:
    d = resolve_dir(args.dir)
    if args.status not in FINAL_STATUSES:
        return die("--status 只能是 " + str(FINAL_STATUSES) + " 之一")
    with file_lock(d / LOCK_REL):
        st = load(d)
        c = get_case(st, args.ac)
        if c["status"] != "验证中":
            return die(args.ac + " 当前不是「验证中」（" + c["status"] + "），无需 finish。", 1)
        if c.get("session") != args.session and not args.force:
            return die(args.ac + " 由会话 " + str(c.get("session")) + " 认领，你（"
                       + args.session + "）无权收尾。确需接管加 --force。", 1)
        end = now()
        c.update(status=args.status, updated_at=end, finished_at=end,
                 note=args.note or c.get("note") or "")
        # 终验核对的是「上一次验证」的证据；重新验证后旧终验不再适用，必须作废重验，
        # 否则看板会一直挂着旧的「终验通过」（实际发生过：重测改判为阻塞后仍显示终验通过）
        old_final = c.get("final_status")
        if old_final in FC_FINAL:
            c.update(final_status="未终验", final_by=None, final_at=None,
                     final_note="重新验证后作废（原为「" + old_final + "」），需重新终验")
        s0 = c.get("started_at")
        if s0:
            try:
                c["duration_seconds"] = round(
                    (datetime.datetime.fromisoformat(end)
                     - datetime.datetime.fromisoformat(s0)).total_seconds())
            except ValueError:
                pass
        save(d, st)
    checklist = {"通过": "[done]", "阻塞": "[blocked]"}.get(args.status, "[open]")
    print(args.ac + " 收尾：status=" + args.status + "（Checklist 应回写 " + checklist
          + "）  session=" + str(c.get("session")) + " window=" + str(c.get("window")))
    return 0


def cmd_final(args) -> int:
    """证据终验：只核对证据内容是否支撑结论，**不重跑浏览器**。

    - 前置：该 AC 已完结（状态不属于 待验证/验证中/修复中），否则「还没验完，无可终验」
    - 并发：终验中归认领会话所有（未超时不许抢）；超时后别的会话可直接接管
    - `--ac ALL` 只能批量置「终验中」；终验通过 / 终验不通过必须逐条给
      （每条都要真看过证据，批量打钩等于没验）
    """
    d = resolve_dir(args.dir)
    if args.status not in FC_STATUSES:
        return die("--status 非法: " + args.status + "（应为 " + " / ".join(FC_STATUSES) + "）")
    if args.status == "豁免" and not args.note.strip():
        return die("豁免必须 --note 写明：放行了哪些断言、用户原话、风险（没有书面记录的豁免等于没检查）。")
    if args.ac == "ALL" and args.status != "终验中":
        return die("终验通过 / 终验不通过 必须逐条指定 --ac（每条都要真看过证据）；批量只能置「终验中」。")
    if args.ac != "ALL" and not AC_RE.match(args.ac):
        return die("--ac 写法非法: " + args.ac + "（应为 AC-01，或 ALL 表示全部）")
    ttl = args.ttl
    with file_lock(d / LOCK_REL):
        st = load(d)
        targets = sorted(st["cases"], key=ac_key) if args.ac == "ALL" else [args.ac]
        touched, skipped, passed, failed = [], [], [], []
        for ac in targets:
            c = get_case(st, ac)
            if c["status"] not in FC_DONE:
                skipped.append(ac + "（" + c["status"] + "，还没验完）")
                continue
            owner = c.get("final_by")
            cur = c.get("final_status") or "未终验"
            if args.status in FC_FINAL:
                if cur == args.status and not args.force:
                    skipped.append(ac + "（已终验为「" + args.status + "」）")
                    continue
                # 已终验的结论是「有人真看过证据」才下的，改判必须显式 --force
                if cur in FC_FINAL and not args.force:
                    skipped.append(ac + "（已终验为「" + cur + "」，改判需 --force）")
                    continue
                if cur == "终验中" and owner != args.session and not args.force:
                    skipped.append(ac + "（" + str(owner) + " 正在终验，需 --force）")
                    continue
            else:                                    # 终验中：认领 / 重新打开
                if cur == "终验中" and owner and owner != args.session \
                        and age_minutes(c.get("final_at")) < ttl:
                    skipped.append(ac + "（" + str(owner) + " 正在终验且未超时）")
                    continue
            c.update(final_status=args.status, final_by=args.session, final_at=now(),
                     final_note=args.note or c.get("final_note") or "")
            touched.append(ac)
            if args.status == "终验通过":
                passed.append(ac)
            elif args.status == "终验不通过":
                failed.append(ac)
        save(d, st)
    print("终验 -> " + args.status + "：处理 " + str(len(touched)) + " 条"
          + ("（其中不通过 " + str(len(failed)) + " 条）" if failed else ""))
    if skipped:
        print("跳过 " + str(len(skipped)) + " 条：" + "; ".join(skipped[:8])
              + (" …" if len(skipped) > 8 else ""))
    if passed:
        print("说明：终验通过只代表「证据支撑结论」，验证状态本身没有变（Checklist 仍需按 status 回写）。")
    if failed:
        print("[!] 终验不通过：按「发现问题」处理 —— 先看证据缺什么，必要时才重新 claim 做实机复验。")
    return 0


def cmd_reclaim(args) -> int:
    d = resolve_dir(args.dir)
    with file_lock(d / LOCK_REL):
        st = load(d)
        c = get_case(st, args.ac)
        if c["status"] not in ("验证中", "修复中"):
            return die(args.ac + " 不是「验证中/修复中」（" + c["status"] + "），不用 reclaim。", 1)
        age = age_minutes(c.get("updated_at"))
        if c.get("session") == args.session:
            return die(args.ac + " 本来就是你的（" + args.session + "），直接继续即可。", 1)
        if age < args.ttl:
            return die(args.ac + " 被会话 " + str(c.get("session")) + " 占用，才 "
                       + str(round(age)) + " 分钟（< TTL " + str(args.ttl) + "），不许抢。", 1)
        old = c.get("session")
        c.update(session=args.session, window=args.window, engine=args.engine,
                 started_at=now(), updated_at=now(),
                 note="回收自 " + str(old) + "（" + str(round(age)) + " 分钟无更新，超 TTL "
                      + str(args.ttl) + "）")
        save(d, st)
    print(args.ac + " 已回收：" + str(old) + " -> " + args.session + "（window="
          + args.window + "）")
    return 0


# ------------------------------------------------------------ 主流程

def main() -> int:
    ap = argparse.ArgumentParser(description="Step11.4 浏览器验证用例状态登记")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add_dir(p):
        p.add_argument("--dir", required=True, help="需求目录 docs/develop/{Sprint}-{id}-{title}")
        p.add_argument("--ttl", type=float, default=20.0,
                       help="「验证中」判定超时的分钟数（默认 20）")

    p = sub.add_parser("init", help="初始化登记（默认扫 tests/AC-*）")
    add_dir(p)
    p.add_argument("--acs", help="逗号分隔的 AC 列表，如 AC-01,AC-02；不给则扫 tests/AC-*")
    p.add_argument("--from-result", action="store_true",
                   help="按 tests/AC-NN/RESULT.md 结论回填；旧式产出（无 tests/）回退读《Step 1x-浏览器实机验证报告》")
    p.add_argument("--force", action="store_true", help="已存在的条目也重新回填")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("list", help="列出全部用例状态")
    add_dir(p)
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("mine", help="列出本会话占用的 AC 与窗口")
    add_dir(p)
    p.add_argument("--session", required=True)
    p.set_defaults(func=cmd_mine)

    p = sub.add_parser("claim", help="认领一条 AC（置「验证中」+ 登记窗口）")
    add_dir(p)
    p.add_argument("--ac", required=True)
    p.add_argument("--session", required=True, help="会话标识：主会话名 / 子 agent 名")
    p.add_argument("--window", required=True, help="窗口标识：tab:<id> 或 cdp:<port>/<targetId>")
    p.add_argument("--engine", default="内置浏览器")
    p.add_argument("--note", default="")
    p.add_argument("--force", action="store_true", help="允许重验已完结的 AC")
    p.set_defaults(func=cmd_claim)

    p = sub.add_parser("fix", help="验出问题：验证中 -> 修复中（仍归本会话）")
    add_dir(p)
    p.add_argument("--ac", required=True)
    p.add_argument("--session", required=True)
    p.add_argument("--note", default="", help="问题摘要")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_fix)

    p = sub.add_parser("final", help="证据终验：核对证据是否支撑结论（不重跑浏览器）")
    add_dir(p)
    p.add_argument("--ac", required=True, help="AC-01；或 ALL（批量只允许置「终验中」）")
    p.add_argument("--session", required=True)
    p.add_argument("--status", required=True, choices=FC_STATUSES)
    p.add_argument("--note", default="", help="终验依据 / 不通过原因")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_final)

    p = sub.add_parser("finish", help="收尾一条 AC（写最终状态）")
    add_dir(p)
    p.add_argument("--ac", required=True)
    p.add_argument("--session", required=True)
    p.add_argument("--status", required=True, choices=FINAL_STATUSES)
    p.add_argument("--note", default="")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_finish)

    p = sub.add_parser("reclaim", help="回收超时的「验证中」")
    add_dir(p)
    p.add_argument("--ac", required=True)
    p.add_argument("--session", required=True)
    p.add_argument("--window", required=True)
    p.add_argument("--engine", default="内置浏览器")
    p.set_defaults(func=cmd_reclaim)

    args = ap.parse_args()
    try:
        return args.func(args)
    except TimeoutError as e:
        return die(str(e))


if __name__ == "__main__":
    sys.exit(main())
