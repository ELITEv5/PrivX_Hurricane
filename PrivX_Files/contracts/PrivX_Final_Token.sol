// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║                  PRIVX TOKEN — ELITE TEAM6 (PulseChain)              ║
 * ║                                                                      ║
 * ║   Immutable Utility + Deflationary Token for the PrivX Ecosystem     ║
 * ║   - Fixed total supply: 21,000,000 PRIVX (18 decimals)               ║
 * ║   - Burnable by anyone (deflationary)                                ║
 * ║   - No owner, no minting, no governance                              ║
 * ║   - Designed for Privacy with PrivX Shield Relay                     ║
 * ║                                                                      ║
 * ║   Dev:     ELITE TEAM6                                               ║
 * ║                                                                      ║
 * ║   License: MIT | Immutable | PulseChain Native                       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

contract PrivX_Privacy_Token is ERC20 {
    uint256 private constant INITIAL_SUPPLY = 21_000_000 * 10 ** 18;
    address public constant PULSECHAIN_BURN = 0x0000000000000000000000000000000000000369;

    uint256 public totalBurned;

    constructor() ERC20("Privacy Exchange Token", "PRIVX") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /**
     * @notice Sends tokens to the PulseChain burn sink (0x...0369).
     *         Tracks totalBurned for accurate deflation metrics.
     */
    function burn(uint256 amount) external {
        _transfer(msg.sender, PULSECHAIN_BURN, amount);
        totalBurned += amount;
    }

    /**
     * @notice Returns the circulating supply after accounting for burned tokens.
     */
    function circulatingSupply() external view returns (uint256) {
        return totalSupply() - totalBurned;
    }
}
