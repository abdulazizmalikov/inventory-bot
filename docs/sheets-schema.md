# Google Sheets Schema

Этот документ описывает структуру Google Sheets, используемую как база данных для бота управления складом.

## Создание листов

Создайте следующие листы (tabs) в вашей Google Sheet:

1. `skus`
2. `suppliers`
3. `purchase_orders`
4. `purchase_order_items`
5. `movements`
6. `office_stock`
7. `sku_costs` — база себестоимости (для расчёта сумм по офису и маркетплейсу)
8. `uzum_sales_raw`
9. `profit_calc`
10. `write_offs` — списания с офиса (отправки)

## Структура листов

### 1. skus

Список всех SKU (артикулов).

| Колонка | Тип | Описание |
|---------|-----|----------|
| sku | string | Артикул (уникальный идентификатор) |
| active | boolean | Активен ли товар (TRUE/FALSE) |
| created_at | datetime | Дата создания |
| created_by | string | Создатель (обычно "admin") |

**Пример данных:**
```
sku,active,created_at,created_by
ZEZSHOP-S1MLKS,TRUE,2024-01-15T10:00:00Z,admin
ZEZSHOP-S2MLKS,TRUE,2024-01-15T10:00:00Z,admin
```

### 2. suppliers

Список поставщиков.

| Колонка | Тип | Описание |
|---------|-----|----------|
| supplier_id | string | ID поставщика (уникальный) |
| supplier_name | string | Название поставщика |
| contacts | string | Контакты (опционально) |
| created_at | datetime | Дата создания |
| created_by | string | Создатель |

**Пример данных:**
```
supplier_id,supplier_name,contacts,created_at,created_by
SUP-1234567890,Поставщик А,+998901234567,2024-01-15T10:00:00Z,admin
```

### 3. purchase_orders

Заказы у поставщиков.

| Колонка | Тип | Описание |
|---------|-----|----------|
| po_id | string | ID заказа (уникальный) |
| order_name | string | Название заказа (вводит пользователь) |
| supplier_id | string | ID поставщика |
| order_amount_usd | number | Сумма заказа (USD) |
| shipping_cost_usd | number | Стоимость доставки (USD) |
| total_amount_usd | number | Итого (order + shipping) |
| total_qty | number | Общее количество товаров |
| unit_cost_usd | number | Средняя себестоимость (total_amount / total_qty) |
| status | string | Статус: IN_TRANSIT или RECEIVED |
| created_at | datetime | Дата создания заказа |
| received_at | datetime | Дата получения (если получен) |
| created_by | string | Создатель |

**Пример данных:**
```
po_id,order_name,supplier_id,order_amount_usd,shipping_cost_usd,total_amount_usd,total_qty,unit_cost_usd,status,created_at,received_at,created_by
PO-1234567890-abc123,Заказ от Поставщика А,SUP-1234567890,1000,50,1050,100,10.5,IN_TRANSIT,2024-01-15T10:00:00Z,,admin
```

### 4. purchase_order_items

Товары в заказах.

| Колонка | Тип | Описание |
|---------|-----|----------|
| po_id | string | ID заказа |
| sku | string | Артикул |
| qty | number | Количество |
| unit_cost_uzs | number | Себестоимость за единицу |
| created_at | datetime | Дата создания |

**Пример данных:**
```
po_id,sku,qty,unit_cost_uzs,created_at
PO-1234567890-abc123,ZEZSHOP-S1MLKS,50,10500,2024-01-15T10:00:00Z
PO-1234567890-abc123,ZEZSHOP-S2MLKS,50,10500,2024-01-15T10:00:00Z
```

### 5. movements

Журнал всех движений товаров (неизменяемый ledger).

| Колонка | Тип | Описание |
|---------|-----|----------|
| move_id | string | ID движения (уникальный) |
| type | string | Тип: PO_CREATE, PO_RECEIVE, SHIP, RETURN |
| source | string | Откуда: IN_TRANSIT, OFFICE, MARKETPLACE, NONE |
| destination | string | Куда: IN_TRANSIT, OFFICE, MARKETPLACE, NONE |
| marketplace | string | Маркетплейс: UZUM, YANDEX, NONE |
| sku | string | Артикул |
| qty | number | Количество |
| unit_cost_uzs | number | Себестоимость (опционально) |
| amount_uzs | number | Сумма (опционально) |
| note | string | Примечание (опционально) |
| created_at | datetime | Дата и время |
| created_by | string | Создатель |

**Пример данных:**
```
move_id,type,source,destination,marketplace,sku,qty,unit_cost_uzs,amount_uzs,note,created_at,created_by
MOVE-1234567890-xyz,PO_CREATE,NONE,IN_TRANSIT,NONE,ZEZSHOP-S1MLKS,50,10500,,,2024-01-15T10:00:00Z,admin
```

### 6. office_stock

Текущие остатки в офисе (материализованное представление).

| Колонка | Тип | Описание |
|---------|-----|----------|
| sku | string | Артикул (уникальный) |
| qty | number | Количество |
| updated_at | datetime | Дата последнего обновления |

**Пример данных:**
```
sku,qty,updated_at
ZEZSHOP-S1MLKS,25,2024-01-20T15:30:00Z
ZEZSHOP-S2MLKS,30,2024-01-20T15:30:00Z
```

### 7. sku_costs

База себестоимости товаров (одна запись на SKU). Используется для расчёта **суммы товаров в офисе** и **суммы товаров на маркетплейсе** в разделе «Склады → Итого». Порядок строк не важен — поиск по полю `sku`.

| Колонка | Тип | Описание |
|---------|-----|----------|
| sku | string | Артикул (уникальный) |
| unit_cost_usd | number | Себестоимость за единицу (USD) |
| updated_at | datetime | Дата последнего обновления |

**Пример данных:**
```
sku,unit_cost_usd,updated_at
ZEZSHOP-S1MLKS,10.5,2024-01-20T15:30:00Z
ZEZSHOP-S2MLKS,8.2,2024-01-20T15:30:00Z
```

### 8. uzum_sales_raw

Сырые данные о продажах из Uzum API.

| Колонка | Тип | Описание |



|---------|-----|----------|
| sale_id | string | ID продажи (из API) |
| doc_id | string | ID документа (из API, опционально) |
| sold_at | datetime | Дата продажи |
| sku | string | Артикул |
| qty | number | Количество |
| net_revenue_uzs | number | Чистая выручка (после комиссий) |
| raw_json | string | Сырые данные JSON (опционально) |
| created_at | datetime | Дата импорта |

**Пример данных:**
```
sale_id,doc_id,sold_at,sku,qty,net_revenue_uzs,raw_json,created_at
SALE-123,DOC-456,2024-01-20T12:00:00Z,ZEZSHOP-S1MLKS,2,200000,"{...}",2024-01-20T13:00:00Z
```

### 9. profit_calc

Расчеты прибыли по периодам.

| Колонка | Тип | Описание |
|---------|-----|----------|
| calc_id | string | ID расчета (уникальный) |
| period_start | datetime | Начало периода |
| period_end | datetime | Конец периода |
| sku | string | Артикул |
| qty_sold | number | Количество проданных |
| net_revenue_uzs | number | Чистая выручка |
| avg_cogs_uzs | number | Средняя себестоимость (из последних 3 заказов) |
| cogs_total_uzs | number | Общая себестоимость (avg_cogs * qty_sold) |
| profit_uzs | number | Прибыль (net_revenue - cogs_total) |
| created_at | datetime | Дата расчета |

**Пример данных:**
```
calc_id,period_start,period_end,sku,qty_sold,net_revenue_uzs,avg_cogs_uzs,cogs_total_uzs,profit_uzs,created_at
CALC-123,2024-01-01T00:00:00Z,2024-01-31T23:59:59Z,ZEZSHOP-S1MLKS,10,1000000,10500,105000,895000,2024-02-01T10:00:00Z
```

### 10. write_offs

Списания с офиса (отправки): товар, количество, комментарий.

| Колонка | Тип | Описание |
|---------|-----|----------|
| write_off_id | string | ID списания (уникальный) |
| sku | string | Артикул |
| qty | number | Количество |
| comment | string | Комментарий (причина/назначение) |
| created_at | datetime | Дата и время |
| created_by | string | Кто оформил |

**Пример данных:**
```
write_off_id,sku,qty,comment,created_at,created_by
WO-1739123456789-abc,ZEZSHOP-S1MLKS,5,Отправка клиенту,2024-02-20T10:00:00Z,admin
```

## Инициализация листов

### Шаг 1: Создайте листы

В Google Sheets создайте 9 листов с указанными выше именами.

### Шаг 2: Добавьте заголовки

В первой строке каждого листа добавьте заголовки колонок (как указано в таблицах выше).

**Для листа `ideas`:**
```
idea_id,idea_text,created_at,created_by
```

### Шаг 3: Настройте форматирование (опционально)

- Для колонок с датами: формат "Дата и время"
- Для колонок с числами: формат "Число"
- Для boolean: можно использовать TRUE/FALSE или 1/0

### Шаг 4: Добавьте начальные данные

1. **skus**: Добавьте все ваши SKU
2. **suppliers**: Добавьте поставщиков
3. Остальные листы можно оставить пустыми (кроме заголовков)

## Ручное заполнение исторических данных

Для заполнения исторических заказов:

1. Откройте лист `purchase_orders`
2. Добавьте строку с данными заказа (статус должен быть `RECEIVED` для полученных заказов)
3. В листе `purchase_order_items` добавьте строки с товарами этого заказа
4. В листе `movements` добавьте соответствующие записи:
   - `PO_CREATE` при создании заказа
   - `PO_RECEIVE` при получении заказа
5. Обновите `office_stock` вручную или пересчитайте на основе movements

### 11. ideas

Список идей и заметок.

| Колонка | Тип | Описание |
|---------|-----|----------|
| idea_id | string | ID идеи (уникальный) |
| idea_text | string | Текст идеи |
| created_at | datetime | Дата создания |
| created_by | string | Создатель (обычно "admin") |

**Пример данных:**
```
idea_id,idea_text,created_at,created_by
IDEA-1234567890,Добавить функцию экспорта отчетов,2024-01-20T15:30:00Z,admin
```

## Примечания

- Все даты должны быть в формате ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)
- Все суммы в USD (долларах США)
- Лист `movements` является неизменяемым журналом - не удаляйте записи
- Лист `office_stock` можно пересчитывать на основе `movements`, но для MVP проще обновлять его напрямую

