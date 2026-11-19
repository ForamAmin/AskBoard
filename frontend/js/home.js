/* AskBoard home: fills the dashboard with the user's real activity.
   Reads localStorage (askboard-history, askboard-library, askboard-name) and the
   current document from sessionStorage (askboard-document). Nothing is invented:
   with no activity, every widget shows an honest empty state. */
document.addEventListener("DOMContentLoaded", () => {
  const KEY = {
    doc: "askboard-document",
    history: "askboard-history",
    library: "askboard-library",
    name: "askboard-name",
  };
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DOC_ICON_CLASSES = ["purple", "blue", "amber"];
  const reduceMotion = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const $ = (selector) => document.querySelector(selector);
  const toast = (message) => (window.askboardToast ? window.askboardToast(message) : undefined);
  const renderIcons = () => {
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  };

  /* ───────── Small helpers ───────── */
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

  const icon = (name) => {
    const node = document.createElement("i");
    node.setAttribute("data-lucide", name);
    return node;
  };

  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const toTime = (iso) => {
    const time = Date.parse(iso);
    return Number.isNaN(time) ? 0 : time;
  };
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  const dayKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const shortDate = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

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

  const truncate = (text, max) => {
    const clean = String(text).replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
  };

  // Plain text for previews: no markdown bold and no [Page N] citations.
  const plainAnswer = (text) =>
    String(text).replace(/\s*\[Pages? [\d,\s]+\]/g, "").replace(/\*\*/g, "").replace(/^[*-]\s+/gm, "");

  const animateCount = (node, target) => {
    if (!node) return;
    if (node.dataset.value === String(target)) return;
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

  /* ───────── Data ───────── */
  const loadHistory = () => {
    const raw = readJson(localStorage, KEY.history, []);
    return Array.isArray(raw)
      ? raw.filter((entry) => entry && typeof entry.question === "string" && typeof entry.document_id === "string")
      : [];
  };

  const loadLibrary = () => {
    const raw = readJson(localStorage, KEY.library, []);
    return Array.isArray(raw) ? raw.filter((item) => item && typeof item.document_id === "string") : [];
  };

  const loadCurrent = () => {
    const doc = readJson(sessionStorage, KEY.doc, null);
    return doc && typeof doc.document_id === "string" && doc.document_id ? doc : null;
  };

  // One entry per document, combining the upload library with the saved questions.
  const buildDocuments = (history, library, current) => {
    const map = new Map();

    for (const item of library) {
      map.set(item.document_id, {
        id: item.document_id,
        filename: item.filename || "Untitled PDF",
        pages: Number.isInteger(item.page_count) ? item.page_count : null,
        chunks: Number.isInteger(item.chunk_count) ? item.chunk_count : null,
        characters: Number(item.character_count) || 0,
        uploadedAt: item.uploaded_at || null,
        lastAt: item.uploaded_at || null,
        questions: 0,
      });
    }

    for (const entry of history) {
      let doc = map.get(entry.document_id);
      if (!doc) {
        doc = {
          id: entry.document_id,
          filename: entry.filename || "Untitled PDF",
          pages: null, chunks: null, characters: 0, uploadedAt: null, lastAt: entry.created_at || null, questions: 0,
        };
        map.set(entry.document_id, doc);
      }
      doc.questions += 1;
      if (toTime(entry.created_at) > toTime(doc.lastAt)) doc.lastAt = entry.created_at;
    }

    // A document uploaded before the library existed is still the current one.
    if (current && !map.has(current.document_id)) {
      map.set(current.document_id, {
        id: current.document_id,
        filename: current.filename || "Uploaded PDF",
        pages: null, chunks: null, characters: Number(current.character_count) || 0,
        uploadedAt: null, lastAt: null, questions: 0,
      });
    }

    return [...map.values()].sort((a, b) => toTime(b.lastAt) - toTime(a.lastAt));
  };

  const citedPages = (history, doc) => {
    const pages = new Set();
    for (const entry of history) {
      if (entry.document_id !== doc.id) continue;
      for (const source of entry.sources || []) {
        if (Number.isInteger(source.page) && source.page >= 1 && (!doc.pages || source.page <= doc.pages)) pages.add(source.page);
      }
    }
    return pages.size;
  };

  const dailyCounts = (history, days) => {
    const counts = new Map();
    for (const entry of history) {
      const time = toTime(entry.created_at);
      if (!time) continue;
      const key = dayKey(new Date(time));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const today = startOfDay(new Date());
    const series = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = addDays(today, -i);
      series.push({ date, count: counts.get(dayKey(date)) || 0 });
    }
    return series;
  };

  const computeStreak = (history) => {
    const keys = new Set(history.filter((e) => toTime(e.created_at)).map((e) => dayKey(new Date(toTime(e.created_at)))));
    const today = startOfDay(new Date());
    const activeToday = keys.has(dayKey(today));
    let cursor = activeToday ? today : addDays(today, -1);
    let streak = 0;
    while (keys.has(dayKey(cursor))) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }
    return { streak, activeToday };
  };

  /* ───────── State ───────── */
  let history = [];
  let library = [];
  let current = null;
  let docs = [];
  let rangeDays = 7;
  let drawChartNext = true;

  /* ───────── Greeting, name, header buttons ───────── */
  const getName = () => (localStorage.getItem(KEY.name) || "").trim();

  const renderGreeting = () => {
    const now = new Date();
    const hour = now.getHours();
    const dateLabel = $("#todayDate");
    if (dateLabel) {
      dateLabel.textContent = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    }
    $("#greeting").textContent = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const first = getName().split(/\s+/)[0];
    $("#greetingName").textContent = first ? `, ${first}` : "";
  };

  const renderAvatar = () => {
    const avatar = $("#avatarButton");
    const name = getName();
    avatar.replaceChildren();
    if (name) {
      const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
      avatar.textContent = initials;
      avatar.setAttribute("aria-label", `${name}. Click to change your name`);
      avatar.title = "Change your name";
    } else {
      avatar.append(icon("user"));
      avatar.setAttribute("aria-label", "Set your name");
      avatar.title = "Set your name";
    }
  };

  $("#avatarButton")?.addEventListener("click", () => {
    const answer = window.prompt("What should AskBoard call you?", getName());
    if (answer === null) return;
    const name = answer.trim().slice(0, 40);
    try {
      if (name) localStorage.setItem(KEY.name, name);
      else localStorage.removeItem(KEY.name);
    } catch { /* storage unavailable */ }
    renderGreeting();
    renderAvatar();
    renderIcons();
  });

  const renderHeader = () => {
    const hasDoc = Boolean(current);
    $("#headAsk").hidden = !hasDoc;
    $("#headUpload").hidden = hasDoc;
  };

  /* ───────── Hero preview: your latest answer ───────── */
  const previewBody = $("#previewBody");
  const previewEmptyHtml = previewBody.innerHTML;

  const renderHero = () => {
    const latest = [...history].sort((a, b) => toTime(b.created_at) - toTime(a.created_at))[0];
    const label = $("#previewLabel");

    if (!latest) {
      label.textContent = "Latest answer";
      previewBody.innerHTML = previewEmptyHtml;
      return;
    }

    label.textContent = `Latest answer · ${relativeTime(latest.created_at)}`;

    const question = el("div", "bubble bubble-q");
    question.append(icon(latest.mode === "voice" ? "mic" : "message-square-text"), el("span", "", truncate(latest.question, 140)));

    const answer = el("div", "bubble bubble-a");
    answer.append(el("p", "", truncate(plainAnswer(latest.answer), 240)));

    const pages = [...new Set((latest.sources || []).map((s) => s.page).filter((p) => p != null))].sort((a, b) => a - b).slice(0, 4);
    if (pages.length) {
      const row = el("div", "source-row");
      for (const page of pages) {
        const chip = el("span", "source-chip");
        chip.append(icon("file-text"), document.createTextNode(` Page ${page}`));
        row.append(chip);
      }
      answer.append(row);
    }

    previewBody.replaceChildren(question, answer);
  };

  /* ───────── Stats ───────── */
  const setFoot = (node, ...children) => node.replaceChildren(...children);
  const positive = (text, iconName) => {
    const span = el("span", "positive");
    if (iconName) span.append(icon(iconName));
    span.append(document.createTextNode(text));
    return span;
  };

  const renderStats = () => {
    const { streak, activeToday } = computeStreak(history);
    animateCount($("#statStreak"), streak);
    $("#statStreakUnit").textContent = streak === 1 ? "day" : "days";
    setFoot(
      $("#statStreakFoot"),
      activeToday
        ? positive(" Studied today", "check")
        : document.createTextNode(streak > 0 ? "Ask a question today to keep it going" : "Ask a question to start your streak")
    );

    // Questions: this week against the week before.
    const today = startOfDay(new Date());
    const weekStart = addDays(today, -6).getTime();
    const prevStart = addDays(today, -13).getTime();
    let thisWeek = 0;
    let lastWeek = 0;
    for (const entry of history) {
      const time = toTime(entry.created_at);
      if (time >= weekStart) thisWeek += 1;
      else if (time >= prevStart) lastWeek += 1;
    }
    animateCount($("#statQuestions"), history.length);
    const questionFoot = $("#statQuestionsFoot");
    if (lastWeek > 0) {
      const change = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
      const trend = change >= 0 ? positive(` ${change}%`, "trending-up") : el("span", "negative");
      if (change < 0) trend.append(icon("trending-down"), document.createTextNode(` ${Math.abs(change)}%`));
      setFoot(questionFoot, trend, document.createTextNode(" vs last week"));
    } else {
      setFoot(questionFoot, document.createTextNode(history.length ? `${plural(thisWeek, "question", "questions")} this week` : "Nothing asked yet"));
    }

    // Documents
    animateCount($("#statDocuments"), docs.length);
    const knownPages = docs.reduce((sum, doc) => sum + (doc.pages || 0), 0);
    setFoot(
      $("#statDocumentsFoot"),
      document.createTextNode(knownPages ? `${plural(knownPages, "page", "pages")} indexed` : docs.length ? "Open one to start studying" : "Upload a PDF to begin")
    );

    // Pages covered: distinct pages cited in your answers, out of the pages you uploaded.
    let covered = 0;
    let total = 0;
    for (const doc of docs) {
      if (!doc.pages) continue;
      covered += citedPages(history, doc);
      total += doc.pages;
    }
    animateCount($("#statCovered"), covered);
    $("#statCoveredOf").textContent = total ? `of ${plural(total, "page", "pages")}` : "pages";

    const coveredFoot = $("#statCoveredFoot");
    if (total) {
      const percent = Math.round((covered / total) * 100);
      const bar = el("span", "mini-progress");
      const fill = document.createElement("i");
      fill.style.width = "0%";
      bar.append(fill);
      setFoot(coveredFoot, el("span", "", `${percent}% covered`), bar);
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${percent}%`; }));
    } else {
      setFoot(coveredFoot, document.createTextNode("Upload a PDF to track coverage"));
    }
  };

  /* ───────── Activity chart ───────── */
  const chart = $("#chart");
  const chartSvg = $("#chartSvg");

  const curvePath = (points) => {
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
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  };

  const renderChart = () => {
    const series = dailyCounts(history, rangeDays);
    const max = Math.max(...series.map((item) => item.count));
    const niceMax = Math.max(4, Math.ceil(max / 4) * 4);
    const total = series.reduce((sum, item) => sum + item.count, 0);

    $("#rangeLabel").textContent = `Last ${rangeDays} days`;
    $("#chartY").replaceChildren(...[4, 3, 2, 1, 0].map((step) => el("span", "", String(Math.round((niceMax * step) / 4)))));

    // X labels: every weekday for 7 days, five dates for 30 days.
    const labels = rangeDays <= 7
      ? series.map((item) => item.date.toLocaleDateString(undefined, { weekday: "short" }))
      : [0, 0.25, 0.5, 0.75, 1].map((fraction) => shortDate(series[Math.round(fraction * (series.length - 1))].date));
    $("#chartX").replaceChildren(...labels.map((text) => el("span", "", text)));

    $("#chartEmpty").hidden = total > 0;
    $("#chartCaption").textContent = total
      ? `${plural(total, "question", "questions")} in the last ${rangeDays} days`
      : "No questions in this period yet.";

    const width = chart.clientWidth || 600;
    const height = chartSvg.getBoundingClientRect().height || 196;
    chartSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const pad = 8;
    const step = (width - pad * 2) / (series.length - 1);
    const points = series.map((item, index) => ({
      x: pad + index * step,
      y: height - (item.count / niceMax) * height,
    }));

    const line = curvePath(points);
    $("#chartLine").setAttribute("d", line);
    $("#chartArea").setAttribute("d", line ? `${line} L${points[points.length - 1].x.toFixed(1)},${height} L${points[0].x.toFixed(1)},${height} Z` : "");

    const dots = $("#chartDots");
    dots.replaceChildren();
    series.forEach((item, index) => {
      if (!item.count) return;
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("class", `chart-dot${index === series.length - 1 ? " is-last" : ""}`);
      dot.setAttribute("cx", points[index].x.toFixed(1));
      dot.setAttribute("cy", points[index].y.toFixed(1));
      dot.setAttribute("r", index === series.length - 1 ? "5" : "4");
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${shortDate(item.date)}: ${plural(item.count, "question", "questions")}`;
      dot.append(title);
      dots.append(dot);
    });

    if (drawChartNext && !reduceMotion) {
      chartSvg.classList.remove("is-drawing");
      void chartSvg.getBoundingClientRect(); // restart the animation
      chartSvg.classList.add("is-drawing");
    }
    drawChartNext = false;
  };

  $("#rangeToggle")?.addEventListener("click", () => {
    rangeDays = rangeDays === 7 ? 30 : 7;
    drawChartNext = true;
    renderChart();
  });

  if (window.ResizeObserver) {
    let frame = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(renderChart);
    }).observe(chart);
  }

  /* ───────── Continue studying ───────── */
  const selectDocument = (doc) => {
    const parts = [
      doc.pages ? `${doc.pages} ${doc.pages === 1 ? "page" : "pages"} extracted` : null,
      doc.chunks ? `${doc.chunks} searchable chunks` : null,
      `ID ${doc.id}`,
    ].filter(Boolean);
    try {
      sessionStorage.setItem(KEY.doc, JSON.stringify({
        document_id: doc.id,
        filename: doc.filename,
        meta: parts.join(" · "),
        character_count: doc.characters || 0,
        preview: "Selected from your library.",
        dismissed: true,
      }));
    } catch { /* storage unavailable */ }
    refresh();
    toast(`Now studying ${truncate(doc.filename, 40)}.`);
  };

  const actionButton = (label, href, iconName, className) => {
    const link = el("a", `button ${className}`);
    link.href = href;
    link.append(icon(iconName), document.createTextNode(` ${label}`));
    return link;
  };

  const renderFocus = () => {
    const body = $("#focusBody");
    const card = el("div", "focus-card");
    const top = el("div", "focus-card-top");
    const doc = current ? docs.find((item) => item.id === current.document_id) : null;
    const suggestion = !doc ? docs[0] : null;

    if (doc) {
      top.append(el("span", "subject-badge", "CURRENT DOCUMENT"), el("span", "", doc.pages ? plural(doc.pages, "page", "pages") : "Ready"));
      card.append(top, el("h3", "", doc.filename));
      card.querySelector("h3").title = doc.filename;

      const last = history.filter((entry) => entry.document_id === doc.id).sort((a, b) => toTime(b.created_at) - toTime(a.created_at))[0];
      card.append(el("p", "", last ? `Last question: “${truncate(last.question, 90)}”` : "No questions yet. Ask your first one."));

      if (doc.pages) {
        const covered = citedPages(history, doc);
        const percent = Math.round((covered / doc.pages) * 100);
        const progress = el("div", "focus-progress");
        const labels = document.createElement("div");
        labels.append(el("span", "", "Pages covered"), el("strong", "", `${covered} of ${doc.pages}`));
        const track = el("div", "progress-track");
        const fill = document.createElement("i");
        fill.style.width = "0%";
        track.append(fill);
        progress.append(labels, track);
        card.append(progress);
        requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${percent}%`; }));
      }

      card.append(actionButton("Ask a question", "ask.html", "message-square-text", "button-light"));
      const links = el("div", "focus-links");
      links.append(actionButton("Speak", "speak.html", "mic", ""), actionButton("Teach Me", "teach.html", "graduation-cap", ""));
      card.append(links);
    } else if (suggestion) {
      top.append(el("span", "subject-badge", "RECENT DOCUMENT"), el("span", "", suggestion.pages ? plural(suggestion.pages, "page", "pages") : ""));
      card.append(top, el("h3", "", suggestion.filename));
      card.querySelector("h3").title = suggestion.filename;
      card.append(el("p", "", "Pick up where you left off, or choose another document below."));
      const use = el("button", "button button-light");
      use.type = "button";
      use.append(icon("book-open"), document.createTextNode(" Use this document"));
      use.addEventListener("click", () => selectDocument(suggestion));
      card.append(use);
    } else {
      top.append(el("span", "subject-badge", "GET STARTED"));
      card.append(top, el("h3", "", "Upload your first PDF"));
      card.append(el("p", "", "AskBoard splits it into searchable pieces and remembers which page each answer came from."));
      const upload = el("button", "button button-light");
      upload.type = "button";
      upload.append(icon("upload-cloud"), document.createTextNode(" Upload notes"));
      upload.addEventListener("click", () => $("#pdfFileInput")?.click());
      card.append(upload);
    }

    body.replaceChildren(card);

    const saved = history.length;
    const newest = [...history].sort((a, b) => toTime(b.created_at) - toTime(a.created_at))[0];
    $("#reviseText").textContent = saved
      ? `${plural(saved, "answer", "answers")} saved · last ${relativeTime(newest.created_at)}`
      : "Nothing saved yet";
  };

  /* ───────── Recent documents ───────── */
  const documentMeta = (doc) => {
    const parts = [];
    if (doc.uploadedAt && toTime(doc.uploadedAt) >= toTime(doc.lastAt)) parts.push(`Uploaded ${relativeTime(doc.uploadedAt)}`);
    else if (doc.lastAt) parts.push(`Last used ${relativeTime(doc.lastAt)}`);
    else parts.push("Selected this session");
    if (doc.pages) parts.push(plural(doc.pages, "page", "pages"));
    return parts.join(" · ");
  };

  const renderDocuments = () => {
    const list = $("#documentsList");
    const empty = $("#documentsEmpty");
    const query = ($("#documentSearch")?.value || "").toLowerCase().trim();
    const matches = docs.filter((doc) => doc.filename.toLowerCase().includes(query));
    const shown = matches.slice(0, query ? 50 : 6);

    list.replaceChildren();
    shown.forEach((doc, index) => {
      const isCurrent = current && current.document_id === doc.id;
      const row = el("article", `document-row${isCurrent ? " is-current" : ""}`);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Study ${doc.filename}`);

      const fileIcon = el("div", `file-icon ${DOC_ICON_CLASSES[index % DOC_ICON_CLASSES.length]}`);
      fileIcon.append(icon("file-text"));

      const info = el("div", "document-info");
      const name = el("strong", "", doc.filename);
      name.title = doc.filename;
      info.append(name, el("span", "", documentMeta(doc)));

      const tag = el(
        "span",
        `document-tag ${isCurrent ? "purple-tag" : "gray-tag"}`,
        isCurrent ? "Current" : doc.questions ? plural(doc.questions, "question", "questions") : "Not asked yet"
      );

      const more = el("span", "row-more");
      more.append(icon("chevron-right"));

      row.append(fileIcon, info, tag, more);
      const choose = () => selectDocument(doc);
      row.addEventListener("click", choose);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose();
        }
      });
      list.append(row);
    });

    const emptyText = empty.querySelectorAll("*");
    if (!docs.length) {
      emptyText[0].textContent = "No documents yet";
      emptyText[1].textContent = "Upload a PDF and it will show up here.";
    } else {
      emptyText[0].textContent = "No documents match your search";
      emptyText[1].textContent = "Try a different name.";
    }
    empty.classList.toggle("is-visible", shown.length === 0);
  };

  $("#documentSearch")?.addEventListener("input", renderDocuments);

  /* ───────── Quick actions ───────── */
  const renderQuickActions = () => {
    const doc = current ? docs.find((item) => item.id === current.document_id) : null;
    const using = doc ? `Using ${truncate(doc.filename, 28)}` : "Upload a PDF first";
    $("#askSub").textContent = doc ? using : "Upload a PDF first";
    $("#speakSub").textContent = doc ? using : "Upload a PDF first";
    $("#teachSub").textContent = doc ? "Quiz, teach back, explain" : "Upload a PDF first";
  };

  /* ───────── Scroll reveal ───────── */
  const setupReveal = () => {
    const items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-in"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    items.forEach((item) => observer.observe(item));
  };

  /* ───────── Render everything ───────── */
  function refresh() {
    history = loadHistory();
    library = loadLibrary();
    current = loadCurrent();
    docs = buildDocuments(history, library, current);

    renderGreeting();
    renderAvatar();
    renderHeader();
    renderHero();
    renderStats();
    renderChart();
    renderFocus();
    renderDocuments();
    renderQuickActions();
    renderIcons();
  }

  window.addEventListener("askboard:library-changed", refresh);
  window.addEventListener("storage", (event) => {
    if ([KEY.history, KEY.library, KEY.name].includes(event.key)) refresh();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refresh(); // coming back with the Back button
  });

  setupReveal();
  refresh();
});