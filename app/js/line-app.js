(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function utf8Encode(text) { return new TextEncoder().encode(String(text)); }
  function utf8Decode(bytes) { return new TextDecoder().decode(bytes); }
  function concatUint8(arrays) {
    var total = arrays.reduce(function (n, a) { return n + a.length; }, 0);
    var out = new Uint8Array(total);
    var off = 0;
    arrays.forEach(function (a) { out.set(a, off); off += a.length; });
    return out;
  }
  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (var j = 0; j < 8; j++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xedb88320) : (crc >>> 1);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function crc32Hex(bytes) { return (crc32(bytes) >>> 0).toString(16).padStart(8, '0'); }
  async function sha256Hex(bytes) {
    if (!globalThis.crypto || !crypto.subtle) return null;
    var buf = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
    var hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function asUint8(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    if (typeof value === 'string') return utf8Encode(value);
    return null;
  }
  function readFileBytes(file) {
    var direct = asUint8(file);
    if (direct) return Promise.resolve(direct);
    if (!(file instanceof Blob)) return Promise.reject(new Error('尚未選擇檔案'));
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(reader.error || new Error('讀取失敗')); };
      reader.onload = function () { resolve(new Uint8Array(reader.result)); };
      reader.readAsArrayBuffer(file);
    });
  }
  function formatBytes(n) {
    if (!Number.isFinite(n)) return '-';
    var u = ['B', 'KB', 'MB', 'GB']; var i = 0; var v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v : v.toFixed(2)) + ' ' + u[i];
  }
  function safeName(name) {
    var base = String(name || 'received.bin').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return base || 'received.bin';
  }
  function downloadBytes(bytes, name, mime) {
    var url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    var a = document.createElement('a');
    a.href = url; a.download = safeName(name);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function indexesToRanges(indexes) {
    var arr = Array.from(new Set(indexes)).sort(function (a, b) { return a - b; }).filter(function (n) { return Number.isInteger(n) && n >= 0; });
    if (!arr.length) return '';
    var parts = []; var start = arr[0], prev = arr[0];
    for (var i = 1; i <= arr.length; i++) {
      var cur = arr[i];
      if (cur === prev + 1) { prev = cur; continue; }
      parts.push(start === prev ? String(start) : start + '-' + prev);
      start = prev = cur;
    }
    return parts.join(',');
  }
  function logTo(el, message, kind) {
    if (!el) return;
    var line = document.createElement('div');
    line.className = 'log-line log-' + (kind || 'info');
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
    el.appendChild(line);
    while (el.children.length > 200) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }
  function setProgress(fill, text, pct, label) {
    var n = Math.max(0, Math.min(100, pct || 0));
    if (fill) fill.style.width = n + '%';
    if (text) text.textContent = label || n.toFixed(0) + '%';
  }

  var TYPES = Object.freeze({ START: 1, DATA: 2, END: 3 });
  var MAGIC = new Uint8Array([0x51, 0x46, 0x54, 0x32]);
  var VERSION = 1;
  var FIXED = 12;
  var CRC_LEN = 4;
  function encodeRecord(type, header, payload) {
    header = header || {}; payload = payload || new Uint8Array(0);
    var headerBytes = utf8Encode(JSON.stringify(header));
    var body = payload instanceof Uint8Array ? payload : new Uint8Array(payload || 0);
    var withoutCrc = new Uint8Array(FIXED + headerBytes.length + body.length);
    var view = new DataView(withoutCrc.buffer);
    withoutCrc.set(MAGIC, 0); view.setUint8(4, VERSION); view.setUint8(5, type);
    view.setUint16(6, headerBytes.length, true); view.setUint32(8, body.length, true);
    withoutCrc.set(headerBytes, FIXED);
    withoutCrc.set(body, FIXED + headerBytes.length);
    var out = new Uint8Array(withoutCrc.length + CRC_LEN);
    out.set(withoutCrc, 0);
    new DataView(out.buffer).setUint32(withoutCrc.length, crc32(withoutCrc), true);
    return out;
  }
  function findMagic(bytes) {
    outer: for (var i = 0; i <= bytes.length - 4; i++) {
      for (var j = 0; j < 4; j++) if (bytes[i + j] !== MAGIC[j]) continue outer;
      return i;
    }
    return -1;
  }
  function RecordParser() { this.buffer = new Uint8Array(0); }
  RecordParser.prototype.reset = function () { this.buffer = new Uint8Array(0); };
  RecordParser.prototype.feed = function (chunk) {
    var bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    this.buffer = concatUint8([this.buffer, bytes]);
    var records = [];
    while (this.buffer.length >= FIXED) {
      var start = findMagic(this.buffer);
      if (start < 0) { this.buffer = this.buffer.slice(Math.max(0, this.buffer.length - 3)); break; }
      if (start > 0) this.buffer = this.buffer.slice(start);
      if (this.buffer.length < FIXED) break;
      var view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      if (view.getUint8(4) !== VERSION) { this.buffer = this.buffer.slice(1); continue; }
      var type = view.getUint8(5);
      var headerLen = view.getUint16(6, true);
      var payloadLen = view.getUint32(8, true);
      var total = FIXED + headerLen + payloadLen + CRC_LEN;
      if (total > 4 * 1024 * 1024) { this.buffer = this.buffer.slice(1); continue; }
      if (this.buffer.length < total) break;
      var recBytes = this.buffer.slice(0, total);
      var expected = new DataView(recBytes.buffer, recBytes.byteOffset, recBytes.byteLength).getUint32(total - CRC_LEN, true);
      if (expected !== crc32(recBytes.slice(0, total - CRC_LEN))) {
        // Do not consume `total` bytes on a damaged modem frame. A missing Quiet
        // sub-frame can make this record short and the following record starts
        // inside that window. Drop one byte and re-scan for MAGIC so the next
        // valid START/DATA/END can still be recovered.
        this.buffer = this.buffer.slice(1);
        continue;
      }
      var headerObj;
      try { headerObj = JSON.parse(utf8Decode(recBytes.slice(FIXED, FIXED + headerLen))); }
      catch (e) { this.buffer = this.buffer.slice(1); continue; }
      this.buffer = this.buffer.slice(total);
      records.push({ type: type, header: headerObj, payload: recBytes.slice(FIXED + headerLen, FIXED + headerLen + payloadLen) });
    }
    return records;
  };
  function makeSessionId() {
    var a = new Uint8Array(6);
    if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (var i = 0; i < 6; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function splitChunks(bytes, size) {
    var chunks = []; var index = 0;
    for (var off = 0; off < bytes.length; off += size) chunks.push({ index: index++, bytes: bytes.slice(off, off + size) });
    if (!bytes.length) chunks.push({ index: 0, bytes: new Uint8Array(0) });
    return chunks;
  }

  function QuietAdapter() { this.ready = false; this.initPromise = null; this.tx = null; this.rx = null; this.waiter = null; }
  QuietAdapter.prototype.init = function () {
    var self = this;
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise(function (resolve, reject) {
      if (typeof Quiet === 'undefined') { reject(new Error('Quiet 尚未載入')); return; }
      var settled = false;
      var timer = setTimeout(function () { if (!settled) reject(new Error('quiet-js 等待逾時')); }, 20000);
      function ok() { settled = true; clearTimeout(timer); self.ready = true; resolve(); }
      function fail(reason) { settled = true; clearTimeout(timer); reject(new Error(String(reason || 'quiet-js 初始化失敗'))); }
      if (typeof Quiet.addReadyCallback === 'function') Quiet.addReadyCallback(ok, fail);
      else reject(new Error('Quiet API 不符'));
    });
    return this.initPromise;
  };
  QuietAdapter.prototype.createTransmitter = function (profile) {
    if (!this.ready) throw new Error('quiet-js 尚未就緒');
    this.destroyTransmitter();
    var self = this;
    function finished() { if (self.waiter) { var w = self.waiter; self.waiter = null; w.resolve(); } }
    this.tx = Quiet.transmitter({
      profile: profile,
      clampFrame: true,
      onFinish: finished
    });
    return this.tx;
  };
  QuietAdapter.prototype.createReceiver = function (profile, onReceive, onCreate, onCreateFail, onReceiveFail) {
    if (!this.ready) throw new Error('quiet-js 尚未就緒');
    this.destroyReceiver();
    this.rx = Quiet.receiver({
      profile: profile,
      onReceive: onReceive,
      onCreate: onCreate,
      onCreateFail: onCreateFail,
      onReceiveFail: onReceiveFail
    });
    return this.rx;
  };
  QuietAdapter.prototype.transmit = function (bytes) {
    if (!this.tx) return Promise.reject(new Error('尚未建立傳送器'));
    var uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var buf = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
    var self = this;
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true; self.waiter = null;
        reject(new Error('傳送逾時：請確認瀏覽器輸出是 3.5mm 耳機孔'));
      }, 30000);
      self.waiter = {
        resolve: function () { if (!settled) { settled = true; clearTimeout(timer); resolve(); } },
        reject: function (e) { if (!settled) { settled = true; clearTimeout(timer); reject(e); } }
      };
      try { self.tx.transmit(buf); }
      catch (e) { if (self.waiter && self.waiter.reject) self.waiter.reject(e); self.waiter = null; }
    });
  };
  QuietAdapter.prototype.abortTransmit = function (message) {
    var waiter = this.waiter;
    this.waiter = null;
    if (waiter && waiter.reject) waiter.reject(new Error(message || '已停止'));
    this.destroyTransmitter();
  };
  QuietAdapter.prototype.destroyTransmitter = function () {
    if (this.waiter && this.waiter.reject) {
      var w = this.waiter; this.waiter = null;
      w.reject(new Error('傳送器已關閉'));
    }
    if (this.tx && typeof this.tx.destroy === 'function') { try { this.tx.destroy(); } catch (e) {} }
    this.tx = null;
  };
  QuietAdapter.prototype.destroyReceiver = function () {
    if (this.rx && typeof this.rx.destroy === 'function') { try { this.rx.destroy(); } catch (e) {} }
    this.rx = null;
    if (typeof Quiet !== 'undefined' && Quiet.disconnect) { try { Quiet.disconnect(); } catch (e) {} }
  };

  var adapter = new QuietAdapter();
  var parser = new RecordParser();
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Edg\//.test(ua);
  var isAndroid = /Android/i.test(ua);
  var state = {
    role: null,
    selectedFile: null,
    prepared: null,
    sending: false,
    stopRequested: false,
    receiving: false,
    recv: null,
    capture: null,
    meterCtx: null,
    meterSource: null,
    meterAnalyser: null,
    meterRaf: 0
  };
  var probe = { ctx: null, osc: null, timer: 0 };
  var els = {};
  var quietRuntime = null;
  var PROFILE = 'jack-gmsk';
  var CHUNK = 128;
  var REPEAT = 1;
  var START_REPEAT = 3;
  var END_REPEAT = 2;

  function initEls() {
    ['quietStatus', 'btnRoleTx', 'btnRoleRx', 'txCard', 'rxCard', 'btnProbe', 'btnSendDemo', 'btnStopSend', 'fileInput', 'btnPrepare', 'btnSend', 'sendInfo', 'sendBar', 'sendText', 'resendList', 'btnResendMissing', 'btnReceive', 'btnStopReceive', 'btnClearReceive', 'btnRefreshInputs', 'audioInputSelect', 'captureMode', 'audioRouteInfo', 'inputBar', 'inputText', 'receiverInfo', 'recvBar', 'recvText', 'missingList', 'btnCopyMissing', 'downloadBox', 'log', 'demoText'].forEach(function (id) { els[id] = $(id); });
  }
  function log(msg, kind) { logTo(els.log, msg, kind || 'info'); }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('無法載入 ' + src)); };
      document.body.appendChild(s);
    });
  }
  function ensureQuietRuntime() {
    if (adapter.ready) return Promise.resolve();
    if (quietRuntime) return quietRuntime;
    quietRuntime = (async function () {
      els.quietStatus.textContent = '載入解碼器…';
      els.quietStatus.className = 'status idle';
      if (typeof window.FTWS_PRELOAD_QUIET_MEMORY !== 'function') {
        await loadScript('app/vendor/quiet/ftws-embedded-assets.js');
      }
      if (typeof window.FTWS_PRELOAD_QUIET_MEMORY === 'function') window.FTWS_PRELOAD_QUIET_MEMORY();
      await loadScript('app/vendor/quiet/quiet-emscripten.js');
      await adapter.init();
      els.quietStatus.textContent = '解碼器已就緒';
      els.quietStatus.className = 'status ok';
    })().catch(function (e) {
      quietRuntime = null;
      els.quietStatus.textContent = '解碼器失敗：' + e.message;
      els.quietStatus.className = 'status err';
      throw e;
    });
    return quietRuntime;
  }
  function setRole(role) {
    state.role = role;
    els.txCard.classList.toggle('hidden', role !== 'tx');
    els.rxCard.classList.toggle('hidden', role !== 'rx');
    els.btnRoleTx.classList.toggle('active', role === 'tx');
    els.btnRoleRx.classList.toggle('active', role === 'rx');
    if (role === 'tx') {
      adapter.destroyReceiver();
      stopCapture();
      state.receiving = false;
      els.btnReceive.disabled = true;
      els.btnStopReceive.disabled = true;
      els.btnSendDemo.disabled = false;
      els.btnPrepare.disabled = !state.selectedFile;
      log('這台當傳送端。播放裝置請選 3.5mm 耳機孔。', 'ok');
    } else {
      adapter.destroyTransmitter();
      stopProbe();
      els.btnReceive.disabled = false;
      log('這台當接收端。開始接收後不要再開系統錄音。', 'ok');
    }
  }
  function stopInputMeter() {
    if (state.meterRaf) { cancelAnimationFrame(state.meterRaf); state.meterRaf = 0; }
    if (state.meterSource) { try { state.meterSource.disconnect(); } catch (e) {} state.meterSource = null; }
    if (state.meterCtx && state.meterCtx.state !== 'closed') { try { state.meterCtx.close(); } catch (e) {} }
    state.meterCtx = null; state.meterAnalyser = null;
    if (els.inputBar) els.inputBar.style.width = '0%';
    if (els.inputText) els.inputText.textContent = '等待訊號';
  }
  function stopCapture() {
    stopInputMeter();
    if (state.capture) {
      state.capture.getTracks().forEach(function (t) { t.stop(); });
      state.capture = null;
    }
    window.FTWS_AUDIO_STREAM = null;
    window.FTWS_AUDIO_DEVICE_ID = '';
    window.FTWS_AUDIO_CONSTRAINTS = null;
    if (els.audioRouteInfo) els.audioRouteInfo.textContent = '尚未開啟輸入';
  }
  function parseRanges(text, maxExclusive) {
    var out = new Set();
    String(text || '').split(',').forEach(function (part) {
      part = part.trim(); if (!part) return;
      var m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) return;
      var a = Number(m[1]), b = m[2] == null ? a : Number(m[2]);
      if (b < a) { var tmp = a; a = b; b = tmp; }
      for (var i = a; i <= b && i < maxExclusive; i++) if (i >= 0) out.add(i);
    });
    return Array.from(out).sort(function (a,b) { return a-b; });
  }
  function getCaptureMode() {
    var mode = els.captureMode ? els.captureMode.value : 'auto';
    if (mode === 'auto') return isAndroid ? 'route-safe' : 'raw';
    return mode;
  }
  function buildAudioConstraints(deviceId) {
    var mode = getCaptureMode();
    var audio = {
      echoCancellation: mode === 'route-safe',
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
      googEchoCancellation: mode === 'route-safe',
      googAutoGainControl: false,
      googNoiseSuppression: false,
      googHighpassFilter: false
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    return audio;
  }
  async function refreshAudioInputs(unlockLabels) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    var temp = null;
    if (unlockLabels) {
      try { temp = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {}
    }
    try {
      var current = els.audioInputSelect ? els.audioInputSelect.value : '';
      var devices = await navigator.mediaDevices.enumerateDevices();
      var inputs = devices.filter(function (d) { return d.kind === 'audioinput'; });
      if (els.audioInputSelect) {
        els.audioInputSelect.innerHTML = '';
        var def = document.createElement('option'); def.value = ''; def.textContent = '系統預設輸入'; els.audioInputSelect.appendChild(def);
        inputs.forEach(function (d, i) {
          var opt = document.createElement('option'); opt.value = d.deviceId; opt.textContent = d.label || ('音訊輸入 ' + (i + 1));
          els.audioInputSelect.appendChild(opt);
        });
        if (Array.from(els.audioInputSelect.options).some(function (o) { return o.value === current; })) els.audioInputSelect.value = current;
      }
      log('找到 ' + inputs.length + ' 個音訊輸入', inputs.length ? 'ok' : 'warn');
    } finally {
      if (temp) temp.getTracks().forEach(function (t) { t.stop(); });
    }
  }
  async function startInputMeter(stream) {
    stopInputMeter();
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx = new Ctx();
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
    var source = ctx.createMediaStreamSource(stream);
    var analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);
    state.meterCtx = ctx; state.meterSource = source; state.meterAnalyser = analyser;
    var data = new Float32Array(analyser.fftSize);
    function tick() {
      if (!state.meterAnalyser) return;
      analyser.getFloatTimeDomainData(data);
      var sum = 0, peak = 0;
      for (var i = 0; i < data.length; i++) { var a = Math.abs(data[i]); sum += data[i] * data[i]; if (a > peak) peak = a; }
      var rms = Math.sqrt(sum / data.length);
      var pct = Math.min(100, Math.max(0, rms * 260));
      if (els.inputBar) els.inputBar.style.width = pct.toFixed(1) + '%';
      if (els.inputText) {
        if (peak > 0.985) els.inputText.textContent = '過載 / clipping';
        else if (rms < 0.002) els.inputText.textContent = '幾乎無訊號';
        else if (rms < 0.015) els.inputText.textContent = '訊號偏小';
        else els.inputText.textContent = '收到音訊 · RMS ' + rms.toFixed(3);
      }
      state.meterRaf = requestAnimationFrame(tick);
    }
    tick();
  }
  function stopProbe() {
    if (probe.timer) { clearTimeout(probe.timer); probe.timer = 0; }
    if (probe.osc) { try { probe.osc.stop(); } catch (e) {} probe.osc = null; }
    if (probe.ctx && probe.ctx.state !== 'closed') { try { probe.ctx.close(); } catch (e) {} }
    probe.ctx = null;
  }
  async function playProbe() {
    if (state.role !== 'tx') throw new Error('請先選電腦傳送');
    stopProbe();
    probe.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (probe.ctx.state === 'suspended') await probe.ctx.resume();
    var osc = probe.ctx.createOscillator();
    var gain = probe.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1000;
    gain.gain.value = 0.9;
    osc.connect(gain);
    gain.connect(probe.ctx.destination);
    osc.start();
    probe.osc = osc;
    log('探測音 1 kHz，5 秒。手機請用系統錄音聽，並關掉這個頁面。', 'ok');
    probe.timer = setTimeout(stopProbe, 5000);
  }
  async function prepareFile(file, overrideBytes, overrideName, overrideMime) {
    var bytes = overrideBytes != null ? asUint8(overrideBytes) : await readFileBytes(file);
    if (!(bytes instanceof Uint8Array)) throw new Error('準備失敗');
    var chunks = splitChunks(bytes, CHUNK);
    var info = {
      sessionId: makeSessionId(),
      fileName: safeName(overrideName || (file && file.name) || 'demo.txt'),
      mimeType: overrideMime || (file && file.type) || 'application/octet-stream',
      fileSize: bytes.length,
      chunkSize: CHUNK,
      totalChunks: chunks.length,
      crc32: crc32Hex(bytes),
      sha256: await sha256Hex(bytes)
    };
    state.prepared = { info: info, chunks: chunks };
    els.sendInfo.textContent = info.fileName + ' · ' + formatBytes(info.fileSize) + ' · ' + info.totalChunks + ' chunks';
    els.btnSend.disabled = false;
    if (els.btnResendMissing) els.btnResendMissing.disabled = false;
    setProgress(els.sendBar, els.sendText, 0, '待傳送');
    log('已準備 ' + info.fileName, 'ok');
  }
  async function sendPrepared() {
    if (state.role !== 'tx') throw new Error('請先選電腦傳送');
    if (!state.prepared) throw new Error('尚未準備');
    stopProbe();
    await ensureQuietRuntime();
    adapter.createTransmitter(PROFILE);
    log('開始傳送 jack-gmsk · chunk ' + CHUNK + ' B · DATA 單次', 'ok');
    await sleep(40);
    var info = state.prepared.info;
    var chunks = state.prepared.chunks;
    var totalUnits = START_REPEAT + chunks.length * REPEAT + END_REPEAT;
    var unit = 0;
    state.sending = true;
    state.stopRequested = false;
    els.btnSend.disabled = true;
    els.btnSendDemo.disabled = true;
    els.btnPrepare.disabled = true;
    els.btnStopSend.disabled = false;
    try {
      var startRec = encodeRecord(TYPES.START, info, new Uint8Array(0));
      for (var i = 0; i < START_REPEAT; i++) {
        if (state.stopRequested) throw new Error('已停止');
        await adapter.transmit(startRec); unit++;
        setProgress(els.sendBar, els.sendText, unit / totalUnits * 100, 'START ' + (i + 1) + '/' + START_REPEAT);
        await sleep(80);
      }
      for (var t = 0; t < chunks.length; t++) {
        var ch = chunks[t];
        var rec = encodeRecord(TYPES.DATA, { s: info.sessionId, i: ch.index }, ch.bytes);
        for (var r = 0; r < REPEAT; r++) {
          if (state.stopRequested) throw new Error('已停止');
          await adapter.transmit(rec); unit++;
          setProgress(els.sendBar, els.sendText, unit / totalUnits * 100, (ch.index + 1) + '/' + info.totalChunks);
          await sleep(40);
        }
      }
      var end = encodeRecord(TYPES.END, { sessionId: info.sessionId, totalChunks: info.totalChunks, crc32: info.crc32, sha256: info.sha256 }, new Uint8Array(0));
      for (var e = 0; e < END_REPEAT; e++) {
        if (state.stopRequested) throw new Error('已停止');
        await adapter.transmit(end); unit++;
        setProgress(els.sendBar, els.sendText, unit / totalUnits * 100, 'END ' + (e + 1) + '/' + END_REPEAT);
        await sleep(80);
      }
      setProgress(els.sendBar, els.sendText, 100, '完成');
      log('傳送完成', 'ok');
    } catch (err) {
      log(err.message, state.stopRequested ? 'warn' : 'err');
      setProgress(els.sendBar, els.sendText, 0, err.message);
    } finally {
      state.sending = false;
      adapter.destroyTransmitter();
      els.btnSend.disabled = !state.prepared;
      els.btnSendDemo.disabled = false;
      els.btnPrepare.disabled = !state.selectedFile;
      els.btnStopSend.disabled = true;
    }
  }
  async function resendMissing() {
    if (state.role !== 'tx') throw new Error('請先選電腦傳送');
    if (!state.prepared) throw new Error('請先準備同一個檔案，勿重新選檔後建立新 session');
    var info = state.prepared.info, chunks = state.prepared.chunks;
    var indexes = parseRanges(els.resendList && els.resendList.value, chunks.length);
    if (!indexes.length) throw new Error('請貼上缺失編號，例如 0,3-5,9');
    stopProbe(); await ensureQuietRuntime(); adapter.createTransmitter(PROFILE);
    state.sending = true; state.stopRequested = false;
    els.btnStopSend.disabled = false; els.btnResendMissing.disabled = true;
    var total = 1 + indexes.length + END_REPEAT, done = 0;
    try {
      await adapter.transmit(encodeRecord(TYPES.START, info, new Uint8Array(0))); done++;
      for (var n = 0; n < indexes.length; n++) {
        if (state.stopRequested) throw new Error('已停止');
        var ch = chunks[indexes[n]];
        await adapter.transmit(encodeRecord(TYPES.DATA, { s: info.sessionId, i: ch.index }, ch.bytes)); done++;
        setProgress(els.sendBar, els.sendText, done / total * 100, '補傳 ' + ch.index);
        await sleep(35);
      }
      var end = encodeRecord(TYPES.END, { sessionId: info.sessionId, totalChunks: info.totalChunks, crc32: info.crc32, sha256: info.sha256 }, new Uint8Array(0));
      for (var e = 0; e < END_REPEAT; e++) { await adapter.transmit(end); done++; await sleep(50); }
      setProgress(els.sendBar, els.sendText, 100, '補傳完成');
      log('補傳完成：' + indexesToRanges(indexes), 'ok');
    } finally {
      state.sending = false; adapter.destroyTransmitter(); els.btnStopSend.disabled = true;
      if (els.btnResendMissing) els.btnResendMissing.disabled = !state.prepared;
    }
  }
  function resetReceiveSession() {
    state.recv = null;
    parser.reset();
    if (els.receiverInfo) els.receiverInfo.textContent = '尚未收到';
    if (els.missingList) els.missingList.value = '';
    if (els.downloadBox) els.downloadBox.innerHTML = '';
    setProgress(els.recvBar, els.recvText, 0, '等待');
  }
  async function startReceive() {
    if (state.role !== 'rx') throw new Error('請先選手機接收');
    if (isIOS || isSafari) log('iPhone / Safari 不能收', 'warn');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('這個瀏覽器不能錄音');
    resetReceiveSession();
    stopProbe();
    adapter.destroyTransmitter();
    adapter.destroyReceiver();
    stopCapture();
    await ensureQuietRuntime();

    var deviceId = (els.audioInputSelect && els.audioInputSelect.value) || '';
    var constraints = buildAudioConstraints(deviceId);
    var mode = getCaptureMode();
    window.FTWS_AUDIO_DEVICE_ID = deviceId;
    window.FTWS_AUDIO_CONSTRAINTS = constraints;
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    } catch (e1) {
      log('指定輸入/模式失敗，改用系統預設：' + (e1.name || e1.message), 'warn');
      stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints('') });
    }
    state.capture = stream;
    window.FTWS_AUDIO_STREAM = stream;
    var track = stream.getAudioTracks()[0];
    var label = (track && track.label) || '未知';
    var settings = track && track.getSettings ? track.getSettings() : {};
    var routeText = label + (settings.sampleRate ? ' · ' + settings.sampleRate + ' Hz' : '') + ' · ' + (mode === 'route-safe' ? 'Android 路由相容' : '原始音訊');
    if (els.audioRouteInfo) els.audioRouteInfo.textContent = routeText;
    log('輸入：' + routeText, /內建|internal|built-?in/i.test(label) ? 'warn' : 'ok');
    if (isAndroid && mode === 'raw') log('Android 原始模式可能因 Chromium 路由問題改抓內建麥克風；若電平沒有反應請切回「自動」。', 'warn');
    await startInputMeter(stream);
    await refreshAudioInputs(false);

    adapter.createReceiver(PROFILE, onQuietBytes, function () { log('GMSK 接收器已啟動', 'ok'); }, function (reason) { log('接收失敗：' + reason, 'err'); }, function (total) { if (total && total % 10 === 0) log('解碼失敗累計 ' + total + ' frames', 'warn'); });
    state.receiving = true;
    els.btnReceive.disabled = true;
    els.btnStopReceive.disabled = false;
  }
  function stopReceive() {
    adapter.destroyReceiver();
    stopCapture();
    state.receiving = false;
    els.btnReceive.disabled = state.role !== 'rx';
    els.btnStopReceive.disabled = true;
    log('已停止接收', 'warn');
  }
  function onQuietBytes(ab) { parser.feed(ab instanceof ArrayBuffer ? new Uint8Array(ab) : ab).forEach(handleRecord); updateReceiveInfo(); }
  function handleRecord(rec) {
    if (rec.type === TYPES.START) {
      var h = rec.header;
      if (!state.recv || state.recv.info.sessionId !== h.sessionId) {
        state.recv = { info: h, chunks: new Map(), completed: false };
        if (els.downloadBox) els.downloadBox.innerHTML = '';
        log('START ' + h.fileName, 'ok');
      }
      return;
    }
    if (!state.recv) return;
    var recSession = rec.header.sessionId || rec.header.s;
    if (recSession && recSession !== state.recv.info.sessionId) return;
    if (rec.type === TYPES.DATA) {
      var idx = Number(rec.header.index != null ? rec.header.index : rec.header.i);
      if (!Number.isInteger(idx)) return;
      if (!state.recv.chunks.has(idx)) {
        state.recv.chunks.set(idx, rec.payload);
        if (state.recv.chunks.size === state.recv.info.totalChunks) finalizeReceive();
      }
      return;
    }
    if (rec.type === TYPES.END && state.recv.chunks.size === state.recv.info.totalChunks) finalizeReceive();
  }
  function missingIndexes() {
    if (!state.recv) return [];
    var out = []; var total = state.recv.info.totalChunks || 0;
    for (var i = 0; i < total; i++) if (!state.recv.chunks.has(i)) out.push(i);
    return out;
  }
  function updateReceiveInfo() {
    if (!els.receiverInfo) return;
    if (!state.recv) { els.receiverInfo.textContent = '等待 START'; return; }
    var info = state.recv.info, got = state.recv.chunks.size, total = info.totalChunks || 0;
    els.missingList.value = indexesToRanges(missingIndexes());
    els.receiverInfo.textContent = info.fileName + ' · ' + got + '/' + total;
    setProgress(els.recvBar, els.recvText, total ? got / total * 100 : 0, (total ? got / total * 100 : 0).toFixed(0) + '%');
  }
  async function finalizeReceive() {
    if (!state.recv || state.recv.completed) return;
    var info = state.recv.info, parts = [];
    for (var i = 0; i < info.totalChunks; i++) {
      var c = state.recv.chunks.get(i);
      if (!c) return;
      parts.push(c);
    }
    var cropped = concatUint8(parts).slice(0, info.fileSize);
    var crc = crc32Hex(cropped);
    var sha = await sha256Hex(cropped);
    var ok = crc === info.crc32 && (!info.sha256 || !sha || sha === info.sha256);
    state.recv.completed = ok;
    if (ok) {
      log('完成 ' + info.fileName, 'ok');
      els.downloadBox.innerHTML = '';
      var btn = document.createElement('button');
      btn.className = 'btn primary';
      btn.textContent = '下載';
      btn.onclick = function () { downloadBytes(cropped, info.fileName, info.mimeType); };
      els.downloadBox.appendChild(btn);
      setProgress(els.recvBar, els.recvText, 100, '完成');
    } else {
      log('驗證失敗', 'err');
    }
  }
  function bindEvents() {
    els.btnRoleTx.addEventListener('click', function () { setRole('tx'); });
    els.btnRoleRx.addEventListener('click', function () { setRole('rx'); });
    els.btnProbe.addEventListener('click', function () { playProbe().catch(function (e) { log(e.message, 'err'); }); });
    els.fileInput.addEventListener('change', function () {
      state.selectedFile = (els.fileInput.files && els.fileInput.files[0]) || null;
      state.prepared = null;
      els.btnPrepare.disabled = !state.selectedFile;
      els.btnSend.disabled = true;
      els.sendInfo.textContent = state.selectedFile ? state.selectedFile.name : '尚未準備';
    });
    els.btnPrepare.addEventListener('click', function () {
      prepareFile(state.selectedFile).catch(function (e) { log(e.message, 'err'); });
    });
    els.btnSendDemo.addEventListener('click', function () {
      var text = (els.demoText && els.demoText.value) || 'Hello Line';
      prepareFile(null, utf8Encode(text), 'demo.txt', 'text/plain;charset=utf-8')
        .then(function () { return sendPrepared(); })
        .catch(function (e) { log(e.message, 'err'); });
    });
    els.btnSend.addEventListener('click', function () {
      (state.prepared ? Promise.resolve() : prepareFile(state.selectedFile))
        .then(function () { return sendPrepared(); })
        .catch(function (e) { log(e.message, 'err'); });
    });
    els.btnStopSend.addEventListener('click', function () {
      if (!state.sending) return;
      state.stopRequested = true;
      adapter.abortTransmit('已停止');
    });
    els.btnReceive.addEventListener('click', function () {
      startReceive().catch(function (e) { log(e.message, 'err'); });
    });
    els.btnResendMissing.addEventListener('click', function () { resendMissing().catch(function (e) { log(e.message, 'err'); }); });
    els.btnRefreshInputs.addEventListener('click', function () { refreshAudioInputs(!state.receiving).catch(function (e) { log(e.message, 'err'); }); });
    els.btnStopReceive.addEventListener('click', stopReceive);
    els.btnClearReceive.addEventListener('click', resetReceiveSession);
    els.btnCopyMissing.addEventListener('click', function () {
      var text = els.missingList.value || '';
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { log('已複製', 'ok'); }, function () {});
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initEls();
    bindEvents();
    resetReceiveSession();
    els.quietStatus.textContent = '先選角色。探測音不必等解碼器。';
    els.quietStatus.className = 'status idle';
    if (els.captureMode) els.captureMode.value = 'auto';
    refreshAudioInputs(false).catch(function () {});
    log('GMSK Android 相容版：128 B chunk、DATA 單次、支援缺失補傳與輸入電平檢查。', 'ok');
  });
})();
