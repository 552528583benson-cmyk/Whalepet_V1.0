const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const ROOT = path.resolve(__dirname, "..");
app.setPath("userData", path.join(ROOT, "work", "test-user-data", `transparency-${process.pid}`));
app.disableHardwareAcceleration();
const EXPECTED_SIZE = { width: 338, height: 313 };
const TRANSPARENT_HAIR_GAPS = {
  1: [244, 163],
  2: [243, 161],
  3: [245, 160],
  4: [36, 168],
  5: [92, 224],
  6: [239, 207],
  7: [250, 184],
  8: [253, 198],
  9: [243, 190],
  10: [245, 186],
  11: [286, 173],
  12: [249, 175],
  13: [235, 171],
  14: [248, 172],
  15: [241, 172],
  16: [241, 171],
  17: [241, 174],
};
const TRANSPARENT_AHOGE_GAPS = {
  1: [145, 40],
  2: [142, 37],
  3: [139, 35],
  4: [77, 35],
  5: [149, 88],
  6: [93, 153],
  7: [138, 109],
  8: [158, 80],
  9: [137, 79],
  10: [137, 77],
  11: [189, 105],
  12: [170, 58],
  13: [141, 54],
  14: [149, 56],
  15: [131, 61],
  16: [143, 52],
  17: [149, 53],
};
const DRAG_AHOGE_GAPS = {
  1: [155, 26],
  2: [155, 19],
  3: [156, 24],
  4: [156, 19],
  5: [156, 24],
  6: [156, 20],
  7: [156, 23],
  8: [157, 19],
};
const DRAG_HEADBAND_OUTLINE = {
  1: [157, 40],
  2: [157, 34],
  3: [158, 38],
  4: [158, 34],
  5: [158, 38],
  6: [158, 35],
  7: [158, 37],
  8: [158, 34],
};

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
        const samples = ${JSON.stringify(TRANSPARENT_HAIR_GAPS)};
        const ahogeSamples = ${JSON.stringify(TRANSPARENT_AHOGE_GAPS)};
        const countAhogeMatte = (context, width, height, centerX, centerY, radiusX, radiusY) => {
          const pixels = context.getImageData(0, 0, width, height).data;
          const offset = (x, y) => (y * width + x) * 4;
          let count = 0;
          for (let y = Math.max(0, centerY - radiusY); y <= Math.min(height - 1, centerY + radiusY); y += 1) {
            for (let x = Math.max(0, centerX - radiusX); x <= Math.min(width - 1, centerX + radiusX); x += 1) {
              const index = offset(x, y);
              const red = pixels[index];
              const green = pixels[index + 1];
              const blue = pixels[index + 2];
              const alpha = pixels[index + 3];
              const minimum = Math.min(red, green, blue);
              const maximum = Math.max(red, green, blue);
              if (
                alpha <= 12
                || minimum < 160
                || maximum - minimum > 75
                || blue - red < 4
              ) continue;
              let touchesTransparency = false;
              for (let dy = -2; dy <= 2 && !touchesTransparency; dy += 1) {
                for (let dx = -2; dx <= 2; dx += 1) {
                  const nearX = x + dx;
                  const nearY = y + dy;
                  if (nearX < 0 || nearX >= width || nearY < 0 || nearY >= height) continue;
                  if (pixels[offset(nearX, nearY) + 3] <= 12) {
                    touchesTransparency = true;
                    break;
                  }
                }
              }
              if (touchesTransparency) count += 1;
            }
          }
          return count;
        };
        const results = [];
        for (const [poseNumber, point] of Object.entries(samples)) {
          const filename = \`pose-\${String(poseNumber).padStart(2, "0")}.webp\`;
          const image = new Image();
          image.src = \`../assets/design-whalepet/\${filename}?qa=\${Date.now()}-\${poseNumber}\`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const width = canvas.width;
          const height = canvas.height;
          const offset = (x, y) => (y * width + x) * 4;
          const isBlueHair = (x, y) => {
            const index = offset(x, y);
            const red = pixels[index];
            const green = pixels[index + 1];
            const blue = pixels[index + 2];
            const alpha = pixels[index + 3];
            return alpha >= 128 && blue >= 65 && blue - red >= 14 && blue - green >= 4;
          };

          let hairTop = height;
          for (let scanY = 0; scanY < height; scanY += 1) {
            for (let scanX = 70; scanX < Math.min(270, width); scanX += 1) {
              if (isBlueHair(scanX, scanY)) {
                hairTop = Math.min(hairTop, scanY);
              }
            }
          }

          let paleSideEdgePixels = 0;
          const regionTop = Math.min(height, hairTop + 126);
          const regionBottom = Math.min(height, 246);
          for (let scanY = regionTop; scanY < regionBottom; scanY += 1) {
            for (let scanX = 0; scanX < width; scanX += 1) {
              if (scanX >= 95 && scanX < 243) continue;
              const index = offset(scanX, scanY);
              const red = pixels[index];
              const green = pixels[index + 1];
              const blue = pixels[index + 2];
              const alpha = pixels[index + 3];
              const minimum = Math.min(red, green, blue);
              const maximum = Math.max(red, green, blue);
              const pink = red - (green + blue) / 2;
              if (alpha < 240 || minimum < 180 || maximum - minimum > 65 || pink >= 10) continue;

              let touchesTransparency = false;
              let nearbyBlue = 0;
              for (let dy = -5; dy <= 5; dy += 1) {
                const nearY = scanY + dy;
                if (nearY < 0 || nearY >= height) continue;
                for (let dx = -5; dx <= 5; dx += 1) {
                  const nearX = scanX + dx;
                  if (nearX < 0 || nearX >= width) continue;
                  const nearIndex = offset(nearX, nearY);
                  if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && pixels[nearIndex + 3] === 0) {
                    touchesTransparency = true;
                  }
                  if (isBlueHair(nearX, nearY)) nearbyBlue += 1;
                }
              }
              if (touchesTransparency && nearbyBlue >= 2) paleSideEdgePixels += 1;
            }
          }
          const [x, y] = point;
          const [ahogeX, ahogeY] = ahogeSamples[poseNumber];
          results.push({
            kind: "pose",
            filename,
            width: image.naturalWidth,
            height: image.naturalHeight,
            alpha: context.getImageData(x, y, 1, 1).data[3],
            ahogeAlpha: context.getImageData(ahogeX, ahogeY, 1, 1).data[3],
            ahogeMattePixels: countAhogeMatte(
              context, width, height, ahogeX, ahogeY, 42, 34
            ),
            paleSideEdgePixels,
          });
        }
        const dragSamples = ${JSON.stringify(DRAG_AHOGE_GAPS)};
        const dragHeadbandSamples = ${JSON.stringify(DRAG_HEADBAND_OUTLINE)};
        for (const [frameNumber, point] of Object.entries(dragSamples)) {
          const filename = \`frame-\${String(frameNumber).padStart(2, "0")}.webp\`;
          const image = new Image();
          image.src = \`../assets/generated-transitions/drag-cute/\${filename}?qa=\${Date.now()}-\${frameNumber}\`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const [ahogeX, ahogeY] = point;
          const [headbandX, headbandY] = dragHeadbandSamples[frameNumber];
          results.push({
            kind: "drag",
            filename: \`drag-cute/\${filename}\`,
            width: image.naturalWidth,
            height: image.naturalHeight,
            alpha: 0,
            ahogeAlpha: context.getImageData(ahogeX, ahogeY, 1, 1).data[3],
            headbandAlpha: context.getImageData(headbandX, headbandY, 1, 1).data[3],
            ahogeMattePixels: countAhogeMatte(
              context,
              image.naturalWidth,
              image.naturalHeight,
              ahogeX,
              ahogeY,
              38,
              30,
            ),
            paleSideEdgePixels: 0,
          });
        }
        return results;
      })()
    `))
    .then((results) => {
      let totalPaleSideEdgePixels = 0;
      let totalPoseAhogeMattePixels = 0;
      let totalDragAhogeMattePixels = 0;
      for (const result of results) {
        assert.equal(result.width, EXPECTED_SIZE.width, `${result.filename} width changed`);
        assert.equal(result.height, EXPECTED_SIZE.height, `${result.filename} height changed`);
        assert.ok(result.alpha <= 15, `${result.filename} restored an opaque paper-white hair gap`);
        assert.ok(
          result.ahogeAlpha <= 15,
          `${result.filename} restored opaque paper white inside the ahoge loop`,
        );
        if (result.kind === "drag") {
          assert.ok(
            result.headbandAlpha >= 240,
            `${result.filename} damaged the outlined white headband below the ahoge gap`,
          );
          assert.ok(
            result.ahogeMattePixels <= 34,
            `${result.filename} has ${result.ahogeMattePixels} pale pixels on the ahoge edge`,
          );
          totalDragAhogeMattePixels += result.ahogeMattePixels;
        } else {
          assert.ok(
            result.ahogeMattePixels <= 38,
            `${result.filename} has ${result.ahogeMattePixels} pale pixels on the ahoge edge`,
          );
          totalPoseAhogeMattePixels += result.ahogeMattePixels;
        }
        assert.ok(
          result.paleSideEdgePixels <= 24,
          `${result.filename} has ${result.paleSideEdgePixels} pale side-hair edge pixels`,
        );
        totalPaleSideEdgePixels += result.paleSideEdgePixels;
      }
      assert.ok(
        totalPaleSideEdgePixels <= 80,
        `all poses have ${totalPaleSideEdgePixels} pale side-hair edge pixels`,
      );
      assert.ok(
        totalPoseAhogeMattePixels <= 490,
        `all poses have ${totalPoseAhogeMattePixels} pale ahoge-edge pixels`,
      );
      assert.ok(
        totalDragAhogeMattePixels <= 210,
        `all drag frames have ${totalDragAhogeMattePixels} pale ahoge-edge pixels`,
      );
      console.log("Transparency regression check passed for all 17 poses and 8 drag frames.");
      window.destroy();
      app.quit();
    });
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
