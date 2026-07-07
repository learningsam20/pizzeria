-- Staff active flag (required for deactivate/reactivate in Admin → User Management)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Enforce one customer record per mobile number
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON customers (phone);
