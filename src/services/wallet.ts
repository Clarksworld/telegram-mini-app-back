import crypto from 'crypto';
import { HDNodeWallet, isAddress } from 'ethers';
import { WalletContractV4, Address } from '@ton/ton';
import { keyPairFromSeed } from '@ton/crypto';

export interface DerivedWallets {
  walletIndex: number;
  tonAddress: string;
  bep20Address: string;
}

const DEFAULT_MNEMONIC = 'rice link stand catch october smooth before tattoo board organ antique permit';

function getMasterMnemonic(): string {
  const mnemonic = process.env.MASTER_MNEMONIC?.trim();
  if (!mnemonic) {
    console.warn('⚠️ MASTER_MNEMONIC not set in environment, using default development mnemonic');
    return DEFAULT_MNEMONIC;
  }
  return mnemonic;
}

/**
 * Derives a standard EVM (BEP-20 / BSC / Ethereum) address from master HD mnemonic
 * Path: m/44'/60'/0'/0/{index}
 */
export function deriveBEP20Address(walletIndex: number): string {
  const mnemonic = getMasterMnemonic();
  const path = `m/44'/60'/0'/0/${walletIndex}`;
  const hdWallet = HDNodeWallet.fromPhrase(mnemonic, undefined, path);
  return hdWallet.address;
}

/**
 * Derives a standard TON Wallet V4R2 address deterministically from master seed
 */
export function deriveTonAddress(walletIndex: number): string {
  const mnemonic = getMasterMnemonic();
  const masterSeed = crypto.createHash('sha256').update(mnemonic).digest();
  const userSubSeed = crypto
    .createHmac('sha512', masterSeed)
    .update(`ton-user-wallet-${walletIndex}`)
    .digest()
    .subarray(0, 32);

  const keyPair = keyPairFromSeed(userSubSeed);
  const contract = WalletContractV4.create({
    publicKey: keyPair.publicKey,
    workchain: 0,
  });

  return contract.address.toString({ bounceable: false, urlSafe: true });
}

/**
 * Derives both TON and BEP-20 addresses for a specific user walletIndex
 */
export function deriveUserWallets(walletIndex: number): DerivedWallets {
  const tonAddress = deriveTonAddress(walletIndex);
  const bep20Address = deriveBEP20Address(walletIndex);

  return {
    walletIndex,
    tonAddress,
    bep20Address,
  };
}

/**
 * Validates whether a string is a valid TON address
 */
export function isTonAddressValid(address: string): boolean {
  try {
    Address.parse(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates whether a string is a valid BEP-20 / EVM address
 */
export function isBEP20AddressValid(address: string): boolean {
  return isAddress(address);
}

export default {
  deriveBEP20Address,
  deriveTonAddress,
  deriveUserWallets,
  isTonAddressValid,
  isBEP20AddressValid,
};
