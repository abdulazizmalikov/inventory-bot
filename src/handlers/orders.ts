import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../bot';
import { generatePOId, generateMoveId } from '../utils/id';
import { getCurrentTimestamp, formatCurrency, formatDate } from '../utils/date';
import { Marketplace } from '../types';

interface OrderCreationState {
  step: 'name' | 'supplier' | 'items' | 'amounts' | 'confirm' | 'edit_shipping';
  order_name?: string;
  supplier_id?: string;
  supplier_name?: string;
  items: Array<{ sku: string; qty: number }>;
  order_amount_usd?: number;
  shipping_cost_usd?: number;
}

// Store user states
const orderStates = new Map<number, OrderCreationState>();
const pendingSKU = new Map<number, string>(); // Track which SKU user is adding
const isSearchingSKU = new Map<number, boolean>(); // Track if user is in search mode
/** User is entering new shipping cost for existing PO (value = po_id). */
const editShippingPoId = new Map<number, string>();

export function setupOrderHandlers(bot: Bot<BotContext>) {
  // In Transit menu
  bot.callbackQuery('menu_in_transit', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('➕ Новый заказ', 'order_create')
      .text('✅ Получить заказ', 'order_receive').row()
      .text('✏️ Изменить доставку', 'order_edit_delivery').row()
      .text('◀️ Главное меню', 'menu_main');

    await ctx.editMessageText(
      '🚚 *В пути*\n\nВыберите действие:',
      {
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      }
    );
    await ctx.answerCallbackQuery();
  });

  // Create order flow
  bot.callbackQuery('order_create', async (ctx) => {
    if (!ctx.from) return;
    
    orderStates.set(ctx.from.id, {
      step: 'name',
      items: [],
    });

    await ctx.editMessageText(
      '📋 *Создание заказа*\n\nВведите название заказа:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'menu_in_transit'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  // Select supplier
  bot.callbackQuery(/^order_supplier_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    
    const supplierId = ctx.match[1];
    const suppliers = await ctx.sheets.getSuppliers();
    const supplier = suppliers.find(s => s.supplier_id === supplierId);
    
    if (!supplier) {
      await ctx.answerCallbackQuery('Поставщик не найден');
      return;
    }

    const state = orderStates.get(ctx.from.id);
    if (!state) return;

    state.supplier_id = supplier.supplier_id;
    state.supplier_name = supplier.supplier_name;
    state.step = 'items';

    const skus = await ctx.sheets.getSKUs(true);
    await showSKUList(ctx, skus, 0);
  });

  // New supplier
  bot.callbackQuery('order_new_supplier', async (ctx) => {
    if (!ctx.from) return;
    
    const state = orderStates.get(ctx.from.id);
    if (!state) return;

    state.step = 'supplier';
    await ctx.editMessageText(
      '📝 Введите название нового поставщика:',
      {
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'order_create'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  // SKU search
  bot.callbackQuery('order_sku_search', async (ctx) => {
    if (!ctx.from) return;
    
    isSearchingSKU.set(ctx.from.id, true);
    
    await ctx.editMessageText(
      '🔍 *Поиск SKU*\n\nВведите часть артикула для поиска:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'order_create'),
      }
    );
    await ctx.answerCallbackQuery();
  });


  // SKU pagination (MUST be BEFORE order_sku_ handler to avoid regex conflict)
  bot.callbackQuery(/^order_sku_page_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    
    const page = parseInt(ctx.match[1]);
    const skus = await ctx.sheets.getSKUs(true);
    await showSKUList(ctx, skus, page);
    await ctx.answerCallbackQuery();
  });

  // Select SKU
  bot.callbackQuery(/^order_sku_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    
    // Skip if this is a pagination callback
    if (ctx.callbackQuery.data.startsWith('order_sku_page_')) {
      return;
    }
    
    const sku = ctx.match[1];
    const state = orderStates.get(ctx.from.id);
    if (!state || state.step !== 'items') return;

    // Store pending SKU
    pendingSKU.set(ctx.from.id, sku);

    await ctx.editMessageText(
      `📦 *${sku}*\n\nВведите количество:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'order_create'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  // Handle quantity input for order items
  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();

    // Editing shipping cost for an existing (in-transit) order
    const poIdForEdit = editShippingPoId.get(ctx.from.id);
    if (poIdForEdit) {
      const amount = parseFloat(ctx.message.text.trim());
      if (isNaN(amount) || amount < 0) {
        await ctx.reply('Введите корректную сумму доставки (0 или больше).');
        return;
      }
      editShippingPoId.delete(ctx.from.id);
      try {
        await ctx.sheets.updatePurchaseOrderShipping(poIdForEdit, amount);
        await ctx.reply(
          `✅ Стоимость доставки обновлена: ${formatCurrency(amount)}`,
          { reply_markup: new InlineKeyboard().text('◀️ В путь', 'menu_in_transit') }
        );
      } catch (e) {
        console.error('updatePurchaseOrderShipping:', e);
        await ctx.reply('Ошибка при обновлении. Попробуйте снова.');
      }
      return;
    }

    const state = orderStates.get(ctx.from.id);
    if (!state) return next();

    // Handle search (when in search mode)
    if (isSearchingSKU.get(ctx.from.id)) {
      isSearchingSKU.set(ctx.from.id, false); // Reset search flag
      
      const searchText = ctx.message.text.trim().toLowerCase();
      if (!searchText) {
        await ctx.reply('Пожалуйста, введите текст для поиска.');
        return;
      }

      const allSKUs = await ctx.sheets.getSKUs(true);
      const filteredSKUs = allSKUs.filter(sku => 
        sku.sku.toLowerCase().includes(searchText)
      );

      if (filteredSKUs.length === 0) {
        await ctx.reply(
          `❌ SKU не найдены по запросу "${ctx.message.text}"\n\nПопробуйте другой поисковый запрос или вернитесь к списку.`,
          {
            reply_markup: new InlineKeyboard()
              .text('🔍 Поиск снова', 'order_sku_search')
              .text('📋 Весь список', 'order_create'),
          }
        );
        return;
      }

      await showSKUListAsReply(ctx, filteredSKUs, 0);
      return;
    }

    // Handle quantity input for items
    if (state.step === 'items') {
      const pendingSku = pendingSKU.get(ctx.from.id);
      
      if (!pendingSku) {
        // No pending SKU and not searching - ignore or show error
        return next();
      }

      // Handle quantity input for items
      const qty = parseInt(ctx.message.text.trim());
      if (isNaN(qty) || qty <= 0) {
        await ctx.reply('Пожалуйста, введите корректное количество (число больше 0).');
        return;
      }

      // Add item
      state.items.push({ sku: pendingSku, qty });
      pendingSKU.delete(ctx.from.id);
      isSearchingSKU.delete(ctx.from.id); // Clear search flag if exists

      const itemsText = state.items.map(item => `• ${item.sku}: ${item.qty} шт.`).join('\n');
      const keyboard = new InlineKeyboard()
        .text('➕ Добавить еще', 'order_add_more')
        .text('✅ Продолжить', 'order_continue').row()
        .text('◀️ Отмена', 'menu_in_transit');

      await ctx.reply(
        `✅ Товар добавлен!\n\nТекущие товары:\n${itemsText}\n\nДобавить еще или продолжить?`,
        { reply_markup: keyboard }
      );
      return;
    }

    // Handle amounts
    if (state.step === 'amounts') {
      const amount = parseFloat(ctx.message.text.trim());
      if (isNaN(amount) || amount < 0) {
        await ctx.reply('Пожалуйста, введите корректную сумму (0 или больше).');
        return;
      }

      if (!state.order_amount_usd) {
        state.order_amount_usd = amount;
        await ctx.reply('💰 Введите стоимость доставки (USD). Можно 0 — добавите или измените позже:');
        return;
      }

      state.shipping_cost_usd = amount;
      state.step = 'confirm';
      await showOrderConfirmation(ctx, state);
      return;
    }

    // Handle edit shipping (only shipping cost)
    if (state.step === 'edit_shipping') {
      const amount = parseFloat(ctx.message.text.trim());
      if (isNaN(amount) || amount < 0) {
        await ctx.reply('Пожалуйста, введите корректную сумму доставки (0 или больше).');
        return;
      }
      state.shipping_cost_usd = amount;
      state.step = 'confirm';
      await showOrderConfirmation(ctx, state);
      return;
    }

    // Handle order name input
    if (state.step === 'name') {
      const orderName = ctx.message.text.trim();
      if (!orderName) {
        await ctx.reply('Пожалуйста, введите название заказа.');
        return;
      }

      state.order_name = orderName;
      state.step = 'supplier';

      const suppliers = await ctx.sheets.getSuppliers();
      const keyboard = new InlineKeyboard();
      
      suppliers.forEach((supplier, idx) => {
        if (idx % 2 === 0) keyboard.row();
        keyboard.text(supplier.supplier_name, `order_supplier_${supplier.supplier_id}`);
      });
      
      keyboard.row().text('➕ Новый поставщик', 'order_new_supplier');
      keyboard.row().text('◀️ Назад', 'menu_in_transit');

      await ctx.reply(
        `📋 *Создание заказа*\n\nНазвание: ${orderName}\n\nВыберите поставщика:`,
        {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        }
      );
      return;
    }

    // Handle supplier name
    if (state.step === 'supplier') {
      const supplierName = ctx.message.text.trim();
      if (!supplierName) {
        await ctx.reply('Пожалуйста, введите название поставщика.');
        return;
      }

      // Check if exists
      let supplier = await ctx.sheets.findSupplierByName(supplierName);
      
      if (!supplier) {
        // Create new
        const supplierId = `SUP-${Date.now()}`;
        supplier = {
          supplier_id: supplierId,
          supplier_name: supplierName,
        };
        await ctx.sheets.createSupplier(supplier);
      }

      state.supplier_id = supplier.supplier_id;
      state.supplier_name = supplier.supplier_name;
      state.step = 'items';

      const skus = await ctx.sheets.getSKUs(true);
      await showSKUList(ctx, skus, 0);
      return;
    }

    return next();
  });

  // Add item (simplified: SKU selected, now ask qty)
  bot.callbackQuery(/^order_add_item_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    
    const sku = ctx.match[1];
    const state = orderStates.get(ctx.from.id);
    if (!state) return;

    await ctx.editMessageText(
      `📦 *${sku}*\n\nВведите количество:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'order_create'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  // Add more items to current order
  bot.callbackQuery('order_add_more', async (ctx) => {
    if (!ctx.from) return;
    
    const state = orderStates.get(ctx.from.id);
    if (!state || state.step !== 'items') {
      await ctx.answerCallbackQuery('Ошибка: состояние заказа');
      return;
    }

    // Return to SKU selection
    const skus = await ctx.sheets.getSKUs(true);
    await showSKUList(ctx, skus, 0);
    await ctx.answerCallbackQuery();
  });

  // Continue order creation (after items added)
  bot.callbackQuery('order_continue', async (ctx) => {
    if (!ctx.from) return;
    
    const state = orderStates.get(ctx.from.id);
    if (!state || state.items.length === 0) {
      await ctx.answerCallbackQuery('Добавьте хотя бы один товар');
      return;
    }

    state.step = 'amounts';
    await ctx.editMessageText(
      '💰 Введите сумму заказа (USD):',
      {
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'order_create'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  // Edit shipping cost before confirm
  bot.callbackQuery('order_edit_shipping', async (ctx) => {
    if (!ctx.from) return;
    const state = orderStates.get(ctx.from.id);
    if (!state || state.step !== 'confirm') {
      await ctx.answerCallbackQuery('Ошибка состояния');
      return;
    }
    state.step = 'edit_shipping';
    await ctx.editMessageText(
      `✏️ Введите стоимость доставки (USD). Текущая: ${formatCurrency(state.shipping_cost_usd ?? 0)}\n\nМожно 0, если пока не известна.`,
      {
        reply_markup: new InlineKeyboard().text('◀️ Назад к подтверждению', 'order_back_to_confirm'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  // Back to confirmation after edit shipping (without changing value)
  bot.callbackQuery('order_back_to_confirm', async (ctx) => {
    if (!ctx.from) return;
    const state = orderStates.get(ctx.from.id);
    if (!state) return;
    state.step = 'confirm';
    await showOrderConfirmation(ctx, state);
    await ctx.answerCallbackQuery();
  });

  // Confirm order
  bot.callbackQuery('order_confirm', async (ctx) => {
    if (!ctx.from) return;
    
    const state = orderStates.get(ctx.from.id);
    if (!state || !state.order_name || !state.supplier_id || state.items.length === 0) {
      await ctx.answerCallbackQuery('Ошибка: неполные данные');
      return;
    }

    try {
      // Use order_name as part of po_id for uniqueness
      const poId = `PO-${Date.now()}-${state.order_name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10)}`;
      const totalQty = state.items.reduce((sum, item) => sum + item.qty, 0);
      const totalAmount = (state.order_amount_usd || 0) + (state.shipping_cost_usd || 0);
      const unitCost = totalQty > 0 ? totalAmount / totalQty : 0;

      const po = {
        po_id: poId,
        order_name: state.order_name,
        supplier_id: state.supplier_id,
        order_amount_usd: state.order_amount_usd || 0,
        shipping_cost_usd: state.shipping_cost_usd || 0,
        total_amount_usd: totalAmount,
        total_qty: totalQty,
        unit_cost_usd: unitCost,
        status: 'IN_TRANSIT' as const,
        created_at: getCurrentTimestamp(),
        created_by: 'admin',
      };

      await ctx.sheets.createPurchaseOrder(po);

      // Create items
      for (const item of state.items) {
        await ctx.sheets.createPurchaseOrderItem({
          po_id: poId,
          sku: item.sku,
          qty: item.qty,
          unit_cost_usd: unitCost,
        });

        // Create movement
        await ctx.sheets.createMovement({
          move_id: generateMoveId(),
          type: 'PO_CREATE',
          source: 'NONE',
          destination: 'IN_TRANSIT',
          marketplace: 'NONE',
          sku: item.sku,
          qty: item.qty,
          unit_cost_usd: unitCost,
          created_at: getCurrentTimestamp(),
          created_by: 'admin',
        });
      }

      orderStates.delete(ctx.from.id);
      pendingSKU.delete(ctx.from.id);

      await ctx.editMessageText(
        `✅ *Заказ создан*\n\nНазвание: ${state.order_name}\nПоставщик: ${state.supplier_name}\nТоваров: ${totalQty}\nСумма: ${formatCurrency(totalAmount)}`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('◀️ Главное меню', 'menu_main'),
        }
      );
    } catch (error) {
      console.error('Error creating order:', error);
      await ctx.answerCallbackQuery('Ошибка при создании заказа');
    }
    await ctx.answerCallbackQuery();
  });

  // Receive order
  bot.callbackQuery('order_receive', async (ctx) => {
    const orders = await ctx.sheets.getPurchaseOrders('IN_TRANSIT');
    
    console.log('Orders in transit:', orders.map(o => ({ po_id: o.po_id, status: o.status })));
    
    if (orders.length === 0) {
      await ctx.editMessageText(
        '📦 Нет заказов в пути',
        {
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_in_transit'),
        }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    const keyboard = new InlineKeyboard();
    orders.forEach((order, idx) => {
      if (idx % 2 === 0) keyboard.row();
      const displayName = order.order_name || order.po_id;
      keyboard.text(displayName, `order_receive_${order.po_id}`);
    });
    keyboard.row().text('◀️ Назад', 'menu_in_transit');

    await ctx.editMessageText(
      '✅ *Получение заказа*\n\nВыберите заказ для получения:',
      {
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      }
    );
    await ctx.answerCallbackQuery();
  });

  // Edit delivery (shipping cost) — show list of in-transit orders
  bot.callbackQuery('order_edit_delivery', async (ctx) => {
    if (ctx.from) editShippingPoId.delete(ctx.from.id);
    const orders = await ctx.sheets.getPurchaseOrders('IN_TRANSIT');
    if (orders.length === 0) {
      await ctx.editMessageText(
        '📦 Нет заказов в пути. Сначала создайте заказ.',
        { reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_in_transit') }
      );
      await ctx.answerCallbackQuery();
      return;
    }
    const keyboard = new InlineKeyboard();
    orders.forEach((order, idx) => {
      if (idx % 2 === 0) keyboard.row();
      const label = (order.order_name || order.po_id) + ` (доставка: ${formatCurrency(order.shipping_cost_usd)})`;
      keyboard.text(label, `order_edit_delivery_po_${order.po_id}`);
    });
    keyboard.row().text('◀️ Назад', 'menu_in_transit');
    await ctx.editMessageText(
      '✏️ *Изменить стоимость доставки*\n\nВыберите заказ:',
      { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
    await ctx.answerCallbackQuery();
  });

  // Select order for editing shipping — ask for new amount
  bot.callbackQuery(/^order_edit_delivery_po_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    const poId = ctx.match[1];
    editShippingPoId.set(ctx.from.id, poId);
    const orders = await ctx.sheets.getPurchaseOrders('IN_TRANSIT');
    const order = orders.find(o => o.po_id === poId);
    const current = order ? formatCurrency(order.shipping_cost_usd) : '0';
    await ctx.editMessageText(
      `✏️ Введите новую стоимость доставки (USD).\nТекущая: ${current}`,
      { reply_markup: new InlineKeyboard().text('◀️ Отмена', 'order_edit_delivery') }
    );
    await ctx.answerCallbackQuery();
  });

  // Toggle item selection (callback_data до 64 байт: order_receive_item_<index>)
  bot.callbackQuery(/^order_receive_item_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    await ctx.answerCallbackQuery();

    const index = parseInt(ctx.match[1], 10);
    const receiveState = (orderStates as any).get(`receive_${ctx.from.id}`);
    if (!receiveState || !receiveState.items || !receiveState.items[index]) {
      await ctx.reply('Сессия устарела. Выберите заказ заново.');
      return;
    }

    const item = receiveState.items[index];
    if (receiveState.selectedItems.has(item.sku)) {
      receiveState.selectedItems.delete(item.sku);
    } else {
      receiveState.selectedItems.add(item.sku);
    }

    const poId = receiveState.po_id;
    const allOrders = await ctx.sheets.getPurchaseOrders();
    const order = allOrders.find((po: any) => po.po_id.trim() === poId.trim());
    if (!order) {
      await ctx.reply('Заказ не найден.');
      return;
    }

    // Получаем имя поставщика по ID
    const suppliers = await ctx.sheets.getSuppliers();
    const supplier = suppliers.find(s => s.supplier_id === order.supplier_id);
    const supplierName = supplier ? supplier.supplier_name : order.supplier_id;

    const items = receiveState.items;
    const itemsText = items.map((i: any) => {
      const isSelected = receiveState.selectedItems.has(i.sku);
      return `${isSelected ? '✅' : '☐'} ${i.sku}: ${i.qty} шт.`;
    }).join('\n');
    const displayName = order.order_name || poId;
    const batchTotal = (order.order_amount_usd || 0) + (order.shipping_cost_usd || 0);

    const keyboard = new InlineKeyboard();
    items.forEach((i: any, idx: number) => {
      if (idx % 2 === 0) keyboard.row();
      const isSelected = receiveState.selectedItems.has(i.sku);
      keyboard.text(`${isSelected ? '✅' : '☐'} ${i.sku}`, `order_receive_item_${idx}`);
    });
    keyboard.row()
      .text('✅ Получить выбранные', `order_receive_confirm_${poId}`)
      .text('✅ Получить все', `order_receive_all_${poId}`).row()
      .text('◀️ Отмена', 'order_receive');

    const orderDateStr = order.created_at ? formatDate(order.created_at) : '—';
    await ctx.editMessageText(
      `✅ *Получение заказа*\n\n` +
      `📦 Заказ: ${displayName}\n` +
      `📅 Дата добавления: ${orderDateStr}\n` +
      `🏢 Поставщик: ${supplierName}\n\n` +
      `💵 Сумма заказа: ${formatCurrency(order.order_amount_usd || 0)}\n` +
      `🚚 Доставка: ${formatCurrency(order.shipping_cost_usd || 0)}\n` +
      `📦 Цена партии (заказ + доставка): ${formatCurrency(batchTotal)}\n` +
      `📈 Цена за единицу: ${formatCurrency(order.unit_cost_usd || 0)}\n\n` +
      `📋 Товары:\n${itemsText}\n\n` +
      `➡️ Выберите товары для получения:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  });

  // Receive all items
  bot.callbackQuery(/^order_receive_all_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const poId = ctx.match[1];
    
    try {
      const allOrders = await ctx.sheets.getPurchaseOrders();
      const order = allOrders.find(po => po.po_id.trim() === poId.trim());
      
      if (!order) {
        await ctx.reply('Заказ не найден.');
        return;
      }
      
      if (order.status !== 'IN_TRANSIT') {
        await ctx.reply('Заказ уже получен.');
        return;
      }

      const items = await ctx.sheets.getPurchaseOrderItems(poId);
      const receivedAt = getCurrentTimestamp();

      // Update PO status
      await ctx.sheets.updatePurchaseOrderStatus(poId, 'RECEIVED', receivedAt);

      // Create movements and update stock
      for (const item of items) {
        await ctx.sheets.createMovement({
          move_id: generateMoveId(),
          type: 'PO_RECEIVE',
          source: 'IN_TRANSIT',
          destination: 'OFFICE',
          marketplace: 'NONE',
          sku: item.sku,
          qty: item.qty,
          unit_cost_usd: item.unit_cost_usd,
          created_at: receivedAt,
          created_by: 'admin',
        });

        await ctx.stock.updateOfficeStockAfterMovement(item.sku, item.qty);
      }

      if (ctx.from) {
        (orderStates as any).delete(`receive_${ctx.from.id}`);
      }

      const displayName = order.order_name || poId;
      await ctx.editMessageText(
        `✅ *Заказ получен полностью*\n\nЗаказ: ${displayName}\nТоваров: ${items.length}`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('◀️ Главное меню', 'menu_main'),
        }
      );
    } catch (error) {
      console.error('Error receiving order:', error);
      await ctx.reply('Ошибка при получении заказа. Попробуйте снова.').catch(() => {});
    }
  });

  // Execute receive selected items (must be BEFORE order_receive_ handler to avoid regex conflict)
  bot.callbackQuery(/^order_receive_confirm_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    await ctx.answerCallbackQuery();
    const poId = ctx.match[1];
    
    try {
      const receiveState = (orderStates as any).get(`receive_${ctx.from.id}`);
      if (!receiveState || receiveState.po_id !== poId) {
        await ctx.reply('Ошибка: состояние не найдено. Выберите заказ заново.');
        return;
      }

      const allOrders = await ctx.sheets.getPurchaseOrders();
      const order = allOrders.find(po => po.po_id.trim() === poId.trim());
      
      if (!order) {
        await ctx.reply('Заказ не найден.');
        return;
      }
      
      if (order.status !== 'IN_TRANSIT') {
        await ctx.reply('Заказ уже получен.');
        return;
      }

      // Get selected items
      const selectedItems = receiveState.items.filter((item: any) => 
        receiveState.selectedItems.has(item.sku)
      );

      if (selectedItems.length === 0) {
        await ctx.reply('Выберите хотя бы один товар (отметьте галочками) и нажмите «Получить выбранные».');
        return;
      }

      const receivedAt = getCurrentTimestamp();

      // Create movements and update stock for selected items only
      for (const item of selectedItems) {
        await ctx.sheets.createMovement({
          move_id: generateMoveId(),
          type: 'PO_RECEIVE',
          source: 'IN_TRANSIT',
          destination: 'OFFICE',
          marketplace: 'NONE',
          sku: item.sku,
          qty: item.qty,
          unit_cost_usd: item.unit_cost_usd,
          created_at: receivedAt,
          created_by: 'admin',
        });

        await ctx.stock.updateOfficeStockAfterMovement(item.sku, item.qty);
      }

      // Check if all items are received
      const allItems = receiveState.items;
      const receivedSkus = new Set(selectedItems.map((item: any) => item.sku));
      const allReceived = allItems.every((item: any) => receivedSkus.has(item.sku));

      // Update PO status only if all items received
      if (allReceived) {
        await ctx.sheets.updatePurchaseOrderStatus(poId, 'RECEIVED', receivedAt);
      }

      (orderStates as any).delete(`receive_${ctx.from.id}`);

      const displayName = order.order_name || poId;
      const itemsText = selectedItems.map((item: any) => `• ${item.sku}: ${item.qty} шт.`).join('\n');
      
      await ctx.editMessageText(
        `✅ *Товары получены*\n\nЗаказ: ${displayName}\n\nПолучено товаров:\n${itemsText}\n\n${allReceived ? '✅ Заказ полностью получен' : '⚠️ Заказ получен частично'}`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('◀️ Главное меню', 'menu_main'),
        }
      );
    } catch (error) {
      console.error('Error receiving order:', error);
      await ctx.reply('Ошибка при получении заказа. Попробуйте снова.').catch(() => {});
    }
  });

  // Confirm receive (selecting order from list)
  bot.callbackQuery(/^order_receive_(.+)$/, async (ctx) => {
    const poId = ctx.match[1];
    console.log(`Looking for order with po_id: "${poId}"`);
    
    const allOrders = await ctx.sheets.getPurchaseOrders();
    console.log(`Total orders found: ${allOrders.length}`);
    console.log('All order IDs:', allOrders.map(o => `"${o.po_id}"`));
    
    const order = allOrders.find(po => {
      const poIdTrimmed = po.po_id.trim();
      const searchIdTrimmed = poId.trim();
      const match = poIdTrimmed === searchIdTrimmed;
      if (!match) {
        console.log(`Comparing: "${poIdTrimmed}" !== "${searchIdTrimmed}"`);
      }
      return match;
    });
    
    if (!order) {
      console.log(`Order not found. Looking for: "${poId}", Available IDs:`, allOrders.map(o => `"${o.po_id}"`));
      await ctx.answerCallbackQuery('Заказ не найден');
      return;
    }
    
    console.log(`Order found: ${order.po_id}, status: ${order.status}`);
    
    if (order.status !== 'IN_TRANSIT') {
      console.log(`Order status is: ${order.status}, expected: IN_TRANSIT`);
      await ctx.answerCallbackQuery('Заказ уже получен');
      return;
    }

    const items = await ctx.sheets.getPurchaseOrderItems(poId);
    const displayName = order.order_name || poId;
    const batchTotal = (order.order_amount_usd || 0) + (order.shipping_cost_usd || 0);

    // Имя поставщика по ID
    const suppliers = await ctx.sheets.getSuppliers();
    const supplier = suppliers.find(s => s.supplier_id === order.supplier_id);
    const supplierName = supplier ? supplier.supplier_name : order.supplier_id;

    // Store order items in state for partial receive
    const receiveState = {
      po_id: poId,
      items: items,
      selectedItems: new Set<string>(), // Track selected SKUs
    };
    if (ctx.from) {
      (orderStates as any).set(`receive_${ctx.from.id}`, receiveState);
    }

    // Кнопки по индексу (callback_data до 64 байт в Telegram)
    const keyboard = new InlineKeyboard();
    items.forEach((item, idx) => {
      if (idx % 2 === 0) keyboard.row();
      const isSelected = receiveState.selectedItems.has(item.sku);
      keyboard.text(`${isSelected ? '✅' : '☐'} ${item.sku}`, `order_receive_item_${idx}`);
    });
    keyboard.row()
      .text('✅ Получить выбранные', `order_receive_confirm_${poId}`)
      .text('✅ Получить все', `order_receive_all_${poId}`).row()
      .text('◀️ Отмена', 'order_receive');

    const itemsText = items.map(item => `• ${item.sku}: ${item.qty} шт.`).join('\n');
    const orderDateStr = order.created_at ? formatDate(order.created_at) : '—';

    await ctx.editMessageText(
      `✅ *Получение заказа*\n\n` +
      `📦 Заказ: ${displayName}\n` +
      `📅 Дата добавления: ${orderDateStr}\n` +
      `🏢 Поставщик: ${supplierName}\n\n` +
      `💵 Сумма заказа: ${formatCurrency(order.order_amount_usd || 0)}\n` +
      `🚚 Доставка: ${formatCurrency(order.shipping_cost_usd || 0)}\n` +
      `📦 Цена партии (заказ + доставка): ${formatCurrency(batchTotal)}\n` +
      `📈 Цена за единицу: ${formatCurrency(order.unit_cost_usd || 0)}\n\n` +
      `📋 Товары:\n${itemsText}\n\n` +
      `➡️ Выберите товары для получения:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
    await ctx.answerCallbackQuery();
  });
}

async function showSKUList(ctx: BotContext, skus: any[], page: number) {
  const pageSize = 10;
  const start = page * pageSize;
  const end = start + pageSize;
  const pageSkus = skus.slice(start, end);

  const keyboard = new InlineKeyboard();
  pageSkus.forEach((sku, idx) => {
    if (idx % 2 === 0) keyboard.row();
    keyboard.text(sku.sku, `order_sku_${sku.sku}`);
  });

  if (start > 0 || end < skus.length) {
    keyboard.row();
    if (start > 0) keyboard.text('◀️', `order_sku_page_${page - 1}`);
    if (end < skus.length) keyboard.text('▶️', `order_sku_page_${page + 1}`);
  }

  keyboard.row().text('🔍 Поиск', 'order_sku_search');
  
  if (skus.length > 0) {
    keyboard.row().text('✅ Продолжить', 'order_continue');
  }
  keyboard.row().text('◀️ Назад', 'order_create');

  const totalPages = Math.ceil(skus.length / pageSize);
  const pageInfo = totalPages > 1 ? ` (страница ${page + 1} из ${totalPages})` : '';
  
  await ctx.editMessageText(
    `📦 *Выбор товара*\n\nНайдено SKU: ${skus.length}${pageInfo}\n\nВыберите SKU:`,
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    }
  );
}

async function showSKUListAsReply(ctx: BotContext, skus: any[], page: number) {
  const pageSize = 10;
  const start = page * pageSize;
  const end = start + pageSize;
  const pageSkus = skus.slice(start, end);

  const keyboard = new InlineKeyboard();
  pageSkus.forEach((sku, idx) => {
    if (idx % 2 === 0) keyboard.row();
    keyboard.text(sku.sku, `order_sku_${sku.sku}`);
  });

  if (start > 0 || end < skus.length) {
    keyboard.row();
    if (start > 0) keyboard.text('◀️', `order_sku_page_${page - 1}`);
    if (end < skus.length) keyboard.text('▶️', `order_sku_page_${page + 1}`);
  }

  keyboard.row().text('🔍 Поиск', 'order_sku_search');
  
  if (skus.length > 0) {
    keyboard.row().text('✅ Продолжить', 'order_continue');
  }
  keyboard.row().text('◀️ Назад', 'order_create');

  const totalPages = Math.ceil(skus.length / pageSize);
  const pageInfo = totalPages > 1 ? ` (страница ${page + 1} из ${totalPages})` : '';
  
  await ctx.reply(
    `📦 *Результаты поиска*\n\nНайдено SKU: ${skus.length}${pageInfo}\n\nВыберите SKU:`,
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    }
  );
}

async function showOrderConfirmation(ctx: BotContext, state: OrderCreationState) {
  const itemsText = state.items.map(item => `• ${item.sku}: ${item.qty} шт.`).join('\n');
  const totalQty = state.items.reduce((sum, item) => sum + item.qty, 0);
  const totalAmount = (state.order_amount_usd || 0) + (state.shipping_cost_usd || 0);
  const unitCost = totalQty > 0 ? totalAmount / totalQty : 0;

  const keyboard = new InlineKeyboard()
    .text('✅ Подтвердить', 'order_confirm')
    .text('✏️ Изменить доставку', 'order_edit_shipping').row()
    .text('◀️ Отмена', 'order_create');

  await ctx.reply(
    `📋 *Подтверждение заказа*\n\n` +
    `Поставщик: ${state.supplier_name}\n\n` +
    `Товары:\n${itemsText}\n\n` +
    `Сумма заказа: ${formatCurrency(state.order_amount_usd || 0)}\n` +
    `Доставка: ${formatCurrency(state.shipping_cost_usd ?? 0)}\n` +
    `Итого: ${formatCurrency(totalAmount)}\n` +
    `Средняя себестоимость: ${formatCurrency(unitCost)}`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

