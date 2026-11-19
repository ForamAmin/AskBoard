document.addEventListener("DOMContentLoaded", () => {
  const DOC_KEY = "askboard-document"; // written by app.js after a successful upload (sessionStorage)

  const $ = (selector) => document.querySelector(selector);
  const root = document.documentElement;
  const nav = $("#mainNav");
  const menuToggle = $("#menuToggle");
  const themeToggle = $("#themeToggle");
  const toast = $("#toast");
  const docRow = $("#docRow");
  const docStatus = $("#docStatus");
  const docState = $("#docState");
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
  $("#searchFocus")?.addEventListener("click", () => $("#modes")?.scrollIntoView({ behavior: "smooth", block: "center" }));

  /* ── Current document ── */
  let doc = null;
  try { doc = JSON.parse(sessionStorage.getItem(DOC_KEY) || "null"); } catch { /* ignore corrupt storage */ }
  const hasDocument = typeof doc?.document_id === "string" && doc.document_id !== "";

  if (hasDocument) {
    docStatus.textContent = `${doc.filename || "Your uploaded PDF"} · Ready to learn`;
  } else {
    docRow.classList.add("is-missing");
    docStatus.textContent = "No document yet · Upload a PDF on the dashboard to start";
    docState.innerHTML = '<i data-lucide="circle-alert"></i>';

    // Without a document the modes have nothing to work from, so they don't navigate.
    document.querySelectorAll(".mode-card").forEach((card) => {
      card.classList.add("is-disabled");
      card.setAttribute("aria-disabled", "true");
      card.addEventListener("click", (event) => {
        event.preventDefault();
        showToast("Upload a PDF on the dashboard first.");
      });
    });
  }

  renderIcons();
});