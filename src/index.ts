import { bot } from './bot';

async function main() {
  console.log('Starting inventory bot...');
  
  try {
    await bot.start();
    console.log('Bot started successfully!');
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main();

