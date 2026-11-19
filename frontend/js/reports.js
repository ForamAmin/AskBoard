/* AskBoard reports: every number, chart and idea comes from the user's own activity.
   Sources: askboard-history (questions), askboard-library (uploads), askboard-teach-back-sessions
   (Teach It Back), plus /api/reports/overview when the backend provides it. */
document.addEventListener("DOMContentLoaded", () => {
  const G = window.AskBoardGrammar;
  const KEY = {
    history: "askboard-history",
    library: "askboard-library",
    sessions: "askboard-teach-back-sessions",
    goal: "askboard-weekly-goal",
    name: "askboard-name",
  };
  const API_BASE = window.ASKBOARD_API_BASE || "http://127.0.0.1:8000";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SLOT_MS = 3 * 60 * 1000; // ideas and thoughts change every 3 minutes
  const DEFAULT_GOAL = 10;
  const BLOCKS = ["Morning", "Afternoon", "Evening", "Night"];
  const BLOCK_SHORT = ["Morn", "Aft", "Eve", "Night"];
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const reduceMotion = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const $ = (selector) => document.querySelector(selector);
  const root = document.documentElement;

  /* ───────── Helpers ───────── */
  const readJson = (storage, key, fallback) => {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    return node;
  };
  const icon = (name) => {
    const node = document.createElement("i");
    node.setAttribute("data-lucide", name);
    return node;
  };
  const renderIcons = () => {
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const toTime = (iso) => {
    const time = Date.parse(iso);
    return Number.isNaN(time) ? 0 : time;
  };
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const shortDate = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const mondayIndex = (date) => (date.getDay() + 6) % 7;
  const truncate = (text, max) => {
    const clean = String(text).replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
  };
  const relativeTime = (iso) => {
    const time = toTime(iso);
    if (!time) return "";
    const minutes = Math.floor((Date.now() - time) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(time))) / 86400000);
    if (days <= 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    return shortDate(new Date(time));
  };
  const formatDuration = (seconds) => {
    const total = Math.round(Number(seconds) || 0);
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };
  const toRanges = (numbers) => {
    const parts = [];
    let start = null;
    let previous = null;
    for (const n of numbers) {
      if (start === null) { start = n; previous = n; continue; }
      if (n === previous + 1) { previous = n; continue; }
      parts.push(start === previous ? String(start) : `${start}–${previous}`);
      start = n;
      previous = n;
    }
    if (start !== null) parts.push(start === previous ? String(start) : `${start}–${previous}`);
    return parts.join(", ");
  };
  const levelClass = (score) => (score >= 80 ? "good" : score >= 60 ? "ok" : "low");
  const afterPaint = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
  const markReady = (container) => {
    if (!container) return;
    container.classList.remove("ready");
    afterPaint(() => container.classList.add("ready"));
  };

  const animateCount = (node, target) => {
    if (!node || node.dataset.value === String(target)) return;
    node.dataset.value = String(target);
    cancelAnimationFrame(Number(node.dataset.raf || 0));
    if (reduceMotion || target === 0) {
      node.textContent = String(target);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / 900);
      node.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) node.dataset.raf = String(requestAnimationFrame(tick));
    };
    node.dataset.raf = String(requestAnimationFrame(tick));
  };

  /* ───────── Shell: theme, menu, toast ───────── */
  const toast = $("#toast");
  let toastTimer;
  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  };
  const themeToggle = $("#themeToggle");
  const syncThemeLabel = () => themeToggle?.setAttribute("aria-label", `Switch to ${root.dataset.theme === "dark" ? "light" : "dark"} theme`);
  syncThemeLabel();
  themeToggle?.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("askboard-theme", root.dataset.theme); } catch { /* storage unavailable */ }
    syncThemeLabel();
    render(); // charts read theme colours
  });
  const nav = $("#mainNav");
  const menuToggle = $("#menuToggle");
  const setMenu = (open) => {
    nav?.classList.toggle("open", open);
    menuToggle?.setAttribute("aria-expanded", String(open));
  };
  menuToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    setMenu(!nav.classList.contains("open"));
  });
  document.addEventListener("click", (event) => { if (!nav?.contains(event.target)) setMenu(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") setMenu(false); });
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.addEventListener("click", () => { showToast(`${item.dataset.view} is coming soon.`); setMenu(false); });
  });
  const avatar = $("#avatarButton");
  const savedName = (localStorage.getItem(KEY.name) || "").trim();
  if (savedName) avatar.textContent = savedName.split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  avatar?.addEventListener("click", () => showToast("Set your name from the avatar on the dashboard."));

  /* ───────── Data ───────── */
  const loadHistory = () => {
    const raw = readJson(localStorage, KEY.history, []);
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.question === "string" && typeof e.document_id === "string") : [];
  };
  const loadLibrary = () => {
    const raw = readJson(localStorage, KEY.library, []);
    return Array.isArray(raw) ? raw.filter((d) => d && typeof d.document_id === "string") : [];
  };
  const localSessions = () => {
    const raw = readJson(localStorage, KEY.sessions, []);
    return Array.isArray(raw) ? raw : [];
  };
  let remoteSessions = [];
  const sessionTime = (s) => s.created_at || s.updated_at || "";
  const mergeSessions = (a, b) => {
    const map = new Map();
    [...a, ...b].forEach((s) => map.set(s.id || `${s.document_id}-${sessionTime(s)}`, s));
    return [...map.values()].sort((x, y) => toTime(sessionTime(y)) - toTime(sessionTime(x)));
  };

  const goal = () => {
    const stored = Number(localStorage.getItem(KEY.goal));
    return Number.isInteger(stored) && stored > 0 ? stored : DEFAULT_GOAL;
  };

  const computeStreaks = (stamps) => {
    const keys = [...new Set(stamps.filter(Boolean).map((t) => dayKey(new Date(t))))].sort();
    const today = startOfDay(new Date());
    const set = new Set(keys);
    const activeToday = set.has(dayKey(today));
    let cursor = activeToday ? today : addDays(today, -1);
    let current = 0;
    while (set.has(dayKey(cursor))) { current += 1; cursor = addDays(cursor, -1); }
    let best = 0;
    let run = 0;
    let previous = null;
    for (const key of keys) {
      const [y, m, d] = key.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      run = previous && Math.round((date - previous) / 86400000) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      previous = date;
    }
    return { current, best, activeToday };
  };

  function buildModel() {
    const filter = $("#docFilter").value || "all";
    const inScope = (id) => filter === "all" || id === filter;
    const allHistory = loadHistory();
    const library = loadLibrary();
    const allSessions = mergeSessions(localSessions(), remoteSessions);

    // Every document we know about, for the filter and the coverage list.
    const docMap = new Map();
    const touch = (id, filename) => {
      if (!id) return null;
      if (!docMap.has(id)) docMap.set(id, { id, filename: filename || "Untitled PDF", pages: null, uploadedAt: null, typed: 0, spoken: 0, first: 0, last: 0, cited: new Map(), sessions: 0 });
      const doc = docMap.get(id);
      if (filename && doc.filename === "Untitled PDF") doc.filename = filename;
      return doc;
    };
    for (const item of library) {
      const doc = touch(item.document_id, item.filename);
      doc.pages = Number.isInteger(item.page_count) ? item.page_count : doc.pages;
      doc.uploadedAt = item.uploaded_at || null;
    }
    for (const entry of allHistory) {
      const doc = touch(entry.document_id, entry.filename);
      if (entry.mode === "voice") doc.spoken += 1; else doc.typed += 1;
      const time = toTime(entry.created_at);
      if (time) { doc.first = doc.first ? Math.min(doc.first, time) : time; doc.last = Math.max(doc.last, time); }
      for (const source of entry.sources || []) {
        if (Number.isInteger(source.page) && source.page >= 1) doc.cited.set(source.page, (doc.cited.get(source.page) || 0) + 1);
      }
    }
    for (const session of allSessions) {
      const doc = touch(session.document_id, session.filename);
      if (doc) doc.sessions += 1;
    }
    const allDocs = [...docMap.values()].sort((a, b) => (b.last || toTime(b.uploadedAt)) - (a.last || toTime(a.uploadedAt)));

    const history = allHistory.filter((e) => inScope(e.document_id));
    const sessions = allSessions.filter((s) => filter === "all" || s.document_id === filter);
    const docs = allDocs.filter((d) => inScope(d.id));

    const typed = history.filter((e) => e.mode !== "voice").length;
    const spoken = history.length - typed;

    const stamps = [...history.map((e) => toTime(e.created_at)), ...sessions.map((s) => toTime(sessionTime(s)))];
    const streaks = computeStreaks(stamps);

    // Writing analysis
    const units = [
      ...history.map((e) => ({ text: e.question, spoken: e.mode === "voice", at: e.created_at, source: e.mode === "voice" ? "spoken" : "typed" })),
      ...sessions.filter((s) => String(s.transcript || "").trim()).map((s) => ({ text: s.transcript, spoken: true, at: sessionTime(s), source: "teach" })),
    ];
    const grammar = G.summarize(units.map((u) => ({ analysis: G.analyzeText(u.text, { spoken: u.spoken }), at: u.at, source: u.source })));

    const today = startOfDay(new Date());
    const weekStart = addDays(today, -6).getTime();
    const prevStart = addDays(today, -13).getTime();
    let thisWeek = 0;
    let lastWeek = 0;
    for (const entry of history) {
      const time = toTime(entry.created_at);
      if (time >= weekStart) thisWeek += 1; else if (time >= prevStart) lastWeek += 1;
    }

    // Writing score: last 7 days against the 7 before.
    const scoreAvg = (from, to) => {
      const pool = grammar.trend.filter((p) => toTime(p.at) >= from && toTime(p.at) < to);
      return pool.length ? pool.reduce((sum, p) => sum + p.score, 0) / pool.length : null;
    };
    const nowMs = Date.now() + 1;
    const recentScore = scoreAvg(weekStart, nowMs);
    const previousScore = scoreAvg(prevStart, weekStart);
    const scoreDelta = recentScore != null && previousScore != null ? Math.round(recentScore - previousScore) : null;

    // Calendar week (Monday to Sunday) for the goal.
    const monday = addDays(today, -mondayIndex(today)).getTime();
    const weekQuestions = history.filter((e) => toTime(e.created_at) >= monday).length;

    // Study rhythm and weekday totals
    const rhythm = Array.from({ length: 7 }, () => [0, 0, 0, 0]);
    const weekdayTotals = new Array(7).fill(0);
    for (const time of stamps) {
      if (!time) continue;
      const date = new Date(time);
      const hour = date.getHours();
      const block = hour >= 5 && hour < 12 ? 0 : hour >= 12 && hour < 17 ? 1 : hour >= 17 && hour < 22 ? 2 : 3;
      rhythm[mondayIndex(date)][block] += 1;
      weekdayTotals[mondayIndex(date)] += 1;
    }

    const series = (days) => {
      const result = [];
      const index = new Map();
      for (let i = days - 1; i >= 0; i -= 1) {
        const date = addDays(today, -i);
        const entry = { date, typed: 0, spoken: 0, teach: 0 };
        index.set(dayKey(date), entry);
        result.push(entry);
      }
      for (const e of history) {
        const bucket = index.get(dayKey(new Date(toTime(e.created_at))));
        if (bucket) bucket[e.mode === "voice" ? "spoken" : "typed"] += 1;
      }
      for (const s of sessions) {
        const bucket = index.get(dayKey(new Date(toTime(sessionTime(s)))));
        if (bucket) bucket.teach += 1;
      }
      return result;
    };

    const coverage = docs.map((d) => (d.pages ? Math.round((Math.min(d.cited.size, d.pages) / d.pages) * 100) : null)).filter((p) => p != null);
    const questionWords = history.filter((e) => e.mode !== "voice").map((e) => G.tokenize(e.question).length);

    return {
      filter, allDocs, docs, history, sessions, typed, spoken, streaks, grammar, units,
      thisWeek, lastWeek, scoreDelta, weekQuestions, rhythm, weekdayTotals, series,
      bestCoverage: coverage.length ? Math.max(...coverage) : 0,
      avgQuestionWords: questionWords.length ? questionWords.reduce((a, b) => a + b, 0) / questionWords.length : null,
      empty: history.length === 0 && sessions.length === 0,
    };
  }

  /* ───────── Small chart helpers ───────── */
  const CIRC = 2 * Math.PI * 42;

  function ringSvg(fraction, strokeVar) {
    const svg = svgEl("svg", { viewBox: "0 0 100 100", "aria-hidden": "true" });
    svg.append(svgEl("circle", { class: "track", cx: 50, cy: 50, r: 42, "stroke-width": 10 }));
    const fill = svgEl("circle", { class: "ring-fill", cx: 50, cy: 50, r: 42, "stroke-width": 10, stroke: `var(${strokeVar})`, "stroke-dasharray": `0 ${CIRC}` });
    svg.append(fill);
    const length = CIRC * clamp(fraction, 0, 1);
    afterPaint(() => fill.setAttribute("stroke-dasharray", `${length} ${CIRC - length}`));
    return svg;
  }

  const fillBar = (node, percent) => afterPaint(() => { node.style.width = `${percent}%`; });

  function curvePath(points) {
    if (points.length < 2) return "";
    let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const low = Math.min(p1.y, p2.y);
      const high = Math.max(p1.y, p2.y);
      const c1y = clamp(p1.y + (p2.y - p0.y) / 6, low, high);
      const c2y = clamp(p2.y - (p3.y - p1.y) / 6, low, high);
      d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)},${c1y.toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }

  /* ───────── Stats ───────── */
  const setFoot = (node, ...children) => node.replaceChildren(...children);
  const positive = (text, iconName) => {
    const span = el("span", "positive");
    if (iconName) span.append(icon(iconName));
    span.append(document.createTextNode(text));
    return span;
  };
  const negative = (text, iconName) => {
    const span = el("span", "negative");
    if (iconName) span.append(icon(iconName));
    span.append(document.createTextNode(text));
    return span;
  };

  function renderStats(m) {
    animateCount($("#statQuestions"), m.history.length);
    if (m.lastWeek > 0) {
      const change = Math.round(((m.thisWeek - m.lastWeek) / m.lastWeek) * 100);
      setFoot($("#statQuestionsFoot"), change >= 0 ? positive(` ${change}%`, "trending-up") : negative(` ${Math.abs(change)}%`, "trending-down"), document.createTextNode(" vs last week"));
    } else {
      setFoot($("#statQuestionsFoot"), document.createTextNode(m.history.length ? `${m.thisWeek} in the last 7 days` : "Nothing asked yet"));
    }

    animateCount($("#statWords"), m.grammar.words);
    const spokenWords = m.grammar.words - m.grammar.typedWords;
    setFoot($("#statWordsFoot"), document.createTextNode(m.grammar.words ? `${m.grammar.typedWords.toLocaleString()} typed · ${spokenWords.toLocaleString()} spoken` : "Nothing to count yet"));

    animateCount($("#statGrammar"), m.grammar.overall == null ? 0 : m.grammar.overall);
    if (m.grammar.overall == null) {
      setFoot($("#statGrammarFoot"), document.createTextNode("Ask a few questions to get a score"));
    } else if (m.scoreDelta != null) {
      setFoot($("#statGrammarFoot"), m.scoreDelta >= 0 ? positive(` ${m.scoreDelta} pts`, "trending-up") : negative(` ${Math.abs(m.scoreDelta)} pts`, "trending-down"), document.createTextNode(" vs previous week"));
    } else {
      setFoot($("#statGrammarFoot"), document.createTextNode(`From ${plural(m.grammar.texts, "text", "texts")}`));
    }

    animateCount($("#statStreak"), m.streaks.current);
    $("#statStreakUnit").textContent = m.streaks.current === 1 ? "day" : "days";
    setFoot($("#statStreakFoot"), document.createTextNode(m.streaks.best ? `Best streak: ${plural(m.streaks.best, "day", "days")}` : "Ask a question to start a streak"));
  }

  /* ───────── Activity and mix ───────── */
  let rangeDays = 7;

  function renderActivity(m) {
    const series = m.series(rangeDays);
    const max = Math.max(1, ...series.map((s) => s.typed + s.spoken + s.teach));
    const bars = $("#bars");
    bars.classList.toggle("dense", rangeDays > 7);
    $("#rangeLabel").textContent = `Last ${rangeDays} days`;

    bars.replaceChildren(...series.map((s, index) => {
      const total = s.typed + s.spoken + s.teach;
      const col = el("div", "bar-col");
      col.title = `${shortDate(s.date)}: ${s.typed} typed, ${s.spoken} spoken, ${s.teach} Teach It Back`;
      col.append(el("span", "bar-total", rangeDays <= 7 && total ? String(total) : ""));
      const stack = el("div", `stack${total ? "" : " zero"}`);
      stack.style.height = `calc((100% - 44px) * ${total / max})`;
      stack.style.setProperty("--i", String(index));
      for (const [cls, value] of [["seg-typed", s.typed], ["seg-spoken", s.spoken], ["seg-teach", s.teach]]) {
        if (!value) continue;
        const seg = el("div", `seg ${cls}`);
        seg.style.flex = `${value} 0 0`;
        stack.append(seg);
      }
      const label = rangeDays <= 7
        ? s.date.toLocaleDateString(undefined, { weekday: "short" })
        : ((series.length - 1 - index) % 7 === 0 ? shortDate(s.date) : "");
      col.append(stack, el("small", "", label));
      return col;
    }));
    markReady(bars);

    const totals = series.reduce((acc, s) => ({ typed: acc.typed + s.typed, spoken: acc.spoken + s.spoken, teach: acc.teach + s.teach }), { typed: 0, spoken: 0, teach: 0 });
    const all = totals.typed + totals.spoken + totals.teach;
    $("#activityCaption").textContent = all
      ? `${plural(all, "item", "items")} in the last ${rangeDays} days: ${totals.typed} typed, ${totals.spoken} spoken, ${totals.teach} Teach It Back.`
      : "Nothing in this period yet.";
  }

  function renderDonut(m) {
    const donut = $("#donut");
    const legend = $("#donutLegend");
    const parts = [
      { label: "Typed questions", value: m.typed, color: "--lav", cls: "dot-typed" },
      { label: "Spoken questions", value: m.spoken, color: "--warm", cls: "dot-spoken" },
      { label: "Teach It Back sessions", value: m.sessions.length, color: "--green", cls: "dot-teach" },
    ];
    const total = parts.reduce((sum, p) => sum + p.value, 0);

    const svg = svgEl("svg", { viewBox: "0 0 100 100", "aria-hidden": "true" });
    svg.append(svgEl("circle", { class: "track", cx: 50, cy: 50, r: 42, "stroke-width": 14 }));
    let offset = 0;
    const arcs = [];
    if (total) {
      for (const part of parts) {
        if (!part.value) continue;
        const length = (part.value / total) * CIRC;
        const gap = parts.filter((p) => p.value).length > 1 ? 1.5 : 0;
        const visible = Math.max(0, length - gap);
        const arc = svgEl("circle", { class: "arc", cx: 50, cy: 50, r: 42, "stroke-width": 14, stroke: `var(${part.color})`, "stroke-dasharray": `0 ${CIRC}`, "stroke-dashoffset": -offset });
        svg.append(arc);
        arcs.push([arc, visible]);
        offset += length;
      }
    }
    const center = el("div", "donut-center");
    center.append(el("b", "", String(total)), el("span", "", "in total"));
    donut.replaceChildren(svg, center);
    afterPaint(() => arcs.forEach(([arc, visible]) => arc.setAttribute("stroke-dasharray", `${visible} ${CIRC - visible}`)));

    legend.replaceChildren(...parts.map((part) => {
      const li = el("li");
      li.append(el("i", `dot ${part.cls}`), document.createTextNode(part.label), el("b", "", total ? `${part.value} · ${Math.round((part.value / total) * 100)}%` : "0"));
      return li;
    }));
  }

  /* ───────── Progress tracker ───────── */
  function renderGoal(m) {
    const target = goal();
    const done = m.weekQuestions;
    const ring = $("#goalRing");
    ring.replaceChildren(ringSvg(done / target, "--lav"));
    const label = el("div", "ring-label");
    label.append(el("b", "", `${Math.min(100, Math.round((done / target) * 100))}%`), el("span", "", "of goal"));
    ring.append(label);
    $("#goalValue").textContent = `${done} of ${target}`;
    $("#goalText").textContent = done >= target ? "Goal reached this week. Nice." : `${plural(target - done, "question", "questions")} to go this week (Mon–Sun)`;
  }

  $("#goalEdit")?.addEventListener("click", () => {
    const answer = window.prompt("How many questions do you want to ask each week?", String(goal()));
    if (answer === null) return;
    const value = Math.round(Number(answer));
    if (!Number.isFinite(value) || value < 1 || value > 500) { showToast("Enter a number between 1 and 500."); return; }
    try { localStorage.setItem(KEY.goal, String(value)); } catch { /* storage unavailable */ }
    render();
  });

  function renderRhythm(m) {
    const grid = $("#rhythm");
    const max = Math.max(1, ...m.rhythm.flat());
    const nodes = [el("span", "r-head")];
    BLOCK_SHORT.forEach((label, i) => { const head = el("span", "r-head", label); head.title = BLOCKS[i]; nodes.push(head); });
    m.rhythm.forEach((row, day) => {
      nodes.push(el("span", "r-day", WEEKDAYS[day]));
      row.forEach((count, block) => {
        const cell = el("span", "r-cell", count ? String(count) : "");
        cell.style.setProperty("--p", `${count ? 25 + (count / max) * 65 : 0}%`);
        cell.title = `${WEEKDAYS_LONG[day]} ${BLOCKS[block].toLowerCase()}: ${plural(count, "item", "items")}`;
        nodes.push(cell);
      });
    });
    grid.replaceChildren(...nodes);

    let best = { count: 0, day: 0, block: 0 };
    m.rhythm.forEach((row, day) => row.forEach((count, block) => { if (count > best.count) best = { count, day, block }; }));
    $("#rhythmCaption").textContent = best.count
      ? `Busiest slot: ${WEEKDAYS_LONG[best.day]} ${BLOCKS[best.block].toLowerCase()} (${plural(best.count, "item", "items")}). Morning is 5–12, afternoon 12–17, evening 17–22.`
      : "Your busiest times will show up here.";
  }

  function milestoneList(m) {
    const texts = m.grammar.texts;
    return [
      { icon: "message-circle", title: "First question", desc: "Ask your first question", value: m.history.length, goal: 1 },
      { icon: "messages-square", title: "10 questions", desc: "Ask ten questions", value: m.history.length, goal: 10 },
      { icon: "library", title: "50 questions", desc: "Ask fifty questions", value: m.history.length, goal: 50 },
      { icon: "flame", title: "3-day streak", desc: "Study three days in a row", value: m.streaks.best, goal: 3 },
      { icon: "flame", title: "7-day streak", desc: "Study seven days in a row", value: m.streaks.best, goal: 7 },
      { icon: "mic", title: "Voice learner", desc: "Ask a question out loud", value: m.spoken, goal: 1 },
      { icon: "graduation-cap", title: "Teach it back", desc: "Save a Teach It Back session", value: m.sessions.length, goal: 1 },
      { icon: "book-check", title: "Halfway there", desc: "Cover half the pages of a document", value: m.bestCoverage, goal: 50, suffix: "%" },
      { icon: "trophy", title: "Cover to cover", desc: "Cover every page of a document", value: m.bestCoverage, goal: 100, suffix: "%" },
      { icon: "spell-check", title: "Clean writer", desc: "Writing score of 90+ over 5 texts", value: texts >= 5 && m.grammar.overall != null ? m.grammar.overall : 0, goal: 90 },
    ];
  }

  function renderMilestones(m) {
    const list = milestoneList(m);
    const done = list.filter((item) => item.value >= item.goal).length;
    $("#milestoneCount").textContent = `${done} of ${list.length}`;
    $("#milestones").replaceChildren(...list.map((item) => {
      const complete = item.value >= item.goal;
      const li = el("li", `milestone${complete ? " is-done" : ""}`);
      const iconBox = el("span", "m-icon");
      iconBox.append(icon(item.icon));
      const text = el("div");
      text.append(el("strong", "", item.title), el("span", "m-desc", item.desc));
      const suffix = item.suffix || "";
      li.append(iconBox, text, el("span", "m-progress", complete ? "Done" : `${Math.min(item.value, item.goal)}${suffix} / ${item.goal}${suffix}`));
      return li;
    }));
  }

  function renderDocuments(m) {
    const container = $("#docProgress");
    const items = m.docs.filter((d) => d.typed + d.spoken + d.sessions > 0 || d.pages);
    $("#docEmpty").hidden = items.length > 0;
    container.replaceChildren(...items.slice(0, 12).map((doc, index) => {
      const covered = doc.pages ? Math.min(doc.cited.size, doc.pages) : doc.cited.size;
      const percent = doc.pages ? Math.round((covered / doc.pages) * 100) : null;

      const details = el("details", "doc-item");
      if (index === 0 && items.length > 0) details.open = items.length === 1;
      const summary = el("summary");
      const name = el("span", "d-name", doc.filename);
      name.title = doc.filename;
      const meta = el("span", "d-meta", doc.pages
        ? `${covered} of ${plural(doc.pages, "page", "pages")} cited in answers`
        : `${plural(doc.cited.size, "page", "pages")} cited · page count unknown`);
      const bar = el("div", "d-bar");
      const fill = document.createElement("i");
      bar.append(fill);
      summary.append(name, el("span", "d-pct", percent == null ? "—" : `${percent}%`), meta, bar);
      fillBar(fill, percent || 0);
      details.append(summary);

      const detail = el("div", "doc-detail");
      const stats = el("div", "doc-stats");
      const stat = (label, value) => { const span = el("span"); span.append(document.createTextNode(`${label} `), el("b", "", value)); return span; };
      stats.append(
        stat("Questions", String(doc.typed + doc.spoken)),
        stat("Typed", String(doc.typed)),
        stat("Spoken", String(doc.spoken)),
        stat("Teach It Back", String(doc.sessions)),
        stat("First studied", doc.first ? shortDate(new Date(doc.first)) : "—"),
        stat("Last studied", doc.last ? relativeTime(new Date(doc.last).toISOString()) : "—"),
      );
      detail.append(stats);

      if (doc.pages) {
        const tiles = el("div", "page-tiles");
        const maxHits = Math.max(1, ...doc.cited.values());
        const shown = Math.min(doc.pages, 200);
        for (let page = 1; page <= shown; page += 1) {
          const hits = doc.cited.get(page) || 0;
          const tile = el("span", `page-tile${hits ? " hit" : ""}`, String(page));
          if (hits) tile.style.setProperty("--p", `${45 + (hits / maxHits) * 55}%`);
          tile.title = hits ? `Page ${page}: cited ${plural(hits, "time", "times")}` : `Page ${page}: not cited yet`;
          tiles.append(tile);
        }
        detail.append(tiles);
        const missing = [];
        for (let page = 1; page <= doc.pages; page += 1) if (!doc.cited.has(page)) missing.push(page);
        detail.append(el("p", "uncovered", missing.length ? `Not covered yet: ${toRanges(missing)}${doc.pages > 200 ? " (tiles show the first 200 pages)" : ""}` : "Every page has been cited at least once."));
      } else {
        detail.append(el("p", "uncovered", doc.cited.size ? `Pages cited so far: ${toRanges([...doc.cited.keys()].sort((a, b) => a - b))}` : "No pages cited yet."));
      }
      details.append(detail);
      return details;
    }));
  }

  /* ───────── Writing analysis ───────── */
  function renderGrammar(m) {
    const g = m.grammar;
    const hasData = g.texts > 0 && g.overall != null;
    $("#grammarEmpty").hidden = hasData;
    $("#grammarBody").hidden = !hasData;
    if (!hasData) return;

    // Overall ring
    const ring = $("#gRing");
    ring.replaceChildren(ringSvg(g.overall / 100, g.overall >= 80 ? "--green" : g.overall >= 60 ? "--amber-fg" : "--coral"));
    const label = el("div", "ring-label");
    label.append(el("b", "", String(g.overall)), el("span", "", "out of 100"));
    ring.append(label);
    $("#gLabel").textContent = g.overall >= 90 ? "Excellent" : g.overall >= 80 ? "Strong" : g.overall >= 60 ? "Getting there" : "Needs attention";
    const scored = g.categories.filter((c) => c.score != null);
    const strongest = [...scored].sort((a, b) => b.score - a.score)[0];
    const weakest = [...scored].sort((a, b) => a.score - b.score)[0];
    $("#gNote").textContent = `Based on ${plural(g.texts, "text", "texts")} and ${g.words.toLocaleString()} words. Strongest: ${strongest.label} (${strongest.score}). ${weakest.score < 100 ? `Most room to grow: ${weakest.label} (${weakest.score}).` : "Nothing is dragging it down."}`;

    renderRadar(g);
    renderTrend(g);
    renderCategoryCards(g);
    renderPunctuation(g);
    renderIssues(g);
    renderHistogram(g);
    renderReadability(g);
    renderWords(g);
    renderCorrections(g);
  }

  function renderRadar(g) {
    const cx = 150;
    const cy = 125;
    const radius = 88;
    const svg = svgEl("svg", { viewBox: "0 0 300 250", role: "img", "aria-label": "Skill scores by category" });
    const angle = (i) => (-Math.PI / 2) + (i * 2 * Math.PI) / g.categories.length;
    const point = (i, fraction) => [cx + Math.cos(angle(i)) * radius * fraction, cy + Math.sin(angle(i)) * radius * fraction];
    for (const level of [0.25, 0.5, 0.75, 1]) {
      svg.append(svgEl("polygon", { class: "radar-grid", points: g.categories.map((_, i) => point(i, level).map((n) => n.toFixed(1)).join(",")).join(" ") }));
    }
    g.categories.forEach((category, i) => {
      const [x, y] = point(i, 1);
      svg.append(svgEl("line", { class: "radar-axis", x1: cx, y1: cy, x2: x.toFixed(1), y2: y.toFixed(1) }));
      const [lx, ly] = point(i, 1.2);
      const anchor = Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end";
      const text = svgEl("text", { class: "radar-label", x: lx.toFixed(1), y: (ly + 4).toFixed(1), "text-anchor": anchor });
      text.textContent = `${category.label.replace(" & ", " & ")} ${category.score == null ? "–" : category.score}`;
      svg.append(text);
    });
    const shape = svgEl("polygon", { class: "radar-shape", points: g.categories.map((c, i) => point(i, (c.score == null ? 0 : c.score) / 100).map((n) => n.toFixed(1)).join(",")).join(" ") });
    svg.append(shape);
    g.categories.forEach((c, i) => {
      if (c.score == null) return;
      const [x, y] = point(i, c.score / 100);
      svg.append(svgEl("circle", { class: "radar-dot", cx: x.toFixed(1), cy: y.toFixed(1), r: 3 }));
    });
    const holder = $("#radar");
    holder.replaceChildren(svg);
    markReady(holder);
  }

  function renderTrend(g) {
    const holder = $("#trend");
    const points = g.trend.slice(-24);
    if (points.length < 2) {
      holder.replaceChildren(el("p", "empty", points.length ? "One analysed text so far. Two or more will draw a trend." : "No scored texts yet."));
      $("#trendCaption").textContent = "";
      return;
    }
    const width = holder.clientWidth || 360;
    const height = 200;
    const padL = 26;
    const padB = 20;
    const innerW = width - padL - 8;
    const innerH = height - padB - 8;
    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", role: "img", "aria-label": "Writing score over time" });
    const defs = svgEl("defs");
    const gradient = svgEl("linearGradient", { id: "trendFill", x1: 0, x2: 0, y1: 0, y2: 1 });
    gradient.append(svgEl("stop", { offset: 0, "stop-color": "#aa93f5", "stop-opacity": 0.28 }), svgEl("stop", { offset: 1, "stop-color": "#aa93f5", "stop-opacity": 0 }));
    defs.append(gradient);
    svg.append(defs);
    const yFor = (score) => 8 + innerH - (score / 100) * innerH;
    for (const tick of [0, 50, 100]) {
      svg.append(svgEl("line", { class: "trend-grid", x1: padL, x2: width - 4, y1: yFor(tick), y2: yFor(tick) }));
      const text = svgEl("text", { class: "trend-label", x: 0, y: yFor(tick) + 3 });
      text.textContent = String(tick);
      svg.append(text);
    }
    const coords = points.map((p, i) => ({ x: padL + (i / (points.length - 1)) * innerW, y: yFor(p.score) }));
    const line = curvePath(coords);
    svg.append(svgEl("path", { class: "trend-area", d: `${line} L${coords[coords.length - 1].x.toFixed(1)},${yFor(0)} L${coords[0].x.toFixed(1)},${yFor(0)} Z` }));
    svg.append(svgEl("path", { class: "trend-line", d: line, "vector-effect": "non-scaling-stroke" }));
    points.forEach((p, i) => {
      const dot = svgEl("circle", { class: `t-dot ${levelClass(p.score)}`, cx: coords[i].x.toFixed(1), cy: coords[i].y.toFixed(1), r: 5 });
      const title = svgEl("title");
      title.textContent = `${shortDate(new Date(toTime(p.at)))}: ${p.score}/100 · “${p.excerpt}”`;
      dot.append(title);
      svg.append(dot);
    });
    holder.replaceChildren(svg);
    if (!reduceMotion) {
      svg.classList.add("is-drawing");
    }
    const first = points[0];
    const last = points[points.length - 1];
    $("#trendCaption").textContent = `Each dot is one text, from ${shortDate(new Date(toTime(first.at)))} to ${shortDate(new Date(toTime(last.at)))}. Green is 80+, amber 60–79, red below 60.`;
  }

  function renderCategoryCards(g) {
    $("#categoryCards").replaceChildren(...g.categories.map((c, index) => {
      const card = el("article", "category-card reveal");
      card.style.setProperty("--d", `${index * 0.05}s`);
      const head = el("header");
      head.append(el("h3", "", c.label), el("span", "c-score", c.score == null ? "–" : String(c.score)));
      const bar = el("div", "c-bar");
      const fill = document.createElement("i");
      fill.className = c.score == null ? "" : levelClass(c.score);
      bar.append(fill);
      fillBar(fill, c.score == null ? 0 : c.score);
      const top = el("div", c.top ? "c-top" : "c-top clean");
      if (c.score == null) {
        top.className = "c-top";
        top.textContent = "Not scored for spoken text.";
      } else if (c.top) {
        const example = c.top.examples[0];
        top.append(el("strong", "", `${c.top.label} · ${plural(c.top.count, "time", "times")}`));
        if (example) {
          top.append(document.createElement("br"), el("q", "", example.excerpt));
          if (example.fix) { top.append(document.createTextNode(" → "), el("span", "fix", example.fix)); }
        }
      } else {
        top.textContent = "No issues found.";
      }
      card.append(head, bar, el("p", "c-checks", c.checks), top);
      card.classList.add("is-in");
      return card;
    }));
  }

  function renderPunctuation(g) {
    const holder = $("#punctTable");
    if (!g.typedWords) {
      holder.replaceChildren(el("p", "empty", "Punctuation is analysed for typed text only. Type a few questions to see it."));
      return;
    }
    const words = g.typedWords;
    const per100 = (n) => (words ? (n / words) * 100 : 0).toFixed(1);
    const summary = el("div", "p-summary");
    const rate = (label, good, total) => {
      const row = el("div", "p-rate");
      const meter = el("span", "meter");
      const fill = document.createElement("i");
      meter.append(fill);
      const percent = total ? Math.round((good / total) * 100) : 0;
      fillBar(fill, percent);
      row.append(el("span", "", label), meter, el("b", "", total ? `${percent}%` : "–"));
      return row;
    };
    summary.append(
      rate("Sentences with ending punctuation", g.typedTerminal, g.typedSentences),
      rate("Questions ending with “?”", g.questions.marked, g.questions.total),
    );

    const rows = [
      ["Commas", g.marks.commas, "Separate clauses and list items"],
      ["Full stops", g.marks.periods, "End statements"],
      ["Question marks", g.marks.questionMarks, "End questions"],
      ["Exclamation marks", g.marks.exclamations, "Use sparingly in notes"],
      ["Apostrophes", g.marks.apostrophes, "Contractions and possessives"],
      ["Colons and semicolons", g.marks.colons + g.marks.semicolons, "Introduce lists, join related clauses"],
      ["Brackets and quotes", g.marks.brackets + g.marks.quotes, "Asides and quotations"],
      ["Dashes", g.marks.dashes, "Breaks and ranges"],
    ];
    const table = el("table", "p-table");
    const thead = el("thead");
    const headRow = el("tr");
    headRow.append(el("th", "", "Mark"), el("th", "num", "Count"), el("th", "num", "Per 100 words"), el("th", "", "Used for"));
    thead.append(headRow);
    const tbody = el("tbody");
    for (const [label, count, note] of rows) {
      const tr = el("tr");
      tr.append(el("td", "", label), el("td", "num", String(count)), el("td", "num", per100(count)), el("td", "", note));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    holder.replaceChildren(summary, table);
  }

  function renderIssues(g) {
    const holder = $("#issueBars");
    const types = g.issueTypes.slice(0, 8);
    if (!types.length) {
      holder.replaceChildren(el("p", "empty", "No issues found."));
      return;
    }
    const max = Math.max(...types.map((t) => t.count));
    holder.replaceChildren(...types.map((type) => {
      const row = el("div", `issue-row${type.severity === "note" ? " note" : ""}`);
      row.append(el("span", "i-label", type.label), el("span", "i-count", String(type.count)));
      const bar = el("div", "i-bar");
      const fill = document.createElement("i");
      bar.append(fill);
      fillBar(fill, (type.count / max) * 100);
      row.append(bar);
      const category = G.CATEGORIES.find((c) => c.key === type.category);
      row.append(el("small", "", `${category ? category.label : type.category}${type.severity === "note" ? " · note, not scored" : ""}`));
      return row;
    }));
  }

  function renderHistogram(g) {
    const holder = $("#histogram");
    const max = Math.max(1, ...g.histogram.map((b) => b.count));
    holder.replaceChildren(...g.histogram.map((bucket, index) => {
      const col = el("div", "bar-col");
      col.append(el("span", "bar-total", bucket.count ? String(bucket.count) : ""));
      const stack = el("div", `stack${bucket.count ? "" : " zero"}`);
      stack.style.height = `calc((100% - 44px) * ${bucket.count / max})`;
      stack.style.setProperty("--i", String(index));
      if (bucket.count) { const seg = el("div", "seg"); seg.style.flex = "1 0 0"; stack.append(seg); }
      col.append(stack, el("small", "", bucket.label));
      return col;
    }));
    markReady(holder);
    const stats = g.sentenceStats;
    $("#sentenceCaption").textContent = stats
      ? `${plural(stats.count, "sentence", "sentences")} · average ${stats.average} words · longest ${stats.longest} · shortest ${stats.shortest}. Words per sentence.`
      : "Sentence lengths appear once there is punctuated text to measure.";
  }

  function renderReadability(g) {
    const holder = $("#readability");
    const nodes = [];
    if (g.readability) {
      const score = el("div", "read-score");
      score.append(el("b", "", String(g.readability.score)), el("span", "mini", g.readability.label));
      const scale = el("div", "read-scale");
      const marker = document.createElement("i");
      scale.append(marker);
      afterPaint(() => { marker.style.left = `${g.readability.score}%`; });
      const ends = el("div", "read-ends");
      ends.append(el("span", "", "Harder"), el("span", "", "Easier"));
      const facts = el("div", "facts");
      const fact = (value, label) => { const box = el("div", "fact"); box.append(el("b", "", value), el("span", "", label)); return box; };
      facts.append(fact(String(g.readability.wordsPerSentence), "Words per sentence"), fact(String(g.readability.syllablesPerWord), "Syllables per word"));
      nodes.push(score, scale, ends, facts);
    } else {
      nodes.push(el("p", "empty", "Readability needs at least three sentences and 30 words of punctuated text."));
    }
    holder.replaceChildren(...nodes);
  }

  function renderWords(g) {
    const holder = $("#wordsPanel");
    const nodes = [];
    nodes.push(el("p", "sub-h", "Most used"));
    const chips = el("div", "chips");
    if (g.topWords.length) {
      for (const [word, count] of g.topWords.slice(0, 8)) {
        const chip = el("span", "chip", word);
        chip.append(el("em", "", String(count)));
        chips.append(chip);
      }
    } else {
      chips.append(el("span", "mini", "Nothing yet"));
    }
    nodes.push(chips);
    nodes.push(el("p", "sub-h", "Filler words"));
    const fillers = el("div", "chips");
    if (g.fillers.length) {
      for (const [word, count] of g.fillers) {
        const chip = el("span", "chip", `“${word}”`);
        chip.append(el("em", "", String(count)));
        fillers.append(chip);
      }
    } else {
      fillers.append(el("span", "mini", "None found"));
    }
    nodes.push(fillers);
    nodes.push(el("p", "sub-h", "Vocabulary variety"));
    nodes.push(el("p", "empty", g.vocabulary
      ? `${Math.round(g.vocabulary.ratio * 100)}% of your ${g.vocabulary.total.toLocaleString()} words are unique.`
      : "Needs at least 50 words."));
    holder.replaceChildren(...nodes);
  }

  function renderCorrections(g) {
    const list = $("#corrections");
    $("#correctionsEmpty").hidden = g.recent.length > 0;
    list.replaceChildren(...g.recent.map((item) => {
      const li = el("li", "correction");
      const category = G.CATEGORIES.find((c) => c.key === item.category);
      li.append(el("span", "c-tag", category ? category.label : item.category));
      const body = el("div");
      body.append(el("q", "", item.excerpt));
      const note = el("p", "", `${item.message}. `);
      if (item.fix) { note.append(document.createTextNode("Try: "), el("span", "fix", item.fix)); }
      body.append(note);
      li.append(body, el("time", "", relativeTime(item.at)));
      return li;
    }));
  }

  /* ───────── Teach It Back sessions ───────── */
  function renderSessions(m) {
    const sessions = m.sessions;
    const totalSeconds = sessions.reduce((n, s) => n + (Number(s.duration_seconds) || 0), 0);
    const topics = new Set(sessions.map((s) => s.topic).filter(Boolean)).size;
    const wordsOf = (s) => Number(s.word_count) || String(s.transcript || "").trim().split(/\s+/).filter(Boolean).length;
    const spokenWords = sessions.reduce((n, s) => n + wordsOf(s), 0);
    const cards = [
      ["circle-check", "Sessions completed", String(sessions.length)],
      ["clock-3", "Speaking time", formatDuration(totalSeconds)],
      ["layers-3", "Topics studied", String(topics)],
      ["mic", "Words spoken", spokenWords.toLocaleString()],
    ];
    $("#tbStats").replaceChildren(...cards.map(([iconName, label, value], index) => {
      const card = el("article", "stat-card reveal is-in");
      card.style.setProperty("--d", `${index * 0.06}s`);
      const iconBox = el("div", "stat-icon muted-icon");
      iconBox.append(icon(iconName));
      const val = el("div", "stat-value", value);
      card.append(iconBox, el("div", "stat-label", label), val);
      return card;
    }));

    const latest = $("#latest");
    const newest = sessions[0];
    if (newest) {
      latest.className = "latest";
      const metric = (value, label) => { const box = el("div", "metric"); box.append(el("b", "", value == null ? "—" : String(value)), el("span", "", label)); return box; };
      const list = el("div", "metric-list");
      list.append(metric(newest.speaking_wpm, "Words per minute"), metric(newest.filler_words, "Filler words"), metric(newest.unique_words, "Unique words"), metric(newest.sentence_count, "Sentences"));
      latest.replaceChildren(el("strong", "", newest.topic || "Untitled topic"), list);
    } else {
      latest.className = "latest empty";
      latest.textContent = "No Teach It Back sessions have been saved yet.";
    }

    const holder = $("#sessionList");
    if (!sessions.length) {
      holder.replaceChildren(el("p", "empty", "No saved sessions yet. Finish a Teach It Back session to build your report."));
    } else {
      holder.replaceChildren(...sessions.slice(0, 20).map((s) => {
        const row = el("article", "session-row");
        const left = el("div");
        left.append(el("h3", "", s.topic || "Untitled topic"), el("p", "", `${s.filename || "Uploaded PDF"} · ${wordsOf(s) || "—"} words · ${s.grammar || "Transcript metrics available"}`));
        const meta = el("div", "session-meta");
        const when = toTime(sessionTime(s));
        meta.append(document.createTextNode(when ? new Date(when).toLocaleDateString() : ""), document.createElement("br"), document.createTextNode(formatDuration(s.duration_seconds)));
        row.append(left, meta);
        return row;
      }));
    }
  }

  /* ───────── Ideas and thoughts (change every 3 minutes) ───────── */
  const ADVICE = {
    "missing-question-mark": "End your questions with “?”. It takes a second and keeps your writing clear.",
    "missing-terminal": "Finish sentences with a full stop, question mark or exclamation mark.",
    "lowercase-start": "Start each sentence with a capital letter.",
    "lowercase-i": "Write the pronoun “I” as a capital letter.",
    "missing-apostrophe": "Add apostrophes to contractions: don't, can't, I'm.",
    "misspelling": "Re-read for common misspellings. A quick spell check catches most of them.",
    "agreement": "Check that verbs match their subjects: he doesn't, they were.",
    "a-an": "Use “an” before vowel sounds and “a” before consonant sounds.",
    "run-on": "Split very long sentences in two. Shorter sentences are easier to follow.",
    "long-no-comma": "Add commas to long sentences to show where the reader should pause.",
    "repeated-word": "Look for accidental double words like “the the”.",
    "filler": "Replace fillers like “um” and “you know” with a short pause.",
    "space-before-punct": "Remove the space before commas, full stops and question marks.",
    "missing-space-after": "Add a space after every comma and full stop.",
    "repeated-punctuation": "One question mark or exclamation mark is enough.",
    "unbalanced-pairs": "Close every bracket and quotation mark you open.",
    "should-of": "Write “should have”, not “should of”.",
  };

  const STARTER_IDEAS = [
    { title: "Ask a “why” question", text: "Questions that start with why or how make the answer explain the reasoning, not just state a fact.", href: "ask.html", cta: "Ask a question" },
    { title: "Explain it out loud", text: "Teaching a topic in your own words quickly shows which parts you can’t yet explain. Those are the parts to review.", href: "teach.html", cta: "Open Teach Me" },
    { title: "Little and often", text: "Ten focused minutes every day beats one long session. A single question a day keeps your streak alive.", href: "ask.html", cta: "Ask today’s question" },
    { title: "Check the source page", text: "Open the source passages under an answer and read the original wording. It builds trust in the answer and in your notes." },
  ];
  const STARTER_THOUGHTS = [
    { title: "Understanding beats re-reading", text: "Re-reading feels productive, but explaining or being quizzed is what makes ideas stick." },
    { title: "Gaps are useful", text: "A question you can’t answer yet is a map of what to study next, not a sign you’re behind." },
    { title: "Progress is quiet", text: "Most learning is invisible while it happens. Charts like these make it visible after the fact." },
  ];

  function buildInsights(m) {
    const ideas = [];
    const thoughts = [];
    const g = m.grammar;

    // Pages that never came up in an answer.
    for (const doc of m.docs) {
      if (!doc.pages || !(doc.typed + doc.spoken)) continue;
      const missing = [];
      for (let page = 1; page <= doc.pages; page += 1) if (!doc.cited.has(page)) missing.push(page);
      if (missing.length && missing.length < doc.pages) {
        ideas.push({
          title: `Page ${missing[0]} hasn’t come up yet`,
          text: `“${truncate(doc.filename, 40)}” has ${plural(missing.length, "page", "pages")} you haven’t asked about (${toRanges(missing).slice(0, 40)}). Try a question about that material.`,
          href: "ask.html", cta: "Ask about it",
        });
      }
    }
    const target = goal();
    if (m.history.length && m.weekQuestions < target) {
      ideas.push({ title: `${plural(target - m.weekQuestions, "question", "questions")} from your weekly goal`, text: `You’ve asked ${m.weekQuestions} of ${target} this week. A couple of short sessions would get you there.`, href: "ask.html", cta: "Ask a question" });
    }
    if (m.streaks.current > 0 && !m.streaks.activeToday) {
      ideas.push({ title: `Keep your ${plural(m.streaks.current, "day", "days")} streak`, text: "You haven’t studied yet today. One question is enough to keep the streak going.", href: "ask.html", cta: "Ask now" });
    }
    if (m.typed >= 5 && m.spoken === 0) {
      ideas.push({ title: "Try asking out loud", text: "Everything so far was typed. Speaking a question is faster, and it practises explaining in your own words.", href: "speak.html", cta: "Open Speak" });
    }
    if (m.history.length >= 3 && m.sessions.length === 0) {
      ideas.push({ title: "Teach a topic back", text: "A Teach It Back session saves a transcript, which unlocks speaking-pace and filler-word feedback here.", href: "teach.html", cta: "Open Teach Me" });
    }
    if (m.avgQuestionWords != null && m.typed >= 5 && m.avgQuestionWords < 5) {
      ideas.push({ title: "Add context to your questions", text: `Your typed questions average ${m.avgQuestionWords.toFixed(1)} words. Adding what you want to know, such as “why”, “compare” or “in the context of…”, gets sharper answers.` });
    }
    for (const type of g.issueTypes.filter((t) => t.severity === "error" && t.count >= 2 && ADVICE[t.code]).slice(0, 3)) {
      ideas.push({ title: `Writing tip: ${type.label.toLowerCase()}`, text: `${ADVICE[type.code]} It came up ${type.count} times.` });
    }
    if (m.history.length >= 3) {
      ideas.push({ title: "Revisit saved answers", text: `You have ${plural(m.history.length, "saved answer", "saved answers")}. Reading back over them a day later is one of the easiest ways to remember them.`, href: "revision.html", cta: "Open Revision" });
    }
    const flat = m.rhythm.flat();
    if (Math.max(0, ...flat) >= 3) {
      let bestBlock = 0;
      const blockTotals = [0, 1, 2, 3].map((b) => m.rhythm.reduce((n, row) => n + row[b], 0));
      blockTotals.forEach((n, b) => { if (n > blockTotals[bestBlock]) bestBlock = b; });
      ideas.push({ title: `Plan around your ${BLOCKS[bestBlock].toLowerCase()}s`, text: `Most of your study happens in the ${BLOCKS[bestBlock].toLowerCase()}. Booking revision then makes it easier to stick to.` });
    }

    // Observations
    const busiest = m.weekdayTotals.indexOf(Math.max(...m.weekdayTotals));
    if (Math.max(...m.weekdayTotals) >= 3) {
      thoughts.push({ title: `${WEEKDAYS_LONG[busiest]} is your day`, text: `You’ve done ${plural(m.weekdayTotals[busiest], "study action", "study actions")} on ${WEEKDAYS_LONG[busiest]}s, more than any other weekday.` });
    }
    if (m.scoreDelta != null) {
      thoughts.push({
        title: m.scoreDelta > 0 ? "Your writing is improving" : m.scoreDelta < 0 ? "Your writing score dipped" : "Your writing is steady",
        text: m.scoreDelta === 0 ? "Your writing score matches the previous week." : `Your writing score is ${Math.abs(m.scoreDelta)} points ${m.scoreDelta > 0 ? "higher" : "lower"} than the previous week.${m.scoreDelta < 0 ? " One or two sloppy questions can cause this." : ""}`,
      });
    }
    if (m.history.length >= 4) {
      thoughts.push({ title: `${Math.round((m.spoken / m.history.length) * 100)}% of your questions are spoken`, text: m.spoken ? "Mixing speaking and typing helps: speaking is quicker, typing makes you phrase things precisely." : "Everything has been typed so far. Speaking is a different skill worth practising." });
    }
    if (m.avgQuestionWords != null && m.typed >= 3) {
      thoughts.push({ title: `${m.avgQuestionWords.toFixed(1)} words per question`, text: "That’s the average length of your typed questions. Longer questions usually carry more context." });
    }
    const covered = m.docs.reduce((n, d) => n + (d.pages ? Math.min(d.cited.size, d.pages) : 0), 0);
    const pages = m.docs.reduce((n, d) => n + (d.pages || 0), 0);
    if (pages) {
      thoughts.push({ title: `${Math.round((covered / pages) * 100)}% of your pages touched`, text: `Your answers have cited ${covered} of ${plural(pages, "page", "pages")} across ${plural(m.docs.filter((d) => d.pages).length, "document", "documents")}.` });
    }
    if (m.streaks.best >= 2) {
      thoughts.push({ title: `Your best streak is ${plural(m.streaks.best, "day", "days")}`, text: m.streaks.current === m.streaks.best ? "You’re on it right now." : `You’re at ${m.streaks.current} now. Beating ${m.streaks.best} is within reach.` });
    }
    if (g.vocabulary) {
      thoughts.push({ title: `${Math.round(g.vocabulary.ratio * 100)}% of your words are unique`, text: "A higher share means a more varied vocabulary. Short, focused questions naturally score lower, so don’t chase it." });
    }
    if (g.readability) {
      thoughts.push({ title: `Your writing reads as “${g.readability.label}”`, text: `Readability score ${g.readability.score}. Plain, easy writing is a strength when you are explaining something.` });
    }
    const scored = g.categories.filter((c) => c.score != null);
    if (scored.length >= 2) {
      const best = [...scored].sort((a, b) => b.score - a.score)[0];
      const worst = [...scored].sort((a, b) => a.score - b.score)[0];
      if (best.key !== worst.key) thoughts.push({ title: `Strongest: ${best.label}`, text: `${best.label} scores ${best.score}. Your lowest area is ${worst.label.toLowerCase()} at ${worst.score}.` });
    }

    for (const item of STARTER_IDEAS) if (ideas.length < 4) ideas.push(item);
    for (const item of STARTER_THOUGHTS) if (thoughts.length < 3) thoughts.push(item);
    return { ideas, thoughts };
  }

  let insights = { ideas: [], thoughts: [] };
  let shownSlot = Math.floor(Date.now() / SLOT_MS);
  let manualOffset = 0;

  const pick = (list, shift) => list[(((shownSlot + shift + manualOffset) % list.length) + list.length) % list.length];
  const slotIndex = (list, shift) => (((shownSlot + shift + manualOffset) % list.length) + list.length) % list.length;

  function fillInsight(prefix, list, shift) {
    const item = pick(list, shift);
    $(`#${prefix}Title`).textContent = item.title;
    $(`#${prefix}Text`).textContent = item.text;
    const cta = $(`#${prefix}Cta`);
    cta.hidden = !item.href;
    if (item.href) {
      cta.href = item.href;
      cta.replaceChildren(document.createTextNode(`${item.cta || "Open"} `), icon("arrow-right"));
    }
    $(`#${prefix}Count`).textContent = `${slotIndex(list, shift) + 1} of ${list.length}`;
  }

  function renderInsights(animate) {
    const update = () => {
      fillInsight("idea", insights.ideas, 0);
      fillInsight("thought", insights.thoughts, 1);
      renderIcons();
    };
    if (!animate || reduceMotion) {
      update();
      return;
    }
    const cards = [$("#ideaCard"), $("#thoughtCard")];
    cards.forEach((card) => card.classList.add("is-swapping"));
    setTimeout(() => {
      update();
      cards.forEach((card) => card.classList.remove("is-swapping"));
    }, 350);
  }

  function tick() {
    const slot = Math.floor(Date.now() / SLOT_MS);
    if (slot !== shownSlot) {
      shownSlot = slot;
      manualOffset = 0;
      renderInsights(true);
    }
    const remaining = SLOT_MS - (Date.now() % SLOT_MS);
    const seconds = Math.ceil(remaining / 1000);
    $("#timerText").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    $("#timerFill").style.width = `${(remaining / SLOT_MS) * 100}%`;
  }

  $("#nextInsight")?.addEventListener("click", () => {
    manualOffset += 1;
    renderInsights(true);
  });

  /* ───────── Render everything ───────── */
  function rebuildFilter() {
    const select = $("#docFilter");
    const previous = select.value || "all";
    const history = loadHistory();
    const library = loadLibrary();
    const seen = new Map();
    for (const item of library) seen.set(item.document_id, item.filename || "Untitled PDF");
    for (const entry of history) if (!seen.has(entry.document_id)) seen.set(entry.document_id, entry.filename || "Untitled PDF");
    for (const session of mergeSessions(localSessions(), remoteSessions)) if (session.document_id && !seen.has(session.document_id)) seen.set(session.document_id, session.filename || "Untitled PDF");
    const options = [new Option("All documents", "all")];
    for (const [id, name] of seen) options.push(new Option(truncate(name, 48), id));
    select.replaceChildren(...options);
    select.value = seen.has(previous) || previous === "all" ? previous : "all";
  }

  function render() {
    rebuildFilter();
    const m = buildModel();

    const notice = $("#notice");
    notice.hidden = !m.empty;
    if (m.empty) notice.textContent = m.filter === "all"
      ? "No activity yet. Upload a PDF and ask a question, and every chart on this page fills in from your own data."
      : "Nothing recorded for this document yet.";

    renderStats(m);
    renderActivity(m);
    renderDonut(m);
    renderGoal(m);
    renderRhythm(m);
    renderMilestones(m);
    renderDocuments(m);
    renderGrammar(m);
    renderSessions(m);

    insights = buildInsights(m);
    renderInsights(false);
    tick();
    renderIcons();
  }

  $("#docFilter")?.addEventListener("change", render);
  $("#rangeToggle")?.addEventListener("click", () => {
    rangeDays = rangeDays === 7 ? 30 : 7;
    render();
  });

  /* ───────── Scroll reveal ───────── */
  const items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });
    items.forEach((item) => observer.observe(item));
  } else {
    items.forEach((item) => item.classList.add("is-in"));
  }

  window.addEventListener("storage", (event) => {
    if ([KEY.history, KEY.library, KEY.sessions, KEY.goal].includes(event.key)) render();
  });
  window.addEventListener("pageshow", (event) => { if (event.persisted) render(); });

  render();
  setInterval(tick, 1000);

  // Sessions saved by the backend (optional). The page works without it.
  if (typeof fetch === "function") {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), 3000);
    fetch(`${API_BASE}/api/reports/overview`, controller ? { signal: controller.signal } : undefined)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.sessions) && data.sessions.length) {
          remoteSessions = data.sessions;
          render();
        }
      })
      .catch(() => { /* backend has no reports endpoint: local data only */ })
      .finally(() => clearTimeout(timer));
  }
});