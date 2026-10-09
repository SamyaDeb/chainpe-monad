/**
 * Secure Credential Storage using OS Keychain
 *
 * Stores the agent wallet's EVM private key using the operating system's native
 * credential manager:
 * - macOS: Keychain Access
 * - Linux: Secret Service API (GNOME Keyring, KWallet)
 * - Windows: Credential Manager
 *
 * The private key is never stored in plaintext on disk — it is encrypted by the
 * OS and tied to the user's login credentials.
 */

type Keytar = typeof import("keytar");

let keytarPromise: Promise<Keytar> | undefined;

/**
 * Loads keytar on first use. It is a native module (libsecret on Linux), so a
 * static import would crash every command — even `--help` — on machines without
 * it; this way only keychain operations fail, with a clear message.
 */
function loadKeytar(): Promise<Keytar> {
  keytarPromise ??= import("keytar")
    .then((m) => ((m as { default?: Keytar }).default ?? m) as Keytar)
    .catch((err: unknown) => {
      keytarPromise = undefined;
      throw new Error(
        `OS keychain unavailable (${(err as Error).message}). ` +
          "On Linux install libsecret (e.g. apt install libsecret-1-0)."
      );
    });
  return keytarPromise;
}

const SERVICE_NAME = "chainpe-agent";
const WALLET_PREFIX = "wallet";

/** Stores a wallet private key securely in the OS keychain. */
export async function savePrivateKey(walletAddress: string, privateKey: string): Promise<void> {
  const keytar = await loadKeytar();
  await keytar.setPassword(SERVICE_NAME, `${WALLET_PREFIX}-${walletAddress}`, privateKey);
}

/** Retrieves a wallet private key from the OS keychain (null if not found). */
export async function getPrivateKey(walletAddress: string): Promise<string | null> {
  const keytar = await loadKeytar();
  return keytar.getPassword(SERVICE_NAME, `${WALLET_PREFIX}-${walletAddress}`);
}

/** Removes a wallet private key from the OS keychain. */
export async function deletePrivateKey(walletAddress: string): Promise<boolean> {
  const keytar = await loadKeytar();
  return keytar.deletePassword(SERVICE_NAME, `${WALLET_PREFIX}-${walletAddress}`);
}

/** Checks if a wallet private key exists in the keychain. */
export async function hasPrivateKey(walletAddress: string): Promise<boolean> {
  return (await getPrivateKey(walletAddress)) !== null;
}

/** Lists all wallet addresses with stored keys. */
export async function listStoredWallets(): Promise<string[]> {
  const keytar = await loadKeytar();
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  return credentials
    .filter((c) => c.account.startsWith(`${WALLET_PREFIX}-`))
    .map((c) => c.account.replace(`${WALLET_PREFIX}-`, ""));
}

/** Removes all ChainPe agent credentials. Use with caution. */
export async function clearAllCredentials(): Promise<number> {
  const keytar = await loadKeytar();
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  let deleted = 0;
  for (const c of credentials) {
    if (await keytar.deletePassword(SERVICE_NAME, c.account)) deleted++;
  }
  return deleted;
}

/** Tests if the keychain is accessible. */
export async function isKeychainAvailable(): Promise<boolean> {
  try {
    const keytar = await loadKeytar();
    await keytar.findCredentials(SERVICE_NAME);
    return true;
  } catch {
    return false;
  }
}

/** Information about stored credentials (without revealing secrets). */
export async function getCredentialInfo(): Promise<{
  available: boolean;
  walletCount: number;
  wallets: string[];
}> {
  const available = await isKeychainAvailable();
  if (!available) return { available: false, walletCount: 0, wallets: [] };
  const wallets = await listStoredWallets();
  return {
    available: true,
    walletCount: wallets.length,
    wallets: wallets.map((w) => `${w.slice(0, 6)}…${w.slice(-4)}`),
  };
}
