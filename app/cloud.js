import './web-reminders.js';

const $=id=>document.getElementById(id),storage=window.WageWiseData,features=window.WageWiseFeatures;
const {merge,equal}=window.WageWiseMerge;
const {request}=window.WageWiseAccess;
const empty=()=>({calculator:null,log:Tracking.empty()});
const envelope=data=>({format:'wagewise',version:2,...data});
const validate=data=>Planner.readBackup(JSON.stringify(data));
const status=msg=>{$('sync-status').textContent=msg;};
let connection,running,queued=false,timer;
const cloudRead=async id=>{
 const remote=await request('read',{workspace:id});return remote?{...remote,data:validate(remote.data)}:{revision:0,data:null};
};
function paragraph(text){const node=document.createElement('p');node.textContent=text;return node;}
function button(text,fn){const node=document.createElement('button');node.type='button';node.textContent=text;
 node.onclick=async()=>{node.disabled=true;try{await fn();}catch(e){status(e.message);}finally{node.disabled=false;}};return node;}
function conflictPanel(conflicts, resolve) {
  const panel = $('sync-conflicts');
  const choices = Object.create(null);
  const fields = conflicts.map(conflict => {
    const field = document.createElement('label');
    const select = document.createElement('select');
    for (const [value, title] of [['', 'Choose the version to keep'], ['local', 'This device'], ['remote', 'Cloud']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = title;
      select.append(option);
    }
    select.onchange = () => { choices[conflict.key] = select.value; };
    field.append(conflict.label || 'WageWise records', select);
    return field;
  });
  panel.replaceChildren(paragraph('Some records changed on both devices.'), ...fields,
    button('Apply choices', () => {
      if (conflicts.some(item => !choices[item.key])) throw Error('Choose a version for each conflict.');
      return resolve(choices);
    }));
  panel.hidden = false;
}

async function synchronize(choices, reviewed) {
  const id = connection;
  const key = 'account:' + id;
  const usable = () => WageWiseAccess.valid && features.getWorkspace() === key;
  if (!id || !usable()) return;
  const record = await storage.get(key);
  const remote = await cloudRead(id);
  if (!usable()) return;
  if (reviewed && (!equal(record.data, reviewed.local) || remote.revision !== reviewed.revision)) choices = undefined;
  const review = {local: record.data, revision: remote.revision};
  const combined = remote.data ? merge(record.base, record.data, remote.data, choices) : {data: record.data, conflicts: []};
  if (combined.conflicts.length) {
    status('Review changes made on both devices.');
    conflictPanel(combined.conflicts, value => syncNow(value, review));
    return;
  }
  let candidate;
  try { candidate = validate(envelope(combined.data)); }
  catch (error) {
    if (!remote.data) throw error;
    if (!choices?.snapshot) {
      status('The combined changes could not be saved together.');
      conflictPanel([{key: 'snapshot', label: 'Combined records'}], value => syncNow(value, review));
      return;
    }
    candidate = choices.snapshot === 'remote' ? remote.data : record.data;
  }
  let revision = remote.revision;
  if (!equal(candidate, remote.data)) {
    revision = await request('write', {workspace: id, revision,
      snapshot: envelope(candidate), mutation: crypto.randomUUID()});
    if (revision == null) { queued = true; return; }
  }
  if (!usable()) return;
  let adopted = false;
  await storage.change(key, current => {
    if (!equal(current.data, record.data) || current.revision !== record.revision) return current;
    adopted = true;
    return {...current, data: candidate, base: candidate, revision};
  });
  if (!usable()) return;
  if (!adopted) { queued = true; return; }
  if (!equal(candidate, record.data)) await features.useWorkspace(key);
  $('sync-conflicts').hidden = true;
  status(`Last synced ${new Date().toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'})}`);
}

function schedule(){clearTimeout(timer);timer=setTimeout(syncNow,450);}
function syncNow(choices,reviewed){
 if(!WageWiseAccess.valid)return;
 if(running){queued=true;return running;}
 running=synchronize(choices,reviewed).catch(e=>status('Sync paused · '+e.message)).finally(()=>{
   running=null;if(queued){queued=false;schedule();}
 });return running;
}
async function offerGuest(){
 const local=await storage.get('guest'),data=local?.data;
 if(local?.movedTo||!data||(!data.calculator&&equal(data.log,Tracking.empty(data.log.started))))return;
 const panel=$('sync-import'),key=features.getWorkspace();
 const move=async (choices,reviewed)=>{
   await request('session');await features.flush();
   const record=await storage.get(key);
   const combined=merge(empty(),data,record.data,reviewed&&!equal(reviewed,record.data)?undefined:choices);
   if(combined.conflicts.length){conflictPanel(combined.conflicts,value=>move(value,record.data));return;}
   const next=validate(envelope(combined.data));
   await storage.moveGuest(key,local,record,next);
   await features.useWorkspace(key);panel.hidden=true;$('sync-conflicts').hidden=true;await syncNow();
 };
 panel.hidden=false;panel.replaceChildren(paragraph('Move records stored on this device into '+WageWiseAccess.identity.username+'? '+(data.calculator?.history?.length??0)+' saved pay entries and '+Object.keys(data.log.days).length+' logged days.'),
   button('Move my local records',()=>move({})),button('Leave for later',()=>{panel.hidden=true;}));
}
window.addEventListener('wagewise-ready',async()=>{
 connection=WageWiseAccess.identity.workspace;
 $('sync-user').textContent='Signed in as '+WageWiseAccess.identity.username;
 $('sync-retry').onclick=()=>syncNow();
 $('sync-logout').onclick=async()=>{
   try{
     await features.flush();await syncNow();const r=await storage.get(features.getWorkspace());
     if(!equal(r.base,r.data)&&!confirm('Some records are pending sync. Sign out and keep them for this account on this device?'))return;
     await request('logout');localStorage.setItem('ww-session-change',crypto.randomUUID());WageWiseAccess.login();
   }catch(e){status(e.message);}
 };
 window.addEventListener('wagewise-data',e=>{if(e.detail.key===features.getWorkspace()){status('Saving to your account…');schedule();}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
 setInterval(()=>{if(!document.hidden)schedule();},25000);
 await syncNow();await offerGuest();
},{once:true});
