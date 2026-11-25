(() => {
  'use strict';
  const P=PayslipImport, F=window.WageWiseFeatures, store=window.WageWiseData;
  const $=id=>document.getElementById(id);
  const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const button=(name,fn)=>{const b=el('button',name);b.type='button';b.onclick=fn;return b;};
  const gbp=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'});
  const money=p=>gbp.format(p/100);
  const asInput=p=>p==null?'':(p/100).toFixed(2);
  const labels={gross:'Gross pay',net:'Take-home pay',ytdGross:'Taxable pay to date',ytdTotal:'Gross pay to date',ytdTax:'PAYE paid to date',ytdNi:'Employee NI to date'};
  const description=d=>[d.employer,d.frequency==='other'?'Pay period':d.frequency==='weekly'?'Tax week':'Tax month',d.period].filter(Boolean).join(' ');
  let queue=[],token=0,total=0,cleanPreview=null,cleanDialog=null;
  function matches(history,entry){
    const d=entry.imported;
    return history.filter(e=>e.imported?.hash===d.hash || (e.date===entry.date && (!e.imported ||
      ((!d.employer||!e.imported.employer||P.textKey(e.imported.employer)===P.textKey(d.employer)) &&
        e.imported.frequency===d.frequency && (!e.imported.period||!d.period||e.imported.period===d.period)))));
  }
  function input(type,value,attrs={}){
    const i=el('input');i.type=type;i.value=value??'';Object.assign(i,attrs);return i;
  }
  function field(parent,name,control){
    const label=el('label',name);label.append(control);parent.append(label);return control;
  }
  function options(items,value){
    const sel=el('select');for(const [k,v] of Object.entries(items))sel.add(new Option(v,k));
    sel.value=value;return sel;
  }
  function checkbox(parent,label){
    const i=input('checkbox','');field(parent,label,i).className='';i.parentNode.className='import-choice';return i;
  }
  function makeEntry(d){
    const t=P.totals(d.lines);
    return {id:Date.now(),date:d.date,manual:true,basic:Math.max(0,t.basic)/100,otEntries:[],otTotal:Math.max(0,t.overtime)/100,
      gross:d.gross/100,net:d.net/100,tax:t.tax==null?null:t.tax/100,ni:t.ni==null?null:t.ni/100,note:description(d),imported:d};
  }
  function mappingKey(d,workspace){
    return d.layout && P.textKey(d.employer) ? 'payslip-rules:'+JSON.stringify([workspace,P.textKey(d.employer),d.layout]) : '';
  }
  function readyForAnchor(d) {
    let supported=false;
    try{Payroll.bands(Payroll.year(d.date));supported=P.periodFor(d.date,'weekly')===d.period;}catch{}
    return supported && d.frequency==='weekly' && /^S\d{1,4}[LMNT]$/i.test(d.taxCode) && d.niCode==='A' &&
      d.ytdGross!=null&&d.ytdGross>=0&&d.ytdTax!=null&&d.date<=Tracking.localDate()&&!(F.latestPayslip()?.date>d.date);
  }
  function reset(){
    token++;queue=[];cleanPreview?.();cleanPreview=null;
    $('import-review').hidden=true;$('import-review').replaceChildren();$('import-files').value='';$('import-choose').disabled=false;
    if($('import-original').open)$('import-original').close();
  }
  async function originalButton(entry,host){
    const content=await store.get(F.getWorkspace()+':payslip-file:'+entry.imported.hash).catch(()=>null);
    if(!host.isConnected||host.dataset.originalFor!==String(entry.id))return;
    if(!content){host.append(el('p','The original is held on the importing device.'));return;}
    host.append(button('View original payslip',async()=>{
      const dialog=$('import-original');dialog.showModal();
      cleanDialog=await WageWiseReader.preview(content,$('import-original-pages'));
    }));
  }
  async function next(){
    cleanPreview?.();cleanPreview=null;
    if(!queue.length){reset();return;}
    const generation=++token, workspace=F.getWorkspace(),file=queue.shift();
    const box=$('import-review');box.hidden=false;box.replaceChildren();
    const title=el('h2','Review payslip '+(total-queue.length)+' of '+total);
    const filename=el('p',file.name),status=el('p','Reading payslip…');status.setAttribute('role','status');
    box.append(title,filename,status);box.scrollIntoView({block:'start'});
    let d=P.blank(),hash;
    const skip=button(queue.length?'Skip this file':'Cancel',next);box.append(skip);
    if(file.size>30*1024*1024){status.textContent='This file exceeds 30 MB. Choose a smaller copy.';return;}
    try{
      const bytes=await file.arrayBuffer(),sig=new Uint8Array(bytes,0,Math.min(12,bytes.byteLength));
      const ascii=String.fromCharCode(...sig);
      if(!ascii.startsWith('%PDF-') && !(sig[0]===137&&ascii.slice(1,4)==='PNG') && !(sig[0]===255&&sig[1]===216) && !(ascii.startsWith('RIFF')&&ascii.endsWith('WEBP'))){
        status.textContent='Choose a PDF, PNG, JPEG or WebP file.';return;
      }
      hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      if(generation!==token)return;
      if((F.readCalculator()?.history??[]).some(e=>e.imported?.hash===hash)){
        await store.change(F.getWorkspace()+':payslip-file:'+hash,()=>file);status.textContent='Already in pay history. The original is available on this device.';return;
      }
      d=await WageWiseReader.extract(file,message=>{if(token===generation)status.textContent=message;});
      if(token!==generation)return;
      status.textContent='Check the figures against your original before saving.';
    }catch(error){
      if(token!==generation)return;
      if(error.message?.startsWith('Several pay dates')){status.textContent=error.message;return;}
      status.textContent='Could not read all fields. Enter the printed figures or skip this file. '+(error.message||'');
      if(!hash)return;
    }
    d.hash=hash;
    const offline=el('small','Preparing the reader for offline use…');box.append(offline);
    WageWiseReader.prepareOffline().then(ok=>{offline.textContent=ok?'Reader available offline.':'Connect to finish preparing the offline reader.';});
    const key=mappingKey(d,workspace),rules=key?await store.get(key):null;
    if(generation!==token)return;
    for(const line of d.lines){const learned=rules?.[P.textKey(line.label)];if(Object.hasOwn(P.categories,learned))line.kind=learned;}
    skip.remove();
    const layout=el('div');layout.className='import-layout';box.append(layout);
    const original=el('details');original.className='import-source';original.open=matchMedia('(min-width: 760px)').matches;
    original.append(el('summary','View original'));const preview=el('div');original.append(preview);
    const showPreview=async()=>{if(original.open&&!preview.childNodes.length){preview.textContent='Loading original…';const clean=await WageWiseReader.preview(file,preview);if(token===generation)cleanPreview=clean;else clean();}};
    original.ontoggle=showPreview;layout.append(original);showPreview();
    const form=el('form');form.className='import-form';layout.append(form);
    const fields=el('div');fields.className='import-fields';form.append(fields);
    const employer=field(fields,'Employer',input('text',d.employer,{maxLength:120}));
    const date=field(fields,'Pay date',input('date',d.date,{required:true}));
    const freq=field(fields,'Pay frequency',options({'':'Choose frequency',weekly:'Weekly',monthly:'Monthly',other:'Other printed period'},d.frequency));
    freq.required=true;
    const period=field(fields,'Printed tax week or period',input('text',d.period||P.periodFor(d.date,d.frequency),{maxLength:30}));
    let suggested=!d.period;
    period.oninput=()=>{suggested=false;};
    for(const ctrl of [date,freq])ctrl.onchange=()=>{if(suggested||!period.value){period.value=P.periodFor(date.value,freq.value);suggested=true;}};
    const taxCode=field(fields,'Tax code',input('text',d.taxCode,{maxLength:20}));
    const niCode=field(fields,'NI category',input('text',d.niCode,{maxLength:5}));
    const values={};
    for(const k of P.moneyFields){
      values[k]=field(fields,labels[k]+' (£)',input('number',asInput(d[k]),{step:'0.01',required:['net','gross'].includes(k)}));
    }
    form.append(el('h3','Payslip lines'));
    const rows=el('div');form.append(rows);
    const controls=[];
    function addRow(line={}){
      const row=el('fieldset');row.className='import-line';
      const label=field(row,'Printed description',input('text',line.label,{required:true,maxLength:100}));
      const category=field(row,'Category',options(P.categories,line.kind||'unknown'));
      const amount=field(row,'Printed amount (£)',input('number',asInput(line.pence),{step:'0.01',required:true}));
      const hours=field(row,'Hours',input('number',line.hours,{step:'any',min:'0'}));
      const rate=field(row,'Hourly rate (£)',input('number',line.rate,{step:'any',min:'0'}));
      function read(){return {label:label.value.trim(),kind:category.value,pence:P.toPence(amount.value),
        hours:hours.value===''?null:Number(hours.value),rate:rate.value===''?null:Number(rate.value)};}
      controls.push(read);row.append(button('Remove line',()=>{controls.splice(controls.indexOf(read),1);row.remove();update();}));
      rows.append(row);
    }
    d.lines.forEach(addRow);
    form.append(button('Add payslip line',()=>{addRow();update();}));
    const notes=el('p');notes.className='import-feedback';form.append(notes);
    const acknowledgement=checkbox(form,'I checked the differences and want to use the printed figures.');
    const remember=checkbox(form,'Remember these categories for this employer and layout');
    const anchor=checkbox(form,'Use these YTD figures for my next weekly estimate');
    const capability=el('small');form.append(capability);
    const dupeBox=el('div');form.append(dupeBox);
    const error=el('p');error.setAttribute('role','alert');form.append(error);
    const save=el('button','Save actual payslip');save.type='submit';save.className='primary-btn';form.append(save,skip);
    let priorMatches='',choice;
    function read(){
      return {...d,employer:employer.value.trim(),date:date.value,frequency:freq.value,period:period.value.trim(),
        taxCode:taxCode.value.trim().toUpperCase(),niCode:niCode.value.trim().toUpperCase(),
        ...Object.fromEntries(P.moneyFields.map(k=>[k,P.toPence(values[k].value)])),lines:controls.map(fn=>fn())};
    }
    function update(){
      const draft=read(),diff=P.differences(draft),messages=[];
      for(const control of [date,freq,values.gross,values.net])control.classList.toggle('import-needs-review',!control.value);
      if(diff.gross)messages.push('Printed gross is '+money(Math.abs(diff.gross))+(diff.gross>0?' above':' below')+' the listed gross earnings.');
      if(diff.net)messages.push('Printed take-home is '+money(Math.abs(diff.net))+(diff.net>0?' above':' below')+' gross plus reimbursements minus deductions.');
      if(!draft.lines.length)messages.push('Totals only. This entry will be partially itemised.');
      const expected=P.periodFor(draft.date,draft.frequency);
      if(expected && period.value && period.value!==expected)messages.push('Pay date suggests period '+expected+'. Check the printed period.');
      notes.textContent=messages.join(' ')||(suggested&&expected?'Period '+expected+' is suggested from the pay date.':'Check each line and the printed totals.');
      acknowledgement.parentNode.hidden=!messages.length;
      remember.parentNode.hidden=!mappingKey(draft,workspace);
      anchor.parentNode.hidden=!readyForAnchor(draft);
      capability.textContent=readyForAnchor(draft)?'':draft.frequency==='weekly'&&/^S\d+[LMNT]$/i.test(draft.taxCode)&&draft.niCode==='A'
        ? 'To update the weekly forecast, confirm taxable pay to date and PAYE to date on your latest eligible payslip.'
        : 'Forecasting supports weekly Scottish suffix tax codes and employee NI category A. Other payroll setups can be recorded as actual pay.';
      const matchesNow=matches(F.readCalculator()?.history??[],makeEntry(draft));
      const fingerprint=JSON.stringify(matchesNow);
      if(fingerprint!==priorMatches){
        dupeBox.replaceChildren();choice=null;priorMatches=fingerprint;
        if(matchesNow.length){
          dupeBox.append(el('h3','Existing pay entries'),el('p','This payslip shows '+money(draft.net??0)+' take-home.'));
          const opts={'':'Choose how to save',extra:'Keep as a separate supplementary payment'};
          for(const e of matchesNow)opts[e.id]='Replace '+(e.manual?'actual pay':'estimate')+' · '+gbp.format(e.gross)+' gross · '+gbp.format(e.net)+' net';
          choice=field(dupeBox,'Matching payday',options(opts,''));choice.required=true;
        }
      }
    }
    form.addEventListener('input',e=>{if(e.target!==acknowledgement)acknowledgement.checked=false;update();});
    form.addEventListener('change',update);update();
    form.onsubmit=async ev=>{
      ev.preventDefault();if(save.disabled)return;
      update();const draft=read();error.textContent='';
      if(!Tracking.dateValid(draft.date)||!P.valid(draft)){error.textContent='Check the pay date and amounts, and choose a category for every line.';return;}
      if(draft.frequency!=='other'&&!/^[1-9]\d?$/.test(draft.period) || (draft.frequency==='monthly'&&+draft.period>12)||(draft.frequency==='weekly'&&+draft.period>53)){error.textContent='Enter a valid printed tax week or month.';return;}
      if(!acknowledgement.parentNode.hidden&&!acknowledgement.checked){error.textContent='Review and confirm the differences before saving.';return;}
      if(choice&&!choice.value){error.textContent='Choose whether to replace the matching entry or record a supplementary payment.';return;}
      save.disabled=true;skip.disabled=true;
      try{
        const key=mappingKey(draft,workspace);
        const mapping=key&&remember.checked?{key,rules:Object.fromEntries(draft.lines.map(row=>[P.textKey(row.label),row.kind]))}:null;
        const entry=makeEntry(draft),replace=choice&&choice.value!=='extra'?Number(choice.value):null;
        await F.importPayslip({entry,file,replace,anchor:anchor.checked&&readyForAnchor(draft),mapping,workspaceKey:workspace,expectedMatches:priorMatches});
        if(token!==generation)return;
        window.dispatchEvent(new CustomEvent('wagewise-payslip-imported',{detail:replace??entry.id}));
        $('import-result').textContent='Saved '+draft.date+' · '+money(draft.net)+' take-home.';
        await next();
      }catch(e){error.textContent=e.message;save.disabled=false;skip.disabled=false;}
    };
  }
  window.PayslipReview={matches,originalButton:(entry,host)=>{host.dataset.originalFor=String(entry.id);return originalButton(entry,host);}};
  window.addEventListener('wagewise-ready',()=>{
    const result=el('p');result.id='import-result';result.setAttribute('role','status');$('import-review').before(result);
    $('import-choose').onclick=()=>$('import-files').click();
    $('import-files').onchange=()=>{queue=Array.from($('import-files').files);total=queue.length;$('import-choose').disabled=true;result.textContent='';next();};
    $('import-close-original').onclick=()=>$('import-original').close();
    $('import-original').onclose=()=>{cleanDialog?.();cleanDialog=null;$('import-original-pages').replaceChildren();};
    window.addEventListener('wagewise-workspace',reset);
  },{once:true});
})();
