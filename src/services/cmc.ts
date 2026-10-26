import axios from 'axios';

export interface TokenPriceData {
  symbol: string;
  name: string;
  priceUsd: number;
  rateNgn: number;
}

export interface RatesResponse {
  rates: Record<string, TokenPriceData>;
  usdNgnRate: number;
  source: string;
  updatedAt: string;
}

// In-memory cache to respect API rate limits
let cachedRates: RatesResponse | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

export async function getLiveTokenRates(): Promise<RatesResponse> {
  const now = Date.now();
  if (cachedRates && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedRates;
  }

  // Base parallel market rate for 1 USD to NGN (configurable via env)
  const usdNgnRate = parseFloat(process.env.USD_NGN_RATE || '1680');
  const cmcApiKey = process.env.CMC_API_KEY;

  // 1. Try CoinMarketCap API if key is available
  if (cmcApiKey && cmcApiKey.trim() !== '') {
    try {
      const response = await axios.get(
        'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
        {
          params: {
            symbol: 'USDT,TON',
            convert: 'USD',
          },
          headers: {
            'X-CMC_PRO_API_KEY': cmcApiKey,
            Accept: 'application/json',
          },
          timeout: 6000,
        }
      );

      const data = response.data?.data;
      if (data && data.USDT && data.TON) {
        const usdtUsd = data.USDT.quote?.USD?.price || 1.0;
        const tonUsd = data.TON.quote?.USD?.price || 5.2;

        cachedRates = {
          rates: {
            USDT: {
              symbol: 'USDT',
              name: 'Tether USD',
              priceUsd: usdtUsd,
              rateNgn: Math.round(usdtUsd * usdNgnRate),
            },
            TON: {
              symbol: 'TON',
              name: 'Toncoin',
              priceUsd: tonUsd,
              rateNgn: Math.round(tonUsd * usdNgnRate),
            },
          },
          usdNgnRate,
          source: 'coinmarketcap',
          updatedAt: new Date().toISOString(),
        };
        lastFetchTime = now;
        return cachedRates;
      }
    } catch (cmcError: any) {
      console.warn('CoinMarketCap API fetch failed, falling back to backup:', cmcError.message);
    }
  }

  // 2. Fallback to public CoinGecko API
  try {
    const cgResponse = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: {
          ids: 'tether,the-open-network',
          vs_currencies: 'usd',
        },
        timeout: 5000,
      }
    );

    const cgData = cgResponse.data;
    const usdtUsd = cgData?.tether?.usd || 1.0;
    const tonUsd = cgData?.['the-open-network']?.usd || 5.25;

    cachedRates = {
      rates: {
        USDT: {
          symbol: 'USDT',
          name: 'Tether USD',
          priceUsd: usdtUsd,
          rateNgn: Math.round(usdtUsd * usdNgnRate),
        },
        TON: {
          symbol: 'TON',
          name: 'Toncoin',
          priceUsd: tonUsd,
          rateNgn: Math.round(tonUsd * usdNgnRate),
        },
      },
      usdNgnRate,
      source: 'coingecko_fallback',
      updatedAt: new Date().toISOString(),
    };
    lastFetchTime = now;
    return cachedRates;
  } catch (cgError: any) {
    console.warn('CoinGecko fallback failed, using default baseline rates:', cgError.message);
  }

  // 3. Resilient Baseline Fallback
  const defaultUsdtUsd = 1.0;
  const defaultTonUsd = 5.2;

  cachedRates = {
    rates: {
      USDT: {
        symbol: 'USDT',
        name: 'Tether USD',
        priceUsd: defaultUsdtUsd,
        rateNgn: Math.round(defaultUsdtUsd * usdNgnRate),
      },
      TON: {
        symbol: 'TON',
        name: 'Toncoin',
        priceUsd: defaultTonUsd,
        rateNgn: Math.round(defaultTonUsd * usdNgnRate),
      },
    },
    usdNgnRate,
    source: 'baseline_default',
    updatedAt: new Date().toISOString(),
  };
  lastFetchTime = now;
  return cachedRates;
}
