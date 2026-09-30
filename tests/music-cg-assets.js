const assert=require('node:assert/strict');
const {app,nativeImage}=require('electron');
const path=require('node:path');
app.whenReady().then(()=>{
  for(const file of ['assets/whalepet-hd/idle.png','assets/whalepet-music/listening-v1.png','assets/whalepet-music/dancing-v1.png']) {
    const img=nativeImage.createFromPath(path.join(__dirname,'..',file)),{width,height}=img.getSize(),p=img.toBitmap();
    assert.ok(width>=1024&&height>=1024);
    let transparent=0,left=width,top=height,right=0,bottom=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=p[(y*width+x)*4+3];if(a===0)transparent++;if(a>32){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}}
    assert.ok(transparent>width*height*.35,'real alpha, not a painted background');
    if(file.includes('listening')) {
      assert.equal(p[(150*width+575)*4+3],0,'enclosed ahoge gap is transparent');
      assert.ok(p[(220*width+570)*4+3]>=250,'white headband is essentially opaque, not cut away');
    }
    if(file.includes('dancing')) {
      assert.equal(p[(115*width+580)*4+3],0,'dance ahoge gap is transparent');
      assert.ok(p[(178*width+580)*4+3]>=250,'dance headband fabric preserved');
      assert.ok(p[(1160*width+590)*4+3]>=250,'first shoe preserved');
      assert.ok(p[(1100*width+740)*4+3]>=250,'second shoe preserved');
    }
    console.log(JSON.stringify({file,width,height,transparentFraction:transparent/(width*height),bounds:{left,top,right,bottom}}));
  }
  app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
