const fs = require('node:fs');
const path = require('node:path');
const {normalizeGames}=require('./user-activity');
const POSES = Object.freeze([
  ['idle','待机','idle.webp'], ['connecting','连接网络','connecting.webp'],
  ['thinking','思考中','thinking.webp'], ['reading','阅读文件','reading.webp'],
  ['searching','搜索文件','searching.webp'], ['tool_use','调用工具','tool-use.webp'],
  ['working','工作中','working.webp'], ['testing','检查结果','testing.webp'],
  ['generating','生成内容','generating.webp'], ['needs_input','需要你','needs-input.webp'],
  ['ready','完成','ready.webp'], ['blocked','遇到问题','blocked.webp']
]);
function normalizePreferences(value = {}) {
  if(!value||typeof value!=='object'||Array.isArray(value))value={};
  const scale = Number(value.scale);
  const images = {};
  for (const [state] of POSES) {
    if (/^[a-f0-9-]{36}\.png$/.test(value.images?.[state] || '')) images[state] = value.images[state];
  }
  return {
    scale: Number.isFinite(scale) ? Math.round(Math.max(.65, Math.min(1.5, scale))*100)/100 : 1,
    bubbleScale: Number.isFinite(value.bubbleScale) ? Math.round(Math.max(.8,Math.min(1.2,value.bubbleScale))*100)/100 : 1,
    bubbleOffset: Number.isFinite(value.bubbleOffset) ? Math.round(Math.max(-20,Math.min(30,value.bubbleOffset))) : 0,
    showBadge: value.showBadge !== false, showSpeech: value.showSpeech !== false,
    typingCompanion: value.typingCompanion === true,
    gameCompanion: value.gameCompanion === true,
    games: normalizeGames(value.games),
    idleLife: value.idleLife !== false,
    idleSongEnabled: value.idleSongEnabled === true,
    idleSongMode: ['pet','system'].includes(value.idleSongMode) ? value.idleSongMode : 'ai',
    idleSongVolume: Number.isFinite(value.idleSongVolume) ? Math.max(0,Math.min(.5,value.idleSongVolume)) : .18,
    idleSongFile: /^[a-f0-9-]{36}\.(mp3|wav|m4a|ogg)$/.test(value.idleSongFile || '') ? value.idleSongFile : '',
    idleSongName: typeof value.idleSongName === 'string' ? value.idleSongName.slice(0,120) : '',
    customLabel: typeof value.customLabel === 'string' ? value.customLabel.trim().slice(0,20) || '我的 AI' : '我的 AI',
    images
  };
}
function readPreferences(file) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file,'utf8')); }
  catch { return normalizePreferences(); }
  const next = normalizePreferences(value);
  // The removed full-character mouse lock must not survive an upgrade. Keep
  // every other preference, even if a read-only filesystem prevents migration.
  if(value&&Object.hasOwn(value,'clickThrough')){
    try { writePreferences(file,next); }
    catch(error) { console.warn('WhalePet could not clean the retired mouse setting: '+error.message); }
  }
  return next;
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
