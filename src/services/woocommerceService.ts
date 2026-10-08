export interface WooOrderBilling {
  first_name: string;
  last_name: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface WooOrderShipping {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  phone?: string;
}

export interface WooOrderLineItem {
  id: number;
  name: string;
  product_id: number;
  variation_id?: number;
  quantity: number;
  subtotal: string;
  total: string;
  price: number;
  sku?: string;
  meta_data?: Array<{ key: string; value: any; display_key?: string; display_value?: any }>;
  image?: { id: string | number; src: string };
  parent_name?: string | null;
}

export interface WooOrderMeta {
  id?: number;
  key: string;
  value: any;
}

export interface WooOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  currency_symbol?: string;
  date_created: string;
  date_modified?: string;
  total: string;
  total_tax: string;
  shipping_total: string;
  payment_method: string;
  payment_method_title: string;
  transaction_id?: string;
  customer_note?: string;
  billing: WooOrderBilling;
  shipping: WooOrderShipping;
  line_items: WooOrderLineItem[];
  meta_data: WooOrderMeta[];
  payment_url?: string;
}

export interface WooBrand {
  id: number;
  name: string;
  slug: string;
  count: number;
  description?: string;
  image?: { id?: number; src: string } | null;
}

export interface WooProduct {
  id: number;
  name: string;
  slug: string;
  permalink?: string;
  sku?: string;
  price: string;
  regular_price?: string;
  sale_price?: string;
  on_sale?: boolean;
  stock_status: 'instock' | 'outofstock' | 'onbackorder' | string;
  stock_quantity: number | null;
  manage_stock?: boolean;
  images?: Array<{ id: number; src: string; alt?: string }>;
  attributes?: Array<{ id: number; name: string; slug: string; options: string[] }>;
  meta_data?: Array<{ key: string; value: any }>;
}

export interface WooSalesReportTotalsDay {
  sales: string;
  orders: number;
  items: number;
  tax: string;
  shipping: string;
  discount: string;
}

export interface WooSalesReport {
  total_sales: string;
  net_sales: string;
  average_sales: string;
  total_orders: number;
  total_items: number;
  total_tax: string;
  total_shipping: string;
  total_discount: string;
  totals?: Record<string, WooSalesReportTotalsDay>;
}

export interface WooCustomerAnalytics {
  id: number;
  user_id: number;
  username: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  city: string;
  country: string;
  orders_count: number;
  total_spend: number;
  avg_order_value: number;
  date_last_order: string | null;
}

export class WooCommerceService {
  private baseUrl: string;
  private authHeader: string;

  constructor(url: string, consumerKey: string, consumerSecret: string) {
    this.baseUrl = url.replace(/\/+$/, '');
    const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
  }

  private async requestWithResponse<T>(endpoint: string, options: RequestInit = {}): Promise<{ data: T; response: Response }> {
    const url = `${this.baseUrl}/wp-json/wc/v3${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'WooCommerce-Telegram-Manager/1.0',
      ...(options.headers || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
      redirect: 'manual', // maxRedirects: 0 to prevent SSRF via open redirects
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        `WooCommerce API redirected with status ${response.status}. Redirects are disallowed for SSRF protection.`
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `WooCommerce API Error (${response.status}): ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.message) {
          errorMessage = `WooCommerce Error: ${errorJson.message}`;
        }
      } catch {
        if (errorText) errorMessage += ` - ${errorText.slice(0, 150)}`;
      }
      throw new Error(errorMessage);
    }

    const data = (await response.json()) as T;
    return { data, response };
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const { data } = await this.requestWithResponse<T>(endpoint, options);
    return data;
  }

  /**
   * Get orders list
   */
  async getOrders(params?: { status?: string; per_page?: number; page?: number; search?: string }): Promise<WooOrder[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.per_page) query.set('per_page', params.per_page.toString());
    if (params?.page) query.set('page', params.page.toString());
    if (params?.search) query.set('search', params.search);

    const queryString = query.toString();
    return this.request<WooOrder[]>(`/orders${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Get single order by ID
   */
  async getOrder(orderId: number | string): Promise<WooOrder> {
    return this.request<WooOrder>(`/orders/${orderId}`);
  }

  /**
   * Update order status
   */
  async updateOrderStatus(orderId: number | string, status: string): Promise<WooOrder> {
    return this.request<WooOrder>(`/orders/${orderId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }

  /**
   * List existing webhooks in WooCommerce
   */
  async getWebhooks(): Promise<any[]> {
    return this.request<any[]>('/webhooks');
  }

  /**
   * Create a webhook in WooCommerce with per-store secret
   */
  async createWebhook(data: { name: string; topic: string; delivery_url: string; secret?: string; status?: string }): Promise<any> {
    const payload: Record<string, any> = {
      name: data.name,
      topic: data.topic,
      delivery_url: data.delivery_url,
      status: data.status || 'active',
    };
    if (data.secret) {
      payload.secret = data.secret;
    }
    return this.request<any>('/webhooks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Delete a webhook in WooCommerce
   */
  async deleteWebhook(webhookId: number | string): Promise<any> {
    return this.request<any>(`/webhooks/${webhookId}?force=true`, {
      method: 'DELETE',
    });
  }

  /**
   * Test connection to WooCommerce REST API
   */
  async testConnection(): Promise<boolean> {
    await this.request<any>('/orders?per_page=1');
    return true;
  }

  /**
   * Get brands taxonomy list
   */
  async getBrands(params?: { per_page?: number; page?: number; search?: string }): Promise<WooBrand[]> {
    const query = new URLSearchParams();
    query.set('per_page', (params?.per_page || 100).toString());
    if (params?.page) query.set('page', params.page.toString());
    if (params?.search) query.set('search', params.search);

    const queryString = query.toString();
    return this.request<WooBrand[]>(`/products/brands${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Get products by brand ID
   */
  async getProductsByBrand(brandId: number, params?: { per_page?: number; page?: number }): Promise<WooProduct[]> {
    const query = new URLSearchParams();
    query.set('brand', brandId.toString());
    query.set('per_page', (params?.per_page || 20).toString());
    if (params?.page) query.set('page', params.page.toString());

    return this.request<WooProduct[]>(`/products?${query.toString()}`);
  }

  /**
   * Get single product by ID
   */
  async getProduct(productId: number | string): Promise<WooProduct> {
    return this.request<WooProduct>(`/products/${productId}`);
  }

  /**
   * Search products by keyword, SKU or name
   * Returns products array and total found count from WooCommerce headers
   */
  async searchProducts(
    search: string,
    params?: { per_page?: number; page?: number }
  ): Promise<{ products: WooProduct[]; total: number }> {
    const query = new URLSearchParams();
    query.set('search', search);
    query.set('per_page', (params?.per_page || 30).toString());
    if (params?.page) query.set('page', params.page.toString());
    const { data, response } = await this.requestWithResponse<WooProduct[]>(`/products?${query.toString()}`);
    const total = parseInt(response.headers.get('x-wp-total') || `${data.length}`, 10);
    return { products: data, total };
  }

  /**
   * Get sales reports with support for period or custom date range (date_min & date_max)
   */
  async getSalesReports(params?: {
    period?: string;
    date_min?: string;
    date_max?: string;
  }): Promise<WooSalesReport[]> {
    const query = new URLSearchParams();
    if (params?.date_min && params?.date_max) {
      query.set('date_min', params.date_min);
      query.set('date_max', params.date_max);
    } else if (params?.period) {
      query.set('period', params.period);
    } else {
      query.set('period', 'month');
    }
    return this.request<WooSalesReport[]>(`/reports/sales?${query.toString()}`);
  }

  /**
   * Get top customers by spend for all-time, last 6 months, last 1 year, or specific year
   */
  async getTopCustomers(params?: {
    per_page?: number;
    period?: 'all' | '6m' | '1y' | 'last_year' | string;
  }): Promise<WooCustomerAnalytics[]> {
    const query = new URLSearchParams();
    query.set('per_page', (params?.per_page || 10).toString());
    query.set('orderby', 'total_spend');
    query.set('order', 'desc');

    const now = new Date();
    const currentYear = now.getFullYear();

    if (params?.period === '6m') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 6);
      query.set('last_order_after', `${d.toISOString().slice(0, 10)}T00:00:00`);
    } else if (params?.period === '1y' || params?.period === 'year') {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      query.set('last_order_after', `${d.toISOString().slice(0, 10)}T00:00:00`);
    } else if (params?.period === 'last_year') {
      const lastYear = currentYear - 1;
      query.set('last_order_after', `${lastYear}-01-01T00:00:00`);
      query.set('last_order_before', `${lastYear}-12-31T23:59:59`);
    } else if (params?.period && /^\d{4}$/.test(params.period)) {
      const yr = parseInt(params.period, 10);
      query.set('last_order_after', `${yr}-01-01T00:00:00`);
      query.set('last_order_before', `${yr}-12-31T23:59:59`);
    }

    return this.request<WooCustomerAnalytics[]>(`/../../wc-analytics/reports/customers?${query.toString()}`);
  }
}

