import { SheetsService } from './sheets';
import { Warehouse, Marketplace } from '../types';

export class StockService {
  constructor(private sheets: SheetsService) {}

  /**
   * Get stock quantity in IN_TRANSIT warehouse for a SKU
   */
  async getInTransitStock(sku: string): Promise<number> {
    const movements = await this.sheets.getMovements(sku, 'PO_CREATE');
    const receives = await this.sheets.getMovements(sku, 'PO_RECEIVE');
    
    const created = movements.reduce((sum, m) => sum + m.qty, 0);
    const received = receives.reduce((sum, m) => sum + m.qty, 0);
    
    return Math.max(0, created - received);
  }

  /**
   * Get stock quantity in OFFICE warehouse for a SKU
   */
  async getOfficeStock(sku: string): Promise<number> {
    return await this.sheets.getOfficeStockBySKU(sku);
  }

  /**
   * Get aggregated stock by SKU for IN_TRANSIT
   */
  async getAllInTransitStock(): Promise<Map<string, number>> {
    const allPOs = await this.sheets.getPurchaseOrders('IN_TRANSIT');
    const stockMap = new Map<string, number>();
    
    for (const po of allPOs) {
      const items = await this.sheets.getPurchaseOrderItems(po.po_id);
      for (const item of items) {
        const current = stockMap.get(item.sku) || 0;
        stockMap.set(item.sku, current + item.qty);
      }
    }
    
    return stockMap;
  }

  /**
   * Get aggregated stock by SKU for OFFICE
   */
  async getAllOfficeStock(): Promise<Map<string, number>> {
    const stock = await this.sheets.getOfficeStock();
    const stockMap = new Map<string, number>();
    
    for (const item of stock) {
      stockMap.set(item.sku, item.qty);
    }
    
    return stockMap;
  }

  /**
   * Update office stock after movement
   */
  async updateOfficeStockAfterMovement(sku: string, qtyChange: number): Promise<void> {
    const currentQty = await this.getOfficeStock(sku);
    const newQty = Math.max(0, currentQty + qtyChange);
    await this.sheets.updateOfficeStock(sku, newQty);
  }
}

