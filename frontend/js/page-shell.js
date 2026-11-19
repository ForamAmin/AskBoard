/* Shared page shell for Teach It Back: theme toggle, navigation, the navbar camera indicator
   and Focus view. It only reads the page; the camera, speech and hand-tracking logic stays in
   teach-back.js. */
document.addEventListener("DOMContentLoaded", () => {
  const $ = (selector) => document.querySelector(selector);
  const root = document.documentElement;
  const nav = $("#mainNav");
  const menuToggle = $("#menuToggle");
  const themeToggle = $("#themeToggle");
  const toast = $("#toast");
  let toastTimer;

  const renderIcons = () => {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    } else {
      console.error("AskBoard: Lucide failed to load.");
    }
  };
  renderIcons();

  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  };

  /* Theme */
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

  /* Avatar: initials of the name saved on the dashboard, otherwise a person icon */
  const avatar = $("#avatarButton");
  let savedName = "";
  try { savedName = (localStorage.getItem("askboard-name") || "").trim(); } catch { /* storage unavailable */ }
  if (avatar && savedName) {
    avatar.textContent = savedName.split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  }
  avatar?.addEventListener("click", () => showToast("Set your name from the avatar on the dashboard."));

  /* Navigation */
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

  // Items that are not built yet say so honestly.
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.addEventListener("click", () => {
      showToast(`${item.dataset.view} is coming soon.`);
      setMenu(false);
    });
  });

  $("#searchFocus")?.addEventListener("click", () => {
    const start = $("#startCamera");
    start?.scrollIntoView({ behavior: "smooth", block: "center" });
    start?.focus();
  });

  /* Focus view: camera and transcript fill the screen. Esc or the same button exits. */
  const focusButton = $("#focusToggle");
  const setFocus = (on) => {
    document.body.classList.toggle("tb-focus", on);
    if (!focusButton) return;
    focusButton.setAttribute("aria-pressed", String(on));
    focusButton.innerHTML = on
      ? '<i data-lucide="minimize-2"></i><span>Exit focus</span>'
      : '<i data-lucide="maximize-2"></i><span>Focus view</span>';
    renderIcons();
  };
  focusButton?.addEventListener("click", () => setFocus(!document.body.classList.contains("tb-focus")));

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setMenu(false);
    if (document.body.classList.contains("tb-focus")) setFocus(false);
  });

  /* Navbar camera indicator: watches the video stream, so it works whatever teach-back.js does */
  const pill = $("#camPill");
  const pillText = $("#camPillText");
  const video = $("#cameraVideo");
  let lastLive = null;

  const isLive = () => {
    const stream = video?.srcObject;
    return Boolean(stream && typeof stream.getTracks === "function" &&
      stream.getTracks().some((track) => track.readyState === "live"));
  };

  const syncPill = () => {
    const live = isLive();
    if (live === lastLive) return;
    lastLive = live;
    pill?.classList.toggle("is-live", live);
    if (pillText) pillText.textContent = live ? "Camera live" : "Camera off";
  };
  syncPill();
  setInterval(syncPill, 500);
});