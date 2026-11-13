'use strict';
const $ = s => document.querySelector(s);
const fields = ['documentation','material','cutting','machining','assembly','packing','sheet','dispatch'];
const labels = {documentation:'Dokumentacija',material:'Material',cutting:'Razrez',machining:'Obdelava',assembly:'Sestavljanje',packing:'Pakiranje',sheet:'Pločevina',dispatch:'Odprema',code:'Nalog',title:'Objekt',due:'Rok',owner:'Odgovorna oseba',notes:'Opombe',archived:'Arhiv',created:'Nalog ustvarjen'};
const baseStatus = {waiting:'Čaka',active:'V delu',done:'Končano',blocked:'Zastoj',ordered:'Naročeno',painting:'Na barvanju',na:'Ni potrebno'};
const special = {documentation:{waiting:'Čaka',active:'V pregledu',done:'Sprejeta'},material:{waiting:'Za naročiti',done:'Pripravljeno'},sheet:{waiting:'Za naročiti',done:'Pripravljena'},dispatch:{waiting:'Čaka',done:'Odpremljeno'}};
const options = Object.fromEntries(fields.map(k => [k,k==='material'?['waiting','ordered','done','blocked']:k==='sheet'?['na','waiting','ordered','painting','done','blocked']:k==='dispatch'?['waiting','done','blocked']:['waiting','active','done','blocked',...(k==='documentation'?[]:['na'])]]));
const filters = [['all','Vsi aktivni'],['work','V delu'],['blocked','Zastoji'],['ready','Za odpremo'],['archive','Arhiv']];
let jobs=[], actor='', filter='all', search='', editing=null, draft=null, choice=null, loading=false, toastTimer;
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textStatus = (field,value) => special[field]?.[value] || baseStatus[value] || value;
const day = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Ljubljana'}).format(new Date());
const date = x => x ? new Intl.DateTimeFormat('sl-SI',{day:'numeric',month:'numeric',year:'numeric',timeZone:'Europe/Ljubljana'}).format(new Date(x.length===10 ? x+'T12:00:00' : x)) : 'Brez roka';
const timestamp = x => new Intl.DateTimeFormat('sl-SI',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Ljubljana'}).format(new Date(x));
const blocked = j => fields.some(k=>j[k]==='blocked');
const working = j => fields.some(k=>['active','ordered','painting'].includes(j[k]));
const ready = j => fields.filter(k=>k!=='dispatch').every(k=>['done','na'].includes(j[k]));
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
function showLogin(){actor='';$('#app').hidden=true;$('#login').hidden=false;for(const id of ['jobDialog','statusDialog'])if($('#'+id).open)$('#'+id).close();}
async function enter(name){actor=name;$('#identity').textContent='● '+actor;$('#login').hidden=true;$('#app').hidden=false;await load();}
async function load(){
 if(loading||!actor)return;loading=true;
 try{jobs=(await api('/api/jobs')).jobs;render();$('#sync').textContent='Podatki osveženi';$('#sync').className='';$('#lastSync').textContent='Zadnja osvežitev '+timestamp(new Date().toISOString());}
 catch(e){$('#sync').textContent='Ni povezave · podatki so lahko zastareli';$('#sync').className='offline';if(e.status!==401)throw e;}
 finally{loading=false;}
}
function render(){
 const active=jobs.filter(j=>!j.archived);
 const metrics=[['Aktivni nalogi',active.length,'▤','all',''],['V delu',active.filter(working).length,'◷','work','warn'],['Zastoji',active.filter(blocked).length,'!','blocked','danger'],['Pripravljeno za odpremo',active.filter(ready).length,'✓','ready','good']];
 $('#metrics').innerHTML=metrics.map(([name,n,icon,f,c])=>`<button class="metric ${c}" data-filter="${f}"><div><div class="metric-label">${name}</div><div class="metric-number">${n.toString().padStart(2,'0')}</div></div><span class="metric-symbol" aria-hidden="true">${icon}</span></button>`).join('');
 $('#filters').innerHTML=filters.map(([key,label])=>`<button data-filter="${key}" class="${key===filter?'selected':''}" aria-pressed="${key===filter}">${label}${key==='archive'?' ('+jobs.filter(j=>j.archived).length+')':''}</button>`).join('');
 const visible=jobs.filter(j=>(filter==='archive'?j.archived:!j.archived)&&(filter!=='work'||working(j))&&(filter!=='blocked'||blocked(j))&&(filter!=='ready'||ready(j))&&[j.code,j.title,j.owner,j.notes].join(' ').toLocaleLowerCase('sl').includes(search.toLocaleLowerCase('sl'))).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||b.created.localeCompare(a.created));
 $('#resultCount').textContent=`${visible.length} ${visible.length===1?'nalog':'nalogov'} · ${filter==='archive'?'arhiv':'razvrščeno po roku'}`;
 $('#rows').innerHTML=visible.map(j=>{
  const late=j.due&&j.due<day()&&!j.archived;
  return `<tr class="${late?'late':''}"><td><button class="job-link" data-edit="${j.id}"><span class="job-code">${esc(j.code)}</span><span class="job-title" title="${esc(j.title)}">${esc(j.title)}</span><span class="job-owner">${esc(j.owner||'Odgovorna oseba še ni določena')}</span></button></td><td class="due ${late?'overdue':''}">${esc(date(j.due))}${late?'<small>Rok je potekel</small>':''}</td>${fields.map(k=>`<td>${statusButton(j,k)}</td>`).join('')}<td><button class="dots" data-edit="${j.id}" aria-label="Podrobnosti naloga ${esc(j.code)}">⋯</button></td></tr>`;
 }).join('');
 $('#empty').hidden=visible.length>0;
 $('#emptyTitle').textContent=jobs.length===0?'Prvi nalog, jasen začetek.':'V tem pogledu ni nalogov.';
 $('#emptyText').textContent=jobs.length===0?'Dodaj nalog in sodelavci bodo lahko sproti označevali posamezne faze izdelave.':'Spremeni filter ali iskalni niz. Vsi podatki ostajajo v skupnem pregledu.';
 $('#emptyNew').hidden=jobs.length>0;
}
function renderDraftStages(){
 $('#detailStages').innerHTML=fields.map(k=>`<div class="detail-stage"><span>${labels[k]}</span>${statusButton(draft,k,true)}</div>`).join('');
}
async function openJob(id=null){
 editing=id?structuredClone(jobs.find(j=>j.id===id)):null;
 if(id&&!editing)return;
 draft=editing?structuredClone(editing):{id:'new',...Object.fromEntries(fields.map(k=>[k,'waiting'])),sheet:'na',code:'',title:'',due:'',owner:actor,notes:'',archived:false};
 $('#jobForm').reset();
 for(const k of ['code','title','due','owner','notes'])$('#jobForm').elements[k].value=draft[k]||'';
 $('#dialogTitle').textContent=editing?editing.code:'Nov nalog';$('#formError').textContent='';
 $('#historySection').hidden=!editing;
 $('#archiveArea').innerHTML=editing?`<button type="button" class="secondary" id="archiveJob">${editing.archived?'↶ Vrni med aktivne naloge':'Premakni v arhiv'}</button><p class="hint">${editing.archived?'Če je nalog odpremljen, se ob vrnitvi odprema ponastavi na »Čaka«.':'Arhiviranje ne potrdi odpreme. Nalog ostane shranjen.'}</p>`:'';
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
 $('#dispatchHint').hidden=field!=='dispatch';
 $('#statusChoices').innerHTML=options[field].map(v=>`<button type="button" class="status ${v} ${j[field]===v?'chosen':''}" data-choice="${v}" aria-pressed="${j[field]===v}"><span>${esc(textStatus(field,v))}</span><span>${j[field]===v?'✓':''}</span></button>`).join('');
 $('#statusDialog').showModal();
}
async function selectStatus(value){
 const c=choice;if(!c)return;
 if(c.field==='dispatch'&&value==='done'){
  const j=c.isDraft?draft:jobs.find(x=>x.id===c.id);
  if(!ready(j)&&!confirm('Nekatere faze še niso zaključene. Vseeno potrdiš odpremo in premakneš nalog v arhiv?'))return;
 }
 if(c.isDraft){draft[c.field]=value;renderDraftStages();$('#statusDialog').close();return;}
 $('#statusChoices').querySelectorAll('button').forEach(b=>b.disabled=true);
 try{await api(`/api/jobs/${c.id}`,'PATCH',{version:c.version,[c.field]:value});$('#statusDialog').close();toast('Status je shranjen.');await load();}
 catch(e){$('#statusError').textContent=e.message;if(e.status===409){await load().catch(()=>{});$('#statusError').textContent+=' Zapri izbiro statusa in jo odpri znova.';}}
 finally{$('#statusChoices').querySelectorAll('button').forEach(b=>b.disabled=false);}
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
$('#search').addEventListener('input',e=>{search=e.target.value;render();});
document.addEventListener('click',e=>{
 const filterButton=e.target.closest('[data-filter]');if(filterButton){filter=filterButton.dataset.filter;render();}
 const closer=e.target.closest('[data-close]');if(closer)$('#'+closer.dataset.close).close();
 const edit=e.target.closest('[data-edit]');if(edit)openJob(edit.dataset.edit);
 const status=e.target.closest('[data-status]');if(status)openStatus(status.dataset.id,status.dataset.status);
 const draftButton=e.target.closest('[data-draft]');if(draftButton)openStatus(draftButton.dataset.id,draftButton.dataset.draft,true);
 const selected=e.target.closest('[data-choice]');if(selected)selectStatus(selected.dataset.choice);
 const archive=e.target.closest('#archiveJob');if(archive)archiveJob();
});
$('#jobForm').addEventListener('submit',async e=>{
 e.preventDefault();$('#saveJob').disabled=true;$('#formError').textContent='';
 const data={};for(const k of ['code','title','due','owner','notes'])data[k]=e.currentTarget.elements[k].value.trim();
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
