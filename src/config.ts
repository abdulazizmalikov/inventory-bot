import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    adminIds: (process.env.ADMIN_IDS || '').split(',').map((id: string) => parseInt(id.trim())).filter((id: number) => !isNaN(id)),
  },
  google: {
    sheetsId: process.env.GOOGLE_SHEETS_ID || '',
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: process.env.GOOGLE_PRIVATE_KEY || '',
  },
  uzum: {
    baseUrl: process.env.UZUM_API_BASE_URL || 'https://api-seller.uzum.uz/api/seller-openapi',
    apiKey: process.env.UZUM_API_KEY || '',
    apiSecret: process.env.UZUM_API_SECRET || '',
  },
  yandex: {
    baseUrl: process.env.YANDEX_API_BASE_URL || 'https://api.partner.market.yandex.ru',
    apiToken: process.env.YANDEX_API_TOKEN || '',
  },
};

export function isAdmin(userId: number): boolean {
  return config.telegram.adminIds.includes(userId);
}

