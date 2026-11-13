'use strict';
const $ = s => document.querySelector(s);
const fields = ['documentation','material','cutting','machining','assembly','packing','sheet','dispatch','sheet_dispatch','raw_sheet','raw_sheet_dispatch','anchors_status','small_material_status','caps_status','subcaps_status','anchors_dispatch','small_material_dispatch','caps_dispatch','subcaps_dispatch'];
const labels = {documentation:'Dokumentacija',material:'Material',cutting:'Razrez',machining:'Obdelava',assembly:'Sestavljanje',packing:'Pakiranje',sheet:'Barvana pločevina',raw_sheet:'Surova pločevina',dispatch:'Odprema fasade',sheet_dispatch:'Odprema barvane pločevine',raw_sheet_dispatch:'Odprema surove pločevine',code:'Nalog',title:'Objekt',due:'Rok',owner:'Odgovorna oseba',notes:'Opombe',sheet_papers_date:'Oddani papirji – barvana pločevina',raw_sheet_papers_date:'Oddani papirji – surova pločevina',anchors_dispatch:'Odprema sider',small_material_dispatch:'Odprema drobnega materiala',caps_dispatch:'Odprema kap',subcaps_dispatch:'Odprema podkap',small_material:'Drobni material',caps:'Kape',subcaps:'Podkape',caps_status:'Priprava kap',subcaps_status:'Priprava podkap',anchors:'Sidra',anchors_status:'Priprava sider',small_material_status:'Priprava drobnega materiala',archived:'Arhiv',created:'Nalog ustvarjen'};
const baseStatus = {waiting:'Čaka',active:'V izdelavi',done:'Končano',blocked:'Zastoj',ordered:'Naročeno',painting:'Na barvanju',manufacturing:'V izdelavi',awaiting_paint:'Čaka barvanje',na:'Ni potrebno'};
const special = {documentation:{waiting:'Čaka',active:'V pregledu',done:'Sprejeta'},material:{waiting:'Za naročiti',done:'Pripravljeno'},sheet:{waiting:'Za naročiti',done:'Pripravljena'},dispatch:{waiting:'Čaka',done:'Fasada odšla'},sheet_dispatch:{waiting:'Čaka',done:'Odpremljena'},raw_sheet:{waiting:'Za naročiti',active:'V pripravi',done:'Pripravljena'},raw_sheet_dispatch:{waiting:'Čaka',done:'Odpremljena'}};
special.anchors_status={waiting:'Čaka pripravo',done:'✓ Pripravljeno'};
special.small_material_status={waiting:'Čaka pripravo',done:'✓ Pripravljeno'};
special.caps_status={waiting:'Čaka pripravo',done:'✓ Pripravljeno'};
special.subcaps_status={waiting:'Čaka pripravo',done:'✓ Pripravljeno'};
for(const key of ['anchors_dispatch','small_material_dispatch','caps_dispatch','subcaps_dispatch'])special[key]={waiting:'Čaka odpremo',done:'Odpremljeno'};
const options = Object.fromEntries(fields.map(k => [k,['anchors_status','small_material_status','caps_status','subcaps_status'].includes(k)?['waiting','done','na']:k==='material'?['waiting','ordered','done','blocked']:k==='sheet'?['na','waiting','ordered','manufacturing','awaiting_paint','painting','done','blocked']:k==='raw_sheet'?['na','waiting','ordered','active','manufacturing','done','blocked']:['sheet_dispatch','raw_sheet_dispatch','anchors_dispatch','small_material_dispatch','caps_dispatch','subcaps_dispatch'].includes(k)?['waiting','done','blocked','na']:k==='dispatch'?['waiting','done','blocked']:['waiting','active','done','blocked',...(k==='documentation'?[]:['na'])]]));
const filters = [['all','Vsi aktivni'],['work','V izdelavi'],['blocked','Zastoji'],['ready','Čaka odpremo'],['partial','Delno odpremljeno'],['archive','Arhiv']];
let jobs=[], actor='', filter='all', search='', editing=null, draft=null, choice=null, loading=false, toastTimer, projectId=null, projectVersion=null, papersChoice=null, completedExpanded=false;
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textStatus = (field,value) => special[field]?.[value] || baseStatus[value] || value;
const day = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Ljubljana'}).format(new Date());
const date = x => x ? new Intl.DateTimeFormat('sl-SI',{day:'numeric',month:'numeric',year:'numeric',timeZone:'Europe/Ljubljana'}).format(new Date(x.length===10 ? x+'T12:00:00' : x)) : 'Brez roka';
const timestamp = x => new Intl.DateTimeFormat('sl-SI',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Ljubljana'}).format(new Date(x));
const activeKeys = j => {const keys=j.dispatch==='done'?[]:['documentation','material','cutting','machining','assembly','packing','dispatch'].filter(k=>!['done','na'].includes(j[k]));for(const [stage,shipping] of shipmentPairs)if(j[stage]!=='na'&&j[shipping]!=='done'){if(j[stage]!=='done')keys.push(stage);keys.push(shipping);}return keys;};
const blocked = j => activeKeys(j).some(k=>j[k]==='blocked');
const working = j => activeKeys(j).some(k=>['active','ordered','manufacturing','awaiting_paint','painting'].includes(j[k]));
const facadeReady = j => ['documentation','material','cutting','machining','assembly','packing'].every(k=>['done','na'].includes(j[k]));
const sheetPairs = [['sheet','sheet_dispatch','Barvana'],['raw_sheet','raw_sheet_dispatch','Surova']];
const otherPairs=[['anchors_status','anchors_dispatch','Sidra'],['small_material_status','small_material_dispatch','Drobni material'],['caps_status','caps_dispatch','Kape'],['subcaps_status','subcaps_dispatch','Podkape']];
const shipmentPairs=[...sheetPairs,...otherPairs];
const allShipped = j => j.dispatch==='done'&&shipmentPairs.every(([stage,shipping])=>j[stage]==='na'||j[shipping]==='done');
const ready = j => (j.dispatch!=='done'&&facadeReady(j))||shipmentPairs.some(([stage,shipping])=>j[stage]==='done'&&j[shipping]!=='done');
const partial = j => !j.archived&&(j.dispatch==='done'||shipmentPairs.some(([,shipping])=>j[shipping]==='done'));
const shipmentSummary = j => {const parts=[...(j.dispatch==='done'?[]:['Fasada čaka odpremo']),...shipmentPairs.filter(([stage,shipping])=>j[stage]!=='na'&&j[shipping]!=='done').map(([stage,,label])=>label.toLocaleLowerCase('sl')+' '+(j[stage]==='done'?'čaka odpremo':textStatus(stage,j[stage]).toLocaleLowerCase('sl')))];return parts.length?'Odprto: '+parts.join(' · '):'Vse odpremljeno';};
function syncDraftShipping(){for(const [stage,shipping] of shipmentPairs){if(draft[stage]==='na')draft[shipping]='na';else if(draft[shipping]==='na')draft[shipping]='waiting';}}

const statusButton = (j,k,detail=false) => `<button type="button" class="status ${esc(j[k])}" data-${detail?'draft':'status'}="${k}" data-id="${esc(j.id)}" aria-label="${esc(labels[k]+': '+textStatus(k,j[k])+'. Spremeni status naloga '+j.code)}">${esc(textStatus(k,j[k]))}</button>`;

function toast(message,bad=false){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').className='toast'+(bad?' bad':'');$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,bad?8000:3000);}
async function api(path,method='GET',body){
 let res;
 try{res=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}
 catch{throw new Error('Spojitev s strežnikom ni uspela. Preveri povezavo in osveži podatke.');}
 let data;try{data=await res.json();}catch{throw new Error('Strežnik ni vrnil podatkov. Poskusi znova.');}
 if(!res.ok){const e=new Error(data.error||'Napaka pri shranjevanju.');e.status=res.status;if(res.status===401&&path!=='/api/login'){showLogin();}throw e;}
 return data;
}
function showLogin(){actor='';$('#app').hidden=true;$('#login').hidden=false;for(const id of ['papersDialog','statusDialog','jobDialog','projectDialog'])if($('#'+id).open)$('#'+id).close();}
async function enter(name){actor=name;$('#identity').textContent='● '+actor;$('#login').hidden=true;$('#app').hidden=false;await load();}
async function load(){
 if(loading||!actor)return;loading=true;
 try{jobs=(await api('/api/jobs')).jobs;render();if(projectId&&$('#projectDialog').open)renderProject();$('#sync').textContent='Podatki osveženi';$('#sync').className='';$('#lastSync').textContent='Zadnja osvežitev '+timestamp(new Date().toISOString());}
 catch(e){$('#sync').textContent='Ni povezave · podatki so lahko zastareli';$('#sync').className='offline';if(e.status!==401)throw e;}
 finally{loading=false;}
}
function papersButton(j,stage){
 const field=stage==='sheet'?'sheet_papers_date':'raw_sheet_papers_date';
 return `<button type="button" class="papers-button" data-papers="${field}" data-id="${esc(j.id)}" aria-label="${esc(labels[field])}: ${esc(j[field]?date(j[field]):'Vpiši datum')}"><span>Oddani papirji</span><strong>${esc(j[field]?date(j[field]):'＋ Vpiši datum')}</strong></button>`;
}
function openPapers(id,field){
 if(!['sheet_papers_date','raw_sheet_papers_date'].includes(field))return;
 const j=jobs.find(x=>x.id===id);if(!j)return;
 papersChoice={id,field,version:j.version};
 $('#papersTitle').textContent=labels[field];$('#papersJob').textContent=j.code;
 $('#papersDate').value=j[field]||'';$('#papersError').textContent='';$('#papersDialog').showModal();
}
async function savePapers(){
 const choice=papersChoice;if(!choice)return;$('#papersSave').disabled=true;$('#papersError').textContent='';
 try{await api('/api/jobs/'+choice.id,'PATCH',{version:choice.version,[choice.field]:$('#papersDate').value});$('#papersDialog').close();toast('Datum oddaje papirjev je shranjen.');await load();}
 catch(e){$('#papersError').textContent=e.message;if(e.status===409){await load().catch(()=>{});$('#papersError').textContent+=' Zapri okno in ga odpri znova; vpisani datum še ni shranjen.';}}
 finally{$('#papersSave').disabled=false;}
}
function completedLink(j,text='✓ Zaključeno'){return `<button type="button" class="completed-link" data-completed="${esc(j.id)}">${esc(text)}</button>`;}
function activePhase(j,key){return j.dispatch==='done'||['done','na'].includes(j[key])?completedLink(j,j[key]==='na'?'Ni potrebno':'✓'):statusButton(j,key);}
function sheetCell(j,shipping=false){const pairs=sheetPairs.filter(([stage,dispatch])=>j[stage]!=='na'&&j[dispatch]!=='done');return pairs.length?'<div class="sheet-stack">'+pairs.map(([stage,dispatch,label])=>'<div><span class="sheet-type">'+label+'</span>'+(shipping?statusButton(j,dispatch):(j[stage]==='done'?'<span class="prepared-hint">Čaka odpremo</span>':statusButton(j,stage)))+(shipping?'':papersButton(j,stage))+'</div>').join('')+'</div>':completedLink(j);}
const capGroups=[['caps','caps_status','Kape'],['subcaps','subcaps_status','Podkape']];
function warehouseActions(j,preparation,full=false){const shipping=otherPairs.find(([key])=>key===preparation)[1];if(!full&&(j[preparation]==='na'||j[shipping]==='done'))return completedLink(j,j[preparation]==='na'?'Ni potrebno':'✓ Odpremljeno');const showPreparation=full||j[preparation]!=='done';return '<div class="warehouse-actions '+(showPreparation?'':'shipping-only')+'">'+(showPreparation?'<span class="sheet-type">Priprava</span>'+statusButton(j,preparation):'')+'<span class="sheet-type shipping-label">Odprema</span>'+statusButton(j,shipping)+'</div>';}
function warehouseCell(j,key){const shipping=otherPairs.find(([stage])=>stage===key)[1];if(j[key]==='na'||j[shipping]==='done')return completedLink(j,j[key]==='na'?'Ni potrebno':'✓ Odpremljeno');return warehouseActions(j,key)+'<button type="button" class="warehouse-list" data-edit="'+esc(j.id)+'">'+esc(j[key==='anchors_status'?'anchors':'small_material']||'Vpiši seznam')+'</button>'; }
function capsCell(j){const groups=capGroups.filter(([,key])=>j[key]!=='na'&&j[otherPairs.find(([stage])=>stage===key)[1]]!=='done');return groups.length?'<div class="sheet-stack">'+groups.map(([text,key,label])=>'<div><span class="sheet-type">'+label+'</span>'+warehouseActions(j,key)+'<button type="button" class="warehouse-list" data-edit="'+esc(j.id)+'" title="'+esc(j[text]||'')+'">'+esc(j[text]||'Vpiši seznam')+'</button></div>').join('')+'</div>':completedLink(j);}
function openWork(j){const production=['documentation','material','cutting','machining','assembly','packing'];return {production:j.dispatch==='done'?[]:production.filter(k=>!['done','na'].includes(j[k])),pending:shipmentPairs.filter(([stage,shipping])=>j[stage]!=='na'&&j[shipping]!=='done'),closed:shipmentPairs.filter(([stage,shipping])=>j[stage]==='na'||j[shipping]==='done'),doneStages:production.filter(k=>j.dispatch==='done'||['done','na'].includes(j[k])),preparedStages:shipmentPairs.filter(([stage,shipping])=>j[stage]==='done'&&j[shipping]!=='done').map(([stage])=>stage)};}

function render(){
 const active=jobs.filter(j=>!j.archived);
 const metrics=[['Aktivni nalogi',active.length,'▤','all',''],['V izdelavi',active.filter(working).length,'◷','work','warn'],['Zastoji',active.filter(blocked).length,'!','blocked','danger'],['Čaka odpremo',active.filter(ready).length,'✓','ready','good']];
 $('#metrics').innerHTML=metrics.map(([name,n,icon,f,c])=>`<button class="metric ${c}" data-filter="${f}"><div><div class="metric-label">${name}</div><div class="metric-number">${n.toString().padStart(2,'0')}</div></div><span class="metric-symbol" aria-hidden="true">${icon}</span></button>`).join('');
 $('#filters').innerHTML=filters.map(([key,label])=>`<button data-filter="${key}" class="${key===filter?'selected':''}" aria-pressed="${key===filter}">${label}${key==='archive'?' ('+jobs.filter(j=>j.archived).length+')':''}</button>`).join('');
 const visible=jobs.filter(j=>(filter==='archive'?j.archived:!j.archived)&&(filter!=='work'||working(j))&&(filter!=='blocked'||blocked(j))&&(filter!=='ready'||ready(j))&&(filter!=='partial'||partial(j))&&[j.code,j.title,j.owner,j.notes,j.small_material,j.anchors,j.caps,j.subcaps].join(' ').toLocaleLowerCase('sl').includes(search.toLocaleLowerCase('sl'))).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||b.created.localeCompare(a.created));
 $('#resultCount').textContent=`${visible.length} ${visible.length===1?'nalog':'nalogov'} · ${filter==='archive'?'arhiv':'razvrščeno po roku'}`;
 $('#rows').innerHTML=visible.map(j=>{
  const late=j.due&&j.due<day()&&!j.archived;
  return `<tr class="${late?'late':''}"><td><button class="job-link" data-edit="${j.id}"><span class="job-code">${esc(j.code)}</span><span class="job-title" title="${esc(j.title)}">${esc(j.title)}</span><span class="job-owner">${esc(j.owner||'Odgovorna oseba še ni določena')}</span>${partial(j)?'<span class="shipment-summary">'+esc(shipmentSummary(j))+'</span>':''}${j.notes?'<span class="manual-note" title="'+esc(j.notes)+'"><strong>Opomba:</strong> '+esc(j.notes)+'</span>':''}</button></td><td class="due ${late?'overdue':''}">${esc(date(j.due))}${late?'<small>Rok je potekel</small>':''}</td>${['documentation','material','anchors_status','small_material_status','cutting','machining','assembly','packing'].map(k=>`<td>${['anchors_status','small_material_status'].includes(k)?warehouseCell(j,k):activePhase(j,k)}</td>`).join('')}<td>${capsCell(j)}</td><td>${sheetCell(j)}</td><td>${j.dispatch==='done'?completedLink(j,'✓ Odpremljeno'):statusButton(j,'dispatch')}</td><td>${sheetCell(j,true)}</td><td><button class="dots" data-edit="${j.id}" aria-label="Podrobnosti naloga ${esc(j.code)}">⋯</button></td></tr>`;
 }).join('');
 $('#projectCards').innerHTML=visible.map(projectCard).join('');
 $('#empty').hidden=visible.length>0;
 $('#emptyTitle').textContent=jobs.length===0?'Prvi nalog, jasen začetek.':'V tem pogledu ni nalogov.';
 $('#emptyText').textContent=jobs.length===0?'Dodaj nalog in sodelavci bodo lahko sproti označevali posamezne faze izdelave.':'Spremeni filter ali iskalni niz. Vsi podatki ostajajo v skupnem pregledu.';
 $('#emptyNew').hidden=jobs.length>0;
}
function projectCard(j){
 const needed=fields.filter(k=>j[k]!=='na'),done=needed.filter(k=>j[k]==='done').length;
 const late=j.due&&j.due<day()&&!j.archived;
 const state=j.archived?'Odpremljeno':blocked(j)?'Zastoj':partial(j)?'Delno odpremljeno':ready(j)?'Čaka odpremo':working(j)?'V izdelavi':'Čaka';
 const tone=j.archived?'done':blocked(j)?'blocked':partial(j)||working(j)?'active':ready(j)?'done':'waiting';
 return `<button type="button" class="project-card" data-open-project="${esc(j.id)}" aria-label="Odpri projekt ${esc(j.code+' · '+j.title)}"><span class="card-top"><strong>${esc(j.code)}</strong><span class="card-state ${tone}">${state}</span></span><span class="card-title">${esc(j.title)}</span><span class="card-meta"><span class="${late?'card-late':''}">${late?'⚠ ':''}${esc(date(j.due))}</span><span>${esc(j.owner||'Brez odgovorne osebe')}</span></span><span class="card-progress"><span>Faze ${done} / ${needed.length}</span><span>${Math.round(done/Math.max(needed.length,1)*100)} %</span></span><span class="progress-track"><span class="progress-fill p${Math.round(done/Math.max(needed.length,1)*10)}"></span></span>${partial(j)?'<span class="card-shipment">'+esc(shipmentSummary(j))+'</span>':''}<span class="card-open">Odpri projekt <span aria-hidden="true">→</span></span></button>`;
}
function openProject(id){
 if(!jobs.some(j=>j.id===id))return;
 projectId=id;projectVersion=null;completedExpanded=false;renderProject();$('#projectDialog').showModal();
}
function renderProject(){
 const j=jobs.find(j=>j.id===projectId);if(!j)return;
 if(projectVersion===j.version)return;
 if(projectVersion!==null)completedExpanded=$('#completedWork')?.open||false;
 projectVersion=j.version;
 const work=openWork(j);
 const stage=k=>`<div class="project-stage"><span>${esc(labels[k])}</span>${statusButton(j,k)}</div>`;
 const section=(title,body)=>body?`<section class="project-section"><h2>${title}</h2>${body}</section>`:'';
 const materialGroup=([key,shipping,label],full=false)=>`<div class="project-material"><h3>${esc(label)}</h3><p class="project-text">${esc(j[key.replace('_status','')]||'Seznam še ni vpisan.')}</p>${warehouseActions(j,key,full)}</div>`;
 const sheetGroup=([key,shipping,label],full=false)=>`<div class="project-sheet"><h3>${esc(label)} pločevina</h3>${papersButton(j,key)}<div class="project-stage-grid ${!full&&j[key]==='done'?'single-stage':''}">${full||j[key]!=='done'?stage(key):''}${stage(shipping)}</div></div>`;
 const isSheet=pair=>sheetPairs.some(([key])=>key===pair[0]);
 const pendingMaterial=work.pending.filter(pair=>!isSheet(pair));
 const activeSections=section('Izdelava',work.production.length?'<div class="project-stage-grid">'+work.production.map(stage).join('')+'</div>':'')+section('Skladišče',pendingMaterial.filter(([key])=>['anchors_status','small_material_status'].includes(key)).map(pair=>materialGroup(pair)).join(''))+section('Kape in podkape',pendingMaterial.filter(([key])=>['caps_status','subcaps_status'].includes(key)).map(pair=>materialGroup(pair)).join(''))+section('Pločevina',work.pending.filter(isSheet).map(pair=>sheetGroup(pair)).join(''))+(j.dispatch==='done'?'':section('Odprema fasade',statusButton(j,'dispatch')));
 const completedCount=work.closed.length+work.doneStages.length+work.preparedStages.length+(j.dispatch==='done'?1:0);
 const completedContent=(j.dispatch==='done'?section('Fasada – odpremljena',statusButton(j,'dispatch')):'')+section(j.dispatch==='done'?'Faze odpremljene fasade':'Zaključene faze / ni potrebno',work.doneStages.length?'<div class="project-stage-grid">'+work.doneStages.map(stage).join('')+'</div>':'')+section('Pripravljeno – še čaka odpremo',work.preparedStages.length?'<div class="project-stage-grid">'+work.preparedStages.map(stage).join('')+'</div>':'')+section('Zaključene skupine / ni potrebno',work.closed.map(pair=>isSheet(pair)?sheetGroup(pair,true):materialGroup(pair,true)).join(''));
 $('#projectContent').innerHTML=`<div class="project-intro"><p class="eyebrow">${j.archived?'ARHIVIRAN PROJEKT':'ODPRTO DELO'}</p><h1 id="projectTitle">${esc(j.code)}</h1><p class="project-name">${esc(j.title)}</p><div class="project-info"><span>Rok: <strong>${esc(date(j.due))}</strong></span><span>Odgovorna oseba: <strong>${esc(j.owner||'Ni določena')}</strong></span></div><p class="project-partial">${esc(shipmentSummary(j))}</p><button type="button" class="secondary project-edit" data-edit="${esc(j.id)}">✎ Opombe, material in urejanje</button><p class="project-save-hint">Končano se umakne spodaj. Pripravljeno ostane odprto do odpreme.</p></div><div id="projectOpenWork">${activeSections||'<p class="all-done-message">✓ Vsi potrebni deli so odpremljeni.</p>'}</div>${completedCount?`<details id="completedWork" class="completed-work" ${completedExpanded?'open':''}><summary>Zaključeno / ni potrebno <span>${completedCount}</span></summary><p class="completed-help">Podatki ostajajo shranjeni. Tu lahko popraviš status ali ponovno odpreš delo.</p>${completedContent}</details>`:''}${section('Opombe',`<p class="project-text">${esc(j.notes||'Ni opomb.')}</p><button type="button" class="secondary project-edit" data-edit="${esc(j.id)}">Uredi podatke / zgodovina</button>`)}`;
}
function openCompleted(id){openProject(id);const details=$('#completedWork');if(details){details.open=true;completedExpanded=true;details.scrollIntoView?.({block:'start',behavior:'smooth'});}}

function renderDraftStages(){
 $('#detailStages').innerHTML=fields.map(k=>`<div class="detail-stage"><span>${labels[k]}</span>${statusButton(draft,k,true)}</div>`).join('');
}
async function openJob(id=null){
 editing=id?structuredClone(jobs.find(j=>j.id===id)):null;
 if(id&&!editing)return;
 draft=editing?structuredClone(editing):{id:'new',...Object.fromEntries(fields.map(k=>[k,'waiting'])),sheet:'na',sheet_dispatch:'na',raw_sheet:'na',raw_sheet_dispatch:'na',code:'',title:'',due:'',owner:actor,notes:'',caps:'',subcaps:'',caps_status:'na',subcaps_status:'na',sheet_papers_date:'',raw_sheet_papers_date:'',anchors:'',small_material:'',archived:false};
 syncDraftShipping();
 $('#jobForm').reset();
 for(const k of ['code','title','due','owner','notes','small_material','anchors','sheet_papers_date','raw_sheet_papers_date','caps','subcaps'])$('#jobForm').elements[k].value=draft[k]||'';
 $('#dialogTitle').textContent=editing?editing.code:'Nov nalog';$('#formError').textContent='';
 $('#historySection').hidden=!editing;
 $('#archiveArea').innerHTML=editing?.archived?'<button type="button" class="secondary" id="archiveJob">↶ Vrni med aktivne naloge</button><p class="hint">Ob vrnitvi zaključenega naloga se odprema fasade ponastavi na »Čaka«.</p>':'<p class="hint">Fasada, sidra, drobni material, kape, podkape in pločevina se odpremijo ločeno. Nalog gre v arhiv po odpremi vseh potrebnih delov.</p>';
 renderDraftStages();$('#jobDialog').showModal();
 $('#jobForm').elements.code.focus();
 if(editing){
  $('#history').textContent='Nalagam …';
  const target=editing.id;
  try{const data=await api(`/api/jobs/${target}/history`);if(editing?.id!==target)return;
   $('#history').innerHTML=data.events.map(e=>`<div class="history-item"><strong>${esc(e.actor)}</strong> · ${esc(labels[e.field]||e.field)}<div class="history-change">${e.field==='created'?esc(e.new_value):esc(historyValue(e.field,e.old_value))+' → '+esc(historyValue(e.field,e.new_value))}</div><small>${esc(timestamp(e.at))}</small></div>`).join('')||'Ni sprememb.';
  }catch(e){$('#history').textContent=e.message;}
 }
}
function historyValue(k,v){if(['sheet_papers_date','raw_sheet_papers_date'].includes(k))return v?date(v):'Ni vpisano';if(k==='archived')return v==='True'?'Arhiviran':'Aktiven';if(fields.includes(k))return textStatus(k,v);return v||'Prazno';}
function openStatus(id,field,isDraft=false){
 const j=isDraft?draft:jobs.find(x=>x.id===id);if(!j)return;
 choice={id,field,isDraft,version:j.version};
 $('#statusJob').textContent=j.code||'Nov nalog';$('#statusTitle').textContent=labels[field];$('#statusError').textContent='';
 $('#dispatchHint').hidden=field!=='dispatch'&&!shipmentPairs.some(([,shipping])=>shipping===field);
 $('#statusChoices').innerHTML=options[field].filter(v=>{const pair=shipmentPairs.find(([,shipping])=>shipping===field);return !pair||(j[pair[0]]==='na'?v==='na':v!=='na');}).map(v=>`<button type="button" class="status ${v} ${j[field]===v?'chosen':''}" data-choice="${v}" aria-pressed="${j[field]===v}"><span>${esc(textStatus(field,v))}</span><span>${j[field]===v?'✓':''}</span></button>`).join('');
 $('#statusDialog').showModal();
}
async function selectStatus(value){
 const c=choice;if(!c)return;
 if((c.field==='dispatch'||shipmentPairs.some(([,shipping])=>shipping===c.field))&&value==='done'){
  const j=c.isDraft?draft:jobs.find(x=>x.id===c.id);
  if((c.field==='dispatch'?!facadeReady(j):j[shipmentPairs.find(([,shipping])=>shipping===c.field)[0]]!=='done')&&!confirm('Ta del še ni označen kot pripravljen. Vseeno potrdiš njegovo odpremo? Preostali deli ostanejo odprti.'))return;
 }
 if(c.isDraft){draft[c.field]=value;syncDraftShipping();renderDraftStages();$('#statusDialog').close();return;}
 $('#statusChoices').querySelectorAll('button').forEach(b=>b.disabled=true);
 try{await api(`/api/jobs/${c.id}`,'PATCH',{version:c.version,[c.field]:value});$('#statusDialog').close();toast('Status je shranjen.');await load();}
 catch(e){$('#statusError').textContent=e.message;if(e.status===409){await load().catch(()=>{});$('#statusError').textContent+=' Zapri izbiro statusa in jo odpri znova.';}}
 finally{$('#statusChoices').querySelectorAll('button').forEach(b=>b.disabled=false);}
}
async function markPrepared(button){
 const j=jobs.find(x=>x.id===button.dataset.id),field=button.dataset.status;if(!j)return;
 const value=j[field]==='done'?'waiting':'done';button.disabled=true;
 try{await api('/api/jobs/'+j.id,'PATCH',{version:j.version,[field]:value});toast(({anchors_status:'Sidra',small_material_status:'Drobni material',caps_status:'Kape',subcaps_status:'Podkape'}[field])+(value==='done'?' – pripravljeno.':' – ponovno čaka pripravo.'));await load();}
 catch(e){toast(e.message,true);if(e.status===409)await load().catch(()=>{});}
 finally{button.disabled=false;}
}
$('#loginForm').addEventListener('submit',async e=>{
 e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;$('#loginError').textContent='';
 try{const res=await api('/api/login','POST',{actor:form.actor.value,password:form.password.value});form.password.value='';await enter(res.actor);}
 catch(err){$('#loginError').textContent=err.message;}finally{button.disabled=false;}
});
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout','POST',{});showLogin();}catch(e){toast(e.message,true);}});
$('#identity').addEventListener('click',()=>toast('Vpisano ime: '+actor+'. Za drugo ime se odjavi in ponovno prijavi.'));
$('#newJob').addEventListener('click',()=>openJob());$('#emptyNew').addEventListener('click',()=>openJob());
$('#refresh').addEventListener('click',()=>load().catch(e=>toast(e.message,true)));
$('#papersForm').addEventListener('submit',e=>{e.preventDefault();savePapers();});
$('#projectRefresh').addEventListener('click',()=>load().catch(e=>toast(e.message,true)));
$('#projectDialog').addEventListener('close',()=>{projectId=null;projectVersion=null;});
$('#search').addEventListener('input',e=>{search=e.target.value;render();});
document.addEventListener('click',e=>{
 const filterButton=e.target.closest('[data-filter]');if(filterButton){filter=filterButton.dataset.filter;render();}
 const closer=e.target.closest('[data-close]');if(closer)$('#'+closer.dataset.close).close();
 const completed=e.target.closest('[data-completed]');if(completed)openCompleted(completed.dataset.completed);
 const project=e.target.closest('[data-open-project]');if(project)openProject(project.dataset.openProject);
 const edit=e.target.closest('[data-edit]');if(edit)openJob(edit.dataset.edit);
 const status=e.target.closest('[data-status]');if(status){if(['anchors_status','small_material_status','caps_status','subcaps_status'].includes(status.dataset.status))markPrepared(status);else openStatus(status.dataset.id,status.dataset.status);}
 const draftButton=e.target.closest('[data-draft]');if(draftButton)openStatus(draftButton.dataset.id,draftButton.dataset.draft,true);
 const papers=e.target.closest('[data-papers]');if(papers)openPapers(papers.dataset.id,papers.dataset.papers);
 const selected=e.target.closest('[data-choice]');if(selected)selectStatus(selected.dataset.choice);
 const archive=e.target.closest('#archiveJob');if(archive)archiveJob();
});
$('#jobForm').addEventListener('submit',async e=>{
 e.preventDefault();$('#saveJob').disabled=true;$('#formError').textContent='';
 const data={};for(const k of ['code','title','due','owner','notes','small_material','anchors','sheet_papers_date','raw_sheet_papers_date','caps','subcaps'])data[k]=e.currentTarget.elements[k].value.trim();
 for(const k of fields)if(!editing||draft[k]!==editing[k])data[k]=draft[k];
 for(const [text,key] of capGroups)if(!editing&&data[text]&&data[key]==='na')data[key]='waiting';
 if(editing)data.version=editing.version;
 try{await api(editing?'/api/jobs/'+editing.id:'/api/jobs',editing?'PATCH':'POST',data);$('#jobDialog').close();toast(editing?'Nalog je shranjen.':'Nov nalog je dodan.');await load();}
 catch(err){$('#formError').textContent=err.message;if(err.status===409){$('#formError').textContent+=' Kopiraj svoje opombe, nato zapri nalog in ga odpri znova.';await load().catch(()=>{});}}
 finally{$('#saveJob').disabled=false;}
});
async function archiveJob(){
 if(!editing||!confirm(editing.archived?'Vrnem nalog med aktivne? Neshranjene spremembe v obrazcu bodo zavržene.':'Premaknem nalog v arhiv? Neshranjene spremembe v obrazcu bodo zavržene.'))return;
 const button=$('#archiveJob');button.disabled=true;
 try{await api('/api/jobs/'+editing.id,'PATCH',{version:editing.version,archived:!editing.archived});$('#jobDialog').close();toast('Nalog je premaknjen.');await load();}
 catch(e){$('#formError').textContent=e.message;if(e.status===409)await load().catch(()=>{});}
 finally{button.disabled=false;}
}
$('#today').textContent=new Intl.DateTimeFormat('sl-SI',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Ljubljana'}).format(new Date()).toLocaleUpperCase('sl');
setInterval(()=>{if(actor&&!document.hidden)load().catch(()=>{});},10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&actor)load().catch(()=>{});});
(async()=>{try{await enter((await api('/api/me')).actor);}catch{showLogin();}})();
