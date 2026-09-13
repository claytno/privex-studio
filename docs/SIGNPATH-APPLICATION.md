# SignPath Foundation application draft

Status: prepared, not submitted. No acceptance, certificate or signed release
exists yet. A repository becoming public does not guarantee Foundation acceptance.

## Project information

- Project: Privex Studio
- Repository: https://github.com/claytno/privex-studio
- Maintainer, reviewer and proposed signing approver: claytno
- License: GPL-3.0-or-later
- Platform: Windows x64, Electron client with a C++ libobs media wrapper
- Public signing policy: CODE_SIGNING_POLICY.md
- Privacy policy: PRIVACY.md
- Security contact: contato@privex.site

## Description for the application

Privex Studio is a desktop broadcasting client for the age-restricted Privex
service. It authenticates a verified adult creator through a browser device flow,
previews selected capture sources and provides broadcast, chat, moderation and
interaction controls. It is intended for a service that permits adult content;
the client itself contains no user media or credentials. The hosted service and
its financial/account rules remain server-side and are not part of this project.

The published client is fully open source. Dependencies retain their licenses
and the distribution includes corresponding source archives and notices. We
request eligibility review for free project signing; we do not claim an existing
Foundation relationship or Windows publisher certificate.

## Questions to resolve with the Foundation

1. Is a fully open-source client for this independently operated commercial,
   age-restricted service eligible?
2. Does the proposed Electron packaging meet the artifact-origin/signing policy,
   including the rebranded Electron executable and upstream media DLLs?
3. Which native build job, artifact configuration and Inno installer/uninstaller
   signing flow should be used under the project's approved subscription?
4. Does the initial release history provide sufficient project reputation?

## Technical prerequisites still to complete

- Accept the application and configure the SignPath account/MFA.
- Build and validate native release artifacts on GitHub-hosted runners; local
  engine tests do not establish trusted CI provenance.
- Configure organization/project/artifact identifiers, signing policies and human
  approvers. Never put the API token or certificate material in source.
- Sign the allowed executable artifacts, preserve upstream signatures, construct
  and sign the installer/uninstaller, then verify the final Authenticode chain.
- Test the downloaded installer on Windows11 with Smart App Control active.
- Publish the final installer and its verified update metadata only after approval.

The owner confirmed GitHub MFA is enabled. This document does not submit a
request or accept third-party terms on the owner's behalf.

References: https://signpath.org/terms.html,
https://signpath.org/apply.html,
https://docs.signpath.io/trusted-build-systems/github .
