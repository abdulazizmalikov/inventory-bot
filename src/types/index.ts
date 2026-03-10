// Warehouse types
export type Warehouse = 'IN_TRANSIT' | 'OFFICE' | 'MARKETPLACE';
export type Marketplace = 'UZUM' | 'YANDEX' | 'NONE';
export type MovementType = 'PO_CREATE' | 'PO_RECEIVE' | 'SHIP' | 'RETURN' | 'OFFICE_ADD';
export type POStatus = 'IN_TRANSIT' | 'RECEIVED';

// Entity types
export interface SKU {
  sku: string;
  active: boolean;
  created_at?: string;
  created_by?: string;
}

export interface Supplier {
  supplier_id: string;
  supplier_name: string;
  contacts?: string;
  created_at?: string;
  created_by?: string;
}

export interface PurchaseOrder {
  po_id: string;
  order_name: string; // Название заказа (вводит пользователь)
  supplier_id: string;
  order_amount_usd: number;
  shipping_cost_usd: number;
  total_amount_usd: number;
  total_qty: number;
  unit_cost_usd: number;
  status: POStatus;
  created_at: string;
  received_at?: string;
  created_by?: string;
}

export interface PurchaseOrderItem {
  po_id: string;
  sku: string;
  qty: number;
  unit_cost_usd: number;
  created_at?: string;
}

export interface Movement {
  move_id: string;
  type: MovementType;
  source: Warehouse | 'NONE';
  destination: Warehouse | 'NONE';
  marketplace: Marketplace;
  sku: string;
  qty: number;
  unit_cost_usd?: number;
  amount_usd?: number;
  note?: string;
  created_at: string;
  created_by?: string;
}

export interface OfficeStock {
  sku: string;
  qty: number;
  updated_at: string;
}

// Manual SKU costs for OFFICE and MARKETPLACE warehouses
export interface SkuCost {
  sku: string;
  unit_cost_usd: number;
  updated_at: string;
}

export interface UzumSale {
  sale_id?: string;
  doc_id?: string;
  sold_at: string;
  sku: string;
  qty: number;
  net_revenue_usd: number;
  raw_json?: string;
  created_at?: string;
}

export interface ProfitCalculation {
  calc_id: string;
  period_start: string;
  period_end: string;
  sku: string;
  qty_sold: number;
  net_revenue_usd: number;
  avg_cogs_usd: number;
  cogs_total_usd: number;
  profit_usd: number;
  created_at: string;
}

// API types
export interface UzumStockResponse {
  sku: string;
  qty: number;
  [key: string]: any;
}

export interface UzumSalesResponse {
  sales: Array<{
    article: string; // SKU
    sold_at: string;
    qty: number;
    net_revenue_usd: number;
    [key: string]: any;
  }>;
  [key: string]: any;
}

// Bot state types
export interface OrderCreationState {
  step: 'supplier' | 'items' | 'amounts' | 'confirm';
  supplier_id?: string;
  supplier_name?: string;
  items: Array<{ sku: string; qty: number }>;
  order_amount_usd?: number;
  shipping_cost_usd?: number;
}

export interface ShipmentState {
  step: 'sku' | 'qty' | 'comment' | 'confirm';
  sku?: string;
  qty?: number;
  comment?: string;
}

export interface ReturnState {
  step: 'marketplace' | 'sku' | 'qty' | 'confirm';
  marketplace?: Marketplace;
  sku?: string;
  qty?: number;
}

export interface Idea {
  idea_id: string;
  idea_text: string;
  created_at: string;
  created_by?: string;
}

/** Списание с офиса (отправка / расход) — учёт в листе write_offs */
export interface WriteOff {
  write_off_id: string;
  sku: string;
  qty: number;
  comment: string;
  created_at: string;
  created_by?: string;
}

