document.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("cameraVideo");
  const canvas = document.getElementById("trackingCanvas");
  const ctx = canvas.getContext("2d");
  const startButton = document.getElementById("startCamera");
  const stopButton = document.getElementById("stopCamera");
  const cameraStatus = document.getElementById("cameraStatus");
  const handStatus = document.getElementById("handStatus");
  const placeholder = document.getElementById("cameraPlaceholder");

  let stream = null;
  let hands = null;
  let animationId = null;
  let processing = false;

  const SPEECH_LANG = "en-IN";   // same language as the Speak page
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let recognitionRestartTimer = null;
  let audioCaptureActive = false;
  let interimText = "";
  let transcript = "";
  let hintInProgress = false;
  let previousHint = null;
  let revisionUi = null;
  let selectedTopic = "";
  let timerMinutes = 2;
  let timerSeconds = 120;
  let timerRunning = false;
  let timerPausedForHint = false;
  let timerInterval = null;
  let sessionStartedAt = null;

  // ---------------------------------------------------------------
  // V-sign state + constants
  // ---------------------------------------------------------------
  const V_HOLD_MS = 900;        // how long the V must be held
  const PALM_HOLD_MS = 1200;    // how long an open palm must be held to end + save
  const MIN_HAND_SIZE = 0.10;   // wrist->middle knuckle, in frame-height units; smaller = too far away
  const V_LOST_GRACE = 250;     // forgive brief tracking dropouts
  const V_COOLDOWN_MS = 2200;   // gap between hint requests

  let vHoldStartedAt = 0;
  let vLostSince = 0;
  let vGestureTriggered = false;
  let vCooldownUntil = 0;
  let palmHoldStartedAt = 0;
  let palmLostSince = 0;
  let endingSession = false;

  let labelText = "";
  let labelOk = false;
  let labelUntil = 0;

  // Canvas effects
  let particles = [];
  let ripples = [];
  let lastVCenter = null;       // last known V position (canvas px)

  const COLORS = {
    lav: "#B9A0FF",
    warm: "#FFCA70",
    green: "#69E6A6",
    red: "#FF6B6B"
  };

  const apiBase = window.ASKBOARD_API_BASE || "http://127.0.0.1:8000";

  // ---------------------------------------------------------------
  // Injected animation styles (no CSS file changes needed)
  // ---------------------------------------------------------------
  (function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      @media (prefers-reduced-motion: no-preference) {
        @keyframes tb-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes tb-shimmer { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
        @keyframes tb-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(185,160,255,0); }
          50% { box-shadow: 0 0 24px 2px rgba(185,160,255,.28); }
        }
        #teachBackAiPanel.is-listening { animation: tb-glow 2.6s ease-in-out infinite; }
        #teachBackHint.is-thinking { animation: tb-shimmer 1.1s ease-in-out infinite; }
        #teachBackHint.is-new { animation: tb-fade-in .5s ease both; }
        #teachBackTranscript.is-updated { animation: tb-fade-in .3s ease both; }
      }
      #teachBackHint.is-new { border-left: 3px solid ${COLORS.lav}; padding-left: 12px; }
      #handStatus.tone-ok { color: ${COLORS.green} !important; }
      #handStatus.tone-bad { color: ${COLORS.red} !important; }
      #handStatus.tone-v { color: ${COLORS.lav} !important; }
    `;
    document.head.appendChild(style);
  })();

  function setStatusTone(tone) {
    handStatus.classList.remove("tone-ok", "tone-bad", "tone-v");
    if (tone) handStatus.classList.add(`tone-${tone}`);
  }

  // ---------------------------------------------------------------
  // Topic, transcript persistence, timer (unchanged behaviour)
  // ---------------------------------------------------------------
  function activeTopic() {
    return document.getElementById("topicInput")?.value.trim() || selectedTopic;
  }

  function persistTranscript() {
    const active = getActiveDocument();
    if (!active?.document_id || !transcript.trim()) return;
    try {
      const key = "askboard-teach-back-sessions";
      const sessions = JSON.parse(localStorage.getItem(key) || "[]");
      const now = new Date().toISOString();
      const item = {
        id: sessionStartedAt || `session-${Date.now()}`,
        document_id: active.document_id,
        filename: active.filename,
        topic: activeTopic(),
        transcript,
        duration_seconds: Math.max(0, timerMinutes * 60 - timerSeconds),
        started_at: sessionStartedAt || now,
        updated_at: now
      };
      localStorage.setItem(
        key,
        JSON.stringify([item, ...sessions.filter(session => session.id !== item.id)].slice(0, 20))
      );
      fetch(`${apiBase}/api/reports/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
        keepalive: true
      }).catch(() => {});
    } catch (error) {
      console.warn("Could not save teaching transcript:", error);
    }
  }

  function renderTimer() {
    const display = document.getElementById("timerDisplay");
    if (display) {
      display.textContent = `${String(Math.floor(timerSeconds / 60)).padStart(2, "0")}:${String(timerSeconds % 60).padStart(2, "0")}`;
    }
    const start = document.getElementById("timerStart");
    if (start) {
      start.innerHTML = timerRunning
        ? '<i data-lucide="pause"></i> Pause timer'
        : '<i data-lucide="play"></i> Start timer';
    }
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  function stopTimerInterval() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function startTimer() {
    if (timerSeconds <= 0) timerSeconds = timerMinutes * 60;
    timerRunning = true;
    stopTimerInterval();
    renderTimer();
    timerInterval = setInterval(() => {
      if (!timerPausedForHint && timerSeconds > 0) {
        timerSeconds -= 1;
        renderTimer();
        if (timerSeconds === 0) {
          timerRunning = false;
          stopTimerInterval();
        }
      }
    }, 1000);
  }

  function pauseTimerForHint() {
    if (timerRunning) {
      timerPausedForHint = true;
      document.getElementById("topicStatus").textContent =
        "Timer paused while AskBoard prepares your hint.";
    }
  }

  function resumeTimerAfterHint() {
    if (timerPausedForHint && timerSeconds > 0) {
      timerPausedForHint = false;
      document.getElementById("topicStatus").textContent = "Timer resumed · keep teaching.";
    }
  }

  function resetTimer() {
    timerRunning = false;
    timerPausedForHint = false;
    stopTimerInterval();
    timerSeconds = timerMinutes * 60;
    renderTimer();
  }

  async function choosePdfTopic() {
    const active = getActiveDocument();
    const status = document.getElementById("topicStatus");
    if (!active?.document_id) {
      status.textContent = "Upload a PDF on the dashboard first.";
      status.classList.add("error");
      return;
    }
    const button = document.getElementById("chooseTopic");
    button.disabled = true;
    status.classList.remove("error");
    status.textContent = "Finding a teachable topic in your PDF…";
    try {
      const response = await fetch(`${apiBase}/api/teach/topic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: active.document_id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Topic selection failed (${response.status})`);
      selectedTopic = data.topic || "";
      document.getElementById("topicInput").value = selectedTopic;
      status.textContent = selectedTopic
        ? `Topic selected${data.page ? ` · Page ${data.page}` : ""}.`
        : "No topic found.";
    } catch (error) {
      status.textContent = error.message || "Could not choose a topic.";
      status.classList.add("error");
    } finally {
      button.disabled = false;
    }
  }

  // ---------------------------------------------------------------
  // Teach-back panel
  // ---------------------------------------------------------------
  function createTeachBackPanel() {
    if (revisionUi) return;

    revisionUi = document.createElement("section");
    revisionUi.id = "teachBackAiPanel";
    revisionUi.setAttribute("aria-live", "polite");
    revisionUi.style.cssText =
      "margin:18px 0;padding:16px;border:1px solid rgba(170,147,245,.35);border-radius:16px;background:var(--panel,rgba(170,147,245,.07));color:var(--text,inherit);display:grid;gap:12px;";

    revisionUi.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <strong>Speak your explanation</strong>
        <span id="transcriptionStatus" style="font-size:.9rem;opacity:.8">Microphone starts with the camera</span>
      </div>
      <div>
        <div style="font-size:.85rem;opacity:.75;margin-bottom:6px">LIVE TRANSCRIPT</div>
        <div id="teachBackTranscript" style="min-height:48px;max-height:180px;overflow:auto;white-space:pre-wrap;line-height:1.5">Your spoken explanation will appear here.</div>
      </div>
      <div>
        <div style="font-size:.85rem;opacity:.75;margin-bottom:6px">AI HINT</div>
        <div id="teachBackHint" style="min-height:42px;white-space:pre-wrap;line-height:1.5">Hold a V sign after explaining something to request a hint based on your PDF and transcript.</div>
      </div>`;

    const anchor = handStatus?.parentElement || video.parentElement;

    if (anchor && anchor.parentElement) {
      anchor.insertAdjacentElement("afterend", revisionUi);
    } else {
      document.body.appendChild(revisionUi);
    }
  }

  function setTranscriptionStatus(message) {
    const el = document.getElementById("transcriptionStatus");
    if (el) el.textContent = message;
  }

  function appendTranscript(text) {
    const cleaned = (text || "").trim();
    if (!cleaned) return;

    transcript = `${transcript}${transcript ? " " : ""}${cleaned}`.trim();
    persistTranscript();

    const el = document.getElementById("teachBackTranscript");

    if (el) {
      el.textContent = transcript;
      el.scrollTop = el.scrollHeight;
      el.classList.remove("is-updated");
      void el.offsetWidth; // restart animation
      el.classList.add("is-updated");
    }
  }

  function getActiveDocument() {
    try {
      const raw = sessionStorage.getItem("askboard-document");
      if (!raw) return null;

      const doc = JSON.parse(raw);

      if (typeof doc === "string") {
        return { document_id: doc, filename: "Selected PDF" };
      }

      if (!doc || typeof doc !== "object") return null;

      const documentId =
        doc.document_id ||
        doc.documentId ||
        doc.id ||
        doc.document?.document_id ||
        doc.document?.id;

      const filename =
        doc.filename ||
        doc.name ||
        doc.document?.filename ||
        "Selected PDF";

      return documentId ? { document_id: documentId, filename } : null;
    } catch (error) {
      console.warn("Could not read the active AskBoard document:", error);
      return null;
    }
  }

  // ---------------------------------------------------------------
  // Speech capture: browser SpeechRecognition (same engine as the Speak page)
  // ---------------------------------------------------------------
  function renderLiveTranscript() {
    const el = document.getElementById("teachBackTranscript");
    if (!el) return;
    const live = `${transcript}${interimText ? (transcript ? " " : "") + interimText : ""}`.trim();
    el.textContent = live || "Your spoken explanation will appear here.";
    el.style.opacity = interimText ? "0.85" : "1";
    el.scrollTop = el.scrollHeight;
  }

  function createRecognition() {
    const rec = new SpeechRecognitionAPI();
    rec.lang = SPEECH_LANG;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setTranscriptionStatus(
        transcript
          ? "Listening · transcript saved in this session"
          : "Listening… speak clearly near your microphone"
      );
    };

    rec.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          appendTranscript(piece);
        } else {
          interim += piece;
        }
      }
      interimText = interim.trim();
      renderLiveTranscript();
    };

    rec.onerror = event => {
      // "no-speech" and "aborted" are routine; the onend handler restarts.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        audioCaptureActive = false;
        revisionUi?.classList.remove("is-listening");
        setTranscriptionStatus(
          "Microphone permission denied. Allow microphone access for this site and restart the camera."
        );
      } else if (event.error === "audio-capture") {
        audioCaptureActive = false;
        revisionUi?.classList.remove("is-listening");
        setTranscriptionStatus("No microphone found. Connect one and restart the camera.");
      } else if (event.error === "network") {
        setTranscriptionStatus("Speech recognition needs an internet connection. Retrying…");
      }
    };

    // Chrome/Edge end a session after a pause. Restart while we are active.
    rec.onend = () => {
      interimText = "";
      renderLiveTranscript();
      if (!audioCaptureActive) return;
      clearTimeout(recognitionRestartTimer);
      recognitionRestartTimer = setTimeout(startRecognition, 300);
    };

    return rec;
  }

  function startRecognition() {
    if (!audioCaptureActive) return;
    try {
      recognition = createRecognition();
      recognition.start();
    } catch (error) {
      console.warn("Could not start speech recognition:", error);
      recognitionRestartTimer = setTimeout(startRecognition, 800);
    }
  }

  async function startAudioCapture() {
    if (!SpeechRecognitionAPI) {
      setTranscriptionStatus(
        "Speech recognition isn't supported in this browser. Use Chrome or Edge."
      );
      return;
    }

    audioCaptureActive = true;
    revisionUi?.classList.add("is-listening");
    setTranscriptionStatus("Starting microphone…");
    startRecognition();
  }

  async function stopAudioCapture() {
    audioCaptureActive = false;
    revisionUi?.classList.remove("is-listening");
    clearTimeout(recognitionRestartTimer);
    recognitionRestartTimer = null;

    if (recognition) {
      try {
        recognition.onend = null;
        recognition.stop();
      } catch (error) {
        console.warn("Recognition already stopped:", error);
      }
      recognition = null;
    }

    interimText = "";
    setTranscriptionStatus("Microphone stopped");
  }

  // ---------------------------------------------------------------
  // AI hint
  // ---------------------------------------------------------------
  async function requestContextualHint() {
    if (hintInProgress) return;

    hintInProgress = true;
    pauseTimerForHint();

    const hintEl = document.getElementById("teachBackHint");

    if (hintEl) {
      hintEl.classList.remove("is-new");
      hintEl.classList.add("is-thinking");
      hintEl.textContent = "Giving hint…";
    }
    setTranscriptionStatus("Giving hint…");

    try {
      const spoken = `${transcript} ${interimText}`.trim();

      const activeDocument = getActiveDocument();

      if (!activeDocument?.document_id) {
        throw new Error(
          "No active PDF was found. Return to the dashboard and select a document first."
        );
      }

      if (!spoken) {
        throw new Error(
          "I detected your V sign, but no speech has been transcribed yet. Speak for a few seconds and try again."
        );
      }

      const response = await fetch(`${apiBase}/api/teach/hint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: activeDocument.document_id,
          topic: activeTopic() || spoken.slice(-1200),
          transcript: spoken,
          top_k: 4,
          previous_hint: previousHint
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.detail || `Hint request failed (${response.status})`
        );
      }

      previousHint = data.hint || null;

      if (hintEl) {
        hintEl.classList.remove("is-thinking");
        hintEl.textContent = data.hint || "I couldn't generate a hint this time.";
        void hintEl.offsetWidth;
        hintEl.classList.add("is-new");
      }

      setTranscriptionStatus("Hint received · keep explaining when you're ready");
    } catch (error) {
      console.error("Contextual hint failed:", error);

      if (hintEl) {
        hintEl.classList.remove("is-thinking");
        hintEl.textContent =
          error.message ||
          "Could not get a hint. Check that the backend is running.";
      }
    } finally {
      hintInProgress = false;
      hintEl?.classList.remove("is-thinking");
      resumeTimerAfterHint();
    }
  }

  function resetTranscript() {
    transcript = "";
    interimText = "";
    previousHint = null;

    const transcriptEl = document.getElementById("teachBackTranscript");
    const hintEl = document.getElementById("teachBackHint");

    if (transcriptEl) {
      transcriptEl.textContent = "Your spoken explanation will appear here.";
    }

    if (hintEl) {
      hintEl.classList.remove("is-new", "is-thinking");
      hintEl.textContent =
        "Hold a V sign after explaining something to request a hint based on your PDF and transcript.";
    }
  }

  function resetGestureState() {
    vHoldStartedAt = 0;
    vLostSince = 0;
    vGestureTriggered = false;
    vCooldownUntil = 0;
    palmHoldStartedAt = 0;
    palmLostSince = 0;
    labelUntil = 0;
    particles = [];
    ripples = [];
    lastVCenter = null;
    setStatusTone(null);
  }

  function setResult(text, ok) {
    labelText = text;
    labelOk = ok;
    labelUntil = Date.now() + 2500;
    handStatus.textContent = text;
    setStatusTone(ok ? "ok" : "bad");
  }

  // ---------------------------------------------------------------
  // V-sign detection
  //
  // Everything is measured as distance from the wrist (landmark 0),
  // so it survives hand rotation and tilt. Aspect-corrected so a
  // widescreen video doesn't distort distances.
  // ---------------------------------------------------------------
  // Shared geometry. d() is aspect-corrected distance; size is the
  // wrist -> middle-knuckle length, which scales with how close the hand is.
  function measureHand(lm) {
    const aspect = video.videoWidth / video.videoHeight || 1;
    const d = (a, b) =>
      Math.hypot((lm[a].x - lm[b].x) * aspect, lm[a].y - lm[b].y);
    return { aspect, d, size: d(0, 9) };
  }

  // 1 = perfectly straight finger, lower = bent.
  function straightness(d, mcp, pip, dip, tip) {
    const chain = d(mcp, pip) + d(pip, dip) + d(dip, tip);
    return chain ? d(mcp, tip) / chain : 0;
  }

  // 1 = pointing straight up the image, 0 = sideways, negative = down.
  function upness(lm, aspect, mcp, tip) {
    const dx = (lm[tip].x - lm[mcp].x) * aspect;
    const dy = lm[tip].y - lm[mcp].y;
    const len = Math.hypot(dx, dy);
    return len ? -dy / len : 0;
  }

  // Angle (degrees) between two finger directions.
  function fingerSpreadDeg(lm, aspect, mcpA, tipA, mcpB, tipB) {
    const ax = (lm[tipA].x - lm[mcpA].x) * aspect, ay = lm[tipA].y - lm[mcpA].y;
    const bx = (lm[tipB].x - lm[mcpB].x) * aspect, by = lm[tipB].y - lm[mcpB].y;
    const dot = ax * bx + ay * by;
    const len = Math.hypot(ax, ay) * Math.hypot(bx, by);
    return len ? (Math.acos(Math.max(-1, Math.min(1, dot / len))) * 180) / Math.PI : 0;
  }

  // Strict V: two long, fully straight, raised fingers with a clear gap,
  // ring + pinky firmly curled, hand big enough in frame and held upright.
  function isVSign(lm) {
    const { aspect, d, size } = measureHand(lm);
    if (size < MIN_HAND_SIZE) return false;

    // Index + middle: straight and long (not half-bent, not casual).
    const indexStraight = straightness(d, 5, 6, 7, 8) > 0.9;
    const middleStraight = straightness(d, 9, 10, 11, 12) > 0.9;
    const indexLong = d(0, 8) > size * 1.55;
    const middleLong = d(0, 12) > size * 1.55;

    // Both must point up in the air, within ~45 degrees of vertical.
    const indexUp = upness(lm, aspect, 5, 8) > 0.7;
    const middleUp = upness(lm, aspect, 9, 12) > 0.7;

    // Proper spacing: a real angle between the fingers AND a real tip gap.
    const angle = fingerSpreadDeg(lm, aspect, 5, 8, 9, 12);
    const angleOk = angle > 22 && angle < 75;
    const gapOk = d(8, 12) > size * 0.4;

    // Ring + pinky firmly curled into the palm.
    const ringCurled = d(0, 16) < size * 1.35 && straightness(d, 13, 14, 15, 16) < 0.8;
    const pinkyCurled = d(0, 20) < size * 1.25 && straightness(d, 17, 18, 19, 20) < 0.8;

    return (
      indexStraight && middleStraight && indexLong && middleLong &&
      indexUp && middleUp && angleOk && gapOk && ringCurled && pinkyCurled
    );
  }

  // Open palm: all five digits out, fingers straight, spread, hand upright.
  function isOpenPalm(lm) {
    const { aspect, d, size } = measureHand(lm);
    if (size < MIN_HAND_SIZE) return false;

    const straight =
      straightness(d, 5, 6, 7, 8) > 0.88 &&
      straightness(d, 9, 10, 11, 12) > 0.88 &&
      straightness(d, 13, 14, 15, 16) > 0.88 &&
      straightness(d, 17, 18, 19, 20) > 0.85;

    const long =
      d(0, 8) > size * 1.5 &&
      d(0, 12) > size * 1.55 &&
      d(0, 16) > size * 1.5 &&
      d(0, 20) > size * 1.3;

    const spread = d(8, 20) > size * 0.7;      // index tip far from pinky tip
    const thumbOut = d(4, 17) > size * 0.85;   // thumb away from the palm
    const upright = upness(lm, aspect, 9, 12) > 0.6;

    return straight && long && spread && thumbOut && upright;
  }

  // ---------------------------------------------------------------
  // Canvas drawing + effects (canvas is mirrored by CSS, so text is
  // flipped back before drawing)
  // ---------------------------------------------------------------
  function drawText(text, x, y, color, size, align = "left") {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.font = `bold ${size}px sans-serif`;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function spawnBurst(x, y, color) {
    for (let i = 0; i < 36; i++) {
      const angle = (Math.PI * 2 * i) / 36 + Math.random() * 0.4;
      const speed = 2 + Math.random() * 5;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        size: 2 + Math.random() * 3,
        color: Math.random() > 0.5 ? color : COLORS.warm
      });
    }
    ripples.push({ x, y, r: 10, life: 1, color });
    ripples.push({ x, y, r: 4, life: 1, color: COLORS.lav });
  }

  function drawEffects() {
    // Ripples
    for (const r of ripples) {
      r.r += 5;
      r.life -= 0.03;
      if (r.life <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, r.life);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ripples = ripples.filter(r => r.life > 0);

    // Particles
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12; // gravity
      p.vx *= 0.985;
      p.life -= 0.022;
      if (p.life <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life + 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    particles = particles.filter(p => p.life > 0);
  }

  function drawVSign(lm, progress, triggered) {
    const w = canvas.width;
    const h = canvas.height;
    const t = performance.now() / 1000;
    const base = triggered ? COLORS.green : COLORS.lav;

    const P = i => ({ x: lm[i].x * w, y: lm[i].y * h });

    // Glowing finger chains
    const chains = [[5, 6, 7, 8], [9, 10, 11, 12]];
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = base;
    ctx.shadowBlur = 18 + Math.sin(t * 5) * 6;

    for (const chain of chains) {
      const a = P(chain[0]);
      const b = P(chain[3]);
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, base);
      grad.addColorStop(1, COLORS.warm);

      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(4, w / 150);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      for (let i = 1; i < chain.length; i++) {
        const p = P(chain[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Knuckle web connecting the two fingers
    const k1 = P(5);
    const k2 = P(9);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = base;
    ctx.lineWidth = Math.max(2, w / 260);
    ctx.beginPath();
    ctx.moveTo(k1.x, k1.y);
    ctx.lineTo(k2.x, k2.y);
    ctx.stroke();
    ctx.restore();

    // Joint dots
    for (const chain of chains) {
      for (let i = 0; i < chain.length; i++) {
        const p = P(chain[i]);
        const isTip = i === chain.length - 1;
        ctx.save();
        ctx.shadowColor = isTip ? COLORS.warm : base;
        ctx.shadowBlur = isTip ? 16 : 6;
        ctx.fillStyle = isTip ? COLORS.warm : "#FFFFFF";
        ctx.beginPath();
        ctx.arc(p.x, p.y, isTip ? w / 70 : w / 130, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Progress ring around the V (fills during the hold)
    const t8 = P(8);
    const t12 = P(12);
    const cx = (t8.x + t12.x) / 2;
    const cy = (t8.y + t12.y) / 2;
    const radius = Math.max(34, Math.hypot(t8.x - t12.x, t8.y - t12.y) * 0.9);
    lastVCenter = { x: cx, y: cy };

    ctx.save();
    ctx.lineCap = "round";

    // track
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // progress
    ctx.shadowColor = base;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = base;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress)
    );
    ctx.stroke();
    ctx.restore();

    // Spinner while the hint is being generated
    if (hintInProgress) {
      ctx.save();
      ctx.strokeStyle = COLORS.warm;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.shadowColor = COLORS.warm;
      ctx.shadowBlur = 12;
      const spin = t * 5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 12, spin, spin + Math.PI * 0.6);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPalm(lm, progress) {
    const w = canvas.width;
    const h = canvas.height;
    const t = performance.now() / 1000;
    const P = i => ({ x: lm[i].x * w, y: lm[i].y * h });

    const links = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17]
    ];

    ctx.save();
    ctx.lineCap = "round";
    ctx.shadowColor = COLORS.warm;
    ctx.shadowBlur = 16 + Math.sin(t * 5) * 5;
    ctx.strokeStyle = COLORS.warm;
    ctx.lineWidth = Math.max(3, w / 200);
    for (const [a, b] of links) {
      const pa = P(a);
      const pb = P(b);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.restore();

    [4, 8, 12, 16, 20].forEach(i => {
      const p = P(i);
      ctx.save();
      ctx.shadowColor = COLORS.warm;
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(p.x, p.y, w / 90, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Progress ring centred on the palm
    const c = P(9);
    const radius = Math.max(40, Math.hypot(P(0).x - c.x, P(0).y - c.y) * 1.2);
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowColor = COLORS.warm;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = COLORS.warm;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress));
    ctx.stroke();
    ctx.restore();

    lastVCenter = { x: c.x, y: c.y };
  }

  function drawLabelPill() {
    const now = Date.now();
    if (now >= labelUntil) return;

    const fade = Math.min(1, (labelUntil - now) / 400);
    const size = Math.max(15, canvas.width / 32);
    const text = labelText.toUpperCase();
    const color = labelOk ? COLORS.green : COLORS.red;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.font = `bold ${size}px sans-serif`;
    const tw = ctx.measureText(text).width;
    const padX = 16;
    const padY = 10;
    const bw = tw + padX * 2;
    const bh = size + padY * 2;
    const x = canvas.width - 15 - bw;
    const y = 15;

    ctx.fillStyle = "rgba(23,20,33,.78)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, bh / 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = fade;
    drawText(text, canvas.width - 15 - padX, y + padY + size * 0.82, color, size, "left");
    ctx.restore();
  }

  function resizeCanvas() {
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  // ---------------------------------------------------------------
  // V-sign hold logic
  // ---------------------------------------------------------------
  function endSession() {
    if (endingSession) return;
    endingSession = true;

    // Fold in any half-finished sentence, then save before anything shuts down.
    if (interimText) {
      appendTranscript(interimText);
      interimText = "";
    }
    const hadText = Boolean(transcript.trim());
    persistTranscript();

    timerRunning = false;
    timerPausedForHint = false;
    stopTimerInterval();
    renderTimer();

    setTimeout(() => {
      stopCamera();
      handStatus.textContent = hadText
        ? "Session saved · camera off."
        : "Camera off · nothing was transcribed, so nothing was saved.";
      setTranscriptionStatus(hadText ? "Session saved" : "Nothing to save");
      endingSession = false;
    }, 900);
  }

  function handlePalm(landmarks, now) {
    palmLostSince = 0;
    vHoldStartedAt = 0;
    vLostSince = 0;
    vGestureTriggered = false;

    if (!palmHoldStartedAt) palmHoldStartedAt = now;
    const heldFor = now - palmHoldStartedAt;
    const progress = Math.min(1, heldFor / PALM_HOLD_MS);

    drawPalm(landmarks, progress);

    if (heldFor < PALM_HOLD_MS) {
      handStatus.textContent = "Open palm · hold to save and turn the camera off…";
      setStatusTone("v");
    } else if (!endingSession) {
      spawnBurst(lastVCenter.x, lastVCenter.y, COLORS.warm);
      setResult("Palm held · saving session", true);
      endSession();
    }
  }

  function handleGestures(landmarks, now) {
    if (endingSession) {
      drawPalm(landmarks, 1);
      return;
    }

    if (isOpenPalm(landmarks)) {
      handlePalm(landmarks, now);
      return;
    }

    // Not a palm: forgive a brief dropout, then reset the palm hold.
    if (palmHoldStartedAt) {
      if (!palmLostSince) palmLostSince = now;
      if (now - palmLostSince > V_LOST_GRACE) {
        palmHoldStartedAt = 0;
        palmLostSince = 0;
      }
    }

    const vSign = isVSign(landmarks);

    if (!vSign) {
      if (!vLostSince) vLostSince = now;

      if (now - vLostSince > V_LOST_GRACE) {
        vHoldStartedAt = 0;
        vGestureTriggered = false;
      }

      if (now >= labelUntil && now >= vCooldownUntil) {
        handStatus.textContent = "Show a clear V for a hint · open palm to end and save.";
        setStatusTone(null);
      }
      return;
    }

    vLostSince = 0;
    if (!vHoldStartedAt) vHoldStartedAt = now;

    const heldFor = now - vHoldStartedAt;
    const progress = Math.min(1, heldFor / V_HOLD_MS);

    drawVSign(landmarks, progress, vGestureTriggered);

    if (heldFor < V_HOLD_MS) {
      handStatus.textContent = `V sign detected · hold ${Math.ceil((V_HOLD_MS - heldFor) / 100)}…`;
      setStatusTone("v");
    } else if (!vGestureTriggered && now >= vCooldownUntil) {
      vGestureTriggered = true;
      vCooldownUntil = now + V_COOLDOWN_MS;
      if (lastVCenter) spawnBurst(lastVCenter.x, lastVCenter.y, COLORS.green);
      setResult("V sign detected · giving hint", true);
      requestContextualHint();
    } else if (vGestureTriggered && now >= labelUntil) {
      handStatus.textContent = "V sign held · release to request another hint.";
      setStatusTone("ok");
    }
  }

  // ---------------------------------------------------------------
  // MediaPipe + camera
  // ---------------------------------------------------------------
  async function initializeHands() {
    if (typeof Hands === "undefined") {
      throw new Error(
        "MediaPipe Hands failed to load. Check your internet connection."
      );
    }

    hands = new Hands({
      locateFile: file =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    hands.onResults(results => {
      resizeCanvas();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const now = Date.now();
      const landmarks = results.multiHandLandmarks?.[0];

      if (!landmarks) {
        if (!vLostSince) vLostSince = now;
        if (now - vLostSince > V_LOST_GRACE) {
          vHoldStartedAt = 0;
          vGestureTriggered = false;
          palmHoldStartedAt = 0;
        }
        if (now >= labelUntil) {
          handStatus.textContent = "No hand detected · Show a V sign for a hint, open palm to end and save.";
          setStatusTone(null);
        }
      } else {
        handleGestures(landmarks, now);
      }

      drawEffects();
      drawLabelPill();
    });
  }

  async function processFrames() {
    if (!stream || !hands) return;

    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      !processing
    ) {
      processing = true;

      try {
        await hands.send({ image: video });
      } catch (error) {
        console.error("Hand tracking error:", error);
        handStatus.textContent = "Hand tracking encountered an error.";
      } finally {
        processing = false;
      }
    }

    if (stream) {
      animationId = requestAnimationFrame(processFrames);
    }
  }

  async function startCamera() {
    startButton.disabled = true;
    cameraStatus.textContent = "Requesting camera permission...";

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

      video.srcObject = stream;
      await video.play();

      resetGestureState();
      resetTranscript();
      sessionStartedAt = new Date().toISOString();
      createTeachBackPanel();

      await initializeHands();
      await startAudioCapture();

      placeholder.style.display = "none";
      cameraStatus.textContent = "Camera is running";
      handStatus.textContent =
        "Hold a clear V for a hint · hold an open palm to end and save.";

      stopButton.disabled = false;
      processFrames();
    } catch (error) {
      console.error(error);

      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }

      video.srcObject = null;
      startButton.disabled = false;
      cameraStatus.textContent = "Could not start camera";

      handStatus.textContent =
        error.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access in your browser."
          : error.message || "Check your camera and try again.";
    }
  }

  function stopCamera() {
    stopAudioCapture();

    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    if (hands) {
      hands.close();
      hands = null;
    }

    video.srcObject = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    resetGestureState();

    placeholder.style.display = "flex";
    cameraStatus.textContent = "Camera is off";
    handStatus.textContent = "Hand tracking stopped.";

    startButton.disabled = false;
    stopButton.disabled = true;
    processing = false;
  }

  // ---------------------------------------------------------------
  // Init + event wiring
  // ---------------------------------------------------------------
  createTeachBackPanel();

  const activeDocument = getActiveDocument();
  const topicDocument = document.getElementById("topicDocument");
  if (topicDocument) {
    topicDocument.textContent = activeDocument?.filename || "No document selected";
  }

  document.getElementById("chooseTopic")?.addEventListener("click", choosePdfTopic);

  document.getElementById("topicInput")?.addEventListener("input", event => {
    selectedTopic = event.target.value.trim();
    const status = document.getElementById("topicStatus");
    if (status && selectedTopic) {
      status.classList.remove("error");
      status.textContent = "Topic ready · start your timer when you are ready.";
    }
  });

  document.querySelectorAll(".timer-choice").forEach(button =>
    button.addEventListener("click", () => {
      timerMinutes = Number(button.dataset.minutes);
      document
        .querySelectorAll(".timer-choice")
        .forEach(item => item.classList.remove("is-selected"));
      button.classList.add("is-selected");
      resetTimer();
    })
  );

  document.getElementById("timerStart")?.addEventListener("click", () => {
    if (timerRunning) {
      timerRunning = false;
      stopTimerInterval();
      renderTimer();
    } else {
      startTimer();
    }
  });

  document.getElementById("timerReset")?.addEventListener("click", resetTimer);
  renderTimer();

  startButton.addEventListener("click", startCamera);
  stopButton.addEventListener("click", stopCamera);
  window.addEventListener("beforeunload", () => {
    persistTranscript();
    stopCamera();
  });
});