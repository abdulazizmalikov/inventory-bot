import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../bot';
import { ReturnState } from '../types';
import { generateMoveId } from '../utils/id';
import { getCurrentTimestamp } from '../utils/date';
import { Marketplace } from '../types';

const returnStates = new Map<number, ReturnState>();
const isSearchingSKU = new Map<number, boolean>(); // Track if user is in search mode

export function setupReturnHandlers(bot: Bot<BotContext>) {
  bot.callbackQuery('menu_return', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('🛒 Uzum', 'return_marketplace_UZUM')
      .text('🛒 Yandex', 'return_marketplace_YANDEX').row()
      .text('◀️ Главное меню', 'menu_main');

    await ctx.editMessageText(
      '🔁 *Возврат товара*\n\nВыберите маркетплейс:',
      {
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^return_marketplace_(UZUM|YANDEX)$/, async (ctx) => {
    if (!ctx.from) return;
    
    const marketplace = ctx.match[1] as Marketplace;
    returnStates.set(ctx.from.id, {
      step: 'sku',
      marketplace,
    });

    const skus = await ctx.sheets.getSKUs(true);
    await showReturnSKUList(ctx, skus, 0);
  });

  // SKU search
  bot.callbackQuery('return_sku_search', async (ctx) => {
    if (!ctx.from) return;
    
    isSearchingSKU.set(ctx.from.id, true);
    
    await ctx.editMessageText(
      '🔍 *Поиск SKU*\n\nВведите часть артикула для поиска:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'menu_return'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^return_sku_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    
    // Skip if this is a pagination callback
    if (ctx.callbackQuery.data.startsWith('return_sku_page_')) {
      return;
    }
    
    const sku = ctx.match[1];
    const state = returnStates.get(ctx.from.id);
    if (!state) return;

    state.sku = sku;
    state.step = 'qty';

    await ctx.editMessageText(
      `📦 *${sku}*\n\nВведите количество для возврата:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'menu_return'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  // Handle quantity input and search
  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    
    const state = returnStates.get(ctx.from.id);
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
              .text('🔍 Поиск снова', 'return_sku_search')
              .text('📋 Весь список', 'menu_return'),
          }
        );
        return;
      }

      await showReturnSKUListAsReply(ctx, filteredSKUs, 0);
      return;
    }

    // Handle quantity input
    if (state.step !== 'qty') return next();

    const qty = parseInt(ctx.message.text.trim());
    if (isNaN(qty) || qty <= 0) {
      await ctx.reply('Пожалуйста, введите корректное количество (число больше 0).');
      return;
    }

    if (!state.sku) {
      await ctx.reply('Ошибка: SKU не выбран');
      return;
    }

    state.qty = qty;
    state.step = 'confirm';

    await showReturnConfirmation(ctx, state);
  });

  bot.callbackQuery('return_confirm', async (ctx) => {
    if (!ctx.from) return;
    
    const state = returnStates.get(ctx.from.id);
    if (!state || !state.marketplace || !state.sku || !state.qty) {
      await ctx.answerCallbackQuery('Ошибка: неполные данные');
      return;
    }

    try {
      // Create movement (RETURN does NOT decrease marketplace stock)
      await ctx.sheets.createMovement({
        move_id: generateMoveId(),
        type: 'RETURN',
        source: 'MARKETPLACE',
        destination: 'OFFICE',
        marketplace: state.marketplace,
        sku: state.sku,
        qty: state.qty,
        note: `Возврат с ${state.marketplace}`,
        created_at: getCurrentTimestamp(),
        created_by: 'admin',
      });

      // Update office stock (increase)
      await ctx.stock.updateOfficeStockAfterMovement(state.sku, state.qty);

      returnStates.delete(ctx.from.id);

      await ctx.editMessageText(
        `✅ *Товар возвращен*\n\nSKU: ${state.sku}\nКоличество: ${state.qty} шт.\nМаркетплейс: ${state.marketplace}\n\nТовар добавлен в офис.`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('◀️ Главное меню', 'menu_main'),
        }
      );
    } catch (error) {
      console.error('Error processing return:', error);
      await ctx.answerCallbackQuery('Ошибка при возврате');
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^return_sku_page_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    
    const page = parseInt(ctx.match[1]);
    const skus = await ctx.sheets.getSKUs(true);
    await showReturnSKUList(ctx, skus, page);
    await ctx.answerCallbackQuery();
  });
}

async function showReturnSKUList(ctx: BotContext, skus: any[], page: number) {
  const pageSize = 10;
  const start = page * pageSize;
  const end = start + pageSize;
  const pageSkus = skus.slice(start, end);

  const keyboard = new InlineKeyboard();
  pageSkus.forEach((sku, idx) => {
    if (idx % 2 === 0) keyboard.row();
    keyboard.text(sku.sku, `return_sku_${sku.sku}`);
  });

  if (start > 0 || end < skus.length) {
    keyboard.row();
    if (start > 0) keyboard.text('◀️', `return_sku_page_${page - 1}`);
    if (end < skus.length) keyboard.text('▶️', `return_sku_page_${page + 1}`);
  }

  keyboard.row().text('🔍 Поиск', 'return_sku_search');
  keyboard.row().text('◀️ Назад', 'menu_return');

  const totalPages = Math.ceil(skus.length / pageSize);
  const pageInfo = totalPages > 1 ? ` (страница ${page + 1} из ${totalPages})` : '';

  await ctx.editMessageText(
    `📦 *Выбор товара для возврата*\n\nНайдено SKU: ${skus.length}${pageInfo}\n\nВыберите SKU:`,
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    }
  );
}

async function showReturnSKUListAsReply(ctx: BotContext, skus: any[], page: number) {
  const pageSize = 10;
  const start = page * pageSize;
  const end = start + pageSize;
  const pageSkus = skus.slice(start, end);

  const keyboard = new InlineKeyboard();
  pageSkus.forEach((sku, idx) => {
    if (idx % 2 === 0) keyboard.row();
    keyboard.text(sku.sku, `return_sku_${sku.sku}`);
  });

  if (start > 0 || end < skus.length) {
    keyboard.row();
    if (start > 0) keyboard.text('◀️', `return_sku_page_${page - 1}`);
    if (end < skus.length) keyboard.text('▶️', `return_sku_page_${page + 1}`);
  }

  keyboard.row().text('🔍 Поиск', 'return_sku_search');
  keyboard.row().text('◀️ Назад', 'menu_return');

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

async function showReturnConfirmation(ctx: BotContext, state: ReturnState) {
  await ctx.reply(
    `🔁 *Подтверждение возврата*\n\n` +
    `SKU: ${state.sku}\n` +
    `Количество: ${state.qty} шт.\n` +
    `Маркетплейс: ${state.marketplace}\n\n` +
    `Подтвердить возврат?`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('✅ Подтвердить', 'return_confirm')
        .text('◀️ Отмена', 'menu_return'),
    }
  );
}

