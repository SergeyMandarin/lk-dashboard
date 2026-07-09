# Оформление личного кабинета (checker-soft)

Хостинг статических ассетов для кастомизации ЛК клиентов.

## Файлы
- `sidebar-toggle.js` — боковое меню (кнопка-бургер, сдвиг контента, запоминание
  состояния) + подгонка графиков Highcharts под контейнер.
- `dashboard.css` — тема и вёрстка дашборда (шапка, фильтры, меню, график).
- `.nojekyll` — отключает обработку Jekyll на GitHub Pages (отдаём файлы как есть).

## Подключение в ЛК клиента

В поле для JS в личном кабинете вставить **загрузчик** (в нём нет символа `<`,
поэтому поле его не обрежет). Файл отдаём через **jsDelivr** прямо из GitHub-репо
(домен `cdn.jsdelivr.net` разрешён в CSP платформы; `github.io` — заблокирован).
Заменить `USERNAME` и `REPO` на свои:

```javascript
(function () {
  try {
    if (localStorage.getItem("lk-sidebar-open") === "1")
      document.documentElement.classList.add("sb-open");
  } catch (e) {}
  var s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/gh/USERNAME/REPO@main/sidebar-toggle.js";
  s.async = false;
  (document.head || document.documentElement).appendChild(s);
})();
```

Репозиторий должен быть **public**. CSS пока подключается штатным полем CSS
дашборда (содержимым `dashboard.css`).

## Обновление
Меняем файл в репозитории → коммит/пуш. jsDelivr кеширует `@main` (~до 12 ч),
клиентов трогать не нужно. Чтобы обновление доехало **сразу** — открыть один раз
пург-ссылку:
`https://purge.jsdelivr.net/gh/USERNAME/REPO@main/sidebar-toggle.js`
