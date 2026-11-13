'use strict';
const $ = s => document.querySelector(s);
const fields = ['documentation','material','cutting','machining','assembly','packing','sheet','dispatch','sheet_dispatch','raw_sheet','raw_sheet_dispatch','anchors_status','small_material_status'];
const labels = {documentation:'Dokumentacija',material:'Material',cutting:'Razrez',machining:'Obdelava',assembly:'Sestavljanje',packing:'Pakiranje',sheet:'Barvana pločevina',raw_sheet:'Surova pločevina',dispatch:'Odprema fasade',sheet_dispatch:'Odprema barvane pločevine',raw_sheet_dispatch:'Odprema surove pločevine',code:'Nalog',title:'Objekt',due:'Rok',owner:'Odgovorna oseba',notes:'Opombe',small_material:'Drobni material',anchors:'Sidra',anchors_status:'Priprava sider',small_material_status:'Priprava drobnega materiala',archived:'Arhiv',created:'Nalog ustvarjen'};
const baseStatus = {waiting:'Čaka',active:'V delu',done:'Končano',blocked:'Zastoj',ordered:'Naročeno',painting:'Na barvanju',awaiting_paint:'Čaka barvanje',na:'Ni potrebno'};
const special = {documentation:{waiting:'Čaka',active:'V pregledu',done:'Sprejeta'},material:{waiting:'Za naročiti',done:'Pripravljeno'},sheet:{waiting:'Za naročiti',done:'Pripravljena'},dispatch:{waiting:'Čaka',done:'Fasada odšla'},sheet_dispatch:{waiting:'Čaka',done:'Odpremljena'},raw_sheet:{waiting:'Za naročiti',active:'V pripravi',done:'Pripravljena'},raw_sheet_dispatch:{waiting:'Čaka',done:'Odpremljena'}};
special.anchors_status={waiting:'Čaka pripravo',done:'✓ Pripravljeno'};
special.small_material_status={waiting:'Čaka pripravo',done:'✓ Pripravljeno'};
const options = Object.fromEntries(fields.map(k => [k,['anchors_status','small_material_status'].includes(k)?['waiting','done','na']:k==='material'?['waiting','ordered','done','blocked']:k==='sheet'?['na','waiting','ordered','awaiting_paint','painting','done','blocked']:k==='raw_sheet'?['na','waiting','ordered','active','done','blocked']:['sheet_dispatch','raw_sheet_dispatch'].includes(k)?['waiting','done','blocked','na']:k==='dispatch'?['waiting','done','blocked']:['waiting','active','done','blocked',...(k==='documentation'?[]:['na'])]]));
const filters = [['all','Vsi aktivni'],['work','V delu'],['blocked','Zastoji'],['ready','Za odpremo'],['partial','Delno odpremljeno'],['archive','Arhiv']];
let jobs=[], actor='', filter='all', search='', editing=null, draft=null, choice=null, loading=false, toastTimer, projectId=null, projectVersion=null;
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textStatus = (field,value) => special[field]?.[value] || baseStatus[value] || value;
const day = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Ljubljana'}).format(new Date());
const date = x => x ? new Intl.DateTimeFormat('sl-SI',{day:'numeric',month:'numeric',year:'numeric',timeZone:'Europe/Ljubljana'}).format(new Date(x.length===10 ? x+'T12:00:00' : x)) : 'Brez roka';
const timestamp = x => new Intl.DateTimeFormat('sl-SI',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Ljubljana'}).format(new Date(x));
const blocked = j => fields.some(k=>j[k]==='blocked');
const working = j => fields.some(k=>['active','ordered','awaiting_paint','painting'].includes(j[k]));
const facadeReady = j => ['documentation','material','cutting','machining','assembly','packing','anchors_status','small_material_status'].every(k=>['done','na'].includes(j[k]));
const sheetPairs = [['sheet','sheet_dispatch','Barvana'],['raw_sheet','raw_sheet_dispatch','Surova']];
const allShipped = j => j.dispatch==='done'&&sheetPairs.every(([stage,shipping])=>j[stage]==='na'||j[shipping]==='done');
const ready = j => (j.dispatch!=='done'&&facadeReady(j))||sheetPairs.some(([stage,shipping])=>j[stage]==='done'&&j[shipping]!=='done');
const partial = j => !j.archived&&(j.dispatch==='done'||sheetPairs.some(([,shipping])=>j[shipping]==='done'));
const shipmentSummary = j => partial(j) ? [j.dispatch==='done'?'Fasada odšla':'Fasada čaka odpremo',...sheetPairs.filter(([stage])=>j[stage]!=='na').map(([stage,shipping,label])=>label.toLocaleLowerCase('sl')+' '+(j[shipping]==='done'?'odšla':j[stage]==='done'?'čaka odpremo':textStatus(stage,j[stage]).toLocaleLowerCase('sl')))].join(' · ') : '';
function syncDraftShipping(){for(const [stage,shipping] of sheetPairs){if(draft[stage]==='na')draft[shipping]='na';else if(draft[shipping]==='na')draft[shipping]='waiting';}}

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
function showLogin(){actor='';$('#app').hidden=true;$('#login').hidden=false;for(const id of ['statusDialog','jobDialog','projectDialog'])if($('#'+id).open)$('#'+id).close();}
async function enter(name){actor=name;$('#identity').textContent='● '+actor;$('#login').hidden=true;$('#app').hidden=false;await load();}
async function load(){
 if(loading||!actor)return;loading=true;
 try{jobs=(await api('/api/jobs')).jobs;render();if(projectId&&$('#projectDialog').open)renderProject();$('#sync').textContent='Podatki osveženi';$('#sync').className='';$('#lastSync').textContent='Zadnja osvežitev '+timestamp(new Date().toISOString());}
 catch(e){$('#sync').textContent='Ni povezave · podatki so lahko zastareli';$('#sync').className='offline';if(e.status!==401)throw e;}
 finally{loading=false;}
}
function sheetCell(j,shipping=false){return '<div class="sheet-stack">'+sheetPairs.map(([stage,dispatch,label])=>'<div><span class="sheet-type">'+label+'</span>'+statusButton(j,shipping?dispatch:stage)+'</div>').join('')+'</div>';}
function render(){
 const active=jobs.filter(j=>!j.archived);
 const metrics=[['Aktivni nalogi',active.length,'▤','all',''],['V delu',active.filter(working).length,'◷','work','warn'],['Zastoji',active.filter(blocked).length,'!','blocked','danger'],['Pripravljeno za odpremo',active.filter(ready).length,'✓','ready','good']];
 $('#metrics').innerHTML=metrics.map(([name,n,icon,f,c])=>`<button class="metric ${c}" data-filter="${f}"><div><div class="metric-label">${name}</div><div class="metric-number">${n.toString().padStart(2,'0')}</div></div><span class="metric-symbol" aria-hidden="true">${icon}</span></button>`).join('');
 $('#filters').innerHTML=filters.map(([key,label])=>`<button data-filter="${key}" class="${key===filter?'selected':''}" aria-pressed="${key===filter}">${label}${key==='archive'?' ('+jobs.filter(j=>j.archived).length+')':''}</button>`).join('');
 const visible=jobs.filter(j=>(filter==='archive'?j.archived:!j.archived)&&(filter!=='work'||working(j))&&(filter!=='blocked'||blocked(j))&&(filter!=='ready'||ready(j))&&(filter!=='partial'||partial(j))&&[j.code,j.title,j.owner,j.notes,j.small_material,j.anchors].join(' ').toLocaleLowerCase('sl').includes(search.toLocaleLowerCase('sl'))).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||b.created.localeCompare(a.created));
 $('#resultCount').textContent=`${visible.length} ${visible.length===1?'nalog':'nalogov'} · ${filter==='archive'?'arhiv':'razvrščeno po roku'}`;
 $('#rows').innerHTML=visible.map(j=>{
  const late=j.due&&j.due<day()&&!j.archived;
  return `<tr class="${late?'late':''}"><td><button class="job-link" data-edit="${j.id}"><span class="job-code">${esc(j.code)}</span><span class="job-title" title="${esc(j.title)}">${esc(j.title)}</span><span class="job-owner">${esc(j.owner||'Odgovorna oseba še ni določena')}</span>${partial(j)?'<span class="shipment-summary">'+esc(shipmentSummary(j))+'</span>':''}${j.notes?'<span class="manual-note" title="'+esc(j.notes)+'"><strong>Opomba:</strong> '+esc(j.notes)+'</span>':''}</button></td><td class="due ${late?'overdue':''}">${esc(date(j.due))}${late?'<small>Rok je potekel</small>':''}</td>${['documentation','material','anchors_status','small_material_status','cutting','machining','assembly','packing'].map(k=>`<td>${statusButton(j,k)}${k==='anchors_status'||k==='small_material_status'?'<button type="button" class="warehouse-list" data-edit="'+j.id+'" title="'+esc(j[k==='anchors_status'?'anchors':'small_material']||'')+'">'+esc(j[k==='anchors_status'?'anchors':'small_material']||(k==='anchors_status'?'Vpiši sidra':'Vpiši drobni material'))+'</button>':''}</td>`).join('')}<td>${sheetCell(j)}</td><td>${statusButton(j,'dispatch')}</td><td>${sheetCell(j,true)}</td><td><button class="dots" data-edit="${j.id}" aria-label="Podrobnosti naloga ${esc(j.code)}">⋯</button></td></tr>`;
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
 const state=j.archived?'Odpremljeno':blocked(j)?'Zastoj':partial(j)?'Delno odpremljeno':ready(j)?'Za odpremo':working(j)?'V delu':'Čaka';
 const tone=j.archived?'done':blocked(j)?'blocked':partial(j)||working(j)?'active':ready(j)?'done':'waiting';
 return `<button type="button" class="project-card" data-open-project="${esc(j.id)}" aria-label="Odpri projekt ${esc(j.code+' · '+j.title)}"><span class="card-top"><strong>${esc(j.code)}</strong><span class="card-state ${tone}">${state}</span></span><span class="card-title">${esc(j.title)}</span><span class="card-meta"><span class="${late?'card-late':''}">${late?'⚠ ':''}${esc(date(j.due))}</span><span>${esc(j.owner||'Brez odgovorne osebe')}</span></span><span class="card-progress"><span>Faze ${done} / ${needed.length}</span><span>${Math.round(done/Math.max(needed.length,1)*100)} %</span></span><span class="progress-track"><span class="progress-fill p${Math.round(done/Math.max(needed.length,1)*10)}"></span></span>${partial(j)?'<span class="card-shipment">'+esc(shipmentSummary(j))+'</span>':''}<span class="card-open">Odpri projekt <span aria-hidden="true">→</span></span></button>`;
}
function openProject(id){
 if(!jobs.some(j=>j.id===id))return;
 projectId=id;projectVersion=null;renderProject();$('#projectDialog').showModal();
}
function renderProject(){
 const j=jobs.find(j=>j.id===projectId);if(!j)return;
 if(projectVersion===j.version)return;projectVersion=j.version;
 const stage=k=>`<div class="project-stage"><span>${esc(labels[k])}</span>${statusButton(j,k)}</div>`;
 $('#projectContent').innerHTML=`<div class="project-intro"><p class="eyebrow">${j.archived?'ARHIVIRAN PROJEKT':'DELOVNI NALOG'}</p><h1 id="projectTitle">${esc(j.code)}</h1><p class="project-name">${esc(j.title)}</p><div class="project-info"><span>Rok: <strong>${esc(date(j.due))}</strong></span><span>Odgovorna oseba: <strong>${esc(j.owner||'Ni določena')}</strong></span></div>${partial(j)?'<p class="project-partial">'+esc(shipmentSummary(j))+'</p>':''}<button type="button" class="secondary project-edit" data-edit="${esc(j.id)}">✎ Opombe, material in urejanje</button><p class="project-save-hint">Statusi se shranijo takoj po izbiri.</p></div><section class="project-section"><h2>Izdelava</h2><div class="project-stage-grid">${['documentation','material','cutting','machining','assembly','packing'].map(stage).join('')}</div></section><section class="project-section"><h2>Skladišče</h2><p class="section-hint">En klik na status označi pripravljeno.</p>${[['anchors','anchors_status','Sidra'],['small_material','small_material_status','Drobni material']].map(([text,key,label])=>`<div class="project-material"><h3>${label}</h3><p class="project-text">${esc(j[text]||'Seznam še ni vpisan.')}</p>${statusButton(j,key)}</div>`).join('')}</section><section class="project-section"><h2>Pločevina</h2>${sheetPairs.map(([key,shipping,label])=>`<div class="project-sheet"><h3>${label} pločevina</h3><div class="project-stage-grid"><div class="project-stage"><span>Priprava</span>${statusButton(j,key)}</div><div class="project-stage"><span>Odprema</span>${statusButton(j,shipping)}</div></div></div>`).join('')}</section><section class="project-section"><h2>Odprema fasade</h2>${statusButton(j,'dispatch')}</section><section class="project-section"><h2>Opombe</h2><p class="project-text">${esc(j.notes||'Ni opomb.')}</p><button type="button" class="secondary project-edit" data-edit="${esc(j.id)}">Uredi podatke / zgodovina</button></section>`;
}
function renderDraftStages(){
 $('#detailStages').innerHTML=fields.map(k=>`<div class="detail-stage"><span>${labels[k]}</span>${statusButton(draft,k,true)}</div>`).join('');
}
async function openJob(id=null){
 editing=id?structuredClone(jobs.find(j=>j.id===id)):null;
 if(id&&!editing)return;
 draft=editing?structuredClone(editing):{id:'new',...Object.fromEntries(fields.map(k=>[k,'waiting'])),sheet:'na',sheet_dispatch:'na',raw_sheet:'na',raw_sheet_dispatch:'na',code:'',title:'',due:'',owner:actor,notes:'',anchors:'',small_material:'',archived:false};
 $('#jobForm').reset();
 for(const k of ['code','title','due','owner','notes','small_material','anchors'])$('#jobForm').elements[k].value=draft[k]||'';
 $('#dialogTitle').textContent=editing?editing.code:'Nov nalog';$('#formError').textContent='';
 $('#historySection').hidden=!editing;
 $('#archiveArea').innerHTML=editing?.archived?'<button type="button" class="secondary" id="archiveJob">↶ Vrni med aktivne naloge</button><p class="hint">Ob vrnitvi zaključenega naloga se odprema fasade ponastavi na »Čaka«.</p>':'<p class="hint">Nalog gre samodejno v arhiv šele po odpremi fasade in vse potrebne pločevine.</p>';
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
function historyValue(k,v){if(k==='archived')return v==='True'?'Arhiviran':'Aktiven';if(fields.includes(k))return textStatus(k,v);return v||'Prazno';}
function openStatus(id,field,isDraft=false){
 const j=isDraft?draft:jobs.find(x=>x.id===id);if(!j)return;
 choice={id,field,isDraft,version:j.version};
 $('#statusJob').textContent=j.code||'Nov nalog';$('#statusTitle').textContent=labels[field];$('#statusError').textContent='';
 $('#dispatchHint').hidden=!['dispatch','sheet_dispatch','raw_sheet_dispatch'].includes(field);
 $('#statusChoices').innerHTML=options[field].filter(v=>!['sheet_dispatch','raw_sheet_dispatch'].includes(field)||(j[field==='sheet_dispatch'?'sheet':'raw_sheet']==='na'?v==='na':v!=='na')).map(v=>`<button type="button" class="status ${v} ${j[field]===v?'chosen':''}" data-choice="${v}" aria-pressed="${j[field]===v}"><span>${esc(textStatus(field,v))}</span><span>${j[field]===v?'✓':''}</span></button>`).join('');
 $('#statusDialog').showModal();
}
async function selectStatus(value){
 const c=choice;if(!c)return;
 if(['dispatch','sheet_dispatch','raw_sheet_dispatch'].includes(c.field)&&value==='done'){
  const j=c.isDraft?draft:jobs.find(x=>x.id===c.id);
  if((c.field==='dispatch'?!facadeReady(j):j[c.field==='sheet_dispatch'?'sheet':'raw_sheet']!=='done')&&!confirm('Ta del še ni označen kot pripravljen. Vseeno potrdiš njegovo odpremo? Preostali deli ostanejo odprti.'))return;
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
 try{await api('/api/jobs/'+j.id,'PATCH',{version:j.version,[field]:value});toast((field==='anchors_status'?'Sidra':'Drobni material')+(value==='done'?' – pripravljeno.':' – ponovno čaka pripravo.'));await load();}
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
$('#projectRefresh').addEventListener('click',()=>load().catch(e=>toast(e.message,true)));
$('#projectDialog').addEventListener('close',()=>{projectId=null;projectVersion=null;});
$('#search').addEventListener('input',e=>{search=e.target.value;render();});
document.addEventListener('click',e=>{
 const filterButton=e.target.closest('[data-filter]');if(filterButton){filter=filterButton.dataset.filter;render();}
 const closer=e.target.closest('[data-close]');if(closer)$('#'+closer.dataset.close).close();
 const project=e.target.closest('[data-open-project]');if(project)openProject(project.dataset.openProject);
 const edit=e.target.closest('[data-edit]');if(edit)openJob(edit.dataset.edit);
 const status=e.target.closest('[data-status]');if(status){if(['anchors_status','small_material_status'].includes(status.dataset.status))markPrepared(status);else openStatus(status.dataset.id,status.dataset.status);}
 const draftButton=e.target.closest('[data-draft]');if(draftButton)openStatus(draftButton.dataset.id,draftButton.dataset.draft,true);
 const selected=e.target.closest('[data-choice]');if(selected)selectStatus(selected.dataset.choice);
 const archive=e.target.closest('#archiveJob');if(archive)archiveJob();
});
$('#jobForm').addEventListener('submit',async e=>{
 e.preventDefault();$('#saveJob').disabled=true;$('#formError').textContent='';
 const data={};for(const k of ['code','title','due','owner','notes','small_material','anchors'])data[k]=e.currentTarget.elements[k].value.trim();
 for(const k of fields)if(!editing||draft[k]!==editing[k])data[k]=draft[k];
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
