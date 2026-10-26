export const ErrorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string', example: 'Error message' },
    hint: { type: 'string', example: 'Helpful troubleshooting hint' },
    details: { type: 'string', example: 'Underlying error details' },
  },
};

export const WalletItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    currency: { type: 'string', example: 'TON' },
    address: { type: 'string', example: 'UQ...' },
    balance: { type: 'string', example: '0' },
    lockedBalance: { type: 'string', example: '0' },
  },
};

export const UserProfileSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    telegramId: { type: 'string', example: '123456789' },
    username: { type: 'string', example: 'tester' },
    firstName: { type: 'string', example: 'Test' },
    lastName: { type: 'string', example: 'User' },
    first_name: { type: 'string', example: 'Test' },
    last_name: { type: 'string', example: 'User' },
    languageCode: { type: 'string', example: 'en' },
    walletIndex: { type: 'integer', example: 1 },
    tonDepositAddress: { type: 'string', example: 'UQ...' },
    bep20DepositAddress: { type: 'string', example: '0x...' },
    bankName: { type: 'string', nullable: true },
    accountNumber: { type: 'string', nullable: true },
    accountName: { type: 'string', nullable: true },
    wallets: {
      type: 'array',
      items: WalletItemSchema,
    },
  },
};

export const swaggerOptions: any = {
  openapi: {
    openapi: '3.0.3',
    info: {
      title: 'Telegram Mini App - Wallet & Trading API',
      description: `
API for Telegram Mini App custodial HD wallet generation, balances, deposits, and P2P Buy/Sell crypto trading.

### How to test in Swagger UI:
Endpoints requiring authentication are marked with a lock icon.
1. Click the **Authorize** button at the top right.
2. In the **Value** field, enter:
   \`tma test_user=123456789\`
3. Click **Authorize** then **Close**.
4. Test **GET /profile**, **GET /trade/rates**, or **POST /trade/sell**!
`,
      version: '2.1.0',
    },
    servers: [
      {
        url: '/',
        description: 'Current Environment (Local / Railway / Vercel)',
      },
    ],
    components: {
      securitySchemes: {
        telegramAuth: {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header',
          description: 'Telegram Mini App auth header. Example: "tma test_user=123456789" or "tma <initData>"',
        },
      },
      schemas: {
        ErrorResponse: ErrorResponseSchema,
        WalletItem: WalletItemSchema,
        UserProfile: UserProfileSchema,
      },
    },
    tags: [
      { name: 'System', description: 'System health and status' },
      { name: 'User & Profile', description: 'Telegram user profile and auto-wallet derivation' },
      { name: 'Settings & Bank', description: 'User bank account setup and management' },
      { name: 'Trade', description: 'CoinMarketCap rates, Buy & Sell crypto flows' },
      { name: 'Wallet', description: 'HD wallet generation, retrieval, and on-chain syncing' },
      { name: 'Deposits', description: 'Manual deposit reporting and transaction matching' },
      { name: 'Webhooks', description: 'Third-party notification webhooks' },
    ],
  },
};

export const swaggerUiOptions: any = {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
    persistAuthorization: true,
  },
  staticCSP: false,
};
