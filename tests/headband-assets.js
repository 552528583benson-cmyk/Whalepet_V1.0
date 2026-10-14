const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const ROOT = path.resolve(__dirname, "..");
app.setPath("userData", path.join(ROOT, "work", "test-user-data", `headband-${process.pid}`));
app.disableHardwareAcceleration();
const EXPECTED_SIZE = { width: 338, height: 313 };
const REPAIRED_SAMPLES = {
  1: [[143, 55], [162, 54], [187, 52]],
  2: [[136, 52], [159, 51], [188, 50]],
  3: [[135, 47], [154, 47], [183, 47]],
  4: [[75, 44], [90, 45], [117, 45]],
  5: [[144, 102], [163, 102], [190, 102]],
  6: [[106, 157], [138, 154], [173, 157]],
  7: [[138, 122], [160, 121], [186, 121]],
  8: [[156, 94], [175, 94], [201, 94]],
  9: [[137, 94], [156, 94], [184, 94]],
  10: [[136, 90], [160, 90], [185, 90]],
  11: [[188, 118], [197, 115], [217, 115]],
  12: [[153, 71], [176, 71], [202, 71]],
  13: [[134, 69], [155, 66], [180, 68]],
  14: [[142, 71], [164, 66], [192, 70]],
  15: [[131, 75], [156, 74], [181, 73]],
  16: [[137, 65], [156, 65], [184, 65]],
  17: [[142, 68], [161, 67], [188, 67]],
};
const SOURCE_TRUTH_SAMPLES = {
  1: [[152, 35], [158, 43], [145, 45], [151, 46], [148, 48], [134, 54]],
  2: [[153, 32], [147, 41], [146, 43], [137, 47], [220, 74], [214, 80]],
  3: [[140, 28], [157, 38], [145, 40], [157, 41], [122, 48], [101, 71]],
  4: [[83, 27], [88, 39], [93, 40], [71, 46], [73, 47], [73, 48]],
  5: [[153, 83], [150, 93], [147, 94], [149, 95], [150, 96], [109, 128]],
  6: [[160, 133], [102, 138], [96, 146], [99, 153], [84, 167], [74, 198]],
  7: [[140, 104], [140, 114], [137, 116], [140, 117], [132, 120], [111, 147]],
  8: [[164, 82], [173, 84], [199, 87], [207, 94], [216, 96], [239, 123]],
  9: [[145, 74], [154, 83], [119, 95], [115, 100], [213, 110], [104, 124]],
  10: [[148, 72], [136, 83], [132, 87], [127, 91], [125, 92], [105, 121]],
  11: [[188, 97], [205, 108], [238, 111], [186, 115], [172, 119], [154, 149]],
  12: [[171, 54], [174, 62], [166, 64], [171, 65], [108, 75], [238, 101]],
  13: [[151, 50], [144, 59], [139, 61], [136, 63], [136, 67], [207, 96]],
  14: [[155, 59], [149, 61], [159, 62], [144, 68], [121, 95], [68, 101]],
  15: [[148, 61], [130, 68], [127, 70], [128, 71], [128, 73], [97, 99]],
  16: [[139, 45], [149, 56], [156, 58], [161, 60], [165, 63], [107, 93]],
  17: [[153, 47], [151, 58], [151, 60], [142, 64], [133, 67], [230, 98]],
};
const ALL_HEADBAND_SAMPLES = Object.fromEntries(
  Object.entries(REPAIRED_SAMPLES).map(([pose, samples]) => [
    pose,
    [...samples, ...SOURCE_TRUTH_SAMPLES[pose]],
  ]),
);

app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  return window.loadFile(path.join(ROOT, "tests", "headband-fixture.html"))
    .then(() => window.webContents.executeJavaScript(`
      (async () => {
        const expectedSize = ${JSON.stringify(EXPECTED_SIZE)};
        const repairedSamples = ${JSON.stringify(ALL_HEADBAND_SAMPLES)};
        const results = [];
        for (const [poseNumber, samples] of Object.entries(repairedSamples)) {
          const filename = \`pose-\${String(poseNumber).padStart(2, "0")}.webp\`;
          const image = new Image();
          image.src = \`../assets/design-whalepet/\${filename}?qa=\${Date.now()}-\${poseNumber}\`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          results.push({
            filename,
            width: image.naturalWidth,
            height: image.naturalHeight,
            alphas: samples.map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]),
          });
        }
        return { expectedSize, results };
      })()
    `))
    .then(({ expectedSize, results }) => {
      for (const result of results) {
        assert.equal(result.width, expectedSize.width, `${result.filename} width changed`);
        assert.equal(result.height, expectedSize.height, `${result.filename} height changed`);
        result.alphas.forEach((alpha, index) => {
          // Canvas/WebP colour conversion can round an antialiased ruffle edge
          // below 240 even when it is visibly opaque. A deleted/background
          // pixel is near zero, so 200 still catches the actual corruption.
          assert.ok(
            alpha >= 200,
            `${result.filename} lost repaired headband sample ${index} (alpha ${alpha})`
          );
        });
      }
      console.log("Headband asset regression check passed at 153 source-truth ruffle points across all 17 poses.");
      window.destroy();
      app.quit();
    });
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
