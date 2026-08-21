-- Splits the profile URL from the display name: nickname stays a free-text
-- display name (already unique via profiles_nickname_lower_idx), profile_slug
-- is a new, separately editable, url-safe identifier used for /users/:slug.
-- NULL slugs are unaffected (a unique index allows any number of NULLs).

ALTER TABLE profiles ADD COLUMN profile_slug text;

CREATE UNIQUE INDEX profiles_slug_lower_idx ON profiles (lower(profile_slug));

COMMENT ON COLUMN profiles.profile_slug IS
  'User-chosen URL slug for their public profile link (/users/:slug). '
  'Distinct from nickname (the display name) — see backend/src/routes/profile.js.';
