# Оформление личного кабинета (checker-soft)

Хостинг статических ассетов для кастомизации ЛК клиентов.

## Файлы
- `sidebar-toggle.js` — боковое меню (кнопка-бургер, сдвиг контента, запоминание
  состояния) + подгонка графиков Highcharts под контейнер.
- `dashboard.css` — тема и вёрстка дашборда (шапка, фильтры, меню, график).
- `.nojekyll` — отключает обработку Jekyll на GitHub Pages (отдаём файлы как есть).

## Подключение в ЛК клиента

В поле для JS в личном кабинете вставить **загрузчик** (в нём нет символа `<`,
поэтому поле его не обрежет). Заменить `USERNAME` и `REPO` на свои:

```javascript
(function () {
  try {
    if (localStorage.getItem("lk-sidebar-open") === "1")
      document.documentElement.classList.add("sb-open");
  } catch (e) {}
  var s = document.createElement("script");
  s.src = "https://USERNAME.github.io/REPO/sidebar-toggle.js";
  s.async = false;
  (document.head || document.documentElement).appendChild(s);
})();
```

CSS пока подключается штатным полем CSS дашборда (содержимым `dashboard.css`).

## Обновление
Меняем файл в репозитории → коммит/пуш (или загрузка через веб-интерфейс).
GitHub Pages отдаёт с коротким кешем (~10 мин), клиентов трогать не нужно.
Если нужно мгновенно — добавить версию к URL в загрузчике: `...sidebar-toggle.js?v=2`.
