const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const els = {
  toast: $("toast"),
  csvFile: /** @type {HTMLInputElement} */ ($("csvFile")),
  csvInfo: $("csvInfo"),
  csvColumn: /** @type {HTMLSelectElement} */ ($("csvColumn")),
  applyCsvBtn: /** @type {HTMLButtonElement} */ ($("applyCsvBtn")),
  groupLife: $("group-life"),
  groupCareer: $("group-career"),
  groupContent: $("group-content"),
  groupTrend: $("group-trend"),
  kpiN: $("kpiN"),
  kpiCharMed: $("kpiCharMed"),
  kpiWordMed: $("kpiWordMed"),
  kpiStructure: $("kpiStructure"),
  summaryList: $("summaryList"),
  ideaList: $("ideaList"),
  hookList: $("hookList"),
  sampleTable: $("sampleTable"),
};

/** @type {Record<string, import("chart.js").Chart>} */
const charts = {};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => (els.toast.hidden = true), 2200);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function tokenize(text) {
  const t = String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#]\w+/g, " ");
  const m = t.match(/[a-z0-9\u4e00-\u9fa5]+/g);
  return (m || []).filter((x) => x.length >= 2);
}

function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}

function histogram(values, binSize) {
  if (!values.length) return { labels: [], counts: [] };
  const vmin = Math.min(...values);
  const vmax = Math.max(...values);
  const start = Math.floor(vmin / binSize) * binSize;
  const end = (Math.floor(vmax / binSize) + 1) * binSize;
  const bins = [];
  for (let b = start; b <= end; b += binSize) bins.push(b);
  const counts = new Array(Math.max(1, bins.length - 1)).fill(0);
  const width = bins.length >= 2 ? bins[1] - bins[0] : binSize;
  for (const v of values) {
    const idx = clamp(Math.floor((v - bins[0]) / width), 0, counts.length - 1);
    counts[idx] += 1;
  }
  const labels = counts.map((_, i) => `${bins[i]}–${bins[i + 1] - 1}`);
  return { labels, counts };
}

const SENT_POS = new Set(["best", "amazing", "great", "easy", "wins", "win", "improve", "boost", "fast", "save", "pro", "premium", "成功", "提升", "高效", "省钱", "爆", "爽", "提升", "稳赢"]);
const SENT_NEG = new Set(["fail", "fails", "bad", "worst", "slow", "broken", "mistake", "scam", "avoid", "坑", "踩坑", "翻车", "糟糕", "失败", "崩", "焦虑"]);

function sentimentLabel(title) {
  const toks = tokenize(title);
  let score = 0;
  for (const w of toks) {
    if (SENT_POS.has(w)) score += 1;
    if (SENT_NEG.has(w)) score -= 1;
  }
  if (score >= 1) return "positive";
  if (score <= -1) return "negative";
  return "neutral";
}

function hookCounts(titles) {
  const rx = {
    question_mark: /[?？]\s*$/,
    listicle: /\b(\d+)\s+(ways|tips|reasons|ideas|lessons)\b/i,
    how_to: /\bhow to\b/i,
    vs: /\bvs\.?\b/i,
    brackets: /[\[\(【（].+[\]\)】）]/,
    colon: /[:：]/,
    quoted: /“|”|".+?"/,
  };
  const counts = Object.fromEntries(Object.keys(rx).map((k) => [k, 0]));
  for (const t of titles) for (const [k, r] of Object.entries(rx)) if (r.test(t)) counts[k] += 1;
  return counts;
}

function parseCSV(text) {
  const src = String(text || "");
  const sample = src.slice(0, 2000);
  const delim = sample.includes("\t") && !sample.includes(",") ? "\t" : sample.includes(";") && !sample.includes(",") ? ";" : ",";

  /** @type {string[][]} */
  const rows = [];
  let cur = "";
  let inQuotes = false;
  /** @type {string[]} */
  let row = [];

  function pushCell() {
    row.push(cur);
    cur = "";
  }
  function pushRow() {
    // trim only surrounding whitespace; keep inner spaces
    const r = row.map((c) => c.replace(/^\uFEFF/, "").trim());
    if (r.some((x) => x.length)) rows.push(r);
    row = [];
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = src[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        pushCell();
      } else if (ch === "\n") {
        pushCell();
        pushRow();
      } else if (ch === "\r") {
        // ignore
      } else {
        cur += ch;
      }
    }
  }
  pushCell();
  pushRow();

  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0];
  const records = rows.slice(1);
  return { headers, records };
}

function buildTopicFromTitles(name, titles) {
  const clean = titles.map((t) => String(t || "").trim()).filter((t) => t.length >= 2);
  const n = clean.length;
  const charLens = clean.map((t) => t.length);
  const wordLens = clean.map((t) => (t.trim() ? t.trim().split(/\s+/).length : 0));

  const sent = { pos: 0, neu: 0, neg: 0 };
  for (const t of clean) {
    const lab = sentimentLabel(t);
    if (lab === "positive") sent.pos += 1;
    else if (lab === "negative") sent.neg += 1;
    else sent.neu += 1;
  }

  const hooks = hookCounts(clean);

  const freq = new Map();
  for (const t of clean) {
    const toks = tokenize(t);
    for (const g of [...ngrams(toks, 1), ...ngrams(toks, 2)]) {
      freq.set(g, (freq.get(g) || 0) + 1);
    }
  }
  const top = [...freq.entries()]
    .filter(([k]) => k.length >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const charHist = histogram(charLens, 6);
  const wordHist = histogram(wordLens, 2);

  const topTerms = { labels: top.map((x) => x[0]), counts: top.map((x) => x[1]) };

  const colonRate = n ? Math.round((hooks.colon / n) * 100) : 0;
  const listRate = n ? Math.round((hooks.listicle / n) * 100) : 0;
  const qRate = n ? Math.round((hooks.question_mark / n) * 100) : 0;
  const vsRate = n ? Math.round((hooks.vs / n) * 100) : 0;
  const howRate = n ? Math.round((hooks.how_to / n) * 100) : 0;

  const structure = [
    listRate >= 12 ? "数字清单" : null,
    vsRate >= 8 ? "对比" : null,
    howRate >= 8 ? "How-to" : null,
    colonRate >= 12 ? "冒号拆分" : null,
    qRate >= 8 ? "提问" : null,
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join(" + ") || "清晰对象 + 具体收益 + 可执行步骤";

  const medChar = Math.round(median(charLens));
  const medWord = Math.round(median(wordLens));

  const term1 = topTerms.labels[0] || "这个主题";
  const term2 = topTerms.labels[1] || "核心方法";
  const term3 = topTerms.labels[2] || "避坑";

  const summary = [
    `标题长度中位数约为 ${medChar} 字（词数中位数 ${medWord}），建议围绕中位数上下做“短/长两档”A/B。`,
    `钩子结构占比（大致）：冒号 ${colonRate}% · 清单 ${listRate}% · 提问 ${qRate}% · 对比 ${vsRate}% · How-to ${howRate}%。优先沿高占比结构做系列。`,
    `主题词集中在「${term1}」「${term2}」「${term3}」等，建议用“二元词组”作为标题骨架，再填入人群/场景/结果指标。`,
    `情绪基调：正/中/负 ≈ ${sent.pos}/${sent.neu}/${sent.neg}。如果你做的是增长向内容，可适当提高“正向收益承诺”与“对比证据”。`,
  ];

  const ideas = [
    `《${term1}：从 0 到 1 的最小闭环（附清单/模板）》`,
    `《${term1} vs ${term2}：同一目标两种做法对比，差别在这 3 点》`,
    `《别再做 ${term3}：这 5 个坑会让你越做越差（替代方案）》`,
    `《${term1} 的 7 条高频问题一次讲清（适合新手/上班族）》`,
    `《真实案例复盘：用 ${term1} 做到 ___ 的关键动作与时间线》`,
  ];

  const hookTemplates = [
    { title: "对比证据", text: `同一目标我用「${term1}」和「${term2}」各做了一次，对比结果差距很明显。` },
    { title: "反常识纠偏", text: `你以为 ${term1} 的关键是 ___？其实真正影响结果的是这一步。` },
    { title: "清单交付", text: `我把「${term1}」拆成一张清单：照着做就能复刻结果。` },
    { title: "避坑预警", text: `最容易翻车的是「${term3}」：先按这 3 条规则排雷。` },
    { title: "限定人群", text: `如果你是【___人群】，用 ${term1} 最稳的切入点是 ___（不走弯路）。` },
  ];

  const sampleTitles = clean.slice(0, 20).map((t, i) => ({
    title: t,
    score: 1200 - i * 23,
    tag: hooks.colon ? "结构" : "样本",
  }));

  return {
    name,
    kpis: { n, charMedian: medChar, wordMedian: medWord, structure },
    summary,
    ideas,
    hooks: hookTemplates,
    sampleTitles,
    charts: {
      sent,
      hooks,
      lenChar: charHist,
      lenWord: wordHist,
      terms: topTerms,
    },
  };
}

function chartGradient(ctx, area, c1, c2) {
  const g = ctx.createLinearGradient(area.left, area.top, area.right, area.bottom);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  return g;
}

function buildBlueGrad(chart, alpha = 0.55) {
  const { ctx, chartArea } = chart;
  if (!chartArea) return `rgba(26,82,118,${alpha})`;
  return chartGradient(ctx, chartArea, `rgba(26,82,118,${alpha})`, `rgba(46,134,193,${alpha})`);
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function renderCharts(topic) {
  const gridColor = "rgba(26,82,118,0.14)";
  const tickColor = "rgba(15,27,33,0.70)";
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { labels: { color: "rgba(15,27,33,0.78)" } } },
    scales: {
      x: { ticks: { color: tickColor }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor }, grid: { color: gridColor } },
    },
  };

  // Sentiment doughnut
  destroyChart("sent");
  charts.sent = new Chart($("chartSent"), {
    type: "doughnut",
    data: {
      labels: ["positive", "neutral", "negative"],
      datasets: [
        {
          data: [topic.charts.sent.pos, topic.charts.sent.neu, topic.charts.sent.neg],
          backgroundColor: ["rgba(26,82,118,0.88)", "rgba(46,134,193,0.78)", "rgba(133,193,233,0.70)"],
          borderColor: "rgba(26,82,118,0.18)",
          borderWidth: 1,
        },
      ],
    },
    options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "rgba(15,27,33,0.78)" } } } },
  });

  // Hooks bar
  destroyChart("hooks");
  const hookLabels = ["问号结尾", "Listicle", "How-to", "VS 对比", "冒号", "括号", "引号"];
  const h = topic.charts.hooks;
  const hookValues = [h.question_mark, h.listicle, h.how_to, h.vs, h.colon, h.brackets, h.quoted];
  charts.hooks = new Chart($("chartHooks"), {
    type: "bar",
    data: {
      labels: hookLabels,
      datasets: [
        {
          data: hookValues,
          backgroundColor: (ctx) => buildBlueGrad(ctx.chart, 0.55),
          borderColor: "rgba(26,82,118,0.75)",
          borderWidth: 1,
        },
      ],
    },
    options: { ...common, plugins: { ...common.plugins, legend: { display: false } } },
  });

  // Length histograms
  destroyChart("lenChar");
  charts.lenChar = new Chart($("chartLenChar"), {
    type: "bar",
    data: {
      labels: topic.charts.lenChar.labels,
      datasets: [
        {
          data: topic.charts.lenChar.counts,
          backgroundColor: (ctx) => buildBlueGrad(ctx.chart, 0.45),
          borderColor: "rgba(26,82,118,0.65)",
          borderWidth: 1,
        },
      ],
    },
    options: { ...common, plugins: { ...common.plugins, legend: { display: false } } },
  });

  destroyChart("lenWord");
  charts.lenWord = new Chart($("chartLenWord"), {
    type: "bar",
    data: {
      labels: topic.charts.lenWord.labels,
      datasets: [
        {
          data: topic.charts.lenWord.counts,
          backgroundColor: (ctx) => buildBlueGrad(ctx.chart, 0.50),
          borderColor: "rgba(26,82,118,0.55)",
          borderWidth: 1,
        },
      ],
    },
    options: { ...common, plugins: { ...common.plugins, legend: { display: false } } },
  });

  // Terms
  destroyChart("terms");
  charts.terms = new Chart($("chartTerms"), {
    type: "bar",
    data: {
      labels: topic.charts.terms.labels,
      datasets: [
        {
          data: topic.charts.terms.counts,
          backgroundColor: (ctx) => buildBlueGrad(ctx.chart, 0.55),
          borderColor: "rgba(26,82,118,0.70)",
          borderWidth: 1,
        },
      ],
    },
    options: { ...common, indexAxis: "y", plugins: { ...common.plugins, legend: { display: false } } },
  });
}

function renderTopic(topicKey) {
  const t = TOPIC_DATA[topicKey];
  if (!t) return;

  // KPI
  els.kpiN.textContent = String(t.kpis.n);
  els.kpiCharMed.textContent = String(t.kpis.charMedian);
  els.kpiWordMed.textContent = String(t.kpis.wordMedian);
  els.kpiStructure.textContent = t.kpis.structure;

  // Summary
  els.summaryList.innerHTML = t.summary.map((x) => `<li>${escapeHtml(x)}</li>`).join("");

  // Ideas
  els.ideaList.innerHTML = t.ideas.map((x) => `<li>${escapeHtml(x)}</li>`).join("");

  // Hooks
  els.hookList.innerHTML = t.hooks
    .map(
      (h) => `
      <div class="hook">
        <div class="hook__title">${escapeHtml(h.title)}</div>
        <div class="hook__text">${escapeHtml(h.text)}</div>
      </div>
    `
    )
    .join("");

  // Table
  els.sampleTable.innerHTML = t.sampleTitles
    .slice(0, 20)
    .map((r) => `<tr><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.score)}</td><td>${escapeHtml(r.tag)}</td></tr>`)
    .join("");

  renderCharts(t);

  // Active button
  document.querySelectorAll(".topicBtn").forEach((btn) => {
    btn.classList.toggle("isActive", btn.dataset.topic === topicKey);
  });
}

function addTopicButtons(container, keys) {
  container.innerHTML = keys
    .map((k) => `<button class="topicBtn" type="button" data-topic="${k}">${escapeHtml(TOPIC_DATA[k].name)}</button>`)
    .join("");
}

function bindButtons() {
  document.addEventListener("click", (e) => {
    const btn = e.target instanceof HTMLElement ? e.target.closest(".topicBtn") : null;
    if (!btn) return;
    const key = btn.getAttribute("data-topic");
    if (!key) return;
    renderTopic(key);
    showToast(`已切换：${TOPIC_DATA[key].name}`);
  });
}

// --- 20 个话题：全部前端预设（专业内容+图表数据） ---
const TOPIC_GROUPS = {
  life: ["fitness", "yoga", "running", "fat_meal", "muscle_gain"],
  career: ["workwear", "interview", "promotion", "side_hustle_money", "time_mgmt"],
  content: ["short_video_script", "viral_title", "vlog", "editing", "graphic_seeding"],
  trend: ["ai_tools", "chatgpt", "crypto", "side_hustle", "personal_ip"],
};

const TOPIC_DATA = {
  // 生活健身类
  fitness: {
    name: "健身",
    kpis: { n: 80, charMedian: 22, wordMedian: 8, structure: "反差对比 + 清单步骤 + 误区纠偏" },
    summary: [
      "爆款更偏“可执行”：一套动作/一个训练日模板/一个周期计划，比泛泛科普更容易被收藏与转发。",
      "标题里出现明确结果指标（腰围、体脂、卧推/深蹲 PR、跑步配速）能显著提高点击与完读。",
      "“误区纠偏/踩坑避雷”天然带情绪张力：先否定常见做法，再给更优替代方案。",
      "强刺激内容要配“安全边界”：动作要点、禁忌人群、替代动作，能提升信任与复看率。",
    ],
    ideas: [
      "《一周 3 练：上班族增肌不掉线训练表（含动作顺序/组数/替代动作）》",
      "《体脂下不去的 3 个“隐形热量”来源：饮料/调味/零食》",
      "《新手深蹲 5 个错误：膝盖、核心、脚掌发力一次讲清》",
      "《不去健身房也能练：一张“弹力带全身训练”清单》",
      "《30 天挑战：每天 10 分钟，腰腹线条会发生什么？（记录模板）》",
    ],
    hooks: [
      { title: "反常识", text: "你以为练得越狠越瘦？其实最容易胖的就是这一步…" },
      { title: "结果先行", text: "照着做 14 天，腰围平均能少多少？我把模板给你。" },
      { title: "踩坑纠偏", text: "这 3 个动作你做错了，难怪膝盖不舒服。" },
      { title: "极简清单", text: "只记住这 1 张表：新手也能把训练排明白。" },
      { title: "对比实验", text: "同样 30 分钟：A 方案燃脂更高，差别在这里。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: [
        "增肌最快不是练胸，是先把这个动作练对",
        "一周 3 练训练表：上班族也能坚持",
        "体脂卡住？先检查这 4 个隐形热量",
        "新手深蹲 5 个错误：膝盖疼的根源",
        "30 天挑战：每天 10 分钟腹肌训练",
      ][i % 5],
      score: 900 + (20 - i) * 33,
      tag: ["清单", "误区", "模板", "教程", "挑战"][i % 5],
    })),
    charts: {
      sent: { pos: 22, neu: 48, neg: 10 },
      hooks: { question_mark: 6, listicle: 10, how_to: 8, vs: 6, colon: 12, brackets: 7, quoted: 3 },
      lenChar: { labels: ["10–19", "20–29", "30–39", "40–49", "50–59"], counts: [10, 28, 22, 14, 6] },
      lenWord: { labels: ["4–5", "6–7", "8–9", "10–11", "12–13"], counts: [8, 20, 26, 18, 8] },
      terms: { labels: ["训练计划", "动作要点", "增肌", "减脂", "新手", "一周3练", "体脂", "膝盖疼", "热量", "代替动作"], counts: [26, 19, 18, 17, 16, 14, 13, 12, 11, 10] },
    },
  },
  yoga: {
    name: "瑜伽",
    kpis: { n: 65, charMedian: 20, wordMedian: 7, structure: "场景痛点 + 温和承诺 + 跟练序列" },
    summary: [
      "瑜伽爆款更吃“场景化痛点”：圆肩驼背、久坐腰酸、经前不适、睡眠质量，比“体式科普”更强。",
      "用户更愿意收藏“序列”：3-5 个体式连贯安排 + 每个体式时长 + 注意事项。",
      "标题里出现“效果感受”更抓人：肩颈松了、呼吸顺了、睡前更好入睡。",
      "内容要强调“可替代/可降阶”，降低练习门槛与受伤焦虑。",
    ],
    ideas: [
      "《久坐肩颈僵：5 分钟瑜伽序列，练完立刻松一圈》",
      "《睡前 8 分钟：让身体进入“能睡”的状态（跟练）》",
      "《圆肩驼背改善：打开胸椎的 3 个关键体式》",
      "《新手别硬拉：髋打不开就先做这 2 个准备》",
      "《经期前后怎么练：舒缓版序列 + 禁忌提醒》",
    ],
    hooks: [
      { title: "即时感受", text: "现在跟我做 30 秒，你会立刻感觉肩颈松一点。" },
      { title: "低门槛", text: "不需要柔软度，只要你能坐在地上就能练。" },
      { title: "痛点共鸣", text: "你是不是也：久坐到晚上腰像被拧住？" },
      { title: "误区提醒", text: "很多人练瑜伽腰更疼，是因为忽略了这一步。" },
      { title: "序列承诺", text: "这套 5 个体式按顺序做，效果比乱练强很多。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["睡前 8 分钟瑜伽：更好入睡", "久坐肩颈僵：5 分钟序列", "圆肩驼背改善：胸椎打开", "新手髋打不开怎么办？", "经期舒缓瑜伽注意事项"][i % 5],
      score: 780 + (20 - i) * 28,
      tag: ["跟练", "舒缓", "体态", "新手", "禁忌"][i % 5],
    })),
    charts: {
      sent: { pos: 18, neu: 40, neg: 7 },
      hooks: { question_mark: 5, listicle: 7, how_to: 6, vs: 2, colon: 10, brackets: 6, quoted: 2 },
      lenChar: { labels: ["8–15", "16–23", "24–31", "32–39", "40–47"], counts: [8, 22, 18, 12, 5] },
      lenWord: { labels: ["3–4", "5–6", "7–8", "9–10", "11–12"], counts: [6, 16, 20, 15, 8] },
      terms: { labels: ["睡前", "肩颈", "久坐", "体态", "序列", "跟练", "胸椎", "呼吸", "舒缓", "禁忌"], counts: [20, 18, 16, 14, 13, 12, 10, 9, 8, 7] },
    },
  },
  running: {
    name: "跑步",
    kpis: { n: 70, charMedian: 23, wordMedian: 8, structure: "数据指标 + 训练区间 + 装备/伤痛解决" },
    summary: [
      "跑步内容的“专业感”来自数据：配速、心率区间、训练周量、跑姿要点，越具体越容易被认可。",
      "爆款多围绕“卡点突破”：5K 破 30、10K 破 60、半马 PB；把目标拆成 4 周计划更易收藏。",
      "伤痛是高互动主题：膝盖、胫骨、足底筋膜，给到排查清单+替代训练能强力涨粉。",
      "装备不求全：强调“最小可行装备”与性价比选择，会更符合大众人群。",
    ],
    ideas: [
      "《4 周把 5K 配速提高 30 秒：训练周计划（含区间跑/轻松跑）》",
      "《心率区间怎么用：新手也能避免越跑越累》",
      "《跑步膝盖痛：先做这 5 项自测，再决定要不要停跑》",
      "《跑姿 3 个关键：落脚位置/步频/躯干，改完更省力》",
      "《一双鞋跑到底？你需要的是“轮换策略”，不是更贵》",
    ],
    hooks: [
      { title: "数据钩子", text: "如果你 5K 卡在 30 分钟，先把这 2 个指标看懂。" },
      { title: "拆解计划", text: "别瞎跑：我把 4 周训练表写出来，你照着做就行。" },
      { title: "伤痛排查", text: "膝盖痛别硬扛，先按这张清单排雷。" },
      { title: "省力秘诀", text: "步频从 160 调到 175，你会感觉突然轻松。" },
      { title: "装备理性", text: "提升最快的不是买鞋，而是把训练结构排对。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["4 周 5K 进步计划", "心率区间新手教程", "跑步膝盖痛自测清单", "跑姿三要点：更省力", "跑鞋轮换策略：性价比"][i % 5],
      score: 860 + (20 - i) * 30,
      tag: ["计划", "科普", "伤痛", "技巧", "装备"][i % 5],
    })),
    charts: {
      sent: { pos: 16, neu: 44, neg: 10 },
      hooks: { question_mark: 4, listicle: 6, how_to: 7, vs: 4, colon: 11, brackets: 5, quoted: 1 },
      lenChar: { labels: ["12–19", "20–27", "28–35", "36–43", "44–51"], counts: [10, 24, 18, 12, 6] },
      lenWord: { labels: ["4–5", "6–7", "8–9", "10–11", "12–13"], counts: [7, 18, 22, 15, 8] },
      terms: { labels: ["配速", "心率区间", "训练计划", "区间跑", "轻松跑", "膝盖痛", "步频", "跑姿", "PB", "周量"], counts: [21, 18, 17, 15, 14, 12, 11, 10, 9, 8] },
    },
  },
  fat_meal: {
    name: "减脂餐",
    kpis: { n: 90, charMedian: 18, wordMedian: 7, structure: "低热量 + 高饱腹 + 5 分钟可复刻" },
    summary: [
      "减脂餐爆款核心是“可复制”：食材少、步骤短、计量清晰（克数/热量/蛋白质）更容易被收藏。",
      "标题里出现“替换关系”点击更高：奶茶替换、晚餐替换、零食替换，降低用户决策成本。",
      "强烈建议用“组合公式”：主食/蛋白/蔬菜/脂肪的比例，形成持续选题。",
      "避开极端：强调长期可坚持、味道不差、社交场景可用，更符合大众需求。",
    ],
    ideas: [
      "《一份 450kcal 的晚餐模板：蛋白+蔬菜+主食比例怎么配》",
      "《外卖怎么点才不翻车：3 套减脂点单公式》",
      "《奶茶替换方案：同样好喝，热量砍一半》",
      "《高饱腹早餐：10 分钟搞定，下午不饿》",
      "《一周食材清单：用 12 样食材做 7 天减脂餐》",
    ],
    hooks: [
      { title: "替换思路", text: "想减脂但嘴馋？先学会“替换”，而不是硬扛。" },
      { title: "热量透明", text: "这份晚餐 450kcal，但蛋白拉满，饱到不想吃零食。" },
      { title: "外卖不翻车", text: "别再点沙拉了，这 3 个外卖公式更稳。" },
      { title: "食材清单", text: "只买这 12 样，一周减脂餐你就能安排明白。" },
      { title: "懒人也行", text: "5 分钟一道菜：不会做饭也能复刻。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["450kcal 晚餐模板", "外卖减脂点单公式", "奶茶替换方案", "高饱腹早餐 10 分钟", "12 样食材做 7 天"][i % 5],
      score: 980 + (20 - i) * 36,
      tag: ["模板", "外卖", "替换", "早餐", "清单"][i % 5],
    })),
    charts: {
      sent: { pos: 26, neu: 54, neg: 10 },
      hooks: { question_mark: 3, listicle: 12, how_to: 6, vs: 3, colon: 9, brackets: 4, quoted: 1 },
      lenChar: { labels: ["8–13", "14–19", "20–25", "26–31", "32–37"], counts: [14, 30, 22, 16, 8] },
      lenWord: { labels: ["3–4", "5–6", "7–8", "9–10", "11–12"], counts: [10, 24, 26, 18, 12] },
      terms: { labels: ["450kcal", "点单公式", "替换方案", "高蛋白", "饱腹", "一周清单", "早餐", "晚餐", "外卖", "热量"], counts: [24, 19, 18, 16, 15, 13, 12, 11, 10, 9] },
    },
  },
  muscle_gain: {
    name: "增肌",
    kpis: { n: 75, charMedian: 24, wordMedian: 8, structure: "训练分化 + 饮食蛋白 + 进阶周期" },
    summary: [
      "增肌内容最有效的是“闭环”：训练（动作/组数/强度）+ 饮食（蛋白/热量）+ 恢复（睡眠/酸痛）。",
      "爆款更愿意讲“可量化进步”：围度、PR、训练重量进阶曲线，越具体越可信。",
      "新手需求是“少而对”：给 3-4 个复合动作搭配，而不是动作堆砌。",
      "误区主题高互动：练胸不长、练腿太累、蛋白吃不够/吃过量，适合系列化。",
    ],
    ideas: [
      "《新手增肌只做 4 个动作：坚持 8 周会发生什么》",
      "《蛋白吃多少才够？按体重一算就明白（附食物替换表）》",
      "《训练重量怎么加：RPE/力竭/递增的最简单用法》",
      "《练腿不再痛苦：动作顺序 + 组间休息的“省命版”》",
      "《增肌期怎么控脂：热量盈余别踩这 3 个坑》",
    ],
    hooks: [
      { title: "少而对", text: "增肌别贪多：4 个动作练到位，比 12 个动作更长肌肉。" },
      { title: "公式", text: "蛋白不够一切白搭：按体重这个公式算，你就知道差多少。" },
      { title: "进阶路径", text: "重量加不上去？你缺的是“递增策略”，不是更猛。" },
      { title: "省命练腿", text: "练腿不想吐？把顺序改一下，强度还更高。" },
      { title: "控脂避坑", text: "增肌期长胖，多半不是吃多，是吃错。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["新手增肌 4 动作", "蛋白摄入公式+替换表", "重量递增最简单用法", "练腿省命版动作顺序", "增肌期控脂 3 坑"][i % 5],
      score: 920 + (20 - i) * 31,
      tag: ["新手", "饮食", "进阶", "训练", "避坑"][i % 5],
    })),
    charts: {
      sent: { pos: 20, neu: 44, neg: 11 },
      hooks: { question_mark: 2, listicle: 8, how_to: 7, vs: 3, colon: 12, brackets: 4, quoted: 1 },
      lenChar: { labels: ["14–21", "22–29", "30–37", "38–45", "46–53"], counts: [10, 22, 18, 15, 10] },
      lenWord: { labels: ["4–5", "6–7", "8–9", "10–11", "12–13"], counts: [8, 18, 22, 15, 12] },
      terms: { labels: ["4个动作", "蛋白摄入", "重量递增", "RPE", "热量盈余", "控脂", "复合动作", "8周", "围度", "练腿"], counts: [20, 18, 16, 12, 12, 11, 10, 9, 8, 7] },
    },
  },

  // 职场成长类
  workwear: {
    name: "职场穿搭",
    kpis: { n: 60, charMedian: 18, wordMedian: 7, structure: "场景（面试/会议）+ 规则（比例/配色）+ 直接清单" },
    summary: [
      "职场穿搭爆款是“可照抄”：一套成套搭配（上衣/下装/鞋/包/配饰）比讲审美更有效。",
      "场景越明确越好：面试、转正、客户拜访、年会、夏季通勤；越具体越容易转化收藏。",
      "标题里出现“避雷/显贵/不出错”更抓人，本质是帮用户降低社交风险。",
      "强调性价比与替代单品（预算分档）更容易获得大众传播。",
    ],
    ideas: [
      "《面试不出错：男女通用 3 套穿搭公式（含预算分档）》",
      "《夏季通勤显精神：衬衫/西裤怎么选不廉价》",
      "《客户拜访“显贵不夸张”：配色和材质优先级》",
      "《小个子职场穿搭：比例 3 法则，立刻显高》",
      "《衣柜精简：用 12 件单品搭出 30 套职场穿搭》",
    ],
    hooks: [
      { title: "风险降低", text: "你不需要很会穿，只要不出错：这 3 套公式照抄就行。" },
      { title: "显贵秘诀", text: "显贵不是买贵，是把“材质/剪裁/配色”先排对。" },
      { title: "预算分档", text: "同一套思路，300/800/1500 三档怎么买我都写好了。" },
      { title: "反差对比", text: "同样白衬衫：A 显廉价，B 显专业，差别在领型和版型。" },
      { title: "一图搞定", text: "给你一张“通勤配色表”，从此不纠结。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["面试穿搭公式：不出错", "夏季通勤显精神单品", "客户拜访显贵配色", "小个子职场显高法则", "12 件单品搭 30 套"][i % 5],
      score: 740 + (20 - i) * 24,
      tag: ["面试", "通勤", "客户", "显高", "衣柜"][i % 5],
    })),
    charts: {
      sent: { pos: 14, neu: 40, neg: 6 },
      hooks: { question_mark: 1, listicle: 9, how_to: 4, vs: 2, colon: 10, brackets: 4, quoted: 0 },
      lenChar: { labels: ["10–15", "16–21", "22–27", "28–33", "34–39"], counts: [10, 20, 14, 10, 6] },
      lenWord: { labels: ["3–4", "5–6", "7–8", "9–10", "11–12"], counts: [8, 18, 16, 12, 6] },
      terms: { labels: ["不出错", "穿搭公式", "预算分档", "显精神", "显贵", "配色", "材质", "通勤", "面试", "比例法则"], counts: [18, 16, 14, 12, 11, 10, 9, 8, 8, 7] },
    },
  },
  interview: {
    name: "面试技巧",
    kpis: { n: 85, charMedian: 24, wordMedian: 9, structure: "常见问题拆解 + STAR 模板 + 反问清单" },
    summary: [
      "面试爆款偏“模板化输出”：回答结构（STAR/金字塔）+ 示例句式，直接降低表达成本。",
      "强互动主题：薪资谈判、离职原因、空窗期、项目失败复盘；越敏感越容易评论讨论。",
      "标题中出现“踩雷/千万别说”具有强点击，但正文必须给替代话术，否则会掉信任。",
      "最好附“反问清单”与“面试官视角”，会显著提升专业度。",
    ],
    ideas: [
      "《离职原因怎么说不扣分：3 种高分表达 + 3 种踩雷说法》",
      "《项目复盘回答模板：失败也能说成能力》",
      "《薪资谈判一句话：先稳住再加码（含区间策略）》",
      "《自我介绍 60 秒结构：不废话但很有料》",
      "《反问面试官 10 题：快速判断坑不坑》",
    ],
    hooks: [
      { title: "千万别说", text: "面试官最怕听到这句话，你一说就扣分。" },
      { title: "高分模板", text: "你把这 4 句按顺序说出来，面试官会觉得你很成熟。" },
      { title: "敏感题拆解", text: "离职原因怎么说？核心不是理由，是“叙事框架”。" },
      { title: "反问加分", text: "最后的反问才是分水岭：这 10 题直接拉开差距。" },
      { title: "谈判策略", text: "谈薪不是要价，是谈“价值锚点”。我教你怎么锚。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["离职原因高分表达", "项目失败复盘模板", "薪资谈判区间策略", "自我介绍 60 秒结构", "反问面试官 10 题"][i % 5],
      score: 1020 + (20 - i) * 34,
      tag: ["话术", "复盘", "谈薪", "结构", "反问"][i % 5],
    })),
    charts: {
      sent: { pos: 16, neu: 52, neg: 17 },
      hooks: { question_mark: 5, listicle: 9, how_to: 8, vs: 3, colon: 14, brackets: 6, quoted: 2 },
      lenChar: { labels: ["14–21", "22–29", "30–37", "38–45", "46–53"], counts: [14, 28, 20, 14, 9] },
      lenWord: { labels: ["5–6", "7–8", "9–10", "11–12", "13–14"], counts: [10, 22, 24, 18, 11] },
      terms: { labels: ["高分表达", "踩雷", "STAR模板", "反问清单", "谈薪", "区间策略", "复盘", "自我介绍", "面试官视角", "价值锚点"], counts: [22, 18, 16, 15, 14, 12, 11, 10, 9, 8] },
    },
  },
  promotion: {
    name: "升职加薪",
    kpis: { n: 70, charMedian: 21, wordMedian: 8, structure: "成果量化 + 影响力叙事 + 向上管理" },
    summary: [
      "升职加薪内容的“爆点”在于可验证：绩效指标、项目影响力、可复用的方法论，而不是鸡汤。",
      "高点击主题：向上管理、述职汇报、跨部门协作、争取资源；因为它们直接影响收入。",
      "标题建议强调“可衡量成果”：提效 X%、节省成本、营收增长、风险降低。",
      "输出最好包含：述职 PPT 框架 + 一页指标表 + 复盘模板，形成工具包。",
    ],
    ideas: [
      "《述职汇报一页纸：用“指标-动作-影响”讲清价值》",
      "《向上管理不是拍马屁：3 个动作让领导放心把事交给你》",
      "《争取加薪：先做“市场价锚定”，再做“贡献对齐”》",
      "《跨部门协作：把需求写成“可交付”的 5 条规则》",
      "《绩效复盘模板：把过程变成果，把成果变影响力》",
    ],
    hooks: [
      { title: "结果量化", text: "不量化就很难升职：我教你怎么把工作写成“可衡量成果”。" },
      { title: "一页纸", text: "述职别做 30 页：一页纸就够，用这三个栏位。" },
      { title: "向上管理", text: "领导放心不是因为你忙，是因为你“可预测”。" },
      { title: "加薪策略", text: "加薪不是谈感情，是谈“市场价 + 贡献对齐”。" },
      { title: "协作规则", text: "跨部门永远吵？把需求写成“可交付”，立刻少 80% 摩擦。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["述职一页纸框架", "向上管理 3 动作", "加薪：市场价锚定", "跨部门协作 5 规则", "绩效复盘模板"][i % 5],
      score: 920 + (20 - i) * 29,
      tag: ["述职", "管理", "加薪", "协作", "模板"][i % 5],
    })),
    charts: {
      sent: { pos: 18, neu: 40, neg: 12 },
      hooks: { question_mark: 2, listicle: 7, how_to: 6, vs: 2, colon: 13, brackets: 5, quoted: 1 },
      lenChar: { labels: ["12–17", "18–23", "24–29", "30–35", "36–41"], counts: [10, 20, 18, 12, 10] },
      lenWord: { labels: ["4–5", "6–7", "8–9", "10–11", "12–13"], counts: [8, 16, 22, 14, 10] },
      terms: { labels: ["一页纸", "可衡量成果", "向上管理", "贡献对齐", "市场价", "述职", "影响力", "资源", "跨部门", "复盘模板"], counts: [18, 16, 14, 12, 11, 11, 10, 9, 8, 7] },
    },
  },
  side_hustle_money: {
    name: "副业赚钱",
    kpis: { n: 90, charMedian: 23, wordMedian: 9, structure: "路径拆解 + 成本/风险 + 可执行清单" },
    summary: [
      "副业内容必须“反夸张”：给到时间成本、试错周期、风险边界，反而更容易建立信任。",
      "爆款更偏“路径地图”：从 0 到 1 的步骤（选赛道→验证→获客→交付→复购），要具体。",
      "标题里出现“普通人”“下班后”“可复制”点击高，但正文要给资源清单/模板。",
      "避免引导违规或高风险理财：强调合规、技能型、长期主义会更稳。",
    ],
    ideas: [
      "《下班后 2 小时：3 条技能型副业路径（含起步清单）》",
      "《从 0 接到第一单：自由职业获客 5 渠道 + 话术模板》",
      "《报价怎么定：不低价内卷的“价值阶梯”》",
      "《副业复盘表：每周 30 分钟，把试错变成长》",
      "《最容易失败的副业 3 类：为什么坑你钱和时间》",
    ],
    hooks: [
      { title: "反鸡汤", text: "副业不是一夜暴富：真正能赚到钱的是这条“路径”。" },
      { title: "第一单", text: "你缺的不是能力，是第一单。我把获客话术给你。" },
      { title: "报价", text: "别再按小时卖命：用“价值阶梯”定价，才能越做越轻松。" },
      { title: "复盘", text: "副业做不起来，多半是没复盘：这张表每周填一次就够。" },
      { title: "避坑", text: "这 3 类副业最坑人：听起来很爽，做起来很惨。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["下班后副业路径地图", "从0到第一单：获客话术", "报价：价值阶梯", "副业复盘表（每周30分钟）", "最容易失败的副业3类"][i % 5],
      score: 1100 + (20 - i) * 38,
      tag: ["路径", "获客", "定价", "复盘", "避坑"][i % 5],
    })),
    charts: {
      sent: { pos: 20, neu: 52, neg: 18 },
      hooks: { question_mark: 1, listicle: 10, how_to: 7, vs: 2, colon: 12, brackets: 5, quoted: 1 },
      lenChar: { labels: ["14–21", "22–29", "30–37", "38–45", "46–53"], counts: [14, 30, 22, 16, 8] },
      lenWord: { labels: ["5–6", "7–8", "9–10", "11–12", "13–14"], counts: [12, 26, 24, 18, 10] },
      terms: { labels: ["路径地图", "第一单", "获客渠道", "话术模板", "价值阶梯", "定价", "时间成本", "风险边界", "复盘表", "技能型"], counts: [22, 18, 15, 14, 13, 12, 11, 10, 9, 8] },
    },
  },
  time_mgmt: {
    name: "时间管理",
    kpis: { n: 80, charMedian: 18, wordMedian: 7, structure: "优先级框架 + 复盘机制 + 工具最小化" },
    summary: [
      "时间管理爆款不靠“更努力”，靠“减少决策”：固定模板、固定时间块、固定复盘节奏。",
      "标题里出现“普通人/上班族/带娃”更容易触发共鸣，本质是高约束场景。",
      "高收藏主题：周计划模板、待办系统、反拖延、番茄钟的改良用法。",
      "避免工具堆砌：强调“一个系统用到底”，更符合用户预期。",
    ],
    ideas: [
      "《上班族周计划模板：3 个时间块搞定工作/健康/学习》",
      "《把拖延变可控：用“2 分钟启动”打穿心理阻力》",
      "《待办清单越写越多？你缺的是“删减规则”》",
      "《每天只做 3 件事：如何选那 3 件（优先级框架）》",
      "《周复盘 15 分钟：用 4 个问题纠偏下一周》",
    ],
    hooks: [
      { title: "减负", text: "时间管理的核心不是塞满，而是删掉：这条规则最关键。" },
      { title: "模板", text: "别靠意志力：给你一张周计划模板，照填就行。" },
      { title: "反拖延", text: "只要开始 2 分钟，你就赢了一半。" },
      { title: "优先级", text: "你不是没时间，是把时间花在了“低价值但紧急”的事上。" },
      { title: "复盘", text: "每周 15 分钟复盘，比每天鸡血更有用。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["周计划模板：三时间块", "2分钟启动法：反拖延", "待办删减规则", "每天只做3件事", "周复盘4个问题"][i % 5],
      score: 980 + (20 - i) * 32,
      tag: ["模板", "方法", "系统", "优先级", "复盘"][i % 5],
    })),
    charts: {
      sent: { pos: 18, neu: 50, neg: 12 },
      hooks: { question_mark: 2, listicle: 8, how_to: 6, vs: 1, colon: 9, brackets: 4, quoted: 1 },
      lenChar: { labels: ["10–15", "16–21", "22–27", "28–33", "34–39"], counts: [12, 26, 20, 14, 8] },
      lenWord: { labels: ["3–4", "5–6", "7–8", "9–10", "11–12"], counts: [10, 22, 24, 16, 8] },
      terms: { labels: ["周计划模板", "优先级", "删减规则", "2分钟启动", "复盘", "时间块", "系统", "拖延", "只做3件", "上班族"], counts: [20, 16, 14, 12, 12, 11, 10, 9, 8, 7] },
    },
  },

  // 内容创作类
  short_video_script: {
    name: "短视频脚本",
    kpis: { n: 95, charMedian: 20, wordMedian: 8, structure: "三段式结构 + 镜头清单 + 反转/证据" },
    summary: [
      "脚本爆款的关键是“镜头可执行”：开头 3 秒、转场点、画面说明，比泛泛讲技巧更有效。",
      "高互动主题：脚本模板、爆点设计、口播节奏、B-roll 清单、结尾 CTA。",
      "标题要承诺结果：完播率/转粉/带货转化；正文给可复制模板与示例句。",
      "建议输出“脚本骨架 + 可替换变量”，让用户能套用到自己赛道。",
    ],
    ideas: [
      "《万能三段式脚本：痛点→反转→方法（含 3 秒开场句库）》",
      "《口播不尬：把“我认为”换成这 5 种表达》",
      "《完播率更高的节奏：每 7 秒一个信息点怎么做》",
      "《镜头清单：拍不出质感？先把 B-roll 拍对》",
      "《结尾 CTA 模板：引导评论/收藏/私信不招人烦》",
    ],
    hooks: [
      { title: "3 秒开场", text: "如果你也在做【___】，先别急着看方法，你可能踩了这个坑。" },
      { title: "反转", text: "大家都在教你【___】，但真正有效的是相反做法。" },
      { title: "数据承诺", text: "按这个节奏剪，完播率通常会更稳：我拆给你看。" },
      { title: "模板交付", text: "别学技巧了，直接拿脚本模板：变量一换就能拍。" },
      { title: "镜头清单", text: "你差的不是设备，是镜头清单：这 8 个镜头拍完就高级。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["万能三段式脚本模板", "口播不尬的 5 种表达", "每 7 秒一个信息点节奏", "B-roll 镜头清单", "结尾 CTA 模板"][i % 5],
      score: 1200 + (20 - i) * 40,
      tag: ["模板", "口播", "节奏", "镜头", "CTA"][i % 5],
    })),
    charts: {
      sent: { pos: 24, neu: 58, neg: 13 },
      hooks: { question_mark: 1, listicle: 9, how_to: 8, vs: 2, colon: 14, brackets: 6, quoted: 3 },
      lenChar: { labels: ["10–15", "16–21", "22–27", "28–33", "34–39"], counts: [14, 30, 24, 16, 11] },
      lenWord: { labels: ["4–5", "6–7", "8–9", "10–11", "12–13"], counts: [10, 24, 28, 20, 13] },
      terms: { labels: ["脚本模板", "三段式", "3秒开场", "完播率", "镜头清单", "口播", "节奏", "反转", "信息点", "CTA"], counts: [26, 20, 18, 16, 14, 12, 11, 10, 9, 8] },
    },
  },
  viral_title: {
    name: "爆款标题",
    kpis: { n: 110, charMedian: 18, wordMedian: 7, structure: "强结果承诺 + 具体对象 + 限定条件" },
    summary: [
      "标题爆款最核心是“具体”：对象（谁）+ 场景（何时何地）+ 结果（得到什么）。",
      "高点击结构：数字清单、反常识、对比（A vs B）、“别再…”、“只做这 1 件事”。",
      "避免空话：把形容词替换成可验证指标（涨粉、转化、完播、节省时间）。",
      "标题要与内容强一致：标题承诺越大，正文越要给步骤与证据（截图/数据/案例）。",
    ],
    ideas: [
      "《20 个高完播标题公式：把变量替换成你的赛道》",
      "《反常识标题怎么写：先否定再给更优解（附例子）》",
      "《标题里加这 1 个限定条件，点击率更稳》",
      "《同一个内容：A 标题 2 万播放，B 标题 20 万播放（对比拆解）》",
      "《“别再…”标题库：适合知识/健身/职场的通用版》",
    ],
    hooks: [
      { title: "限定条件", text: "如果你是【___人群】，只要改这一个词，点击率会更稳。" },
      { title: "对比拆解", text: "同样内容两个标题，差 10 倍播放：我把差异拆给你。" },
      { title: "反常识", text: "别再用【___】做标题了，真正有效的是【___】。" },
      { title: "公式交付", text: "我给你 20 个标题公式，变量一换就能用。" },
      { title: "证据先行", text: "这是我最近 7 天数据：标题里出现这类词，完播更高。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["20 个高完播标题公式", "反常识标题写法（附例子）", "一个限定条件让点击更稳", "A/B 标题 10 倍差异拆解", "“别再…”标题库通用版"][i % 5],
      score: 1400 + (20 - i) * 45,
      tag: ["公式", "反常识", "技巧", "拆解", "标题库"][i % 5],
    })),
    charts: {
      sent: { pos: 30, neu: 65, neg: 15 },
      hooks: { question_mark: 4, listicle: 18, how_to: 6, vs: 8, colon: 12, brackets: 4, quoted: 2 },
      lenChar: { labels: ["8–13", "14–19", "20–25", "26–31", "32–37"], counts: [22, 36, 28, 16, 8] },
      lenWord: { labels: ["3–4", "5–6", "7–8", "9–10", "11–12"], counts: [18, 28, 30, 22, 12] },
      terms: { labels: ["标题公式", "点击率", "完播", "限定条件", "反常识", "对比拆解", "变量替换", "别再", "数据证据", "标题库"], counts: [34, 22, 20, 18, 16, 14, 12, 11, 10, 9] },
    },
  },
  vlog: {
    name: "Vlog拍摄",
    kpis: { n: 75, charMedian: 19, wordMedian: 7, structure: "故事线 + 场景节奏 + 画面质感" },
    summary: [
      "Vlog 爆款更看“叙事”：开场一句话交代冲突/目标，整条视频围绕一个主线推进。",
      "画面质感来自“稳定的镜头语言”：景别切换（远-中-近）、动作衔接、环境音。",
      "高收藏主题：镜头清单、光线布置、手机参数、收音方案。",
      "别堆镜头：留白与节奏更重要，适当慢下来反而更高级。",
    ],
    ideas: [
      "《一张 Vlog 镜头清单：出门按表拍就不慌》",
      "《手机拍出电影感：光线优先级 3 条规则》",
      "《Vlog 叙事模板：目标→阻碍→解决→回收》",
      "《收音比画质更重要：室内/户外最稳方案》",
      "《节奏怎么剪：让观众愿意看完的“留白点”》",
    ],
    hooks: [
      { title: "镜头清单", text: "你拍不出质感，多半是没镜头清单：这张表拿走。" },
      { title: "电影感", text: "电影感不是滤镜，是光线：先把这 3 条规则记住。" },
      { title: "叙事", text: "Vlog 不好看不是你不够美，是没有主线。" },
      { title: "收音", text: "画面再好也白搭：收音差观众立刻划走。" },
      { title: "留白", text: "剪太满会累：这里留 1 秒空白，气质马上起来。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["Vlog 镜头清单一张表", "手机电影感光线规则", "Vlog 叙事模板四段式", "室内户外收音方案", "节奏留白点怎么剪"][i % 5],
      score: 920 + (20 - i) * 27,
      tag: ["清单", "光线", "叙事", "收音", "剪辑"][i % 5],
    })),
    charts: {
      sent: { pos: 20, neu: 48, neg: 7 },
      hooks: { question_mark: 0, listicle: 8, how_to: 7, vs: 1, colon: 10, brackets: 6, quoted: 1 },
      lenChar: { labels: ["10–15", "16–21", "22–27", "28–33", "34–39"], counts: [12, 26, 18, 12, 7] },
      lenWord: { labels: ["3–4", "5–6", "7–8", "9–10", "11–12"], counts: [10, 20, 22, 15, 8] },
      terms: { labels: ["镜头清单", "电影感", "光线", "叙事模板", "收音", "环境音", "景别切换", "留白", "节奏", "手机参数"], counts: [22, 18, 16, 14, 12, 10, 9, 8, 8, 7] },
    },
  },
  editing: {
    name: "剪辑技巧",
    kpis: { n: 88, charMedian: 20, wordMedian: 8, structure: "节奏节点 + 转场逻辑 + 字幕信息层级" },
    summary: [
      "剪辑爆款内容要“可复制”：给到具体操作路径（快捷键/参数/模板），而不是泛泛讲审美。",
      "高互动主题：节奏、转场、字幕、BGM、调色；尤其是“新手一学就会”的最受欢迎。",
      "强调“信息层级”：字幕别堆满，关键信息大字，次要信息小字，观感立刻高级。",
      "案例对比是王炸：同一素材，改 3 处剪辑点就更顺。观众最爱看对比。",
    ],
    ideas: [
      "《新手剪辑 3 个节奏节点：卡住就套这个》",
      "《字幕排版 4 规则：立刻从“土”变“高级”》",
      "《转场不是越多越好：用“动机转场”更自然》",
      "《BGM 选得好：情绪线怎么铺（含曲库关键词）》",
      "《同一素材前后对比：只改 3 处剪辑点，完播更稳》",
    ],
    hooks: [
      { title: "立刻变高级", text: "字幕只要改这 4 个点，质感立刻上去。" },
      { title: "套模板", text: "节奏剪不顺？用这 3 个节点去卡，你就不会乱。" },
      { title: "对比", text: "同一素材，A 很乱，B 很顺：差别就这 3 处。" },
      { title: "少即是多", text: "转场不是堆出来的：你需要的是“动机”。" },
      { title: "情绪线", text: "BGM 不会选？先把情绪线确定，再选曲。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["3 个节奏节点模板", "字幕排版 4 规则", "动机转场更自然", "BGM 情绪线怎么铺", "同一素材前后对比"][i % 5],
      score: 1050 + (20 - i) * 35,
      tag: ["节奏", "字幕", "转场", "BGM", "对比"][i % 5],
    })),
    charts: {
      sent: { pos: 22, neu: 54, neg: 12 },
      hooks: { question_mark: 1, listicle: 10, how_to: 8, vs: 2, colon: 11, brackets: 4, quoted: 2 },
      lenChar: { labels: ["10–15", "16–21", "22–27", "28–33", "34–39"], counts: [14, 30, 22, 14, 8] },
      lenWord: { labels: ["4–5", "6–7", "8–9", "10–11", "12–13"], counts: [10, 24, 26, 18, 10] },
      terms: { labels: ["节奏节点", "字幕排版", "信息层级", "动机转场", "BGM", "完播", "对比", "快捷键", "参数", "模板"], counts: [24, 18, 16, 14, 13, 12, 11, 9, 8, 7] },
    },
  },
  graphic_seeding: {
    name: "图文种草",
    kpis: { n: 72, charMedian: 17, wordMedian: 7, structure: "人群痛点 + 真实体验 + 对比证据" },
    summary: [
      "图文种草爆款更靠“证据链”：对比图/使用前后/参数/价格/适用人群，让内容像咨询报告。",
      "标题要点明人群与场景：油皮/敏感肌/通勤/旅行/小户型，越具体越好。",
      "强收藏主题：清单、对比、避坑、购买建议（预算分档）。",
      "避免硬广：用“体验过程”讲结论，用“风险提示”建立可信度。",
    ],
    ideas: [
      "《同价位 5 个好物横评：优缺点一张表（适合___人群）》",
      "《买前必看：这 7 个坑让我浪费了钱（替代推荐）》",
      "《预算 200/500/1000 三档：怎么搭出最强性价比组合》",
      "《真实使用 30 天：效果、缺点、适合谁（不适合谁）》",
      "《一图懂：参数怎么选才不踩雷（小白版）》",
    ],
    hooks: [
      { title: "横评表格", text: "我把同价位 5 个对比成一张表，你直接照着买。" },
      { title: "避坑", text: "这 7 个坑我踩过了，别再花冤枉钱。" },
      { title: "预算分档", text: "200/500/1000 三档怎么选？我给你最稳组合。" },
      { title: "30 天体验", text: "不说空话：我用 30 天，优缺点和适用人群讲清。" },
      { title: "参数小白", text: "看参数头大？只记住这 3 个指标就够了。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["同价位横评一张表", "买前必看 7 个坑", "预算三档最稳组合", "真实使用 30 天复盘", "参数小白版三指标"][i % 5],
      score: 980 + (20 - i) * 31,
      tag: ["横评", "避坑", "预算", "复盘", "科普"][i % 5],
    })),
    charts: {
      sent: { pos: 18, neu: 40, neg: 14 },
      hooks: { question_mark: 0, listicle: 16, how_to: 4, vs: 5, colon: 9, brackets: 3, quoted: 1 },
      lenChar: { labels: ["8–13", "14–19", "20–25", "26–31", "32–37"], counts: [16, 24, 18, 10, 4] },
      lenWord: { labels: ["3–4", "5–6", "7–8", "9–10", "11–12"], counts: [12, 18, 20, 14, 8] },
      terms: { labels: ["横评", "一张表", "适合人群", "预算分档", "真实使用", "避坑", "替代推荐", "参数", "优缺点", "不适合"], counts: [20, 17, 15, 13, 12, 11, 10, 9, 8, 7] },
    },
  },

  // 热门趋势类
  ai_tools: {
    name: "AI工具",
    kpis: { n: 120, charMedian: 22, wordMedian: 9, structure: "场景任务 + 工具链 + 结果对比" },
    summary: [
      "AI 工具爆款的核心是“任务导向”：不要只介绍工具，要用工具完成一个明确任务（写方案/做海报/做数据分析/自动化）。",
      "强传播形式是“工具链/工作流”：单工具很快被替代，多工具组合的 workflow 更有复用价值。",
      "标题里出现“节省时间/替代岗位动作/一键生成/从 0 到 1”更容易吸引点击，但正文必须给步骤与提示词。",
      "专业度来自“对比与边界”：同一任务用 A/B 工具对比输出，并说明适用场景与坑（幻觉、版权、隐私）。",
    ],
    ideas: [
      "《5 个 AI 工具组成“内容生产流水线”：选题→脚本→封面→剪辑→分发》",
      "《同一份需求：用 3 个 AI 生成方案对比（哪个好用，差在哪）》",
      "《AI 自动化：让它每天帮你做“信息收集→摘要→选题”》",
      "《AI 画图不翻车：版权/一致性/提示词的 6 条规则》",
      "《从 0 搭一个个人知识库：AI 帮你整理、检索、输出》",
    ],
    hooks: [
      { title: "结果对比", text: "同一任务我用 3 个 AI 做了一遍，差距非常大。" },
      { title: "工作流", text: "别再只学一个工具了：这条 workflow 才是真正可复用。" },
      { title: "省时承诺", text: "这套流程能把一篇内容从 2 小时压到 20 分钟。" },
      { title: "避坑边界", text: "AI 最容易翻车的不是生成，而是版权和隐私：这 6 条先记住。" },
      { title: "交付模板", text: "我把提示词和步骤都写成模板，你照抄就能用。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["AI 工具链：内容生产流水线", "3 个 AI 方案对比", "AI 自动化信息收集到选题", "AI 画图版权一致性避坑", "AI 个人知识库从0搭建"][i % 5],
      score: 1600 + (20 - i) * 50,
      tag: ["工作流", "对比", "自动化", "避坑", "知识库"][i % 5],
    })),
    charts: {
      sent: { pos: 34, neu: 70, neg: 16 },
      hooks: { question_mark: 2, listicle: 14, how_to: 12, vs: 10, colon: 16, brackets: 4, quoted: 2 },
      lenChar: { labels: ["12–17", "18–23", "24–29", "30–35", "36–41"], counts: [18, 36, 32, 22, 12] },
      lenWord: { labels: ["5–6", "7–8", "9–10", "11–12", "13–14"], counts: [16, 28, 34, 26, 16] },
      terms: { labels: ["工作流", "工具链", "提示词模板", "对比输出", "自动化", "信息收集", "内容生产", "版权", "隐私", "知识库"], counts: [36, 28, 24, 22, 20, 18, 16, 14, 12, 10] },
    },
  },
  chatgpt: {
    name: "ChatGPT",
    kpis: { n: 130, charMedian: 24, wordMedian: 10, structure: "角色设定 + 约束条件 + 迭代追问" },
    summary: [
      "ChatGPT 爆款不是“问答”，而是“协作”：给它角色、目标、输入材料、输出格式，让它像同事一样交付。",
      "内容高转发主题：提示词框架、追问链条、让它自检、让它产出结构化文档（表格/清单/脚本）。",
      "标题里出现“提示词/模板/一键/从 0 到 1”更吸引，但务必提供可复制 prompt。",
      "专业建议要包含边界：敏感信息不要喂、事实要核对、输出要用 checklist 自检。",
    ],
    ideas: [
      "《万能提示词 5 段式：目标→背景→约束→输出→校验》",
      "《让 ChatGPT 写方案不空：先喂这份“信息清单”》",
      "《追问链条示例：把一个模糊想法逼成可执行计划》",
      "《让它自检：用 checklist 降低幻觉（可复制模板）》",
      "《把 ChatGPT 变成你的“行业分析师”：周报/竞品/趋势》",
    ],
    hooks: [
      { title: "5 段式", text: "别再只问一句话：用 5 段式提示词，输出立刻专业。" },
      { title: "信息清单", text: "写方案不空的关键不是 prompt，是你先给足信息。" },
      { title: "追问链", text: "我用 6 次追问，把一个想法逼成可执行计划。" },
      { title: "自检模板", text: "让它先自检再交付：幻觉会少很多。" },
      { title: "分析师", text: "每周 10 分钟：让它帮你做行业周报和竞品摘要。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["万能提示词 5 段式", "写方案信息清单", "6 次追问链条示例", "自检 checklist 降幻觉", "ChatGPT 做行业周报"][i % 5],
      score: 1700 + (20 - i) * 55,
      tag: ["提示词", "方案", "追问", "自检", "分析"][i % 5],
    })),
    charts: {
      sent: { pos: 36, neu: 78, neg: 16 },
      hooks: { question_mark: 1, listicle: 16, how_to: 14, vs: 6, colon: 18, brackets: 5, quoted: 3 },
      lenChar: { labels: ["14–21", "22–29", "30–37", "38–45", "46–53"], counts: [22, 42, 36, 20, 10] },
      lenWord: { labels: ["5–6", "7–8", "9–10", "11–12", "13–14"], counts: [18, 30, 40, 26, 16] },
      terms: { labels: ["5段式提示词", "追问链", "约束条件", "输出格式", "自检", "checklist", "信息清单", "角色设定", "降低幻觉", "行业周报"], counts: [34, 26, 22, 20, 18, 16, 14, 12, 11, 10] },
    },
  },
  crypto: {
    name: "数字货币",
    kpis: { n: 90, charMedian: 22, wordMedian: 9, structure: "风险提示 + 框架科普 + 情绪降噪" },
    summary: [
      "数字货币内容最容易爆也最容易翻车：专业做法是先给风险边界（非投资建议、波动、仓位）。",
      "爆款常见结构：概念科普（是什么）→ 机制（为什么）→ 风险（怎么亏）→ 策略（怎么管）。",
      "标题“暴涨暴跌”有流量，但更高信任来自“框架降噪”：用数据与机制解释波动。",
      "建议避免诱导投机：以教育、风险管理、信息整理为主，更适合长期账号。",
    ],
    ideas: [
      "《一张图看懂：牛市/熊市你该关注哪些指标（新手版）》",
      "《为什么会暴涨暴跌：机制+情绪的 3 个关键因素》",
      "《仓位管理入门：不靠预测也能减少亏损》",
      "《常见骗局清单：这些话术出现就要警惕》",
      "《信息源怎么选：如何避免被“带节奏”》",
    ],
    hooks: [
      { title: "降噪框架", text: "别被情绪带走：用这 3 个指标先看清局面。" },
      { title: "机制解释", text: "涨跌不是玄学：机制一拆开就明白。" },
      { title: "风险边界", text: "先说清楚：这不是建议，你要先学会风险管理。" },
      { title: "骗局预警", text: "看到这种话术，先跑：我把骗局清单写出来了。" },
      { title: "仓位", text: "仓位管不好，再对的方向也会亏钱。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["牛熊指标新手版", "暴涨暴跌的机制解释", "仓位管理入门", "骗局话术清单", "信息源选择避带节奏"][i % 5],
      score: 1300 + (20 - i) * 42,
      tag: ["指标", "机制", "风控", "预警", "信息"][i % 5],
    })),
    charts: {
      sent: { pos: 18, neu: 50, neg: 22 },
      hooks: { question_mark: 3, listicle: 10, how_to: 8, vs: 2, colon: 12, brackets: 5, quoted: 2 },
      lenChar: { labels: ["12–17", "18–23", "24–29", "30–35", "36–41"], counts: [14, 28, 22, 16, 10] },
      lenWord: { labels: ["5–6", "7–8", "9–10", "11–12", "13–14"], counts: [12, 22, 26, 18, 12] },
      terms: { labels: ["风险提示", "仓位管理", "指标", "机制", "情绪", "骗局清单", "信息源", "波动", "非投资建议", "降噪"], counts: [24, 18, 16, 14, 12, 11, 10, 9, 8, 7] },
    },
  },
  side_hustle: {
    name: "副业",
    kpis: { n: 85, charMedian: 21, wordMedian: 8, structure: "赛道筛选 + 小步验证 + 复购交付" },
    summary: [
      "副业爆款更偏“方法论 + 可落地案例”：告诉用户如何选赛道、怎么验证、如何获客与复购。",
      "“普通人可复制”需要证据：真实时间投入、样例交付、复盘数据，才能显得专业。",
      "建议聚焦技能/服务型副业（咨询/设计/剪辑/运营/写作），合规且更可持续。",
      "用“路径地图”做系列内容：每期解决一个阶段的关键问题。",
    ],
    ideas: [
      "《副业赛道筛选表：用 4 个维度排除“看着爽实际坑”》",
      "《验证最小闭环：一周内拿到第一个反馈怎么做》",
      "《交付模板：把服务产品化，避免越做越累》",
      "《复购来自哪里：售后 3 步让客户愿意再买》",
      "《副业时间管理：如何不影响主业又能稳定输出》",
    ],
    hooks: [
      { title: "排坑筛选", text: "副业先筛掉 80%：这张表帮你快速排坑。" },
      { title: "最小闭环", text: "别憋大招：先跑通最小闭环，一周就能验证。" },
      { title: "产品化", text: "副业越做越累？把交付做成模板就轻松了。" },
      { title: "复购", text: "赚钱不是接单，是复购：这 3 步很关键。" },
      { title: "不影响主业", text: "副业能长期做下去，靠的是节奏，不是鸡血。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["副业赛道筛选表", "一周验证最小闭环", "交付产品化模板", "复购售后3步", "副业不影响主业的节奏"][i % 5],
      score: 1200 + (20 - i) * 37,
      tag: ["筛选", "验证", "模板", "复购", "节奏"][i % 5],
    })),
    charts: {
      sent: { pos: 20, neu: 50, neg: 15 },
      hooks: { question_mark: 1, listicle: 9, how_to: 7, vs: 1, colon: 11, brackets: 4, quoted: 1 },
      lenChar: { labels: ["12–17", "18–23", "24–29", "30–35", "36–41"], counts: [16, 30, 22, 12, 5] },
      lenWord: { labels: ["4–5", "6–7", "8–9", "10–11", "12–13"], counts: [12, 24, 26, 16, 7] },
      terms: { labels: ["赛道筛选", "最小闭环", "产品化", "交付模板", "复购", "节奏", "合规", "验证", "反馈", "时间管理"], counts: [20, 16, 14, 13, 12, 11, 9, 9, 8, 7] },
    },
  },
  personal_ip: {
    name: "个人IP",
    kpis: { n: 95, charMedian: 22, wordMedian: 9, structure: "定位一句话 + 内容支柱 + 信任资产" },
    summary: [
      "个人 IP 爆款不是“人设”，是“可信定位”：你帮谁解决什么问题，用什么方法，凭什么信你。",
      "内容要围绕 3-4 个“内容支柱”：案例复盘、方法论、工具模板、观点，形成稳定预期。",
      "信任来自连续证据：过程记录、前后对比、客户反馈、失败复盘（含边界）。",
      "建议做“资产化”：置顶合集、资料包、模板库，让新粉快速理解你的价值。",
    ],
    ideas: [
      "《一句话定位模板：把“我是谁”写到让人愿意关注》",
      "《个人 IP 内容支柱：3 类内容轮换，持续输出不枯竭》",
      "《案例复盘怎么写：用“问题-动作-结果-复用”四段》",
      "《信任资产清单：置顶/合集/资料包怎么搭》",
      "《从 0 到 1：个人 IP 的 30 天训练营计划表》",
    ],
    hooks: [
      { title: "定位一句话", text: "一句话让人懂你：套这个模板，你的定位会更清晰。" },
      { title: "内容不枯竭", text: "不是你没素材，是缺内容支柱：3 类轮换就够。" },
      { title: "案例复盘", text: "复盘写得好=信任建立：用这四段结构。" },
      { title: "资产化", text: "别把内容当流水账：把它做成资产，新粉会更快转化。" },
      { title: "30天计划", text: "给你一张 30 天计划表，从 0 训练出可持续输出。" },
    ],
    sampleTitles: Array.from({ length: 20 }).map((_, i) => ({
      title: ["一句话定位模板", "内容支柱轮换法", "案例复盘四段结构", "信任资产清单", "个人IP 30天计划表"][i % 5],
      score: 1450 + (20 - i) * 41,
      tag: ["定位", "内容", "复盘", "资产", "计划"][i % 5],
    })),
    charts: {
      sent: { pos: 22, neu: 60, neg: 13 },
      hooks: { question_mark: 0, listicle: 8, how_to: 10, vs: 1, colon: 14, brackets: 3, quoted: 1 },
      lenChar: { labels: ["12–17", "18–23", "24–29", "30–35", "36–41"], counts: [16, 34, 26, 14, 5] },
      lenWord: { labels: ["4–5", "6–7", "8–9", "10–11", "12–13"], counts: [12, 26, 30, 18, 9] },
      terms: { labels: ["一句话定位", "内容支柱", "信任资产", "案例复盘", "方法论", "工具模板", "置顶合集", "资料包", "30天计划", "持续输出"], counts: [26, 20, 18, 16, 12, 11, 10, 9, 8, 7] },
    },
  },
};

// Init buttons + default topic
addTopicButtons(els.groupLife, TOPIC_GROUPS.life);
addTopicButtons(els.groupCareer, TOPIC_GROUPS.career);
addTopicButtons(els.groupContent, TOPIC_GROUPS.content);
addTopicButtons(els.groupTrend, TOPIC_GROUPS.trend);
bindButtons();

// --- CSV 上传：本地读取并替换当前示例数据 ---
let lastCsv = { headers: [], records: [], fileName: "" };

function setColumnOptions(headers) {
  els.csvColumn.innerHTML = "";
  headers.forEach((h, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = h || `第 ${idx + 1} 列`;
    els.csvColumn.appendChild(opt);
  });

  // Guess a likely title/query column
  const lower = headers.map((h) => String(h || "").toLowerCase());
  const candidates = ["title", "标题", "query", "queries", "keyword", "keywords", "term", "topic", "search term", "搜索词", "搜索字词"];
  let pick = 0;
  for (let i = 0; i < lower.length; i++) {
    if (candidates.some((c) => lower[i].includes(String(c).toLowerCase()))) {
      pick = i;
      break;
    }
  }
  els.csvColumn.value = String(pick);
}

els.csvFile.addEventListener("change", async () => {
  const f = els.csvFile.files && els.csvFile.files[0];
  if (!f) return;
  els.csvInfo.textContent = `已选择：${f.name}（${Math.round(f.size / 1024)} KB）`;
  const text = await f.text();
  const parsed = parseCSV(text);
  if (!parsed.headers.length || !parsed.records.length) {
    showToast("CSV 解析失败或没有数据行，请检查格式。");
    els.csvColumn.disabled = true;
    els.applyCsvBtn.disabled = true;
    return;
  }
  lastCsv = { ...parsed, fileName: f.name };
  setColumnOptions(parsed.headers);
  els.csvColumn.disabled = false;
  els.applyCsvBtn.disabled = false;
  showToast("CSV 已读取：请选择标题列并应用。");
});

els.applyCsvBtn.addEventListener("click", () => {
  if (!lastCsv.records.length) return;
  const col = Number(els.csvColumn.value || 0);
  const titles = lastCsv.records.map((r) => (r && r[col] != null ? String(r[col]) : "")).filter((x) => x && x.trim().length);
  if (titles.length < 5) {
    showToast("该列有效标题太少（<5）。请换一列再试。");
    return;
  }

  const topic = buildTopicFromTitles(`自定义 CSV：${lastCsv.fileName}`, titles.slice(0, 300));
  TOPIC_DATA.uploaded = topic;

  // Render and highlight: create a synthetic active button state by clearing others.
  renderTopic("uploaded");
  showToast(`已用 CSV 分析：${titles.length} 条标题`);
});

// 默认选中：AI工具（符合“专业不敷衍”的示例）
renderTopic("ai_tools");

