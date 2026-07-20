/* ============================================================================
   report-appeal.js — АВТОПОДАЧА АПЕЛЛЯЦИИ ПОСЛЕ ЗАМЕЧАНИЯ
   Страница «Полный отчёт по проверкам» (show-entire-crit.php).

   Задача (клиент 2026-07-18): автоматически нажимать «2. Апелляция подана»
   (чтобы по каждому замечанию уходило уведомление) в ДВУХ случаях:
     A) пользователь отправил замечание через модалку «Добавление замечания»
        (кнопка «Отправить» = #commentCrit);
     B) пользователь ИЗМЕНИЛ хотя бы одно покомментарийное поле пункта анкеты
        и нажал «Сохранить комментарии» (#save_comments).
   Оба случая ведут к одной отложенной подаче апелляции (см. ниже).

   ⚠️ Почему через localStorage, а не «клик за кликом»: и «Отправить»/«Сохранить»,
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
    form.addEventListener("submit", function (e) {
      /* ⚠️ Отправку мог отменить кто-то до нас — платформенный
         onsubmit="return validate()" отменяет её, но всплытие НЕ останавливает,
         так что мы всё равно сюда попадаем. Без этой проверки флаг остался бы
         висеть, и любая перезагрузка в течение TTL молча подала бы апелляцию:
         статус ушёл бы на сервер, уведомления разослались, откатить нельзя.
         Инлайновый обработчик платформы зарегистрирован раньше нашего, значит
         к этому моменту отмена уже видна. */
      if (e.defaultPrevented) return;
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
        /* Форма модалки появляется/переинициализируется — перевешиваем.
           ⚠️ Не одна попытка через 300 мс, а несколько: модалку строит
           jQuery/AJAX, и на медленной сети форма с #commentCrit к этому моменту
           ещё не существует. Тогда слушатель не вешался вовсе, флаг не
           ставился, апелляция не подавалась — внешне «срабатывает через раз».
           armOnCommentSubmit идемпотентен (data-lk-appeal-armed), так что
           лишние попытки безвредны. */
        [150, 400, 900, 1800].forEach(function (ms) {
          setTimeout(armOnCommentSubmit, ms);
        });
      });
    }
  }

  /* ---- шаг 1b: «Сохранить комментарии» с изменёнными полями пунктов ----
     У каждого пункта анкеты есть поле «Поле для подачи апелляций» — это
     input[type=text] внутри формы кнопки #save_comments (~45 штук). Клиент:
     если пользователь ИЗМЕНИЛ хотя бы один такой комментарий и нажал
     «Сохранить комментарии» → тоже подать «2. Апелляция подана».
     «Изменил» = снимок значений всех полей на ЗАГРУЗКЕ не совпал со снимком в
     момент submit (правка или добавление любого поля; если поле вернули к
     исходному — изменения нет). Флаг, TTL и сама подача — те же, что у модалки:
     форма постит на страницу с перезагрузкой, поэтому апелляция срабатывает на
     следующей загрузке (см. firePendingAppeal). */
  function armOnCommentsSave() {
    var saveBtn = document.getElementById("save_comments");
    var form = saveBtn && saveBtn.closest("form");
    if (!form || form.getAttribute("data-lk-appeal-armed")) return;
    form.setAttribute("data-lk-appeal-armed", "1");
    function snapshot() {
      var fs = form.querySelectorAll('input[type="text"], textarea');
      var v = "";
      for (var i = 0; i < fs.length; i++) v += fs[i].value + "\u0001";
      return v;
    }
    var baseline = snapshot(); /* значения на момент загрузки страницы */
    form.addEventListener("submit", function (e) {
      /* та же защита, что и у модалки: отменённая отправка не должна оставлять
         флаг — иначе апелляция подастся сама на ближайшей перезагрузке */
      if (e.defaultPrevented) return;
      if (snapshot() !== baseline && isActive(appealBtn())) {
        lsSet(FLAG_KEY, JSON.stringify({ crit: CRIT_ID, ts: nowMs() }));
      }
    });
  }

  /* ---- шаг 2: на загрузке подаём отложенную апелляцию ----
     СВОЙ флаг снимаем СРАЗУ (до клика): апелляция сама перезагрузит страницу, и
     без раннего снятия он сработал бы повторно — бесконечная подача.
     ⚠️ А вот ЧУЖОЙ флаг трогать нельзя. Раньше снятие стояло до проверки
     CritID, и вкладка с другим отчётом съедала флаг, поставленный в соседней:
     та догружалась уже без него, апелляция молча не подавалась, уведомления не
     уходили — ровно тот отказ, который выглядит как «иногда не срабатывает».
     Чужой ПРОСРОЧЕННЫЙ всё же подчищаем, чтобы мусор не копился. */
  function firePendingAppeal() {
    var raw = lsGet(FLAG_KEY);
    if (!raw) return;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      lsDel(FLAG_KEY); /* не разобрали — это мусор, убираем */
      return;
    }
    if (!data || data.crit !== CRIT_ID) {
      if (!data || nowMs() - (data.ts || 0) > TTL_MS) lsDel(FLAG_KEY);
      return; /* флаг от другого отчёта — оставляем ему */
    }
    lsDel(FLAG_KEY);
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
    watchCommentButton();    /* модалка «Добавление замечания» */
    armOnCommentsSave();      /* «Сохранить комментарии» с изменёнными полями */
    firePendingAppeal();      /* отложенная подача апелляции после reload */
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
