/* ============================================================
   Боковое меню личного кабинета: открытие/сворачивание по кнопке-бургеру.

   - Уходим от раскрытия по hover к явному переключению кнопкой.
   - В раскрытом состоянии меню показывает подписи и СДВИГАЕТ интерфейс вправо.
   - Состояние запоминается в localStorage.

   Внешний вид задаётся в "Default-analyst-dashboard 4.css" (блок "БОКОВОЕ МЕНЮ").
   Состояние — класс "sb-open" на элементе HTML.

   ИСТОРИЯ ПРО СИМВОЛ "МЕНЬШЕ" (снято 2026-07-16): раньше файл вставляли прямо
   в поле ввода JS личного кабинета, а оно обрезает содержимое на первом же
   символе "меньше" (принимает за начало HTML-тега). Теперь в поле лежит только
   маленький загрузчик, а сам файл едет с jsDelivr и через поле НЕ проходит —
   значит ограничение к нему больше не относится, писать "меньше" можно.
   ⚠️ Ограничение по-прежнему в силе для САМОГО ЗАГРУЗЧИКА в поле ЛК.
   Существующие обходы (сравнения через !==, сборка скобок из кодов символов)
   оставлены как есть: они рабочие, трогать их только при правках по существу.

   Для "без мигания": сохранённое состояние применяется синхронно в самом верху,
   поэтому файл желательно подключать как можно раньше (в head). Класс вешается на
   элемент HTML, т.к. на момент выполнения тела BODY может ещё не быть.
   ============================================================ */
(function () {
  "use strict";

  /* rem-база: 1rem = 10px (62.5% от браузерных 16px) — CSS уже ставит это же
     правилом html{font-size:62.5%} (главный источник, работает ВЕЗДЕ, включая
     страницы без нашего JS). Дублируем здесь синхронно, самым первым действием,
     как явное соответствие и на случай гонки до применения внешнего CSS. */
  document.documentElement.style.fontSize = "62.5%";

  /* Мобильный вьюпорт: у страницы НЕТ meta viewport, поэтому телефоны рендерят её
     в ~980px (десктопный фолбэк) и наши @media (max-width:767) не срабатывают —
     виден сломанный десктоп. Добавляем device-width СИНХРОННО и как можно раньше
     (файл желательно подключать в head), чтобы телефон сразу считал реальную ширину.
     На десктопе device-width = ширина окна, поэтому там ничего не меняется. */
  (function ensureViewport() {
    if (document.querySelector('meta[name="viewport"]')) return;
    var m = document.createElement("meta");
    m.name = "viewport";
    m.content = "width=device-width, initial-scale=1";
    (document.head || document.documentElement).appendChild(m);
  })();

  var OPEN_CLASS = "sb-open";
  var STORAGE_KEY = "lk-sidebar-open";
  var root = document.documentElement;

  /* ============================================================
     ТАЙМИНГИ — все в одном месте. Раньше числа были разбросаны по файлу, и по
     месту вызова было не понять, какую гонку каждое из них закрывает. Значения
     подобраны эмпирически на живом ЛК; менять, только понимая, чего ждём.
     ============================================================ */
  /* Тумблер рельсы: контент едет 0.25s (CSS transition). Ждём конец анимации
     плюс запас — иначе пересчёт поймает промежуточную ширину. Полоса/кнопки
     идут чуть позже графиков: их размер зависит от уже пересчитанного контента. */
  var RAIL_ANIM_MS = 320;
  var RAIL_ANIM_BARS_MS = 340;
  /* Дебаунс тяжёлого ресайз-обработчика (подробности — у самого обработчика). */
  var RESIZE_DEBOUNCE_MS = 150;
  /* Дебаунс MutationObserver: AJAX-контент приезжает пачкой мутаций — гоняем
     enhanceReports один раз на пачку, а не на каждую. */
  var ENHANCE_DEBOUNCE_MS = 150;
  /* Отчёты и графики платформа подтягивает по AJAX БЕЗ события готовности —
     точного момента нет. Поэтому повторяем проходы несколько раз с нарастающей
     задержкой (страховка на медленный ответ), а поздние догрузки ловит
     MutationObserver. Всё внутри идемпотентно, лишний проход безвреден. */
  var CHART_RETRY_MS = [500, 1500];
  var REPORTS_RETRY_MS = [800, 1800];
  /* После window.load ширина уже посчитана с учётом viewport-меты (телефон
     перевёрстан из 980 в device-width) — повторяем режимные пересчёты. */
  var POST_LOAD_MS = 300;
  /* Сколько сообщение об ошибке висит на кнопке экспорта до возврата исходной
     надписи. Короткое — для «таблица не найдена» (всё ясно сразу), длинное —
     когда юзеру стоит успеть заметить отсылку к консоли. */
  var BTN_MSG_SHORT_MS = 2000;
  var BTN_MSG_LONG_MS = 3000;
  /* Blob-ссылка на готовый файл: Chrome стартует скачивание синхронно по click,
     но освобождаем с запасом — отзыв раньше времени убил бы загрузку. */
  var BLOB_TTL_MS = 10000;

  /* Высота нижнего таб-бара варианта A. Держим ЗДЕСЬ только как справочное
     значение для JS-расчётов; источник правды для вёрстки — CSS-переменная
     --lk-tabbar-h (её же читают отступы контента и позиция полосы hbar),
     чтобы значение не разъехалось между файлами. */
  var TABBAR_H_PX = 56;

  function isSaved() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  /* 1) Состояние применяем сразу (синхронно), до отрисовки при раннем подключении. */
  root.classList.toggle(OPEN_CLASS, isSaved());

  /* Пере-расчёт живых графиков Highcharts под текущую ширину контейнера.
     ⚠️ НЕ просто c.reflow() — платформа при рендере графика (AJAX) всегда
     задаёт ЯВНУЮ chart.options.chart.width (напр. 1406), а reflow() у
     Highcharts — no-op, если у графика уже стоит явная ширина (документировано
     поведение: "if a size is explicitly set... reflow will not resize it").
     Из-за этого при сворачивании/раскрытии рельсы контейнер меняет реальную
     ширину, а SVG графика — нет: тултип (отдельный HTML-div с left/top в
     координатах СТАРОЙ ширины) визуально отрывается от своего фона-подложки.
     Лечится ТОЛЬКО принудительным setSize() под текущую ширину родителя
     контейнера (не самого c.container — у него тоже может быть заморожен
     inline-width от старого рендера). */
  /* Высота графика на ТЕЛЕФОНЕ — доля от его ширины, по типу графика.
     Платформа задаёт высоту один раз под десктоп и больше не трогает: на
     телефоне ширина ужимается до ~340, а высота остаётся десктопной (видели
     341x1165) — донат теряется в пустоте на пол-экрана. Пропорции подобраны
     живьём: круговой гейдж почти квадратный, линия — приземистее.
     Возвращаем 0, если тип не знаком: значит высоту не трогаем вовсе. */
  function phoneChartHeight(chart, w) {
    var type =
      (chart.options && chart.options.chart && chart.options.chart.type) || "";
    if (type === "solidgauge" || type === "pie") return Math.round(w * 0.72);
    if (type === "spline" || type === "line" || type === "area") {
      return Math.round(w * 0.62);
    }
    if (type === "column" || type === "bar") return Math.round(w * 0.75);
    return 0;
  }

  /* Заголовок/подзаголовок считаем ПУСТЫМ, если после вычистки тегов переноса
     строки и неразрывных пробелов не осталось текста. Платформа шлёт сюда
     ровно такие «пустышки» из тегов br — визуально пусто, но Highcharts честно
     резервирует под них место по заданному шрифту (28px!). На узком экране это
     съедало 143px из 246 (73 сверху + 70 снизу), и гейджу оставалось 103px —
     он получался крошечным. ⚠️ Убирать можно ТОЛЬКО пустые: на «CX-метриках»
     подзаголовок несёт текст вопроса анкеты. */
  var BR_TAG_RE = /<br\s*\/?>/gi;

  function isBlankChartTitle(text) {
    if (text == null) return true;
    return (
      String(text)
        .replace(BR_TAG_RE, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, "")
        .length === 0
    );
  }

  /* Пустые заголовки убираем один раз на график: флаг на инстансе. Иначе
     update() гонялся бы на каждый reflow (а он идёт и по AJAX, и по ресайзу). */
  function dropBlankChartTitles(c) {
    if (c.__lkTitlesCleaned) return;
    var upd = {};
    if (c.options.title && isBlankChartTitle(c.options.title.text)) {
      upd.title = { text: null };
    }
    if (c.options.subtitle && isBlankChartTitle(c.options.subtitle.text)) {
      upd.subtitle = { text: null };
    }
    c.__lkTitlesCleaned = true;
    if (upd.title || upd.subtitle) c.update(upd, false);
  }

  /* Полукруглый гейдж («Общий результат») на телефоне.
     Платформа задаёт pane под десктоп: center ['50%','90%'], size '85%',
     дуга -90..90 (верхняя половина). Беда в том, что Highcharts считает size в
     процентах от МЕНЬШЕЙ стороны области построения — на телефоне это высота
     (166 против ширины 321), поэтому дуга выходила диаметром 141 при доступной
     ширине 321: половина карточки пустовала, а «Оценка» с числом жались друг
     к другу в центре крошки.
     Считаем размер в ПИКСЕЛЯХ (Highcharts это принимает) — так не зависим от
     того, от какой стороны берётся процент:
       радиус = min(ширина/2, центр_по_вертикали)
     второе ограничение обязательно: дуга рисуется ВВЕРХ от центра, и при
     слишком большом радиусе её макушку срезает верхний край. */
  var GAUGE_CENTER_Y = 0.96;

  function fitPhoneGauge(c) {
    if (!c.pane || !c.pane[0] || !c.plotWidth || !c.plotHeight) return;
    var centerY = c.plotHeight * GAUGE_CENTER_Y;
    var radius = Math.floor(Math.min(c.plotWidth / 2, centerY));
    if (radius <= 0) return;
    var diameter = radius * 2;
    /* уже подогнан под этот размер — не гоняем update лишний раз */
    if (c.__lkGaugeDiameter === diameter) return;
    c.__lkGaugeDiameter = diameter;
    c.update(
      {
        pane: {
          size: diameter,
          center: ["50%", GAUGE_CENTER_Y * 100 + "%"]
        },
        /* «Оценка» — это yAxis.title, Highcharts кладёт её В ЦЕНТР полукруга,
           ровно туда же, где значение: на узком экране надпись налезала на дугу
           и толкалась с числом. Смысла не теряем — карточка и так называется
           «Общий результат», а число под дугой читается как оценка. */
        yAxis: { title: { text: null } },
        plotOptions: {
          solidgauge: {
            dataLabels: {
              /* рамка вокруг числа на телефоне выглядит артефактом */
              borderWidth: 0,
              backgroundColor: "transparent",
              /* платформа ставит color:"contrast" — Highcharts считает его от
                 фона ТОЧКИ (оранжевая дуга) и мог выдать белый текст на белом
                 фоне карточки: число то видно, то нет. Задаём цвет явно. */
              style: { color: "#3c3c3b", textOutline: "none" }
            }
          }
        }
      },
      false
    );
  }

  /* Подписи осей платформа задаёт в опциях графика: labels.style.fontSize = 27px
     (рассчитано на десктоп-фолбэк 980px). На телефоне это давало обрезанные в
     «1. В…» названия подразделов внизу под графиком.
     ⚠️ Одним CSS не лечится: подписи оси X рисуются через useHTML, то есть это
     HTML-спаны, которым Highcharts ИНЛАЙНОМ проставляет и font-size, и width с
     text-overflow:ellipsis — ширину, посчитанную под 27px, !important не
     исправит, останется многоточие. Поэтому меняем сами опции: тогда Highcharts
     пересчитает и ширину подписи, и место под неё в раскладке.
     Идём по всем осям массивом: c.update({xAxis:{…}}) применился бы только к
     первой. */
  var PHONE_AXIS_FONT = "11px";

  function fitPhoneAxisLabels(c) {
    if (c.__lkAxisFont === PHONE_AXIS_FONT) return;
    c.__lkAxisFont = PHONE_AXIS_FONT;
    var opt = { labels: { style: { fontSize: PHONE_AXIS_FONT } } };
    [].concat(c.xAxis || [], c.yAxis || []).forEach(function (ax) {
      if (ax && ax.update) ax.update(opt, false);
    });
  }

  function reflowCharts() {
    if (window.Highcharts && Highcharts.charts) {
      Highcharts.charts.forEach(function (c) {
        if (!c) return;
        try {
          var parent = c.container && c.container.parentElement;
          var w = parent ? parent.clientWidth : 0;
          if (w) {
            /* На телефоне правим и высоту, на остальных режимах — только
               ширину (undefined = не трогать), чтобы не задеть вылизанные
               десктоп и планшет. */
            var phone = isAppMode();
            var h = 0;
            if (phone) {
              dropBlankChartTitles(c);
              /* СТРОГО до setSize: он перерисовывает график, и подписи должны
                 попасть в раскладку уже новым размером — иначе место под ось
                 останется посчитанным под 27px. */
              fitPhoneAxisLabels(c);
              h = phoneChartHeight(c, w);
            }
            c.setSize(w, h || undefined, false);
            /* Гейдж подгоняем СТРОГО ПОСЛЕ setSize: размер дуги считаем от
               plotWidth/plotHeight, а они пересчитываются только там. */
            if (phone && c.options.chart.type === "solidgauge") {
              fitPhoneGauge(c);
            }
          } else {
            c.reflow();
          }
        } catch (e) {}
      });
    }
  }

  function setOpen(open) {
    root.classList.toggle(OPEN_CLASS, open);
    var btn = document.getElementById("lk-burger");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch (e) {}
    /* после анимации сдвига контента перерисовываем графики и полосу */
    setTimeout(reflowCharts, RAIL_ANIM_MS);
    setTimeout(function () {
      updateHBar();
      sizeExportBars();
    }, RAIL_ANIM_BARS_MS);
  }

  function toggle() {
    setOpen(!root.classList.contains(OPEN_CLASS));
  }

  /* 2) Кнопка-бургер — требует BODY, поэтому после готовности DOM. */
  function createBurger() {
    if (document.getElementById("lk-burger")) return;
    var btn = document.createElement("button");
    btn.id = "lk-burger";
    btn.type = "button";
    btn.setAttribute("aria-label", "Открыть/свернуть меню");
    btn.setAttribute(
      "aria-expanded",
      root.classList.contains(OPEN_CLASS) ? "true" : "false"
    );
    /* три полоски бургера — через createElement, без innerHTML с символом тега */
    btn.appendChild(document.createElement("span"));
    btn.appendChild(document.createElement("span"));
    btn.appendChild(document.createElement("span"));
    btn.addEventListener("click", toggle);
    document.body.appendChild(btn);
  }

  /* Иконки разделов средней рельсы: вешаем класс lk-sec-[ключ] по НАЗВАНИЮ
     пункта (не по client-specific cat_id и не по nth-child — порядок и состав
     разделов у клиентов разные, а имена стандартные). Сами иконки — в CSS
     (.upper_tabs_nav li.lk-sec-*). Неизвестные пункты класс не получают и
     остаются на текущей иконке-фолбэке. Пока только русские названия. */
  function tagRailIcons() {
    var MAP = [
      [/общий результат/i, "overall"],
      [/филиал/i, "branches"],
      [/раздел/i, "sections"],
      [/вопрос/i, "questions"],
      [/[сc]водн/i, "summary"],
      [/pdf/i, "pdf"],
      [/артефакт/i, "artifacts"],
      [/статус/i, "status"],
      [/впечатлен/i, "impressions"],
      [/карта/i, "map"],
      [/[cс][xх]-?метрик/i, "satisfaction"],
      [/инструкц/i, "guide"]
    ];
    /* десктопная рельса (.tab_menu_item) + мобильная (#reports_categories li) */
    var items = document.querySelectorAll(
      ".upper_tabs_nav li.tab_menu_item, #reports_categories li"
    );
    [].forEach.call(items, function (li) {
      var txt = (li.textContent || "").trim().toLowerCase();
      MAP.some(function (pair) {
        if (pair[0].test(txt)) {
          li.classList.add("lk-sec-" + pair[1]);
          return true;
        }
        return false;
      });
    });
  }

  /* ============================================================
     Горизонтальный скролл ШИРОКИХ отчётов.
     Проблема: контент таблицы-отчёта шире блока, родная полоса
     прокрутки — внизу высокой таблицы, ниже экрана. Приходится
     крутить страницу вниз к полосе, вести вправо, возвращаться вверх.

     Решение 1: липкая полоса-дублёр (position:fixed) у низа экрана,
       синхронная с активным отчётом. Всегда на виду.
     Решение 2: drag-to-pan (тащим таблицу мышью вбок) + Shift+колесо.

     Оформление — в CSS (#lk-hbar, .lk-pannable). Код без символа
     "меньше" — см. примечание вверху файла (поле JS в ЛК режет тег). */
  /* Свой ползунок (div), а НЕ стилизация нативного скроллбара: Chrome на
     Windows 11 игнорирует "::-webkit-scrollbar", поэтому рисуем полосу сами —
     заодно делаем её жирнее и в акцентном цвете. */
  var HBAR_H = 14;
  var HBAR_SHOW_THRESHOLD = 80;
  var THUMB_MIN = 40;
  var hbar = null;
  var thumb = null;
  var activeScroller = null;
  var hbarScheduled = false;
  var cachedScrollers = [];

  function isWideScroller(el) {
    var ox = getComputedStyle(el).overflowX;
    if (ox !== "auto" && ox !== "scroll") return false;
    return el.scrollWidth - el.clientWidth > 20;
  }

  function collectScrollers() {
    var out = [];
    /* #lk-tview-body — второй адрес намеренно: развёрнутая на весь экран
       таблица физически уезжает из .grid_report_td в оверлей (см. фазу 7),
       и без этой ветки скроллер там становится невидим для полосы #lk-hbar. */
    var nodes = document.querySelectorAll(
      ".grid_report_td center, .grid_report_td div, .grid_report_td table," +
        "#lk-tview-body center, #lk-tview-body div, #lk-tview-body table"
    );
    [].forEach.call(nodes, function (el) {
      if (isWideScroller(el) && out.indexOf(el) === -1) out.push(el);
    });
    return out;
  }

  /* Пересчёт размера/позиции ползунка по прокрутке активного отчёта. */
  function updateThumb() {
    if (!hbar || !thumb || !activeScroller) return;
    var barW = hbar.clientWidth;
    var sw = activeScroller.scrollWidth;
    var cw = activeScroller.clientWidth;
    var maxScroll = sw - cw;
    var tw = Math.max(THUMB_MIN, Math.round((cw / sw) * barW));
    if (tw > barW) tw = barW;
    thumb.style.width = tw + "px";
    var range = barW - tw;
    var ratio = 0;
    if (maxScroll > 0) ratio = activeScroller.scrollLeft / maxScroll;
    thumb.style.left = Math.round(ratio * range) + "px";
  }

  function buildHBar() {
    if (hbar) return;
    hbar = document.createElement("div");
    hbar.id = "lk-hbar";
    thumb = document.createElement("div");
    thumb.id = "lk-hbar-thumb";
    hbar.appendChild(thumb);
    document.body.appendChild(hbar);

    /* Перетаскивание ползунка -> прокрутка активного отчёта. */
    var dragging = false;
    var dsx = 0;
    var dsl = 0;
    var dpid = null;
    thumb.addEventListener("pointerdown", function (e) {
      if (!activeScroller) return;
      dragging = true;
      dsx = e.clientX;
      dsl = activeScroller.scrollLeft;
      dpid = e.pointerId;
      try {
        thumb.setPointerCapture(dpid);
      } catch (err) {}
      e.preventDefault();
      e.stopPropagation();
    });
    thumb.addEventListener("pointermove", function (e) {
      if (!dragging || !activeScroller) return;
      var barW = hbar.clientWidth;
      var range = barW - thumb.offsetWidth;
      var maxScroll = activeScroller.scrollWidth - activeScroller.clientWidth;
      if (range > 0) {
        var dx = e.clientX - dsx;
        activeScroller.scrollLeft = dsl + (dx / range) * maxScroll;
        updateThumb();
      }
      e.preventDefault();
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      try {
        if (dpid !== null) thumb.releasePointerCapture(dpid);
      } catch (err) {}
    }
    thumb.addEventListener("pointerup", endDrag);
    thumb.addEventListener("pointercancel", endDrag);

    /* Клик по дорожке — прыжок на "страницу" в сторону клика. */
    hbar.addEventListener("pointerdown", function (e) {
      if (e.target === thumb || !activeScroller) return;
      var rect = hbar.getBoundingClientRect();
      var clickX = e.clientX - rect.left;
      var page = activeScroller.clientWidth;
      if (clickX > thumb.offsetLeft) activeScroller.scrollLeft += page;
      else activeScroller.scrollLeft -= page;
      updateThumb();
    });
  }

  /* Выбираем "активный" отчёт: видимый на экране И такой, у которого
     родная нижняя полоса ушла ниже вьюпорта. Если он есть — показываем
     дублёр под ним; иначе прячем. */
  function updateHBar() {
    if (!hbar) return;
    var vh = window.innerHeight;
    var best = null;
    var bestVis = 0;
    /* В развёрнутом виде правила другие, и общая логика тут врала: скроллер
       занимает оверлей ровно по высоте экрана, поэтому «родная полоса ушла ниже
       вьюпорта» не выполняется никогда — дублёр не выбирался, activeScroller
       обнулялся, а ползунок замирал на координатах скроллера из карточки.
       В оверлее кандидат ровно один, он всегда на виду, и родной полосы у него
       нет — значит и порогов не нужно. */
    var viewer = root.classList.contains("lk-tview-open")
      ? document.querySelector("#lk-tview-body .lk-pannable")
      : null;
    if (viewer) {
      if (viewer.scrollWidth - viewer.clientWidth > 20) best = viewer;
    } else
      [].forEach.call(cachedScrollers, function (el) {
        if (!el.isConnected) return;
        /* узлы из оверлея сюда попадать не должны: он закрыт */
        if (el.closest("#lk-tview")) return;
        if (!(el.scrollWidth - el.clientWidth > 20)) return;
        var r = el.getBoundingClientRect();
        var visTop = Math.max(r.top, 0);
        var visBottom = Math.min(r.bottom, vh);
        var visH = visBottom - visTop;
        /* высота родной горизонтальной полосы отчёта */
        var sbH = el.offsetHeight - el.clientHeight;
        sbH = sbH > 0 ? sbH : HBAR_H;
        /* дублёр показываем ТОЛЬКО когда родная полоса целиком ушла ниже вьюпорта,
           иначе у нижнего края отчёта на миг видны обе полосы */
        var nativeOffscreen = r.bottom > vh + sbH;
        /* полоса-дублёр всплывала даже когда от блока виден 1px у нижнего края
           экрана (блок ещё практически не виден) — требуем отступ сверху блока,
           прежде чем показывать полосу (подобрано на глаз). */
        if (visH > HBAR_SHOW_THRESHOLD && nativeOffscreen && visH > bestVis) {
          bestVis = visH;
          best = el;
        }
      });
    if (best) {
      var rb = best.getBoundingClientRect();
      hbar.style.display = "block";
      hbar.style.left = Math.round(rb.left) + "px";
      hbar.style.width = Math.round(best.clientWidth) + "px";
      activeScroller = best;
      updateThumb();
    } else {
      hbar.style.display = "none";
      activeScroller = null;
    }
  }

  function scheduleHBar() {
    if (hbarScheduled) return;
    hbarScheduled = true;
    requestAnimationFrame(function () {
      hbarScheduled = false;
      updateHBar();
    });
  }

  function enhanceScroller(el) {
    if (el.getAttribute("data-lk-scroll") === "1") return;
    el.setAttribute("data-lk-scroll", "1");
    el.classList.add("lk-pannable");

    /* родной скролл отчёта (колесо/тачпад/drag) -> двигаем ползунок дублёра */
    el.addEventListener("scroll", function () {
      if (el === activeScroller) updateThumb();
    });

    /* Shift + колесо -> горизонтальная прокрутка */
    el.addEventListener(
      "wheel",
      function (e) {
        if (e.shiftKey && e.deltaY !== 0) {
          el.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false }
    );

    /* drag-to-pan: тянем таблицу мышью вбок как карту */
    var down = false;
    var moved = false;
    var startX = 0;
    var startLeft = 0;
    var pid = null;
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      if (e.target.closest("a, button, input, select, textarea, label")) return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      pid = e.pointerId;
    });
    el.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 4) {
        moved = true;
        el.classList.add("lk-panning");
        try {
          el.setPointerCapture(pid);
        } catch (err) {}
      }
      if (moved) {
        el.scrollLeft = startLeft - dx;
        e.preventDefault();
      }
    });
    function endPan() {
      if (!down) return;
      down = false;
      try {
        if (pid !== null) el.releasePointerCapture(pid);
      } catch (err) {}
      if (moved) {
        el.classList.remove("lk-panning");
        /* гасим клик, следующий за перетаскиванием, чтобы не сработала ячейка */
        var block = function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
          el.removeEventListener("click", block, true);
        };
        el.addEventListener("click", block, true);
        setTimeout(function () {
          el.removeEventListener("click", block, true);
        }, 0);
      }
    }
    el.addEventListener("pointerup", endPan);
    el.addEventListener("pointercancel", endPan);
    el.addEventListener("pointerleave", endPan);
  }

  function refreshScrollers() {
    cachedScrollers = collectScrollers();
    [].forEach.call(cachedScrollers, enhanceScroller);
  }

  function initWideScroll() {
    buildHBar();
    refreshScrollers();
    updateHBar();
  }

  /* Ширину панели кнопок задаём здесь: блок внутри слота растянулся бы на всю
     ширину данных (напр. 5737), а нам нужна ширина видимой области скроллера,
     чтобы кнопки центрировались по экрану. */
  function sizeExportBars() {
    var bars = document.querySelectorAll(".lk-export-bar");
    [].forEach.call(bars, function (bar) {
      var scroller = bar.closest(".lk-pannable");
      bar.style.width = scroller ? scroller.clientWidth + "px" : "";
    });
  }

  /* Кнопки экспорта лежат ВНУТРИ широкой таблицы (в .dashboard-report-slot рядом
     с данными), поэтому уезжают при гориз.прокрутке. Оборачиваем их в один
     sticky-контейнер (.lk-export-bar) — стили в CSS его центрируют и держат на
     виду. Слот пинить нельзя (утащил бы данные), поэтому пиним только обёртку. */
  function wrapExportBars() {
    var slots = document.querySelectorAll(".dashboard-report-slot");
    [].forEach.call(slots, function (slot) {
      if (slot.getAttribute("data-lk-exportbar") === "1") return;
      var ctrls = [].filter.call(slot.children, function (c) {
        if (c.tagName === "FORM") {
          /* Форма-исключение (тег table, style=float:left, целиком широкая
             таблица с данными И кнопками разом) — если её сюда завернуть,
             получится пустая sticky-обёртка без реального контента (float
             выпадает из потока), а relocateFloatButtonRow() ниже решит эту
             форму отдельно и правильно. */
          if (c.querySelector('table[style*="float:left"]')) return false;
          return true;
        }
        if (c.tagName === "INPUT" && ("" + c.className).indexOf("btn-input") !== -1) {
          return true;
        }
        return false;
      });
      if (!ctrls.length) return;
      slot.setAttribute("data-lk-exportbar", "1");
      var bar = document.createElement("div");
      bar.className = "lk-export-bar";
      slot.insertBefore(bar, ctrls[0]);
      ctrls.forEach(function (c) {
        bar.appendChild(c);
      });
    });
    sizeExportBars();
  }

  /* Некоторые отчёты (напр. «Клиентские комментарии» на «Статус анкет») кладут
     кнопки Сохранить/Выбрать все/Экспорт ВНУТРИ той же огромной таблицы (тег
     table, style="float:left"), что и сама таблица данных (Сохранить в одной
     ячейке с гридом, остальные — в другой). Это ломает wrapExportBars() выше:
     он оборачивает ВЕСЬ элемент form целиком, а форма тут содержит целиком
     широкую таблицу — .lk-export-bar получается контейнером ВОКРУГ широких
     данных, а не ВМЕСТО кнопок, и sticky на нём не даёт эффекта (ширины/
     родителя недостаточно).
     ⚠️ Проверено вживую: position:sticky на самой float:left-таблице ТОЖЕ не
     работает (float+sticky на одном элементе не сочетаются в Chrome) — и вообще
     ни один уровень вложенности между кнопками и скроллером не липнет (несколько
     вложенных таблиц ломают sticky). Единственный рабочий вариант — физически
     перенести кнопки в новый div, ПРЯМОЙ потомок скроллера .lk-pannable (там же,
     где уже успешно липнут заголовок/подписи блока) — переиспользуем готовый
     .lk-export-bar (тот же CSS, что у «нормальных» отчётов). Сохранить — type=
     submit, у формы часто нет id → делаем form="id" на кнопке, чтобы отправка
     не сломалась при переносе за пределы исходного поддерева формы. */
  function relocateFloatButtonRow() {
    var floatTables = document.querySelectorAll('table[style*="float:left"]');
    [].forEach.call(floatTables, function (floatTable) {
      var save = floatTable.querySelector('input[type="submit"][name="Save"]');
      if (!save || save.closest('[data-lk-relocated="1"]')) return;
      var scroller = floatTable.closest(".lk-pannable");
      if (!scroller) return;
      var selectAll = floatTable.querySelector(
        'input[onclick*="checkUncheckAllComments"]'
      );
      var exportBtn = floatTable.querySelector(
        'input.btn-input[onclick*="open_export_type_dialogue"]'
      );
      var form = save.closest("form");
      if (form) {
        if (!form.id) {
          form.id = "lk-genform-" + Math.random().toString(36).slice(2, 8);
        }
        save.setAttribute("form", form.id);
      }
      var wrap = document.createElement("div");
      wrap.className = "lk-export-bar";
      wrap.setAttribute("data-lk-relocated", "1");
      var row1 = document.createElement("div");
      row1.className = "lk-export-bar-row";
      var row2 = document.createElement("div");
      row2.className = "lk-export-bar-row";
      if (save) row1.appendChild(save);
      [selectAll, exportBtn].forEach(function (el) {
        if (el) row2.appendChild(el);
      });
      wrap.appendChild(row1);
      wrap.appendChild(row2);
      scroller.appendChild(wrap);
    });
    sizeExportBars();
  }

  /* Прячем служебный счётчик "N Records" в конце отчёта: это ГОЛЫЙ текст-узел —
     прямой ребёнок .dashboard-report-slot (после кнопок экспорта, перед br),
     CSS-ом текст-узел не скрыть → зануляем его значение. Идемпотентно (пустой
     узел уже не матчит \d+). Прячем и хвостовые br, чтобы не оставался зазор. */
  function hideRecordCounts() {
    var slots = document.querySelectorAll(".dashboard-report-slot");
    [].forEach.call(slots, function (slot) {
      /* Обходим ВСЁ поддерево слота, а не только прямых детей: "N Records" бывает
         не только голым текст-узлом слота, но и внутри TD таблицы кнопок (стр.
         «Статус анкет»), где он сдвигал «Сохранить» с центра. Регулярка требует,
         чтобы ВЕСЬ узел был "N Records" (^...$) → данные с этим текстом не заденем.
         Узлы собираем заранее — не мутируем дерево во время обхода. */
      var walker = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT, null);
      var hits = [];
      var node;
      while ((node = walker.nextNode())) {
        if (/^\s*\d+\s*Records?[.\s]*$/i.test(node.nodeValue)) hits.push(node);
      }
      hits.forEach(function (n) {
        n.nodeValue = "";
        var sib = n.nextSibling;
        while (sib && (sib.nodeName === "BR" ||
               (sib.nodeType === 3 && !sib.nodeValue.trim()))) {
          var next = sib.nextSibling;
          if (sib.nodeName === "BR") sib.parentNode.removeChild(sib);
          sib = next;
        }
      });
    });
  }

  /* Иконки строк отчёта (report/pdf/print) лежат в ячейке td.report-dir прямыми
     детьми (3 ссылки). Чтобы дать равные промежутки/отступы (flex space-around),
     нельзя ставить flex на сам td — он потеряет table-cell и схлопнет высоту
     (иконки уедут к верху строки, vertical-align перестанет центрировать). Поэтому
     оборачиваем содержимое ячейки во внутренний div.lk-report-actions (flex), а td
     остаётся table-cell с vertical-align:middle → обёртка центрируется вертикально.
     Идемпотентно (data-lk-flexacts); при AJAX-перезагрузке td новый — обернётся
     заново. Обёртка не триггерит observeReports (не table/center/form/input/slot). */
  function flexReportActions() {
    var imgs = document.querySelectorAll("img[src*='review-report']");
    [].forEach.call(imgs, function (img) {
      var td = img.closest("td");
      if (!td || td.getAttribute("data-lk-flexacts")) return;
      var wrap = document.createElement("div");
      wrap.className = "lk-report-actions";
      while (td.firstChild) wrap.appendChild(td.firstChild);
      td.appendChild(wrap);
      td.setAttribute("data-lk-flexacts", "1");
    });
  }

  /* ============================================================
     ЭКСПЕРИМЕНТ: своя кнопка «Скачать с оформлением» рядом с родной
     a.export_download. Родной .xls с сервера приходит вообще без
     форматирования (ни заливки, ни ширины по контенту — проверено).
     Вместо парсинга чужого бинарника (штука капризная, у их файла
     нестандартная internal-структура) строим НОВЫЙ .xlsx с нуля прямо
     из уже отрисованной DOM-таблицы — все цвета там уже посчитаны
     платформой (getComputedStyle), дублировать пороги/логику не нужно.
     Библиотека — ExcelJS (умеет писать заливку ячеек бесплатно, в
     отличие от community-версии SheetJS, где запись стилей — платная
     Pro-фича). Грузим ЛЕНИВО, только по клику на страницах с экспортом,
     с jsDelivr (уже разрешён в CSP платформы под наш sidebar-toggle.js).
     ============================================================ */
  var EXCELJS_CDN_URL =
    "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
  /* SRI-хэш содержимого библиотеки. Версия запинена (4.4.0), значит байты
     неизменны и хэш вечный. Браузер сверит скачанное с хэшем и ОТКАЖЕТСЯ
     исполнять подменённый файл: без этого компрометация jsDelivr дала бы
     чужому коду полные права внутри авторизованной сессии ЛК.
     Пересчитать при смене версии (URL библиотеки подставить свой):
     curl -s URL | openssl dgst -sha384 -binary | openssl base64 -A */
  var EXCELJS_SRI =
    "sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz";
  var exceljsLoadPromise = null;

  function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    if (exceljsLoadPromise) return exceljsLoadPromise;
    exceljsLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = EXCELJS_CDN_URL;
      /* crossOrigin обязателен вместе с integrity: без CORS-запроса браузер
         не имеет права читать тело ответа для сверки хэша и просто не
         выполнит скрипт. referrerPolicy — гигиена, CDN незачем знать, с
         какой страницы ЛК пришёл запрос. */
      s.integrity = EXCELJS_SRI;
      s.crossOrigin = "anonymous";
      s.referrerPolicy = "no-referrer";
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        exceljsLoadPromise = null;
        reject(new Error("ExcelJS load failed"));
      };
      document.head.appendChild(s);
    });
    return exceljsLoadPromise;
  }

  /* Имя файла — Colored-ЧЧ-ММ_ДД-ММ-ГГГГ.xlsx (текущее время), чтобы разные
     выгрузки не затирали друг друга в загрузках. Двоеточия в имени файла
     Windows не разрешает — используем дефис вместо ":". */
  function pad2(n) {
    return ("0" + n).slice(-2);
  }
  function coloredExportFilename() {
    var d = new Date();
    return (
      "Colored-" +
      pad2(d.getHours()) +
      "-" +
      pad2(d.getMinutes()) +
      "_" +
      pad2(d.getDate()) +
      "-" +
      pad2(d.getMonth() + 1) +
      "-" +
      d.getFullYear() +
      ".xlsx"
    );
  }

  /* "rgb(r,g,b)" / "rgba(r,g,b,a)" в ARGB-hex для заливки ExcelJS.
     Прозрачные ячейки (alpha=0 — платформа так помечает "заливки нет")
     возвращают null — просто не ставим fill, ячейка остаётся белой. */
  function cssColorToArgb(css) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(css || "");
    if (!m) return null;
    var a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a === 0) return null;
    function hex(n) {
      var h = parseInt(n, 10).toString(16);
      return ("0" + h).slice(-2);
    }
    return "FF" + hex(m[1]) + hex(m[2]) + hex(m[3]);
  }

  /* Заголовки колонок несут служебный префикс вида "0,0,0,0,5 / ФИО
     проверяющего:" (так лежит в DOM у платформы, не наша разметка) —
     полезный текст идёт ПОСЛЕ первого слэша. */
  function cleanHeaderText(text) {
    var i = text.indexOf("/");
    if (i === -1) return text;
    return text.slice(i + 1).trim();
  }

  /* Правила форматирования — см. COLORED_EXPORT_FORMAT.md в репозитории. */
  var EXPORT_SKIP_COLS = 2;
  var EXPORT_HEADER_HEIGHT_PX = 50;
  var EXPORT_MAX_COL_WIDTH_PX = 300;
  var EXPORT_MIN_COL_WIDTH_PX = 40;
  var EXPORT_HEADER_BG_ARGB = "FF365D8D";
  var EXPORT_BOLD_DATA_COL = 2; /* 2-й столбец файла = «Оценка» */

  /* px → пункты (высота строки Excel — в pt, не px; 96dpi: 1px=0.75pt). */
  function pxToPt(px) {
    return px * 0.75;
  }
  /* px → «символьные» единицы ширины столбца Excel (Calibri 11 дефолт). */
  function pxToExcelWidth(px) {
    return (px - 5) / 7;
  }

  function buildColoredWorkbook(table) {
    var rows = [].slice.call(table.querySelectorAll("tr"));
    var colCount = 0;
    var headerCells = null;
    var dataRows = [];
    rows.forEach(function (tr) {
      /* строка фильтров под шапкой — пустые input, в экспорт не идёт */
      if (tr.querySelector("input")) return;
      var allCells = [].slice.call(tr.children);
      var isHeaderRow = !!allCells.length && allCells[0].tagName === "TH";
      var cells = allCells.slice(EXPORT_SKIP_COLS).map(function (cell) {
        var cs = getComputedStyle(cell);
        var text = cell.textContent.trim();
        return {
          text: isHeaderRow ? cleanHeaderText(text) : text,
          argb: cssColorToArgb(cs.backgroundColor),
        };
      });
      if (cells.length > colCount) colCount = cells.length;
      if (isHeaderRow) {
        headerCells = cells;
      } else {
        dataRows.push(cells);
      }
    });

    /* автоширина — ТОЛЬКО по данным, заголовок (часто длинный вопрос
       анкеты) в замере не участвует, иначе раздул бы колонку. */
    var colMax = [];
    dataRows.forEach(function (cells) {
      cells.forEach(function (cell, i) {
        var len = cell.text.length;
        if (!colMax[i] || len > colMax[i]) colMax[i] = len;
      });
    });

    var wb = new window.ExcelJS.Workbook();
    var ws = wb.addWorksheet("Экспорт");

    /* Сначала строки данных (без заголовка) — ширины считаем по ним.
       ⚠️ ws.columns = [...] ДО addRow ломает сборку в ExcelJS 4.4.0
       (TypeError: e.equivalentTo is not a function внутри toModel). */
    dataRows.forEach(function (cells) {
      var rowValues = cells.map(function (c) {
        return c.text;
      });
      var row = ws.addRow(rowValues);
      cells.forEach(function (cell, i) {
        var xlCell = row.getCell(i + 1);
        xlCell.alignment = { wrapText: true };
        if (i + 1 === EXPORT_BOLD_DATA_COL) {
          xlCell.font = { bold: true };
        }
        if (cell.argb) {
          xlCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: cell.argb },
          };
        }
      });
      /* высоту строки НЕ трогаем — Excel сам авто-подгонит под перенос */
    });

    /* Ширина столбцов — фиксируем ДО вставки строки заголовка. */
    for (var i = 0; i !== colCount; i++) {
      var widthPx = Math.min(
        EXPORT_MAX_COL_WIDTH_PX,
        Math.max(EXPORT_MIN_COL_WIDTH_PX, (colMax[i] || 8) * 7 + 10)
      );
      ws.getColumn(i + 1).width = pxToExcelWidth(widthPx);
    }

    /* Заголовок — вставляем СВЕРХУ последним, своя фиксированная высота
       и заливка, чтобы не участвовать в замере ширины выше. */
    if (headerCells) {
      var headerValues = headerCells.map(function (c) {
        return c.text;
      });
      var headerRow = ws.insertRow(1, headerValues);
      headerRow.height = pxToPt(EXPORT_HEADER_HEIGHT_PX);
      headerCells.forEach(function (cell, i) {
        var xlCell = headerRow.getCell(i + 1);
        xlCell.alignment = {
          wrapText: true,
          vertical: "middle",
          horizontal: "center",
        };
        xlCell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        xlCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: EXPORT_HEADER_BG_ARGB },
        };
      });
    }

    return wb;
  }

  function downloadWorkbook(wb, filename) {
    return wb.xlsx.writeBuffer().then(function (buf) {
      var blob = new Blob([buf], {
        type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, BLOB_TTL_MS);
    });
  }

  /* Диалог экспорта (jQuery UI) — это ПРОСТО div.ui-dialog-content, никакого
     тега form внутри него нет вообще (проверено вживую) — кнопка "Экспортировать
     эту таблицу" (#do_export, type=submit, но без формы вокруг — сабмитить
     нечего) переходит на report-performance-concentr.php через свой ЖЕ inline
     onclick, не через событие submit. Значит перехватывать нужно click по
     кнопке, в capture-фазе, чтобы успеть до inline onclick платформы.

     Связь "диалог → нужная таблица": id контента диалога — это ВСЕГДА
     "exportSPAN" + id оригинальной формы блока (напр. содержимого диалога
     "exportSPANthe_export_form_for_tr_1149551688" соответствует форма
     "the_export_form_for_tr_1149551688", которая как была, так и осталась
     в .lk-export-bar внутри нужного .dashboard-report-slot — диалог её не
     забирает, а просто получает копию под именем с префиксом). Проверено
     вживую на реальной странице. */
  function findTableForDialog(dialogContent) {
    var formId = dialogContent.id.replace(/^exportSPAN/, "");
    var origForm = formId && document.getElementById(formId);
    var slot = origForm && origForm.closest(".dashboard-report-slot");
    return slot && slot.querySelector('table[id^="questions_in_reviews_"]');
  }

  function closeExportDialog(dialogContent) {
    var dialog = dialogContent.closest(".ui-dialog");
    var closeBtn = dialog && dialog.querySelector(".ui-dialog-titlebar-close");
    if (closeBtn) closeBtn.click();
  }

  function handleColoredExportClick(dialogContent, submitBtn) {
    /* Исходную надпись запоминаем ДО любых подмен и восстанавливаем только из
       неё: надпись локализована платформой (в ЛК есть переключатель языка), а
       зашитая строка сделала бы кнопку русской на любой другой локали. */
    var original = submitBtn.value;
    var table = findTableForDialog(dialogContent);
    if (!table) {
      console.error("lk colored export: таблица с данными не найдена для этого диалога");
      submitBtn.value = "Таблица не найдена";
      setTimeout(function () {
        submitBtn.value = original;
      }, BTN_MSG_SHORT_MS);
      return;
    }
    submitBtn.setAttribute("disabled", "disabled");
    submitBtn.value = "Готовим файл...";
    var failed = false;
    loadExcelJS()
      .then(function () {
        var wb = buildColoredWorkbook(table);
        return downloadWorkbook(wb, coloredExportFilename());
      })
      .catch(function (e) {
        failed = true;
        console.error("lk colored export failed:", e);
        submitBtn.value = "Ошибка (см. консоль)";
      })
      .then(function () {
        submitBtn.removeAttribute("disabled");
        if (!failed) {
          submitBtn.value = original;
          closeExportDialog(dialogContent);
        } else {
          setTimeout(function () {
            submitBtn.value = original;
          }, BTN_MSG_LONG_MS);
        }
      });
  }

  /* «Красивенько» — первый и выбранный по умолчанию пункт в выпадающем
     списке формата (select#export_type) диалога экспорта. Клик по
     «Экспортировать эту таблицу» перехватываем в capture-фазе — если выбран
     наш пункт, гасим платформенный onclick (увёл бы на
     report-performance-concentr.php, где у нас, как выяснили, нет JS) и
     собираем .xlsx сами. Идемпотентно через data-lk-colored-added на select
     (диалог создаётся заново при каждом клике «Экспорт» — enhance подхватит). */
  function enhanceExportDialogs() {
    var selects = document.querySelectorAll(".ui-dialog select#export_type");
    [].forEach.call(selects, function (select) {
      if (select.getAttribute("data-lk-colored-added")) return;
      select.setAttribute("data-lk-colored-added", "1");
      var opt = document.createElement("option");
      opt.value = "lk_colored";
      opt.textContent = "Красивенько";
      select.insertBefore(opt, select.firstChild);
      select.value = "lk_colored";
      var dialogContent = select.closest(".ui-dialog-content");
      var submitBtn = dialogContent
        ? dialogContent.querySelector("#do_export")
        : null;
      if (!dialogContent || !submitBtn) return;
      submitBtn.addEventListener(
        "click",
        function (e) {
          if (select.value !== "lk_colored") return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          handleColoredExportClick(dialogContent, submitBtn);
        },
        true
      );
    });
  }

  function enhanceReports() {
    initWideScroll();
    wrapExportBars();
    relocateFloatButtonRow();
    hideRecordCounts();
    flexReportActions();
    enhanceExportDialogs();
    /* только телефон: на десктопе/планшете широкие таблицы и так помещаются */
    if (isAppMode()) addTableViewerButtons();
    /* Графики приезжают по AJAX и часто ПОЗЖЕ фиксированных повторов —
       ловим их здесь же, наблюдателем (см. mutationTouchesReport). Вызов
       идемпотентен: setSize с теми же размерами ничего не меняет. */
    reflowCharts();
  }

  /* Данные отчёта (широкая таблица + кнопки) грузятся по AJAX и могут прийти
     ПОЗЖЕ фиксированных таймеров — тогда полоса/обёртка кнопок не появлялись
     ("то работает, то нет"). Наблюдаем за DOM и до-enhance'им, когда контент
     реально добавился. Фильтр по релевантности — чтобы не срабатывать на
     анимацию графиков; дебаунс — чтобы не гонять на каждую мутацию. */
  var enhanceScheduled = false;
  var reportObserver = null;

  function scheduleEnhance() {
    if (enhanceScheduled) return;
    enhanceScheduled = true;
    setTimeout(function () {
      enhanceScheduled = false;
      enhanceReports();
    }, ENHANCE_DEBOUNCE_MS);
  }

  function mutationTouchesReport(records) {
    var hit = false;
    [].forEach.call(records, function (rec) {
      if (hit) return;
      [].forEach.call(rec.addedNodes, function (n) {
        if (hit || n.nodeType !== 1) return;
        var t = n.tagName;
        if (t === "TABLE" || t === "CENTER" || t === "FORM" || t === "INPUT") {
          hit = true;
        } else if (
          n.querySelector &&
          n.querySelector("center, table, .dashboard-report-slot, form, select")
        ) {
          hit = true;
        } else if (
          /* Появился САМ контейнер графика — значит Highcharts только что
             отрисовал его и надо подогнать размеры под телефон. Фиксированные
             повторы (CHART_RETRY_MS) сюда не успевают: графики приезжают по
             AJAX позже последней попытки — ловили высоту 400 (дефолт
             Highcharts) вместо телефонной.
             ⚠️ Ловим именно ДОБАВЛЕНИЕ контейнера, а не любые мутации svg:
             иначе setSize вызовет перерисовку → новую мутацию → бесконечный
             цикл. Контейнер добавляется один раз, поэтому цикла нет. */
          (n.classList && n.classList.contains("highcharts-container")) ||
          (n.querySelector && n.querySelector(".highcharts-container"))
        ) {
          hit = true;
        }
      });
    });
    return hit;
  }

  function observeReports() {
    if (reportObserver || !window.MutationObserver) return;
    reportObserver = new MutationObserver(function (records) {
      if (mutationTouchesReport(records)) scheduleEnhance();
    });
    reportObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /* ============================================================
     Мобильное меню: на узких экранах (max-width MNAV_BP) прячем боковую
     рельсу и нижнее меню в выезжающий по бургеру оверлей. Куски переносим
     в свой фикс-контейнер (#lk-mnav) и ВОЗВРАЩАЕМ на место на десктопе
     (обратимо, по ресайзу). Показ/скрытие — по классу sb-open, который
     бургер уже переключает (отдельный обработчик не нужен). Оформление —
     в CSS (@media max-width, #lk-mnav). Код без символа "меньше" — см. верх. */
  var MNAV_BP = 767;

  /* Мобильный режим определяем по факту МОБИЛЬНОГО HTML (сервер отдаёт его по
     user-agent телефонам И планшетам), а НЕ по ширине вьюпорта — иначе телефон
     в ландшафте (широкий) выпадал из мобильной вёрстки. Класс lk-m включает
     мобильный CSS; lk-wide (планшет: короткая сторона экрана больше 550px,
     не зависит от ориентации) — для просторных планшетных оверрайдов. */
  var TABLET_SHORT_EDGE = 550;

  function isMobileHTML() {
    return !!document.querySelector(".mobile_categories_list");
  }
  /* Планшет: мобильный HTML, но экран просторный. Считаем по КОРОТКОЙ стороне —
     не зависит от поворота устройства. */
  function isTabletWide() {
    return Math.min(screen.width, screen.height) > TABLET_SHORT_EDGE;
  }
  /* ЧИСТЫЙ телефон = мобильный HTML И НЕ планшет. Единственный источник правды:
     раньше этот же расчёт жил копипастой в syncModeClasses и syncFilt — при
     правке порога они разъехались бы молча. */
  function isPhone() {
    return isMobileHTML() && !isTabletWide();
  }

  /* ============================================================
     ВАРИАНТ A (мобильное приложение с нижним таб-баром) — см. MOBILE-PLAN.md.
     Всё новое включается классом lk-app и ТОЛЬКО на чистом телефоне: планшет
     (lk-m.lk-wide) и десктоп сохраняют вылизанное ранее поведение.
     Kill-switch: localStorage.lkAppOff = "1" + перезагрузка — телефон
     откатывается на старую мобилку без перевыкатки кода.
     ============================================================ */
  var APP_CLASS = "lk-app";
  var APP_OFF_KEY = "lkAppOff";
  var APP_FORCE_KEY = "lkAppForce";

  function lsGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      /* localStorage может быть недоступен (приватный режим, политики) —
         это не повод менять поведение интерфейса */
      return null;
    }
  }

  function isAppMode() {
    /* Выключатель сильнее всего: это аварийный откат на старую мобилку. */
    if (lsGet(APP_OFF_KEY) === "1") return false;
    /* Принудительное включение: lkAppForce="1". Нужно там, где screen врёт про
       размер устройства, а раскладка обязана быть телефонной:
       — эмуляция DevTools в режиме Responsive (вьюпорт мобильный, а screen от
         монитора) — иначе телефонную вёрстку не проверить;
       — разделённый экран на планшете (см. REFACTOR-TODO): screen показывает
         весь экран, окно узкое.
       Требуем мобильный HTML: без него нет рельсы, а из неё строится вся
       навигация варианта A — включать было бы нечего. */
    if (lsGet(APP_FORCE_KEY) === "1" && isMobileHTML()) return true;
    return isPhone();
  }

  function syncModeClasses() {
    var m = isMobileHTML();
    var app = isAppMode();
    root.classList.toggle("lk-m", m);
    /* ⚠️ lk-wide и lk-app ВЗАИМОИСКЛЮЧАЮЩИЕ: первый включает планшетную
       раскладку, второй — телефонную, и вместе они дают кашу из двух наборов
       правил (ловили вживую: рельса открыта по-планшетному поверх таб-бара,
       вёрстка поехала). Обычно конфликта нет — isPhone() и isTabletWide()
       противоположны. Но lkAppForce="1" включает телефонный режим в обход
       проверки размера, и тогда lk-wide обязан уступить. */
    root.classList.toggle("lk-wide", m && isTabletWide() && !app);
    root.classList.toggle(APP_CLASS, app);
  }

  var mnav = null;
  var mnavBackdrop = null;
  var mnavBuilt = false;
  var mnavMoved = [];

  function buildMnav() {
    if (mnav) return;
    mnav = document.createElement("div");
    mnav.id = "lk-mnav";
    var hdr = document.createElement("div");
    hdr.id = "lk-mnav-hdr";
    hdr.textContent = "Меню";
    mnav.appendChild(hdr);
    mnavBackdrop = document.createElement("div");
    mnavBackdrop.id = "lk-mnav-bd";
    mnavBackdrop.addEventListener("click", function () {
      root.classList.remove(OPEN_CLASS);
    });
    document.body.appendChild(mnavBackdrop);
    document.body.appendChild(mnav);
  }

  /* переносим рельсу + нижнее меню в оверлей (запоминаем исходные места) */
  function enterMnav() {
    if (mnavBuilt) return;
    buildMnav();
    mnav.style.display = "";
    mnavBackdrop.style.display = "";
    mnavMoved = [];
    /* рельса: на десктопе .upper_tabs_nav, на мобильном HTML (сервер отдаёт другой
       по user-agent) — .mobile_categories_list; берём ту, что есть */
    var pieces = [
      document.querySelector(".upper_tabs_nav") ||
        document.querySelector(".mobile_categories_list"),
      document.getElementById("menu_top_level_wrapper")
    ];
    pieces.forEach(function (el) {
      if (!el) return;
      mnavMoved.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      mnav.appendChild(el);
    });
    /* телефон-оверлей стартует закрытым; планшет (lk-wide, desktop-like)
       уважает сохранённое положение (localStorage), как десктоп */
    if (!root.classList.contains("lk-wide")) root.classList.remove(OPEN_CLASS);
    mnavBuilt = true;
  }

  /* возвращаем куски на место (десктоп) */
  function exitMnav() {
    if (!mnavBuilt) return;
    mnavMoved.forEach(function (o) {
      try {
        if (o.next && o.next.parentNode === o.parent) {
          o.parent.insertBefore(o.el, o.next);
        } else {
          o.parent.appendChild(o.el);
        }
      } catch (e) {
        /* сюда попадаем, если платформа успела перерисовать исходного
           родителя — тогда кусок меню остаётся в оверлее и пропадает с
           глаз. Молчать нельзя: это ровно тот случай, который потом
           выглядит как "иногда мистически ломается меню". */
        console.warn("lk: не удалось вернуть узел меню на место", o.el, e);
      }
    });
    mnavMoved = [];
    if (mnav) mnav.style.display = "none";
    if (mnavBackdrop) mnavBackdrop.style.display = "none";
    root.classList.remove(OPEN_CLASS);
    mnavBuilt = false;
  }

  function syncMnav() {
    /* Вариант A (телефон): навигация живёт в таб-баре и лаунчере, боковая
       шторка не нужна. exitMnav вернёт рельсу на исходное место, если её
       успел утащить прошлый режим (например, после поворота планшет→телефон);
       саму рельсу потом прячет CSS — из DOM НЕ убираем, она источник правды
       для лаунчера, заголовка раздела и признака isMobileHTML(). */
    if (isAppMode()) {
      exitMnav();
      return;
    }
    if (isMobileHTML()) enterMnav();
    else exitMnav();
  }

  /* ============================================================
     ВАРИАНТ A: нижний таб-бар + лаунчер разделов (MOBILE-PLAN, фазы 1-2).
     Строятся вместе: по отдельности бессмысленны — таб-бар без лаунчера
     оставил бы телефон без доступа к 11 из 12 разделов.
     ============================================================ */

  /* Разделы берём строго из UL#reports_categories: там ровно 12 пунктов, все
     со ссылками и уже размеченные иконками (tagRailIcons проставил lk-sec-*).
     ⚠️ НЕ брать li из всего .mobile_categories_list — там есть ЛИШНИЙ li в
     SPAN.current_tab_title: «висячий» заголовок текущего раздела БЕЗ ссылки
     (его оборачивает в ссылку linkActiveRailItem). Иначе получим 13 пунктов
     с дублем активного. */
  function getRailItems() {
    var ul = document.getElementById("reports_categories");
    return ul ? [].slice.call(ul.querySelectorAll("li")) : [];
  }

  /* Активный раздел — по cat_id из адреса, а НЕ по классу topTabActive: этот
     класс висит СРАЗУ НА ДВУХ элементах (заголовок + пункт списка), а cat_id
     однозначен. */
  function currentCatId() {
    var m = /[?&]cat_id=(\d+)/.exec(location.search);
    return m ? m[1] : null;
  }

  /* Из класса пункта рельсы («topTabInactive lk-sec-overall») оставляем только
     lk-sec-*, чтобы клон получил иконку, но не платформенные состояния. */
  function railIconClass(li) {
    var m = /lk-sec-[a-z]+/.exec(li.className || "");
    return m ? m[0] : "";
  }

  /* Единственный открытый оверлей за раз: иначе лаунчер, шторка «Ещё» и
     фильтры наложатся друг на друга. Пустая строка — закрыть всё. */
  function setAppOverlay(name) {
    root.classList.toggle("lk-launcher-open", name === "launcher");
    root.classList.toggle("filt-open", name === "filters");
    root.classList.toggle("lk-more-open", name === "more");
    /* заодно пересчитает бейдж фильтров — страховка на случай, если виджет
       изменил выбор способом, который мы не отследили (событий он не шлёт) */
    syncTabbarState();
  }

  /* Сколько фильтров реально применено — для бейджа на табе.
     Правило без хардкода значений (проверено на живой форме):
     — одиночный select: дефолт это ПЕРВАЯ опция («По умолчанию», «Нет», …),
       значит выбран не первый = фильтр задан;
     — мультиселект: дефолт это «ничего не выбрано».
     Так работает для любого клиента: состав и подписи фильтров у всех разные,
     а «первая опция = ничего не выбрано» — общее соглашение платформы. */
  function countActiveFilters() {
    var form = document.getElementById("general_filters_form");
    if (!form) return 0;
    var n = 0;
    [].forEach.call(form.querySelectorAll("select"), function (s) {
      var opts = [].slice.call(s.options);
      if (!opts.length) return;
      if (s.multiple) {
        if (
          opts.some(function (o) {
            return o.selected;
          })
        ) {
          n++;
        }
      } else if (!opts[0].selected) {
        n++;
      }
    });
    return n;
  }

  function syncFilterBadge() {
    var tab = document.querySelector("#lk-tabbar .lk-tab-filters");
    if (!tab) return;
    tab.setAttribute("data-lk-count", String(countActiveFilters()));
  }

  function syncTabbarState() {
    var bar = document.getElementById("lk-tabbar");
    if (!bar) return;
    syncFilterBadge();
    var launcherOpen = root.classList.contains("lk-launcher-open");
    var filtersOpen = root.classList.contains("filt-open");
    var moreOpen = root.classList.contains("lk-more-open");
    var anyOverlay = launcherOpen || filtersOpen || moreOpen;
    var items = getRailItems();
    var firstLink = items[0] && items[0].querySelector("a");
    var firstHref = firstLink ? firstLink.getAttribute("href") || "" : "";
    var cat = currentCatId();
    /* «Главная» активна, только когда мы физически на первом разделе и ничего
       не открыто поверх. */
    var onHome = !!(cat && firstHref.indexOf("cat_id=" + cat) !== -1);

    bar.querySelectorAll(".lk-tab").forEach(function (t) {
      var isOn =
        (t.classList.contains("lk-tab-home") && onHome && !anyOverlay) ||
        (t.classList.contains("lk-tab-sections") && launcherOpen) ||
        (t.classList.contains("lk-tab-filters") && filtersOpen) ||
        (t.classList.contains("lk-tab-more") && moreOpen);
      t.classList.toggle("lk-on", isOn);
    });
  }

  function buildLauncher() {
    if (document.getElementById("lk-launcher")) return;
    var items = getRailItems();
    if (!items.length) return;

    var box = document.createElement("div");
    box.id = "lk-launcher";

    var hdr = document.createElement("div");
    hdr.id = "lk-launcher-hdr";
    hdr.textContent = "Разделы";
    box.appendChild(hdr);

    var list = document.createElement("div");
    list.id = "lk-launcher-list";
    var cat = currentCatId();

    items.forEach(function (li) {
      var a = li.querySelector("a");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      /* КЛОНИРУЕМ ссылку, а не переносим: рельса обязана остаться на месте
         (источник правды). Клон ссылки безопасен — она несёт href, а не
         платформенный обработчик (в отличие от кнопок/инпутов платформы). */
      var item = document.createElement("a");
      item.className = "lk-launcher-item " + railIconClass(li);
      item.href = href;
      item.textContent = a.textContent.trim();
      if (cat && href.indexOf("cat_id=" + cat) !== -1) {
        item.classList.add("lk-on");
      }
      list.appendChild(item);
    });

    box.appendChild(list);
    document.body.appendChild(box);
  }

  /* ---- Компактная шапка (фаза 4) ----
     Платформенная плашка приветствия съедает ~99px высоты на телефоне ради
     одной строки текста. Заменяем её на узкую шапку: мини-лого + название
     текущего раздела + счётчик непросмотренных.
     ⚠️ Плашку прячем ТОЛЬКО через CSS (display:none), из DOM не трогаем: внутри
     неё живут тег script со сменой языка и скрытый список языков, из которого
     платформа строит свой диалог. */

  /* Название текущего раздела. Основной источник — заголовок платформы
     (.current_tab_title), он скрыт вместе с рельсой, но textContent читается.
     Фолбэк — активный пункт рельсы (на случай, если заголовка нет). */
  function currentSectionTitle() {
    var t = document.querySelector(".current_tab_title");
    var txt = t ? t.textContent.trim() : "";
    if (txt) return txt;
    var cat = currentCatId();
    var hit = getRailItems().filter(function (li) {
      var a = li.querySelector("a");
      return a && (a.getAttribute("href") || "").indexOf("cat_id=" + cat) !== -1;
    })[0];
    return hit ? hit.textContent.trim() : "Основное меню";
  }

  function buildAppHeader() {
    if (document.getElementById("lk-apphdr")) return;
    var hdr = document.createElement("header");
    hdr.id = "lk-apphdr";

    /* Лого: сначала переменная --logo-img-main, потом картинка из DOM.
       Хардкодить нельзя ни то ни другое — файлы у каждого клиента свои (219 в
       219-Logo-83.png это id клиента), поэтому оба источника читаем на месте.
       Порядок именно такой (решение клиента 2026-07-17): в #top_title_graphics
       лежит логотип КОМПАНИИ (тот же, что в подвале), а в шапке нужен логотип
       КЛИЕНТА — он только в переменной. Платформа объявляет её инлайном на
       body.page-main-menu, то есть на других страницах её может не быть —
       поэтому картинка из DOM остаётся фолбэком, а не удаляется. */
    var logo = document.createElement("span");
    logo.id = "lk-apphdr-logo";
    var cssLogo = "";
    try {
      cssLogo = getComputedStyle(document.body)
        .getPropertyValue("--logo-img-main")
        .trim();
    } catch (e) {}
    var srcImg = document.querySelector("#top_title_graphics img");
    var src = srcImg && srcImg.getAttribute("src");
    if (cssLogo && cssLogo !== "none") logo.style.backgroundImage = cssLogo;
    else if (src) logo.style.backgroundImage = 'url("' + src + '")';
    hdr.appendChild(logo);

    var title = document.createElement("span");
    title.id = "lk-apphdr-title";
    title.textContent = currentSectionTitle();
    hdr.appendChild(title);

    /* Слот под счётчик непросмотренных: сам перенос — в moveCounterToHeader. */
    var slot = document.createElement("span");
    slot.id = "lk-apphdr-counter";
    hdr.appendChild(slot);

    document.body.appendChild(hdr);
  }

  /* Счётчик непросмотренных — ссылка на report-property.php с числом. Обработчиков
     на ней нет (проверено), но переносим, а не клонируем: если платформа обновит
     число, пользователь увидит актуальное, а не слепок на момент загрузки.
     Возврат — общий с языком (moreMoved/restoreMoreMoved). */
  function moveCounterToHeader() {
    var slot = document.getElementById("lk-apphdr-counter");
    var greet = document.getElementById("main_menu_title_text");
    if (!slot || !greet) return;
    var counter = [].slice.call(greet.querySelectorAll("a")).filter(function (a) {
      return (a.getAttribute("href") || "").indexOf("report-property") !== -1;
    })[0];
    if (!counter || slot.contains(counter)) return;
    moreMoved.push({
      el: counter,
      parent: counter.parentNode,
      next: counter.nextSibling
    });
    slot.appendChild(counter);
    /* Ноль непросмотренных — не новость: гасим бейдж, чтобы не мозолил. */
    slot.classList.toggle("lk-zero", counter.textContent.trim() === "0");
  }

  /* Шторка «Ещё»: нижнее меню платформы (Главная/Управление/Отчеты/Выход) плюс
     переключатель языка.
     Пункты меню — КЛОНЫ: проверено вживую, все четыре суть обычные ссылки с
     href и без onclick, так что клон ведёт себя как оригинал. Иконки берутся
     общими правилами по href (селекторы расширены на .lk-more-item).
     ⚠️ Кнопка языка — НЕ клон, а ПЕРЕНОС с возвратом: это тег a с href="#",
     обработчик ей вешает jQuery, и клон остался бы мёртвой кнопкой. */
  var moreMoved = [];

  function buildMoreSheet() {
    if (document.getElementById("lk-more")) return;

    var bd = document.createElement("div");
    bd.id = "lk-more-bd";
    bd.addEventListener("click", function () {
      setAppOverlay("");
    });

    var sheet = document.createElement("div");
    sheet.id = "lk-more";

    var grab = document.createElement("div");
    grab.id = "lk-more-grab";
    sheet.appendChild(grab);

    var hdr = document.createElement("div");
    hdr.id = "lk-more-hdr";
    hdr.textContent = "Ещё";
    sheet.appendChild(hdr);

    var list = document.createElement("div");
    list.id = "lk-more-list";
    var menu = document.getElementById("menu_top_level_wrapper");
    var links = menu ? [].slice.call(menu.querySelectorAll("a")) : [];
    links.forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href) return;
      var item = document.createElement("a");
      item.className = "lk-more-item";
      item.href = href;
      item.textContent = a.textContent.trim();
      list.appendChild(item);
    });
    sheet.appendChild(list);

    /* Пустой слот под перенесённую кнопку языка: сам перенос — в moveLangToMore,
       он должен пережить пересборку шторки и уметь вернуть кнопку назад. */
    var langSlot = document.createElement("div");
    langSlot.id = "lk-more-lang";
    sheet.appendChild(langSlot);

    document.body.appendChild(bd);
    document.body.appendChild(sheet);
  }

  function moveLangToMore() {
    var lang = document.getElementById("set-language");
    var slot = document.getElementById("lk-more-lang");
    if (!lang || !slot || slot.contains(lang)) return;
    moreMoved.push({ el: lang, parent: lang.parentNode, next: lang.nextSibling });
    slot.appendChild(lang);
  }

  /* Возврат языка на штатное место — обязателен при уходе с телефона (поворот
     планшета, kill-switch): иначе кнопка исчезнет вместе со шторкой. */
  function restoreMoreMoved() {
    moreMoved.forEach(function (o) {
      try {
        if (o.next && o.next.parentNode === o.parent) {
          o.parent.insertBefore(o.el, o.next);
        } else {
          o.parent.appendChild(o.el);
        }
      } catch (e) {
        console.warn("lk: не удалось вернуть кнопку языка на место", o.el, e);
      }
    });
    moreMoved = [];
  }

  function makeTab(cls, label, isLink) {
    var el = document.createElement(isLink ? "a" : "button");
    if (!isLink) el.type = "button";
    el.className = "lk-tab " + cls;
    /* иконка — отдельный span (фон в CSS), текст — свой: так подпись не
       наезжает на иконку при длинных словах */
    var ic = document.createElement("span");
    ic.className = "lk-tab-ic";
    el.appendChild(ic);
    var tx = document.createElement("span");
    tx.className = "lk-tab-tx";
    tx.textContent = label;
    el.appendChild(tx);
    return el;
  }

  function buildTabbar() {
    if (document.getElementById("lk-tabbar")) return;
    var items = getRailItems();
    if (!items.length) return;

    var bar = document.createElement("nav");
    bar.id = "lk-tabbar";

    /* «Главная» — первый раздел рельсы («Общий результат»): именно он
       открывается по умолчанию и служит сводным экраном. Обычная ссылка —
       работает средним кликом/долгим тапом как любая другая. */
    var firstLink = items[0].querySelector("a");
    var home = makeTab("lk-tab-home", "Главная", true);
    home.href = firstLink ? firstLink.getAttribute("href") : "main-menu.php";
    home.addEventListener("click", function () {
      setAppOverlay("");
    });
    bar.appendChild(home);

    var sections = makeTab("lk-tab-sections", "Разделы", false);
    sections.addEventListener("click", function () {
      setAppOverlay(
        root.classList.contains("lk-launcher-open") ? "" : "launcher"
      );
    });
    bar.appendChild(sections);

    /* Фильтры: класс filt-open уже умеет показывать оверлей (старая мобилка) —
       переиспользуем как есть, в фазе 5 оверлей станет шторкой снизу. */
    var filters = makeTab("lk-tab-filters", "Фильтры", false);
    filters.addEventListener("click", function () {
      setAppOverlay(root.classList.contains("filt-open") ? "" : "filters");
    });
    bar.appendChild(filters);

    var more = makeTab("lk-tab-more", "Ещё", false);
    more.addEventListener("click", function () {
      setAppOverlay(root.classList.contains("lk-more-open") ? "" : "more");
    });
    bar.appendChild(more);

    document.body.appendChild(bar);
    syncTabbarState();
  }

  /* ---- Полноэкранный просмотр широких таблиц (фаза 7) ----
     Отчёты вроде «Сводной таблицы» — это 41 колонка и ~10000px ширины на
     экране в 412. Скроллер (drag-to-pan + полоса #lk-hbar) уже работает, но
     смотреть данные в окошке высотой в треть экрана неудобно: разворачиваем
     таблицу на весь экран.
     ⚠️ Переносим ЦЕЛИКОМ сам скроллер (center.lk-pannable): внутри него живут
     и таблица, и панель кнопок, и формы экспорта. Если тащить только таблицу,
     развалится «Красивенько» — оно ищет таблицу через форму в
     .dashboard-report-slot (см. память lk-dashboard-colored-export). Проверено:
     внутри скроллера ровно один слот, так что забираем его целиком.
     Перенос — с возвратом (см. mnavMoved/filtMoved): узел платформенный. */
  var tviewMoved = null;

  function buildTableViewer() {
    if (document.getElementById("lk-tview")) return;

    var box = document.createElement("div");
    box.id = "lk-tview";

    var hdr = document.createElement("div");
    hdr.id = "lk-tview-hdr";

    var title = document.createElement("span");
    title.id = "lk-tview-title";
    hdr.appendChild(title);

    var close = document.createElement("button");
    close.id = "lk-tview-close";
    close.type = "button";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Закрыть таблицу");
    close.addEventListener("click", closeTableViewer);
    hdr.appendChild(close);

    box.appendChild(hdr);

    var body = document.createElement("div");
    body.id = "lk-tview-body";
    box.appendChild(body);

    document.body.appendChild(box);
  }

  /* Внутри скроллера рядом с таблицей лежат заголовок отчёта, описание и
     инструкция «как экспортировать» — в развёрнутом виде они съедают тот самый
     экран, ради которого всё затевалось (у одного H1 высота 219px!).
     Помечаем ветку с данными, остальное прячет CSS. Пометка из JS, а не
     селектором: состав и порядок этих блоков у отчётов разный, а «та ветка, где
     лежит таблица» — признак надёжный. */
  var TVIEW_KEEP_SEL = "table.report:not(#red_border), .lk-export-bar";

  function markTableBranch(scroller, on) {
    [].forEach.call(scroller.children, function (c) {
      if (!on) {
        c.removeAttribute("data-lk-tview-keep");
        return;
      }
      /* И matches, и querySelector: у части отчётов таблица (или панель кнопок)
         сама является прямым потомком скроллера, а не лежит внутри обёртки —
         одного querySelector мало, он смотрит только потомков.
         .lk-export-bar в списке обязательно: на «Клиентских комментариях» это
         отдельная ветка без таблицы, и без пометки в развёрнутом виде пропадали
         «Сохранить» и «Выбрать все» — выбор комментариев стало бы не сохранить. */
      if (c.matches(TVIEW_KEEP_SEL) || c.querySelector(TVIEW_KEEP_SEL)) {
        c.setAttribute("data-lk-tview-keep", "1");
      }
    });
  }

  /* Текст заголовка БЕЗ служебных детей. С тех пор как кнопка «Развернуть»
     переехала внутрь H1, простой h1.textContent давал «Клиентские комментарии
     Развернуть» — имя кнопки уезжало в шапку оверлея. Ссылки (иконки платформы)
     тоже исключаем: текста в них нет, но пробелы\переводы строк они приносят. */
  function headingText(h1) {
    if (!h1) return "";
    var out = "";
    [].forEach.call(h1.childNodes, function (n) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (
        n.nodeType === 1 &&
        n.tagName !== "A" &&
        !(n.classList && n.classList.contains("lk-tview-btn"))
      )
        out += n.textContent;
    });
    return out.replace(/\s+/g, " ").trim();
  }

  function openTableViewer(scroller, name) {
    if (tviewMoved) return;
    buildTableViewer();
    var body = document.getElementById("lk-tview-body");
    /* Название берём из H1 самого отчёта — он лежит в скроллере, а не в слоте.
       H1 приоритетнее переданного name: name собирают по "h1, center b" внутри
       слота, а первым center b нередко оказывается врезка («Примечание») —
       на «Разделах анкеты» именно она и уезжала в шапку вместо названия. */
    var h1 = scroller.querySelector("h1");
    var title = headingText(h1) || name || "";
    document.getElementById("lk-tview-title").textContent =
      title || "Таблица отчёта";
    tviewMoved = {
      el: scroller,
      parent: scroller.parentNode,
      next: scroller.nextSibling
    };
    markTableBranch(scroller, true);
    body.appendChild(scroller);
    root.classList.add("lk-tview-open");
    /* пересобираем список скроллеров и полосу: узел сменил место и размеры */
    refreshScrollers();
    scheduleHBar();
  }

  function closeTableViewer() {
    if (!tviewMoved) return;
    var o = tviewMoved;
    tviewMoved = null;
    /* снимаем пометки: вне оверлея прятать соседние блоки незачем */
    markTableBranch(o.el, false);
    try {
      if (o.next && o.next.parentNode === o.parent) {
        o.parent.insertBefore(o.el, o.next);
      } else {
        o.parent.appendChild(o.el);
      }
    } catch (e) {
      console.warn("lk: не удалось вернуть таблицу на место", o.el, e);
    }
    root.classList.remove("lk-tview-open");
    refreshScrollers();
    scheduleHBar();
    reflowCharts();
  }

  /* «Развернуть»: на телефоне — иконкой в ШАПКЕ карточки (решение клиента
     2026-07-17, там же где были убранные шестерёнка\редактирование), в прочих
     режимах — кнопкой в панели кнопок отчёта.
     Ставим на сам скроллер, а не на панель: у отчётов без панели (её собирает
     wrapExportBars только там, где есть контролы) кнопки иначе не было бы вовсе.
     В оверлее кнопку прячет CSS — там для выхода крестик. */
  function addTableViewerButtons() {
    var scrollers = document.querySelectorAll(".lk-pannable");
    [].forEach.call(scrollers, function (sc) {
      if (sc.getAttribute("data-lk-tview-added")) return;
      /* только для реально широких: у обычных отчётов разворачивать нечего.
         После уменьшения шрифта таблиц таких стало меньше — и это правильно. */
      if (!(sc.scrollWidth - sc.clientWidth > 20)) return;
      var h1 = sc.querySelector("h1");
      var bar = sc.querySelector(".lk-export-bar");
      var host = isAppMode() ? h1 || bar : bar || h1;
      if (!host) return;
      sc.setAttribute("data-lk-tview-added", "1");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lk-tview-btn";
      /* Текст держим в DOM всегда: на телефоне его гасит font-size:0, но он
         остаётся именем кнопки для скринридера и подписью в других режимах. */
      btn.textContent = "Развернуть";
      btn.title = "Развернуть таблицу";
      btn.addEventListener("click", function () {
        openTableViewer(sc, headingText(h1));
      });
      host.appendChild(btn);
    });
  }

  /* Разбираем навигацию варианта A обратно. Нужен, когда режим перестал быть
     телефонным: поворот планшета, смена ширины, kill-switch. Без этого таб-бар
     остался бы висеть поверх планшетной раскладки, которую мы не трогаем.
     Всё наше — клоны и свои узлы, поэтому просто удаляем: платформенный DOM не
     затронут (в отличие от mnav/filt, где нужен аккуратный возврат). */
  function destroyAppNav() {
    /* ⚠️ СНАЧАЛА вернуть перенесённое (таблица, язык, счётчик), и только потом
       удалять контейнеры: иначе узлы уедут в небытие вместе с оверлеями. */
    closeTableViewer();
    restoreMoreMoved();
    [
      "lk-apphdr",
      "lk-tabbar",
      "lk-launcher",
      "lk-more",
      "lk-more-bd",
      "lk-tview"
    ].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
    root.classList.remove("lk-launcher-open");
    root.classList.remove("lk-more-open");
    root.classList.remove("lk-tview-open");
  }

  /* Собираем/разбираем навигацию варианта A по текущему режиму. Идемпотентно;
     ВАЖНО звать ПОСЛЕ tagRailIcons() — иначе клоны в лаунчере останутся без
     иконок. */
  function buildAppNav() {
    if (!isAppMode()) {
      destroyAppNav();
      return;
    }
    buildAppHeader();
    buildTabbar();
    buildLauncher();
    buildMoreSheet();
    /* переносы — после сборки контейнеров: им нужны готовые слоты */
    moveCounterToHeader();
    moveLangToMore();
    watchFilterChanges();
    syncTabbarState();
  }

  /* Бейдж должен реагировать, пока пользователь ковыряет фильтры (до
     «Подтвердить», которое перезагружает страницу).
     ⚠️ Проверено вживую: jQuery-UI мультиселект НЕ шлёт НИКАКИХ событий —
     ни нативного change, ни jQuery-триггера. Он молча правит исходный select.
     Поэтому одного слушателя change мало: он покроет только нативные селекты.
     Ловим ещё и клик по меню виджета — оно живёт в body (вне формы), поэтому
     слушаем на document. Пересчёт откладываем на следующий тик: на момент
     клика виджет ещё не успел синхронизировать select. */
  var filtWatched = false;

  function watchFilterChanges() {
    if (filtWatched) return;
    filtWatched = true;

    document.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("#general_filters_form")) syncFilterBadge();
    });

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest(".ui-multiselect-menu")) {
        setTimeout(syncFilterBadge, 0);
      }
    });
  }

  /* ============================================================
     Мобильные фильтры: на узких экранах прячем блок фильтров под кнопку
     "Фильтры", по тапу — полноэкранный оверлей со стопкой. Формы
     (general_filters_form + clear_general_filters_form) переносим в
     оверлей #lk-filt и возвращаем на десктопе (обратимо). Оформление —
     CSS (@media, #lk-filt). Показ — класс filt-open. Без символа "меньше". */
  var FILT_BP = 767;
  var filt = null;
  var filtBd = null;
  var filtBtn = null;
  var filtBuilt = false;
  var filtMoved = [];
  var filtRow = null;
  var filtActionsOrig = [];

  function buildFilt() {
    if (filt) return;
    filtBd = document.createElement("div");
    filtBd.id = "lk-filt-bd";
    filtBd.addEventListener("click", function () {
      root.classList.remove("filt-open");
    });
    filt = document.createElement("div");
    filt.id = "lk-filt";
    var hdr = document.createElement("div");
    hdr.id = "lk-filt-hdr";
    hdr.textContent = "Фильтры";
    var close = document.createElement("button");
    close.id = "lk-filt-close";
    close.type = "button";
    close.textContent = "✕";
    close.addEventListener("click", function () {
      root.classList.remove("filt-open");
    });
    hdr.appendChild(close);
    filt.appendChild(hdr);
    document.body.appendChild(filtBd);
    document.body.appendChild(filt);
  }

  function enterFilt() {
    if (filtBuilt) return;
    var form = document.getElementById("general_filters_form");
    if (!form) return;
    buildFilt();
    filt.style.display = "";
    filtBd.style.display = "";
    if (!filtBtn) {
      filtBtn = document.createElement("button");
      filtBtn.id = "lk-filt-btn";
      filtBtn.type = "button";
      filtBtn.textContent = "Фильтры";
      filtBtn.addEventListener("click", function () {
        root.classList.add("filt-open");
      });
    }
    form.parentNode.insertBefore(filtBtn, form);
    filtMoved = [];
    var pieces = [form, document.getElementById("clear_general_filters_form")];
    pieces.forEach(function (el) {
      if (!el) return;
      filtMoved.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      filt.appendChild(el);
    });
    root.classList.remove("filt-open");
    filtBuilt = true;
  }

  /* Подтвердить (submit, живёт в форме) + Очистить (ссылка, живёт в области отчётов,
     ОТДЕЛЬНО от формы) — оборачиваем в один ряд #lk-filt-actions, чтобы не разлетались.
     ВСЕГДА, на любом режиме (мобильный оверлей, планшетный инлайн, десктоп) — на десктопе
     это раньше не делалось (расчёт был на то, что места всегда достаточно), но при узком
     окне браузера форма фильтров переносится на 2 строки и «Очистить» (у неё СВОЯ верстальная
     позиция в области отчётов) визуально отрывается от «Подтвердить». Группировка раз и
     навсегда убирает этот разрыв независимо от ширины окна. */
  function groupActions() {
    if (filtRow) return;
    var confirmBtn = document.getElementById("update_filters");
    var clearLink = document.getElementById("link_to_clear_general_filters");
    if (!confirmBtn) return;
    filtActionsOrig = [];
    [confirmBtn, clearLink].forEach(function (el) {
      if (el) {
        filtActionsOrig.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      }
    });
    filtRow = document.createElement("div");
    filtRow.id = "lk-filt-actions";
    confirmBtn.parentNode.insertBefore(filtRow, confirmBtn);
    filtRow.appendChild(confirmBtn);
    if (clearLink) filtRow.appendChild(clearLink);
  }

  function exitFilt() {
    if (!filtBuilt) return;
    filtMoved.forEach(function (o) {
      try {
        if (o.next && o.next.parentNode === o.parent) {
          o.parent.insertBefore(o.el, o.next);
        } else {
          o.parent.appendChild(o.el);
        }
      } catch (e) {
        /* см. такой же catch в exitMnav: потеря формы фильтров молча —
           худший исход, лучше след в консоли. */
        console.warn("lk: не удалось вернуть форму фильтров на место", o.el, e);
      }
    });
    filtMoved = [];
    if (filtBtn && filtBtn.parentNode) filtBtn.parentNode.removeChild(filtBtn);
    if (filt) filt.style.display = "none";
    if (filtBd) filtBd.style.display = "none";
    root.classList.remove("filt-open");
    filtBuilt = false;
  }

  function syncFilt() {
    /* Оверлей-фильтры + кнопка «Фильтры» — только на ЧИСТОЙ мобилке. Планшет
       (lk-wide) и десктоп держат фильтры инлайн (exitFilt). Считаем через
       isPhone() — тот же источник правды, что и у классов режима (раньше здесь
       была копипаста расчёта, которая могла разъехаться с syncModeClasses).
       Подтвердить+Очистить группируем ВСЕГДА (см. комментарий у groupActions). */
    groupActions();
    if (isPhone()) {
      /* чистая мобилка: оверлей + кнопка «Фильтры» */
      enterFilt();
    } else {
      /* планшет и десктоп: фильтры инлайн, на штатных местах */
      exitFilt();
    }
  }

  /* Диагностика для реального телефона: открыть URL с #lkdbg — покажет структуру
     рельсы/меню (device-правила платформы у нас на десктопе не воспроизводятся). */
  function mnavDebug() {
    if (location.hash.indexOf("lkdbg") === -1) return;
    var out = [];
    out.push("W=" + window.innerWidth + " selects=" + document.querySelectorAll("select").length);
    /* цепочка предков пункта рельсы "Филиалы" — покажет контейнер мобильной рельсы */
    var item = [].filter.call(
      document.querySelectorAll("a, li, span, div, option, td, strong"),
      function (e) {
        return (e.textContent || "").trim() === "Филиалы" && 1 >= e.children.length;
      }
    )[0];
    if (item) {
      var p = item;
      for (var i = 0; 7 > i && p && p !== document.body; i++) {
        out.push(
          i + ")" + p.tagName + "." + ("" + p.className).slice(0, 22) +
          (p.id ? "#" + p.id.slice(0, 12) : "") +
          (mnav && mnav.contains(p) ? " [inMnav]" : "")
        );
        p = p.parentElement;
      }
    } else {
      out.push("'Филиалы' NOT FOUND");
    }
    out.push(
      "ul.upper=" + document.querySelectorAll("ul.upper_tabs, ul.tabs_menu").length +
      " toprow=" + document.querySelectorAll(".top_tabs_row").length
    );
    var box = document.getElementById("lk-dbg") || document.createElement("div");
    box.id = "lk-dbg";
    box.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#000;" +
      "color:#0f0;font:13px monospace;padding:10px;white-space:pre-wrap;" +
      "max-height:80vh;overflow:auto;";
    box.textContent = out.join("\n");
    document.body.appendChild(box);
  }

  /* Активный пункт рельсы платформа отдаёт как font-тег БЕЗ ссылки (на десктопе
     он кликабелен) — оборачиваем содержимое в ссылку (a). Сессия у платформы
     кука-based (соседние ссылки тоже без chk_key).
     ⚠️ href с location.search, а НЕ голый main-menu.php: голый адрес открывает
     дефолтную категорию, т.е. тап по активному пункту «Филиалы» уводил на
     «Общий результат» — переход туда, куда пользователь не просил. Сохраняем
     текущий cat_id: тап по активному пункту = остаться в своём разделе. */
  function linkActiveRailItem() {
    var li = document.querySelector("#reports_categories li.topTabActive");
    if (!li || li.querySelector("a")) return;
    var a = document.createElement("a");
    a.href = "main-menu.php" + location.search;
    while (li.firstChild) a.appendChild(li.firstChild);
    li.appendChild(a);
  }

  /* Платформа в мобильном HTML добавляет ДВА неразрывных пробела (  )
     в начало подписи пунктов средней рельсы (#reports_categories li) — для
     отступа от инлайн-иконки. У нас иконка — ФОН, поэтому эти nbsp только
     сдвигают текст вправо и ломают единый зазор иконка→текст (у нижнего меню
     их нет). Срезаем ведущие пробелы/nbsp у первого текстового узла пункта. */
  function trimRailText() {
    var items = document.querySelectorAll("#reports_categories li");
    [].forEach.call(items, function (li) {
      var wk = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, null, false);
      var n;
      while ((n = wk.nextNode())) {
        if (n.nodeValue && n.nodeValue.length) {
          var t = n.nodeValue.replace(/^[\s ]+/, "");
          if (t !== n.nodeValue) n.nodeValue = t;
          break;
        }
      }
    });
  }

  /* Приветствие в шапке («Добро пожаловать, …») платформа отдаёт с ведущими
     неразрывными пробелами — при центрировании они смещают текст вправо.
     Срезаем ведущие пробелы/nbsp у первого текст-узла ячеек .gray-lighter2. */
  function trimHeaderGreeting() {
    var cells = document.querySelectorAll("#main_menu_title_text td.gray-lighter2");
    [].forEach.call(cells, function (c) {
      var wk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null, false);
      var n;
      while ((n = wk.nextNode())) {
        if (n.nodeValue && n.nodeValue.trim().length) {
          var t = n.nodeValue.replace(/^[\s ]+/, "");
          if (t !== n.nodeValue) n.nodeValue = t;
          break;
        }
      }
    });
  }

  /* ДЕСКТОП-рельса: категории (.upper_tabs_nav — свой скролл) и нижнее меню
     (#menu_top_level_wrapper — ОТДЕЛЬНЫЙ fixed) при НИЗКОМ экране наезжали. Объединяем
     в ОДИН скролл: переносим меню в ячейку категорий, а ячейку делаем flex-column
     скроллом НИЖЕ логотипа. Тогда скроллится ВСЯ рельса (категории+меню вместе), лого
     закреплён сверху, на высоком экране меню прижато к низу (margin:auto сверху).
     Только десктоп (на мобилке рельса живёт в #lk-mnav — там своя раскладка).
     Стили ИНЛАЙНОМ: платформенный margin-top логотипа под transition и маскирует
     CSS-override (ловились промежуточные 245px); инлайн бьёт надёжно, без гонок. */
  function unifyDesktopRail() {
    if (isMobileHTML()) return;
    var cats = document.querySelector(".upper_tabs_nav");
    if (!cats) return;
    var td = cats.parentElement;
    var bm = document.getElementById("menu_top_level_wrapper");
    if (!td || !bm) return;
    if (!td.contains(bm)) td.appendChild(bm);
    cats.style.setProperty("margin-top", "0", "important");
    cats.style.setProperty("transition", "none", "important");
    cats.style.setProperty("max-height", "none", "important");
    cats.style.setProperty("height", "auto", "important");
    cats.style.setProperty("overflow", "visible", "important");
    cats.style.setProperty("flex", "0 0 auto", "important");
    td.style.setProperty("display", "flex", "important");
    td.style.setProperty("flex-direction", "column", "important");
    td.style.setProperty("overflow-y", "auto", "important");
    td.style.setProperty("overflow-x", "hidden", "important");
    /* Резерв под логотип (margin-top ячейки) и высоту скролла задаёт CSS — он ЗАВИСИТ
       от состояния рельсы: раскрыто 245, свёрнуто 100 (категории ближе к лого). */
    td.classList.add("lk-rail-scroll");
    bm.style.setProperty("position", "static", "important");
    bm.style.setProperty("margin", "auto 0 0 0", "important");
    bm.style.setProperty("width", "auto", "important");
    bm.style.setProperty("clip-path", "none", "important");
    bm.style.setProperty("z-index", "auto", "important");
    bm.style.setProperty("flex", "0 0 auto", "important");
  }

  function onReady() {
    syncModeClasses();
    createBurger();
    syncMnav();
    syncFilt();
    unifyDesktopRail();
    mnavDebug();
    tagRailIcons();
    trimRailText();
    trimHeaderGreeting();
    linkActiveRailItem();
    /* ⚠️ СТРОГО ПОСЛЕ всех правок рельсы: лаунчер клонирует её пункты, поэтому
       к этому моменту они должны быть уже полностью готовы —
       tagRailIcons() проставил классы иконок (иначе клоны без иконок),
       trimRailText() срезал ведущие nbsp,
       linkActiveRailItem() обернул АКТИВНЫЙ пункт в ссылку (иначе он выпадает
       из лаунчера: берём только пункты со ссылкой — было 11 из 12, пропадал
       ровно тот раздел, на котором стоит пользователь). */
    buildAppNav();
    /* графики могут подтягиваться по ajax — перерисовываем с несколькими попытками */
    reflowCharts();
    CHART_RETRY_MS.forEach(function (ms) {
      setTimeout(reflowCharts, ms);
    });
    /* широкие отчёты: липкая полоса + drag-to-pan + обёртка кнопок экспорта
       (данные/кнопки могут подгружаться по ajax — повторяем с задержками) */
    enhanceReports();
    REPORTS_RETRY_MS.forEach(function (ms) {
      setTimeout(enhanceReports, ms);
    });
    /* и наблюдаем за поздней AJAX-загрузкой данных отчёта */
    observeReports();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
  window.addEventListener("load", reflowCharts);

  /* Липкая гориз. полоса: следим за скроллом страницы. */
  window.addEventListener("scroll", scheduleHBar, { passive: true });

  /* Ресайз ОДНИМ задебаунсенным обработчиком. Событие стреляет десятки раз в
     секунду, пока тянут край окна, а работа тут тяжёлая: refreshScrollers()
     читает scrollWidth/getComputedStyle у всех кандидатов (принудительный
     пересчёт layout на каждый вызов), reflowCharts() дёргает setSize у каждого
     графика. Раньше это шло на КАЖДОЕ событие (и двумя отдельными
     обработчиками) — окно дёргалось рывками. Теперь один проход после того,
     как пользователь отпустил край. Дебаунс, а НЕ throttle: важно финальное
     состояние, промежуточные ширины никому не нужны. */
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      refreshScrollers();
      sizeExportBars();
      scheduleHBar();
      syncModeClasses();
      syncMnav();
      syncFilt();
      /* режим мог смениться (поворот планшета) — навигация варианта A должна
         появиться или исчезнуть вместе с ним, не оставляя сирот */
      buildAppNav();
      unifyDesktopRail();
      reflowCharts();
    }, RESIZE_DEBOUNCE_MS);
  });
  window.addEventListener("load", function () {
    /* после load ширина уже с учётом viewport-меты (телефон перевёрстан из 980
       в device-width) — перезапускаем меню/фильтры, иначе рельса могла не
       переместиться (syncMnav мог отработать на 980 = "десктоп"). */
    syncModeClasses();
    syncMnav();
    syncFilt();
    buildAppNav();
    unifyDesktopRail();
    setTimeout(function () {
      syncModeClasses();
      syncMnav();
      syncFilt();
      buildAppNav();
      unifyDesktopRail();
      enhanceReports();
      mnavDebug();
    }, POST_LOAD_MS);
  });
})();
