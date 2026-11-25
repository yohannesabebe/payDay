import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const QDAY_TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying PayDay contracts on ${network.name} (chainId=${network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  let tokenAddress = process.env.TUSD8_ADDRESS || QDAY_TUSD8;

  if (network.name === "hardhat" || network.name === "localhost") {
    const MockToken = await ethers.getContractFactory("MocktUSD8");
    const mockToken = await MockToken.deploy();
    await mockToken.waitForDeployment();
    tokenAddress = await mockToken.getAddress();
    console.log(`MocktUSD8 deployed at: ${tokenAddress}`);
  } else {
    console.log(`Using QDay tUSD8 token at: ${tokenAddress}`);
  }

  const Registry = await ethers.getContractFactory("ERC8004PayeeRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`ERC8004PayeeRegistry deployed at: ${registryAddress}`);

  const Vault = await ethers.getContractFactory("PayDayYieldVault");
  const vault = await Vault.deploy(tokenAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`PayDayYieldVault deployed at: ${vaultAddress}`);

  const Router = await ethers.getContractFactory("PayDayRouter");
  const router = await Router.deploy(tokenAddress, vaultAddress, registryAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`PayDayRouter deployed at: ${routerAddress}`);

  const tx = await vault.setRouter(routerAddress);
  await tx.wait();
  console.log(`PayDayYieldVault router set to ${routerAddress}`);

  // Register default PayDay AI Agent identity under ERC-8004
  const regTx = await registry.registerAgent(
    deployer.address,
    "https://payday.qday.info/agents/payday-autonomous-v1.json"
  );
  await regTx.wait();
  console.log(`ERC-8004 Agent #1 registered for operator ${deployer.address}`);

  const deployment = {
    network: network.name,
    chainId: network.config.chainId,
    tUSD8: tokenAddress,
    registry: registryAddress,
    vault: vaultAddress,
    router: routerAddress,
    deployedAt: new Date().toISOString(),
  };

  const outPath = path.join(__dirname, "..", "deployments.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log(`Saved deployment manifest to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
