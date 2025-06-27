// =================================================================================
// 設定 (Config)
// =================================================================================

const trainSpecs = {
  西武6000系: {
    // 物理パラメータ
    physical: {
      POWER_LEVELS: 4,
      BRAKE_LEVELS: 7,
      MAX_SPEED: 120, // km/h
      MAX_FREQ: 120, // Hz
      DECEL_RATE_COAST: 0.3, // km/h/s (惰行)
      DECEL_RATE_MAX: 3.5, // km/h/s (B7)
      DECEL_RATE_EB: 4.5, // km/h/s (EB)
      ACCEL_RATE_MAX: 2.8, // km/h/s (P4時)
    },
    // 変調パターン
    modulationPatterns: {
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
    },
  },
  // 他の車種データをここに追加できます
  E231系500番台: {
    physical: {
      POWER_LEVELS: 5,
      BRAKE_LEVELS: 8,
      MAX_SPEED: 120,
      MAX_FREQ: 120,
      DECEL_RATE_COAST: 0.3,
      DECEL_RATE_MAX: 4.2,
      DECEL_RATE_EB: 4.5,
      ACCEL_RATE_MAX: 3.0,
    },
    modulationPatterns: {
      accel: [
        { from: 0, to: 3, type: "async", carrierFreq: 198 },
        { from: 3, to: 36, type: "async", carrierFreq: { from: 198, to: 880 } },
        { from: 36, to: 39, type: "async", carrierFreq: 880 },
        { from: 39, to: 52, type: "sync", pulse: 3 },
        { from: 52, to: "max", type: "sync", pulse: 1 },
      ],
      decel: [
        { from: 58, to: "max", type: "sync", pulse: 1 },
        { from: 50, to: 58, type: "sync", pulse: 3 },
        { from: 40, to: 50, type: "async", carrierFreq: 1000 },
        {
          from: 4,
          to: 40,
          type: "async",
          carrierFreq: { from: 1000, to: 169 },
        },
        { from: 0, to: 4, type: "async", carrierFreq: 169 },
      ],
    },
  },
};

const globalConfig = {
  // 初期状態
  initialState: {
    handlePosition: 0, // -8 (EB) to 4 (P4)
    currentSpeed: 0,
    isSimulating: false,
    volume: 1.0,
    lpfCutoff: 1500,
    reverbEnabled: true,
    selectedTrain: Object.keys(trainSpecs)[0], // 初期選択の車種
  },

  // UI設定 (Konva.js)
  ui: {
    stage: { width: 600, height: 400 },
    notch: {
      y_start: 40,
      y_step: 28,
      base_x: 70,
      base_width: 45,
      base_height: 22,
      special_width: 60,
      get special_x() {
        return this.base_x - (this.special_width - this.base_width) / 2;
      },
      colors: {
        default_bg: "#222",
        default_label: "#111",
        active_p: "#facc15",
        active_b: "#facc15",
        active_n: "#22c55e",
        active_eb: "#ef4444",
      },
    },
    speedometer: {
      value: {
        x: 300,
        y: 100,
        width: 220,
        height: 80,
        fontSize: 72,
        fill: "#22d3ee",
      },
      label: {
        x: 300,
        y: 180,
        width: 220,
        height: 40,
        fontSize: 28,
        fill: "#aaa",
      },
    },
  },
};
