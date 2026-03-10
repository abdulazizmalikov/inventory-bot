import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../bot';
import { formatCurrency, getCurrentTimestamp } from '../utils/date';
import { generateMoveId } from '../utils/id';

const PAGE_SIZE = 10;
/** userId -> sku (user is entering qty to add to office) */
const officeAddPending = new Map<number, string>();

async function showOfficeAddSKUList(ctx: BotContext, skus: { sku: string }[], page: number) {
  const start = page * PAGE_SIZE;
  const pageSkus = skus.slice(start, start + PAGE_SIZE);
  const totalPages = Math.ceil(skus.length / PAGE_SIZE);

  const keyboard = new InlineKeyboard();
  pageSkus.forEach((s, idx) => {
    if (idx % 2 === 0) keyboard.row();
    keyboard.text(s.sku, `office_add_sku_${s.sku}`);
  });
  if (totalPages > 1) {
    keyboard.row();
    if (page > 0) keyboard.text('◀️', `office_add_sku_page_${page - 1}`);
    if (page < totalPages - 1) keyboard.text('▶️', `office_add_sku_page_${page + 1}`);
  }
  keyboard.row().text('◀️ Отмена', 'office_add_cancel');

  const pageInfo = totalPages > 1 ? ` (стр. ${page + 1}/${totalPages})` : '';
  await ctx.editMessageText(
    `➕ *Добавить на склад Офис*\n\nВыберите SKU:${pageInfo}\n\nВсего: ${skus.length}`,
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    }
  );
}

export function setupWarehouseHandlers(bot: Bot<BotContext>) {
  bot.callbackQuery('menu_warehouses', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('🚚 В пути', 'warehouse_in_transit')
      .text('🏢 Офис', 'warehouse_office').row()
      .text('🛒 Маркетплейс', 'warehouse_marketplace')
      .text('📊 Итого', 'warehouse_total').row()
      .text('◀️ Главное меню', 'menu_main');

    await ctx.editMessageText(
      '🏬 *Склады*\n\nВыберите склад для просмотра:',
      {
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('warehouse_in_transit', async (ctx) => {
    const inTransitStock = await ctx.stock.getAllInTransitStock();
    const inTransitOrders = await ctx.sheets.getPurchaseOrders('IN_TRANSIT');
    
    if (inTransitStock.size === 0) {
      await ctx.editMessageText(
        '🚚 *В пути*\n\nНет товаров в пути',
        {
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_warehouses'),
          parse_mode: 'Markdown',
        }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    const items = Array.from(inTransitStock.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50); // Limit to 50 items

    // Calculate totals
    const totalOrderAmount = inTransitOrders.reduce((sum, po) => sum + po.order_amount_usd, 0);
    const totalShippingCost = inTransitOrders.reduce((sum, po) => sum + po.shipping_cost_usd, 0);

    let text = '🚚 *В пути*\n\n' + items.map(([sku, qty]) => `• ${sku}: ${qty} шт.`).join('\n');
    
    // Add totals at the end
    text += `\n\n━━━━━━━━━━━━━━━━\n`;
    text += `💰 *Итого:*\n`;
    text += `Сумма товара: ${formatCurrency(totalOrderAmount)}\n`;
    text += `Доставка: ${formatCurrency(totalShippingCost)}\n`;
    text += `*Всего: ${formatCurrency(totalOrderAmount + totalShippingCost)}*`;

    await ctx.editMessageText(
      text.length > 4096 ? text.substring(0, 4090) + '...' : text,
      {
        reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_warehouses'),
        parse_mode: 'Markdown',
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('warehouse_office', async (ctx) => {
    const officeStock = await ctx.stock.getAllOfficeStock();
    const keyboard = new InlineKeyboard()
      .text('➕ Добавить на склад', 'office_add_start').row()
      .text('◀️ Назад', 'menu_warehouses');

    if (officeStock.size === 0) {
      await ctx.editMessageText(
        '🏢 *Офис*\n\nНет товаров в офисе.\n\nМожно добавить товар напрямую на склад.',
        {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    const items = Array.from(officeStock.entries())
      .filter(([_, qty]) => qty > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);

    const totalQty = items.reduce((sum, [_, qty]) => sum + qty, 0);
    const text = `🏢 *Офис*\n\nВсего позиций: ${items.length}\nОбщее количество: ${totalQty} шт.\n\n` +
      items.map(([sku, qty]) => `• ${sku}: ${qty} шт.`).join('\n');

    await ctx.editMessageText(
      text.length > 4096 ? text.substring(0, 4090) + '...' : text,
      {
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      }
    );
    await ctx.answerCallbackQuery();
  });

  // --- Добавить на склад Офис (напрямую, без заказа "В пути") ---
  bot.callbackQuery('office_add_start', async (ctx) => {
    const skus = await ctx.sheets.getSKUs(true);
    if (skus.length === 0) {
      await ctx.editMessageText(
        '📦 Нет активных SKU. Добавьте товары в справочник.',
        { reply_markup: new InlineKeyboard().text('◀️ Назад', 'warehouse_office') }
      );
      await ctx.answerCallbackQuery();
      return;
    }
    await showOfficeAddSKUList(ctx, skus, 0);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^office_add_sku_page_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10);
    const skus = await ctx.sheets.getSKUs(true);
    await showOfficeAddSKUList(ctx, skus, page);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^office_add_sku_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    const sku = ctx.match[1];
    officeAddPending.set(ctx.from.id, sku);
    await ctx.editMessageText(
      `➕ *Добавить на склад Офис*\n\nSKU: *${sku}*\n\nВведите количество:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'office_add_cancel'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('office_add_cancel', async (ctx) => {
    if (ctx.from) officeAddPending.delete(ctx.from.id);
    const officeStock = await ctx.stock.getAllOfficeStock();
    const keyboard = new InlineKeyboard()
      .text('➕ Добавить на склад', 'office_add_start').row()
      .text('◀️ Назад', 'menu_warehouses');
    if (officeStock.size === 0) {
      await ctx.editMessageText(
        '🏢 *Офис*\n\nНет товаров в офисе.\n\nМожно добавить товар напрямую на склад.',
        { reply_markup: keyboard, parse_mode: 'Markdown' }
      );
    } else {
      const items = Array.from(officeStock.entries())
        .filter(([_, qty]) => qty > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50);
      const totalQty = items.reduce((sum, [_, qty]) => sum + qty, 0);
      const text = `🏢 *Офис*\n\nВсего позиций: ${items.length}\nОбщее количество: ${totalQty} шт.\n\n` +
        items.map(([sku, qty]) => `• ${sku}: ${qty} шт.`).join('\n');
      await ctx.editMessageText(
        text.length > 4096 ? text.substring(0, 4090) + '...' : text,
        { reply_markup: keyboard, parse_mode: 'Markdown' }
      );
    }
    await ctx.answerCallbackQuery();
  });

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    const sku = officeAddPending.get(ctx.from.id);
    if (!sku) return next();

    const qty = parseInt(ctx.message.text.trim(), 10);
    if (isNaN(qty) || qty <= 0) {
      await ctx.reply('Введите число больше 0.');
      return;
    }

    officeAddPending.delete(ctx.from.id);

    try {
      await ctx.sheets.createMovement({
        move_id: generateMoveId(),
        type: 'OFFICE_ADD',
        source: 'NONE',
        destination: 'OFFICE',
        marketplace: 'NONE',
        sku,
        qty,
        created_at: getCurrentTimestamp(),
        created_by: 'admin',
      });
      await ctx.stock.updateOfficeStockAfterMovement(sku, qty);
      await ctx.reply(
        `✅ На склад Офис добавлено: *${sku}* — ${qty} шт.`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('➕ Ещё товар', 'office_add_start')
            .text('◀️ Офис', 'warehouse_office'),
        }
      );
    } catch (e) {
      console.error('Office add error:', e);
      await ctx.reply('Ошибка при добавлении. Попробуйте снова.');
    }
  });

  bot.callbackQuery('warehouse_marketplace', async (ctx) => {
    await ctx.editMessageText('⏳ Загрузка данных с маркетплейса...', {
      reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_warehouses'),
    });
    await ctx.answerCallbackQuery();

    try {
      // Берём все активные товары из Uzum (без фильтра по нашим SKU),
      // затем сохраняем их в лист marketplace_stock и показываем в боте.
      const stockMap = await ctx.uzum.getBulkStock([]);

      if (stockMap.size === 0) {
        await ctx.editMessageText(
          '🛒 *Маркетплейс (Uzum)*\n\nНет данных о товарах на маркетплейсе.\nВозможно, API не настроен.',
          {
            reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_warehouses'),
            parse_mode: 'Markdown',
          }
        );
        return;
      }

      // Сохраняем остатки маркетплейса в отдельный лист marketplace_stock
      try {
        await ctx.sheets.setMarketplaceStock(stockMap);
      } catch (e) {
        console.error('Error syncing marketplace stock to sheet:', e);
      }

      const items = Array.from(stockMap.entries())
        .filter(([_, qty]) => qty > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50);

      const totalQty = items.reduce((sum, [_, qty]) => sum + qty, 0);
      const text = `🛒 *Маркетплейс (Uzum)*\n\nВсего позиций: ${items.length}\nОбщее количество: ${totalQty} шт.\n\n` +
        items.map(([sku, qty]) => `• ${sku}: ${qty} шт.`).join('\n');

      await ctx.editMessageText(
        text.length > 4096 ? text.substring(0, 4090) + '...' : text,
        {
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_warehouses'),
          parse_mode: 'Markdown',
        }
      );
    } catch (error) {
      console.error('Error fetching marketplace stock:', error);
      await ctx.editMessageText(
        '❌ Ошибка при загрузке данных с маркетплейса.\nПроверьте настройки API.',
        {
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_warehouses'),
        }
      );
    }
  });

  bot.callbackQuery('warehouse_total', async (ctx) => {
    await ctx.editMessageText('⏳ Расчет итоговых остатков...', {
      reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_warehouses'),
    });
    await ctx.answerCallbackQuery();

    try {
      const skus = await ctx.sheets.getSKUs(true);
      const skuCosts = await ctx.sheets.getSkuCosts();
      const costMap = new Map<string, number>();
      skuCosts.forEach(c => costMap.set(c.sku, c.unit_cost_usd));

      const inTransitStock = await ctx.stock.getAllInTransitStock();
      const officeStock = await ctx.stock.getAllOfficeStock();

      // Маркетплейс: при ошибке API показываем 0, не ломаем весь расчёт
      let marketplaceStock: Map<string, number>;
      try {
        marketplaceStock = await ctx.uzum.getBulkStock(skus.map(s => s.sku));
      } catch (e) {
        console.error('Uzum getBulkStock failed, using empty marketplace:', e);
        marketplaceStock = new Map();
      }

      // 1) В пути: количество и сумма по себестоимости (из purchase_order_items)
      const inTransitOrders = await ctx.sheets.getPurchaseOrders('IN_TRANSIT');
      let inTransitQty = 0;
      let inTransitAmount = 0;
      for (const po of inTransitOrders) {
        const items = await ctx.sheets.getPurchaseOrderItems(po.po_id);
        for (const item of items) {
          const qty = item.qty;
          const unit = item.unit_cost_usd ?? 0;
          inTransitQty += qty;
          inTransitAmount += qty * unit;
        }
      }

      // 2) Офис: количество по office_stock, сумма по sku_costs
      let officeQty = 0;
      let officeAmount = 0;
      for (const [sku, qty] of officeStock.entries()) {
        if (qty <= 0) continue;
        const unit = costMap.get(sku) ?? 0;
        officeQty += qty;
        officeAmount += qty * unit;
      }

      // 3) Маркетплейс: количество по Uzum API, сумма по sku_costs
      let marketplaceQty = 0;
      let marketplaceAmount = 0;
      for (const [sku, qty] of marketplaceStock.entries()) {
        if (qty <= 0) continue;
        const unit = costMap.get(sku) ?? 0;
        marketplaceQty += qty;
        marketplaceAmount += qty * unit;
      }

      const totalQty = inTransitQty + officeQty + marketplaceQty;
      const totalAmount = inTransitAmount + officeAmount + marketplaceAmount;

      if (totalQty === 0) {
        await ctx.editMessageText(
          '📊 *Итого*\n\nНет товаров на складах',
          {
            reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_warehouses'),
            parse_mode: 'Markdown',
          }
        );
        return;
      }

      const text =
        '📊 *Итого по складам*\n\n' +
        `🚚 *В пути*\n` +
        `Количество: ${inTransitQty} шт.\n` +
        `Сумма: ${formatCurrency(inTransitAmount)}\n\n` +
        `🏢 *Офис*\n` +
        `Количество: ${officeQty} шт.\n` +
        `Сумма: ${formatCurrency(officeAmount)}\n\n` +
        `🛒 *Маркетплейс (Uzum)*\n` +
        `Количество: ${marketplaceQty} шт.\n` +
        `Сумма: ${formatCurrency(marketplaceAmount)}\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `📦 *Всего по всем складам*\n` +
        `Количество: ${totalQty} шт.\n` +
        `Сумма: ${formatCurrency(totalAmount)}`;

      await ctx.editMessageText(
        text.length > 4096 ? text.substring(0, 4090) + '...' : text,
        {
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_warehouses'),
          parse_mode: 'Markdown',
        }
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Error calculating totals:', error);
      await ctx.editMessageText(
        '❌ Ошибка при расчете итогов\n\n' + errMsg.slice(0, 500),
        {
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_warehouses'),
        }
      );
    }
  });
}

