const fs = require('node:fs');
const path = require('node:path');
const {buildSync} = require('esbuild');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const script = contents => '<script>\n' + contents.replace(/<\/script/gi, '<\\/script') + '\n</script>';
const files = ['app/tracking.js', 'app/planner.js', 'app/planner-view.js', 'app/data.js', 'app/merge.js', 'app/features.js'];
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
for (const file of ['index.html', 'public/index.html']) {
  if (check) {
    if (read(file) !== html) throw Error(file + ' is stale. Run npm run build.');
  } else fs.writeFileSync(path.join(root, file), html);
}
if (!check) fs.writeFileSync(path.join(root, 'public', 'sync-config.json'), JSON.stringify(syncConfig()));
console.log('WageWise assets ' + (check ? 'verified' : 'built'));
