-- Atomic deposit-request creation with per-user rate limiting.
--
-- The previous backend flow did COUNT then INSERT in two round-trips (TOCTOU):
-- concurrent requests could each read count < 3 and all insert, exceeding the
-- 3-per-hour limit. This SECURITY DEFINER function serialises per-user with a
-- transaction-scoped advisory lock so the count+insert is atomic.
--
-- Window: max(now - 1h, last_deposit_confirmed_at) — same as the app logic, so
-- a confirmed deposit resets the hourly window.

-- SETOF return so PostgREST yields an array and supabase-js .single() unwraps it.
DROP FUNCTION IF EXISTS create_deposit_request(uuid, numeric);

CREATE FUNCTION create_deposit_request(p_user_id uuid, p_amount numeric)
RETURNS SETOF deposit_requests
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_last  timestamptz;
  v_since timestamptz;
  v_count integer;
BEGIN
  -- Serialise concurrent deposit requests for this user within the transaction
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  SELECT last_deposit_confirmed_at INTO v_last FROM profiles WHERE id = p_user_id;
  v_since := GREATEST(now() - interval '1 hour', COALESCE(v_last, now() - interval '1 hour'));

  SELECT count(*) INTO v_count
  FROM deposit_requests
  WHERE user_id = p_user_id AND created_at >= v_since;

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'deposit_rate_limit' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    INSERT INTO deposit_requests (user_id, claimed_amount, status)
    VALUES (p_user_id, p_amount, 'pending')
    RETURNING *;
END;
$$;
