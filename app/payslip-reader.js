(() => {
  'use strict';
  // Version the asset directory together with the dependency lockfile and service worker.
  const base='/payslip-reader/v1/';
  let pdfModule,ocrScript,preparing;
  function prepareOffline(){
    if(!('caches' in window))return Promise.resolve(false);
    return preparing??=(async()=>{
      const cache=await caches.open('wagewise-reader-v1');
      const manifest=await cache.match(base+'offline.json')||await fetch(base+'offline.json');
      const files=await manifest.clone().json();
      for(const name of files){
        const path=base+name;
        if(!await cache.match(path))await cache.add(path);
      }
      await cache.put(base+'offline.json',manifest);
      return true;
    })().catch(()=>{preparing=null;return false;});
  }
  async function pdfLibrary(){
    const pdf=await (pdfModule??=import(base+'pdf.min.mjs').catch(e=>{pdfModule=null;throw e;}));
    pdf.GlobalWorkerOptions.workerSrc=base+'pdf.worker.min.mjs';
    return pdf;
  }
  async function ocrLibrary(){
    if(window.Tesseract)return window.Tesseract;
    await (ocrScript??=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=base+'tesseract.min.js';
      script.onload=resolve;script.onerror=()=>{ocrScript=null;script.remove();reject(Error('Go online once to download the image reader.'));};
      document.head.append(script);
    }));
    return window.Tesseract;
  }
  // Ruled payroll tables often touch the digits in the amount column. Remove long
  // straight rules before OCR, retaining the original bitmap for the review pane.
  function removeRules(canvas) {
    const ctx=canvas.getContext('2d'),width=canvas.width,height=canvas.height;
    const pixels=ctx.getImageData(0,0,width,height),data=pixels.data;
    const ink=new Uint8Array(width*height);
    for(let i=0;i<ink.length;i++){
      const p=i*4;ink[i]=Math.min(data[p],data[p+1],data[p+2])<130 && Math.max(data[p],data[p+1],data[p+2])<225;
    }
    function erase(start,stride,length,min) {
      let first=-1;
      for(let i=0;i<=length;i++){
        if(i<length&&ink[start+i*stride]){if(first<0)first=i;continue;}
        if(first>=0&&i-first>=min){
          for(let j=first;j<i;j++){const k=4*(start+j*stride);data[k]=data[k+1]=data[k+2]=255;}
        }
        first=-1;
      }
    }
    for(let y=0;y<height;y++)erase(y*width,1,width,Math.max(45,width*.07));
    for(let x=0;x<width;x++)erase(x,width,height,Math.max(45,height*.05));
    ctx.putImageData(pixels,0,0);
  }
  async function extract(file,status) {
    const pages=[];
    let worker,doc;
    async function recognise(source) {
      removeRules(source);
      const T=await ocrLibrary();
      worker??=await T.createWorker('eng',1,{workerPath:base+'worker.min.js',workerBlobURL:false,
        corePath:base+'tesseract-core-lstm.wasm.js',langPath:base,logger:m=>{
          status(m.status==='recognizing text'?'Reading image · '+Math.round(m.progress*100)+'%':'Preparing image reader…');
        }});
      await worker.setParameters({tessedit_pageseg_mode:T.PSM.SPARSE_TEXT});
      const {data}=await worker.recognize(source,{}, {blocks:true});
      const words=(data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words.map(w=>({
        text:w.text,x:w.bbox.x0,y:(w.bbox.y0+w.bbox.y1)/2,w:w.bbox.x1-w.bbox.x0,h:w.bbox.y1-w.bbox.y0
      })))));
      // A narrow second digit can disappear among table rules. Re-read the period
      // cell on its own when the first pass disagrees with the dated tax period.
      const draft=PayslipImport.parse([words]),expected=PayslipImport.periodFor(draft.date,draft.frequency);
      if(expected&&draft.period&&draft.period!==expected){
        const header=words.find(w=>/^period$/i.test(w.text));
        const value=header&&words.find(w=>w.text===draft.period&&w.y>header.y&&w.y-header.y<header.h*7&&Math.abs(w.x-header.x)<header.w);
        if(value){
          const pad=value.h;
          const left=Math.max(0,Math.floor(value.x-pad*.6)),top=Math.max(0,Math.floor(value.y-pad*.9));
          const rectangle={left,top,width:Math.min(source.width-left,Math.ceil(value.w+pad*2)),height:Math.min(source.height-top,Math.ceil(pad*1.8))};
          await worker.setParameters({tessedit_pageseg_mode:T.PSM.SINGLE_WORD,tessedit_char_whitelist:'0123456789'});
          const retry=await worker.recognize(source,{rectangle});
          if(retry.data.text.trim()===expected)value.text=expected;
          await worker.setParameters({tessedit_char_whitelist:''});
        }
      }
      return words;
    }
    try {
      if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
        const pdf=await pdfLibrary();
        doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,
          useSystemFonts:true,wasmUrl:base+'wasm/'}).promise;
        if(doc.numPages>20)throw Error('Choose a PDF with up to 20 pages for one payslip.');
        for(let n=1;n<=doc.numPages;n++){
          status('Reading PDF page '+n+' of '+doc.numPages+'…');
          const page=await doc.getPage(n),vp=page.getViewport({scale:1});
          const content=await page.getTextContent();
          let words=content.items.filter(item=>item.str?.trim()).map(item=>{
            const m=pdf.Util.transform(vp.transform,item.transform);
            const h=Math.hypot(m[2],m[3])||item.height||10;
            return {text:item.str,x:m[4],y:m[5]-h/2,w:item.width,h};
          });
          if(!words.some(w=>/\d[.,]\d{2}\b/.test(w.text))){
            const viewport=page.getViewport({scale:Math.min(3,2400/Math.max(vp.width,vp.height))});
            const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
            try{await page.render({canvas,viewport}).promise;words=await recognise(canvas);}
            finally{canvas.width=canvas.height=0;}
          }
          pages.push(words);page.cleanup();
        }
      }else{
        const bitmap=await createImageBitmap(file);
        const scale=Math.min(3,2800/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
        const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
        try{pages.push(await recognise(canvas));}finally{canvas.width=canvas.height=0;}
      }
      return PayslipImport.parse(pages);
    }finally{await worker?.terminate();await doc?.loadingTask.destroy();}
  }
  async function preview(file,host) {
    const url=URL.createObjectURL(file);
    let doc,closed=false;
    const clear=()=>{closed=true;URL.revokeObjectURL(url);doc?.loadingTask.destroy();};
    if(file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name)){
      const img=document.createElement('img');img.alt='Original payslip';img.src=url;host.replaceChildren(img);
    }else{
      const display=async()=>{
        const pdf=await pdfLibrary();if(closed)return;
        doc=await pdf.getDocument({url,isEvalSupported:false,wasmUrl:base+'wasm/'}).promise;
        if(closed){await doc.loadingTask.destroy();return;}
        const select=document.createElement('select');select.setAttribute('aria-label','Original page');
        for(let n=1;n<=doc.numPages;n++)select.add(new Option('Page '+n+' of '+doc.numPages,String(n)));
        const canvas=document.createElement('canvas');host.replaceChildren(select,canvas);
        const render=async()=>{
          select.disabled=true;
          try{
            const page=await doc.getPage(Number(select.value));
            const baseViewport=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,1600/Math.max(baseViewport.width,baseViewport.height))});
            canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
            await page.render({canvas,viewport}).promise;
          }finally{select.disabled=false;}
        };
        select.onchange=()=>render().catch(fail);await render();
      };
      const fail=()=>{if(!closed)host.textContent='This PDF could not be previewed. Open the source file on your device to check its figures.';};
      display().catch(fail);
    }
    return clear;
  }
  window.WageWiseReader={extract,preview,prepareOffline};
})();
