import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../bot';
import { generateId } from '../utils/id';
import { getCurrentTimestamp, formatDate } from '../utils/date';

const waitingForIdea = new Map<number, boolean>();

export function setupIdeasHandlers(bot: Bot<BotContext>) {
  bot.callbackQuery('menu_ideas', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('➕ Новая идея', 'idea_new')
      .text('📋 Мои идеи', 'idea_list').row()
      .text('◀️ Главное меню', 'menu_main');

    await ctx.editMessageText(
      '💡 *Идеи*\n\nВыберите действие:',
      {
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('idea_new', async (ctx) => {
    if (!ctx.from) return;
    
    waitingForIdea.set(ctx.from.id, true);
    
    await ctx.editMessageText(
      '💡 *Новая идея*\n\nНапишите вашу идею:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'menu_ideas'),
      }
    );
    await ctx.answerCallbackQuery();
  });

  // Handle idea input
  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    
    if (!waitingForIdea.get(ctx.from.id)) return next();
    
    const ideaText = ctx.message.text.trim();
    if (!ideaText) {
      await ctx.reply('Пожалуйста, введите текст идеи.');
      return;
    }

    try {
      const ideaId = generateId();
      await ctx.sheets.createIdea({
        idea_id: ideaId,
        idea_text: ideaText,
        created_at: getCurrentTimestamp(),
        created_by: 'admin',
      });

      waitingForIdea.delete(ctx.from.id);

      await ctx.reply(
        `✅ *Идея сохранена*\n\n${ideaText}`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('➕ Еще идея', 'idea_new')
            .text('📋 Мои идеи', 'idea_list').row()
            .text('◀️ Главное меню', 'menu_main'),
        }
      );
    } catch (error) {
      console.error('Error saving idea:', error);
      await ctx.reply('❌ Ошибка при сохранении идеи. Попробуйте еще раз.');
      waitingForIdea.delete(ctx.from.id);
    }
  });

  bot.callbackQuery('idea_list', async (ctx) => {
    try {
      const ideas = await ctx.sheets.getIdeas();
      
      if (ideas.length === 0) {
        await ctx.editMessageText(
          '📋 *Мои идеи*\n\nНет сохраненных идей',
          {
            reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_ideas'),
            parse_mode: 'Markdown',
          }
        );
        await ctx.answerCallbackQuery();
        return;
      }

      // Sort by date (newest first)
      const sortedIdeas = ideas.sort((a, b) => 
        b.created_at.localeCompare(a.created_at)
      );

      const ideasText = sortedIdeas
        .slice(0, 20) // Limit to 20 most recent
        .map((idea, idx) => 
          `${idx + 1}. ${formatDate(idea.created_at)}\n${idea.idea_text}`
        )
        .join('\n\n━━━━━━━━━━━━━━━━\n\n');

      const text = `📋 *Мои идеи*\n\nВсего: ${ideas.length}\n\n${ideasText}`;

      await ctx.editMessageText(
        text.length > 4096 ? text.substring(0, 4090) + '...' : text,
        {
          reply_markup: new InlineKeyboard()
            .text('➕ Новая идея', 'idea_new')
            .text('◀️ Назад', 'menu_ideas'),
          parse_mode: 'Markdown',
        }
      );
      await ctx.answerCallbackQuery();
    } catch (error) {
      console.error('Error fetching ideas:', error);
      await ctx.answerCallbackQuery('Ошибка при загрузке идей');
    }
  });
}

