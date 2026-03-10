import { UzumStockResponse, UzumSalesResponse } from '../types';

export class UzumService {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(baseUrl: string, apiKey: string, apiSecret: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private async makeRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'accept': '*/*',
    };

    // Uzum seller-openapi: простой API-ключ в Authorization без Bearer
    if (this.apiKey) {
      headers['Authorization'] = this.apiKey;
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        throw new Error(`Uzum API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Uzum API request failed:', error);
      throw error;
    }
  }

  /**
   * Get stock quantity for a specific SKU (article) across all shops.
   * Обёртка над getBulkStock, чтобы не дублировать логику.
   */
  async getStock(sku: string): Promise<number> {
    const map = await this.getBulkStock([sku]);
    return map.get(sku) || 0;
  }

  /**
   * Get stock for multiple SKUs.
   *
   * Uzum API: GET /v1/product/shop/{shopId}
   * Мы:
   * - обходим магазины 1594 и 79402,
   * - берём skuList[*].article (или sellerItemCode) как наш SKU,
   * - суммируем skuList[*].quantityActive по всем магазинам.
   *
   * @param skus - Array of SKU codes (articles). Если пустой массив, вернём все артикулы, что пришли из Uzum.
   * @returns Map<sku, quantityActive>
   */
  async getBulkStock(skus: string[]): Promise<Map<string, number>> {
    const stockMap = new Map<string, number>();

    // Список магазинов, которые нужно опросить (из твоего сообщения)
    const shopIds = [1594, 79402];

    try {
      for (const shopId of shopIds) {
        const pageSize = 100;
        let page = 0; // Uzum API: первая страница = 0

        // Пагинация по всем товарам магазина
        while (true) {
          const endpoint = `/v1/product/shop/${shopId}?sortBy=DEFAULT&order=ASC&size=${pageSize}&page=${page}&filter=ACTIVE`;
          const response = await this.makeRequest(endpoint);

          const productList = response?.productList;
          if (!Array.isArray(productList) || productList.length === 0) {
            break;
          }

          for (const product of productList) {
            const skuList = product?.skuList;
            if (!Array.isArray(skuList)) continue;

            for (const skuItem of skuList as any[]) {
              // Опорное поле: article. Если его нет — пробуем sellerItemCode.
              const code: string =
                skuItem.article ||
                skuItem.sellerItemCode ||
                skuItem.skuFullTitle ||
                skuItem.skuTitle;

              if (!code) continue;

              const qtyActive = Number(skuItem.quantityActive || 0);

              // Если вызывающий передал список skus, фильтруем по нему
              if (skus && skus.length > 0 && !skus.includes(code)) {
                continue;
              }

              const current = stockMap.get(code) || 0;
              stockMap.set(code, current + qtyActive);
            }
          }

          // Если пришло меньше, чем pageSize, значит это последняя страница
          if (productList.length < pageSize) {
            break;
          }
          page += 1;
        }
      }
    } catch (error) {
      console.error('Error fetching bulk stock from Uzum /v1/product/shop:', error);
      // В случае ошибки просто вернём то, что успели набрать (или пустую map)
    }

    return stockMap;
  }

  /**
   * Get sales report for a date range
   * @param startDate - Start date (ISO format)
   * @param endDate - End date (ISO format)
   * @returns Array of sales with SKU, quantity, and net revenue
   */
  async getSales(startDate: string, endDate: string): Promise<Array<{
    article: string;
    sold_at: string;
    qty: number;
    net_revenue_usd: number;
    [key: string]: any;
  }>> {
    try {
      // NOTE: Replace with actual Uzum sales API endpoint
      // Example: /sales/report?start_date={startDate}&end_date={endDate}
      const response = await this.makeRequest(
        `/sales/report?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`
      );
      
      // Adjust based on actual API response structure
      if (response.data && Array.isArray(response.data.sales)) {
        return response.data.sales;
      }
      if (response.sales && Array.isArray(response.sales)) {
        return response.sales;
      }
      if (Array.isArray(response)) {
        return response;
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching sales:', error);
      throw error;
    }
  }

  /**
   * Check if API is configured and accessible
   */
  async isConfigured(): Promise<boolean> {
    try {
      // Try a simple endpoint to check connectivity
      await this.makeRequest('/health', 'GET');
      return true;
    } catch (error) {
      return false;
    }
  }
}

