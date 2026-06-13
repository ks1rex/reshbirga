CREATE TABLE profiles (
  id                     uuid         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname               text         UNIQUE NOT NULL,
  avatar_url             text,
  is_admin               boolean      NOT NULL DEFAULT false,
  is_banned              boolean      NOT NULL DEFAULT false,
  rating_as_customer     numeric(3,2) NOT NULL DEFAULT 0,
  rating_as_executor     numeric(3,2) NOT NULL DEFAULT 0,
  reviews_count_customer integer      NOT NULL DEFAULT 0,
  reviews_count_executor integer      NOT NULL DEFAULT 0,
  balance_available      numeric(12,2) NOT NULL DEFAULT 0,
  balance_pending        numeric(12,2) NOT NULL DEFAULT 0,
  created_at             timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_nickname ON profiles(nickname);

-- Security definer bypasses RLS to avoid circular dependency in policies
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid()),
    false
  )
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read profiles (balance filtered at API layer)
CREATE POLICY "profiles_select_authenticated"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- Users can update own profile; sensitive fields are write-protected
CREATE POLICY "profiles_update_self"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.is_admin          = is_admin
        AND p.is_banned         = is_banned
        AND p.balance_available = balance_available
        AND p.balance_pending   = balance_pending
        AND p.rating_as_customer    = rating_as_customer
        AND p.rating_as_executor    = rating_as_executor
        AND p.reviews_count_customer = reviews_count_customer
        AND p.reviews_count_executor = reviews_count_executor
    )
  );

-- Admin can update any profile (ban/unban, balance adjustments via service_role)
CREATE POLICY "profiles_update_admin"
  ON profiles FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (true);
