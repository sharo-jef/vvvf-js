import { globalConfig } from "./config.js";

export class VVVFSimulator {
  constructor(trainSpecs, config) {
    this.trainSpecs = trainSpecs;
    this.config = config;
    this.state = { ...this.config.initialState };
    this.currentSpec = this.trainSpecs[this.state.selectedTrain];

    this.audioCtx = null;
    this.pwmNode = null;
    this.gainNode = null;
    this.lpfNode = null;
    this.convolverNode = null;
    this.konvaObjects = {};
    this.simulationLoopStarted = false;
    this.lastSimTime = 0;

    this.dom = {
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
  }

  async initialize() {
    this.initKonvaUI();
    this.setupTrainSelector();
    this.setupEventListeners();

    Object.assign(this.state, this.config.initialState, {
      isSimulating: true,
      lpfCutoff: this.currentSpec.physical.lpfCutoff,
    });

    this.dom.volume.value = this.state.volume * 100;
    this.dom.lpf.value = this.state.lpfCutoff;
    this.dom.reverb.checked = this.state.reverbEnabled;

    await this.setupAudio();
    this.updateAudioConnections();

    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();

    this.render();
    this.startSimulationLoop();
  }

  initKonvaUI() {
    const {
      stage: stageConfig,
      notch: notchConfig,
      speedometer: speedConfig,
    } = this.config.ui;

    const { POWER_LEVELS, BRAKE_LEVELS } = this.currentSpec.physical;
    const brakeLabels = Array.from(
      { length: BRAKE_LEVELS },
      (_, i) => `B${BRAKE_LEVELS - i}`
    );
    const powerLabels = Array.from(
      { length: POWER_LEVELS },
      (_, i) => `P${i + 1}`
    );
    const labels = ["非 常", ...brakeLabels, "ユルメ", ...powerLabels];

    if (!this.konvaObjects.stage) {
      this.konvaObjects.stage = new Konva.Stage({
        container: this.dom.konvaContainer,
        width: stageConfig.width,
        height: 520,
      });
      this.konvaObjects.layer = new Konva.Layer();
      this.konvaObjects.stage.add(this.konvaObjects.layer);
    } else {
      this.konvaObjects.stage.height(520);
    }

    this.konvaObjects.layer.destroyChildren();
    this.konvaObjects.notchRects = [];
    this.konvaObjects.notchLabels = [];

    const masconBgStartIndex = 0;
    const masconBgEndIndex =
      this.currentSpec.physical.BRAKE_LEVELS +
      1 +
      this.currentSpec.physical.POWER_LEVELS;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let i = masconBgStartIndex; i <= masconBgEndIndex; i++) {
      const text = labels[i];
      const isSpecial = text === "非 常" || text === "ユルメ";
      const width = isSpecial
        ? notchConfig.special_width
        : notchConfig.base_width;
      const x = isSpecial ? notchConfig.special_x : notchConfig.base_x;
      const y = notchConfig.y_start + i * notchConfig.y_step;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + notchConfig.base_height);
    }
    const marginTop = 40,
      marginBottom = 40,
      marginLeft = 30,
      marginRight = 30;
    minX -= marginLeft;
    maxX += marginRight;
    minY -= marginTop;
    maxY += marginBottom;
    const masconBgRect = new Konva.Rect({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      fill: "#111",
      cornerRadius: 5,
      listening: false,
    });
    if (!this.konvaObjects.bgLayer) {
      this.konvaObjects.bgLayer = new Konva.Layer();
      this.konvaObjects.stage.add(this.konvaObjects.bgLayer);
      this.konvaObjects.bgLayer.moveToBottom();
    } else {
      this.konvaObjects.bgLayer.destroyChildren();
    }
    this.konvaObjects.bgLayer.add(masconBgRect);

    labels.forEach((text, i) => {
      const y = notchConfig.y_start + i * notchConfig.y_step;
      const isSpecial = text === "非 常" || text === "ユルメ";
      const width = isSpecial
        ? notchConfig.special_width
        : notchConfig.base_width;
      const x = isSpecial ? notchConfig.special_x : notchConfig.base_x;

      let fill = "#b0ab99";
      const NEUTRAL_INDEX = this.currentSpec.physical.BRAKE_LEVELS + 1;
      if (i === NEUTRAL_INDEX && this.state.handlePosition === 0) {
        fill = notchConfig.colors.active_n;
      }
      const rect = new Konva.Rect({
        x,
        y,
        width,
        height: notchConfig.base_height,
        fill,
        cornerRadius: 3,
      });
      this.konvaObjects.layer.add(rect);
      this.konvaObjects.notchRects.push(rect);

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
      this.konvaObjects.layer.add(label);
      this.konvaObjects.notchLabels.push(label);
    });

    this.createNotchOutline(
      this.currentSpec.physical.BRAKE_LEVELS + 2,
      this.currentSpec.physical.BRAKE_LEVELS +
        2 +
        this.currentSpec.physical.POWER_LEVELS -
        1,
      { top: 2, bottom: 2, left: 20, right: 20 },
      () => {
        if (this.state.handlePosition < this.currentSpec.physical.POWER_LEVELS) {
          this.state.handlePosition++;
        }
      }
    );

    this.createNotchOutline(
      this.currentSpec.physical.BRAKE_LEVELS + 1,
      this.currentSpec.physical.BRAKE_LEVELS + 1,
      { top: 1, bottom: 1, left: 1, right: 1 },
      () => {
        if (this.state.handlePosition > 0) {
          this.state.handlePosition--;
        } else if (this.state.handlePosition < 0) {
          this.state.handlePosition++;
        }
      }
    );

    this.createNotchOutline(0, 0, { top: 2, bottom: 2, left: 2, right: 2 }, () => {
      this.state.handlePosition = -(this.currentSpec.physical.BRAKE_LEVELS + 1);
    });

    this.createNotchOutline(
      1,
      this.currentSpec.physical.BRAKE_LEVELS,
      { top: 2, bottom: 2, left: 20, right: 20 },
      () => {
        if (this.state.handlePosition > -this.currentSpec.physical.BRAKE_LEVELS) {
          this.state.handlePosition--;
        }
      }
    );

    this.konvaObjects.speedValue = new Konva.Text({
      ...speedConfig.value,
      text: "0",
      fontFamily: "monospace",
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
    });
    this.konvaObjects.layer.add(this.konvaObjects.speedValue);

    this.konvaObjects.kmhLabel = new Konva.Text({
      ...speedConfig.label,
      text: "km/h",
      align: "center",
      verticalAlign: "middle",
    });
    this.konvaObjects.layer.add(this.konvaObjects.kmhLabel);

    this.konvaObjects.layer.draw();
  }

  createNotchOutline(startIndex, endIndex, margin, onClick) {
    const rects = this.konvaObjects.notchRects.slice(startIndex, endIndex + 1);
    if (rects.length === 0) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    rects.forEach((rect) => {
      const absX = rect.x();
      const absY = rect.y();
      const w = rect.width();
      const h = rect.height();
      minX = Math.min(minX, absX);
      minY = Math.min(minY, absY);
      maxX = Math.max(maxX, absX + w);
      maxY = Math.max(maxY, absY + h);
    });

    minX -= margin.left;
    maxX += margin.right;
    minY -= margin.top;
    maxY += margin.bottom;

    const outline = new Konva.Rect({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      stroke: "#fff",
      strokeWidth: 2,
      cornerRadius: 3,
      listening: true,
    });
    this.konvaObjects.layer.add(outline);
    outline.moveToTop();

    outline.on("pointerdown", async (evt) => {
      evt.evt.preventDefault && evt.evt.preventDefault();
      if (!this.audioCtx) await this.setupAudio();
      if (this.audioCtx && this.audioCtx.state === "suspended")
        await this.audioCtx.resume();
      if (!this.state.isSimulating) {
        this.state.isSimulating = true;
        if (!this.simulationLoopStarted) this.startSimulationLoop();
      }
      onClick();
      this.render();
      this.updateAudio();
    });
  }

  render() {
    const { notch: notchConfig } = this.config.ui;
    const NEUTRAL_INDEX = this.currentSpec.physical.BRAKE_LEVELS + 1;
    const EB_INDEX = 0;

    this.konvaObjects.notchRects.forEach((rect, i) => {
      let fill = "#b0ab99";
      const handle = this.state.handlePosition;

      if (handle === 0 && i === NEUTRAL_INDEX) {
        fill = notchConfig.colors.active_n;
      } else if (handle === -(this.currentSpec.physical.BRAKE_LEVELS + 1)) {
        if (i === EB_INDEX) fill = notchConfig.colors.active_eb;
        else if (i > EB_INDEX && i < NEUTRAL_INDEX)
          fill = notchConfig.colors.active_b;
      } else if (handle < 0) {
        if (i >= NEUTRAL_INDEX - Math.abs(handle) && i < NEUTRAL_INDEX) {
          fill = notchConfig.colors.active_b;
        }
      } else if (handle > 0) {
        if (i > NEUTRAL_INDEX && i <= NEUTRAL_INDEX + handle) {
          fill = notchConfig.colors.active_p;
        }
      }
      rect.fill(fill);
    });

    this.konvaObjects.speedValue.text(Math.round(this.state.currentSpeed));

    if (this.dom.volumeValue)
      this.dom.volumeValue.textContent = `${Math.round(this.state.volume * 100)}%`;
    if (this.dom.lpfValue)
      this.dom.lpfValue.textContent = `${this.state.lpfCutoff} Hz`;

    this.konvaObjects.layer.draw();
  }

  async setupAudio() {
    if (this.audioCtx) return;
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await this.audioCtx.audioWorklet.addModule("./src/processor.js?t=" + Date.now());

    this.pwmNode = new AudioWorkletNode(this.audioCtx, "pwm-processor", {
      parameterData: { signalFreq: 0 },
    });
    this.lpfNode = this.audioCtx.createBiquadFilter();
    this.lpfNode.type = "lowpass";
    this.convolverNode = this.audioCtx.createConvolver();
    this.gainNode = this.audioCtx.createGain();

    this.pwmNode.connect(this.lpfNode);
    this.gainNode.connect(this.audioCtx.destination);

    this.pwmNode.port.onmessage = this.handlePwmMessage.bind(this);

    try {
      const response = await fetch("ir/bright.wav");
      const arrayBuffer = await response.arrayBuffer();
      this.convolverNode.buffer = await this.audioCtx.decodeAudioData(
        arrayBuffer
      );
    } catch (e) {
      console.error("Failed to load impulse response:", e);
      if (this.dom.reverb) this.dom.reverb.disabled = true;
    }
  }

  handlePwmMessage({ data }) {
    if (data.type === "ready") {
      this.pwmNode.port.postMessage({
        modulationPatterns: this.currentSpec.modulationPatterns.accel,
      });
    } else if (data.type === "waveform" && this.dom.modulationInfo) {
      const { pattern, carrierFreq } = data.data;
      let text = "-";
      if (pattern) {
        if (pattern.type === "async")
          text = `非同期 ${carrierFreq.toFixed(1)}Hz`;
        else if (pattern.type !== "mute")
          text = `同期 ${
            pattern.pulse === "wide_3" ? "広域3" : pattern.pulse
          }パルス`;
      }
      this.dom.modulationInfo.textContent = text;
    }
  }

  updateAudioConnections() {
    if (!this.lpfNode || !this.gainNode || !this.convolverNode) return;
    this.lpfNode.disconnect();
    if (this.state.reverbEnabled && this.convolverNode.buffer) {
      this.lpfNode.connect(this.convolverNode).connect(this.gainNode);
    } else {
      this.lpfNode.connect(this.gainNode);
    }
  }

  updateAudio() {
    if (!this.audioCtx || !this.pwmNode) return;

    const isAudible = this.state.currentSpeed > 0 && this.state.handlePosition !== 0;
    const freq = isAudible
      ? (this.state.currentSpeed / this.currentSpec.physical.MAX_SPEED) *
        this.currentSpec.physical.MAX_FREQ
      : 0;

    this.pwmNode.parameters
      .get("signalFreq")
      .setValueAtTime(freq, this.audioCtx.currentTime);
    this.gainNode.gain.setValueAtTime(
      isAudible ? this.state.volume : 0,
      this.audioCtx.currentTime
    );
    this.lpfNode.frequency.setValueAtTime(
      this.state.lpfCutoff,
      this.audioCtx.currentTime
    );

    const patterns =
      this.state.handlePosition < 0
        ? this.currentSpec.modulationPatterns.decel
        : this.currentSpec.modulationPatterns.accel;

    this.pwmNode.port.postMessage({
      handlePosition:
        this.state.handlePosition === 0 ? "N" : this.state.handlePosition,
      speed: this.state.currentSpeed,
      modulationPatterns: patterns,
    });
  }

  startSimulationLoop() {
    if (this.simulationLoopStarted) return;
    this.simulationLoopStarted = true;
    this.lastSimTime = performance.now();
    requestAnimationFrame(this.simulationLoop.bind(this));
  }

  simulationLoop(now) {
    if (!this.state.isSimulating) {
      this.simulationLoopStarted = false;
      if (this.audioCtx) this.audioCtx.suspend();
      return;
    }

    const dt = (now - this.lastSimTime) / 1000;
    this.lastSimTime = now;

    this.updateSpeed(dt);
    this.state.currentSpeed = Math.max(
      0,
      Math.min(this.state.currentSpeed, this.currentSpec.physical.MAX_SPEED)
    );

    this.render();
    this.updateAudio();
    requestAnimationFrame(this.simulationLoop.bind(this));
  }

  updateSpeed(dt) {
    const handle = this.state.handlePosition;
    const { physical } = this.currentSpec;
    if (handle > 0) {
      const accel = (physical.ACCEL_RATE_MAX * handle) / physical.POWER_LEVELS;
      this.state.currentSpeed += accel * dt;
    } else if (handle === 0) {
      this.state.currentSpeed -= physical.DECEL_RATE_COAST * dt;
    } else {
      if (handle === -(physical.BRAKE_LEVELS + 1))
        this.state.currentSpeed -= physical.DECEL_RATE_EB * dt;
      else {
        const decel =
          (physical.DECEL_RATE_MAX / physical.BRAKE_LEVELS) * Math.abs(handle);
        this.state.currentSpeed -= decel * dt;
      }
    }
  }

  setupEventListeners() {
    window.addEventListener("keydown", this.handleKeyEvent.bind(this));

    this.dom.volume.addEventListener("input", () => {
      this.state.volume = Number(this.dom.volume.value) / 100;
      this.render();
      this.updateAudio();
    });

    this.dom.lpf.addEventListener("input", () => {
      this.state.lpfCutoff = Number(this.dom.lpf.value);
      this.render();
      this.updateAudio();
    });

    this.dom.reverb.addEventListener("change", (e) => {
      this.state.reverbEnabled = e.target.checked;
      this.updateAudioConnections();
    });

    this.dom.resetButton.addEventListener("click", this.resetSimulation.bind(this));
    this.dom.trainSelect.addEventListener("change", (e) => {
      this.state.selectedTrain = e.target.value;
      this.resetSimulation();
    });
  }

  setupTrainSelector() {
    Object.keys(this.trainSpecs).forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      this.dom.trainSelect.appendChild(option);
    });
    this.dom.trainSelect.value = this.state.selectedTrain;
  }

  handleKeyEvent(e) {
    if (!this.state.isSimulating) return;
    let changed = false;
    let handle = this.state.handlePosition;
    const { physical } = this.currentSpec;

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
      this.state.handlePosition = handle;
      this.render();
      this.updateAudio();
      if (this.audioCtx && this.audioCtx.state === "suspended")
        this.audioCtx.resume();
      if (!this.simulationLoopStarted) this.startSimulationLoop();
    }
  }

  resetSimulation() {
    this.currentSpec = this.trainSpecs[this.state.selectedTrain];
    Object.assign(this.state, this.config.initialState, {
      isSimulating: true,
      selectedTrain: this.state.selectedTrain,
      lpfCutoff: this.currentSpec.physical.lpfCutoff,
    });

    this.initKonvaUI();

    this.dom.volume.value = this.state.volume * 100;
    this.dom.lpf.value = this.state.lpfCutoff;
    this.dom.reverb.checked = this.state.reverbEnabled;

    this.render();
    this.updateAudioConnections();
    this.updateAudio();
  }
}