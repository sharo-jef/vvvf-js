document.addEventListener("DOMContentLoaded", () => {
  // --- 定数と設定 ---
  const POWER_LEVELS = 4;
  const BRAKE_LEVELS = 7;
  const EB_LEVEL = 8;
  const MAX_SPEED = 120; // km/h
  const MAX_FREQ = 120; // Hz
  const ACCEL_RATE = 0.5; // Hz per second per notch
  const DECEL_RATE_COAST = 0.3; // Hz per second (natural deceleration)
  const DECEL_RATE_BRAKE = 0.8; // Hz per second per notch

  // --- DOM要素の取得 ---
  const ui = {
    startButton: document.getElementById("startButton"),
    carrierFreq: document.getElementById("carrierFreq"),
    carrierFreqValue: document.getElementById("carrierFreqValue"),
    waveformCanvas: document.getElementById("waveformCanvas"),
    speedometer: document.getElementById("speedometer"),
    handleContainer: document.getElementById("handle-container"),
    handleIndicator: document.getElementById("handle-indicator"),
    allNotches: document.getElementById("all-notches"),
  };

  // --- アプリケーションの状態 ---
  const state = {
    audioCtx: null,
    pwmNode: null,
    isSimulating: false,
    handlePosition: 0, // -8 (EB) to 4 (P4)
    currentFreq: 0,
    currentSpeed: 0,
    lastUpdateTime: performance.now(),
  };

  // --- 初期化 ---
  function init() {
    setupHandleUI();
    addEventListeners();
    updateHandleIndicator();
    clearCanvas();
  }

  function setupHandleUI() {
    // EB notch
    const ebNotch = document.createElement("div");
    ebNotch.textContent = "EB";
    ebNotch.classList.add(
      "text-red-600",
      "flex-1",
      "flex",
      "items-center",
      "justify-center",
      "font-bold",
      "text-sm"
    );
    ui.allNotches.appendChild(ebNotch);

    // Brake notches (B7..B1)
    for (let i = BRAKE_LEVELS; i >= 1; i--) {
      const notch = document.createElement("div");
      notch.textContent = `B${i}`;
      notch.classList.add(
        "text-red-400",
        "flex-1",
        "flex",
        "items-center",
        "justify-center",
        "font-bold",
        "text-sm"
      );
      ui.allNotches.appendChild(notch);
    }

    // Neutral notch
    const neutralNotch = document.createElement("div");
    neutralNotch.textContent = "N";
    neutralNotch.classList.add(
      "text-gray-300",
      "flex-1",
      "flex",
      "items-center",
      "justify-center",
      "font-bold",
      "text-sm"
    );
    ui.allNotches.appendChild(neutralNotch);

    // Power notches (P1..P4)
    for (let i = 1; i <= POWER_LEVELS; i++) {
      const notch = document.createElement("div");
      notch.textContent = `P${i}`;
      notch.classList.add(
        "text-green-400",
        "flex-1",
        "flex",
        "items-center",
        "justify-center",
        "font-bold",
        "text-sm"
      );
      ui.allNotches.appendChild(notch);
    }
  }

  // --- AudioWorkletのセットアップ ---
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
      state.pwmNode.connect(state.audioCtx.destination);
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
    // AudioWorkletNodeのパラメータを初期値でセット（Nなら0、そうでなければstate.currentFreq）
    let freqToSend = state.currentFreq;
    if (state.handlePosition === 0) {
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
    if (state.handlePosition === 0 || state.currentSpeed === 0) {
      freqToSend = 0;
    }
    if (state.pwmNode) {
      const param = state.pwmNode.parameters.get("signalFreq");
      if (param) {
        param.setValueAtTime(freqToSend, state.audioCtx.currentTime);
      }
    }

    // UIの更新
    updateUI();

    state.lastUpdateTime = timestamp;
    requestAnimationFrame(simulationLoop);
  }

  function updateFrequency(deltaTime) {
    if (state.handlePosition > 0) {
      // Power
      state.currentFreq += state.handlePosition * ACCEL_RATE * deltaTime;
    } else if (state.handlePosition === 0) {
      // Neutral (Coasting)
      state.currentFreq -= DECEL_RATE_COAST * deltaTime;
    } else {
      // Brake
      const brakeForce = Math.abs(state.handlePosition);
      state.currentFreq -= brakeForce * DECEL_RATE_BRAKE * deltaTime;
    }

    if (state.currentFreq < 0) state.currentFreq = 0;
    if (state.currentFreq > MAX_FREQ) state.currentFreq = MAX_FREQ;
  }

  // --- UI更新 ---
  function updateUI() {
    ui.speedometer.textContent = Math.round(state.currentSpeed);
    updateHandleIndicator();
  }

  function updateHandleIndicator() {
    const totalNotches = POWER_LEVELS + BRAKE_LEVELS + 2; // P4..N..B7..EB, total 13 notches
    const handleContainerHeight = ui.handleContainer.clientHeight;
    const notchHeight = handleContainerHeight / totalNotches;

    // Map handlePosition (-8 for EB to 4 for P4) to a visual index (0 to 12)
    // The notches are in order: EB, B7, ..., B1, N, P1, ..., P4
    // EB(-8) -> index 0
    // B7(-7) -> index 1
    // ...
    // N(0)   -> index 8
    // ...
    // P4(4)  -> index 12
    const positionIndex = state.handlePosition + EB_LEVEL;

    const translateY = positionIndex * notchHeight;

    ui.handleIndicator.style.transform = `translateY(${translateY}px)`;
  }

  // --- イベントリスナー ---
  function addEventListeners() {
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
        if (state.handlePosition > -EB_LEVEL) {
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
});
