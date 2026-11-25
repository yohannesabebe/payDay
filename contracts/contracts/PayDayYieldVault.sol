// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PayDayYieldVault
 * @notice Manages idle tUSD8 payroll capital across selectable QDay yield strategies.
 *         Accrues deterministic yield over time and allows strategy rebalancing.
 */
contract PayDayYieldVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Strategy {
        string name;
        uint256 apyBps; // e.g., 1420 = 14.20% APY
        bool active;
        uint256 totalDeposited;
    }

    struct VaultPosition {
        uint256 principal;
        uint8 strategyId;
        uint256 lastUpdate;
        uint256 accruedYield;
        bool withdrawn;
    }

    IERC20 public immutable token;
    address public router;
    uint256 public yieldReserve;

    mapping(uint8 => Strategy) public strategies;
    uint8 public strategyCount;
    mapping(uint256 => VaultPosition) public positions;

    event RouterUpdated(address indexed newRouter);
    event StrategyAdded(uint8 indexed strategyId, string name, uint256 apyBps);
    event StrategyApyUpdated(uint8 indexed strategyId, uint256 newApyBps);
    event YieldReserveFunded(address indexed funder, uint256 amount);
    event DepositedToVault(uint256 indexed payrollId, uint256 principal, uint8 strategyId);
    event StrategyRebalanced(uint256 indexed payrollId, uint8 fromStrategy, uint8 toStrategy, uint256 accruedSoFar);
    event WithdrawnFromVault(uint256 indexed payrollId, uint256 principal, uint256 yieldPaid);

    modifier onlyRouter() {
        require(msg.sender == router, "Only PayDayRouter");
        _;
    }

    constructor(address _token) Ownable(msg.sender) {
        require(_token != address(0), "Invalid token");
        token = IERC20(_token);

        _addStrategy("QDay Stable LP (tUSD8/tQDAY)", 850);
        _addStrategy("Aevum Treasury Pool", 1420);
        _addStrategy("Quantum Liquidity Pool", 2100);
    }

    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "Invalid router");
        router = _router;
        emit RouterUpdated(_router);
    }

    function _addStrategy(string memory name, uint256 apyBps) internal {
        uint8 id = strategyCount++;
        strategies[id] = Strategy({
            name: name,
            apyBps: apyBps,
            active: true,
            totalDeposited: 0
        });
        emit StrategyAdded(id, name, apyBps);
    }

    function updateStrategyApy(uint8 strategyId, uint256 newApyBps) external onlyOwner {
        require(strategyId < strategyCount, "Invalid strategy");
        require(newApyBps <= 10000, "APY too high");
        strategies[strategyId].apyBps = newApyBps;
        emit StrategyApyUpdated(strategyId, newApyBps);
    }

    function fundYieldReserve(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        token.safeTransferFrom(msg.sender, address(this), amount);
        yieldReserve += amount;
        emit YieldReserveFunded(msg.sender, amount);
    }

    function depositForPayroll(
        uint256 payrollId,
        uint256 amount,
        uint8 strategyId
    ) external onlyRouter nonReentrant {
        require(strategyId < strategyCount && strategies[strategyId].active, "Invalid strategy");
        require(positions[payrollId].principal == 0, "Position exists");

        token.safeTransferFrom(msg.sender, address(this), amount);
        strategies[strategyId].totalDeposited += amount;

        positions[payrollId] = VaultPosition({
            principal: amount,
            strategyId: strategyId,
            lastUpdate: block.timestamp,
            accruedYield: 0,
            withdrawn: false
        });

        emit DepositedToVault(payrollId, amount, strategyId);
    }

    function rebalanceStrategy(uint256 payrollId, uint8 newStrategyId) external onlyRouter nonReentrant {
        VaultPosition storage pos = positions[payrollId];
        require(pos.principal > 0 && !pos.withdrawn, "Invalid position");
        require(newStrategyId < strategyCount && strategies[newStrategyId].active, "Invalid strategy");
        require(pos.strategyId != newStrategyId, "Already in target strategy");

        uint256 pending = _pendingYield(pos);
        pos.accruedYield += pending;
        pos.lastUpdate = block.timestamp;

        uint8 oldStrategy = pos.strategyId;
        strategies[oldStrategy].totalDeposited -= pos.principal;
        strategies[newStrategyId].totalDeposited += pos.principal;
        pos.strategyId = newStrategyId;

        emit StrategyRebalanced(payrollId, oldStrategy, newStrategyId, pos.accruedYield);
    }

    function withdrawForPayroll(
        uint256 payrollId
    ) external onlyRouter nonReentrant returns (uint256 principal, uint256 yieldPaid) {
        VaultPosition storage pos = positions[payrollId];
        require(pos.principal > 0 && !pos.withdrawn, "Invalid or withdrawn");

        uint256 totalYield = pos.accruedYield + _pendingYield(pos);
        principal = pos.principal;

        // Protect principal: cap yield payout to available yieldReserve
        yieldPaid = totalYield > yieldReserve ? yieldReserve : totalYield;
        yieldReserve -= yieldPaid;

        pos.accruedYield = yieldPaid;
        pos.lastUpdate = block.timestamp;
        pos.withdrawn = true;
        strategies[pos.strategyId].totalDeposited -= principal;

        token.safeTransfer(msg.sender, principal + yieldPaid);
        emit WithdrawnFromVault(payrollId, principal, yieldPaid);
    }

    function previewYield(uint256 payrollId) external view returns (uint256) {
        VaultPosition memory pos = positions[payrollId];
        if (pos.principal == 0 || pos.withdrawn) return pos.accruedYield;
        return pos.accruedYield + _pendingYield(pos);
    }

    function getBestStrategy() external view returns (uint8 bestId, uint256 bestApyBps) {
        for (uint8 i = 0; i < strategyCount; i++) {
            if (strategies[i].active && strategies[i].apyBps > bestApyBps) {
                bestApyBps = strategies[i].apyBps;
                bestId = i;
            }
        }
    }

    function _pendingYield(VaultPosition memory pos) internal view returns (uint256) {
        if (block.timestamp <= pos.lastUpdate) return 0;
        uint256 elapsed = block.timestamp - pos.lastUpdate;
        uint256 apyBps = strategies[pos.strategyId].apyBps;
        return (pos.principal * apyBps * elapsed) / (10000 * 365 days);
    }
}
