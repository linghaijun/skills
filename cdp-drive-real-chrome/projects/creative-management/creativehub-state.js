// Creative Hub（L1）：读 window.__u2i 摘要（Ad Type / Result type / Style Type / PD / Selling Point / Optimize 任务态 / Prompt 模型与编辑器文本 / 参考图 / canGenerate …）。先跑 creativehub-find.js。来源 CP-58118 g2。
(() => {
  const s = window.__u2i;
  if (!s) return { err: "no __u2i, run creativehub-find.js" };
  const un = (v) => (v && typeof v === "object" && "value" in v && !Array.isArray(v) ? v.value : v);
  const a = s.assist;
  const t = un(a.tab);
  const fd = un(s.formData);
  const ed = document.querySelector(".prompt-editor");
  const gen = document.querySelector(".generate-btn");
  return {
    sourceType: un(s.sourceType),
    adType: fd.adTypeNode ? `${fd.adTypeNode.productLine}|${fd.adTypeNode.adType}|${fd.adTypeNode.name || ""}` : null,
    resultType: fd.resultType,
    isOthers: un(s.isOthersSelected),
    styleType: un(a.styleType),
    pd: t.pd,
    pdTask: { ...t.pdTask },
    hookTask: { ...t.hookTask },
    optimizeTask: { ...t.optimizeTask },
    selection: { ...t.selection },
    hooks: (t.hookResult?.sellingPoints || []).map((sp) => sp.sellingPointName),
    caps: t.hookResult?.capabilities || null,
    promptModel: fd.prompt,
    promptLen: (fd.prompt || "").length,
    editorText: ed ? ed.innerText : null,
    editorEditable: ed ? ed.getAttribute("contenteditable") : null,
    refs: (fd.referenceImagePaths || []).map((r) => r?.name || r?.path),
    canOptimize: un(a.canOptimize),
    optimizeTip: un(a.optimizeTip),
    aiBusy: un(a.aiBusy),
    canGenerate: un(s.canGenerate),
    generateDisabledTip: un(s.generateDisabledTip),
    genBtnDisabled: gen ? gen.disabled || gen.classList.contains("is-disabled") : null,
    testMode: un(s.testModeOn),
    selectedProduct: un(s.selectedProduct)?.asin || null,
    selectedProductImgUrl: un(s.selectedProduct)?.imgUrl || null
  };
})()
