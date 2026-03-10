import { google } from 'googleapis';
import {
  SKU,
  Supplier,
  PurchaseOrder,
  PurchaseOrderItem,
  Movement,
  OfficeStock,
  UzumSale,
  ProfitCalculation,
  Idea,
  SkuCost,
  WriteOff,
} from '../types';
import { getCurrentTimestamp } from '../utils/date';

export class SheetsService {
  private sheets: any;
  private spreadsheetId: string;
  private auth: any;

  constructor(spreadsheetId: string, serviceAccountEmail: string, privateKey: string) {
    this.spreadsheetId = spreadsheetId;
    this.auth = new google.auth.JWT({
      email: serviceAccountEmail,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  // Helper to append row
  private async appendRow(sheetName: string, values: any[]): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:Z`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [values] },
      });
    } catch (error) {
      console.error(`Error appending to ${sheetName}:`, error);
      throw error;
    }
  }

  // Helper to read range
  private async readRange(sheetName: string, range: string = 'A:Z'): Promise<any[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!${range}`,
      });
      return response.data.values || [];
    } catch (error) {
      console.error(`Error reading ${sheetName}:`, error);
      throw error;
    }
  }

  // Helper to update cell
  private async updateCell(sheetName: string, row: number, col: number, value: any): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!${this.columnToLetter(col)}${row}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[value]] },
      });
    } catch (error) {
      console.error(`Error updating cell in ${sheetName}:`, error);
      throw error;
    }
  }

  private columnToLetter(column: number): string {
    let temp, letter = '';
    while (column > 0) {
      temp = (column - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      column = (column - temp - 1) / 26;
    }
    return letter;
  }

  // SKUs
  async getSKUs(activeOnly: boolean = false): Promise<SKU[]> {
    const rows = await this.readRange('skus');
    if (rows.length < 2) return [];
    
    const headers = rows[0];
    const skuIndex = headers.indexOf('sku');
    const activeIndex = headers.indexOf('active');
    
    return rows.slice(1)
      .map(row => ({
        sku: row[skuIndex] || '',
        active: row[activeIndex] === 'TRUE' || row[activeIndex] === true,
      }))
      .filter(sku => !activeOnly || sku.active);
  }

  async createSKU(sku: SKU): Promise<void> {
    await this.appendRow('skus', [
      sku.sku,
      sku.active,
      getCurrentTimestamp(),
      'admin',
    ]);
  }

  // Suppliers
  async getSuppliers(): Promise<Supplier[]> {
    const rows = await this.readRange('suppliers');
    if (rows.length < 2) return [];
    
    const headers = rows[0];
    const idIndex = headers.indexOf('supplier_id');
    const nameIndex = headers.indexOf('supplier_name');
    const contactsIndex = headers.indexOf('contacts');
    
    return rows.slice(1).map(row => ({
      supplier_id: row[idIndex] || '',
      supplier_name: row[nameIndex] || '',
      contacts: row[contactsIndex] || '',
    }));
  }

  async createSupplier(supplier: Supplier): Promise<void> {
    await this.appendRow('suppliers', [
      supplier.supplier_id,
      supplier.supplier_name,
      supplier.contacts || '',
      getCurrentTimestamp(),
      'admin',
    ]);
  }

  async findSupplierByName(name: string): Promise<Supplier | null> {
    const suppliers = await this.getSuppliers();
    return suppliers.find(s => s.supplier_name.toLowerCase() === name.toLowerCase()) || null;
  }

  // Purchase Orders
  async getPurchaseOrders(status?: 'IN_TRANSIT' | 'RECEIVED'): Promise<PurchaseOrder[]> {
    const rows = await this.readRange('purchase_orders');
    if (rows.length < 2) {
      console.log('No purchase orders found (rows.length < 2)');
      return [];
    }
    
    const headers = rows[0];
    console.log('Purchase orders headers:', headers);
    
    const poIdIndex = headers.indexOf('po_id');
    const orderNameIndex = headers.indexOf('order_name');
    const supplierIdIndex = headers.indexOf('supplier_id');
    const orderAmountIndex = headers.indexOf('order_amount_usd');
    const shippingCostIndex = headers.indexOf('shipping_cost_usd');
    const totalAmountIndex = headers.indexOf('total_amount_usd');
    const totalQtyIndex = headers.indexOf('total_qty');
    const unitCostIndex = headers.indexOf('unit_cost_usd');
    const statusIndex = headers.indexOf('status');
    const createdAtIndex = headers.indexOf('created_at');
    const receivedAtIndex = headers.indexOf('received_at');
    
    console.log('Column indices:', {
      poIdIndex,
      supplierIdIndex,
      statusIndex,
      totalRows: rows.length
    });
    
    if (poIdIndex === -1) {
      console.error('po_id column not found in headers!');
    }
    
    const orders = rows.slice(1)
      .map((row, idx) => {
        const statusValue = (row[statusIndex] || 'IN_TRANSIT').toString().trim().toUpperCase();
        const normalizedStatus = (statusValue === 'RECEIVED' ? 'RECEIVED' : 'IN_TRANSIT') as 'IN_TRANSIT' | 'RECEIVED';
        
        const po_id = (row[poIdIndex] || '').toString().trim();
        const order_name = orderNameIndex >= 0 ? (row[orderNameIndex] || '').toString().trim() : '';
        console.log(`Row ${idx + 1}: po_id="${po_id}", order_name="${order_name}", status="${row[statusIndex]}" -> normalized="${normalizedStatus}"`);
        
        return {
          po_id,
          order_name: order_name || po_id, // Fallback to po_id if order_name is empty
          supplier_id: (row[supplierIdIndex] || '').toString().trim(),
          order_amount_usd: parseFloat(row[orderAmountIndex] || '0'),
          shipping_cost_usd: parseFloat(row[shippingCostIndex] || '0'),
          total_amount_usd: parseFloat(row[totalAmountIndex] || '0'),
          total_qty: parseInt(row[totalQtyIndex] || '0'),
          unit_cost_usd: parseFloat(row[unitCostIndex] || '0'),
          status: normalizedStatus,
          created_at: row[createdAtIndex] || '',
          received_at: row[receivedAtIndex] || undefined,
        };
      })
      .filter(po => !status || po.status === status);
    
    console.log(`Filtered orders (status=${status}):`, orders.length);
    return orders;
  }

  async createPurchaseOrder(po: PurchaseOrder): Promise<void> {
    await this.appendRow('purchase_orders', [
      po.po_id,
      po.order_name || '',
      po.supplier_id,
      po.order_amount_usd,
      po.shipping_cost_usd,
      po.total_amount_usd,
      po.total_qty,
      po.unit_cost_usd,
      po.status,
      po.created_at,
      po.received_at || '',
      'admin',
    ]);
  }

  async updatePurchaseOrderStatus(poId: string, status: 'RECEIVED', receivedAt: string): Promise<void> {
    const rows = await this.readRange('purchase_orders');
    const headers = rows[0];
    const poIdIndex = headers.indexOf('po_id');
    const statusIndex = headers.indexOf('status');
    const receivedAtIndex = headers.indexOf('received_at');
    
    const rowIndex = rows.findIndex((row, idx) => idx > 0 && row[poIdIndex] === poId);
    if (rowIndex > 0) {
      await this.updateCell('purchase_orders', rowIndex + 1, statusIndex + 1, status);
      await this.updateCell('purchase_orders', rowIndex + 1, receivedAtIndex + 1, receivedAt);
    }
  }

  /** Update shipping cost for an IN_TRANSIT order; recalculates total_amount_usd and unit_cost_usd. */
  async updatePurchaseOrderShipping(poId: string, shippingCostUsd: number): Promise<void> {
    const rows = await this.readRange('purchase_orders');
    const headers = rows[0];
    const poIdIndex = headers.indexOf('po_id');
    const orderAmountIndex = headers.indexOf('order_amount_usd');
    const shippingCostIndex = headers.indexOf('shipping_cost_usd');
    const totalAmountIndex = headers.indexOf('total_amount_usd');
    const totalQtyIndex = headers.indexOf('total_qty');
    const unitCostIndex = headers.indexOf('unit_cost_usd');

    const rowIndex = rows.findIndex((row, idx) => idx > 0 && row[poIdIndex] === poId);
    if (rowIndex < 1) return;

    const row = rows[rowIndex];
    const orderAmountUsd = parseFloat(row[orderAmountIndex] || '0');
    const totalQty = parseInt(row[totalQtyIndex] || '0', 10);
    const totalAmountUsd = orderAmountUsd + shippingCostUsd;
    const unitCostUsd = totalQty > 0 ? totalAmountUsd / totalQty : 0;
    const sheetRow = rowIndex + 1;

    await this.updateCell('purchase_orders', sheetRow, shippingCostIndex + 1, shippingCostUsd);
    await this.updateCell('purchase_orders', sheetRow, totalAmountIndex + 1, totalAmountUsd);
    await this.updateCell('purchase_orders', sheetRow, unitCostIndex + 1, unitCostUsd);
  }

  // Purchase Order Items
  async getPurchaseOrderItems(poId: string): Promise<PurchaseOrderItem[]> {
    const rows = await this.readRange('purchase_order_items');
    if (rows.length < 2) return [];
    
    const headers = rows[0];
    const poIdIndex = headers.indexOf('po_id');
    const skuIndex = headers.indexOf('sku');
    const qtyIndex = headers.indexOf('qty');
    const unitCostIndex = headers.indexOf('unit_cost_usd');
    
    return rows.slice(1)
      .filter(row => row[poIdIndex] === poId)
      .map(row => ({
        po_id: row[poIdIndex] || '',
        sku: row[skuIndex] || '',
        qty: parseInt(row[qtyIndex] || '0'),
        unit_cost_usd: parseFloat(row[unitCostIndex] || '0'),
      }));
  }

  async createPurchaseOrderItem(item: PurchaseOrderItem): Promise<void> {
    await this.appendRow('purchase_order_items', [
      item.po_id,
      item.sku,
      item.qty,
      item.unit_cost_usd,
      getCurrentTimestamp(),
    ]);
  }

  // Movements
  async createMovement(movement: Movement): Promise<void> {
    await this.appendRow('movements', [
      movement.move_id,
      movement.type,
      movement.source,
      movement.destination,
      movement.marketplace,
      movement.sku,
      movement.qty,
      movement.unit_cost_usd || '',
      movement.amount_usd || '',
      movement.note || '',
      movement.created_at,
      movement.created_by || 'admin',
    ]);
  }

  async getMovements(sku?: string, type?: string): Promise<Movement[]> {
    const rows = await this.readRange('movements');
    if (rows.length < 2) return [];
    
    const headers = rows[0];
    const moveIdIndex = headers.indexOf('move_id');
    const typeIndex = headers.indexOf('type');
    const sourceIndex = headers.indexOf('source');
    const destIndex = headers.indexOf('destination');
    const marketplaceIndex = headers.indexOf('marketplace');
    const skuIndex = headers.indexOf('sku');
    const qtyIndex = headers.indexOf('qty');
    const unitCostIndex = headers.indexOf('unit_cost_usd');
    const amountIndex = headers.indexOf('amount_usd');
    const noteIndex = headers.indexOf('note');
    const createdAtIndex = headers.indexOf('created_at');
    
    return rows.slice(1)
      .filter(row => {
        if (sku && row[skuIndex] !== sku) return false;
        if (type && row[typeIndex] !== type) return false;
        return true;
      })
      .map(row => ({
        move_id: row[moveIdIndex] || '',
        type: row[typeIndex] as any,
        source: row[sourceIndex] as any,
        destination: row[destIndex] as any,
        marketplace: row[marketplaceIndex] as any,
        sku: row[skuIndex] || '',
        qty: parseInt(row[qtyIndex] || '0'),
        unit_cost_usd: row[unitCostIndex] ? parseFloat(row[unitCostIndex]) : undefined,
        amount_usd: row[amountIndex] ? parseFloat(row[amountIndex]) : undefined,
        note: row[noteIndex] || '',
        created_at: row[createdAtIndex] || '',
      }));
  }

  // Office Stock
  async getOfficeStock(): Promise<OfficeStock[]> {
    const rows = await this.readRange('office_stock');
    if (rows.length < 2) return [];
    
    const headers = rows[0];
    const skuIndex = headers.indexOf('sku');
    const qtyIndex = headers.indexOf('qty');
    const updatedAtIndex = headers.indexOf('updated_at');
    
    return rows.slice(1).map(row => ({
      sku: row[skuIndex] || '',
      qty: parseInt(row[qtyIndex] || '0'),
      updated_at: row[updatedAtIndex] || '',
    }));
  }

  async getOfficeStockBySKU(sku: string): Promise<number> {
    const stock = await this.getOfficeStock();
    const item = stock.find(s => s.sku === sku);
    return item ? item.qty : 0;
  }

  async updateOfficeStock(sku: string, qty: number): Promise<void> {
    const rows = await this.readRange('office_stock');
    const headers = rows[0];
    const skuIndex = headers.indexOf('sku');
    const qtyIndex = headers.indexOf('qty');
    const updatedAtIndex = headers.indexOf('updated_at');
    
    const rowIndex = rows.findIndex((row, idx) => idx > 0 && row[skuIndex] === sku);
    
    if (rowIndex > 0) {
      // Update existing
      await this.updateCell('office_stock', rowIndex + 1, qtyIndex + 1, qty);
      await this.updateCell('office_stock', rowIndex + 1, updatedAtIndex + 1, getCurrentTimestamp());
    } else {
      // Create new
      await this.appendRow('office_stock', [
        sku,
        qty,
        getCurrentTimestamp(),
      ]);
    }
  }

  // Manual SKU costs for OFFICE and MARKETPLACE (sheet: sku_costs)
  async getSkuCosts(): Promise<SkuCost[]> {
    const rows = await this.readRange('sku_costs');
    if (rows.length < 2) return [];

    const headers = rows[0];
    const skuIndex = headers.indexOf('sku');
    const costIndex = headers.indexOf('unit_cost_usd');
    const updatedAtIndex = headers.indexOf('updated_at');

    return rows.slice(1).map(row => ({
      sku: row[skuIndex] || '',
      unit_cost_usd: parseFloat(row[costIndex] || '0'),
      updated_at: row[updatedAtIndex] || '',
    }));
  }

  async getSkuCostBySku(sku: string): Promise<number> {
    const costs = await this.getSkuCosts();
    const found = costs.find(c => c.sku === sku);
    return found ? found.unit_cost_usd : 0;
  }

  // Списания с офиса (лист write_offs)
  async createWriteOff(writeOff: WriteOff): Promise<void> {
    await this.appendRow('write_offs', [
      writeOff.write_off_id,
      writeOff.sku,
      writeOff.qty,
      writeOff.comment || '',
      writeOff.created_at,
      writeOff.created_by || 'admin',
    ]);
  }

  // Marketplace stock snapshot (sheet: marketplace_stock)
  async setMarketplaceStock(stock: Map<string, number>): Promise<void> {
    const rows: any[][] = [['sku', 'qty', 'updated_at']];
    const now = getCurrentTimestamp();
    for (const [sku, qty] of stock.entries()) {
      rows.push([sku, qty, now]);
    }

    try {
      // Clear existing data
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: 'marketplace_stock!A:Z',
      });
    } catch (error) {
      console.error('Error clearing marketplace_stock sheet (can be ignored on first run):', error);
    }

    try {
      // Write new snapshot
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'marketplace_stock!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      });
    } catch (error) {
      console.error('Error writing marketplace_stock sheet:', error);
      throw error;
    }
  }

  // Uzum Sales
  async createUzumSale(sale: UzumSale): Promise<void> {
    await this.appendRow('uzum_sales_raw', [
      sale.sale_id || '',
      sale.doc_id || '',
      sale.sold_at,
      sale.sku,
      sale.qty,
      sale.net_revenue_usd,
      sale.raw_json || '',
      sale.created_at || getCurrentTimestamp(),
    ]);
  }

  async getUzumSales(sku?: string, startDate?: string, endDate?: string): Promise<UzumSale[]> {
    const rows = await this.readRange('uzum_sales_raw');
    if (rows.length < 2) return [];
    
    const headers = rows[0];
    const saleIdIndex = headers.indexOf('sale_id');
    const docIdIndex = headers.indexOf('doc_id');
    const soldAtIndex = headers.indexOf('sold_at');
    const skuIndex = headers.indexOf('sku');
    const qtyIndex = headers.indexOf('qty');
    const netRevenueIndex = headers.indexOf('net_revenue_usd');
    const rawJsonIndex = headers.indexOf('raw_json');
    const createdAtIndex = headers.indexOf('created_at');
    
    return rows.slice(1)
      .filter(row => {
        if (sku && row[skuIndex] !== sku) return false;
        if (startDate && row[soldAtIndex] < startDate) return false;
        if (endDate && row[soldAtIndex] > endDate) return false;
        return true;
      })
      .map(row => ({
        sale_id: row[saleIdIndex] || undefined,
        doc_id: row[docIdIndex] || undefined,
        sold_at: row[soldAtIndex] || '',
        sku: row[skuIndex] || '',
        qty: parseInt(row[qtyIndex] || '0'),
        net_revenue_usd: parseFloat(row[netRevenueIndex] || '0'),
        raw_json: row[rawJsonIndex] || undefined,
        created_at: row[createdAtIndex] || undefined,
      }));
  }

  async saleExists(saleId: string, docId?: string): Promise<boolean> {
    const rows = await this.readRange('uzum_sales_raw');
    if (rows.length < 2) return false;
    
    const headers = rows[0];
    const saleIdIndex = headers.indexOf('sale_id');
    const docIdIndex = headers.indexOf('doc_id');
    
    return rows.slice(1).some(row => 
      row[saleIdIndex] === saleId || (docId && row[docIdIndex] === docId)
    );
  }

  // Profit Calculations
  async createProfitCalculation(calc: ProfitCalculation): Promise<void> {
    await this.appendRow('profit_calc', [
      calc.calc_id,
      calc.period_start,
      calc.period_end,
      calc.sku,
      calc.qty_sold,
      calc.net_revenue_usd,
      calc.avg_cogs_usd,
      calc.cogs_total_usd,
      calc.profit_usd,
      calc.created_at,
    ]);
  }

  async getProfitCalculations(periodStart?: string, periodEnd?: string): Promise<ProfitCalculation[]> {
    const rows = await this.readRange('profit_calc');
    if (rows.length < 2) return [];
    
    const headers = rows[0];
    const calcIdIndex = headers.indexOf('calc_id');
    const periodStartIndex = headers.indexOf('period_start');
    const periodEndIndex = headers.indexOf('period_end');
    const skuIndex = headers.indexOf('sku');
    const qtySoldIndex = headers.indexOf('qty_sold');
    const netRevenueIndex = headers.indexOf('net_revenue_usd');
    const avgCogsIndex = headers.indexOf('avg_cogs_usd');
    const cogsTotalIndex = headers.indexOf('cogs_total_usd');
    const profitIndex = headers.indexOf('profit_usd');
    const createdAtIndex = headers.indexOf('created_at');
    
    return rows.slice(1)
      .filter(row => {
        if (periodStart && row[periodStartIndex] < periodStart) return false;
        if (periodEnd && row[periodEndIndex] > periodEnd) return false;
        return true;
      })
      .map(row => ({
        calc_id: row[calcIdIndex] || '',
        period_start: row[periodStartIndex] || '',
        period_end: row[periodEndIndex] || '',
        sku: row[skuIndex] || '',
        qty_sold: parseInt(row[qtySoldIndex] || '0'),
        net_revenue_usd: parseFloat(row[netRevenueIndex] || '0'),
        avg_cogs_usd: parseFloat(row[avgCogsIndex] || '0'),
        cogs_total_usd: parseFloat(row[cogsTotalIndex] || '0'),
        profit_usd: parseFloat(row[profitIndex] || '0'),
        created_at: row[createdAtIndex] || '',
      }));
  }

  // Helper: Get average COGS for SKU from last 3 received POs
  async getAverageCOGS(sku: string): Promise<number> {
    const allPOs = await this.getPurchaseOrders('RECEIVED');
    const items = await Promise.all(
      allPOs.map(po => this.getPurchaseOrderItems(po.po_id))
    );
    
    const relevantItems = items
      .flat()
      .filter(item => item.sku === sku)
      .sort((a, b) => {
        const poA = allPOs.find(po => po.po_id === a.po_id);
        const poB = allPOs.find(po => po.po_id === b.po_id);
        const dateA = poA?.received_at || poA?.created_at || '';
        const dateB = poB?.received_at || poB?.created_at || '';
        return dateB.localeCompare(dateA);
      })
      .slice(0, 3);
    
    if (relevantItems.length === 0) return 0;
    
    const totalCost = relevantItems.reduce((sum, item) => sum + item.unit_cost_usd, 0);
    return totalCost / relevantItems.length;
  }

  // Ideas
  async createIdea(idea: Idea): Promise<void> {
    await this.appendRow('ideas', [
      idea.idea_id,
      idea.idea_text,
      idea.created_at,
      idea.created_by || 'admin',
    ]);
  }

  async getIdeas(): Promise<Idea[]> {
    const rows = await this.readRange('ideas');
    if (rows.length < 2) return [];
    
    const headers = rows[0];
    const ideaIdIndex = headers.indexOf('idea_id');
    const ideaTextIndex = headers.indexOf('idea_text');
    const createdAtIndex = headers.indexOf('created_at');
    const createdByIndex = headers.indexOf('created_by');
    
    return rows.slice(1).map(row => ({
      idea_id: row[ideaIdIndex] || '',
      idea_text: row[ideaTextIndex] || '',
      created_at: row[createdAtIndex] || '',
      created_by: row[createdByIndex] || 'admin',
    }));
  }
}

