import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../bot';
import { getCurrentTimestamp, formatCurrency, formatDate } from '../utils/date';
import { generateId } from '../utils/id';
import { subDays, startOfMonth, endOfMonth } from 'date-fns';

export function setupProfitHandlers(bot: Bot<BotContext>) {
  bot.callbackQuery('menu_profit', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('📊 Последние расчеты', 'profit_recent')
      .text('◀️ Главное меню', 'menu_main');

    await ctx.editMessageText(
      '💰 *Прибыль*\n\nВыберите действие:',
      {
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu_update_sales', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('📅 Последние 7 дней', 'profit_update_7')
      .text('📅 Последние 30 дней', 'profit_update_30').row()
      .text('📅 Этот месяц', 'profit_update_month')
      .text('📅 Произвольный период', 'profit_update_custom').row()
      .text('◀️ Назад', 'menu_profit');

    await ctx.editMessageText(
      '🔄 *Обновить продажи*\n\nВыберите период:',
      {
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('profit_update_7', async (ctx) => {
    const endDate = new Date();
    const startDate = subDays(endDate, 7);
    await updateSalesAndCalculateProfit(ctx, startDate.toISOString(), endDate.toISOString());
  });

  bot.callbackQuery('profit_update_30', async (ctx) => {
    const endDate = new Date();
    const startDate = subDays(endDate, 30);
    await updateSalesAndCalculateProfit(ctx, startDate.toISOString(), endDate.toISOString());
  });

  bot.callbackQuery('profit_update_month', async (ctx) => {
    const now = new Date();
    const startDate = startOfMonth(now);
    const endDate = endOfMonth(now);
    await updateSalesAndCalculateProfit(ctx, startDate.toISOString(), endDate.toISOString());
  });

  bot.callbackQuery('profit_recent', async (ctx) => {
    const calculations = await ctx.sheets.getProfitCalculations();
    const recent = calculations
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 10);

    if (recent.length === 0) {
      await ctx.editMessageText(
        '📊 *Последние расчеты*\n\nНет расчетов прибыли',
        {
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_profit'),
          parse_mode: 'Markdown',
        }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    // Group by period
    const byPeriod = new Map<string, ProfitSummary>();
    for (const calc of recent) {
      const key = `${calc.period_start}_${calc.period_end}`;
      if (!byPeriod.has(key)) {
        byPeriod.set(key, {
          periodStart: calc.period_start,
          periodEnd: calc.period_end,
          totalRevenue: 0,
          totalCOGS: 0,
          totalProfit: 0,
          skuCount: 0,
        });
      }
      const summary = byPeriod.get(key)!;
      summary.totalRevenue += calc.net_revenue_usd;
      summary.totalCOGS += calc.cogs_total_usd;
      summary.totalProfit += calc.profit_usd;
      summary.skuCount++;
    }

    const text = '📊 *Последние расчеты*\n\n' +
      Array.from(byPeriod.values())
        .map(summary => 
          `Период: ${formatDate(summary.periodStart)} - ${formatDate(summary.periodEnd)}\n` +
          `Товаров: ${summary.skuCount}\n` +
          `Выручка: ${formatCurrency(summary.totalRevenue)}\n` +
          `Себестоимость: ${formatCurrency(summary.totalCOGS)}\n` +
          `Прибыль: ${formatCurrency(summary.totalProfit)}\n`
        ).join('\n');

    await ctx.editMessageText(
      text.length > 4096 ? text.substring(0, 4090) + '...' : text,
      {
        reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_profit'),
        parse_mode: 'Markdown',
      }
    );
    await ctx.answerCallbackQuery();
  });
}

interface ProfitSummary {
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  totalCOGS: number;
  totalProfit: number;
  skuCount: number;
}

async function updateSalesAndCalculateProfit(ctx: BotContext, startDate: string, endDate: string) {
  await ctx.editMessageText('⏳ Загрузка продаж из API...', {
    reply_markup: new InlineKeyboard().text('◀️ Отмена', 'menu_update_sales'),
  });
  await ctx.answerCallbackQuery();

  try {
    // Fetch sales from Uzum API
    const sales = await ctx.uzum.getSales(startDate, endDate);
    
    if (sales.length === 0) {
      await ctx.editMessageText(
        `📊 *Продажи*\n\nЗа период ${formatDate(startDate)} - ${formatDate(endDate)}\n\nНет продаж`,
        {
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_update_sales'),
          parse_mode: 'Markdown',
        }
      );
      return;
    }

    // Store sales (avoid duplicates)
    let newSalesCount = 0;
    for (const sale of sales) {
      const saleId = sale.sale_id || sale.doc_id || `${sale.article}_${sale.sold_at}`;
      const exists = await ctx.sheets.saleExists(saleId, sale.doc_id);
      
      if (!exists) {
        await ctx.sheets.createUzumSale({
          sale_id: saleId,
          doc_id: sale.doc_id,
          sold_at: sale.sold_at,
          sku: sale.article,
          qty: sale.qty,
          net_revenue_usd: sale.net_revenue_usd,
          raw_json: JSON.stringify(sale),
        });
        newSalesCount++;
      }
    }

    await ctx.editMessageText(
      `⏳ Обработано продаж: ${newSalesCount} новых\nРасчет прибыли...`,
      {
        reply_markup: new InlineKeyboard(),
      }
    );

    // Calculate profit by SKU
    const salesBySKU = new Map<string, { qty: number; revenue: number }>();
    for (const sale of sales) {
      const existing = salesBySKU.get(sale.article) || { qty: 0, revenue: 0 };
      existing.qty += sale.qty;
      existing.revenue += sale.net_revenue_usd;
      salesBySKU.set(sale.article, existing);
    }

    const calcId = generateId();
    const calculations: any[] = [];
    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalProfit = 0;

    for (const [sku, data] of salesBySKU.entries()) {
      const avgCOGS = await ctx.sheets.getAverageCOGS(sku);
      const cogsTotal = avgCOGS * data.qty;
      const profit = data.revenue - cogsTotal;

      totalRevenue += data.revenue;
      totalCOGS += cogsTotal;
      totalProfit += profit;

      const calc = {
        calc_id: `${calcId}_${sku}`,
        period_start: startDate,
        period_end: endDate,
        sku,
        qty_sold: data.qty,
        net_revenue_usd: data.revenue,
        avg_cogs_usd: avgCOGS,
        cogs_total_usd: cogsTotal,
        profit_usd: profit,
        created_at: getCurrentTimestamp(),
      };

      await ctx.sheets.createProfitCalculation(calc);
      calculations.push(calc);
    }

    // Get top 10 by profit
    const top10 = calculations
      .sort((a, b) => b.profit_usd - a.profit_usd)
      .slice(0, 10);

    const top10Text = top10.map((calc, idx) => 
      `${idx + 1}. ${calc.sku}: ${formatCurrency(calc.profit_usd)} (${calc.qty_sold} шт.)`
    ).join('\n');

    const text = `💰 *Расчет прибыли*\n\n` +
      `Период: ${formatDate(startDate)} - ${formatDate(endDate)}\n\n` +
      `📊 Итого:\n` +
      `Выручка: ${formatCurrency(totalRevenue)}\n` +
      `Себестоимость: ${formatCurrency(totalCOGS)}\n` +
      `Прибыль: ${formatCurrency(totalProfit)}\n\n` +
      `📈 Топ-10 товаров по прибыли:\n${top10Text}`;

    await ctx.editMessageText(
      text.length > 4096 ? text.substring(0, 4090) + '...' : text,
      {
        reply_markup: new InlineKeyboard().text('◀️ Главное меню', 'menu_main'),
        parse_mode: 'Markdown',
      }
    );
  } catch (error) {
    console.error('Error updating sales:', error);
    await ctx.editMessageText(
      '❌ Ошибка при обновлении продаж.\nПроверьте настройки API.',
      {
        reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_update_sales'),
      }
    );
  }
}

