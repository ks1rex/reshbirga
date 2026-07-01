# СтудБиржа

Учебная биржа услуг между студентами. Заказчики публикуют задания (заказы и каталожные услуги), исполнители подают заявки, система удерживает оплату в эскроу, начисляет исполнителю при подтверждении, разрешает споры. Платформа берёт комиссию 10% с каждого пополнения кошелька.

**Функции:** регистрация/профиль, лента заказов, каталог услуг, заявки + аукцион цены, чат заказа, залог, кошелёк (пополнение / вывод), споры, отзывы, поддержка, модерация обмена контактами (regex + DeepSeek AI), Telegram-уведомления, полная панель администратора.

---

## Стек

| Слой | Технология | Деплой |
|------|-----------|--------|
| Frontend | React 19 + Vite 8 | GitHub Pages (`/reshbirga/`) |
| Backend | Node.js 20 + Express | Render (Docker) |
| БД / Auth / Storage | Supabase (PostgreSQL, RLS, S3-хранилище) | supabase.com |
| AI-модерация | DeepSeek API (`deepseek-chat`) | ─ |
| Уведомления | Telegram Bot API (Supabase Edge Function) | supabase.com |

---

## Структура репозитория

```
reshbirga/
├── frontend/                   # React-приложение
│   ├── src/
│   │   ├── pages/              # Страницы (OrderFeed, OrderDetail, Chat, Admin*, ...)
│   │   ├── components/         # Переиспользуемые компоненты (Navbar, ChatWindow, ...)
│   │   ├── contexts/           # AuthContext
│   │   └── utils/              # api.js, upload.js
│   ├── public/                 # Статика (favicon, manifest)
│   ├── .env.example
│   └── vite.config.js          # base: '/reshbirga/'
│
├── backend/                    # Express API
│   ├── src/
│   │   ├── routes/             # orders, admin, wallet, conversations, listings, ...
│   │   ├── middleware/         # auth.js, isBanned.js
│   │   └── utils/              # contactDetector.js, aiChatCheck.js, autoConfirm.js
│   ├── smoke_test.js           # Интеграционный smoke-тест
│   ├── Dockerfile
│   ├── .env.example
│   └── main.js
│
├── supabase/
│   ├── migrations/             # 0001–0023: схема, RLS, функции, индексы
│   └── functions/
│       └── notify-admin-events/ # Edge Function: Telegram-уведомления
│
└── .github/
    └── workflows/
        └── deploy-frontend.yml  # CI/CD: сборка + деплой на GitHub Pages
```

---

## Локальный запуск

### Требования

- Node.js 20+
- Проект Supabase (ref: `vmoyqhuxxmkceqmauujm`) с применёнными миграциями 0001–0023

### Frontend

```bash
cd frontend
cp .env.example .env.local    # заполни VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_BACKEND_URL
npm install
npm run dev                   # http://localhost:5173/reshbirga/
```

### Backend

```bash
cd backend
cp .env.example .env          # заполни все переменные (см. раздел ниже)
npm install
npm run dev                   # http://localhost:3001 (nodemon)
# или: npm start              # без hot-reload
```

Проверка: `GET http://localhost:3001/health` → `{ "status": "ok" }`.

---

## Переменные окружения

### Frontend — `frontend/.env.local`

| Переменная | Описание |
|-----------|---------|
| `VITE_SUPABASE_URL` | URL проекта Supabase (Project Settings → API → Project URL) |
| `VITE_SUPABASE_ANON_KEY` | Anon (public) ключ Supabase |
| `VITE_BACKEND_URL` | URL backend без слэша (`http://localhost:3001` локально) |

### Backend — `backend/.env`

| Переменная | Описание | Секрет? |
|-----------|---------|---------|
| `SUPABASE_URL` | URL проекта Supabase | нет |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key (полный доступ к БД, минуя RLS) | **ДА** |
| `SUPABASE_ANON_KEY` | Anon-ключ (нужен только smoke-тесту) | нет |
| `PORT` | Порт HTTP-сервера (default: `3001`) | нет |
| `FRONTEND_URL` | Разрешённый CORS-origin frontend (без слэша) | нет |
| `AUTO_CONFIRM_HOURS` | Через сколько часов заказ автоподтверждается (default: `24`) | нет |
| `DEEPSEEK_API_KEY` | API-ключ DeepSeek для AI-модерации чата | **ДА** |
| `ADMIN_EMAIL` | Email admin-аккаунта (только для smoke-теста) | нет |
| `ADMIN_PASSWORD` | Пароль admin-аккаунта (только для smoke-теста) | **ДА** |
| `BACKEND_URL` | URL backend для smoke-теста (default: `http://localhost:3001`) | нет |

### Supabase Edge Function — `notify-admin-events`

Секреты задаются в **Supabase Dashboard → Edge Functions → Secrets**, не в backend `.env`:

| Переменная | Описание |
|-----------|---------|
| `TELEGRAM_BOT_TOKEN` | Токен Telegram-бота (`@BotFather`) |
| `TELEGRAM_CHAT_ID` | ID чата/канала для уведомлений |

---

## Деплой

### Frontend → GitHub Pages

Деплой автоматический через GitHub Actions при пуше в `master` (если изменены файлы в `frontend/`).

#### 1. Задай GitHub Secrets

В репозитории: **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Значение |
|--------|---------|
| `VITE_SUPABASE_URL` | URL проекта Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon-ключ Supabase |
| `VITE_BACKEND_URL` | URL Render-сервиса (после деплоя бэка) |

#### 2. Включи GitHub Pages

**Settings → Pages → Source:** выбери `Deploy from a branch`, ветка `gh-pages`, папка `/ (root)`.

> Итоговый URL: `https://ks1rex.github.io/reshbirga/`

#### 3. Обнови Supabase Auth Redirect URLs

**Supabase Dashboard → Authentication → URL Configuration → Redirect URLs:**

Добавь: `https://ks1rex.github.io/reshbirga/**`

---

### Backend → Render

#### 1. Создай Web Service

- New → Blueprint (используй `render.yaml` в корне `backend/`) **или** New → Web Service вручную.
- Источник: этот репозиторий, root directory: `backend/`.
- Environment: **Docker**.
- Health Check Path: `/health`.
- Plan: Free.

#### 2. Задай переменные окружения в Render Dashboard

**Environment → Add Environment Variable** — добавь все переменные из `backend/.env.example`:

| Переменная | Секрет? | Примечание |
|-----------|---------|-----------|
| `SUPABASE_URL` | нет | |
| `SUPABASE_SERVICE_ROLE_KEY` | **ДА** | пометь как Secret |
| `PORT` | нет | Render подставляет автоматически, можно пропустить |
| `FRONTEND_URL` | нет | `https://ks1rex.github.io` |
| `AUTO_CONFIRM_HOURS` | нет | `24` |
| `DEEPSEEK_API_KEY` | **ДА** | пометь как Secret |

> `SUPABASE_ANON_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `BACKEND_URL` нужны только для smoke-теста и не нужны на проде.

#### 3. Обнови CORS на backend

После получения URL Render-сервиса (`https://xxx.onrender.com`) убедись, что `FRONTEND_URL` в Render Dashboard совпадает с твоим GitHub Pages URL: `https://<username>.github.io`.

---

## Тестирование

```bash
cd backend
npm run smoke-test
```

Тест проходит 17 шагов: health, создание пользователей, депозит, заказы (instant deduction, insufficient balance, auction, topup, cancel), выплаты, вывод средств, спор, тикет поддержки, бан/разбан.

> Тест создаёт временные аккаунты `smoketest_*@test.local` и очищает их в конце. Требует запущенного backend и заполненного `backend/.env`.

---

## Администрирование

Доступ к `/admin` — для аккаунтов с `is_admin = true` в таблице `profiles`.

Первый администратор (после регистрации через UI):
```sql
UPDATE profiles SET is_admin = true WHERE id = '<uuid>';
```

### Разделы панели администратора

| Раздел | URL | Назначение |
|--------|-----|-----------|
| Обзор | `/admin` | Сводная статистика: споры, тикеты, баланс, оборот |
| Все заказы | `/admin/orders` | Фильтрация по статусу, типу, поиск по названию/нику |
| Все чаты | `/admin/conversations` | Просмотр переписки, поиск, тип чата |
| Пополнения | `/admin/deposits` | Подтверждение заявок на пополнение кошелька |
| Выплаты | `/admin/withdrawals` | Подтверждение / отклонение заявок на вывод |
| Споры | `/admin/disputes` | Разрешение споров (pay_executor / refund_customer), бан |
| Поддержка | `/admin/support` | Ответы на тикеты, закрытие |
| Пользователи | `/admin/users` | Бан/разбан, просмотр профилей |
| Модерация чата | `/admin/chat-moderation` | Сообщения с контактами (regex + AI-подозрения) |
| Сделки с контактами | `/admin/contact-exchange-orders` | Заказы с флагом `requires_contact_exchange` |
| Реестр транзакций | `/admin/ledger` | Все финансовые операции |

---

## Применение миграций

Миграции уже применены к проекту Supabase. При необходимости повторного применения (новый проект):

```bash
# Через Supabase CLI
supabase db push --linked

# Или вручную: выполни каждый файл из supabase/migrations/ в порядке 0001 → 0023
# через Supabase Dashboard → SQL Editor
```
