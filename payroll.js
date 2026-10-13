/* Weekly Scottish suffix-code PAYE; HMRC PAYErout v24, sections 3.3 and 4.
   No personal payslip information is included in this module. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.Payroll=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const round=n=>Math.round((n+Number.EPSILON)*100)/100;
  const down=(n,p=100)=>Math.floor(n*p+1e-7)/p;
  const valid=n=>typeof n==='number'&&Number.isFinite(n);
  function year(iso){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,10)!==iso)throw Error('Choose a valid pay date.');
    return Number(iso.slice(0,4))-(iso.slice(5)<'04-06'?1:0);
  }
  function week(iso){return Math.floor((Date.parse(iso)-Date.UTC(year(iso),3,6))/604800000)+1;}
  function bands(y){
    if(y!==2025&&y!==2026)throw Error('Supported tax years: 2025/26 and 2026/27.');
    return (y===2026?[3967,12989,14136,31338,62710,Infinity]:[2827,12094,16171,31338,62710,Infinity]).map((width,i)=>({width,rate:[.19,.20,.21,.42,.45,.48][i],name:['Starter','Basic','Intermediate','Higher','Advanced','Top'][i]+' rate'}));
  }
  function freePay(allowance){
    if(!valid(allowance)||allowance<0||allowance>9999990||allowance%10!==0)throw Error('Enter the numeric Scottish tax-code allowance in multiples of £10 (S1257L = £12,570).');
    const code=allowance/10;
    if(!code)return 0;
    const q=Math.floor((code-1)/500),remainder=(code-1)%500+1;
    return (q*9616+Math.ceil(down((remainder*10+9)/52,10000)*100-1e-7))/100;
  }
  function liability(gross,n,allowance,y){
    const bs=bands(y),free=round(freePay(allowance)*n),un=round(Math.max(0,gross-free)),tn=Math.floor(un);
    let cumulativeWidth=0,cumulativeTax=0,previousThreshold=0,previousTax=0;
    let tax=0,selected=bs[0];
    for(const b of bs){
      cumulativeWidth+=b.width;
      const threshold=down(cumulativeWidth*n/52,10000);
      if(un<=Math.ceil(threshold)||!Number.isFinite(b.width)){
        selected=b;tax=down(Math.max(0,previousTax+(tn-previousThreshold)*b.rate));break;
      }
      cumulativeTax+=b.width*b.rate;
      previousThreshold=threshold;previousTax=down(cumulativeTax*n/52,10000);
    }
    return {tax,freePay:free,taxable:tn,rate:selected.rate,breakdown:un>0?[{name:'PAYE total (rounded; top band '+selected.name+')',rate:selected.rate,amount:tn,tax}]:[]};
  }
  function ni(gross){
    const main=round(Math.max(0,Math.min(gross,967)-242)*.08),upper=round(Math.max(0,gross-967)*.02);
    return {ni:round(main+upper),breakdown:[{name:'8% (£242–£967)',amount:Math.max(0,Math.min(gross,967)-242),ni:main},{name:'2% above £967',amount:Math.max(0,gross-967),ni:upper}].filter(b=>b.amount>0)};
  }
  function calculate({gross,date,allowance=12570,prior=null,deductions=[]}){
    if(!valid(gross)||gross<0||gross>10000000)throw Error('Pay must be a finite amount between £0 and £10,000,000.');
    const y=year(date),w=week(date);bands(y);gross=round(gross);
    let mode='Week 1 estimate — complete prior YTD figures not supplied';
    if(prior){
      if(!valid(prior.gross)||prior.gross<0||!valid(prior.tax)||!Number.isInteger(prior.week)||prior.week!==w-1)throw Error('YTD figures must cover all pay through the week immediately before this pay date.');
      if(prior.year!==y)throw Error('YTD figures must belong to the selected tax year.');
      if(prior.ni!=null&&(!valid(prior.ni)||prior.ni<0))throw Error('YTD NI must be zero or a positive amount.');
      mode='Cumulative PAYE — using supplied prior YTD';
    }
    if(w===53)mode='Week 53 — extra weekly allowance (Week 1 basis)';
    const cumulative=prior&&w<=52,base=cumulative?prior.gross:0,paid=cumulative?prior.tax:0;
    const due=liability(round(base+gross),cumulative?w:1,allowance,y);
    const tax=round(Math.min(down(gross*.5),round(due.tax-paid))),nr=ni(gross);
    const breakdown=deductions.map(d=>{
      if(!valid(d.value)||d.value<0||!['percent','amount'].includes(d.type))throw Error('Invalid deduction.');
      return {...d,amount:round(d.type==='percent'?gross*d.value/100:d.value)};
    });
    const total=round(breakdown.reduce((s,d)=>s+d.amount,0));
    return {gross,taxW:tax,taxRes:due,niRes:nr,customDedRes:{total,breakdown},net:round(gross-tax-nr.ni-total),taxWeek:w,taxYear:y,mode,prior,
      cumulativeGross:prior?round(prior.gross+gross):null,cumulativeTaxToDate:prior?round(prior.tax+tax):null,cumulativeNiToDate:prior&&prior.ni!=null?round(prior.ni+nr.ni):null};
  }
  return {round,year,week,bands,freePay,liability,ni,calculate};
});
