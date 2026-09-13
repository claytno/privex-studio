# Code signing policy

## Current status

Application preparation only. SignPath Foundation has not accepted this project
and does not currently sponsor or sign Privex Studio. Released beta installers
are unsigned. Opening the repository does not resolve Smart App Control by itself.

## Proposed team

- Committer and reviewer: [claytno](https://github.com/claytno), project owner.
- Release approver: [claytno](https://github.com/claytno).
- External pull requests: reviewed by the maintainer before merge.
- The owner confirmed MFA is enabled on the GitHub account. MFA is also required
  on the SignPath account before it can approve a signing request.

Automated assistance is a development tool, not a substitute for the accountable
human release approver. Every production signing request requires manual approval.

## Proposed signing boundaries

Only project-built Privex Studio.exe, PrivexStudioEngine.exe and the official
installer/uninstaller may be signed as project artifacts. Upstream DLLs keep
their original signatures or remain unsigned; they must not be re-signed under
the Foundation certificate as if authored here. Metadata must match the approved
project name/version. The final installer includes license/source materials.

Artifacts must originate from reviewed public source, pinned dependencies and
verifiable build jobs. A local prebuilt binary is not proof of CI provenance.
Untrusted pull requests receive no signing credentials. Update metadata is
published only after verification of the final signed installer hash.

## Attribution after approval

Only after approval and configuration, replace the pending status with the
Foundation-required attribution: “Free code signing provided by SignPath.io,
certificate by SignPath Foundation”. Until then this is a proposed future
attribution, not a claim of an existing relationship.

Read [PRIVACY.md](PRIVACY.md) for automatic update queries and their opt-out.
Requirements: https://signpath.org/terms.html . Application: https://signpath.org/apply.html .
