use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

// BullBank program id (generated fresh — NOT the DiamondHands program).
declare_id!("BLj7FScr8f57ygqFGJJtZ3sVRCx7C7gUQihyUWYptBYq");

const ACC_PRECISION: u128 = 1_000_000_000_000;

// Multiplier basis points (10000 = 1.0x), indexed by tier 0..=3.
//
// Tier 0 is the HOLD tier: no lock, no transfer, 1.0x. Tiers 1..=3 are LOCK
// tiers: tokens move into the vault and cannot come back until the term ends.
const TIER_MULT_BPS: [u64; 4] = [10_000, 12_000, 15_000, 20_000];
const TIER_LOCK_SECS: [i64; 4] = [
    0,
    14 * 24 * 60 * 60,
    30 * 24 * 60 * 60,
    60 * 24 * 60 * 60,
];
const BPS_DENOM: u128 = 10_000;
const HOLD_TIER: u8 = 0;

#[program]
pub mod staking {
    use super::*;

    /// Create the pool. `reward_rate_per_sec` is the emission rate in reward-token
    /// base units per second, split across all registered weight. Set once here
    /// and never changeable — there is deliberately no setter.
    pub fn initialize_pool(ctx: Context<InitializePool>, reward_rate_per_sec: u64) -> Result<()> {
        require!(reward_rate_per_sec > 0, StakeError::ZeroAmount);
        // Stake mint and reward mint are the same token, so a shared vault would
        // let emissions pay out locked principal.
        require_keys_neq!(
            ctx.accounts.stake_vault.key(),
            ctx.accounts.reward_vault.key(),
            StakeError::VaultsMustDiffer
        );

        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.stake_mint = ctx.accounts.stake_mint.key();
        pool.reward_mint = ctx.accounts.reward_mint.key();
        pool.stake_vault = ctx.accounts.stake_vault.key();
        pool.reward_vault = ctx.accounts.reward_vault.key();
        pool.total_weighted = 0;
        pool.acc_reward_per_share = 0;
        pool.reward_rate_per_sec = reward_rate_per_sec;
        pool.last_update_time = now;
        pool.reward_end_time = now;
        pool.bump = ctx.bumps.pool;
        Ok(())
    }

    /// Top up the reserve. Permissionless; extends how LONG emissions run, never
    /// how fast. Nobody has a path to take anything back out.
    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        require!(amount > 0, StakeError::ZeroAmount);
        update_pool(&mut ctx.accounts.pool)?;

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.funder_reward_ata.to_account_info(),
            mint: ctx.accounts.reward_mint.to_account_info(),
            to: ctx.accounts.reward_vault.to_account_info(),
            authority: ctx.accounts.funder.to_account_info(),
        };
        let decimals = ctx.accounts.reward_mint.decimals;
        token_interface::transfer_checked(
            CpiContext::new(cpi_program, cpi_accounts),
            amount,
            decimals,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        let added_secs = (amount / pool.reward_rate_per_sec) as i64;
        require!(added_secs > 0, StakeError::FundTooSmall);
        let base = if now > pool.reward_end_time { now } else { pool.reward_end_time };
        pool.reward_end_time = base.checked_add(added_secs).ok_or(StakeError::Overflow)?;

        // Restart the emission clock. Without this, an idle stretch before funding
        // would later be measured as emission time and paid out as rewards that
        // were never deposited.
        if pool.last_update_time < now {
            pool.last_update_time = now;
        }
        Ok(())
    }

    /// Register the caller's WALLET balance so it earns. No tokens move.
    ///
    /// This is the core of the hold-to-earn model. A Solana program cannot observe
    /// a wallet balance changing — nothing notifies it — so the holder tells it,
    /// and the program reads the token account directly to verify the claim rather
    /// than trusting a number passed in.
    ///
    /// Settlement uses `min(registered, current)`: rewards for the period just
    /// ended are paid on the SMALLER of what was registered last time and what is
    /// actually held now. Sync a large balance, sell, and come back, and the
    /// closing balance is what you get paid on. Borrowing tokens to inflate a
    /// balance is equally pointless — almost no time elapses, so almost nothing
    /// accrues.
    pub fn sync(ctx: Context<Sync>) -> Result<()> {
        update_pool(&mut ctx.accounts.pool)?;

        let current_balance = ctx.accounts.owner_ata.amount;
        let current_weight = weight_for(current_balance, HOLD_TIER)?;

        let pool_acc = ctx.accounts.pool.acc_reward_per_share;
        let owner_key = ctx.accounts.owner.key();
        let pool_key = ctx.accounts.pool.key();

        let pos = &mut ctx.accounts.position;
        // First sync initialises the account; weight 0 means nothing accrues for
        // the period before registration, which is correct.
        pos.owner = owner_key;
        pos.pool = pool_key;
        pos.tier = HOLD_TIER;
        pos.unlock_time = 0;

        let effective = pos.weight.min(current_weight);
        settle(pos, pool_acc, effective)?;

        let old_weight = pos.weight;
        pos.weight = current_weight;
        pos.balance = current_balance;

        let pool = &mut ctx.accounts.pool;
        pool.total_weighted = pool
            .total_weighted
            .checked_sub(old_weight)
            .ok_or(StakeError::Overflow)?
            .checked_add(current_weight)
            .ok_or(StakeError::Overflow)?;
        Ok(())
    }

    /// Lock tokens into the vault at a boost tier (1..=3).
    ///
    /// Unlike `sync`, this genuinely takes custody: the tokens leave the holder's
    /// wallet and cannot be retrieved until the term expires. That is the whole
    /// reason it earns more.
    pub fn stake(ctx: Context<Stake>, tier: u8, amount: u64) -> Result<()> {
        require!(amount > 0, StakeError::ZeroAmount);
        require!(tier != HOLD_TIER, StakeError::UseSyncForHolding);
        require!((tier as usize) < 4, StakeError::BadTier);
        update_pool(&mut ctx.accounts.pool)?;

        // Settle at the existing weight before it changes. Locked weight is
        // authoritative — the tokens are in the vault, so there is nothing to
        // cross-check against a wallet.
        {
            let acc = ctx.accounts.pool.acc_reward_per_share;
            let pos = &mut ctx.accounts.position;
            let w = pos.weight;
            settle(pos, acc, w)?;
        }

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.owner_ata.to_account_info(),
            mint: ctx.accounts.stake_mint.to_account_info(),
            to: ctx.accounts.stake_vault.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let decimals = ctx.accounts.stake_mint.decimals;
        token_interface::transfer_checked(
            CpiContext::new(cpi_program, cpi_accounts),
            amount,
            decimals,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let added_weight = weight_for(amount, tier)?;
        let owner_key = ctx.accounts.owner.key();
        let pool_key = ctx.accounts.pool.key();

        let pos = &mut ctx.accounts.position;
        pos.owner = owner_key;
        pos.pool = pool_key;
        pos.tier = tier;
        pos.balance = pos.balance.checked_add(amount).ok_or(StakeError::Overflow)?;
        pos.weight = pos.weight.checked_add(added_weight).ok_or(StakeError::Overflow)?;
        // Adding to a locked position restarts the full term on the combined balance.
        pos.unlock_time = now
            .checked_add(TIER_LOCK_SECS[tier as usize])
            .ok_or(StakeError::Overflow)?;

        let pool = &mut ctx.accounts.pool;
        pool.total_weighted = pool
            .total_weighted
            .checked_add(added_weight)
            .ok_or(StakeError::Overflow)?;
        Ok(())
    }

    /// Withdraw locked principal. Only after the term expires, and only for lock
    /// tiers — a hold position has nothing in the vault to withdraw.
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        update_pool(&mut ctx.accounts.pool)?;
        {
            let pos = &ctx.accounts.position;
            require!(pos.tier != HOLD_TIER, StakeError::NothingLocked);
            require!(now >= pos.unlock_time, StakeError::StillLocked);
            require!(amount > 0 && amount <= pos.balance, StakeError::InsufficientStake);
        }

        let acc = ctx.accounts.pool.acc_reward_per_share;
        let removed_weight;
        {
            let pos = &mut ctx.accounts.position;
            let w = pos.weight;
            settle(pos, acc, w)?;

            removed_weight = weight_for(amount, pos.tier)?;
            pos.balance = pos.balance.checked_sub(amount).ok_or(StakeError::Overflow)?;
            pos.weight = pos.weight.checked_sub(removed_weight).ok_or(StakeError::Overflow)?;
        }

        let pool = &mut ctx.accounts.pool;
        pool.total_weighted = pool
            .total_weighted
            .checked_sub(removed_weight)
            .ok_or(StakeError::Overflow)?;

        let stake_mint_key = ctx.accounts.pool.stake_mint;
        let bump = ctx.accounts.pool.bump;
        let seeds: &[&[u8]] = &[b"pool", stake_mint_key.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.stake_vault.to_account_info(),
            mint: ctx.accounts.stake_mint.to_account_info(),
            to: ctx.accounts.owner_ata.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let decimals = ctx.accounts.stake_mint.decimals;
        token_interface::transfer_checked(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
            amount,
            decimals,
        )?;
        Ok(())
    }

    /// Claim accrued rewards. Works for both hold and lock positions.
    ///
    /// For a hold position this performs an implicit sync first, re-reading the
    /// wallet balance and settling at `min(registered, current)`. Without that,
    /// the sell-then-claim path would pay out on tokens the holder no longer owns.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        update_pool(&mut ctx.accounts.pool)?;

        let acc = ctx.accounts.pool.acc_reward_per_share;
        let current_balance = ctx.accounts.owner_ata.amount;
        let total;
        let old_weight;
        let new_weight;

        {
            let pos = &mut ctx.accounts.position;
            old_weight = pos.weight;

            if pos.tier == HOLD_TIER {
                new_weight = weight_for(current_balance, HOLD_TIER)?;
                let effective = pos.weight.min(new_weight);
                settle(pos, acc, effective)?;
                pos.weight = new_weight;
                pos.balance = current_balance;
            } else {
                new_weight = pos.weight;
                let w = pos.weight;
                settle(pos, acc, w)?;
            }

            total = pos.accrued;
            require!(total > 0, StakeError::NothingToClaim);
            pos.accrued = 0;
        }

        if old_weight != new_weight {
            let pool = &mut ctx.accounts.pool;
            pool.total_weighted = pool
                .total_weighted
                .checked_sub(old_weight)
                .ok_or(StakeError::Overflow)?
                .checked_add(new_weight)
                .ok_or(StakeError::Overflow)?;
        }

        let stake_mint_key = ctx.accounts.pool.stake_mint;
        let bump = ctx.accounts.pool.bump;
        let seeds: &[&[u8]] = &[b"pool", stake_mint_key.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.reward_vault.to_account_info(),
            mint: ctx.accounts.reward_mint.to_account_info(),
            to: ctx.accounts.owner_ata.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let decimals = ctx.accounts.reward_mint.decimals;
        token_interface::transfer_checked(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
            total,
            decimals,
        )?;
        Ok(())
    }
}

// ---- helpers ----

fn weight_for(amount: u64, tier: u8) -> Result<u64> {
    let mult = TIER_MULT_BPS[tier as usize] as u128;
    let w = (amount as u128)
        .checked_mul(mult)
        .ok_or(StakeError::Overflow)?
        / BPS_DENOM;
    Ok(w as u64)
}

/// Move a position's checkpoint to the current accumulator, crediting `effective`
/// weight for the interval. Passing a reduced `effective` is how the hold model
/// declines to pay for tokens that were sold mid-period.
fn settle(pos: &mut Position, acc_now: u128, effective: u64) -> Result<()> {
    if acc_now > pos.acc_checkpoint && effective > 0 {
        let delta = acc_now - pos.acc_checkpoint;
        let earned = ((effective as u128) * delta / ACC_PRECISION) as u64;
        pos.accrued = pos.accrued.checked_add(earned).ok_or(StakeError::Overflow)?;
    }
    pos.acc_checkpoint = acc_now;
    Ok(())
}

/// Accrue emissions since the last touch, capped at `reward_end_time` so the
/// accumulator can never promise more than `fund_rewards` deposited.
///
/// Seconds that elapse while nothing is registered are skipped for accrual but
/// still consumed from the schedule; those tokens stay in the reserve
/// undistributed. Stale weight from holders who sold without syncing has the same
/// effect — it inflates the denominator, so slightly less is paid out than the
/// schedule allows. Both err toward over-collateralisation, which is the safe side.
fn update_pool(pool: &mut Pool) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let applicable = if now < pool.reward_end_time { now } else { pool.reward_end_time };
    if applicable <= pool.last_update_time {
        return Ok(());
    }
    if pool.total_weighted > 0 {
        let elapsed = (applicable - pool.last_update_time) as u128;
        let reward = elapsed
            .checked_mul(pool.reward_rate_per_sec as u128)
            .ok_or(StakeError::Overflow)?;
        let add = reward
            .checked_mul(ACC_PRECISION)
            .ok_or(StakeError::Overflow)?
            .checked_div(pool.total_weighted as u128)
            .ok_or(StakeError::Overflow)?;
        pool.acc_reward_per_share = pool
            .acc_reward_per_share
            .checked_add(add)
            .ok_or(StakeError::Overflow)?;
    }
    pool.last_update_time = applicable;
    Ok(())
}

// ---- accounts ----

#[account]
pub struct Pool {
    pub authority: Pubkey,
    pub stake_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub stake_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub total_weighted: u64,
    pub acc_reward_per_share: u128,
    pub reward_rate_per_sec: u64,
    pub last_update_time: i64,
    pub reward_end_time: i64,
    pub bump: u8,
}

#[account]
pub struct Position {
    pub owner: Pubkey,
    pub pool: Pubkey,
    /// Hold tier: the wallet balance at last sync. Lock tiers: tokens in the vault.
    pub balance: u64,
    /// balance * tier multiplier.
    pub weight: u64,
    /// Accumulator value at last settlement.
    pub acc_checkpoint: u128,
    pub accrued: u64,
    pub tier: u8,
    /// Always 0 for the hold tier.
    pub unlock_time: i64,
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init, payer = authority,
        space = 8 + 32 * 5 + 8 + 16 + 8 + 8 + 8 + 1,
        seeds = [b"pool", stake_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    pub stake_mint: InterfaceAccount<'info, Mint>,
    pub reward_mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = authority, token::mint = stake_mint, token::authority = pool)]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(init, payer = authority, token::mint = reward_mint, token::authority = pool)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    #[account(mut, seeds = [b"pool", pool.stake_mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(address = pool.reward_mint)]
    pub reward_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(mut)]
    pub funder_reward_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = pool.reward_vault)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Sync<'info> {
    #[account(mut, seeds = [b"pool", pool.stake_mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        init_if_needed, payer = owner,
        space = 8 + 32 + 32 + 8 + 8 + 16 + 8 + 1 + 8,
        seeds = [b"position", pool.key().as_ref(), owner.key().as_ref(), &[HOLD_TIER]],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// The wallet's token account for the staked mint.
    ///
    /// These two constraints are the security of the whole hold model. Without
    /// the owner check anyone could register somebody else's balance as their
    /// own; without the mint check they could register a balance of an unrelated
    /// token. The program reads the balance from this account rather than
    /// accepting a number from the caller.
    #[account(
        constraint = owner_ata.mint == pool.stake_mint @ StakeError::WrongMint,
        constraint = owner_ata.owner == owner.key() @ StakeError::WrongOwner,
    )]
    pub owner_ata: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(tier: u8)]
pub struct Stake<'info> {
    #[account(mut, seeds = [b"pool", pool.stake_mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        init_if_needed, payer = owner,
        space = 8 + 32 + 32 + 8 + 8 + 16 + 8 + 1 + 8,
        seeds = [b"position", pool.key().as_ref(), owner.key().as_ref(), &[tier]],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(address = pool.stake_mint)]
    pub stake_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, constraint = owner_ata.owner == owner.key() @ StakeError::WrongOwner)]
    pub owner_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = pool.stake_vault)]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Unstake<'info> {
    #[account(mut, seeds = [b"pool", pool.stake_mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [b"position", pool.key().as_ref(), owner.key().as_ref(), &[position.tier]],
        bump,
        has_one = owner,
    )]
    pub position: Account<'info, Position>,
    #[account(address = pool.stake_mint)]
    pub stake_mint: InterfaceAccount<'info, Mint>,
    pub owner: Signer<'info>,
    #[account(mut, constraint = owner_ata.owner == owner.key() @ StakeError::WrongOwner)]
    pub owner_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = pool.stake_vault)]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut, seeds = [b"pool", pool.stake_mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [b"position", pool.key().as_ref(), owner.key().as_ref(), &[position.tier]],
        bump,
        has_one = owner,
    )]
    pub position: Account<'info, Position>,
    #[account(address = pool.reward_mint)]
    pub reward_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// Both the reward destination and — for hold positions — the balance that
    /// gets re-verified before paying out.
    #[account(
        mut,
        constraint = owner_ata.mint == pool.stake_mint @ StakeError::WrongMint,
        constraint = owner_ata.owner == owner.key() @ StakeError::WrongOwner,
    )]
    pub owner_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = pool.reward_vault)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[error_code]
pub enum StakeError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Invalid tier (must be 0-3)")]
    BadTier,
    #[msg("Use sync() to register a wallet balance; tier 0 does not lock tokens")]
    UseSyncForHolding,
    #[msg("This position has no locked tokens to withdraw")]
    NothingLocked,
    #[msg("Insufficient locked balance")]
    InsufficientStake,
    #[msg("Position is still locked")]
    StillLocked,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Funding amount too small to buy a second of emissions")]
    FundTooSmall,
    #[msg("Stake vault and reward vault must be different accounts")]
    VaultsMustDiffer,
    #[msg("Token account belongs to a different mint")]
    WrongMint,
    #[msg("Token account is not owned by the signer")]
    WrongOwner,
    #[msg("Arithmetic overflow")]
    Overflow,
}
