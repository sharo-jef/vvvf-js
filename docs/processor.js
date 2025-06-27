// DEBUG: Top-level processor.js loaded
console.log("[DEBUG] processor.js script loaded");

class PwmProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "signalFreq",
        defaultValue: 0,
        minValue: 0,
        maxValue: 200,
        automationRate: "a-rate",
      },
    ];
  }

  constructor() {
    console.log("[DEBUG] PwmProcessor constructor: start");
    super();
    console.log("[DEBUG] PwmProcessor constructor: after super()");
    this.signalPhase = 0;
    this.asyncCarrierPhase = 0; // For async mode
    this.lastWaveformUpdateTime = 0;
    this.R = 1;
    this.handlePosition = "N";
    this.speed = 0;
    this.modulationPatterns = []; // To be loaded from JSON

    this.port.onmessage = (event) => {
      // DEBUG: Log all incoming messages
      try {
        this.port.postMessage({
          type: "debug",
          message: "[processor] port.onmessage",
          event: event.data,
        });
      } catch (e) {}
      if (event.data && typeof event.data === "object") {
        if ("handlePosition" in event.data) {
          this.handlePosition = event.data.handlePosition;
        }
        if ("speed" in event.data) {
          this.speed = event.data.speed;
        }
        if ("modulationPatterns" in event.data) {
          this.modulationPatterns = event.data.modulationPatterns;
          // デバッグ: パターン受信時に内容を通知（即時flushのためsetTimeoutで遅延）
          setTimeout(() => {
            this.port.postMessage({
              type: "debug",
              message: "modulationPatterns received",
              patterns: this.modulationPatterns,
            });
          }, 0);
        }
      }
    };

    try {
      this.port.postMessage({ type: "ready" });
      console.log("[DEBUG] PwmProcessor constructor: posted ready");
    } catch (e) {
      console.log("[DEBUG] PwmProcessor constructor: failed to post ready", e);
    }
  }

  _getModulationPattern(signalFreq) {
    if (!this.modulationPatterns || this.modulationPatterns.length === 0) {
      throw new Error("modulationPatterns is not defined or empty");
    }
    for (const pattern of this.modulationPatterns) {
      if (pattern.to === "max" || signalFreq < pattern.to) {
        return pattern;
      }
    }
    // Fallback to the last pattern
    return this.modulationPatterns[this.modulationPatterns.length - 1];
  }

  process(inputs, outputs, parameters) {
    // デバッグ: 速度0のときはデバッグ出力もしない
    if (this.speed === 0) {
      return true;
    }
    // デバッグ: 最初の1回だけパターンを通知
    if (
      !this._debugPatternPrinted &&
      this.modulationPatterns &&
      this.modulationPatterns.length > 0
    ) {
      this.port.postMessage({
        type: "debug",
        message: "modulationPatterns in process (once)",
        patterns: this.modulationPatterns,
      });
      this._debugPatternPrinted = true;
    }
    // Always post a debug message on first process call to confirm processor is running
    if (!this._debugProcessPosted) {
      this.port.postMessage({
        type: "debug",
        message: "process() called: processor is running",
        modulationPatternsLength: this.modulationPatterns
          ? this.modulationPatterns.length
          : 0,
      });
      this._debugProcessPosted = true;
    }
    const output = outputs[0];
    const outputChannel = output[0];

    if (!outputChannel) {
      return true;
    }

    const signalFreqParam = parameters.signalFreq;
    const sampleRate = globalThis.sampleRate;

    let signalPhase = this.signalPhase;
    let asyncCarrierPhase = this.asyncCarrierPhase;
    let prevPattern = this._getModulationPattern(
      signalFreqParam.length > 1 ? signalFreqParam[0] : signalFreqParam[0]
    );
    let prevCarrierFreq = null;
    for (let i = 0; i < outputChannel.length; i++) {
      if (this.handlePosition === "N" || this.speed === 0) {
        outputChannel[i] = 0;
        continue;
      }

      const currentSignalFreq =
        signalFreqParam.length > 1 ? signalFreqParam[i] : signalFreqParam[0];
      const signalIncrement = (2 * Math.PI * currentSignalFreq) / sampleRate;

      // パターン切り替え時はキャリア位相をリセット
      const pattern = this._getModulationPattern(currentSignalFreq);
      let carrierFreq = null;
      if (pattern.type === "async") {
        if (typeof pattern.carrierFreqRatio === "number") {
          carrierFreq = currentSignalFreq * pattern.carrierFreqRatio;
        } else if (typeof pattern.carrierFreq === "number") {
          carrierFreq = pattern.carrierFreq;
        } else {
          throw new Error(
            "async pattern requires carrierFreq or carrierFreqRatio"
          );
        }
      }
      if (
        pattern !== prevPattern ||
        (pattern.type === "async" && carrierFreq !== prevCarrierFreq)
      ) {
        asyncCarrierPhase = 0;
        prevPattern = pattern;
        prevCarrierFreq = carrierFreq;
      }

      signalPhase += signalIncrement;
      if (signalPhase > 2 * Math.PI) {
        signalPhase -= 2 * Math.PI;
      }

      let carrierWave;
      if (pattern.type === "async") {
        const carrierIncrement = (2 * Math.PI * carrierFreq) / sampleRate;
        asyncCarrierPhase += carrierIncrement;
        if (asyncCarrierPhase > 2 * Math.PI) {
          asyncCarrierPhase -= 2 * Math.PI;
        }
        carrierWave = (2 / Math.PI) * Math.asin(Math.sin(asyncCarrierPhase));
      } else {
        // sync: pulse必須
        let pulse = pattern.pulse;
        if (pulse === undefined) {
          throw new Error("sync pattern requires pulse");
        }
        if (pulse === "wide_3") {
          const basePhase = signalPhase % (2 * Math.PI);
          let shift = 0;
          if (basePhase < (2 * Math.PI) / 3) {
            shift = 0;
          } else if (basePhase < (4 * Math.PI) / 3) {
            shift = Math.PI;
          } else {
            shift = 0;
          }
          const carrierPhase = (signalPhase * 3 + shift) % (2 * Math.PI);
          carrierWave = (2 / Math.PI) * Math.asin(Math.sin(carrierPhase));
        } else {
          const carrierPhase = (signalPhase * pulse) % (2 * Math.PI);
          carrierWave = (2 / Math.PI) * Math.asin(Math.sin(carrierPhase));
        }
      }

      const signalU = Math.sin(signalPhase);
      const signalV = Math.sin(signalPhase - (2 * Math.PI) / 3);
      const signalW = Math.sin(signalPhase - (4 * Math.PI) / 3);

      const pwmU = signalU > carrierWave ? 1 : -1;
      const pwmV = signalV > carrierWave ? 1 : -1;
      const pwmW = signalW > carrierWave ? 1 : -1;

      const currentI1 = (2 * pwmU - pwmV - pwmW) / (3 * this.R);
      outputChannel[i] = currentI1 * 0.1;
    }
    this.signalPhase = signalPhase;
    this.asyncCarrierPhase = asyncCarrierPhase;

    if (globalThis.currentTime - this.lastWaveformUpdateTime > 0.016) {
      if (this.handlePosition === "N" || this.speed === 0) {
        this.port.postMessage({
          type: "waveform",
          data: {
            signalU: 0,
            signalV: 0,
            signalW: 0,
            lineVoltage: 0,
            carrier: 0,
            pattern: null,
          },
        });
        this.lastWaveformUpdateTime = globalThis.currentTime;
        return true;
      }

      const lastSampleIndex = outputChannel.length - 1;
      const currentSignalFreq =
        signalFreqParam.length > 1
          ? signalFreqParam[lastSampleIndex]
          : signalFreqParam[0];
      const signalIncrement = (2 * Math.PI * currentSignalFreq) / sampleRate;
      const lastSignalPhase =
        this.signalPhase + signalIncrement * lastSampleIndex;

      const pattern = this._getModulationPattern(currentSignalFreq);
      let carrierWave;
      if (pattern.type === "async") {
        const carrierFreq = pattern.carrierFreqRatio
          ? currentSignalFreq * pattern.carrierFreqRatio
          : pattern.carrierFreq;
        const carrierIncrement = (2 * Math.PI * carrierFreq) / sampleRate;
        const lastAsyncCarrierPhase =
          this.asyncCarrierPhase + carrierIncrement * lastSampleIndex;
        carrierWave =
          (2 / Math.PI) * Math.asin(Math.sin(lastAsyncCarrierPhase));
      } else {
        let pulse = pattern.pulse;
        if (pulse === "wide_3") {
          const basePhase = lastSignalPhase % (2 * Math.PI);
          let shift = 0;
          if (basePhase < (2 * Math.PI) / 3) {
            shift = 0;
          } else if (basePhase < (4 * Math.PI) / 3) {
            shift = Math.PI;
          } else {
            shift = 0;
          }
          const lastCarrierPhase =
            (lastSignalPhase * 3 + shift) % (2 * Math.PI);
          carrierWave = (2 / Math.PI) * Math.asin(Math.sin(lastCarrierPhase));
        } else {
          const lastCarrierPhase = (lastSignalPhase * pulse) % (2 * Math.PI);
          carrierWave = (2 / Math.PI) * Math.asin(Math.sin(lastCarrierPhase));
        }
      }

      const signalU = Math.sin(lastSignalPhase);
      const signalV = Math.sin(lastSignalPhase - (2 * Math.PI) / 3);
      const signalW = Math.sin(lastSignalPhase - (4 * Math.PI) / 3);

      const pwmU = signalU > carrierWave ? 1 : -1;
      const pwmV = signalV > carrierWave ? 1 : -1;
      const pwmW = signalW > carrierWave ? 1 : -1;
      const currentI1 = (2 * pwmU - pwmV - pwmW) / (3 * this.R);

      this.port.postMessage({
        type: "waveform",
        data: {
          signalU,
          signalV,
          signalW,
          lineVoltage: currentI1,
          carrier: carrierWave,
          pattern: pattern,
        },
      });
      this.lastWaveformUpdateTime = globalThis.currentTime;
    }

    return true;
  }
}

try {
  console.log("[DEBUG] Registering pwm-processor");
  registerProcessor("pwm-processor", PwmProcessor);
  console.log("[DEBUG] registerProcessor succeeded");
} catch (e) {
  // Try to post error to main thread if possible
  try {
    if (
      typeof AudioWorkletGlobalScope !== "undefined" &&
      AudioWorkletGlobalScope.port
    ) {
      AudioWorkletGlobalScope.port.postMessage({
        type: "debug",
        message: "registerProcessor failed",
        error: e,
      });
    }
  } catch (ee) {}
  console.log("[DEBUG] registerProcessor failed", e);
}
