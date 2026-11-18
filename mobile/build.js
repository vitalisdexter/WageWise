const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const web = path.join(__dirname, 'web');
execFileSync(process.execPath, [path.join(root, 'scripts', 'build.js')], {stdio: 'inherit'});
fs.mkdirSync(web, {recursive: true});
for (const obsolete of ['app.js', 'calculator.html', 'payroll.js', 'planner-view.js', 'planner.js', 'style.css', 'tracking.js']) {
  fs.rmSync(path.join(web, obsolete), {force: true});
}
for (const file of ['index.html', 'sync-config.json', 'icon.svg', 'manifest.webmanifest']) {
  fs.copyFileSync(path.join(root, 'public', file), path.join(web, file));
}
