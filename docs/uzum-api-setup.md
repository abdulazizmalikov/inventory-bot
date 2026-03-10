# Настройка Uzum API

Этот документ описывает, как настроить интеграцию с Uzum Market API.

## Текущая реализация

Интеграция с Uzum API реализована как заглушка с интерфейсом. Вам нужно заполнить реальные эндпоинты в файле `src/services/uzum.ts`.

## Требуемые эндпоинты

### 1. Получение остатков (Stock)

**Метод:** `getStock(sku: string): Promise<number>`

**Требования:**
- Принимает SKU (артикул) как параметр
- Возвращает количество товара на маркетплейсе
- Должен обрабатывать ошибки (если товар не найден, возвращать 0)

**Пример реализации:**
```typescript
async getStock(sku: string): Promise<number> {
  const response = await this.makeRequest(
    `/inventory/stock?article=${encodeURIComponent(sku)}`
  );
  return response.data?.qty || response.qty || 0;
}
```

**Возможные форматы ответа API:**
```json
// Вариант 1
{
  "data": {
    "qty": 10
  }
}

// Вариант 2
{
  "qty": 10
}

// Вариант 3
{
  "stock": 10
}
```

### 2. Получение продаж (Sales)

**Метод:** `getSales(startDate: string, endDate: string): Promise<Array<...>>`

**Требования:**
- Принимает даты начала и конца периода (ISO format)
- Возвращает массив продаж с полями:
  - `article` (string) - SKU/артикул
  - `sold_at` (string) - дата продажи
  - `qty` (number) - количество
  - `net_revenue_uzs` (number) - чистая выручка после комиссий

**Пример реализации:**
```typescript
async getSales(startDate: string, endDate: string): Promise<Array<{
  article: string;
  sold_at: string;
  qty: number;
  net_revenue_uzs: number;
}>> {
  const response = await this.makeRequest(
    `/sales/report?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`
  );
  
  // Обработайте ответ в зависимости от формата API
  return response.data?.sales || response.sales || [];
}
```

**Возможные форматы ответа API:**
```json
// Вариант 1
{
  "data": {
    "sales": [
      {
        "article": "ZEZSHOP-S1MLKS",
        "sold_at": "2024-01-20T12:00:00Z",
        "qty": 2,
        "net_revenue_uzs": 200000
      }
    ]
  }
}

// Вариант 2
{
  "sales": [
    {
      "article": "ZEZSHOP-S1MLKS",
      "sold_at": "2024-01-20T12:00:00Z",
      "qty": 2,
      "net_revenue_uzs": 200000
    }
  ]
}
```

## Аутентификация

Текущая реализация использует заголовки:
- `X-API-Key`: API ключ
- `X-API-Secret`: API секрет

Если Uzum API использует другой метод аутентификации (OAuth, Bearer token, и т.д.), обновите метод `makeRequest` в `src/services/uzum.ts`.

**Пример с Bearer token:**
```typescript
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${this.apiKey}`,
};
```

## Тестирование

После настройки API:

1. Запустите бота
2. Перейдите в "🏬 Склады" → "🛒 Маркетплейс"
3. Проверьте, что остатки загружаются
4. Перейдите в "🔄 Обновить продажи"
5. Выберите период и проверьте импорт продаж

## Если API недоступен

Если Uzum API недоступен или не предоставлен:

1. Бот будет работать в ограниченном режиме
2. Функция "Маркетплейс" будет показывать "API не настроен"
3. Вы можете вручную заполнять продажи в Google Sheets (лист `uzum_sales_raw`)
4. Расчет прибыли будет работать на основе данных из Sheets

## Документация Uzum API

Если у вас есть доступ к документации Uzum Market API, используйте ее для точной настройки эндпоинтов и форматов данных.

## Поддержка других маркетплейсов

Для добавления поддержки других маркетплейсов (например, Yandex):

1. Создайте новый сервис по аналогии с `UzumService`
2. Добавьте его в `src/bot.ts`
3. Обновите обработчики для использования соответствующего сервиса

