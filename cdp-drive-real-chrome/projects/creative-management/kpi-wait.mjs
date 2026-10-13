// 等 KPI 卡片出数（Impressions 不再是 0）且无 loading
import { connect } from "../../scripts/conn.mjs"; const c = await connect(); let v;
for (let i=0;i<45;i++){ v = await c.ev(`(()=>{const e=[...document.querySelectorAll('[class*=card]')].find(e=>e.getBoundingClientRect().width>0 && /^Impressions\\s/.test(e.innerText.trim())); return e? e.innerText.replace(/\\s+/g,' ').trim():null})()`); if (v && !/ 0$/.test(v)) break; await c.sleep(1000);} console.log("kpi", v); c.close();
