import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../bot';
import { generateMoveId, generateWriteOffId } from '../utils/id';
import { getCurrentTimestamp } from '../utils/date';
import { ShipmentState } from '../types';

const shipmentStates = new Map<number, ShipmentState>();
const isSearchingSKU = new Map<number, boolean>();

export function setupShipmentHandlers(bot: Bot<BotContext>) {
  // Меню: списание с офиса (без выбора маркетплейса)
  bot.callbackQuery('menu_shipment', async (ctx) => {
    shipmentStates.set(ctx.from!.id, { step: 'sku' });
    const skus = await ctx.sheets.getSKUs(true);
    await showShipmentSKUList(ctx, skus, 0);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^shipment_sku_page_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const page = parseInt(ctx.match[1], 10);
    const skus = await ctx.sheets.getSKUs(true);
    await showShipmentSKUList(ctx, skus, page);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('shipment_sku_search', async (ctx) => {
    if (!ctx.from) return;
    isSearchingSKU.set(ctx.from.id, true);
    await ctx.editMessageText(
      '🔍 *Поиск SKU*\n\nВведите часть артикула для поиска:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'menu_shipment'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^shipment_sku_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    if (ctx.callbackQuery.data.startsWith('shipment_sku_page_')) return;
    const sku = ctx.match[1];
    const state = shipmentStates.get(ctx.from.id);
    if (!state) return;
    state.sku = sku;
    state.step = 'qty';
    const officeQty = await ctx.stock.getOfficeStock(sku);
    await ctx.editMessageText(
      `📦 *${sku}*\n\nОстаток в офисе: ${officeQty} шт.\n\nВведите количество для списания:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'menu_shipment'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  // Текстовые сообщения: поиск SKU, ввод количества, ввод комментария
  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    const state = shipmentStates.get(ctx.from.id);
    if (!state) return next();

    if (isSearchingSKU.get(ctx.from.id)) {
      isSearchingSKU.set(ctx.from.id, false);
      const searchText = ctx.message.text.trim().toLowerCase();
      if (!searchText) {
        await ctx.reply('Введите текст для поиска.');
        return;
      }
      const allSKUs = await ctx.sheets.getSKUs(true);
      const filtered = allSKUs.filter(s => s.sku.toLowerCase().includes(searchText));
      if (filtered.length === 0) {
        await ctx.reply(`По запросу «${ctx.message.text}» ничего не найдено.`, {
          reply_markup: new InlineKeyboard()
            .text('🔍 Поиск снова', 'shipment_sku_search')
            .text('📋 Весь список', 'menu_shipment'),
        });
        return;
      }
      await showShipmentSKUListAsReply(ctx, filtered, 0);
      return;
    }

    if (state.step === 'qty') {
      const qty = parseInt(ctx.message.text.trim(), 10);
      if (isNaN(qty) || qty <= 0) {
        await ctx.reply('Введите число больше 0.');
        return;
      }
      if (!state.sku) {
        await ctx.reply('Ошибка: SKU не выбран.');
        return;
      }
      const officeQty = await ctx.stock.getOfficeStock(state.sku);
      if (qty > officeQty) {
        await ctx.reply(`❌ Недостаточно на складе. В офисе: ${officeQty} шт.`);
        return;
      }
      state.qty = qty;
      state.step = 'comment';
      await ctx.reply(
        '📝 Введите комментарий к списанию (можно кратко, например: «Отправка клиенту», «Брак»):',
        { reply_markup: new InlineKeyboard().text('◀️ Отмена', 'menu_shipment') }
      );
      return;
    }

    if (state.step === 'comment') {
      const comment = ctx.message.text.trim() || '—';
      state.comment = comment;
      state.step = 'confirm';
      await ctx.reply(
        `📤 *Подтверждение списания*\n\n` +
        `📦 SKU: ${state.sku}\n` +
        `🔢 Количество: ${state.qty} шт.\n` +
        `📝 Комментарий: ${comment}\n\n` +
        `Подтвердить списание с офиса?`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('✅ Подтвердить', 'shipment_confirm')
            .text('◀️ Отмена', 'menu_shipment'),
        }
      );
      return;
    }

    return next();
  });

  // Подтверждение списания
  bot.callbackQuery('shipment_confirm', async (ctx) => {
    if (!ctx.from) return;
    const state = shipmentStates.get(ctx.from.id);
    if (!state || state.step !== 'confirm' || !state.sku || state.qty == null) {
      await ctx.answerCallbackQuery('Ошибка: неполные данные');
      return;
    }

    try {
      const officeQty = await ctx.stock.getOfficeStock(state.sku);
      if (state.qty > officeQty) {
        await ctx.reply(`❌ Недостаточно на складе. В офисе: ${officeQty} шт.`);
        shipmentStates.delete(ctx.from.id);
        await ctx.answerCallbackQuery();
        return;
      }

      const now = getCurrentTimestamp();
      const writeOffId = generateWriteOffId();

      await ctx.sheets.createWriteOff({
        write_off_id: writeOffId,
        sku: state.sku,
        qty: state.qty,
        comment: state.comment || '—',
        created_at: now,
        created_by: 'admin',
      });

      await ctx.sheets.createMovement({
        move_id: generateMoveId(),
        type: 'SHIP',
        source: 'OFFICE',
        destination: 'NONE',
        marketplace: 'NONE',
        sku: state.sku,
        qty: state.qty,
        note: state.comment || '',
        created_at: now,
        created_by: 'admin',
      });

      await ctx.stock.updateOfficeStockAfterMovement(state.sku, -state.qty);

      shipmentStates.delete(ctx.from.id);

      await ctx.editMessageText(
        `✅ *Списание оформлено*\n\n` +
        `📦 ${state.sku}: ${state.qty} шт.\n` +
        `📝 ${state.comment || '—'}\n\n` +
        `Запись в листе *write_offs*.`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('◀️ Главное меню', 'menu_main'),
        }
      );
    } catch (error) {
      console.error('Shipment/write-off error:', error);
      await ctx.reply('Ошибка при списании. Попробуйте снова.');
    }
    await ctx.answerCallbackQuery();
  });
}

async function showShipmentSKUList(ctx: BotContext, skus: any[], page: number) {
  const pageSize = 10;
  const start = page * pageSize;
  const end = start + pageSize;
  const pageSkus = skus.slice(start, end);
  const keyboard = new InlineKeyboard();
  pageSkus.forEach((s, idx) => {
    if (idx % 2 === 0) keyboard.row();
    keyboard.text(s.sku, `shipment_sku_${s.sku}`);
  });
  if (Math.ceil(skus.length / pageSize) > 1) {
    keyboard.row();
    if (page > 0) keyboard.text('◀️', `shipment_sku_page_${page - 1}`);
    if (end < skus.length) keyboard.text('▶️', `shipment_sku_page_${page + 1}`);
  }
  keyboard.row().text('🔍 Поиск', 'shipment_sku_search');
  keyboard.row().text('◀️ Назад', 'menu_main');

  const totalPages = Math.ceil(skus.length / pageSize);
  const pageInfo = totalPages > 1 ? ` (стр. ${page + 1}/${totalPages})` : '';
  await ctx.editMessageText(
    `📤 *Списание с офиса*\n\nВыберите товар:${pageInfo}\n\nВсего SKU: ${skus.length}`,
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    }
  );
}

async function showShipmentSKUListAsReply(ctx: BotContext, skus: any[], page: number) {
  const pageSize = 10;
  const start = page * pageSize;
  const end = start + pageSize;
  const pageSkus = skus.slice(start, end);
  const keyboard = new InlineKeyboard();
  pageSkus.forEach((s, idx) => {
    if (idx % 2 === 0) keyboard.row();
    keyboard.text(s.sku, `shipment_sku_${s.sku}`);
  });
  if (Math.ceil(skus.length / pageSize) > 1) {
    keyboard.row();
    if (page > 0) keyboard.text('◀️', `shipment_sku_page_${page - 1}`);
    if (end < skus.length) keyboard.text('▶️', `shipment_sku_page_${page + 1}`);
  }
  keyboard.row().text('🔍 Поиск', 'shipment_sku_search');
  keyboard.row().text('◀️ Назад', 'menu_main');

  const totalPages = Math.ceil(skus.length / pageSize);
  const pageInfo = totalPages > 1 ? ` (стр. ${page + 1}/${totalPages})` : '';
  await ctx.reply(
    `📤 *Результаты поиска*\n\nНайдено: ${skus.length}${pageInfo}\n\nВыберите SKU:`,
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    }
  );
}
