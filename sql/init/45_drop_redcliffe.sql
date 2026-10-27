-- Remove Redcliffe from the franchisee networks.
--
-- Dropped on 2026-10-27: its register publishes no phone number for collection
-- centres at all, and the only numbers it carries are one switchboard on its
-- own pathology labs. See "Why Redcliffe was dropped" in
-- docs/RUNBOOK-franchisees.md.
--
-- This needs to be its own statement because atlas.load_chain_centres() only
-- ever deletes within the chain it is loading — that is deliberate, so a
-- Thyrocare refresh can never look like Metropolis going missing. The flip
-- side is that a chain we stop carrying is never cleaned up by loading the
-- others, and would sit on the screen indefinitely.
--
-- Safe to run more than once, and safe to run on a database that never had it.

DELETE FROM atlas.chain_centre       WHERE chain = 'Redcliffe';
DELETE FROM atlas.chain_centre_stage WHERE chain = 'Redcliffe';
