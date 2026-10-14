"""生成离线回归用的 fixture（xlsx / csv / json，4145 行），供 tests/run-verify-export.mjs 对拍。

用法：python gen_fixtures.py <输出目录>
为什么跑时生成而不是把文件放进 skill：xlsx 是 100KB 二进制，放进 skill 会跟着分发到所有 agent 目录；
另外这也是「export-lib 能解真实 openpyxl 产物」的交叉验证（两边各自独立实现）。
"""
import csv, json, sys
from openpyxl import Workbook

out = sys.argv[1]
rows = 4145
wb = Workbook(); ws = wb.active; ws.title = "Creative"
ws.append(["Ad", "Ad Type", "Creative", "Spend"])
for i in range(rows):
    ws.append([f"Ad {i+1} (ID: {600000+i})", "SP" if i % 2 == 0 else "SB", "Creative" if i % 3 == 0 else "", 12.5 + i])
wb.save(out + "/export.xlsx")

with open(out + "/export.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f); w.writerow(["Ad", "Ad Type", "Creative", "Spend"])
    for i in range(rows):
        w.writerow([f"Ad {i+1} (ID: {600000+i})", "SP" if i % 2 == 0 else "SB", "Creative" if i % 3 == 0 else "", 12.5 + i])

json.dump([{"Ad": f"Ad {i+1}", "Ad Type": "SP", "Spend": i} for i in range(5)],
          open(out + "/export.json", "w", encoding="utf-8"))
print("fixtures written to", out)
