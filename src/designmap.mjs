import fs from 'node:fs';
import path from 'node:path';

/**
 * 게임 설계 지도 — 시스템·재화·테이블·기획서·코드가 어떻게 연결되는지.
 * 데이터: <작업폴더>/.ddalgi/index/design-map.json
 * 보기:   <작업폴더>/.ddalgi/index/설계지도.html (오른쪽 패널에서 연다 — 혼자 열리는 한 파일)
 *
 * 뼈대(문서·시트 탭·테이블↔코드 매핑)는 카탈로그와 project.yaml 에서 자동으로 만들고,
 * 시스템·재화 같은 의미 노드와 연결은 🗺 설계 지도 스킬(에이전트)이 채운다.
 */

export const MAP_REL = '.ddalgi/index/design-map.json';
export const VIEWER_REL = '.ddalgi/index/설계지도.html';
export const NODE_TYPES = ['system', 'currency', 'table', 'doc', 'code', 'card', 'other'];
export const EDGE_KINDS = ['정의', '사용', '저장', '참조', '구현', '관련'];

export function loadMap(workDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(workDir, MAP_REL), 'utf-8'));
  } catch {
    return null;
  }
}

const slug = (s) =>
  String(s)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** 카탈로그·매핑에서 자동으로 만드는 뼈대 (의미 노드 없이 '무엇이 있는지'만). */
export function buildSkeleton(workDir, project = {}) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const add = (n) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };
  let cat = '';
  try {
    cat = fs.readFileSync(path.join(workDir, '.ddalgi', 'index', 'catalog.md'), 'utf-8');
  } catch {
    /* 카탈로그 없음 — 매핑만 */
  }
  for (const m of cat.matchAll(/^- (.+?) \[(doc|presentation)\] id=([\w-]+)/gm)) {
    add({ id: 'doc:' + m[3], type: 'doc', label: m[1].trim(), ref: { kind: 'doc', id: m[3] }, auto: true });
  }
  // ### 시트 "이름" 탭 (n개) — id=XXX  다음 줄: 탭(행×열) · 탭(행×열) …
  for (const m of cat.matchAll(/^### 시트 "(.+?)" 탭 \(\d+개\) — id=([\w-]+)\n(.+)$/gm)) {
    const sheetId = m[2];
    for (const t of m[3].split(' · ')) {
      const tab = t.replace(/\(\d+×\d+\)\s*$/, '').trim();
      if (!tab || /^…/.test(tab)) continue;
      add({ id: `table:${sheetId}:${slug(tab)}`, type: 'table', label: tab, group: m[1], ref: { kind: 'sheet', id: sheetId, tab }, auto: true });
    }
  }
  for (const mp of project.table_code_mappings ?? []) {
    if (!mp?.code_file) continue;
    const codeId = 'code:' + mp.code_file;
    add({ id: codeId, type: 'code', label: path.basename(mp.code_file), ref: { kind: 'file', path: mp.code_file }, auto: true });
    const tab = mp.tab || mp.table;
    const tbl = nodes.find((n) => n.type === 'table' && (n.label === tab || n.label === mp.table));
    const tableId = tbl?.id || `table:${slug(mp.table)}`;
    if (!tbl) add({ id: tableId, type: 'table', label: mp.table, ref: { kind: 'sheet', tab: mp.tab }, auto: true });
    edges.push({ from: codeId, to: tableId, kind: '구현', why: `매핑 선언 ${mp.key_column || ''} ↔ ${mp.code_symbol || ''}`.trim(), auto: true });
  }
  return { nodes, edges };
}

/** 저장 전 정리 — 종류·필수값 검사, 중복 제거, 끝이 없는 연결 제거, 사용자 메모 보존. */
export function normalizeMap(input, prev) {
  const prevNotes = new Map((prev?.nodes ?? []).filter((n) => n.note).map((n) => [n.id, n.note]));
  const nodes = [];
  const ids = new Set();
  const dropped = [];
  for (const n of input?.nodes ?? []) {
    if (!n || !n.id || !n.label) continue;
    if (!n.ref && !['system', 'currency'].includes(n.type)) {
      dropped.push(`${n.label}(출처 없음)`);
      continue;
    }
    if (ids.has(n.id)) continue;
    ids.add(n.id);
    nodes.push({
      id: String(n.id),
      type: NODE_TYPES.includes(n.type) ? n.type : 'other',
      label: String(n.label).slice(0, 80),
      ...(n.group ? { group: String(n.group) } : {}),
      ...(n.summary ? { summary: String(n.summary).slice(0, 400) } : {}),
      ...(n.ref ? { ref: n.ref } : {}),
      ...(n.note || prevNotes.get(n.id) ? { note: String(n.note || prevNotes.get(n.id)) } : {}),
      ...(n.auto ? { auto: true } : {}),
    });
  }
  const edges = [];
  const ek = new Set();
  for (const e of input?.edges ?? []) {
    if (!e || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const kind = EDGE_KINDS.includes(e.kind) ? e.kind : '관련';
    const k = `${e.from}|${e.to}|${kind}`;
    if (ek.has(k)) continue;
    ek.add(k);
    edges.push({ from: e.from, to: e.to, kind, ...(e.why ? { why: String(e.why).slice(0, 200) } : {}), ...(e.auto ? { auto: true } : {}) });
  }
  return { nodes, edges, dropped };
}

export function saveMap(workDir, input, title = '') {
  const prev = loadMap(workDir);
  const { nodes, edges, dropped } = normalizeMap(input, prev);
  const map = { version: 1, title: title || prev?.title || path.basename(workDir), updatedAt: new Date().toISOString(), nodes, edges };
  const file = path.join(workDir, MAP_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 1));
  writeViewer(workDir, map);
  const prevIds = new Set((prev?.nodes ?? []).map((n) => n.id));
  return {
    nodes: nodes.length,
    edges: edges.length,
    added: nodes.filter((n) => !prevIds.has(n.id)).length,
    dropped,
    byType: Object.fromEntries(NODE_TYPES.map((t) => [t, nodes.filter((n) => n.type === t).length]).filter(([, c]) => c)),
  };
}

/** 보기 HTML 을 (다시) 만든다. 지도가 없으면 뼈대로 그린다. 반환: 작업폴더 기준 상대 경로. */
export function writeViewer(workDir, map, project) {
  const m = map || loadMap(workDir) || { title: path.basename(workDir), updatedAt: null, skeletonOnly: true, ...buildSkeleton(workDir, project) };
  const file = path.join(workDir, VIEWER_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderViewer(m));
  return VIEWER_REL;
}

function renderViewer(map) {
  const data = JSON.stringify(map).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>🗺 설계 지도 — ${escapeHtml(map.title || '')}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--bg:#f7f7f5;--panel:#fff;--ink:#1d2433;--dim:#667085;--line:#d0d5dd;--hl:#e33d4b;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--panel:#171a24;--ink:#e6e8f0;--dim:#9aa3bd;--line:#2a3042;--hl:#ff6b77;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;height:100vh;display:flex;flex-direction:column}
header{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--panel)}
header h1{font-size:14px;margin:0 6px 0 0}header .meta{color:var(--dim);font-size:12px}
input[type=search]{flex:1 1 160px;min-width:120px;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.chips{display:flex;flex-wrap:wrap;gap:4px}.chip{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:999px;padding:3px 9px;font-size:12px;cursor:pointer}
.chip.off{opacity:.35}.chip i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
main{flex:1;display:flex;min-height:0}#stage{flex:1;position:relative;min-width:0;min-height:0}
@media (max-width:760px){main{flex-direction:column}#side{width:auto!important;max-width:none!important;max-height:38%;border-left:0!important;border-top:1px solid var(--line)}}svg{width:100%;height:100%;display:block;cursor:grab}
#side{width:300px;max-width:45%;border-left:1px solid var(--line);background:var(--panel);padding:12px;overflow:auto}
#side h2{font-size:15px;margin:2px 0 4px}#side .t{color:var(--dim);font-size:12px}#side ul{padding-left:16px;margin:6px 0}#side li{margin:3px 0;cursor:pointer}
#side a{color:var(--hl)}#side .note{background:var(--bg);border-radius:8px;padding:8px;margin-top:8px;white-space:pre-wrap}
button.impact{margin-top:8px;border:1px solid var(--hl);color:var(--hl);background:transparent;border-radius:8px;padding:5px 10px;cursor:pointer}
button.impact.on{background:var(--hl);color:#fff}
.empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dim);text-align:center;padding:20px}
text{font-size:11px;fill:var(--ink);pointer-events:none}line{stroke:var(--line);stroke-width:1.2}
.dim{opacity:.12}.hl line,line.hl{stroke:var(--hl);stroke-width:2}circle.sel{stroke:var(--hl);stroke-width:3}
.banner{padding:6px 12px;font-size:12px;background:rgba(227,61,75,.12);color:var(--ink)}
</style></head><body>
<header><h1>🗺 설계 지도</h1><span class="meta" id="meta"></span><input type="search" id="q" placeholder="찾기 (시스템·테이블·문서·코드)"><div class="chips" id="chips"></div></header>
<div class="banner" id="banner" hidden></div>
<main><div id="stage"><svg id="svg"><g id="vp"></g></svg></div><aside id="side"><div class="t">점을 누르면 상세와 연결이 보여요.<br>[이거 바꾸면 영향]으로 영향받는 곳을 강조할 수 있어요.<br><br>지도를 만들거나 고치려면 대화창에 "설계 지도 갱신해줘"라고 말하세요.</div></aside></main>
<script>
const MAP=${data};
const TYPES={system:['시스템','#e33d4b'],currency:['재화','#f59e0b'],table:['테이블','#10b981'],doc:['기획서','#3b82f6'],code:['코드','#8b5cf6'],card:['트렐로','#06b6d4'],other:['기타','#94a3b8']};
const nodes=MAP.nodes.map(n=>({...n})),byId=new Map(nodes.map(n=>[n.id,n]));
const edges=MAP.edges.filter(e=>byId.has(e.from)&&byId.has(e.to)).map(e=>({...e,s:byId.get(e.from),t:byId.get(e.to)}));
const adj=new Map(nodes.map(n=>[n.id,[]]));edges.forEach(e=>{adj.get(e.from).push([e.to,e]);adj.get(e.to).push([e.from,e])});
document.getElementById('meta').textContent=(MAP.title||'')+' · 노드 '+nodes.length+' · 연결 '+edges.length+(MAP.updatedAt?' · 갱신 '+MAP.updatedAt.slice(0,10):'');
if(MAP.skeletonOnly){const b=document.getElementById('banner');b.hidden=false;b.textContent='아직 설계 지도가 없어 카탈로그로 만든 뼈대(문서·테이블)만 보여요. 대화창에 "설계 지도 만들어줘"라고 말하면 시스템·재화와 연결을 채웁니다.';}
// 배치 — 간단한 힘 기반 계산 (외부 라이브러리 없음)
// 종류별 구역(시스템 가운데, 재화 위, 테이블·문서·코드·카드는 바깥 구역)에 모으고, 연결은 끌어당기고, 가까운 것끼리는 밀어낸다
const W=1200,H=800,ZONE={system:[0,0],currency:[0,-170],table:[330,40],doc:[-330,-20],code:[60,290],card:[-300,270],other:[300,-250]};
nodes.forEach(n=>{const z=ZONE[n.type]||ZONE.other;n.zx=W/2+z[0];n.zy=H/2+z[1];n.x=n.zx+(Math.random()-.5)*120;n.y=n.zy+(Math.random()-.5)*120;n.vx=0;n.vy=0});
for(let it=0;it<360;it++){const k=1-it/360;for(let i=0;i<nodes.length;i++){const a=nodes[i];for(let j=i+1;j<nodes.length;j++){const b=nodes[j];let dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+.01;if(d2>14400)continue;const f=520/d2;a.vx+=dx*f;a.vy+=dy*f;b.vx-=dx*f;b.vy-=dy*f}}
edges.forEach(e=>{const dx=e.t.x-e.s.x,dy=e.t.y-e.s.y,d=Math.sqrt(dx*dx+dy*dy)+.01,f=(d-110)*.015;e.s.vx+=dx/d*f;e.s.vy+=dy/d*f;e.t.vx-=dx/d*f;e.t.vy-=dy/d*f});
nodes.forEach(n=>{const lone=!adj.get(n.id).length;n.vx+=(n.zx-n.x)*(lone?.03:.008);n.vy+=(n.zy-n.y)*(lone?.03:.008);n.x+=Math.max(-18,Math.min(18,n.vx))*k;n.y+=Math.max(-18,Math.min(18,n.vy))*k;n.vx*=.55;n.vy*=.55})}
const NS='http://www.w3.org/2000/svg',vp=document.getElementById('vp'),svg=document.getElementById('svg');
const el=(t,a)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);return e};
edges.forEach(e=>{e.el=el('line',{x1:e.s.x,y1:e.s.y,x2:e.t.x,y2:e.t.y});const ti=el('title',{});ti.textContent=e.s.label+' —'+e.kind+'→ '+e.t.label+(e.why?' ('+e.why+')':'');e.el.append(ti);vp.append(e.el)});
nodes.forEach(n=>{const deg=adj.get(n.id).length,r=n.type==='system'?11:n.type==='currency'?9:Math.min(9,5+deg*.5);const g=el('g',{transform:'translate('+n.x+','+n.y+')'});
n.c=el('circle',{r,fill:(TYPES[n.type]||TYPES.other)[1]});const tx=el('text',{x:r+3,y:4});tx.textContent=n.label;g.append(n.c,tx);g.style.cursor='pointer';
g.addEventListener('click',ev=>{ev.stopPropagation();select(n)});n.g=g;vp.append(g)});
if(!nodes.length){document.getElementById('stage').insertAdjacentHTML('beforeend','<div class="empty">아직 지도에 표시할 내용이 없어요.<br>대화창에 "설계 지도 만들어줘"라고 말해 보세요.</div>')}
// 이동·확대
let view={x:0,y:0,s:1},drag=null;const apply=()=>vp.setAttribute('transform','translate('+view.x+','+view.y+') scale('+view.s+')');
function fit(){const r=svg.getBoundingClientRect();if(!nodes.length)return;const xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y);const minX=Math.min(...xs)-40,maxX=Math.max(...xs)+140,minY=Math.min(...ys)-40,maxY=Math.max(...ys)+40;const s=Math.min(r.width/(maxX-minX),r.height/(maxY-minY),1.6);view.s=Math.max(s,.7);
if(view.s===s){view.x=-minX*view.s+(r.width-(maxX-minX)*view.s)/2;view.y=-minY*view.s+(r.height-(maxY-minY)*view.s)/2}
else{const core=nodes.filter(n=>n.type==='system'||n.type==='currency');const cx=core.length?core.reduce((a,n)=>a+n.x,0)/core.length:W/2,cy=core.length?core.reduce((a,n)=>a+n.y,0)/core.length:H/2;view.x=r.width/2-cx*view.s;view.y=r.height/2-cy*view.s}apply()}
svg.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY<0?1.12:1/1.12,r=svg.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;view.x=mx-(mx-view.x)*f;view.y=my-(my-view.y)*f;view.s*=f;apply()},{passive:false});
svg.addEventListener('mousedown',e=>{drag={x:e.clientX-view.x,y:e.clientY-view.y};svg.style.cursor='grabbing'});
window.addEventListener('mousemove',e=>{if(drag){view.x=e.clientX-drag.x;view.y=e.clientY-drag.y;apply()}});window.addEventListener('mouseup',()=>{drag=null;svg.style.cursor='grab'});
svg.addEventListener('click',()=>select(null));
// 필터·검색
const off=new Set();const chips=document.getElementById('chips');
Object.entries(TYPES).forEach(([t,[name,col]])=>{const c=nodes.filter(n=>n.type===t).length;if(!c)return;const b=document.createElement('button');b.className='chip';b.innerHTML='<i style="background:'+col+'"></i>'+name+' '+c;b.onclick=()=>{off.has(t)?off.delete(t):off.add(t);b.classList.toggle('off');refresh()};chips.append(b)});
const q=document.getElementById('q');q.addEventListener('input',refresh);
let sel=null,impact=false,lit=null;
function link(ref){if(!ref)return'';if(ref.kind==='doc'&&ref.id)return'https://docs.google.com/document/d/'+ref.id+'/edit';if(ref.kind==='sheet'&&ref.id)return'https://docs.google.com/spreadsheets/d/'+ref.id+'/edit';if(ref.kind==='card'&&ref.id)return'https://trello.com/c/'+ref.id;if(ref.url)return ref.url;return''}
function where(ref){if(!ref)return'';if(ref.kind==='sheet')return'시트 탭: '+(ref.tab||'');if(ref.kind==='file')return'코드: '+(ref.path||'')+(ref.line?':'+ref.line:'');if(ref.kind==='doc')return'기획서';if(ref.kind==='card')return'트렐로 카드';return ref.kind||''}
function reach(id,depth){const out=new Set([id]);let fr=[id];for(let d=0;d<depth;d++){const nx=[];fr.forEach(x=>adj.get(x).forEach(([y])=>{if(!out.has(y)){out.add(y);nx.push(y)}}));fr=nx}return out}
function refresh(){const term=q.value.trim().toLowerCase();nodes.forEach(n=>{const hide=off.has(n.type)||(term&&!(n.label+' '+(n.summary||'')+' '+(n.group||'')).toLowerCase().includes(term));const dim=lit&&!lit.has(n.id);n.g.style.display=hide?'none':'';n.g.classList.toggle('dim',!!dim);n.c.classList.toggle('sel',sel===n)});
edges.forEach(e=>{const hide=e.s.g.style.display==='none'||e.t.g.style.display==='none';e.el.style.display=hide?'none':'';const on=lit&&lit.has(e.from)&&lit.has(e.to);e.el.classList.toggle('dim',!!lit&&!on);e.el.classList.toggle('hl',!!on)})}
function select(n){sel=n;impact=false;lit=n?reach(n.id,1):null;render();refresh()}
function render(){const s=document.getElementById('side');if(!sel){s.innerHTML='<div class="t">점을 누르면 상세와 연결이 보여요.</div>';return}
const [tn]=TYPES[sel.type]||TYPES.other,url=link(sel.ref),nb=adj.get(sel.id);
s.innerHTML='<div class="t">'+tn+(sel.group?' · '+esc(sel.group):'')+'</div><h2>'+esc(sel.label)+'</h2>'+(sel.summary?'<div>'+esc(sel.summary)+'</div>':'')+'<div class="t" style="margin-top:6px">'+esc(where(sel.ref))+'</div>'+(url?'<div><a href="'+url+'" target="_blank">원본 열기 ↗</a></div>':'')+
'<button class="impact'+(impact?' on':'')+'" id="imp">이거 바꾸면 영향</button>'+(impact?'<div class="t" style="margin-top:6px">2단계까지 연결된 '+(lit.size-1)+'곳이 강조됐어요</div>':'')+
'<h2 style="margin-top:12px;font-size:13px">연결 '+nb.length+'</h2><ul>'+nb.map(([id,e])=>{const o=byId.get(id);return'<li data-id="'+esc(id)+'">'+((TYPES[o.type]||TYPES.other)[0])+' · '+esc(o.label)+' <span class="t">('+e.kind+')</span></li>'}).join('')+'</ul>'+(sel.note?'<div class="note">📝 '+esc(sel.note)+'</div>':'');
s.querySelector('#imp').onclick=()=>{impact=!impact;lit=reach(sel.id,impact?2:1);render();refresh()};s.querySelectorAll('li[data-id]').forEach(li=>li.onclick=()=>select(byId.get(li.dataset.id)))}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
fit();window.addEventListener('resize',fit);
</script></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
