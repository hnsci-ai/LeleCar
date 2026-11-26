export const CARS = [
  {
    id: 'ferrari-458',
    name: 'FERRARI 458 ITALIA',
    subtitle: '4.5L NA V8 • 9000 RPM • RWD • 7-Speed F1 DCT',
    color: '#d61522',
    accent: '#ffd000',
    glow: '#ff2035',
    style: 'gt',
    stats: {
      topSpeed: 89,
      accel: 88,
      handling: 92,
      nitro: 86
    },
    physics: {
      // Legacy/summary values
      maxSpeed: 92,        // ~331 km/h natural top speed (m/s)
      nitroPower: 1.32,
      nitroCapacity: 100,

      // Chassis & Drivetrain
      mass: 1485,
      drivetrain: 'RWD',
      awdFrontBias: 0.0,
      weightFront: 0.42,
      wheelbase: 2.65,
      cgHeight: 0.44,
      yawInertiaScale: 0.24,

      // Engine & 7-Speed DCT Gearbox
      engine: {
        soundProfile: 'v8_na',
        hasTurbo: false,
        idleRpm: 1150,
        redlineRpm: 9000,
        shiftUpRpm: 8780,
        shiftDownRpm: 4600,
        peakTorque: 610, // Nm (slightly energized for exhilarating 1.5x expressway scale)
        engineBrake: 165,
        // [rpmNormalized (0..1), torqueFactor]
        torqueCurve: [
          [0.00, 0.56],
          [0.25, 0.76],
          [0.55, 0.94],
          [0.78, 1.00],
          [0.94, 0.96],
          [1.00, 0.88]
        ]
      },
      transmission: {
        // 7-speed close-ratio F1 DCT (1st ~84, 2nd ~130, 3rd ~177, 4th ~226, 5th ~278, 6th ~336, 7th ~402 km/h theoretical)
        gears: [3.95, 2.58, 1.90, 1.48, 1.20, 0.99, 0.83],
        reverseRatio: 3.55,
        finalDrive: 3.46,
        wheelRadius: 0.345,
        shiftTime: 0.075,
        shiftKick: 0.85
      },

      // Aerodynamics
      aero: {
        dragCoeff: 0.49,
        downforceFront: 0.72,
        downforceRear: 1.05
      },

      // Tires & Handling
      tires: {
        frontGrip: 1.54,
        rearGrip: 1.58,
        corneringStiffnessF: 9.8,
        corneringStiffnessR: 10.2,
        peakSlipAngle: 0.165,
        slideGripRatio: 0.86,
        handbrakeRearGrip: 0.42,
        driftBalance: 1.00
      },

      // Carbon-Ceramic Brakes
      brakes: {
        maxBrakeForce: 26500,
        brakeBiasFront: 0.63
      }
    }
  },
  {
    id: 'lamborghini-aventador',
    name: 'LAMBORGHINI AVENTADOR',
    subtitle: '6.5L NA V12 • 8500 RPM • AWD • 7-Speed ISR',
    color: '#0a84ff',
    accent: '#00e5ff',
    glow: '#00b4ff',
    style: 'hyper',
    stats: {
      topSpeed: 98,
      accel: 91,
      handling: 83,
      nitro: 93
    },
    physics: {
      maxSpeed: 98,        // ~353 km/h natural top speed
      nitroPower: 1.36,
      nitroCapacity: 110,

      mass: 1625,
      drivetrain: 'AWD',
      awdFrontBias: 0.32,
      weightFront: 0.43,
      wheelbase: 2.70,
      cgHeight: 0.43,
      yawInertiaScale: 0.26,

      engine: {
        soundProfile: 'v12_na',
        hasTurbo: false,
        idleRpm: 1000,
        redlineRpm: 8500,
        shiftUpRpm: 8300,
        shiftDownRpm: 4200,
        peakTorque: 765,
        engineBrake: 185,
        torqueCurve: [
          [0.00, 0.62],
          [0.25, 0.82],
          [0.55, 0.96],
          [0.75, 1.00],
          [0.93, 0.97],
          [1.00, 0.90]
        ]
      },
      transmission: {
        gears: [3.91, 2.44, 1.81, 1.41, 1.14, 0.94, 0.78],
        reverseRatio: 3.40,
        finalDrive: 3.22,
        wheelRadius: 0.352,
        shiftTime: 0.11,   // Dramatic ISR mechanical kick!
        shiftKick: 1.25
      },

      aero: {
        dragCoeff: 0.45,
        downforceFront: 0.65,
        downforceRear: 0.98
      },

      tires: {
        frontGrip: 1.48,
        rearGrip: 1.56,
        corneringStiffnessF: 9.0,
        corneringStiffnessR: 10.0,
        peakSlipAngle: 0.175,
        slideGripRatio: 0.85,
        handbrakeRearGrip: 0.44,
        driftBalance: 0.92
      },

      brakes: {
        maxBrakeForce: 27800,
        brakeBiasFront: 0.65
      }
    }
  },
  {
    id: 'porsche-911-gt3rs',
    name: 'PORSCHE 911 GT3 RS',
    subtitle: '4.0L Flat-6 • 9000 RPM • RR Track • 7-Speed PDK',
    color: '#f5b800',
    accent: '#ffffff',
    glow: '#ffc400',
    style: 'track',
    stats: {
      topSpeed: 86,
      accel: 90,
      handling: 99,
      nitro: 88
    },
    physics: {
      maxSpeed: 89,        // ~320 km/h (high downforce wing trades top speed for insane cornering!)
      nitroPower: 1.31,
      nitroCapacity: 105,

      mass: 1430,
      drivetrain: 'RWD',
      awdFrontBias: 0.0,
      weightFront: 0.39,   // Classic 911 rear-engine traction + trail-brake turn-in!
      wheelbase: 2.46,
      cgHeight: 0.42,
      yawInertiaScale: 0.22,

      engine: {
        soundProfile: 'flat6_na',
        hasTurbo: false,
        idleRpm: 1050,
        redlineRpm: 9000,
        shiftUpRpm: 8820,
        shiftDownRpm: 4800,
        peakTorque: 575,
        engineBrake: 175,
        torqueCurve: [
          [0.00, 0.54],
          [0.25, 0.74],
          [0.55, 0.92],
          [0.80, 1.00],
          [0.95, 0.98],
          [1.00, 0.91]
        ]
      },
      transmission: {
        gears: [3.75, 2.52, 1.88, 1.47, 1.20, 1.00, 0.85],
        reverseRatio: 3.55,
        finalDrive: 3.68,
        wheelRadius: 0.342,
        shiftTime: 0.055,  // Lightning-quick Weissach PDK!
        shiftKick: 0.65
      },

      aero: {
        dragCoeff: 0.55,
        downforceFront: 1.18,
        downforceRear: 1.68
      },

      tires: {
        frontGrip: 1.66,
        rearGrip: 1.68,
        corneringStiffnessF: 11.4,
        corneringStiffnessR: 11.2,
        peakSlipAngle: 0.16,
        slideGripRatio: 0.89,
        handbrakeRearGrip: 0.40,
        driftBalance: 1.08
      },

      brakes: {
        maxBrakeForce: 28800,
        brakeBiasFront: 0.61
      }
    }
  },
  {
    id: 'mclaren-senna',
    name: 'MCLAREN SENNA',
    subtitle: '4.0L Twin-Turbo V8 • Active Aero • 7-Speed SSG',
    color: '#ff5500',
    accent: '#00f5d4',
    glow: '#ff6a00',
    style: 'wedge',
    stats: {
      topSpeed: 94,
      accel: 99,
      handling: 95,
      nitro: 91
    },
    physics: {
      maxSpeed: 95,        // ~342 km/h
      nitroPower: 1.34,
      nitroCapacity: 105,

      mass: 1310,
      drivetrain: 'RWD',
      awdFrontBias: 0.0,
      weightFront: 0.42,
      wheelbase: 2.67,
      cgHeight: 0.41,
      yawInertiaScale: 0.23,

      engine: {
        soundProfile: 'v8_tt',
        hasTurbo: true,
        idleRpm: 1100,
        redlineRpm: 8500,
        shiftUpRpm: 8280,
        shiftDownRpm: 4200,
        peakTorque: 760,
        engineBrake: 160,
        torqueCurve: [
          [0.00, 0.58],
          [0.22, 0.84],
          [0.42, 0.99],
          [0.72, 1.00],
          [0.92, 0.93],
          [1.00, 0.84]
        ]
      },
      transmission: {
        gears: [3.85, 2.52, 1.86, 1.44, 1.16, 0.96, 0.80],
        reverseRatio: 3.45,
        finalDrive: 3.30,
        wheelRadius: 0.345,
        shiftTime: 0.065,
        shiftKick: 0.90
      },

      aero: {
        dragCoeff: 0.54,
        downforceFront: 1.24,
        downforceRear: 1.82
      },

      tires: {
        frontGrip: 1.60,
        rearGrip: 1.62,
        corneringStiffnessF: 10.8,
        corneringStiffnessR: 10.6,
        peakSlipAngle: 0.162,
        slideGripRatio: 0.87,
        handbrakeRearGrip: 0.41,
        driftBalance: 1.04
      },

      brakes: {
        maxBrakeForce: 27400,
        brakeBiasFront: 0.62
      }
    }
  }
];

export const TRACKS = [
  {
    id: 'neon-harbor',
    name: 'TOKYO BAY EXPRESSWAY',
    subtitle: 'Twilight Coastal Highway • Fast Sweepers & Hairpin',
    theme: 'night',
    hdri: '/env/dusk.hdr',
    roadWidth: 22,
    defaultLaps: 3,
    skyTop: '#081224',
    skyMid: '#182b47',
    skyHorizon: '#c46a3c',
    fogColor: '#232b3a',
    fogDensity: 0.00050,
    ambientColor: '#7a94b8',
    sunColor: '#ffbe82',
    sunPos: [220, 145, -340],
    neonPrimary: '#ffaa44',
    neonSecondary: '#d8e4f0',
    waterLevel: -6,
    points: [
      [0, 0, 0],
      [0, 0, -140],
      [28, 3, -270],
      [115, 8, -340],
      [240, 12, -310],
      [330, 6, -210],
      [355, 2, -80],
      [290, 0, 45],
      [215, 5, 115],
      [265, 10, 225],
      [195, 6, 320],
      [75, 2, 310],
      [-25, 0, 220],
      [-15, 0, 115]
    ]
  },
  {
    id: 'alpine-dusk',
    name: 'ALPINE DUSK PASS',
    subtitle: 'Golden Hour Mountain • Elevation & Technical Esses',
    theme: 'sunset',
    hdri: '/env/sunset.hdr',
    roadWidth: 20,
    defaultLaps: 3,
    skyTop: '#161b3a',
    skyMid: '#7d3448',
    skyHorizon: '#ff7b3b',
    fogColor: '#482834',
    fogDensity: 0.00055,
    ambientColor: '#9c7166',
    sunColor: '#ffae5c',
    sunPos: [-280, 130, -280],
    neonPrimary: '#ffaa22',
    neonSecondary: '#ff4433',
    waterLevel: -18,
    points: [
      [0, 0, 0],
      [0, 2, -155],
      [-45, 10, -295],
      [-160, 22, -350],
      [-285, 28, -260],
      [-310, 18, -110],
      [-210, 10, -10],
      [-270, 16, 130],
      [-190, 24, 265],
      [-55, 14, 305],
      [65, 6, 230],
      [40, 2, 110]
    ]
  }
];

export const BOT_NAMES = [
  'KAZUKI',
  'VALENTINA',
  'DRIFT_KING',
  'NOVA_77',
  'VIPER_X',
  'SOLARIS',
  'RENEGADE'
];

export const RACE_STATES = {
  LOBBY: 'LOBBY',
  COUNTDOWN: 'COUNTDOWN',
  RACING: 'RACING',
  FINISHED: 'FINISHED'
};
