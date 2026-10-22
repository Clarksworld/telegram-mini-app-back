import axios from 'axios';

const TATUM_API_KEY = process.env.TATUM_API_KEY || '';
const TATUM_BASE_URL = 'https://api.tatum.io/v3';

export const tatum = {
  async verifyTransaction(network: 'BNB' | 'TON', txId: string) {
    if (!TATUM_API_KEY) {
      console.warn('TATUM_API_KEY is not configured; skipping remote Tatum check');
      return { status: 'UNKNOWN', txId };
    }

    try {
      const response = await axios.get(`${TATUM_BASE_URL}/transaction/${network}/${txId}`, {
        headers: { 'x-api-key': TATUM_API_KEY },
      });

      return response.data;
    } catch (error: any) {
      console.error(`Tatum verification error for ${network}:`, error.response?.data || error.message);
      throw error;
    }
  },

  async createWebhook(address: string, network: 'BNB' | 'TON', webhookUrl: string) {
    if (!TATUM_API_KEY) {
      console.warn('TATUM_API_KEY is not configured; skipping Tatum webhook subscription');
      return null;
    }

    try {
      const response = await axios.post(
        `${TATUM_BASE_URL}/webhook/subscribe`,
        {
          address,
          network,
          webhookUrl,
        },
        {
          headers: { 'x-api-key': TATUM_API_KEY },
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('Tatum webhook subscription error:', error.response?.data || error.message);
      throw error;
    }
  },
};

export default tatum;
