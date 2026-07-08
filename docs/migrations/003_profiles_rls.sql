-- Profiles RLS: allow signed-in users to read their own row (optional direct client reads).
-- Staff login uses GET /api/profiles/me (service role on server) so login works even without this policy.

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Mutations stay server-side only (service role bypasses RLS).
-- Do not add INSERT/UPDATE/DELETE policies for authenticated unless you need client writes.
