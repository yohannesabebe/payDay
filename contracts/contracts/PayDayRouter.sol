// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PayDayYieldVault.sol";
import "./ERC8004PayeeRegistry.sol";

/**
 * @title PayDayRouter
 * @notice Core payroll lifecycle contract for QDay Aevum Testnet.
 *         Combines idle tUSD8 yield generation, scoped least-privilege AI agent sessions,
 *         ERC-8004 agent verification, and deterministic employee distribution.
 */
contract PayDayRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Recipient {
        address wallet;
        uint256 amount;
        string handle; // optional .qday handle for receipt auditability
    }

    struct AgentSession {
        uint256 budgetCap; // max tUSD8 principal per payroll execution
        uint256 expiry;
        bool active;
    }

    struct PayrollPosition {
        uint256 id;
        address employer;
        uint256 principal;
        uint256 payrollDate;
        uint256 createdAt;
        uint256 yieldReturned;
        bytes32 stateHash;
        bool executed;
        bool cancelled;
    }

    IERC20 public immutable token;
    PayDayYieldVault public immutable vault;
    ERC8004PayeeRegistry public immutable registry;

    uint256 public nextPayrollId = 1;
    uint256[] public activePayrollIds;

    mapping(uint256 => PayrollPosition) public payrolls;
    mapping(uint256 => Recipient[]) private _recipients;
    mapping(address => uint256[]) public employerPayrolls;
    mapping(address => mapping(address => AgentSession)) public agentSessions;

    event AgentSessionGranted(address indexed employer, address indexed agent, uint256 budgetCap, uint256 expiry);
    event AgentSessionRevoked(address indexed employer, address indexed agent);
    event PayrollCreated(
        uint256 indexed payrollId,
        address indexed employer,
        uint256 principal,
        uint256 payrollDate,
        uint8 strategyId,
        bytes32 stateHash
    );
    event PayrollRebalanced(uint256 indexed payrollId, address indexed triggeredBy, uint8 newStrategyId);
    event EmployeePaid(uint256 indexed payrollId, address indexed wallet, string handle, uint256 amount);
    event PayrollExecuted(
        uint256 indexed payrollId,
        address indexed employer,
        address indexed executor,
        uint256 principalDistributed,
        uint256 yieldReturned,
        bytes32 stateHash
    );
    event PayrollCancelled(uint256 indexed payrollId, address indexed employer, uint256 returnedAmount);

    constructor(address _token, address _vault, address _registry) {
        require(_token != address(0) && _vault != address(0) && _registry != address(0), "Invalid addresses");
        token = IERC20(_token);
        vault = PayDayYieldVault(_vault);
        registry = ERC8004PayeeRegistry(_registry);
    }

    /**
     * @notice Grant a least-privilege scoped session to an autonomous AI agent.
     */
    function grantAgentSession(address agent, uint256 budgetCap, uint256 durationSeconds) external {
        require(agent != address(0), "Invalid agent");
        require(budgetCap > 0, "Budget cap must be > 0");
        require(durationSeconds > 0 && durationSeconds <= 365 days, "Invalid duration");

        uint256 expiry = block.timestamp + durationSeconds;
        agentSessions[msg.sender][agent] = AgentSession({
            budgetCap: budgetCap,
            expiry: expiry,
            active: true
        });

        emit AgentSessionGranted(msg.sender, agent, budgetCap, expiry);
    }

    /**
     * @notice Immediately revoke an AI agent's execution permissions.
     */
    function revokeAgentSession(address agent) external {
        agentSessions[msg.sender][agent].active = false;
        emit AgentSessionRevoked(msg.sender, agent);
    }

    /**
     * @notice Deposit tUSD8 payroll funds into the yield vault and schedule payday.
     */
    function createPayroll(
        uint256 totalAmount,
        uint256 payrollDate,
        Recipient[] calldata recipients,
        uint8 strategyId
    ) external nonReentrant returns (uint256 payrollId) {
        require(totalAmount > 0, "Amount must be > 0");
        require(payrollDate > block.timestamp, "Payroll date must be future");
        require(recipients.length > 0 && recipients.length <= 100, "Invalid recipient count");

        uint256 sum = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i].wallet != address(0), "Invalid recipient wallet");
            require(recipients[i].amount > 0, "Recipient amount must be > 0");
            sum += recipients[i].amount;
        }
        require(sum == totalAmount, "Recipient sum != totalAmount");

        payrollId = nextPayrollId++;
        bytes32 stateHash = keccak256(abi.encode(payrollId, msg.sender, totalAmount, payrollDate, recipients.length));

        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        token.forceApprove(address(vault), totalAmount);
        vault.depositForPayroll(payrollId, totalAmount, strategyId);

        payrolls[payrollId] = PayrollPosition({
            id: payrollId,
            employer: msg.sender,
            principal: totalAmount,
            payrollDate: payrollDate,
            createdAt: block.timestamp,
            yieldReturned: 0,
            stateHash: stateHash,
            executed: false,
            cancelled: false
        });

        for (uint256 i = 0; i < recipients.length; i++) {
            _recipients[payrollId].push(recipients[i]);
        }

        activePayrollIds.push(payrollId);
        employerPayrolls[msg.sender].push(payrollId);

        emit PayrollCreated(payrollId, msg.sender, totalAmount, payrollDate, strategyId, stateHash);
    }

    /**
     * @notice Rebalance a payroll's idle capital to a higher-APY strategy.
     */
    function rebalancePayroll(uint256 payrollId, uint8 newStrategyId) external nonReentrant {
        PayrollPosition storage pos = payrolls[payrollId];
        require(pos.id != 0 && !pos.executed && !pos.cancelled, "Payroll not active");
        require(block.timestamp + 1 days < pos.payrollDate, "Too close to payday");
        _requireAuthorized(pos.employer, pos.principal);

        vault.rebalanceStrategy(payrollId, newStrategyId);
        emit PayrollRebalanced(payrollId, msg.sender, newStrategyId);
    }

    /**
     * @notice Execute payroll on or after payday: return yield to employer & pay all employees.
     */
    function executePayroll(uint256 payrollId) external nonReentrant {
        PayrollPosition storage pos = payrolls[payrollId];
        require(pos.id != 0, "Payroll not found");
        require(!pos.executed && !pos.cancelled, "Already settled");
        require(block.timestamp >= pos.payrollDate, "Payday not reached");
        _requireAuthorized(pos.employer, pos.principal);

        pos.executed = true;
        (uint256 principal, uint256 yieldPaid) = vault.withdrawForPayroll(payrollId);
        pos.yieldReturned = yieldPaid;

        if (yieldPaid > 0) {
            token.safeTransfer(pos.employer, yieldPaid);
        }

        Recipient[] storage list = _recipients[payrollId];
        for (uint256 i = 0; i < list.length; i++) {
            token.safeTransfer(list[i].wallet, list[i].amount);
            emit EmployeePaid(payrollId, list[i].wallet, list[i].handle, list[i].amount);
        }

        emit PayrollExecuted(payrollId, pos.employer, msg.sender, principal, yieldPaid, pos.stateHash);
    }

    /**
     * @notice Employer emergency cancel before execution; returns principal + accrued yield.
     */
    function cancelPayroll(uint256 payrollId) external nonReentrant {
        PayrollPosition storage pos = payrolls[payrollId];
        require(pos.id != 0, "Payroll not found");
        require(msg.sender == pos.employer, "Only employer");
        require(!pos.executed && !pos.cancelled, "Already settled");

        pos.cancelled = true;
        (uint256 principal, uint256 yieldPaid) = vault.withdrawForPayroll(payrollId);
        uint256 totalReturn = principal + yieldPaid;
        pos.yieldReturned = yieldPaid;

        token.safeTransfer(pos.employer, totalReturn);
        emit PayrollCancelled(payrollId, pos.employer, totalReturn);
    }

    function getRecipients(uint256 payrollId) external view returns (Recipient[] memory) {
        return _recipients[payrollId];
    }

    function getActivePayrollIds() external view returns (uint256[] memory) {
        return activePayrollIds;
    }

    function getEmployerPayrolls(address employer) external view returns (uint256[] memory) {
        return employerPayrolls[employer];
    }

    function _requireAuthorized(address employer, uint256 amount) internal view {
        if (msg.sender == employer) return;

        AgentSession memory session = agentSessions[employer][msg.sender];
        require(session.active, "Agent session inactive");
        require(block.timestamp <= session.expiry, "Agent session expired");
        require(amount <= session.budgetCap, "Exceeds agent budget cap");
    }
}
