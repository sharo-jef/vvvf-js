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
    super();
    // ...
    this.signalPhase = 0;
    this.asyncCarrierPhase = 0; // For async mode
    this.lastWaveformUpdateTime = 0;
    this.R = 1;
    this.handlePosition = "N";
    this.speed = 0;
    this.modulationPatterns = []; // To be loaded from JSON

    this.port.onmessage = (event) => {
      if (event.data && typeof event.data === "object") {
        if ("handlePosition" in event.data) {
          this.handlePosition = event.data.handlePosition;
        }
        if ("speed" in event.data) {
          this.speed = event.data.speed;
        }
        if ("modulationPatterns" in event.data) {
          this.modulationPatterns = event.data.modulationPatterns;
        }
      }
    };

    try {
      this.port.postMessage({ type: "ready" });
    } catch (e) {}
  }

  _getModulationPattern(signalFreq) {
    if (!this.modulationPatterns || this.modulationPatterns.length === 0) {
      throw new Error("modulationPatterns is not defined or empty");
    }
    for (const pattern of this.modulationPatterns) {
      const isInRange =
        signalFreq >= pattern.from &&
        (pattern.to === "max" || signalFreq < pattern.to);
      if (isInRange) {
        return pattern;
      }
    }
    // Fallback to the last pattern
    return this.modulationPatterns[this.modulationPatterns.length - 1];
  }

  process(inputs, outputs, parameters) {
    if (this.speed === 0) {
      return true;
    }
    const output = outputs[0];
    const outputChannel = output[0];
    if (!outputChannel) {
      return true;
    }

    const signalFreqParam = parameters.signalFreq;
    const sampleRate = globalThis.sampleRate;

    // 0Hzから1パルスになる周波数まで線形に電圧値(振幅)を0~1で変動させる
    // 1パルスになる周波数 = キャリア周波数 (sync: pulse=1)
    // ただし、pattern.typeがmute/asyncの場合は従来通り

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
        if (typeof pattern.carrierFreq === "object") {
          // 線形補間
          const signalFreqRange = pattern.to - pattern.from;
          const carrierFreqRange =
            pattern.carrierFreq.to - pattern.carrierFreq.from;
          const signalFreqOffset = currentSignalFreq - pattern.from;

          if (signalFreqRange <= 0) {
            carrierFreq = pattern.carrierFreq.from;
          } else {
            const ratio = signalFreqOffset / signalFreqRange;
            carrierFreq = pattern.carrierFreq.from + carrierFreqRange * ratio;
          }
        } else if (typeof pattern.carrierFreqRatio === "number") {
          carrierFreq = currentSignalFreq * pattern.carrierFreqRatio;
        } else if (typeof pattern.carrierFreq === "number") {
          carrierFreq = pattern.carrierFreq;
        } else {
          throw new Error(
            "async pattern requires carrierFreq (number or object) or carrierFreqRatio"
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
      if (pattern.type === "mute") {
        outputChannel[i] = 0;
        continue;
      } else if (pattern.type === "async") {
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

      // --- 振幅(電圧値)のスケーリング ---
      let amplitude = 1;
      if (pattern.type === "async") {
        // async: carrierFreqは既に決定済み
        if (carrierFreq > 0) {
          amplitude = Math.max(0, Math.min(1, currentSignalFreq / carrierFreq));
        }
      } else if (
        pattern.type === "sync" &&
        typeof pattern.pulse === "number" &&
        pattern.pulse === 1
      ) {
        // 1パルスになる周波数 = キャリア周波数
        const carrierFreq = currentSignalFreq; // pulse=1のときキャリア=信号周波数
        amplitude = Math.max(0, Math.min(1, currentSignalFreq / carrierFreq));
      } else if (
        pattern.type === "sync" &&
        typeof pattern.pulse === "number" &&
        pattern.pulse > 1
      ) {
        // 1パルス未満の範囲でのみスケーリング
        const carrierFreq = currentSignalFreq * pattern.pulse;
        if (currentSignalFreq < carrierFreq) {
          amplitude = Math.max(0, Math.min(1, currentSignalFreq / carrierFreq));
        }
      }

      const signalU = Math.sin(signalPhase) * amplitude;
      const signalV = Math.sin(signalPhase - (2 * Math.PI) / 3) * amplitude;
      const signalW = Math.sin(signalPhase - (4 * Math.PI) / 3) * amplitude;

      const pwmU = signalU > carrierWave ? 1 : -1;
      const pwmV = signalV > carrierWave ? 1 : -1;
      const pwmW = signalW > carrierWave ? 1 : -1;

      const currentI1 = (pwmU - pwmV) / 2; // Normalize to -1.0 to 1.0
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
        let carrierFreq;
        if (typeof pattern.carrierFreq === "object") {
          const signalFreqRange = pattern.to - pattern.from;
          const carrierFreqRange =
            pattern.carrierFreq.to - pattern.carrierFreq.from;
          const signalFreqOffset = currentSignalFreq - pattern.from;

          if (signalFreqRange <= 0) {
            carrierFreq = pattern.carrierFreq.from;
          } else {
            const ratio = signalFreqOffset / signalFreqRange;
            carrierFreq = pattern.carrierFreq.from + carrierFreqRange * ratio;
          }
        } else if (pattern.carrierFreqRatio) {
          carrierFreq = currentSignalFreq * pattern.carrierFreqRatio;
        } else {
          carrierFreq = pattern.carrierFreq;
        }

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
      const currentI1 = (pwmU - pwmV) / 2; // Normalize to -1.0 to 1.0

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
  registerProcessor("pwm-processor", PwmProcessor);
} catch (e) {}
