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
  carrierFreq: document.getElementById("carrierFreq"),
  carrierFreqValue: document.getElementById("carrierFreqValue"),
  waveformCanvas: document.getElementById("waveformCanvas"),
  speedmeter: document.getElementById("speedmeter"),
  handleContainer: document.getElementById("handle-container"),
  allNotches: document.getElementById("all-notches"),
  volume: document.getElementById("volume"),
  volumeValue: document.getElementById("volumeValue"),
};

// --- 疎結合な状態管理・UI・シミュレーション ---
const state = {
  handlePosition: 0, // -8 (EB) to 4 (P4)
  currentSpeed: 0,
  isSimulating: false,
};

// Konva.js UI描画
let konvaObjects = {};
function render(state) {
  // スライダーの値表示が動的に更新されるようにイベントを付与（多重登録防止）
  if (
    ui.carrierFreq &&
    ui.carrierFreqValue &&
    !ui.carrierFreq.__copilot_listener
  ) {
    ui.carrierFreq.addEventListener("input", () => {
      ui.carrierFreqValue.textContent = ui.carrierFreq.value;
    });
    ui.carrierFreq.__copilot_listener = true;
  }
  if (ui.volume && ui.volumeValue && !ui.volume.__copilot_listener) {
    ui.volume.addEventListener("input", () => {
      ui.volumeValue.textContent = ui.volume.value;
    });
    ui.volume.__copilot_listener = true;
  }
  if (!konvaObjects.stage) {
    // 初回のみKonvaステージ生成
    const width = 800, // 横長に拡張
      height = 400;
    konvaObjects.stage = new Konva.Stage({
      container: "konva-stage-container",
      width,
      height,
    });
    konvaObjects.layer = new Konva.Layer();
    konvaObjects.stage.add(konvaObjects.layer);
    // 右側ナビバー風の背景
    konvaObjects.navBarBg = new Konva.Rect({
      x: 650,
      y: 0,
      width: 150,
      height: 400,
      fill: "#222",
      cornerRadius: 0,
      strokeWidth: 0,
      shadowColor: "#000",
      shadowBlur: 8,
      shadowOffset: { x: -2, y: 0 },
      shadowOpacity: 0.2,
    });
    konvaObjects.layer.add(konvaObjects.navBarBg);

    // HTML側のUIを右端に移動
    const navPanel = document.getElementById("sim-nav-panel");
    if (!navPanel) {
      const panel = document.createElement("div");
      panel.id = "sim-nav-panel";
      panel.style.position = "absolute";
      panel.style.top = "0px";
      panel.style.right = "0px";
      panel.style.width = "150px";
      panel.style.height = "400px";
      panel.style.background = "rgba(34,34,34,0.98)";
      panel.style.display = "flex";
      panel.style.flexDirection = "column";
      panel.style.alignItems = "center";
      panel.style.justifyContent = "flex-start";
      panel.style.gap = "18px";
      panel.style.zIndex = "10";
      // 搬送波周波数
      if (ui.carrierFreq && ui.carrierFreqValue) {
        // label要素をinputの前に取得
        let freqLabel = null;
        if (ui.carrierFreq.labels && ui.carrierFreq.labels.length > 0) {
          freqLabel = ui.carrierFreq.labels[0];
        } else {
          // fallback: inputの直前の兄弟要素
          const prev = ui.carrierFreq.previousElementSibling;
          if (prev && prev.tagName === "LABEL") freqLabel = prev;
        }
        // ラッパーdiv生成
        const freqWrap = document.createElement("div");
        freqWrap.style.display = "flex";
        freqWrap.style.flexDirection = "column";
        freqWrap.style.alignItems = "center";
        freqWrap.style.marginTop = "32px";
        if (freqLabel) freqWrap.appendChild(freqLabel);
        freqWrap.appendChild(ui.carrierFreq);
        if (ui.carrierFreqValue) freqWrap.appendChild(ui.carrierFreqValue);
        panel.appendChild(freqWrap);
      }
      // 音量
      if (ui.volume && ui.volumeValue) {
        let volLabel = null;
        if (ui.volume.labels && ui.volume.labels.length > 0) {
          volLabel = ui.volume.labels[0];
        } else {
          const prev = ui.volume.previousElementSibling;
          if (prev && prev.tagName === "LABEL") volLabel = prev;
        }
        const volWrap = document.createElement("div");
        volWrap.style.display = "flex";
        volWrap.style.flexDirection = "column";
        volWrap.style.alignItems = "center";
        if (volLabel) volWrap.appendChild(volLabel);
        volWrap.appendChild(ui.volume);
        if (ui.volumeValue) volWrap.appendChild(ui.volumeValue);
        panel.appendChild(volWrap);
      }
      // シミュレーション開始ボタン
      const btn = document.getElementById("startButton");
      if (btn) {
        btn.style.display = "";
        btn.style.width = "120px";
        btn.style.marginTop = "32px";
        btn.style.marginBottom = "0px";
        btn.style.fontSize = "18px";
        btn.style.borderRadius = "8px";
        btn.style.background = btn.classList.contains("bg-red-600")
          ? "#dc2626"
          : "#2563eb";
        panel.appendChild(btn);
      }
      document.body.appendChild(panel);
    }
    // ノッチ
    konvaObjects.notchRects = [];
    konvaObjects.notchLabels = [];
    const notchLabels = [
      "EB",
      "B7",
      "B6",
      "B5",
      "B4",
      "B3",
      "B2",
      "B1",
      "N",
      "P1",
      "P2",
      "P3",
      "P4",
    ];
    for (let i = 0; i < notchLabels.length; i++) {
      const y = 40 + i * 30; // 少し間隔を詰める
      // EBとNは横長
      let width = 45,
        height = 22,
        x = 70;
      if (i === 0 || i === 8) {
        // EB, N
        width = 60;
        x = 62;
      }
      const rect = new Konva.Rect({
        x,
        y,
        width,
        height,
        fill: "#222",
        cornerRadius: 0, // 角を丸めない
        strokeWidth: 0, // ふちなし
      });
      konvaObjects.layer.add(rect);
      konvaObjects.notchRects.push(rect);
      const label = new Konva.Text({
        x,
        y: y + 2,
        width,
        height,
        text: notchLabels[i],
        fontSize: 15,
        fontStyle: "bold",
        align: "center",
        verticalAlign: "middle",
        fill: "#111",
      });
      konvaObjects.layer.add(label);
      konvaObjects.notchLabels.push(label);
    }
    // スピードメーター
    konvaObjects.speedValue = new Konva.Text({
      x: 400,
      y: 20,
      width: 180,
      height: 60,
      text: "0",
      fontSize: 56,
      fontFamily: "monospace",
      fontStyle: "bold",
      fill: "#22d3ee",
      align: "center",
      verticalAlign: "middle",
    });
    konvaObjects.layer.add(konvaObjects.speedValue);
    konvaObjects.kmhLabel = new Konva.Text({
      x: 400,
      y: 80,
      width: 180,
      height: 30,
      text: "km/h",
      fontSize: 22,
      fill: "#aaa",
      align: "center",
      verticalAlign: "middle",
    });
    konvaObjects.layer.add(konvaObjects.kmhLabel);
    // キー操作
    window.addEventListener("keydown", (e) => {
      if (!state.isSimulating) return;
      switch (e.key.toUpperCase()) {
        case "Z":
          if (state.handlePosition < 4) state.handlePosition++;
          break;
        case "Q":
          if (state.handlePosition > -7) state.handlePosition--;
          break;
        case "A":
          state.handlePosition = 0;
          break;
        case "1":
          state.handlePosition = -8;
          break;
      }
      render(state);
    });
  }
  // ノッチの点灯状態
  for (let i = 0; i < konvaObjects.notchRects.length; i++) {
    let fill = "#222";
    let labelColor = "#111";
    if (state.handlePosition === -8 && i === 0) fill = "#ef4444"; // EB
    else if (state.handlePosition === -8 && i > 0 && i <= 7)
      fill = "#facc15"; // EB+B
    else if (
      state.handlePosition < 0 &&
      i >= 8 - Math.abs(state.handlePosition) &&
      i <= 7
    )
      fill = "#facc15"; // B
    else if (state.handlePosition === 0 && i === 8) fill = "#22c55e"; // N
    else if (
      state.handlePosition > 0 &&
      i >= 8 &&
      i <= 8 + state.handlePosition
    )
      fill = "#38bdf8"; // P
    konvaObjects.notchRects[i].fill(fill);
    konvaObjects.notchLabels[i].fill(labelColor);
  }
  // スピードメーター
  konvaObjects.speedValue.text(Math.round(state.currentSpeed));
  // HTMLボタンのラベル・色も状態で切り替え
  const btn = document.getElementById("startButton");
  if (btn) {
    btn.textContent = state.isSimulating
      ? "シミュレーション停止"
      : "シミュレーション開始";
    btn.style.background = state.isSimulating ? "#dc2626" : "#2563eb";
  }
  konvaObjects.layer.draw();
}

// --- AudioWorklet連携 ---
let audioCtx = null,
  pwmNode = null,
  gainNode = null;
async function setupAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.audioWorklet.addModule("./processor.js");
  pwmNode = new AudioWorkletNode(audioCtx, "pwm-processor", {
    parameterData: {
      carrierFreq: 2000,
      signalFreq: 0,
    },
  });
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0.5;
  pwmNode.connect(gainNode);
  gainNode.connect(audioCtx.destination);
}
function updateAudio() {
  if (!audioCtx || !pwmNode) return;
  // Neutralまたは速度0のときは無音
  let freqToSend =
    state.currentSpeed > 0 && state.handlePosition !== 0
      ? (state.currentSpeed / MAX_SPEED) * MAX_FREQ
      : 0;
  const param = pwmNode.parameters.get("signalFreq");
  if (param) param.setValueAtTime(freqToSend, audioCtx.currentTime);
  gainNode.gain.value =
    state.currentSpeed > 0 && state.handlePosition !== 0 ? 0.5 : 0;
  // AudioWorkletProcessorにhandlePositionとspeedを送信
  pwmNode.port.postMessage({
    handlePosition: state.handlePosition === 0 ? "N" : state.handlePosition,
    speed: state.currentSpeed,
  });
}
function stopAudio() {
  if (audioCtx) audioCtx.suspend();
}

// 疎結合なシミュレーションループ
function startSimulationLoop() {
  let lastTime = performance.now();
  function loop(now) {
    if (!state.isSimulating) {
      stopAudio();
      return;
    }
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    // 速度計算例（P段で加速、B段で減速、Nで自然減速）
    if (state.handlePosition > 0)
      state.currentSpeed += state.handlePosition * 0.5 * dt;
    else if (state.handlePosition === 0) state.currentSpeed -= 0.3 * dt;
    else if (state.handlePosition < 0)
      state.currentSpeed -= Math.abs(state.handlePosition) * 0.8 * dt;
    if (state.currentSpeed < 0) state.currentSpeed = 0;
    if (state.currentSpeed > 120) state.currentSpeed = 120;
    render(state);
    updateAudio();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// 既存のHTMLボタンでシミュレーション開始/停止
window.addEventListener("DOMContentLoaded", () => {
  render(state);
  const btn = document.getElementById("startButton");
  btn.addEventListener("click", async () => {
    state.isSimulating = !state.isSimulating;
    btn.textContent = state.isSimulating
      ? "シミュレーション停止"
      : "シミュレーション開始";
    btn.classList.toggle("bg-blue-600", !state.isSimulating);
    btn.classList.toggle("bg-red-600", state.isSimulating);
    render(state);
    if (state.isSimulating) {
      await setupAudio();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      startSimulationLoop();
    } else {
      stopAudio();
    }
  });
});
