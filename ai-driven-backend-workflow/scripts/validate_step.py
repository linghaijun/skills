#!/usr/bin/env python
"""每步产出物的机器验收 + 流程状态记录。只用标准库。

为什么需要它：原流程每步的出口是「汇报路径 → 暂停 → 人确认」，**人眼是唯一验收器**。
无人值守时，模型说「我检查过了」和真检查过没法区分。本脚本把文档里已经写死的
规则（AC-NN 全局唯一、矩阵必须覆盖每条 AC、交付前不得有 [open]、结论必须带证据标注）
变成可执行断言。

用法:
    python validate_step.py --dir docs/develop/xxx --step 3
    python validate_step.py --dir docs/develop/xxx --all
    python validate_step.py --dir docs/develop/xxx --step 3 --record   # 写入状态
    python validate_step.py --dir docs/develop/xxx --status            # 看进度/续跑点

退出码:
    0 = 通过
    1 = 有 FAIL，但未超重试次数 —— 自动修后重跑
    2 = 同一步连续失败超过 --max-attempts —— **必须停下来问人，禁止继续自动修**

失败次数记在 .workflow-state.json 里，不靠模型记忆。「同一步栽过几次」是
可查事实，所以「第 3 次还不过就停」这条规则落得了地。
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:  # Step1 问答记录解析（同目录共用脚本）
    import qa_record
except ImportError:  # pragma: no cover
    qa_record = None

FAIL, WARN, OK = "FAIL", "WARN", "OK"
STATE_FILE = ".workflow-state.json"

findings: list[tuple[str, str, str]] = []  # (status, 检查项, 说明)


_CONCL_RE = "(通过|PASS|已验证|不涉及|N/A)"
# 否定/条件语境：出现这些词时该行不算结论，避免「在确认前不得判 PASS」被误判为已通过
_NEGATE_RE = re.compile(r"(不得|未|尚未|待|无法|禁止|非|除非|若|如果)")


_WAIVED_RE = re.compile(r"WAIVED", re.I)
# 豁免必须配一段书面决策记录，否则「写两个字就放行」和不检查没区别
_WAIVER_RECORD_RE = "风险接受记录"


def _is_waived(text: str, n: int) -> bool:
    """R-n 是否被显式标记为人工豁免。

    豁免 = 「知道没验，但决定放行」，与「验过了」是两回事，必须分开计数并始终显形。
    加这一态是因为：如实描述风险接受的句子绕不开「非 / 若 / 未」，
    而这些正是 _has_conclusion 的否定守卫词 —— 结果逼着人去改措辞迎合门禁。
    该修的是规则，不是文档。
    """
    for line in text.splitlines():
        m = re.search(rf"R-0*{n}\b", line)
        if m and _WAIVED_RE.search(line[m.end():]):
            return True
    return False


def _has_waiver_record(text: str, n: int) -> bool:
    """豁免是否留下了书面决策记录（含「风险接受记录」字样且提及 R-n 的段落）。"""
    for line in text.splitlines():
        if re.search(_WAIVER_RECORD_RE, line) and re.search(rf"R-0*{n}\b", line):
            return True
    return False


def _has_conclusion(text: str, n: int) -> bool:
    """R-n 是否给出了结论。

    只认「同一行内、R-n 之后」出现的结论词，且该行不含否定/条件语气。
    曾实际发生：正文写「在确认前，本清单不得判 PASS」，其中的 PASS 落在 R-7 之后，
    使一条明确未闭环的回归项被判为已通过。门禁误放行比不检查更危险。
    """
    for line in text.splitlines():
        m = re.search(rf"R-0*{n}\b", line)
        if not m:
            continue
        tail = line[m.end():]
        if re.search(_CONCL_RE, tail, re.I) and not _NEGATE_RE.search(tail):
            return True
    return False


def add(status: str, check: str, detail: str = "") -> None:
    findings.append((status, check, detail))


# ------------------------------------------------------------ 产出物映射

# step -> (标题, [glob 模式...])；glob 命中任一即算存在
FULLSTACK = {
    1: ("需求澄清 Q&A", ["Step 1-*.md"]),
    2: ("Spec", ["Step 2-*.md"]),
    3: ("Checklist", ["Step 3-Checklist.md"]),
    4: ("技术设计", ["Step 4-*.md"]),
    5: ("DDL", ["Step 5-*.sql"]),
    6: ("API 契约", ["Step 6-*.md"]),
    7: ("前端设计", ["Step 7-*.md"]),
    8: ("测试矩阵", ["Step 8-*测试矩阵*.md", "Step 8-*矩阵*.md"]),
    9: ("tasks", ["Step 9-tasks.md"]),
    10: ("编码", ["Step 9-tasks.md"]),  # 产出物是代码；机器能判的是 tasks.md 全部勾完
    11: ("自检报告", ["Step 11-*自检*.md"]),
    12: ("AI Review", ["Step 12-*.md"]),
    13: ("全局一致性", ["Step 13-*.md"]),
    14: ("AC-Subtask提测", ["Step 14-*Subtask*.md", "Step 14-*映射*.md", "Step 14-*.md"]),
}
BACKEND = {
    1: ("需求澄清 Q&A", ["Step 1-*.md"]),
    2: ("Spec", ["Step 2-*.md"]),
    3: ("Checklist", ["Step 3-Checklist.md"]),
    4: ("技术设计", ["Step 4-*.md"]),
    5: ("DDL", ["Step 5-*.sql"]),
    6: ("API 契约", ["Step 6-*.md"]),
    7: ("测试矩阵", ["Step 7-*矩阵*.md"]),
    8: ("tasks", ["Step 8-tasks.md"]),
    9: ("编码", ["Step 8-tasks.md"]),  # 产出物是代码；机器能判的是 tasks.md 全部勾完
    10: ("自检报告", ["Step 10-*自检*.md"]),
    11: ("AI Review", ["Step 11-*.md"]),
    12: ("全局一致性", ["Step 12-*.md"]),
    13: ("AC-Subtask提测", ["Step 13-*Subtask*.md", "Step 13-*映射*.md", "Step 13-*.md"]),
}
# 回归清单与测试矩阵同步骤
REGRESSION_GLOB = {"fullstack": "Step 8-回归验证清单.md", "backend": "Step 7-回归验证清单.md"}
MATRIX_STEP = {"fullstack": 8, "backend": 7}
TASKS_STEP = {"fullstack": 9, "backend": 8}
TEST_STEP = {"fullstack": 11, "backend": 10}
CODING_STEP = {"fullstack": 10, "backend": 9}
REVIEW_STEP = {"fullstack": 12, "backend": 11}
# 交付门禁（git 提交 + 交接文档 + 证据验收）仍停在全局一致性步
FINAL_STEP = {"fullstack": 13, "backend": 12}
# 提测状态（与验证态分离）在下一步收口；终态必须是 已提测 / 无需提测
HANDOVER_STEP = {"fullstack": 14, "backend": 13}
HANDOVER_FINAL = {"已提测", "无需提测"}

AC_RE = re.compile(r"\bAC-(\d{1,3})\b")
R_RE = re.compile(r"\bR-(\d{1,3})\b")
EVIDENCE_RE = re.compile(r"(证据[：:]|来源[：:]|待用户确认)")
# 未取证的措辞：文档明令禁止（原则 21）
GUESS_RE = re.compile(r"(通常|一般来说|应该是|按惯例|大概是|估计是|想必)")


def find_one(d: Path, patterns: list[str]) -> Path | None:
    for pat in patterns:
        hits = sorted(d.glob(pat))
        if hits:
            return hits[0]
    return None


def find_all(d: Path, patterns: list[str]) -> list[Path]:
    """匹配到的全部文件（去重、保持稳定顺序）。

    fullstack 的测试矩阵按设计就是**两份**（前端 + 后端），只读 hits[0] 会把另一份
    里覆盖到的 AC 全判成「未覆盖」——曾实际发生：后端矩阵覆盖的 AC-13~AC-19 被误报漏测。
    """
    out: list[Path] = []
    seen: set[Path] = set()
    for pat in patterns:
        for h in sorted(d.glob(pat)):
            if h not in seen:
                seen.add(h)
                out.append(h)
    return out


def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


# ------------------------------------------------------------ 各步检查

def check_exists(d: Path, step: int, spec: dict) -> Path | None:
    title, pats = spec[step]
    f = find_one(d, pats)
    if f is None:
        add(FAIL, f"Step{step} {title} 产出物", f"未找到，期望 {' 或 '.join(pats)}")
        return None
    if len(read(f).strip()) < 50:
        add(FAIL, f"Step{step} {title} 内容", f"{f.name} 几乎是空的")
        return None
    add(OK, f"Step{step} {title} 产出物", f.name)
    return f


# AC 编号的规范宽度：<=99 条用两位（AC-01），>99 用三位（AC-001）。
# 同一需求内**宽度必须统一** —— AC-1 与 AC-01 混用会导致目录名对不上、排序错乱。
AC_WIDTH = 2


def ac_token(n: int) -> str:
    """AC 编号的规范写法，全流程（含 tests/ 目录名）唯一认这一种。"""
    return "AC-%0*d" % (AC_WIDTH, n)


def _check_ac_width(text: str, uniq: list[int]) -> None:
    """Checklist 内部编号宽度必须统一，且与条数匹配。"""
    global AC_WIDTH
    AC_WIDTH = 3 if (uniq and uniq[-1] > 99) else 2
    widths = {}
    for m in AC_RE.finditer(text):
        widths.setdefault(len(m.group(1)), set()).add(m.group(0))
    if len(widths) > 1:
        sample = {w: sorted(v)[:3] for w, v in sorted(widths.items())}
        add(FAIL, "AC 编号宽度统一", f"混用了不同位数: {sample} —— 全部改成 {AC_WIDTH} 位（如 {ac_token(1)}）")
    elif widths and next(iter(widths)) != AC_WIDTH:
        got = next(iter(widths))
        add(FAIL, "AC 编号宽度统一",
            f"当前 {got} 位，{len(uniq)} 条 AC 应为 {AC_WIDTH} 位（如 {ac_token(1)}）")
    else:
        add(OK, "AC 编号宽度统一", f"{AC_WIDTH} 位零填充（{ac_token(uniq[0])}..{ac_token(uniq[-1])}）")


def check_checklist(d: Path, spec: dict) -> list[int]:
    f = find_one(d, spec[3][1])
    if f is None:
        return []
    text = read(f)
    nums = [int(m) for m in AC_RE.findall(text)]
    if not nums:
        add(FAIL, "AC 编号", "Checklist 里一条 AC-NN 都没有")
        return []
    # 定义处：行首附近出现的才算定义，这里用去重后的全集近似
    uniq = sorted(set(nums))
    _check_ac_width(text, uniq)
    dup = [n for n in uniq if nums.count(n) and _is_defined_twice(text, n)]
    if dup:
        add(FAIL, "AC 编号唯一性", f"重复定义: {[ac_token(n) for n in dup]}")
    else:
        add(OK, "AC 编号唯一性", f"{len(uniq)} 条: {ac_token(uniq[0])}..{ac_token(uniq[-1])}")
    missing = [n for n in range(uniq[0], uniq[-1] + 1) if n not in uniq]
    if missing:
        add(WARN, "AC 编号连续性", f"缺号: {[ac_token(n) for n in missing]}")
    return uniq


CK_ITEM_RE = re.compile(r"^\* \[(?:open|done|blocked|waived)\] (AC-\d{2,3})\b")
CK_REF_RE = re.compile(r"(同\s*AC-\d+|其余(?:字段)?同|同上|参见\s*AC-\d+)")
CK_VAGUE_RE = re.compile(r"(三者|以上操作|上述操作|前者|后者)")
CK_FIG_RE = re.compile(r"UI/[^）)\s]+\.(?:png|jpe?g|gif|webp|mp4|webm)", re.I)
UI_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".webm"}


def check_checklist_quality(d: Path, spec: dict) -> None:
    """Checklist 要让人不回翻就能看懂（用户要求：不简写、不互相引用、配标注图）。

    - FAIL：用「同 AC-xx / 其余字段同 / 同上」引用别的条目；图示引用的图片文件不存在
    - WARN：Then 太短（< 20 字）；用「三者 / 以上操作」等指代；有 UI/ 图却有条目没写「图示」；
            缺少「一页读懂」小节（联动总览 + 全貌图 + 字段速查）
    """
    f = find_one(d, spec[3][1])
    if f is None:
        return
    text = read(f)
    items, cur = [], None
    for ln in text.splitlines():
        m = CK_ITEM_RE.match(ln)
        if m:
            cur = {"ac": m.group(1), "lines": []}
            items.append(cur)
        elif cur is not None and ln.startswith(">>"):
            cur["lines"].append(ln)
        elif cur is not None and ln.strip():
            cur = None
    refs, vague, short, nofig, badfig = [], [], [], [], []
    for it in items:
        body = "\n".join(it["lines"])
        if CK_REF_RE.search(body):
            refs.append(it["ac"])
        if CK_VAGUE_RE.search(body):
            vague.append(it["ac"])
        then = next((x for x in it["lines"] if re.match(r">>\s*Then\s*[:：]", x)), "")
        if len(re.sub(r">>\s*Then\s*[:：]\s*", "", then)) < 20:
            short.append(it["ac"])
        figs = [x for x in it["lines"] if re.match(r">>\s*图示\s*[:：]", x)]
        if not figs:
            nofig.append(it["ac"])
        for fl in figs:
            for path in CK_FIG_RE.findall(fl):
                if not (d / path).exists():
                    badfig.append(f"{it['ac']}:{path}")
    if refs:
        add(FAIL, "Checklist 互相引用", f"{refs[:10]} 用了「同 AC-xx / 其余字段同 / 同上」—— 每条都要写全，不让读者回翻")
    if badfig:
        add(FAIL, "图示文件缺失", f"{badfig[:8]}")
    if vague:
        add(WARN, "Checklist 指代不清", f"{vague[:10]} 出现「三者 / 以上操作」等指代，改成写出具体元素名")
    if short:
        add(WARN, "Then 过短", f"{short[:10]} 的 Then 不足 20 字，写清页面位置与具体可见结果")
    ui = d / "UI"
    has_ui = ui.is_dir() and any(x.suffix.lower() in UI_EXT for x in ui.iterdir())
    if has_ui and nofig:
        add(WARN, "缺图示", f"{len(nofig)} 条没有「>> 图示:」行：{nofig[:10]}（没有合适的图就写「图示: 无（页面位置…）」）")
    if "一页读懂" not in text:
        add(WARN, "缺一页读懂", "Checklist 文首缺「一页读懂」小节（联动总览图 + 页面全貌标注图 + 字段速查表）")
    if not (refs or badfig or vague or short or (has_ui and nofig)) and "一页读懂" in text:
        add(OK, "Checklist 可读性", f"{len(items)} 条：无互相引用 / 指代，均有图示")


def _is_defined_twice(text: str, n: int) -> bool:
    """行首（允许 |、- 等前缀）出现两次以上视为重复定义。

    编号可能补零（AC-01）也可能不补（AC-1），必须两种都匹配 ——
    否则 AC-1..AC-9 的重复检测会静默失效（曾实际发生：前 9 条一直没被检查过）。
    """
    pat = re.compile(rf"^[\s|\-*#]*AC-0*{n}\b", re.MULTILINE)
    return len(pat.findall(text)) > 1


# 矩阵里不许出现的模糊预期（Step8/7「⑤ 预期结果必须具体」）
VAGUE_RE = re.compile(r"(显示正确|功能正常|符合预期|返回成功|数据无误|页面正常|结果正确|一切正常)")
# 折叠省略（「② 必须逐条完整输出」）
ELLIPSIS_RE = re.compile(r"(其余.{0,6}同理|参照上面|参见上面|以此类推|（略）|\(略\)|\.\.\.\s*略)")


def check_matrix_quality(d: Path, wf: str, spec: dict) -> None:
    """矩阵写得对不对，不只是格子填没填满。

    覆盖率检查（每条 AC 有没有分支）回答不了「分支写得对不对」——
    矩阵是 AI 自己写的，模糊预期和折叠省略是两个高频偷懒点，都能被正则抓到。
    """
    step = MATRIX_STEP[wf]
    files = find_all(d, spec[step][1])
    if not files:
        return
    vague, ellipsis, no_prio = [], [], []
    for f in files:
        for i, line in enumerate(read(f).splitlines(), 1):
            if not line.strip().startswith("|"):
                continue
            if VAGUE_RE.search(line):
                vague.append(f"{f.name}:{i} {VAGUE_RE.search(line).group(1)}")
            if ELLIPSIS_RE.search(line):
                ellipsis.append(f"{f.name}:{i}")
            # 表格数据行（非表头、非分隔线）应带优先级
            if AC_RE.search(line) and not re.search(r"\bP[012]\b", line) and "---" not in line:
                no_prio.append(f"{f.name}:{i}")
    if vague:
        add(FAIL, f"Step{step} 预期具体性",
            f"模糊预期 {len(vague)} 处: {vague[:5]}"
            + (" ..." if len(vague) > 5 else "")
            + " —— 后端要写到字段名+值+副作用，前端要写到文案原文+状态")
    if ellipsis:
        add(FAIL, f"Step{step} 逐条完整",
            f"出现折叠省略 {len(ellipsis)} 处: {ellipsis[:5]}"
            + (" ..." if len(ellipsis) > 5 else "")
            + " —— 省略掉的那几条就是后面没人写测试的那几条")
    if no_prio:
        add(WARN, f"Step{step} 分支优先级",
            f"未标 P0/P1/P2 的行 {len(no_prio)} 处: {no_prio[:5]}"
            + (" ..." if len(no_prio) > 5 else ""))
    if not (vague or ellipsis or no_prio):
        add(OK, f"Step{step} 矩阵质量", "无模糊预期 / 无折叠省略 / 分支均标优先级")


def check_matrix_covers_ac(d: Path, acs: list[int], wf: str, spec: dict) -> None:
    step = MATRIX_STEP[wf]
    files = find_all(d, spec[step][1])
    if not files or not acs:
        return
    covered = {int(m) for f in files for m in AC_RE.findall(read(f))}
    missing = [n for n in acs if n not in covered]
    if missing:
        add(FAIL, f"Step{step} 矩阵覆盖 AC",
            f"未覆盖: {[ac_token(n) for n in missing[:10]]}" + (" ..." if len(missing) > 10 else ""))
    else:
        add(OK, f"Step{step} 矩阵覆盖 AC",
            f"{len(acs)} 条全覆盖（合并 {len(files)} 份矩阵）")


def check_tasks_bind_ac(d: Path, acs: list[int], wf: str, spec: dict) -> None:
    step = TASKS_STEP[wf]
    f = find_one(d, spec[step][1])
    if f is None or not acs:
        return
    bound = {int(m) for m in AC_RE.findall(read(f))}
    missing = [n for n in acs if n not in bound]
    if missing:
        add(WARN, f"Step{step} tasks 绑定 AC",
            f"未出现: {[ac_token(n) for n in missing[:10]]}（纯技术任务可不绑，但要确认不是漏了）")
    else:
        add(OK, f"Step{step} tasks 绑定 AC", f"{len(acs)} 条全绑定")


def check_regression(d: Path, wf: str) -> list[int]:
    f = d / REGRESSION_GLOB[wf]
    if not f.exists():
        hits = sorted(d.glob("Step *-回归验证清单.md"))
        f = hits[0] if hits else None
    if f is None:
        add(FAIL, "回归验证清单", f"未找到 {REGRESSION_GLOB[wf]}（强制产出物）")
        return []
    rs = sorted({int(m) for m in R_RE.findall(read(f))})
    if not rs:
        add(WARN, "回归项 R-NN", "清单存在但没有 R-NN 条目（确认确实无回归风险）")
    else:
        add(OK, "回归项 R-NN", f"{len(rs)} 条")
    return rs


def check_tests_evidence(d: Path, acs: list[int], wf: str) -> None:
    tests = d / "tests"
    if not tests.exists():
        add(FAIL, "测试证据目录", "缺 tests/")
        return
    if not (tests / "README.md").exists():
        add(FAIL, "tests/README.md", "缺索引")
    missing_dir, missing_result, missing_replay, misnamed = [], [], [], []
    for n in acs:
        want = ac_token(n)
        ac_dir = tests / want
        if not ac_dir.exists():
            # 目录在、但写法不规范（AC-1 / AC-001 / ac-01）也要能定位到，
            # 否则会误报"没留证"，让人以为要重测。
            alt = next((p for p in tests.iterdir()
                        if p.is_dir() and re.fullmatch(rf"(?i)AC-0*{n}", p.name)), None)
            if alt is None:
                missing_dir.append(n)
                continue
            misnamed.append((alt.name, want))
            ac_dir = alt
        if not (ac_dir / "RESULT.md").exists():
            missing_result.append(n)
        if not (ac_dir / "REPLAY.md").exists() and not (ac_dir / "script").exists():
            missing_replay.append(n)
    if missing_dir:
        add(FAIL, "每 AC 证据目录", f"缺: {[ac_token(n) for n in missing_dir[:10]]}（没留证 = 未测）")
    if missing_result:
        add(FAIL, "RESULT.md", f"缺: {[ac_token(n) for n in missing_result[:10]]}")
    if missing_replay:
        add(FAIL, "复跑入口", f"缺 script/ 或 REPLAY.md: {[ac_token(n) for n in missing_replay[:10]]}")
    # 证据形式优先级：有 UI 可见结果的 AC 必须有录屏/GIF/截图；
    # 只有日志/抓包时必须在 RESULT.md 写明降级理由，否则视为偷懒。
    MEDIA = {".mp4", ".webm", ".gif", ".png", ".jpg", ".jpeg"}
    no_media = []
    for n in acs:
        ac_dir = tests / ac_token(n)
        if not ac_dir.exists():
            alt = next((p for p in tests.iterdir()
                        if p.is_dir() and re.fullmatch(rf"(?i)AC-0*{n}", p.name)), None)
            if alt is None:
                continue
            ac_dir = alt
        ev = ac_dir / "evidence"
        if not ev.exists():
            continue
        has_media = any(p.suffix.lower() in MEDIA for p in ev.rglob("*") if p.is_file())
        if has_media:
            continue
        result = read(ac_dir / "RESULT.md")
        if "证据降级" not in result:
            no_media.append(n)
    if no_media:
        add(WARN, "证据形式优先级",
            f"无录屏/GIF/截图且未写降级理由: {[ac_token(n) for n in no_media[:10]]}"
            + (" ..." if len(no_media) > 10 else "")
            + " —— 纯后端 AC 属正常，但要在 RESULT.md 写一行「证据降级：因 X 无法录屏/截图，改用 Y」")
    if misnamed:
        pairs = ", ".join(f"{a} -> {b}" for a, b in misnamed[:10])
        add(FAIL, "tests 目录名与 AC 编号一致",
            f"写法与 Checklist 不一致，重命名: {pairs}"
            + (" ..." if len(misnamed) > 10 else ""))
    if not (missing_dir or missing_result or missing_replay or misnamed or no_media) and acs:
        add(OK, "测试证据", f"{len(acs)} 个 AC 证据齐全")


QA_RECORD = "Step 1-需求澄清问答记录.md"
PM_PENDING = "待PM确认"


def check_pm_pending(d: Path, step: int) -> None:
    """Step1 问答记录：待PM确认是否清零 + 每题是否写清楚。

    待PM确认：Step1 / Step2 只提示（允许用户明确说「先按暂定继续」）；Step3 起判 FAIL ——
    Checklist 的 AC 要进 Jira，不能建立在产品没确认的前提上。
    问题描述缺失判 FAIL、过短给 WARN：清单是要转给产品看的，一句话标题别人看不懂。
    兼容旧版表格格式（只数状态列为「待PM确认」的表格行）。
    """
    f = d / QA_RECORD
    if not f.exists():
        add(WARN if step >= 2 else FAIL, "Step1 问答记录", f"缺少 {QA_RECORD}（一个问题一节，含状态 / 问题描述 / 候选项 / 已选）")
        return
    if qa_record is None:
        add(WARN, "Step1 问答记录", "qa_record.py 缺失，跳过逐题检查")
        return
    data = qa_record.parse(read(f))
    qs = data["questions"]
    if qs:
        ids = [q["id"] for q in qs if q["状态"] == PM_PENDING]
        if step == 1:
            for lv, msg in qa_record.check(d):
                add(FAIL if lv == "FAIL" else WARN, "问答记录质量", msg)
    else:
        add(WARN, "Step1 问答记录格式", "仍是旧版表格格式：看板无法逐题展示与编辑，建议迁移为「一个问题一节」")
        rows = [ln for ln in read(f).splitlines() if ln.lstrip().startswith("|") and PM_PENDING in ln]
        ids = [m.group(0) for ln in rows for m in [re.search(r"\b[QNX]\d+\b", ln)] if m]
    if not ids:
        add(OK, "待PM确认", "无残留")
    elif step >= 3:
        add(FAIL, "待PM确认未清零",
            f"{len(ids)} 条：{ids[:10]} —— 产品答复后改为「PM已确认」再过 Step3 门控")
    else:
        add(WARN, "待PM确认", f"{len(ids)} 条：{ids[:10]} —— 清单已贴给用户？Step3 前须清零")


def check_qa_changes(d: Path) -> None:
    """看板上改过问答、但 AI 还没跟用户确认并同步下游 —— 任何一步都不放行。

    不靠「AI 记得去看看板」：改动登记在 .qa-changes.json，这里每步都查。
    """
    if qa_record is None:
        return
    pend = qa_record.pending_changes(d)
    if pend:
        add(FAIL, "看板问答改动待确认",
            f"{len(pend)} 条：{[c['qid'] for c in pend]} —— 先跑 `qa_record.py changes` 列给用户确认，"
            f"同步 Spec / Checklist 等下游后 `ack`；用户不认可则 `reject`")


def refresh_dashboard(d: Path) -> None:
    """--record 后顺带重建看板快照（双击打开的 HTML 也能跟上每一步）。失败只提示，不影响验收结论。"""
    script = Path(__file__).resolve().parent / "verify_dashboard.py"
    if not script.exists():
        return
    try:
        r = subprocess.run([sys.executable, str(script), "--dir", str(d)], capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=120)
        print("看板已刷新" if r.returncode == 0 else f"[warn] 看板刷新失败：{(r.stderr or r.stdout)[-300:]}")
    except Exception as e:  # noqa: BLE001
        print(f"[warn] 看板刷新失败：{e}")


def check_evidence_markers(d: Path, spec: dict) -> None:
    """原则 21：事实判断必须带证据/来源标注，禁止「通常/应该是」这类措辞。"""
    for step in (4, 6):
        if step not in spec:
            continue
        f = find_one(d, spec[step][1])
        if f is None:
            continue
        text = read(f)
        guesses = GUESS_RE.findall(text)
        if guesses:
            add(WARN, f"Step{step} 未取证措辞",
                f"{f.name} 出现 {len(guesses)} 处「{'/'.join(sorted(set(guesses))[:4])}」，原则 21 禁止用推测替代取证")
        if not EVIDENCE_RE.search(text):
            add(WARN, f"Step{step} 证据标注",
                f"{f.name} 通篇没有「证据：」/「来源：」/「待用户确认」标注")
        else:
            add(OK, f"Step{step} 证据标注", f"{len(EVIDENCE_RE.findall(text))} 处")


# 代码改了但对应文档没改 —— 规则早就写在 AGENTS.md 里（「REST API 变更必须同步
# OpenAPI 注解与 docs/creative-management-api.md」），但从来没有检查，做没做没人知道。
# (类别, 命中判据, 必须同步的文档, 严重度)
DOC_SYNC_RULES = [
    ("API 契约", lambda p: "/controller/" in p or re.search(
        r"(Req|Resp|View|VO|DTO)\.java$", p), "docs/creative-management-api.md", FAIL),
    ("数据层", lambda p: "/mapper/" in p or p.endswith("Mapper.java")
     or (p.endswith(".sql") and "/db/" in p), "docs/creative-management-data.md", WARN),
    ("架构 / 编排", lambda p: any(s in p for s in ("/manager/", "/handler/", "/consumers/")),
     "docs/creative-management-architecture.md", WARN),
]


def _git_changed_files(project: Path, base: str | None) -> list[str] | None:
    """返回改动文件列表（POSIX 路径）。不是 git 仓库返回 None。

    工作流禁止 Step13 之前提交，所以改动通常在**工作区**而非提交里；给了 --base
    则再并上该分支已提交的部分。
    """
    import subprocess

    def run(*args: str) -> list[str]:
        try:
            p = subprocess.run(["git", "-C", str(project), *args],
                               capture_output=True, text=True, timeout=60, errors="replace")
        except (OSError, subprocess.SubprocessError):
            return []
        if p.returncode != 0:
            return []
        # 只 rstrip：--porcelain 的状态码占前两列，行首空格有意义，strip 掉会切错路径
        return [l.rstrip().replace("\\", "/") for l in p.stdout.splitlines() if l.strip()]

    if not (project / ".git").exists():
        return None
    files = set(run("diff", "--name-only", "HEAD"))          # 已跟踪文件的未提交改动
    # -uall 不可省：默认 --porcelain 会把整个未跟踪目录折叠成一行（如 src/main/resources/），
    # 新建的 Controller / mapper 就整个看不见了
    for line in run("status", "--porcelain", "-uall"):
        if len(line) > 3:
            path = line[3:]
            # 重命名是 "R  old -> new"，取新路径
            files.add(path.split(" -> ")[-1].strip('"'))
    if base:
        files |= set(run("diff", "--name-only", f"{base}...HEAD"))
    return sorted(f for f in files if f)


def check_doc_sync(project: Path, base: str | None) -> None:
    changed = _git_changed_files(project, base)
    if changed is None:
        add(WARN, "文档同步", f"{project} 不是 git 仓库，跳过检查")
        return
    code = [f for f in changed if f.endswith((".java", ".xml", ".sql"))
            and "/test/" not in f and "/target/" not in f]
    if not code:
        add(OK, "文档同步", "本次无生产代码改动")
        return

    for label, matches, doc, severity in DOC_SYNC_RULES:
        hits = [f for f in code if matches(f)]
        if not hits:
            continue
        if doc in changed:
            add(OK, f"文档同步 · {label}", f"{doc} 已同步")
        else:
            add(severity, f"文档同步 · {label}",
                f"改了 {len(hits)} 个文件（如 {hits[0]}）但 {doc} 未更新")


HANDOVER_GLOB = {"fullstack": "Step 13-测试交接文档.md", "backend": "Step 12-测试交接文档.md"}
# 只在「像是把密码值写出来」时才判失败：密码/password 后面紧跟冒号或等号再跟内容。
# 光是提到「密码」两个字不算 —— 「填邮箱会报用户名或密码错误」是描述报错文案，
# 「密码找 X 要」是正确写法，都不该判失败。门禁宁可漏报也不能靠改措辞来迎合。
_PWD_RE = re.compile(r"(密\s*码|password|passwd|\bpwd\b)\s*[:：=]\s*\S", re.I)
_PWD_SAFE_RE = re.compile(r"(不写|禁止|不记录|不在本文档|人工|找|问|无|N/A|见)")
_VERDICT_RE = re.compile(r"(✅\s*\*\*?(通过|PASS)|\bRESULT\.md\b|evidence/|REPLAY\.md)")


def check_handover(d: Path, wf: str) -> None:
    """提测交接文档：存在、有账号矩阵、不含密码、不透传我们的结论。"""
    f = d / HANDOVER_GLOB[wf]
    if not f.exists() or not f.read_text(encoding="utf-8", errors="ignore").strip():
        add(FAIL, "测试交接文档", f"未找到 {HANDOVER_GLOB[wf]}（提测强制产出物）")
        return
    text = read(f)
    missing = [k for k in ("登录名", "client", "能验什么", "不能验什么") if k not in text]
    if missing:
        add(FAIL, "测试交接文档 账号矩阵", f"缺少必填列: {missing}（场景→账号矩阵不完整）")
    else:
        add(OK, "测试交接文档 账号矩阵", "登录名 / client / 能验 / 不能验 齐备")
    leaks = [ln.strip()[:60] for ln in text.splitlines()
             if _PWD_RE.search(ln) and not _PWD_SAFE_RE.search(ln)]
    if leaks:
        add(FAIL, "测试交接文档 凭据", f"疑似写入密码: {leaks[:3]}（禁止写密码，只注明找谁要）")
    if _VERDICT_RE.search(text):
        add(WARN, "测试交接文档 结论透传",
            "出现 AC 结论或 tests/ 证据引用 —— 交接文档只给前置条件，不给我们的判定（锚定效应）")


def check_ac_subtask_handover(d: Path) -> None:
    """Step14/13：提测状态与验证态分离；终态必须是 已提测 / 无需提测。"""
    p = d / ".handover-state.json"
    if not p.exists():
        add(FAIL, "提测状态", "未找到 .handover-state.json（与 tests/.verify-state.json 分离）")
        return
    try:
        st = json.loads(read(p) or "{}")
    except json.JSONDecodeError as e:
        add(FAIL, "提测状态", f".handover-state.json 不是合法 JSON: {e}")
        return
    status = st.get("status") or ""
    if status not in HANDOVER_FINAL:
        add(FAIL, "提测状态终态",
            f"当前 status={status or '(空)'}，须为 已提测 或 无需提测"
            "（用户说不提测 → 无需提测；勿与验证态混写）")
    else:
        add(OK, "提测状态终态", status)
    mapping = st.get("mapping") or []
    if not isinstance(mapping, list) or not mapping:
        add(WARN, "提测映射", "mapping 为空 —— 确认父票下是否确无 Sub-task / AC")
    else:
        matched = sum(1 for m in mapping if (m.get("subtaskKey") or "").strip())
        add(OK, "提测映射", f"n={len(mapping)} matched={matched}")
    if status == "已提测":
        actions = st.get("jiraActions") or []
        if not actions and matched_keys(mapping):
            add(WARN, "提测 Jira 动作",
                "status=已提测 但 jiraActions 为空 —— 若已流转请 record-jira，无可流转 subtask 则在 note 写明")


def matched_keys(mapping: list) -> bool:
    return any((m.get("subtaskKey") or "").strip() for m in mapping)


def check_final_gate(d: Path, acs: list[int], rs: list[int], wf: str, spec: dict) -> None:
    """交付门禁：不得有 [open] 的 AC、R-NN 必须有结论、脏数据必须已清理。"""
    f = find_one(d, spec[3][1])
    if f:
        # 🔴 [open] 既可能在 AC 编号之后，也可能在之前（`* [open] AC-26 ...`）。
        # 早期正则只认前者，对后一种格式**恒绿** —— CP-57337 实测 51 条全是 [open]
        # 却仍报「无 [open]」。改为逐行判定：同一行里既有 [open] 又有 AC-NN 即算未回写。
        opens = [m.group(1) for line in read(f).splitlines() if "[open]" in line
                 for m in [re.search(r"AC-(\d{1,3})\b", line)] if m]
        if opens:
            add(FAIL, "交付门禁 AC 状态",
                f"仍为 [open]: {[ac_token(int(n)) for n in opens[:10]]}（Step11 应回写 [done]）")
        else:
            add(OK, "交付门禁 AC 状态", "无 [open]")
        # [waived] = 证据验收没通过、由用户放行（与 [done] 分开计数）；必须在证据验收报告里有
        # 「风险接受记录」且同一行点名该 AC，否则「写个 [waived]」就能绕过交付门禁
        waived = sorted({int(m.group(1)) for m in re.finditer(r"\[waived\]\s*AC-(\d{1,3})\b", read(f))})
        if waived:
            ea = d / EVIDENCE_ACCEPT_GLOB[wf]
            ea_text = read(ea) if ea.exists() else ""
            no_rec = [n for n in waived
                      if not any(_WAIVER_RECORD_RE in l and re.search(rf"AC-0*{n}\b", l) for l in ea_text.splitlines())]
            if no_rec:
                add(FAIL, "AC 豁免记录",
                    f"[waived] 缺风险接受记录: {[ac_token(n) for n in no_rec]}（{ea.name} 里要有含「风险接受记录」并点名该 AC 的一行：放行范围 + 用户原话 + 风险）")
            else:
                add(WARN, "AC 用户豁免", f"{[ac_token(n) for n in waived]} 未经验收通过，由用户放行（有风险接受记录）—— 提测时请测试关注")

    reg = d / REGRESSION_GLOB[wf]
    if reg.exists():
        text = read(reg)
        waived = [n for n in rs if _is_waived(text, n)]
        bad_waiver = [n for n in waived if not _has_waiver_record(text, n)]
        no_concl = [n for n in rs
                    if n not in waived and not _has_conclusion(text, n)]
        if no_concl:
            add(FAIL, "交付门禁 R-NN",
                f"无结论: {['R-%d' % n for n in no_concl[:10]]}（未验证的 R 与未实现的 AC 同等对待）")
        elif bad_waiver:
            add(FAIL, "交付门禁 R-NN",
                f"豁免缺决策记录: {['R-%d' % n for n in bad_waiver[:10]]}"
                "（WAIVED 必须配一段含「风险接受记录」且提及该 R-NN 的说明）")
        elif rs:
            add(OK, "交付门禁 R-NN",
                f"{len(rs)} 条均有结论"
                + (f"（含 {len(waived)} 条豁免）" if waived else ""))
        if waived:
            add(WARN, "R-NN 人工豁免",
                f"{['R-%d' % n for n in waived]} 未经测试证实，"
                "由人工风险接受放行 —— 上线后保持关注")

    rpt = find_one(d, ["Step 1*-浏览器实机验证报告.md"])
    if rpt and re.search(r"未清理|待清理", read(rpt)):
        add(FAIL, "交付门禁 脏数据", "实机验证报告里仍有未清理项")


EVIDENCE_ACCEPT_GLOB = {"fullstack": "Step 13-证据验收报告.md", "backend": "Step 12-证据验收报告.md"}


def check_evidence_acceptance(d: Path, acs: list[int], wf: str) -> None:
    """证据验收（验收测试专员）：逐 AC 判定证据能否通过验收，且 Checklist 状态不得超前于判定。

    前面的门禁只查产出物彼此是否自洽；证据能不能让 AC 验收通过，要靠一个只看证据原件的
    独立角色判。只认行首 `| AC-NN |` 的表格行，避免把规则说明里的判定字样误判。
    """
    f = d / EVIDENCE_ACCEPT_GLOB[wf]
    if not f.exists():
        add(FAIL, "证据验收报告", f"未找到 {EVIDENCE_ACCEPT_GLOB[wf]}（见 references/evidence-acceptance.md）")
        return
    # 复验轮次另存为「…证据验收报告-第N轮.md」：按 首轮 → 第2轮 → 第3轮… 顺序读，
    # 同一 AC 以最后出现的判定为准（同一文件内追加的复验小节同理）。
    # 只读首轮文件会让复验通过的 AC 永远停在首轮的「验收不通过」。
    def round_no(p: Path) -> int:
        m = re.search(r"第\s*(\d+)\s*轮", p.name)
        return int(m.group(1)) if m else 1
    reports = [f] + sorted((p for p in d.glob(f.stem + "-*.md") if p != f), key=round_no)
    verdicts: dict[int, str] = {}
    for rf in reports:
        for line in read(rf).splitlines():
            m = re.match(r"\|\s*AC-(\d{1,3})\s*\|", line)
            if not m:
                continue
            v = re.search(r"验收(不通过|通过)", line)
            if v:
                verdicts[int(m.group(1))] = v.group(0)
    missing = [n for n in acs if n not in verdicts]
    failed = sorted(n for n, v in verdicts.items() if v == "验收不通过")
    ck = d / "Step 3-Checklist.md"
    done = {int(m.group(1)) for m in re.finditer(r"\[done\]\s*AC-(\d{1,3})\b", read(ck))} if ck.exists() else set()
    false_done = [n for n in failed if n in done]
    if missing:
        add(FAIL, "证据验收 覆盖", f"无判定: {[ac_token(n) for n in missing[:10]]}")
    if false_done:
        add(FAIL, "证据验收 vs Checklist",
            f"已置 [done] 但验收不通过: {[ac_token(n) for n in false_done[:10]]}（退回 [open] 或补证复验）")
    if failed:
        add(WARN, "证据验收 判定", f"验收不通过: {[ac_token(n) for n in failed[:10]]}（补证 / 重测，或交用户放行）")
    if not (missing or false_done):
        add(OK, "证据验收", f"{len(verdicts)} 条 AC 均有判定，[done] 均已验收通过")

def check_tasks_done(d: Path, wf: str, spec) -> None:
    """编码步：tasks.md 不得留未勾选项（`- [ ]`）—— 没做完的任务要么做完勾上，要么写明取消 / 移交原因后勾上。"""
    hits = [h for g in spec[TASKS_STEP[wf]][1] for h in sorted(d.glob(g))]
    if not hits:
        return
    f = hits[0]
    open_items = [l.strip()[:60] for l in read(f).splitlines() if re.match(r"^\s*[-*]\s*\[ \]", l)]
    if open_items:
        add(FAIL, "编码 tasks 完成度", f"{f.name} 仍有 {len(open_items)} 项未勾选：{open_items[:5]}")
    else:
        add(OK, "编码 tasks 完成度", f"{f.name} 全部勾选")


# ------------------------------------------------------------ 状态记录

def load_state(d: Path) -> dict:
    p = d / STATE_FILE
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    return {"steps": {}, "history": []}


def save_state(d: Path, state: dict) -> None:
    (d / STATE_FILE).write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def record_state(d: Path, step: int | str, passed: bool) -> int:
    """记录一次尝试，返回该步当前的连续失败次数。"""
    state = load_state(d)
    now = datetime.datetime.now().isoformat(timespec="seconds")
    prev = state["steps"].get(str(step), {})
    attempts = prev.get("attempts", 0) + 1
    consecutive = 0 if passed else prev.get("consecutive_fails", 0) + 1

    state["steps"][str(step)] = {
        "passed": passed,
        "at": now,
        "attempts": attempts,
        "consecutive_fails": consecutive,
        "fails": [f"{c}: {t}" for s, c, t in findings if s == FAIL],
    }
    state["history"].append({"step": str(step), "passed": passed, "at": now,
                             "attempt": attempts})
    state["history"] = state["history"][-50:]
    state["last_step"] = str(step)
    state["updated_at"] = now
    save_state(d, state)
    return consecutive


def print_status(d: Path, spec: dict) -> None:
    state = load_state(d)
    if not state.get("steps"):
        print(f"{d}\n还没有任何步骤记录（用 --record 写入）")
        return
    print(f"流程状态 @ {d}")
    print(f"最后更新: {state.get('updated_at', '-')}   最后执行: Step{state.get('last_step', '-')}\n")
    for step in sorted(spec, key=int):
        info = state["steps"].get(str(step))
        title = spec[step][0]
        if info is None:
            print(f"  ○ Step{step:<3}{title}  未执行")
            continue
        tries = info.get("attempts", 1)
        suffix = f"  （第 {tries} 次尝试）" if tries > 1 else ""
        if info["passed"]:
            print(f"  ✅ Step{step:<3}{title}  {info['at']}{suffix}")
        else:
            cf = info.get("consecutive_fails", 1)
            print(f"  ❌ Step{step:<3}{title}  {info['at']}{suffix}  连续失败 {cf} 次")
            for x in info.get("fails", [])[:3]:
                print(f"       - {x}")
            if cf > 2:
                print("       🔴 已超重试上限，按规则必须停下问人，不要继续自动修")
    nxt = next((s for s in sorted(spec, key=int)
                if not state["steps"].get(str(s), {}).get("passed")), None)
    print(f"\n续跑点: {'全部通过' if nxt is None else f'Step{nxt}'}")


# ------------------------------------------------------------ 主流程

# ------------------------------------------------------------ skill 自检

# 两个 workflow 共用、理应逐字一致的文件（内容与步号无关）
SHARED_FILES = ["references/browser-verification-playbook.md",
                "references/evidence-acceptance.md",
                "references/test-handover.md",
                "references/lesson-harvest.md",
                "scripts/preflight.py",
                "scripts/verify_state.py",
                "scripts/verify_dashboard.py",
                "scripts/handover_state.py",
                "scripts/handover_match.py",
                "scripts/init_workdir.py",
                "scripts/qa_record.py",
                "scripts/checklist_jira.py",
                "scripts/annotate.js",]
SIBLING = {"ai-driven-fullstack-workflow": "ai-driven-backend-workflow",
           "ai-driven-backend-workflow": "ai-driven-fullstack-workflow"}


def _norm_shared(line: str) -> str:
    """抹掉两个 workflow 之间**本就应当不同**的东西，只留真实内容差异。

    步号（11.4 / 10.4、第十步 / 第十一步）与 lesson 编号（L20 / L17）天然不同，
    不归一化的话这个检查会永远亮黄灯 —— 永远亮的告警等于没有告警（见 L18）。
    """
    line = re.sub(r"(Step ?|第)\s*[一二三四五六七八九十]+步", "Step<N>", line)
    line = re.sub(r"Step ?\d+(\.\d+)*", "Step<N>", line)
    line = re.sub(r"\b\d+\.\d+(\.\d+)?\b", "<N.N>", line)
    line = re.sub(r"\bL\d+\b", "L<N>", line)
    # 「第十步 10.4」拆出两个占位符，「Step 11.4」只拆一个 —— 合并相邻占位符再比
    line = re.sub(r"(Step<N>)(\s*<N\.N>)+", r"\1", line)
    return re.sub(r"\s+", " ", line).strip()


def check_shared_drift(skill_dir: Path) -> None:
    """共用文件在两个 workflow 之间有没有漂移。

    约 1100 行内容在两个 skill 里各存一份。一边改了另一边忘了，不会报错、
    只会让两个 workflow 行为不一致 —— 已因此产生过两次 LNN 错位。
    只比**与步号无关**的文件；step-NN 系列天然应当不同，不在此列。
    """
    sib_name = SIBLING.get(skill_dir.name)
    if not sib_name:
        return
    sib = skill_dir.parent / sib_name
    if not sib.exists():
        add(WARN, "共用文件漂移", f"未找到对照 skill {sib_name}，跳过")
        return
    drift, missing = [], []
    for rel in SHARED_FILES:
        a, b = skill_dir / rel, sib / rel
        if not a.exists() or not b.exists():
            missing.append(rel)
            continue
        # 按行比较，忽略行尾 CR 差异
        # 按行比较：忽略行尾 CR，并归一化步号 / lesson 号（两边本就不同）
        la = [_norm_shared(x) for x in read(a).splitlines()]
        lb = [_norm_shared(x) for x in read(b).splitlines()]
        if la != lb:
            n = sum(1 for x, y in zip(la, lb) if x != y) + abs(len(la) - len(lb))
            drift.append(f"{rel}({n} 行不同)")
    if missing:
        add(WARN, "共用文件缺失", f"{missing} 在某一侧不存在")
    if drift:
        add(WARN, "共用文件漂移",
            f"{drift} 与 {sib_name} 不一致 —— 若非有意，两个 workflow 的行为已经不同了")
    elif not missing:
        add(OK, "共用文件一致", f"{len(SHARED_FILES)} 个共用文件与 {sib_name} 逐字相同")


def check_skill_self(skill_dir: Path) -> None:
    """校验 skill 自身的 lessons 引用是否自洽。

    两个 workflow 的 lessons 是**各自独立编号**的（同一条经验在 fullstack 是 L20、
    在 backend 是 L17）。内容从一边复制到另一边时，`LNN` 引用会静默指向错误条目 ——
    不报错、不影响运行，只是执行时对照到了别的 lesson。已实际发生过两次。
    """
    lf = skill_dir / "references" / "lessons-learned.md"
    if not lf.exists():
        add(WARN, "skill 自检", f"未找到 {lf}")
        return
    text = read(lf)
    nums = sorted(int(n) for n in re.findall(r"^### L(\d+)\.", text, re.MULTILINE))
    if not nums:
        add(FAIL, "lessons 解析", "lessons-learned.md 里一条 `### LNN.` 都没有")
        return

    # 1) 引用是否都落在本 skill 的有效编号内
    dangling: dict[int, list[str]] = {}
    used: set[int] = set()
    for f in sorted(skill_dir.rglob("*.md")):
        if f.name == "lessons-learned.md":
            continue
        for m in re.finditer(r"[（(\s/、，。；：]L(\d+)", read(f)):
            n = int(m.group(1))
            used.add(n)
            if n not in nums:
                dangling.setdefault(n, []).append(f.name)
    if dangling:
        detail = "; ".join(f"L{n} (本 skill 无此条) ← {', '.join(sorted(set(v)))}"
                           for n, v in sorted(dangling.items()))
        add(FAIL, "lessons 引用有效性",
            f"{detail} —— 多半是从另一个 workflow 复制内容时没换编号")
    else:
        add(OK, "lessons 引用有效性", f"{len(used)} 个引用全部命中（共 {len(nums)} 条 lesson）")

    # 2) 计数行是否跟得上
    m = re.search(r"- 当前：\*\*(\d+)\*\*", text)
    if not m:
        add(WARN, "lessons 计数行", "没找到「- 当前：**N**」")
    elif int(m.group(1)) != len(nums):
        add(WARN, "lessons 计数行", f"写的是 {m.group(1)}，实际 {len(nums)} 条")
    else:
        add(OK, "lessons 计数行", f"{len(nums)} 条")

    # 3) 末尾索引表是否漏行
    missing_row = [n for n in nums if not re.search(rf"^\|\s*L{n}\s*\|", text, re.MULTILINE)]
    if missing_row:
        add(WARN, "lessons 索引表", f"缺行: {['L%d' % n for n in missing_row[:10]]}")

    # 4) 孤儿条目（仅提示，不算错：有些 lesson 靠标题被读到）
    orphan = [n for n in nums if n not in used]
    if orphan:
        add(WARN, "lessons 未被引用",
            f"{['L%d' % n for n in orphan[:10]]} 只存在于 lessons 库，"
            f"对应步骤文件里没有 `（见 LNN）` 锚点，执行时容易想不起来")


# 指向某一步的**独特称呼** → 该步文件名里的片段。
# 两个 workflow 的步号不同（fullstack 多一步「前端设计」，其后全部错位一位），
# 从一边复制段落到另一边时 `StepN` 会静默指向错误的步 —— 已实际发生过。
# 只收**歧义低**的称呼：像「需求回溯」「影响面清单」这种会出现在别的步里的词不收，
# 宁可漏报也不能误报（永远亮的告警等于没有告警，见门禁设计经验）。
STEP_TOPICS = {
    "checklist": ["Checklist"],
    "ddl": ["DDL"],
    "test-matrix": ["测试矩阵", "单元测试验证指标矩阵", "前端测试验证指标矩阵",
                    "回归验证清单"],
    "tasks": ["tasks.md"],
    "test-debug": ["业务逻辑自检", "实机验证"],
    "ai-review": ["AI Review"],
    "global-consistency-review": ["全局一致性审查"],
    "ac-subtask-handover": ["AC ↔ Subtask", "AC-Subtask", "Subtask 匹配与提测"],
}


def check_step_refs(skill_dir: Path) -> None:
    """正文里的 `StepN <某步的名字>` 是否指向本 skill 真正的那一步。"""
    ref = skill_dir / "references"
    if not ref.exists():
        return
    slug2num: dict[str, int] = {}
    for f in ref.glob("step-*.md"):
        m = re.match(r"step-(\d+)-(.+)\.md$", f.name)
        if m:
            slug2num[m.group(2)] = int(m.group(1))

    topic2num = {t: slug2num[slug]
                 for slug, topics in STEP_TOPICS.items() if slug in slug2num
                 for t in topics}
    if not topic2num:
        return
    alt = "|".join(re.escape(t) for t in sorted(topic2num, key=len, reverse=True))
    pat = re.compile(rf"Step ?(\d+)(?:\.\d+)?\s*[-—－]?\s*[《「]?({alt})")

    bad = []
    for f in sorted(skill_dir.rglob("*.md")):
        for i, line in enumerate(read(f).splitlines(), 1):
            for num, topic in pat.findall(line):
                exp = topic2num[topic]
                if int(num) != exp:
                    bad.append(f"{f.name}:{i} 写的 Step{num} {topic}，本 skill 是 Step{exp}")
    if bad:
        add(FAIL, "步号引用",
            "; ".join(bad[:8]) + (f" …共 {len(bad)} 处" if len(bad) > 8 else "")
            + " —— 多半是从另一个 workflow 复制内容时没换步号")
    else:
        add(OK, "步号引用", f"{len(topic2num)} 个步骤称呼的引用全部对得上")


def check_bughunt_letter(skill_dir: Path) -> None:
    """缺陷猎捕清单标题里的维度序号，必须与 Review 步里实际的维度字母一致。"""
    cl = skill_dir / "references" / "bug-hunting-checklist.md"
    rv = next(iter(sorted((skill_dir / "references").glob("step-*-ai-review.md"))), None)
    if not cl.exists() or rv is None:
        return
    m = re.search(r"\*\*([A-Z])\d?\.\s*缺陷猎捕", read(rv))
    if not m:
        add(WARN, "缺陷猎捕维度", f"{rv.name} 里找不到「缺陷猎捕」维度")
        return
    letter = m.group(1)
    head = read(cl).splitlines()[0]
    h = re.search(r"维度 ?([A-Z])\d? ?专用", head)
    if not h:
        add(WARN, "缺陷猎捕维度", "清单标题里没写「维度 X 专用」")
    elif h.group(1) != letter:
        add(FAIL, "缺陷猎捕维度",
            f"清单标题写「维度 {h.group(1)}」，{rv.name} 里实际是维度 {letter}")
    else:
        add(OK, "缺陷猎捕维度", f"清单与 {rv.name} 都是维度 {letter}")


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="每步产出物机器验收")
    ap.add_argument("--dir", help="docs/develop/{Sprint}-{id}-{标题}/ 目录")
    ap.add_argument("--self-check", action="store_true",
                    help="只校验 skill 自身（lessons 编号引用是否自洽），不需要 --dir")
    ap.add_argument("--workflow", choices=["fullstack", "backend"], default="fullstack")
    ap.add_argument("--step", type=int, help="只校验某一步")
    ap.add_argument("--all", action="store_true", help="校验到目前为止的全部产出")
    ap.add_argument("--record", action="store_true", help="把结果写入 .workflow-state.json")
    ap.add_argument("--status", action="store_true", help="打印流程状态与续跑点")
    ap.add_argument("--max-attempts", type=int, default=2,
                    help="同一步允许自动修几次，超过则退出码 2 要求停下问人（默认 2）")
    ap.add_argument("--project", help="代码仓根目录（默认从 --dir 上溯：docs/develop/x → 仓根）")
    ap.add_argument("--base", help="文档同步检查的对比基线分支，如 origin/production；"
                                   "不给则只看工作区未提交改动（流程禁止 Step13 前提交，通常够用）")
    args = ap.parse_args()

    if args.self_check:
        skill_dir = Path(__file__).resolve().parent.parent
        check_skill_self(skill_dir)
        check_step_refs(skill_dir)
        check_bughunt_letter(skill_dir)
        check_shared_drift(skill_dir)
        icon = {OK: "✅", WARN: "⚠️ ", FAIL: "❌"}
        print("skill 自检 @ " + skill_dir.name)
        print()
        for s, c, t in findings:
            print(f"  {icon[s]} {c}{'  ' + t if t else ''}")
        fails = [f for f in findings if f[0] == FAIL]
        print()
        print(f"❌ {len(fails)} 项未通过" if fails else "✅ skill 自洽")
        raise SystemExit(1 if fails else 0)

    if not args.dir:
        ap.error("需要 --dir（或用 --self-check 只校验 skill 自身）")

    d = Path(args.dir).resolve()
    spec = FULLSTACK if args.workflow == "fullstack" else BACKEND

    if not d.exists():
        print(f"❌ 目录不存在: {d}", file=sys.stderr)
        raise SystemExit(1)

    if args.status:
        print_status(d, spec)
        return

    if not args.step and not args.all:
        print("需要 --step N 或 --all", file=sys.stderr)
        raise SystemExit(1)

    steps = sorted(spec) if args.all else [args.step]
    acs: list[int] = []
    rs: list[int] = []

    check_qa_changes(d)
    for step in steps:
        if step not in spec:
            add(WARN, f"Step{step}", "该 workflow 无此步骤定义，跳过")
            continue
        check_exists(d, step, spec)
        if step in (1, 2, 3):
            check_pm_pending(d, step)
        if step == 3:
            acs = check_checklist(d, spec)
            check_checklist_quality(d, spec)
        if step == MATRIX_STEP[args.workflow]:
            acs = acs or check_checklist(d, spec)
            check_matrix_covers_ac(d, acs, args.workflow, spec)
            check_matrix_quality(d, args.workflow, spec)
            rs = check_regression(d, args.workflow)
        if step == TASKS_STEP[args.workflow]:
            acs = acs or check_checklist(d, spec)
            check_tasks_bind_ac(d, acs, args.workflow, spec)
        if step == CODING_STEP[args.workflow]:
            check_tasks_done(d, args.workflow, spec)
        if step == TEST_STEP[args.workflow]:
            acs = acs or check_checklist(d, spec)
            check_tests_evidence(d, acs, args.workflow)
        if step in (4, 6):
            check_evidence_markers(d, spec)
        if step in (REVIEW_STEP[args.workflow], FINAL_STEP[args.workflow]):
            project = Path(args.project).resolve() if args.project else d.parent.parent.parent
            check_doc_sync(project, args.base)
        if step == FINAL_STEP[args.workflow]:
            acs = acs or check_checklist(d, spec)
            rs = rs or check_regression(d, args.workflow)
            check_final_gate(d, acs, rs, args.workflow, spec)
            check_handover(d, args.workflow)
            check_evidence_acceptance(d, acs, args.workflow)
        if step == HANDOVER_STEP[args.workflow]:
            check_ac_subtask_handover(d)

    fails = [f for f in findings if f[0] == FAIL]
    warns = [f for f in findings if f[0] == WARN]
    icon = {OK: "✅", WARN: "⚠️ ", FAIL: "❌"}
    print(f"验收 @ {d}  workflow={args.workflow}  step={'all' if args.all else args.step}\n")
    for s, c, t in findings:
        print(f"  {icon[s]} {c}{'  ' + t if t else ''}")
    print()
    if fails:
        print(f"❌ {len(fails)} 项未通过 —— 本步未完成，禁止进入下一步")
    else:
        print(f"✅ 通过{f'（{len(warns)} 项警告需确认）' if warns else ''}")

    exit_code = 1 if fails else 0

    if args.record:
        consecutive = record_state(d, "all" if args.all else args.step, not fails)
        print(f"已记录到 {d / STATE_FILE}")
        refresh_dashboard(d)
        if fails and consecutive > args.max_attempts:
            print(f"\n🔴 本步已连续失败 {consecutive} 次（上限 {args.max_attempts}）。")
            print("   **禁止继续自动修** —— 反复修同一处说明判断依据本身有问题，")
            print("   继续修只会越走越偏。把上面的 FAIL 清单和 .workflow-state.json")
            print("   的失败历史贴给用户，请求人工介入。")
            exit_code = 2
        elif fails:
            print(f"（本步第 {consecutive} 次失败，还可自动修 "
                  f"{args.max_attempts - consecutive + 1} 次）")

    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
