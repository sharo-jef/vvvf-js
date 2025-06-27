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
const ACCEL_RATE_P4 = 3; // km/h/s (加速度, P4時)

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
  carrierFreq: 400,
  volume: 0.5,
};

// Konva.js UI描画
let konvaObjects = {};
function render(state) {
  // スライダーの値表示が動的に更新されるようにイベントを付与（多重登録防止）
  // --- 共通の値表示関数 ---
  function setCarrierFreqValueDisplay(val) {
    if (ui.carrierFreqValue) {
      ui.carrierFreqValue.textContent = `${val} Hz`;
    }
  }
  function setVolumeValueDisplay(val) {
    if (ui.volumeValue) {
      ui.volumeValue.textContent = `${Math.round(val)} %`;
    }
  }

  if (
    ui.carrierFreq &&
    ui.carrierFreqValue &&
    !ui.carrierFreq.__copilot_listener
  ) {
    ui.carrierFreq.addEventListener("input", () => {
      setCarrierFreqValueDisplay(ui.carrierFreq.value);
      state.carrierFreq = Number(ui.carrierFreq.value);
      updateAudio();
    });
    ui.carrierFreq.__copilot_listener = true;
  }
  if (ui.volume && ui.volumeValue && !ui.volume.__copilot_listener) {
    ui.volume.addEventListener("input", () => {
      setVolumeValueDisplay(ui.volume.value);
      state.volume = Number(ui.volume.value) * 0.01;
      updateAudio();
    });
    ui.volume.__copilot_listener = true;
  }
  if (!konvaObjects.stage) {
    // 初回のみKonvaステージ生成（ノッチ・メーターのみ）
    const width = 800, // 横長に拡張
      height = 450; // 縦長を少しだけ拡張
    konvaObjects.stage = new Konva.Stage({
      container: "konva-stage-container",
      width,
      height,
    });
    konvaObjects.layer = new Konva.Layer();
    konvaObjects.stage.add(konvaObjects.layer);
    // 右側ナビバー風の背景（不要な灰色の四角）を描画しない
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
      let changed = false;
      switch (e.key.toUpperCase()) {
        case "Z":
          if (state.handlePosition < 4) {
            state.handlePosition++;
            changed = true;
          }
          break;
        case "Q":
          if (state.handlePosition > -7) {
            state.handlePosition--;
            changed = true;
          }
          break;
        case "A":
          // N(0)に近づく方向に一段動かす
          if (state.handlePosition > 0) {
            state.handlePosition--;
            changed = true;
          } else if (state.handlePosition < 0) {
            state.handlePosition++;
            changed = true;
          }
          break;
        case "1":
          if (state.handlePosition !== -8) {
            state.handlePosition = -8;
            changed = true;
          }
          break;
      }
      if (changed) {
        render(state);
        updateAudio();
        // AudioContextがsuspendedならresume（ユーザー操作時のみ有効）
        if (audioCtx && audioCtx.state === "suspended") {
          audioCtx.resume();
        }
        // シミュレーションループが止まっていたら再開
        if (!simulationLoopStarted && state.isSimulating) {
          startSimulationLoop();
        }
      }
    });
  }
  // ノッチの点灯状態
  for (let i = 0; i < konvaObjects.notchRects.length; i++) {
    let fill = "#222";
    let labelColor = "#111";
    // B段: B1~B7, EB
    if (state.handlePosition === -8 && i === 0) fill = "#ef4444"; // EB
    else if (state.handlePosition === -8 && i > 0 && i <= 7)
      fill = "#facc15"; // EB+B
    else if (
      state.handlePosition < 0 &&
      i >= 8 - Math.abs(state.handlePosition) &&
      i <= 7
    )
      fill = "#facc15"; // B
    // N: ニュートラル
    else if (state.handlePosition === 0 && i === 8) fill = "#22c55e";
    // P段: P1~P4（B段と同じ色に）
    else if (
      state.handlePosition > 0 &&
      i >= 8 &&
      i <= 8 + state.handlePosition
    )
      fill = "#facc15";
    // N消灯: P段のときはNを消灯
    if (state.handlePosition > 0 && i === 8) fill = "#222";
    konvaObjects.notchRects[i].fill(fill);
    konvaObjects.notchLabels[i].fill(labelColor);
  }
  // スピードメーター
  konvaObjects.speedValue.text(Math.round(state.currentSpeed));
  // スライダー値表示（単位付き）もここで毎回更新
  setCarrierFreqValueDisplay(ui.carrierFreq ? ui.carrierFreq.value : "");
  setVolumeValueDisplay(ui.volume ? ui.volume.value : "");
  // HTMLボタンのラベル・色も状態で切り替え
  const btn = document.getElementById("startButton");
  if (btn) {
    const icon = btn.querySelector(".unity-btn-icon");
    const label = btn.querySelector(".unity-btn-label");
    if (state.isSimulating) {
      btn.classList.add("stop");
      if (icon) icon.textContent = "■";
      if (label) label.textContent = "シミュレーション停止";
    } else {
      btn.classList.remove("stop");
      if (icon) icon.textContent = "▶";
      if (label) label.textContent = "シミュレーション開始";
    }
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
  // キャリア周波数も反映
  const carrierParam = pwmNode.parameters.get("carrierFreq");
  if (carrierParam)
    carrierParam.setValueAtTime(state.carrierFreq, audioCtx.currentTime);
  const param = pwmNode.parameters.get("signalFreq");
  if (param) param.setValueAtTime(freqToSend, audioCtx.currentTime);
  // 音量も反映
  gainNode.gain.value =
    state.currentSpeed > 0 && state.handlePosition !== 0 ? state.volume : 0;
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
let simulationLoopStarted = false;
function startSimulationLoop() {
  if (simulationLoopStarted) return;
  simulationLoopStarted = true;
  let lastTime = performance.now();
  function loop(now) {
    if (!state.isSimulating) {
      stopAudio();
      simulationLoopStarted = false;
      return;
    }
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    // 速度計算（定義した加速度・減速度を使う）
    if (state.handlePosition > 0) {
      // 加速: P4でACCEL_RATE_P4、ノッチに応じて線形配分
      const accel = (ACCEL_RATE_P4 * state.handlePosition) / POWER_LEVELS;
      state.currentSpeed += accel * dt;
    } else if (state.handlePosition === 0) {
      // ニュートラル: 自然減速
      state.currentSpeed -= DECEL_RATE_COAST * dt;
    } else if (state.handlePosition < 0) {
      // ブレーキ段
      if (state.handlePosition === -8) {
        // EB
        state.currentSpeed -= DECEL_RATE_EB * dt;
      } else if (state.handlePosition === -7) {
        // B7
        state.currentSpeed -= DECEL_RATE_B7 * dt;
      } else {
        // B1~B6
        state.currentSpeed -=
          Math.abs(state.handlePosition) * DECEL_RATE_BRAKE * dt;
      }
    }
    // 速度の下限・上限
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
  // --- UIロジック: 搬送波周波数の数値直接入力 ---
  const carrierFreqValue = document.getElementById("carrierFreqValue");
  const carrierFreqSlider = document.getElementById("carrierFreq");
  if (carrierFreqValue && carrierFreqSlider) {
    carrierFreqValue.style.cursor = "pointer";
    carrierFreqValue.title = "クリックして直接入力";
    function setCarrierFreqValueDisplay() {
      const v = carrierFreqSlider.value;
      carrierFreqValue.innerHTML = `${v} <span style="font-size:13px;color:#4fc3f7;">Hz</span>`;
    }
    setCarrierFreqValueDisplay();
    carrierFreqSlider.addEventListener("input", setCarrierFreqValueDisplay);
    carrierFreqValue.addEventListener("click", function () {
      const min = Number(carrierFreqSlider.min);
      const max = Number(carrierFreqSlider.max);
      const current = carrierFreqSlider.value;
      const wrapper = document.createElement("span");
      wrapper.style.display = "inline-flex";
      wrapper.style.alignItems = "center";
      const input = document.createElement("input");
      input.type = "number";
      input.value = current;
      input.min = min;
      input.max = max;
      input.style.width = "48px";
      input.style.fontSize = "13px";
      input.style.textAlign = "right";
      input.style.background = "#23272a";
      input.style.color = "#4fc3f7";
      input.style.border = "1px solid #4fc3f7";
      input.style.borderRadius = "4px";
      input.style.outline = "none";
      input.style.height = "22px";
      input.style.overflow = "hidden";
      input.style.marginRight = "2px";
      input.style.boxSizing = "border-box";
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") input.blur();
      });
      input.addEventListener("blur", function () {
        let v = Math.round(Number(input.value));
        if (isNaN(v)) v = current;
        if (v < min) v = min;
        if (v > max) v = max;
        carrierFreqSlider.value = v;
        carrierFreqSlider.dispatchEvent(new Event("input"));
        setCarrierFreqValueDisplay();
        wrapper.replaceWith(carrierFreqValue);
      });
      const unit = document.createElement("span");
      unit.textContent = "Hz";
      unit.style.color = "#4fc3f7";
      unit.style.fontSize = "13px";
      unit.style.marginLeft = "2px";
      wrapper.appendChild(input);
      wrapper.appendChild(unit);
      carrierFreqValue.parentNode.replaceChild(wrapper, carrierFreqValue);
      input.focus();
      input.select();
    });
  }

  // --- UIロジック: 音量の数値直接入力 ---
  const volumeValue = document.getElementById("volumeValue");
  const volumeSlider = document.getElementById("volume");
  if (volumeValue && volumeSlider) {
    volumeValue.style.cursor = "pointer";
    volumeValue.title = "クリックして直接入力";
    function setVolumeValueDisplay() {
      const v = volumeSlider.value;
      volumeValue.innerHTML = `${Math.round(
        v * 100
      )}<span style="font-size:13px;color:#7fffd4;">%</span>`;
    }
    setVolumeValueDisplay();
    volumeSlider.addEventListener("input", setVolumeValueDisplay);
    volumeValue.addEventListener("click", function () {
      const min = Number(volumeSlider.min);
      const max = Number(volumeSlider.max);
      const current = Number(volumeSlider.value);
      const wrapper = document.createElement("span");
      wrapper.style.display = "inline-flex";
      wrapper.style.alignItems = "center";
      const input = document.createElement("input");
      input.type = "number";
      input.value = current;
      input.min = min;
      input.max = max;
      input.step = "0.01";
      input.style.width = "38px";
      input.style.fontSize = "13px";
      input.style.textAlign = "right";
      input.style.background = "#23272a";
      input.style.color = "#7fffd4";
      input.style.border = "1px solid #7fffd4";
      input.style.borderRadius = "4px";
      input.style.outline = "none";
      input.style.height = "22px";
      input.style.overflow = "hidden";
      input.style.marginRight = "2px";
      input.style.boxSizing = "border-box";
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") input.blur();
      });
      input.addEventListener("blur", function () {
        let v = Number(input.value);
        if (isNaN(v)) v = current;
        if (v < min) v = min;
        if (v > max) v = max;
        volumeSlider.value = v;
        volumeSlider.dispatchEvent(new Event("input"));
        setVolumeValueDisplay();
        wrapper.replaceWith(volumeValue);
      });
      const unit = document.createElement("span");
      unit.textContent = "%";
      unit.style.color = "#7fffd4";
      unit.style.fontSize = "13px";
      unit.style.marginLeft = "2px";
      wrapper.appendChild(input);
      wrapper.appendChild(unit);
      volumeValue.parentNode.replaceChild(wrapper, volumeValue);
      input.focus();
      input.select();
    });
  }

  // --- UIロジック: Reset（赤テキスト） ---
  const resetButton = document.getElementById("resetButton");
  if (resetButton) {
    resetButton.addEventListener("click", function () {
      // スライダー・値を初期値に
      if (carrierFreqSlider) carrierFreqSlider.value = 400;
      if (volumeSlider) volumeSlider.value = 50;
      // 値表示も更新
      if (typeof setCarrierFreqValueDisplay === "function")
        setCarrierFreqValueDisplay();
      if (typeof setVolumeValueDisplay === "function") setVolumeValueDisplay();
      // Konva/状態も初期化
      state.handlePosition = 0;
      state.currentSpeed = 0;
      state.isSimulating = true;
      state.carrierFreq = 400;
      state.volume = 0.5;
      if (typeof render === "function") render(state);
      updateAudio();
    });
  }

  // --- シミュレーション自動開始 ---
  (async function autoStartSimulation() {
    state.isSimulating = true;
    state.handlePosition = 0;
    state.currentSpeed = 0;
    state.carrierFreq = 400;
    state.volume = 0.5;
    render(state);
    await setupAudio();
    if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
    simulationLoopStarted = false;
    startSimulationLoop();
    updateAudio();
  })();
});
