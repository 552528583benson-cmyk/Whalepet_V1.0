(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WhaleAhogePullAssets=api;
})(typeof window==='object'?window:globalThis,function(){
  // Both approved canvases stay intact. Their shared hair-tip anchor must not
  // move when the expression crossfades or when the body swings around it.
  const size=275,sourceSize=1254;
  return Object.freeze({
    size,sourceSize,
    pivot:Object.freeze({x:679/sourceSize*size,y:13/sourceSize*size}),
    poses:Object.freeze({
      open:'assets/generated-transitions/ahoge-pull/open.png',
      smile:'assets/generated-transitions/ahoge-pull/smile.png'
    }),
    smileDelayMs:3000,fadeMs:160
  });
});
