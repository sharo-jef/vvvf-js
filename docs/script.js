// --- 定数と設定 ---
const POWER_LEVELS = 4;
const BRAKE_LEVELS = 7;
const EB_LEVEL = 8;
const MAX_SPEED = 120; // km/h
const MAX_FREQ = 120; // Hz
const DECEL_RATE_COAST = 0.3; // Hz per second (natural deceleration)
const DECEL_RATE_BRAKE = 0.8; // Hz per second per notch (B1~B6)
const DECEL_RATE_B7 = 4.2; // km/h/s (B7)
const DECEL_RATE_EB = 4.5; // km/h/s (EB)

// --- DOM要素の取得 ---
const ui = {
  startButton: document.getElementById("startButton"),
  carrierFreq: document.getElementById("carrierFreq"),
  carrierFreqValue: document.getElementById("carrierFreqValue"),
  // acceleration: document.getElementById("acceleration"),
  // accelerationValue: document.getElementById("accelerationValue"),
  waveformCanvas: document.getElementById("waveformCanvas"),
  speedometer: document.getElementById("speedometer"),
  handleContainer: document.getElementById("handle-container"),
  allNotches: document.getElementById("all-notches"),
  volume: document.getElementById("volume"),
  volumeValue: document.getElementById("volumeValue"),
};

// --- アプリケーションの状態 ---
const state = {
  audioCtx: null,
  pwmNode: null,
  gainNode: null,
  isSimulating: false,
  handlePosition: 0, // -8 (EB) to 4 (P4)
  currentFreq: 0,
  currentSpeed: 0,
  acceleration: 3.0, // km/h/s（UIからは変更不可、プログラムからは可）
  lastUpdateTime: performance.now(),
};

// --- 初期化 ---
function init() {
  setupHandleUI();
  addEventListeners();
  clearCanvas();
  // acceleration UIは削除したので何もしない
}

function setupHandleUI() {
  // EB
  const ebNotch = createNotchElement("EB", "eb");
  ui.allNotches.appendChild(ebNotch);
  // B7~B1
  for (let i = BRAKE_LEVELS; i >= 1; i--) {
    const notch = createNotchElement(`B${i}`, `b${i}`);
    ui.allNotches.appendChild(notch);
  }
  // N
  const nNotch = createNotchElement("N", "n");
  ui.allNotches.appendChild(nNotch);
  // P1~P4
  for (let i = 1; i <= POWER_LEVELS; i++) {
    const notch = createNotchElement(`P${i}`, `p${i}`);
    ui.allNotches.appendChild(notch);
  }
}

function createNotchElement(label, notchId) {
  const wrapper = document.createElement("div");
  wrapper.classList.add("flex-1", "flex", "items-center", "justify-center");
  wrapper.dataset.notch = notchId;
  // ライト
  const light = document.createElement("div");
  light.classList.add(
    "notch-light",
    "w-8",
    "h-8",
    "rounded-full",
    "flex",
    "items-center",
    "justify-center",
    "mr-2",
    "border-2",
    "border-gray-600",
    "transition-all"
  );
  // 段名
  const text = document.createElement("span");
  text.textContent = label;
  text.classList.add("font-bold", "text-sm", "text-black", "select-none");
  light.appendChild(text);
  wrapper.appendChild(light);
  return wrapper;
}

function updateHandleLights() {
  // 全ノッチのライトをリセット
  const notches = ui.allNotches.querySelectorAll("[data-notch] > .notch-light");
  notches.forEach((light, idx) => {
    light.style.backgroundColor = "#222";
    light.style.opacity = "0.3";
    light.style.boxShadow = "none";
  });
  // 点灯ロジック
  // EB: -8, B7: -7 ... B1: -1, N: 0, P1: 1 ... P4: 4
  // EB: EB+全B点灯(赤/黄), B: B1~現在段まで点灯(黄), N: Nのみ点灯(緑), P: P1~現在段まで点灯(水色)
  if (state.handlePosition === -EB_LEVEL) {
    // EB
    for (let i = 0; i <= BRAKE_LEVELS; i++) {
      const light = ui.allNotches.children[i].querySelector(".notch-light");
      if (i === 0) {
        // EB
        light.style.backgroundColor = "#ef4444"; // 赤
        light.style.opacity = "1";
        light.style.boxShadow = "0 0 12px 4px #ef4444aa";
      } else {
        // B
        light.style.backgroundColor = "#facc15"; // 黄
        light.style.opacity = "1";
        light.style.boxShadow = "0 0 8px 2px #facc15aa";
      }
    }
  } else if (state.handlePosition < 0) {
    // B段
    const brakeIdx = Math.abs(state.handlePosition);
    // B1: children[7], B2: children[6,7], ... B7: children[1-7]
    for (let i = BRAKE_LEVELS + 1 - brakeIdx; i <= BRAKE_LEVELS; i++) {
      const light = ui.allNotches.children[i].querySelector(".notch-light");
      light.style.backgroundColor = "#facc15"; // 黄
      light.style.opacity = "1";
      light.style.boxShadow = "0 0 8px 2px #facc15aa";
    }
  } else if (state.handlePosition === 0) {
    // N
    const nIdx = BRAKE_LEVELS + 1;
    const light = ui.allNotches.children[nIdx].querySelector(".notch-light");
    light.style.backgroundColor = "#22c55e"; // 緑
    light.style.opacity = "1";
    light.style.boxShadow = "0 0 8px 2px #22c55eaa";
  } else if (state.handlePosition > 0) {
    // P段
    for (let i = 1; i <= state.handlePosition; i++) {
      const idx = BRAKE_LEVELS + 1 + i;
      const light = ui.allNotches.children[idx].querySelector(".notch-light");
      light.style.backgroundColor = "#38bdf8"; // 水色
      light.style.opacity = "1";
      light.style.boxShadow = "0 0 8px 2px #38bdf8aa";
    }
  }
}

// --- AudioWorkletのセ���トアップ ---
async function setupAudio() {
  if (state.audioCtx) return;
  try {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await state.audioCtx.audioWorklet.addModule("./processor.js");
    state.pwmNode = new AudioWorkletNode(state.audioCtx, "pwm-processor", {
      parameterData: {
        carrierFreq: parseFloat(ui.carrierFreq.value),
        signalFreq: state.currentFreq,
      },
    });
    // GainNodeを作成し、音量調整用に接続
    state.gainNode = state.audioCtx.createGain();
    state.gainNode.gain.value = 1.0; // デフォルト音量
    state.pwmNode.connect(state.gainNode);
    state.gainNode.connect(state.audioCtx.destination);
    state.pwmNode.port.onmessage = (event) => {
      if (event.data.type === "waveform") {
        drawWaveform(event.data.data);
      }
    };
  } catch (e) {
    console.error("Audio setup failed:", e);
    alert(
      "オーディオの初期化に失敗しました。ブラウザが対応していない可能性があります。"
    );
  }
}

// --- シミュレーションの開始/停止 ---
async function toggleSimulation() {
  if (!state.isSimulating) {
    await startSimulation();
  } else {
    stopSimulation();
  }
}

async function startSimulation() {
  if (!state.audioCtx) {
    await setupAudio();
  }
  if (state.audioCtx.state === "suspended") {
    await state.audioCtx.resume();
  }
  // AudioWorkletNodeのパラメータを初期値でセット（Nまたは停止中なら0）
  let freqToSend = state.currentFreq;
  if (state.handlePosition === 0 || state.currentSpeed === 0) {
    freqToSend = 0;
  }
  if (state.pwmNode) {
    const param = state.pwmNode.parameters.get("signalFreq");
    if (param) {
      param.setValueAtTime(freqToSend, state.audioCtx.currentTime);
    }
  }
  state.isSimulating = true;
  state.lastUpdateTime = performance.now();
  ui.startButton.textContent = "シミュレーション停止";
  ui.startButton.classList.replace("bg-blue-600", "bg-red-600");
  requestAnimationFrame(simulationLoop);
}

function stopSimulation() {
  state.isSimulating = false;
  if (state.audioCtx && state.audioCtx.state === "running") {
    state.audioCtx.suspend();
  }
  state.currentFreq = 0;
  state.currentSpeed = 0;
  updateUI();
  ui.startButton.textContent = "シミュレーション開始";
  ui.startButton.classList.replace("bg-red-600", "bg-blue-600");
}

// --- メインのシミュレーションループ ---
function simulationLoop(timestamp) {
  if (!state.isSimulating) return;

  const deltaTime = (timestamp - state.lastUpdateTime) / 1000; // seconds

  // 周波数の更新
  updateFrequency(deltaTime);

  // 速度の更新 (周波数に比例)
  state.currentSpeed = (state.currentFreq / MAX_FREQ) * MAX_SPEED;
  if (state.currentSpeed < 0) state.currentSpeed = 0;
  if (state.currentSpeed > MAX_SPEED) state.currentSpeed = MAX_SPEED;

  // Neutralまたは速度0のときは必ず無音にする
  let freqToSend = state.currentFreq;
  const isSilent = state.handlePosition === 0 || state.currentSpeed === 0;
  if (isSilent) {
    freqToSend = 0;
  }
  if (state.pwmNode) {
    const param = state.pwmNode.parameters.get("signalFreq");
    if (param) {
      param.setValueAtTime(freqToSend, state.audioCtx.currentTime);
    }
    // handlePositionとspeedをAudioWorkletに送信
    state.pwmNode.port.postMessage({
      handlePosition: state.handlePosition === 0 ? "N" : state.handlePosition,
      speed: state.currentSpeed,
    });
  }
  // Nまたは0kmのときは音量0、それ以外はスライダー値
  if (state.gainNode) {
    state.gainNode.gain.value = isSilent ? 0 : parseFloat(ui.volume.value);
  }

  // UIの更新
  updateUI();

  state.lastUpdateTime = timestamp;
  requestAnimationFrame(simulationLoop);
}

function updateFrequency(deltaTime) {
  // P4の時に state.acceleration と同じ加速度になるように、最大パワーレベルで割る
  const accelRateHz = state.acceleration / POWER_LEVELS;
  if (state.handlePosition > 0) {
    // Power
    state.currentFreq += state.handlePosition * accelRateHz * deltaTime;
  } else if (state.handlePosition === 0) {
    // Neutral (Coasting)
    state.currentFreq -= DECEL_RATE_COAST * deltaTime;
  } else {
    // Brake
    // EB: -8, B7: -7, B6: -6 ... B1: -1
    if (state.handlePosition === -EB_LEVEL) {
      // EB
      state.currentFreq -= DECEL_RATE_EB * deltaTime;
    } else if (state.handlePosition === -BRAKE_LEVELS) {
      // B7
      state.currentFreq -= DECEL_RATE_B7 * deltaTime;
    } else {
      // B1~B6
      const brakeForce = Math.abs(state.handlePosition);
      state.currentFreq -= brakeForce * DECEL_RATE_BRAKE * deltaTime;
    }
  }

  if (state.currentFreq < 0) state.currentFreq = 0;
  if (state.currentFreq > MAX_FREQ) state.currentFreq = MAX_FREQ;
}

// --- UI更新 ---
function updateUI() {
  ui.speedometer.textContent = Math.round(state.currentSpeed);
  updateHandleLights();
}

// --- イベントリスナー ---
function addEventListeners() {
  // 音量スライダー
  ui.volume.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    if (state.gainNode) {
      state.gainNode.gain.value = val;
    }
    ui.volumeValue.textContent = Math.round(val * 100) + "%";
  });
  ui.startButton.addEventListener("click", toggleSimulation);

  ui.carrierFreq.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    ui.carrierFreqValue.textContent = `${val} Hz`;
    if (state.pwmNode) {
      const param = state.pwmNode.parameters.get("carrierFreq");
      if (param) {
        param.setValueAtTime(val, state.audioCtx.currentTime);
      }
    }
  });

  // acceleration UIは削除したのでイベントリスナー不要

  window.addEventListener("keydown", handleKeyPress);
}

function handleKeyPress(e) {
  if (!state.isSimulating) return;

  switch (e.key.toUpperCase()) {
    case "Z": // マスコン進段 (Power up)
      if (state.handlePosition < POWER_LEVELS) {
        state.handlePosition++;
      }
      break;
    case "Q": // ブレーキ進段 (Brake up)
      // B7までしか入らない（EBにはQで入らない）
      if (state.handlePosition > -BRAKE_LEVELS) {
        state.handlePosition--;
      }
      break;
    case "A": // 惰行 (Neutral)
      state.handlePosition = 0;
      break;
    case "1": // EB
      state.handlePosition = -EB_LEVEL;
      break;
  }
  updateUI();
}

// --- 波形描画関連 (変更なし) ---
const canvasCtx = ui.waveformCanvas.getContext("2d");
const waveData = { u: [], v: [], w: [], line: [], carrier: [] };
let lastDrawTime = 0;

function drawWaveform(data) {
  const now = performance.now();
  if (now - lastDrawTime < 16) return; // ~60fps
  lastDrawTime = now;

  const canvas = ui.waveformCanvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  waveData.u.push(data.signalU);
  waveData.v.push(data.signalV);
  waveData.w.push(data.signalW);
  waveData.line.push(data.lineVoltage);
  waveData.carrier.push(data.carrier);

  if (waveData.u.length > width) {
    Object.keys(waveData).forEach((key) => waveData[key].shift());
  }

  canvasCtx.clearRect(0, 0, width, height);
  canvasCtx.lineWidth = 2;

  canvasCtx.strokeStyle = "#3b82f6"; // U (Blue)
  drawPath(waveData.u, height / 2, height / 4);
  canvasCtx.strokeStyle = "#22c55e"; // V (Green)
  drawPath(waveData.v, height / 2, height / 4);
  canvasCtx.strokeStyle = "#f59e0b"; // W (Yellow)
  drawPath(waveData.w, height / 2, height / 4);
  canvasCtx.strokeStyle = "#ef4444"; // I1 (Red)
  drawPath(waveData.line, height / 2, height / 8);
  canvasCtx.strokeStyle = "#6b7280"; // Carrier (Gray)
  canvasCtx.lineWidth = 1;
  drawPath(waveData.carrier, height / 2, height / 4);
}

function drawPath(data, midY, amplitude) {
  if (data.length < 1) return;
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, midY - data[0] * amplitude);
  for (let i = 1; i < data.length; i++) {
    canvasCtx.lineTo(i, midY - data[i] * amplitude);
  }
  canvasCtx.stroke();
}

function clearCanvas() {
  const canvas = ui.waveformCanvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvasCtx.clearRect(0, 0, width, height);
  Object.keys(waveData).forEach((key) => (waveData[key] = []));
}

// --- アプリケーション開始 ---
init();
