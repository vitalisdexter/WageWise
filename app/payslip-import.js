(function(root, factory) {
  if (typeof module === 'object') module.exports = factory();
  else root.PayslipImport = factory();
})(globalThis, function() {
  'use strict';
  const categories = {basic:'Basic pay', overtime:'Overtime', backpay:'Back pay', bonus:'Bonus',
    earning:'Other gross earnings', tax:'PAYE', ni:'Employee NI', deduction:'Other deduction',
    reimbursement:'Reimbursement after tax', refund:'PAYE refund', unknown:'Choose treatment'};
  const moneyFields = ['gross','net','ytdGross','ytdTax','ytdNi','ytdTotal'];
  const textKey = text => text.trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const blank = () => ({employer:'',date:'',frequency:'',period:'',taxCode:'',niCode:'',
    gross:null,net:null,ytdGross:null,ytdTax:null,ytdNi:null,ytdTotal:null,lines:[],layout:''});
  const periodFor = (date, frequency) => {
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(date))) return '';
    const year = Number(date.slice(0,4)) - (date.slice(5) < '04-06');
    if (frequency === 'weekly') return String(1 + Math.floor((Date.parse(date)-Date.UTC(year,3,6))/604800000));
    if (frequency === 'monthly') return String(1 + (Number(date.slice(5,7)) - 4 - (Number(date.slice(8)) < 6) + 12) % 12);
    return '';
  };
  const parseDate = value => {
    const m = value.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/);
    const iso = m ? (m[3].length===2?'20':'')+m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0')
      : value.match(/\b\d{4}-\d\d-\d\d\b/)?.[0];
    if (iso && Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0,10)===iso) return iso;
    const named = value.match(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/i);
    return named && Number.isFinite(Date.parse(named[0]+' UTC')) ? new Date(named[0]+' UTC').toISOString().slice(0,10) : '';
  };
  const toPence = value => {
    const s = String(value).replace(/[£,\s]/g,'').replace(/[−–]/g,'-');
    if (!/^(?:-?\d+(?:\.\d{1,2})?|\(\d+(?:\.\d{1,2})?\)|\d+(?:\.\d{1,2})?-)$/.test(s)) return null;
    const n = Math.round(Number(s.replace(/[()-]/g,''))*100) * (/[-(]/.test(s)?-1:1);
    return Number.isSafeInteger(n) && Math.abs(n)<=999999999 ? n : null;
  };
  const ytd = /\b(?:ytd|year[ -]to[ -]date|to[ -]date|t[/'’]?d|t\/date)\b/i;
  function kind(label,section) {
    if (/\b(?:tax|paye).*(?:refund|reimburse|rebate)|(?:refund|rebate).*tax/i.test(label)) return 'refund';
    if (/^(?:income tax|tax|paye(?: tax)?)$/i.test(label)) return 'tax';
    if (/^(?:(?:employee|ees?)'?s?\s*)?(?:national insurance|n\.?i\.?(?:c(?:s)?)?)(?:\s+(?:employee|ees?))?$/i.test(label)) return 'ni';
    if (/\b(?:overtime|ot\s*\d*)\b/i.test(label)) return 'overtime';
    if (/\b(?:back ?pay|arrears)\b/i.test(label)) return 'backpay';
    if (/\bbonus\b/i.test(label)) return 'bonus';
    if (/\b(?:basic|salary|ordinary pay|standard pay)\b/i.test(label)) return 'basic';
    if (/\b(?:expenses?|reimbursements?)\b/i.test(label)) return 'reimbursement';
    if (/\b(?:pension|union|student loan)\b/i.test(label)||section==='deduction') return 'deduction';
    return section==='earning'?'earning':'unknown';
  }
  function field(label) {
    const s = label.trim().replace(/[:.]+$/,'').toLowerCase();
    if (ytd.test(s)) {
      if (/taxable|pay for tax/.test(s)) return 'ytdGross';
      if (/\btax\b|paye/.test(s)) return 'ytdTax';
      if (/employee ni|employee national insurance/.test(s)) return 'ytdNi';
      if (/gross pay|total pay/.test(s)) return 'ytdTotal';
      return 'ignore';
    }
    if (/^(?:total (?:gross(?: pay)?|earnings|pay)|gross(?: pay| earnings)?)(?: this period)?$/.test(s)) return 'gross';
    if (/^(?:net(?: pay| wages| payment)?|take[ -]home(?: pay)?|amount paid|payment to (?:you|bank))$/.test(s)) return 'net';
    if (/^(?:taxable (?:gross|pay)|gross pay for tax|total (?:deductions|ni)|rounding|contracted out|employer|tax code|employee number)/.test(s)) return 'ignore';
    return '';
  }
  // Coordinates are in page units, with y measured downwards. Preserve the gaps between table cells.
  function groupPage(words) {
    const rows=[];
    for (const w of [...words].filter(w=>w.text.trim()).sort((a,b)=>a.y-b.y||a.x-b.x)) {
      const row=rows.at(-1);
      if (row && Math.abs(w.y-row.y)<=Math.max(2,Math.min(row.h,w.h)*0.62)) row.words.push(w);
      else rows.push({y:w.y,h:w.h,words:[w]});
    }
    return rows.map(row=>{
      const cells=[];
      for (const w of row.words.sort((a,b)=>a.x-b.x)) {
        const prev=cells.at(-1);
        if (prev && w.x-prev.end < Math.max(1,w.h*0.8)) {
          prev.text+=' '+w.text; prev.end=Math.max(prev.end,w.x+w.w);
        } else cells.push({text:w.text,x:w.x,end:w.x+w.w});
      }
      return {...row,cells,text:cells.map(c=>c.text).join('  ')};
    });
  }
  const price = /(?<![\d.])(?:[-−–]?\s*£?\s*\d[\d,]*\.\d{2}(?:-|\b)|\(\s*£?\d[\d,]*\.\d{2}\s*\))(?![\d.])/g;
  function parse(pages) {
    const draft=blank(), headings=new Set(), seenDates=new Set();
    for (const words of pages) {
      const rows=groupPage(words);
      let section='',columns=null, stopLedger=false,sections=[],units=null;
      for (let i=0;i<rows.length;i++) {
        const {text,cells,h}=rows[i];
        const beneath=c=>{
          const index=cells.indexOf(c), left=c.x-h, right=cells[index+1]?.x??Infinity;
          for(const next of rows.slice(i+1,i+7)){
            if(next.y-rows[i].y>h*7)break;
            const candidates=next.cells.filter(v=>(v.x+v.end)/2>=left && (v.x+v.end)/2<right && /[\da-z]/i.test(v.text));
            if(candidates.length)return candidates.map(v=>v.text).join(' ');
          }
          return '';
        };
        for (const c of cells) {
          const s=c.text.trim(), norm=textKey(s);
          if (/^(?:employer|company)(?: name)?\s*[:\-]/i.test(s)) draft.employer=s.replace(/^.*?[:\-]\s*/,'').slice(0,120);
          if (!draft.employer && i<6 && /\b(?:ltd|limited|plc)\b/i.test(s)) draft.employer=s.replace(/^e[- ]?payslip\s*/i,'').slice(0,120);
          if (/\b(?:pay ?date|payment date|date paid)\b/i.test(s)) {
            const date=parseDate(s)||parseDate((cells[cells.indexOf(c)+1]?.text??''))||parseDate(beneath(c));
            if(date) seenDates.add(date);
          }
          if (/\b(?:weekly|monthly|fortnightly|four.weekly|4.weekly)\b/i.test(s) && !/pension/i.test(s))
            draft.frequency=/fortnightly|four.weekly|4.weekly/i.test(s)?'other':/monthly/i.test(s)?'monthly':'weekly';
          const period=s.match(/\b(tax week|tax month|pay period|period)\s*[:#]?\s*(\d{1,2})\b/i);
          if(period){draft.period=period[2];if(/week|month/i.test(period[1]))draft.frequency=/month/i.test(period[1])?'monthly':'weekly';}
          if (/^(?:period|tax week|tax month|pay period)$/i.test(s)) {
            const n=beneath(c).match(/^\s*(\d{1,2})\b/); if(n) draft.period=n[1];
          }
          const code=s.match(/\b([SC]?\d{1,4}[LMNT](?:\s+(?:W1|M1|X))?)\b/i);
          if(code && !draft.taxCode) draft.taxCode=code[1].toUpperCase();
          if (/^ni(?: (?:code|category|letter)|$)/i.test(s) && !draft.niCode) draft.niCode=(s.match(/[: ]([A-Z])$/)?.[1]||beneath(c).match(/^\s*([A-Z])\b/)?.[1]||'');
          if (/^(earnings|payments|pay & allowances|deductions|this period|current|current period|year to date|ytd|description|amount|narrative|rate|units|hours)$/.test(norm)||/^pay (?:and )?allowances$/.test(norm)) {
            headings.add(norm+'@'+cells.indexOf(c));
            if (/^(earnings|payments|pay (?:and )?allowances|deductions)$/.test(norm)) {
              section=norm==='deductions'?'deduction':'earning';
              if(sections.length && c.x<=sections.at(-1).x+h) sections=[];
              sections.push({x:c.x,section}); stopLedger=false;
            }
          }
        }
        if (/\b(?:current|this (?:period|month|week))\b/i.test(text) && cells.some(c=>ytd.test(c.text))) {
          const mid=c=>(c.x+c.end)/2;
          columns={current:mid(cells.find(c=>/\bcurrent|this (?:period|month|week)/i.test(c.text))),
            ytd:mid(cells.find(c=>ytd.test(c.text)))};
          headings.add('parallel ytd'); continue;
        }
        if (/^\s*(?:year[ -]to[ -]date(?: totals)?|to[ -]date totals|ytd totals)\s*$/i.test(text)) {stopLedger=true;columns=null;}
        if(cells.some(c=>/^(?:hours|units|quantity)$/i.test(c.text)) && cells.some(c=>/^rate$/i.test(c.text))){
          units={hours:cells.find(c=>/^(?:hours|units|quantity)$/i.test(c.text)).x,
            rate:cells.find(c=>/^rate$/i.test(c.text)).x,amount:cells.find(c=>/amount|current|this period/i.test(c.text))?.x};
          continue;
        }
        // Header bands can put figures directly beneath their labels, as in OneAdvanced.
        for (const c of cells) {
          const key=field(c.text);
          if (key && key!=='ignore' && draft[key]==null) {
            const m=beneath(c).trim().match(/^[-£(]?\s*\d[\d,]*\.\d\d[)-]?(?=\s|$)/);
            if(m) draft[key]=toPence(m[0]);
          }
        }
        let pendingLabel='', qty=null,rate=null,labelX=0,previousLabel='';
        const setValue=(label,amount,x)=>{
          if(!label||amount==null)return;
          let key=field(label);
          if((columns && Math.abs(x-columns.ytd)<Math.abs(x-columns.current))||stopLedger) {
            key=field(label+' YTD'); if(key && key!=='ignore')draft[key]=amount; return;
          }
          if(key){if(key!=='ignore')draft[key]=amount;return;}
          if(stopLedger||/^(?:total|balance|taxable|employer|period|pay date|pension t|rate|amount|narrative|to.date|rounding|contracted)/i.test(label)||ytd.test(label))return;
          const local=sections.filter(col=>col.x<=labelX+h).at(-1)?.section || section;
          if(!local && kind(label,'')==='unknown' && !columns)return;
          draft.lines.push({label:label.slice(0,100),kind:kind(label,local),pence:amount,hours:qty,rate});
        };
        for(const c of cells){
          if(units && units.amount!=null && /^£?[\d,.]+$/.test(c.text.trim())){
            const center=(c.x+c.end)/2;
            const closest=Object.entries(units).sort((a,b)=>Math.abs(a[1]-center)-Math.abs(b[1]-center))[0][0];
            if(closest==='hours'){qty=Number(c.text.replace(/,/g,''));continue;}
            if(closest==='rate'){rate=Number(c.text.replace(/[£,]/g,''));continue;}
          }
          const mult=c.text.match(/(\d+(?:\.\d+)?)\s*[x×@]\s*£?(\d+(?:\.\d+)?)/i);
          let s=c.text;
          if(mult){qty=Number(mult[1]);rate=Number(mult[2]);s=s.replace(mult[0],' ');}
          const matches=[...s.matchAll(price)];
          if(!matches.length){
            if(s.trim() && /[a-z]/i.test(s)){pendingLabel=s.trim();labelX=c.x;}
            continue;
          }
          let end=0;
          for(const m of matches){
            const prefix=s.slice(end,m.index).trim().replace(/[:£\s]+$/,'');
            if(/[a-z]/i.test(prefix)){pendingLabel=prefix;labelX=c.x;}
            const label=pendingLabel || (columns?previousLabel:'');
            setValue(label,toPence(m[0]),c.x+(c.end-c.x)*m.index/Math.max(1,s.length));
            if(label)previousLabel=label;
            pendingLabel='';qty=null;rate=null;end=m.index+m[0].length;
          }
          if(/[a-z]/i.test(s.slice(end))) pendingLabel=s.slice(end).trim();
        }
      }
    }
    if(seenDates.size>1)throw Error('Several pay dates were found. Select one file per payslip.');
    if(seenDates.size===1)draft.date=[...seenDates][0];
    draft.layout=[...headings].join('|').slice(0,600);
    return draft;
  }
  function totals(lines) {
    const result={gross:0,deductions:0,credits:0,basic:0,overtime:0,hours:0,tax:null,ni:null};
    for(const row of lines) {
      const n=row.pence;
      if(['basic','overtime','backpay','bonus','earning'].includes(row.kind)) result.gross+=n;
      if(row.kind==='basic')result.basic+=n;
      if(row.kind==='overtime'){result.overtime+=n;result.hours=row.hours==null||result.hours==null?null:result.hours+row.hours;}
      if(row.kind==='reimbursement')result.credits+=n;
      if(['ni','tax','refund','deduction'].includes(row.kind))result.deductions+=row.kind==='refund'?-Math.abs(n):n;
      if(row.kind==='ni')result.ni=(result.ni??0)+n;
      if(['tax','refund'].includes(row.kind))result.tax=(result.tax??0)+(row.kind==='refund'?-Math.abs(n):n);
    }
    return result;
  }
  const differences = d => {
    const t=totals(d.lines);
    return {gross:d.gross==null?null:d.gross-t.gross,net:d.net==null||d.gross==null?null:d.net-(d.gross+t.credits-t.deductions)};
  };
  const valid = d => d && typeof d==='object' && ['employer','period','taxCode','niCode','layout'].every(k=>typeof d[k]==='string'&&d[k].length<=600)
    && ['weekly','monthly','other'].includes(d.frequency) && typeof d.date==='string'
    && moneyFields.every(k=>d[k]===null||Number.isSafeInteger(d[k])&&Math.abs(d[k])<=999999999)
    && d.gross!=null && d.gross>=0 && d.net!=null && /^[a-f0-9]{64}$/.test(d.hash)
    && Array.isArray(d.lines)&&d.lines.length<=300&&d.lines.every(r=>r && typeof r.label==='string'&&r.label.trim()&&r.label.length<=100
      && Object.hasOwn(categories,r.kind)&&r.kind!=='unknown'&&Number.isSafeInteger(r.pence)&&Math.abs(r.pence)<=999999999
      && ['hours','rate'].every(k=>r[k]===null||Number.isFinite(r[k])&&r[k]>=0&&r[k]<=999999));
  return {blank,parse,kind,categories,toPence,textKey,totals,differences,periodFor,valid,moneyFields};
});
