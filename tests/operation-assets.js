const assert = require("assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow } = require("electron");

const root = path.join(__dirname, "..");
const assets = ["connecting.webp", "thinking.webp", "tool-use.webp", "testing.webp", "generating.webp"];

app.setPath("userData", path.join(root, "work", "test-user-data", `operation-${process.pid}`));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const sources = assets.map((filename) => ({
    filename,
    url: pathToFileURL(path.join(root, "assets", "whalepet-v015", filename)).href
  }));
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  // A data: page cannot read file: sprites under Chromium's security policy.
  await window.loadFile(path.join(root, "tests", "headband-fixture.html"));
  const results = await window.webContents.executeJavaScript(`(async () => {
    const sources = ${JSON.stringify(sources)};
    const results = [];
    for (const { filename, url } of sources) {
      const image = new Image();
      image.src = url + "?qa=" + Date.now();
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const probes = {
        'thinking.webp': { cloth: [[165,80],[177,79],[206,80]], hole: [[164,67],[157,69]] },
        'tool-use.webp': { cloth: [[190,80],[203,78],[235,80]], hole: [[191,66],[186,70]] },
        'generating.webp': { cloth: [[164,80],[172,78],[210,78]], hole: [[161,65],[153,70]] }
      }[filename];
      const alphaAt = ([x,y]) => rgba[(y*canvas.width+x)*4+3];
      let minimumNonzeroAlpha = 255;
      let maximumVisibleY = -1;
      let visiblePixels = 0;
      let lowerLegPixels = 0;
      for (let index = 3; index < rgba.length; index += 4) {
        const alpha = rgba[index];
        if (alpha === 0) continue;
        const pixelIndex = Math.floor(index / 4);
        const x = pixelIndex % canvas.width;
        const y = Math.floor(pixelIndex / canvas.width);
        minimumNonzeroAlpha = Math.min(minimumNonzeroAlpha, alpha);
        maximumVisibleY = Math.max(maximumVisibleY, y);
        visiblePixels += 1;
        if (alpha > 16 && y >= 360 && x >= 120 && x < 270) lowerLegPixels += 1;
      }
      results.push({
        filename,
        width: canvas.width,
        height: canvas.height,
        minimumNonzeroAlpha,
        maximumVisibleY,
        visiblePixels,
        lowerLegPixels,
        ruffleAlphas: probes?.cloth.map(alphaAt), holeAlphas: probes?.hole.map(alphaAt)
      });
    }
    return results;
  })()`);

  for (const result of results) {
    assert.equal(result.width, 384, `${result.filename} has the wrong width`);
    assert.equal(result.height, 384, `${result.filename} has the wrong height`);
    assert.ok(result.visiblePixels > 20_000, `${result.filename} lost too much character artwork`);
    assert.ok(result.minimumNonzeroAlpha >= 10, `${result.filename} contains sub-visible alpha dust`);
    assert.equal(result.maximumVisibleY, 373, `${result.filename} does not share the y=374 authored baseline`);
    assert.ok(result.lowerLegPixels > 300, `${result.filename} is missing its short legs or both shoes`);
    for (const alpha of result.ruffleAlphas || []) assert.ok(alpha >= 240, `${result.filename} lost an upper headband ruffle (${alpha})`);
    for (const alpha of result.holeAlphas || []) assert.equal(alpha, 0, `${result.filename} ahoge gap contains background paper`);
  }
  console.log("Operation assets passed: five 384px poses keep short legs, baseline, alpha floor; three repaired headbands retain cloth and transparent ahoge gaps");
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
