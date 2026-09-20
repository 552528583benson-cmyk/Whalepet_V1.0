const ASSET_ROOT = "assets/whalepet-v015";
const ASSET_REVISION = "hd-poses-v1";
const HD_ASSET_ROOT = "assets/whalepet-hd";
let userPreferences = {images:{},showBadge:true,showSpeech:true,customLabel:'我的 AI'};
const WORK_STICKY_MS = 2500;
const READY_HOLD_MS = 5200;
const PREVIEW_HOLD_MS = 4200;
const CLICK_COOLDOWN_MS = 650;
const FRAME_FADE_MS = 110;
// Full-body optical-flow frames changed the headband, tail and apparent body
// size from drawing to drawing.  Keep the character structurally intact and
// let the compositor create the motion, just like the drag animation does.
const POSE_TRANSITION_MS = 920;
const POSE_SWAP_PROGRESS = 0.38;
const POSE_MOTION_SAMPLES = 61;
const DRAG_SETTLE_MS = 340;
const DRAG_BLINK_DELAY_MS = 1800;
const DRAG_BLINK_HOLD_MS = 190;
const DRAG_BLINK_INTERVAL_MS = 2500;
const DRAG_FRAME_COUNT = 1;
const CLICK_DRAG_THRESHOLD_PX = 9;
const MOUSE_RELEASE_DELAY_MS = 90;
const POST_DRAG_HOLD_MS = 180;
const WORKING_STATES = new Set([
  "connecting", "thinking", "reading", "searching",
  "tool_use", "working", "testing", "generating"
]);
const frame = (filename, duration) => [filename, duration];
// One reviewed drawing: no expression swap can change the inverted anatomy.
const DRAG_START_FILE = "../generated-transitions/tail-hang/pose.png";
const DRAG_HAPPY_FILE = DRAG_START_FILE;
const DRAG_BLINK_FILE = DRAG_START_FILE;
// CSS pixels in the 300 x 342 window; also the stage's rotation pivot.
const DRAG_TAIL_ANCHOR = Object.freeze({ x: 150, y: 110 });

// v0.15 sprites share one 384px canvas and a y=374 authored baseline.
const FRAME_Y_OFFSETS = Object.freeze({});

const FRAME_SCALES = Object.freeze({ [DRAG_START_FILE]: 0.86 });

const STATES = Object.freeze({
  idle: {
    label: "待机",
    alt: "小鲸鱼女仆正在待机",
    loop: true,
    frames: [frame("idle.webp", 2600)]
  },
  connecting: {
    label: "连接网络",
    alt: "小鲸鱼女仆抱着终端连接网络",
    loop: true,
    frames: [frame("connecting.webp", 2400)]
  },
  thinking: {
    label: "思考中",
    alt: "小鲸鱼女仆正在认真思考",
    loop: true,
    frames: [frame("thinking.webp", 2600)]
  },
  reading: {
    label: "阅读文件",
    alt: "小鲸鱼女仆正在阅读文件",
    loop: true,
    frames: [frame("reading.webp", 2600)]
  },
  searching: {
    label: "搜索文件",
    alt: "小鲸鱼女仆正在翻找文件",
    loop: true,
    frames: [frame("searching.webp", 2600)]
  },
  tool_use: {
    label: "调用工具",
    alt: "小鲸鱼女仆找到了要使用的工具",
    loop: true,
    frames: [frame("tool-use.webp", 2300)]
  },
  working: {
    label: "工作中",
    alt: "小鲸鱼女仆正在努力处理文件",
    loop: true,
    frames: [frame("working.webp", 2600)]
  },
  testing: {
    label: "检查结果",
    alt: "小鲸鱼女仆正在仔细检查结果",
    loop: true,
    frames: [frame("testing.webp", 2400)]
  },
  generating: {
    label: "生成内容",
    alt: "小鲸鱼女仆闪着星星眼生成新内容",
    loop: true,
    frames: [frame("generating.webp", 2200)]
  },
  needs_input: {
    label: "需要你",
    alt: "小鲸鱼女仆正在等待你的帮助",
    loop: true,
    frames: [frame("needs-input.webp", 2600)]
  },
  ready: {
    label: "完成",
    alt: "小鲸鱼女仆开心地完成了工作",
    loop: false,
    frames: [frame("ready.webp", 1600)]
  },
  blocked: {
    label: "遇到问题",
    alt: "小鲸鱼女仆没有找到正确的文件",
    loop: true,
    frames: [frame("blocked.webp", 2600)]
  }
});

const POSE_BRIDGE = Object.freeze({ duration: POSE_TRANSITION_MS });
const STATE_TRANSITIONS = Object.freeze(Object.fromEntries(
  Object.keys(STATES).flatMap((from) =>
    Object.keys(STATES)
      .filter((to) => to !== from)
      .map((to) => [`${from}>${to}`, POSE_BRIDGE])
  )
));

const GENERATED_TRANSITION_FILES = new Set(
  [
    ...Object.values(STATES).flatMap(({ frames }) => frames.map(([filename]) => filename)),
    DRAG_START_FILE,
    DRAG_HAPPY_FILE,
    DRAG_BLINK_FILE
  ]
);

function transitionDurationBetween(fromState, toState) {
  if (reducedMotion?.matches) return 0;
  return STATE_TRANSITIONS[`${fromState}>${toState}`]?.duration || 0;
}

const DEMO_ORDER = [
  "idle", "connecting", "thinking", "reading", "searching", "tool_use",
  "working", "testing", "generating", "needs_input", "ready", "blocked"
];
const PROVIDER_UI = Object.freeze({
  chatgpt: Object.freeze({
    short: "GPT",
    name: "ChatGPT",
    switchMessage: "切到 ChatGPT 啦，交给小鲸～"
  }),
  custom: Object.freeze({short:'AI',name:'自定义 AI',switchMessage:'现在陪你的 AI 工作啦～'}),
  deepseek: Object.freeze({
    short: "DS",
    name: "DeepSeek",
    switchMessage: "现在陪 DeepSeek 工作啦～"
  })
});
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const pet = document.querySelector("#pet");
const stage = document.querySelector(".stage");
const motionLayer = document.querySelector(".motion-layer");
const layers = [document.querySelector("#characterA"), document.querySelector("#characterB")];
const speech = document.querySelector("#speech");
const badge = document.querySelector("#stateBadge");

let activeState = "idle";
let activeMessage = "待机中";
let activeProvider = "chatgpt";
let lastExternalState = { state: "idle", message: "待机中", provider: "chatgpt" };
let lastWorkingSignalAt = Number.NEGATIVE_INFINITY;
let visibleLayer = 0;
let frameIndex = 0;
let frameTimer = null;
let transitionRaf = null;
let transitionInProgress = false;
let queuedIncomingState = null;
let queuedStateTimer = null;
let deferredStateTimer = null;
let readyTimer = null;
let previewTimer = null;
let previewUntil = 0;
let bubbleTimer = null;
let reactionAnimation = null;
let transitionMotionAnimation = null;
let lastReactionAt = Number.NEGATIVE_INFINITY;
let stateVersion = 0;
let stateSwapAnimation = null;
let layerRequestIds = [0, 0];
let pointerStart = null;
let lastPointer = null;
let wasDragged = false;
let activePointerId = null;
let mouseReleaseTimer = null;
let dragVisualActive = false;
let mouseInteractive = false;
let pointerSample = null;
let pointerSampleRaf = 0;
let nativeDragActive = false;
let dragTilt = 0;
let dragTiltRaf = 0;
let dragAnchorX = null;
const dragPendulum = window.WhaleDragPhysics.create();
const alphaCache = new Map();
let dragExpressionTimers = [];
const idleLife = window.createIdleLife({parent:motionLayer,pet,compact:()=>Number(userPreferences.scale||1)<=.85,eligible:()=>
  activeState==='idle' && !dragVisualActive && !transitionInProgress &&
  !reducedMotion.matches && userPreferences.idleLife!==false &&
  !userPreferences.images['idle.webp'] &&
  layers[visibleLayer].dataset.filename==='idle.webp' && layers[visibleLayer].complete &&
  layers[visibleLayer].src.includes('/whalepet-hd/idle.png')
});

layers.forEach((layer) => {
  layer.dataset.filename = "idle.webp";
  layer.style.setProperty("--frame-y", "0px");
  layer.style.setProperty("--frame-scale", "1");
});

function asset(filename) {
  if(userPreferences.images[filename]) return userPreferences.images[filename];
  // Keep logical filenames stable for custom-image preferences and drag art.
  if (/^[a-z-]+\.webp$/.test(filename)) {
    return `${HD_ASSET_ROOT}/${filename.replace(/\.webp$/, ".png")}?v=${ASSET_REVISION}`;
  }
  return `${ASSET_ROOT}/${filename}?v=${ASSET_REVISION}`;
}


function providerUi(provider = activeProvider) {
  if(provider==='custom')return {...PROVIDER_UI.custom,short:userPreferences.customLabel.slice(0,10)};
  return PROVIDER_UI[provider] || PROVIDER_UI.chatgpt;
}

function badgeText(label) {
  return `${providerUi().short} · ${label}`;
}

function showSpeech(message, duration = 2800) {
  clearTimeout(bubbleTimer);
  speech.textContent = message;
  speech.classList.remove("is-hidden");
  if (Number.isFinite(duration) && duration > 0) {
    bubbleTimer = setTimeout(() => speech.classList.add("is-hidden"), duration);
  }
}

function speechDurationFor(state) {
  if (state === "needs_input" || state === "blocked") return 8000;
  if (state === "ready") return READY_HOLD_MS;
  if (state === "idle") return 2200;
  return 3200;
}

function setMouseInteractive(interactive) {
  const next = interactive === true;
  if (next === mouseInteractive) return;
  mouseInteractive = next;
  window.whalePet.setInteractive(next);
}

function cancelMouseRelease() {
  clearTimeout(mouseReleaseTimer);
  mouseReleaseTimer = null;
}

function scheduleMouseRelease(delay = MOUSE_RELEASE_DELAY_MS) {
  cancelMouseRelease();
  mouseReleaseTimer = setTimeout(() => {
    mouseReleaseTimer = null;
    if (pointerStart) return;
    if (pointerSample && interactiveAt(pointerSample.x, pointerSample.y)) return;
    setMouseInteractive(false);
  }, delay);
}

function keepMouseInteractive() {
  cancelMouseRelease();
  setMouseInteractive(true);
}

function rectContains(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function paddedRectContains(rect, x, y, padding) {
  return x >= rect.left - padding && x <= rect.right + padding &&
    y >= rect.top - padding && y <= rect.bottom + padding;
}

function alphaMapFor(layer) {
  const filename = layer.dataset.filename;
  if (!filename || !layer.complete || !layer.naturalWidth) return null;
  if (alphaCache.has(filename)) return alphaCache.get(filename);
  const canvas = document.createElement("canvas");
  canvas.width = layer.naturalWidth;
  canvas.height = layer.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(layer, 0, 0);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let source = 3, target = 0; source < rgba.length; source += 4, target += 1) {
    alpha[target] = rgba[source];
  }
  const map = { alpha, width: canvas.width, height: canvas.height };
  alphaCache.set(filename, map);
  return map;
}

function characterContains(x, y) {
  const layer = layers[visibleLayer];
  const map = alphaMapFor(layer);
  const rect = layer.getBoundingClientRect();
  if (!map || !rectContains(rect, x, y)) return false;
  const scale = Math.min(rect.width / map.width, rect.height / map.height);
  const renderedWidth = map.width * scale;
  const renderedHeight = map.height * scale;
  const left = rect.left + (rect.width - renderedWidth) / 2;
  const top = rect.bottom - renderedHeight;
  if (x < left || x >= left + renderedWidth || y < top || y >= top + renderedHeight) return false;
  const sourceX = Math.min(map.width - 1, Math.max(0, Math.floor((x - left) / scale)));
  const sourceY = Math.min(map.height - 1, Math.max(0, Math.floor((y - top) / scale)));
  // A small hit halo makes fast clicks and drags reliable while leaving most
  // transparent window pixels available to applications behind the pet.
  // Preserve the same desktop-sized hit halo for HD and imported sprites.
  const haloStep = Math.max(1, Math.round(3 * map.width / 384));
  for (let offsetY = -2 * haloStep; offsetY <= 2 * haloStep; offsetY += haloStep) {
    const sampleY = sourceY + offsetY;
    if (sampleY < 0 || sampleY >= map.height) continue;
    for (let offsetX = -2 * haloStep; offsetX <= 2 * haloStep; offsetX += haloStep) {
      const sampleX = sourceX + offsetX;
      if (sampleX < 0 || sampleX >= map.width) continue;
      if (map.alpha[sampleY * map.width + sampleX] > 24) return true;
    }
  }
  return false;
}

function interactiveAt(x, y) {
  return characterContains(x, y);
}

function animateDragTilt(now) {
  dragTiltRaf = 0;
  if(!dragVisualActive||reducedMotion.matches){resetDragTilt();return;}
  if(dragAnchorX!==null)dragTilt=dragPendulum.advance(now,dragAnchorX);
  stage.style.setProperty("--drag-angle", `${dragTilt.toFixed(3)}deg`);
  dragTiltRaf = requestAnimationFrame(animateDragTilt);
}

window.whalePet.onDragMotion(value=>{
  if(!dragVisualActive||!nativeDragActive||reducedMotion.matches||!Number.isFinite(value?.x))return;
  if(dragAnchorX===null||value.start)dragPendulum.reset(performance.now(),value.x);
  dragAnchorX=value.x;
  if (!dragTiltRaf) dragTiltRaf = requestAnimationFrame(animateDragTilt);
});

function resetDragTilt() {
  if (dragTiltRaf) cancelAnimationFrame(dragTiltRaf);
  dragTiltRaf = 0;
  dragTilt = 0;
  dragAnchorX = null;
  dragPendulum.reset();
  stage.style.removeProperty("--drag-angle");
}

function samplePointer() {
  pointerSampleRaf = 0;
  if (!pointerSample) return;
  if (pointerStart) {
    keepMouseInteractive();
  } else if (interactiveAt(pointerSample.x, pointerSample.y)) {
    keepMouseInteractive();
  } else {
    scheduleMouseRelease();
  }
}

function revealInstant(incoming, outgoing, nextLayer) {
  stage.classList.add("instant-swap");
  outgoing.src = incoming.currentSrc || incoming.src;
  outgoing.dataset.filename = incoming.dataset.filename;
  outgoing.style.setProperty(
    "--frame-y",
    incoming.style.getPropertyValue("--frame-y") || "0px"
  );
  outgoing.style.setProperty(
    "--frame-scale",
    incoming.style.getPropertyValue("--frame-scale") || "1"
  );
  outgoing.alt = incoming.alt;
  outgoing.classList.add("is-visible");
  incoming.classList.remove("is-visible");
  pet.dataset.frame = outgoing.dataset.filename;
  requestAnimationFrame(() => stage.classList.remove("instant-swap"));
}

function revealCrossfade(incoming, outgoing, nextLayer) {
  if (stateSwapAnimation) stateSwapAnimation.cancel();
  const tuck = motionLayer.animate(
    [
      { transform: "translateY(0) scale(1, 1)" },
      { transform: "translateY(2px) scale(1, 1)" }
    ],
    { duration: 110, easing: "ease-in", fill: "forwards" }
  );
  stateSwapAnimation = tuck;
  tuck.finished.then(() => {
    revealInstant(incoming, outgoing, nextLayer);
    const settle = motionLayer.animate(
      [
        { transform: "translateY(2px) scale(1, 1)" },
        { transform: "translateY(-1px) scale(1, 1)", offset: 0.58 },
        { transform: "translateY(0) scale(1, 1)" }
      ],
      { duration: 270, easing: "cubic-bezier(0.22, 1.12, 0.36, 1)" }
    );
    stateSwapAnimation = settle;
    settle.finished.catch(() => {}).finally(() => {
      if (stateSwapAnimation === settle) stateSwapAnimation = null;
    });
  }).catch(() => {});
}

function revealWithMotionHide(incoming, outgoing, nextLayer, version) {
  if (stateSwapAnimation) stateSwapAnimation.cancel();
  const hide = motionLayer.animate(
    [
      { transform: "translateY(0) scale(1, 1)" },
      { transform: "translateY(3px) scale(1, 1)" }
    ],
    { duration: 180, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "forwards" }
  );
  stateSwapAnimation = hide;
  hide.finished.then(() => {
    if (version !== stateVersion) {
      if (stateSwapAnimation === hide) {
        hide.cancel();
        stateSwapAnimation = null;
      }
      return;
    }
    revealInstant(incoming, outgoing, nextLayer);
    const pop = motionLayer.animate(
      [
        { transform: "translateY(3px) scale(1, 1)" },
        { transform: "translateY(-2px) scale(1, 1)", offset: 0.68 },
        { transform: "translateY(0) scale(1, 1)" }
      ],
      { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
    stateSwapAnimation = pop;
    pop.finished.catch(() => {}).finally(() => {
      if (stateSwapAnimation === pop) stateSwapAnimation = null;
    });
  }).catch(() => {});
}

function showFrame(filename, version, enteringState = false, instant = false) {
  if (dragVisualActive && filename !== DRAG_START_FILE) return;
  const outgoing = layers[visibleLayer];
  if (outgoing.dataset.filename === filename) return;

  const nextLayer = visibleLayer === 0 ? 1 : 0;
  const incoming = layers[nextLayer];
  const requestId = layerRequestIds[nextLayer] + 1;
  layerRequestIds[nextLayer] = requestId;
  incoming.src = asset(filename);
  incoming.dataset.filename = filename;
  incoming.style.setProperty("--frame-y", `${FRAME_Y_OFFSETS[filename] || 0}px`);
  incoming.style.setProperty("--frame-scale", String(FRAME_SCALES[filename] || 1));
  incoming.alt = STATES[activeState].alt;

  const reveal = () => {
    if (
      (dragVisualActive && filename !== DRAG_START_FILE) ||
      version !== stateVersion ||
      layerRequestIds[nextLayer] !== requestId ||
      incoming.dataset.filename !== filename
    ) return;
    if (instant || reducedMotion.matches) {
      revealInstant(incoming, outgoing, nextLayer);
    } else if (enteringState) {
      revealWithMotionHide(incoming, outgoing, nextLayer, version);
    } else {
      revealCrossfade(incoming, outgoing, nextLayer);
    }
  };

  if (incoming.complete && incoming.naturalWidth) {
    reveal();
  } else {
    incoming.addEventListener("load", reveal, { once: true });
  }
}

function poseMotionKeyframes() {
  return Array.from({ length: POSE_MOTION_SAMPLES }, (_value, index) => {
    const progress = index / (POSE_MOTION_SAMPLES - 1);
    // A sampled damped spring avoids the velocity discontinuities produced by
    // chaining two easing curves.  It crosses the centre quickly near 38%,
    // which is where the single bitmap swap is least visible.
    const displacement = index === POSE_MOTION_SAMPLES - 1
      ? 0
      : -4.5 * Math.exp(-2 * progress) * Math.sin(2 * Math.PI * 1.32 * progress);
    return {
      transform: `translateY(${displacement.toFixed(3)}px) scale(1, 1)`,
      offset: progress
    };
  });
}

function playPoseTransition(version) {
  if (transitionMotionAnimation) transitionMotionAnimation.cancel();
  transitionMotionAnimation = null;
  if (transitionRaf !== null) cancelAnimationFrame(transitionRaf);
  transitionRaf = null;
  clearTimeout(frameTimer);
  transitionInProgress = true;
  pet.classList.add("is-transitioning");

  const finish = () => {
    if (version !== stateVersion) return;
    if (transitionRaf !== null) cancelAnimationFrame(transitionRaf);
    transitionRaf = null;
    transitionMotionAnimation = null;
    transitionInProgress = false;
    pet.classList.remove("is-transitioning");
    scheduleFrame(version, false, true);
    clearTimeout(queuedStateTimer);
    queuedStateTimer = setTimeout(flushQueuedState, 48);
  };

  if (reducedMotion.matches || typeof motionLayer.animate !== "function") {
    scheduleFrame(version, false, true);
    finish();
    return;
  }

  // One compositor animation runs from start to finish.  The old two-animation
  // chain could pause for a display frame while a promise callback created the
  // second half, which looked like lag at every posture swap.
  const animation = motionLayer.animate(poseMotionKeyframes(), {
    duration: POSE_TRANSITION_MS,
    easing: "linear"
  });
  transitionMotionAnimation = animation;
  const [targetFrame] = STATES[activeState].frames[0];
  let swapped = false;
  const swapTick = () => {
    if (version !== stateVersion || transitionMotionAnimation !== animation) {
      transitionRaf = null;
      return;
    }
    const progress = (Number(animation.currentTime) || 0) / POSE_TRANSITION_MS;
    if (progress >= POSE_SWAP_PROGRESS) {
      swapped = true;
      transitionRaf = null;
      showFrame(targetFrame, version, false, true);
      return;
    }
    transitionRaf = requestAnimationFrame(swapTick);
  };
  transitionRaf = requestAnimationFrame(swapTick);
  animation.finished.then(() => {
    if (version !== stateVersion) return;
    if (!swapped) showFrame(targetFrame, version, false, true);
    finish();
  }).catch(() => {
    if (version === stateVersion) finish();
  });
}

function flushQueuedState() {
  clearTimeout(queuedStateTimer);
  queuedStateTimer = null;
  if (transitionInProgress || dragVisualActive || !queuedIncomingState) return;
  const queued = queuedIncomingState;
  queuedIncomingState = null;
  applyIncomingState(queued);
}

function scheduleFrame(version, enteringState = false, instant = false) {
  clearTimeout(frameTimer);
  if (version !== stateVersion || dragVisualActive) return;

  const definition = STATES[activeState];
  const [filename, duration] = definition.frames[frameIndex];
  showFrame(filename, version, enteringState, instant);

  if (reducedMotion.matches || definition.frames.length === 1) return;
  const isLastFrame = frameIndex === definition.frames.length - 1;
  if (isLastFrame && !definition.loop) return;

  frameTimer = setTimeout(() => {
    frameIndex = (frameIndex + 1) % definition.frames.length;
    scheduleFrame(version, false);
  }, duration);
}

function clearDragExpressionTimers() {
  dragExpressionTimers.forEach((timer) => clearTimeout(timer));
  dragExpressionTimers = [];
}

function scheduleDragBlink(version, delay = DRAG_BLINK_DELAY_MS) {
  const blinkTimer = setTimeout(() => {
    if (!dragVisualActive || version !== stateVersion) return;
    showFrame(DRAG_BLINK_FILE, version, false, true);
    const reopenTimer = setTimeout(() => {
      if (!dragVisualActive || version !== stateVersion) return;
      showFrame(DRAG_HAPPY_FILE, version, false, true);
      scheduleDragBlink(version, DRAG_BLINK_INTERVAL_MS);
    }, DRAG_BLINK_HOLD_MS);
    dragExpressionTimers.push(reopenTimer);
  }, delay);
  dragExpressionTimers.push(blinkTimer);
}

function startDragVisual() {
  dragVisualActive = true;
  const version = stateVersion;
  clearTimeout(frameTimer);
  if (transitionRaf !== null) cancelAnimationFrame(transitionRaf);
  clearTimeout(queuedStateTimer);
  transitionRaf = null;
  transitionInProgress = false;
  pet.classList.remove("is-transitioning");
  if (transitionMotionAnimation) {
    transitionMotionAnimation.cancel();
    transitionMotionAnimation = null;
  }
  if (stateSwapAnimation) {
    stateSwapAnimation.cancel();
    stateSwapAnimation = null;
  }
  if (reactionAnimation) {
    reactionAnimation.cancel();
    reactionAnimation = null;
  }
  clearDragExpressionTimers();
  badge.textContent = badgeText("移动中");
  showSpeech("诶，倒过来了～", 1150);
  showFrame(DRAG_START_FILE, version, false, true);
}

function stopDragVisual(showLandingMessage = true) {
  if (!dragVisualActive) return;
  resetDragTilt();
  dragVisualActive = false;
  clearDragExpressionTimers();
  badge.textContent = badgeText(STATES[activeState].label);
  frameIndex = reducedMotion.matches && !STATES[activeState].loop
    ? STATES[activeState].frames.length - 1
    : 0;
  scheduleFrame(stateVersion, false, true);
  clearTimeout(queuedStateTimer);
  queuedStateTimer = setTimeout(flushQueuedState, POST_DRAG_HOLD_MS + 40);
  if (showLandingMessage) {
    showSpeech("到这里啦～", 800);
    if (!reducedMotion.matches && typeof motionLayer.animate === "function") {
      if (reactionAnimation) reactionAnimation.cancel();
      const landingAnimation = motionLayer.animate(
        [
          { transform: "translateY(-3px) scale(0.995, 1.006)" },
          { transform: "translateY(3px) scale(1.008, 0.993)", offset: 0.4 },
          { transform: "translateY(-1px) scale(0.998, 1.003)", offset: 0.72 },
          { transform: "translateY(0) scale(1, 1)" }
        ],
        { duration: 460, easing: "cubic-bezier(0.22, 1.14, 0.36, 1)" }
      );
      reactionAnimation = landingAnimation;
      landingAnimation.finished.catch(() => {}).finally(() => {
        if (reactionAnimation === landingAnimation) reactionAnimation = null;
      });
    }
  }
}

function previewDrag(duration = 1700) {
  if (pointerStart || dragVisualActive) return false;
  pet.classList.add("is-dragging");
  startDragVisual();
  setTimeout(() => {
    if (pointerStart) return;
    pet.classList.remove("is-dragging");
    stage.style.removeProperty("--drag-angle");
    stopDragVisual(false);
  }, Math.max(500, Math.min(Number(duration) || 1700, 5000)));
  return true;
}

function commitState(value, forceRestart = false) {
  const state = STATES[value?.state] ? value.state : "idle";
  const nextProvider = PROVIDER_UI[value?.provider] ? value.provider : activeProvider;
  const providerChanged = nextProvider !== activeProvider || value?.providerChanged === true;
  activeProvider = nextProvider;
  const definition = STATES[state];
  const message = typeof value?.message === "string" && value.message.trim()
    ? value.message.trim().slice(0, 160)
    : definition.label;
  const previousState = activeState;
  const stateChanged = state !== previousState;

  activeMessage = message;
  showSpeech(
    providerChanged ? providerUi().switchMessage : message,
    providerChanged ? 2200 : speechDurationFor(state)
  );
  badge.textContent = badgeText(dragVisualActive ? "移动中" : definition.label);
  pet.classList.toggle("provider-chatgpt", activeProvider === "chatgpt");
  pet.classList.toggle("provider-deepseek", activeProvider === "deepseek");
  pet.dataset.provider = activeProvider;
  if (!stateChanged && !forceRestart && !providerChanged) {
    window.whalePet.reportState({ state, message, provider: activeProvider, restarted: false, at: Math.round(performance.now()) });
    return;
  }

  clearTimeout(readyTimer);
  if (transitionRaf !== null) cancelAnimationFrame(transitionRaf);
  clearTimeout(queuedStateTimer);
  transitionRaf = null;
  transitionInProgress = false;
  pet.classList.remove("is-transitioning");
  if (transitionMotionAnimation) {
    transitionMotionAnimation.cancel();
    transitionMotionAnimation = null;
  }
  if (reactionAnimation) reactionAnimation.cancel();
  if (stateSwapAnimation) {
    stateSwapAnimation.cancel();
    stateSwapAnimation = null;
  }
  stateVersion += 1;
  activeState = state;
  frameIndex = reducedMotion.matches && !definition.loop ? definition.frames.length - 1 : 0;
  pet.className = `pet state-${state} provider-${activeProvider}${dragVisualActive ? " is-dragging" : ""}`;
  pet.dataset.state = state;
  stage.dataset.state = state;
  layers.forEach((layer) => { layer.alt = definition.alt; });
  const transition = STATE_TRANSITIONS[`${previousState}>${state}`];
  if (dragVisualActive) {
    startDragVisual();
  } else if (stateChanged && transition && !reducedMotion.matches) {
    playPoseTransition(stateVersion);
  } else {
    scheduleFrame(stateVersion, stateChanged);
    queuedStateTimer = setTimeout(flushQueuedState, 48);
  }
  window.whalePet.reportState({ state, message, provider: activeProvider, restarted: true, at: Math.round(performance.now()) });

  if (state === "ready" && !value?.preview) {
    const readyVersion = stateVersion;
    const animationDelay = transition?.duration || 0;
    readyTimer = setTimeout(() => {
      if (stateVersion !== readyVersion || activeState !== "ready") return;
      commitState({ state: "idle", message: "已完成，等待下一项工作" });
    }, READY_HOLD_MS + animationDelay);
  }
}

function applyIncomingState(value) {
  const state = STATES[value?.state] ? value.state : "idle";
  const provider = PROVIDER_UI[value?.provider] ? value.provider : activeProvider;
  const next = {
    state,
    provider,
    message: value?.message || STATES[state].label,
    preview: value?.preview === true,
    providerChanged: value?.providerChanged === true
  };
  const now = performance.now();

  // Never cut a character action in half. Keep only the newest request so a
  // burst of status events produces one coherent follow-up action, not a stack.
  if (transitionInProgress && !next.providerChanged && next.state !== activeState) {
    queuedIncomingState = next;
    if (!next.preview) {
      lastExternalState = { state: next.state, message: next.message, provider: next.provider };
    }
    return;
  }

  if (next.preview) {
    clearTimeout(previewTimer);
    clearTimeout(deferredStateTimer);
    const previewDelay = PREVIEW_HOLD_MS + transitionDurationBetween(activeState, next.state);
    previewUntil = now + previewDelay;
    commitState(next, true);
    previewTimer = setTimeout(() => {previewUntil=0;applyIncomingState(lastExternalState);}, previewDelay);
    return;
  }

  lastExternalState = { state: next.state, message: next.message, provider: next.provider };
  // A user-triggered preview stays visible briefly while real events keep
  // updating in the background. Provider switches still take effect at once.
  if(now<previewUntil && !next.providerChanged) return;
  previewUntil=0;
  clearTimeout(previewTimer);
  if (next.providerChanged) {
    queuedIncomingState = null;
    clearTimeout(deferredStateTimer);
    commitState(next, true);
    return;
  }
  if (WORKING_STATES.has(state)) lastWorkingSignalAt = now;
  if (state === "idle" && WORKING_STATES.has(activeState)) lastWorkingSignalAt = now;

  if (state === "idle" && now - lastWorkingSignalAt < WORK_STICKY_MS) {
    clearTimeout(deferredStateTimer);
    const delay = WORK_STICKY_MS - (now - lastWorkingSignalAt);
    deferredStateTimer = setTimeout(() => commitState(next), delay);
    return;
  }

  clearTimeout(deferredStateTimer);
  commitState(next);
}

function previewNextState() {
  const nextIndex = (DEMO_ORDER.indexOf(activeState) + 1) % DEMO_ORDER.length;
  applyIncomingState({
    state: DEMO_ORDER[nextIndex],
    provider: activeProvider,
    message: "本地姿势预览",
    preview: true
  });
}

function playReaction() {
  const now = performance.now();
  if (now - lastReactionAt < CLICK_COOLDOWN_MS) return;
  if (reactionAnimation && reactionAnimation.playState === "running") return;
  lastReactionAt = now;
  showSpeech("我在这里～", 900);
  if (reducedMotion.matches || typeof motionLayer.animate !== "function") return;
  reactionAnimation = motionLayer.animate(
    [
      { transform: "translateY(0) rotate(0deg)" },
      { transform: "translateY(-9px) rotate(-1.2deg)", offset: 0.38 },
      { transform: "translateY(-3px) rotate(0.8deg)", offset: 0.7 },
      { transform: "translateY(0) rotate(0deg)" }
    ],
    { duration: 700, easing: "cubic-bezier(0.22, 1.08, 0.36, 1)" }
  );
  reactionAnimation.finished.catch(() => {}).finally(() => {
    reactionAnimation = null;
  });
}

function finishPointer(event, cancelled = false) {
  if (!pointerStart) return;
  const pointerId = activePointerId;
  const didDrag = wasDragged;
  const hadNativeDrag = nativeDragActive;
  const shiftKey = event?.shiftKey === true;
  pointerStart = null;
  lastPointer = null;
  wasDragged = false;
  nativeDragActive = false;
  activePointerId = null;
  if (pointerId !== null && pet.hasPointerCapture(pointerId)) pet.releasePointerCapture(pointerId);
  pet.classList.remove("is-dragging");
  resetDragTilt();
  // Capture-loss/cancel events may carry zero or stale coordinates. Only use
  // an actual mouse move/release as the final point; otherwise keep the tracker.
  const hasReleasePoint = (event?.type === 'pointerup' || event?.type === 'pointermove') &&
    Number.isFinite(event.screenX) && Number.isFinite(event.screenY);
  if (hadNativeDrag) window.whalePet.endDrag({ dragged: didDrag, cancelled,
    cursor:hasReleasePoint?{x:event.screenX,y:event.screenY}:undefined });
  if (didDrag) {
    stopDragVisual();
  } else if (!cancelled && shiftKey) {
    previewNextState();
  } else if (!cancelled && event) {
    playReaction();
  }
  keepMouseInteractive();
  scheduleMouseRelease(POST_DRAG_HOLD_MS);
}

pet.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (!characterContains(event.clientX, event.clientY)) {
    scheduleMouseRelease(0);
    return;
  }
  if (pointerStart) finishPointer(null, true);
  pet.setPointerCapture(event.pointerId);
  activePointerId = event.pointerId;
  pointerStart = { x: event.screenX, y: event.screenY };
  lastPointer = { ...pointerStart };
  wasDragged = false;
  nativeDragActive = false;
  keepMouseInteractive();
});

pet.addEventListener("pointermove", (event) => {
  if (!pointerStart || !lastPointer || event.pointerId !== activePointerId) return;
  if ((event.buttons & 1) === 0) {
    finishPointer(event, true);
    return;
  }
  const totalX = event.screenX - pointerStart.x;
  const totalY = event.screenY - pointerStart.y;
  if (Math.hypot(totalX, totalY) > CLICK_DRAG_THRESHOLD_PX && !wasDragged) {
    wasDragged = true;
    nativeDragActive = true;
    pet.classList.add("is-dragging");
    if (reactionAnimation) reactionAnimation.cancel();
    window.whalePet.beginDrag({
      clientX: Math.round(event.clientX),
      clientY: Math.round(event.clientY),
      screenX: Math.round(event.screenX),
      screenY: Math.round(event.screenY),
      pressScreenX:pointerStart.x,
      pressScreenY:pointerStart.y,
      tailAnchor: DRAG_TAIL_ANCHOR
    });
    startDragVisual();
  }
  if (wasDragged) {
    window.whalePet.moveDrag();
  }
  lastPointer = { x: event.screenX, y: event.screenY };
});

pet.addEventListener("pointerup", (event) => finishPointer(event));
pet.addEventListener("pointercancel", (event) => finishPointer(event, true));
pet.addEventListener("lostpointercapture", (event) => {
  if (event.pointerId === activePointerId && (event.buttons & 1) === 0) {
    finishPointer(event, true);
  } else if (event.pointerId === activePointerId && pointerStart) {
    try {
      pet.setPointerCapture(event.pointerId);
    } catch {
      // The native main-process cursor tracker continues until pointerup.
    }
  }
});
window.addEventListener("pointerup", (event) => {
  if (event.pointerId === activePointerId) finishPointer(event);
});

pet.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (!characterContains(event.clientX, event.clientY)) return;
  window.whalePet.openContextMenu();
});

document.addEventListener("mousemove", (event) => {
  pointerSample = { x: event.clientX, y: event.clientY };
  if (!pointerSampleRaf) pointerSampleRaf = requestAnimationFrame(samplePointer);
});

document.addEventListener("mouseleave", () => {
  pointerSample = null;
  if (!pointerStart) scheduleMouseRelease();
});

reducedMotion.addEventListener("change", () => commitState(
  { state: activeState, message: activeMessage, provider: activeProvider },
  true
));
window.whalePet.onState(applyIncomingState);
function applyPreferences(value) {
  const imagesChanged=JSON.stringify(userPreferences.images)!==JSON.stringify(value.images||{});
  userPreferences={...userPreferences,...value};
  document.body.classList.toggle('compact-pet',Number(userPreferences.scale||1)<=.85);
  document.body.classList.toggle('hide-badge',!userPreferences.showBadge);
  document.body.classList.toggle('hide-speech',!userPreferences.showSpeech);
  badge.textContent=badgeText(dragVisualActive?'移动中':STATES[activeState].label);
  if(imagesChanged){
    alphaCache.clear();
    layers.forEach((layer,index)=>{layer.dataset.filename='';layerRequestIds[index]++;});
    commitState({state:activeState,message:activeMessage,provider:activeProvider},true);
  }
  idleLife.sync();
}
window.whalePet.onPreferences(applyPreferences);

const preloadedImages = [];
const preloadPromises = [];
for (const filename of GENERATED_TRANSITION_FILES) {
  const image = new Image();
  image.decoding = "async";
  image.src = asset(filename);
  preloadedImages.push(image);
  preloadPromises.push(image.decode().catch(() => undefined));
}

Promise.allSettled(preloadPromises)
  .then(()=>window.whalePet.requestPreferences())
  .then(applyPreferences)
  .then(() => window.whalePet.requestState())
  .then(applyIncomingState);
setMouseInteractive(false);
window.whalePetController = Object.freeze({
  setState: applyIncomingState,
  previewNextState,
  previewDrag,
  react: playReaction,
  idleLife,
  dragPhysicsInfo:()=>({...dragPendulum.info(),active:dragVisualActive,anchorX:dragAnchorX}),
  getState: () => ({
    state: activeState,
    message: activeMessage,
    provider: activeProvider,
    frame: pet.dataset.frame || "idle.webp"
  }),
  hitTest: interactiveAt,
  transitionInfo: () => ({
    fadeMs: FRAME_FADE_MS,
    poseTransitionMs: POSE_TRANSITION_MS,
    preloadedFrameCount: GENERATED_TRANSITION_FILES.size,
    dragFrameMs: DRAG_SETTLE_MS,
    dragFrameCount: DRAG_FRAME_COUNT,
    inProgress: transitionInProgress,
    queuedState: queuedIncomingState?.state || null,
    frame: pet.dataset.frame || "idle.webp"
  }),
  layerInfo: () => ({
    visibleLayers: layers.filter((layer) => layer.classList.contains("is-visible")).length,
    renderedLayer: layers[visibleLayer].dataset.filename || "idle.webp"
  })
});
