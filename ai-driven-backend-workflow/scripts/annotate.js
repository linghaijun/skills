// 截图标注：红框 + 编号 + 右侧文字说明 + 连线。用法：window.__ann([{el|sel, n, label}], {labelX, title})
window.__ann = function (items, opts) {
  opts = opts || {};
  document.querySelectorAll('.__ann').forEach(e => e.remove());
  const sx = window.scrollX, sy = window.scrollY;
  const W = document.documentElement.scrollWidth, H = document.documentElement.scrollHeight;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', '__ann');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.style.cssText = 'position:absolute;left:0;top:0;z-index:99998;pointer-events:none';
  document.body.appendChild(svg);
  const labelX = opts.labelX || 700;
  let lastY = -1e9;
  const boxes = items.map(it => {
    const el = it.el || document.querySelector(it.sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return Object.assign({}, it, { x: r.left + sx - 4, y: r.top + sy - 4, w: r.width + 8, h: r.height + 8 });
  }).filter(Boolean);
  boxes.forEach(b => {
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', b.x); rect.setAttribute('y', b.y);
    rect.setAttribute('width', b.w); rect.setAttribute('height', b.h);
    rect.setAttribute('rx', 6); rect.setAttribute('fill', 'rgba(220,38,38,0.06)');
    rect.setAttribute('stroke', '#dc2626'); rect.setAttribute('stroke-width', 2.5);
    svg.appendChild(rect);
    // 编号圆点
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', b.x); c.setAttribute('cy', b.y); c.setAttribute('r', 12);
    c.setAttribute('fill', '#dc2626'); svg.appendChild(c);
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', b.x); t.setAttribute('y', b.y + 5); t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', 14); t.setAttribute('font-weight', 700); t.setAttribute('fill', '#fff');
    t.setAttribute('font-family', 'Segoe UI, Microsoft YaHei, sans-serif');
    t.textContent = b.n; svg.appendChild(t);
    // 说明框（右侧，按纵向避让）
    let ly = Math.max(b.y, lastY + 8);
    const div = document.createElement('div');
    div.className = '__ann';
    div.style.cssText = `position:absolute;left:${labelX}px;top:${ly}px;width:${opts.labelW || 360}px;z-index:99999;` +
      'background:#fff;border:2px solid #dc2626;border-radius:8px;padding:6px 10px;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;color:#1f2328;box-shadow:0 2px 8px rgba(0,0,0,.12)';
    const acs = (opts.acs && opts.acs[b.n]) || [];
    div.innerHTML = `<b style="color:#dc2626">${b.n}</b> ${b.label}` +
      (acs.length ? `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed #fca5a5;color:#1d4ed8;font-weight:600">对应 AC：${acs.join('、')}</div>` : '');
    document.body.appendChild(div);
    const lh = div.getBoundingClientRect().height;
    lastY = ly + lh;
    const line = document.createElementNS(svgNS, 'path');
    const lw = opts.labelW || 360, leftSide = labelX + lw < b.x;
    const x1 = leftSide ? b.x : b.x + b.w, y1 = b.y + Math.min(b.h / 2, 20), x2 = leftSide ? labelX + lw : labelX, y2 = ly + 14;
    const k = leftSide ? -30 : 30; line.setAttribute('d', `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`);
    line.setAttribute('stroke', '#dc2626'); line.setAttribute('stroke-width', 1.5);
    line.setAttribute('fill', 'none'); line.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(line);
  });
  if (opts.title) {
    const tt = document.createElement('div');
    tt.className = '__ann';
    const top = (opts.titleY != null ? opts.titleY : Math.min(...boxes.map(b => b.y)) - (opts.note ? 96 : 52));
    tt.style.cssText = `position:absolute;left:${opts.titleX || labelX}px;top:${top}px;z-index:99999;background:#dc2626;color:#fff;` +
      'font:600 15px/1.4 "Segoe UI","Microsoft YaHei",sans-serif;padding:6px 12px;border-radius:8px;box-sizing:border-box;max-width:' + (opts.labelW || 360) + 'px';
    tt.innerHTML = opts.title + (opts.note ? `<div style="font-weight:400;font-size:12.5px;margin-top:2px">${opts.note}</div>` : '');
    document.body.appendChild(tt);
  }
  const tops = boxes.map(b => b.y).concat([...document.querySelectorAll('div.__ann')].map(d => d.getBoundingClientRect().top + sy));
  const bots = boxes.map(b => b.y + b.h).concat([...document.querySelectorAll('div.__ann')].map(d => d.getBoundingClientRect().bottom + sy));
  return { boxes: boxes.map(b => [b.n, Math.round(b.y)]), top: Math.max(0, Math.min(...tops) - 24), bottom: Math.max(...bots) + 24 };
};
