# UX reference library

Short, cited summaries the ux-reviewer pulls into its findings, one file per topic. Written in our own words with a link; never copied text. Find entries with `node scripts/ux-refs.mjs search <words>`; check a review with `node scripts/ux-refs.mjs cite <review.md> --topics dark,contrast`.

Entry format (one `##` heading per entry): `## DARK-1 Title`, then `- strength:` (`hard` = checked and listed in every review of that topic, `guide` = judgment), `- status:` (`fetched` = the page was read in a session, `search-summary` = known only from a search summary and to be confirmed by a fetch, `pending` = source blocked or not yet read), `- source:` (https link), `- tags:`, then the paraphrase. Only `hard` entries with a `fetched` or `search-summary` status are enforced; `pending` ones are listed as open.

To add a source: fetch it, write the paraphrase (600 characters or less), add the entry, and run `node --test tests/ux-refs.test.mjs`. If a fetch is blocked, add a `pending` entry that says so, and list the host in HANDOFF.md.
