// Separate from pose/drag rendering: music never changes the AI state machine.
(() => {
  let audio=null, fade=null, generation=0, danceRaf=0;
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const cg=new Image();
  cg.className='music-cg';cg.alt='小鲸握着两根粉色荧光棒，开心地左右应援';
  cg.dataset.filename='music-dancing-v1';cg.hidden=true;cg.draggable=false;
  cg.src='assets/whalepet-music/dancing-v1.png';
  document.querySelector('.stage').append(cg);
  const cgReady=cg.decode().then(()=>true,()=>false);
  const note=document.createElement('span');
  note.className='idle-song-note';note.textContent='♫';note.hidden=true;
  note.setAttribute('aria-label','小鲸正在偷偷唱歌');
  document.querySelector('.stage').append(note);
  function dance() {
    danceRaf=0;
    if(!audio||cg.hidden)return;
    const pose=window.WhaleMusicDance.frame(audio.currentTime,{
      compact:document.body.classList.contains('compact-pet'),
      dpr:window.devicePixelRatio,reduced:reduceMotion.matches
    });
    cg.style.transform=`translate(${pose.x}px,${pose.y}px) rotate(${pose.angle}deg)`;
    cg.dataset.danceAngle=String(pose.angle);
    cg.dataset.danceTime=String(audio.currentTime);
    danceRaf=requestAnimationFrame(dance);
  }
  function stop() {
    generation++;
    cancelAnimationFrame(danceRaf);danceRaf=0;
    cg.style.transform='none';delete cg.dataset.danceAngle;delete cg.dataset.danceTime;
    clearInterval(fade);fade=null;note.hidden=true;
    cg.hidden=true;document.body.classList.remove('music-playing');
    window.whalePetController?.idleLife.sync();
    if(audio){audio.pause();audio.removeAttribute('src');audio.load();audio=null;}
  }
  window.whalePet.onIdleSong(async packet=>{
    stop();
    if(packet.action!=='play')return;
    const mine=generation;
    const player=new Audio(packet.url);audio=player;player.volume=0;player.loop=false;
    const result=status=>{if(mine===generation){stop();window.whalePet.idleSongResult({token:packet.token,status});}};
    player.addEventListener('ended',()=>result('ended'),{once:true});
    player.addEventListener('error',()=>result('error'),{once:true});
    try {
      await player.play();
      if(mine!==generation)return;
      note.hidden=false;
      if(await cgReady) {
        if(mine!==generation)return;
        cg.hidden=false;document.body.classList.add('music-playing');
        window.whalePetController?.idleLife.sync();
        dance();
      }
      if(mine!==generation)return;
      const start=performance.now(),volume=Math.max(0,Math.min(.5,packet.volume||0));
      fade=setInterval(()=>{player.volume=volume*Math.min(1,(performance.now()-start)/1800);if(player.volume>=volume){clearInterval(fade);fade=null;}},50);
    } catch {result('error');}
  });
  const hush=()=>{stop();window.whalePet.idleSongActivity();};
  // Let the pet hit-test the currently visible glowstick sprite first; hiding
  // it in capture phase would make clicks on outstretched hands miss the pet.
  document.addEventListener('pointerdown',hush);
  document.addEventListener('contextmenu',hush,true);
  window.addEventListener('beforeunload',stop);
})();
