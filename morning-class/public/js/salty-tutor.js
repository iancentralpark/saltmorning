/**
 * Salty — floating English/grammar tutor for content-only student portal.
 * Debrief-style talking buddy + typewriter reply; text / hold-to-talk mic in.
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
  var typeGen = 0;
  var audioCtx = null;
  var mediaRecorder = null;
  var recordChunks = [];
  var recording = false;
  var composing = false;
  var justSent = false;
  var buddyVideoBase = '';
  var buddyTalkTimer = null;

  var BUDDY = {
    idle: '/img/salt-buddy/idle-512.png',
    listening: '/img/salt-buddy/listening.png',
    thinking: '/img/salt-buddy/thinking.png',
    talking: '/img/salt-buddy/talking.png',
    happy: '/img/salt-buddy/happy.png'
  };
  var BUDDY_VIDEO = {
    speaking: '/img/salt-buddy/talking-loop',
    listening: '/img/salt-buddy/listening-loop',
    thinking: '/img/salt-buddy/thinking-loop',
    happy: '/img/salt-buddy/happy-loop'
  };
  var buddyVideoOk = { speaking: true, listening: true, thinking: true, happy: true };

  function $(id) { return document.getElementById(id); }

  function setBuddyVideoSources(base) {
    var vid = $('saltyVideo');
    if (!vid || !base || base === buddyVideoBase) return;
    buddyVideoBase = base;
    try { vid.pause(); } catch (e) { /* ignore */ }
    while (vid.firstChild) vid.removeChild(vid.firstChild);
    var webm = document.createElement('source');
    webm.src = base + '.webm';
    webm.type = 'video/webm';
    var mp4 = document.createElement('source');
    mp4.src = base + '.mp4';
    mp4.type = 'video/mp4';
    vid.appendChild(webm);
    vid.appendChild(mp4);
    vid.load();
  }

  function playBuddyVideo(mood, fallbackStill) {
    var img = $('saltyAvatar');
    var vid = $('saltyVideo');
    var frame = $('saltyBuddyFrame');
    if (!img || !vid || !frame) return;
    if (buddyTalkTimer) { clearInterval(buddyTalkTimer); buddyTalkTimer = null; }
    var base = BUDDY_VIDEO[mood];
    if (!base || !buddyVideoOk[mood]) {
      frame.classList.remove('is-speaking');
      try { vid.pause(); } catch (e) { /* ignore */ }
      vid.classList.add('hidden');
      img.classList.remove('hidden');
      img.src = BUDDY[fallbackStill] || BUDDY.idle;
      if (mood === 'speaking') {
        var openMouth = false;
        buddyTalkTimer = setInterval(function () {
          openMouth = !openMouth;
          img.src = openMouth ? BUDDY.talking : BUDDY.idle;
        }, 140);
      }
      return;
    }
    setBuddyVideoSources(base);
    if (mood === 'speaking') frame.classList.add('is-speaking');
    else frame.classList.remove('is-speaking');
    img.classList.add('hidden');
    vid.classList.remove('hidden');
    try {
      var p = vid.play();
      if (p && p.catch) {
        p.catch(function () {
          buddyVideoOk[mood] = false;
          playBuddyVideo(mood, fallbackStill);
        });
      }
    } catch (e) {
      buddyVideoOk[mood] = false;
      playBuddyVideo(mood, fallbackStill);
    }
  }

  function setMood(mood) {
    var img = $('saltyAvatar');
    var vid = $('saltyVideo');
    var frame = $('saltyBuddyFrame');
    var cap = $('saltyCaption');
    if (!img) return;
    mood = mood || 'idle';
    if (cap) {
      cap.textContent = mood === 'listening' ? 'Listening…'
        : mood === 'thinking' ? 'Thinking…'
          : mood === 'talking' ? 'Salty is talking…'
            : 'Ask Salty';
    }
    if (buddyTalkTimer) { clearInterval(buddyTalkTimer); buddyTalkTimer = null; }

    if (mood === 'talking') {
      playBuddyVideo('speaking', 'talking');
      return;
    }
    if (mood === 'listening' || mood === 'thinking' || mood === 'happy') {
      playBuddyVideo(mood, mood);
      return;
    }

    if (frame) frame.classList.remove('is-speaking');
    if (vid) {
      try { vid.pause(); } catch (e) { /* ignore */ }
      vid.classList.add('hidden');
    }
    img.classList.remove('hidden');
    img.src = BUDDY.idle;
  }

  function setYouSaid(text) {
    var el = $('saltyYouSaid');
    if (!el) return;
    if (!text) {
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    el.textContent = 'You: ' + text;
    el.classList.remove('hidden');
  }

  function setLiveText(text, typing) {
    var el = $('saltyLiveText');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-typing', !!typing && !!text);
  }

  function typeReply(fullText, onDone) {
    typeGen += 1;
    var gen = typeGen;
    var i = 0;
    var step = /[\u3131-\uD79D]/.test(fullText) ? 1 : 2;
    setLiveText('', true);
    function tick() {
      if (gen !== typeGen) return;
      i = Math.min(fullText.length, i + step);
      setLiveText(fullText.slice(0, i), i < fullText.length);
      if (i < fullText.length) {
        setTimeout(tick, 22);
      } else if (onDone) {
        onDone();
      }
    }
    tick();
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

  function clearInputHard() {
    var input = $('saltyInput');
    if (!input) return;
    input.value = '';
    // Korean IME often re-inserts the last composed char after value='' — clear again.
    requestAnimationFrame(function () {
      if (input) input.value = '';
    });
    setTimeout(function () {
      if (input) input.value = '';
      justSent = false;
    }, 80);
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
      typeGen += 1;
      setMood('idle');
      setLiveText('');
      setYouSaid('');
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
      if (history.length) {
        var last = history[history.length - 1];
        if (last.role === 'salty') setLiveText(last.text, false);
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
    if (!window.speechSynthesis) {
      if (gen === speechGen) setMood('idle');
      return;
    }
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.onend = function () { if (gen === speechGen) setMood('idle'); };
    u.onerror = function () { if (gen === speechGen) setMood('idle'); };
    window.speechSynthesis.speak(u);
  }

  function speak(text) {
    stopSpeech();
    if (muteVoice || !text) {
      setMood('idle');
      return;
    }
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
    var studentLine = (data.message && data.message.text) || data.heard || '';
    if (studentLine) {
      history.push({ role: 'student', text: studentLine });
      setYouSaid(studentLine);
    }
    var reply = data.reply || '';
    history.push({ role: 'salty', text: reply });
    renderChat();
    if (data.status && $('saltyStatus')) {
      $('saltyStatus').textContent = 'Today: ' + data.status.remaining + ' / ' + data.status.dailyLimit + ' left';
    }
    setMood('talking');
    typeReply(reply, null);
    speak(reply);
  }

  function sendText() {
    if (busy || composing) return;
    var input = $('saltyInput');
    var message = (input && input.value || '').trim();
    if (!message) return;
    if ($('saltyError')) $('saltyError').textContent = '';
    busy = true;
    justSent = true;
    setMood('thinking');
    setYouSaid(message);
    setLiveText('…', true);
    clearInputHard();
    history.push({ role: 'student', text: message });
    renderChat();
    api('/api/student/salty-tutor/turn', { method: 'POST', body: { message: message, source: 'text' } }, role)
      .then(function (data) {
        history.pop();
        afterReply(data);
      })
      .catch(function (e) {
        history.pop();
        renderChat();
        setMood('idle');
        setLiveText('');
        setYouSaid('');
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
    setLiveText('…', true);
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
      setLiveText('');
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
      $('saltyInput').addEventListener('compositionstart', function () { composing = true; });
      $('saltyInput').addEventListener('compositionend', function () {
        composing = false;
        if (justSent || busy) clearInputHard();
      });
      $('saltyInput').addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        // Avoid sending mid-IME composition (Korean etc.) — leftover last glyph bug.
        if (e.isComposing || e.keyCode === 229 || composing) return;
        e.preventDefault();
        sendText();
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
