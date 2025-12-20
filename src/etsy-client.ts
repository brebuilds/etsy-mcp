import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';

const ETSY_API_BASE = 'https://openapi.etsy.com/v3';

export class EtsyClient {
  private client: AxiosInstance;
  private cachedShopId?: number;

  constructor(accessToken: string) {
    this.client = axios.create({
      baseURL: ETSY_API_BASE,
      headers: {
        'x-api-key': accessToken, // Etsy API v3 uses x-api-key header
        'Authorization': `Bearer ${accessToken}`, // Also include Bearer token
      },
    });
  }

  private async getShopId(): Promise<number> {
    if (this.cachedShopId !== undefined) {
      return this.cachedShopId;
    }

    // First get the user's shops
    const response = await this.client.get('/application/users/me');
    const userId = response.data.user_id;

    // Get shops for this user
    const shopsResponse = await this.client.get(`/application/users/${userId}/shops`);
    if (shopsResponse.data.results && shopsResponse.data.results.length > 0) {
      const shopId = shopsResponse.data.results[0].shop_id;
      this.cachedShopId = shopId;
      return shopId;
    }

    throw new Error('No shops found for this user');
  }

  async getShopInfo(): Promise<any> {
    const shopId = await this.getShopId();
    const shopResponse = await this.client.get(`/application/shops/${shopId}`);
    return shopResponse.data;
  }

  async listListings(limit: number = 25, offset: number = 0): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.get(`/application/shops/${shopId}/listings/active`, {
      params: {
        limit,
        offset,
      },
    });

    return response.data;
  }

  async getListing(listingId: number): Promise<any> {
    const response = await this.client.get(`/application/listings/${listingId}`);
    return response.data;
  }

  async createListing(listingData: {
    quantity: number;
    title: string;
    description: string;
    price: number;
    whoMade: string;
    whenMade: string;
    taxonomyId: number;
    variations?: Array<{
      propertyId: number; // 513 or 514 for custom variations
      propertyName: string; // e.g., "Size", "Color"
      values: Array<{
        value: string; // e.g., "Small", "Red"
        price?: number; // Optional price override for this variation
      }>;
    }>;
  }): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.post(`/application/shops/${shopId}/listings`, {
      quantity: listingData.quantity,
      title: listingData.title,
      description: listingData.description,
      price: listingData.price,
      who_made: listingData.whoMade,
      when_made: listingData.whenMade,
      taxonomy_id: listingData.taxonomyId,
      state: 'draft', // Start as draft
      is_supply: false,
      is_customizable: false,
      // Add variations if provided
      ...(listingData.variations && {
        variations: listingData.variations.map((variation) => ({
          property_id: variation.propertyId,
          property_name: variation.propertyName,
          values: variation.values.map((v) => ({
            value: v.value,
            ...(v.price !== undefined && { price: v.price }),
          })),
        })),
      }),
    });

    return response.data;
  }

  async getListingInventory(listingId: number): Promise<any> {
    const response = await this.client.get(`/application/listings/${listingId}/inventory`);
    return response.data;
  }

  async updateListingInventory(
    listingId: number,
    products: Array<{
      sku?: string;
      propertyValues: Array<Array<{
        propertyId: number;
        propertyName: string;
        valueIds?: number[];
        values?: string[];
      }>>;
      offerings: Array<{
        price: number;
        quantity: number;
      }>;
    }>
  ): Promise<any> {
    const response = await this.client.put(`/application/listings/${listingId}/inventory`, {
      products,
    });
    return response.data;
  }

  async getListingProperties(listingId: number): Promise<any> {
    const response = await this.client.get(`/application/listings/${listingId}/properties`);
    return response.data;
  }

  async updateListing(listingId: number, updates: {
    title?: string;
    description?: string;
    price?: number;
    quantity?: number;
    tags?: string[];
    materials?: string[];
    whoMade?: string;
    whenMade?: string;
    state?: 'draft' | 'active' | 'inactive';
  }): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.put(`/application/shops/${shopId}/listings/${listingId}`, updates);
    return response.data;
  }

  async uploadListingImage(listingId: number, imagePath: string, rank?: number): Promise<any> {
    const shopId = await this.getShopId();
    
    const form = new FormData();
    form.append('image', fs.createReadStream(imagePath));
    if (rank !== undefined) {
      form.append('rank', rank.toString());
    }

    const response = await this.client.post(
      `/application/shops/${shopId}/listings/${listingId}/images`,
      form,
      {
        headers: form.getHeaders(),
      }
    );
    return response.data;
  }

  async deleteListingImage(listingId: number, imageId: number): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.delete(
      `/application/shops/${shopId}/listings/${listingId}/images/${imageId}`
    );
    return response.data;
  }

  async listDraftListings(limit: number = 25, offset: number = 0): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.get(`/application/shops/${shopId}/listings/draft`, {
      params: {
        limit,
        offset,
      },
    });
    return response.data;
  }

  async publishListing(listingId: number): Promise<any> {
    return this.updateListing(listingId, { state: 'active' });
  }

  async deactivateListing(listingId: number): Promise<any> {
    return this.updateListing(listingId, { state: 'inactive' });
  }

  async deleteListing(listingId: number): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.delete(`/application/shops/${shopId}/listings/${listingId}`);
    return response.data;
  }

  async getShippingProfiles(): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.get(`/application/shops/${shopId}/shipping-profiles`);
    return response.data;
  }

  async getShopSections(): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.get(`/application/shops/${shopId}/sections`);
    return response.data;
  }

  async createShopSection(title: string): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.post(`/application/shops/${shopId}/sections`, {
      title,
    });
    return response.data;
  }

  async updateReceipt(receiptId: number, updates: {
    was_shipped?: boolean;
    was_paid?: boolean;
    tracking_code?: string;
    carrier_name?: string;
  }): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.put(`/application/shops/${shopId}/receipts/${receiptId}`, updates);
    return response.data;
  }

  async getOrders(params?: {
    limit?: number;
    minCreated?: number;
    maxCreated?: number;
  }): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.get(`/application/shops/${shopId}/receipts`, {
      params: {
        limit: params?.limit || 25,
        min_created: params?.minCreated,
        max_created: params?.maxCreated,
      },
    });

    return response.data;
  }

  async getReceipts(limit: number = 25): Promise<any> {
    const shopId = await this.getShopId();
    const response = await this.client.get(`/application/shops/${shopId}/receipts`, {
      params: {
        limit,
      },
    });

    return response.data;
  }
}

