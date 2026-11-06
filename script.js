/* Конкурс «Лучший профорг — 2026» — интерактив */

const pad = (n) => String(n).padStart(2, "0");

// ---------- Шапка: тень при скролле + прогресс-бар чтения ----------
const header = document.getElementById("header");
const progressBar = document.querySelector(".progress");
const onScroll = () => {
  header.classList.toggle("scrolled", window.scrollY > 10);
  if (progressBar) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
  }
};
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---------- Мобильное меню ----------
const burger = document.getElementById("burger");
const nav = document.getElementById("nav");

burger.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  burger.classList.toggle("open", open);
  burger.setAttribute("aria-expanded", String(open));
});

nav.querySelectorAll("a").forEach((link) =>
  link.addEventListener("click", () => {
    nav.classList.remove("open");
    burger.classList.remove("open");
    burger.setAttribute("aria-expanded", "false");
  })
);

// ---------- Подсветка активного пункта меню ----------
const navLinks = [...document.querySelectorAll('.nav__link[href^="#"]')];
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const activeObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) =>
        link.classList.toggle(
          "active",
          link.getAttribute("href") === "#" + entry.target.id
        )
      );
    });
  },
  { rootMargin: "-40% 0px -55% 0px" }
);
sections.forEach((section) => activeObserver.observe(section));

// ---------- Вкладки критериев по этапам ----------
// Активная вкладка синхронизируется с таймером (этап ближайшего события),
// ручное переключение работает до тех пор, пока таймер не сменит этап.
const stageTabs = [...document.querySelectorAll(".stage-tab")];
const stagePanels = [...document.querySelectorAll(".stage-panel")];

function activateStage(stage) {
  stageTabs.forEach((t) => {
    const on = Number(t.dataset.stage) === stage;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", String(on));
  });
  stagePanels.forEach((p) => {
    const on = Number(p.dataset.stage ?? p.id.slice(-1)) === stage;
    p.classList.toggle("is-active", on);
    p.hidden = !on;
  });
}

stageTabs.forEach((t) =>
  t.addEventListener("click", () => activateStage(Number(t.dataset.stage)))
);

// ---------- Аллея участников в герое ----------
// 9 карточек: фото (img/ally-1.jpg … -9.jpg) и ФИО.
// Если файла фото нет — в квадрате показывается звезда-сполох.
// ФИО заполняются в полях name/surname ниже.
const ALLY = [
  { name: "Гузько Никита Андреевич", group: "ФН11-32Б", photo: "img/ally-1.jpg?v=2" },
  { name: "Аксенова Алевтина Александровна", group: "ИБМ6-11М", photo: "img/ally-2.jpg?v=2" },
  { name: "Загирова Алина Тимуровна", group: "РК5-51Б", photo: "img/ally-3.jpg?v=2" },
  { name: "Щетанова Полина Денисовна", group: "Э4-72Б", photo: "img/ally-4.jpg?v=2" },
  { name: "Амиров Руслан Рустемович", group: "РЛ6-31М", photo: "img/ally-5.jpg?v=2" },
  { name: "Кузьмичев Максим Олегович", group: "РКТ2-51", photo: "img/ally-6.jpg?v=2" },
  { name: "Шумилина Екатерина Владимировна", group: "МТ11-52Б", photo: "img/ally-7.jpg?v=2" },
  { name: "Портузенков Ильяс Рафаэлевич", group: "ИУ10-59", photo: "img/ally-8.jpg?v=2" },
  { name: "Данилина Дарья Алексеевна", group: "ИУ1К-31Б", photo: "img/ally-9.jpg?v=2" },
];

(function renderAlley() {
  const grid = document.getElementById("alleyGrid");
  if (!grid) return;
  ALLY.forEach((p, i) => {
    const fullName = [p.name, p.surname].filter(Boolean).join(" ") || "ФИО";
    const groupHtml = p.group ? `<small class="alley-card__group">${p.group}</small>` : "";
    const card = document.createElement("article");
    card.className = "alley-card";
    card.innerHTML = `
      <span class="alley-card__photo">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C13.1 6.9 17.1 10.9 24 12C17.1 13.1 13.1 17.1 12 24C10.9 17.1 6.9 13.1 0 12C6.9 10.9 10.9 6.9 12 0Z"/></svg>
      </span>
      <p class="alley-card__name"><span>${fullName}</span>${groupHtml}</p>`;
    if (p.photo) {
      const img = new Image();
      img.alt = [fullName, p.group].filter(Boolean).join(", ") || `Участник ${i + 1}`;
      img.onload = () => {
        const slot = card.querySelector(".alley-card__photo");
        slot.textContent = "";
        slot.appendChild(img);
      };
      img.src = p.photo;
    }
    grid.appendChild(card);
  });
})();

// ---------- Секция «Голосование»: обязательный вход по логину и паролю (1 аккаунт = 1 голос) ----------
// Проверка логина и пароля выполняется через БД (/api/votes -> users.json / SQLite).
// Каждый аккаунт может проголосовать строго 1 раз.
const VOTE_OPEN_AT = new Date("2026-12-08T16:30:00+03:00").getTime();
const LS_AUTH = "lp26_auth_user";
const LS_VOTES_BY_USER = "lp26_votes_by_user";
const LS_COUNTS = "lp26_counts";

const FINALISTS = ALLY.map((p, i) => ({
  id: "f" + (i + 1),
  name: p.name,
  group: p.group,
  photo: p.photo,
  base: 0,
}));

const voteDemo = new URLSearchParams(location.search).has("demo");
const voteGrid = document.getElementById("voteGrid");
const voteLocked = document.getElementById("voteLocked");
const voteAuth = document.getElementById("voteAuth");
const voteSub = document.getElementById("voteSub");
const voteAuthFormWrap = document.getElementById("voteAuthFormWrap");
const voteUserBar = document.getElementById("voteUserBar");
const voteUserName = document.getElementById("voteUserName");
const voteLoginForm = document.getElementById("voteLoginForm");
const voteLoginInput = document.getElementById("voteLoginInput");
const votePassInput = document.getElementById("votePassInput");
const voteAuthError = document.getElementById("voteAuthError");
const voteLogoutBtn = document.getElementById("voteLogoutBtn");

const readJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const writeJSON = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch {}
};

let currentUser = readJSON(LS_AUTH, null); // { login, token }
if (currentUser && (!currentUser.token || !currentUser.login)) {
  currentUser = null;
  try { localStorage.removeItem(LS_AUTH); } catch {}
}
let votingInProgress = false;

const voteIsOpen = () => voteDemo || Date.now() >= VOTE_OPEN_AT;

function getMyVoteForUser(login) {
  if (!login) return null;
  const map = readJSON(LS_VOTES_BY_USER, {});
  return map[login] || null;
}

function setMyVoteForUser(login, candidateId) {
  if (!login) return;
  const map = readJSON(LS_VOTES_BY_USER, {});
  if (candidateId) {
    map[login] = { id: candidateId, ts: Date.now() };
  }
  writeJSON(LS_VOTES_BY_USER, map);
}

const myVote = () => (currentUser ? getMyVoteForUser(currentUser.login) : null);
const localCounts = () => readJSON(LS_COUNTS, {});
const displayName = (f, i) => [f.name, f.surname].filter(Boolean).join(" ").trim() || "Участник " + (i + 1);

function updateAuthUI() {
  const loggedIn = Boolean(currentUser && currentUser.login);
  if (voteAuthFormWrap) voteAuthFormWrap.hidden = loggedIn;
  if (voteUserBar) voteUserBar.hidden = !loggedIn;
  if (voteUserName && loggedIn) voteUserName.textContent = currentUser.login;
  if (voteAuthError) voteAuthError.hidden = true;
}

function showAuthError(msg) {
  if (!voteAuthError) return;
  voteAuthError.textContent = msg;
  voteAuthError.hidden = !msg;
}

function renderVoteCards() {
  const loggedIn = Boolean(currentUser && currentUser.login);
  const my = myVote();
  const counts = localCounts();
  voteGrid.innerHTML = "";
  FINALISTS.forEach((f, i) => {
    const total = (f.base || 0) + (counts[f.id] || 0);
    const chosen = my && my.id === f.id;
    const fullName = displayName(f, i);
    const groupHtml = f.group ? `<small class="alley-card__group">${f.group}</small>` : "";
    const card = document.createElement("article");
    card.className = "alley-card vote-card" + (chosen ? " is-chosen" : "");
    // счётчики всех участников открываются после того, как аккаунт проголосовал
    const votesBlock = my
      ? `<p class="vote-card__votes"><b data-votes="${f.id}">${total}</b><small>голосов</small></p>`
      : "";
    const btnLabel = chosen
      ? "Ваш голос"
      : !loggedIn
      ? "Войти и голосовать"
      : "Голосовать";
    card.innerHTML = `
      <span class="alley-card__photo vote-card__photo">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C13.1 6.9 17.1 10.9 24 12C17.1 13.1 13.1 17.1 12 24C10.9 17.1 6.9 13.1 0 12C6.9 10.9 10.9 6.9 12 0Z"/></svg>
      </span>
      <p class="alley-card__name vote-card__name"><span>${fullName}</span>${groupHtml}</p>
      ${votesBlock}
      <button class="btn-frame" type="button" data-id="${f.id}" ${my || votingInProgress ? "disabled" : ""}>
        <svg class="btn-frame__svg" viewBox="0 0 320 94" preserveAspectRatio="none" aria-hidden="true">
          <path d="M6 47 C 30 40 44 24 50 8 L 270 8 C 276 24 290 40 314 47 C 290 54 276 70 270 86 L 50 86 C 44 70 30 54 6 47 Z" fill="none" stroke="url(#frameGrad)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
        </svg>
        <span>${btnLabel}</span>
      </button>`;
    if (f.photo) {
      const img = new Image();
      img.alt = [fullName, f.group].filter(Boolean).join(", ") || `Участник ${i + 1}`;
      img.onload = () => {
        const slot = card.querySelector(".vote-card__photo");
        slot.textContent = "";
        slot.appendChild(img);
      };
      img.src = f.photo;
    }
    const btn = card.querySelector("button");
    btn.addEventListener("click", () => voteFor(f.id));
    voteGrid.appendChild(card);
  });
}

// Обновление счётчиков на карточках без полной перерисовки фото
function applyServerState(data) {
  if (!data || typeof data !== "object") return;
  const prevVote = myVote();
  const prevId = prevVote ? prevVote.id : null;

  if (data.counts && typeof data.counts === "object") {
    writeJSON(LS_COUNTS, data.counts);
  }
  if (currentUser && currentUser.login && data.my_vote) {
    setMyVoteForUser(currentUser.login, data.my_vote);
  }

  const nowVote = myVote();
  const nowId = nowVote ? nowVote.id : null;

  if (prevId !== nowId) {
    renderVoteCards();
    return;
  }

  if (nowId && data.counts) {
    FINALISTS.forEach((f) => {
      const el = voteGrid.querySelector(`[data-votes="${f.id}"]`);
      if (el) {
        el.textContent = (f.base || 0) + (data.counts[f.id] || 0);
      }
    });
  }
}

async function syncVotesFromServer() {
  if (location.protocol === "file:") return;
  try {
    const qs = new URLSearchParams();
    if (currentUser && currentUser.login && currentUser.token) {
      qs.set("login", currentUser.login);
      qs.set("token", currentUser.token);
    }
    const res = await fetch(`/api/votes?${qs.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (res.status === 401) {
      currentUser = null;
      try { localStorage.removeItem(LS_AUTH); } catch {}
      updateAuthUI();
      renderVoteCards();
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    applyServerState(data);
  } catch {
    // при недоступности сервера используем сохранённое локальное состояние
  }
}

async function verifyCredentialsWithDB(login, password) {
  if (location.protocol === "file:") {
    return {
      ok: false,
      error: "Для авторизации запустите сайт через сервер (python server.py или Netlify)",
    };
  }
  try {
    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "login", login, password }),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 429) {
      return {
        ok: false,
        error: (data && data.error) || "Слишком много неудачных попыток входа. Подождите 5 минут.",
      };
    }
    if (res.status === 401) {
      return {
        ok: false,
        error: (data && data.error) || "Неверный логин или пароль",
      };
    }
    if (res.ok && data && data.ok) {
      return { ok: true, data };
    }
    return {
      ok: false,
      error: (data && data.error) || "Ошибка авторизации",
    };
  } catch {
    return {
      ok: false,
      error: "Сервер авторизации временно недоступен",
    };
  }
}

if (voteLoginForm) {
  voteLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const login = (voteLoginInput.value || "").trim();
    const password = (votePassInput.value || "").trim();
    if (!login || !password) {
      showAuthError("Введите логин и пароль");
      return;
    }
    showAuthError("");
    const result = await verifyCredentialsWithDB(login, password);
    if (!result.ok) {
      showAuthError(result.error || "Неверный логин или пароль");
      return;
    }
    currentUser = {
      login: (result.data && result.data.login) || login,
      token: result.data && result.data.token,
    };
    writeJSON(LS_AUTH, currentUser);
    votePassInput.value = "";
    updateAuthUI();
    if (result.data) {
      applyServerState(result.data);
    }
    voteStateShown = null;
    refreshVote();
    renderVoteCards();
  });
}

if (voteLogoutBtn) {
  voteLogoutBtn.addEventListener("click", () => {
    currentUser = null;
    try { localStorage.removeItem(LS_AUTH); } catch {}
    updateAuthUI();
    voteStateShown = null;
    refreshVote();
    renderVoteCards();
  });
}

async function voteFor(id) {
  if (!currentUser || !currentUser.login || !currentUser.token) {
    showAuthError("Для голосования необходимо войти по логину и паролю");
    if (voteLoginInput) {
      voteLoginInput.scrollIntoView({ behavior: "smooth", block: "center" });
      voteLoginInput.focus();
    }
    return;
  }
  if (myVote() || votingInProgress) return;
  votingInProgress = true;
  voteGrid.querySelectorAll("button").forEach((b) => (b.disabled = true));

  if (location.protocol === "file:") {
    votingInProgress = false;
    showAuthError("Голосование доступно только при запуске через сервер (python server.py или Netlify)");
    renderVoteCards();
    return;
  }

  try {
    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        action: "vote",
        id,
        login: currentUser.login,
        token: currentUser.token,
      }),
    });
    const data = await res.json().catch(() => null);

    if (res.status === 401) {
      currentUser = null;
      try { localStorage.removeItem(LS_AUTH); } catch {}
      votingInProgress = false;
      updateAuthUI();
      showAuthError("Сессия истекла — пожалуйста, войдите снова");
      renderVoteCards();
      return;
    }
    if (res.status === 409) {
      votingInProgress = false;
      if (data) applyServerState(data);
      showAuthError((data && data.error) || "Этот аккаунт уже проголосовал");
      renderVoteCards();
      return;
    }
    if (res.ok && data && data.ok) {
      votingInProgress = false;
      applyServerState(data);
      renderVoteCards();
      return;
    }
    showAuthError((data && data.error) || "Не удалось сохранить голос. Попробуйте снова.");
  } catch {
    showAuthError("Сервер голосования временно недоступен. Проверьте интернет-соединение.");
  }

  votingInProgress = false;
  renderVoteCards();
}

let voteStateShown = null;
function refreshVote() {
  const open = voteIsOpen();
  if (open !== voteStateShown) {
    voteStateShown = open;
    voteLocked.hidden = open;
    if (voteAuth) voteAuth.hidden = !open;
    voteGrid.hidden = !open;
    voteSub.textContent = open
      ? "Выбери лучшего профорга МГТУ — один аккаунт, один голос"
      : "Выбор лучшего профорга откроется вместе с финалом конкурса";
    if (open) syncVotesFromServer();
  }
  if (!open) {
    const left = Math.max(0, VOTE_OPEN_AT - Date.now());
    document.getElementById("vd-days").textContent = pad(Math.floor(left / 86400000));
    document.getElementById("vd-hours").textContent = pad(Math.floor(left / 3600000) % 24);
    document.getElementById("vd-mins").textContent = pad(Math.floor(left / 60000) % 60);
    document.getElementById("vd-secs").textContent = pad(Math.floor(left / 1000) % 60);
  }
}
updateAuthUI();
renderVoteCards();
refreshVote();
syncVotesFromServer();
// Каждые 5 секунд синхронизируем общие голоса со всех устройств
setInterval(() => {
  if (voteIsOpen()) syncVotesFromServer();
}, 5000);

// ---------- Таймер: отсчёт до ближайшего события конкурса ----------
// Когда дата наступает, таймер автоматически переключается на следующую.
const MILESTONES = [
  { date: "2026-12-08T16:30:00+03:00", label: "До финального гала-концерта · 8 декабря, 16:30", stage: 5 },
];
const FINISHED_LABEL = "Конкурс завершён — до встречи в 2027 году!";

const cd = {
  days: document.getElementById("cd-days"),
  hours: document.getElementById("cd-hours"),
  mins: document.getElementById("cd-mins"),
  secs: document.getElementById("cd-secs"),
};
const cdLabel = document.querySelector(".countdown__label");
let lastAutoStage = null;

function tick() {
  const now = Date.now();
  const milestone = MILESTONES.find((m) => new Date(m.date).getTime() > now);
  const left = milestone ? new Date(milestone.date).getTime() - now : 0;
  cdLabel.textContent = milestone ? milestone.label : FINISHED_LABEL;
  cd.days.textContent = pad(Math.floor(left / 86400000));
  cd.hours.textContent = pad(Math.floor(left / 3600000) % 24);
  cd.mins.textContent = pad(Math.floor(left / 60000) % 60);
  cd.secs.textContent = pad(Math.floor(left / 1000) % 60);

  // вкладка критериев следует за этапом из таймера;
  // перерисовываем только при реальной смене этапа, чтобы не сбивать ручной выбор
  const autoStage = milestone ? milestone.stage : 5;
  if (autoStage !== lastAutoStage) {
    lastAutoStage = autoStage;
    activateStage(autoStage);
  }
  refreshVote();
}
tick();
setInterval(tick, 1000);

// ---------- Появление блоков + счётчики ----------
// карточки всплывают по очереди: задержка = индекс внутри родителя * 0.05с
document.querySelectorAll(".reveal").forEach((el) => {
  const siblings = [...el.parentElement.children].filter((c) =>
    c.classList.contains("reveal")
  );
  el.style.setProperty("--i", siblings.indexOf(el));
});

const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
);
document.querySelectorAll(".reveal, .fade-in").forEach((el) => revealObserver.observe(el));

// анимированные числа в статистике
function animateCounter(el) {
  const target = Number(el.dataset.target) || 0;
  const duration = 1200;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    el.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3)));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const statsObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      animateCounter(entry.target);
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.6 }
);
document.querySelectorAll(".stats__num").forEach((el) => statsObserver.observe(el));

// ---------- Слайдер «О конкурсе» (по образцу слайдера SLAY: 01 / 03) ----------
const aboutTrack = document.getElementById("aboutTrack");
const aboutCurrent = document.getElementById("aboutCurrent");
const aboutTotal = aboutTrack ? aboutTrack.children.length : 0;
let aboutIndex = 0;

function aboutGo(delta) {
  aboutIndex = (aboutIndex + delta + aboutTotal) % aboutTotal;
  aboutTrack.style.transform = `translateX(-${aboutIndex * 100}%)`;
  aboutCurrent.textContent = pad(aboutIndex + 1);
}

const aboutPrev = document.getElementById("aboutPrev");
const aboutNext = document.getElementById("aboutNext");
if (aboutPrev && aboutNext) {
  aboutPrev.addEventListener("click", () => aboutGo(-1));
  aboutNext.addEventListener("click", () => aboutGo(1));
}

// ---------- FAQ-аккордеон ----------
document.querySelectorAll(".faq__item").forEach((item) => {
  const btn = item.querySelector(".faq__q");
  const answer = item.querySelector(".faq__a");

  btn.addEventListener("click", () => {
    const isOpen = item.classList.contains("open");

    // закрываем остальные
    document.querySelectorAll(".faq__item.open").forEach((other) => {
      other.classList.remove("open");
      other.querySelector(".faq__a").style.maxHeight = null;
      other.querySelector(".faq__q").setAttribute("aria-expanded", "false");
    });

    if (!isOpen) {
      item.classList.add("open");
      answer.style.maxHeight = answer.scrollHeight + "px";
      btn.setAttribute("aria-expanded", "true");
    }
  });
});

// ---------- Звёздное небо (герой + все секции) ----------
// Звёзды генерируются в первой половине широкого трека и дублируются во вторую —
// так бесшовный дрейф translateX(-50%) крутится без скачка. Каждая звезда мерцает
// со своими длительностью/задержкой; у секций небо реже и дрейф своей скорости.
(function initStarfield() {
  const tracks = document.querySelectorAll(".sky__track");
  if (!tracks.length) return;
  const isMobile = matchMedia("(max-width: 720px)").matches;

  tracks.forEach((track) => {
    const hero = track.closest(".sky--hero");
    const footer = track.closest(".sky--footer");
    let count;
    if (hero) count = isMobile ? 56 : 120;
    else if (footer) count = isMobile ? 14 : 32;
    else count = isMobile ? 20 : 42;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const s = document.createElement("span");
      s.className = "h-star";
      const r = Math.random();
      const size = r < 0.5 ? 1 : r < 0.8 ? 1.5 : r < 0.95 ? 2 : 2.6;
      s.style.width = s.style.height = size + "px";
      s.style.left = (Math.random() * 50).toFixed(3) + "%";
      s.style.top = (Math.random() * 100).toFixed(3) + "%";
      s.style.setProperty("--d", (2.2 + Math.random() * 4).toFixed(2) + "s");
      s.style.setProperty("--dl", (-Math.random() * 6).toFixed(2) + "s");
      s.style.setProperty("--o", (0.35 + Math.random() * 0.5).toFixed(2));
      if (size > 2) {
        s.classList.add("h-star--glow");
        s.style.setProperty("--star-c", Math.random() < 0.5 ? "#8ce0ff" : "#ffffff");
      } else if (Math.random() < 0.28) {
        s.style.setProperty("--star-c", "#93d5ff");
      }
      frag.appendChild(s);
    }
    track.appendChild(frag);
    track.innerHTML += track.innerHTML;
    if (!hero) {
      // у секций скорость дрейфа своя, чтобы небо не двигалось синхронно
      track.style.animationDuration = (210 + Math.random() * 110).toFixed(0) + "s";
    }
  });
})();

// Регистрация участников проходит в официальной группе конкурса ВКонтакте:
// https://vk.com/thebestprof (анкета: ФИО, факультет и группа, контакты, согласие на обработку ПД).
