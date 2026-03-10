# Миграция Google Sheets: UZS → USD

Этот документ описывает изменения, которые нужно внести в Google Sheets для перехода с UZS на USD.

## Изменения в заголовках колонок

### 1. purchase_orders

**Старые заголовки:**
```
po_id, supplier_id, order_amount_uzs, shipping_cost_uzs, total_amount_uzs, total_qty, unit_cost_uzs, status, created_at, received_at, created_by
```

**Новые заголовки:**
```
po_id, supplier_id, order_amount_usd, shipping_cost_usd, total_amount_usd, total_qty, unit_cost_usd, status, created_at, received_at, created_by
```

**Что изменить:**
- `order_amount_uzs` → `order_amount_usd`
- `shipping_cost_uzs` → `shipping_cost_usd`
- `total_amount_uzs` → `total_amount_usd`
- `unit_cost_uzs` → `unit_cost_usd`

### 2. purchase_order_items

**Старые заголовки:**
```
po_id, sku, qty, unit_cost_uzs, created_at
```

**Новые заголовки:**
```
po_id, sku, qty, unit_cost_usd, created_at
```

**Что изменить:**
- `unit_cost_uzs` → `unit_cost_usd`

### 3. movements

**Старые заголовки:**
```
move_id, type, source, destination, marketplace, sku, qty, unit_cost_uzs, amount_uzs, note, created_at, created_by
```

**Новые заголовки:**
```
move_id, type, source, destination, marketplace, sku, qty, unit_cost_usd, amount_usd, note, created_at, created_by
```

**Что изменить:**
- `unit_cost_uzs` → `unit_cost_usd`
- `amount_uzs` → `amount_usd`

### 4. uzum_sales_raw

**Старые заголовки:**
```
sale_id, doc_id, sold_at, sku, qty, net_revenue_uzs, raw_json, created_at
```

**Новые заголовки:**
```
sale_id, doc_id, sold_at, sku, qty, net_revenue_usd, raw_json, created_at
```

**Что изменить:**
- `net_revenue_uzs` → `net_revenue_usd`

### 5. profit_calc

**Старые заголовки:**
```
calc_id, period_start, period_end, sku, qty_sold, net_revenue_uzs, avg_cogs_uzs, cogs_total_uzs, profit_uzs, created_at
```

**Новые заголовки:**
```
calc_id, period_start, period_end, sku, qty_sold, net_revenue_usd, avg_cogs_usd, cogs_total_usd, profit_usd, created_at
```

**Что изменить:**
- `net_revenue_uzs` → `net_revenue_usd`
- `avg_cogs_uzs` → `avg_cogs_usd`
- `cogs_total_uzs` → `cogs_total_usd`
- `profit_uzs` → `profit_usd`

## Инструкция по миграции

### Шаг 1: Резервное копирование

1. Создайте копию вашего Google Sheet (Файл → Создать копию)
2. Сохраните копию как "Backup before USD migration"

### Шаг 2: Изменение заголовков

Для каждого листа:

1. Откройте лист
2. Найдите первую строку (заголовки)
3. Замените названия колонок согласно списку выше
4. **Важно:** Измените ТОЛЬКО названия колонок, не трогайте данные

### Шаг 3: Проверка

После изменения заголовков:

1. Убедитесь, что все заголовки изменены правильно
2. Проверьте, что данные остались на месте
3. Запустите бота и проверьте работу основных функций

## Листы, которые НЕ требуют изменений

- `skus` - нет полей с валютами
- `suppliers` - нет полей с валютами
- `office_stock` - нет полей с валютами

## Примечания

- **Данные не изменяются** - меняются только названия колонок
- Если у вас есть исторические данные, они останутся с теми же значениями
- Формат чисел остается прежним (просто теперь это USD вместо UZS)
- После миграции все новые записи будут использовать USD

## Проверка после миграции

1. Создайте тестовый заказ через бота
2. Проверьте, что данные записались в правильные колонки
3. Проверьте расчет прибыли
4. Убедитесь, что все суммы отображаются как USD

