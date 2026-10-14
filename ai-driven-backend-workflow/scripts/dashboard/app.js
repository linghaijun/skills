/* 验证进度看板前端（scripts/dashboard/app.js）。
 * 服务模式：GET / 外壳页内联「需求摘要列表」；详情按需 /api/req/<目录>?rev=；每 5s 只发 1 个请求，页面不可见时暂停。
 * 静态模式（file:// 或生成产物）：数据全部内联在 #payload，不发请求。
 */
'use strict';
const PAYLOAD=JSON.parse(document.getElementById('payload').textContent||'{}');
const BASE=PAYLOAD.base||'';
const SERVE=PAYLOAD.mode==='serve';
const IS_INDEX=!!PAYLOAD.is_index;
const SINGLE=PAYLOAD.single||null;
const HTTP=location.protocol.startsWith('http');
const POLL_MS=Math.max(2000,parseInt(new URLSearchParams(location.search).get('interval')||'5000',10)||5000);
const TTL_MIN=20;
const ROWS_STEP=150, THUMB_LIMIT=60;
let LIST=PAYLOAD.list||{rev:'',reqs:[],archived:[],errors:[]};
const DETAIL={};Object.keys(PAYLOAD.detail||{}).forEach(k=>{DETAIL[k]=PAYLOAD.detail[k];});
const EVC={}, EVG={}, LOADING={};

const STATUS_ORDER=["待验证","验证中","修复中","通过","失败","阻塞","部分","走读证据","跳过"];
const ST_CLS={"待验证":"b-pend","验证中":"b-run","修复中":"b-fix","通过":"b-pass","失败":"b-fail","阻塞":"b-blk","部分":"b-part","走读证据":"b-ro","跳过":"b-skip"};
const FC_ORDER=["未终验","终验中","终验通过","终验不通过","豁免"];
const FC_CLS={"未终验":"b-unk","终验中":"b-run","终验通过":"b-pass","终验不通过":"b-fail","豁免":"b-ro"};
const HO_CLS={"未进入":"b-ho-none","待匹配":"b-ho-pend","已匹配待确认":"b-ho-wait","待提测":"b-ho-wait","未匹配":"b-ho-none","待补记":"b-ho-wait","已提测":"b-ho-ok","无需提测":"b-ho-skip","提测失败":"b-fail"};
const FINISHED=["通过","失败","阻塞","部分","走读证据","跳过"];
const DECIDED5=["通过","失败","阻塞","部分","走读证据"];
const REGR_V={pass:["通过","b-pass"],partial:["部分","b-fix"],not_run:["未跑","b-skip"],waived:["豁免","b-ro"],unknown:["无结论","b-unk"]};
const CK_LABEL={done:"Checklist done",open:"Checklist open",blocked:"blocked",waived:"waived（放行）"};
const HATCH="repeating-linear-gradient(45deg,var(--skip) 0 2px,transparent 2px 4px)";
const COL={"待验证":"var(--pend)","验证中":"var(--run-s)","修复中":"var(--fix-s)","通过":"var(--pass-s)","失败":"var(--fail-s)","阻塞":"var(--blk-s)","部分":"var(--part-s)","走读证据":"var(--ro)","跳过":HATCH};
const TABS=[["overview","总览"],["qa","需求问答"],["cases","用例明细"],["evidence","证据"],["regression","回归"],["timeline","时间线"],["guide","说明"]];
const TAB_KEYS=TABS.map(t=>t[0]);

// ---------------------------------------------------------------- 本地记忆（失败不影响功能）
function lsGet(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
const savedF=lsGet('vd_filters',{})||{};
const state={view:(SINGLE?'one':'all'),folder:SINGLE,tab:'overview',arch:false,
 filter:{status:new Set(savedF.status||[]),fc:new Set(savedF.fc||[]),risk:!!savedF.risk,ev:!!savedF.ev,q:''},
 eq:'',rv:new Set(),open:new Set(),openR:new Set(),evOpen:new Set(),evShowAll:new Set(),evGroupOpen:new Set(),
 sort:lsGet('vd_sort',{key:null,dir:1})||{key:null,dir:1},rowsShown:ROWS_STEP,
 lf:Object.assign({sprint:'',st:'',q:''},lsGet('vd_listf',{})||{},{q:''}),
 conn:SERVE?'init':(HTTP?'static-http':'file'),fail:0,api:SERVE?true:(HTTP?false:null),
 qaEdit:null,qaMsg:'',qaConflict:false,needList:false,stepOpen:null,focusAc:null,seenChg:undefined,
 moreOpen:!!lsGet('vd_more',false),lowOpen:false,keyHelp:false,registry:{}};
function saveFilters(){lsSet('vd_filters',{status:[...state.filter.status],fc:[...state.filter.fc],risk:state.filter.risk,ev:state.filter.ev});}

// ---------------------------------------------------------------- 小工具
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function evUrl(rel){return BASE+String(rel).split('/').map(encodeURIComponent).join('/');}
function pct(x){return x==null?"—":(x*100).toFixed(0)+"%";}
function badge(s){return '<span class="badge '+(ST_CLS[s]||"b-unk")+'">'+esc(s)+'</span>';}
// 终验通过 = 「证据支撑结论」，不等于 AC 通过：阻塞 / 失败 / 部分 的终验通过要把结论带出来
function fbadge(s,st){s=s||"未终验";
 if(s==="终验通过"&&st&&st!=="通过")return '<span class="badge b-hold" title="证据支撑「'+esc(st)+'」这一结论，不代表 AC 通过">'+esc(st)+'成立</span>';
 return '<span class="badge '+(FC_CLS[s]||"b-unk")+'">'+esc(s)+'</span>';}
function hbadge(s){s=s||"未进入";return '<span class="badge '+(HO_CLS[s]||"b-ho-none")+'">'+esc(s)+'</span>';}
function prio(p){return p?'<span class="prio '+esc(p)+'">'+esc(p)+'</span>':'<span class="muted">—</span>';}
function dur(s){s=Math.max(0,Math.round(s));if(s<60)return s+"s";const m=Math.floor(s/60);
 if(m<60)return m+"m"+(s%60?(s%60)+"s":"");const h=Math.floor(m/60);return h+"h"+(m%60)+"m";}
function pd(n){return String(n).padStart(2,'0');}
function ts(x){if(!x)return"—";const d=new Date(x);if(isNaN(d))return esc(x);return d.getFullYear()+"-"+pd(d.getMonth()+1)+"-"+pd(d.getDate())+" "+pd(d.getHours())+":"+pd(d.getMinutes());}
function tsShort(x){if(!x)return"—";const d=new Date(x);if(isNaN(d))return esc(x);return pd(d.getMonth()+1)+"-"+pd(d.getDate())+" "+pd(d.getHours())+":"+pd(d.getMinutes());}
function ago(x){if(!x)return"";const d=new Date(x);if(isNaN(d))return"";const s=(Date.now()-d)/1000;
 return s<60?"刚刚":s<3600?Math.round(s/60)+" 分钟前":s<86400?Math.round(s/3600)+" 小时前":Math.round(s/86400)+" 天前";}
function normAc(t){const m=/(\d{1,3})/.exec(t||'');return m?'AC-'+String(+m[1]).padStart(2,'0'):String(t||'').toUpperCase();}
function humanSize(n){n=+n||0;const u=["B","KB","MB","GB"];let i=0;while(n>=1024&&i<3){n/=1024;i++;}return (i?n.toFixed(1):n)+u[i];}
function baseName(p){return String(p).split('/').pop();}
function frac(a,b){return a+'<span class="den">/'+b+'</span>';}
function sn(n,tone){return '<span class="statn '+(tone||'')+'">'+n+'</span>';}
function curSnap(){const d=DETAIL[state.folder];return d&&d.snap;}
function curSum(){return (LIST.reqs||[]).find(r=>r.folder===state.folder);}
function canAdmin(){return SERVE&&state.api===true;}
function stale(x){const u=x?new Date(x):null;return !u||isNaN(u)||(Date.now()-u)/60000>TTL_MIN;}

// ---------------------------------------------------------------- 指标 / 风险（与 Python ui_risks 同口径）
function metrics(req){const cs=req.acs||[];const total=cs.length;const cnt={};STATUS_ORDER.forEach(s=>cnt[s]=0);
 const ck={open:0,done:0,blocked:0,waived:0,none:0};let ev=0,med=0;
 cs.forEach(a=>{cnt[a.status]!==undefined?cnt[a.status]++:cnt["待验证"]++;ck[a.ck||"none"]=(ck[a.ck||"none"]||0)+1;ev+=a.ev_n||0;med+=a.ev_media||0;});
 const decided=cnt["通过"]+cnt["失败"]+cnt["阻塞"]+cnt["部分"];
 const fc={};FC_ORDER.forEach(s=>fc[s]=0);let fcBase=0;
 cs.forEach(a=>{const s=a.final_status||"未终验";fc[s]!==undefined?fc[s]++:fc["未终验"]++;if(FINISHED.includes(a.status))fcBase++;});
 const impl=total?ck.done/total:0, coverage=total?(total-cnt["待验证"])/total:0;
 const passRate=decided?cnt["通过"]/decided:null;
 const regs=req.regressions||[];const rd=regs.filter(r=>r.ok).length;const rr=regs.length?rd/regs.length:null;
 const stepsOk=(req.step_spec||[]).filter(([n])=>((req.steps||{})[String(n)]||{}).passed).length;
 const progress=0.5*impl+0.3*(passRate||0)+0.2*(rr||0);
 let work=0,wall=null,inflight=0;const start=[],finish=[];
 cs.forEach(a=>{const s=a.started_at?new Date(a.started_at):null,e=a.finished_at?new Date(a.finished_at):(a.updated_at?new Date(a.updated_at):null);
  if(s&&!isNaN(s))start.push(s);if(a.finished_at&&!isNaN(new Date(a.finished_at)))finish.push(new Date(a.finished_at));
  if(s&&e&&!isNaN(s)&&!isNaN(e))work+=Math.max(0,(e-s)/1000);
  if((a.status==="验证中"||a.status==="修复中")&&s&&!isNaN(s))inflight=Math.max(inflight,(Date.now()-s)/1000);});
 if(start.length&&finish.length)wall=(Math.max(...finish)-Math.min(...start))/1000;
 return {total,cnt,ck,impl,coverage,passRate,regs,rd,rr,stepsOk,progress,ev,med,work,wall,inflight,fc,fcBase};}
function risks(req){const out=[];
 (req.acs||[]).forEach(a=>{const st=a.status;
  if(st==="失败"||st==="阻塞")out.push({l:"high",ac:a.token,t:"验证"+st+"："+(a.note||"见 RESULT.md")});
  if((st==="验证中"||st==="修复中")&&stale(a.updated_at))out.push({l:"high",ac:a.token,t:"「"+st+"」超过 "+TTL_MIN+" 分钟无更新（可能已中断），可 reclaim"});
  if(st==="通过"&&a.ck==="open")out.push({l:"medium",ac:a.token,r:"registry 已通过但 Checklist 未回写 [done]",t:"registry 已「通过」但 Checklist 仍 [open]（回写漏了）"});
  if(a.ck==="done"&&(st==="失败"||st==="阻塞"))out.push({l:"medium",ac:a.token,r:"Checklist 已 [done] 但 registry 结论相反",t:"Checklist 已 [done] 但 registry 是「"+st+"」"});
  if(st==="通过"&&a.has_dir&&!a.ev_n)out.push({l:"medium",ac:a.token,r:"已判定但 evidence/ 为空",t:"判「通过」但 evidence/ 为空（未留证=未测）"});
  if(a.has_dir&&!(a.has_replay||a.has_script))out.push({l:"low",ac:a.token,r:"缺复跑入口（REPLAY.md 或 script/）",t:"缺复跑入口（REPLAY.md 或 script/）"});
  if(a.final_status==="终验不通过")out.push({l:"high",ac:a.token,t:"证据终验不通过："+(a.final_note||"证据不支撑结论")});
  if(a.final_status==="终验中"&&stale(a.final_at))out.push({l:"low",ac:a.token,t:"「终验中」超过 "+TTL_MIN+" 分钟无更新（可能已中断），可重新 final"});
  if(FINISHED.includes(a.status)&&(a.final_status||"未终验")==="未终验")out.push({l:"low",ac:a.token,r:"已完结但未终验",t:"已完结但未终验（终验只核对证据内容，不用重跑浏览器）"});});
 const acs=req.acs||[];
 if(!acs.some(x=>x.has_dir)&&acs.some(x=>DECIDED5.includes(x.status)))out.push({l:"medium",ac:null,t:"该需求没有 tests/AC-NN 证据目录（旧式产出：结论来自 Step 1x 报告，未按 AC 归档证据）"});
 (req.regressions||[]).forEach(r=>{if(!r.ok)out.push({l:"medium",ac:r.token,t:"回归项无结论（未验证的 R-NN 与未实现 AC 同等对待）"});});
 (req.step_spec||[]).forEach(([n,t])=>{const i=(req.steps||{})[String(n)]||{};
  if((i.consecutive_fails||0)>2)out.push({l:"high",ac:null,t:"Step"+n+"（"+t+"）连续失败 "+i.consecutive_fails+" 次 —— 须停手问人"});});
 const G={},F=[];out.forEach(x=>{(x.r&&x.ac)?(G[x.r]=G[x.r]||[]).push(x):F.push(x);});
 Object.keys(G).forEach(k=>{const its=G[k];if(its.length<=5)F.push.apply(F,its);
  else F.push({l:its[0].l,ac:null,acs:its.map(i=>i.ac),t:its.length+" 条「"+k+"」："+its.slice(0,8).map(i=>i.ac).join(", ")+(its.length>8?" …":"")});});
 const rank={high:0,medium:1,low:2};F.sort((a,b)=>rank[a.l]-rank[b.l]);
 return F;}
function bar(items){const total=items.reduce((s,i)=>s+i[1],0)||1;
 return '<div class="bar">'+items.filter(i=>i[1]>0).map(i=>'<i style="width:'+(i[1]/total*100)+'%;background:'+i[2]+'" title="'+esc(i[0])+' '+i[1]+'"></i>').join('')+'</div>';}
function legend(items){return '<div class="legend">'+items.filter(i=>i[1]>0).map(i=>'<span><i style="background:'+i[2]+'"></i>'+esc(i[0])+' <b class="ln">'+i[1]+'</b></span>').join('')+'</div>';}
function card(k,v,s,tone){return '<div class="card'+(tone?' '+tone:'')+'"><div class="k">'+esc(k)+'</div><div class="v">'+v+'</div><div class="s">'+esc(s||"")+'</div></div>';}
function alarmIf(n){return n>0?'alarm':'';}

// ---------------------------------------------------------------- 网络
async function getJSON(url,ms){const ac=new AbortController();const to=setTimeout(()=>ac.abort(),ms||10000);
 try{const r=await fetch(url,{cache:'no-store',signal:ac.signal});const ct=r.headers.get('content-type')||'';
  if(!ct.includes('json'))throw new Error('HTTP '+r.status);const j=await r.json();
  if(!r.ok||j.ok===false){const e=new Error(j.error||('HTTP '+r.status));e.status=r.status;e.body=j;throw e;}
  // 已打开的页面只轮询数据、不会重新加载 JS / CSS：服务端前端资源版本变了就自动刷新一次
  if(j.ui&&UI_VER&&j.ui!==UI_VER&&!UI_RELOADING){UI_RELOADING=true;location.reload();}
  return j;}
 finally{clearTimeout(to);}}
async function postJSON(path,body){const r=await fetch(BASE+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
 let j={};try{j=await r.json();}catch(e){}
 if(!r.ok||!j.ok){const e=new Error(j.error||('HTTP '+r.status));e.status=r.status;e.body=j;throw e;}return j;}
// 页面自身加载的前端资源版本（/__dash/app.js?v=…）；静态 file:// 产物没有，跳过自动刷新
const UI_VER=((document.querySelector('script[src*="/__dash/app.js"]')||{}).src||'').split('v=')[1]||'';let UI_RELOADING=false;
async function fetchList(){const j=await getJSON(BASE+'api/list?rev='+encodeURIComponent(LIST.rev||''));
 state.needList=false;if(j.unchanged)return false;LIST=j;return true;}
async function fetchDetail(folder){const d=DETAIL[folder];
 const j=await getJSON(BASE+'api/req/'+encodeURIComponent(folder)+'?rev='+encodeURIComponent(d?d.rev:''));
 if(j.list_rev&&j.list_rev!==LIST.rev)state.needList=true;
 if(j.unchanged)return false;
 DETAIL[folder]={rev:j.rev,snap:j.snap};
 if(j.summary){const i=(LIST.reqs||[]).findIndex(r=>r.folder===folder);if(i>=0)LIST.reqs[i]=j.summary;}
 return true;}
let inFlight=false;
async function tick(manual){
 if(!SERVE){if(HTTP&&state.view==='one')await pollRegistry(manual);return;}
 if(inFlight)return;if(document.hidden&&!manual)return;  // 页面不可见：暂停轮询
 if(state.view==='one'&&state.folder&&!DETAIL[state.folder]&&!state.needList)return;  // 首次加载由 render() 负责，避免重复请求
 inFlight=true;let changed=false;
 try{
  if(state.view==='all'||!state.folder||state.needList)changed=await fetchList();
  else changed=await fetchDetail(state.folder);
  state.fail=0;state.conn='live';
 }catch(e){state.fail++;state.conn='down';state.connErr=e.message||String(e);}
 finally{inFlight=false;}
 checkPmNotify();setConn();
 if(changed||manual||state.fail===1||state.fail===2){if(state.qaEdit&&!manual)return;render();}}
// 普通静态 http 服务（没有 /api）：只轮询当前需求的 registry 合并状态（旧行为的兜底）
async function pollRegistry(manual){const s=curSnap();if(!s||!s.registry_rel)return;
 try{const r=await fetch(BASE+s.registry_rel+'?t='+Date.now(),{cache:'no-store'});
  if(r.status===404){state.conn='static-http';return;}if(!r.ok)throw new Error('HTTP '+r.status);
  const reg=await r.json();const sig=JSON.stringify(reg.cases||{});
  state.fail=0;state.conn='static-live';
  if(sig!==state.registry[s.folder]||manual){state.registry[s.folder]=sig;mergeRegistry(s,reg);render();}}
 catch(e){state.fail++;state.conn='down';state.connErr=e.message;}
 setConn();}
function mergeRegistry(s,reg){const cases=reg.cases||{};const by={};Object.keys(cases).forEach(k=>{by[normAc(k)]=cases[k];});
 (s.acs||[]).forEach(a=>{const c=by[a.token];if(!c)return;
  ["status","session","window","engine","started_at","finished_at","updated_at","final_by","final_at"].forEach(k=>{if(c[k]!==undefined)a[k]=c[k];});
  if(c.note)a.note=c.note;if(c.final_status)a.final_status=c.final_status;if(c.final_note)a.final_note=c.final_note;});}

// ---------------------------------------------------------------- 顶栏：连接状态 与 数据变化时间 分开显示
function setConn(){const c=document.getElementById('conn'),d=document.getElementById('dot'),t=document.getElementById('connTxt');if(!c)return;
 let cls='',dc='idle',txt='';
 if(state.conn==='live'){cls='live';dc='live';txt='实时 · 每 '+Math.round(POLL_MS/1000)+'s';}
 else if(state.conn==='down'){cls='down';dc='down';txt='离线 · 连续 '+state.fail+' 次失败';}
 else if(state.conn==='init'){dc='idle';txt='连接中…';}
 else if(state.conn==='static-live'){cls='live';dc='live';txt='状态轮询（静态服务）';}
 else if(state.conn==='static-http'){cls='snap';dc='warn';txt='快照（静态服务）';}
 else {cls='snap';dc='warn';txt='快照（file://）';}
 if(document.hidden&&SERVE&&state.conn==='live')txt='已暂停（页面不可见）';
 c.className='conn '+cls;d.className='dot '+dc;t.textContent=txt;
 c.title=state.conn==='down'?('拉取失败：'+(state.connErr||'')):'连接状态';
 const dt=document.getElementById('dataTime');if(!dt)return;
 let last='';if(state.view==='one'){const s=curSum();last=s&&s.last_change;}
 else (LIST.reqs||[]).forEach(r=>{if(r.last_change&&(!last||r.last_change>last))last=r.last_change;});
 if(!SERVE&&!last)last=PAYLOAD.generated_at;
 dt.textContent=last?((SERVE?'数据更新 ':'快照生成 ')+(SERVE?ago(last):ts(PAYLOAD.generated_at))):'';
 dt.title=last?((SERVE?'需求目录里文件的最后修改时间：':'生成时间：')+ts(SERVE?last:PAYLOAD.generated_at)):'';}

// ---------------------------------------------------------------- 主题：跟随系统 / 浅色 / 深色
const THEME_LABEL={auto:'跟随系统',light:'浅色',dark:'深色'};
function themeGet(){const t=lsGet('vd_theme_v',null);return t==='light'||t==='dark'?t:'auto';}
function themeApply(t){const r=document.documentElement;if(t==='auto')r.removeAttribute('data-theme');else r.setAttribute('data-theme',t);
 try{if(t==='auto')localStorage.removeItem('vd_theme');else localStorage.setItem('vd_theme',t);}catch(e){}
 lsSet('vd_theme_v',t);const b=document.getElementById('theme');if(b){b.textContent='主题：'+THEME_LABEL[t];}}

// ---------------------------------------------------------------- 渲染入口
function render(){const app=document.getElementById('app');
 const ae=document.activeElement,fid=ae&&ae.id,sel=fid&&ae.selectionStart!=null?[ae.selectionStart,ae.selectionEnd]:null;
 let h=topBanners();
 if(state.view==='all'&&!SINGLE){h+=renderAll();}
 else{const snap=curSnap();
  if(!snap){const s=curSum();
   h+=(s&&s.error)?'<div class="banner err"><b>该需求构建失败</b>：'+esc(s.error)+'</div>':'<div class="panel muted">加载中…</div>';
   if(SERVE&&state.folder&&!LOADING['d:'+state.folder]){LOADING['d:'+state.folder]=1;
    fetchDetail(state.folder).then(()=>{delete LOADING['d:'+state.folder];render();}).catch(e=>{LOADING['d:'+state.folder]=0;state.conn='down';state.connErr=e.message;setConn();
     app.innerHTML=topBanners()+'<div class="banner err"><b>加载失败</b>：'+esc(e.message)+'</div>';});}
  }else h+=renderOne(snap);}
 app.innerHTML=h;
 syncSwitcher();setConn();
 if(fid){const el=document.getElementById(fid);if(el&&el!==document.activeElement){el.focus();if(sel&&el.setSelectionRange)try{el.setSelectionRange(sel[0],sel[1]);}catch(e){}}}
 const pend=new Set();(LIST.reqs||[]).forEach(r=>(r.pm_changes||[]).forEach(c=>pend.add(c.qid+'@'+r.folder)));
 document.title=(pend.size?'('+pend.size+') ':'')+BASE_TITLE;}
const BASE_TITLE=document.title;
function topBanners(){let h='';
 if(!HTTP)h+='<div class="banner warn">以 <b>file://</b> 打开：显示生成时快照（'+ts(PAYLOAD.generated_at)+'），<b>不会实时刷新</b>，文本类证据也无法内联预览。实时看板：<a href="http://127.0.0.1:8787/">http://127.0.0.1:8787/</a>（或 <code>python scripts/verify_dashboard.py --all --develop "'+esc(PAYLOAD.develop||'')+'" --serve</code>）。</div>';
 else if(!SERVE&&state.conn==='static-http')h+='<div class="banner warn">当前是普通静态服务：显示生成时快照（'+ts(PAYLOAD.generated_at)+'）；保存 / 归档不可用。用 <code>verify_dashboard.py --serve</code> 打开可实时刷新。</div>';
 const errs=LIST.errors||[];
 if(errs.length)h+='<div class="banner err"><b>'+errs.length+' 个需求构建失败</b>（看板没有显示它们的最新数据；详见 docs/develop/tools/dashboard.log）<ul>'+
  errs.map(e=>'<li><b class="mono">'+esc(e.folder)+'</b>：'+esc(e.msg)+'</li>').join('')+'</ul></div>';
 if(SERVE&&state.fail>=2)h+='<div class="banner err"><b>连续 '+state.fail+' 次拉取失败</b>，显示的数据可能已过期（'+esc(state.connErr||'')+'）。<button onclick="tick(true)">重试</button></div>';
 const qerr=[];(state.view==='one'?[curSnap()].filter(Boolean):[]).forEach(s=>((s.qa||{}).errors||[]).forEach(e=>qerr.push(e)));
 if(state.view==='all')(LIST.reqs||[]).forEach(r=>{if(r.qa_errors)qerr.push((r.id||r.folder)+'：问答改动 / 分享数据文件损坏（进入该需求「需求问答」查看）');});
 if(qerr.length)h+='<div class="banner err"><b>问答数据文件损坏</b><ul>'+qerr.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul></div>';
 return h;}
function syncSwitcher(){const sw=document.getElementById('switcher');if(!sw)return;
 const reqs=LIST.reqs||[];
 if(SINGLE||reqs.length<1){sw.innerHTML='';return;}
 const key=reqs.map(r=>r.folder).join('|');
 if(sw.dataset.key!==key){sw.dataset.key=key;
  sw.innerHTML='<select id="rsel" title="切换需求"><option value="">— 全部需求总览 —</option>'+reqs.map(r=>'<option value="'+esc(r.folder)+'" title="'+esc((r.id?r.id+' · ':'')+r.name)+'">'+esc((r.id?r.id+' · ':'')+r.name)+'</option>').join('')+'</select>';
  document.getElementById('rsel').onchange=e=>{const v=e.target.value;if(v)go(v,'overview');else back();};}
 const rs=document.getElementById('rsel');if(rs){const v=state.view==='one'?state.folder:'';if(rs.value!==v)rs.value=v;rs.title=rs.options[rs.selectedIndex]?rs.options[rs.selectedIndex].title:'';}}

// ---------------------------------------------------------------- 全部需求总览
// 首页三栏泳道：轮到我 > 等别人 > 快收尾，一个需求只进第一个命中的栏；其它命中事项作为徽章保留在卡片上
const LANES=[["mine","轮到我","失败待修、看板改动待确认、验证中、待验证、待终验、流程下一步"],["others","等别人","待 PM 确认、阻塞（缺账号 / 环境 / 外部依赖）、待确认提测"],["done","快收尾","开发与验证都完成：待提测匹配、已提测 / 可归档"]];
const SPRINT_ALL='__all';
function hoSt(r){return (r.handover||{}).status||'未进入';}
// 分栏口径（开发视角）：「轮到我」= 只有我能推进的活；「等别人」= 我动不了的；最后一步（AC↔Subtask 提测）是交接动作，归「快收尾」
function lastStep(r){return r.workflow==='backend'?13:14;}
function laneHits(r){const c=r.cnt||{},fc=r.fc||{},pc=(r.pm_changes||[]).length,ns=r.next_step;const m=[],o=[];
 const handoverOnly=ns&&ns.n>=lastStep(r);
 if(r.error)m.push({k:'err',t:'解析失败：'+r.error,cls:'fail'});
 if((c["失败"]||0)>0)m.push({k:'fail',t:c["失败"]+' 条失败待修',cls:'fail'});
 if(pc)m.push({k:'chg',t:'看板改动 '+pc+' 条待确认',cls:'pm',tip:(r.pm_changes||[]).map(x=>(x.qid||'')+' '+(x.title||'')).join('\n')});
 if(r.busy>0)m.push({k:'busy',t:r.busy+' 条验证中 / 修复中',cls:'flow'});
 if((c["待验证"]||0)>0)m.push({k:'todo',t:c["待验证"]+' 条待验证',cls:'flow'});
 // 能终验的只有已通过 / 走读证据 / 跳过的 AC：阻塞、失败、部分、待验证、验证中的不算（与详情页待办「未终验」组口径一致）
 const fcReady=Math.max(0,(fc["未终验"]||0)-["阻塞","失败","部分","待验证","验证中","修复中"].reduce((n,k)=>n+(c[k]||0),0));
 if(fcReady>0)m.push({k:'fc',t:'终验 '+(fc["终验通过"]||0)+'/'+(r.fc_base||0)+'（'+fcReady+' 条可终验）',cls:'final'});
 if(ns&&!handoverOnly&&!(r.qa_pm>0)){const g=ns.gaps||[];m.push({k:'step',t:'下一步 Step'+ns.n+' '+ns.name,cls:'flow',
  sub:ns.inferred?'按产出文件推断':(g.length?'Step '+g.join('/')+' 未记录':''),
  tip:ns.inferred?'没有 .workflow-state.json，按顶层 Step 文件推断已到哪一步':(g.length?'.workflow-state.json 里 Step '+g.join(' / ')+' 没有通过记录（后续步骤已通过）':'')});}
 if(r.qa_pm>0)o.push({k:'qa',t:'待 PM 确认 '+r.qa_pm+' 题'+(ns?'（卡在 Step'+ns.n+' 前）':''),cls:'pm'});
 if((c["阻塞"]||0)>0)o.push({k:'blk',t:c["阻塞"]+' 条阻塞（等账号 / 环境 / 外部依赖）',cls:'blk'});
 if(hoSt(r)==='已匹配待确认')o.push({k:'ho',t:'待确认提测',cls:'final'});
 return {m,o,handoverOnly};}
function laneOf(r){const h=laneHits(r);
 if(h.m.length)return {lane:'mine',main:h.m[0]};
 if(h.o.length)return {lane:'others',main:h.o[0]};
 const ho=hoSt(r);
 if(h.handoverOnly&&ho!=='已提测'&&ho!=='无需提测')return {lane:'done',main:{k:'ho',t:'待提测：Step'+lastStep(r)+' AC↔Subtask 匹配',cls:'final'}};
 return {lane:'done',main:{k:'done',t:ho==='已提测'?'已提测，可归档':ho==='无需提测'?'无需提测，可归档':'可归档',cls:'done'}};}
function laneScore(r){const c=r.cnt||{};return [c["失败"]||0,(c["阻塞"]||0)+(r.qa_pm||0)+(r.pm_changes||[]).length+(r.busy||0)];}
function stItem(label,n,tone,act,tip){const on=n>0;
 return '<span class="si'+(on&&tone?' on '+tone:'')+(act&&on?' click':'')+'"'+(act&&on?' onclick="'+act+'" role="button" tabindex="0"':'')+(tip?' title="'+esc(tip)+'"':'')+'><b>'+n+'</b>'+esc(label)+'</span>';}
function curSprint(sprints){const v=state.lf.sprint;if(v===SPRINT_ALL)return SPRINT_ALL;return v&&sprints.includes(v)?v:(sprints[0]||SPRINT_ALL);}
function renderAll(){if(state.arch)return renderArchived();
 const all=(LIST.reqs||[]).slice();const lf=state.lf;
 const sprints=[...new Set(all.map(r=>r.sprint).filter(Boolean))].sort().reverse();
 const sp=curSprint(sprints);
 const reqs=sp===SPRINT_ALL?all:all.filter(r=>r.sprint===sp);const other=all.length-reqs.length;
 const agg={attn:0,qa:0,chg:0,ho:0,busy:0};
 reqs.forEach(r=>{if(r.error||r.fail>0||r.risk_high>0)agg.attn++;agg.qa+=r.qa_pm||0;agg.chg+=(r.pm_changes||[]).length;agg.busy+=r.busy||0;if(hoSt(r)==='已匹配待确认'||hoSt(r)==='待匹配')agg.ho++;});
 const q=(lf.q||'').trim().toLowerCase();
 const shown=reqs.filter(r=>!q||((r.id||'')+' '+(r.name||'')+' '+r.folder).toLowerCase().includes(q));
 const by={mine:[],others:[],done:[]};
 shown.forEach(r=>{const L=laneOf(r);by[L.lane].push({r,main:L.main});});
 Object.values(by).forEach(a=>a.sort((x,y)=>{const sx=laneScore(x.r),sy=laneScore(y.r);return (sy[0]-sx[0])||(sy[1]-sx[1])||String(y.r.last_change||'').localeCompare(String(x.r.last_change||''));}));
 const admin=canAdmin();
 return archTabs()+
 '<div class="homebar"><div class="statusbar">'+stItem('进行中需求',reqs.length,'')+stItem('需关注',agg.attn,'bad','','有失败 / 阻塞 / 高风险的需求个数')+stItem('待 PM 确认',agg.qa,'warn')+
  stItem('看板改动待确认',agg.chg,'warn')+stItem('待确认提测',agg.ho,'info')+stItem('验证中用例',agg.busy,'info')+
  (other>0?stItem('其它 sprint',other,'muted',"setLf('sprint','"+SPRINT_ALL+"')",'点击切到「全部 Sprint」'):'')+'</div>'+
 '<div class="fbar"><span class="fgrp"><span class="gl">Sprint</span><select onchange="setLf(\'sprint\',this.value)">'+
  sprints.map((s,i)=>'<option value="'+esc(s)+'"'+(sp===s?' selected':'')+'>'+esc(s)+(i===0?'（最新）':'')+'</option>').join('')+
  '<option value="'+SPRINT_ALL+'"'+(sp===SPRINT_ALL?' selected':'')+'>全部</option></select></span>'+
 '<span class="search"><input id="lq" placeholder="搜索 CP 号 / 名称 / 目录名" value="'+esc(lf.q)+'" oninput="setLf(\'q\',this.value)"><span class="k">/</span></span>'+
 '<span class="sp"></span><span class="hint">'+shown.length+' / '+reqs.length+'</span></div></div>'+
 '<div class="lanes">'+LANES.map(([k,t,d])=>'<section class="lane lane-'+k+'"><h3>'+esc(t)+' <span class="lc">'+by[k].length+'</span><span class="hint">'+esc(d)+'</span></h3>'+
  (by[k].length?by[k].map(x=>reqCard(x.r,x.main,k,admin)).join(''):'<div class="lane-empty muted small">'+(k==='mine'?'没有轮到你的事项':'暂无')+'</div>')+'</section>').join('')+'</div>';}
function setLf(k,v){state.lf[k]=v;lsSet('vd_listf',{sprint:state.lf.sprint});render();}
function reqTitle(r){const cp=/^[A-Z][A-Z0-9]*-\d+$/.test(r.id||'')?r.id:'';let nm=r.name||r.folder||'';
 if(r.sprint&&nm.startsWith(r.sprint+'-'))nm=nm.slice(r.sprint.length+1);
 return {cp,nm};}
function reqDir(r){const d=String(PAYLOAD.develop||'').replace(/[\\/]+$/,'');const sep=d.includes('\\')?'\\':'/';return d?d+sep+r.folder:r.folder;}
function resumeCmd(r){const sd=String(PAYLOAD.skills_dir||'').replace(/[\\/]+$/,'');const sep=sd.includes('\\')?'\\':'/';const wf=r.workflow==='backend'?'backend':'fullstack';
 const py=(sd?sd+sep:'')+'ai-driven-'+wf+'-workflow'+sep+'scripts'+sep+'validate_step.py';
 return 'python "'+py+'" --dir "'+reqDir(r)+'"'+(wf==='backend'?' --workflow backend':'')+' --status';}
async function copyResume(btn){const r=(LIST.reqs||[]).find(x=>x.folder===btn.dataset.f);if(!r)return;await copyText(resumeCmd(r));toast('已复制续跑命令');}
function toast(msg){let el=document.getElementById('toast');if(!el){el=document.createElement('div');el.id='toast';el.className='toast';el.setAttribute('role','status');document.body.appendChild(el);}
 el.textContent=msg;el.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('show'),1800);}
const ARCH_SVG='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M2 3.5h12v2.5H2zM3 6v6.5h10V6M6.5 8.5h3"/></svg>';
function reqCard(r,main,lane,admin){const enc=encodeURIComponent(r.folder);const {cp,nm}=reqTitle(r);
 const c=r.cnt||{},fc=r.fc||{},tot=r.total||0,pass=c["通过"]||0,done=(r.ck||{}).done||0,p=Math.max(0,Math.min(1,r.progress||0));
 const h=laneHits(r);const others=h.m.concat(h.o).filter(x=>x.k!==main.k&&x.k!=='err');
 const nums=[(done!==pass?'实现 '+done+'/'+tot:''),'通过 '+pass+'/'+tot,'终验 '+(fc["终验通过"]||0)+'/'+(r.fc_base||0),(r.regs_total?'回归 '+r.regs_done+'/'+r.regs_total:'')].filter(Boolean).join(' · ');
 const bd=[[(c["失败"]||0),'失败','b-fail'],[(c["阻塞"]||0),'阻塞','b-blk'],[r.qa_pm||0,'待 PM','b-ho-wait'],[(r.pm_changes||[]).length,'看板改动','b-ho-wait'],[r.risk_high||0,'高风险','b-fail']]
  .filter(x=>x[0]>0).map(x=>'<span class="badge '+x[2]+'">'+esc(x[1])+' '+x[0]+'</span>').join('')+
  others.filter(x=>!['fail','blk','qa','chg'].includes(x.k)).map(x=>'<span class="badge b-also" title="'+esc(x.tip||x.t)+'">另有：'+esc(x.t)+'</span>').join('')+
  (tot===0&&!r.error?'<span class="badge b-unk">无 AC</span>':'');
 return '<article onclick="cardClick(event,this)" class="rc'+(lane==='mine'&&((c["失败"]||0)>0||r.error)?' rc-alarm':'')+'" data-f="'+esc(r.folder)+'">'+
 '<div class="rc1"><a class="rc-name" href="#/'+enc+'" title="'+esc(r.folder)+'">'+(cp?'<b>'+esc(cp)+'</b> ':'')+esc(nm)+'</a>'+
  (r.sprint?'<span class="tag spr">'+esc(r.sprint)+'</span>':'')+(r.workflow==='backend'?'<span class="tag wf">backend</span>':'')+'</div>'+
 '<div class="rc2"><span class="nx nx-'+main.cls+'" title="'+esc(main.tip||main.t)+'">'+esc(main.t)+'</span>'+(main.sub?'<span class="nx-sub" title="'+esc(main.tip||'')+'">'+esc(main.sub)+'</span>':'')+
  '<span class="sp"></span><span class="rc-up" title="最后更新 '+esc(ts(r.last_change))+'">'+(r.last_change?esc(ago(r.last_change)):'—')+'</span></div>'+
 (r.error||!tot?'':'<div class="rc3"><span class="pb"><i style="width:'+(p*100).toFixed(1)+'%"></i></span><b>'+pct(p)+'</b><span class="pgs" title="'+esc(nums)+'">'+esc(nums)+'</span></div>')+
 (bd?'<div class="rc4">'+bd+'</div>':'')+
 '<div class="rc5"><a class="btn primary" href="#/'+enc+'">打开详情</a><button type="button" class="btn" data-f="'+esc(r.folder)+'" onclick="copyResume(this)" title="'+esc(resumeCmd(r))+'">复制续跑命令</button>'+
  '<span class="sp"></span>'+(admin&&lane==='done'?'<button class="icon-btn" data-f="'+esc(r.folder)+'" onclick="archiveReq(this.dataset.f)" title="归档：标记已完成并移到 archived/" aria-label="归档">'+ARCH_SVG+'</button>':'')+'</div></article>';}
function cardClick(e,el){if(e.target.closest('a,button,input,select'))return;if(window.getSelection&&String(window.getSelection()).length)return;location.hash='#/'+encodeURIComponent(el.dataset.f);}
function archTabs(){return '<div class="tabs" style="margin-top:0">'+
 '<button class="'+(state.arch?'':'on')+'" onclick="state.arch=false;render()">进行中（'+(LIST.reqs||[]).length+'）</button>'+
 '<button class="'+(state.arch?'on':'')+'" onclick="state.arch=true;render()">已归档（'+(LIST.archived||[]).length+'）</button></div>';}
function renderArchived(){const A=LIST.archived||[];const admin=canAdmin();
 return archTabs()+'<div class="panel"><h3>已归档需求（'+A.length+'）</h3>'+
 (!admin?'<div class="banner warn">归档 / 恢复需要通过看板服务打开（<code>verify_dashboard.py --all --develop docs/develop --serve</code>）。</div>':'')+
 '<div class="tw"><table><thead><tr><th>需求</th><th>状态</th><th>归档时间</th>'+(admin?'<th>操作</th>':'')+'</tr></thead><tbody>'+
 (A.length?A.map(a=>'<tr><td>'+(a.has_page?'<a target="_blank" href="'+evUrl('archived/'+a.folder+'/验证进度看板.html')+'"><b>'+esc(a.id||'')+'</b> '+esc(a.name||a.folder)+'</a>':'<b>'+esc(a.id||'')+'</b> '+esc(a.name||a.folder))+
  '<div class="small muted mono">'+esc(a.folder)+'</div></td>'+
  '<td>'+(a.completed?'<span class="badge b-pass">'+esc(a.completed)+'</span>':'<span class="muted small">—</span>')+'</td>'+
  '<td class="nowrap">'+esc(ts(a.archived_at))+'</td>'+
  (admin?'<td><button data-f="'+esc(a.folder)+'" onclick="unarchiveReq(this.dataset.f)">恢复</button></td>':'')+'</tr>').join('')
 :'<tr><td colspan="4" class="muted">暂无已归档需求。</td></tr>')+'</tbody></table></div>'+
 '<div class="hint" style="margin-top:8px">点需求名查看归档时留存的看板（只读快照）。</div></div>';}
async function reqAction(kind,folder){
 try{await postJSON('api/req/'+kind,{folder});LIST.rev='';await fetchList();render();}
 catch(e){alert((kind==='archive'?'归档':'恢复')+'失败：'+(e&&e.message||e));}}
function archiveReq(folder){if(confirm('归档「'+folder+'」？\n\n· 该需求标记为「已完成」\n· 目录移到 docs/develop/archived/\n· 可在「已归档」里查看或恢复'))reqAction('archive',folder);}
function unarchiveReq(folder){if(confirm('恢复「'+folder+'」到进行中？'))reqAction('unarchive',folder);}

// ---------------------------------------------------------------- 单需求
function renderOne(req){let h='';
 if(!(req.acs||[]).length)h+='<div class="banner warn"><b>该需求暂无可聚合的用例。</b>'+
  (!req.has_checklist?'未找到 Step 3-Checklist.md。':(req.has_ac_ids?'':'Checklist 未使用 AC-NN 编号（旧格式：'+req.unnumbered+' 条只有前缀无编号），看板无法按 AC 聚合。'))+
  (req.has_tests_dir?'':' 也没有 tests/ 证据目录（尚未进入实机验证）。')+'</div>';
 const fullName=(req.id?req.id+' · ':'')+req.name;
 h+='<div class="fbar" style="margin-bottom:0">'+(!SINGLE?'<button onclick="back()">← 全部需求</button>':'')+
  '<b class="clip" title="'+esc(fullName)+'">'+esc(fullName)+'</b>'+
  (!SINGLE&&HTTP?'<a class="evfile" target="_blank" href="'+evUrl(req.folder+'/验证进度看板.html')+'">在独立页打开 ↗</a>':'')+
  '<span class="sp"></span><button type="button" class="btn" onclick="copyResumeCur()" title="'+esc(resumeCmd(sumOf(req)))+'">复制续跑命令</button></div>';
 const m=metrics(req);const rs=risks(req);const hi=rs.filter(r=>r.l==='high').length;
 const qa=req.qa||{},qpm=(qa.questions||[]).filter(q=>q["状态"]==="待PM确认").length,qch=(qa.pending||[]).length;
 const cnt={qa:(qa.exists?(qa.questions||[]).length:'')+(qpm?' · 待PM '+qpm:'')+(qch?' · 待确认改动 '+qch:''),
  cases:m.total,evidence:m.ev,regression:m.regs.length?m.rd+'/'+m.regs.length:''};
 const alarm={overview:hi,cases:m.cnt["失败"]+m.cnt["阻塞"],qa:(qa.errors||[]).length};
 h+='<div class="tabs" role="tablist">'+TABS.map(([k,t],i)=>'<button role="tab" class="'+(state.tab===k?'on':'')+'" onclick="tab(\''+k+'\')">'+t+
  (alarm[k]?'<span class="cnt alarm">'+alarm[k]+'</span>':(cnt[k]!==undefined&&cnt[k]!==''?'<span class="cnt">'+cnt[k]+'</span>':''))+'<span class="kbd">'+(i+1)+'</span></button>').join('')+'</div>';
 const VIEWS={overview:viewOverview,qa:viewQa,cases:viewCases,evidence:viewEvidence,regression:viewRegression,timeline:viewTimeline,guide:viewGuide};
 try{h+=(VIEWS[state.tab]||viewOverview)(req);}
 catch(e){h+='<div class="banner err"><b>渲染出错</b>：'+esc(e&&e.message||e)+'<br><span class="muted small">'+esc((e&&e.stack||'').split('\n').slice(0,3).join(' | '))+'</span></div>';console.error(e);}
 return h;}

function ring(p,sz){sz=sz||116;const r=48,c=2*Math.PI*r,v=Math.max(0,Math.min(1,p||0));
 return '<div class="ring'+(sz<116?' sm':'')+'" title="需求交付进度 = 实现 50% + 通过率 30% + 回归 20%"><svg viewBox="0 0 116 116"><circle cx="58" cy="58" r="'+r+'" fill="none" stroke="var(--track)" stroke-width="11"/>'+
 '<circle cx="58" cy="58" r="'+r+'" fill="none" stroke="url(#rg)" stroke-width="11" stroke-linecap="round" stroke-dasharray="'+(c*v).toFixed(1)+' '+c.toFixed(1)+'"/>'+
 '<defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="var(--run-s)"/><stop offset="1" stop-color="var(--pass-s)"/></linearGradient></defs></svg>'+
 '<div class="lab"><b>'+pct(v)+'</b><span>交付进度</span></div></div>';}
// ---- 详情「总览」：与首页卡片共用 laneOf / laneHits（同一份 /api/list 摘要），保证两处说同一句话
// 与 verify_dashboard.py next_step() 同口径：最高已通过步之后第一个未通过的步；之前缺通过记录的进 gaps；无任何记录时按 Step 文件推断
function nextStepOf(req){const spec=(req.step_spec||[]).map(([n,t])=>[+n,t]);if(!spec.length)return null;
 const ok=new Set(spec.filter(([n])=>((req.steps||{})[String(n)]||{}).passed).map(([n])=>n));let top=0,inferred=false;
 if(ok.size)top=Math.max(...ok);else{const ns=Object.keys(req.step_files||{}).filter(k=>/^\d+$/.test(k)).map(Number);if(ns.length){top=Math.max(...ns);inferred=true;}}
 const gaps=inferred?[]:spec.filter(([n])=>n<top&&!ok.has(n)).map(([n])=>n);
 const nx=spec.find(([n])=>n>top&&!ok.has(n));return nx?{n:nx[0],name:nx[1],gaps,inferred}:null;}
function sumOf(req){const s=(LIST.reqs||[]).find(x=>x.folder===req.folder);if(s)return s;  // 服务模式：直接用首页同一份摘要
 const m=metrics(req);const qa=req.qa||{};const qs=qa.questions||[];
 return {folder:req.folder,id:req.id,name:req.name,workflow:req.workflow,handover:req.handover||{},cnt:m.cnt,fc:m.fc,fc_base:m.fcBase,total:m.total,
  busy:m.cnt["验证中"]+m.cnt["修复中"],fail:m.cnt["失败"]+m.cnt["阻塞"],qa_pm:qs.filter(q=>q["状态"]==="待PM确认").length,
  pm_changes:pmChanges(qa).map(c=>({qid:c.qid,title:c.title||''})),next_step:nextStepOf(req),error:null};}
const LANE_NAME={mine:'轮到我',others:'等别人',done:'快收尾'};
function laneTag(l){return '<span class="lane-tag lt-'+l+'">'+LANE_NAME[l]+'</span>';}
function copyResumeCur(){const s=curSnap();if(!s)return;copyText(resumeCmd(sumOf(s))).then(()=>toast('已复制续跑命令'));}
function gotoR(tok){state.tab='regression';state.openR.add(tok);syncHash();render();const el=document.querySelector('tr[data-r="'+tok+'"]');if(el)el.scrollIntoView({block:'center'});}
function gotoQ(id){state.tab='qa';state.qaEdit=null;syncHash();render();const el=document.getElementById('qa-'+id);if(el){el.scrollIntoView({block:'center'});el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),1600);}}
function nextBanner(req){const s=sumOf(req);const L=laneOf(s),h=laneHits(s);const main=L.main;
 const rest=h.m.concat(h.o).filter(x=>x.k!==main.k);const ho=req.handover||{};
 const subMatched=(req.acs||[]).filter(a=>a.subtaskKey).length,n=(req.acs||[]).length;
 return '<div class="panel nb nb-'+L.lane+'"><div class="nb1">'+laneTag(L.lane)+
  '<span class="nb-main nx-'+main.cls+'" title="'+esc(main.tip||main.t)+'">'+esc(main.t)+'</span>'+(main.sub?'<span class="nx-sub" title="'+esc(main.tip||'')+'">'+esc(main.sub)+'</span>':'')+'</div>'+
  (rest.length?'<div class="nb2">'+rest.map(x=>'<span class="nb-chip nx-'+x.cls+'" title="'+esc(x.tip||x.t)+'">'+esc(x.t)+'</span>').join('')+'</div>':'')+
  '<div class="nb3 small muted">提测 '+hbadge(ho.status)+' · 父票 <b class="mono">'+(ho.parentIssue?esc(ho.parentIssue):'—')+'</b> · Subtask 已匹配 <b>'+subMatched+'</b>/'+n+
  (ho.exists&&n-subMatched?' · 未匹配 <b class="statn fail">'+(n-subMatched)+'</b>':'')+(ho.assigneeEmail?' · 默认转交 '+esc(ho.assigneeEmail)+' → '+esc(ho.targetStatus||'Testing'):'')+(ho.note?' · '+esc(ho.note):'')+'</div></div>';}
function stepTrack(req){const ns=nextStepOf(req);const gaps=new Set((ns&&ns.gaps)||[]);
 return '<div class="panel st-panel"><div class="strack">'+(req.step_spec||[]).map(([n,t])=>{const i=(req.steps||{})[String(n)]||{};
  const fs=(req.step_files||{})[String(n)]||[];
  const inf=ns&&ns.inferred&&n<ns.n;
  const st=i.passed?'ok':(gaps.has(n)||inf)?'gap':(ns&&ns.n===n)?'cur':i.consecutive_fails?'no':'none';
  const lab={ok:'已通过',gap:inf?'未记录：没有 .workflow-state.json，按产出文件推断已做过本步':'未记录：后续步骤已通过，但本步在 .workflow-state.json 里没有通过记录',cur:'当前（下一步）'+(ns&&ns.inferred?' · 按产出文件推断':''),no:'连续失败 '+i.consecutive_fails+' 次',none:'未开始'}[st];
  const tip='Step'+n+' '+t+' · '+lab+(i.at?' · '+ts(i.at):'')+(fs.length?' · 点击查看产出物（'+fs.length+'）':' · 暂无产出物');
  return '<button type="button" class="sstep s-'+st+(state.stepOpen===n?' sel':'')+'"'+(fs.length?' onclick="stepClick('+n+')"':' disabled')+' title="'+esc(tip)+'"><i></i><span class="sn">'+n+(st==='gap'?' !':'')+'</span><span class="sl">'+esc(t)+'</span></button>';}).join('')+
 '</div>'+stepFilesRow(req)+'</div>';}
const COVERED_RISK=[/^验证(失败|阻塞)：/,/超过 \d+ 分钟无更新.*reclaim/,/^证据终验不通过/,/已完结但未终验/,/^回归项无结论/];
function todoGroups(req){const A=req.acs||[];const by=(f)=>A.filter(f);const G=[];
 const acChips=(list,tipf)=>list.map(a=>({k:'ac',tok:a.token,tip:tipf?tipf(a):(a.title||''),warn:false}));
 const add=(lane,key,title,items,hint,extra)=>{if(items.length||extra)G.push({lane,key,title,items,hint:hint||'',extra:extra||''});};
 add('mine','fail','失败待修',acChips(by(a=>a.status==="失败"),a=>a.note||a.title||''));
 const busy=by(a=>a.status==="验证中"||a.status==="修复中");
 add('mine','busy','验证中 · 修复中',busy.map(a=>({k:'ac',tok:a.token,tip:a.status+(stale(a.updated_at)?' · 超过 '+TTL_MIN+' 分钟无更新（可能已中断，可 reclaim）':'')+' · '+(a.title||''),warn:stale(a.updated_at)})),busy.some(a=>stale(a.updated_at))?'虚线 = 超时无更新，可 reclaim':'');
 add('mine','todo','待验证',acChips(by(a=>(a.status||"待验证")==="待验证")));
 add('mine','part','部分通过',acChips(by(a=>a.status==="部分"),a=>a.note||a.title||''),'附条件 / 待补');
 add('mine','fcfail','终验不通过',acChips(by(a=>a.final_status==="终验不通过"),a=>a.final_note||'证据不支撑结论'));
 add('mine','fc','未终验',acChips(by(a=>FINISHED.includes(a.status)&&(a.final_status||"未终验")==="未终验")),'只核对证据，不用重跑');
 add('mine','regr','回归未结论',(req.regressions||[]).filter(r=>!r.ok).map(r=>({k:'r',tok:r.token,tip:(r.text||'')+(r.verdict_line?' · '+r.verdict_line:'')})),'未验证的 R-NN 与未实现 AC 同等对待');
 add('mine','chg','看板改动待确认',pmChanges(req.qa).map(c=>({k:'q',tok:c.qid,tip:c.title||''})),'PM 在确认页改了结论，需你确认');
 const blk=by(a=>a.status==="阻塞");const why={};blk.forEach(a=>{const k=(a.note||'未写原因').slice(0,60);(why[k]=why[k]||[]).push(a.token);});
 add('others','blk','阻塞',acChips(blk,a=>a.note||a.title||''),'缺账号 / 环境 / 外部依赖',
  blk.length?'<ul class="why">'+Object.keys(why).sort((x,y)=>why[y].length-why[x].length).slice(0,4).map(k=>'<li><b>'+why[k].length+'</b> '+esc(k)+'</li>').join('')+'</ul>':'');
 add('others','qa','待 PM 确认',(((req.qa||{}).questions)||[]).filter(q=>q["状态"]==="待PM确认").map(q=>({k:'q',tok:q.id,tip:q.title||''})));
 const ho=req.handover||{};
 if(((ho.status)||'')==='已匹配待确认')add('others','ho','待确认提测',[],'',
  '<div class="small muted">AC↔Subtask 已匹配 '+(ho.matched||0)+'/'+(ho.total_map||0)+'，等确认后提测（Step'+lastStep(req)+'）</div>');
 // 同一 AC 只出现一次：按「最需要先处理」的组优先认领（阻塞先于终验类，避免阻塞 AC 被算成"只差终验"）
 const seen=new Set();['fail','busy','todo','part','blk','fcfail','fc'].forEach(k=>{const g=G.find(x=>x.key===k);if(!g)return;
  g.items=g.items.filter(c=>c.k!=='ac'||(!seen.has(c.tok)&&seen.add(c.tok)));});
 for(let i=G.length-1;i>=0;i--)if(!G[i].items.length&&!G[i].extra)G.splice(i,1);
 const other=risks(req).filter(r=>!COVERED_RISK.some(re=>re.test(r.t)));
 if(other.length)G.push({lane:'risk',key:'risk',title:'其它风险',items:[],hint:'',risks:other});
 return G;}
function chipHtml(c){if(c.k==='ac')return '<button class="tchip'+(c.warn?' warn':'')+'" data-act="goto-ac" data-ac="'+esc(c.tok)+'" title="'+esc(c.tip)+'">'+esc(c.tok)+'</button>';
 const fn=c.k==='r'?'gotoR':'gotoQ';return '<button class="tchip t-'+c.k+'" onclick="'+fn+'(\''+esc(c.tok)+'\')" title="'+esc(c.tip)+'">'+esc(c.tok)+'</button>';}
function riskLine(r){return '<div class="risk '+r.l+'"><div class="txt"><span class="lv">'+({high:'高',medium:'中',low:'低'})[r.l]+'</span>'+(r.ac?'<button class="tchip" data-act="goto-ac" data-ac="'+esc(r.ac)+'">'+esc(r.ac)+'</button> ':'')+esc(r.t)+'</div>'+
 (r.acs?'<div class="tchips">'+r.acs.map(t=>chipHtml({k:'ac',tok:t,tip:''})).join('')+'</div>':'')+(r.cmd?'<code>'+esc(r.cmd)+'</code>':'')+'</div>';}
function todoPanel(req){const G=todoGroups(req);state.todoOpen=state.todoOpen||{};
 if(!G.length)return '<div class="panel"><h3>待办清单</h3><div class="muted small">没有待办：AC 都有结论且已终验，回归全部有结论。</div></div>';
 const lanes=[['mine','轮到我'],['others','等别人'],['risk','']];let idx=0;
 const grp=g=>{const n=g.risks?g.risks.length:(g.items.length||(g.extra?1:0));const key=req.folder+'|'+g.key;const open=state.todoOpen[key]!==undefined?state.todoOpen[key]:idx<3;idx++;
  let body='';
  if(g.risks){const top=g.risks.filter(r=>r.l!=='low'),low=g.risks.filter(r=>r.l==='low');
   body=top.map(riskLine).join('')+(low.length?'<details class="more"'+(state.lowOpen?' open':'')+' ontoggle="state.lowOpen=this.open"><summary class="small">低风险 '+low.length+' 条</summary>'+low.map(riskLine).join('')+'</details>':'');}
  else body=(g.items.length?'<div class="tchips">'+g.items.slice(0,120).map(chipHtml).join('')+(g.items.length>120?'<span class="muted small">… 另 '+(g.items.length-120)+' 条见用例明细</span>':'')+'</div>':'')+g.extra;
  return '<details class="tg tg-'+g.key+'"'+(open?' open':'')+' data-k="'+esc(key)+'" ontoggle="state.todoOpen[this.dataset.k]=this.open"><summary><b>'+esc(g.title)+'</b><span class="tn">'+n+'</span>'+(g.hint?'<span class="hint">'+esc(g.hint)+'</span>':'')+'</summary><div class="tg-body">'+body+'</div></details>';};
 return '<div class="panel todo"><h3>待办清单 <span class="hint">同一事项只出现一次 · 点 AC 跳用例明细，R 跳回归，Q 跳需求问答</span></h3>'+
  lanes.map(([l,t])=>{const gs=G.filter(g=>g.lane===l);if(!gs.length)return '';return '<div class="tlane">'+(t?'<div class="tlane-h">'+laneTag(l)+'</div>':'')+gs.map(grp).join('')+'</div>';}).join('')+'</div>';}
function thinBar(label,v,den,cls){const p=den?Math.max(0,Math.min(1,v/den)):0;
 return '<div class="tb"><span class="l">'+label+'</span><span class="mb '+(cls||'')+'"><i style="width:'+(p*100).toFixed(1)+'%"></i></span><b>'+(den?v+'<span class="muted">/'+den+'</span>':'<span class="muted">—</span>')+'</b></div>';}
function viewOverview(req){const m=metrics(req);const ho=req.handover||{};
 const subMatched=(req.acs||[]).filter(a=>a.subtaskKey).length,subMiss=(req.acs||[]).length-subMatched;
 const fb=m.cnt["失败"]+m.cnt["阻塞"];
 let h=nextBanner(req)+stepTrack(req)+todoPanel(req);
 h+='<div class="panel prog"><div class="prog1">'+ring(m.progress,64)+'<div class="tbs">'+
  thinBar('实现',m.ck.done,m.total)+thinBar('通过',m.cnt["通过"],m.total,'ok')+thinBar('终验',m.fc["终验通过"],m.fcBase,'f')+thinBar('回归',m.rd,m.regs.length,'r')+'</div>'+
  '<div class="dist">'+bar(STATUS_ORDER.map(s=>[s,m.cnt[s],COL[s]]))+legend(STATUS_ORDER.map(s=>[s,m.cnt[s],COL[s]]))+'</div></div></div>';
 // 更多指标（全部保留；原「需求整体进度」的 Checklist / 状态分布条也收在这里）
 const ckItems=[["done",m.ck.done,"var(--pass-s)"],["open",m.ck.open,"var(--pend)"],["blocked",m.ck.blocked,"var(--blk-s)"],["waived",m.ck.waived||0,"var(--fix-s)"]];
 h+='<div class="panel"><details class="more"'+(state.moreOpen?' open':'')+' ontoggle="state.moreOpen=this.open;lsSet(\'vd_more\',this.open)"><summary>更多指标 <span class="hint">18 项</span></summary>'+
 '<div class="grid cards">'+
 card("需求交付进度",pct(m.progress),"实现50% + 通过率30% + 回归20%")+card("AC 总数",m.total,"Checklist / 目录合计")+
 card("实现完成",frac(m.ck.done,m.total),"Checklist [done]")+card("验证通过",m.cnt["通过"],"registry = 通过")+
 card("进行中",m.cnt["验证中"]+m.cnt["修复中"],"验证中 "+m.cnt["验证中"]+" · 修复中 "+m.cnt["修复中"])+card("待验证",m.cnt["待验证"],"")+
 card("失败/阻塞",m.cnt["失败"]+" / "+m.cnt["阻塞"],"",alarmIf(fb))+card("提测状态",hbadge(ho.status),"与验证态分离 · .handover-state.json")+
 card("Subtask 匹配",frac(subMatched,(req.acs||[]).length),subMiss?"未匹配 "+subMiss:"全部已挂号")+card("验证覆盖率",pct(m.coverage),"已开始的 AC 占比")+
 card("验证通过率",pct(m.passRate),"已判定的通过占比")+
 card("证据终验",frac(m.fc["终验通过"],m.fcBase),"未终验 "+m.fc["未终验"]+" · 终验中 "+m.fc["终验中"]+" · 不通过 "+m.fc["终验不通过"]+" · 豁免 "+m.fc["豁免"],alarmIf(m.fc["终验不通过"]))+
 card("回归项",frac(m.rd,m.regs.length),"R-NN 有结论")+card("流程步骤",frac(m.stepsOk,(req.step_spec||[]).length),"validate_step")+
 card("证据文件",m.ev,"媒体 "+m.med)+card("累计验证工时",dur(m.work),"各 AC 耗时之和")+
 card("墙钟时长",m.wall==null?"—":dur(m.wall),"最早开始→最晚结束")+card("进行中已耗时",dur(m.inflight),"最长的一条",m.inflight>TTL_MIN*60?'warn':'')+
 '</div><div style="margin-top:12px"><div class="small muted" style="margin-bottom:4px">Checklist 状态</div>'+bar(ckItems)+legend(ckItems.map(i=>[CK_LABEL[i[0]]||i[0],i[1],i[2]]))+'</div></details></div>';
 return h;}
function stepFileList(n){const r=curSnap();return ((r&&r.step_files)||{})[String(n)]||[];}
function stepClick(n){const fs=stepFileList(n);if(!fs.length)return;
 if(fs.length===1){state.stepOpen=null;openEv(fs[0].rel,fs[0].type,fs[0].name);return;}
 state.stepOpen=state.stepOpen===n?null:n;render();}
function stepFilesRow(req){const n=state.stepOpen;if(n==null)return '';const fs=((req.step_files||{})[String(n)])||[];if(!fs.length)return '';
 return '<div class="stepfiles"><span class="muted">Step'+n+' 产出物：</span>'+fs.map((f,k)=>'<button type="button" onclick="stepFileOpen('+n+','+k+')">'+esc(f.name)+'</button>').join('')+'</div>';}
function stepFileOpen(n,k){const f=stepFileList(n)[k];if(f)openEv(f.rel,f.type,f.name);}
function filteredRegr(req){const f=state.rv;const rs=req.regressions||[];return (!f||!f.size)?rs:rs.filter(r=>f.has(r.verdict));}
function viewRegression(req){const all=req.regressions||[];
 if(!all.length)return '<div class="panel muted">未找到《回归验证清单》（Step *-回归验证清单.md）。<div class="hint" style="margin-top:6px">R-NN 回答「既有功能有没有被弄坏」，与 AC-NN（新需求验收）独立编号。</div></div>';
 const list=filteredRegr(req);const by={};all.forEach(r=>{by[r.verdict]=(by[r.verdict]||0)+1;});const done=all.filter(r=>r.ok).length;
 const rchip=k=>{const v=REGR_V[k]||REGR_V.unknown;return '<button class="fchip'+(state.rv.has(k)?' on':'')+'" onclick="frv(\''+k+'\')"><span class="badge '+v[1]+'">'+v[0]+'</span><span class="n">'+(by[k]||0)+'</span></button>';};
 const rows=list.map(r=>{const v=REGR_V[r.verdict]||REGR_V.unknown;const open=state.openR.has(r.token);
  return '<tr data-r="'+r.token+'" onclick="toggleR(\''+r.token+'\')" style="cursor:pointer" class="'+(r.ok?'':'row-warn')+'"><td class="mono nowrap"><b>'+esc(r.token)+'</b></td><td>'+esc(r.text||"—")+'</td>'+
  '<td class="small">'+esc(r.who||"—")+'</td><td><span class="badge '+v[1]+'">'+v[0]+'</span></td>'+
  '<td class="small muted">'+(r.note?(esc(r.note.slice(0,80))+(r.note.length>80?"…":"")):"—")+'</td></tr>'+
  (open?'<tr class="detail"><td colspan="5"><div class="det det-grid">'+
  '<div class="det-sec"><h4>因为改了什么</h4><div class="small">'+(r.because?esc(r.because):'<span class="muted">—</span>')+'</div></div>'+
  '<div class="det-sec"><h4>期望不变的行为</h4><div class="small">'+(r.expect?esc(r.expect):'<span class="muted">—</span>')+'</div></div>'+
  '<div class="det-sec"><h4>验证方式</h4><div class="small">'+(r.how?esc(r.how):'<span class="muted">—</span>')+'</div></div>'+
  '<div class="det-sec"><h4>结论说明</h4><div class="small">'+(r.note?esc(r.note):'<span class="muted">尚未回填</span>')+'</div></div>'+
  '</div></td></tr>':'');}).join('');
 const left=(by.not_run||0)+(by.unknown||0);
 return '<div class="panel"><div class="fbar"><b>回归项 '+done+' / '+all.length+' 有结论</b>'+
 '<span class="hint">AC = 新需求做对了吗；<b>R = 既有功能有没有被改坏</b>（编号独立）</span>'+
 (req.regression_rel?'<button class="btn" '+evAttrs(req.regression_rel,'md',req.regression_file||'回归验证清单')+'>打开清单原文</button>':'')+'</div>'+
 '<div class="grid cards" style="margin-bottom:12px">'+card("有结论",done+"/"+all.length,"pass / partial / waived")+card("通过",by.pass||0,"verdict=pass")+
 card("部分",by.partial||0,"附条件 / 待补",by.partial?'warn':'')+card("未跑 / 无结论",left,"挡门禁",alarmIf(left))+'</div>'+
 '<div class="fbar"><span class="fgrp"><span class="gl">结论</span>'+Object.keys(REGR_V).map(rchip).join("")+'</span><span class="sp"></span><span class="hint">'+list.length+' / '+all.length+' 条 · 点击行展开</span></div>'+
 '<div class="tw"><table><thead><tr><th>R</th><th>受影响的既有功能</th><th>谁来验</th><th>结论</th><th>说明</th></tr></thead><tbody>'+
 rows+(list.length?'':'<tr><td colspan="5" class="muted">无匹配回归项。</td></tr>')+'</tbody></table></div></div>';}

// ---------------------------------------------------------------- 用例明细
const ST_RANK={"失败":0,"阻塞":1,"修复中":2};
function stRank(a){return ST_RANK[a.status]!==undefined?ST_RANK[a.status]:(a.final_status==="终验不通过"?2.5:3);}
function durSec(a){const s=a.started_at?new Date(a.started_at):null;const e=a.finished_at?new Date(a.finished_at):(a.updated_at?new Date(a.updated_at):null);
 return (!s||!e||isNaN(s)||isNaN(e))?null:(e-s)/1000;}
const SORTS={token:a=>a.num,status:a=>STATUS_ORDER.indexOf(a.status),final:a=>FC_ORDER.indexOf(a.final_status||"未终验"),ho:a=>a.handoverStatus||'',
 sub:a=>a.subtaskKey||'~',prio:a=>a.priority||'P9',prefix:a=>a.prefix||'~',tags:a=>(a.tags||[]).join('/')||'~',title:a=>a.title||'',
 start:a=>a.started_at||'',dur:a=>durSec(a)==null?-1:durSec(a),ev:a=>a.ev_n||0};
function filtered(req){const f=state.filter;
 const list=(req.acs||[]).filter(a=>{if(f.status.size&&!f.status.has(a.status))return false;
  if(f.fc.size&&!f.fc.has(a.final_status||"未终验"))return false;
  if(f.risk&&!["失败","阻塞","验证中","修复中"].includes(a.status)&&a.final_status!=="终验不通过")return false;
  if(f.ev&&!a.ev_n)return false;
  if(f.q){const q=f.q.toLowerCase();if(!((a.token+" "+(a.subtaskKey||"")+" "+(a.handoverStatus||"")+" "+a.title+" "+a.prefix+" "+a.note+" "+a.gwt+" "+(a.session||'')+" "+(a.window||'')).toLowerCase().includes(q)))return false;}
  return true;});
 const s=state.sort;
 if(s.key&&SORTS[s.key]){const g=SORTS[s.key];list.sort((x,y)=>{const a=g(x),b=g(y);return (a<b?-1:a>b?1:0)*s.dir||(x.num-y.num);});}
 else list.sort((x,y)=>stRank(x)-stRank(y)||x.num-y.num);  // 默认：失败/阻塞/修复中 置顶
 return list;}
function th(key,label){const s=state.sort;const on=s.key===key;
 return '<th class="sort" data-act="sort" data-k="'+key+'" title="点击排序">'+label+(on?'<span class="arr">'+(s.dir>0?'▲':'▼')+'</span>':'')+'</th>';}
function figName(rel){return String(rel).split('/').pop().replace(/\.(png|jpe?g|gif|webp)$/i,'');}
function figGallery(req){const ims=req.ui_images||[];if(!ims.length)return '';
 return '<div class="panel"><div class="fbar" style="margin-bottom:4px"><b>一页读懂 · 标注图（'+ims.length+'）</b><span class="hint">点图放大；图上每个编号下写了「对应 AC」</span></div>'+
 '<div class="figbar">'+ims.map(r=>'<div class="fig" '+evAttrs(r,'image',figName(r))+'><img loading="lazy" src="'+evUrl(r)+'" alt=""><div class="cap">'+esc(figName(r))+'</div></div>').join('')+'</div></div>';}
function viewCases(req){const list=filtered(req);const ho=req.handover||{};const f=state.filter;const all=req.acs||[];
 const cntS={},cntF={};all.forEach(a=>{cntS[a.status]=(cntS[a.status]||0)+1;const k=a.final_status||"未终验";cntF[k]=(cntF[k]||0)+1;});
 const chip=s=>'<button class="fchip'+(f.status.has(s)?' on':'')+(cntS[s]?'':' zero')+'" data-act="fstat" data-s="'+esc(s)+'">'+badge(s)+'<span class="n">'+(cntS[s]||0)+'</span></button>';
 const fchip=s=>'<button class="fchip'+(f.fc.has(s)?' on':'')+(cntF[s]?'':' zero')+'" data-act="ffc" data-s="'+esc(s)+'">'+fbadge(s)+'<span class="n">'+(cntF[s]||0)+'</span></button>';
 const shown=list.slice(0,state.rowsShown);
 const rows=shown.map(a=>{const d=durSec(a);
  const cls=(a.status==="失败"||a.status==="阻塞"||a.final_status==="终验不通过")?'row-alarm':(a.status==="修复中"?'row-warn':'');
  const tip='会话 '+(a.session||'—')+' · 窗口 '+(a.window||'—')+(a.engine?' · '+a.engine:'');
  return '<tr data-ac="'+a.token+'" data-act="toggle" class="'+cls+(state.focusAc===a.token?' focus':'')+'" style="cursor:pointer">'+
  '<td class="mono nowrap" title="'+esc(tip)+'"><b>'+esc(a.token)+'</b></td>'+
  '<td class="nowrap">'+badge(a.status)+'</td><td class="nowrap">'+fbadge(a.final_status,a.status)+'</td>'+
  '<td class="nowrap">'+hbadge(a.handoverStatus||"未进入")+'</td>'+
  '<td class="nowrap">'+(a.subtaskKey?'<span class="subkey">'+esc(a.subtaskKey)+'</span>':'<span class="muted small">—</span>')+'</td>'+
  '<td>'+prio(a.priority)+'</td><td class="small">'+esc(a.prefix||"—")+'</td><td class="small nowrap">'+esc((a.tags||[]).join("/")||"—")+'</td>'+
  '<td class="title">'+esc(a.title)+'</td>'+
  '<td class="small nowrap" title="'+esc(ts(a.started_at))+'">'+tsShort(a.started_at)+'</td>'+
  '<td class="small mono nowrap">'+(d==null?'—':dur(d)+(a.finished_at?'':' <span class="muted">≈</span>'))+'</td>'+
  '<td class="mono nowrap">'+(a.ev_n?a.ev_n+' <span class="muted small">('+(a.ev_media||0)+' 媒体)</span>':'<span class="muted">0</span>')+'</td></tr>'+detailRow(req,a);}).join("");
 return figGallery(req)+'<div class="panel"><div class="fbar">'+
 '<span class="fgrp"><span class="gl">状态</span>'+["失败","阻塞","修复中","验证中","待验证","通过"].map(chip).join("")+'</span>'+
 '<span class="fgrp"><span class="gl">终验</span>'+FC_ORDER.map(fchip).join("")+'</span>'+
 '<span class="fgrp"><label class="tog"><input type="checkbox" '+(f.risk?'checked':'')+' data-act="frisk"> 只看风险</label>'+
 '<label class="tog"><input type="checkbox" '+(f.ev?'checked':'')+' data-act="fev"> 只看有证据</label></span>'+
 '<span class="search"><input id="q" placeholder="搜索 AC / Subtask / 描述 / GWT / 会话" value="'+esc(f.q)+'" oninput="fq(this.value)"><span class="k">/</span></span>'+
 '<span class="sp"></span><span class="hint nowrap">'+list.length+' / '+all.length+' 条 · 需求提测门控 '+hbadge(ho.status)+'</span></div>'+
 '<div class="tw sticky"><table><thead><tr>'+th('token','AC')+th('status','状态')+th('final','终验')+th('ho','提测')+th('sub','Subtask')+th('prio','优先级')+
 th('prefix','前缀')+th('tags','归属')+th('title','场景')+th('start','开始')+th('dur','耗时')+th('ev','证据')+'</tr></thead><tbody>'+rows+
 (list.length?'':'<tr><td colspan="12" class="muted">无匹配用例。</td></tr>')+'</tbody></table></div>'+
 (list.length>shown.length?'<div class="more-rows"><button data-act="more-rows">再显示 '+Math.min(ROWS_STEP,list.length-shown.length)+' 条（共 '+list.length+'）</button></div>':'')+
 '<div class="hint" style="margin-top:6px">默认 失败 / 阻塞 / 修复中 置顶；点表头排序（再点反向，第三次恢复默认）；<kbd>j</kbd>/<kbd>k</kbd> 逐条展开；会话 / 窗口在 AC 上悬浮或展开查看。</div></div>';}
function detailRow(req,a){if(!state.open.has(a.token))return "";
 const r=a.result||{};const vCls=r.verdict==='通过'?'ok':(r.verdict==='失败'?'bad':'mute');
 const acts=a.dir_rel?('<div class="det-actions"><span class="lbl">原文</span>'+
  '<button class="btn primary" '+evAttrs(a.dir_rel+'/RESULT.md','md','RESULT.md · '+a.token,a.token)+'>RESULT.md</button>'+
  (a.has_replay?'<button class="btn" '+evAttrs(a.dir_rel+'/REPLAY.md','md','REPLAY.md · '+a.token,a.token)+'>REPLAY.md</button>':'')+
  '<button class="btn" '+evAttrs(a.dir_rel+'/case.md','md','case.md · '+a.token,a.token)+'>case.md</button>'+
  '<span class="lbl sep">结果</span><span class="chip '+vCls+'">'+(r.verdict?esc(r.verdict==='NOT_RUN'?'待验证':r.verdict):'未判定')+'</span>'+
  (a.has_replay||a.has_script?'':'<span class="chip bad">缺复跑入口</span>')+'</div>')
  :('<div class="det-actions"><span class="lbl">该 AC 没有 tests/AC-NN 目录，没有原文可看</span></div>');
 const kv='<dl class="kv">'+
 '<dt>Subtask</dt><dd>'+(a.subtaskKey?'<span class="subkey">'+esc(a.subtaskKey)+'</span>'+(a.subtaskSummary?' <span class="muted small">'+esc(a.subtaskSummary)+'</span>':'')+(a.subtaskMatch?' <span class="muted small">· '+esc(a.subtaskMatch)+'</span>':''):'<span class="muted">未匹配</span>')+'</dd>'+
 '<dt>提测（Subtask）</dt><dd>'+hbadge(a.handoverStatus||"未进入")+'</dd>'+
 '<dt>状态</dt><dd>'+badge(a.status)+'</dd>'+
 '<dt>证据终验</dt><dd>'+fbadge(a.final_status,a.status)+(a.final_by?' <span class="muted small">'+esc(a.final_by)+' · '+ts(a.final_at)+'</span>':'')+(a.final_note?'<div class="small">'+esc(a.final_note)+'</div>':'')+'</dd>'+
 '<dt>会话</dt><dd class="mono small">'+esc(a.session||"—")+(a.engine?' · '+esc(a.engine):'')+'</dd>'+
 '<dt>窗口</dt><dd class="mono small" style="word-break:break-all">'+esc(a.window||"—")+'</dd>'+
 '<dt>开始 / 结束</dt><dd class="mono small">'+ts(a.started_at)+' / '+ts(a.finished_at||a.updated_at)+'</dd>'+
 '<dt>备注</dt><dd>'+esc(a.note||"—")+'</dd>'+
 (r.env?'<dt>环境</dt><dd>'+esc(r.env)+'</dd>':'')+(r.verdict_line?'<dt>RESULT 结论</dt><dd>'+esc(r.verdict_line)+'</dd>':'')+
 (r.downgrade?'<dt>证据降级</dt><dd class="muted">'+esc(r.downgrade)+'</dd>':'')+'</dl>';
 return '<tr class="detail"><td colspan="12"><div class="det">'+acts+'<div class="det-grid">'+
 '<div class="det-sec"><h4>验收原文（GWT）</h4>'+(a.gwt?'<pre class="gwt">'+esc(a.gwt)+'</pre>':'<div class="muted small">Checklist 中未找到该条 GWT</div>')+
 (a.fig_text?'<h4 style="margin-top:10px">图示 <span class="muted small" style="font-weight:400">看图中红框标的编号；点图放大</span></h4><div class="small"><b>'+esc(a.fig_text.replace(/（UI\/[^）]*）/g,''))+'</b></div>'+
  ((a.figs||[]).length?'<div class="figac">'+a.figs.map(x=>'<div class="fig" '+evAttrs(x,'image',a.token+' · '+figName(x))+'><img loading="lazy" src="'+evUrl(x)+'" alt=""></div>').join('')+'</div>':''):'')+'</div>'+
 '<div class="det-sec"><h4>执行信息</h4>'+kv+'</div></div>'+
 '<div class="det-sec"><h4>证据（'+(a.ev_n||0)+' 个'+(a.ev_media?'，媒体 '+a.ev_media:'')+'）'+(a.ev_n>(a.ev||[]).length?' <span class="muted" style="font-weight:400">预览前 '+(a.ev||[]).length+' 个</span>':'')+'</h4>'+
 (a.ev_n?evList(req,a,a.ev||[],'p:'+a.token)+(a.ev_n>(a.ev||[]).length?'<div style="margin-top:8px"><button class="btn" data-act="goto-ev" data-ac="'+a.token+'">在「证据」页签查看全部 '+a.ev_n+' 个 →</button></div>':'')
  :'<div class="muted small">evidence/ 为空 —— 按门禁口径「未留证 = 未测」</div>')+
 '</div></div></td></tr>';}

// ---------------------------------------------------------------- 证据（按 AC 折叠；展开才渲染图片；大目录折叠）
function evRel(a,e){return a.dir_rel+'/evidence/'+e.p;}
function evKey(req,a){return req.folder+'|'+(DETAIL[req.folder]||{}).rev+'|'+a.token;}
function evAttrs(rel,type,title,ac,grp){return 'data-ev="'+encodeURIComponent(rel)+'" data-type="'+esc(type)+'" data-title="'+esc(title||'')+'"'+(ac?' data-ac="'+esc(ac)+'"':'')+(grp?' data-grp="'+esc(grp)+'"':'');}
function evIcon(t){return t==='video'?'🎬':t==='har'?'📦':t==='log'?'📜':t==='image'?'🖼':'📄';}
async function evItems(req,a){const k=evKey(req,a);if(EVC[k])return EVC[k];
 if(a.ev_all)return (EVC[k]=a.ev_all);
 if(SERVE){const j=await getJSON(BASE+'api/req/'+encodeURIComponent(req.folder)+'/evidence?ac='+encodeURIComponent(a.token));return (EVC[k]=j.items||[]);}
 return (EVC[k]=a.ev||[]);}
async function evGroupItems(req,a,dir){const k=evKey(req,a)+'|'+dir;if(EVG[k])return EVG[k];
 if(a.ev_groups&&a.ev_groups[dir])return (EVG[k]=a.ev_groups[dir]);
 if(SERVE){const j=await getJSON(BASE+'api/req/'+encodeURIComponent(req.folder)+'/evidence?ac='+encodeURIComponent(a.token)+'&dir='+encodeURIComponent(dir));return (EVG[k]=j.items||[]);}
 return [];}
function ensure(key,fn){if(LOADING[key])return;LOADING[key]=1;fn().then(()=>{delete LOADING[key];render();}).catch(e=>{LOADING[key]='err:'+(e&&e.message||e);render();});}
function evList(req,a,items,key,grp){
 const imgs=items.filter(e=>e.t==='image'),groups=items.filter(e=>e.t==='group'),rest=items.filter(e=>e.t!=='image'&&e.t!=='group');
 const lim=state.evShowAll.has(key)?imgs.length:Math.min(imgs.length,THUMB_LIMIT);let h='';
 if(imgs.length)h+='<div class="thumbs">'+imgs.slice(0,lim).map(e=>{const rel=evRel(a,e);const nm=baseName(e.p);
  return '<span class="evlink" '+evAttrs(rel,'image',nm,a.token,grp)+' title="'+esc(e.p)+'"><img loading="lazy" decoding="async" src="'+evUrl(rel)+'" alt=""><div class="cap">'+esc(nm)+'</div></span>';}).join('')+'</div>'+
  (imgs.length>lim?'<div style="margin-top:6px"><button class="btn" data-act="ev-all" data-k="'+esc(key)+'">显示其余 '+(imgs.length-lim)+' 张</button></div>':'');
 if(rest.length)h+='<div style="margin-top:6px">'+rest.map(e=>{const rel=evRel(a,e);
  return '<span class="evfile">'+evIcon(e.t)+' <span class="evlink" '+evAttrs(rel,e.t,baseName(e.p),a.token,grp)+' title="'+esc(e.p)+'">'+esc(baseName(e.p))+'</span> <span class="muted">'+humanSize(e.s)+'</span></span>';}).join('')+'</div>';
 groups.forEach(g=>{const gk=a.token+'|'+g.g;const open=state.evGroupOpen.has(gk);
  h+='<div class="evgroup">📁 <button data-act="ev-grp" data-k="'+esc(gk)+'">'+(open?'▾ ':'▸ ')+esc(g.g)+'/</button> <span class="muted small">'+g.n+' 个文件（图片 '+g.img+'）· '+humanSize(g.s)+' · 大目录已折叠，点开再列</span>';
  if(open){const k=evKey(req,a)+'|'+g.g;
   if(EVG[k])h+=evList(req,a,EVG[k],'g:'+gk,g.g);
   else if(typeof LOADING['g:'+k]==='string')h+='<div class="banner err small">加载失败：'+esc(LOADING['g:'+k])+'</div>';
   else{h+='<div class="muted small">加载中…</div>';ensure('g:'+k,()=>evGroupItems(req,a,g.g));}}
  h+='</div>';});
 return h;}
function evMatch(a,q){q=(q||'').trim().toLowerCase();if(!q)return true;
 const m=q.match(/^(?:ac-?)?(\d{1,3})$/);if(m)return a.num===parseInt(m[1],10);
 const k=evKey({folder:state.folder},a);const names=(EVC[k]||a.ev||[]).map(e=>e.p||e.g||'');
 const hay=[a.token,a.title,a.gwt,a.subtaskKey,(a.tags||[]).join(' ')].concat(names).join(' ').toLowerCase();
 return q.split(/\s+/).every(w=>hay.includes(w));}
function feq(v){state.eq=v;render();}
function viewEvidence(req){const all=(req.acs||[]).filter(a=>a.ev_n);
 if(!all.length)return '<div class="panel muted">还没有任何证据文件（evidence/ 为空）。</div>';
 const eq=state.eq||'';const grp=all.filter(a=>evMatch(a,eq));
 if(grp.length===1&&eq)state.evOpen.add(grp[0].token);
 let h='<div class="panel"><div class="fbar" style="margin-bottom:0">'+
 '<span class="search" style="flex:1"><input id="evq" style="width:100%" placeholder="搜索证据：AC-94 / 94 / 标题 / GWT / Subtask / 文件名（已展开的 AC 搜完整文件名）" value="'+esc(eq)+'" oninput="feq(this.value)"><span class="k">/</span></span>'+
 '<span class="muted small nowrap">'+grp.length+' / '+all.length+' 条 AC · '+all.reduce((s,a)=>s+(a.ev_n||0),0)+' 个文件</span>'+
 '<button class="btn" data-act="ev-expand-all">全部展开</button><button class="btn" data-act="ev-collapse-all">全部收起</button>'+
 (eq?'<button class="btn" onclick="feq(\'\')">清空</button>':'')+'</div>'+
 (!SERVE&&!all.some(a=>a.ev_all)?'<div class="hint" style="margin-top:6px">当前是总览快照：每条 AC 只带前 8 个证据预览；完整清单请打开该需求的独立页（验证进度看板.html）或用 --serve 服务。</div>':'')+'</div>';
 if(!grp.length)return h+'<div class="panel muted">没有匹配「'+esc(eq)+'」的证据。</div>';
 h+=grp.map(a=>{const open=state.evOpen.has(a.token);
  const meta=[a.prefix,a.priority,(a.tags||[]).join('/')].filter(Boolean).join(' · ');
  let b='<div class="panel evac'+(open?' open':'')+(state.focusAc===a.token?' focus':'')+'" id="evac-'+a.token+'">'+
  '<div class="hd" data-act="ev-ac" data-ac="'+a.token+'"><span class="car">▸</span><b class="mono">'+esc(a.token)+'</b> '+badge(a.status)+' '+fbadge(a.final_status,a.status)+
  '<span class="tw2" title="'+esc(a.title)+'">'+esc(a.title)+'</span><span class="muted small nowrap">'+a.ev_n+' 个文件 · 媒体 '+(a.ev_media||0)+'</span></div>';
  if(open){const k=evKey(req,a);
   b+='<div class="bd">'+(a.dir_rel?'<div class="det-actions" style="margin-bottom:8px"><span class="lbl">原文</span>'+
   '<button class="btn primary" '+evAttrs(a.dir_rel+'/RESULT.md','md','RESULT.md · '+a.token,a.token)+'>RESULT.md</button>'+
   (a.has_replay?'<button class="btn" '+evAttrs(a.dir_rel+'/REPLAY.md','md','REPLAY.md · '+a.token,a.token)+'>REPLAY.md</button>':'')+
   '<button class="btn" '+evAttrs(a.dir_rel+'/case.md','md','case.md · '+a.token,a.token)+'>case.md</button></div>':'')+
   '<div class="det-sec" style="margin-bottom:12px"><h4>验收内容（Checklist）</h4><div class="small" style="margin-bottom:6px"><b>'+esc(a.title||a.token)+'</b>'+
   (meta?' <span class="muted">· '+esc(meta)+'</span>':'')+(a.subtaskKey?' <span class="subkey" style="margin-left:6px">'+esc(a.subtaskKey)+'</span>':'')+'</div>'+
   (a.gwt?'<pre class="gwt">'+esc(a.gwt)+'</pre>':'<div class="muted small">Checklist 中未找到该条 GWT</div>')+'</div>'+
   '<div class="det-sec"><h4>证据文件（'+a.ev_n+'）</h4>';
   if(EVC[k])b+=evList(req,a,EVC[k],'a:'+a.token);
   else if(typeof LOADING['e:'+k]==='string')b+='<div class="banner err small">加载失败：'+esc(LOADING['e:'+k])+'</div>';
   else{b+='<div class="muted small">加载中…</div>';ensure('e:'+k,()=>evItems(req,a));}
   b+='</div></div>';}
  return b+'</div>';}).join('');
 return h;}

// ---------------------------------------------------------------- 时间线 / 说明
function viewTimeline(req){const ds=(req.acs||[]).filter(a=>a.started_at).map(a=>{
 const s=new Date(a.started_at);const e=a.finished_at?new Date(a.finished_at):(a.updated_at?new Date(a.updated_at):null);return {a,s,e};}).filter(x=>!isNaN(x.s));
 if(!ds.length)return '<div class="panel muted">还没有任何 AC 被认领（无 started_at）。</div>';
 const t0=Math.min(...ds.map(x=>+x.s));const t1=Math.max(Date.now(),...ds.map(x=>x.e?+x.e:+Date.now()));const span=Math.max(1,t1-t0);
 const rows=ds.sort((x,y)=>x.s-y.s).map(({a,s,e})=>{const left=(+s-t0)/span*100;const w=((e?(+e-+s):(Date.now()-+s))/span*100);
  return '<div style="margin:6px 0"><div class="small mono" title="'+esc((a.session||'')+' '+(a.window||''))+'"><b>'+esc(a.token)+'</b> '+esc(a.session||"")+
  ' <span class="muted">'+(e?dur((e-s)/1000):dur((Date.now()-s)/1000)+"（进行中）")+'</span></div>'+
  '<div class="tl"><span style="left:'+left+'%;width:'+Math.max(0.6,w)+'%;background:'+COL[a.status]+'"></span></div></div>';}).join("");
 return '<div class="panel"><h3>时间线（'+ts(new Date(t0).toISOString())+' → 现在）</h3>'+rows+'<div class="hint">进行中的条延伸到“现在”；颜色=当前状态。</div></div>';}
function viewGuide(req){const m=metrics(req);
 return '<div class="panel"><h3>状态枚举</h3><div class="legend">'+STATUS_ORDER.map(s=>'<span>'+badge(s)+'</span>').join('')+'</div>'+
 '<div class="hint">只有 <b>通过</b> 对应 Checklist <b>[done]</b>；<b>验证中/修复中</b> 仍属 [open]。生命周期：待验证 → 验证中 →（发现问题）修复中 → 验证中（复验）→ 通过/失败/…<br>'+
 '<b>跳过</b> = 明确不做 / 不适用（斜纹）；<b>⬜ NOT_RUN（本轮没跑、待执行）算「待验证」，不是跳过</b>。</div>'+
 '<div class="hint" style="margin-top:10px"><b>证据终验</b>（独立维度，不重跑浏览器）：'+FC_ORDER.map(s=>fbadge(s)).join(" ")+
 '<br>全部 AC 跑完、证据采集完之后，逐条核对<b>证据内容是否支撑结论</b>：截图里是否真有期望值、证据时间/环境是否对得上这条 AC、<code>evidence/</code> 是否非空且能打开。'+
 '<b>已完结的 AC 都应过一遍</b>；终验不通过按「发现问题」处理。<b>终验通过不改变验证状态</b>，Checklist 仍按 status 回写。'+
 '<div class="mono small" style="margin-top:6px">python scripts/verify_state.py final --dir "&lt;需求目录&gt;" --ac ALL --session s1 --status 终验中</div></div></div>'+
 '<div class="panel"><h3>提测状态（与验证态分离）</h3><div class="hint" style="margin-bottom:6px"><b>需求门控</b>（总览）：</div>'+
 '<div class="legend" style="margin-bottom:8px">'+["未进入","待匹配","已匹配待确认","已提测","无需提测"].map(s=>'<span>'+hbadge(s)+'</span>').join('')+'</div>'+
 '<div class="hint" style="margin-bottom:6px"><b>用例「提测」列 = Subtask 级</b>（mapping Key + <code>jiraActions</code>）：</div>'+
 '<div class="legend" style="margin-bottom:8px">'+["未匹配","待提测","已提测","提测失败","待补记","无需提测"].map(s=>'<span>'+hbadge(s)+'</span>').join('')+'</div>'+
 '<div class="hint">需求终态只有 <b>已提测</b> / <b>无需提测</b>。用户说不提测 → 全员「无需提测」，不改 Jira。真正改 Jira 是按 Sub-task 逐条 transition/assign，结果进 <code>jiraActions</code>。</div></div>'+
 '<div class="panel"><h3>数据来源与刷新</h3><ul class="small">'+
 '<li><b>服务模式（实时）</b>：每 '+Math.round(POLL_MS/1000)+'s 发 1 个请求；服务端按需求目录文件签名缓存快照，未变化返回 <code>unchanged</code>；页面不可见时暂停（开了桌面通知时每 60s 检查一次产品确认）。</li>'+
 '<li><b>证据清单</b>：快照只带每条 AC 的计数 + 前 8 个预览，完整清单在「证据」页签展开时按需加载；同一子目录超过 50 个文件（录帧）折叠为一条。</li>'+
 '<li>当前：'+(SERVE?'服务模式':(HTTP?'静态 http（快照）':'file://（快照）'))+'；快照生成：'+esc(ts(req.generated_at))+'。</li>'+
 '<li>刷新静态产物：<code>python scripts/verify_dashboard.py --dir "'+esc(req.path||req.folder)+'"</code></li>'+
 '<li>实时服务：<code>python scripts/verify_dashboard.py --all --develop docs/develop --serve</code>（常驻：docs/develop/tools/dashboard_server.py，日志 tools/dashboard.log）</li></ul></div>'+
 '<div class="panel"><h3>快捷键</h3>'+keyTable()+'</div>'+
 '<div class="panel"><h3>本次快照统计</h3><div class="small muted">AC '+m.total+' · Subtask 已匹配 '+(req.acs||[]).filter(a=>a.subtaskKey).length+' · 提测 '+esc((req.handover||{}).status||'未进入')+
 ' · 证据文件 '+m.ev+'（媒体 '+m.med+'）· 回归项 '+m.regs.length+' · 风险 '+risks(req).length+'</div></div>';}
function keyTable(){return '<table><tbody>'+[["1 – 7","切换页签"],["j / k","下一条 / 上一条 AC（用例明细展开、证据页展开）"],["/","聚焦搜索框"],["r","立即刷新"],["← / →","灯箱内上一个 / 下一个（到头自动跨 AC）"],["滚轮 / 拖拽 / 双击","灯箱图片缩放 / 平移 / 复位"],["Esc","关闭灯箱 / 浮层"],["?","显示 / 隐藏快捷键"]].map(([k,t])=>'<tr><td><kbd>'+k+'</kbd></td><td>'+t+'</td></tr>').join('')+'</tbody></table>';}

// ---------------------------------------------------------------- 需求问答（Step1 记录）
const QA_ST=["已定","待PM确认","PM已确认"];
function mdInline(s){s=esc(s);const code=[];
 s=s.replace(/`([^`]+)`/g,(_,c)=>{code.push('<code>'+c+'</code>');return '\u0000'+(code.length-1)+'\u0000';});
 s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');s=s.replace(/(^|[^\w])__([^_]+)__(?!\w)/g,'$1<strong>$2</strong>');
 s=s.replace(/\*([^*\s][^*]*)\*/g,'<em>$1</em>');s=s.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g,'$1<em>$2</em>');
 s=s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
 return s.replace(/\u0000(\d+)\u0000/g,(_,i)=>code[+i]);}
function qaLines(s){return String(s||"").split('\n').map(x=>mdInline(x)).join('<br>');}
function qaBadge(s){return '<span class="badge st-'+esc(s)+'">'+esc(s||'—')+'</span>';}
function qaCanEdit(){return canAdmin();}
function qaCard(req,q,ro){const ed=!ro&&state.qaEdit===q.id;const pend=(req.qa.pending||[]).filter(c=>c.qid===q.id);const opts=q.options||[];
 let h='<div class="qa-card'+(q["状态"]==="待PM确认"?' pm':'')+(pend.length?' chg':'')+(ed?' editing':'')+'"'+(ro?'':' id="qa-'+esc(q.id)+'"')+'>'+
 '<div class="qa-head"><span class="qid">'+esc(q.id)+'</span><span class="qt">'+esc(q.title)+'</span>'+
 (ed?'<select id="qa-st" title="状态">'+QA_ST.map(s=>'<option'+(q["状态"]===s?' selected':'')+'>'+s+'</option>').join('')+'</select>':qaBadge(q["状态"]))+
 (pend.length?'<span class="badge b-run">改动待 AI 确认</span>':'')+
 (ed?'<button onclick="qaCancel()">取消</button><button class="qa-save" onclick="qaSave()">保存</button>'
   :(qaCanEdit()?'<button data-q="'+esc(q.id)+'" onclick="qaEdit(this.dataset.q)">'+(ro?'去编辑':'编辑')+'</button>':''))+'</div>'+
 (ed&&state.qaMsg?'<div class="banner err" style="margin-top:6px"><b>'+esc(state.qaMsg)+'</b>'+(state.qaConflict?' <button onclick="qaReload()">刷新最新内容</button>':'')+'</div>':'')+
 '<div class="qa-sec"><div class="lab">问题描述</div><div class="qa-txt">'+(q["问题描述"]?qaLines(q["问题描述"]):'<span class="muted">（未写问题描述）</span>')+'</div></div>';
 if(opts.length){h+='<div class="qa-sec"><div class="lab">候选项'+(ed?'（点选即改）':'（✓ 为当前所选）')+'</div><ul class="qa-opts'+(ed?' pick':'')+'">';
  if(ed){h+=opts.map(o=>'<li class="'+(q["已选"]===o.key?'on':'')+'"><label><input type="radio" name="qa-sel" value="'+esc(o.key)+'"'+(q["已选"]===o.key?' checked':'')+' onchange="qaPick(this.value)"> <b>'+esc(o.key)+'.</b> '+qaLines(o.text)+'</label></li>').join('')+
   '<li class="'+(q["已选"]==="自定义"?'on':'')+'"><label><input type="radio" name="qa-sel" value="自定义"'+(q["已选"]==="自定义"?' checked':'')+' onchange="qaPick(this.value)"> <b>自定义</b>（在下方「当前结论」里写）</label></li>';}
  else{h+=opts.map(o=>'<li class="'+(q["已选"]===o.key?'on':'')+'"><span class="mk">'+(q["已选"]===o.key?'✓':'')+'</span><b>'+esc(o.key)+'.</b> '+qaLines(o.text)+'</li>').join('')+
   (q["已选"]==="自定义"?'<li class="on"><span class="mk">✓</span><b>自定义</b>（见当前结论）</li>':'');}
  h+='</ul></div>';}
 const chg=pend.slice(-1)[0];const repick=chg&&chg.after["已选"]!==chg.before["已选"]&&chg.after["当前结论"]===chg.before["当前结论"];
 h+='<div class="qa-sec"><div class="lab">当前结论'+(ed?'（不用改：保存后 AI 按你的选择更新）':'')+'</div><div class="qa-txt">'+(q["当前结论"]?qaLines(q["当前结论"]):'<span class="muted">—</span>')+'</div>'+
 (repick&&!ed?'<div class="small" style="color:var(--run);margin-top:4px">已改选 '+esc(chg.after["已选"])+'，结论待 AI 确认后更新</div>':'')+
 (ed?'<div id="qa-custom" style="margin-top:8px;'+(q["已选"]==="自定义"?'':'display:none')+'"><div class="lab">自定义答复（必填，即为新的结论）</div><textarea id="qa-concl" class="qa-ta">'+(q["已选"]==="自定义"?esc(q["当前结论"]||''):'')+'</textarea></div>':'')+'</div>'+
 '<div class="qa-sec"><div class="lab">来源</div><div class="qa-txt small">'+qaLines(q["来源"])+'</div></div>';
 return h+'</div>';}
function qaCur(){const req=curSnap();return (((req||{}).qa||{}).questions||[]).find(x=>x.id===state.qaEdit);}
function qaPick(v){const q=qaCur();if(!q)return;
 document.querySelectorAll('#qa-'+q.id+' .qa-opts.pick li').forEach(li=>{const r=li.querySelector('input');li.classList.toggle('on',!!(r&&r.checked));});
 const o=(q.options||[]).find(x=>x.key===v);const st=document.getElementById('qa-st');
 const cb=document.getElementById('qa-custom');if(cb){cb.style.display=v==='自定义'?'':'none';if(v==='自定义'){const ta=document.getElementById('qa-concl');if(ta)ta.focus();}}
 if(o){if(/需要跟产品经理确认/.test(o.text))st.value="待PM确认";else if(st.value==="待PM确认")st.value="已定";}
 else if(v==='自定义'&&st.value==="待PM确认")st.value="已定";}
function qaEdit(id){const q=((curSnap().qa||{}).questions||[]).find(x=>x.id===id);state.qaEdit=id;state.qaRev=q&&q.rev;state.qaMsg="";state.qaConflict=false;render();
 const el=document.getElementById('qa-'+id);if(el)el.scrollIntoView({block:'center'});}
function qaCancel(){state.qaEdit=null;state.qaMsg="";state.qaConflict=false;render();}
async function qaReload(){state.qaEdit=null;state.qaMsg="";state.qaConflict=false;if(SERVE){DETAIL[state.folder]&&(DETAIL[state.folder].rev='');try{await fetchDetail(state.folder);}catch(e){}}render();}
async function qaSave(){const req=curSnap();const q=qaCur();if(!q)return;
 const sel=document.querySelector('input[name="qa-sel"]:checked');const fields={"状态":document.getElementById('qa-st').value};
 if(sel)fields["已选"]=sel.value;
 if(sel&&sel.value==='自定义'){const v=(document.getElementById('qa-concl').value||'').trim();if(!v){state.qaMsg='选择「自定义」时请填写自定义答复';render();return;}fields["当前结论"]=v;}
 try{const j=await postJSON('api/qa/save',{folder:req.folder,qid:q.id,fields,rev:state.qaRev||q.rev});
  req.qa=j.qa;state.qaEdit=null;state.qaMsg="";state.qaConflict=false;render();}
 catch(e){state.qaConflict=e.status===409;state.qaMsg=state.qaConflict?'已被他人修改，请刷新后再改（你的选择未保存）':'保存失败：'+(e&&e.message||e);
  if(state.qaConflict&&e.body&&e.body.qa)req.qa=e.body.qa;render();}}
function qaPmText(req,fmt){const items=((req.qa||{}).questions||[]).filter(q=>q["状态"]==="待PM确认");
 if(fmt==='csv'){const c=v=>'"'+String(v||'').replace(/"/g,'""')+'"';
  return '﻿'+[["编号","问题","问题描述","候选项","当前倾向 / 暂定","来源"].map(c).join(',')].concat(items.map(q=>[q.id,q.title,q["问题描述"],(q.options||[]).map(o=>o.key+'. '+o.text).join('\n'),q["当前结论"],q["来源"]].map(c).join(','))).join('\r\n');}
 let s='# 待产品确认问题（'+(req.id||'')+' '+(req.name||'')+'）\n\n共 '+items.length+' 条\n\n';
 items.forEach((q,i)=>{s+='## '+(i+1)+'. '+q.title+'（'+q.id+'）\n\n'+q["问题描述"]+'\n\n';
  if((q.options||[]).length)s+='候选项：\n\n'+q.options.map(o=>'- '+o.key+'. '+o.text).join('\n')+'\n\n';
  if(q["当前结论"])s+='当前倾向：'+q["当前结论"]+'\n\n';});return s;}
function qaDownload(fmt){const req=curSnap();const txt=qaPmText(req,fmt);
 const blob=new Blob([txt],{type:fmt==='csv'?'text/csv;charset=utf-8':'text/markdown;charset=utf-8'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='待产品确认-'+(req.id||req.folder)+'.'+(fmt==='csv'?'csv':'md');
 document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);}
async function copyText(t){try{await navigator.clipboard.writeText(t);}catch(e){const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}}
async function qaCopy(btn){await copyText(qaPmText(curSnap(),'md'));btn.textContent='已复制 ✓';setTimeout(()=>{btn.textContent='复制';},1600);}
function pmShares(req){const ss=(req.qa||{}).shares||[];if(!ss.length)return '';
 return '<div class="qa-sec"><div class="lab">已生成的产品确认链接（局域网内可打开；产品选择确认后，会作为「待 AI 确认」的改动回到这里）</div>'+
 ss.map(s=>'<div class="qa-tools" style="margin:4px 0"><input readonly value="'+esc(s.url)+'" style="flex:1;min-width:260px" onclick="this.select()">'+
 '<button data-u="'+esc(s.url)+'" onclick="pmCopy(this)">复制链接</button>'+
 '<span class="small muted">'+esc((s.qids||[]).join('、'))+' · 已答 '+(s.answers||0)+' 次 · 有效至 '+esc(ts(s.expires_at))+'</span>'+
 (qaCanEdit()?'<button data-t="'+esc(s.token)+'" onclick="pmRevoke(this.dataset.t)">作废</button>':'')+'</div>').join('')+'</div>';}
async function pmPost(path,body){const req=curSnap();const j=await postJSON('api/pm/'+path,Object.assign({folder:req.folder},body||{}));req.qa=j.qa;render();return j;}
async function pmShare(){try{const j=await pmPost('share');await copyText(j.url);
 alert('已生成并复制链接：\n'+j.url+'\n\n发给产品即可（需与你在同一内网 / VPN，且你的电脑开着）。');}catch(e){alert('生成失败：'+(e&&e.message||e));}}
async function pmRevoke(t){if(!confirm('作废这个链接？作废后产品将无法再打开。'))return;try{await pmPost('revoke',{token:t});}catch(e){alert('作废失败：'+(e&&e.message||e));}}
async function pmCopy(btn){await copyText(btn.dataset.u);btn.textContent='已复制 ✓';setTimeout(()=>{btn.textContent='复制链接';},1500);}
function notifyBtn(){if(!('Notification' in window))return '';
 if(Notification.permission==='granted')return '<span class="small muted">🔔 桌面通知已开启</span>';
 if(Notification.permission==='denied')return '<span class="small muted">桌面通知被浏览器禁止（在地址栏左侧的站点设置里允许）</span>';
 return '<button onclick="Notification.requestPermission().then(()=>render())">🔔 开启桌面通知（产品确认后提醒我）</button>';}
function pmChanges(qa){return ((qa||{}).pending||[]).filter(c=>String(c.by||'').startsWith('pm:'));}
function viewQa(req){const qa=req.qa||{};const qs=qa.questions||[];let h='';  // 文件损坏的红条由 topBanners() 统一显示（所有页签可见）
 if(!qa.exists)return h+'<div class="panel">尚无 <code>Step 1-需求澄清问答记录.md</code>。</div>';
 if(!qs.length)return h+'<div class="banner warn">问答记录还是旧版表格格式（待PM确认 '+(qa.legacy_pm||0)+' 行），看板无法逐题展示与编辑。按 step-01 的「一个问题一节」格式迁移后即可。</div>';
 if(!qaCanEdit())h+='<div class="banner warn"><b>只读</b>：编辑保存需要通过看板服务打开 —— <code>python scripts/verify_dashboard.py --dir "&lt;需求目录&gt;" --serve</code></div>';
 const pend=qa.pending||[];
 if(pend.length)h+='<div class="banner warn"><b>'+pend.length+' 条看板改动等待 AI 确认</b>：'+pend.map(c=>esc(c.qid)+'（'+esc(ts(c.at))+'）').join('、')+
  '。回到对话里告诉 AI「看板改了」，AI 会逐条列出改前 / 改后跟你确认，同步 Spec / Checklist 等下游后再标记为已确认。</div>';
 const cnt={};QA_ST.forEach(s=>cnt[s]=qs.filter(q=>q["状态"]===s).length);
 h+='<div class="agg-row">'+QA_ST.map(s=>'<div class="item"><span class="lab">'+s+'</span><span class="num"'+(s==='待PM确认'&&cnt[s]?' style="color:var(--fix)"':'')+'>'+cnt[s]+'</span></div>').join('')+
 '<div class="item"><span class="lab">共</span><span class="num">'+qs.length+'</span></div></div>';
 const pm=qs.filter(q=>q["状态"]==="待PM确认");
 h+='<div class="panel"><div class="qa-tools"><h3 style="margin:0">待产品确认（'+pm.length+'）</h3>'+notifyBtn()+'<span class="sp"></span>'+
 '<button onclick="qaCopy(this)"'+(pm.length?'':' disabled')+'>复制</button><button onclick="qaDownload(\'md\')"'+(pm.length?'':' disabled')+'>导出 .md</button>'+
 '<button onclick="qaDownload(\'csv\')"'+(pm.length?'':' disabled')+'>导出 .csv（Excel）</button>'+
 (qaCanEdit()?'<button onclick="pmShare()"'+(pm.length?'':' disabled')+' style="border-color:var(--acc);color:var(--acc);font-weight:600">生成产品确认链接</button>':'')+'</div>'+
 pmShares(req)+(pm.length?pm.map(q=>qaCard(req,q,true)).join(''):'<div class="muted" style="margin-top:6px">无待产品确认的问题。</div>')+'</div>';
 const pmDone=pmChanges(qa);
 if(pmDone.length){const byQ={};pmDone.forEach(c=>{byQ[c.qid]=c;});
  h+='<div class="panel" style="border-left:4px solid var(--ro)"><div class="qa-tools"><h3 style="margin:0">产品已确认（待处理 '+Object.keys(byQ).length+'）</h3><span class="sp"></span>'+
  '<span class="small muted">回到对话告诉 AI「产品确认了」，AI 逐条跟你确认后同步下游</span></div>'+
  Object.values(byQ).map(c=>{const q=qs.find(x=>x.id===c.qid);if(!q)return '';
   return '<div class="small" style="margin:10px 0 -4px;color:var(--ro)"><b>'+esc(String(c.by||'').replace(/^pm:/,'')||'产品')+'</b> 于 '+esc(ts(c.at))+' 确认</div>'+qaCard(req,q,true);}).join('')+'</div>';}
 const groups=(qa.groups||[]).filter(g=>qs.some(q=>q.group===g));if(qs.some(q=>!q.group))groups.unshift('');
 groups.forEach(g=>{const list=qs.filter(q=>(q.group||'')===g);h+='<div class="panel"><h3>'+esc(g||'未分组')+'（'+list.length+'）</h3>'+list.map(q=>qaCard(req,q)).join('')+'</div>';});
 return h;}
function checkPmNotify(){const all=[];(LIST.reqs||[]).forEach(r=>(r.pm_changes||[]).forEach(c=>all.push([r,c])));
 if(state.seenChg===undefined){state.seenChg=new Set(all.map(x=>x[1].id));return;}
 all.forEach(([r,c])=>{if(state.seenChg.has(c.id))return;state.seenChg.add(c.id);
  if('Notification' in window&&Notification.permission==='granted'){
   const n=new Notification('产品已确认 '+c.qid+' · '+(r.id||''),{body:(c.title||'')+'\n'+(c.concl||''),tag:c.id});
   n.onclick=()=>{window.focus();go(r.folder,'qa');n.close();};}});}

// ---------------------------------------------------------------- 灯箱：文本预览 / 图片缩放拖拽 / 跨 AC 浏览
let modalText=null,modalIsMd=false,mdViewMode='preview';
let navList=[],navIdx=-1,navCtx={};
const zoom={s:1,x:0,y:0};
function mdIsSep(line){return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line||'');}
function mdToHtml(src){src=String(src||'').replace(/\r\n?/g,'\n');const fences=[];
 src=src.replace(/```([\w-]*)\n([\s\S]*?)```/g,(_,lang,code)=>{const i=fences.length;fences.push('<pre class="md-code"><code>'+esc(code.replace(/\n$/,''))+'</code></pre>');return '\n%%F'+i+'%%\n';});
 const lines=src.split('\n');let html='',i=0;
 const isBlockStart=l=>{const t=(l||'').trim();return !t||/^%%F\d+%%$/.test(t)||/^#{1,6}\s/.test(l)||/^(-{3,}|\*{3,}|_{3,})$/.test(t)||/^\|/.test(t)||/^>\s?/.test(l)||/^[-*+]\s+/.test(l)||/^\d+\.\s+/.test(l);};
 while(i<lines.length){const line=lines[i],trim=line.trim();const fm=/^%%F(\d+)%%$/.exec(trim);
  if(fm){html+=fences[+fm[1]]||'';i++;continue;}if(!trim){i++;continue;}
  const hm=/^(#{1,6})\s+(.*)$/.exec(line);if(hm){const n=hm[1].length;html+='<h'+n+'>'+mdInline(hm[2])+'</h'+n+'>';i++;continue;}
  if(/^(-{3,}|\*{3,}|_{3,})$/.test(trim)){html+='<hr>';i++;continue;}
  if(/^\|/.test(trim)&&i+1<lines.length&&mdIsSep(lines[i+1].trim())){const rows=[];while(i<lines.length&&/^\|/.test(lines[i].trim())){rows.push(lines[i]);i++;}
   if(rows.length>=2){const split=r=>r.replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());const head=split(rows[0]);const bodyRows=rows.slice(2).map(split);
    html+='<table><thead><tr>'+head.map(c=>'<th>'+mdInline(c)+'</th>').join('')+'</tr></thead><tbody>'+bodyRows.map(r=>'<tr>'+r.map(c=>'<td>'+mdInline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
   continue;}
  if(/^>\s?/.test(line)){const buf=[];while(i<lines.length&&/^>\s?/.test(lines[i])){buf.push(lines[i].replace(/^>\s?/,''));i++;}html+='<blockquote>'+mdInline(buf.join(' '))+'</blockquote>';continue;}
  if(/^[-*+]\s+/.test(line)||/^\d+\.\s+/.test(line)){const ordered=/^\d+\.\s+/.test(line);const tag=ordered?'ol':'ul';const buf=[];
   while(i<lines.length&&(ordered?/^\d+\.\s+/.test(lines[i]):/^[-*+]\s+/.test(lines[i]))){buf.push(lines[i].replace(ordered?/^\d+\.\s+/:/^[-*+]\s+/,''));i++;}
   html+='<'+tag+'>'+buf.map(x=>'<li>'+mdInline(x)+'</li>').join('')+'</'+tag+'>';continue;}
  const para=[line];i++;while(i<lines.length&&!isBlockStart(lines[i])){para.push(lines[i]);i++;}html+='<p>'+mdInline(para.join(' '))+'</p>';}
 return html||'<p class="muted">（空文件）</p>';}
function setMdView(mode){mdViewMode=mode==='source'?'source':'preview';
 document.getElementById('btn-md-preview').classList.toggle('on',mdViewMode==='preview');document.getElementById('btn-md-source').classList.toggle('on',mdViewMode==='source');renderModalText();}
function renderModalText(){const body=document.getElementById('modal-body');if(!body||modalText==null)return;
 if(modalIsMd&&mdViewMode==='preview')body.innerHTML='<div class="md-view">'+mdToHtml(modalText)+'</div>';else{body.innerHTML='<pre></pre>';body.firstChild.textContent=modalText;}}
function acByToken(tok){const r=curSnap();return r&&(r.acs||[]).find(a=>a.token===tok);}
function navForAc(req,a,items){const L=[];
 if(a.dir_rel){L.push({rel:a.dir_rel+'/RESULT.md',type:'md',title:'RESULT.md · '+a.token,ac:a.token});
  if(a.has_replay)L.push({rel:a.dir_rel+'/REPLAY.md',type:'md',title:'REPLAY.md · '+a.token,ac:a.token});
  L.push({rel:a.dir_rel+'/case.md',type:'md',title:'case.md · '+a.token,ac:a.token});}
 (items||[]).filter(e=>e.t!=='group').forEach(e=>L.push({rel:evRel(a,e),type:e.t,title:baseName(e.p),ac:a.token}));return L;}
function buildNav(rel,ctx){const req=curSnap();if(!req)return [];
 const ims=req.ui_images||[];if(ims.includes(rel))return ims.map(r=>({rel:r,type:'image',title:figName(r)}));
 const sf=req.step_files||{};for(const k in sf){if(sf[k].some(f=>f.rel===rel))return sf[k].map(f=>({rel:f.rel,type:f.type,title:f.name}));}
 const a=ctx.ac&&acByToken(ctx.ac);if(!a)return [];
 if(ctx.grp){const g=EVG[evKey(req,a)+'|'+ctx.grp]||[];return g.map(e=>({rel:evRel(a,e),type:e.t,title:baseName(e.p),ac:a.token,grp:ctx.grp}));}
 return navForAc(req,a,EVC[evKey(req,a)]||a.ev||[]);}
function openEv(rel,type,title,ctx,keepNav){ctx=ctx||{};const url=evUrl(rel),name=title||baseName(rel);
 if(!keepNav){navCtx=ctx;navList=buildNav(rel,ctx);navIdx=navList.findIndex(x=>x.rel===rel);
  // 完整清单尚未加载：后台取回后重建导航（保持当前位置）
  const req=curSnap(),a=ctx.ac&&acByToken(ctx.ac);
  if(req&&a&&!ctx.grp&&!EVC[evKey(req,a)]&&SERVE&&a.ev_n>(a.ev||[]).length)
   evItems(req,a).then(()=>{if(navCtx!==ctx)return;navList=buildNav(rel,ctx);navIdx=navList.findIndex(x=>x.rel===(navList[navIdx]||{}).rel||rel);if(navIdx<0)navIdx=navList.findIndex(x=>x.rel===rel);showNav();}).catch(()=>{});}
 showNav();
 const m=document.getElementById('modal'),body=document.getElementById('modal-body'),tog=document.getElementById('modal-view-toggle');
 document.getElementById('modal-title').textContent=name+(ctx.ac&&name.indexOf(ctx.ac)<0?'  ·  '+ctx.ac:'');
 document.getElementById('modal-raw').href=url;document.getElementById('modal-zoom').textContent='';
 modalText=null;modalIsMd=false;mdViewMode='preview';tog.style.display='none';body.className='modal-body';
 m.classList.add('open');
 if(type==='image'){zoom.s=1;zoom.x=0;zoom.y=0;body.className='modal-body img';body.innerHTML='<img alt="" draggable="false" src="'+url+'">';applyZoom();return;}
 if(type==='video'){body.innerHTML='<video controls autoplay preload="metadata" src="'+url+'"></video>';return;}
 const ext=(name.split('.').pop()||'').toLowerCase();
 const asText=['json','har','log','data','md'].includes(type)||['md','markdown','txt','text','rst','csv','log','json','har','sql'].includes(ext);
 const isMd=type==='md'||['md','markdown','rst'].includes(ext);
 if(asText){body.innerHTML='<div class="muted">加载中…</div>';
  fetch(url,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text();})
  .then(t=>{modalText=t;modalIsMd=isMd;mdViewMode='preview';tog.style.display=isMd?'inline-flex':'none';
   document.getElementById('btn-md-preview').classList.add('on');document.getElementById('btn-md-source').classList.remove('on');renderModalText();})
  .catch(e=>{body.innerHTML='<div class="banner warn">无法内联预览（'+esc(e.message)+'）。'+(location.protocol==='file:'?'<br>file:// 下浏览器禁止读取本地文件：请用 http 打开看板（8787），或点右上角「新标签打开 ↗」。':'')+'</div>';});
  return;}
 body.innerHTML='<div class="banner warn">该类型不支持内联预览（如 Excel / 压缩包 / 二进制）：请点右上角「新标签打开 ↗」。</div>';}
function showNav(){const nav=document.getElementById('modal-nav'),pos=document.getElementById('modal-pos');
 const on=navList.length>=1&&navIdx>=0&&(navList.length>=2||navCtx.ac);nav.style.display=on?'flex':'none';if(!on)return;
 const cur=navList[navIdx]||{};pos.textContent=(cur.ac?cur.ac+' · ':'')+(navIdx+1)+' / '+navList.length+(navCtx.grp?'（'+navCtx.grp+'）':'');
 const cross=!!(navCtx.ac&&!navCtx.grp);
 document.getElementById('nav-prev').disabled=navIdx<=0&&!(cross&&neighborAc(-1));
 document.getElementById('nav-next').disabled=navIdx>=navList.length-1&&!(cross&&neighborAc(1));}
function neighborAc(d){const req=curSnap();if(!req||!navCtx.ac)return null;const L=(req.acs||[]).filter(a=>a.ev_n||a.dir_rel);
 const i=L.findIndex(a=>a.token===navCtx.ac);return i<0?null:L[i+d]||null;}
async function navStep(d){const j=navIdx+d;
 if(j>=0&&j<navList.length){navIdx=j;const x=navList[j];openEv(x.rel,x.type,x.title,navCtx,true);return;}
 if(!navCtx.ac||navCtx.grp)return;
 const b=neighborAc(d);if(!b)return;const req=curSnap();
 let items=b.ev||[];try{items=await evItems(req,b);}catch(e){}
 navCtx={ac:b.token};navList=navForAc(req,b,items);navIdx=d>0?0:navList.length-1;const x=navList[navIdx];if(x)openEv(x.rel,x.type,x.title,navCtx,true);}
function closeModal(){navList=[];navIdx=-1;navCtx={};const m=document.getElementById('modal');m.classList.remove('open');
 const b=document.getElementById('modal-body');b.innerHTML='';b.className='modal-body';document.getElementById('modal-view-toggle').style.display='none';modalText=null;modalIsMd=false;}
function applyZoom(){const img=document.querySelector('#modal-body.img img');if(!img)return;
 img.style.transform='translate('+zoom.x+'px,'+zoom.y+'px) scale('+zoom.s+')';
 document.getElementById('modal-zoom').textContent=Math.round(zoom.s*100)+'% · 滚轮缩放 / 拖拽平移 / 双击复位';}
(function lightboxInput(){const body=document.getElementById('modal-body');let drag=null;
 body.addEventListener('wheel',e=>{if(!body.classList.contains('img'))return;e.preventDefault();
  const r=body.getBoundingClientRect();const cx=e.clientX-r.left-r.width/2,cy=e.clientY-r.top-r.height/2;
  const ns=Math.min(12,Math.max(0.2,zoom.s*(e.deltaY<0?1.15:1/1.15)));const k=ns/zoom.s;
  zoom.x=cx-(cx-zoom.x)*k;zoom.y=cy-(cy-zoom.y)*k;zoom.s=ns;applyZoom();},{passive:false});
 body.addEventListener('mousedown',e=>{if(!body.classList.contains('img')||e.button!==0)return;e.preventDefault();drag={x:e.clientX,y:e.clientY,ox:zoom.x,oy:zoom.y};body.classList.add('drag');});
 window.addEventListener('mousemove',e=>{if(!drag)return;zoom.x=drag.ox+e.clientX-drag.x;zoom.y=drag.oy+e.clientY-drag.y;applyZoom();});
 window.addEventListener('mouseup',()=>{if(drag){drag=null;body.classList.remove('drag');}});
 body.addEventListener('dblclick',()=>{if(!body.classList.contains('img'))return;if(zoom.s!==1||zoom.x||zoom.y){zoom.s=1;zoom.x=0;zoom.y=0;}else zoom.s=2;applyZoom();});
 document.getElementById('modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal();});})();

// ---------------------------------------------------------------- 路由 / 交互
function syncHash(){let h='#';if(state.view==='one'&&state.folder&&!SINGLE)h='#/'+encodeURIComponent(state.folder)+(state.tab!=='overview'?'/'+state.tab:'');
 else if(SINGLE)h=state.tab!=='overview'?'#/'+encodeURIComponent(SINGLE)+'/'+state.tab:'';
 if(location.hash!==h&&!(h===''&&!location.hash))history.replaceState(null,'',h||(location.pathname+location.search));}
function resetReqUi(){state.open.clear();state.evOpen.clear();state.evShowAll.clear();state.evGroupOpen.clear();state.openR.clear();state.stepOpen=null;state.focusAc=null;state.rowsShown=ROWS_STEP;state.qaEdit=null;state.eq='';}
function go(folder,tabk){if(state.folder!==folder)resetReqUi();state.folder=folder;state.view='one';state.tab=tabk||'overview';syncHash();render();window.scrollTo(0,0);}
function tab(k){state.tab=k;state.qaEdit=null;syncHash();render();}
function back(){if(SINGLE)return;state.view='all';state.qaEdit=null;history.replaceState(null,'','#');render();if(SERVE)tick(true);}
function fromHash(){const parts=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean).map(x=>{try{return decodeURIComponent(x);}catch(e){return x;}});
 if(SINGLE){state.tab=(parts[1]&&TAB_KEYS.includes(parts[1]))?parts[1]:'overview';return;}
 const f=parts[0];const known=(LIST.reqs||[]).some(r=>r.folder===f);
 if(f&&known){if(state.folder!==f)resetReqUi();state.folder=f;state.view='one';state.tab=(parts[1]&&TAB_KEYS.includes(parts[1]))?parts[1]:'overview';}
 else{state.view='all';}}
window.addEventListener('hashchange',()=>{fromHash();state.qaEdit=null;render();if(SERVE&&state.view==='one')tick(true);});
function keepRow(selector,fn){const el=document.querySelector(selector);const y0=el?el.getBoundingClientRect().top:null;fn();
 if(y0==null)return;const el2=document.querySelector(selector);if(el2)window.scrollBy(0,el2.getBoundingClientRect().top-y0);}
function toggle(t){keepRow('tr[data-ac="'+t+'"]',()=>{state.open.has(t)?state.open.delete(t):state.open.add(t);state.focusAc=t;render();});}
function toggleR(t){keepRow('tr[data-r="'+t+'"]',()=>{state.openR.has(t)?state.openR.delete(t):state.openR.add(t);render();});}
function frv(s){state.rv.has(s)?state.rv.delete(s):state.rv.add(s);render();}
function fq(v){state.filter.q=v;state.rowsShown=ROWS_STEP;render();}
function gotoAc(tok){state.tab='cases';state.open.add(tok);state.focusAc=tok;
 const req=curSnap();const list=req?filtered(req):[];if(!list.some(a=>a.token===tok)){state.filter.status.clear();state.filter.fc.clear();state.filter.risk=false;state.filter.ev=false;state.filter.q='';}
 const idx=filtered(req).findIndex(a=>a.token===tok);if(idx>=state.rowsShown)state.rowsShown=idx+ROWS_STEP;
 syncHash();render();const el=document.querySelector('tr[data-ac="'+tok+'"]');if(el)el.scrollIntoView({block:'center'});}
function gotoEv(tok){state.tab='evidence';state.evOpen.add(tok);state.focusAc=tok;state.eq='';syncHash();render();
 const el=document.getElementById('evac-'+tok);if(el)el.scrollIntoView({block:'start'});}
function stepAc(d){const req=curSnap();if(!req)return;
 if(state.tab==='cases'){const list=filtered(req);if(!list.length)return;let i=list.findIndex(a=>a.token===state.focusAc);
  i=i<0?(d>0?0:list.length-1):Math.max(0,Math.min(list.length-1,i+d));const t=list[i].token;
  if(state.focusAc&&state.focusAc!==t)state.open.delete(state.focusAc);state.open.add(t);state.focusAc=t;if(i>=state.rowsShown)state.rowsShown=i+1;render();
  const el=document.querySelector('tr[data-ac="'+t+'"]');if(el)el.scrollIntoView({block:'start'});}
 else if(state.tab==='evidence'){const list=(req.acs||[]).filter(a=>a.ev_n&&evMatch(a,state.eq));if(!list.length)return;let i=list.findIndex(a=>a.token===state.focusAc);
  i=i<0?(d>0?0:list.length-1):Math.max(0,Math.min(list.length-1,i+d));const t=list[i].token;
  if(state.focusAc&&state.focusAc!==t)state.evOpen.delete(state.focusAc);state.evOpen.add(t);state.focusAc=t;render();
  const el=document.getElementById('evac-'+t);if(el)el.scrollIntoView({block:'start'});}}
function toggleKeyHelp(){state.keyHelp=!state.keyHelp;let el=document.getElementById('keyhelp');
 if(!state.keyHelp){if(el)el.remove();return;}
 el=document.createElement('div');el.id='keyhelp';el.className='keyhelp';el.innerHTML='<div style="display:flex;align-items:center;margin-bottom:6px"><b>快捷键</b><span class="sp"></span><button data-act="keyhelp">✕</button></div>'+keyTable();document.body.appendChild(el);}
// 统一事件委托（数据属性，避免把需求目录名拼进内联 JS）
document.addEventListener('click',e=>{
 const ev=e.target.closest('[data-ev]');
 if(ev){e.preventDefault();e.stopPropagation();openEv(decodeURIComponent(ev.dataset.ev),ev.dataset.type,ev.dataset.title||'',{ac:ev.dataset.ac||'',grp:ev.dataset.grp||''});return;}
 const t=e.target.closest('[data-act]');if(!t)return;const act=t.dataset.act;
 if(act==='toggle'){if(e.target.closest('a,button,input'))return;toggle(t.dataset.ac);}
 else if(act==='goto-ac')gotoAc(t.dataset.ac);
 else if(act==='goto-ev')gotoEv(t.dataset.ac);
 else if(act==='sort'){const k=t.dataset.k,s=state.sort;if(s.key!==k){s.key=k;s.dir=1;}else if(s.dir===1)s.dir=-1;else{s.key=null;s.dir=1;}lsSet('vd_sort',s);render();}
 else if(act==='fstat'){const s=t.dataset.s;state.filter.status.has(s)?state.filter.status.delete(s):state.filter.status.add(s);state.rowsShown=ROWS_STEP;saveFilters();render();}
 else if(act==='ffc'){const s=t.dataset.s;state.filter.fc.has(s)?state.filter.fc.delete(s):state.filter.fc.add(s);state.rowsShown=ROWS_STEP;saveFilters();render();}
 else if(act==='more-rows'){state.rowsShown+=ROWS_STEP;render();}
 else if(act==='ev-ac'){const k=t.dataset.ac;state.evOpen.has(k)?state.evOpen.delete(k):state.evOpen.add(k);state.focusAc=k;render();}
 else if(act==='ev-all'){state.evShowAll.add(t.dataset.k);render();}
 else if(act==='ev-grp'){const k=t.dataset.k;state.evGroupOpen.has(k)?state.evGroupOpen.delete(k):state.evGroupOpen.add(k);render();}
 else if(act==='ev-expand-all'){const req=curSnap();(req.acs||[]).filter(a=>a.ev_n&&evMatch(a,state.eq)).slice(0,20).forEach(a=>state.evOpen.add(a.token));render();}
 else if(act==='ev-collapse-all'){state.evOpen.clear();render();}
 else if(act==='modal-close')closeModal();
 else if(act==='nav-prev')navStep(-1);
 else if(act==='nav-next')navStep(1);
 else if(act==='md-preview')setMdView('preview');
 else if(act==='md-source')setMdView('source');
 else if(act==='keyhelp')toggleKeyHelp();});
document.addEventListener('change',e=>{const t=e.target.closest('[data-act]');if(!t)return;
 if(t.dataset.act==='frisk'){state.filter.risk=t.checked;saveFilters();render();}
 else if(t.dataset.act==='fev'){state.filter.ev=t.checked;saveFilters();render();}});
document.addEventListener('keydown',e=>{const modal=document.getElementById('modal').classList.contains('open');
 if(e.key==='Escape'){if(modal)closeModal();else if(state.keyHelp)toggleKeyHelp();else if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();return;}
 if(modal){if(e.key==='ArrowLeft'){e.preventDefault();navStep(-1);}else if(e.key==='ArrowRight'){e.preventDefault();navStep(1);}
  else if(e.key==='+'||e.key==='='){zoom.s=Math.min(12,zoom.s*1.25);applyZoom();}else if(e.key==='-'){zoom.s=Math.max(.2,zoom.s/1.25);applyZoom();}else if(e.key==='0'){zoom.s=1;zoom.x=0;zoom.y=0;applyZoom();}
  return;}
 const tg=e.target;if(tg&&(tg.tagName==='INPUT'||tg.tagName==='TEXTAREA'||tg.tagName==='SELECT'||tg.isContentEditable))return;
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.key==='/'){const el=document.getElementById('q')||document.getElementById('evq')||document.getElementById('lq');if(el){e.preventDefault();el.focus();el.select();}return;}
 if(e.key==='?'){toggleKeyHelp();return;}
 if(e.key==='r'||e.key==='R'){tick(true);return;}
 if(state.view!=='one')return;
 if(/^[1-7]$/.test(e.key)){tab(TAB_KEYS[+e.key-1]);return;}
 if(e.key==='j'){stepAc(1);}else if(e.key==='k'){stepAc(-1);}});

// ---------------------------------------------------------------- 启动
(function init(){
 themeApply(themeGet());
 document.getElementById('theme').onclick=()=>{const order=['auto','light','dark'];themeApply(order[(order.indexOf(themeGet())+1)%3]);};
 document.getElementById('refresh').onclick=()=>{if(SERVE){LIST.rev=LIST.rev||'';}tick(true);};
 document.getElementById('keys').onclick=toggleKeyHelp;
 const tt=document.getElementById('title');
 tt.textContent=SINGLE?('验证进度看板 · '+(((LIST.reqs||[])[0]||{}).id||'')+' '+(((LIST.reqs||[])[0]||{}).name||'')):'验证进度看板 · 所有进行中需求';tt.title=tt.textContent;
 const top=document.getElementById('top');const setTop=()=>document.documentElement.style.setProperty('--toph',top.offsetHeight+'px');
 setTop();window.addEventListener('resize',setTop);if(window.ResizeObserver)new ResizeObserver(setTop).observe(top);
 fromHash();render();checkPmNotify();
 if(SERVE){if(state.view==='one'&&!DETAIL[state.folder]){/* render() 已触发加载 */}
  setInterval(()=>tick(false),POLL_MS);
  // 页面不可见：暂停 5s 轮询；开了桌面通知时每 60s 只查一次列表（产品确认提醒不丢）
  setInterval(()=>{if(document.hidden&&'Notification' in window&&Notification.permission==='granted')fetchList().then(ch=>{checkPmNotify();if(ch)render();}).catch(()=>{});},60000);
  document.addEventListener('visibilitychange',()=>{setConn();if(!document.hidden)tick(true);});
  state.conn='live';setConn();}
 else{setConn();if(HTTP&&state.view==='one'){pollRegistry(false);setInterval(()=>{if(!document.hidden)pollRegistry(false);},POLL_MS);}}
 setInterval(setConn,30000);})();
