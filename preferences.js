const fs = require('node:fs');
const path = require('node:path');
const POSES = Object.freeze([
  ['idle','待机','idle.webp'], ['connecting','连接网络','connecting.webp'],
  ['thinking','思考中','thinking.webp'], ['reading','阅读文件','reading.webp'],
  ['searching','搜索文件','searching.webp'], ['tool_use','调用工具','tool-use.webp'],
  ['working','工作中','working.webp'], ['testing','检查结果','testing.webp'],
  ['generating','生成内容','generating.webp'], ['needs_input','需要你','needs-input.webp'],
  ['ready','完成','ready.webp'], ['blocked','遇到问题','blocked.webp']
]);
function normalizePreferences(value = {}) {
  const scale = Number(value.scale);
  const images = {};
  for (const [state] of POSES) {
    if (/^[a-f0-9-]{36}\.png$/.test(value.images?.[state] || '')) images[state] = value.images[state];
  }
  return {
    scale: Number.isFinite(scale) ? Math.round(Math.max(.65, Math.min(1.5, scale))*100)/100 : 1,
    showBadge: value.showBadge !== false, showSpeech: value.showSpeech !== false,
    idleLife: value.idleLife !== false,
    customLabel: typeof value.customLabel === 'string' ? value.customLabel.trim().slice(0,20) || '我的 AI' : '我的 AI',
    images
  };
}
function readPreferences(file) {
  try { return normalizePreferences(JSON.parse(fs.readFileSync(file,'utf8'))); }
  catch { return normalizePreferences(); }
}
function writePreferences(file, value) {
  const next = normalizePreferences(value);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n');
  fs.renameSync(temp,file);
  return next;
}
module.exports = { POSES, normalizePreferences, readPreferences, writePreferences };
