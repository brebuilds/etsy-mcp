import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { EtsyClient } from '../src/etsy-client.js';

// EtsyClient calls axios.create() once in its constructor and then talks to
// the returned instance. Mock axios.create to always hand back the same
// fake instance so tests can assert on the calls made against it, without
// ever making a real HTTP request.
const instance = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => instance),
  },
}));

function freshClient(): EtsyClient {
  instance.get.mockReset();
  instance.post.mockReset();
  instance.put.mockReset();
  instance.delete.mockReset();
  return new EtsyClient('fake-access-token');
}

/** Wires up the two calls getShopId() makes so it resolves to `shopId`. */
function mockShopIdLookup(shopId: number) {
  instance.get.mockImplementation((url: string) => {
    if (url === '/application/users/me') {
      return Promise.resolve({ data: { user_id: 42 } });
    }
    if (url === '/application/users/42/shops') {
      return Promise.resolve({ data: { results: [{ shop_id: shopId }] } });
    }
    return Promise.resolve({ data: {} });
  });
}

describe('EtsyClient shop id resolution / caching', () => {
  it('resolves the shop id via /users/me then /users/{id}/shops', async () => {
    const client = freshClient();
    mockShopIdLookup(555);

    await client.getShopInfo();

    expect(instance.get).toHaveBeenNthCalledWith(1, '/application/users/me');
    expect(instance.get).toHaveBeenNthCalledWith(2, '/application/users/42/shops');
    expect(instance.get).toHaveBeenNthCalledWith(3, '/application/shops/555');
  });

  it('caches the shop id — a second call does not repeat the lookup', async () => {
    const client = freshClient();
    mockShopIdLookup(555);

    await client.getShopInfo();
    await client.getShopInfo();

    // 2 lookup calls + 2 getShopInfo calls = 4, not 6
    expect(instance.get).toHaveBeenCalledTimes(4);
  });

  it('throws a clear error when the user has no shops', async () => {
    const client = freshClient();
    instance.get.mockImplementation((url: string) => {
      if (url === '/application/users/me') return Promise.resolve({ data: { user_id: 42 } });
      if (url === '/application/users/42/shops') return Promise.resolve({ data: { results: [] } });
      return Promise.resolve({ data: {} });
    });

    await expect(client.getShopInfo()).rejects.toThrow('No shops found for this user');
  });
});

describe('EtsyClient listing pagination', () => {
  it('defaults limit=25 and offset=0 when listing active listings', async () => {
    const client = freshClient();
    mockShopIdLookup(555);
    instance.get.mockImplementation((url: string) => {
      if (url === '/application/users/me') return Promise.resolve({ data: { user_id: 42 } });
      if (url === '/application/users/42/shops') return Promise.resolve({ data: { results: [{ shop_id: 555 }] } });
      return Promise.resolve({ data: { results: [] } });
    });

    await client.listListings();

    expect(instance.get).toHaveBeenLastCalledWith('/application/shops/555/listings/active', {
      params: { limit: 25, offset: 0 },
    });
  });

  it('passes through a custom limit/offset for pagination', async () => {
    const client = freshClient();
    mockShopIdLookup(555);

    await client.listListings(10, 20);

    expect(instance.get).toHaveBeenLastCalledWith('/application/shops/555/listings/active', {
      params: { limit: 10, offset: 20 },
    });
  });

  it('applies the same default pagination to draft listings', async () => {
    const client = freshClient();
    mockShopIdLookup(555);

    await client.listDraftListings();

    expect(instance.get).toHaveBeenLastCalledWith('/application/shops/555/listings/draft', {
      params: { limit: 25, offset: 0 },
    });
  });
});

describe('EtsyClient request building', () => {
  beforeEach(() => {
    instance.get.mockReset();
    instance.post.mockReset();
    instance.put.mockReset();
    instance.delete.mockReset();
  });

  it('builds a single-listing GET by id without needing the shop id', async () => {
    const client = freshClient();
    instance.get.mockResolvedValue({ data: { listing_id: 999 } });

    await client.getListing(999);

    expect(instance.get).toHaveBeenCalledWith('/application/listings/999');
  });

  it('maps createListing camelCase fields to the snake_case Etsy API body, and defaults to draft', async () => {
    const client = freshClient();
    mockShopIdLookup(555);
    instance.post.mockResolvedValue({ data: { listing_id: 1 } });

    await client.createListing({
      quantity: 5,
      title: 'A Mug',
      description: 'desc',
      price: 25,
      whoMade: 'i_am_making',
      whenMade: '2024_2024',
      taxonomyId: 69150467,
    });

    expect(instance.post).toHaveBeenCalledWith('/application/shops/555/listings', {
      quantity: 5,
      title: 'A Mug',
      description: 'desc',
      price: 25,
      who_made: 'i_am_making',
      when_made: '2024_2024',
      taxonomy_id: 69150467,
      state: 'draft',
      is_supply: false,
      is_customizable: false,
    });
  });

  it('maps variation property ids/values, including an optional per-value price override', async () => {
    const client = freshClient();
    mockShopIdLookup(555);
    instance.post.mockResolvedValue({ data: { listing_id: 1 } });

    await client.createListing({
      quantity: 10,
      title: 'A Shirt',
      description: 'desc',
      price: 20,
      whoMade: 'i_am_making',
      whenMade: '2024_2024',
      taxonomyId: 1,
      variations: [
        {
          propertyId: 513,
          propertyName: 'Size',
          values: [{ value: 'Small' }, { value: 'Large', price: 22 }],
        },
      ],
    });

    const body = instance.post.mock.calls[0][1];
    expect(body.variations).toEqual([
      {
        property_id: 513,
        property_name: 'Size',
        values: [{ value: 'Small' }, { value: 'Large', price: 22 }],
      },
    ]);
  });

  it('sends only the given fields on a partial update_listing call', async () => {
    const client = freshClient();
    mockShopIdLookup(555);
    instance.put.mockResolvedValue({ data: {} });

    await client.updateListing(123, { price: 29.99, quantity: 10 });

    expect(instance.put).toHaveBeenCalledWith('/application/shops/555/listings/123', {
      price: 29.99,
      quantity: 10,
    });
  });

  it('publishListing sets state=active via updateListing', async () => {
    const client = freshClient();
    mockShopIdLookup(555);
    instance.put.mockResolvedValue({ data: {} });

    await client.publishListing(123);

    expect(instance.put).toHaveBeenCalledWith('/application/shops/555/listings/123', { state: 'active' });
  });

  it('deactivateListing sets state=inactive via updateListing', async () => {
    const client = freshClient();
    mockShopIdLookup(555);
    instance.put.mockResolvedValue({ data: {} });

    await client.deactivateListing(123);

    expect(instance.put).toHaveBeenCalledWith('/application/shops/555/listings/123', { state: 'inactive' });
  });

  it('deleteListing issues a DELETE against the shop-scoped listing URL', async () => {
    const client = freshClient();
    mockShopIdLookup(555);
    instance.delete.mockResolvedValue({ data: {} });

    await client.deleteListing(123);

    expect(instance.delete).toHaveBeenCalledWith('/application/shops/555/listings/123');
  });

  it('getOrders maps minCreated/maxCreated to min_created/max_created and defaults limit to 25', async () => {
    const client = freshClient();
    mockShopIdLookup(555);
    instance.get.mockImplementation((url: string) => {
      if (url === '/application/users/me') return Promise.resolve({ data: { user_id: 42 } });
      if (url === '/application/users/42/shops') return Promise.resolve({ data: { results: [{ shop_id: 555 }] } });
      return Promise.resolve({ data: { results: [] } });
    });

    await client.getOrders({ minCreated: 100, maxCreated: 200 });

    expect(instance.get).toHaveBeenLastCalledWith('/application/shops/555/receipts', {
      params: { limit: 25, min_created: 100, max_created: 200 },
    });
  });

  it('getReceipts defaults limit to 25 and honors a custom limit', async () => {
    const client = freshClient();
    mockShopIdLookup(555);

    await client.getReceipts();
    expect(instance.get).toHaveBeenLastCalledWith('/application/shops/555/receipts', { params: { limit: 25 } });

    await client.getReceipts(5);
    expect(instance.get).toHaveBeenLastCalledWith('/application/shops/555/receipts', { params: { limit: 5 } });
  });

  it('updateReceipt maps camelCase args to the snake_case Etsy fields', async () => {
    const client = freshClient();
    mockShopIdLookup(555);
    instance.put.mockResolvedValue({ data: {} });

    await client.updateReceipt(789, {
      was_shipped: true,
      was_paid: true,
      tracking_code: '1Z999',
      carrier_name: 'UPS',
    });

    expect(instance.put).toHaveBeenCalledWith('/application/shops/555/receipts/789', {
      was_shipped: true,
      was_paid: true,
      tracking_code: '1Z999',
      carrier_name: 'UPS',
    });
  });

  it('createShopSection posts the given title to the shop-scoped sections endpoint', async () => {
    const client = freshClient();
    mockShopIdLookup(555);
    instance.post.mockResolvedValue({ data: {} });

    await client.createShopSection('Holiday Collection');

    expect(instance.post).toHaveBeenCalledWith('/application/shops/555/sections', {
      title: 'Holiday Collection',
    });
  });
});
