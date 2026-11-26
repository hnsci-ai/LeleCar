import * as THREE from 'three';
import { CARS, TRACKS, RACE_STATES } from '../../shared/config.js';
import { SceneManager } from './engine/SceneManager.js';
import { Track } from './engine/TrackBuilder.js';
import { buildSupercar } from './engine/CarBuilder.js';
import { modelLoader } from './engine/ModelLoader.js';
import { CarController } from './engine/CarPhysics.js';
import { AudioEngine } from './engine/AudioEngine.js';
import { SkidMarks } from './engine/SkidMarks.js';
import { NetworkClient } from './net/NetworkClient.js';
import { HUD, formatTime } from './ui/HUD.js';

class ApexHorizonGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.sceneMgr = new SceneManager(this.canvas);
    this.audio = new AudioEngine();
    this.hud = new HUD();

    this.selectedCarId = CARS[0].id;
    this.playerName = `RACER_${Math.floor(100 + Math.random() * 899)}`;
    this.room = null;
    this.availableRooms = [];
    this.myId = null;

    // Showroom
    this.showroomCar = null;
    this.showroomAngle = 0;

    // Active Race state
    this.mode = 'showroom'; // 'showroom' | 'race'
    this.track = null;
    this.skidMarks = null;
    this.localCar = null;
    this.localCarMesh = null;
    this.localBots = new Map();     // host-simulated bots: id -> { ctrl, mesh, info }
    this.remoteRacers = new Map();  // remote players & peer-side bots: id -> { mesh, info, target, current }

    this.racePhase = RACE_STATES.LOBBY;
    this.countdownStartMs = 0;
    this.countdownDurationMs = 3600;
    this.lastCountdownDigit = -1;
    this.raceStartLocalMs = 0;
    this.lastLapObserved = 1;
    this.lastRankObserved = 99;
    this.sentFinish = false;

    // Camera & Dynamic Handling Feel State
    this.cameraModes = ['CHASE', 'HOOD', 'FAR'];
    this.cameraModeIndex = 0;
    this.camPos = new THREE.Vector3(0, 6, 12);
    this.camLook = new THREE.Vector3();
    this.camShake = 0;
    this.camChaseYaw = 0;
    this.camLongLag = 0;
    this.camRoll = 0;
    this.backfireTimer = 0;

    // Driver driving preferences (persisted across races)
    this.preferredTransMode = 'AT';
    this.preferredTcs = true;
    this._gpPrevLB = false;
    this._gpPrevRB = false;

    // Input state
    this.keys = {};
    this.netSendAccum = 0;

    this._initUI();
    this._initInput();
    this._fetchLanInfo();
    this._initNetwork();

    // Preload Blender GLB supercars & track props, then display showroom car
    modelLoader.preloadAll().then(() => {
      this._loadShowroomCar(this.selectedCarId);
    });

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _initUI() {
    const nameInput = document.getElementById('input-name');
    nameInput.value = this.playerName;

    // Populate Track dropdown
    const trackSelect = document.getElementById('select-track');
    TRACKS.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name}`;
      trackSelect.appendChild(opt);
    });

    // Populate Car Selector Cards
    const cardsEl = document.getElementById('car-cards');
    CARS.forEach((car) => {
      const div = document.createElement('div');
      div.className = `car-card ${car.id === this.selectedCarId ? 'active' : ''}`;
      div.dataset.carId = car.id;
      div.innerHTML = `
        <div class="car-swatch" style="background:${car.color}"></div>
        <div class="car-card-name">${car.name}</div>
      `;
      div.addEventListener('click', () => this._selectCar(car.id));
      cardsEl.appendChild(div);
    });
    this._updateCarStatsUI(CARS[0]);

    // Buttons
    document.getElementById('btn-copy-lan').addEventListener('click', async () => {
      const txt = document.getElementById('lan-url-text').textContent;
      try {
        await navigator.clipboard.writeText(txt);
        document.getElementById('btn-copy-lan').textContent = '已复制!';
        setTimeout(() => (document.getElementById('btn-copy-lan').textContent = '复制'), 1500);
      } catch {}
    });

    document.getElementById('btn-join-room').addEventListener('click', () => {
      this.audio.init();
      this.playerName = nameInput.value.trim() || this.playerName;
      const code = document.getElementById('input-room').value.trim() || 'LAN1';
      this.net.send({ type: 'join_room', code, name: this.playerName, carId: this.selectedCarId });
    });

    document.getElementById('btn-create-room').addEventListener('click', () => {
      this.audio.init();
      this.playerName = nameInput.value.trim() || this.playerName;
      this.net.send({ type: 'create_room', name: this.playerName, carId: this.selectedCarId });
    });

    document.getElementById('btn-leave-room').addEventListener('click', () => {
      this.net.send({ type: 'leave_room' });
      this.room = null;
      this._renderLobbyUI();
    });

    document.getElementById('btn-ready').addEventListener('click', () => {
      if (!this.room) return;
      const me = this.room.players.find((p) => p.id === this.myId);
      if (!me) return;
      this.net.send({ type: 'update_player', ready: !me.ready });
    });

    document.getElementById('btn-start-race').addEventListener('click', () => {
      this.audio.init();
      this.net.send({ type: 'start_race' });
    });

    document.getElementById('btn-join-live').addEventListener('click', () => {
      this.audio.init();
      this.net.send({ type: 'join_live_race' });
    });

    document.getElementById('btn-race-again').addEventListener('click', () => {
      this.audio.init();
      this.net.send({ type: 'start_race' });
    });

    document.getElementById('btn-back-lobby').addEventListener('click', () => {
      if (this.room && this.room.hostId === this.myId) {
        this.net.send({ type: 'return_lobby' });
      } else {
        this.net.send({ type: 'exit_race' });
        this._enterShowroom();
      }
    });

    document.getElementById('btn-exit-race').addEventListener('click', () => {
      if (this.mode !== 'race') return;
      this.net.send({ type: 'exit_race' });
      this._enterShowroom();
    });

    // Host Settings change
    const sendSettings = () => {
      if (!this.room || this.room.hostId !== this.myId) return;
      this.net.send({
        type: 'update_settings',
        trackId: trackSelect.value,
        laps: Number(document.getElementById('select-laps').value),
        botCount: Number(document.getElementById('select-bots').value)
      });
    };
    trackSelect.addEventListener('change', sendSettings);
    document.getElementById('select-laps').addEventListener('change', sendSettings);
    document.getElementById('select-bots').addEventListener('change', sendSettings);

    // Top bar toggles
    document.getElementById('btn-mute').addEventListener('click', () => {
      this.audio.init();
      const muted = this.audio.toggleMute();
      document.getElementById('btn-mute').textContent = muted ? 'SFX: OFF' : 'SFX: ON';
    });
    document.getElementById('btn-bgm').addEventListener('click', () => {
      this.audio.init();
      const on = this.audio.toggleBgm();
      document.getElementById('btn-bgm').textContent = on ? 'BGM: ON' : 'BGM: OFF';
    });
    document.getElementById('btn-cam').addEventListener('click', () => this._cycleCamera());
    document.getElementById('btn-trans').addEventListener('click', () => this._toggleTransmission());
    document.getElementById('btn-tcs').addEventListener('click', () => this._toggleTcs());
  }

  _toggleTransmission() {
    this.preferredTransMode = this.preferredTransMode === 'AT' ? 'MT' : 'AT';
    if (this.localCar) {
      this.localCar.transmissionMode = this.preferredTransMode;
      this.localCar.manualHoldTimer = 0;
    }
    this._syncDrivingAssistButtons();
    if (this.mode === 'race') {
      this.hud.showToast(
        this.preferredTransMode === 'MT' ? 'MANUAL SHIFT (Q/E) // 手动换挡' : 'SPORT AUTO // 智能运动自动挡',
        1500
      );
    }
  }

  _toggleTcs() {
    this.preferredTcs = !this.preferredTcs;
    if (this.localCar) {
      this.localCar.tcsEnabled = this.preferredTcs;
    }
    this._syncDrivingAssistButtons();
    if (this.mode === 'race') {
      this.hud.showToast(
        this.preferredTcs ? 'TCS: SPORT // 运动牵引力控制' : 'TCS: OFF // 关闭电控 (原始后驱打滑)',
        1500
      );
    }
  }

  _syncDrivingAssistButtons() {
    const transBtn = document.getElementById('btn-trans');
    const tcsBtn = document.getElementById('btn-tcs');
    if (transBtn) transBtn.textContent = `SHIFT: ${this.preferredTransMode}`;
    if (tcsBtn) tcsBtn.textContent = this.preferredTcs ? 'TCS: SPORT' : 'TCS: OFF';
  }

  _initInput() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const firstPress = !this.keys[e.code];
      this.keys[e.code] = true;
      if (e.code === 'KeyC' && this.mode === 'race') this._cycleCamera();
      if (e.code === 'KeyR' && this.mode === 'race' && this.localCar) this.localCar.resetToTrack();
      if (firstPress && e.code === 'KeyT' && this.mode === 'race') this._toggleTransmission();
      if (firstPress && e.code === 'KeyH' && this.mode === 'race') this._toggleTcs();
      if (firstPress && e.code === 'KeyE' && this.mode === 'race' && this.localCar && this.racePhase === RACE_STATES.RACING) {
        this.localCar.shiftUp();
      }
      if (firstPress && e.code === 'KeyQ' && this.mode === 'race' && this.localCar && this.racePhase === RACE_STATES.RACING) {
        this.localCar.shiftDown();
      }
      if (e.code === 'Escape' && this.mode === 'race') {
        this.net.send({ type: 'exit_race' });
        this._enterShowroom();
      }
      if (e.code === 'KeyM') {
        const muted = this.audio.toggleMute();
        document.getElementById('btn-mute').textContent = muted ? 'SFX: OFF' : 'SFX: ON';
      }
      if (e.code === 'KeyB') {
        const on = this.audio.toggleBgm();
        document.getElementById('btn-bgm').textContent = on ? 'BGM: ON' : 'BGM: OFF';
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  _readDrivingInput() {
    let throttle = (this.keys['KeyW'] || this.keys['ArrowUp']) ? 1 : 0;
    let brake = (this.keys['KeyS'] || this.keys['ArrowDown']) ? 1 : 0;
    let steer = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) steer += 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) steer -= 1;
    let handbrake = Boolean(this.keys['Space']);
    let nitro = Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.keys['KeyN']);

    // Optional Gamepad API support (Xbox / PlayStation controllers, including LB/RB shift paddles!)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[0];
    if (gp) {
      if (Math.abs(gp.axes[0]) > 0.10) {
        // Non-linear steering curve for fine analog precision near center
        const raw = -gp.axes[0];
        steer = Math.sign(raw) * Math.pow(Math.abs(raw), 1.35);
      }
      if (gp.buttons[7]?.value > 0.04) throttle = Math.max(throttle, gp.buttons[7].value);
      if (gp.buttons[6]?.value > 0.04) brake = Math.max(brake, gp.buttons[6].value);
      if (gp.buttons[0]?.pressed) handbrake = true;
      if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed) nitro = true;

      const lb = Boolean(gp.buttons[4]?.pressed);
      const rb = Boolean(gp.buttons[5]?.pressed);
      if (this.mode === 'race' && this.localCar && this.racePhase === RACE_STATES.RACING) {
        if (rb && !this._gpPrevRB) this.localCar.shiftUp();
        if (lb && !this._gpPrevLB) this.localCar.shiftDown();
      }
      this._gpPrevLB = lb;
      this._gpPrevRB = rb;
    }

    return { throttle, brake, steer, handbrake, nitro };
  }

  _cycleCamera() {
    this.cameraModeIndex = (this.cameraModeIndex + 1) % this.cameraModes.length;
    document.getElementById('btn-cam').textContent = `CAM: ${this.cameraModes[this.cameraModeIndex]}`;
  }

  async _fetchLanInfo() {
    try {
      const res = await fetch('/api/info');
      const data = await res.json();
      const urlEl = document.getElementById('lan-url-text');
      if (data.lan && data.lan.length > 0) {
        urlEl.textContent = data.lan[0].url;
      } else {
        urlEl.textContent = window.location.origin;
      }
    } catch {
      document.getElementById('lan-url-text').textContent = window.location.origin;
    }
  }

  _initNetwork() {
    this.net = new NetworkClient({
      onPing: (ms) => {
        document.getElementById('ping-badge').classList.remove('hidden');
        document.getElementById('ping-val').textContent = ms;
      },
      onMessage: (msg) => this._handleNetworkMessage(msg)
    });
    this.net.connect();
  }

  _handleNetworkMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this.myId = msg.id;
        this.availableRooms = msg.rooms || [];
        this._renderRoomList();
        break;
      case 'room_list':
        this.availableRooms = msg.rooms || [];
        this._renderRoomList();
        break;
      case 'joined_room':
        this.myId = msg.playerId;
        this.room = msg.room;
        this._renderLobbyUI();
        break;
      case 'room_update':
        this.room = msg.room;
        if (this.mode === 'showroom') {
          this._renderLobbyUI();
        } else if (this.racePhase === RACE_STATES.FINISHED || this.sentFinish) {
          this._renderPodiumUI();
        }
        break;
      case 'race_countdown':
        this.room = msg.room;
        this._startRaceScene(msg.durationMs || 3600, false);
        break;
      case 'enter_live_race':
        this.room = msg.room;
        this._startRaceScene(0, true, msg.raceElapsedMs || 0);
        break;
      case 'player_joined_live':
        this.room = msg.room;
        if (this.mode === 'race' && msg.player && msg.player.id !== this.myId && !this.remoteRacers.has(msg.player.id)) {
          const carCfg = CARS.find((c) => c.id === msg.player.carId) || CARS[0];
          const spawn = this.track.getStartGridTransform(msg.player.gridIndex || 0);
          const mesh = buildSupercar(carCfg, false, msg.player.name, false);
          mesh.root.position.copy(spawn.position);
          mesh.root.rotation.y = spawn.yaw;
          this.sceneMgr.raceGroup.add(mesh.root);
          this.remoteRacers.set(msg.player.id, {
            mesh,
            info: { id: msg.player.id, name: msg.player.name, isBot: false },
            target: { x: spawn.position.x, y: spawn.position.y, z: spawn.position.z, yaw: spawn.yaw, pitch: 0, speed: 0, steer: 0, drift: 0, braking: false, nitro: false, lap: 1, progress: -0.05 },
            current: { x: spawn.position.x, y: spawn.position.y, z: spawn.position.z, yaw: spawn.yaw, pitch: 0 }
          });
          this.hud.showToast(`${msg.player.name} 加入了比赛!`, 1800);
        }
        break;
      case 'race_start':
        this.room = msg.room;
        this.racePhase = RACE_STATES.RACING;
        this.raceStartLocalMs = performance.now();
        if (this.localCar) {
          this.localCar.lapStartTime = 0;
          if (this.localCar.triggerPerfectLaunch()) {
            this.hud.showToast('PERFECT LAUNCH! // 弹射起步', 2000);
            this.audio.playBoostSurge();
            this.camShake = 0.35;
          }
        }
        this.track?.setCountdownLights(5, true);
        this.hud.setCountdown('GO!', false);
        this.audio.playCountdownBeep(true);
        setTimeout(() => this.hud.setCountdown(null), 900);
        break;
      case 'remote_state':
        this._applyRemoteState(msg.id, msg.state);
        break;
      case 'remote_bots':
        if (Array.isArray(msg.bots)) {
          for (const b of msg.bots) this._applyRemoteState(b.id, b.state);
        }
        break;
      case 'collision_bump':
        if (this.localCar) {
          this.localCar.applyExternalImpulse(msg.ix, msg.iz);
          this.camShake = Math.max(this.camShake, 0.55);
          this.audio.playCollision(0.7);
        }
        break;
      case 'player_left':
        this._removeRemoteRacer(msg.playerId);
        break;
      case 'race_finished':
        this.room = msg.room;
        this.racePhase = RACE_STATES.FINISHED;
        this._showFinishOverlay();
        break;
      case 'returned_lobby':
        this.room = msg.room;
        this._enterShowroom();
        break;
      case 'error':
        alert(msg.message);
        break;
    }
  }

  _selectCar(carId) {
    this.selectedCarId = carId;
    const carCfg = CARS.find((c) => c.id === carId) || CARS[0];
    document.querySelectorAll('.car-card').forEach((el) => {
      el.classList.toggle('active', el.dataset.carId === carId);
    });
    this._updateCarStatsUI(carCfg);
    this._loadShowroomCar(carId);
    if (this.room) {
      this.net.send({ type: 'update_player', carId });
    }
  }

  _updateCarStatsUI(car) {
    document.getElementById('car-name').textContent = car.name;
    document.getElementById('car-subtitle').textContent = car.subtitle;
    document.getElementById('stat-speed').style.width = `${car.stats.topSpeed}%`;
    document.getElementById('stat-accel').style.width = `${car.stats.accel}%`;
    document.getElementById('stat-handling').style.width = `${car.stats.handling}%`;
    document.getElementById('stat-nitro').style.width = `${car.stats.nitro}%`;
  }

  _loadShowroomCar(carId) {
    if (this.showroomCar) {
      this.sceneMgr.showroomGroup.remove(this.showroomCar.root);
    }
    const cfg = CARS.find((c) => c.id === carId) || CARS[0];
    this.showroomCar = buildSupercar(cfg, false, null, false, true);
    this.showroomCar.root.position.set(0, 0.02, 0);
    this.sceneMgr.showroomGroup.add(this.showroomCar.root);
  }

  _renderRoomList() {
    const el = document.getElementById('active-rooms-list');
    if (!el) return;
    if (!this.availableRooms || this.availableRooms.length === 0) {
      el.innerHTML = '<div class="muted" style="font-size:12px">暂无房间，点击上方新建或加入 LAN1</div>';
      return;
    }
    el.innerHTML = '';
    for (const r of this.availableRooms) {
      const row = document.createElement('div');
      row.className = 'active-room-row';
      const statusText = r.state === RACE_STATES.RACING ? '比赛中' : (r.state === RACE_STATES.COUNTDOWN ? '发车中' : '组队中');
      const badgeCls = r.state === RACE_STATES.RACING ? 'badge-racing' : 'badge-ready';
      row.innerHTML = `
        <div>
          <strong class="accent-text">${r.code}</strong>
          <span class="muted" style="margin-left:6px">${r.players}/8人</span>
          <span class="player-badge ${badgeCls}">${statusText}</span>
        </div>
        <button class="small-btn">一键加入</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        this.audio.init();
        const nameInput = document.getElementById('input-name');
        this.playerName = nameInput.value.trim() || this.playerName;
        document.getElementById('input-room').value = r.code;
        this.net.send({ type: 'join_room', code: r.code, name: this.playerName, carId: this.selectedCarId });
      });
      el.appendChild(row);
    }
  }

  _renderLobbyUI() {
    const joinSec = document.getElementById('join-section');
    const lobbySec = document.getElementById('lobby-section');
    if (!this.room) {
      joinSec.classList.remove('hidden');
      lobbySec.classList.add('hidden');
      this._renderRoomList();
      return;
    }
    joinSec.classList.add('hidden');
    lobbySec.classList.remove('hidden');

    document.getElementById('lobby-room-code').textContent = this.room.code;
    document.getElementById('player-count').textContent = this.room.players.length;

    const stateBadge = document.getElementById('lobby-state-badge');
    const isLive = this.room.state === RACE_STATES.RACING || this.room.state === RACE_STATES.COUNTDOWN;
    stateBadge.textContent = isLive ? 'RACING' : 'LOBBY';
    stateBadge.className = `player-badge ${isLive ? 'badge-racing' : 'badge-ready'}`;

    const isHost = this.room.hostId === this.myId;
    const hostPlayer = this.room.players.find((p) => p.id === this.room.hostId);
    const trackSel = document.getElementById('select-track');
    const lapsSel = document.getElementById('select-laps');
    const botsSel = document.getElementById('select-bots');

    trackSel.value = this.room.trackId;
    lapsSel.value = String(this.room.laps);
    botsSel.value = String(this.room.botCount);
    trackSel.disabled = !isHost;
    lapsSel.disabled = !isHost;
    botsSel.disabled = !isHost;

    const listEl = document.getElementById('player-list');
    listEl.innerHTML = '';
    for (const p of this.room.players) {
      const car = CARS.find((c) => c.id === p.carId) || CARS[0];
      const row = document.createElement('div');
      row.className = `player-row ${p.id === this.myId ? 'me' : ''}`;
      const statusBadge = p.inRace
        ? '<span class="player-badge badge-racing">RACING</span>'
        : `<span class="player-badge ${p.ready ? 'badge-ready' : 'badge-wait'}">${p.ready ? 'READY' : 'WAITING'}</span>`;
      row.innerHTML = `
        <div>
          <strong>${p.name}</strong>
          ${p.isHost ? '<span class="player-badge badge-host">HOST</span>' : ''}
          <div class="muted" style="font-size:11px">${car.name}${p.ping ? ` • ${p.ping}ms` : ''}</div>
        </div>
        ${statusBadge}
      `;
      listEl.appendChild(row);
    }

    const startBtn = document.getElementById('btn-start-race');
    const readyBtn = document.getElementById('btn-ready');
    const joinLiveBtn = document.getElementById('btn-join-live');
    const statusBanner = document.getElementById('lobby-status-banner');

    const readyCount = this.room.players.filter((p) => p.ready).length;
    if (isLive) {
      joinLiveBtn.classList.remove('hidden');
      startBtn.classList.toggle('hidden', !isHost);
      startBtn.textContent = '重新发车 / RESTART ALL';
      readyBtn.classList.add('hidden');
      statusBanner.textContent = isHost
        ? '房间正在比赛中：你可以立即切入比赛，或点击「重新发车」带全队开新局'
        : '比赛正在进行中！点击下方「立即切入比赛」即可马上加入赛道';
    } else {
      joinLiveBtn.classList.add('hidden');
      startBtn.classList.toggle('hidden', !isHost);
      startBtn.textContent = `开始比赛 / START RACE (${readyCount}/${this.room.players.length})`;
      readyBtn.classList.toggle('hidden', isHost);
      const me = this.room.players.find((p) => p.id === this.myId);
      readyBtn.textContent = me?.ready ? '取消准备 / UNREADY' : '准备 / READY';
      statusBanner.textContent = isHost
        ? `你是房主（已准备 ${readyCount}/${this.room.players.length}）— 选好赛道即可随时发车！`
        : `已组队！等待房主 ${hostPlayer?.name || 'HOST'} 点击开始比赛...`;
    }
  }

  _clearRaceWorld() {
    while (this.sceneMgr.raceGroup.children.length > 0) {
      this.sceneMgr.raceGroup.remove(this.sceneMgr.raceGroup.children[0]);
    }
    this.localBots.clear();
    this.remoteRacers.clear();
    this.localCar = null;
    this.localCarMesh = null;
    this.track = null;
    this.skidMarks = null;
  }

  _enterShowroom() {
    this._clearRaceWorld();
    this.mode = 'showroom';
    this.racePhase = RACE_STATES.LOBBY;
    this.sceneMgr.setMode('showroom');
    this.hud.setVisible(false);
    this.hud.setCountdown(null);
    document.getElementById('finish-overlay').classList.add('hidden');
    document.getElementById('menu-overlay').classList.remove('hidden');
    document.getElementById('btn-cam').classList.add('hidden');
    document.getElementById('btn-trans').classList.add('hidden');
    document.getElementById('btn-tcs').classList.add('hidden');
    document.getElementById('btn-exit-race').classList.add('hidden');
    document.getElementById('speed-vignette').style.opacity = '0';
    this.audio.updateEngine({ active: false, rpm: 0, speed: 0, gear: 1, drifting: false, nitro: false });
    this._renderLobbyUI();
  }

  _startRaceScene(countdownMs, joinLive = false, elapsedMs = 0) {
    this._clearRaceWorld();
    this.mode = 'race';
    this.racePhase = joinLive ? RACE_STATES.RACING : RACE_STATES.COUNTDOWN;
    this.countdownStartMs = performance.now();
    this.countdownDurationMs = countdownMs;
    this.raceStartLocalMs = joinLive ? (performance.now() - elapsedMs) : 0;
    this.lastCountdownDigit = -1;
    this.sentFinish = false;
    this.lastLapObserved = 1;
    this.lastRankObserved = 99;
    this.backfireTimer = 0;
    this.camLongLag = 0;
    this.camRoll = 0;

    const trackCfg = TRACKS.find((t) => t.id === this.room.trackId) || TRACKS[0];
    this.track = new Track(trackCfg);
    this.sceneMgr.raceGroup.add(this.track.group);
    this.sceneMgr.applyTrackAtmosphere(trackCfg);
    this.sceneMgr.setMode('race');

    this.skidMarks = new SkidMarks(this.sceneMgr.raceGroup);
    this.hud.prepareTrackMinimap(this.track);

    const isHost = this.room.hostId === this.myId;

    // Spawn all human players
    for (const p of this.room.players) {
      const carCfg = CARS.find((c) => c.id === p.carId) || CARS[0];
      const spawn = this.track.getStartGridTransform(p.gridIndex);
      const isMe = p.id === this.myId;
      const mesh = buildSupercar(carCfg, isMe, isMe ? null : p.name, false);
      mesh.root.position.copy(spawn.position);
      mesh.root.rotation.y = spawn.yaw;
      this.sceneMgr.raceGroup.add(mesh.root);

      if (p.id === this.myId) {
        this.localCar = new CarController(carCfg, this.track, spawn, false);
        this.localCar.transmissionMode = this.preferredTransMode;
        this.localCar.tcsEnabled = this.preferredTcs;
        this.localCarMesh = mesh;
        this.audio.setCarProfile(carCfg);
      } else {
        this.remoteRacers.set(p.id, {
          mesh,
          info: { id: p.id, name: p.name, isBot: false },
          target: { x: spawn.position.x, y: spawn.position.y, z: spawn.position.z, yaw: spawn.yaw, pitch: 0, speed: 0, steer: 0, drift: 0, latG: 0, longG: 0, braking: false, nitro: false, lap: 1, progress: -0.05 },
          current: { x: spawn.position.x, y: spawn.position.y, z: spawn.position.z, yaw: spawn.yaw, pitch: 0 }
        });
      }
    }

    // Spawn AI bots (Host simulates them physically; peers interpolate them from host broadcasts)
    for (const b of this.room.bots || []) {
      const carCfg = CARS.find((c) => c.id === b.carId) || CARS[0];
      const spawn = this.track.getStartGridTransform(b.gridIndex);
      const mesh = buildSupercar(carCfg, false, b.name, true);
      mesh.root.position.copy(spawn.position);
      mesh.root.rotation.y = spawn.yaw;
      this.sceneMgr.raceGroup.add(mesh.root);

      if (isHost) {
        const ctrl = new CarController(carCfg, this.track, spawn, true, b.skill);
        this.localBots.set(b.id, { ctrl, mesh, info: { id: b.id, name: b.name, isBot: true } });
      } else {
        this.remoteRacers.set(b.id, {
          mesh,
          info: { id: b.id, name: b.name, isBot: true },
          target: { x: spawn.position.x, y: spawn.position.y, z: spawn.position.z, yaw: spawn.yaw, pitch: 0, speed: 0, steer: 0, drift: 0, latG: 0, longG: 0, braking: false, nitro: false, lap: 1, progress: -0.05 },
          current: { x: spawn.position.x, y: spawn.position.y, z: spawn.position.z, yaw: spawn.yaw, pitch: 0 }
        });
      }
    }

    // Snap camera immediately behind player car
    if (this.localCar) {
      this.camChaseYaw = this.localCar.yaw;
      const back = new THREE.Vector3(-Math.sin(this.localCar.yaw), 0, -Math.cos(this.localCar.yaw));
      this.camPos.copy(this.localCar.position).addScaledVector(back, 10.5).add(new THREE.Vector3(0, 4.2, 0));
      this.camLook.copy(this.localCar.position).add(new THREE.Vector3(0, 1.4, 0));
    }

    document.getElementById('menu-overlay').classList.add('hidden');
    document.getElementById('finish-overlay').classList.add('hidden');
    document.getElementById('btn-cam').classList.remove('hidden');
    document.getElementById('btn-trans').classList.remove('hidden');
    document.getElementById('btn-tcs').classList.remove('hidden');
    document.getElementById('btn-exit-race').classList.remove('hidden');
    this._syncDrivingAssistButtons();
    this.hud.setVisible(true);
    if (joinLive) {
      this.track?.setCountdownLights(5, true);
      this.hud.setCountdown(null);
      this.hud.showToast('JOINED LIVE RACE! // 切入赛场', 1800);
    }
    this.audio.init();
  }

  _applyRemoteState(id, state) {
    const r = this.remoteRacers.get(id);
    if (!r || !state) return;
    r.target = state;
  }

  _removeRemoteRacer(id) {
    const r = this.remoteRacers.get(id);
    if (!r) return;
    this.sceneMgr.raceGroup.remove(r.mesh.root);
    this.remoteRacers.delete(id);
  }

  _showFinishOverlay() {
    document.getElementById('finish-overlay').classList.remove('hidden');
    this._renderPodiumUI();
  }

  _renderPodiumUI() {
    if (!this.room) return;
    const isHost = this.room.hostId === this.myId;
    document.getElementById('btn-race-again').classList.toggle('hidden', !isHost);

    const rows = [];
    for (const p of this.room.players) {
      rows.push({
        id: p.id,
        name: p.name,
        finished: p.finished,
        finishTime: p.finishTime,
        bestLap: p.bestLap,
        progress: p.progress
      });
    }
    for (const [, bot] of this.localBots) {
      rows.push({
        id: bot.info.id,
        name: `${bot.info.name} (AI)`,
        finished: bot.ctrl.finished,
        finishTime: bot.ctrl.finishTime,
        bestLap: bot.ctrl.bestLap,
        progress: bot.ctrl.totalProgress
      });
    }
    // Also show AI bots for non-host peers on the podium!
    for (const [, r] of this.remoteRacers) {
      if (r.info.isBot) {
        rows.push({
          id: r.info.id,
          name: `${r.info.name} (AI)`,
          finished: Boolean(r.target?.finished),
          finishTime: 0,
          bestLap: 0,
          progress: r.target?.progress || 0
        });
      }
    }

    rows.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });

    const myRank = rows.findIndex((r) => r.id === this.myId) + 1;
    document.getElementById('finish-headline').textContent = myRank === 1 ? 'VICTORY // P1' : `FINISHED P${myRank || 1}`;

    const list = document.getElementById('podium-list');
    list.innerHTML = rows.map((r, i) => `
      <div class="podium-row ${i === 0 ? 'first' : ''} ${r.id === this.myId ? 'me' : ''}">
        <span>#${i + 1} ${r.name}</span>
        <span class="mono">${r.finished ? formatTime(r.finishTime) : 'RACING...'}</span>
      </div>
    `).join('');
  }

  _resolveCarCollisions() {
    if (!this.localCar || this.racePhase !== RACE_STATES.RACING) return;
    const minDist = 2.8;
    const p1 = this.localCar.position;

    const checkOther = (otherPos, otherId, isRemoteHuman, botCtrl = null) => {
      const dx = p1.x - otherPos.x;
      const dz = p1.z - otherPos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < minDist) {
        const nx = dx / d;
        const nz = dz / d;
        const overlap = (minDist - d) * 0.55;
        p1.x += nx * overlap;
        p1.z += nz * overlap;
        this.localCar.velocity.x += nx * 10;
        this.localCar.velocity.z += nz * 10;
        this.camShake = Math.max(this.camShake, 0.45);
        this.audio.playCollision(0.6);

        // Collision sparks!
        for (let k = 0; k < 10; k++) {
          this.sceneMgr.spawnParticle(
            (p1.x + otherPos.x) * 0.5,
            p1.y + 0.7,
            (p1.z + otherPos.z) * 0.5,
            (Math.random() - 0.5) * 18,
            3 + Math.random() * 7,
            (Math.random() - 0.5) * 18,
            1.0, 0.75, 0.25,
            0.35, 16
          );
        }

        if (isRemoteHuman) {
          this.net.send({ type: 'collision_bump', targetId: otherId, ix: -nx * 10, iz: -nz * 10 });
        } else if (botCtrl) {
          botCtrl.applyExternalImpulse(-nx * 10, -nz * 10);
        }
      }
    };

    for (const [id, r] of this.remoteRacers) {
      checkOther({ x: r.current.x, z: r.current.z }, id, !r.info.isBot);
    }
    for (const [id, b] of this.localBots) {
      checkOther(b.ctrl.position, id, false, b.ctrl);
    }
  }

  _updateRace(dt, now) {
    if (!this.localCar || !this.track) return;

    // Countdown updates
    if (this.racePhase === RACE_STATES.COUNTDOWN) {
      const elapsed = now - this.countdownStartMs;
      const remaining = Math.max(0, this.countdownDurationMs - elapsed);
      const digit = Math.ceil(remaining / 1000);
      if (digit !== this.lastCountdownDigit && digit >= 1 && digit <= 3) {
        this.lastCountdownDigit = digit;
        this.hud.setCountdown(String(digit), true);
        this.track.setCountdownLights(4 - digit, false);
        this.audio.playCountdownBeep(false);
      }
    }

    const canMove = this.racePhase === RACE_STATES.RACING;
    const raceTimeMs = canMove ? (now - this.raceStartLocalMs) : 0;
    const totalLaps = this.room?.laps || 3;

    // Detect Slipstream / Drafting behind any rival car (< 28m directly ahead!)
    let inSlipstream = false;
    if (canMove && this.localCar.speed > 36) {
      const fwdX = Math.sin(this.localCar.yaw);
      const fwdZ = Math.cos(this.localCar.yaw);
      const checkDraft = (ox, oz) => {
        const dx = ox - this.localCar.position.x;
        const dz = oz - this.localCar.position.z;
        const along = dx * fwdX + dz * fwdZ;
        if (along > 5 && along < 28) {
          const perp = Math.abs(dx * fwdZ - dz * fwdX);
          if (perp < 3.4) return true;
        }
        return false;
      };
      for (const [, b] of this.localBots) {
        if (checkDraft(b.ctrl.position.x, b.ctrl.position.z)) inSlipstream = true;
      }
      for (const [, r] of this.remoteRacers) {
        if (checkDraft(r.current.x, r.current.z)) inSlipstream = true;
      }
    }

    // Update Local Player Car
    const input = this._readDrivingInput();
    this.localCar.update(dt, input, canMove, raceTimeMs, totalLaps, { slipstream: inSlipstream });

    // Drift-Exit Boost, Upshift Backfire & Downshift Rev-Match Exhaust Crackle!
    if (this.localCar.justTriggeredDriftBoost) {
      this.hud.showToast('DRIFT BOOST!', 1300);
      this.audio.playBoostSurge();
      this.camShake = Math.max(this.camShake, 0.20);
    }
    this.backfireTimer = Math.max(0, this.backfireTimer - dt);
    if (this.localCar.justUpshifted || this.localCar.justDownshifted) {
      this.backfireTimer = this.localCar.justUpshifted ? 0.14 : 0.11;
      const backX = -Math.sin(this.localCar.yaw) * 2.45;
      const backZ = -Math.cos(this.localCar.yaw) * 2.45;
      const count = this.localCar.justUpshifted ? 7 : 5;
      for (let k = 0; k < count; k++) {
        this.sceneMgr.spawnParticle(
          this.localCar.position.x + backX + (Math.random() - 0.5) * 0.4,
          this.localCar.position.y + 0.36,
          this.localCar.position.z + backZ + (Math.random() - 0.5) * 0.4,
          backX * 3.8 + (Math.random() - 0.5) * 3.5,
          1.0 + Math.random() * 1.8,
          backZ * 3.8 + (Math.random() - 0.5) * 3.5,
          1.0, this.localCar.justUpshifted ? 0.62 : 0.48, 0.18,
          0.20, 6
        );
      }
    }

    // Sync local mesh (car.yaw IS the real physical chassis angle including true drift slip!)
    this.localCarMesh.root.position.copy(this.localCar.position);
    this.localCarMesh.root.rotation.order = 'YXZ';
    this.localCarMesh.root.rotation.y = this.localCar.yaw;
    this.localCarMesh.root.rotation.x = this.localCar.pitch;
    this.localCarMesh.setVisualState({
      speed: this.localCar.speed,
      frontWheelSpeed: this.localCar.frontWheelSpeed,
      rearWheelSpeed: this.localCar.rearWheelSpeed,
      steer: this.localCar.visualSteer,
      braking: this.localCar.braking,
      nitro: this.localCar.nitroActive,
      driftAngle: this.localCar.driftAngle,
      latG: this.localCar.latG,
      longG: this.localCar.longG,
      shiftKick: this.localCar.shiftKickPulse,
      kerbRumble: this.localCar.kerbRumble,
      backfire: this.backfireTimer / 0.14,
      dt
    });

    // Lap chime, Final Lap / Best Lap toasts & Finish notification
    if (this.localCar.lap > this.lastLapObserved) {
      this.lastLapObserved = this.localCar.lap;
      this.audio.playLapChime();
      if (this.localCar.lap === totalLaps) {
        this.hud.showToast('FINAL LAP! // 最后一圈', 2200);
      } else if (this.localCar.justSetBestLap) {
        this.hud.showToast(`BEST LAP ${formatTime(this.localCar.bestLap)}`, 2000);
      }
    }
    if (this.localCar.finished && !this.sentFinish) {
      this.sentFinish = true;
      this.audio.playLapChime();
      this.net.send({
        type: 'player_finished',
        finishTime: this.localCar.finishTime,
        bestLap: this.localCar.bestLap
      });
      this._showFinishOverlay();
    }

    // Authentic Velocity-Aligned Skidmarks & Wheel-Patch Tire Smoke (Rear Slip, Burnout & Front Scrub!)
    const absSpd = Math.abs(this.localCar.speed);
    const velYaw = absSpd > 2.5
      ? Math.atan2(this.localCar.velocity.x, this.localCar.velocity.z)
      : this.localCar.yaw;
    const segLen = Math.max(0.85, absSpd * dt * 1.45);

    if (this.localCar.rearSlip > 0.42 && absSpd > 5.5) {
      const intensity = Math.min(1, (this.localCar.rearSlip - 0.35) / 0.60);
      this.skidMarks?.stampAxle(this.localCar.position, this.localCar.yaw, velYaw, -1.28, 0.90, segLen, intensity);

      if (this.localCar.rearSlip > 0.56 || this.localCar.wheelSpin > 0.25) {
        const fwdX = Math.sin(this.localCar.yaw);
        const fwdZ = Math.cos(this.localCar.yaw);
        const leftX = Math.cos(this.localCar.yaw);
        const leftZ = -Math.sin(this.localCar.yaw);
        const smokeCount = (this.localCar.drifting || this.localCar.wheelSpin > 0.45) ? 2 : 1;
        for (let wIdx = 0; wIdx < smokeCount; wIdx++) {
          const side = wIdx === 0 ? -0.90 : 0.90;
          const wx = this.localCar.position.x + leftX * side - fwdX * 1.28;
          const wz = this.localCar.position.z + leftZ * side - fwdZ * 1.28;
          this.sceneMgr.spawnParticle(
            wx + (Math.random() - 0.5) * 0.28,
            this.localCar.position.y + 0.20,
            wz + (Math.random() - 0.5) * 0.28,
            this.localCar.velocity.x * 0.14 + (Math.random() - 0.5) * 2.2,
            1.1 + Math.random() * 1.8,
            this.localCar.velocity.z * 0.14 + (Math.random() - 0.5) * 2.2,
            0.78, 0.82, 0.88,
            0.42 + intensity * 0.24, -1.3
          );
        }
      }
    }

    // Front tire scrub marks on heavy understeer or threshold ABS braking
    if ((this.localCar.frontSlip > 0.68 || this.localCar.absActive) && absSpd > 10) {
      const fIntensity = Math.min(0.85, Math.max(this.localCar.frontSlip - 0.45, this.localCar.absActive ? 0.55 : 0));
      this.skidMarks?.stampAxle(this.localCar.position, this.localCar.yaw, velYaw, 1.32, 0.88, segLen, fIntensity);
    }

    if (this.localCar.wallHitIntensity > 0.12) {
      this.camShake = Math.max(this.camShake, this.localCar.wallHitIntensity * 0.55);
      this.audio.playCollision(this.localCar.wallHitIntensity);
      for (let k = 0; k < 8; k++) {
        this.sceneMgr.spawnParticle(
          this.localCar.position.x,
          this.localCar.position.y + 0.6,
          this.localCar.position.z,
          (Math.random() - 0.5) * 20,
          3 + Math.random() * 7,
          (Math.random() - 0.5) * 20,
          1.0, 0.55, 0.15,
          0.32, 18
        );
      }
    }

    // Host updates local AI bots with competitive pack pacing
    for (const [, bot] of this.localBots) {
      bot.ctrl.update(dt, null, canMove, raceTimeMs, totalLaps, { leadHumanProgress: this.localCar.totalProgress });
      bot.mesh.root.position.copy(bot.ctrl.position);
      bot.mesh.root.rotation.order = 'YXZ';
      bot.mesh.root.rotation.y = bot.ctrl.yaw;
      bot.mesh.root.rotation.x = bot.ctrl.pitch;
      bot.mesh.setVisualState({
        speed: bot.ctrl.speed,
        frontWheelSpeed: bot.ctrl.frontWheelSpeed,
        rearWheelSpeed: bot.ctrl.rearWheelSpeed,
        steer: bot.ctrl.visualSteer,
        braking: bot.ctrl.braking,
        nitro: bot.ctrl.nitroActive,
        driftAngle: bot.ctrl.driftAngle,
        latG: bot.ctrl.latG,
        longG: bot.ctrl.longG,
        shiftKick: bot.ctrl.shiftKickPulse,
        kerbRumble: bot.ctrl.kerbRumble,
        dt
      });
    }

    // Smooth interpolation for remote players & peer-side bots
    const lerpFactor = Math.min(1, dt * 14);
    for (const [, r] of this.remoteRacers) {
      const t = r.target;
      const c = r.current;
      c.x = THREE.MathUtils.lerp(c.x, t.x, lerpFactor);
      c.y = THREE.MathUtils.lerp(c.y, t.y, lerpFactor);
      c.z = THREE.MathUtils.lerp(c.z, t.z, lerpFactor);
      // Shortest-angle yaw interpolation
      let dyaw = t.yaw - c.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      c.yaw += dyaw * lerpFactor;
      c.pitch = THREE.MathUtils.lerp(c.pitch, t.pitch || 0, lerpFactor);

      r.mesh.root.position.set(c.x, c.y, c.z);
      r.mesh.root.rotation.order = 'YXZ';
      r.mesh.root.rotation.y = c.yaw;
      r.mesh.root.rotation.x = c.pitch;
      r.mesh.setVisualState({
        speed: t.speed || 0,
        steer: t.steer || 0,
        braking: Boolean(t.braking),
        nitro: Boolean(t.nitro),
        driftAngle: t.drift || 0,
        latG: typeof t.latG === 'number' ? t.latG : null,
        longG: typeof t.longG === 'number' ? t.longG : null,
        dt
      });
    }

    this._resolveCarCollisions();

    // Broadcast local state at ~30Hz over LAN WebSocket
    this.netSendAccum += dt;
    if (this.netSendAccum >= 0.033) {
      this.netSendAccum = 0;
      this.net.send({ type: 'car_state', state: this.localCar.getNetworkState() });
      if (this.localBots.size > 0) {
        const botPayload = [];
        for (const [id, b] of this.localBots) {
          botPayload.push({ id, state: b.ctrl.getNetworkState() });
        }
        this.net.send({ type: 'bot_states', bots: botPayload });
      }
    }

    // Dynamic AAA Camera (Chase / Hood / Far) + velocity-lagged drift view + G-force feel
    this._updateRaceCamera(dt);

    // Rich Physics-Driven Audio & Particles & Shadow Follow
    const combinedSlip = Math.max(this.localCar.rearSlip, this.localCar.frontSlip * 0.82);
    this.audio.updateEngine({
      active: true,
      rpm: this.localCar.rpm,
      speed: this.localCar.speed,
      gear: this.localCar.gear,
      drifting: this.localCar.drifting,
      nitro: this.localCar.nitroActive,
      slipstream: this.localCar.slipstreamActive,
      throttle: this.localCar.throttleInput,
      slipIntensity: combinedSlip,
      turboBoost: this.localCar.turboBoost,
      kerbRumble: this.localCar.kerbRumble,
      shiftCut: this.localCar.shiftTimer > 0,
      revLimiter: this.localCar.revLimiterActive,
      justUpshifted: this.localCar.justUpshifted,
      justDownshifted: this.localCar.justDownshifted
    });
    this.sceneMgr.updateParticles(dt);
    this.sceneMgr.updateShadowFollow(this.localCar.position, this.track.config.sunPos);
    this.track.update(now * 0.001);
    this.sceneMgr.setPostFX(this.localCar.nitroActive ? 1.0 : 0.0, Math.min(1, Math.abs(this.localCar.speed) / 92));

    // Build live standings & minimap racer list
    const standings = [
      { id: this.myId, name: this.playerName, lap: this.localCar.lap, progress: this.localCar.totalProgress }
    ];
    const racers = [
      { id: this.myId, x: this.localCar.position.x, z: this.localCar.position.z, isBot: false }
    ];

    for (const [id, b] of this.localBots) {
      standings.push({ id, name: b.info.name, lap: b.ctrl.lap, progress: b.ctrl.totalProgress });
      racers.push({ id, x: b.ctrl.position.x, z: b.ctrl.position.z, isBot: true });
    }
    for (const [id, r] of this.remoteRacers) {
      standings.push({ id, name: r.info.name, lap: r.target.lap || 1, progress: r.target.progress || 0 });
      racers.push({ id, x: r.current.x, z: r.current.z, isBot: r.info.isBot });
    }
    standings.sort((a, b) => b.progress - a.progress);

    // Overtake detection!
    const currentRank = standings.findIndex((r) => r.id === this.myId) + 1;
    if (canMove && raceTimeMs > 2500 && currentRank > 0 && currentRank < this.lastRankObserved) {
      this.audio.playOvertakeChime();
      this.hud.showToast(`OVERTAKE! P${currentRank}`, 1400);
    }
    if (currentRank > 0) this.lastRankObserved = currentRank;

    this.hud.updateTelemetry({
      car: this.localCar,
      raceTimeMs,
      totalLaps,
      standings,
      myId: this.myId,
      track: this.track,
      racers
    });
  }

  _updateRaceCamera(dt) {
    const car = this.localCar;
    const cam = this.sceneMgr.camera;
    const mode = this.cameraModes[this.cameraModeIndex];

    const forward = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    let desiredPos, desiredLook;

    // Smooth longitudinal G-force camera lag (pulls back on hard accel/shift kick, nudges forward on braking!)
    const targetLongLag = THREE.MathUtils.clamp(
      car.longG * 0.42 + (car.nitroActive ? 0.85 : 0) - car.shiftKickPulse * 0.18,
      -0.65,
      1.35
    );
    this.camLongLag = THREE.MathUtils.lerp(this.camLongLag, targetLongLag, Math.min(1, dt * 6.5));

    if (mode === 'HOOD') {
      desiredPos = car.position.clone().addScaledVector(forward, 1.35).add(new THREE.Vector3(0, 1.32, 0));
      desiredLook = car.position.clone().addScaledVector(forward, 26).add(new THREE.Vector3(0, 1.0, 0));
      this.camPos.copy(desiredPos);
      this.camLook.copy(desiredLook);
      this.camRoll = THREE.MathUtils.lerp(this.camRoll, THREE.MathUtils.clamp(car.latG * 0.018, -0.032, 0.032), Math.min(1, dt * 9));
    } else {
      // Velocity-blended Chase Heading: when drifting, camera trails smoothly behind velocity
      // so the player clearly sees the car's sideways slip angle across the apex!
      const absSpd = Math.abs(car.forwardSpeed);
      let targetChaseYaw = car.yaw;
      if (car.forwardSpeed > 6.0) {
        const velYaw = Math.atan2(car.velocity.x, car.velocity.z);
        let slipDiff = velYaw - car.yaw;
        while (slipDiff > Math.PI) slipDiff -= Math.PI * 2;
        while (slipDiff < -Math.PI) slipDiff += Math.PI * 2;
        // Blend ~56% toward velocity vector during active slides so drifts look cinematic & readable!
        targetChaseYaw = car.yaw + slipDiff * 0.56;
      }

      let dChase = targetChaseYaw - this.camChaseYaw;
      while (dChase > Math.PI) dChase -= Math.PI * 2;
      while (dChase < -Math.PI) dChase += Math.PI * 2;
      const yawFollowRate = absSpd > 8 ? 7.2 : 10.5;
      this.camChaseYaw += dChase * Math.min(1, dt * yawFollowRate);

      const chaseFwd = new THREE.Vector3(Math.sin(this.camChaseYaw), 0, Math.cos(this.camChaseYaw));
      const chaseLeft = new THREE.Vector3(Math.cos(this.camChaseYaw), 0, -Math.sin(this.camChaseYaw));

      const baseDist = mode === 'FAR' ? 10.4 : 6.6;
      const height = mode === 'FAR' ? 3.7 : 2.22;
      const latSwing = THREE.MathUtils.clamp(-car.latG * 0.28, -0.75, 0.75);

      desiredPos = car.position.clone()
        .addScaledVector(chaseFwd, -(baseDist + this.camLongLag))
        .addScaledVector(chaseLeft, latSwing)
        .add(new THREE.Vector3(0, height - Math.min(0.18, Math.max(0, car.longG * 0.08)), 0));
      desiredLook = car.position.clone()
        .addScaledVector(forward, 10.5)
        .add(new THREE.Vector3(0, 1.05, 0));

      this.camPos.lerp(desiredPos, Math.min(1, dt * 11.5));
      this.camLook.lerp(desiredLook, Math.min(1, dt * 14));
      this.camRoll = THREE.MathUtils.lerp(this.camRoll, THREE.MathUtils.clamp(car.latG * 0.012, -0.025, 0.025), Math.min(1, dt * 8));
    }

    // Subtle camera shake on impacts, nitro & apex kerb rumble!
    this.camShake = Math.max(0, this.camShake - dt * 2.4);
    const kerbShake = car.kerbRumble * 0.042;
    const speedVibe = Math.max(0, (Math.abs(car.speed) - 62) / 50) * 0.016;
    const totalShake = this.camShake + (car.nitroActive ? 0.05 : 0) + kerbShake + speedVibe;
    cam.position.copy(this.camPos);
    if (totalShake > 0.004) {
      cam.position.x += (Math.random() - 0.5) * totalShake;
      cam.position.y += (Math.random() - 0.5) * totalShake;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.camLook);
    if (Math.abs(this.camRoll) > 0.0005) {
      cam.rotateZ(this.camRoll);
    }

    // Dynamic FOV warp with speed, longitudinal acceleration & nitro
    const speedRatio = Math.min(1, Math.abs(car.speed) / 92);
    const accelFov = THREE.MathUtils.clamp(car.longG * 1.4, -2.5, 3.2);
    const targetFov = 59 + speedRatio * 14.5 + accelFov + (car.nitroActive ? 8.5 : 0);
    cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, Math.min(1, dt * 7.5));
    cam.updateProjectionMatrix();
  }

  _updateShowroom(dt) {
    this.showroomAngle += dt * 0.35;
    const cam = this.sceneMgr.camera;
    const r = 7.4;
    cam.position.set(Math.sin(this.showroomAngle) * r, 2.35, Math.cos(this.showroomAngle) * r);
    cam.lookAt(0, 0.72, 0);
    cam.fov = 46;
    cam.updateProjectionMatrix();

    if (this.showroomCar) {
      this.showroomCar.setVisualState({
        speed: 0,
        steer: Math.sin(this.showroomAngle * 0.8) * 0.25,
        braking: false,
        nitro: false,
        driftAngle: 0,
        dt
      });
    }
  }

  _loop(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    if (this.mode === 'showroom') {
      this._updateShowroom(dt);
    } else {
      this._updateRace(dt, now);
    }

    this.sceneMgr.render();
    requestAnimationFrame((t) => this._loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new ApexHorizonGame();
});
