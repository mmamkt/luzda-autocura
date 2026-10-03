(function () {
  "use strict";

  // D começa só com a configuração pública (/api/config); o conteúdo chega depois do login (/api/content).
  const EMPTY_APP = { name: "", shortName: "", brand: "", logo: "", primaryColor: "#5d3b78", loginText: "", support: { whatsapp: "", whatsappMessage: "", email: "" } };
  let publicApp = EMPTY_APP;
  let D = { app: EMPTY_APP, hero: {}, labels: {}, products: [], lockedProducts: [], upsells: [], posts: [] };
  let preview = false;
  const root = document.getElementById("root");
  const modalRoot = document.getElementById("modal-root");
  const MAX_FAVORITES = 30;

  // ---------- Icons ----------
  const ICONS = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
    whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    lotus: '<path d="M12 20c-4 0-8-2-9-6 3 0 6 1 9 4 3-3 6-4 9-4-1 4-5 6-9 6Z"/><path d="M12 18c-2-2-3-5-3-8 1 1 2 1.5 3 3 1-1.5 2-2 3-3 0 3-1 6-3 8Z"/><path d="M12 13c-1-2-1-5 0-8 1 3 1 6 0 8Z"/>'
  };
  const icon = (name, cls) => `<svg class="i ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  // ---------- Helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new Error("Sem conexão com o servidor. Verifique sua internet e tente novamente.");
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* resposta sem JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || "Não foi possível conectar. Tente novamente.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Escurece (amt < 0) ou clareia (amt > 0) uma cor #rrggbb.
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.round(Math.min(255, Math.max(0, amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return "#" + [n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, "0")).join("");
  }

  function applyBranding(app) {
    const color = /^#[0-9a-f]{6}$/i.test(app.primaryColor || "") ? app.primaryColor : "#5d3b78";
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--primary", color);
    rootStyle.setProperty("--primary-dark", shade(color, -0.45));
    rootStyle.setProperty("--primary-soft", shade(color, 0.88));
    rootStyle.setProperty("--sidebar-bg", shade(color, 0.9));
    rootStyle.setProperty("--sidebar-border", shade(color, 0.82));
    rootStyle.setProperty("--topbar-bg", shade(color, 0.95));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = shade(color, -0.45);
    document.title = app.name || "";
  }

  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(diff)) return "";
    if (diff < 60) return "agora mesmo";
    const units = [
      [31536000, "ano", "anos"], [2592000, "mês", "meses"], [86400, "dia", "dias"],
      [3600, "hora", "horas"], [60, "minuto", "minutos"]
    ];
    for (const [secs, one, many] of units) {
      const n = Math.floor(diff / secs);
      if (n >= 1) return `há ${n} ${n === 1 ? one : many}`;
    }
    return "agora mesmo";
  }

  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  function logoHtml(cls) {
    const inner = D.app.logo ? `<img src="${esc(D.app.logo)}" alt="">` : icon("lotus");
    return `<div class="logo ${cls || ""}">${inner}</div>`;
  }

  function coverHtml(item, size) {
    if (item.cover) return `<img class="cover-img" src="${esc(item.cover)}" alt="" loading="lazy">`;
    const [a, b, c] = item.theme || ["#2a1740", "#5d3b78", "#e8c08a"];
    const text = item.coverText || item.title;
    const fs = size === "sm" ? 6 : size === "lg" ? 22 : size === "md" ? 19 : 15;
    const brand = size === "sm" ? "" : `<span class="brand">${esc(D.app.brand)}</span>`;
    const orn = size === "sm" ? "" : `<svg class="orn" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.4">${ICONS.lotus}</svg>`;
    return `<div class="cover-gen" style="background:linear-gradient(170deg, ${b} 0%, ${a} 70%)">
      ${brand}${orn}<span class="t" style="font-size:${fs}px;color:${c}">${esc(text)}</span>
    </div>`;
  }

  // ---------- Session / user state (salvos no servidor) ----------
  let session = null;
  let state = null;
  let saveTimer = null;

  function saveState() {
    const mods = allModules();
    state.progress = { done: mods.filter((x) => isDone(x.key)).length, total: mods.length };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api("PUT", "api/state", { state }).catch((e) => { if (e.status === 401) logout(true); });
    }, 400);
  }
  const modKey = (p, m) => `${p}/${m}`;

  function allModules() {
    const list = [];
    D.products.forEach((p) => p.modules.forEach((m) => list.push({ product: p, module: m, key: modKey(p.id, m.id) })));
    return list;
  }
  function findModule(pid, mid) {
    const p = D.products.find((x) => x.id === pid);
    const m = p && p.modules.find((x) => x.id === mid);
    return p && m ? { product: p, module: m, key: modKey(pid, mid) } : null;
  }
  const isDone = (key) => state.completed.includes(key);
  const isFav = (key) => state.favorites.includes(key);

  function setDone(key, done) {
    state.completed = state.completed.filter((k) => k !== key);
    if (done) state.completed.push(key);
    saveState();
  }
  function toggleFav(key) {
    if (isFav(key)) {
      state.favorites = state.favorites.filter((k) => k !== key);
      saveState();
      return false;
    }
    if (state.favorites.length >= MAX_FAVORITES) {
      toast(`Limite de ${MAX_FAVORITES} favoritos atingido.`);
      return false;
    }
    state.favorites.push(key);
    saveState();
    return true;
  }
  // Produtos sem acesso (vêm sem módulos do servidor) + ofertas, todos com cadeado.
  function lockedItems() {
    return D.lockedProducts.map((p) => Object.assign({ description: p.lockedDescription }, p)).concat(D.upsells);
  }
  function moduleLabel(m) { return m.continueTitle || m.description || m.title; }

  // ---------- Login ----------
  function renderLogin(error) {
    applyBranding(D.app);
    root.innerHTML = `
      <div class="login">
        <form class="login-card" id="login-form" novalidate>
          ${logoHtml()}
          <h1>${esc(D.app.name)}</h1>
          <p>${esc(D.app.loginText || "Digite o e-mail usado na compra para acessar.")}</p>
          <div class="field">
            <label for="email">E-mail</label>
            <input id="email" type="email" autocomplete="email" placeholder="seuemail@exemplo.com" required>
          </div>
          <div class="login-error" id="login-error">${esc(error || "")}</div>
          <button class="btn btn-primary btn-block" type="submit" id="login-btn">Entrar</button>
        </form>
      </div>`;
    const form = document.getElementById("login-form");
    const input = document.getElementById("email");
    const btn = document.getElementById("login-btn");
    const errorEl = document.getElementById("login-error");
    input.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorEl.textContent = "Informe um e-mail válido."; return; }
      btn.disabled = true;
      btn.textContent = "Entrando...";
      errorEl.textContent = "";
      try {
        await api("POST", "api/login", { email });
        await boot();
      } catch (err) {
        errorEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = "Entrar";
      }
    });
  }

  async function logout(expired) {
    clearTimeout(saveTimer);
    if (preview && !expired) { location.href = "/admin"; return; }
    if (!expired) await api("POST", "api/logout").catch(() => {});
    session = null;
    state = null;
    preview = false;
    D = { app: publicApp, hero: {}, labels: {}, products: [], lockedProducts: [], upsells: [], posts: [] };
    closeModal();
    history.replaceState(null, "", "#/");
    renderLogin(expired ? "Sua sessão expirou. Entre novamente." : "");
  }

  // ---------- Shell ----------
  function shell(active, body) {
    const nav = [
      { id: "home", icon: "home", tip: "Início", href: "#/" },
      { id: "avisos", icon: "megaphone", tip: "Avisos", href: "#/avisos" },
      { id: "install", icon: "download", tip: "Instalar App", action: "install" },
      { id: "favoritos", icon: "bookmark", tip: "Favoritos", action: "favorites" },
      { id: "ajuda", icon: "help", tip: "Ajuda", action: "help" }
    ];
    return `
      <aside class="sidebar">
        ${logoHtml()}
        <nav class="nav">
          ${nav.map((n) => `<button class="nav-btn ${active === n.id ? "active" : ""}" ${n.href ? `data-href="${n.href}"` : `data-action="${n.action}"`} aria-label="${n.tip}">
            ${icon(n.icon)}<span class="tip">${n.tip}</span></button>`).join("")}
        </nav>
        <button class="nav-btn logout" data-action="logout" aria-label="Sair">${icon("logout")}<span class="tip">Sair</span></button>
      </aside>
      <div class="main">
        <header class="topbar">
          ${logoHtml("mobile-logo")}
          <div style="display:flex;align-items:center;gap:14px">
            <div class="search">
              ${icon("search")}
              <input id="search" type="search" placeholder="Buscar..." autocomplete="off">
              <div class="search-results" id="search-results" hidden></div>
            </div>
            <button class="avatar-btn" data-action="profile" aria-label="Perfil">${icon("user")}</button>
          </div>
        </header>
        ${preview ? `<div class="preview-bar">Pré-visualização do admin: progresso e favoritos não são salvos. <a href="/admin">Voltar ao painel</a></div>` : ""}
        <main class="content">${body}</main>
      </div>
      <button class="fab-top" id="fab-top" aria-label="Voltar ao topo">${icon("arrowUp")}</button>
      <button class="fab-ai" data-action="assistant" aria-label="Assistente">${icon("sparkles")}</button>`;
  }

  // ---------- Pages ----------
  function pageHome() {
    const mods = allModules();
    const done = mods.filter((x) => isDone(x.key)).length;
    const pct = mods.length ? Math.round((done / mods.length) * 100) : 0;

    let cont = state.last && findModule(state.last.p, state.last.m);
    if (!cont) cont = mods.find((x) => !isDone(x.key)) || mods[0];

    const heroStyle = D.hero.image ? `style="background-image:url('${esc(D.hero.image)}')"` : "";
    const continueHtml = cont ? `
      <button class="card-row" data-href="#/modulo/${cont.product.id}/${cont.module.id}">
        <div class="thumb">${coverHtml(cont.module, "sm")}</div>
        <div class="meta">
          <div class="eyebrow">Continue de onde parou</div>
          <strong>${esc(moduleLabel(cont.module))}</strong>
          <small>${esc(cont.module.title)} · ${esc(cont.product.title)}</small>
        </div>
        <span class="play">${icon("play")}</span>
      </button>` : "";

    return `
      <section class="hero ${D.hero.image ? "" : "no-image"}" ${heroStyle}>
        <div class="hero-inner">
          <span class="pill">${esc(D.hero.tag)}</span>
          <h1>${esc(D.hero.title)}</h1>
          <p>${esc(D.hero.subtitle)}</p>
        </div>
      </section>
      ${continueHtml}
      <div class="progress-card">
        <div class="progress-head">
          <span class="ico">${icon("trophy")}</span>
          <div class="meta"><strong>Seu Progresso</strong><small>${pct === 100 ? "Jornada concluída! 🎉" : "Continue sua jornada!"}</small></div>
          <div class="pct"><b>${pct}%</b><span>${done} de ${mods.length} módulos</span></div>
        </div>
        <div class="bar"><div style="width:${pct}%"></div></div>
      </div>

      <h2 class="section-title">${esc(D.labels.unlocked || "Conteúdos Liberados")}</h2>
      <div class="grid">
        ${D.products.length ? "" : `<p class="hint-empty">Você ainda não tem conteúdos liberados. Fale com o suporte se acabou de comprar.</p>`}
        ${D.products.map((p) => `
          <button class="p-card" data-href="#/produto/${p.id}">
            <div class="cover">${coverHtml(p)}</div>
            <div class="body"><div class="rule"></div><h3>${esc(p.title)}</h3></div>
          </button>`).join("")}
      </div>

      ${lockedItems().length ? `
      <h2 class="section-title">${esc(D.labels.upsells || "Achamos que você também pode gostar")}</h2>
      <div class="grid">
        ${lockedItems().map((u) => `
          <button class="p-card" data-action="locked" data-id="${u.id}">
            <div class="cover">${coverHtml(u)}<span class="lock-badge">${icon("lock")}</span></div>
            <div class="body"><div class="rule"></div><h3>${esc(u.title)}</h3></div>
          </button>`).join("")}
      </div>` : ""}`;
  }

  function pageProduct(pid) {
    const p = D.products.find((x) => x.id === pid);
    if (!p) return pageNotFound();
    return `
      <div class="page-head">
        <button class="back" data-href="#/" aria-label="Voltar">${icon("chevronLeft")}</button>
        <div class="meta"><h2>${esc(p.title)}</h2><small>Módulos do produto</small></div>
      </div>
      <div class="modules">
        ${p.modules.length ? "" : `<div class="empty-state"><p>Nenhum módulo por aqui ainda.</p><small>Novos conteúdos aparecem aqui assim que forem publicados.</small></div>`}
        ${p.modules.map((m) => {
          const key = modKey(p.id, m.id);
          return `
          <button class="m-card" data-href="#/modulo/${p.id}/${m.id}">
            <div class="cover">${coverHtml(m, "md")}${isDone(key) ? `<span class="done-badge">${icon("check")}Concluído</span>` : ""}</div>
            <div class="body">
              <span class="tag">Módulo</span>
              <div class="rule"></div>
              <h3>${esc(m.title)}</h3>
              ${m.description ? `<p>${esc(m.description)}</p>` : ""}
            </div>
          </button>`;
        }).join("")}
      </div>`;
  }

  // Converte links do YouTube/Vimeo em endereço de player; outros links de vídeo ficam como estão.
  function videoEmbed(url) {
    let m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return { kind: "iframe", src: `https://www.youtube.com/embed/${m[1]}?rel=0` };
    m = url.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?/);
    if (m) return { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ""}` };
    if (/\.(mp4|webm|m4v)(\?|$)/i.test(url)) return { kind: "video", src: url };
    if (/\.(mp3|m4a|ogg|wav)(\?|$)/i.test(url)) return { kind: "audio", src: url };
    return { kind: "iframe", src: url };
  }

  function moduleContent(m) {
    const c = m.content || {};
    const body = c.body ? `<div class="rich">${esc(c.body)}</div>` : "";
    if (c.type === "support") {
      return `${body}<div class="actions">
        ${D.app.support.whatsapp ? `<a class="btn btn-primary" href="${whatsappUrl()}" target="_blank" rel="noopener">${icon("whatsapp")}WhatsApp</a>` : ""}
        ${D.app.support.email ? `<a class="btn btn-ghost" href="mailto:${esc(D.app.support.email)}">${icon("mail")}E-mail</a>` : ""}
      </div>`;
    }
    if (c.type === "text" || c.type === "none") return body;
    if (c.type === "video" && c.url) {
      const v = videoEmbed(c.url);
      const player = v.kind === "video"
        ? `<video src="${esc(v.src)}" controls playsinline preload="metadata" style="width:100%;height:100%"></video>`
        : v.kind === "audio"
          ? `<audio src="${esc(v.src)}" controls preload="metadata" style="width:100%"></audio>`
          : `<iframe src="${esc(v.src)}" style="width:100%;height:100%;border:0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
      return v.kind === "audio"
        ? `<div style="margin-top:18px" data-open-content>${player}</div>${body}`
        : `<div class="player" data-open-content>${player}</div>${body}`;
    }
    if (c.url) {
      const label = c.buttonLabel || (c.type === "pdf" ? "Abrir material (PDF)" : "Acessar conteúdo");
      return `${body}<div class="actions"><a class="btn btn-primary" href="${esc(c.url)}" target="_blank" rel="noopener" data-open-content>${icon(c.type === "pdf" ? "file" : "external")}${esc(label)}</a></div>`;
    }
    return body || `<div class="notice">Este conteúdo estará disponível em breve.</div>`;
  }

  function pageModule(pid, mid) {
    const found = findModule(pid, mid);
    if (!found) return pageNotFound();
    const { product: p, module: m, key } = found;
    state.last = { p: pid, m: mid };
    saveState();

    const idx = p.modules.indexOf(m);
    const prev = p.modules[idx - 1];
    const next = p.modules[idx + 1];
    return `
      <div class="page-head">
        <button class="back" data-href="#/produto/${p.id}" aria-label="Voltar">${icon("chevronLeft")}</button>
        <div class="meta"><h2>${esc(p.title)}</h2><small>Módulo ${idx + 1} de ${p.modules.length}</small></div>
      </div>
      <div class="module-view">
        <div class="cover">${coverHtml(m, "lg")}</div>
        <div>
          <span class="tag">Módulo</span>
          <h1>${esc(m.title)}</h1>
          ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ""}
          ${moduleContent(m)}
          <div class="actions">
            <button class="btn ${isDone(key) ? "btn-success" : "btn-ghost"}" data-action="toggle-done" data-key="${key}">
              ${icon("check")}${isDone(key) ? "Concluído" : "Marcar como concluído"}
            </button>
            <button class="btn btn-ghost" data-action="toggle-fav" data-key="${key}">
              ${icon("bookmark")}${isFav(key) ? "Salvo" : "Salvar"}
            </button>
          </div>
          <div class="module-nav">
            ${prev ? `<button class="btn btn-ghost" data-href="#/modulo/${p.id}/${prev.id}">${icon("chevronLeft")}<span>Anterior</span></button>` : "<span></span>"}
            ${next ? `<button class="btn btn-primary" data-href="#/modulo/${p.id}/${next.id}"><span>Próximo</span>${icon("chevronRight")}</button>` : "<span></span>"}
          </div>
        </div>
      </div>`;
  }

  function pageFeed() {
    const posts = D.posts.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    return `
      <div class="feed">
        <div class="page-head">
          <span class="ico">${icon("megaphone")}</span>
          <div class="meta"><h2>Feed de Avisos</h2><small>Novidades e atualizações</small></div>
          <button class="icon-btn" data-action="refresh-feed" aria-label="Atualizar">${icon("refresh")}</button>
        </div>
        ${posts.length ? posts.map((post) => `
          <article class="post">
            <div class="post-head">
              <span class="post-avatar">${esc(post.author.trim().charAt(0).toUpperCase())}</span>
              <div><strong>${esc(post.author)}</strong><small>${timeAgo(post.date)}</small></div>
            </div>
            <h3>${esc(post.title)}</h3>
            <p>${esc(post.body)}</p>
          </article>`).join("") : `<div class="empty-state">${icon("megaphone")}<p>Nenhum aviso por enquanto.</p></div>`}
      </div>`;
  }

  function pageNotFound() {
    return `<div class="empty-state"><p>Página não encontrada.</p><small><a href="#/" style="color:var(--primary)">Voltar ao início</a></small></div>`;
  }

  // ---------- Router ----------
  function route() {
    const parts = (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean).map(decodeURIComponent);
    switch (parts[0]) {
      case undefined: return { active: "home", html: pageHome() };
      case "avisos": return { active: "avisos", html: pageFeed() };
      case "produto": return { active: "home", html: pageProduct(parts[1]) };
      case "modulo": return { active: "home", html: pageModule(parts[1], parts[2]) };
      default: return { active: "", html: pageNotFound() };
    }
  }

  function render() {
    if (!session) return renderLogin();
    const r = route();
    document.title = D.app.name;
    root.innerHTML = shell(r.active, r.html);
    bindShell();
  }

  function rerenderKeepScroll() {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  // ---------- Search ----------
  function searchIndex() {
    const items = [];
    D.products.forEach((p) => {
      items.push({ title: p.title, sub: "Produto", href: `#/produto/${p.id}`, item: p, text: p.title });
      p.modules.forEach((m) => items.push({
        title: moduleLabel(m), sub: p.title, href: `#/modulo/${p.id}/${m.id}`, item: m,
        text: [m.title, m.description, m.continueTitle, m.coverText].join(" ")
      }));
    });
    lockedItems().forEach((u) => items.push({ title: u.title, sub: "Conteúdo bloqueado", action: "locked", id: u.id, item: u, text: [u.title, u.coverText].join(" ") }));
    return items;
  }
  function searchFor(q) {
    const terms = norm(q).split(/\s+/).filter((t) => t.length > 1);
    if (!terms.length) return [];
    return searchIndex().filter((x) => terms.some((t) => norm(x.text).includes(t)));
  }

  // ---------- Modals ----------
  function openModal(html, cls) {
    modalRoot.innerHTML = `<div class="overlay ${cls || ""}" data-overlay>${html}</div>`;
    const ov = modalRoot.firstElementChild;
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closeModal();
      const close = e.target.closest("[data-close]");
      if (close) closeModal();
    });
    return ov;
  }
  function closeModal() { modalRoot.innerHTML = ""; }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  function openFavorites() {
    const favs = state.favorites.map((k) => { const [p, m] = k.split("/"); return findModule(p, m); }).filter(Boolean);
    const body = favs.length ? `<div class="fav-list">${favs.map((f) => `
        <div class="fav-item">
          <button style="display:flex;gap:10px;align-items:center;flex:1;text-align:left" data-go="#/modulo/${f.product.id}/${f.module.id}">
            <span class="thumb">${coverHtml(f.module, "sm")}</span>
            <span><strong>${esc(moduleLabel(f.module))}</strong><small>${esc(f.product.title)}</small></span>
          </button>
          <button class="rm" data-unfav="${f.key}" aria-label="Remover">${icon("trash")}</button>
        </div>`).join("")}</div>`
      : `<div class="empty-state">${icon("bookmark")}<p>Você ainda não possui módulos favoritos.</p><small>Acesse um módulo e clique em 'Salvar' para adicioná-lo aqui.</small></div>`;

    const ov = openModal(`
      <div class="modal" role="dialog" aria-label="Módulos Favoritos">
        <div class="modal-head">
          <span class="ico">${icon("bookmark")}</span>
          <h3>Módulos Favoritos</h3>
          <span class="count">${state.favorites.length} / ${MAX_FAVORITES}</span>
          <button class="modal-close" data-close aria-label="Fechar">${icon("x")}</button>
        </div>
        <div class="modal-body" style="padding:${favs.length ? "12px" : "0 20px"}">${body}</div>
      </div>`);
    ov.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go]");
      if (go) { closeModal(); location.hash = go.dataset.go; return; }
      const rm = e.target.closest("[data-unfav]");
      if (rm) { toggleFav(rm.dataset.unfav); openFavorites(); if (location.hash.startsWith("#/modulo")) rerenderKeepScroll(); }
    });
  }

  function whatsappUrl() {
    const s = D.app.support;
    return `https://wa.me/${encodeURIComponent(s.whatsapp)}?text=${encodeURIComponent(s.whatsappMessage || "")}`;
  }

  function openHelp() {
    openModal(`
      <div class="help-card" role="dialog" aria-label="Ajuda">
        <div class="help-head"><h3>Como posso te ajudar?</h3><button data-close aria-label="Fechar">${icon("x")}</button></div>
        <div class="help-body">
          <p>Escolha como prefere entrar em contato:</p>
          ${D.app.support.whatsapp ? `<a class="contact" href="${whatsappUrl()}" target="_blank" rel="noopener">
            <span class="ci" style="background:#22c55e">${icon("whatsapp")}</span>
            <span><strong>WhatsApp</strong><small>Atendimento rápido via chat</small></span>
          </a>` : ""}
          ${D.app.support.email ? `<a class="contact" href="mailto:${esc(D.app.support.email)}">
            <span class="ci" style="background:#3b82f6">${icon("mail")}</span>
            <span><strong>E-mail</strong><small>Envie uma mensagem detalhada</small></span>
          </a>` : ""}
        </div>
      </div>`, "help");
  }

  function openLocked(id) {
    const u = lockedItems().find((x) => x.id === id);
    if (!u) return;
    openModal(`
      <div class="modal" role="dialog">
        <div class="modal-head">
          <span class="ico">${icon("lock")}</span><h3>Conteúdo bloqueado</h3>
          <button class="modal-close" data-close aria-label="Fechar">${icon("x")}</button>
        </div>
        <div class="modal-body" style="display:flex;gap:16px;align-items:flex-start">
          <div style="width:96px;height:128px;border-radius:10px;overflow:hidden;flex:none">${coverHtml(u, "sm")}</div>
          <div>
            <strong style="font-family:var(--serif);font-size:16px">${esc(u.title)}</strong>
            <p style="font-size:12.5px;color:var(--muted);margin:8px 0 14px;line-height:1.6;white-space:pre-line">${esc(u.description || "Este conteúdo ainda não faz parte do seu acesso. Libere agora para continuar sua jornada.")}</p>
            ${u.buyUrl
              ? `<a class="btn btn-primary" href="${esc(u.buyUrl)}" target="_blank" rel="noopener">${esc(u.buyLabel || "Quero liberar")}</a>`
              : `<button class="btn btn-primary" data-close>Entendi</button>`}
          </div>
        </div>
      </div>`);
  }

  function openProfile() {
    const ov = openModal(`
      <div class="modal" role="dialog" aria-label="Perfil">
        <div class="modal-head">
          <span class="ico">${icon("user")}</span><h3>Meu perfil</h3>
          <button class="modal-close" data-close aria-label="Fechar">${icon("x")}</button>
        </div>
        <form class="modal-body" id="profile-form">
          <div class="field"><label for="pf-name">Nome</label><input id="pf-name" value="${esc(state.name)}" placeholder="Como quer ser chamado(a)?"></div>
          <div class="field"><label>E-mail</label><input value="${esc(session.email)}" disabled></div>
          <div style="display:flex;gap:10px;margin-top:6px">
            <button class="btn btn-primary" type="submit" style="flex:1">Salvar</button>
            <button class="btn btn-ghost" type="button" data-action-modal="logout">${icon("logout")}Sair</button>
          </div>
          <button class="btn btn-ghost btn-block" type="button" data-action-modal="reset" style="margin-top:10px;color:#b91c1c">Zerar meu progresso</button>
        </form>
      </div>`);
    ov.querySelector("#profile-form").addEventListener("submit", (e) => {
      e.preventDefault();
      state.name = ov.querySelector("#pf-name").value.trim();
      saveState();
      closeModal();
      toast("Perfil atualizado.");
    });
    ov.addEventListener("click", (e) => {
      const a = e.target.closest("[data-action-modal]");
      if (!a) return;
      if (a.dataset.actionModal === "logout") logout();
      if (a.dataset.actionModal === "reset" && confirm("Zerar todo o progresso e favoritos?")) {
        state.completed = []; state.favorites = []; state.last = null;
        saveState(); closeModal(); render(); toast("Progresso zerado.");
      }
    });
  }

  // ---------- PWA install ----------
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; toast("App instalado!"); });

  async function installApp() {
    if (window.matchMedia("(display-mode: standalone)").matches) return toast("O app já está instalado.");
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    openModal(`
      <div class="modal" role="dialog" aria-label="Instalar App">
        <div class="modal-head">
          <span class="ico">${icon("download")}</span><h3>Instalar App</h3>
          <button class="modal-close" data-close aria-label="Fechar">${icon("x")}</button>
        </div>
        <div class="modal-body">
          ${ios ? `<ol class="steps">
              <li>Toque no botão <b>Compartilhar</b> do Safari.</li>
              <li>Escolha <b>Adicionar à Tela de Início</b>.</li>
              <li>Confirme em <b>Adicionar</b>.</li></ol>`
            : `<ol class="steps">
              <li>Abra o menu do navegador (⋮).</li>
              <li>Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li>
              <li>Confirme a instalação.</li></ol>`}
        </div>
      </div>`);
  }

  // ---------- Assistant ----------
  const assistantMsgs = [];
  function assistantReply(q) {
    const n = norm(q);
    if (/suporte|ajuda|contato|whats|email|e-mail/.test(n)) {
      return { text: "Você pode falar com o suporte pelo WhatsApp ou por e-mail.", action: { label: "Abrir contatos", act: "help" } };
    }
    if (/progresso|conclu|terminei/.test(n)) {
      const mods = allModules();
      const done = mods.filter((x) => isDone(x.key)).length;
      return { text: `Você concluiu ${done} de ${mods.length} módulos. Continue sua jornada! ✨` };
    }
    if (/instal|baixar|celular/.test(n)) return { text: "Para instalar, use o botão de download na barra lateral.", action: { label: "Instalar app", act: "install" } };
    const hits = searchFor(q).filter((x) => x.href).slice(0, 3);
    if (hits.length) return { text: "Encontrei estes conteúdos para você:", links: hits };
    return { text: "Não encontrei nada sobre isso. Tente outras palavras ou fale com o suporte.", action: { label: "Falar com o suporte", act: "help" } };
  }
  function openAssistant() {
    if (!assistantMsgs.length) {
      const hi = state.name ? `Olá, ${state.name}!` : "Olá!";
      assistantMsgs.push({ from: "bot", text: `${hi} Sou o assistente do ${D.app.shortName || D.app.name}. Pergunte sobre os conteúdos, seu progresso ou suporte.` });
    }
    const ov = openModal(`
      <div class="assistant-card" role="dialog" aria-label="Assistente">
        <div class="assistant-head">${icon("sparkles")}<h3>Assistente</h3><button data-close aria-label="Fechar">${icon("x")}</button></div>
        <div class="assistant-msgs" id="a-msgs"></div>
        <form class="assistant-form" id="a-form">
          <input id="a-input" placeholder="Digite sua pergunta..." autocomplete="off">
          <button type="submit" aria-label="Enviar">${icon("send")}</button>
        </form>
      </div>`, "assistant");
    const box = ov.querySelector("#a-msgs");
    const draw = () => {
      box.innerHTML = assistantMsgs.map((m) => `<div class="msg ${m.from}">${esc(m.text)}
        ${(m.links || []).map((l) => `<button data-go="${l.href}">→ ${esc(l.title)}</button>`).join("")}
        ${m.action ? `<button data-act="${m.action.act}">→ ${esc(m.action.label)}</button>` : ""}</div>`).join("");
      box.scrollTop = box.scrollHeight;
    };
    draw();
    const input = ov.querySelector("#a-input");
    input.focus();
    ov.querySelector("#a-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      assistantMsgs.push({ from: "me", text: q });
      assistantMsgs.push(Object.assign({ from: "bot" }, assistantReply(q)));
      input.value = "";
      draw();
    });
    box.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go]");
      if (go) { closeModal(); location.hash = go.dataset.go; }
      const act = e.target.closest("[data-act]");
      if (act) { closeModal(); runAction(act.dataset.act); }
    });
  }

  // ---------- Events ----------
  function runAction(action, el) {
    switch (action) {
      case "install": return installApp();
      case "favorites": return openFavorites();
      case "help": return openHelp();
      case "logout": return logout();
      case "profile": return openProfile();
      case "assistant": return openAssistant();
      case "locked": return openLocked(el.dataset.id);
      case "toggle-done": {
        const done = !isDone(el.dataset.key);
        setDone(el.dataset.key, done);
        toast(done ? "Módulo concluído! ✨" : "Módulo marcado como não concluído.");
        return rerenderKeepScroll();
      }
      case "toggle-fav": {
        const saved = toggleFav(el.dataset.key);
        if (saved) toast("Módulo salvo nos favoritos.");
        else if (!isFav(el.dataset.key)) toast("Removido dos favoritos.");
        return rerenderKeepScroll();
      }
      case "refresh-feed": {
        el.classList.remove("spin"); void el.offsetWidth; el.classList.add("spin");
        return setTimeout(rerenderKeepScroll, 600);
      }
    }
  }

  root.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-href]");
    if (nav) { e.preventDefault(); location.hash = nav.dataset.href; return; }
    const act = e.target.closest("[data-action]");
    if (act) { runAction(act.dataset.action, act); return; }
    const content = e.target.closest("[data-open-content]");
    if (content) {
      const m = location.hash.match(/^#\/modulo\/([^/]+)\/([^/]+)/);
      if (m && !isDone(modKey(m[1], m[2]))) { setDone(modKey(m[1], m[2]), true); setTimeout(rerenderKeepScroll, 300); }
    }
  });

  function bindShell() {
    const input = document.getElementById("search");
    const results = document.getElementById("search-results");
    input.addEventListener("input", () => {
      const q = input.value.trim();
      if (!q) { results.hidden = true; return; }
      const hits = searchFor(q).slice(0, 8);
      results.innerHTML = hits.length ? hits.map((h) => `
        <button ${h.href ? `data-href="${h.href}"` : `data-action="${h.action}" data-id="${h.id}"`}>
          <span class="thumb">${coverHtml(h.item, "sm")}</span>
          <span><strong>${esc(h.title)}</strong><small>${esc(h.sub)}</small></span>
        </button>`).join("") : `<div class="empty">Nenhum resultado para "${esc(q)}".</div>`;
      results.hidden = false;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { input.value = ""; results.hidden = true; input.blur(); }
      if (e.key === "Enter") { const first = results.querySelector("button"); if (first) first.click(); }
    });
    onScroll();
  }

  document.addEventListener("click", (e) => {
    const results = document.getElementById("search-results");
    if (results && !e.target.closest(".search")) results.hidden = true;
  });

  function onScroll() {
    const fab = document.getElementById("fab-top");
    if (fab) fab.classList.toggle("show", window.scrollY > 300);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  root.addEventListener("click", (e) => { if (e.target.closest("#fab-top")) window.scrollTo({ top: 0, behavior: "smooth" }); });

  window.addEventListener("hashchange", () => { closeModal(); render(); window.scrollTo(0, 0); });

  // ---------- Boot ----------
  async function boot() {
    try {
      const cfg = await api("GET", "api/config");
      publicApp = Object.assign({}, EMPTY_APP, cfg.app);
      D.app = publicApp;
      applyBranding(publicApp);
    } catch (err) {
      return renderLogin(err.message);
    }
    try {
      const me = await api("GET", "api/me");
      const data = await api("GET", "api/content");
      D = Object.assign({ hero: {}, labels: {}, products: [], lockedProducts: [], upsells: [], posts: [] }, data);
      D.app = Object.assign({}, EMPTY_APP, data.app);
      applyBranding(D.app);
      preview = !!me.preview;
      session = { email: me.email };
      state = Object.assign({ completed: [], favorites: [], last: null, name: me.name || "" }, me.state || {});
      render();
    } catch (err) {
      session = null;
      renderLogin(err.status === 401 ? "" : err.message);
    }
  }
  boot();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
