/**
 * Shared Type Declarations for TREE Warehouse Logistics
 */

export interface CatalogItem {
  barcode: string;
  product_name: string;
  system_qty: number;
  image_url: string;
  regular_price?: number | null;
  offer_price?: number | null;
}

export interface InventoryItem {
  id?: number;
  barcode: string;
  location_id: string;
  quantity: number;
}

export interface LocationItem {
  location_id: string;
}

export interface OrderLineItem {
  sku: string;
  itemName?: string;
  quantity: number;
}

export interface OrderItem {
  order_id: string;
  customer_name?: string;
  status: "PENDING" | "pending" | "COMPLETED" | "completed";
  items: OrderLineItem[];
}

export interface ActivityLog {
  id?: number;
  action: string;
  details: string;
  created_at?: string;
  timestamp?: string;
}

export interface UserSession {
  username: string;
  role: "admin" | "branch_employee";
  branch: string | null;
  ts: number;
}
