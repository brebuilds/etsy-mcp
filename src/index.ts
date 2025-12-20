#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { EtsyClient } from './etsy-client.js';
import { TokenManager } from './token-manager.js';
import { OAuthHandler } from './oauth-handler.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.etsy-mcp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'shops.json');

interface ShopConfig {
  shopId: string;
  shopName: string;
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  pendingCodeVerifier?: string;
  pendingState?: string;
}

interface Config {
  shops: ShopConfig[];
  defaultShopId?: string;
}

class EtsyMCPServer {
  private server: Server;
  private tokenManager: TokenManager;
  private oauthHandler: OAuthHandler;
  private config: Config;

  constructor() {
    this.server = new Server(
      {
        name: 'etsy-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.tokenManager = new TokenManager();
    this.oauthHandler = new OAuthHandler();
    this.config = { shops: [] };

    this.setupHandlers();
  }

  private async loadConfig(): Promise<void> {
    try {
      await fs.mkdir(CONFIG_DIR, { recursive: true });
      const data = await fs.readFile(CONFIG_FILE, 'utf-8');
      this.config = JSON.parse(data);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.config = { shops: [] };
        await this.saveConfig();
      } else {
        throw error;
      }
    }
  }

  private async saveConfig(): Promise<void> {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  private async getClient(shopId?: string): Promise<EtsyClient> {
    await this.loadConfig();
    
    const targetShopId = shopId || this.config.defaultShopId;
    if (!targetShopId) {
      throw new Error('No shop specified and no default shop configured');
    }

    const shop = this.config.shops.find((s) => s.shopId === targetShopId);
    if (!shop) {
      throw new Error(`Shop ${targetShopId} not found`);
    }

    if (!shop.accessToken) {
      throw new Error(`Shop ${targetShopId} is not authenticated. Please run oauth_authenticate first.`);
    }

    // Check if token needs refresh
    if (shop.tokenExpiry && Date.now() >= shop.tokenExpiry - 60000) {
      if (shop.refreshToken) {
        await this.refreshToken(shop);
      } else {
        throw new Error(`Token expired for shop ${targetShopId}. Please re-authenticate.`);
      }
    }

    return new EtsyClient(shop.accessToken);
  }

  private async refreshToken(shop: ShopConfig): Promise<void> {
    const newTokens = await this.oauthHandler.refreshToken(
      shop.clientId,
      shop.clientSecret,
      shop.refreshToken!
    );

    shop.accessToken = newTokens.access_token;
    shop.refreshToken = newTokens.refresh_token;
    shop.tokenExpiry = Date.now() + (newTokens.expires_in * 1000);

    await this.saveConfig();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_shops',
          description: 'List all configured Etsy shops',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'add_shop',
          description: 'Add a new Etsy shop configuration (requires client ID and secret from Etsy Developer Portal)',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Unique identifier for this shop',
              },
              shopName: {
                type: 'string',
                description: 'Display name for the shop',
              },
              clientId: {
                type: 'string',
                description: 'Etsy API client ID',
              },
              clientSecret: {
                type: 'string',
                description: 'Etsy API client secret',
              },
            },
            required: ['shopId', 'shopName', 'clientId', 'clientSecret'],
          },
        },
        {
          name: 'oauth_authenticate',
          description: 'Start OAuth2 authentication flow for a shop. Returns authorization URL.',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID to authenticate',
              },
            },
            required: ['shopId'],
          },
        },
        {
          name: 'oauth_callback',
          description: 'Complete OAuth2 authentication with authorization code',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID',
              },
              code: {
                type: 'string',
                description: 'Authorization code from OAuth callback',
              },
            },
            required: ['shopId', 'code'],
          },
        },
        {
          name: 'set_default_shop',
          description: 'Set the default shop to use when shopId is not specified',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID to set as default',
              },
            },
            required: ['shopId'],
          },
        },
        {
          name: 'get_shop_info',
          description: 'Get information about a shop',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
            },
          },
        },
        {
          name: 'list_listings',
          description: 'List all listings for a shop',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of listings to return (default: 25)',
              },
              offset: {
                type: 'number',
                description: 'Offset for pagination (default: 0)',
              },
            },
          },
        },
        {
          name: 'get_listing',
          description: 'Get details for a specific listing',
          inputSchema: {
            type: 'object',
            properties: {
              listingId: {
                type: 'number',
                description: 'Listing ID',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
            },
            required: ['listingId'],
          },
        },
        {
          name: 'create_listing',
          description: 'Create a new listing with optional custom variations (up to 2 variations supported)',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              quantity: {
                type: 'number',
                description: 'Quantity available (base quantity if variations are used)',
              },
              title: {
                type: 'string',
                description: 'Listing title',
              },
              description: {
                type: 'string',
                description: 'Listing description',
              },
              price: {
                type: 'number',
                description: 'Base price in shop currency',
              },
              whoMade: {
                type: 'string',
                description: 'Who made the item (i_am_making, someone_else, collective)',
                enum: ['i_am_making', 'someone_else', 'collective'],
              },
              whenMade: {
                type: 'string',
                description: 'When the item was made',
              },
              taxonomyId: {
                type: 'number',
                description: 'Taxonomy ID for the listing category',
              },
              variations: {
                type: 'array',
                description: 'Custom variations (up to 2). Use propertyId 513 for first variation, 514 for second.',
                items: {
                  type: 'object',
                  properties: {
                    propertyId: {
                      type: 'number',
                      description: 'Property ID: 513 for first custom variation, 514 for second',
                      enum: [513, 514],
                    },
                    propertyName: {
                      type: 'string',
                      description: 'Name of the variation (e.g., "Size", "Color", "Material")',
                    },
                    values: {
                      type: 'array',
                      description: 'Array of variation values',
                      items: {
                        type: 'object',
                        properties: {
                          value: {
                            type: 'string',
                            description: 'Value name (e.g., "Small", "Red", "Cotton")',
                          },
                          price: {
                            type: 'number',
                            description: 'Optional price override for this specific variation value',
                          },
                        },
                        required: ['value'],
                      },
                    },
                  },
                  required: ['propertyId', 'propertyName', 'values'],
                },
              },
            },
            required: ['quantity', 'title', 'description', 'price', 'whoMade', 'whenMade', 'taxonomyId'],
          },
        },
        {
          name: 'get_listing_inventory',
          description: 'Get inventory details for a listing including variations/products',
          inputSchema: {
            type: 'object',
            properties: {
              listingId: {
                type: 'number',
                description: 'Listing ID',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
            },
            required: ['listingId'],
          },
        },
        {
          name: 'update_listing_inventory',
          description: 'Update inventory for a listing with variations/products. Each product represents a combination of variation values.',
          inputSchema: {
            type: 'object',
            properties: {
              listingId: {
                type: 'number',
                description: 'Listing ID',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              products: {
                type: 'array',
                description: 'Array of products (variation combinations)',
                items: {
                  type: 'object',
                  properties: {
                    sku: {
                      type: 'string',
                      description: 'Optional SKU for this product',
                    },
                    propertyValues: {
                      type: 'array',
                      description: 'Array of property value arrays. Each inner array represents one variation property.',
                      items: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            propertyId: {
                              type: 'number',
                              description: 'Property ID (513 or 514 for custom variations)',
                            },
                            propertyName: {
                              type: 'string',
                              description: 'Property name',
                            },
                            values: {
                              type: 'array',
                              description: 'Array of value strings for this property',
                              items: {
                                type: 'string',
                              },
                            },
                          },
                          required: ['propertyId', 'propertyName', 'values'],
                        },
                      },
                    },
                    offerings: {
                      type: 'array',
                      description: 'Offerings for this product (price and quantity)',
                      items: {
                        type: 'object',
                        properties: {
                          price: {
                            type: 'number',
                            description: 'Price for this product variant',
                          },
                          quantity: {
                            type: 'number',
                            description: 'Quantity available for this product variant',
                          },
                        },
                        required: ['price', 'quantity'],
                      },
                    },
                  },
                  required: ['propertyValues', 'offerings'],
                },
              },
            },
            required: ['listingId', 'products'],
          },
        },
        {
          name: 'get_listing_properties',
          description: 'Get properties/variations for a listing',
          inputSchema: {
            type: 'object',
            properties: {
              listingId: {
                type: 'number',
                description: 'Listing ID',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
            },
            required: ['listingId'],
          },
        },
        {
          name: 'update_listing',
          description: 'Update an existing listing (title, description, price, quantity, tags, materials, state, etc.)',
          inputSchema: {
            type: 'object',
            properties: {
              listingId: {
                type: 'number',
                description: 'Listing ID to update',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              title: {
                type: 'string',
                description: 'New title',
              },
              description: {
                type: 'string',
                description: 'New description',
              },
              price: {
                type: 'number',
                description: 'New price',
              },
              quantity: {
                type: 'number',
                description: 'New quantity',
              },
              tags: {
                type: 'array',
                description: 'Array of tag strings',
                items: { type: 'string' },
              },
              materials: {
                type: 'array',
                description: 'Array of material strings',
                items: { type: 'string' },
              },
              whoMade: {
                type: 'string',
                description: 'Who made the item',
                enum: ['i_am_making', 'someone_else', 'collective'],
              },
              whenMade: {
                type: 'string',
                description: 'When the item was made',
              },
              state: {
                type: 'string',
                description: 'Listing state',
                enum: ['draft', 'active', 'inactive'],
              },
            },
            required: ['listingId'],
          },
        },
        {
          name: 'upload_listing_image',
          description: 'Upload an image to a listing',
          inputSchema: {
            type: 'object',
            properties: {
              listingId: {
                type: 'number',
                description: 'Listing ID',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              imagePath: {
                type: 'string',
                description: 'Path to the image file on disk',
              },
              rank: {
                type: 'number',
                description: 'Image rank/position (optional, 1-10)',
              },
            },
            required: ['listingId', 'imagePath'],
          },
        },
        {
          name: 'delete_listing_image',
          description: 'Delete an image from a listing',
          inputSchema: {
            type: 'object',
            properties: {
              listingId: {
                type: 'number',
                description: 'Listing ID',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              imageId: {
                type: 'number',
                description: 'Image ID to delete',
              },
            },
            required: ['listingId', 'imageId'],
          },
        },
        {
          name: 'list_draft_listings',
          description: 'List all draft listings for a shop',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of listings to return (default: 25)',
              },
              offset: {
                type: 'number',
                description: 'Offset for pagination (default: 0)',
              },
            },
          },
        },
        {
          name: 'publish_listing',
          description: 'Publish a draft listing (change state to active)',
          inputSchema: {
            type: 'object',
            properties: {
              listingId: {
                type: 'number',
                description: 'Listing ID',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
            },
            required: ['listingId'],
          },
        },
        {
          name: 'deactivate_listing',
          description: 'Deactivate a listing (change state to inactive)',
          inputSchema: {
            type: 'object',
            properties: {
              listingId: {
                type: 'number',
                description: 'Listing ID',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
            },
            required: ['listingId'],
          },
        },
        {
          name: 'delete_listing',
          description: 'Delete a listing permanently',
          inputSchema: {
            type: 'object',
            properties: {
              listingId: {
                type: 'number',
                description: 'Listing ID',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
            },
            required: ['listingId'],
          },
        },
        {
          name: 'get_shipping_profiles',
          description: 'Get all shipping profiles for a shop',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
            },
          },
        },
        {
          name: 'get_shop_sections',
          description: 'Get all shop sections (categories)',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
            },
          },
        },
        {
          name: 'create_shop_section',
          description: 'Create a new shop section (category)',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              title: {
                type: 'string',
                description: 'Section title',
              },
            },
            required: ['title'],
          },
        },
        {
          name: 'update_receipt',
          description: 'Update receipt/order status (mark as shipped, paid, add tracking)',
          inputSchema: {
            type: 'object',
            properties: {
              receiptId: {
                type: 'number',
                description: 'Receipt ID',
              },
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              wasShipped: {
                type: 'boolean',
                description: 'Mark as shipped',
              },
              wasPaid: {
                type: 'boolean',
                description: 'Mark as paid',
              },
              trackingCode: {
                type: 'string',
                description: 'Tracking code',
              },
              carrierName: {
                type: 'string',
                description: 'Carrier name (e.g., "USPS", "FedEx")',
              },
            },
            required: ['receiptId'],
          },
        },
        {
          name: 'get_orders',
          description: 'Get orders for a shop',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of orders to return (default: 25)',
              },
              minCreated: {
                type: 'number',
                description: 'Minimum creation timestamp (Unix timestamp)',
              },
              maxCreated: {
                type: 'number',
                description: 'Maximum creation timestamp (Unix timestamp)',
              },
            },
          },
        },
        {
          name: 'get_receipts',
          description: 'Get receipts (order details) for a shop',
          inputSchema: {
            type: 'object',
            properties: {
              shopId: {
                type: 'string',
                description: 'Shop ID (optional, uses default if not provided)',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of receipts to return (default: 25)',
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_shops': {
            await this.loadConfig();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      shops: this.config.shops.map((s) => ({
                        shopId: s.shopId,
                        shopName: s.shopName,
                        isAuthenticated: !!s.accessToken,
                        isDefault: s.shopId === this.config.defaultShopId,
                      })),
                      defaultShopId: this.config.defaultShopId,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          case 'add_shop': {
            await this.loadConfig();
            const { shopId, shopName, clientId, clientSecret } = args as any;
            
            if (this.config.shops.find((s) => s.shopId === shopId)) {
              throw new Error(`Shop ${shopId} already exists`);
            }

            this.config.shops.push({
              shopId,
              shopName,
              clientId,
              clientSecret,
            });

            if (!this.config.defaultShopId) {
              this.config.defaultShopId = shopId;
            }

            await this.saveConfig();
            return {
              content: [
                {
                  type: 'text',
                  text: `Shop ${shopName} (${shopId}) added successfully. Run oauth_authenticate to authenticate.`,
                },
              ],
            };
          }

          case 'oauth_authenticate': {
            await this.loadConfig();
            const { shopId } = args as any;
            const shop = this.config.shops.find((s) => s.shopId === shopId);
            
            if (!shop) {
              throw new Error(`Shop ${shopId} not found`);
            }

            const authData = await this.oauthHandler.getAuthorizationUrl(
              shop.clientId,
              shop.clientSecret
            );

            // Store code verifier and state in shop config
            shop.pendingCodeVerifier = authData.codeVerifier;
            shop.pendingState = authData.state;
            await this.saveConfig();

            return {
              content: [
                {
                  type: 'text',
                  text: `Please visit this URL to authorize:\n\n${authData.url}\n\nAfter authorization, use oauth_callback with the code from the redirect URL.`,
                },
              ],
            };
          }

          case 'oauth_callback': {
            await this.loadConfig();
            const { shopId, code } = args as any;
            const shop = this.config.shops.find((s) => s.shopId === shopId);
            
            if (!shop) {
              throw new Error(`Shop ${shopId} not found`);
            }

            if (!shop.pendingCodeVerifier) {
              throw new Error('No pending OAuth flow found. Please run oauth_authenticate first.');
            }

            const tokens = await this.oauthHandler.exchangeCode(
              shop.clientId,
              shop.clientSecret,
              code,
              shop.pendingCodeVerifier
            );

            shop.accessToken = tokens.access_token;
            shop.refreshToken = tokens.refresh_token;
            shop.tokenExpiry = Date.now() + (tokens.expires_in * 1000);
            
            // Clear pending OAuth data
            delete shop.pendingCodeVerifier;
            delete shop.pendingState;

            await this.saveConfig();
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully authenticated shop ${shop.shopName}`,
                },
              ],
            };
          }

          case 'set_default_shop': {
            await this.loadConfig();
            const { shopId } = args as any;
            
            if (!this.config.shops.find((s) => s.shopId === shopId)) {
              throw new Error(`Shop ${shopId} not found`);
            }

            this.config.defaultShopId = shopId;
            await this.saveConfig();
            return {
              content: [
                {
                  type: 'text',
                  text: `Default shop set to ${shopId}`,
                },
              ],
            };
          }

          case 'get_shop_info': {
            const client = await this.getClient(args?.shopId as string);
            const shopInfo = await client.getShopInfo();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(shopInfo, null, 2),
                },
              ],
            };
          }

          case 'list_listings': {
            const client = await this.getClient(args?.shopId as string);
            const listings = await client.listListings(
              args?.limit as number || 25,
              args?.offset as number || 0
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(listings, null, 2),
                },
              ],
            };
          }

          case 'get_listing': {
            const client = await this.getClient(args?.shopId as string);
            const listing = await client.getListing(args?.listingId as number);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(listing, null, 2),
                },
              ],
            };
          }

          case 'create_listing': {
            const client = await this.getClient(args?.shopId as string);
            const listing = await client.createListing(args as any);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(listing, null, 2),
                },
              ],
            };
          }

          case 'get_orders': {
            const client = await this.getClient(args?.shopId as string);
            const orders = await client.getOrders(args as any);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(orders, null, 2),
                },
              ],
            };
          }

          case 'get_receipts': {
            const client = await this.getClient(args?.shopId as string);
            const receipts = await client.getReceipts(args?.limit as number || 25);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(receipts, null, 2),
                },
              ],
            };
          }

          case 'get_listing_inventory': {
            const client = await this.getClient(args?.shopId as string);
            const inventory = await client.getListingInventory(args?.listingId as number);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(inventory, null, 2),
                },
              ],
            };
          }

          case 'update_listing_inventory': {
            const client = await this.getClient(args?.shopId as string);
            const inventory = await client.updateListingInventory(
              args?.listingId as number,
              args?.products as any
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(inventory, null, 2),
                },
              ],
            };
          }

          case 'get_listing_properties': {
            const client = await this.getClient(args?.shopId as string);
            const properties = await client.getListingProperties(args?.listingId as number);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(properties, null, 2),
                },
              ],
            };
          }

          case 'update_listing': {
            const client = await this.getClient(args?.shopId as string);
            const { listingId, shopId, ...updates } = args as any;
            const updatedListing = await client.updateListing(listingId, updates);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(updatedListing, null, 2),
                },
              ],
            };
          }

          case 'upload_listing_image': {
            const client = await this.getClient(args?.shopId as string);
            const { listingId, imagePath, rank } = args as any;
            const result = await client.uploadListingImage(listingId, imagePath, rank);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'delete_listing_image': {
            const client = await this.getClient(args?.shopId as string);
            const { listingId, imageId } = args as any;
            const result = await client.deleteListingImage(listingId, imageId);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'list_draft_listings': {
            const client = await this.getClient(args?.shopId as string);
            const drafts = await client.listDraftListings(
              args?.limit as number || 25,
              args?.offset as number || 0
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(drafts, null, 2),
                },
              ],
            };
          }

          case 'publish_listing': {
            const client = await this.getClient(args?.shopId as string);
            const result = await client.publishListing(args?.listingId as number);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'deactivate_listing': {
            const client = await this.getClient(args?.shopId as string);
            const result = await client.deactivateListing(args?.listingId as number);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'delete_listing': {
            const client = await this.getClient(args?.shopId as string);
            const result = await client.deleteListing(args?.listingId as number);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'get_shipping_profiles': {
            const client = await this.getClient(args?.shopId as string);
            const profiles = await client.getShippingProfiles();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(profiles, null, 2),
                },
              ],
            };
          }

          case 'get_shop_sections': {
            const client = await this.getClient(args?.shopId as string);
            const sections = await client.getShopSections();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(sections, null, 2),
                },
              ],
            };
          }

          case 'create_shop_section': {
            const client = await this.getClient(args?.shopId as string);
            const section = await client.createShopSection(args?.title as string);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(section, null, 2),
                },
              ],
            };
          }

          case 'update_receipt': {
            const client = await this.getClient(args?.shopId as string);
            const { receiptId, shopId, wasShipped, wasPaid, trackingCode, carrierName, ...rest } = args as any;
            const result = await client.updateReceipt(receiptId, {
              was_shipped: wasShipped,
              was_paid: wasPaid,
              tracking_code: trackingCode,
              carrier_name: carrierName,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'etsy://shops',
          name: 'Configured Shops',
          description: 'List of all configured Etsy shops',
          mimeType: 'application/json',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'etsy://shops') {
        await this.loadConfig();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  shops: this.config.shops.map((s) => ({
                    shopId: s.shopId,
                    shopName: s.shopName,
                    isAuthenticated: !!s.accessToken,
                    isDefault: s.shopId === this.config.defaultShopId,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Etsy MCP server running on stdio');
  }
}

const server = new EtsyMCPServer();
server.run().catch(console.error);

