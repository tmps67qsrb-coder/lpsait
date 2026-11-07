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
const VOTE_OPEN_AT = new Date("2026-12-08T16:30:00+03:00").getTime();
const LS_AUTH = "lp26_auth_user";
const LS_VOTES_BY_USER = "lp26_votes_by_user_v2";
const LS_COUNTS = "lp26_counts_v2";
const LS_LOCAL_PROFILES = "lp26_local_profiles";

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
const cabProfileName = document.getElementById("cabProfileName");
const cabProfilePhone = document.getElementById("cabProfilePhone");
const cabProfileGroup = document.getElementById("cabProfileGroup");
const cabProfileSupporter = document.getElementById("cabProfileSupporter");
const cabProfileVote = document.getElementById("cabProfileVote");
const cabGoVoteBtn = document.getElementById("cabGoVoteBtn");
const cabLogoutBtn = document.getElementById("cabLogoutBtn");

const readJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const writeJSON = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch {}
};

let currentUser = readJSON(LS_AUTH, null); // { login, token, profile }
if (currentUser && (!currentUser.token || !currentUser.login)) {
  currentUser = null;
  try { localStorage.removeItem(LS_AUTH); } catch {}
}
let votingInProgress = false;
let isNotBmstu = false;

const voteIsOpen = () => voteDemo || Date.now() >= VOTE_OPEN_AT;
const isLoggedIn = () => Boolean(currentUser && currentUser.login && currentUser.token);

function normalizePhoneClient(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
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

const myVote = () => (currentUser ? getMyVoteForUser(currentUser.login) : null);
const localCounts = () => readJSON(LS_COUNTS, {});
const displayName = (f, i) => [f.name, f.surname].filter(Boolean).join(" ").trim() || "Участник " + (i + 1);

function updateAuthUI() {
  const loggedIn = isLoggedIn();
  const prof = (currentUser && currentUser.profile) || {};
  const displayUser = prof.fullName || (currentUser && currentUser.login) || "";

  if (voteAuthFormWrap) voteAuthFormWrap.hidden = loggedIn;
  if (voteUserBar) voteUserBar.hidden = !loggedIn;
  if (voteUserName && loggedIn) voteUserName.textContent = displayUser;
  if (voteAuthError) voteAuthError.hidden = true;

  if (headerCabinetLabel) {
    headerCabinetLabel.textContent = "Личный кабинет";
  }

  if (cabinetGuestView) cabinetGuestView.hidden = loggedIn;
  if (cabinetProfileView) cabinetProfileView.hidden = !loggedIn;

  if (loggedIn) {
    if (cabProfileName) cabProfileName.textContent = prof.fullName || currentUser.login;
    if (cabProfilePhone) cabProfilePhone.textContent = prof.phone || currentUser.login;
    if (cabProfileGroup) {
      cabProfileGroup.textContent = prof.notBmstu
        ? "Не из МГТУ им. Н.Э. Баумана"
        : prof.group || "МГТУ им. Н.Э. Баумана";
    }
    if (cabProfileSupporter) cabProfileSupporter.textContent = prof.supporterOf || "Просто зритель";
    if (cabProfileVote) {
      const my = myVote();
      if (my && my.id) {
        const chosenFin = FINALISTS.find((f) => f.id === my.id);
        cabProfileVote.textContent = chosenFin
          ? `Голос отдан: ${chosenFin.name}`
          : "Голос учтён";
      } else if (voteIsOpen()) {
        cabProfileVote.textContent = "Голосование открыто — выберите кандидата";
      } else {
        cabProfileVote.textContent = "Голосование откроется 8 декабря в 16:30";
      }
    }
  }

  // Без обязательной регистрации и входа карточки голосования не открываются
  if (voteGrid) {
    voteGrid.hidden = !(voteIsOpen() && loggedIn);
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

function renderVoteCards() {
  const loggedIn = isLoggedIn();
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
  if (currentUser && data.profile && typeof data.profile === "object") {
    currentUser.profile = data.profile;
    writeJSON(LS_AUTH, currentUser);
  }

  updateAuthUI();

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

    // Обязательная проверка каждого пункта
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
          token: data.token,
          profile: data.profile || {
            phone,
            fullName,
            group: groupVal,
            notBmstu: isNotBmstu,
            supporterOf,
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
      // Локальный режим при открытии по file:// — храним только криптографический хэш пароля
      const pwdHash = await hashPasswordClient(password);
      const localProfiles = readJSON(LS_LOCAL_PROFILES, {});
      if (localProfiles[phone]) {
        showRegError("Этот номер телефона уже зарегистрирован. Перейдите во вкладку «Вход».");
        return;
      }
      const profile = { phone, fullName, group: groupVal, notBmstu: isNotBmstu, supporterOf };
      localProfiles[phone] = { ...profile, passwordHash: pwdHash };
      writeJSON(LS_LOCAL_PROFILES, localProfiles);
      currentUser = { login: phone, token: "local." + Date.now(), profile };
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

// Отправка входа
if (cabinetLoginForm) {
  cabinetLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showLoginError("");

    const rawLogin = (loginPhoneInput.value || "").trim();
    const normPhone = normalizePhoneClient(rawLogin);
    const loginKey = normPhone || rawLogin;
    const password = (loginPassInput.value || "").trim();

    if (!loginKey || !password) {
      showLoginError("Введите номер телефона и пароль");
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
          showLoginError((data && data.error) || "Неверный номер телефона или пароль");
          return;
        }
        currentUser = {
          login: data.login || loginKey,
          token: data.token,
          profile: data.profile || { phone: loginKey, fullName: loginKey },
        };
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
      const localProfiles = readJSON(LS_LOCAL_PROFILES, {});
      const found = localProfiles[loginKey];
      if (!found || !pwdHash || found.passwordHash !== pwdHash) {
        showLoginError("Неверный номер телефона или пароль");
        return;
      }
      currentUser = {
        login: loginKey,
        token: "local." + Date.now(),
        profile: {
          phone: found.phone,
          fullName: found.fullName,
          group: found.group,
          notBmstu: found.notBmstu,
          supporterOf: found.supporterOf,
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
  const loggedIn = isLoggedIn();
  if (open !== voteStateShown) {
    voteStateShown = open;
    voteLocked.hidden = open;
    if (voteAuth) voteAuth.hidden = !open;
    voteSub.textContent = open
      ? "Выбери лучшего профорга МГТУ — один аккаунт, один голос"
      : "Выбор лучшего профорга откроется вместе с финалом конкурса";
    if (open) syncVotesFromServer();
  }
  if (voteGrid) {
    voteGrid.hidden = !(open && loggedIn);
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
