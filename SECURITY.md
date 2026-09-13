# Security policy

Report vulnerabilities privately to contato@privex.site. Include the affected
Studio version, reproduction steps and impact. Never include passwords, device
tokens, private keys, user conversations or real financial data in public issues.
There is currently no promised response SLA or paid bounty program.

The server is the authority for account permissions, eligibility, money, session
ownership and moderation. Knowledge of API routes is not authorization. Changes
to this client must not weaken server-side verification or Windows protections.

Security-sensitive files include main/, engine/, scripts/, installer/ and
.github/workflows/. Outside contributions require human review. Release signing
requires human approval and must never run with production secrets on a pull
request. Signing keys are not stored in this repository or in the application.

The Ed25519 key in main/update-public-key.pem verifies update metadata only.
It is not an Authenticode certificate and does not establish Windows publisher
trust. Authenticode/SignPath signing remains pending.
