document.addEventListener("DOMContentLoaded", () => {
  const API_BASE = window.ASKBOARD_API_BASE || "http://127.0.0.1:8000";
  const SPEECH_LANG = "en-IN";              // language used for listening and reading aloud
  const DOC_KEY = "askboard-document";      // written by app.js after a successful upload (sessionStorage)
  const HISTORY_KEY = "askboard-history";   // saved Q&A shared with the Ask page and the future Revision page
  const HISTORY_LIMIT = 200;
  const TOP_K = 4;

  const $ = (selector) => document.querySelector(selector);
  const root = document.documentElement;
  const nav = $("#mainNav");
  const menuToggle = $("#menuToggle");
  const themeToggle = $("#themeToggle");
  const toast = $("#toast");
  const orb = $("#orb");
  const micButton = $("#micButton");
  const statusLine = $("#voiceStatus");
  const noDoc = $("#noDoc");
  const result = $("#result");
  const saidText = $("#saidText");
  const answerCard = $("#answerCard");
  const answerIconSlot = $("#answerIconSlot");
  const answerTitle = $("#answerTitle");
  const answerBody = $("#answerBody");
  const answerPages = $("#answerPages");
  const answerSources = $("#answerSources");
  const answerSourceList = $("#answerSourceList");
  const answerMeta = $("#answerMeta");
  const playRow = $("#playRow");
  const playButton = $("#playButton");
  let toastTimer;

  /* ── Shared shell: icons, toast, theme, navigation (same behaviour as the other pages) ── */
  const renderIcons = () => {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    } else {
      console.error("AskBoard: Lucide failed to load.");
    }
  };

  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  };

  const syncThemeLabel = () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    themeToggle?.setAttribute("aria-label", `Switch to ${next} theme`);
  };
  syncThemeLabel();
  themeToggle?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("askboard-theme", next); } catch { /* storage unavailable */ }
    syncThemeLabel();
  });

  const setMenu = (open) => {
    nav?.classList.toggle("open", open);
    menuToggle?.setAttribute("aria-expanded", String(open));
  };
  menuToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    setMenu(!nav.classList.contains("open"));
  });
  document.addEventListener("click", (event) => {
    if (!nav?.contains(event.target)) setMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });

  document.querySelectorAll("[data-view]").forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.dataset.view;
      showToast(view === "Revision"
        ? "Revision will list your saved questions and answers — coming soon."
        : `${view} workspace is ready for your next session.`);
      setMenu(false);
    });
  });
  $("#searchFocus")?.addEventListener("click", () => micButton?.focus());

  /* ── Storage helpers (same history format as the Ask page) ── */
  const readJson = (storage, key, fallback) => {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const loadHistory = () => {
    const list = readJson(localStorage, HISTORY_KEY, []);
    return Array.isArray(list) ? list : [];
  };

  const saveHistory = (list) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      return true;
    } catch {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
        return true;
      } catch {
        return false;
      }
    }
  };

  const addToHistory = (entry) => {
    const sameQuestion = (item) =>
      item.document_id === entry.document_id &&
      String(item.question).trim().toLowerCase() === entry.question.trim().toLowerCase();
    return saveHistory([entry, ...loadHistory().filter((item) => !sameQuestion(item))].slice(0, HISTORY_LIMIT));
  };

  /* ── Current document ── */
  const doc = readJson(sessionStorage, DOC_KEY, null);
  const documentId = typeof doc?.document_id === "string" ? doc.document_id : "";
  const filename = doc?.filename || "Uploaded PDF";

  /* ── Browser support ── */
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  const canListen = Boolean(documentId && Recognition);

  /* ── Answer rendering (builds DOM nodes, so nothing is parsed as HTML) ── */
  const formatWhen = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const pagesOf = (sources) =>
    [...new Set((sources || []).map((source) => source.page).filter((page) => page != null))]
      .sort((a, b) => a - b);

  const makeChip = (label) => {
    const chip = document.createElement("span");
    chip.className = "source-chip";
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", "file-text");
    chip.append(icon, document.createTextNode(label));
    return chip;
  };

  const TOKEN = /(\*\*[^*\n]+\*\*|\[Pages? [\d,\s]+\])/;
  const renderInline = (parent, line) => {
    line.split(TOKEN).forEach((part) => {
      if (!part) return;
      if (/^\*\*[^*\n]+\*\*$/.test(part)) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        parent.append(strong);
      } else if (/^\[Pages? [\d,\s]+\]$/.test(part)) {
        const cite = document.createElement("span");
        cite.className = "cite";
        cite.textContent = part.slice(1, -1);
        parent.append(cite);
      } else {
        parent.append(document.createTextNode(part));
      }
    });
  };

  const renderAnswerText = (container, text) => {
    container.replaceChildren();
    String(text).trim().split(/\n{2,}/).forEach((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return;
      if (lines.every((line) => /^[*-]\s+/.test(line))) {
        const list = document.createElement("ul");
        lines.forEach((line) => {
          const item = document.createElement("li");
          renderInline(item, line.replace(/^[*-]\s+/, ""));
          list.append(item);
        });
        container.append(list);
      } else {
        const paragraph = document.createElement("p");
        lines.forEach((line, index) => {
          if (index) paragraph.append(document.createElement("br"));
          renderInline(paragraph, line);
        });
        container.append(paragraph);
      }
    });
  };

  const setHead = (state, title, icon) => {
    answerCard.hidden = false;
    answerCard.classList.toggle("is-loading", state === "loading");
    answerCard.classList.toggle("is-error", state === "error");
    answerTitle.textContent = title;
    answerIconSlot.innerHTML = `<i data-lucide="${icon}"></i>`;
  };

  const resetAnswerParts = () => {
    answerBody.replaceChildren();
    answerPages.replaceChildren();
    answerSources.hidden = true;
    answerSources.open = false;
    answerSourceList.replaceChildren();
    answerMeta.replaceChildren();
    playRow.hidden = true;
  };

  const showHeard = (text, interim) => {
    result.hidden = false;
    saidText.textContent = text ? `“${text}”` : "";
    saidText.classList.toggle("is-interim", interim);
  };

  const showLoading = () => {
    resetAnswerParts();
    setHead("loading", "Searching your notes…", "loader-circle");
    answerBody.textContent = "Finding the most relevant passages and writing an answer.";
    renderIcons();
  };

  const showError = (message) => {
    resetAnswerParts();
    setHead("error", "Couldn’t get an answer", "circle-alert");
    answerBody.textContent = message;
    renderIcons();
  };

  let currentAnswerText = "";

  const showAnswer = (entry, { savedNow = false } = {}) => {
    resetAnswerParts();
    setHead("done", "AskBoard’s answer", "sparkles");
    showHeard(entry.question, false);
    renderAnswerText(answerBody, entry.answer);
    currentAnswerText = entry.answer;

    pagesOf(entry.sources).forEach((page) => answerPages.append(makeChip(`Page ${page}`)));

    if (entry.sources?.length) {
      entry.sources.forEach((source) => {
        const item = document.createElement("div");
        item.className = "source-item";
        item.append(makeChip(source.reference || `Page ${source.page}`));
        const text = document.createElement("p");
        text.textContent = source.text;
        item.append(text);
        answerSourceList.append(item);
      });
      answerSources.hidden = false;
    }

    if (savedNow) {
      const icon = document.createElement("i");
      icon.setAttribute("data-lucide", "check");
      answerMeta.append(icon, document.createTextNode("Saved for revision"));
    } else if (entry.created_at) {
      answerMeta.textContent = `Saved ${formatWhen(entry.created_at)}`;
    }

    playRow.hidden = !synth;
    renderIcons();
  };

  /* ── Read the answer aloud ── */
  let speaking = false;

  const setPlayButton = (isPlaying) => {
    speaking = isPlaying;
    playButton.classList.toggle("is-playing", isPlaying);
    playButton.innerHTML = isPlaying
      ? '<i data-lucide="square"></i><span>Stop</span>'
      : '<i data-lucide="volume-2"></i><span>Play answer</span>';
    renderIcons();
  };

  const stopSpeaking = () => {
    if (!synth) return;
    synth.cancel();
    if (speaking) setPlayButton(false);
  };

  const speechText = (text) =>
    String(text)
      .replace(/\s*\[Pages? ([\d,\s]+)\]/g, (_, pages) => `, page ${pages.trim()}`)
      .replace(/\*\*/g, "")
      .replace(/^[*-]\s+/gm, "");

  const pickVoice = () => {
    const voices = synth.getVoices();
    const lang = SPEECH_LANG.toLowerCase();
    return voices.find((voice) => voice.lang.toLowerCase() === lang)
      || voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2)))
      || null;
  };

  const speakAnswer = () => {
    if (!synth || !currentAnswerText) return;
    synth.cancel();

    // Short chunks avoid a browser bug where long utterances stop mid-way.
    const chunks = speechText(currentAnswerText).split(/(?<=[.!?])\s+|\n+/).map((chunk) => chunk.trim()).filter(Boolean);
    if (!chunks.length) return;

    const voice = pickVoice();
    setPlayButton(true);
    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = SPEECH_LANG;
      if (voice) utterance.voice = voice;
      if (index === chunks.length - 1) {
        utterance.onend = () => setPlayButton(false);
        utterance.onerror = () => setPlayButton(false);
      }
      synth.speak(utterance);
    });
  };

  playButton.addEventListener("click", () => (speaking ? stopSpeaking() : speakAnswer()));

  /* ── Voice state ── */
  const BUTTON = {
    idle: { icon: "mic", label: "Start speaking", status: "Tap Start speaking, then ask your question." },
    listening: { icon: "square", label: "Stop listening", status: "Listening… ask your question out loud." },
    thinking: { icon: "loader-circle", label: "Finding answer…", status: "Searching your notes…" },
  };

  let state = "idle";
  let recognition = null;
  let finalText = "";
  let interimText = "";
  let recognitionError = "";
  let lastEntry = null;
  let leaving = false;

  const setState = (next, statusOverride, isError = false) => {
    state = next;
    const { icon, label, status } = BUTTON[next];
    orb.classList.toggle("is-listening", next === "listening");
    orb.classList.toggle("is-thinking", next === "thinking");
    micButton.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
    micButton.disabled = next === "thinking" || !canListen;
    micButton.classList.toggle("is-busy", next === "thinking");
    statusLine.textContent = statusOverride ?? status;
    statusLine.classList.toggle("is-error", isError);
    renderIcons();
  };

  const listenErrorMessage = (code) => {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed":
        return "Microphone access is blocked. Allow the microphone for this site in the address bar, then try again.";
      case "no-speech":
        return "I didn’t hear anything. Tap Start speaking and try again.";
      case "audio-capture":
        return "No microphone was found. Connect one and try again.";
      case "network":
        return "Speech recognition needs an internet connection. Check your connection and try again.";
      case "language-not-supported":
        return "This browser doesn’t support the selected speech language.";
      default:
        return "Something went wrong while listening. Try again.";
    }
  };

  const apiErrorMessage = (status, detail) => {
    if (status === 404) return "This document is no longer in the search index. Upload it again on the dashboard.";
    if (typeof detail === "string" && detail) return detail;
    return `The server returned an error (${status}).`;
  };

  const submitQuestion = async (question) => {
    setState("thinking");
    showHeard(question, false);
    showLoading();
    try {
      const response = await fetch(`${API_BASE}/api/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId, question, top_k: TOP_K }),
      });

      let data = null;
      try { data = await response.json(); } catch { /* error body was not JSON */ }
      if (!response.ok) throw new Error(apiErrorMessage(response.status, data?.detail));

      const sources = Array.isArray(data?.sources)
        ? data.sources.map(({ page, reference, text }) => ({ page, reference, text }))
        : [];
      const entry = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        document_id: documentId,
        filename,
        question,
        answer: data?.answer || "I couldn’t generate an answer.",
        sources,
        mode: "voice",
        created_at: new Date().toISOString(),
      };

      // Only keep answers that are backed by at least one source passage.
      const saved = sources.length > 0 && addToHistory(entry);
      lastEntry = entry;
      showAnswer(entry, { savedNow: saved });
      setState("idle");
    } catch (error) {
      showError(error instanceof TypeError
        ? "Could not reach the AskBoard API. Make sure the backend is running on port 8000."
        : error.message || "Something went wrong. Try again.");
      setState("idle", "Tap Start speaking to try again.");
    }
  };

  const handleEnd = () => {
    recognition = null;
    if (leaving) return;
    const text = (finalText || interimText).trim();

    if (recognitionError) {
      setState("idle", listenErrorMessage(recognitionError), true);
      if (lastEntry) showAnswer(lastEntry); else result.hidden = true;
      return;
    }
    if (!text) {
      setState("idle", "I didn’t catch that. Tap Start speaking and try again.", true);
      if (lastEntry) showAnswer(lastEntry); else result.hidden = true;
      return;
    }
    submitQuestion(text);
  };

  const startListening = () => {
    if (state !== "idle" || !canListen) return;
    stopSpeaking();
    finalText = "";
    interimText = "";
    recognitionError = "";

    recognition = new Recognition();
    recognition.lang = SPEECH_LANG;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setState("listening");
    recognition.onresult = (event) => {
      interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += piece; else interimText += piece;
      }
      answerCard.hidden = true;
      showHeard(`${finalText}${interimText}`.trim(), true);
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted") recognitionError = event.error;
    };
    recognition.onend = handleEnd;

    try {
      recognition.start();
    } catch {
      recognition = null;
      setState("idle", "Couldn’t start the microphone. Try again.", true);
    }
  };

  micButton.addEventListener("click", () => {
    if (state === "idle") startListening();
    else if (state === "listening") recognition?.stop();
  });

  window.addEventListener("pagehide", () => {
    leaving = true;
    try { recognition?.abort(); } catch { /* already stopped */ }
    synth?.cancel();
  });

  /* ── Initial state ── */
  if (!documentId) {
    noDoc.hidden = false;
    setState("idle", "Upload a PDF on the dashboard to start.");
  } else if (!Recognition) {
    setState("idle", "Voice input isn’t supported in this browser. Use Chrome or Edge, or type your question on the Ask page.", true);
  } else {
    setState("idle");
  }
  renderIcons();
});