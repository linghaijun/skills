// Creative Hub（L1 页面层）：把仓内一个 Vue 组件（典型：CreativeGenerationDrawer 的官方引用示例 __demo__/*.vue）
// 只在**页面内存**里挂载到当前页面，用来验证「被别的页面引用时」的行为（不改仓库、不加路由）。
//
//   node run-page.mjs creativehub-mount-demo.js \
//     --param DEMO_FS=/@fs/<前端仓绝对路径，正斜杠>/packages/creativehub/components/CreativeGeneration/__demo__/ProfileIdsDemo.vue
//
// 前置：本地 Vite dev（需要 /@fs/ 与 /node_modules/.vite/deps/vue.js 可访问）。
// 返回 { vueUrl, sameVue, demo, hostRect }；sameVue 必须为 true（与页面同一个 Vue 实例，否则 inject / pinia 拿不到）。
// 🔴 这是**页面内存挂载**，属构造入口：证据标「构造（内存挂载）」，结论不能单独支撑「通过」（CP-58118 AC-94 因此被退回过）；
//    用完整页刷新清除（window.__chDemo 置空），按 workflow playbook §4.2 留「已清除」读回。
// 来源：CP-58118 AC-94（2026-10-13，按 Q77 口径用仓内 Demo 挂载）。
(async () => {
  const demoFs = __DEMO_FS__;
  if (window.__chDemo) return "already mounted（整页刷新后再挂）";
  const el = [...document.querySelectorAll("button")].find((b) => b.__vueParentComponent);
  const ctx = el && el.__vueParentComponent.appContext;
  if (!ctx) return { err: "no appContext" };
  const vueUrl = performance.getEntriesByType("resource").map((e) => e.name).find((n) => /\/node_modules\/\.vite\/deps\/vue\.js/.test(n));
  if (!vueUrl) return { err: "no vite vue dep（不是本地 dev？）" };
  const vue = await import(vueUrl);
  const mod = await import(demoFs + (demoFs.includes("?") ? "&" : "?") + "t=" + Date.now());
  const host = document.createElement("div");
  host.id = "ch-demo-host";
  host.style.cssText = "position:fixed;right:24px;top:150px;z-index:1500;background:#fff;border:2px dashed #ff8000;box-shadow:0 2px 12px rgba(0,0,0,.15)";
  document.body.appendChild(host);
  const vnode = vue.h(mod.default);
  vnode.appContext = ctx;
  vue.render(vnode, host);
  window.__chDemo = vnode;
  return { vueUrl, sameVue: ctx.app.version === vue.version, demo: mod.default.__file, hostRect: host.getBoundingClientRect().toJSON() };
})()
