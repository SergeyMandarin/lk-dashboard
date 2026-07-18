/* ============================================================================
   report-appeal.js — АВТОПОДАЧА АПЕЛЛЯЦИИ ПОСЛЕ ЗАМЕЧАНИЯ
   Страница «Полный отчёт по проверкам» (show-entire-crit.php).

   Задача (клиент 2026-07-18): когда пользователь отправляет замечание через
   модалку «Добавление замечания», сразу после этого автоматически нажимать
   кнопку «2. Апелляция подана» — чтобы по каждому замечанию уходило уведомление.

   ⚠️ Почему через localStorage, а не «клик за кликом»: и «Отправить» (замечание),
   и «2. Апелляция подана» — это ОТДЕЛЬНЫЕ POST-формы с ПЕРЕЗАГРУЗКОЙ страницы.
   Нельзя нажать обе подряд: первая отправка уводит страницу. Поэтому:
     1) при отправке замечания ставим одноразовый флаг в localStorage;
     2) страница перезагружается (замечание сохранено);
     3) на новой загрузке видим флаг → жмём «Апелляция подана» → ещё перезагрузка.
   Да, две перезагрузки подряд — иначе с серверными формами никак.

   Решения клиента:
   — апелляцию подаём ТОЛЬКО если кнопка есть и активна (не disabled/не скрыта);
   — флаг сгорает через 2 минуты (если замечание отправлено, а страница не
     перезагрузилась — не выстреливаем неожиданно позже).

   Отдельный файл, а НЕ часть sidebar-toggle.js: интерфейс этой страницы другой,
   мешать не хочется. Подключается своим загрузчиком на show-entire-crit.php.
   ============================================================================ */
(function () {
  "use strict";

  var FLAG_KEY = "lk_appeal_after_note";
  var TTL_MS = 120000; /* 2 минуты — согласовано с клиентом */
  var APPEAL_VALUE = "2. Апелляция подана"; /* value стабилен; id qc_<N> динамический */

  /* Гейт по отчёту: без CritID это не страница отчёта — выходим. */
  var CRIT_ID = (location.search.match(/CritID=(\d+)/) || [])[1];
  if (!CRIT_ID) return;

  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  }
  function lsDel(k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  }

  /* Кнопку апелляции ищем по ТЕКСТУ, а не по id: id вида qc_1808 у каждого
     отчёта свой. Рядом есть другие статус-кнопки («4. Период закрыт»,
     «5. Отчёт принят») — точное совпадение value их не заденет. */
  function appealBtn() {
    var btns = document.querySelectorAll(
      'input[type="submit"], input[type="button"]'
    );
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].value || "").trim() === APPEAL_VALUE) return btns[i];
    }
    return null;
  }

  /* «Активна» = существует, не disabled и реально на странице (offsetParent
     null у display:none-предка). */
  function isActive(btn) {
    return !!(btn && !btn.disabled && btn.offsetParent !== null);
  }

  /* ---- шаг 1: при отправке замечания ставим флаг ----
     Кнопка «Отправить» в модалке = input#commentCrit, её форма постит на
     show-entire-crit.php (перезагрузка). Слушаем submit ФОРМЫ — сработает и на
     клик, и на Enter. Флаг ставим ТОЛЬКО если апелляцию реально можно подать
     (кнопка активна) — иначе незачем. */
  function armOnCommentSubmit() {
    var commentBtn = document.getElementById("commentCrit");
    var form = commentBtn && commentBtn.closest("form");
    if (!form || form.getAttribute("data-lk-appeal-armed")) return;
    form.setAttribute("data-lk-appeal-armed", "1");
    form.addEventListener("submit", function () {
      if (isActive(appealBtn())) {
        lsSet(
          FLAG_KEY,
          JSON.stringify({ crit: CRIT_ID, ts: nowMs() })
        );
      }
    });
  }

  /* Модалка добавляется в DOM по клику «Добавление замечания» — форма может
     появиться позже. Ставим слушатель и сейчас, и по клику на #thenote. */
  function watchCommentButton() {
    armOnCommentSubmit();
    var link = document.getElementById("thenote");
    if (link && !link.getAttribute("data-lk-appeal-watch")) {
      link.setAttribute("data-lk-appeal-watch", "1");
      link.addEventListener("click", function () {
        /* форма модалки появляется/переинициализируется — перевешиваем */
        setTimeout(armOnCommentSubmit, 300);
      });
    }
  }

  /* ---- шаг 2: на загрузке подаём отложенную апелляцию ----
     Флаг снимаем СРАЗУ (до клика): апелляция сама перезагрузит страницу, и без
     раннего снятия флаг сработал бы повторно — бесконечная подача. */
  function firePendingAppeal() {
    var raw = lsGet(FLAG_KEY);
    if (!raw) return;
    lsDel(FLAG_KEY);
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!data || data.crit !== CRIT_ID) return; /* флаг от другого отчёта */
    if (nowMs() - data.ts > TTL_MS) return; /* просрочен — не стреляем */
    var btn = appealBtn();
    if (isActive(btn)) {
      /* небольшая задержка — дать странице дорисоваться после reload */
      setTimeout(function () {
        if (isActive(btn)) btn.click();
      }, 350);
    }
  }

  /* Date.now доступен в обычном браузерном скрипте (это НЕ workflow-движок). */
  function nowMs() {
    return Date.now();
  }

  function init() {
    watchCommentButton();
    firePendingAppeal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
