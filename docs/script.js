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

// --- 変調パターン定義 ---
const MODULATION_PATTERNS = {
  accel: [
    { from: 0, to: 20, type: "async", carrierFreq: 400 },
    { from: 20, to: 23, type: "sync", pulse: 15 },
    { from: 23, to: 30, type: "sync", pulse: 11 },
    { from: 30, to: 35, type: "sync", pulse: 7 },
    { from: 35, to: 38, type: "sync", pulse: 3 },
    { from: 38, to: 40, type: "sync", pulse: "wide_3" },
    { from: 40, to: "max", type: "sync", pulse: 1 },
  ],
  decel: [
    { from: 58, to: "max", type: "sync", pulse: 1 },
    { from: 55, to: 58, type: "sync", pulse: "wide_3" },
    { from: 52, to: 55, type: "sync", pulse: 3 },
    { from: 43, to: 52, type: "sync", pulse: 7 },
    { from: 30, to: 43, type: "sync", pulse: 11 },
    { from: 23, to: 30, type: "sync", pulse: 15 },
    { from: 7, to: 23, type: "sync", pulse: 21 },
    { from: 0, to: 7, type: "mute" },
  ],
};

// --- DOM要素の取得 ---
const ui = {
  waveformCanvas: document.getElementById("waveformCanvas"),
  speedmeter: document.getElementById("speedmeter"),
  handleContainer: document.getElementById("handle-container"),
  allNotches: document.getElementById("all-notches"),
  volume: document.getElementById("volume"),
  volumeValue: document.getElementById("volumeValue"),
  modulationInfo: document.getElementById("modulation-info"),
  lpf: document.getElementById("lpf"),
  lpfValue: document.getElementById("lpfValue"),
  reverb: document.getElementById("reverb"),
};

// --- 疎結合な状態管理・UI・シミュレーション ---
const state = {
  handlePosition: 0, // -8 (EB) to 4 (P4)
  currentSpeed: 0,
  isSimulating: false,
  volume: 0.5,
  lpfCutoff: 5000,
  reverbEnabled: false,
};

// Konva.js UI描画
let konvaObjects = {};
function render(state) {
  function setVolumeValueDisplay(val) {
    if (ui.volumeValue) {
      ui.volumeValue.textContent = `${Math.round(val * 100)} %`;
    }
  }
  function setLpfValueDisplay(val) {
    if (ui.lpfValue) {
      ui.lpfValue.textContent = `${val} Hz`;
    }
  }

  if (ui.volume && ui.volumeValue && !ui.volume.__copilot_listener) {
    ui.volume.addEventListener("input", () => {
      const newVolume = Number(ui.volume.value) / 100;
      state.volume = newVolume;
      setVolumeValueDisplay(newVolume);
      updateAudio();
    });
    ui.volume.__copilot_listener = true;
  }
  if (ui.lpf && ui.lpfValue && !ui.lpf.__copilot_listener) {
    ui.lpf.addEventListener("input", () => {
      const newLpfCutoff = Number(ui.lpf.value);
      state.lpfCutoff = newLpfCutoff;
      setLpfValueDisplay(newLpfCutoff);
      updateAudio();
    });
    ui.lpf.__copilot_listener = true;
  }
  if (ui.reverb && !ui.reverb.__copilot_listener) {
    ui.reverb.addEventListener("change", (e) => {
      state.reverbEnabled = e.target.checked;
      updateAudioConnections();
    });
    ui.reverb.__copilot_listener = true;
  }

  if (!konvaObjects.stage) {
    // ... (Konvaの初期化は変更なし) ...
    const width = 800,
      height = 450;
    konvaObjects.stage = new Konva.Stage({
      container: "konva-stage-container",
      width,
      height,
    });
    konvaObjects.layer = new Konva.Layer();
    konvaObjects.stage.add(konvaObjects.layer);
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
      const y = 40 + i * 30;
      let width = 45,
        height = 22,
        x = 70;
      if (i === 0 || i === 8) {
        width = 60;
        x = 62;
      }
      const rect = new Konva.Rect({
        x,
        y,
        width,
        height,
        fill: "#222",
        cornerRadius: 0,
        strokeWidth: 0,
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
  // ... (ノッチとスピードメーターの描画は変更なし) ...
  for (let i = 0; i < konvaObjects.notchRects.length; i++) {
    let fill = "#222";
    let labelColor = "#111";
    if (state.handlePosition === -8 && i === 0) fill = "#ef4444";
    else if (state.handlePosition === -8 && i > 0 && i <= 7) fill = "#facc15";
    else if (
      state.handlePosition < 0 &&
      i >= 8 - Math.abs(state.handlePosition) &&
      i <= 7
    )
      fill = "#facc15";
    else if (state.handlePosition === 0 && i === 8) fill = "#22c55e";
    else if (
      state.handlePosition > 0 &&
      i >= 8 &&
      i <= 8 + state.handlePosition
    )
      fill = "#facc15";
    if (state.handlePosition > 0 && i === 8) fill = "#222";
    konvaObjects.notchRects[i].fill(fill);
    konvaObjects.notchLabels[i].fill(labelColor);
  }
  konvaObjects.speedValue.text(Math.round(state.currentSpeed));
  setVolumeValueDisplay(state.volume);
  setLpfValueDisplay(state.lpfCutoff);
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
  gainNode = null,
  lpfNode = null,
  convolverNode = null;

async function setupAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.audioWorklet.addModule("./processor.js");
  pwmNode = new AudioWorkletNode(audioCtx, "pwm-processor", {
    parameterData: { signalFreq: 0 },
  });

  lpfNode = audioCtx.createBiquadFilter();
  lpfNode.type = "lowpass";
  lpfNode.frequency.value = state.lpfCutoff;

  convolverNode = audioCtx.createConvolver();

  gainNode = audioCtx.createGain();
  gainNode.gain.value = state.volume;

  // Establish permanent connections
  pwmNode.connect(lpfNode);
  gainNode.connect(audioCtx.destination);

  // Set up the dynamic part of the chain
  updateAudioConnections();

  pwmNode.port.onmessage = (event) => {
    if (event.data.type === "ready") {
      // On ready, send the initial (acceleration) patterns
      pwmNode.port.postMessage({
        modulationPatterns: MODULATION_PATTERNS.accel,
      });
    } else if (event.data.type === "waveform" && ui.modulationInfo) {
      const pattern = event.data.data.pattern;
      if (pattern) {
        let patternText;
        if (pattern.type === "async") {
          patternText = `非同期 ${pattern.carrierFreq}Hz`;
        } else if (pattern.type === "mute") {
          patternText = `-`;
        } else {
          patternText = `同期 ${
            pattern.pulse === "wide_3" ? "広域3" : pattern.pulse
          }パルス`;
        }
        ui.modulationInfo.textContent = `${patternText}`;
      } else {
        ui.modulationInfo.textContent = "-";
      }
    }
  };

  // Load impulse response
  try {
    const response = await fetch("ir/tunnel.mp3");
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    convolverNode.buffer = audioBuffer;
    updateAudioConnections(); // Re-connect now that the buffer is loaded
  } catch (e) {
    console.error("Failed to load impulse response:", e);
    if (ui.reverb) ui.reverb.disabled = true;
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
  let freqToSend =
    state.currentSpeed > 0 && state.handlePosition !== 0
      ? (state.currentSpeed / MAX_SPEED) * MAX_FREQ
      : 0;

  const param = pwmNode.parameters.get("signalFreq");
  if (param) param.setValueAtTime(freqToSend, audioCtx.currentTime);

  gainNode.gain.value =
    state.currentSpeed > 0 && state.handlePosition !== 0 ? state.volume : 0;
  lpfNode.frequency.setValueAtTime(state.lpfCutoff, audioCtx.currentTime);

  let modulationPatterns;
  if (state.handlePosition < 0) {
    // 減速時は現在の周波数に応じたパターン1つだけを送る
    let freqToSend = state.currentSpeed > 0 && state.handlePosition !== 0
      ? (state.currentSpeed / MAX_SPEED) * MAX_FREQ
      : 0;
    // Hzスケールでパターンを選択
    let pattern = null;
    for (const p of MODULATION_PATTERNS.decel) {
      const from = p.from === "max" ? MAX_FREQ : p.from;
      const to = p.to === "max" ? MAX_FREQ : p.to;
      if (freqToSend >= from && freqToSend < to) {
        pattern = p;
        break;
      }
    }
    if (!pattern) pattern = { type: "mute" };
    modulationPatterns = [pattern];
  } else {
    modulationPatterns = MODULATION_PATTERNS.accel;
  }
  pwmNode.port.postMessage({
    handlePosition: state.handlePosition === 0 ? "N" : state.handlePosition,
    speed: state.currentSpeed,
    modulationPatterns: modulationPatterns,
  });
}

function stopAudio() {
  if (audioCtx) audioCtx.suspend();
}

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
    if (state.handlePosition > 0) {
      const accel = (ACCEL_RATE_P4 * state.handlePosition) / POWER_LEVELS;
      state.currentSpeed += accel * dt;
    } else if (state.handlePosition === 0) {
      state.currentSpeed -= DECEL_RATE_COAST * dt;
    } else if (state.handlePosition < 0) {
      if (state.handlePosition === -8) {
        state.currentSpeed -= DECEL_RATE_EB * dt;
      } else if (state.handlePosition === -7) {
        state.currentSpeed -= DECEL_RATE_B7 * dt;
      } else {
        state.currentSpeed -=
          Math.abs(state.handlePosition) * DECEL_RATE_BRAKE * dt;
      }
    }
    if (state.currentSpeed < 0) state.currentSpeed = 0;
    if (state.currentSpeed > 120) state.currentSpeed = 120;
    render(state);
    updateAudio();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

window.addEventListener("DOMContentLoaded", () => {
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

  const resetButton = document.getElementById("resetButton");
  if (resetButton) {
    resetButton.addEventListener("click", function () {
      if (volumeSlider) volumeSlider.value = 50;
      if (ui.lpf) ui.lpf.value = 5000;
      if (ui.reverb) ui.reverb.checked = false;
      // ...
      state.volume = 0.5;
      state.lpfCutoff = 5000;
      state.reverbEnabled = false;
      if (typeof render === "function") render(state);
      updateAudioConnections();
      updateAudio();
    });
  }

  (async function autoStartSimulation() {
    state.isSimulating = true;
    state.handlePosition = 0;
    state.currentSpeed = 0;
    state.volume = 0.5;
    state.lpfCutoff = 5000;
    state.reverbEnabled = true;
    if (ui.reverb) ui.reverb.checked = true;
    render(state);
    await setupAudio();
    if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
    simulationLoopStarted = false;
    startSimulationLoop();
    updateAudioConnections();
    updateAudio();
  })();
});
