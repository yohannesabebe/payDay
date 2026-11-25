import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("PayDay Protocol (QDay Aevum)", function () {
  const DECIMALS = 10n ** 6n;

  async function deployFixture() {
    const [owner, employer, agent, alice, bob, carol] = await ethers.getSigners();

    const MocktUSD8 = await ethers.getContractFactory("MocktUSD8");
    const token = await MocktUSD8.deploy();

    const Registry = await ethers.getContractFactory("ERC8004PayeeRegistry");
    const registry = await Registry.deploy();

    const Vault = await ethers.getContractFactory("PayDayYieldVault");
    const vault = await Vault.deploy(await token.getAddress());

    const Router = await ethers.getContractFactory("PayDayRouter");
    const router = await Router.deploy(
      await token.getAddress(),
      await vault.getAddress(),
      await registry.getAddress()
    );

    await vault.setRouter(await router.getAddress());

    // Mint tUSD8 to employer and fund vault yield reserve
    await token.mint(employer.address, 50_000n * DECIMALS);
    await token.mint(owner.address, 10_000n * DECIMALS);
    await token.connect(owner).approve(await vault.getAddress(), 10_000n * DECIMALS);
    await vault.connect(owner).fundYieldReserve(10_000n * DECIMALS);

    return { owner, employer, agent, alice, bob, carol, token, registry, vault, router };
  }

  it("registers ERC-8004 agent identity, reputation, and Confirmation of Payee handles", async function () {
    const { owner, agent, alice, employer, registry } = await deployFixture();

    await registry.registerAgent(agent.address, "ipfs://payday-agent-v1");
    expect(await registry.isVerifiedAgent(agent.address)).to.equal(true);

    await registry.connect(employer).submitFeedback(1, 96, "on-time-payroll");
    const [avg, count, active] = await registry.getAgentReputation(1);
    expect(avg).to.equal(96n);
    expect(count).to.equal(1n);
    expect(active).to.equal(true);

    await registry.connect(alice).registerPayee("alice.qday", alice.address, "Alice Chen");
    const resolved = await registry.resolvePayee("ALICE.QDAY");
    expect(resolved.wallet).to.equal(alice.address);
    expect(resolved.displayName).to.equal("Alice Chen");
    expect(resolved.verified).to.equal(true);
  });

  it("earns yield over time, rebalances strategy, returns yield to employer, and pays employees", async function () {
    const { employer, agent, alice, bob, token, vault, router } = await deployFixture();

    const totalAmount = 10_000n * DECIMALS;
    const now = await time.latest();
    const payrollDate = now + 30 * 24 * 60 * 60; // 30 days

    // Employer grants scoped agent session (cap 15,000 tUSD8, 60 days)
    await router.connect(employer).grantAgentSession(agent.address, 15_000n * DECIMALS, 60 * 24 * 60 * 60);

    // Employer approves and creates payroll in Strategy 0 (8.5% APY)
    await token.connect(employer).approve(await router.getAddress(), totalAmount);
    const recipients = [
      { wallet: alice.address, amount: 6_000n * DECIMALS, handle: "alice.qday" },
      { wallet: bob.address, amount: 4_000n * DECIMALS, handle: "bob.qday" },
    ];
    await router.connect(employer).createPayroll(totalAmount, payrollDate, recipients, 0);

    // Advance 10 days and agent rebalances to Strategy 2 (21.0% APY)
    await time.increase(10 * 24 * 60 * 60);
    await router.connect(agent).rebalancePayroll(1, 2);

    // Advance remaining 20 days to payday
    await time.increase(20 * 24 * 60 * 60 + 5);

    const employerBalanceBefore = await token.balanceOf(employer.address);
    await router.connect(agent).executePayroll(1);
    const employerBalanceAfter = await token.balanceOf(employer.address);

    // Employer received positive yield back
    const yieldEarned = employerBalanceAfter - employerBalanceBefore;
    expect(yieldEarned).to.be.gt(0n);

    // Employees received exact principal
    expect(await token.balanceOf(alice.address)).to.equal(6_000n * DECIMALS);
    expect(await token.balanceOf(bob.address)).to.equal(4_000n * DECIMALS);

    const pos = await router.payrolls(1);
    expect(pos.executed).to.equal(true);
    expect(pos.yieldReturned).to.equal(yieldEarned);
    expect(await vault.previewYield(1)).to.equal(yieldEarned);
  });

  it("enforces scoped session guardrails: budget cap, expiry, and instant revocation", async function () {
    const { employer, agent, alice, token, router } = await deployFixture();

    const totalAmount = 5_000n * DECIMALS;
    const now = await time.latest();
    const payrollDate = now + 7 * 24 * 60 * 60;

    // Budget cap of 2,000 tUSD8 is less than 5,000 tUSD8 payroll
    await router.connect(employer).grantAgentSession(agent.address, 2_000n * DECIMALS, 30 * 24 * 60 * 60);
    await token.connect(employer).approve(await router.getAddress(), totalAmount);
    await router.connect(employer).createPayroll(
      totalAmount,
      payrollDate,
      [{ wallet: alice.address, amount: totalAmount, handle: "alice.qday" }],
      1
    );

    await time.increase(7 * 24 * 60 * 60 + 5);
    await expect(router.connect(agent).executePayroll(1)).to.be.revertedWith("Exceeds agent budget cap");

    // Raise cap, then revoke session
    await router.connect(employer).grantAgentSession(agent.address, 10_000n * DECIMALS, 30 * 24 * 60 * 60);
    await router.connect(employer).revokeAgentSession(agent.address);
    await expect(router.connect(agent).executePayroll(1)).to.be.revertedWith("Agent session inactive");

    // Employer can still execute directly
    await router.connect(employer).executePayroll(1);
    expect(await token.balanceOf(alice.address)).to.equal(totalAmount);
  });

  it("allows employer emergency cancel before payday and returns principal + accrued yield", async function () {
    const { employer, alice, token, router } = await deployFixture();

    const totalAmount = 4_000n * DECIMALS;
    const now = await time.latest();
    const payrollDate = now + 14 * 24 * 60 * 60;

    await token.connect(employer).approve(await router.getAddress(), totalAmount);
    await router.connect(employer).createPayroll(
      totalAmount,
      payrollDate,
      [{ wallet: alice.address, amount: totalAmount, handle: "alice.qday" }],
      1
    );

    await time.increase(5 * 24 * 60 * 60);
    const balBefore = await token.balanceOf(employer.address);
    await router.connect(employer).cancelPayroll(1);
    const balAfter = await token.balanceOf(employer.address);

    expect(balAfter - balBefore).to.be.gt(totalAmount);
    expect(await token.balanceOf(alice.address)).to.equal(0n);
  });
});
