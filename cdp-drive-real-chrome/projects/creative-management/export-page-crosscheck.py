"""Ads 页当前页行（ads-page-rows.js 的 cdp 原始输出）vs 导出逐行 CSV（export-parse.py 产出）：按 AdDimensionText 规则算期望 Ad 文字的哈希，看是否出现在导出同 Ad Type 行里。
用法：python -I export-page-crosscheck.py <页面行 raw> <导出 rows.csv> <去标识化输出 json>
导出与页面排序不同（update_time vs Spend），按哈希集合匹配，不按行号；只落 creativeId / 类型 / 哈希 / 是否找到，不落名称原文。"""
import collections, csv, hashlib, json, sys
raw, rows_csv, out = sys.argv[1:4]
page = json.loads(json.load(open(raw, encoding="utf-8"))["result"]["value"])
disp = {"AMAZON_SP": "SP", "AMAZON_SB_VIDEO": "SB - Video", "AMAZON_SD_VIDEO": "SD - Video", "AMAZON_STV": "Streaming TV"}
h = lambda s: hashlib.sha1(s.encode("utf-8")).hexdigest()[:10]
exp_set = collections.defaultdict(collections.Counter)
for x in csv.DictReader(open(rows_csv, encoding="utf-8")):
    exp_set[x["ad_type"]][x["ad_text_sha1"]] += 1
res, miss = [], 0
for i, r in enumerate(page["rows"], 1):
    name = (r["creativeName"] or "").strip() or "Creative"
    has = bool(r["product"] or r["productTitle"])
    text = ((r["productTitle"] or name) + ("\nID: " + r["product"] if r["product"] else "")) if has else name
    t = disp.get(r["adTypeCatalogId"], r["adTypeCatalogId"])
    ok = exp_set[t][h(text)] > 0
    miss += not ok
    res.append({"i": i, "creativeId": r["creativeId"], "ad_type": t, "page_has_product": has, "expected_ad_text_sha1": h(text), "found_in_export_same_type": ok})
json.dump({"page_at": page["at"], "groupBy": page["groupBy"], "rows": res}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
c = collections.Counter((x["ad_type"], x["page_has_product"], x["found_in_export_same_type"]) for x in res)
print("page rows", len(res), "| (type, page_has_product, found) ->", dict(c), "| missing", miss)
