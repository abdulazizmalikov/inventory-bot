import { Bot, Context, InlineKeyboard } from 'grammy';
import { config, isAdmin } from './config';
import { SheetsService } from './services/sheets';
import { UzumService } from './services/uzum';
import { StockService } from './services/stock';
import { setupOrderHandlers } from './handlers/orders';
import { setupShipmentHandlers } from './handlers/shipments';
import { setupReturnHandlers } from './handlers/returns';
import { setupWarehouseHandlers } from './handlers/warehouses';
import { setupProfitHandlers } from './handlers/profit';
import { setupIdeasHandlers } from './handlers/ideas';

export interface BotContext extends Context {
  sheets: SheetsService;
  uzum: UzumService;
  stock: StockService;
}

// Initialize services
const sheetsService = new SheetsService(
  config.google.sheetsId,
  config.google.serviceAccountEmail,
  config.google.privateKey
);

const uzumService = new UzumService(
  config.uzum.baseUrl,
  config.uzum.apiKey,
  config.uzum.apiSecret
);

const stockService = new StockService(sheetsService);

// Create bot
export const bot = new Bot<BotContext>(config.telegram.botToken);

// Middleware to add services to context
bot.use(async (ctx: BotContext, next: () => Promise<void>) => {
  ctx.sheets = sheetsService;
  ctx.uzum = uzumService;
  ctx.stock = stockService;
  await next();
});

// Admin check middleware
bot.use(async (ctx: BotContext, next: () => Promise<void>) => {
  if (!ctx.from) {
    return;
  }
  
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет доступа к этому боту. Обратитесь к администратору.');
    return;
  }
  
  await next();
});

// Start command
bot.command('start', async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text('🚚 В пути', 'menu_in_transit')
    .text('📤 Отправка', 'menu_shipment').row()
    .text('🔁 Возврат', 'menu_return')
    .text('🏬 Склады', 'menu_warehouses').row()
    .text('💰 Прибыль', 'menu_profit')
    .text('🔄 Обновить продажи', 'menu_update_sales').row()
    .text('💡 Идея', 'menu_ideas');

  await ctx.reply(
    '📦 *Управление складом*\n\nВыберите действие:',
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    }
  );
});

// Main menu callback
bot.callbackQuery('menu_main', async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text('🚚 В пути', 'menu_in_transit')
    .text('📤 Отправка', 'menu_shipment').row()
    .text('🔁 Возврат', 'menu_return')
    .text('🏬 Склады', 'menu_warehouses').row()
    .text('💰 Прибыль', 'menu_profit')
    .text('🔄 Обновить продажи', 'menu_update_sales').row()
    .text('💡 Идея', 'menu_ideas');

  await ctx.editMessageText(
    '📦 *Управление складом*\n\nВыберите действие:',
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    }
  );
  await ctx.answerCallbackQuery();
});

// Setup handlers
setupOrderHandlers(bot);
setupShipmentHandlers(bot);
setupReturnHandlers(bot);
setupWarehouseHandlers(bot);
setupProfitHandlers(bot);
setupIdeasHandlers(bot);
setupIdeasHandlers(bot);

// Error handling
bot.catch((err: any) => {
  const { error } = err;
  console.error('Bot error:', error);
});

