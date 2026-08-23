# client

Один чат поверх [API](../api/README.md): гість логіниться у власний акаунт Сільпо, і все відбувається в одній розмові — вільний текст, і структурований "📝 Скласти раціон" (компактна форма: люди, дні, алергени, кухня, обладнання, формат готування, бюджет). Результат — картка страв прямо в треді чату (фото інгредієнтів, БЖУ+калораж, склад, чекбокси), звідти ж одним кліком наповнюється реальний кошик у Сільпо. Ліворуч — sidenav з історією тредів (Postgres, прив'язано до акаунту), кожен тред тримає і вільні повідомлення, і картки раціонів вперемішку — не два розділені режими.

React + Vite, без TypeScript — плейн JS/JSX. Redux Toolkit + RTK Query для стану й HTTP-викликів, react-router-dom для навігації між тредами, React Context — для двох модалок.

## Запуск

```bash
npm install
npm run dev     # http://localhost:5173, hot reload
npm run build    # прод-збірка в dist/
npm run preview  # локально підняти prod-збірку
```

Переконайся, що `api/` вже запущений (`npm run dev`, за замовчуванням :3000) — CORS там уже увімкнено.

## Структура

```
src/
  main.jsx                точка входу: <Provider><BrowserRouter><ModalProvider><App/></ModalProvider></BrowserRouter></Provider>
  App.jsx                  <Routes>: /login (LoginPage) окремо, /, /c/:conversationId, /family, /family/c/:conversationId
                            — усі чотири під RequireAuth і всі → той самий RootLayout (сімейні роути відрізняються лише
                            префіксом; RootLayout сам виводить з нього scope, а не окремий route tree) + bootstrap:
                            ?silpoAuth= редирект-параметр, початкова перевірка автентифікації, застосування теми до <html>
  style.css                 design-token стилі (світла/темна тема), без змін
  constants.js               ключі localStorage, опції чипів (алергени/кухня/обладнання/формат), лейбли

  app/                        Redux Toolkit
    store.js                    configureStore — api reducer + 5 слайсів нижче
    api.js                       RTK Query: усі HTTP-виклики до API (один createApi), динамічний baseUrl
                                  (читає apiUrl зі стану на кожен виклик), 401 з БУДЬ-ЯКОГО ендпоінта →
                                  dispatch(setAuthenticated(false)) в одному місці замість перевірки в кожному хендлері
    settingsSlice.js              apiUrl / sessionId / theme, синхронізовані з localStorage
    authSlice.js                   { isAuthenticated, isChecked } — isChecked стає true після першої реальної
                                    відповіді (статус-чек / ?silpoAuth= / 401), щоб RequireAuth не встиг
                                    відредиректити залогіненого гостя на /login за той один кадр, поки перевірка ще в польоті
    statusSlice.js                  текст статус-бару { text, isError }
    profileDraftSlice.js             чернетка форми (люди/дні/алергени/кухня/обладнання/формат/бюджет/побажання),
                                      спільна для PlanForm і ProfileModal, синхронізована з localStorage
    chatUiSlice.js                    activeConversationId — дзеркало :conversationId з роута (див. RootLayout)

  context/
    ModalContext.jsx           ModalProvider тримає рефи двох <dialog> і монтує PlanForm/ProfileModal один раз;
                                useModals() → { openPlanForm, closePlanForm, openProfileModal, closeProfileModal }

  routes/
    RequireAuth.jsx              layout route: null, поки isChecked === false; редирект на /login, коли
                                  isChecked && !isAuthenticated; інакше <Outlet/>
    LoginPage.jsx                 окрема сторінка /login — <AuthGate/> + статус-бар; редирект на / тільки-но
                                   isChecked && isAuthenticated (guest, який зайшов на /login вже залогінений)
    RootLayout.jsx                рендериться лише під RequireAuth, тож тут auth уже гарантовано true — чат-лейаут,
                                   синхронізує useParams() → chatUiSlice, підвантажує профіль і гідрує profileDraft

  hooks/
    useLogout.js                 весь логаут одним викликом: POST /auth/silpo/logout, новий sessionId, скидання
                                  чернетки й усього RTK Query кешу, закриття відкритих модалок, navigate('/')
                                  (RequireAuth сам відредиректить далі на /login, щойно isAuthenticated стане false)

  components/
    AuthGate.jsx             картка "Спочатку увійди в Сільпо" всередині LoginPage — сам читає sessionId/apiUrl з Redux
    ChatSidenav.jsx          список тредів (useListChatsQuery), "+ Нова розмова"/вибір треду — navigate(), видалення
                              (useDeleteChatMutation); внизу — "📝 Скласти раціон" (useModals()) і бейдж профілю
    ChatPanel.jsx            бульбашки + картки раціонів; useGetChatQuery/useSendMessageMutation
    DishPlanWidget.jsx        картка раціону — DishGrid + власний вибір страв + useCheckoutMutation
    DishGrid.jsx              карточки страв (без змін, чисто презентаційний)
    ProfileMenu.jsx          дропдаун профілю — useModals(), useLogout(), theme через settingsSlice
    ProfileModal.jsx         модалка "Мій профіль" — useGetProfileQuery/useSavePreferencesMutation
    PlanForm.jsx             модалка "Скласти раціон" — profileDraftSlice + useGeneratePlanMutation
    OptionGrid.jsx            переюзаний чипс-грід (без змін, чисто презентаційний)
```

Жоден компонент не отримує `sessionId`/`accountInfo`/тред/тему тощо через props з `App.jsx` — усе через хуки (`useSelector`, RTK Query, `useModals()`, `useParams()`). Єдине, що ще передається пропсами — локальні, однорівневі речі всередині одного компонента (наприклад `DishPlanWidget`'s `dishes`).

## Як це працює

- **Логін у Сільпо блокує весь застосунок через окрему сторінку `/login`** — `RequireAuth` (layout route навколо `/` і `/c/:conversationId`) редиректить туди, поки `auth.isAuthenticated` не `true`; `LoginPage` редиректить назад на `/`, якщо гість уже залогінений. Кнопка на `/login` веде на `GET /auth/silpo/authorize?sessionId=...` бекенду (повна навігація сторінки, не fetch). Після завершення Сільпо повертає на бекенд, а той — на `/` (не на `/login`) з `?silpoAuth=success|already|error` у URL; `App.jsx` зчитує це через `useSearchParams()`, виставляє `isAuthenticated`/`isChecked` і прибирає параметр — `RequireAuth` після цього або пропускає на `/`, або, на `error`, відсилає назад на `/login` зі статус-повідомленням. `sessionId` — `crypto.randomUUID()`, живе в `settingsSlice`/`localStorage`. 401 з будь-якого RTK Query ендпоінта (`app/api.js`'s `dynamicBaseQuery`) миттєво скидає `isAuthenticated` в одному місці — жоден компонент більше не перевіряє статус-код сам, а `RequireAuth` сам відреагує редиректом.
- **Один екран — чат**, завжди на весь viewport. Двоколонковий layout: зліва `ChatSidenav` (список тредів, "+ Нова розмова" — `navigate('/')`, клік по треду — `navigate('/c/:id')`, ✕ — `useDeleteChatMutation`; внизу — "📝 Скласти раціон" і бейдж профілю), справа `ChatPanel` — бульбашки user/assistant **і** картки раціонів (`DishPlanWidget`) вперемішку, автоскрол донизу, інпут знизу. Активний тред — це `:conversationId` в URL (`/` = новий/жоден), не React-стан: можна забукмаркати, перейти назад/вперед браузером, перезавантажити сторінку на `/c/abc123`.
- **`GET /agent/chats/:id` кешується RTK Query за ключем `{sessionId, id}`** — повторний візит у вже відкритий тред рендериться миттєво зі старого кешу, без спалаху "Завантажую розмову...". **`POST /agent/messages`/`POST /agent/plan`** патчать саме цей кеш напряму (`api.util.upsertQueryData`) в момент відповіді — для нового треду це одразу *засіює* кеш під щойно отриманий `conversationId`, тож `navigate('/c/:newId')` після цього рендериться миттєво, без зайвого запиту. Бульбашка з власним повідомленням гостя, поки тред ще не існує (немає `conversationId` — нема кеш-ключа, щоб оптимістично патчити наперед), показується окремим локальним станом `pendingUserText` у `ChatPanel` — зникає сама, щойно приходить справжній кеш під новим `conversationId`.
- **"📝 Скласти раціон"** відкриває `PlanForm` — компактну модалку з усіма полями на одному екрані (не покроковий майстер: це вже допоміжна дія всередині чату, а не головний онбординг). Сабміт шле `POST /agent/plan` з `conversationId` активного треду (`chatUiSlice`, синхронізовано з `:conversationId` роута — `PlanForm` монтується поза деревом роутів, у `ModalContext`, тож `useParams()` там сам по собі не спрацював би).
- **Картка раціону** (`DishPlanWidget`) — власний `Set` вибраних страв (за замовчуванням усі), `DishGrid` + кнопка "🛒 Купити в Сільпо" (`useCheckoutMutation`, агрегує інгредієнти обраних страв за `productId`). Після успіху відкривається `https://silpo.ua/basket`. Кожна картка в треді має незалежний вибір — регенерація додає новий тред-запис, не переписує попередній.
- **Профіль** (бейдж унизу sidenav → `ProfileMenu` → "⚙️ Налаштування") відкриває `ProfileModal` — те саме `profileDraftSlice`, що й `PlanForm`, плюс read-only блок з акаунту Сільпо (`useGetProfileQuery`). "Зберегти" — `useSavePreferencesMutation`, інвалідує `Profile`-тег. Тема — трипозиційний перемикач прямо в меню (`settingsSlice`, `data-theme` на `<html>` виставляє `App.jsx`). "🚪 Вийти" — `useLogout()` (`hooks/useLogout.js`): `POST /auth/silpo/logout`, новий `sessionId`, `dispatch(api.util.resetApiState())` (весь RTK Query кеш геть одним викликом — профіль, треди, усе), скидання чернетки, закриття відкритих модалок, `navigate('/')`.

## Чому React, а не vanilla JS

Попередня vanilla-JS версія кілька разів ловила один і той самий клас багів: `[hidden]`-атрибут на елементі не спрацьовував, бо в CSS для того самого класу вже був безумовний `display: X`, який (за правилами каскаду) переважає юзер-агентський `[hidden] { display: none }`. React-компоненти умовно рендерять розмітку (`{condition && <X/>}`) замість перемикання класів/атрибутів на статичному DOM — цей клас багів структурно неможливий.

## Чому чат і форма злиті, а не два окремих режими

Спочатку вони й були окремими: покроковий майстер → окрема сторінка результатів, і паралельно — незалежний чат зі своєю історією. На практиці це відчувалось як два різні застосунки під одним логіном, а не один продукт. Тепер `/agent/plan` — це просто ще один спосіб додати хід у той самий тред (поряд із вільним текстом через `/agent/messages`), і його результат — рядок в тій самій історії, а не стан окремої сторінки. Бекенд зберігає повний `dishes[]` окремо від тексту, який бачить Claude (`widgets` vs `messages` — див. [`../api/README.md`](../api/README.md)), тож картка переживає перезавантаження й перемикання тредів, а вартість наступних ходів у розмові не росте від розміру раціону.

## Сімейні чати

Другий, окремий "простір" тредів поряд з особистими — не інший продукт, той самий `ChatPanel`/`ChatSidenav`, просто з `scope="family"` (визначається в `RootLayout.jsx` з префіксу `/family` у URL, а не окремим деревом роутів). Показується в sidenav лише якщо `GET /agent/family` повернув реальний `familyId` — тобто гість справді в сім'ї в Сільпо (`silpo_get_my_family` на бекенді, без жодного invite-коду з нашого боку — див. [`../api/README.md`](../api/README.md)). Усередині сімейного треду: та сама стрічка бульбашок і карток (`DishPlanWidget`/`OccasionBasketWidget`/`IngredientOptionsWidget` — усі три тепер приймають `scope`, щоб заміна інгредієнта чи "🛒 Купити" в family-треді била в `/agent/family-messages`, а не в особистий `/agent/messages`).

Форми "📝 Скласти раціон"/"🍲 Скласти страву"/"🎉 Набір" теж працюють у сімейному режимі, не лише в особистому — кожна сама визначає scope через `useLocation().pathname.startsWith('/family')` (вони змонтовані поза деревом роутів у `ModalContext`, тож не отримують scope пропом, як `ChatPanel`/`ChatSidenav`) і шле результат або через `useSendFamilyMessageMutation` (`DishForm`/`OccasionForm` — обидві й так лише компонують вільний текст і шлють його як звичайне повідомлення), або через `POST /agent/plan` з `familyChat: true` (`PlanForm` — єдина, що йде через окремий структурований `/agent/plan`, не через чат-цикл; бекенд лишає саму генерацію без змін і лише вирішує, в який тред покласти картку — див. `AgentService.planMeals` у [`../api/README.md`](../api/README.md)).

## Відомий компроміс: SPA-роутинг і продакшн-хостинг

`react-router-dom` тут — `BrowserRouter` (звичайні `/c/abc123` URL, не `#/c/abc123`). Це означає, що хост, який роздаватиме зібраний `dist/`, має фолбечити будь-який невідомий шлях на `index.html` (типове правило rewrite для SPA — є з коробки в Netlify/Vercel/nginx `try_files`). Зараз у репозиторії немає продакшн-сервера для `client/` (лише `vite dev`/`vite preview`, обидва це роблять із коробки) — це просто нотатка, щоб не здивувало на етапі деплою.
