/* =========================================================
   whyuxavier — автоматичне портфоліо з GitHub.
   Без фреймворків і збірки. Дані з GitHub вважаються
   ненадійними: вони потрапляють у DOM лише через textContent
   і перевірені URL-адреси.
   ========================================================= */
'use strict';

(() => {
  /* ---------------- Налаштування за замовчуванням ---------------- */
  const DEFAULT_SETTINGS = {
    username: 'whyuxavier',
    portfolioRepo: 'portfolio',
    includeForks: false,
    includeArchived: false,
    excludeRepos: ['portfolio'],
    cacheMinutes: 30,
  };
  const CONFIG_URL = 'categories.json';
  const API = 'https://api.github.com';
  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_PAGES = 20;          // запобіжник від нескінченної пагінації
  const MAX_PAGES_LOOKUPS = 15;  // скільки запитів до Pages API дозволено за одне оновлення
  const THEME_KEY = 'portfolio-theme';

  const CATEGORIES = {
    education: { label: 'Освіта', dot: 'c-edu' },
    games: { label: 'Ігри', dot: 'c-games' },
    tools: { label: 'Інструменти', dot: 'c-tools' },
    other: { label: 'Інше', dot: 'c-other' },
  };
  // Синоніми, які можна писати в categories.json
  const CATEGORY_ALIASES = {
    education: 'education', 'освіта': 'education', edu: 'education',
    games: 'games', game: 'games', 'ігри': 'games', 'гра': 'games',
    tools: 'tools', tool: 'tools', 'інструменти': 'tools',
    other: 'other', 'інше': 'other',
  };

  /* ---------------- Класифікатор ----------------
     Формат: "слово:вага". Зірочка в кінці — збіг за початком слова
     (для українських відмінків: "навч*" = навчання, навчальна…).
     Збіг шукається по цілих словах, а не підрядках. */
  const KEYWORDS = {
    education: [
      'education:3', 'educational:3', 'edu:2', 'learning:3', 'learn:2', 'course:3', 'courses:3',
      'quiz:3', 'quest:2', 'lesson:2', 'lessons:2', 'school:1', 'students:2', 'tutorial:2', 'trainer:2', 'teaching:3',
      'навч*:3', 'освіт*:3', 'квест*:2', 'тест:2', 'тести:2', 'тестуван*:3', 'вікторин*:3',
      'курс:3', 'курсу:3', 'курси:3', 'урок*:2', 'клас:2', 'класу:2', 'класів:2', 'учн*:2',
      'інформати*:1.5', 'тренажер*:2', 'підсум*:1', 'шкільн*:1', 'теорі*:1',
    ],
    games: [
      'game:3', 'games:3', 'gaming:3', 'roblox:3', 'arcade:3', 'platformer:3', 'shooter:3',
      'invaders:2', 'puzzle:2', 'rpg:3', 'pixel:1',
      'гра:3', 'ігри:3', 'гри:2', 'ігров*:2', 'платформер*:3', 'аркад*:3', 'пазл*:2', 'шутер*:3', 'головоломк*:2',
    ],
    tools: [
      'tool:3', 'tools:3', 'utility:3', 'utils:2', 'editor:3', 'generator:3', 'converter:3', 'creator:2',
      'calculator:3', 'qr:2', 'dashboard:2', 'vote:2', 'voting:2', 'tournament:2', 'tracker:2', 'app:1',
      'інструмент*:3', 'редактор*:3', 'генер*:3', 'конвертер*:3', 'калькулятор*:3', 'голосуван*:3',
      'утиліт*:3', 'сервіс*:2', 'турнірн*:2', 'сітк*:1', 'трекер*:2',
    ],
    other: [
      'bot:3', 'telegram:2', 'automation:3', 'library:3', 'lib:2', 'experiment:3', 'experiments:3',
      'script:3', 'scripts:3', 'cli:2', 'parser:2',
      'бот:3', 'телеграм*:2', 'автоматизац*:3', 'бібліотек*:3', 'експеримент*:3', 'скрипт*:3', 'парсер*:2',
    ],
  };
  const SOURCE_WEIGHT = { topics: 3, name: 2, description: 1 };
  const MIN_CONFIDENT_SCORE = 2;

  const LANG_COLORS = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', HTML: '#e34c26', CSS: '#663399', Python: '#3572a5',
    Lua: '#4f6bd8', Luau: '#00a2ff', 'C#': '#178600', 'C++': '#f34b7d', C: '#8a8a8a', Java: '#b07219',
    Go: '#00add8', Rust: '#dea584', PHP: '#4f5d95', Shell: '#89e051', Vue: '#41b883', Kotlin: '#a97bff',
  };

  // Довірені статичні іконки (не дані з GitHub).
  const ICONS = {
    star: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 .8l2.2 4.5 4.9.7-3.6 3.5.9 4.9L8 12.1l-4.4 2.3.9-4.9L.9 6l4.9-.7z"/></svg>',
    code: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg>',
    external: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M6 3h7v7M13 3 4 12"/></svg>',
  };

  /* ---------------- Стан ---------------- */
  const state = {
    settings: { ...DEFAULT_SETTINGS },
    overrides: {},          // name(lowercase) -> override
    featuredOrder: [],
    keywords: null,         // розібраний словник
    data: null,             // { ts, repos, pages }
    projects: [],
    cards: new Map(),
    category: 'all',
    query: '',
    sort: 'recommended',
    loading: false,
    lastError: null,
  };

  /* ---------------- DOM-утиліти ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const els = {};

  /** Безпечне створення елементів: рядки завжди стають текстом. */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'style') for (const [p, v] of Object.entries(value)) el.style.setProperty(p, v);
        else el.setAttribute(key, value === true ? '' : String(value));
      }
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }
  function icon(name) {
    const t = document.createElement('template');
    t.innerHTML = ICONS[name]; // лише статичні рядки з ICONS
    return t.content.firstElementChild;
  }
  function externalLinkProps(href) {
    return { href, target: '_blank', rel: 'noopener noreferrer' };
  }

  /* ---------------- Форматування ---------------- */
  const pluralRules = new Intl.PluralRules('uk-UA');
  function plural(n, forms) { // forms: { one, few, many }
    const r = pluralRules.select(n);
    return forms[r] || forms.many;
  }
  const STAR_FORMS = { one: 'зірка', few: 'зірки', many: 'зірок', other: 'зірки' };
  const dateFmt = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const dateTimeFmt = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const fmtDate = (d) => dateFmt.format(d).replace(/\s*р\.$/, '');
  function fmtWhen(ts) {
    const d = new Date(ts);
    const today = new Date();
    return d.toDateString() === today.toDateString() ? `сьогодні о ${timeFmt.format(d)}` : dateTimeFmt.format(d);
  }

  /* ---------------- URL-перевірки ---------------- */
  function parseHttpUrl(value) {
    if (typeof value !== 'string') return null;
    let v = value.trim();
    if (!v) return null;
    // GitHub зберігає homepage як введено: "example.com" без протоколу теж трапляється
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(v)) v = `https://${v}`;
    try {
      const u = new URL(v);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      if (!u.hostname) return null;
      return u;
    } catch { return null; }
  }
  function repoUrlFor(owner, name, htmlUrl) {
    const u = parseHttpUrl(htmlUrl);
    if (u && u.protocol === 'https:' && u.hostname === 'github.com') return u.href;
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  }
  function isSameAsRepo(u, repoUrl) {
    const strip = (s) => s.replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase();
    return strip(u.origin + u.pathname) === strip(repoUrl);
  }
  function safeImageUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const u = new URL(value.trim(), location.href);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch { return null; }
  }

  /* ---------------- Конфігурація ---------------- */
  function normalizeCategory(value) {
    if (typeof value !== 'string') return null;
    return CATEGORY_ALIASES[value.trim().toLowerCase()] || null;
  }
  function sanitizeConfig(raw) {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    const s = { ...DEFAULT_SETTINGS };
    const src = cfg.settings && typeof cfg.settings === 'object' ? cfg.settings : {};
    if (typeof src.username === 'string' && /^[a-z\d](?:[a-z\d-]{0,38})$/i.test(src.username.trim())) s.username = src.username.trim();
    if (typeof src.portfolioRepo === 'string' && src.portfolioRepo.trim()) s.portfolioRepo = src.portfolioRepo.trim();
    if (typeof src.includeForks === 'boolean') s.includeForks = src.includeForks;
    if (typeof src.includeArchived === 'boolean') s.includeArchived = src.includeArchived;
    if (Array.isArray(src.excludeRepos)) s.excludeRepos = src.excludeRepos.filter((x) => typeof x === 'string');
    if (Number.isFinite(src.cacheMinutes) && src.cacheMinutes >= 1 && src.cacheMinutes <= 1440) s.cacheMinutes = src.cacheMinutes;

    const overrides = {};
    const featuredOrder = [];
    const projects = cfg.projects && typeof cfg.projects === 'object' ? cfg.projects : {};
    for (const [name, o] of Object.entries(projects)) {
      if (!o || typeof o !== 'object') continue;
      const key = name.toLowerCase();
      const clean = {};
      const cat = normalizeCategory(o.category);
      if (cat) clean.category = cat;
      else if (o.category !== undefined) console.warn(`[portfolio] Невідома категорія "${o.category}" для ${name}`);
      if (typeof o.title === 'string' && o.title.trim()) clean.title = o.title.trim();
      if (typeof o.description === 'string' && o.description.trim()) clean.description = o.description.trim();
      if (o.demo === false) clean.demo = false;
      else if (typeof o.demo === 'string') {
        const u = parseHttpUrl(o.demo);
        if (u) clean.demo = u.href; else console.warn(`[portfolio] Некоректний demo URL для ${name}`);
      }
      if (o.hidden === true || o.show === false) clean.hidden = true;
      if (o.show === true) clean.show = true;
      const img = safeImageUrl(o.image);
      if (img) clean.image = img;
      if (o.featured === true) { clean.featured = true; featuredOrder.push(key); }
      overrides[key] = clean;
    }

    // Додаткові ключові слова з categories.json
    const keywords = {};
    for (const cat of Object.keys(CATEGORIES)) {
      const extra = cfg.keywords && Array.isArray(cfg.keywords[cat]) ? cfg.keywords[cat].filter((x) => typeof x === 'string') : [];
      keywords[cat] = [...KEYWORDS[cat], ...extra].map(parseKeyword).filter(Boolean);
    }
    return { settings: s, overrides, featuredOrder, keywords };
  }
  function parseKeyword(spec) {
    const m = /^(.+?)(?::(\d+(?:\.\d+)?))?$/.exec(spec.trim().toLowerCase());
    if (!m) return null;
    let term = m[1].trim();
    const prefix = term.endsWith('*');
    if (prefix) term = term.slice(0, -1);
    if (!term) return null;
    return { term, prefix, w: m[2] ? Number(m[2]) : 2 };
  }
  async function loadConfig() {
    try {
      const res = await fetchWithTimeout(CONFIG_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return sanitizeConfig(await res.json());
    } catch (err) {
      console.warn('[portfolio] Не вдалося прочитати categories.json — використовую налаштування за замовчуванням.', err);
      return sanitizeConfig({});
    }
  }

  /* ---------------- Кеш ---------------- */
  const cacheKey = () => `portfolio:v1:${state.settings.username.toLowerCase()}`;
  function readCache() {
    try {
      const raw = localStorage.getItem(cacheKey());
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Number.isFinite(data.ts) || !Array.isArray(data.repos)) return null;
      data.pages = data.pages && typeof data.pages === 'object' ? data.pages : {};
      return data;
    } catch { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(cacheKey(), JSON.stringify(data)); } catch { /* сховище недоступне або переповнене */ }
  }
  const isStale = (data) => !data || Date.now() - data.ts > state.settings.cacheMinutes * 60 * 1000;

  /* ---------------- GitHub API ---------------- */
  class GitHubError extends Error {
    constructor(kind, info = {}) { super(kind); this.kind = kind; Object.assign(this, info); }
  }
  async function fetchWithTimeout(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
  }
  async function ghFetch(url) {
    let res;
    try {
      res = await fetchWithTimeout(url, { headers: { Accept: 'application/vnd.github+json' } });
    } catch (err) {
      throw new GitHubError(err && err.name === 'AbortError' ? 'timeout' : 'network');
    }
    if (res.ok) return res;
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (res.status === 429 || (res.status === 403 && remaining === '0')) {
      throw new GitHubError('rate', { resetAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : null });
    }
    if (res.status === 404) throw new GitHubError('notfound', { status: 404 });
    throw new GitHubError('http', { status: res.status });
  }
  function nextLink(header) {
    if (!header) return null;
    for (const part of header.split(',')) {
      const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
      if (m) return m[1];
    }
    return null;
  }
  async function fetchAllRepos(username) {
    const all = [];
    let page = 1;
    let url = `${API}/users/${encodeURIComponent(username)}/repos?per_page=100&type=owner&sort=pushed&page=1`;
    while (url && page <= MAX_PAGES) {
      const res = await ghFetch(url);
      let data;
      try { data = await res.json(); } catch { throw new GitHubError('format'); }
      if (!Array.isArray(data)) throw new GitHubError('format');
      all.push(...data);
      const linked = nextLink(res.headers.get('link'));
      page += 1;
      if (linked) url = linked;
      else if (data.length === 100) url = `${API}/users/${encodeURIComponent(username)}/repos?per_page=100&type=owner&sort=pushed&page=${page}`;
      else url = null;
    }
    // Захист від дублів між сторінками
    const seen = new Set();
    return all.filter((r) => r && typeof r.name === 'string' && !seen.has(r.id) && seen.add(r.id));
  }
  /** Залишаємо тільки потрібні поля — менше пам’яті й місця в кеші. */
  function slimRepo(r) {
    return {
      id: r.id,
      name: r.name,
      owner: r.owner && typeof r.owner.login === 'string' ? r.owner.login : state.settings.username,
      html_url: r.html_url,
      description: typeof r.description === 'string' ? r.description : '',
      homepage: typeof r.homepage === 'string' ? r.homepage : '',
      has_pages: r.has_pages === true,
      fork: r.fork === true,
      archived: r.archived === true,
      private: r.private === true,
      topics: Array.isArray(r.topics) ? r.topics.filter((t) => typeof t === 'string').slice(0, 20) : [],
      language: typeof r.language === 'string' ? r.language : '',
      stargazers_count: Number.isFinite(r.stargazers_count) ? r.stargazers_count : 0,
      pushed_at: r.pushed_at || r.updated_at || r.created_at || null,
    };
  }
  /**
   * Для репозиторіїв з увімкненим GitHub Pages, але без homepage,
   * питаємо Pages API про справжню адресу (враховує власний домен).
   * Запити робляться лише для таких репозиторіїв і кешуються.
   */
  async function resolvePagesUrls(repos, previous) {
    const pages = {};
    const queue = [];
    for (const r of repos) {
      if (!r.has_pages) continue;
      const o = state.overrides[r.name.toLowerCase()] || {};
      if (o.demo !== undefined || validHomepage(r)) continue;
      if (previous && typeof previous[r.name] === 'string') pages[r.name] = previous[r.name];
      else queue.push(r);
    }
    for (const r of queue.slice(0, MAX_PAGES_LOOKUPS)) {
      try {
        const res = await ghFetch(`${API}/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}/pages`);
        const info = await res.json();
        const u = parseHttpUrl(info && info.html_url);
        if (u) pages[r.name] = u.href;
      } catch (err) {
        if (err.kind === 'rate') break; // не витрачаємо ліміт далі
        // 404/403 без токена — далі використаємо стандартну адресу Pages
      }
    }
    return pages;
  }

  /* ---------------- Демо ---------------- */
  function validHomepage(repo) {
    const u = parseHttpUrl(repo.homepage);
    if (!u) return null;
    if (isSameAsRepo(u, repoUrlFor(repo.owner, repo.name, repo.html_url))) return null;
    return u;
  }
  /** Пріоритет: налаштування → homepage → підтверджений GitHub Pages → (немає демо). */
  function resolveDemo(repo, override, pages) {
    if (override.demo === false) return null;
    if (typeof override.demo === 'string') return { url: override.demo, source: 'config' };
    const hp = validHomepage(repo);
    if (hp) return { url: hp.href, source: /\.github\.io$/i.test(hp.hostname) ? 'pages' : 'homepage' };
    if (repo.has_pages) {
      if (pages[repo.name]) return { url: pages[repo.name], source: 'pages' };
      // has_pages підтверджено GitHub; github.io-адреса автоматично переадресовує на власний домен, якщо він є
      const owner = repo.owner.toLowerCase();
      const isUserSite = repo.name.toLowerCase() === `${owner}.github.io`;
      return { url: `https://${owner}.github.io/${isUserSite ? '' : `${encodeURIComponent(repo.name)}/`}`, source: 'pages' };
    }
    return null;
  }

  /* ---------------- Опис ---------------- */
  function cleanDescription(raw) {
    if (!raw) return '';
    let s = String(raw);
    // Двомовні описи з прапорцями "🇬🇧 … 🇺🇦 …" → українська частина
    const parts = s.split(/(\p{Regional_Indicator}{2})/u);
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i += 2) {
        if (parts[i] === '\u{1F1FA}\u{1F1E6}' && parts[i + 1] && parts[i + 1].trim()) { s = parts[i + 1]; break; }
      }
    }
    // Без декоративних емодзі в картках
    s = s.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}️‍⃣]/gu, '');
    return s.replace(/\s+/g, ' ').trim();
  }

  /* ---------------- Класифікація ---------------- */
  function tokenize(text) {
    return String(text || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[’'ʼ`]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  }
  function scoreTokens(tokens, sourceWeight, scores) {
    if (!tokens.length) return;
    const set = new Set(tokens);
    for (const [cat, list] of Object.entries(state.keywords)) {
      for (const kw of list) {
        const hit = kw.prefix ? tokens.some((t) => t.startsWith(kw.term)) : set.has(kw.term);
        if (hit) scores[cat] += kw.w * sourceWeight; // кожне слово рахується один раз на джерело
      }
    }
  }
  function classify(repo, override) {
    if (override.category) return { category: override.category, source: 'manual' };
    const scores = { education: 0, games: 0, tools: 0, other: 0 };
    scoreTokens(repo.topics.flatMap(tokenize), SOURCE_WEIGHT.topics, scores);
    scoreTokens(tokenize(repo.name), SOURCE_WEIGHT.name, scores);
    scoreTokens(tokenize(repo.description), SOURCE_WEIGHT.description, scores);

    // Навчальна гра — це передусім освіта
    if (scores.education > 0 && scores.games > 0 && scores.education >= scores.games * 0.75) {
      return { category: 'education', source: 'auto', scores };
    }
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [best, second] = ranked;
    if (best[1] < MIN_CONFIDENT_SCORE || best[1] === second[1]) return { category: 'other', source: 'fallback', scores };
    return { category: best[0], source: 'auto', scores };
  }

  /* ---------------- Модель проєктів ---------------- */
  const normalizeSearch = (s) => String(s || '').toLowerCase().replace(/[’'ʼ`]/g, '').replace(/ё/g, 'е');

  function buildProjects(data) {
    const s = state.settings;
    const exclude = new Set(s.excludeRepos.map((x) => x.toLowerCase()));
    const out = [];
    for (const repo of data.repos) {
      const key = repo.name.toLowerCase();
      const o = state.overrides[key] || {};
      if (repo.private) continue;
      if (o.hidden) continue;
      if (!o.show) {
        if (exclude.has(key)) continue;
        if (repo.fork && !s.includeForks) continue;
        if (repo.archived && !s.includeArchived) continue;
      }
      const repoUrl = repoUrlFor(repo.owner, repo.name, repo.html_url);
      const description = o.description || cleanDescription(repo.description);
      const { category, source } = classify(repo, o);
      const updated = repo.pushed_at ? new Date(repo.pushed_at) : null;
      const project = {
        name: repo.name,
        title: o.title || repo.name,
        description,
        repoUrl,
        demo: resolveDemo(repo, o, data.pages || {}),
        category,
        categorySource: source,
        language: repo.language,
        topics: repo.topics,
        stars: repo.stargazers_count,
        updated: updated && !Number.isNaN(updated.getTime()) ? updated : null,
        featured: o.featured === true,
        featuredRank: o.featured ? state.featuredOrder.indexOf(key) : Infinity,
        image: o.image || null,
      };
      project.search = normalizeSearch([
        project.name, project.title, project.description, repo.description,
        CATEGORIES[category].label, category, project.language, project.topics.join(' '),
        project.demo ? 'демо demo' : '',
      ].join(' '));
      out.push(project);
    }
    const missing = Object.keys(state.overrides).filter((k) => !data.repos.some((r) => r.name.toLowerCase() === k));
    if (missing.length) console.info('[portfolio] У categories.json є репозиторії, яких немає серед публічних:', missing.join(', '));
    return out;
  }

  /* ---------------- Картки ---------------- */
  function demoHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }
  function buildCard(p) {
    const primaryUrl = p.demo ? p.demo.url : p.repoUrl;
    const primaryLabel = p.demo
      ? `${p.title} — відкрити демо (нова вкладка)`
      : `${p.title} — відкрити репозиторій на GitHub (нова вкладка)`;
    const cat = CATEGORIES[p.category];

    const tags = h('div', { class: 'tags' },
      h('span', { class: 'tag', title: p.categorySource === 'manual' ? 'Категорію задано вручну' : 'Категорію визначено автоматично' },
        h('i', { class: cat.dot, 'aria-hidden': 'true' }), cat.label),
      p.language && h('span', { class: 'tag tag-lang' },
        h('i', { class: 'lang-dot', 'aria-hidden': 'true', style: LANG_COLORS[p.language] ? { background: LANG_COLORS[p.language] } : null }),
        p.language),
      p.demo && h('span', { class: 'tag tag-demo' }, 'Демо'),
    );

    const starsText = `${p.stars} ${plural(p.stars, STAR_FORMS)}`;
    const meta = h('div', { class: 'card-meta' },
      h('a', {
        class: 'stars', ...externalLinkProps(p.repoUrl),
        title: 'Поставити зірку можна на сторінці репозиторію на GitHub',
        'aria-label': `${starsText} на GitHub. Відкрити репозиторій ${p.name}`,
      }, icon('star'), starsText),
      p.updated && h('span', null, 'Оновлено: ',
        h('time', { datetime: p.updated.toISOString() }, fmtDate(p.updated))),
    );

    const hint = p.demo
      ? h('span', { class: 'primary-hint', title: p.demo.url }, p.demo.source === 'pages' ? 'GitHub Pages' : h('b', null, demoHost(p.demo.url)))
      : h('span', { class: 'primary-hint' }, 'Лише вихідний код');

    const actions = h('div', { class: 'card-actions' },
      hint,
      p.demo && h('a', { class: 'btn btn-sm btn-ghost', ...externalLinkProps(p.demo.url), 'aria-label': `Відкрити демо ${p.title} (нова вкладка)` },
        'Відкрити', icon('external')),
      h('a', { class: 'btn btn-sm btn-ghost', ...externalLinkProps(p.repoUrl), 'aria-label': `Вихідний код ${p.title} на GitHub (нова вкладка)` },
        icon('code'), 'Код'),
    );

    const body = h('div', { class: 'card-body' },
      h('div', { class: 'card-top' },
        h('h3', { class: 'card-title' },
          h('a', { ...externalLinkProps(primaryUrl), 'aria-label': primaryLabel }, p.title)),
        p.featured && h('span', { class: 'featured-mark', title: 'Вибраний проєкт' }, 'Вибране'),
      ),
      p.description
        ? h('p', { class: 'card-desc', title: p.description }, p.description)
        : h('p', { class: 'card-desc is-missing' }, 'Опис проєкту відсутній'),
      tags,
      meta,
    );

    const card = h('article', { class: `card${p.featured ? ' is-featured' : ''}` });
    if (p.image) {
      const img = h('img', { src: p.image, alt: '', loading: 'lazy', decoding: 'async', width: '640', height: '360' });
      const media = h('div', { class: 'card-media' }, img);
      img.addEventListener('error', () => media.remove(), { once: true });
      card.append(media);
    }
    card.append(body, actions);
    return card;
  }
  function buildSkeleton() {
    const sk = (w, hgt) => h('div', { class: 'sk', style: { width: w, height: hgt } });
    return h('div', { class: 'card skeleton', 'aria-hidden': 'true' },
      h('div', { class: 'card-body' },
        sk('55%', '18px'), sk('100%', '12px'), sk('80%', '12px'),
        h('div', { class: 'tags' }, sk('70px', '22px'), sk('80px', '22px')),
        sk('40%', '12px')),
      h('div', { class: 'card-actions' }, sk('100%', '30px')));
  }

  /* ---------------- Рендер ---------------- */
  function matchesQuery(p, words) {
    return words.every((w) => p.search.includes(w));
  }
  function compare(a, b) {
    const byName = a.title.localeCompare(b.title, 'uk', { sensitivity: 'base', numeric: true }) || a.name.localeCompare(b.name);
    const time = (p) => (p.updated ? p.updated.getTime() : 0);
    switch (state.sort) {
      case 'stars': return b.stars - a.stars || time(b) - time(a) || byName;
      case 'updated': return time(b) - time(a) || byName;
      case 'name': return byName;
      default:
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        if (a.featured && b.featured && a.featuredRank !== b.featuredRank) return a.featuredRank - b.featuredRank;
        return time(b) - time(a) || byName;
    }
  }
  function render() {
    const words = normalizeSearch(state.query).split(/\s+/).filter(Boolean);
    const searched = state.projects.filter((p) => matchesQuery(p, words));

    // Лічильники у фільтрах враховують пошук
    const counts = { all: searched.length, education: 0, games: 0, tools: 0, other: 0 };
    for (const p of searched) counts[p.category] += 1;
    for (const btn of els.filters.querySelectorAll('.chip')) {
      const cat = btn.dataset.cat;
      btn.querySelector('.count').textContent = String(counts[cat] ?? 0);
      const active = cat === state.category;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    const list = (state.category === 'all' ? searched : searched.filter((p) => p.category === state.category)).sort(compare);
    els.grid.replaceChildren(...list.map((p) => state.cards.get(p.name)));
    els.grid.setAttribute('aria-busy', 'false');

    if (list.length) { els.empty.hidden = true; return; }
    if (!state.projects.length) {
      showEmpty('Публічних проєктів поки немає', 'Щойно на GitHub з’явиться публічний репозиторій, він буде тут.', null);
    } else {
      const parts = [];
      if (state.query.trim()) parts.push(`«${state.query.trim()}»`);
      if (state.category !== 'all') parts.push(`у категорії «${CATEGORIES[state.category].label}»`);
      showEmpty('Нічого не знайдено', `Немає проєктів, що відповідають запиту ${parts.join(' ')}.`.replace(/\s+\./, '.'),
        { label: 'Скинути фільтри', onClick: resetFilters });
    }
  }
  function showEmpty(title, text, action) {
    els.empty.replaceChildren(
      h('h3', null, title),
      h('p', null, text),
      action && (() => {
        const b = h('button', { type: 'button', class: 'btn btn-ghost' }, action.label);
        b.addEventListener('click', action.onClick);
        return b;
      })(),
    );
    els.empty.hidden = false;
  }
  function renderStats() {
    const total = state.projects.length;
    const stars = state.projects.reduce((sum, p) => sum + p.stars, 0);
    const demos = state.projects.filter((p) => p.demo).length;
    $('[data-stat="total"]').textContent = String(total);
    $('[data-stat="stars"]').textContent = String(stars);
    $('[data-stat="demos"]').textContent = String(demos);
    const cats = $('[data-stat="cats"]');
    cats.replaceChildren(...Object.entries(CATEGORIES).map(([key, c]) =>
      h('span', null, h('i', { class: c.dot, 'aria-hidden': 'true' }), c.label, ' ',
        h('b', null, String(state.projects.filter((p) => p.category === key).length)))));
  }
  function showSkeletons(n = 6) {
    els.grid.setAttribute('aria-busy', 'true');
    els.grid.replaceChildren(...Array.from({ length: n }, buildSkeleton));
  }

  /* ---------------- Статус і помилки ---------------- */
  function errorMessage(err) {
    switch (err && err.kind) {
      case 'rate': {
        const when = err.resetAt ? ` Ліміт оновиться о ${timeFmt.format(new Date(err.resetAt))}.` : ' Спробуйте трохи пізніше.';
        return `Вичерпано ліміт запитів до GitHub API (60 на годину без авторизації).${when}`;
      }
      case 'network': return 'Немає з’єднання з GitHub. Перевірте інтернет і спробуйте ще раз.';
      case 'timeout': return 'GitHub відповідає занадто довго. Спробуйте ще раз.';
      case 'notfound': return `Користувача GitHub «${state.settings.username}» не знайдено.`;
      case 'format': return 'GitHub повернув неочікувані дані.';
      case 'http': return `GitHub повернув помилку (код ${err.status}).`;
      default: return 'Не вдалося завантажити дані з GitHub.';
    }
  }
  function setStatus() {
    const parts = [];
    if (state.loading) parts.push(state.data ? 'Оновлюємо дані з GitHub…' : 'Завантажуємо проєкти з GitHub…');
    else if (state.data) parts.push(`Дані з GitHub: ${fmtWhen(state.data.ts)}`);
    const btn = h('button', { type: 'button', class: 'link-btn', disabled: state.loading || undefined }, 'Оновити');
    btn.addEventListener('click', () => refresh({ force: true }));
    els.status.replaceChildren(h('span', null, parts.join(' ')), state.data || state.lastError ? btn : '');
  }
  function retryButton(label = 'Спробувати ще раз') {
    const b = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, label);
    b.addEventListener('click', () => refresh({ force: true }));
    return b;
  }
  function showError(err) {
    const msg = errorMessage(err);
    if (state.data) {
      els.notice.replaceChildren(
        h('span', null, `Не вдалося оновити дані. ${msg} Показано збережену версію (${fmtWhen(state.data.ts)}).`),
        retryButton());
      els.notice.hidden = false;
    } else {
      els.grid.replaceChildren();
      els.grid.setAttribute('aria-busy', 'false');
      els.empty.replaceChildren(
        h('h3', null, 'Не вдалося завантажити проєкти'),
        h('p', null, msg),
        retryButton(),
        h('p', { style: { 'margin-top': '14px', 'margin-bottom': '0' } },
          'Усі репозиторії також доступні ',
          h('a', externalLinkProps(`https://github.com/${encodeURIComponent(state.settings.username)}?tab=repositories`), 'на GitHub'), '.'));
      els.empty.hidden = false;
    }
  }

  /* ---------------- Дані ---------------- */
  function applyData(data) {
    state.data = data;
    state.projects = buildProjects(data);
    state.cards = new Map(state.projects.map((p) => [p.name, buildCard(p)]));
    renderStats();
    render();
  }
  async function refresh({ force = false } = {}) {
    if (state.loading) return;
    if (!force && state.data && !isStale(state.data)) return;
    state.loading = true;
    state.lastError = null;
    setStatus();
    if (!state.data) { els.empty.hidden = true; showSkeletons(); }
    try {
      const raw = await fetchAllRepos(state.settings.username);
      const repos = raw.map(slimRepo);
      const pages = await resolvePagesUrls(repos, state.data && state.data.pages);
      const data = { ts: Date.now(), repos, pages };
      writeCache(data);
      els.notice.hidden = true;
      applyData(data);
    } catch (err) {
      state.lastError = err;
      if (!(err instanceof GitHubError)) console.error('[portfolio]', err);
      showError(err);
    } finally {
      state.loading = false;
      setStatus();
    }
  }

  /* ---------------- Взаємодія ---------------- */
  function resetFilters() {
    state.query = '';
    state.category = 'all';
    els.search.value = '';
    render();
    els.search.focus();
  }
  function bindUI() {
    els.filters.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      state.category = btn.dataset.cat;
      if (state.data) render();
    });
    let t;
    els.search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { state.query = els.search.value; if (state.data) render(); }, 120);
    });
    els.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.search.value) { e.preventDefault(); els.search.value = ''; state.query = ''; if (state.data) render(); }
    });
    els.sort.addEventListener('change', () => { state.sort = els.sort.value; if (state.data) render(); });

    // Тема
    const themeBtn = $('#themeToggle');
    const syncThemeBtn = () => {
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      themeBtn.setAttribute('aria-label', light ? 'Увімкнути темну тему' : 'Увімкнути світлу тему');
      const meta = $('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', light ? '#f6f6fb' : '#0d0f17');
    };
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      syncThemeBtn();
    });
    syncThemeBtn();

    // Вікно [i]
    const dlg = $('#infoDialog');
    const open = () => {
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    };
    const close = () => { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); };
    $('#infoOpen').addEventListener('click', open);
    $('#infoClose').addEventListener('click', close);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    dlg.addEventListener('close', () => $('#infoOpen').focus());

    // Повернення на вкладку: оновити, якщо кеш застарів
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.data && isStale(state.data)) refresh();
    });
  }

  /** Декоративний «графік активності» у hero (фіксований візерунок, не дані). */
  function drawContrib() {
    const g = $('#heroContrib');
    if (!g) return;
    const NS = 'http://www.w3.org/2000/svg';
    const cols = 30, rows = 6, size = 11, step = 14.4, x0 = 24, y0 = 252;
    let seed = 17;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const v = rnd() * (0.55 + c / cols);
        const rect = document.createElementNS(NS, 'rect');
        rect.setAttribute('x', String(x0 + c * step));
        rect.setAttribute('y', String(y0 + r * step));
        rect.setAttribute('width', String(size));
        rect.setAttribute('height', String(size));
        rect.setAttribute('rx', '2.5');
        if (v < 0.35) rect.setAttribute('class', 'l0');
        else rect.setAttribute('opacity', v < 0.6 ? '0.3' : v < 0.85 ? '0.6' : '0.95');
        rect.style.setProperty('--d', `${(c * 0.012).toFixed(3)}s`);
        g.append(rect);
      }
    }
  }

  /* ---------------- Старт ---------------- */
  async function init() {
    els.grid = $('#grid');
    els.empty = $('#empty');
    els.notice = $('#notice');
    els.status = $('#status');
    els.filters = $('#filters');
    els.search = $('#search');
    els.sort = $('#sort');
    $('#year').textContent = String(new Date().getFullYear());

    drawContrib();
    bindUI();
    showSkeletons();
    setStatus();

    const cfg = await loadConfig();
    state.settings = cfg.settings;
    state.overrides = cfg.overrides;
    state.featuredOrder = cfg.featuredOrder;
    state.keywords = cfg.keywords;
    $('#repoLink').href = `https://github.com/${encodeURIComponent(state.settings.username)}/${encodeURIComponent(state.settings.portfolioRepo)}`;

    const cached = readCache();
    if (cached) {
      applyData(cached);       // миттєво показуємо збережене
      setStatus();
    }
    if (isStale(cached)) refresh(); // а застаріле оновлюємо у фоні
  }

  // Для тестів у консолі: window.__portfolio.classify(...)
  window.__portfolio = { classify: (r) => classify(slimRepo(r), {}), cleanDescription, state };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
