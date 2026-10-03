(function () {
  "use strict";

  let APP = { name: "", logo: "", primaryColor: "#5d3b78" };
  const root = document.getElementById("root");
  document.body.classList.add("admin");

  // ---------- Helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const fmtDate = (ts) => ts ? new Date(ts * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

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
    if (res.status === 401 && !url.endsWith("/login")) { renderLogin("Sua sessão expirou. Entre novamente."); throw new Error("401"); }
    if (!res.ok) throw new Error((data && data.error) || "Erro de conexão.");
    return data;
  }

  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function modal(html) {
    const wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) close(); });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    });
    return { el: wrap, close };
  }

  const X_ICON = '<svg class="i" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  const LOTUS = '<svg class="i" viewBox="0 0 24 24"><path d="M12 20c-4 0-8-2-9-6 3 0 6 1 9 4 3-3 6-4 9-4-1 4-5 6-9 6Z"/><path d="M12 18c-2-2-3-5-3-8 1 1 2 1.5 3 3 1-1.5 2-2 3-3 0 3-1 6-3 8Z"/><path d="M12 13c-1-2-1-5 0-8 1 3 1 6 0 8Z"/></svg>';
  const logoHtml = () => `<div class="logo">${APP.logo ? `<img src="${esc(APP.logo)}" alt="">` : LOTUS}</div>`;

  function applyBrand() {
    document.title = `Painel Admin · ${APP.name || ""}`;
    if (/^#[0-9a-f]{6}$/i.test(APP.primaryColor || "")) document.documentElement.style.setProperty("--primary", APP.primaryColor);
  }

  // ---------- Login ----------
  function renderLogin(error) {
    root.innerHTML = `
      <div class="login">
        <form class="login-card" id="f" novalidate>
          ${logoHtml()}
          <h1>Painel Admin</h1>
          <p>${esc(APP.name)} · acesso restrito</p>
          <div class="field">
            <label for="pw">Senha</label>
            <input id="pw" type="password" autocomplete="current-password" required>
          </div>
          <div class="login-error" id="err">${esc(error || "")}</div>
          <button class="btn btn-primary btn-block" id="b" type="submit">Entrar</button>
        </form>
      </div>`;
    const pw = document.getElementById("pw");
    pw.focus();
    document.getElementById("f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = document.getElementById("b");
      b.disabled = true;
      try {
        await api("POST", "/api/admin/login", { password: pw.value });
        renderShell();
      } catch (err) {
        document.getElementById("err").textContent = err.message;
        b.disabled = false;
        pw.select();
      }
    });
  }

  // ---------- Shell ----------
  const TABS = [
    { id: "membros", label: "Membros" },
    { id: "conteudo", label: "Conteúdo" },
    { id: "aparencia", label: "Aparência" },
    { id: "avisos", label: "Avisos" },
    { id: "cakto", label: "Integração Cakto" },
    { id: "eventos", label: "Eventos" },
    { id: "conta", label: "Conta" }
  ];
  let tab = (location.hash.replace("#", "") || "membros");
  if (!TABS.some((t) => t.id === tab)) tab = "membros";

  function renderShell() {
    applyBrand();
    root.innerHTML = `
      <header class="adm-header">
        <div class="adm-header-inner">
          ${logoHtml()}
          <h1>Painel Admin<small>${esc(APP.name)}</small></h1>
          <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">Abrir app</a>
          <button class="btn btn-ghost btn-sm" id="out">Sair</button>
        </div>
        <nav class="adm-tabs">${TABS.map((t) => `<button class="adm-tab ${t.id === tab ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("")}</nav>
      </header>
      <main class="adm-main" id="view"></main>`;
    const activeTab = root.querySelector(".adm-tab.active");
    if (activeTab) activeTab.parentElement.scrollLeft = activeTab.offsetLeft - 16;
    root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      tab = b.dataset.tab;
      history.replaceState(null, "", `#${tab}`);
      renderShell();
    }));
    document.getElementById("out").addEventListener("click", async () => {
      await api("POST", "/api/admin/logout").catch(() => {});
      renderLogin();
    });
    const views = {
      membros: viewMembers, conteudo: viewContent, aparencia: viewAppearance, avisos: viewPosts,
      cakto: viewCakto, eventos: viewEvents, conta: viewAccount
    };
    Promise.resolve().then(() => views[tab]()).catch((err) => {
      console.error(err);
      const v = document.getElementById("view");
      if (v && err.message !== "401") v.innerHTML = errorBox("Ocorreu um erro ao montar esta tela: " + err.message);
    });
  }

  function errorBox(message) {
    setTimeout(() => {
      const b = document.querySelector("[data-retry-view]");
      if (b) b.onclick = () => renderShell();
    });
    return `<div class="panel"><h2>Não foi possível carregar esta aba</h2>
      <p>${esc(message)}</p><div class="row"><button class="btn btn-primary" data-retry-view>Tentar de novo</button></div></div>`;
  }

  // =====================================================================
  // Conteúdo do app (produtos, módulos, ofertas, aparência, avisos)
  // =====================================================================
  let content = null;
  let rev = null;
  let openProductId = null;

  const uid = () => Math.random().toString(36).slice(2, 10);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
  const TYPE_LABELS = { pdf: "PDF / arquivo", link: "Link externo", video: "Vídeo / áudio", text: "Texto", support: "Suporte", none: "Sem material" };

  async function loadContent(force) {
    if (content && !force) return true;
    try {
      const r = await api("GET", "/api/admin/content");
      content = r.content;
      rev = r.rev;
      return true;
    } catch (e) {
      if (e.message !== "401") document.getElementById("view").innerHTML = `<p class="hint">${esc(e.message)}</p>`;
      return false;
    }
  }

  // Aplica uma alteração numa cópia, salva no servidor e só então atualiza a tela.
  async function commit(mutate, okMessage) {
    const draft = clone(content);
    mutate(draft);
    try {
      const r = await api("PUT", "/api/admin/content", { content: draft, rev });
      content = r.content;
      rev = r.rev;
      APP = Object.assign(APP, content.app);
      toast(okMessage || "Salvo. Já está no app.");
      return true;
    } catch (e) {
      if (e.message !== "401") toast(e.message);
      return false;
    }
  }

  const MIME_BY_EXT = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
    pdf: "application/pdf", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", zip: "application/zip",
    epub: "application/epub+zip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  };

  // Envia o corpo com barra de progresso e devolve a resposta em JSON.
  function sendWithProgress(method, url, headers, file, onProgress, ownServer) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);
      Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (err) { /* sem JSON */ }
        if (ownServer && xhr.status === 401) { renderLogin("Sua sessão expirou. Entre novamente."); return reject(new Error("401")); }
        if (xhr.status >= 200 && xhr.status < 300 && data) return resolve(data);
        const detail = data && (typeof data.error === "string" ? data.error : data.error && data.error.message);
        reject(new Error(ownServer ? (detail || "Falha no envio.") : `O Vercel Blob recusou o arquivo${detail ? `: ${detail}` : "."}`));
      };
      xhr.onerror = () => reject(new Error("Falha de conexão no envio. Verifique sua internet."));
      xhr.send(file);
    });
  }

  // 1) pede autorização ao servidor; 2) envia (para a pasta local ou direto para o Vercel Blob);
  // 3) no Blob, confirma o envio para o servidor registrar o arquivo.
  async function uploadFile(file, onProgress) {
    const start = await api("POST", "/api/admin/upload/start", { filename: file.name, size: file.size });
    if (start.mode === "local") {
      return sendWithProgress("POST", "/api/admin/upload", {
        "X-Requested-With": "fetch",
        "X-Filename": encodeURIComponent(file.name),
        "Content-Type": "application/octet-stream"
      }, file, onProgress, true);
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const contentType = file.type || MIME_BY_EXT[ext] || "application/octet-stream";
    const blob = await sendWithProgress("PUT", start.uploadUrl, {
      "authorization": `Bearer ${start.token}`,
      "x-api-version": start.apiVersion,
      "x-vercel-blob-access": start.access,
      "x-content-type": contentType,
      "x-add-random-suffix": "0"
    }, file, onProgress, false);
    return api("POST", "/api/admin/upload/finish", {
      name: start.name, url: blob.url, filename: file.name, size: file.size, contentType
    });
  }

  const isImageUrl = (u) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u || "");

  function miniCover(item, cls) {
    if (item.cover) return `<div class="thumb-mini ${cls || ""}"><img src="${esc(item.cover)}" alt=""></div>`;
    const [a, b, c] = item.theme || ["#2a1740", "#5d3b78", "#e8c08a"];
    return `<div class="thumb-mini ${cls || ""}" style="background:linear-gradient(170deg, ${b}, ${a} 70%);color:${c}"><span>${esc(item.coverText || item.title || "")}</span></div>`;
  }

  function mediaPreview(url) {
    if (!url) return `<span class="media-empty">Sem arquivo</span>`;
    if (isImageUrl(url)) return `<img src="${esc(url)}" alt="">`;
    const name = url.split("/").pop().split("?")[0];
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="media-file">📎 ${esc(name.length > 22 ? name.slice(0, 20) + "…" : name)}</a>`;
  }

  // Campo de mídia: colar link OU enviar arquivo (com barra de progresso).
  function mediaField(name, label, value, accept, hint) {
    return `
      <div class="field media-field" data-media>
        <label>${label}</label>
        <div class="media-row">
          <div class="media-prev">${mediaPreview(value)}</div>
          <div class="media-ctrl">
            <input class="input" name="${name}" value="${esc(value || "")}" placeholder="Cole um link (https://...) ou envie um arquivo">
            <div class="media-actions">
              <label class="btn btn-ghost btn-sm">Enviar arquivo<input type="file" accept="${accept}" hidden></label>
              <button type="button" class="btn btn-ghost btn-sm" data-clear>Remover</button>
              <span class="up-status"></span>
            </div>
            ${hint ? `<small class="hint">${hint}</small>` : ""}
          </div>
        </div>
      </div>`;
  }

  function bindMedia(container) {
    container.querySelectorAll("[data-media]").forEach((box) => {
      const input = box.querySelector("input.input");
      const prev = box.querySelector(".media-prev");
      const status = box.querySelector(".up-status");
      const file = box.querySelector("input[type=file]");
      input.addEventListener("input", () => { prev.innerHTML = mediaPreview(input.value.trim()); });
      box.querySelector("[data-clear]").addEventListener("click", () => { input.value = ""; prev.innerHTML = mediaPreview(""); });
      file.addEventListener("change", async () => {
        const f = file.files[0];
        if (!f) return;
        status.textContent = "Enviando 0%";
        box.classList.add("busy");
        try {
          const r = await uploadFile(f, (p) => { status.textContent = `Enviando ${p}%`; });
          input.value = r.url;
          prev.innerHTML = mediaPreview(r.url);
          status.textContent = "Enviado ✓";
        } catch (e) {
          status.textContent = "";
          if (e.message !== "401") toast(e.message);
        } finally {
          box.classList.remove("busy");
          file.value = "";
        }
      });
    });
  }

  function themeField(theme) {
    const t = theme || ["#2a1740", "#5d3b78", "#e8c08a"];
    return `
      <div class="field">
        <label>Cores da capa provisória <small style="font-weight:400;color:var(--muted)">(usadas quando não há imagem)</small></label>
        <div class="colors">
          <label><input type="color" name="theme0" value="${esc(t[0])}"> Fundo</label>
          <label><input type="color" name="theme1" value="${esc(t[1])}"> Brilho</label>
          <label><input type="color" name="theme2" value="${esc(t[2])}"> Texto</label>
        </div>
      </div>`;
  }

  const formValues = (form) => {
    const out = {};
    form.querySelectorAll("[name]").forEach((el) => { out[el.name] = el.type === "checkbox" ? el.checked : el.value.trim(); });
    return out;
  };
  const themeFrom = (v) => [v.theme0, v.theme1, v.theme2];
  const busy = (form, on) => form.querySelectorAll("button[type=submit]").forEach((b) => { b.disabled = on; });
  const uploading = (form) => form.querySelector("[data-media].busy");

  // Abre um formulário em modal; onSave recebe os valores e retorna true para fechar.
  function formModal(title, bodyHtml, onSave, wide) {
    const m = modal(`
      <div class="modal ${wide ? "xl" : "wide"}" role="dialog">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" data-close aria-label="Fechar">${X_ICON}</button></div>
        <form class="modal-body form-scroll" novalidate>${bodyHtml}
          <div class="form-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
            <button type="submit" class="btn btn-primary">Salvar</button>
          </div>
        </form>
      </div>`);
    const form = m.el.querySelector("form");
    bindMedia(form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (uploading(form)) return toast("Aguarde o envio do arquivo terminar.");
      busy(form, true);
      const ok = await onSave(formValues(form), form);
      busy(form, false);
      if (ok) m.close();
    });
    const first = form.querySelector("input:not([type=hidden]):not([type=file]), textarea");
    if (first) first.focus();
    return { m, form };
  }

  function move(list, index, delta) {
    const j = index + delta;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
  }

  const rowActions = (kind, i, n, extra) => `
    <div class="acts">
      ${extra || ""}
      <button class="btn btn-ghost btn-sm" data-act="edit-${kind}" data-i="${i}">Editar</button>
      <button class="btn btn-ghost btn-sm icon-only" data-act="up-${kind}" data-i="${i}" ${i === 0 ? "disabled" : ""} title="Subir">↑</button>
      <button class="btn btn-ghost btn-sm icon-only" data-act="down-${kind}" data-i="${i}" ${i === n - 1 ? "disabled" : ""} title="Descer">↓</button>
      <button class="btn btn-danger btn-sm" data-act="del-${kind}" data-i="${i}">Excluir</button>
    </div>`;

  // ---------- Aba Conteúdo ----------
  async function viewContent() {
    if (!(await loadContent())) return;
    const view = document.getElementById("view");
    const pIndex = content.products.findIndex((p) => p.id === openProductId);
    if (pIndex >= 0) return viewProduct(pIndex);
    openProductId = null;

    view.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div><h2>Produtos liberados</h2><p class="hint" style="margin:0">Aparecem em “${esc(content.labels.unlocked)}” para todos os membros. Clique em <b>Módulos</b> para editar o conteúdo de cada produto.</p></div>
          <button class="btn btn-primary" data-act="new-product">+ Novo produto</button>
        </div>
        <div class="list">
          ${content.products.length ? content.products.map((p, i) => `
            <div class="list-row">
              ${miniCover(p)}
              <div class="grow"><strong>${esc(p.title)}</strong><small>${p.modules.length} módulo(s)</small></div>
              ${rowActions("product", i, content.products.length, `<button class="btn btn-primary btn-sm" data-act="open-product" data-i="${i}">Módulos</button>`)}
            </div>`).join("") : `<p class="empty-row">Nenhum produto. Crie o primeiro em “+ Novo produto”.</p>`}
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>Ofertas bloqueadas</h2><p class="hint" style="margin:0">Aparecem com cadeado em “${esc(content.labels.upsells)}”. Ao clicar, o membro vê a descrição e o botão de compra.</p></div>
          <button class="btn btn-primary" data-act="new-upsell">+ Nova oferta</button>
        </div>
        <div class="list">
          ${content.upsells.length ? content.upsells.map((u, i) => `
            <div class="list-row">
              ${miniCover(u)}
              <div class="grow"><strong>${esc(u.title)}</strong><small>${u.buyUrl ? "Com link de compra" : "Sem link de compra"}</small></div>
              ${rowActions("upsell", i, content.upsells.length)}
            </div>`).join("") : `<p class="empty-row">Nenhuma oferta. A seção fica escondida no app enquanto estiver vazia.</p>`}
        </div>
      </div>`;

    view.onclick = async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || b.disabled) return;
      const i = Number(b.dataset.i);
      switch (b.dataset.act) {
        case "new-product": return editProduct(-1);
        case "open-product": openProductId = content.products[i].id; return viewContent();
        case "edit-product": return editProduct(i);
        case "up-product": case "down-product":
          if (await commit((d) => move(d.products, i, b.dataset.act.startsWith("up") ? -1 : 1), "Ordem atualizada.")) viewContent();
          return;
        case "del-product":
          if (!confirm(`Excluir o produto “${content.products[i].title}” e todos os ${content.products[i].modules.length} módulo(s) dele?`)) return;
          if (await commit((d) => d.products.splice(i, 1), "Produto excluído.")) viewContent();
          return;
        case "new-upsell": return editUpsell(-1);
        case "edit-upsell": return editUpsell(i);
        case "up-upsell": case "down-upsell":
          if (await commit((d) => move(d.upsells, i, b.dataset.act.startsWith("up") ? -1 : 1), "Ordem atualizada.")) viewContent();
          return;
        case "del-upsell":
          if (!confirm(`Excluir a oferta “${content.upsells[i].title}”?`)) return;
          if (await commit((d) => d.upsells.splice(i, 1), "Oferta excluída.")) viewContent();
          return;
      }
    };
  }

  function editProduct(i) {
    const p = i >= 0 ? content.products[i]
      : { title: "", cover: "", coverText: "", theme: null, caktoIds: [], buyUrl: "", buyLabel: "", lockedDescription: "" };
    formModal(i >= 0 ? "Editar produto" : "Novo produto", `
      <div class="form-section">Produto</div>
      <div class="field"><label>Nome do produto *</label><input class="input" name="title" value="${esc(p.title)}" required></div>
      ${mediaField("cover", "Capa (formato retrato, 3:4)", p.cover, IMAGE_ACCEPT, "Tamanho sugerido: 600 × 800 px.")}
      <div class="field"><label>Texto da capa provisória</label><input class="input" name="coverText" value="${esc(p.coverText)}" placeholder="Usado só quando não há imagem"></div>
      ${themeField(p.theme)}

      <div class="form-section">Venda e acesso</div>
      <div class="field">
        <label>Produto(s) na Cakto que liberam este produto</label>
        <textarea class="textarea" name="caktoIds" style="min-height:64px" placeholder="ID ou nome exato do produto na Cakto, um por linha">${esc((p.caktoIds || []).join("\n"))}</textarea>
        <small class="hint">Preenchido automaticamente quando você vincula em <b>Integração Cakto → Produtos da Cakto</b>. Também dá para digitar o ID ou nome exato aqui.</small>
      </div>
      <p class="hint" style="margin:-4px 0 12px">Para quem <b>não</b> tem acesso, o produto aparece com cadeado:</p>
      <div class="grid2">
        <div class="field"><label>Link de compra (checkout)</label><input class="input" name="buyUrl" value="${esc(p.buyUrl)}" placeholder="https://pay.cakto.com.br/..."></div>
        <div class="field"><label>Texto do botão</label><input class="input" name="buyLabel" value="${esc(p.buyLabel)}" placeholder="Quero liberar"></div>
      </div>
      <div class="field"><label>Descrição para quem não tem acesso</label><textarea class="textarea" name="lockedDescription" style="min-height:64px">${esc(p.lockedDescription)}</textarea></div>`, async (v) => {
      if (!v.title) { toast("Informe o nome do produto."); return false; }
      if (v.buyUrl && !/^https?:\/\//i.test(v.buyUrl)) { toast("O link de compra precisa começar com https://"); return false; }
      const data = {
        title: v.title, cover: v.cover, coverText: v.coverText, theme: themeFrom(v),
        caktoIds: v.caktoIds.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean),
        buyUrl: v.buyUrl, buyLabel: v.buyLabel, lockedDescription: v.lockedDescription
      };
      const ok = await commit((d) => {
        if (i >= 0) Object.assign(d.products[i], data);
        else d.products.push(Object.assign({ id: uid(), modules: [] }, data));
      }, i >= 0 ? "Produto atualizado." : "Produto criado.");
      if (ok) viewContent();
      return ok;
    });
  }

  function editUpsell(i) {
    const u = i >= 0 ? content.upsells[i] : { title: "", description: "", cover: "", coverText: "", theme: null, buyUrl: "", buyLabel: "" };
    formModal(i >= 0 ? "Editar oferta" : "Nova oferta", `
      <div class="field"><label>Nome da oferta *</label><input class="input" name="title" value="${esc(u.title)}" required></div>
      <div class="field"><label>Descrição (aparece ao clicar)</label><textarea class="textarea" name="description" placeholder="Ex.: Libere agora mais de 50 receitas...">${esc(u.description)}</textarea></div>
      <div class="grid2">
        <div class="field"><label>Link de compra (checkout)</label><input class="input" name="buyUrl" value="${esc(u.buyUrl)}" placeholder="https://pay.cakto.com.br/..."></div>
        <div class="field"><label>Texto do botão</label><input class="input" name="buyLabel" value="${esc(u.buyLabel)}" placeholder="Quero liberar"></div>
      </div>
      ${mediaField("cover", "Capa (formato retrato, 3:4)", u.cover, IMAGE_ACCEPT, "Tamanho sugerido: 600 × 800 px.")}
      <div class="field"><label>Texto da capa provisória</label><input class="input" name="coverText" value="${esc(u.coverText)}"></div>
      ${themeField(u.theme)}`, async (v) => {
      if (!v.title) { toast("Informe o nome da oferta."); return false; }
      if (v.buyUrl && !/^https?:\/\//i.test(v.buyUrl)) { toast("O link de compra precisa começar com https://"); return false; }
      const data = { title: v.title, description: v.description, buyUrl: v.buyUrl, buyLabel: v.buyLabel, cover: v.cover, coverText: v.coverText, theme: themeFrom(v) };
      const ok = await commit((d) => {
        if (i >= 0) Object.assign(d.upsells[i], data);
        else d.upsells.push(Object.assign({ id: uid() }, data));
      }, i >= 0 ? "Oferta atualizada." : "Oferta criada.");
      if (ok) viewContent();
      return ok;
    });
  }

  // ---------- Módulos de um produto ----------
  function viewProduct(pi) {
    const p = content.products[pi];
    const view = document.getElementById("view");
    view.innerHTML = `
      <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:14px">← Todos os produtos</button>
      <div class="panel">
        <div class="panel-head">
          <div style="display:flex;gap:14px;align-items:center">
            ${miniCover(p, "lg")}
            <div><h2 style="font-size:18px">${esc(p.title)}</h2><p class="hint" style="margin:0">${p.modules.length} módulo(s) · a ordem abaixo é a ordem no app</p></div>
          </div>
          <div class="acts">
            <button class="btn btn-ghost" data-act="edit-this">Editar produto</button>
            <button class="btn btn-primary" data-act="new-module">+ Novo módulo</button>
          </div>
        </div>
        <div class="list">
          ${p.modules.length ? p.modules.map((m, i) => `
            <div class="list-row">
              ${miniCover(m)}
              <div class="grow">
                <strong>${esc(m.title)}</strong>
                <small>${esc(m.description || m.continueTitle || "")}</small>
                <div style="margin-top:4px">
                  <span class="badge info">${TYPE_LABELS[m.content.type] || m.content.type}</span>
                  ${["pdf", "link", "video"].includes(m.content.type) && !m.content.url ? '<span class="badge off">Falta o material</span>' : ""}
                </div>
              </div>
              ${rowActions("module", i, p.modules.length, `<button class="btn btn-ghost btn-sm" data-act="dup-module" data-i="${i}">Duplicar</button>`)}
            </div>`).join("") : `<p class="empty-row">Este produto ainda não tem módulos. Clique em “+ Novo módulo”.</p>`}
        </div>
      </div>`;

    view.onclick = async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || b.disabled) return;
      const i = Number(b.dataset.i);
      const idx = () => content.products.findIndex((x) => x.id === p.id);
      switch (b.dataset.act) {
        case "back": openProductId = null; return viewContent();
        case "edit-this": return editProduct(idx());
        case "new-module": return editModule(idx(), -1);
        case "edit-module": return editModule(idx(), i);
        case "dup-module":
          if (await commit((d) => {
            const list = d.products[idx()].modules;
            const copy = clone(list[i]);
            copy.id = uid();
            copy.title = `${copy.title} (cópia)`;
            list.splice(i + 1, 0, copy);
          }, "Módulo duplicado.")) viewContent();
          return;
        case "up-module": case "down-module":
          if (await commit((d) => move(d.products[idx()].modules, i, b.dataset.act.startsWith("up") ? -1 : 1), "Ordem atualizada.")) viewContent();
          return;
        case "del-module":
          if (!confirm(`Excluir o módulo “${p.modules[i].title}”?`)) return;
          if (await commit((d) => d.products[idx()].modules.splice(i, 1), "Módulo excluído.")) viewContent();
          return;
      }
    };
  }

  function editModule(pi, i) {
    const m = i >= 0 ? content.products[pi].modules[i]
      : { title: "", continueTitle: "", description: "", cover: "", coverText: "", theme: null, content: { type: "pdf", url: "", body: "", buttonLabel: "" } };
    const c = m.content;
    const { form } = formModal(i >= 0 ? "Editar módulo" : "Novo módulo", `
      <div class="form-section">Informações</div>
      <div class="field"><label>Título do módulo *</label><input class="input" name="title" value="${esc(m.title)}" required></div>
      <div class="field"><label>Descrição curta</label><textarea class="textarea" name="description" style="min-height:64px">${esc(m.description)}</textarea></div>
      <div class="field"><label>Nome em “Continue de onde parou” <small style="font-weight:400;color:var(--muted)">(opcional)</small></label><input class="input" name="continueTitle" value="${esc(m.continueTitle)}"></div>

      <div class="form-section">Capa</div>
      ${mediaField("cover", "Imagem da capa (retrato, 3:4)", m.cover, IMAGE_ACCEPT, "Tamanho sugerido: 600 × 800 px.")}
      <div class="field"><label>Texto da capa provisória</label><input class="input" name="coverText" value="${esc(m.coverText)}"></div>
      ${themeField(m.theme)}

      <div class="form-section">Material do módulo</div>
      <div class="field">
        <label>Tipo de material</label>
        <select class="select" name="type" style="width:100%">
          ${Object.entries(TYPE_LABELS).map(([k, l]) => `<option value="${k}" ${c.type === k ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <div data-show="pdf">${mediaField("url_pdf", "Arquivo", c.type === "pdf" ? c.url : "", ".pdf,.zip,.epub,.docx,.xlsx,.pptx,.mp3,.m4a", "Envie o PDF (ou outro arquivo) ou cole um link do Google Drive/Dropbox. Arquivos enviados só abrem para membros.")}</div>
      <div data-show="video">${mediaField("url_video", "Vídeo ou áudio", c.type === "video" ? c.url : "", ".mp4,.mp3,.m4a", "Cole o link do YouTube, Vimeo ou Panda — ou envie um MP4/MP3.")}</div>
      <div data-show="link"><div class="field"><label>Link</label><input class="input" name="url_link" value="${esc(c.type === "link" ? c.url : "")}" placeholder="https://..."></div></div>
      <div data-show="pdf link"><div class="field"><label>Texto do botão <small style="font-weight:400;color:var(--muted)">(opcional)</small></label><input class="input" name="buttonLabel" value="${esc(c.buttonLabel)}" placeholder="Abrir material"></div></div>
      <div data-show="pdf link video text support none"><div class="field"><label data-body-label>Texto do módulo <small style="font-weight:400;color:var(--muted)">(opcional)</small></label><textarea class="textarea" name="body" style="min-height:120px" placeholder="Instruções, explicação, passo a passo...">${esc(c.body)}</textarea></div></div>
      <p class="hint" data-show="support">Mostra os botões de WhatsApp e e-mail configurados em <b>Aparência → Suporte</b>.</p>`, async (v) => {
      if (!v.title) { toast("Informe o título do módulo."); return false; }
      const url = v.type === "pdf" ? v.url_pdf : v.type === "video" ? v.url_video : v.type === "link" ? v.url_link : "";
      if (url && !/^(https?:\/\/|\/uploads\/)/i.test(url)) { toast("O link precisa começar com https://"); return false; }
      if (v.type === "text" && !v.body) { toast("Escreva o texto do módulo."); return false; }
      const data = {
        title: v.title, description: v.description, continueTitle: v.continueTitle,
        cover: v.cover, coverText: v.coverText, theme: themeFrom(v),
        content: { type: v.type, url, body: v.body, buttonLabel: v.buttonLabel }
      };
      const ok = await commit((d) => {
        const list = d.products[pi].modules;
        if (i >= 0) Object.assign(list[i], data);
        else list.push(Object.assign({ id: uid() }, data));
      }, i >= 0 ? "Módulo atualizado." : "Módulo criado.");
      if (ok) viewContent();
      return ok;
    }, true);

    const select = form.querySelector("select[name=type]");
    const sync = () => {
      form.querySelectorAll("[data-show]").forEach((el) => { el.hidden = !el.dataset.show.split(" ").includes(select.value); });
      form.querySelector("[data-body-label]").firstChild.textContent = select.value === "text" ? "Texto do módulo * " : "Texto do módulo ";
    };
    select.addEventListener("change", sync);
    sync();
  }

  // ---------- Aba Aparência ----------
  async function viewAppearance() {
    if (!(await loadContent())) return;
    const a = content.app, h = content.hero, l = content.labels;
    const view = document.getElementById("view");
    view.onclick = null;
    view.innerHTML = `
      <form id="ap" novalidate>
        <div class="panel">
          <h2>Identidade do app</h2>
          <div class="grid2" style="margin-top:12px">
            <div class="field"><label>Nome do app *</label><input class="input" name="name" value="${esc(a.name)}" required></div>
            <div class="field"><label>Nome curto <small style="font-weight:400;color:var(--muted)">(ícone do celular, até 30)</small></label><input class="input" name="shortName" value="${esc(a.shortName)}" maxlength="30"></div>
            <div class="field"><label>Marca nas capas provisórias</label><input class="input" name="brand" value="${esc(a.brand)}"></div>
            <div class="field"><label>Cor principal</label><div class="colors"><label><input type="color" name="primaryColor" value="${esc(a.primaryColor)}"> Botões, barra lateral e destaques</label></div></div>
          </div>
          ${mediaField("logo", "Logo / ícone do app (quadrado)", a.logo, IMAGE_ACCEPT, "Use uma imagem quadrada de pelo menos 512 × 512 px. Também vira o ícone quando o app é instalado.")}
        </div>

        <div class="panel">
          <h2>Tela de login</h2>
          <div class="field" style="margin-top:12px"><label>Texto abaixo do nome</label><input class="input" name="loginText" value="${esc(a.loginText)}"></div>
        </div>

        <div class="panel">
          <h2>Banner da página inicial</h2>
          <div class="grid2" style="margin-top:12px">
            <div class="field"><label>Etiqueta (texto pequeno no topo)</label><input class="input" name="hero_tag" value="${esc(h.tag)}"></div>
            <div class="field"><label>Título</label><input class="input" name="hero_title" value="${esc(h.title)}"></div>
          </div>
          <div class="field"><label>Subtítulo</label><textarea class="textarea" name="hero_subtitle" style="min-height:64px">${esc(h.subtitle)}</textarea></div>
          ${mediaField("hero_image", "Imagem de fundo (horizontal)", h.image, IMAGE_ACCEPT, "Tamanho sugerido: 1800 × 600 px. A cor principal é aplicada por cima para manter o texto legível.")}
        </div>

        <div class="panel">
          <h2>Títulos das seções</h2>
          <div class="grid2" style="margin-top:12px">
            <div class="field"><label>Produtos liberados</label><input class="input" name="label_unlocked" value="${esc(l.unlocked)}"></div>
            <div class="field"><label>Ofertas bloqueadas</label><input class="input" name="label_upsells" value="${esc(l.upsells)}"></div>
          </div>
        </div>

        <div class="panel">
          <h2>Suporte</h2>
          <p>Usado no botão <b>Ajuda</b> e nos módulos do tipo Suporte. Deixe em branco para esconder a opção.</p>
          <div class="grid2" style="margin-top:12px">
            <div class="field"><label>WhatsApp (com DDI e DDD)</label><input class="input" name="whatsapp" value="${esc(a.support.whatsapp)}" placeholder="5511999999999" inputmode="numeric"></div>
            <div class="field"><label>E-mail de suporte</label><input class="input" name="email" value="${esc(a.support.email)}" type="email"></div>
          </div>
          <div class="field"><label>Mensagem inicial do WhatsApp</label><input class="input" name="whatsappMessage" value="${esc(a.support.whatsappMessage)}"></div>
        </div>

        <div class="save-bar">
          <span class="hint" style="margin:0">As mudanças aparecem no app assim que você salvar.</span>
          <button class="btn btn-primary" type="submit">Salvar aparência</button>
        </div>
      </form>`;
    const form = document.getElementById("ap");
    bindMedia(form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (uploading(form)) return toast("Aguarde o envio do arquivo terminar.");
      const v = formValues(form);
      if (!v.name) return toast("Informe o nome do app.");
      busy(form, true);
      const ok = await commit((d) => {
        Object.assign(d.app, {
          name: v.name, shortName: v.shortName, brand: v.brand, logo: v.logo, primaryColor: v.primaryColor, loginText: v.loginText,
          support: { whatsapp: v.whatsapp.replace(/\D/g, ""), email: v.email, whatsappMessage: v.whatsappMessage }
        });
        d.hero = { tag: v.hero_tag, title: v.hero_title, subtitle: v.hero_subtitle, image: v.hero_image };
        d.labels = { unlocked: v.label_unlocked, upsells: v.label_upsells };
      }, "Aparência salva. Já está no app.");
      busy(form, false);
      if (ok) renderShell();
    });
  }

  // ---------- Aba Avisos ----------
  const toLocalInput = (iso) => {
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d)) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  async function viewPosts() {
    if (!(await loadContent())) return;
    const view = document.getElementById("view");
    const posts = content.posts;
    view.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div><h2>Feed de Avisos</h2><p class="hint" style="margin:0">Os avisos aparecem para todos os membros, do mais recente para o mais antigo.</p></div>
          <button class="btn btn-primary" data-act="new">+ Novo aviso</button>
        </div>
        <div class="list">
          ${posts.length ? posts.map((p, i) => `
            <div class="list-row">
              <div class="grow">
                <strong>${esc(p.title || "(sem título)")}</strong>
                <small>${esc(p.author || "—")} · ${new Date(p.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small>
                <p class="post-preview">${esc(p.body)}</p>
              </div>
              <div class="acts">
                <button class="btn btn-ghost btn-sm" data-act="edit" data-i="${i}">Editar</button>
                <button class="btn btn-danger btn-sm" data-act="del" data-i="${i}">Excluir</button>
              </div>
            </div>`).join("") : `<p class="empty-row">Nenhum aviso publicado.</p>`}
        </div>
      </div>`;
    view.onclick = async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const i = Number(b.dataset.i);
      if (b.dataset.act === "new") return editPost(-1);
      if (b.dataset.act === "edit") return editPost(i);
      if (b.dataset.act === "del") {
        if (!confirm(`Excluir o aviso “${posts[i].title}”?`)) return;
        if (await commit((d) => d.posts.splice(i, 1), "Aviso excluído.")) viewPosts();
      }
    };
  }

  function editPost(i) {
    const p = i >= 0 ? content.posts[i] : { title: "", body: "", author: (content.posts[0] && content.posts[0].author) || `Equipe ${content.app.name}`, date: "" };
    formModal(i >= 0 ? "Editar aviso" : "Novo aviso", `
      <div class="field"><label>Título *</label><input class="input" name="title" value="${esc(p.title)}" required></div>
      <div class="field"><label>Mensagem *</label><textarea class="textarea" name="body" style="min-height:140px">${esc(p.body)}</textarea></div>
      <div class="grid2">
        <div class="field"><label>Autor</label><input class="input" name="author" value="${esc(p.author)}"></div>
        <div class="field"><label>Data de publicação</label><input class="input" type="datetime-local" name="date" value="${toLocalInput(p.date)}"></div>
      </div>`, async (v) => {
      if (!v.title || !v.body) { toast("Preencha o título e a mensagem."); return false; }
      const date = v.date ? new Date(v.date).toISOString() : new Date().toISOString();
      const data = { title: v.title, body: v.body, author: v.author, date };
      const ok = await commit((d) => {
        if (i >= 0) Object.assign(d.posts[i], data);
        else d.posts.unshift(Object.assign({ id: uid() }, data));
      }, i >= 0 ? "Aviso atualizado." : "Aviso publicado.");
      if (ok) viewPosts();
      return ok;
    });
  }

  // ---------- Membros ----------
  let members = [];
  let filter = { q: "", kind: "todos" };

  async function viewMembers() {
    const view = document.getElementById("view");
    view.innerHTML = `<p class="hint">Carregando...</p>`;
    let stats;
    try {
      [stats, { members }] = await Promise.all([api("GET", "/api/admin/stats"), api("GET", "/api/admin/members"), loadContent(true)]);
    } catch (e) {
      if (e.message !== "401") view.innerHTML = `<p class="hint">${esc(e.message)}</p>`;
      return;
    }
    view.innerHTML = `
      <div class="stats">
        <div class="stat"><span>Membros</span><b>${stats.total}</b></div>
        <div class="stat"><span>Ativos</span><b>${stats.active}</b></div>
        <div class="stat"><span>Já acessaram</span><b>${stats.accessed}</b></div>
        <div class="stat"><span>Acessaram em 7 dias</span><b>${stats.active_week}</b></div>
        <div class="stat"><span>Vindos da Cakto</span><b>${stats.from_cakto}</b></div>
        <div class="stat"><span>Bloqueados</span><b>${stats.revoked}</b></div>
      </div>
      <div class="toolbar">
        <input class="input grow" id="q" type="search" placeholder="Buscar por nome, e-mail ou produto..." value="${esc(filter.q)}">
        <select class="select" id="kind">
          ${[["todos", "Todos"], ["acessaram", "Já acessaram"], ["nunca", "Nunca acessaram"], ["ativos", "Ativos"], ["bloqueados", "Bloqueados"]]
            .map(([v, l]) => `<option value="${v}" ${filter.kind === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="btn btn-ghost" id="add">+ Adicionar membros</button>
        <a class="btn btn-ghost" href="/api/admin/members.csv">Exportar CSV</a>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Membro</th><th>Status</th><th>Produtos</th><th>Origem</th><th>Cadastro</th><th>Último acesso</th><th>Acessos</th><th>Progresso</th><th></th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>`;
    const q = document.getElementById("q");
    q.addEventListener("input", () => { filter.q = q.value; drawRows(); });
    document.getElementById("kind").addEventListener("change", (e) => { filter.kind = e.target.value; drawRows(); });
    document.getElementById("add").addEventListener("click", openAddMembers);
    document.getElementById("rows").addEventListener("click", onRowAction);
    drawRows();
  }

  function drawRows() {
    const terms = norm(filter.q).split(/\s+/).filter(Boolean);
    const list = members.filter((m) => {
      if (filter.kind === "acessaram" && !m.login_count) return false;
      if (filter.kind === "nunca" && m.login_count) return false;
      if (filter.kind === "ativos" && m.status !== "active") return false;
      if (filter.kind === "bloqueados" && m.status === "active") return false;
      const hay = norm([m.email, m.name, m.product, m.phone, accessLabel(m.access)].join(" "));
      return terms.every((t) => hay.includes(t));
    });
    document.getElementById("rows").innerHTML = list.length ? list.map((m) => {
      const pct = m.progress_total ? Math.round((m.progress_done / m.progress_total) * 100) : 0;
      return `<tr>
        <td><div class="who"><strong>${esc(m.name || "—")}</strong><small>${esc(m.email)}${m.phone ? ` · ${esc(m.phone)}` : ""}</small></div></td>
        <td data-label="Status">${m.status === "active" ? '<span class="badge ok">Ativo</span>' : '<span class="badge off">Bloqueado</span>'}</td>
        <td data-label="Produtos"><div class="cell">${accessCell(m.access)}</div></td>
        <td data-label="Origem"><div class="cell">${m.source === "cakto" ? `<span class="badge info">Cakto</span>${m.product ? `<small class="cell-sub">${esc(m.product)}</small>` : ""}` : '<span class="badge muted">Manual</span>'}</div></td>
        <td data-label="Cadastro" class="num">${fmtDate(m.created_at)}</td>
        <td data-label="Último acesso" class="num">${m.last_login ? fmtDate(m.last_login) : '<span class="badge muted">Nunca acessou</span>'}</td>
        <td data-label="Acessos" class="num">${m.login_count}</td>
        <td data-label="Progresso" class="num">${m.progress_total ? `<span class="mini-bar"><div style="width:${pct}%"></div></span>${m.progress_done}/${m.progress_total}` : "—"}</td>
        <td class="cell-actions"><div class="acts">
          <button class="btn btn-ghost btn-sm" data-act="access" data-email="${esc(m.email)}">Editar acessos</button>
          ${m.status === "active"
            ? `<button class="btn btn-ghost btn-sm" data-act="revoke" data-email="${esc(m.email)}">Bloquear</button>`
            : `<button class="btn btn-ghost btn-sm" data-act="activate" data-email="${esc(m.email)}">Liberar</button>`}
          <button class="btn btn-danger btn-sm" data-act="delete" data-email="${esc(m.email)}">Excluir</button>
        </div></td>
      </tr>`;
    }).join("") : `<tr><td colspan="9" class="empty-row">${members.length ? "Nenhum membro encontrado com esse filtro." : "Nenhum membro ainda. As compras aprovadas na Cakto aparecem aqui automaticamente."}</td></tr>`;
  }

  async function onRowAction(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const email = b.dataset.email;
    if (b.dataset.act === "access") return openEditAccess(members.find((x) => x.email === email));
    try {
      if (b.dataset.act === "delete") {
        if (!confirm(`Excluir ${email}? O acesso e o progresso dessa pessoa serão apagados.`)) return;
        await api("POST", "/api/admin/members/delete", { email });
        toast("Membro excluído.");
      } else {
        const status = b.dataset.act === "revoke" ? "revoked" : "active";
        if (status === "revoked" && !confirm(`Bloquear o acesso de ${email}?`)) return;
        await api("POST", "/api/admin/members/status", { email, status });
        toast(status === "revoked" ? "Acesso bloqueado." : "Acesso liberado.");
      }
      viewMembers();
    } catch (err) { if (err.message !== "401") toast(err.message); }
  }

  // ---------- Acesso aos produtos ----------
  const productTitle = (id) => (content.products.find((p) => p.id === id) || {}).title;

  function accessLabel(access) {
    if (access === "*") return "Todos os produtos";
    return access.map(productTitle).filter(Boolean).join(", ");
  }

  function accessCell(access) {
    if (access === "*") return '<span class="badge info">Todos</span>';
    const names = access.map(productTitle).filter(Boolean);
    if (!names.length) return '<span class="badge off">Nenhum</span>';
    return `<span class="badge muted" title="${esc(names.join(", "))}">${names.length} de ${content.products.length}</span>
      <small class="access-names">${esc(names.join(", "))}</small>`;
  }

  // Seleção de produtos: "Todos" (inclui os criados depois) ou produtos específicos.
  function accessPicker(access) {
    const all = access === "*";
    return `
      <div class="access-picker" data-access>
        <label class="check check-all"><input type="checkbox" data-all ${all ? "checked" : ""}>
          <span><b>Todos os produtos</b><small>Inclui os produtos que você criar depois</small></span></label>
        <div class="check-list">
          ${content.products.length ? content.products.map((p) => `
            <label class="check"><input type="checkbox" data-product="${esc(p.id)}" ${all || access.includes(p.id) ? "checked" : ""}>
              ${miniCover(p)}<span><b>${esc(p.title)}</b><small>${p.modules.length} módulo(s)</small></span></label>`).join("")
            : `<p class="hint">Nenhum produto criado ainda. Crie em <b>Conteúdo</b>.</p>`}
        </div>
      </div>`;
  }

  function bindAccessPicker(container) {
    const box = container.querySelector("[data-access]");
    const all = box.querySelector("[data-all]");
    const items = box.querySelectorAll("[data-product]");
    const sync = () => {
      box.classList.toggle("all-on", all.checked);
      items.forEach((i) => { i.disabled = all.checked; if (all.checked) i.checked = true; });
    };
    all.addEventListener("change", () => {
      if (!all.checked) items.forEach((i) => { i.checked = false; });
      sync();
    });
    sync();
  }

  function readAccess(container) {
    const box = container.querySelector("[data-access]");
    if (box.querySelector("[data-all]").checked) return "*";
    return [...box.querySelectorAll("[data-product]:checked")].map((i) => i.dataset.product);
  }

  function openEditAccess(member) {
    if (!member) return;
    const m = modal(`
      <div class="modal wide" role="dialog">
        <div class="modal-head"><h3>Editar acessos</h3><button class="modal-close" data-close aria-label="Fechar">${X_ICON}</button></div>
        <form class="modal-body" id="ea">
          <p class="hint" style="margin-bottom:12px"><b>${esc(member.name || member.email)}</b>${member.name ? ` · ${esc(member.email)}` : ""}<br>
            Marque os produtos que este membro pode acessar. Os demais aparecem para ele com cadeado e o link de compra.</p>
          ${accessPicker(member.access)}
          ${member.status !== "active" ? '<p class="notice-warn">Este membro está <b>bloqueado</b>: ele só volta a entrar depois que você clicar em <b>Liberar</b>.</p>' : ""}
          <div class="form-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
            <button class="btn btn-primary" type="submit">Salvar acessos</button>
          </div>
        </form>
      </div>`);
    bindAccessPicker(m.el);
    m.el.querySelector("#ea").addEventListener("submit", async (e) => {
      e.preventDefault();
      const access = readAccess(m.el);
      if (access !== "*" && !access.length && !confirm("Nenhum produto marcado: o membro vai entrar no app sem conteúdos liberados. Continuar?")) return;
      try {
        await api("POST", "/api/admin/members/access", { email: member.email, access });
        m.close();
        toast("Acessos atualizados.");
        viewMembers();
      } catch (err) { if (err.message !== "401") toast(err.message); }
    });
  }

  function openAddMembers() {
    const m = modal(`
      <div class="modal wide" role="dialog">
        <div class="modal-head"><h3>Adicionar membros</h3><button class="modal-close" data-close aria-label="Fechar">${X_ICON}</button></div>
        <form class="modal-body" id="af">
          <p class="hint" style="margin-bottom:10px">Cole um ou vários e-mails (um por linha ou separados por vírgula). Útil para quem comprou antes da integração.</p>
          <textarea class="textarea" id="emails" placeholder="cliente1@email.com&#10;cliente2@email.com" required></textarea>
          <div class="field" style="margin-top:12px"><label for="nm">Nome (opcional, só quando for 1 e-mail)</label><input id="nm" class="input"></div>
          <div class="field"><label>Produtos liberados</label>${accessPicker("*")}</div>
          <div class="form-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
            <button class="btn btn-primary" type="submit">Liberar acesso</button>
          </div>
        </form>
      </div>`);
    bindAccessPicker(m.el);
    m.el.querySelector("#emails").focus();
    m.el.querySelector("#af").addEventListener("submit", async (e) => {
      e.preventDefault();
      const access = readAccess(m.el);
      if (access !== "*" && !access.length) return toast("Selecione pelo menos um produto.");
      try {
        const r = await api("POST", "/api/admin/members", { emails: m.el.querySelector("#emails").value, name: m.el.querySelector("#nm").value, access });
        m.close();
        toast(`${r.added} membro(s) liberado(s).${r.invalid.length ? ` ${r.invalid.length} e-mail(s) inválido(s) ignorado(s).` : ""}`);
        viewMembers();
      } catch (err) { if (err.message !== "401") toast(err.message); }
    });
  }

  // ---------- Cakto ----------
  async function viewCakto() {
    const view = document.getElementById("view");
    view.onclick = null;
    view.innerHTML = `<p class="hint">Carregando...</p>`;
    let s, catalog;
    try {
      const [settings, cat] = await Promise.all([
        api("GET", "/api/admin/settings"), api("GET", "/api/admin/cakto/products"), loadContent(true)
      ]);
      s = settings;
      catalog = cat.products;
    } catch (e) {
      if (e.message !== "401") view.innerHTML = errorBox(e.message);
      return;
    }
    const url = location.origin + s.webhook_path;
    const products = content.products;
    const titleOf = (id) => (products.find((p) => p.id === id) || {}).title || id;
    const unlinkedCount = catalog.filter((c) => !c.linked.length).length;

    view.innerHTML = `
      <div class="panel">
        <h2>Status da integração</h2>
        <p>${s.cakto_secret_set
          ? '<span class="badge ok">Ativa</span> &nbsp;Cada compra aprovada cadastra o comprador e libera os produtos comprados automaticamente.'
          : '<span class="badge off">Pendente</span> &nbsp;Siga os passos 1 e 2 para começar a receber as compras.'}</p>
        ${unlinkedCount ? `<p class="notice-warn">${unlinkedCount} produto(s) da Cakto sem vínculo com o app. Veja o passo 3.</p>` : ""}
      </div>

      <div class="panel">
        <h2><span class="step-num">1</span>Cadastre o webhook na Cakto</h2>
        <p>No painel da Cakto, vá em <b>Integrações → Webhooks → Adicionar</b>, cole a URL abaixo e marque os eventos de compra aprovada, reembolso, chargeback e assinaturas. Funciona com o webhook <b>V1</b> e com o <b>V2</b> (que envia produto principal, order bumps e upsells juntos).</p>
        <div class="copy-box"><code>${esc(url)}</code><button class="btn btn-ghost btn-sm" data-act="copy">Copiar</button></div>
        ${/localhost|127\.0\.0\.1/.test(location.hostname) ? '<p class="notice-warn">Você está em <b>localhost</b>: a Cakto não consegue chamar este endereço. Publique o app num domínio com HTTPS e use a URL desse domínio.</p>' : ""}
        <p class="hint">Eventos que <b>liberam</b> acesso:</p>
        <div class="event-list">${s.grant_events.map((e) => `<code>${esc(e)}</code>`).join("")}</div>
        <p class="hint">Eventos que <b>removem</b> acesso:</p>
        <div class="event-list">${s.revoke_events.map((e) => `<code>${esc(e)}</code>`).join("")}</div>
      </div>

      <div class="panel">
        <h2><span class="step-num">2</span>Chave secreta do webhook</h2>
        <p>Depois de criar o webhook, a Cakto mostra uma <b>chave secreta</b>. Cole aqui: só as notificações com essa chave são aceitas.</p>
        <div class="row">
          <input class="input" id="secret" type="password" autocomplete="off" placeholder="${s.cakto_secret_set ? `Chave salva (${esc(s.cakto_secret_hint)}). Cole uma nova para trocar.` : "Cole a chave secreta da Cakto"}">
          <button class="btn btn-primary" data-act="save-secret">Salvar chave</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h2><span class="step-num">3</span>Produtos da Cakto</h2>
            <p class="hint" style="margin:0">Cada produto vendido na Cakto aparece aqui sozinho, na primeira venda. Ele é vinculado automaticamente ao produto do app com o <b>mesmo nome</b>; se não existir, segue a regra do passo 4. Você pode mudar o vínculo quando quiser.</p>
          </div>
          <button class="btn btn-ghost" data-act="add-cakto">+ Cadastrar produto da Cakto</button>
        </div>
        <div class="list">
          ${catalog.length ? catalog.map((c, i) => `
            <div class="list-row">
              <div class="grow">
                <strong>${esc(c.name || c.cakto_id)}</strong>
                <small>ID: ${esc(c.cakto_id)}${c.short_id ? ` · ${esc(c.short_id)}` : ""} · ${c.sales} venda(s) · ${c.buyers} comprador(es)</small>
                <div class="tags">
                  ${c.linked.length
                    ? c.linked.map((id) => `<span class="badge ok">Libera: ${esc(titleOf(id))}</span>`).join("")
                    : '<span class="badge off">Sem vínculo</span>'}
                </div>
              </div>
              <div class="acts">
                <button class="btn btn-primary btn-sm" data-act="link" data-i="${i}">Vincular</button>
                <button class="btn btn-danger btn-sm" data-act="del-cakto" data-i="${i}">Remover</button>
              </div>
            </div>`).join("")
          : `<p class="empty-row">Nenhuma venda recebida ainda. Assim que a primeira compra chegar, o produto aparece aqui. Se quiser deixar pronto antes, use <b>+ Cadastrar produto da Cakto</b>.</p>`}
        </div>
      </div>

      <div class="panel">
        <h2><span class="step-num">4</span>Regras</h2>
        <div class="field" style="margin-top:12px">
          <label>Quando chegar uma compra de um produto da Cakto sem vínculo</label>
          <select class="select" id="unmapped" style="width:100%">
            <option value="create" ${s.cakto_unmapped === "create" ? "selected" : ""}>Criar no app e liberar (recomendado)</option>
            <option value="all" ${s.cakto_unmapped === "all" ? "selected" : ""}>Liberar todos os produtos do app</option>
            <option value="none" ${s.cakto_unmapped === "none" ? "selected" : ""}>Cadastrar sem produtos (libero à mão)</option>
          </select>
          <small class="hint">O produto criado automaticamente começa sem módulos: complete em <b>Conteúdo</b>. Enquanto estiver vazio e sem link de compra, ele não aparece para quem não comprou.</small>
        </div>
        <label class="switch"><input type="checkbox" id="revoke" ${s.cakto_revoke ? "checked" : ""}> Remover o acesso automaticamente em reembolso, chargeback ou cancelamento de assinatura</label>
        <details class="advanced">
          <summary>Avançado: aceitar só alguns produtos da Cakto</summary>
          <p class="hint">Use se você vende outros produtos na mesma conta Cakto que <b>não</b> têm relação com este app. Informe os IDs ou nomes aceitos (um por linha). Em branco = aceita todos.</p>
          <textarea class="textarea" id="allow" placeholder="ID ou nome do produto na Cakto">${esc(s.cakto_products.split(",").filter(Boolean).join("\n"))}</textarea>
        </details>
        <div class="row"><button class="btn btn-primary" data-act="save-rules">Salvar regras</button></div>
      </div>

      <div class="panel">
        <h2><span class="step-num">5</span>Testar</h2>
        <p>Simula uma compra aprovada (no formato do webhook V2) com os produtos marcados — marque mais de um para simular order bump. O teste não registra vendas nem cria produtos.</p>
        ${products.length ? `
          <div class="test-products">
            ${products.map((p) => `<label class="check-inline"><input type="checkbox" data-test-product="${esc(p.id)}"> ${esc(p.title)}</label>`).join("")}
          </div>
          <div class="row">
            <input class="input" id="test-email" type="email" placeholder="email@teste.com">
            <button class="btn btn-ghost" data-act="test">Simular compra aprovada</button>
          </div>` : '<p class="hint">Crie um produto em <b>Conteúdo</b> para testar.</p>'}
      </div>`;

    view.onclick = async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || b.disabled) return;
      const i = Number(b.dataset.i);
      try {
        switch (b.dataset.act) {
          case "copy":
            try { await navigator.clipboard.writeText(url); toast("URL copiada."); }
            catch (err) { toast("Selecione e copie a URL manualmente."); }
            return;
          case "save-secret": {
            const v = document.getElementById("secret").value.trim();
            if (!v) return toast("Cole a chave secreta antes de salvar.");
            await api("POST", "/api/admin/settings", { cakto_secret: v });
            toast("Chave salva.");
            return viewCakto();
          }
          case "save-rules":
            await api("POST", "/api/admin/settings", {
              cakto_unmapped: document.getElementById("unmapped").value,
              cakto_revoke: document.getElementById("revoke").checked,
              cakto_products: document.getElementById("allow").value
            });
            return toast("Regras salvas.");
          case "add-cakto": return openAddCaktoProduct();
          case "link": return openLinkCaktoProduct(catalog[i]);
          case "del-cakto": {
            const c = catalog[i];
            if (!confirm(`Remover “${c.name || c.cakto_id}” da lista e desfazer o vínculo? Quem já tem acesso continua com acesso. Se houver nova venda, ele volta a aparecer.`)) return;
            await api("POST", "/api/admin/cakto/products/delete", { cakto_id: c.cakto_id });
            toast("Removido.");
            return viewCakto();
          }
          case "test": {
            const email = document.getElementById("test-email").value.trim();
            const product_ids = [...view.querySelectorAll("[data-test-product]:checked")].map((x) => x.dataset.testProduct);
            if (!product_ids.length) return toast("Marque pelo menos um produto.");
            const r = await api("POST", "/api/admin/test-webhook", { email, product_ids });
            return toast(`Teste: ${r.result}.`);
          }
        }
      } catch (err) { if (err.message !== "401") toast(err.message); }
    };
  }

  function openAddCaktoProduct() {
    const m = modal(`
      <div class="modal wide" role="dialog">
        <div class="modal-head"><h3>Cadastrar produto da Cakto</h3><button class="modal-close" data-close aria-label="Fechar">${X_ICON}</button></div>
        <form class="modal-body" id="acp">
          <p class="hint" style="margin-bottom:12px">Use para deixar o vínculo pronto antes da primeira venda. O ID aparece no painel da Cakto (na página do produto). Depois de cadastrar, clique em <b>Vincular</b>.</p>
          <div class="field"><label>ID do produto na Cakto *</label><input class="input" id="cid" required></div>
          <div class="field"><label>Nome (para você identificar)</label><input class="input" id="cname"></div>
          <div class="form-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
            <button class="btn btn-primary" type="submit">Cadastrar</button>
          </div>
        </form>
      </div>`);
    m.el.querySelector("#cid").focus();
    m.el.querySelector("#acp").addEventListener("submit", async (e) => {
      e.preventDefault();
      const cakto_id = m.el.querySelector("#cid").value.trim();
      if (!cakto_id) return toast("Informe o ID.");
      try {
        await api("POST", "/api/admin/cakto/products", { cakto_id, name: m.el.querySelector("#cname").value.trim() });
        m.close();
        toast("Produto da Cakto cadastrado. Agora clique em Vincular.");
        viewCakto();
      } catch (err) { if (err.message !== "401") toast(err.message); }
    });
  }

  function openLinkCaktoProduct(c) {
    if (!c) return;
    const m = modal(`
      <div class="modal wide" role="dialog">
        <div class="modal-head"><h3>Vincular produto da Cakto</h3><button class="modal-close" data-close aria-label="Fechar">${X_ICON}</button></div>
        <form class="modal-body" id="lcp">
          <p class="hint" style="margin-bottom:12px">Quem comprar <b>${esc(c.name || c.cakto_id)}</b> na Cakto recebe acesso aos produtos marcados abaixo.</p>
          <div class="access-picker">
            <div class="check-list">
              ${content.products.length ? content.products.map((p) => `
                <label class="check"><input type="checkbox" data-link-product="${esc(p.id)}" ${c.linked.includes(p.id) ? "checked" : ""}>
                  ${miniCover(p)}<span><b>${esc(p.title)}</b><small>${p.modules.length} módulo(s)</small></span></label>`).join("")
                : '<p class="hint" style="padding:12px">Nenhum produto no app. Crie em <b>Conteúdo</b>.</p>'}
            </div>
          </div>
          ${c.buyers ? `<label class="switch"><input type="checkbox" id="past" checked> Liberar também para quem já comprou (${c.buyers} comprador(es))</label>` : ""}
          <div class="form-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
            <button class="btn btn-primary" type="submit">Salvar vínculo</button>
          </div>
        </form>
      </div>`);
    m.el.querySelector("#lcp").addEventListener("submit", async (e) => {
      e.preventDefault();
      const chosen = [...m.el.querySelectorAll("[data-link-product]:checked")].map((x) => x.dataset.linkProduct);
      const past = m.el.querySelector("#past");
      try {
        const r = await api("POST", "/api/admin/cakto/link", { cakto_id: c.cakto_id, products: chosen, apply_past: !!(past && past.checked) });
        m.close();
        content = null;  // o vínculo foi gravado nos produtos; recarrega na próxima leitura
        toast(chosen.length ? `Vínculo salvo.${r.applied ? ` Acesso liberado para ${r.applied} comprador(es).` : ""}` : "Vínculo removido.");
        viewCakto();
      } catch (err) { if (err.message !== "401") toast(err.message); }
    });
  }

  // ---------- Eventos ----------
  async function viewEvents() {
    const view = document.getElementById("view");
    let events;
    try { ({ events } = await api("GET", "/api/admin/events")); } catch (e) { return; }
    view.innerHTML = `
      <div class="toolbar">
        <p class="hint grow" style="margin:0">Últimas notificações recebidas da Cakto. Se uma compra chegou antes da configuração ficar pronta, use <b>Reprocessar</b>.</p>
        <button class="btn btn-ghost btn-sm" id="reload">Atualizar</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Recebido em</th><th>Evento</th><th>E-mail</th><th>Resultado</th><th></th></tr></thead>
          <tbody>${events.length ? events.map((ev) => {
            const ok = /liberado|bloqueado/.test(ev.result) && !/^recusado/.test(ev.result);
            const canRetry = /^(recusado|ignorado)/.test(ev.result) && !/^teste/.test(ev.event);
            return `<tr>
              <td data-label="Recebido em" class="num">${fmtDate(ev.received_at)}</td>
              <td data-label="Evento"><code>${esc(ev.event || "—")}</code></td>
              <td data-label="E-mail" class="cell-break">${esc(ev.email || "—")}</td>
              <td data-label="Resultado"><span class="badge badge-wrap ${ok ? "ok" : /^recusado/.test(ev.result) ? "off" : "muted"}">${esc(ev.result)}</span></td>
              <td class="cell-actions"><div class="acts">
                <button class="btn btn-ghost btn-sm" data-view="${ev.id}">Ver dados</button>
                ${canRetry ? `<button class="btn btn-ghost btn-sm" data-retry="${ev.id}">Reprocessar</button>` : ""}
              </div></td>
            </tr>`;
          }).join("") : `<tr><td colspan="5" class="empty-row">Nenhuma notificação recebida ainda.</td></tr>`}</tbody>
        </table>
      </div>`;
    document.getElementById("reload").addEventListener("click", viewEvents);
    view.onclick = async (e) => {
      const v = e.target.closest("[data-view]");
      if (v) {
        const ev = events.find((x) => String(x.id) === v.dataset.view);
        let pretty = ev.payload;
        try { pretty = JSON.stringify(JSON.parse(ev.payload), null, 2); } catch (err) { /* mantém texto */ }
        modal(`<div class="modal wide" role="dialog">
          <div class="modal-head"><h3>Dados do evento</h3><button class="modal-close" data-close aria-label="Fechar">${X_ICON}</button></div>
          <div class="modal-body"><pre class="payload">${esc(pretty)}</pre></div></div>`);
      }
      const r = e.target.closest("[data-retry]");
      if (r) {
        try { const res = await api("POST", "/api/admin/events/reprocess", { id: Number(r.dataset.retry) }); toast(`Reprocessado: ${res.result}.`); viewEvents(); }
        catch (err) { if (err.message !== "401") toast(err.message); }
      }
    };
  }

  // ---------- Conta ----------
  function viewAccount() {
    document.getElementById("view").innerHTML = `
      <div class="panel" style="max-width:520px">
        <h2>Trocar senha do admin</h2>
        <p>Depois de trocar, todas as sessões do admin são encerradas e você entra de novo com a nova senha.</p>
        <form id="pf" style="margin-top:14px">
          <div class="field"><label for="cur">Senha atual</label><input class="input" id="cur" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="nw">Nova senha (mín. 10 caracteres)</label><input class="input" id="nw" type="password" autocomplete="new-password" minlength="10" required></div>
          <div class="field"><label for="nw2">Repita a nova senha</label><input class="input" id="nw2" type="password" autocomplete="new-password" required></div>
          <button class="btn btn-primary" type="submit">Trocar senha</button>
        </form>
      </div>
      <div class="panel" style="max-width:520px">
        <h2>Esqueceu a senha?</h2>
        <p>No servidor, rode <code>python server.py set-admin-password</code> para definir uma nova.</p>
      </div>`;
    document.getElementById("pf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const nw = document.getElementById("nw").value;
      if (nw !== document.getElementById("nw2").value) return toast("As senhas novas não conferem.");
      try {
        await api("POST", "/api/admin/password", { current: document.getElementById("cur").value, new: nw });
        renderLogin("Senha trocada. Entre com a nova senha.");
      } catch (err) { if (err.message !== "401") toast(err.message); }
    });
  }

  // ---------- Boot ----------
  fetch("/api/config")
    .then((r) => r.json())
    .then((cfg) => { APP = Object.assign(APP, cfg.app || {}); applyBrand(); })
    .catch(() => {})
    .then(() => api("GET", "/api/admin/session"))
    .then(renderShell)
    .catch((e) => { if (e.message !== "401") renderLogin(e.message); });
})();
