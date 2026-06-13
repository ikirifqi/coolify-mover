# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.7.0] - 2026-06-13

### Fixed
- **SSH key lookup failing with `ssh_key@0 not found`** (#3, #4). The database
  reader ran `psql -A` (pipe-delimited) and split rows on `|`. Any column value
  containing a pipe, comma or newline — most notably the servers `proxy` blob
  (e.g. `443:443/udp`) — shifted every later column, so `private_key_uuid`
  resolved to `undefined` and the SSH key path fell back to the numeric id
  (`ssh_key@0`). The reader now uses `psql --csv` with a proper RFC‑4180 CSV
  parser, so quoted values containing pipes/commas/newlines are parsed
  correctly. This hardens **every** `SELECT *` query, not just server lookups.

### Thanks
- @MarijnFK for the precise root‑cause diagnosis on #3.
- @jcanning for reporting the same failure on multi‑node instances (#4).
