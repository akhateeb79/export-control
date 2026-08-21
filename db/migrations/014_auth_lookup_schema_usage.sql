-- The no-login security-definer owner needs schema traversal only; table access remains SELECT-only.
GRANT USAGE ON SCHEMA public TO auth_lookup_owner;