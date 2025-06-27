class PwmProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "carrierFreq",
        defaultValue: 2000,
        minValue: 50,
        maxValue: 10000,
        automationRate: "k-rate",
      },
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
    this.carrierPhase = 0;
    this.lastWaveformUpdateTime = 0;
    this.R = 1; // 抵抗
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const outputChannel = output[0];

    if (!outputChannel) {
      return true;
    }

    const carrierFreq = parameters.carrierFreq[0];
    const signalFreq = parameters.signalFreq;
    const sampleRate = globalThis.sampleRate;

    const carrierIncrement = (2 * Math.PI * carrierFreq) / sampleRate;

    for (let i = 0; i < outputChannel.length; i++) {
      const currentSignalFreq = signalFreq.length > 1 ? signalFreq[i] : signalFreq[0];
      const signalIncrement = (2 * Math.PI * currentSignalFreq) / sampleRate;

      this.carrierPhase += carrierIncrement;
      if (this.carrierPhase > 2 * Math.PI) this.carrierPhase -= 2 * Math.PI;
      const carrierWave = (2 / Math.PI) * Math.asin(Math.sin(this.carrierPhase));

      this.signalPhase += signalIncrement;
      if (this.signalPhase > 2 * Math.PI) this.signalPhase -= 2 * Math.PI;

      const signalU = Math.sin(this.signalPhase);
      const signalV = Math.sin(this.signalPhase - (2 * Math.PI / 3));
      const signalW = Math.sin(this.signalPhase - (4 * Math.PI / 3));

      const pwmU = signalU > carrierWave ? 1 : -1;
      const pwmV = signalV > carrierWave ? 1 : -1;
      const pwmW = signalW > carrierWave ? 1 : -1;

      const currentI1 = (2 * pwmU - pwmV - pwmW) / (3 * this.R);
      outputChannel[i] = currentI1 * 0.1;
    }

    if (globalThis.currentTime - this.lastWaveformUpdateTime > 0.016) {
      const lastSampleIndex = outputChannel.length - 1;
      const currentSignalFreq = signalFreq.length > 1 ? signalFreq[lastSampleIndex] : signalFreq[0];
      const signalIncrement = (2 * Math.PI * currentSignalFreq) / sampleRate;
      const lastSignalPhase = this.signalPhase + signalIncrement * lastSampleIndex;

      const signalU = Math.sin(lastSignalPhase);
      const signalV = Math.sin(lastSignalPhase - (2 * Math.PI / 3));
      const signalW = Math.sin(lastSignalPhase - (4 * Math.PI / 3));
      const carrierWave = (2 / Math.PI) * Math.asin(Math.sin(this.carrierPhase + carrierIncrement * lastSampleIndex));
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
        },
      });
      this.lastWaveformUpdateTime = globalThis.currentTime;
    }

    return true;
  }
}

registerProcessor("pwm-processor", PwmProcessor);
