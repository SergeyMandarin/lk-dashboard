/* ============================================================
   Боковое меню личного кабинета: открытие/сворачивание по кнопке-бургеру.

   - Уходим от раскрытия по hover к явному переключению кнопкой.
   - В раскрытом состоянии меню показывает подписи и СДВИГАЕТ интерфейс вправо.
   - Состояние запоминается в localStorage.

   Внешний вид задаётся в "Default-analyst-dashboard 4.css" (блок "БОКОВОЕ МЕНЮ").
   Состояние — класс "sb-open" на элементе HTML.

   ВАЖНО: код намеренно НЕ содержит символа "меньше" (углового скобка-открытие),
   чтобы поле ввода JS в личном кабинете не приняло его за HTML-тег и не обрезало
   скрипт. Цикл — через forEach, кнопка — через createElement.

   Для "без мигания": сохранённое состояние применяется синхронно в самом верху,
   поэтому файл желательно подключать как можно раньше (в head). Класс вешается на
   элемент HTML, т.к. на момент выполнения тела BODY может ещё не быть.
   ============================================================ */
(function () {
  "use strict";

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

  function isSaved() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  /* 1) Состояние применяем сразу (синхронно), до отрисовки при раннем подключении. */
  root.classList.toggle(OPEN_CLASS, isSaved());

  /* Пере-расчёт живых графиков Highcharts под текущую ширину контейнера. */
  function reflowCharts() {
    if (window.Highcharts && Highcharts.charts) {
      Highcharts.charts.forEach(function (c) {
        if (c) {
          try {
            c.reflow();
          } catch (e) {}
        }
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
    /* после анимации сдвига контента (0.25s) перерисовываем графики и полосу */
    setTimeout(reflowCharts, 320);
    setTimeout(function () {
      updateHBar();
      sizeExportBars();
    }, 340);
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
      [/статус/i, "status"]
    ];
    var items = document.querySelectorAll(".upper_tabs_nav li.tab_menu_item");
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
    var nodes = document.querySelectorAll(
      ".grid_report_td center, .grid_report_td div, .grid_report_td table"
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
    [].forEach.call(cachedScrollers, function (el) {
      if (!el.isConnected) return;
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
      if (visH > 0 && nativeOffscreen && visH > bestVis) {
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
        if (c.tagName === "FORM") return true;
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

  function enhanceReports() {
    initWideScroll();
    wrapExportBars();
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
    }, 150);
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
          n.querySelector("center, table, .dashboard-report-slot")
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
    var pieces = [
      document.querySelector(".upper_tabs_nav"),
      document.getElementById("menu_top_level_wrapper")
    ];
    pieces.forEach(function (el) {
      if (!el) return;
      mnavMoved.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      mnav.appendChild(el);
    });
    root.classList.remove(OPEN_CLASS); /* на мобилке стартуем закрытым */
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
      } catch (e) {}
    });
    mnavMoved = [];
    if (mnav) mnav.style.display = "none";
    if (mnavBackdrop) mnavBackdrop.style.display = "none";
    root.classList.remove(OPEN_CLASS);
    mnavBuilt = false;
  }

  function syncMnav() {
    if (MNAV_BP >= window.innerWidth) enterMnav();
    else exitMnav();
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
    /* Подтвердить (submit — оставляем в форме) + Очистить (ссылка) в один ряд */
    var confirmBtn = document.getElementById("update_filters");
    var clearLink = document.getElementById("link_to_clear_general_filters");
    filtActionsOrig = [];
    [confirmBtn, clearLink].forEach(function (el) {
      if (el) {
        filtActionsOrig.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      }
    });
    if (confirmBtn) {
      filtRow = document.createElement("div");
      filtRow.id = "lk-filt-actions";
      confirmBtn.parentNode.insertBefore(filtRow, confirmBtn);
      filtRow.appendChild(confirmBtn);
      if (clearLink) filtRow.appendChild(clearLink);
    }
    root.classList.remove("filt-open");
    filtBuilt = true;
  }

  function exitFilt() {
    if (!filtBuilt) return;
    /* вернуть Подтвердить/Очистить на исходные места и снять ряд */
    filtActionsOrig.forEach(function (o) {
      try {
        if (o.next && o.next.parentNode === o.parent) {
          o.parent.insertBefore(o.el, o.next);
        } else {
          o.parent.appendChild(o.el);
        }
      } catch (e) {}
    });
    filtActionsOrig = [];
    if (filtRow && filtRow.parentNode) filtRow.parentNode.removeChild(filtRow);
    filtRow = null;
    filtMoved.forEach(function (o) {
      try {
        if (o.next && o.next.parentNode === o.parent) {
          o.parent.insertBefore(o.el, o.next);
        } else {
          o.parent.appendChild(o.el);
        }
      } catch (e) {}
    });
    filtMoved = [];
    if (filtBtn && filtBtn.parentNode) filtBtn.parentNode.removeChild(filtBtn);
    if (filt) filt.style.display = "none";
    if (filtBd) filtBd.style.display = "none";
    root.classList.remove("filt-open");
    filtBuilt = false;
  }

  function syncFilt() {
    if (FILT_BP >= window.innerWidth) enterFilt();
    else exitFilt();
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

  function onReady() {
    createBurger();
    syncMnav();
    syncFilt();
    mnavDebug();
    tagRailIcons();
    /* графики могут подтягиваться по ajax — перерисовываем с несколькими попытками */
    reflowCharts();
    setTimeout(reflowCharts, 500);
    setTimeout(reflowCharts, 1500);
    /* широкие отчёты: липкая полоса + drag-to-pan + обёртка кнопок экспорта
       (данные/кнопки могут подгружаться по ajax — повторяем с задержками) */
    enhanceReports();
    setTimeout(enhanceReports, 800);
    setTimeout(enhanceReports, 1800);
    /* и наблюдаем за поздней AJAX-загрузкой данных отчёта */
    observeReports();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
  window.addEventListener("load", reflowCharts);
  window.addEventListener("resize", reflowCharts);

  /* Липкая гориз. полоса: следим за скроллом/ресайзом страницы. */
  window.addEventListener("scroll", scheduleHBar, { passive: true });
  window.addEventListener("resize", function () {
    refreshScrollers();
    sizeExportBars();
    scheduleHBar();
    syncMnav();
    syncFilt();
  });
  window.addEventListener("load", function () {
    /* после load ширина уже с учётом viewport-меты (телефон перевёрстан из 980
       в device-width) — перезапускаем меню/фильтры, иначе рельса могла не
       переместиться (syncMnav мог отработать на 980 = "десктоп"). */
    syncMnav();
    syncFilt();
    setTimeout(function () {
      syncMnav();
      syncFilt();
      enhanceReports();
      mnavDebug();
    }, 300);
  });
})();
