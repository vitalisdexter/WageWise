const fs = require('node:fs');
const path = require('node:path');
const {buildSync} = require('esbuild');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const script = contents => '<script>\n' + contents.replace(/<\/script/gi, '<\\/script') + '\n</script>';
const files = ['app/payslip-import.js', 'app/tracking.js', 'app/planner.js', 'app/planner-view.js', 'app/data.js', 'app/merge.js', 'app/features.js', 'app/payslip-reader.js', 'app/payslip-review.js'];
const auth = buildSync({
  absWorkingDir: root,
  entryPoints: ['app/cloud.js'],
  bundle: true,
  legalComments: 'inline',
  minify: true,
  write: false
}).outputFiles[0].text;
const html = read('wagewise.html')
  .replace('/* SHARED_STYLE */', () => read('app/style.css'))
  .replace('<script src="payroll.js"></script><!-- PAYROLL_ENGINE -->', () => script(read('payroll.js')))
  .replace('<!-- SHARED_APP -->', () => script(files.map(read).join('\n')) + script(auth));

function syncConfig() {
  const local = path.join(root, '.wagewise-sync.json');
  const saved = JSON.parse(read('supabase/client.json'));
  if (fs.existsSync(local)) Object.assign(saved, JSON.parse(fs.readFileSync(local, 'utf8')));
  const url = process.env.WAGEWISE_SUPABASE_URL ?? saved.url ?? '';
  const publishableKey = process.env.WAGEWISE_SUPABASE_PUBLISHABLE_KEY ?? saved.publishableKey ?? '';
  if (!url && !publishableKey) return {};
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !/^sb_publishable_[\w-]+$/.test(publishableKey)) {
    throw Error('Use a Supabase project URL and a publishable key.');
  }
  return {url, publishableKey};
}

const check = process.argv.includes('--check');
const readerDir = path.join(root, 'public/payslip-reader/v1');
if (!check) fs.mkdirSync(readerDir, {recursive:true});
const readerFiles = [
  'pdfjs-dist/build/pdf.min.mjs', 'pdfjs-dist/build/pdf.worker.min.mjs',
  'tesseract.js/dist/tesseract.min.js', 'tesseract.js/dist/worker.min.js',
  'tesseract.js/dist/tesseract.min.js.LICENSE.txt', 'tesseract.js/dist/worker.min.js.LICENSE.txt',
  'tesseract.js-core/tesseract-core-lstm.wasm.js', '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
];
for (const file of readerFiles) {
  const src = path.join(root,'node_modules',file), dest = path.join(readerDir,path.basename(file));
  if (!check) fs.copyFileSync(src,dest);
  else if (!fs.existsSync(dest) || !fs.readFileSync(src).equals(fs.readFileSync(dest))) throw Error(file+' reader asset is stale');
}
if (!check) fs.cpSync(path.join(root,'node_modules/pdfjs-dist/wasm'),path.join(readerDir,'wasm'),{recursive:true});
if (!check) {
  for (const pkg of ['pdfjs-dist','tesseract.js','tesseract.js-core']) {
    fs.copyFileSync(path.join(root,'node_modules',pkg,pkg==='tesseract.js'?'LICENSE.md':'LICENSE'),path.join(readerDir,pkg+'-LICENSE.txt'));
  }
  const assets=readerFiles.filter(f=>!f.endsWith('.txt')).map(f=>path.basename(f));
  for(const name of fs.readdirSync(path.join(readerDir,'wasm')))if(/\.(wasm|js)$/.test(name))assets.push('wasm/'+name);
  fs.writeFileSync(path.join(readerDir,'offline.json'),JSON.stringify(assets));
}
for (const file of ['index.html', 'public/index.html']) {
  if (check) {
    if (read(file) !== html) throw Error(file + ' is stale. Run npm run build.');
  } else fs.writeFileSync(path.join(root, file), html);
}
if (!check) fs.writeFileSync(path.join(root, 'public', 'sync-config.json'), JSON.stringify(syncConfig()));
console.log('WageWise assets ' + (check ? 'verified' : 'built'));
