// Read-only checks: documentation links, state filenames and runnable test names.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const names=['MAKE_YOUR_OWN_WHALEPET.md','CREATOR_CHECKLIST.md','CREATION_INDEX.md'];
for(const name of names){
 const file=path.join(root,'docs',name),text=fs.readFileSync(file,'utf8');
 assert.equal((text.match(/^```/gm)||[]).length%2,0,`${name}: code fences`);
 for(const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
  const href=match[1];if(/^(https?:|#)/.test(href))continue;
  assert.ok(fs.existsSync(path.resolve(path.dirname(file),href.split('#')[0])),`${name}: broken link ${href}`);
 }
 assert.ok(!/C:[/\\]Users[/\\]ASUS/i.test(text),`${name}: author-specific path`);
}
const guide=fs.readFileSync(path.join(root,'docs',names[0]),'utf8');
const {POSES}=require(path.join(root,'preferences.js'));
for(const [state,,logical] of POSES){
 const png=logical.replace(/\.webp$/,'.png');
 assert.ok(guide.includes('`'+state+'`')&&guide.includes('`'+png+'`'),`missing state mapping ${state}`);
 assert.ok(fs.existsSync(path.join(root,'assets/whalepet-hd',png)),`missing runtime image ${png}`);
}
const scripts=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).scripts;
for(const [,name] of guide.matchAll(/npm run ([\w:-]+)/g))assert.ok(scripts[name],`unknown npm command ${name}`);
for(let step=0;step<=10;step++)assert.ok(guide.includes(`## ${step}.`),`missing step ${step}`);
assert.ok(guide.includes('不会自动写进发布 ZIP'));
assert.ok(guide.includes('不是验收证明'));
console.log('Creator docs PASS: 3 documents, local links, 12 state/file mappings, 11 steps and npm commands.',root);
