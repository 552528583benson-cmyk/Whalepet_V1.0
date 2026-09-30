const fs=require('node:fs');
const path=require('node:path');
// Read HTML as data ONLY. Never execute its scripts or follow remote URLs.
function readAudioSource(source) {
  const ext=path.extname(source).toLowerCase();
  if(!['.mp3','.wav','.m4a','.ogg','.html','.htm'].includes(ext))throw new Error('请选择音频或内嵌歌曲的 LetMeGo HTML。');
  const stat=fs.statSync(source);
  if(!stat.isFile()||stat.size===0||stat.size>30*1024*1024)throw new Error('文件须为非空文件，且不超过 30 MB。');
  const bytes=fs.readFileSync(source);
  if(!['.html','.htm'].includes(ext))return {bytes,ext,name:path.basename(source)};
  const match=bytes.toString('utf8').match(/<script\b(?=[^>]*\bid\s*=\s*["']audio-b64["'])(?=[^>]*\btype\s*=\s*["']text\/plain["'])[^>]*>([\s\S]*?)<\/script\s*>/i);
  if(!match)throw new Error('没有找到 audio-b64 内嵌音频。请提供本地歌曲文件。');
  const data=match[1].replace(/\s/g,'');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length%4!==0)throw new Error('内嵌音频编码无效。');
  const decoded=Buffer.from(data,'base64');
  if(decoded.length<12||decoded.toString('ascii',4,8)!=='ftyp')throw new Error('内嵌内容不是预期的 M4A 音频。');
  return {bytes:decoded,ext:'.m4a',name:path.basename(source,path.extname(source))+'.m4a'};
}
module.exports={readAudioSource};
