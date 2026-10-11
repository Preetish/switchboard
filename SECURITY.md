# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them
privately through GitHub: on the repository's **Security** tab, choose
**Report a vulnerability**.

Include what you found, how to reproduce it, and the impact you expect. You'll
get an acknowledgment within a few days and updates as it's fixed. Once a fix
is released, we're happy to credit you in the release notes if you'd like.

## Supported versions

Fixes go into the latest release. Switchboard is self-hosted, so please keep
your instance up to date (see [upgrading](docs/self-hosting.md#upgrading)).

## Scope

Switchboard handles lead contact details and OAuth tokens for your calendars
and CRM. Especially relevant:

- authentication or authorization bypasses (admin pages, the booking and
  availability API, rep connect links);
- ways to read or change another lead's data;
- token or secret disclosure;
- injection (SQL, email header, CSV/formula, HTML);
- rate-limit or abuse-protection bypasses.

The [self-hosting security checklist](docs/self-hosting.md#security-checklist)
covers deployment settings that are the operator's responsibility.
