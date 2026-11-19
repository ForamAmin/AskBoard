/* AskBoard grammar and writing analysis.
   Rule-based and runs entirely in the browser. It checks the things a rule can
   check reliably (punctuation, capitalisation, common spelling and usage slips,
   sentence length, fillers). It is not a full grammar engine and says so in the UI.
   Spoken text (voice questions, Teach It Back transcripts) is produced by a speech
   engine, so punctuation and capitalisation are not scored for it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AskBoardGrammar = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const clip = (text, max = 90) => {
    const clean = String(text).replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
  };

  const CATEGORIES = [
    { key: "punctuation", label: "Punctuation", weight: 0.2, unit: "sentence", checks: "Ending marks, question marks, spacing, apostrophes, paired brackets and quotes" },
    { key: "capitalization", label: "Capitalisation", weight: 0.15, unit: "sentence", checks: "Capital letters at the start of sentences and for “I”" },
    { key: "spelling", label: "Spelling", weight: 0.15, unit: "word", checks: "Frequently misspelled words and “alot”-style merges" },
    { key: "usage", label: "Grammar & usage", weight: 0.2, unit: "word", checks: "Subject–verb agreement, a / an, “should of”" },
    { key: "structure", label: "Sentence structure", weight: 0.15, unit: "sentence", checks: "Run-on and very long sentences" },
    { key: "style", label: "Style & word choice", weight: 0.15, unit: "word", checks: "Repeated words and filler words" },
  ];

  const ISSUE_LABELS = {
    "missing-terminal": "No ending punctuation",
    "missing-question-mark": "Question without “?”",
    "repeated-punctuation": "Repeated punctuation",
    "space-before-punct": "Space before punctuation",
    "missing-space-after": "Missing space after punctuation",
    "missing-apostrophe": "Missing apostrophe",
    "unbalanced-pairs": "Unclosed bracket or quote",
    "lowercase-start": "Sentence starts in lowercase",
    "lowercase-i": "Lowercase “i”",
    "misspelling": "Common misspelling",
    "agreement": "Subject–verb agreement",
    "a-an": "“a” / “an” mix-up",
    "should-of": "“should of” for “should have”",
    "run-on": "Very long sentence",
    "long-no-comma": "Long sentence, no commas",
    "keyword-query": "Keyword-only query",
    "repeated-start": "Repeated sentence openers",
    "repeated-word": "Repeated word",
    "filler": "Filler word",
    "passive": "Possible passive voice",
  };

  const INTERROGATIVES = new Set([
    "who", "whom", "whose", "what", "when", "where", "why", "which", "how",
    "is", "are", "am", "was", "were", "do", "does", "did", "can", "could", "will", "would",
    "shall", "should", "may", "might", "must", "have", "has", "had",
  ]);
  const WH_WORDS = new Set(["who", "whom", "whose", "what", "when", "where", "why", "which", "how"]);

  const MISSPELLINGS = {
    teh: "the", recieve: "receive", definately: "definitely", seperate: "separate", occured: "occurred",
    untill: "until", wich: "which", adress: "address", begining: "beginning", beleive: "believe",
    becuase: "because", becasue: "because", thier: "their", wierd: "weird", alot: "a lot",
    accomodate: "accommodate", acheive: "achieve", agressive: "aggressive", arguement: "argument",
    calender: "calendar", comming: "coming", concious: "conscious", dependant: "dependent",
    enviroment: "environment", existance: "existence", foriegn: "foreign", goverment: "government",
    independant: "independent", knowlege: "knowledge", neccessary: "necessary", noticable: "noticeable",
    occassion: "occasion", persue: "pursue", posession: "possession", prefered: "preferred",
    publically: "publicly", realy: "really", refered: "referred", relevent: "relevant",
    responsability: "responsibility", succesful: "successful", tommorow: "tomorrow", truely: "truly",
    writting: "writing", wether: "whether", wat: "what", waht: "what", hte: "the", adn: "and",
    taht: "that", whcih: "which", thsi: "this", tihs: "this", diffrent: "different", intresting: "interesting",
  };

  const MISSING_APOSTROPHE = {
    dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't", wont: "won't", isnt: "isn't",
    arent: "aren't", wasnt: "wasn't", werent: "weren't", shouldnt: "shouldn't", couldnt: "couldn't",
    wouldnt: "wouldn't", hasnt: "hasn't", havent: "haven't", hadnt: "hadn't", im: "I'm", ive: "I've",
    youre: "you're", theyre: "they're", thats: "that's", whats: "what's", theres: "there's",
  };

  const AGREEMENT = [
    [/\b(he|she|it)\s+(don't|dont)\b/gi, (m) => `${m[1]} doesn't`],
    [/\b(he|she|it)\s+(are|were)\b/gi, (m) => `${m[1]} ${m[2].toLowerCase() === "are" ? "is" : "was"}`],
    [/\b(he|she|it)\s+have\b/gi, (m) => `${m[1]} has`],
    [/\b(they|we|you)\s+(is)\b/gi, (m) => `${m[1]} are`],
    [/\b(they|we|you)\s+(was)\b/gi, (m) => `${m[1]} were`],
    [/\b(they|we|you)\s+(doesn't|doesnt|has)\b/gi, (m) => `${m[1]} ${m[2].toLowerCase() === "has" ? "have" : "don't"}`],
    [/\bI\s+(is|are|has)\b/g, (m) => `I ${m[1] === "has" ? "have" : "am"}`],
    [/\b(this)\s+(are|were)\b/gi, (m) => `this ${m[2].toLowerCase() === "are" ? "is" : "was"}`],
    [/\b(these|those)\s+(is|was)\b/gi, (m) => `${m[1]} ${m[2].toLowerCase() === "is" ? "are" : "were"}`],
  ];

  const A_BEFORE_VOWEL_OK = /^(one|once|use|used|useful|user|usual|usually|utility|unit|united|uniform|union|unique|universe|university|uni|euro|eu|ubiquit)/i;
  const AN_BEFORE_CONSONANT_OK = /^(hour|honest|honou?r|heir|herb)/i;

  const FILLERS = [
    ["um", /\bum+\b/gi, false], ["uh", /\b(?:uh+|er|erm)\b/gi, false],
    ["you know", /\byou know\b/gi, false], ["i mean", /\bi mean\b/gi, false],
    ["kind of", /\bkind of\b/gi, false], ["sort of", /\bsort of\b/gi, false],
    ["like", /,\s*like\b|\blike\s*,/gi, false],
    ["basically", /\bbasically\b/gi, true], ["literally", /\bliterally\b/gi, true], ["actually", /\bactually\b/gi, true],
  ];

  const NOT_PASSIVE = new Set([
    "need", "speed", "feed", "seed", "indeed", "tired", "excited", "interested", "worried", "concerned",
    "confused", "surprised", "pleased", "bored", "scared", "supposed", "advanced", "determined",
    "talented", "skilled", "experienced", "married", "used",
  ]);
  const PASSIVE = /\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?([a-z]{2,}ed|known|shown|seen|given|taken|written|done|made|found|built|held|chosen|broken|spoken)\b/gi;

  const STOP_WORDS = new Set((
    "the and for are but not you all can her was one our out day get has him his how its may new now old see two way " +
    "who did does what when where which why with that this from have they been into than then them there these those " +
    "their about would could should will your some also each other more most such only over just like very much many " +
    "doing were being between because while during before after above below again once is it in on of to a an as at be by " +
    "do he i me my no or so up us we if am"
  ).split(" "));

  const tokenize = (text) => String(text).match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || [];

  function splitSentences(text) {
    const guarded = text.replace(/\b(e\.g|i\.e|etc|vs|fig|dr|mr|mrs|ms|st|approx)\./gi, "$1\u0001");
    return guarded
      .split(/(?<=[.!?])["')\]”’]*\s+|\n+/)
      .map((part) => part.replace(/\u0001/g, ".").trim())
      .filter(Boolean);
  }

  function syllables(word) {
    const w = String(word).toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 0;
    if (w.length <= 3) return 1;
    const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const groups = stripped.match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  const count = (text, regex) => (text.match(regex) || []).length;

  function countMarks(text) {
    return {
      commas: count(text, /,/g),
      periods: count(text, /\.(?=\s|$)/g) - count(text, /\.\.\./g),
      questionMarks: count(text, /\?/g),
      exclamations: count(text, /!/g),
      apostrophes: count(text, /[A-Za-z]['’][A-Za-z]/g),
      colons: count(text, /:/g),
      semicolons: count(text, /;/g),
      brackets: count(text, /\(/g),
      quotes: Math.floor(count(text, /["“”]/g) / 2),
      dashes: count(text, /[—–]|\s-\s/g),
    };
  }

  // Analyse one piece of text. options.spoken = produced by speech recognition.
  function analyzeText(raw, options = {}) {
    const spoken = Boolean(options.spoken);
    const text = String(raw == null ? "" : raw).replace(/\r/g, "").trim();
    const issues = [];
    const add = (category, code, message, excerpt, fix = "", severity = "error", detail = "") => {
      issues.push({ category, code, message, excerpt: clip(excerpt), fix, severity, detail });
    };

    const words = tokenize(text);
    const reliable = !spoken || /[.!?]/.test(text);
    const sentences = reliable ? splitSentences(text) : [];
    const typedSentences = spoken ? 0 : sentences.length;
    const sentenceLengths = [];
    const questions = { total: 0, marked: 0 };

    // ── Sentence-level checks ──
    const starts = new Map();
    sentences.forEach((sentence) => {
      const sWords = tokenize(sentence);
      const wordCount = sWords.length;
      sentenceLengths.push(wordCount);
      const first = (sWords[0] || "").toLowerCase();
      starts.set(first, (starts.get(first) || 0) + 1);

      const hasTerminal = /[.!?]["')\]”’]*$/.test(sentence);
      const endsQuestion = /\?["')\]”’]*$/.test(sentence);
      const endsPeriod = /\.["')\]”’]*$/.test(sentence);
      const questionLike = INTERROGATIVES.has(first);

      if (!spoken) {
        if (questionLike && (endsQuestion || !hasTerminal)) {
          questions.total += 1;
          if (endsQuestion) questions.marked += 1;
        }
        if (!hasTerminal) {
          if (questionLike) add("punctuation", "missing-question-mark", "Looks like a question but has no “?”", sentence, "Add “?” at the end");
          else add("punctuation", "missing-terminal", "No ending punctuation", sentence, "End with “.”, “?” or “!”");
        } else if (WH_WORDS.has(first) && endsPeriod && wordCount <= 14) {
          questions.total += 1;
          add("punctuation", "missing-question-mark", "Question word but the sentence ends with a full stop", sentence, "Use “?” if this is a question");
        }

        const lead = sentence.replace(/^[^A-Za-z]+/, "");
        if (/^[a-z]/.test(lead) && !/^[a-z][A-Z]/.test(lead)) {
          add("capitalization", "lowercase-start", "Sentence starts with a lowercase letter", sentence, "Capitalise the first word");
        }
        if (wordCount > 0 && wordCount <= 2 && !endsQuestion) {
          add("structure", "keyword-query", "Very short: a full question gets better answers", sentence, "", "note");
        }
      }

      const longLimit = spoken ? 45 : 35;
      if (wordCount > longLimit) {
        add("structure", "run-on", `Very long sentence (${wordCount} words)`, sentence, "Split it into shorter sentences");
      } else if (wordCount >= 25 && !/,/.test(sentence)) {
        add("structure", "long-no-comma", `Long sentence (${wordCount} words) with no commas`, sentence, "Add commas or split it");
      }
    });

    if (sentences.length >= 4) {
      for (const [word, total] of starts) {
        if (word && total >= 3) add("structure", "repeated-start", `${total} sentences start with “${word}”`, word, "Vary how sentences begin", "note");
      }
    }

    // ── Typed-only punctuation and capitalisation checks ──
    if (!spoken) {
      for (const match of text.matchAll(/(?:^|[\s“"])(i)(?=$|[\s,.;:!?)”"]|['’](?:m|ll|ve|d)\b)(?!\.e\b)/g)) {
        add("capitalization", "lowercase-i", "Use a capital “I”", text.slice(Math.max(0, match.index - 12), match.index + 18), "Write “I”");
      }
      for (const match of text.matchAll(/\b(dont|doesnt|didnt|cant|wont|isnt|arent|wasnt|werent|shouldnt|couldnt|wouldnt|hasnt|havent|hadnt|im|ive|youre|theyre|thats|whats|theres)\b/gi)) {
        const fix = MISSING_APOSTROPHE[match[1].toLowerCase()];
        add("punctuation", "missing-apostrophe", `Missing apostrophe in “${match[1]}”`, match[0], fix);
      }
      for (const match of text.matchAll(/[!?]{2,}|(?<!\.)\.\.(?!\.)|\.{4,}|,{2,}|;{2,}/g)) {
        add("punctuation", "repeated-punctuation", "Repeated punctuation", text.slice(Math.max(0, match.index - 15), match.index + 8), "Use one mark");
      }
      for (const match of text.matchAll(/\S\s+[,;:.!?](?=\s|$)/g)) {
        add("punctuation", "space-before-punct", "Space before punctuation", match[0], "Remove the space");
      }
      for (const match of text.matchAll(/[A-Za-z]{2,}[,;:](?=[A-Za-z])|[a-z]{2,}[.?!](?=[A-Z][a-z])/g)) {
        add("punctuation", "missing-space-after", "No space after punctuation", match[0], "Add a space");
      }
      if (count(text, /\(/g) !== count(text, /\)/g)) {
        add("punctuation", "unbalanced-pairs", "Opening and closing brackets don't match", text, "Close every bracket");
      }
      if (count(text, /"/g) % 2 === 1) {
        add("punctuation", "unbalanced-pairs", "A quotation mark is not closed", text, "Close the quotation");
      }

      for (const token of words) {
        const fix = MISSPELLINGS[token.toLowerCase()];
        if (fix) add("spelling", "misspelling", `“${token}” looks misspelled`, token, fix);
      }
    }

    // ── Usage (typed and spoken) ──
    for (const [regex, suggest] of AGREEMENT) {
      for (const match of text.matchAll(regex)) {
        add("usage", "agreement", "Subject and verb don't agree", match[0], suggest(match));
      }
    }
    for (const match of text.matchAll(/\b(a|an)\s+([A-Za-z]+)/gi)) {
      const article = match[1].toLowerCase();
      const next = match[2];
      const acronym = next.length > 1 && next === next.toUpperCase();
      if (acronym) continue;
      const vowelStart = /^[aeiou]/i.test(next);
      if (article === "a" && vowelStart && !A_BEFORE_VOWEL_OK.test(next)) add("usage", "a-an", "Use “an” before a vowel sound", match[0], `an ${next}`);
      if (article === "an" && !vowelStart && !AN_BEFORE_CONSONANT_OK.test(next)) add("usage", "a-an", "Use “a” before a consonant sound", match[0], `a ${next}`);
    }
    for (const match of text.matchAll(/\b(should|could|would|must|might)\s+of\b/gi)) {
      add("usage", "should-of", "Use “have”, not “of”", match[0], `${match[1]} have`);
    }

    // ── Style (typed and spoken) ──
    for (const match of text.matchAll(/\b([A-Za-z']{2,})\s+\1\b/gi)) {
      const phrase = match[0].toLowerCase();
      if (phrase === "had had" || phrase === "that that") continue;
      add("style", "repeated-word", `“${match[1]}” is repeated`, match[0], match[1]);
    }
    for (const [label, regex, weak] of FILLERS) {
      if (weak && !spoken) continue;
      for (const match of text.matchAll(regex)) {
        add("style", "filler", `Filler: “${label}”`, match[0], "", "error", label);
      }
    }
    for (const match of text.matchAll(PASSIVE)) {
      if (NOT_PASSIVE.has(match[1].toLowerCase())) continue;
      add("style", "passive", "Possible passive voice", match[0], "", "note");
    }

    const errors = {};
    for (const category of CATEGORIES) errors[category.key] = 0;
    for (const issue of issues) if (issue.severity === "error") errors[issue.category] += 1;

    const syllableTotal = words.reduce((sum, word) => sum + syllables(word), 0);

    return {
      spoken,
      reliable,
      text,
      counts: { words: words.length, sentences: sentences.length, typedSentences },
      issues,
      errors,
      applicable: {
        punctuation: typedSentences,
        capitalization: typedSentences,
        structure: sentences.length,
        spelling: spoken ? 0 : words.length,
        usage: words.length,
        style: words.length,
      },
      sentenceLengths,
      syllables: syllableTotal,
      marks: spoken ? null : countMarks(text),
      questions,
      wordList: words.map((word) => word.toLowerCase()),
    };
  }

  // Scores 0-100 per category (null = nothing to score) and a weighted overall score.
  function scoreFrom(errors, applicable) {
    const scores = {};
    let sum = 0;
    let weight = 0;
    for (const category of CATEGORIES) {
      const total = applicable[category.key] || 0;
      if (!total) {
        scores[category.key] = null;
        continue;
      }
      const found = errors[category.key] || 0;
      const penalty = category.unit === "sentence" ? (found / total) * 50 : (found / total) * 500;
      const score = clamp(100 - penalty, 0, 100);
      scores[category.key] = Math.round(score);
      sum += score * category.weight;
      weight += category.weight;
    }
    return { scores, overall: weight ? Math.round(sum / weight) : null };
  }

  function readabilityLabel(score) {
    if (score >= 90) return "Very easy";
    if (score >= 80) return "Easy";
    if (score >= 70) return "Fairly easy";
    if (score >= 60) return "Plain English";
    if (score >= 50) return "Fairly hard";
    if (score >= 30) return "Difficult";
    return "Very difficult";
  }

  // Combine many analysed texts. items: [{ analysis, at, source }] in any order.
  function summarize(items) {
    const errors = {};
    const applicable = {};
    for (const category of CATEGORIES) {
      errors[category.key] = 0;
      applicable[category.key] = 0;
    }

    const issueTypes = new Map();
    const categoryTop = new Map();
    const frequency = new Map();
    const fillerCounts = new Map();
    const marks = { commas: 0, periods: 0, questionMarks: 0, exclamations: 0, apostrophes: 0, colons: 0, semicolons: 0, brackets: 0, quotes: 0, dashes: 0 };
    const questions = { total: 0, marked: 0 };
    const lengths = [];
    const trend = [];
    let totalWords = 0;
    let typedWords = 0;
    let typedSentences = 0;
    let typedTerminal = 0;
    let readableWords = 0;
    let readableSentences = 0;
    let readableSyllables = 0;
    let tokens = 0;
    const unique = new Set();

    const ordered = [...items].sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));

    for (const item of ordered) {
      const analysis = item.analysis;
      totalWords += analysis.counts.words;
      for (const category of CATEGORIES) {
        errors[category.key] += analysis.errors[category.key];
        applicable[category.key] += analysis.applicable[category.key];
      }

      for (const issue of analysis.issues) {
        let type = issueTypes.get(issue.code);
        if (!type) {
          type = { code: issue.code, label: ISSUE_LABELS[issue.code] || issue.code, category: issue.category, severity: issue.severity, count: 0, examples: [] };
          issueTypes.set(issue.code, type);
        }
        type.count += 1;
        if (type.examples.length < 3 && !type.examples.some((example) => example.excerpt === issue.excerpt)) {
          type.examples.push({ excerpt: issue.excerpt, fix: issue.fix, message: issue.message });
        }
        if (issue.code === "filler") fillerCounts.set(issue.detail, (fillerCounts.get(issue.detail) || 0) + 1);
      }

      for (const word of analysis.wordList) {
        tokens += 1;
        unique.add(word);
        if (word.length >= 3 && !STOP_WORDS.has(word)) frequency.set(word, (frequency.get(word) || 0) + 1);
      }

      if (analysis.reliable) {
        lengths.push(...analysis.sentenceLengths);
        readableWords += analysis.counts.words;
        readableSentences += analysis.counts.sentences;
        readableSyllables += analysis.syllables;
      }

      if (!analysis.spoken) {
        typedWords += analysis.counts.words;
        typedSentences += analysis.counts.typedSentences;
        const sentencesWithEnd = analysis.counts.typedSentences -
          analysis.issues.filter((issue) => issue.code === "missing-terminal" || (issue.code === "missing-question-mark" && !/[.!?]$/.test(issue.excerpt))).length;
        typedTerminal += Math.max(0, sentencesWithEnd);
        questions.total += analysis.questions.total;
        questions.marked += analysis.questions.marked;
        for (const key of Object.keys(marks)) marks[key] += analysis.marks[key];
      }

      const scored = scoreFrom(analysis.errors, analysis.applicable);
      if (scored.overall != null) {
        trend.push({ at: item.at, score: scored.overall, excerpt: clip(analysis.text, 70), source: item.source });
      }
    }

    const { scores, overall } = scoreFrom(errors, applicable);

    for (const type of issueTypes.values()) {
      const current = categoryTop.get(type.category);
      if (type.severity === "error" && (!current || type.count > current.count)) categoryTop.set(type.category, type);
    }

    const categories = CATEGORIES.map((category) => ({
      key: category.key,
      label: category.label,
      checks: category.checks,
      score: scores[category.key],
      errors: errors[category.key],
      top: categoryTop.get(category.key) || null,
    }));

    // Newest corrections first, without repeating the same excerpt and issue.
    const recent = [];
    const seen = new Set();
    for (const item of [...ordered].reverse()) {
      for (const issue of item.analysis.issues) {
        if (issue.severity !== "error") continue;
        const key = `${issue.code}|${issue.excerpt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        recent.push({ ...issue, at: item.at, source: item.source });
        if (recent.length >= 10) break;
      }
      if (recent.length >= 10) break;
    }

    let readability = null;
    if (readableSentences >= 3 && readableWords >= 30) {
      const score = 206.835 - 1.015 * (readableWords / readableSentences) - 84.6 * (readableSyllables / readableWords);
      readability = {
        score: Math.round(clamp(score, 0, 100)),
        label: readabilityLabel(score),
        wordsPerSentence: Math.round((readableWords / readableSentences) * 10) / 10,
        syllablesPerWord: Math.round((readableSyllables / readableWords) * 100) / 100,
      };
    }

    const buckets = [
      { label: "1–5", min: 1, max: 5, count: 0 },
      { label: "6–10", min: 6, max: 10, count: 0 },
      { label: "11–15", min: 11, max: 15, count: 0 },
      { label: "16–20", min: 16, max: 20, count: 0 },
      { label: "21–30", min: 21, max: 30, count: 0 },
      { label: "31+", min: 31, max: Infinity, count: 0 },
    ];
    for (const length of lengths) {
      const bucket = buckets.find((entry) => length >= entry.min && length <= entry.max);
      if (bucket) bucket.count += 1;
    }

    return {
      texts: items.length,
      words: totalWords,
      typedWords,
      scores,
      overall,
      categories,
      trend,
      recent,
      issueTypes: [...issueTypes.values()].sort((a, b) => b.count - a.count),
      marks,
      questions,
      typedSentences,
      typedTerminal,
      readability,
      histogram: buckets,
      sentenceStats: lengths.length
        ? { count: lengths.length, average: Math.round((lengths.reduce((a, b) => a + b, 0) / lengths.length) * 10) / 10, longest: Math.max(...lengths), shortest: Math.min(...lengths) }
        : null,
      topWords: [...frequency.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10),
      fillers: [...fillerCounts.entries()].sort((a, b) => b[1] - a[1]),
      vocabulary: tokens >= 50 ? { unique: unique.size, total: tokens, ratio: unique.size / tokens } : null,
    };
  }

  return { CATEGORIES, ISSUE_LABELS, analyzeText, scoreFrom, summarize, syllables, readabilityLabel, splitSentences, tokenize };
});