-- Ground-truth "does this address have on-chain bytecode" signal for the
-- On-Chain Addresses report's classifier, written on demand by the same
-- /api/balances refresh that writes balances (015): sync's atlas_addresses
-- upsert ON CONFLICT set-list doesn't include this column, so it survives a
-- re-sync of an unchanged address, exactly like balances/balances_checked_at.
--
-- Why a separate signal from is_contract: is_contract (001) is actually
-- "Etherscan-verified contract" (build-addresses.mjs: isContract =
-- Boolean(etherscanName)), so an address with real bytecode but no verified
-- source reads as `false` there and gets misclassified as an EOA. has_code is
-- a real eth_getCode check, only run for addresses where is_contract is false
-- (verified contracts don't need it). NULL = not checked yet (before the
-- first refresh, or a chain fetch-balances doesn't support).
ALTER TABLE atlas_addresses
  ADD COLUMN IF NOT EXISTS has_code boolean;
