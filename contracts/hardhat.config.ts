import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

// Load .env from the contracts workspace and the repo root (root takes lower priority).
dotenv.config();
dotenv.config({ path: "../.env" });

// ============================================================================
// Secrets (NEVER hardcode — read from environment / gitignored .env)
// ============================================================================
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
// Monadscan verification goes through the Etherscan v2 multichain API.
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

const MONAD_RPC_URL = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const MONAD_TESTNET_RPC_URL =
  process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";

// Only attach an account if a key is present, so `hardhat compile`/`test`
// work without any secrets configured.
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

const SOLC_VERSION = "0.8.28";

// Hardhat downloads native solc from binaries.soliditylang.org. Where that host
// is unreachable (e.g. a sandboxed CI), fall back to the solcjs build installed
// from npm (`solc@0.8.28` devDependency): same compiler version, just slower.
// Set SOLC_LOCAL=true to skip the download attempt entirely.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async (args, _hre, runSuper) => {
  if (process.env.SOLC_LOCAL !== "true") {
    try {
      return await runSuper(args);
    } catch (err) {
      if (args.solcVersion !== SOLC_VERSION) throw err;
      console.warn(`solc download failed (${(err as Error).message}); using npm solcjs ${SOLC_VERSION}`);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const solcPkg = require("solc/package.json");
  if (solcPkg.version !== args.solcVersion) {
    throw new Error(`npm solc is ${solcPkg.version}, need ${args.solcVersion}`);
  }
  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: args.solcVersion,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    longVersion: require("solc").version(),
  };
});

const config: HardhatUserConfig = {
  solidity: {
    version: SOLC_VERSION,
    settings: {
      optimizer: { enabled: true, runs: 1000 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: { chainId: 31337, hardfork: "cancun" },
    monadTestnet: {
      url: MONAD_TESTNET_RPC_URL,
      chainId: 10143,
      accounts,
    },
    monad: {
      url: MONAD_RPC_URL,
      chainId: 143,
      accounts,
    },
  },
  // Monadscan verification via the Etherscan v2 API (one key, chain selected by chainid).
  // TODO(verify): confirm Monadscan is served by the Etherscan v2 API for chains 143/10143;
  // otherwise verify on MonadVision via Sourcify (see Monad docs).
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
    customChains: [
      {
        network: "monadTestnet",
        chainId: 10143,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=10143",
          browserURL: "https://testnet.monadscan.com",
        },
      },
      {
        network: "monad",
        chainId: 143,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=143",
          browserURL: "https://monadscan.com",
        },
      },
    ],
  },
  // MonadVision verifies through Sourcify — no API key needed (docs.monad.xyz,
  // guides/verify-smart-contract/hardhat).
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify-api-monad.blockvision.org",
    browserUrl: "https://monadvision.com",
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
