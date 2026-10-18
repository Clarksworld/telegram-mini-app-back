import crypto from 'crypto';

/**
 * Validates Telegram Mini App initData string.
 * The process follows the official Telegram documentation:
 * 1. Sort keys alphabetically.
 * 2. Create a data-check-string.
 * 3. Create a secret key: HMAC-SHA256("WebAppData", botToken).
 * 4. Verify the hash: HMAC-SHA256(secretKey, dataCheckString).
 */
export function validateTelegramInitData(initData: string, botToken: string): boolean {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');

    if (!hash) return false;

    // 1. Collect all pairs except 'hash' and sort them alphabetically
    const dataArray: string[] = [];
    urlParams.forEach((value, key) => {
      if (key !== 'hash') {
        dataArray.push(`${key}=${value}`);
      }
    });
    dataArray.sort();

    // 2. Create the data-check-string
    const dataCheckString = dataArray.join('\n');

    // 3. Derive the Secret Key
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // 4. Calculate final hash
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return calculatedHash === hash;
  } catch (error) {
    console.error('Error validating Telegram initData:', error);
    return false;
  }
}
