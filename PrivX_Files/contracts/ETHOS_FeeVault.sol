// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║           E T H O S   F E E   V A U L T                          ║
 * ║           Powered by PrivX Hurricane                             ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Custom fee vault for ETHOS Shield. Accepts any shielded token   ║
 * ║  as fees and converts them into PRIVX value.                     ║
 * ║                                                                  ║
 * ║  Extends PrivX_FeeVault with per-token swap configuration:       ║
 * ║   • feeOnTransfer  — uses FOT-safe PulseX router function        ║
 * ║   • taxBP          — transfer tax deducted before quote calc     ║
 * ║   • defaultSlippageBP — per-token slippage floor                 ║
 * ║                                                                  ║
 * ║  Tax tokens (5% swap tax, same TokenTax framework):              ║
 * ║    ETHOS  — feeOnTransfer=true, taxBP=500, slippage=600          ║
 * ║    ZKP    — feeOnTransfer=true, taxBP=500, slippage=600          ║
 * ║    OMEGA  — feeOnTransfer=true, taxBP=500, slippage=600          ║
 * ║  Standard tokens:                                                ║
 * ║    pDAI, WPLS, PLSX, HEX, ProvX, PrivX                           ║
 * ║                      — feeOnTransfer=false, taxBP=0, slippage=200║
 * ║                                                                  ║
 * ║  Conversion flow (for each fee token):                           ║
 * ║    1. Swap accumulated token → WPLS via PulseX                   ║
 * ║    2. 80% of WPLS → buy PRIVX + add PRIVX/WPLS LP (POL)          ║
 * ║    3. 10% of WPLS → buy PRIVX → fund Mining Vault (POP rewards)  ║
 * ║    4. 10% of WPLS → buy PRIVX → burn (dead address)              ║
 * ║                                                                  ║
 * ║  Admin role:  Can ONLY set per-token swap configs.               ║
 * ║               Cannot change splits, addresses, or touch funds.   ║
 * ║               Can be renounced (set to address(0)) once all      ║
 * ║               tokens are configured.                             ║
 * ║                                                                  ║
 * ║  Core splits, addresses, and PRIVX destination are immutable.    ║
 * ║  2025 © ETHOS Protocol — Powered by PrivX                        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface IUniswapV2Router {
    /// Standard swap — reverts on fee-on-transfer tokens if received < amountOutMin.
    function swapExactTokensForTokens(
        uint256           amountIn,
        uint256           amountOutMin,
        address[] calldata path,
        address           to,
        uint256           deadline
    ) external returns (uint256[] memory amounts);

    /// FOT-safe swap — use for tokens that take a transfer/swap tax.
    /// Does NOT return amounts; check balance delta after the call.
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256           amountIn,
        uint256           amountOutMin,
        address[] calldata path,
        address           to,
        uint256           deadline
    ) external;

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IMiningVault {
    function topUp(uint256 amount) external;
}

// ─── Contract ─────────────────────────────────────────────────────────────────

contract ETHOS_FeeVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BP_DENOM     = 10_000;

    // ── Immutable core config ─────────────────────────────────────────────────

    IERC20            public immutable privx;
    IERC20            public immutable wpls;
    IUniswapV2Router  public immutable router;
    IUniswapV2Factory public immutable factory;
    IMiningVault      public immutable miningVault;

    uint256 public immutable polBP;
    uint256 public immutable vaultBP;
    uint256 public immutable burnBP;

    // ── Per-token swap config (admin-settable) ────────────────────────────────

    struct TokenConfig {
        bool    feeOnTransfer;     // true → use FOT-safe swap function (e.g. ETHOS 5% tax)
        uint256 taxBP;             // token's swap tax in bp (e.g. 500 = 5%). Used to reduce
                                   //   effective amountIn before calling getAmountsOut so
                                   //   minOut is calculated against what the vault actually receives.
        uint256 defaultSlippageBP; // per-token slippage floor for convertAuto (e.g. 600 for ETHOS).
                                   //   If 0, falls back to the caller-supplied slippageBP.
    }

    mapping(address => TokenConfig) public tokenConfigs;

    // ── Admin (token config only) ─────────────────────────────────────────────

    address public admin;

    // ── Stats ─────────────────────────────────────────────────────────────────

    uint256 public totalPrivxBurned;
    uint256 public totalPrivxToVault;
    uint256 public totalLpTokensLocked;

    // ── Events ────────────────────────────────────────────────────────────────

    event FeeConverted(address indexed token, uint256 tokenIn, uint256 wplsOut);
    event LiquidityAdded(uint256 privxAmount, uint256 wplsAmount, uint256 lpTokens);
    event PrivxBurned(uint256 amount);
    event PrivxToVault(uint256 amount);
    event TokenConfigSet(address indexed token, bool feeOnTransfer, uint256 taxBP, uint256 defaultSlippageBP);
    event AdminTransferred(address indexed previous, address indexed next);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    /**
     * @param _privx        PRIVX token address
     * @param _wpls         WPLS token address
     * @param _router       PulseX V2 router
     * @param _factory      PulseX V2 factory
     * @param _miningVault  Mining vault for POP rewards
     * @param _polBP        Basis points → POL (e.g. 8000)
     * @param _vaultBP      Basis points → Mining Vault (e.g. 1000)
     * @param _admin        Initial admin for token config. Can be renounced.
     */
    constructor(
        address _privx,
        address _wpls,
        address _router,
        address _factory,
        address _miningVault,
        uint256 _polBP,
        uint256 _vaultBP,
        address _admin
    ) {
        require(_privx       != address(0), "privx: zero");
        require(_wpls        != address(0), "wpls: zero");
        require(_router      != address(0), "router: zero");
        require(_factory     != address(0), "factory: zero");
        require(_miningVault != address(0), "vault: zero");
        require(_polBP + _vaultBP < BP_DENOM, "splits exceed 100%");
        require(_polBP > 0, "pol: zero");

        privx       = IERC20(_privx);
        wpls        = IERC20(_wpls);
        router      = IUniswapV2Router(_router);
        factory     = IUniswapV2Factory(_factory);
        miningVault = IMiningVault(_miningVault);
        polBP       = _polBP;
        vaultBP     = _vaultBP;
        burnBP      = BP_DENOM - _polBP - _vaultBP;
        admin       = _admin;

        emit AdminTransferred(address(0), _admin);
    }

    // ── Admin: token config ───────────────────────────────────────────────────

    /**
     * @notice Register or update the swap parameters for a fee token.
     *
     * @param token              Fee token address (e.g. ETHOS).
     * @param feeOnTransfer      Set true for tokens with a swap/transfer tax.
     *                           Uses swapExactTokensForTokensSupportingFeeOnTransferTokens.
     * @param taxBP              Token's swap tax in basis points (e.g. 500 = 5%).
     *                           Reduces effective amountIn in quote calculations so
     *                           minOut reflects what the vault actually receives after tax.
     * @param defaultSlippageBP  Minimum slippage tolerance for this token in convertAuto.
     *                           Prevents callers from setting slippage too low for tax tokens.
     *                           Set to 0 to have no floor (caller's slippageBP is used as-is).
     *
     * Example for ETHOS (5% swap tax):
     *   setTokenConfig(ETHOS_ADDRESS, true, 500, 600)
     *
     * Example for pDAI (no tax, standard):
     *   setTokenConfig(PDAI_ADDRESS, false, 0, 200)
     */
    function setTokenConfig(
        address token,
        bool    feeOnTransfer,
        uint256 taxBP,
        uint256 defaultSlippageBP
    ) external onlyAdmin {
        require(token != address(0),            "token: zero");
        require(taxBP < BP_DENOM,               "taxBP: >= 100%");
        require(defaultSlippageBP < BP_DENOM,   "slippage: >= 100%");

        tokenConfigs[token] = TokenConfig({
            feeOnTransfer:     feeOnTransfer,
            taxBP:             taxBP,
            defaultSlippageBP: defaultSlippageBP
        });

        emit TokenConfigSet(token, feeOnTransfer, taxBP, defaultSlippageBP);
    }

    /**
     * @notice Transfer admin role. Pass address(0) to renounce permanently.
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    // ── Convert (manual, explicit slippage) ──────────────────────────────────

    /**
     * @notice Convert all accumulated fees of `token` into PRIVX POL, vault, and burn.
     *         Anyone can call. A keeper bot is expected to call periodically.
     *
     * @param token          Fee token to convert.
     * @param minWplsOut     Min WPLS from token→WPLS swap (0 if token is already WPLS).
     * @param minPrivxPolLp  Min PRIVX when buying for POL.
     * @param minPrivxVault  Min PRIVX when buying for vault.
     * @param minPrivxBurn   Min PRIVX when buying for burn.
     */
    function convert(
        address token,
        uint256 minWplsOut,
        uint256 minPrivxPolLp,
        uint256 minPrivxVault,
        uint256 minPrivxBurn
    ) external nonReentrant {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "nothing to convert");

        if (token == address(privx)) {
            _distributePrivx(balance, minWplsOut, minPrivxVault, minPrivxBurn);
        } else if (token == address(wpls)) {
            _distributeWpls(balance, minPrivxPolLp, minPrivxVault, minPrivxBurn);
        } else {
            uint256 wplsOut = _swap(token, address(wpls), balance, minWplsOut);
            emit FeeConverted(token, balance, wplsOut);
            _distributeWpls(wplsOut, minPrivxPolLp, minPrivxVault, minPrivxBurn);
        }
    }

    // ── Convert (auto, computes slippage on-chain) ────────────────────────────

    /**
     * @notice Convenience wrapper — computes expected amounts on-chain and applies
     *         slippage. For tax tokens, the effective slippage used is the greater of
     *         `slippageBP` and the token's `defaultSlippageBP` (set via setTokenConfig).
     *
     * @param token       Fee token to convert.
     * @param slippageBP  Acceptable slippage in basis points (e.g. 200 = 2%).
     *                    For ETHOS (5% tax) pass at least 600. The contract will
     *                    enforce the token's defaultSlippageBP as a floor.
     */
    function convertAuto(address token, uint256 slippageBP) external nonReentrant {
        require(slippageBP < BP_DENOM, "slippage: invalid");

        // Enforce per-token minimum slippage floor
        TokenConfig memory cfg = tokenConfigs[token];
        uint256 effectiveSlippage = (cfg.defaultSlippageBP > slippageBP)
            ? cfg.defaultSlippageBP
            : slippageBP;

        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "nothing to convert");

        if (token == address(privx)) {
            uint256 polPrivx    = (balance * polBP) / BP_DENOM;
            uint256 privxToSell = polPrivx / 2;
            uint256 wplsForCalc = _quoteAdjusted(address(privx), address(wpls), privxToSell, 0);
            _distributePrivx(
                balance,
                _applySlippage(wplsForCalc, effectiveSlippage),
                _applySlippage(_quoteAdjusted(address(wpls), address(privx), (balance * vaultBP) / BP_DENOM, 0), effectiveSlippage),
                _applySlippage(_quoteAdjusted(address(wpls), address(privx), (balance * burnBP)  / BP_DENOM, 0), effectiveSlippage)
            );
        } else if (token == address(wpls)) {
            uint256 polW   = (balance * polBP)   / BP_DENOM;
            uint256 vaultW = (balance * vaultBP) / BP_DENOM;
            uint256 burnW  = balance - polW - vaultW;
            _distributeWpls(
                balance,
                _applySlippage(_quoteAdjusted(address(wpls), address(privx), polW / 2, 0), effectiveSlippage),
                _applySlippage(_quoteAdjusted(address(wpls), address(privx), vaultW,   0), effectiveSlippage),
                _applySlippage(_quoteAdjusted(address(wpls), address(privx), burnW,    0), effectiveSlippage)
            );
        } else {
            // Tax-adjusted quote: reduces amountIn by taxBP before hitting getAmountsOut
            uint256 wplsExpected = _quoteAdjusted(token, address(wpls), balance, cfg.taxBP);
            uint256 minWpls      = _applySlippage(wplsExpected, effectiveSlippage);
            uint256 wplsOut      = _swap(token, address(wpls), balance, minWpls);
            emit FeeConverted(token, balance, wplsOut);
            uint256 polW   = (wplsOut * polBP)   / BP_DENOM;
            uint256 vaultW = (wplsOut * vaultBP) / BP_DENOM;
            uint256 burnW  = wplsOut - polW - vaultW;
            _distributeWpls(
                wplsOut,
                _applySlippage(_quoteAdjusted(address(wpls), address(privx), polW / 2, 0), effectiveSlippage),
                _applySlippage(_quoteAdjusted(address(wpls), address(privx), vaultW,   0), effectiveSlippage),
                _applySlippage(_quoteAdjusted(address(wpls), address(privx), burnW,    0), effectiveSlippage)
            );
        }
    }

    // ── Internal distribution ─────────────────────────────────────────────────

    function _distributeWpls(
        uint256 wplsTotal,
        uint256 minPrivxPolLp,
        uint256 minPrivxVault,
        uint256 minPrivxBurn
    ) internal {
        uint256 polWpls   = (wplsTotal * polBP)   / BP_DENOM;
        uint256 vaultWpls = (wplsTotal * vaultBP) / BP_DENOM;
        uint256 burnWpls  = wplsTotal - polWpls - vaultWpls;

        if (polWpls > 1) {
            uint256 wplsToBuy  = polWpls / 2;
            uint256 wplsForLp  = polWpls - wplsToBuy;
            uint256 privxForLp = _swap(address(wpls), address(privx), wplsToBuy, minPrivxPolLp);
            _addLiquidity(privxForLp, wplsForLp);
        }
        if (vaultWpls > 0) {
            uint256 privxForVault = _swap(address(wpls), address(privx), vaultWpls, minPrivxVault);
            _sendToVault(privxForVault);
        }
        if (burnWpls > 0) {
            uint256 privxToBurn = _swap(address(wpls), address(privx), burnWpls, minPrivxBurn);
            _burn(privxToBurn);
        }
    }

    function _distributePrivx(
        uint256 privxTotal,
        uint256 minWplsForLp,
        uint256 minPrivxVault,
        uint256 minPrivxBurn
    ) internal {
        uint256 polPrivx   = (privxTotal * polBP)   / BP_DENOM;
        uint256 vaultPrivx = (privxTotal * vaultBP) / BP_DENOM;
        uint256 burnPrivx  = privxTotal - polPrivx - vaultPrivx;

        if (polPrivx > 1) {
            uint256 privxToSell = polPrivx / 2;
            uint256 privxToLp   = polPrivx - privxToSell;
            uint256 wplsOut     = _swap(address(privx), address(wpls), privxToSell, minWplsForLp);
            _addLiquidity(privxToLp, wplsOut);
        }
        if (vaultPrivx > 0) _sendToVault(vaultPrivx);
        if (burnPrivx  > 0) _burn(burnPrivx);
    }

    // ── Internal swap (standard + FOT) ───────────────────────────────────────

    function _swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).safeApprove(address(router), 0);
        IERC20(tokenIn).safeApprove(address(router), amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        TokenConfig memory cfg = tokenConfigs[tokenIn];

        if (cfg.feeOnTransfer) {
            // FOT-safe router function is void — measure balance delta instead
            uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));
            router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amountIn,
                minAmountOut,
                path,
                address(this),
                block.timestamp + 300
            );
            amountOut = IERC20(tokenOut).balanceOf(address(this)) - balBefore;
        } else {
            uint256[] memory amounts = router.swapExactTokensForTokens(
                amountIn,
                minAmountOut,
                path,
                address(this),
                block.timestamp + 300
            );
            amountOut = amounts[amounts.length - 1];
        }
    }

    function _addLiquidity(uint256 privxAmount, uint256 wplsAmount) internal {
        privx.safeApprove(address(router), 0);
        privx.safeApprove(address(router), privxAmount);
        wpls.safeApprove(address(router), 0);
        wpls.safeApprove(address(router), wplsAmount);

        (, , uint256 lpTokens) = router.addLiquidity(
            address(privx),
            address(wpls),
            privxAmount,
            wplsAmount,
            (privxAmount * 95) / 100,
            (wplsAmount  * 95) / 100,
            address(this),
            block.timestamp + 300
        );
        totalLpTokensLocked += lpTokens;
        emit LiquidityAdded(privxAmount, wplsAmount, lpTokens);
    }

    function _sendToVault(uint256 amount) internal {
        privx.safeApprove(address(miningVault), 0);
        privx.safeApprove(address(miningVault), amount);
        miningVault.topUp(amount);
        totalPrivxToVault += amount;
        emit PrivxToVault(amount);
    }

    function _burn(uint256 amount) internal {
        privx.safeTransfer(BURN_ADDRESS, amount);
        totalPrivxBurned += amount;
        emit PrivxBurned(amount);
    }

    // ── Quote helpers ─────────────────────────────────────────────────────────

    /**
     * @dev Quote with tax adjustment. Reduces amountIn by taxBP before querying
     *      the AMM so the returned estimate reflects what the vault actually
     *      receives after the token's swap tax is deducted.
     */
    function _quoteAdjusted(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 taxBP
    ) internal view returns (uint256) {
        if (amountIn == 0) return 0;
        uint256 effectiveIn = (taxBP > 0)
            ? (amountIn * (BP_DENOM - taxBP)) / BP_DENOM
            : amountIn;
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        try router.getAmountsOut(effectiveIn, path) returns (uint256[] memory amounts) {
            return amounts[amounts.length - 1];
        } catch {
            return 0;
        }
    }

    function _applySlippage(uint256 amount, uint256 slippageBP)
        internal pure returns (uint256)
    {
        return (amount * (BP_DENOM - slippageBP)) / BP_DENOM;
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    /// @notice Accumulated balance of any fee token held by this vault.
    function accumulated(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Expected WPLS output for converting the current `token` balance.
     *         Applies the token's registered taxBP adjustment if configured.
     */
    function quoteConvert(address token) external view returns (uint256 expectedWpls) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0 || token == address(wpls)) return bal;
        TokenConfig memory cfg = tokenConfigs[token];
        return _quoteAdjusted(token, address(wpls), bal, cfg.taxBP);
    }

    /// @notice LP tokens locked in this vault for the PRIVX/WPLS pair (Protocol-Owned Liquidity).
    function polLpBalance() external view returns (uint256) {
        address pair = factory.getPair(address(privx), address(wpls));
        if (pair == address(0)) return 0;
        return IERC20(pair).balanceOf(address(this));
    }

    /// @notice Current split configuration.
    function splitConfig() external view returns (uint256 pol, uint256 vault, uint256 burn) {
        return (polBP, vaultBP, burnBP);
    }

    /// @notice Effective slippage that would be applied for a given token in convertAuto.
    function effectiveSlippage(address token, uint256 callerSlippageBP)
        external view returns (uint256)
    {
        TokenConfig memory cfg = tokenConfigs[token];
        return (cfg.defaultSlippageBP > callerSlippageBP)
            ? cfg.defaultSlippageBP
            : callerSlippageBP;
    }
}
