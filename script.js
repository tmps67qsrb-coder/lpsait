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

// ---------- Личный кабинет и секция «Голосование» (Обязательная регистрация: 1 аккаунт = 1 голос) ----------
const VOTE_OPEN_AT = new Date("2026-12-08T17:00:00+03:00").getTime();
const LS_AUTH = "lp26_auth_user";
const LS_VOTES_BY_USER = "lp26_votes_by_user_v2";
const LS_COUNTS = "lp26_counts_v2";
const LS_LOCAL_PROFILES = "lp26_local_profiles";

const SUPPORTER_TO_CANDIDATE = {
  "Гузько Никита Андреевич": "f1",
  "Аксенова Алевтина Александровна": "f2",
  "Загирова Алина Тимуровна": "f3",
  "Щетанова Полина Денисовна": "f4",
  "Амиров Руслан Рустемович": "f5",
  "Кузьмичев Максим Олегович": "f6",
  "Шумилина Екатерина Владимировна": "f7",
  "Портузенков Ильяс Рафаэлевич": "f8",
  "Данилина Дарья Алексеевна": "f9",
};

try {
  localStorage.removeItem("lp26_votes_by_user");
  localStorage.removeItem("lp26_counts");
} catch {}

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
const voteAuthError = document.getElementById("voteAuthError");
const voteLogoutBtn = document.getElementById("voteLogoutBtn");
const voteOpenRegBtn = document.getElementById("voteOpenRegBtn");
const voteOpenLoginBtn = document.getElementById("voteOpenLoginBtn");
const voteOpenCabinetBtn = document.getElementById("voteOpenCabinetBtn");

// Элементы Личного кабинета
const openCabinetHeaderBtn = document.getElementById("openCabinetHeaderBtn");
const headerCabinetLabel = document.getElementById("headerCabinetLabel");
const cabinetModal = document.getElementById("cabinetModal");
const cabinetBackdrop = document.getElementById("cabinetBackdrop");
const closeCabinetBtn = document.getElementById("closeCabinetBtn");
const cabinetGuestView = document.getElementById("cabinetGuestView");
const cabinetProfileView = document.getElementById("cabinetProfileView");
const cabTabRegister = document.getElementById("cabTabRegister");
const cabTabLogin = document.getElementById("cabTabLogin");
const cabinetRegForm = document.getElementById("cabinetRegForm");
const cabinetLoginForm = document.getElementById("cabinetLoginForm");

// Поля регистрации
const regPhoneInput = document.getElementById("regPhoneInput");
const regNameInput = document.getElementById("regNameInput");
const regNotBmstuBtn = document.getElementById("regNotBmstuBtn");
const regGroupInputWrap = document.getElementById("regGroupInputWrap");
const regGroupInput = document.getElementById("regGroupInput");
const regSupporterSelect = document.getElementById("regSupporterSelect");
const regPassInput = document.getElementById("regPassInput");
const regPassToggle = document.getElementById("regPassToggle");
const regErrorMsg = document.getElementById("regErrorMsg");
const pwdRuleLen = document.getElementById("pwdRuleLen");
const pwdRuleEng = document.getElementById("pwdRuleEng");
const pwdRuleSpec = document.getElementById("pwdRuleSpec");

// Поля входа
const loginPhoneInput = document.getElementById("loginPhoneInput");
const loginPassInput = document.getElementById("loginPassInput");
const loginPassToggle = document.getElementById("loginPassToggle");
const loginErrorMsg = document.getElementById("loginErrorMsg");

// Элементы профиля в Личном кабинете
const cabProfileId = document.getElementById("cabProfileId");
const cabProfileName = document.getElementById("cabProfileName");
const cabProfilePhone = document.getElementById("cabProfilePhone");
const cabProfileGroup = document.getElementById("cabProfileGroup");
const cabProfileSupporter = document.getElementById("cabProfileSupporter");
const cabProfilePresence = document.getElementById("cabProfilePresence");
const cabProfileVote = document.getElementById("cabProfileVote");
const cabGoVoteBtn = document.getElementById("cabGoVoteBtn");
const cabLogoutBtn = document.getElementById("cabLogoutBtn");
const votePresenceWaitBanner = document.getElementById("votePresenceWaitBanner");
const voteUserSubNote = document.getElementById("voteUserSubNote");

// Элементы Личного кабинета АДМИНИСТРАТОРА
const cabinetAdminView = document.getElementById("cabinetAdminView");
const adminLoginLabel = document.getElementById("adminLoginLabel");
const adminRefreshBtn = document.getElementById("adminRefreshBtn");
const adminLogoutBtn = document.getElementById("adminLogoutBtn");
const adminStatTotal = document.getElementById("adminStatTotal");
const adminStatPresent = document.getElementById("adminStatPresent");
const adminStatVoted = document.getElementById("adminStatVoted");
const adminSearchInput = document.getElementById("adminSearchInput");
const adminUsersList = document.getElementById("adminUsersList");
const adminErrorMsg = document.getElementById("adminErrorMsg");
const adminFilterBtns = document.querySelectorAll("[data-admin-filter]");
const cabinetDialogEl = cabinetModal ? cabinetModal.querySelector(".cabinet-modal__dialog") : null;
const cabinetModalTitleEl = document.getElementById("cabinetModalTitle");

// Локальные SHA-256 хэши 6 фиксированных админов (для резервного режима file://)
const LOCAL_ADMIN_HASHES = {
  admin1: "b6701ac6a1976aaa7a9381abfb32ead8e351faef504acd58c19cb47c3e4a9de3",
  admin2: "1b404e55cf9a57db0eb7d86ccb3a4f23bcf9e33e5c076dba2d5e4a2ea6e2df39",
  admin3: "dead97b5f06ec9b61a88641144d8435a58cd6d3df8c984e96aab3359dc6114f9",
  admin4: "6d0388133cdfb203c77418b36ce16ad51e9f5976cb0c334fe979c44181bbc3bd",
  admin5: "6befdeee7c073751983345a77de5b6e7f5f4a7f8500bbc69cc84e0fc4c851e7d",
  admin6: "d4a0b7fee6e70bb531d58bb429a81635aecc560e16d022845d310615e8cfa2a1",
};

const readJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const writeJSON = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch {}
};

let currentUser = readJSON(LS_AUTH, null); // { login, token, is_admin, profile }
if (currentUser && (!currentUser.token || !currentUser.login)) {
  currentUser = null;
  try { localStorage.removeItem(LS_AUTH); } catch {}
}
let votingInProgress = false;
let isNotBmstu = false;
let adminUsersCache = [];
let adminCurrentFilter = "all";

const voteIsOpen = () => voteDemo || Date.now() >= VOTE_OPEN_AT;
const isLoggedIn = () => Boolean(currentUser && currentUser.login && currentUser.token);
const isAdminUser = () =>
  Boolean(
    isLoggedIn() &&
      (currentUser.is_admin ||
        (currentUser.profile && currentUser.profile.isAdmin) ||
        Object.prototype.hasOwnProperty.call(LOCAL_ADMIN_HASHES, String(currentUser.login).toLowerCase()))
  );
const isUserPresent = () =>
  Boolean(isLoggedIn() && !isAdminUser() && currentUser.profile && currentUser.profile.present);

function normalizePhoneClient(raw) {
  const s = String(raw || "").trim();
  if (Object.prototype.hasOwnProperty.call(LOCAL_ADMIN_HASHES, s.toLowerCase())) {
    return "";
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) {
    return "+7" + digits.slice(1);
  }
  if (digits.length === 10 && digits.startsWith("9")) {
    return "+7" + digits;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return "+" + digits;
  }
  return "";
}

function generateLocalUserId(phone, profilesMap) {
  const used = new Set(
    Object.values(profilesMap || {})
      .map((p) => p && String(p.userId || ""))
      .filter((id) => /^\d{4}$/.test(id))
  );
  let h = 2166136261;
  const str = String(phone || "").toLowerCase();
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const base = ((h >>> 0) % 9000) + 1000;
  for (let offset = 0; offset < 9000; offset++) {
    const cand = String(((base - 1000 + offset) % 9000) + 1000);
    if (!used.has(cand)) return cand;
  }
  return String(base);
}

function checkPasswordRules(pwd) {
  const str = String(pwd || "");
  const lenOk = str.length >= 8;
  const hasEng = /[a-zA-Z]/.test(str);
  const hasCyr = /[а-яА-ЯёЁ]/.test(str);
  const engOk = hasEng && !hasCyr;
  const specOk = /[^a-zA-Z0-9\s]/.test(str);
  return { lenOk, engOk, specOk, hasCyr, allOk: lenOk && engOk && specOk };
}

function updatePasswordChecklist() {
  if (!regPassInput) return;
  const r = checkPasswordRules(regPassInput.value);
  if (pwdRuleLen) pwdRuleLen.classList.toggle("is-valid", r.lenOk);
  if (pwdRuleEng) pwdRuleEng.classList.toggle("is-valid", r.engOk);
  if (pwdRuleSpec) pwdRuleSpec.classList.toggle("is-valid", r.specOk);
}

if (regPassInput) {
  regPassInput.addEventListener("input", updatePasswordChecklist);
}

function bindPassToggle(btn, input) {
  if (!btn || !input) return;
  btn.addEventListener("click", () => {
    const isPass = input.type === "password";
    input.type = isPass ? "text" : "password";
    btn.textContent = isPass ? "Скрыть" : "Показать";
  });
}
bindPassToggle(regPassToggle, regPassInput);
bindPassToggle(loginPassToggle, loginPassInput);

// Переключатель плашки «Не из МГТУ им. Н.Э. Баумана»
function setNotBmstuState(active) {
  isNotBmstu = Boolean(active);
  if (regNotBmstuBtn) {
    regNotBmstuBtn.classList.toggle("is-active", isNotBmstu);
    regNotBmstuBtn.setAttribute("aria-pressed", String(isNotBmstu));
  }
  if (regGroupInputWrap) {
    regGroupInputWrap.hidden = isNotBmstu;
  }
  if (regGroupInput) {
    regGroupInput.required = !isNotBmstu;
    regGroupInput.disabled = isNotBmstu;
    if (isNotBmstu) regGroupInput.value = "";
  }
}

if (regNotBmstuBtn) {
  regNotBmstuBtn.addEventListener("click", () => {
    setNotBmstuState(!isNotBmstu);
  });
}

// Переключение вкладок Регистрация / Вход
function switchCabinetTab(tabName) {
  const isReg = tabName !== "login";
  if (cabTabRegister) {
    cabTabRegister.classList.toggle("is-active", isReg);
    cabTabRegister.setAttribute("aria-selected", String(isReg));
  }
  if (cabTabLogin) {
    cabTabLogin.classList.toggle("is-active", !isReg);
    cabTabLogin.setAttribute("aria-selected", String(!isReg));
  }
  if (cabinetRegForm) cabinetRegForm.hidden = !isReg;
  if (cabinetLoginForm) cabinetLoginForm.hidden = isReg;
  if (regErrorMsg) regErrorMsg.hidden = true;
  if (loginErrorMsg) loginErrorMsg.hidden = true;
}

if (cabTabRegister) {
  cabTabRegister.addEventListener("click", () => switchCabinetTab("register"));
}
if (cabTabLogin) {
  cabTabLogin.addEventListener("click", () => switchCabinetTab("login"));
}

// Открытие / закрытие модального окна Личного кабинета
function openCabinetModal(preferredTab) {
  if (!cabinetModal) return;
  updateAuthUI();
  if (!isLoggedIn() && preferredTab) {
    switchCabinetTab(preferredTab);
  }
  if (isAdminUser()) {
    fetchAdminUsers();
  }
  cabinetModal.hidden = false;
  cabinetModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeCabinetModal() {
  if (!cabinetModal) return;
  cabinetModal.hidden = true;
  cabinetModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

if (openCabinetHeaderBtn) {
  openCabinetHeaderBtn.addEventListener("click", () => openCabinetModal("register"));
}
if (voteOpenRegBtn) {
  voteOpenRegBtn.addEventListener("click", () => openCabinetModal("register"));
}
if (voteOpenLoginBtn) {
  voteOpenLoginBtn.addEventListener("click", () => openCabinetModal("login"));
}
if (voteOpenCabinetBtn) {
  voteOpenCabinetBtn.addEventListener("click", () => openCabinetModal());
}
if (closeCabinetBtn) {
  closeCabinetBtn.addEventListener("click", closeCabinetModal);
}
if (cabinetBackdrop) {
  cabinetBackdrop.addEventListener("click", closeCabinetModal);
}
if (cabGoVoteBtn) {
  cabGoVoteBtn.addEventListener("click", () => closeCabinetModal());
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && cabinetModal && !cabinetModal.hidden) {
    closeCabinetModal();
  }
});

function getMyVoteForUser(login) {
  if (!login) return null;
  const map = readJSON(LS_VOTES_BY_USER, {});
  return map[login.toLowerCase()] || map[login] || null;
}

function setMyVoteForUser(login, candidateId) {
  if (!login) return;
  const map = readJSON(LS_VOTES_BY_USER, {});
  if (candidateId) {
    map[login.toLowerCase()] = { id: candidateId, ts: Date.now() };
  }
  writeJSON(LS_VOTES_BY_USER, map);
}

const myVote = () => {
  if (!currentUser) return null;
  const prof = currentUser.profile;
  const supp = prof && prof.supporterOf;
  const cid = (prof && prof.candidateId) || (supp && SUPPORTER_TO_CANDIDATE[supp]) || null;
  if (!cid) return null;
  return { id: cid, confirmed: Boolean(prof && prof.present) };
};
const localCounts = () => readJSON(LS_COUNTS, {});
const displayName = (f, i) => [f.name, f.surname].filter(Boolean).join(" ").trim() || "Участник " + (i + 1);

function updateAuthUI() {
  const loggedIn = isLoggedIn();
  const adminMode = isAdminUser();
  const presentOk = isUserPresent();
  const prof = (currentUser && currentUser.profile) || {};
  const displayUser = prof.fullName || (currentUser && currentUser.login) || "";
  const idSuffix = !adminMode && prof.userId ? ` · ID: ${prof.userId}` : "";

  if (voteAuthFormWrap) voteAuthFormWrap.hidden = loggedIn;
  if (voteUserBar) voteUserBar.hidden = !loggedIn;
  if (voteUserName && loggedIn) voteUserName.textContent = displayUser + idSuffix;
  if (voteAuthError) voteAuthError.hidden = true;

  if (voteOpenCabinetBtn) {
    voteOpenCabinetBtn.textContent = adminMode ? "Панель админа" : "Профиль";
  }
  if (voteUserSubNote) {
    if (adminMode) {
      voteUserSubNote.textContent = "Панель администратора: подтверждение присутствия зрителей и авторизация голосов";
    } else if (presentOk) {
      const isSpectator = !prof.supporterOf || prof.supporterOf === "Просто зритель";
      voteUserSubNote.textContent = isSpectator
        ? "Присутствие в БЗДК подтверждено · Статус: просто зритель"
        : `Присутствие в БЗДК подтверждено · Ваш голос зачтён за: ${prof.supporterOf}`;
    } else {
      voteUserSubNote.textContent = "В личном кабинете скоро появятся лист рассадки и данные о входе в БЗДК";
    }
  }

  // Плашка ожидания подтверждения присутствия от админа (показывается зарегистрированному зрителю, пока админ его не отметил)
  if (votePresenceWaitBanner) {
    votePresenceWaitBanner.hidden = !(loggedIn && !adminMode && !presentOk);
  }

  if (headerCabinetLabel) {
    headerCabinetLabel.textContent = adminMode ? "ЛК Админа" : "Личный кабинет";
  }

  if (cabinetDialogEl) {
    cabinetDialogEl.classList.toggle("cabinet-modal__dialog--admin", adminMode);
  }
  if (cabinetModalTitleEl) {
    cabinetModalTitleEl.textContent = adminMode ? "Личный кабинет администратора" : "Личный кабинет";
  }

  if (cabinetGuestView) cabinetGuestView.hidden = loggedIn;
  if (cabinetProfileView) cabinetProfileView.hidden = !(loggedIn && !adminMode);
  if (cabinetAdminView) cabinetAdminView.hidden = !(loggedIn && adminMode);

  if (loggedIn && adminMode) {
    if (adminLoginLabel) adminLoginLabel.textContent = currentUser.login;
    renderAdminPanel();
  } else if (loggedIn) {
    if (cabProfileId) cabProfileId.textContent = prof.userId || "—";
    if (cabProfileName) cabProfileName.textContent = prof.fullName || currentUser.login;
    if (cabProfilePhone) cabProfilePhone.textContent = prof.phone || currentUser.login;
    if (cabProfileGroup) {
      cabProfileGroup.textContent = prof.notBmstu
        ? "Не из МГТУ им. Н.Э. Баумана"
        : prof.group || "МГТУ им. Н.Э. Баумана";
    }
    if (cabProfileSupporter) cabProfileSupporter.textContent = prof.supporterOf || "Просто зритель";
    if (cabProfilePresence) {
      cabProfilePresence.textContent = presentOk
        ? "Подтверждено администратором (доступ открыт)"
        : "Ожидает подтверждения от администратора в БЗДК";
      cabProfilePresence.classList.toggle("cabinet-profile__val--ok", presentOk);
      cabProfilePresence.classList.toggle("cabinet-profile__val--wait", !presentOk);
    }
    if (cabProfileVote) {
      const isSpectator = !prof.supporterOf || prof.supporterOf === "Просто зритель";
      if (isSpectator) {
        cabProfileVote.textContent = presentOk
          ? "Присутствие подтверждено (статус: просто зритель)"
          : "Статус: просто зритель (ожидает отметки в БЗДК)";
        cabProfileVote.classList.toggle("cabinet-profile__val--ok", presentOk);
        cabProfileVote.classList.toggle("cabinet-profile__val--wait", !presentOk);
      } else if (presentOk) {
        cabProfileVote.textContent = `Голос учтён и подтверждён: ${prof.supporterOf}`;
        cabProfileVote.classList.add("cabinet-profile__val--ok");
        cabProfileVote.classList.remove("cabinet-profile__val--wait");
      } else {
        cabProfileVote.textContent = `Ожидает отметки в БЗДК (голос за: ${prof.supporterOf})`;
        cabProfileVote.classList.remove("cabinet-profile__val--ok");
        cabProfileVote.classList.add("cabinet-profile__val--wait");
      }
    }
  }

  // Таблица статистики результатов отображается при открытии голосования
  if (voteGrid) {
    voteGrid.hidden = !voteIsOpen();
  }
}

function showAuthError(msg) {
  if (!voteAuthError) return;
  voteAuthError.textContent = msg;
  voteAuthError.hidden = !msg;
}

function showRegError(msg) {
  if (!regErrorMsg) return;
  regErrorMsg.textContent = msg;
  regErrorMsg.hidden = !msg;
}

function showLoginError(msg) {
  if (!loginErrorMsg) return;
  loginErrorMsg.textContent = msg;
  loginErrorMsg.hidden = !msg;
}

function showAdminError(msg) {
  if (!adminErrorMsg) return;
  adminErrorMsg.textContent = msg;
  adminErrorMsg.hidden = !msg;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let lastRenderedAdminMarkup = "";

function renderAdminPanel() {
  if (!adminUsersList) return;
  const users = Array.isArray(adminUsersCache) ? adminUsersCache : [];

  const totalCount = users.length;
  const presentCount = users.filter((u) => u.present).length;
  const votedCount = users.filter(
    (u) => Boolean(u.present) && u.supporterOf && u.supporterOf !== "Просто зритель"
  ).length;

  if (adminStatTotal) adminStatTotal.textContent = String(totalCount);
  if (adminStatPresent) adminStatPresent.textContent = String(presentCount);
  if (adminStatVoted) adminStatVoted.textContent = String(votedCount);

  const rawQuery = ((adminSearchInput && adminSearchInput.value) || "").trim().toLowerCase();
  const isExplicitIdSearch = /^(?:id|айди|#)\s*:?\s*\d+$/i.test(rawQuery);
  const cleanIdQuery = rawQuery.replace(/^(?:id|айди|#|\s|:)+/i, "").trim();

  const filtered = users.filter((u) => {
    if (adminCurrentFilter === "pending" && u.present) return false;
    if (adminCurrentFilter === "present" && !u.present) return false;
    if (!rawQuery) return true;
    const uid = String(u.userId || "").toLowerCase();
    if (isExplicitIdSearch) {
      return uid.includes(cleanIdQuery);
    }
    const hay = [
      uid,
      uid ? `id${uid}` : "",
      uid ? `id ${uid}` : "",
      uid ? `#${uid}` : "",
      u.fullName,
      u.phone,
      u.login,
      u.group,
      u.supporterOf,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(rawQuery) || Boolean(cleanIdQuery && uid.includes(cleanIdQuery));
  });

  if (rawQuery && cleanIdQuery) {
    filtered.sort((a, b) => {
      const aId = String(a.userId || "").toLowerCase();
      const bId = String(b.userId || "").toLowerCase();
      const aExact = aId === cleanIdQuery ? 0 : aId.startsWith(cleanIdQuery) ? 1 : 2;
      const bExact = bId === cleanIdQuery ? 0 : bId.startsWith(cleanIdQuery) ? 1 : 2;
      return aExact - bExact;
    });
  }

  if (!filtered.length) {
    const emptyHtml = `<p class="cabinet-admin__empty">${
      totalCount === 0
        ? "Пока нет зарегистрированных пользователей."
        : "По вашему запросу участники не найдены."
    }</p>`;
    if (lastRenderedAdminMarkup !== emptyHtml) {
      lastRenderedAdminMarkup = emptyHtml;
      adminUsersList.innerHTML = emptyHtml;
    }
    return;
  }

  const nextHtml = filtered
    .map((u) => {
      const present = Boolean(u.present);
      const isSpectator = !u.supporterOf || u.supporterOf === "Просто зритель";
      const uidLabel = escapeHtml(u.userId || "—");
      const statusBadge = present
        ? `<span class="admin-badge admin-badge--ok">Присутствие подтверждено${
            u.verifiedBy ? " (" + escapeHtml(u.verifiedBy) + ")" : ""
          }</span>`
        : `<span class="admin-badge admin-badge--wait">Ожидает подтверждения</span>`;
      const votedBadge = isSpectator
        ? `<span class="admin-badge">Просто зритель</span>`
        : present
        ? `<span class="admin-badge admin-badge--voted">Голос зачтён: ${escapeHtml(u.supporterOf)}</span>`
        : `<span class="admin-badge admin-badge--wait">Голос: ${escapeHtml(u.supporterOf)} (ждёт отметки)</span>`;
      const btnText = present ? "Снять отметку" : "Подтвердить присутствие";
      const btnClass = "admin-presence-btn" + (present ? " is-revoke" : "");

      return `
        <div class="admin-user-card${present ? " is-present" : ""}">
          <div class="admin-user-card__info">
            <div class="admin-user-card__head">
              <span class="admin-user-card__id" title="Индивидуальный 4-значный ID">ID: ${uidLabel}</span>
              <div class="admin-user-card__name">${escapeHtml(u.fullName || u.phone)}</div>
            </div>
            <div class="admin-user-card__meta">
              <span>Тел.: <b>${escapeHtml(u.phone || u.login)}</b></span>
              <span>Группа: <b>${escapeHtml(u.group || "—")}</b></span>
              <span>Болеет за: <b>${escapeHtml(u.supporterOf || "Просто зритель")}</b></span>
            </div>
            <div class="admin-user-card__badges">
              ${statusBadge}
              ${votedBadge}
            </div>
          </div>
          <div class="admin-user-card__action">
            <button
              type="button"
              class="${btnClass}"
              data-admin-toggle-login="${escapeHtml(u.login || u.phone)}"
              data-admin-next-present="${present ? "0" : "1"}"
            >${btnText}</button>
          </div>
        </div>
      `;
    })
    .join("");

  if (lastRenderedAdminMarkup === nextHtml) return;
  const prevScroll = adminUsersList.scrollTop;
  lastRenderedAdminMarkup = nextHtml;
  adminUsersList.innerHTML = nextHtml;
  adminUsersList.scrollTop = prevScroll;

  adminUsersList.querySelectorAll("[data-admin-toggle-login]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetLogin = btn.getAttribute("data-admin-toggle-login");
      const nextPresent = btn.getAttribute("data-admin-next-present") === "1";
      btn.disabled = true;
      setAdminPresence(targetLogin, nextPresent);
    });
  });
}

async function fetchAdminUsers() {
  if (!isAdminUser()) return;
  showAdminError("");

  if (location.protocol === "file:") {
    const localProfiles = readJSON(LS_LOCAL_PROFILES, {});
    const votesMap = readJSON(LS_VOTES_BY_USER, {});
    adminUsersCache = Object.values(localProfiles).map((u) => ({
      login: u.phone,
      phone: u.phone,
      userId: u.userId || generateLocalUserId(u.phone, {}),
      fullName: u.fullName,
      group: u.notBmstu ? "Не из МГТУ им. Н.Э. Баумана" : u.group,
      notBmstu: Boolean(u.notBmstu),
      supporterOf: u.supporterOf,
      present: Boolean(u.present),
      verifiedBy: u.verifiedBy || "",
      hasVoted: Boolean(votesMap[String(u.phone || "").toLowerCase()]),
    }));
    renderAdminPanel();
    return;
  }

  try {
    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        action: "admin_list",
        login: currentUser.login,
        token: currentUser.token,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      showAdminError((data && data.error) || "Не удалось загрузить список участников");
      return;
    }
    if (Array.isArray(data.users)) {
      adminUsersCache = data.users;
    }
    renderAdminPanel();
  } catch {
    showAdminError("Ошибка соединения с сервером при загрузке списка");
  }
}

async function setAdminPresence(targetLogin, present) {
  if (!isAdminUser() || !targetLogin) return;
  showAdminError("");

  if (location.protocol === "file:") {
    const localProfiles = readJSON(LS_LOCAL_PROFILES, {});
    if (localProfiles[targetLogin]) {
      localProfiles[targetLogin].present = Boolean(present);
      localProfiles[targetLogin].verifiedBy = present ? currentUser.login : "";
      writeJSON(LS_LOCAL_PROFILES, localProfiles);
    }
    const counts = { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 };
    Object.values(localProfiles).forEach((u) => {
      const cid = u.candidateId || SUPPORTER_TO_CANDIDATE[u.supporterOf];
      if (u.present && cid && counts[cid] !== undefined) {
        counts[cid]++;
      }
    });
    writeJSON(LS_COUNTS, counts);
    await fetchAdminUsers();
    renderVoteCards();
    return;
  }

  try {
    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        action: "admin_set_presence",
        login: currentUser.login,
        token: currentUser.token,
        target_login: targetLogin,
        present: Boolean(present),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      showAdminError((data && data.error) || "Не удалось изменить статус присутствия");
      renderAdminPanel();
      return;
    }
    if (Array.isArray(data.users)) {
      adminUsersCache = data.users;
    }
    if (data.counts && typeof data.counts === "object") {
      writeJSON(LS_COUNTS, data.counts);
      renderVoteCards();
    }
    renderAdminPanel();
  } catch {
    showAdminError("Ошибка соединения с сервером");
    renderAdminPanel();
  }
}

if (adminSearchInput) {
  adminSearchInput.addEventListener("input", () => renderAdminPanel());
}
if (adminRefreshBtn) {
  adminRefreshBtn.addEventListener("click", () => fetchAdminUsers());
}
if (adminLogoutBtn) {
  adminLogoutBtn.addEventListener("click", handleLogout);
}
adminFilterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    adminCurrentFilter = btn.getAttribute("data-admin-filter") || "all";
    adminFilterBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
    renderAdminPanel();
  });
});

function renderVoteCards() {
  const presentOk = isUserPresent();
  const my = myVote();
  const counts = localCounts();
  voteGrid.innerHTML = "";
  FINALISTS.forEach((f, i) => {
    const total = (f.base || 0) + (counts[f.id] || 0);
    const chosen = my && my.id === f.id;
    const fullName = displayName(f, i);
    const groupHtml = f.group ? `<small class="alley-card__group">${f.group}</small>` : "";
    const card = document.createElement("article");
    const cardChosenClass = chosen ? (presentOk ? " is-chosen" : " is-pending-choice") : "";
    card.className = "alley-card vote-card" + cardChosenClass;
    const votesBlock = `<p class="vote-card__votes"><b data-votes="${f.id}">${total}</b><small>голосов</small></p>`;
    let choiceBadge = "";
    if (chosen) {
      choiceBadge = presentOk
        ? `<div class="vote-card__badge vote-card__badge--ok">✓ Ваш подтверждённый голос</div>`
        : `<div class="vote-card__badge vote-card__badge--wait">Ваш выбор (ждёт отметки в БЗДК)</div>`;
    }
    card.innerHTML = `
      <span class="alley-card__photo vote-card__photo">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C13.1 6.9 17.1 10.9 24 12C17.1 13.1 13.1 17.1 12 24C10.9 17.1 6.9 13.1 0 12C6.9 10.9 10.9 6.9 12 0Z"/></svg>
      </span>
      <p class="alley-card__name vote-card__name"><span>${fullName}</span>${groupHtml}</p>
      ${votesBlock}
      ${choiceBadge}`;
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
    voteGrid.appendChild(card);
  });
}

function applyServerState(data) {
  if (!data || typeof data !== "object") return;
  const prevVote = myVote();
  const prevId = prevVote ? prevVote.id : null;
  const prevPresent = isUserPresent();

  if (data.counts && typeof data.counts === "object") {
    writeJSON(LS_COUNTS, data.counts);
  }
  if (
    currentUser &&
    Object.prototype.hasOwnProperty.call(data, "login") &&
    (!data.login || (!data.is_admin && data.profile === null))
  ) {
    currentUser = null;
    adminUsersCache = [];
    try { localStorage.removeItem(LS_AUTH); } catch {}
    updateAuthUI();
    renderVoteCards();
    return;
  }
  if (currentUser && currentUser.login && data.my_vote) {
    setMyVoteForUser(currentUser.login, data.my_vote);
  }
  if (typeof data.is_admin === "boolean" && currentUser) {
    currentUser.is_admin = data.is_admin;
  }
  if (Array.isArray(data.users)) {
    adminUsersCache = data.users;
  }
  if (currentUser && data.profile && typeof data.profile === "object") {
    currentUser.profile = data.profile;
    writeJSON(LS_AUTH, currentUser);
  }

  updateAuthUI();

  const nowVote = myVote();
  const nowId = nowVote ? nowVote.id : null;
  const nowPresent = isUserPresent();

  if (prevId !== nowId || prevPresent !== nowPresent) {
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

// Отправка регистрации
if (cabinetRegForm) {
  cabinetRegForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showRegError("");

    const rawPhone = (regPhoneInput.value || "").trim();
    const phone = normalizePhoneClient(rawPhone);
    const fullName = (regNameInput.value || "").trim();
    const groupVal = isNotBmstu ? "Не из МГТУ им. Н.Э. Баумана" : (regGroupInput.value || "").trim();
    const supporterOf = (regSupporterSelect.value || "").trim();
    const password = (regPassInput.value || "").trim();
    const pwdCheck = checkPasswordRules(password);

    if (!phone) {
      showRegError("Введите корректный номер телефона (10–11 цифр)");
      regPhoneInput.focus();
      return;
    }
    if (!fullName || fullName.length < 3 || !fullName.includes(" ")) {
      showRegError("Пожалуйста, укажите полное ФИО (Фамилия Имя Отчество)");
      regNameInput.focus();
      return;
    }
    if (!isNotBmstu && !groupVal) {
      showRegError("Укажите вашу учебную группу или нажмите плашку «Не из МГТУ им. Н.Э. Баумана»");
      regGroupInput.focus();
      return;
    }
    if (!supporterOf) {
      showRegError("Выберите, за кого вы болеете (или пункт «Просто зритель»)");
      regSupporterSelect.focus();
      return;
    }
    if (!pwdCheck.lenOk) {
      showRegError("Пароль должен содержать минимум 8 символов");
      regPassInput.focus();
      return;
    }
    if (pwdCheck.hasCyr || !pwdCheck.engOk) {
      showRegError("Пароль должен содержать английские буквы (без кириллицы)");
      regPassInput.focus();
      return;
    }
    if (!pwdCheck.specOk) {
      showRegError("Пароль должен содержать хотя бы один специальный знак (! @ # $ % ^ & * _ - + = и др.)");
      regPassInput.focus();
      return;
    }

    const payload = {
      action: "register",
      phone,
      fullName,
      group: groupVal,
      notBmstu: isNotBmstu,
      supporterOf,
      password,
    };

    if (location.protocol !== "file:") {
      try {
        const res = await fetch("/api/votes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.ok) {
          showRegError((data && data.error) || "Ошибка при регистрации. Проверьте введённые данные.");
          return;
        }
        currentUser = {
          login: data.login || phone,
          is_admin: false,
          token: data.token,
          profile: data.profile || {
            phone,
            fullName,
            group: groupVal,
            notBmstu: isNotBmstu,
            supporterOf,
            present: false,
            verifiedBy: "",
          },
        };
        writeJSON(LS_AUTH, currentUser);
        regPassInput.value = "";
        updatePasswordChecklist();
        applyServerState(data);
        updateAuthUI();
        renderVoteCards();
        return;
      } catch {
        showRegError("Сервер временно недоступен. Попробуйте чуть позже.");
        return;
      }
    } else {
      const pwdHash = await hashPasswordClient(password);
      const localProfiles = readJSON(LS_LOCAL_PROFILES, {});
      if (localProfiles[phone]) {
        showRegError("Этот номер телефона уже зарегистрирован. Перейдите во вкладку «Вход».");
        return;
      }
      const userId = generateLocalUserId(phone, localProfiles);
      const candId = SUPPORTER_TO_CANDIDATE[supporterOf] || "";
      const profile = {
        userId,
        candidateId: candId,
        phone,
        fullName,
        group: groupVal,
        notBmstu: isNotBmstu,
        supporterOf,
        present: false,
        verifiedBy: "",
      };
      localProfiles[phone] = { ...profile, passwordHash: pwdHash };
      writeJSON(LS_LOCAL_PROFILES, localProfiles);
      currentUser = { login: phone, is_admin: false, token: "local." + Date.now(), profile };
      writeJSON(LS_AUTH, currentUser);
      regPassInput.value = "";
      updatePasswordChecklist();
      updateAuthUI();
      renderVoteCards();
    }
  });
}

async function hashPasswordClient(pwd) {
  const str = String(pwd || "").trim();
  if (window.crypto && window.crypto.subtle) {
    const buf = new TextEncoder().encode("lp2026_salt:" + str);
    const digest = await window.crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return "";
}

// Отправка входа (для зрителей по номеру телефона и для 6 администраторов admin1..admin6)
if (cabinetLoginForm) {
  cabinetLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showLoginError("");

    const rawLogin = (loginPhoneInput.value || "").trim();
    const normPhone = normalizePhoneClient(rawLogin);
    const loginKey = normPhone || rawLogin.toLowerCase();
    const password = (loginPassInput.value || "").trim();

    if (!loginKey || !password) {
      showLoginError("Введите номер телефона (или логин администратора) и пароль");
      return;
    }

    if (location.protocol !== "file:") {
      try {
        const res = await fetch("/api/votes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: "login", login: loginKey, password }),
        });
        const data = await res.json().catch(() => null);
        if (res.status === 429) {
          showLoginError((data && data.error) || "Слишком много попыток входа. Подождите 5 минут.");
          return;
        }
        if (!res.ok || !data || !data.ok) {
          showLoginError((data && data.error) || "Неверный логин (номер телефона) или пароль");
          return;
        }
        currentUser = {
          login: data.login || loginKey,
          is_admin: Boolean(data.is_admin),
          token: data.token,
          profile: data.profile || { phone: loginKey, fullName: loginKey, present: false },
        };
        if (Array.isArray(data.users)) {
          adminUsersCache = data.users;
        }
        writeJSON(LS_AUTH, currentUser);
        loginPassInput.value = "";
        applyServerState(data);
        updateAuthUI();
        renderVoteCards();
        return;
      } catch {
        showLoginError("Сервер авторизации временно недоступен");
        return;
      }
    } else {
      const pwdHash = await hashPasswordClient(password);
      // Проверка 6 фиксированных аккаунтов администраторов в локальном режиме
      if (Object.prototype.hasOwnProperty.call(LOCAL_ADMIN_HASHES, loginKey)) {
        if (pwdHash !== LOCAL_ADMIN_HASHES[loginKey]) {
          showLoginError("Неверный логин администратора или пароль");
          return;
        }
        currentUser = {
          login: loginKey,
          is_admin: true,
          token: "local.admin." + Date.now(),
          profile: {
            phone: loginKey,
            fullName: `Администратор (${loginKey})`,
            group: "Оргкомитет / Администратор",
            notBmstu: false,
            supporterOf: "Администратор",
            present: true,
            isAdmin: true,
          },
        };
        writeJSON(LS_AUTH, currentUser);
        loginPassInput.value = "";
        await fetchAdminUsers();
        updateAuthUI();
        renderVoteCards();
        return;
      }

      const localProfiles = readJSON(LS_LOCAL_PROFILES, {});
      const found = localProfiles[loginKey];
      if (!found || !pwdHash || found.passwordHash !== pwdHash) {
        showLoginError("Неверный номер телефона или пароль");
        return;
      }
      if (!found.userId) {
        found.userId = generateLocalUserId(found.phone, localProfiles);
        writeJSON(LS_LOCAL_PROFILES, localProfiles);
      }
      currentUser = {
        login: loginKey,
        is_admin: false,
        token: "local." + Date.now(),
        profile: {
          userId: found.userId,
          phone: found.phone,
          fullName: found.fullName,
          group: found.group,
          notBmstu: found.notBmstu,
          supporterOf: found.supporterOf,
          present: Boolean(found.present),
          verifiedBy: found.verifiedBy || "",
        },
      };
      writeJSON(LS_AUTH, currentUser);
      loginPassInput.value = "";
      updateAuthUI();
      renderVoteCards();
    }
  });
}

function handleLogout() {
  currentUser = null;
  adminUsersCache = [];
  try { localStorage.removeItem(LS_AUTH); } catch {}
  updateAuthUI();
  switchCabinetTab("login");
  renderVoteCards();
}

if (voteLogoutBtn) {
  voteLogoutBtn.addEventListener("click", handleLogout);
}
if (cabLogoutBtn) {
  cabLogoutBtn.addEventListener("click", handleLogout);
}

async function voteFor(id) {
  if (!isLoggedIn()) {
    showAuthError("Для голосования необходимо зарегистрироваться или войти в личный кабинет");
    openCabinetModal("register");
    return;
  }
  if (isAdminUser()) {
    showAuthError("Аккаунт администратора предназначен для подтверждения присутствия участников.");
    return;
  }
  if (!isUserPresent()) {
    showAuthError("Право на голосование открывается только после подтверждения вашего присутствия от администратора в БЗДК.");
    return;
  }
  if (myVote() || votingInProgress) return;
  votingInProgress = true;
  voteGrid.querySelectorAll("button").forEach((b) => (b.disabled = true));

  if (location.protocol === "file:") {
    const counts = localCounts();
    counts[id] = (counts[id] || 0) + 1;
    writeJSON(LS_COUNTS, counts);
    setMyVoteForUser(currentUser.login, id);
    votingInProgress = false;
    updateAuthUI();
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
      showAuthError("Сессия истекла — пожалуйста, войдите в личный кабинет снова");
      renderVoteCards();
      return;
    }
    if (res.status === 403) {
      votingInProgress = false;
      showAuthError(
        (data && data.error) ||
          "Право на голосование открывается только после подтверждения вашего присутствия администратором в БЗДК."
      );
      syncVotesFromServer();
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
    if (voteAuth) voteAuth.hidden = false;
    voteSub.textContent = open
      ? "Таблица результатов — голоса подтверждённых участников в БЗДК"
      : "Зарегистрируйтесь заранее — результаты голосования откроются во время финала 8 декабря в 17:00";
    if (open) syncVotesFromServer();
  }
  if (voteGrid) {
    voteGrid.hidden = !open;
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
// Синхронизируем статус присутствия и общие голоса со всех устройств (только в активной вкладке)
setInterval(() => {
  if (!document.hidden && (voteIsOpen() || isLoggedIn())) {
    syncVotesFromServer();
  }
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
    const count = isMobile ? 56 : 120;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const s = document.createElement("span");
      s.className = "h-star";
      const r = Math.random();
      const size = r < 0.45 ? 1 : r < 0.78 ? 1.5 : r < 0.93 ? 2 : 2.7;
      s.style.width = s.style.height = size + "px";
      s.style.left = (Math.random() * 50).toFixed(3) + "%";
      s.style.top = (Math.random() * 100).toFixed(3) + "%";
      s.style.setProperty("--d", (2.2 + Math.random() * 4).toFixed(2) + "s");
      s.style.setProperty("--dl", (-Math.random() * 6).toFixed(2) + "s");
      s.style.setProperty("--o", (0.4 + Math.random() * 0.55).toFixed(2));
      if (size >= 2) {
        s.classList.add("h-star--glow");
        s.style.setProperty("--star-c", Math.random() < 0.5 ? "#8ce0ff" : "#ffffff");
      } else if (Math.random() < 0.32) {
        s.style.setProperty("--star-c", "#93d5ff");
      }
      frag.appendChild(s);
    }
    track.appendChild(frag);
    track.innerHTML += track.innerHTML;
    if (!hero) {
      track.style.animationDuration = (210 + Math.random() * 110).toFixed(0) + "s";
    }
  });

  // Добавляем на все остальные секции и подвал такие же космические элементы, как на главном экране:
  // единый непрерывный S-образный млечный путь (stardust), 3D гранёные звёзды, туманность, орбиты, метеоры
  const sections = document.querySelectorAll(".section, .footer");
  sections.forEach((sec, idx) => {
    const isAlt = idx % 2 === 1; // Hero начинается слева вверху (x=180), плавно огибает заголовок и выходит справа внизу (x=1260). Поэтому секция 0 (#about) продолжает шлейф справа налево (1260 -> 180), секция 1 — слева направо (180 -> 1260) и так далее по всему сайту.
    const curveId = isAlt ? "#stardustCurveAlt" : "#stardustCurve";
    const dashId = isAlt ? "#stardustDashAlt" : "#stardustDash";
    const starsMarkup = isAlt
      ? `
          <circle cx="224" cy="143" r="2.3" opacity=".85"/>
          <circle cx="490" cy="263" r="2.6" opacity=".9"/>
          <circle cx="745" cy="383" r="1.9" opacity=".8"/>
          <circle cx="1015" cy="537" r="2.3" opacity=".85"/>
          <circle cx="1174" cy="675" r="2.8" opacity=".9"/>
          <circle cx="1244" cy="817" r="2.4" opacity=".85"/>
        `
      : `
          <circle cx="1216" cy="143" r="2.3" opacity=".85"/>
          <circle cx="950" cy="263" r="2.6" opacity=".9"/>
          <circle cx="695" cy="383" r="1.9" opacity=".8"/>
          <circle cx="425" cy="537" r="2.3" opacity=".85"/>
          <circle cx="266" cy="675" r="2.8" opacity=".9"/>
          <circle cx="196" cy="817" r="2.4" opacity=".85"/>
        `;
    const altOrbit = idx % 2 === 1 ? " section__orbit--alt" : "";
    const shootDelay1 = (1.5 + (idx * 3.1) % 9).toFixed(1);
    const shootDelay2 = (6.2 + (idx * 2.7) % 10).toFixed(1);

    const cosmicWrap = document.createElement("div");
    cosmicWrap.className = "section-cosmic-bg";
    cosmicWrap.setAttribute("aria-hidden", "true");
    cosmicWrap.innerHTML = `
      <div class="section__glow"></div>
      <div class="section__orbit${altOrbit}"></div>
      <svg class="section__stardust" viewBox="0 0 1440 960" preserveAspectRatio="none">
        <g fill="none" stroke="url(#stardustHeroGrad)" stroke-linecap="round">
          <use href="${curveId}" stroke-width="62" stroke-opacity=".018"/>
          <use href="${curveId}" stroke-width="44" stroke-opacity=".026"/>
          <use href="${curveId}" stroke-width="30" stroke-opacity=".035"/>
          <use href="${curveId}" stroke-width="20" stroke-opacity=".048"/>
          <use href="${curveId}" stroke-width="12" stroke-opacity=".065"/>
          <use href="${curveId}" stroke-width="6" stroke-opacity=".095"/>
          <use href="${curveId}" stroke-width="3" stroke-opacity=".14"/>
          <use href="${curveId}" stroke-width="1.4" stroke-opacity=".48"/>
        </g>
        <use href="${dashId}" fill="none" stroke="#8ce0ff" stroke-width="1" stroke-dasharray="2 14" stroke-linecap="round" opacity=".5"/>
        <g fill="#ffffff">${starsMarkup}</g>
      </svg>
      <svg class="section-chrome-star section-chrome-star--l"><use href="#chrome-star"/></svg>
      <svg class="section-chrome-star section-chrome-star--r"><use href="#chrome-star"/></svg>
      <svg class="section-chrome-star section-chrome-star--sm"><use href="#chrome-star"/></svg>
      <div class="hero-shoot" style="top:18%;left:14%;animation:shootStar 14s ease-in ${shootDelay1}s infinite"></div>
      <div class="hero-shoot" style="top:62%;left:52%;animation:shootStar 18s ease-in ${shootDelay2}s infinite"></div>
    `;
    sec.insertBefore(cosmicWrap, sec.firstChild);
  });
})();

// ============================================================
// ФОНОВАЯ МУЗЫКА
// Полностью автоматический запуск при открытии сайта (без кнопок)
// ============================================================
(function initBackgroundMusic() {
  const audio = document.getElementById("bgMusic");
  if (!audio) return;

  const TARGET_VOLUME = 0.32;
  let fadeTimer = null;
  let isUnlocked = false;

  function fadeVolume(target, duration) {
    if (fadeTimer) clearInterval(fadeTimer);
    const start = audio.volume;
    const stepTime = 40;
    const steps = Math.max(1, Math.floor(duration / stepTime));
    let currentStep = 0;
    fadeTimer = setInterval(() => {
      currentStep++;
      const progress = Math.min(1, currentStep / steps);
      audio.volume = Math.max(0, Math.min(1, start + (target - start) * progress));
      if (progress >= 1) {
        clearInterval(fadeTimer);
        fadeTimer = null;
      }
    }, stepTime);
  }

  // 1. Прямая попытка немедленного запуска со звуком
  function attemptDirectPlay() {
    audio.muted = false;
    audio.volume = TARGET_VOLUME;
    const promise = audio.play();
    if (promise !== undefined) {
      promise
        .then(() => {
          isUnlocked = true;
        })
        .catch(() => {
          // Если браузер заблокировал запуск со звуком без действия пользователя:
          // немедленно запускаем воспроизведение в muted-режиме (разрешено 100% браузеров)
          // и мгновенно активируем звук при любом первом взаимодействии
          startMutedWithGestureUnlock();
        });
    }
  }

  // 2. Muted-запуск + автоматическое включение звука при любом первом действии на странице
  function startMutedWithGestureUnlock() {
    if (isUnlocked) return;
    audio.muted = true;
    audio.volume = TARGET_VOLUME;
    const mutedPromise = audio.play();
    if (mutedPromise !== undefined) {
      mutedPromise.catch(() => {});
    }

    const unlockEvents = [
      "pointerdown", "touchstart", "mousedown", "click", "keydown",
      "scroll", "wheel", "mousemove", "pointermove"
    ];

    function tryUnmute() {
      if (isUnlocked) return;
      audio.muted = false;
      audio.volume = 0;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            isUnlocked = true;
            removeUnlockListeners();
            fadeVolume(TARGET_VOLUME, 900);
          })
          .catch(() => {
            audio.muted = true;
          });
      } else {
        isUnlocked = true;
        removeUnlockListeners();
        audio.volume = TARGET_VOLUME;
      }
    }

    function removeUnlockListeners() {
      unlockEvents.forEach((evt) => {
        window.removeEventListener(evt, tryUnmute, { capture: true });
        document.removeEventListener(evt, tryUnmute, { capture: true });
      });
    }

    unlockEvents.forEach((evt) => {
      window.addEventListener(evt, tryUnmute, { capture: true, passive: true });
      document.addEventListener(evt, tryUnmute, { capture: true, passive: true });
    });
  }

  // Запуск при открытии сайта
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attemptDirectPlay);
  } else {
    attemptDirectPlay();
  }
  window.addEventListener("load", () => {
    if (audio.paused) attemptDirectPlay();
  });
})();

// ---------- Всплывающая плашка: Cookie и согласие на сбор персональных данных ----------
(function initCookieConsent() {
  const banner = document.getElementById("cookieConsentBanner");
  const acceptBtn = document.getElementById("cookieAcceptBtn");
  if (!banner || !acceptBtn) return;

  const CONSENT_STORAGE_KEY = "lp26_cookie_pd_consent_v1";
  const CONSENT_COOKIE_NAME = "lp26_cookie_pd_consent";

  function hasConsent() {
    try {
      if (localStorage.getItem(CONSENT_STORAGE_KEY) === "1") return true;
    } catch (e) {}
    return document.cookie.split(";").some((c) => c.trim().startsWith(CONSENT_COOKIE_NAME + "=1"));
  }

  function saveConsent() {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, "1");
    } catch (e) {}
    document.cookie =
      CONSENT_COOKIE_NAME + "=1; path=/; max-age=" + 60 * 60 * 24 * 365 + "; SameSite=Lax";
  }

  if (!hasConsent()) {
    banner.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        banner.classList.add("is-visible");
      });
    });
  }

  acceptBtn.addEventListener("click", () => {
    saveConsent();
    banner.classList.remove("is-visible");
    setTimeout(() => {
      banner.hidden = true;
    }, 380);
  });
})();

// Регистрация участников проходит в официальной группе конкурса ВКонтакте:
// https://vk.com/thebestprof (анкета: ФИО, факультет и группа, контакты, согласие на обработку ПД).
