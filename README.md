# Etsy MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives an AI
assistant (Claude, Cursor, or any MCP-compatible client) direct, tool-based access to
the [Etsy Open API v3](https://developers.etsy.com/documentation/) — listing
management, inventory/variations, orders and receipts, and shop configuration — across
one or more Etsy shops. Authentication is handled with a hand-rolled OAuth2
Authorization Code + PKCE flow and automatic token refresh, so the assistant can keep
working across a session without the user re-authorizing by hand.

25 tools are exposed today (see the [tool table](#tools) below), covering everything
from `list_listings` to inventory/variation management to order fulfillment.

## Architecture

**Three small modules, one job each:**

| Module | Responsibility |
|---|---|
| `src/oauth-handler.ts` | PKCE generation, the Etsy authorization URL, and the authorization-code / refresh-token token exchanges |
| `src/token-manager.ts` | Token-expiry logic — decides *when* a stored token needs refreshing |
| `src/etsy-client.ts` | A thin wrapper over the Etsy REST API (listings, inventory, orders, shop sections, receipts) |
| `src/index.ts` | The MCP server itself — declares the 25 tools, dispatches tool calls, and owns per-shop config/token storage |

### OAuth2 + PKCE flow

Etsy's OAuth implementation requires PKCE (Proof Key for Code Exchange, [RFC
7636](https://www.rfc-editor.org/rfc/rfc7636)) even for confidential clients, and this
server targets the out-of-band redirect (`urn:ietf:wg:oauth:2.0:oob`) so it works from a
CLI/MCP context with no local callback server to run.

1. **`oauth_authenticate`** — `OAuthHandler.getAuthorizationUrl()` generates a random
   43-character `code_verifier` (`crypto.randomBytes(32)`, base64url-encoded), derives
   the `code_challenge` as `base64url(SHA-256(code_verifier))`, and returns an
   authorization URL carrying that challenge plus a random `state`. The verifier and
   state are stashed on the shop's config entry (`pendingCodeVerifier` /
   `pendingState`) so they survive the round trip to Etsy's consent screen and back.
2. The user visits the URL, approves the app, and Etsy redirects to the OOB endpoint
   with an authorization `code`.
3. **`oauth_callback`** — the code, together with the *original* `code_verifier`, is
   exchanged for an access token + refresh token via `OAuthHandler.exchangeCode()`.
   Etsy verifies the verifier hashes to the challenge it was given in step 1, which is
   what makes PKCE useful here: a code intercepted in transit is useless without the
   verifier that only this process holds.
4. Tokens (plus the computed expiry timestamp) are written to
   `~/.etsy-mcp/shops.json`, one entry per configured shop.

### Automatic token refresh

Every tool call that talks to the Etsy API goes through `EtsyMCPServer.getClient()`,
which checks `TokenManager.isExpiredOrNeedsRefresh()` before handing back a client. That
check compares `Date.now()` against `tokenExpiry - 60s` — refreshing a little *before*
actual expiry avoids a request landing right on the boundary and failing mid-flight. If
refresh is needed and a refresh token is on hand, `OAuthHandler.refreshToken()` exchanges
it for a new access/refresh token pair and the config is rewritten; if there's no refresh
token, the tool call fails with a clear "please re-authenticate" error rather than a raw
HTTP 401 from Etsy.

### Multi-shop support

Shop configuration, credentials, and tokens are keyed by a caller-chosen `shopId` and
stored together in `~/.etsy-mcp/shops.json`. Every listing/order/inventory tool accepts
an optional `shopId`; when omitted, it falls back to whichever shop was set via
`set_default_shop`. Each shop keeps its own client credentials and token lifecycle, so
authenticating one shop never touches another's tokens.

## Prerequisites

- Node.js 18.0.0 or higher
- npm
- Etsy API credentials (Client ID and Client Secret) from the
  [Etsy Developer Portal](https://www.etsy.com/developers/)

## Installation

1. Clone or download this repository
2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Tests

38 [vitest](https://vitest.dev) unit tests, all passing, covering:

- PKCE code-verifier/code-challenge generation (length, charset, RFC 7636 S256
  correctness) and authorization-URL construction
- Token-expiry boundary conditions in `TokenManager.isExpiredOrNeedsRefresh()`
- Request-building in `EtsyClient` — shop-id resolution/caching, pagination defaults,
  camelCase→snake_case body mapping, variation/price-override handling

No real HTTP requests are made — `axios` is mocked at the module boundary. Run them
with:

```bash
npm test
```

## Configuration

### Setting Up Etsy API Credentials

1. Go to the [Etsy Developer Portal](https://www.etsy.com/developers/)
2. Create a new app or use an existing one
3. Note your **Client ID** and **Client Secret**
4. Set the redirect URI to `urn:ietf:wg:oauth:2.0:oob` (for out-of-band OAuth)

### Adding a Shop

Use the MCP tools to add shops:

1. **Add a shop configuration:**
   ```
   add_shop({
     shopId: "my-shop-1",
     shopName: "My First Shop",
     clientId: "YOUR_CLIENT_ID",
     clientSecret: "YOUR_CLIENT_SECRET"
   })
   ```

2. **Authenticate the shop:**
   ```
   oauth_authenticate({ shopId: "my-shop-1" })
   ```
   This will return an authorization URL. Visit it in your browser and authorize the app.

3. **Complete authentication:**
   ```
   oauth_callback({
     shopId: "my-shop-1",
     code: "authorization-code-from-url"
   })
   ```

4. **Set as default (optional):**
   ```
   set_default_shop({ shopId: "my-shop-1" })
   ```

### Adding Multiple Shops

You can add multiple shops by repeating the process above with different `shopId` values. Each shop can have its own Etsy account credentials.

**Note:** Etsy requires each shop to be associated with a unique Etsy account and email address. You'll need separate API credentials for each shop if they're on different accounts.

## Tools

### Shop Management
| Tool | Description |
|---|---|
| `list_shops` | List all configured shops |
| `add_shop` | Add a new shop configuration |
| `oauth_authenticate` | Start OAuth2 authentication flow for a shop; returns an authorization URL |
| `oauth_callback` | Complete OAuth2 authentication with the authorization code |
| `set_default_shop` | Set the default shop used when `shopId` is omitted |

### Shop Information
| Tool | Description |
|---|---|
| `get_shop_info` | Get information about a shop |

### Listings
| Tool | Description |
|---|---|
| `list_listings` | List all active listings for a shop |
| `list_draft_listings` | List all draft listings for a shop |
| `get_listing` | Get details for a specific listing |
| `create_listing` | Create a new listing with optional custom variations (up to 2), starts as draft |
| `update_listing` | Update title, description, price, quantity, tags, materials, state, etc. |
| `publish_listing` | Publish a draft listing (state → active) |
| `deactivate_listing` | Deactivate a listing (state → inactive) |
| `delete_listing` | Delete a listing permanently |
| `get_listing_inventory` | Get inventory details, including variations/products |
| `update_listing_inventory` | Update inventory with variations/products |
| `get_listing_properties` | Get properties/variations for a listing |
| `upload_listing_image` | Upload an image to a listing |
| `delete_listing_image` | Delete an image from a listing |

### Shop Organization
| Tool | Description |
|---|---|
| `get_shop_sections` | Get all shop sections (categories) |
| `create_shop_section` | Create a new shop section (category) |
| `get_shipping_profiles` | Get all shipping profiles for a shop |

### Orders & Fulfillment
| Tool | Description |
|---|---|
| `get_orders` | Get orders for a shop |
| `get_receipts` | Get receipts (order details) for a shop |
| `update_receipt` | Update receipt/order status (shipped, paid, tracking) |

### Example Usage

```javascript
// List all shops
list_shops()

// Get shop information (uses default shop)
get_shop_info()

// Get shop information for a specific shop
get_shop_info({ shopId: "my-shop-1" })

// List listings
list_listings({ limit: 50, offset: 0 })

// Get a specific listing
get_listing({ listingId: 123456789 })

// Create a new listing
create_listing({
  quantity: 5,
  title: "Handmade Ceramic Mug",
  description: "A beautiful handmade ceramic mug...",
  price: 25.00,
  whoMade: "i_am_making",
  whenMade: "2024_2024",
  taxonomyId: 69150467  // You'll need to find the correct taxonomy ID
})

// Create a listing with custom variations (e.g., Size and Color)
create_listing({
  quantity: 10,
  title: "Custom T-Shirt",
  description: "A custom t-shirt with multiple options...",
  price: 20.00,
  whoMade: "i_am_making",
  whenMade: "2024_2024",
  taxonomyId: 69150467,
  variations: [
    {
      propertyId: 513,  // First custom variation (use 514 for second)
      propertyName: "Size",
      values: [
        { value: "Small" },
        { value: "Medium" },
        { value: "Large", price: 22.00 }  // Optional price override
      ]
    },
    {
      propertyId: 514,  // Second custom variation
      propertyName: "Color",
      values: [
        { value: "Red" },
        { value: "Blue" },
        { value: "Green" }
      ]
    }
  ]
})

// Get inventory with variations
get_listing_inventory({ listingId: 123456789 })

// Update inventory for variations
// Each product represents a combination of variation values
update_listing_inventory({
  listingId: 123456789,
  products: [
    {
      sku: "TSHIRT-SM-RED",
      propertyValues: [
        [{ propertyId: 513, propertyName: "Size", values: ["Small"] }],
        [{ propertyId: 514, propertyName: "Color", values: ["Red"] }]
      ],
      offerings: [{ price: 20.00, quantity: 5 }]
    },
    {
      sku: "TSHIRT-M-BLUE",
      propertyValues: [
        [{ propertyId: 513, propertyName: "Size", values: ["Medium"] }],
        [{ propertyId: 514, propertyName: "Color", values: ["Blue"] }]
      ],
      offerings: [{ price: 20.00, quantity: 3 }]
    }
  ]
})

// Update a listing
update_listing({
  listingId: 123456789,
  price: 29.99,
  quantity: 10,
  tags: ["handmade", "ceramic", "mug"]
})

// Upload an image to a listing
upload_listing_image({
  listingId: 123456789,
  imagePath: "/path/to/image.jpg",
  rank: 1  // Optional: image position (1-10)
})

// List draft listings
list_draft_listings({ limit: 50 })

// Publish a draft listing
publish_listing({ listingId: 123456789 })

// Deactivate a listing
deactivate_listing({ listingId: 123456789 })

// Get shop sections
get_shop_sections()

// Create a shop section
create_shop_section({ title: "Holiday Collection" })

// Get shipping profiles
get_shipping_profiles()

// Update receipt/order status
update_receipt({
  receiptId: 987654321,
  wasShipped: true,
  trackingCode: "1Z999AA10123456784",
  carrierName: "UPS"
})
```

## Configuration Storage

Shop configurations and tokens are stored in `~/.etsy-mcp/shops.json`. This file contains:
- Shop configurations (IDs, names, client credentials)
- OAuth tokens (access tokens, refresh tokens)
- Token expiry information

**Security Note:** This file contains sensitive information. Make sure to:
- Keep it secure and not share it
- Add it to `.gitignore` if using version control
- Use appropriate file permissions

## Running the Server

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

The server communicates via stdio, so it's designed to be used with MCP-compatible clients like Cursor IDE.

## MCP Client Configuration

To use this server with an MCP-compatible client, add it to your MCP settings, e.g. for Cursor:

```json
{
  "mcpServers": {
    "etsy": {
      "command": "node",
      "args": ["/path/to/etsy-mcp/dist/index.js"]
    }
  }
}
```

## Troubleshooting

### "No shop specified and no default shop configured"
- Set a default shop using `set_default_shop`
- Or specify `shopId` in tool calls

### "Shop is not authenticated"
- Run `oauth_authenticate` and `oauth_callback` to authenticate

### "Token expired"
- Tokens should auto-refresh, but if not, re-authenticate using `oauth_authenticate`

### OAuth Issues
- Make sure your redirect URI is set to `urn:ietf:wg:oauth:2.0:oob` in Etsy Developer Portal
- Ensure you're using the correct authorization code from the callback URL

## Custom Variations

The server supports custom variations (up to 2 per listing) using Etsy's property system:

- **Property ID 513**: First custom variation (e.g., "Size", "Material")
- **Property ID 514**: Second custom variation (e.g., "Color", "Style")

When creating a listing with variations:
1. Define variations in `create_listing` with property IDs 513/514
2. After creating the listing, use `update_listing_inventory` to set up products (combinations of variation values) with specific prices and quantities
3. Each product represents one combination of variation values (e.g., "Small + Red", "Large + Blue")

**Example workflow:**
1. Create listing with variations defined
2. Get the listing ID from the response
3. Use `update_listing_inventory` to set up all product combinations with their prices and quantities

## API Limitations

- Etsy API has rate limits. The server doesn't currently implement rate limiting, so be mindful of API calls.
- Some endpoints may require specific scopes. Make sure your OAuth scopes include what you need.
- Taxonomy IDs are required for creating listings. You may need to query Etsy's taxonomy API to find the correct IDs.
- Etsy supports up to 2 custom variations per listing.

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
