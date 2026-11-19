document.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;
  const nav = document.querySelector("#mainNav");
  const menuToggle = document.querySelector("#menuToggle");
  const themeToggle = document.querySelector("#themeToggle");
  const toast = document.querySelector("#toast");
  const fileInput = document.querySelector("#pdfFileInput");
  const uploadButtons = document.querySelectorAll("[data-upload]");
  const extractResult = document.querySelector("#extractResult");
  const extractFilename = document.querySelector("#extractFilename");
  const extractMeta = document.querySelector("#extractMeta");
  const extractCharacterCount = document.querySelector("#extractCharacterCount");
  const extractText = document.querySelector("#extractText");
  const extractEyebrow = extractResult?.querySelector(".eyebrow");
  let toastTimer;

  const DOC_KEY = "askboard-document";      // current document (sessionStorage, this tab)
  const LIBRARY_KEY = "askboard-library";   // every uploaded document (localStorage)
  const LIBRARY_LIMIT = 50;

  const renderIcons = () => {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    } else {
      console.error("AskBoard: Lucide failed to load.");
    }
  };
  renderIcons();

  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  };
  window.askboardToast = showToast; // lets home.js reuse the same toast

  /* ── Theme (the initial value is set by the inline script in <head>) ── */
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

  /* ── Navigation ── */
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

  // Items that are not built yet say so honestly.
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.addEventListener("click", () => {
      showToast(`${item.dataset.view} is coming soon.`);
      setMenu(false);
    });
  });

  document.querySelector("#notifyButton")?.addEventListener("click", () => showToast("You’re all caught up."));
  document.querySelector("#searchFocus")?.addEventListener("click", () => {
    const search = document.querySelector("#documentSearch");
    search?.scrollIntoView({ behavior: "smooth", block: "center" });
    search?.focus({ preventScroll: true });
  });

  /* ── PDF upload + extraction (shared by every upload button) ── */
  uploadButtons.forEach((button) => {
    button.dataset.label = button.querySelector("strong")?.textContent || "";
    button.addEventListener("click", () => fileInput?.click());
  });

  const setUploading = (busy) => {
    uploadButtons.forEach((button) => {
      button.disabled = busy;
      const label = button.querySelector("strong");
      if (label) label.textContent = busy ? "Extracting…" : button.dataset.label;
    });
  };

  const readSavedDocument = () => {
    try { return JSON.parse(sessionStorage.getItem(DOC_KEY) || "null"); } catch { return null; }
  };

  // Dismissing only hides the card; the document stays selected for Ask, Speak and Teach Me.
  document.querySelector("#dismissExtract")?.addEventListener("click", () => {
    extractResult.hidden = true;
    extractResult.classList.remove("is-error", "is-loading");
    const saved = readSavedDocument();
    if (saved?.document_id) {
      try { sessionStorage.setItem(DOC_KEY, JSON.stringify({ ...saved, dismissed: true })); } catch { /* ignore */ }
    }
  });

  const showExtractionState = (state, title, meta, text = "") => {
    extractResult.hidden = false;
    extractResult.classList.toggle("is-loading", state === "loading");
    extractResult.classList.toggle("is-error", state === "error");
    if (extractEyebrow) extractEyebrow.textContent = "Extraction complete";
    extractFilename.textContent = title;
    extractMeta.textContent = meta;
    extractCharacterCount.textContent = "";
    extractText.textContent = text;
    extractResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // Remember every uploaded document so the dashboard can list it later.
  const saveToLibrary = (result) => {
    try {
      const stored = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
      const entry = {
        document_id: result.document_id,
        filename: result.filename,
        page_count: result.page_count,
        chunk_count: result.chunk_count,
        character_count: result.character_count,
        uploaded_at: new Date().toISOString(),
      };
      const next = [entry, ...(Array.isArray(stored) ? stored : []).filter((item) => item.document_id !== entry.document_id)]
        .slice(0, LIBRARY_LIMIT);
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
    } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent("askboard:library-changed"));
  };

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      showExtractionState("error", "Could not upload file", "PDF files only", "Please choose a file with a .pdf extension.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showExtractionState("error", "Could not upload file", "File is too large", "PDFs must be smaller than 15 MB.");
      return;
    }

    setUploading(true);
    showExtractionState("loading", file.name, "Extracting text…", "Reading your PDF. The first upload can take a little longer while the search model loads.");
    try {
      const result = await window.askboardApi.extractPdfDocument(file);
      const pages = `${result.page_count} ${result.page_count === 1 ? "page" : "pages"} extracted`;
      const indexed = typeof result.chunk_count === "number" ? ` · ${result.chunk_count} searchable chunks` : "";
      const id = result.document_id ? ` · ID ${result.document_id}` : "";
      showExtractionState("success", result.filename, pages + indexed + id, result.text.slice(0, 4000) || "No preview text returned.");
      extractCharacterCount.textContent = `${result.character_count.toLocaleString()} characters`;

      // Current document for this tab (read by the Ask, Speak and Teach Me pages).
      try {
        sessionStorage.setItem(DOC_KEY, JSON.stringify({
          document_id: result.document_id,
          filename: result.filename,
          meta: pages + indexed + id,
          character_count: result.character_count,
          preview: result.text.slice(0, 4000),
          dismissed: false,
        }));
      } catch { /* storage unavailable */ }

      saveToLibrary(result);
      showToast("PDF extracted successfully.");
    } catch (error) {
      const message = error instanceof TypeError
        ? "Could not reach the AskBoard API. Make sure the backend is running on port 8000."
        : error.message || "Could not extract this PDF.";
      showExtractionState("error", file.name, "Extraction failed", message);
    } finally {
      setUploading(false);
    }
  });

  /* ── Restore the last extraction after navigating back ── */
  const saved = readSavedDocument();
  if (saved?.document_id && !saved.dismissed && extractResult) {
    extractResult.hidden = false;
    if (extractEyebrow) extractEyebrow.textContent = "Extraction complete";
    extractFilename.textContent = saved.filename;
    extractMeta.textContent = saved.meta || "";
    extractCharacterCount.textContent = `${Number(saved.character_count || 0).toLocaleString()} characters`;
    extractText.textContent = saved.preview || "No preview text returned.";
  }
});