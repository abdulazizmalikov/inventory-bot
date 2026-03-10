# Telegram Inventory Management Bot

Telegram бот для управления складом с интеграцией Google Sheets и Uzum Market API.

## Возможности

- Управление инвентарем через 3 склада: В пути, Офис, Маркетплейс
- Создание и получение заказов от поставщиков
- Отправка товаров на маркетплейсы (Uzum, Yandex)
- Возвраты товаров
- Расчет прибыли на основе продаж и себестоимости
- Интеграция с Google Sheets как основная база данных

## Установка

### 1. Клонирование и установка зависимостей

```bash
npm install
```

### 2. Настройка Google Sheets

#### Создание Service Account

1. Перейдите в [Google Cloud Console](/)
2. Создайте новый проект или выберите существующий
3. Включите Google Sheets API:
   - Перейдите в "APIs & Services" > "Library"
   - Найдите "Google Sheets API" и включите его
4. Создайте Service Account:
   - Перейдите в "APIs & Services" > "Credentials"
   - Нажмите "Create Credentials" > "Service Account"
   - Заполните имя и создайте аккаунт
   - Перейдите в созданный Service Account
   - Во вкладке "Keys" создайте новый ключ (JSON)
   - Скачайте JSON файл

#### Настройка Google Sheet

1. Создайте новую Google Sheet
2. Скопируйте ID из URL (между `/d/` и `/edit`)
3. Поделитесь листом с email вашего Service Account (дайте права редактора)
4. Создайте листы согласно схеме (см. `docs/sheets-schema.md`)
5. **ВАЖНО:** Все суммы в USD. Убедитесь, что заголовки колонок используют `_usd` вместо `_uzs` (см. `docs/sheets-migration-usd.md`)

### 3. Настройка Telegram Bot

1. Создайте бота через [@BotFather](https://t.me/BotFather)
2. Получите токен бота
3. Узнайте свой Telegram User ID (можно через [@userinfobot](https://t.me/userinfobot))

### 4. Настройка Uzum API

**Важно:** Uzum API интеграция реализована как заглушка. Вам нужно:

1. Получить API ключи от Uzum Market (если доступны)
2. Узнать базовый URL API и эндпоинты
3. Обновить файл `src/services/uzum.ts` с правильными эндпоинтами:
   - `getStock(sku)` - получение остатков по SKU
   - `getSales(startDate, endDate)` - получение продаж за период

**Если API недоступен:**
- Бот будет работать, но функции маркетплейса будут показывать "API не настроен"
- Вы можете вручную заполнять данные о продажах в лист `uzum_sales_raw`

### 5. Конфигурация

1. Скопируйте `.env.example` в `.env`
2. Заполните все необходимые значения:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_IDS=your_telegram_user_id
GOOGLE_SHEETS_ID=your_sheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
UZUM_API_BASE_URL=https://api.uzum.uz/api/v1
UZUM_API_KEY=your_api_key
UZUM_API_SECRET=your_api_secret
```

**Важно:** Для `GOOGLE_PRIVATE_KEY` используйте приватный ключ из JSON файла Service Account. 

Извлечение приватного ключа:
1. Откройте скачанный JSON файл Service Account
2. Найдите поле `private_key`
3. Скопируйте значение (включая `-----BEGIN PRIVATE KEY-----` и `-----END PRIVATE KEY-----`)
4. В `.env` сохраните его в кавычках, заменив реальные переносы строк на `\n`:

```env
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
```

## Запуск

### Разработка

```bash
npm run dev
```

### Продакшн

```bash
npm run build
npm start
```

## Структура проекта

```
inventory-bot/
├── src/
│   ├── index.ts              # Точка входа
│   ├── bot.ts                # Основной файл бота
│   ├── types/                 # TypeScript типы
│   ├── services/              # Сервисы
│   │   ├── sheets.ts         # Google Sheets API
│   │   ├── uzum.ts           # Uzum API
│   │   └── stock.ts          # Логика работы со складом
│   ├── handlers/              # Обработчики команд
│   │   ├── orders.ts         # Заказы (Flow A, B)
│   │   ├── shipments.ts     # Отправки (Flow C)
│   │   ├── returns.ts        # Возвраты (Flow D)
│   │   ├── warehouses.ts    # Склады (Flow E)
│   │   └── profit.ts         # Прибыль (Flow F)
│   └── utils/                 # Утилиты
├── docs/                      # Документация
│   ├── sheets-schema.md     # Схема Google Sheets
│   └── test-plan.md         # План тестирования
└── package.json
```

## Использование

После запуска бота отправьте команду `/start` в Telegram.

### Основные команды:

- 🚚 **В пути** - управление заказами в пути
- 📤 **Отправка** - отправка товаров на маркетплейс
- 🔁 **Возврат** - возврат товаров в офис
- 🏬 **Склады** - просмотр остатков на складах
- 💰 **Прибыль** - расчет прибыли
- 🔄 **Обновить продажи** - обновление данных о продажах из API

## Тестирование

См. `docs/test-plan.md` для подробного плана тестирования.

## Лицензия

MIT

