// wagewise.html and payroll.js are the only editable application sources.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'wagewise.html'),'utf8').replace('<script src="payroll.js"></script><!-- PAYROLL_ENGINE -->',()=>'<script>\n'+fs.readFileSync(path.join(root,'payroll.js'),'utf8')+'\n</script>');
for(const file of ['index.html','public/index.html']){
  const dest=path.join(root,file);
  if(process.argv.includes('--check')){
    if(fs.readFileSync(dest,'utf8')!==html)throw Error(file+' is stale. Run npm run build.');
  }else fs.writeFileSync(dest,html);
}
console.log('WageWise assets '+(process.argv.includes('--check')?'verified':'built'));
