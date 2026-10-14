#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""单测证据：把当次 surefire XML 全集复制进证据目录，并按 testcase 的 classname 跨文件聚合计数。只用标准库。

用法:
    python -I surefire_aggregate.py --src <模块>/target/surefire-reports \
        --copy-to <需求目录>/tests/_unit/<批次> [--classes FooUnitTest,BarUnitTest] [--out summary.json]

    --src      surefire 报告目录（读其中 TEST-*.xml）
    --copy-to  把 TEST-*.xml 全集原样复制到这里（证据原件；target/ 会被下次运行覆盖，不能只引用）
    --classes  只统计这些类（简单类名，逗号分隔）；不给则统计全部
    --out      聚合结果 JSON（默认写到 --copy-to 下的 surefire-summary.json；都没给则只打印）

输出：每个类的用例总数、失败 / 错误 / 跳过的用例名、这些用例实际记录在哪些 XML 里；每个 XML 的 md5。

为什么有它（CP-58118，2026-10-13）：
- 单测证据引用 target/ 下的报告，被下一次运行覆盖，验收时原件不在 → 退回；
- surefire 并行时会把用例记进**别的类**的 TEST-*.xml，按文件名数用例对不上 → 又退回一轮。
所以：复制全集 + 按 classname 聚合 + 附 md5（evidence-acceptance「测前动作」）。
"""
import argparse
import glob
import hashlib
import json
import os
import shutil
import sys
import xml.etree.ElementTree as ET


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as fp:
        for chunk in iter(lambda: fp.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description="surefire 单测证据：复制原件 + 按 classname 聚合")
    ap.add_argument("--src", required=True)
    ap.add_argument("--copy-to", default=None)
    ap.add_argument("--classes", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    files = sorted(glob.glob(os.path.join(a.src, "TEST-*.xml")))
    if not files:
        sys.exit("没有 TEST-*.xml: " + a.src)
    want = {c.strip() for c in a.classes.split(",")} if a.classes else None
    res = {}
    for f in files:
        for tc in ET.parse(f).getroot().iter("testcase"):
            cls = (tc.get("classname") or "").split(".")[-1]
            if want is not None and cls not in want:
                continue
            r = res.setdefault(cls, {"cases": [], "failed": [], "files": set()})
            r["cases"].append(tc.get("name"))
            r["files"].add(os.path.basename(f))
            if any(ch.tag in ("failure", "error", "skipped") for ch in tc):
                r["failed"].append(tc.get("name"))
    missing = sorted(want - set(res)) if want else []
    out = {
        "src": os.path.abspath(a.src),
        "classes": {k: {"total": len(v["cases"]), "failedOrErrorOrSkipped": v["failed"],
                        "recordedInFiles": sorted(v["files"]), "cases": sorted(v["cases"])}
                    for k, v in sorted(res.items())},
        "classesNotFound": missing,
        "files": {os.path.basename(f): md5(f) for f in files},
    }
    if a.copy_to:
        os.makedirs(a.copy_to, exist_ok=True)
        for f in files:
            shutil.copy2(f, os.path.join(a.copy_to, os.path.basename(f)))
        out["copiedTo"] = os.path.abspath(a.copy_to)
    dst = a.out or (os.path.join(a.copy_to, "surefire-summary.json") if a.copy_to else None)
    if dst:
        with open(dst, "w", encoding="utf-8") as fp:
            json.dump(out, fp, ensure_ascii=False, indent=1)
    for k, v in out["classes"].items():
        print(k, "total=" + str(v["total"]), "bad=" + str(v["failedOrErrorOrSkipped"]), "in=" + ",".join(v["recordedInFiles"]))
    if missing:
        print("[!] 未找到的类: " + ", ".join(missing))
    print("XML " + str(len(files)) + " 个" + ("，已复制到 " + out["copiedTo"] if a.copy_to else "") + ("，汇总 -> " + dst if dst else ""))


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
