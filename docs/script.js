// =================================================================================
// グローバル変数 (Global Variables)
// =================================================================================

const dom = {
  volume: document.getElementById("volume"),
  volumeValue: document.getElementById("volumeValue"),
  modulationInfo: document.getElementById("modulation-info"),
  lpf: document.getElementById("lpf"),
  lpfValue: document.getElementById("lpfValue"),
  reverb: document.getElementById("reverb"),
  resetButton: document.getElementById("resetButton"),
  konvaContainer: "konva-stage-container",
  trainSelect: document.getElementById("train-select"),
};

const state = { ...globalConfig.initialState };
let currentSpec = trainSpecs[state.selectedTrain];

let audioCtx = null,
  pwmNode = null,
  gainNode = null,
  lpfNode = null,
  convolverNode = null;
let konvaObjects = {};
let simulationLoopStarted = false;
let lastSimTime = 0;

// =================================================================================
// UI処理 (UI Handling)
// =================================================================================

function initKonvaUI() {
  const {
    stage: stageConfig,
    notch: notchConfig,
    speedometer: speedConfig,
  } = globalConfig.ui;

  // ラベルを動的に生成
  const { POWER_LEVELS, BRAKE_LEVELS } = currentSpec.physical;
  const brakeLabels = Array.from(
    { length: BRAKE_LEVELS },
    (_, i) => `B${BRAKE_LEVELS - i}`
  );
  const powerLabels = Array.from(
    { length: POWER_LEVELS },
    (_, i) => `P${i + 1}`
  );
  const labels = ["EB", ...brakeLabels, "N", ...powerLabels];

  // ステージとレイヤーの初期化 (一度だけ)
  if (!konvaObjects.stage) {
    konvaObjects.stage = new Konva.Stage({
      container: dom.konvaContainer,
      width: stageConfig.width,
      height: 520, // UI表示領域を縦に拡大
    });
    konvaObjects.layer = new Konva.Layer();
    konvaObjects.stage.add(konvaObjects.layer);
  } else {
    konvaObjects.stage.height(520); // 既存ステージも高さを拡大
  }

  // 既存のUI要素をクリア
  konvaObjects.layer.destroyChildren();

  konvaObjects.notchRects = [];
  konvaObjects.notchLabels = [];
  labels.forEach((text, i) => {
    const y = notchConfig.y_start + i * notchConfig.y_step;
    const isSpecial = text === "EB" || text === "N";
    const width = isSpecial
      ? notchConfig.special_width
      : notchConfig.base_width;
    const x = isSpecial ? notchConfig.special_x : notchConfig.base_x;

    const rect = new Konva.Rect({
      x,
      y,
      width,
      height: notchConfig.base_height,
      fill: notchConfig.colors.default_bg,
      cornerRadius: 3,
    });
    konvaObjects.layer.add(rect);
    konvaObjects.notchRects.push(rect);

    const label = new Konva.Text({
      x,
      y: y + 2,
      width,
      height: notchConfig.base_height,
      text,
      fontSize: 15,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      fill: notchConfig.colors.default_label,
    });
    konvaObjects.layer.add(label);
    konvaObjects.notchLabels.push(label);
  });

  konvaObjects.speedValue = new Konva.Text({
    ...speedConfig.value,
    text: "0",
    fontFamily: "monospace",
    fontStyle: "bold",
    align: "center",
    verticalAlign: "middle",
  });
  konvaObjects.layer.add(konvaObjects.speedValue);

  konvaObjects.kmhLabel = new Konva.Text({
    ...speedConfig.label,
    text: "km/h",
    align: "center",
    verticalAlign: "middle",
  });
  konvaObjects.layer.add(konvaObjects.kmhLabel);

  konvaObjects.layer.draw();
}
function render() {
  const { notch: notchConfig } = globalConfig.ui;
  const NEUTRAL_INDEX = currentSpec.physical.BRAKE_LEVELS + 1;
  const EB_INDEX = 0;

  konvaObjects.notchRects.forEach((rect, i) => {
    let fill = notchConfig.colors.default_bg;
    const handle = state.handlePosition;

    if (handle === -(currentSpec.physical.BRAKE_LEVELS + 1)) {
      if (i === EB_INDEX) fill = notchConfig.colors.active_eb;
      else if (i > EB_INDEX && i < NEUTRAL_INDEX)
        fill = notchConfig.colors.active_b;
    } else if (handle < 0) {
      if (i >= NEUTRAL_INDEX - Math.abs(handle) && i < NEUTRAL_INDEX) {
        fill = notchConfig.colors.active_b;
      }
    } else if (handle === 0) {
      if (i === NEUTRAL_INDEX) fill = notchConfig.colors.active_n;
    } else if (handle > 0) {
      if (i > NEUTRAL_INDEX && i <= NEUTRAL_INDEX + handle) {
        fill = notchConfig.colors.active_p;
      }
    }
    rect.fill(fill);
  });

  konvaObjects.speedValue.text(Math.round(state.currentSpeed));

  if (dom.volumeValue)
    dom.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
  if (dom.lpfValue) dom.lpfValue.textContent = `${state.lpfCutoff} Hz`;

  konvaObjects.layer.draw();
}

// =================================================================================
// 音声処理 (Audio Handling)
// =================================================================================

async function setupAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.audioWorklet.addModule("./processor.js?t=" + Date.now());

  pwmNode = new AudioWorkletNode(audioCtx, "pwm-processor", {
    parameterData: { signalFreq: 0 },
  });
  lpfNode = audioCtx.createBiquadFilter();
  lpfNode.type = "lowpass";
  convolverNode = audioCtx.createConvolver();
  gainNode = audioCtx.createGain();

  pwmNode.connect(lpfNode);
  gainNode.connect(audioCtx.destination);

  pwmNode.port.onmessage = handlePwmMessage;

  try {
    const response = await fetch("ir/emt_140_bright_1.wav");
    const arrayBuffer = await response.arrayBuffer();
    convolverNode.buffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    console.error("Failed to load impulse response:", e);
    if (dom.reverb) dom.reverb.disabled = true;
  }
}

function handlePwmMessage({ data }) {
  if (data.type === "ready") {
    pwmNode.port.postMessage({
      modulationPatterns: currentSpec.modulationPatterns.accel,
    });
  } else if (data.type === "waveform" && dom.modulationInfo) {
    const { pattern } = data.data;
    let text = "-";
    if (pattern) {
      if (pattern.type === "async") text = `非同期 ${pattern.carrierFreq}Hz`;
      else if (pattern.type !== "mute")
        text = `同期 ${
          pattern.pulse === "wide_3" ? "広域3" : pattern.pulse
        }パルス`;
    }
    dom.modulationInfo.textContent = text;
  }
}

function updateAudioConnections() {
  if (!lpfNode || !gainNode || !convolverNode) return;
  lpfNode.disconnect();
  if (state.reverbEnabled && convolverNode.buffer) {
    lpfNode.connect(convolverNode).connect(gainNode);
  } else {
    lpfNode.connect(gainNode);
  }
}

function updateAudio() {
  if (!audioCtx || !pwmNode) return;

  const isAudible = state.currentSpeed > 0 && state.handlePosition !== 0;
  const freq = isAudible
    ? (state.currentSpeed / currentSpec.physical.MAX_SPEED) *
      currentSpec.physical.MAX_FREQ
    : 0;

  pwmNode.parameters
    .get("signalFreq")
    .setValueAtTime(freq, audioCtx.currentTime);
  gainNode.gain.setValueAtTime(
    isAudible ? state.volume : 0,
    audioCtx.currentTime
  );
  lpfNode.frequency.setValueAtTime(state.lpfCutoff, audioCtx.currentTime);

  const patterns =
    state.handlePosition < 0
      ? currentSpec.modulationPatterns.decel
      : currentSpec.modulationPatterns.accel;

  pwmNode.port.postMessage({
    handlePosition: state.handlePosition === 0 ? "N" : state.handlePosition,
    speed: state.currentSpeed,
    modulationPatterns: patterns,
  });
}

// =================================================================================
// シミュレーション (Simulation)
// =================================================================================

function startSimulationLoop() {
  if (simulationLoopStarted) return;
  simulationLoopStarted = true;
  lastSimTime = performance.now();
  requestAnimationFrame(simulationLoop);
}

function simulationLoop(now) {
  if (!state.isSimulating) {
    simulationLoopStarted = false;
    if (audioCtx) audioCtx.suspend();
    return;
  }

  const dt = (now - lastSimTime) / 1000;
  lastSimTime = now;

  updateSpeed(dt);
  state.currentSpeed = Math.max(
    0,
    Math.min(state.currentSpeed, currentSpec.physical.MAX_SPEED)
  );

  render();
  updateAudio();
  requestAnimationFrame(simulationLoop);
}

function updateSpeed(dt) {
  const handle = state.handlePosition;
  const { physical } = currentSpec;
  if (handle > 0) {
    const accel = (physical.ACCEL_RATE_MAX * handle) / physical.POWER_LEVELS;
    state.currentSpeed += accel * dt;
  } else if (handle === 0) {
    state.currentSpeed -= physical.DECEL_RATE_COAST * dt;
  } else {
    if (handle === -(physical.BRAKE_LEVELS + 1))
      state.currentSpeed -= physical.DECEL_RATE_EB * dt;
    else {
      const decel =
        (physical.DECEL_RATE_MAX / physical.BRAKE_LEVELS) * Math.abs(handle);
      state.currentSpeed -= decel * dt;
    }
  }
}

// =================================================================================
// イベントハンドラと初期化 (Event Handlers & Initialization)
// =================================================================================

function setupEventListeners() {
  window.addEventListener("keydown", handleKeyEvent);

  dom.volume.addEventListener("input", () => {
    state.volume = Number(dom.volume.value) / 100;
    render();
    updateAudio();
  });

  dom.lpf.addEventListener("input", () => {
    state.lpfCutoff = Number(dom.lpf.value);
    render();
    updateAudio();
  });

  dom.reverb.addEventListener("change", (e) => {
    state.reverbEnabled = e.target.checked;
    updateAudioConnections();
  });

  dom.resetButton.addEventListener("click", resetSimulation);
  dom.trainSelect.addEventListener("change", (e) => {
    state.selectedTrain = e.target.value;
    resetSimulation();
  });
}

function setupTrainSelector() {
  Object.keys(trainSpecs).forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    dom.trainSelect.appendChild(option);
  });
  dom.trainSelect.value = state.selectedTrain;
}

function handleKeyEvent(e) {
  if (!state.isSimulating) return;
  let changed = false;
  let handle = state.handlePosition;
  const { physical } = currentSpec;

  switch (e.key.toUpperCase()) {
    case "Z":
      if (handle < physical.POWER_LEVELS) {
        handle++;
        changed = true;
      }
      break;
    case "Q":
      if (handle > -physical.BRAKE_LEVELS) {
        handle--;
        changed = true;
      }
      break;
    case "A":
      if (handle > 0) {
        handle--;
        changed = true;
      } else if (handle < 0) {
        handle++;
        changed = true;
      }
      break;
    case "1":
      if (handle !== -(physical.BRAKE_LEVELS + 1)) {
        handle = -(physical.BRAKE_LEVELS + 1);
        changed = true;
      }
      break;
  }

  if (changed) {
    state.handlePosition = handle;
    render();
    updateAudio();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    if (!simulationLoopStarted) startSimulationLoop();
  }
}

function resetSimulation() {
  currentSpec = trainSpecs[state.selectedTrain];
  Object.assign(state, globalConfig.initialState, {
    isSimulating: true,
    selectedTrain: state.selectedTrain,
  });

  // UIを再初期化して新しい段数を反映
  initKonvaUI();

  dom.volume.value = state.volume * 100;
  dom.lpf.value = state.lpfCutoff;
  dom.reverb.checked = state.reverbEnabled;

  render();
  updateAudioConnections();
  updateAudio();
}

async function main() {
  initKonvaUI();
  setupTrainSelector();
  setupEventListeners();

  Object.assign(state, globalConfig.initialState, { isSimulating: true });

  dom.volume.value = state.volume * 100;
  dom.lpf.value = state.lpfCutoff;
  dom.reverb.checked = state.reverbEnabled;

  await setupAudio();
  updateAudioConnections();

  if (audioCtx.state === "suspended") await audioCtx.resume();

  render();
  startSimulationLoop();
}

window.addEventListener("DOMContentLoaded", main);
