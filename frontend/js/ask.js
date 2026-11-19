document.addEventListener("DOMContentLoaded", () => {
  const API_BASE = window.ASKBOARD_API_BASE || "http://127.0.0.1:8000";
  const DOC_KEY = "askboard-document";      // written by app.js after a successful upload (sessionStorage)
  const HISTORY_KEY = "askboard-history";   // saved Q&A, read later by the Revision page (localStorage)
  const HISTORY_LIMIT = 200;
  const HISTORY_SHOWN = 8;
  const TOP_K = 4;

  const $ = (selector) => document.querySelector(selector);
  const root = document.documentElement;
  const nav = $("#mainNav");
  const menuToggle = $("#menuToggle");
  const themeToggle = $("#themeToggle");
  const toast = $("#toast");
  const input = $("#questionInput");
  const askButton = $("#askButton");
  const askLabel = $("#askLabel");
  const askBox = $("#askBox");
  const noDoc = $("#noDoc");
  const docName = $("#docName");
  const answerCard = $("#answerCard");
  const answerIconSlot = $("#answerIconSlot");
  const answerTitle = $("#answerTitle");
  const answerQuestion = $("#answerQuestion");
  const answerBody = $("#answerBody");
  const answerPages = $("#answerPages");
  const answerSources = $("#answerSources");
  const answerSourceList = $("#answerSourceList");
  const answerMeta = $("#answerMeta");
  const historySection = $("#historySection");
  const historyList = $("#historyList");
  let toastTimer;
  let busy = false;

  /* ── Shared shell: icons, toast, theme, navigation (same behaviour as the dashboard) ── */
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
  $("#searchFocus")?.addEventListener("click", () => input?.focus());

  /* ── Storage helpers ── */
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
      // Storage full: keep only the newest entries and try once more.
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
    const next = [entry, ...loadHistory().filter((item) => !sameQuestion(item))].slice(0, HISTORY_LIMIT);
    return saveHistory(next);
  };

  /* ── Current document ── */
  const doc = readJson(sessionStorage, DOC_KEY, null);
  const documentId = typeof doc?.document_id === "string" ? doc.document_id : "";
  const filename = doc?.filename || "Uploaded PDF";
  docName.textContent = documentId ? filename : "No document";

  if (!documentId) {
    noDoc.hidden = false;
    askBox.hidden = true;
  }

  /* ── Rendering ── */
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

  // Gemini answers may contain **bold** and [Page N] citations; build DOM nodes so nothing is parsed as HTML.
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
    answerQuestion.textContent = "";
    answerBody.replaceChildren();
    answerPages.replaceChildren();
    answerSources.hidden = true;
    answerSources.open = false;
    answerSourceList.replaceChildren();
    answerMeta.replaceChildren();
  };

  const showLoading = (question) => {
    resetAnswerParts();
    setHead("loading", "Searching your notes…", "loader-circle");
    answerQuestion.textContent = question;
    answerBody.textContent = "Finding the most relevant passages and writing an answer.";
    renderIcons();
  };

  const showError = (message) => {
    resetAnswerParts();
    setHead("error", "Couldn’t get an answer", "circle-alert");
    answerBody.textContent = message;
    renderIcons();
  };

  const showAnswer = (entry, { savedNow = false } = {}) => {
    resetAnswerParts();
    setHead("done", "AI answer", "sparkles");
    answerQuestion.textContent = entry.question;
    renderAnswerText(answerBody, entry.answer);

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
    renderIcons();
  };

  const renderHistory = () => {
    const entries = documentId ? loadHistory().filter((item) => item.document_id === documentId) : [];
    historyList.replaceChildren();
    historySection.hidden = entries.length === 0;

    entries.slice(0, HISTORY_SHOWN).forEach((entry) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-item";

      const question = document.createElement("span");
      question.className = "history-q";
      question.textContent = entry.question;
      question.title = entry.question;

      const meta = document.createElement("span");
      meta.className = "history-meta";
      const pages = pagesOf(entry.sources).map((page) => `p.${page}`).join(", ");
      meta.textContent = [pages, formatWhen(entry.created_at)].filter(Boolean).join(" · ");

      button.append(question, meta);
      button.addEventListener("click", () => {
        input.value = entry.question;
        updateButton();
        showAnswer(entry);
        answerCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      li.append(button);
      historyList.append(li);
    });
  };

  /* ── Asking ── */
  const errorMessage = (status, detail) => {
    if (status === 404) return "This document is no longer in the search index. Upload it again on the dashboard.";
    if (typeof detail === "string" && detail) return detail;
    return `The server returned an error (${status}).`;
  };

  const updateButton = () => {
    askButton.disabled = busy || !documentId || !input.value.trim();
  };

  const setBusy = (state) => {
    busy = state;
    askButton.classList.toggle("is-busy", state);
    askLabel.textContent = state ? "Thinking…" : "Ask question";
    input.disabled = state;
    updateButton();
  };

  const ask = async () => {
    const question = input.value.trim();
    if (!question || !documentId || busy) return;

    setBusy(true);
    showLoading(question);
    try {
      const response = await fetch(`${API_BASE}/api/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId, question, top_k: TOP_K }),
      });

      let data = null;
      try { data = await response.json(); } catch { /* error body was not JSON */ }
      if (!response.ok) throw new Error(errorMessage(response.status, data?.detail));

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
        created_at: new Date().toISOString(),
      };

      // Only keep answers that are backed by at least one source passage.
      const saved = sources.length > 0 && addToHistory(entry);
      showAnswer(entry, { savedNow: saved });
      renderHistory();
    } catch (error) {
      showError(error instanceof TypeError
        ? "Could not reach the AskBoard API. Make sure the backend is running on port 8000."
        : error.message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
      input.focus();
    }
  };

  askButton.addEventListener("click", ask);
  input.addEventListener("input", updateButton);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask();
    }
  });

  if (!documentId) input.disabled = true;
  renderIcons();
  renderHistory();
  updateButton();
  if (documentId) input.focus();
});