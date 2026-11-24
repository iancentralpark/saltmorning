/**
 * Salty — floating English/grammar tutor for content-only student portal.
 * Text + hold-to-talk mic in; Salty replies with text and voice (Debrief TTS).
 */
(function (global) {
  'use strict';

  var api = null;
  var esc = null;
  var role = 'student';
  var open = false;
  var history = [];
  var busy = false;
  var muteVoice = false;
  var speechGen = 0;
  var audioCtx = null;
  var mediaRecorder = null;
  var recordChunks = [];
  var recording = false;

  function $(id) { return document.getElementById(id); }

  function setMood(mood) {
    var img = $('saltyAvatar');
    var cap = $('saltyCaption');
    if (!img) return;
    var map = {
      idle: '/img/salt-buddy/idle-512.png',
      listening: '/img/salt-buddy/listening.png',
      thinking: '/img/salt-buddy/thinking.png',
      talking: '/img/salt-buddy/talking.png',
      happy: '/img/salt-buddy/happy.png'
    };
    img.src = map[mood] || map.idle;
    if (cap) {
      cap.textContent = mood === 'listening' ? 'Listening…'
        : mood === 'thinking' ? 'Thinking…'
          : mood === 'talking' ? 'Salty is talking…'
            : 'Ask Salty';
    }
  }

  function renderChat() {
    var box = $('saltyChat');
    if (!box) return;
    box.innerHTML = history.map(function (h) {
      var mine = h.role === 'student';
      return '<div class="salty-msg' + (mine ? ' mine' : '') + '">' +
        '<div class="salty-who">' + esc(mine ? 'You' : 'Salty') + '</div>' +
        '<div class="salty-bubble">' + esc(h.text) + '</div></div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function setOpen(on) {
    open = !!on;
    var root = $('saltyFloat');
    if (!root) return;
    root.classList.toggle('panel-collapsed', !open);
    var panel = $('saltyPanel');
    if (panel) panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    var fab = $('saltyFab');
    if (fab) fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      loadHistory();
      setTimeout(function () { if ($('saltyInput')) $('saltyInput').focus(); }, 50);
    } else {
      stopSpeech();
      setMood('idle');
    }
  }

  function loadHistory() {
    return api('/api/student/salty-tutor/history', {}, role).then(function (data) {
      history = (data.messages || []).map(function (m) {
        return { role: m.role === 'assistant' ? 'salty' : m.role, text: m.text };
      });
      renderChat();
      if (data.status && $('saltyStatus')) {
        $('saltyStatus').textContent = 'Today: ' + data.status.remaining + ' / ' + data.status.dailyLimit + ' left';
      }
    }).catch(function (e) {
      if ($('saltyError')) $('saltyError').textContent = e.message || 'Could not load chat.';
    });
  }

  function unlockAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function stopSpeech() {
    speechGen += 1;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }

  function pcmToAudioBuffer(ctx, pcm, rate) {
    var samples = new Int16Array(pcm.byteLength / 2);
    var view = new DataView(pcm);
    for (var i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true);
    var buf = ctx.createBuffer(1, samples.length, rate || 24000);
    var ch = buf.getChannelData(0);
    for (var j = 0; j < samples.length; j++) ch[j] = samples[j] / 32768;
    return buf;
  }

  function speakBrowser(text, gen) {
    if (!window.speechSynthesis) { setMood('idle'); return; }
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.onend = function () { if (gen === speechGen) setMood('idle'); };
    u.onerror = function () { if (gen === speechGen) setMood('idle'); };
    window.speechSynthesis.speak(u);
  }

  function speak(text) {
    stopSpeech();
    if (muteVoice || !text) { setMood('idle'); return; }
    var gen = speechGen;
    setMood('talking');
    var ctx = unlockAudio();
    var token = (global.SaltApp && SaltApp.getToken) ? SaltApp.getToken(role) : '';
    fetch('/api/student/salty-tutor/tts', {
      method: 'POST',
      headers: {
        Accept: 'application/octet-stream, application/json',
        'Content-Type': 'application/json',
        Authorization: token ? ('Bearer ' + token) : ''
      },
      body: JSON.stringify({ text: text })
    }).then(function (r) {
      if (!r.ok) throw new Error('tts');
      var rate = Number(r.headers.get('X-Audio-Sample-Rate')) || 24000;
      return r.arrayBuffer().then(function (pcm) { return { pcm: pcm, rate: rate }; });
    }).then(function (pack) {
      if (gen !== speechGen) return;
      if (!ctx) { speakBrowser(text, gen); return; }
      var buf = pcmToAudioBuffer(ctx, pack.pcm, pack.rate);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = function () { if (gen === speechGen) setMood('idle'); };
      src.start();
    }).catch(function () {
      if (gen === speechGen) speakBrowser(text, gen);
    });
  }

  function afterReply(data) {
    if (data.message) history.push({ role: 'student', text: data.message.text });
    else if (data.heard) history.push({ role: 'student', text: data.heard });
    history.push({ role: 'salty', text: data.reply });
    renderChat();
    if (data.status && $('saltyStatus')) {
      $('saltyStatus').textContent = 'Today: ' + data.status.remaining + ' / ' + data.status.dailyLimit + ' left';
    }
    speak(data.reply);
  }

  function sendText() {
    if (busy) return;
    var input = $('saltyInput');
    var message = (input && input.value || '').trim();
    if (!message) return;
    if ($('saltyError')) $('saltyError').textContent = '';
    busy = true;
    setMood('thinking');
    input.value = '';
    history.push({ role: 'student', text: message });
    renderChat();
    api('/api/student/salty-tutor/turn', { method: 'POST', body: { message: message, source: 'text' } }, role)
      .then(function (data) {
        // Server already stored the student line — drop the optimistic duplicate then re-add from reply path.
        history.pop();
        afterReply(data);
      })
      .catch(function (e) {
        history.pop();
        renderChat();
        setMood('idle');
        if ($('saltyError')) $('saltyError').textContent = e.message || 'Could not reach Salty.';
      })
      .then(function () { busy = false; });
  }

  function startRec() {
    if (busy || recording) return;
    unlockAudio();
    if ($('saltyError')) $('saltyError').textContent = '';
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recordChunks = [];
      var mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) recordChunks.push(ev.data); };
      mediaRecorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        finishRec();
      };
      mediaRecorder.start();
      recording = true;
      setMood('listening');
      if ($('saltyMicBtn')) $('saltyMicBtn').classList.add('on');
    }).catch(function () {
      if ($('saltyError')) $('saltyError').textContent = 'Microphone permission is needed to talk.';
    });
  }

  function stopRec() {
    if (!recording || !mediaRecorder) return;
    try { mediaRecorder.stop(); } catch (e) { recording = false; }
  }

  function finishRec() {
    recording = false;
    if ($('saltyMicBtn')) $('saltyMicBtn').classList.remove('on');
    var blob = new Blob(recordChunks, { type: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm' });
    mediaRecorder = null;
    recordChunks = [];
    if (!blob.size) { setMood('idle'); return; }
    busy = true;
    setMood('thinking');
    var fd = new FormData();
    fd.append('audio', blob, 'salty.webm');
    var token = (global.SaltApp && SaltApp.getToken) ? SaltApp.getToken(role) : '';
    fetch('/api/student/salty-tutor/stt', {
      method: 'POST',
      headers: { Authorization: token ? ('Bearer ' + token) : '' },
      body: fd
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error((body && body.error) || 'Could not hear that.');
        return body;
      });
    }).then(function (data) {
      afterReply(data);
    }).catch(function (e) {
      setMood('idle');
      if ($('saltyError')) $('saltyError').textContent = e.message || 'Could not hear that.';
    }).then(function () { busy = false; });
  }

  function show(on) {
    var root = $('saltyFloat');
    if (!root) return;
    root.classList.toggle('hidden', !on);
    if (!on) setOpen(false);
  }

  function bind() {
    if (!$('saltyFloat')) return;
    if ($('saltyFab')) $('saltyFab').addEventListener('click', function () { setOpen(!open); });
    if ($('saltyClose')) $('saltyClose').addEventListener('click', function () { setOpen(false); });
    if ($('saltySendBtn')) $('saltySendBtn').addEventListener('click', sendText);
    if ($('saltyInput')) {
      $('saltyInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
      });
    }
    if ($('saltyMicBtn')) {
      $('saltyMicBtn').addEventListener('pointerdown', function (e) {
        e.preventDefault();
        startRec();
      });
      $('saltyMicBtn').addEventListener('pointerup', stopRec);
      $('saltyMicBtn').addEventListener('pointerleave', function () { if (recording) stopRec(); });
      $('saltyMicBtn').addEventListener('pointercancel', stopRec);
    }
    if ($('saltyMute')) {
      $('saltyMute').addEventListener('change', function () {
        muteVoice = !!$('saltyMute').checked;
        if (muteVoice) stopSpeech();
      });
    }
  }

  function init(opts) {
    opts = opts || {};
    api = opts.api || (global.SaltApp && SaltApp.api);
    esc = opts.escapeHtml || (global.SaltApp && SaltApp.escapeHtml) || function (s) { return String(s || ''); };
    role = opts.role || 'student';
    bind();
    setMood('idle');
  }

  global.SaltSaltyTutor = { init: init, show: show, setOpen: setOpen };
})(window);
