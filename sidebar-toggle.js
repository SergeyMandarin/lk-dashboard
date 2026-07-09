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
    /* после анимации сдвига контента (0.25s) перерисовываем графики */
    setTimeout(reflowCharts, 320);
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

  /* Иконки разделов средней рельсы: вешаем класс lk-sec-<ключ> по НАЗВАНИЮ
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

  function onReady() {
    createBurger();
    tagRailIcons();
    /* графики могут подтягиваться по ajax — перерисовываем с несколькими попытками */
    reflowCharts();
    setTimeout(reflowCharts, 500);
    setTimeout(reflowCharts, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
  window.addEventListener("load", reflowCharts);
  window.addEventListener("resize", reflowCharts);
})();
