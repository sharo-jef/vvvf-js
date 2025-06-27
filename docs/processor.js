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

    this.port.postMessage({ type: "ready" });
  }

  _getModulationPattern(signalFreq) {
    if (!this.modulationPatterns || this.modulationPatterns.length === 0) {
      // Default pattern if none is provided
      return { type: "async", carrierFreq: 1500 };
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
    const output = outputs[0];
    const outputChannel = output[0];

    if (!outputChannel) {
      return true;
    }

    const signalFreqParam = parameters.signalFreq;
    const sampleRate = globalThis.sampleRate;

    for (let i = 0; i < outputChannel.length; i++) {
      if (this.handlePosition === "N" || this.speed === 0) {
        outputChannel[i] = 0;
        continue;
      }

      const currentSignalFreq =
        signalFreqParam.length > 1 ? signalFreqParam[i] : signalFreqParam[0];
      const signalIncrement = (2 * Math.PI * currentSignalFreq) / sampleRate;

      this.signalPhase += signalIncrement;
      if (this.signalPhase > 2 * Math.PI) {
        this.signalPhase -= 2 * Math.PI;
      }

      const pattern = this._getModulationPattern(currentSignalFreq);
      let carrierWave;

      if (pattern.type === "async") {
        // async: carrierFreq is relative to signalFreq
        const carrierFreq = pattern.carrierFreqRatio
          ? currentSignalFreq * pattern.carrierFreqRatio
          : pattern.carrierFreq;
        const carrierIncrement = (2 * Math.PI * carrierFreq) / sampleRate;
        this.asyncCarrierPhase += carrierIncrement;
        if (this.asyncCarrierPhase > 2 * Math.PI) {
          this.asyncCarrierPhase -= 2 * Math.PI;
        }
        carrierWave =
          (2 / Math.PI) * Math.asin(Math.sin(this.asyncCarrierPhase));
      } else {
        // 'sync'
        let pulse = pattern.pulse;
        if (pulse === "wide_3") {
          // wide_3: wide-range 3-pulse carrier
          const basePhase = this.signalPhase % (2 * Math.PI);
          let shift = 0;
          if (basePhase < (2 * Math.PI) / 3) {
            shift = 0;
          } else if (basePhase < (4 * Math.PI) / 3) {
            shift = Math.PI;
          } else {
            shift = 0;
          }
          const carrierPhase = (this.signalPhase * 3 + shift) % (2 * Math.PI);
          carrierWave = (2 / Math.PI) * Math.asin(Math.sin(carrierPhase));
        } else {
          const carrierPhase = (this.signalPhase * pulse) % (2 * Math.PI);
          carrierWave = (2 / Math.PI) * Math.asin(Math.sin(carrierPhase));
        }
      }

      const signalU = Math.sin(this.signalPhase);
      const signalV = Math.sin(this.signalPhase - (2 * Math.PI) / 3);
      const signalW = Math.sin(this.signalPhase - (4 * Math.PI) / 3);

      const pwmU = signalU > carrierWave ? 1 : -1;
      const pwmV = signalV > carrierWave ? 1 : -1;
      const pwmW = signalW > carrierWave ? 1 : -1;

      const currentI1 = (2 * pwmU - pwmV - pwmW) / (3 * this.R);
      outputChannel[i] = currentI1 * 0.1;
    }

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

registerProcessor("pwm-processor", PwmProcessor);
