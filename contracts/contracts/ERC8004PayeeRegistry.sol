// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ERC8004PayeeRegistry
 * @notice Implements ERC-8004 Trustless Agent Identity & Reputation Registry alongside
 *         a Confirmation of Payee (CoP) handle registry (.qday) for QDay Aevum Testnet.
 */
contract ERC8004PayeeRegistry is ERC721URIStorage, Ownable {
    struct AgentInfo {
        address operator;
        bool active;
        uint256 totalScore;
        uint256 feedbackCount;
    }

    struct PayeeRecord {
        address wallet;
        string displayName;
        bool verified;
        uint256 updatedAt;
    }

    uint256 private _nextAgentId = 1;
    mapping(uint256 => AgentInfo) public agents;
    mapping(address => uint256) public operatorToAgentId;
    mapping(bytes32 => PayeeRecord) private _payees;
    string[] private _registeredHandles;

    event AgentRegistered(uint256 indexed agentId, address indexed operator, string agentURI);
    event AgentStatusUpdated(uint256 indexed agentId, bool active);
    event FeedbackSubmitted(uint256 indexed agentId, address indexed reviewer, uint8 score, string tag);
    event PayeeRegistered(string indexed handleIndexed, string handle, address indexed wallet, string displayName, bool verified);
    event PayeeVerificationUpdated(string indexed handleIndexed, string handle, bool verified);

    constructor() ERC721("PayDay ERC-8004 Agent", "PDAGENT") Ownable(msg.sender) {}

    /**
     * @notice Mint an ERC-8004 identity NFT for an autonomous AI agent.
     */
    function registerAgent(address operator, string calldata agentURI) external returns (uint256 agentId) {
        require(operator != address(0), "Invalid operator");
        require(operatorToAgentId[operator] == 0, "Operator already registered");

        agentId = _nextAgentId++;
        _safeMint(operator, agentId);
        _setTokenURI(agentId, agentURI);

        agents[agentId] = AgentInfo({
            operator: operator,
            active: true,
            totalScore: 0,
            feedbackCount: 0
        });
        operatorToAgentId[operator] = agentId;

        emit AgentRegistered(agentId, operator, agentURI);
    }

    function setAgentActive(uint256 agentId, bool active) external {
        require(ownerOf(agentId) == msg.sender || msg.sender == owner(), "Not authorized");
        agents[agentId].active = active;
        emit AgentStatusUpdated(agentId, active);
    }

    /**
     * @notice Submit ERC-8004 reputation feedback (0-100) for an agent.
     */
    function submitFeedback(uint256 agentId, uint8 score, string calldata tag) external {
        require(_ownerOf(agentId) != address(0), "Agent does not exist");
        require(score <= 100, "Score must be <= 100");
        require(agents[agentId].operator != msg.sender, "Self-rating not allowed");

        agents[agentId].totalScore += score;
        agents[agentId].feedbackCount += 1;

        emit FeedbackSubmitted(agentId, msg.sender, score, tag);
    }

    function getAgentReputation(uint256 agentId) external view returns (uint256 avgScore, uint256 count, bool active) {
        AgentInfo memory info = agents[agentId];
        count = info.feedbackCount;
        active = info.active;
        avgScore = count > 0 ? info.totalScore / count : 0;
    }

    function isVerifiedAgent(address operator) external view returns (bool) {
        uint256 agentId = operatorToAgentId[operator];
        if (agentId == 0) return false;
        return agents[agentId].active;
    }

    /**
     * @notice Register or update a Confirmation of Payee (CoP) handle (e.g. "alice.qday").
     */
    function registerPayee(
        string calldata handle,
        address wallet,
        string calldata displayName
    ) external {
        require(bytes(handle).length > 0, "Empty handle");
        require(wallet != address(0), "Invalid wallet");

        bytes32 key = keccak256(bytes(_toLower(handle)));
        PayeeRecord storage existing = _payees[key];
        if (existing.wallet == address(0)) {
            _registeredHandles.push(handle);
        } else {
            require(
                existing.wallet == msg.sender || msg.sender == owner(),
                "Not handle owner"
            );
        }

        bool isVerified = (msg.sender == owner() || msg.sender == wallet);
        _payees[key] = PayeeRecord({
            wallet: wallet,
            displayName: displayName,
            verified: isVerified,
            updatedAt: block.timestamp
        });

        emit PayeeRegistered(handle, handle, wallet, displayName, isVerified);
    }

    function verifyPayee(string calldata handle, bool verified) external onlyOwner {
        bytes32 key = keccak256(bytes(_toLower(handle)));
        require(_payees[key].wallet != address(0), "Payee not found");
        _payees[key].verified = verified;
        _payees[key].updatedAt = block.timestamp;
        emit PayeeVerificationUpdated(handle, handle, verified);
    }

    function resolvePayee(string calldata handle) external view returns (PayeeRecord memory) {
        bytes32 key = keccak256(bytes(_toLower(handle)));
        return _payees[key];
    }

    function getRegisteredHandlesCount() external view returns (uint256) {
        return _registeredHandles.length;
    }

    function getRegisteredHandleAt(uint256 index) external view returns (string memory) {
        return _registeredHandles[index];
    }

    function _toLower(string memory str) internal pure returns (string memory) {
        bytes memory bStr = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        for (uint256 i = 0; i < bStr.length; i++) {
            if ((uint8(bStr[i]) >= 65) && (uint8(bStr[i]) <= 90)) {
                bLower[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                bLower[i] = bStr[i];
            }
        }
        return string(bLower);
    }
}
