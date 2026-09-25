-- ============================================================
-- 017_payout_account.sql — Datos de cobro del vendedor (Compra Protegida)
--
-- Dónde le transferimos al vendedor cuando se libera su pago (escrow 015):
-- alias, CVU o CBU, más el titular para chequear el nombre antes de
-- transferir. Dato financiero: solo lo ven el dueño
-- (GET/PUT /users/me/payout-account) y los admins (cola de retenciones).
-- El login NO lo devuelve.
--
-- payouts.destination guarda a qué cuenta se transfirió cada liberación, por
-- si el vendedor cambia el alias después (auditoría).
--
-- Idempotente. El código tolera que falte (42703 → sin datos de cobro).
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payout_account    VARCHAR(22),
  ADD COLUMN IF NOT EXISTS payout_holder     VARCHAR(120),
  ADD COLUMN IF NOT EXISTS payout_updated_at TIMESTAMP;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_payout_account_check;
ALTER TABLE users ADD CONSTRAINT users_payout_account_check
  CHECK (payout_account IS NULL OR payout_account ~ '^([0-9]{22}|[A-Za-z0-9.-]{6,20})$');

ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS destination VARCHAR(160);

COMMENT ON COLUMN users.payout_account IS
  'Alias (6 a 20: letras, números, punto, guion) o CVU/CBU (22 dígitos) donde cobra el vendedor. Solo dueño y admins.';
COMMENT ON COLUMN users.payout_holder IS
  'Titular de la cuenta de cobro, para chequear el nombre al transferir';
COMMENT ON COLUMN payouts.destination IS
  'Cuenta de cobro registrada al liberar (alias/CVU/CBU + titular), para auditoría';
