-- Nicknames double as the profile URL slug (GET /profile/:idOrNickname/public
-- and friends now accept either). Enforce case-insensitive uniqueness so two
-- users can't collide on the same link. NULL nicknames are unaffected (a
-- unique index allows any number of NULLs).
--
-- If this fails with a duplicate-key error, find and rename the collisions
-- first:
--   SELECT lower(nickname), array_agg(id) FROM profiles
--   WHERE nickname IS NOT NULL GROUP BY lower(nickname) HAVING count(*) > 1;

CREATE UNIQUE INDEX profiles_nickname_lower_idx ON profiles (lower(nickname));
