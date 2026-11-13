"""Build a self-contained, explicitly labelled demo; never used by the server."""
from pathlib import Path
import json
import datetime as dt

ROOT = Path(__file__).parent
stamp = dt.datetime.now(dt.timezone.utc).isoformat()
today = dt.date.today()


def sample(i, code, title, offset, **statuses):
    return dict(id=f'{i:024x}', version=1, created=stamp, updated=stamp,
                code=code, title=title, owner='Damir' if i % 2 else 'Sodelavec',
                due=(today + dt.timedelta(days=offset)).isoformat(),
                archived=False,
                **{**dict(anchors='Sidra SDe 12 – 12 kos', anchors_status='done', small_material_status='done', small_material='Vijaki M8 – 24 kos\nSidra – 12 kos', notes='Izmišljen primer za predogled.', documentation='done', material='done', cutting='waiting',
                          machining='waiting', assembly='waiting', packing='waiting',
                          sheet_dispatch='waiting' if statuses.get('sheet','na')!='na' else 'na', raw_sheet='na', raw_sheet_dispatch='waiting' if statuses.get('raw_sheet','na')!='na' else 'na', sheet='na', dispatch='waiting'), **statuses})


seeds = [
    sample(1, 'SDe 11', 'Fasada · severni del', 2, cutting='done', machining='active', sheet='awaiting_paint', dispatch='done', raw_sheet='done', raw_sheet_dispatch='done'),
    sample(2, 'SDe 12', 'Aluminijasta vrata · pritličje', 4, material='blocked', raw_sheet='ordered', notes='Primer zastoja: manjkajo profili za vrata.'),
    sample(3, 'SDe 15', 'Okna · 1. nadstropje', 1, cutting='done', machining='done', assembly='done', packing='done', sheet='done'),
    sample(4, 'SDe 16', 'Vhodna stena · objekt B', 6, material='ordered', documentation='active', sheet='ordered'),
    sample(5, 'SDe 17', 'Steklena stena · delavnica', 3, cutting='done', machining='done', assembly='active'),
]
adapter = r'''
const demoKey='delavnica-predogled-v5';
const demoSeeds=__SEEDS__;
let demoState;
try{demoState=JSON.parse(localStorage.getItem(demoKey));}catch{}
if(!demoState||!Array.isArray(demoState.jobs))demoState={jobs:structuredClone(demoSeeds),events:[],actor:'Predogled'};
function saveDemo(){try{localStorage.setItem(demoKey,JSON.stringify(demoState));}catch{}}
async function api(path,method='GET',body){
 const stamp=new Date().toISOString();
 if(path==='/api/me')return {actor:demoState.actor||'Predogled'};
 if(path==='/api/login'){demoState.actor=body.actor;saveDemo();return {actor:body.actor};}
 if(path==='/api/logout')return {ok:true};
 if(path==='/api/jobs'&&method==='GET')return {jobs:structuredClone(demoState.jobs)};
 if(path.endsWith('/history'))return {events:demoState.events.filter(e=>e.job_id===path.split('/')[3]).slice().reverse()};
 const log=(j,field,old,value)=>demoState.events.push({job_id:j.id,field,old_value:String(old),new_value:String(value),actor:demoState.actor,at:stamp});
 if(path==='/api/jobs'&&method==='POST'){
  const id=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');
  const j={id,version:1,created:stamp,updated:stamp,...Object.fromEntries(fields.map(k=>[k,'waiting'])),sheet:'na',archived:false,...body};
  for(const [stage,shipping] of sheetPairs){if(j[stage]==='na')j[shipping]='na';else if(j[shipping]==='na')j[shipping]='waiting';}
  j.archived=allShipped(j);
  demoState.jobs.unshift(j);log(j,'created','',j.code);saveDemo();return structuredClone(j);
 }
 const id=path.split('/')[3],j=demoState.jobs.find(j=>j.id===id);
 if(method==='PATCH'&&j){
  if(body.version!==j.version){const e=new Error('Nalog je medtem spremenjen. Odpri ga znova.');e.status=409;throw e;}
  const patch={...body};delete patch.version;
  for(const [text,status] of [['anchors','anchors_status'],['small_material','small_material_status']])if(text in patch&&patch[text]!==j[text]&&j[status]==='done'&&!(status in patch))patch[status]='waiting';
  const next={...j,...patch};
  for(const [stage,shipping] of sheetPairs){if(next[stage]==='na'&&next[shipping]!=='na')patch[shipping]='na';else if(next[stage]!=='na'&&next[shipping]==='na')patch[shipping]='waiting';}
  if(patch.archived===false&&j.archived&&allShipped(j))patch.dispatch='waiting';
  if(['dispatch','sheet_dispatch','sheet','raw_sheet','raw_sheet_dispatch'].some(k=>k in patch)){const n={...j,...patch};patch.archived=allShipped(n);}
  for(const [k,v]of Object.entries(patch))if(j[k]!==v){log(j,k,j[k],v);j[k]=v;}
  j.version++;j.updated=stamp;saveDemo();return structuredClone(j);
 }
 throw new Error('Ta možnost ni del predogleda.');
}
'''.replace('__SEEDS__', json.dumps(seeds, ensure_ascii=False))

if __name__ == '__main__':
    html = (ROOT / 'static/index.html').read_text()
    css = (ROOT / 'static/style.css').read_text()
    js = (ROOT / 'static/app.js').read_text()
    start, end = js.index('async function api('), js.index('function showLogin(')
    js = js[:start] + adapter + js[end:]
    js += "\n$('#resetDemo').addEventListener('click',()=>{if(confirm('Ponastavim izmišljene primere?')){try{localStorage.removeItem(demoKey);}catch{}location.reload();}});\n"
    html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + css + '</style>')
    html = html.replace('<script src="app.js" defer></script>', '')
    html = html.replace('<body>', '<body><aside style="background:#fff0cf;color:#725318;padding:12px 20px;font:12px/1.6 system-ui;text-align:center"><strong>PREDOGLED · IZMIŠLJENI PRIMERI</strong> — Spremembe so samo v tem brskalniku. Za skupno uporabo namesti aplikacijo na strežnik. <button id="resetDemo" type="button" style="border:1px solid #c7ad75;border-radius:5px;background:transparent;padding:5px 9px;margin-left:10px;color:inherit">Ponastavi primere</button></aside>')
    html = html.replace('<title>Delavnica · Pregled nalogov</title>', '<title>Delavnica · Interaktivni predogled</title>')
    html = html.replace('</body>', '<script>' + js + '</script></body>')
    (ROOT / 'predogled.html').write_text(html)
    print('Ustvarjen predogled.html')
