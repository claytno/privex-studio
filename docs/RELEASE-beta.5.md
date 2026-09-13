# Studio 0.2.0-beta.5

This beta adds device discovery, source changes during a broadcast, independent
microphone/desktop gain and audio meters, audience counts and creator-only
audience pagination. It includes the matching viewer chat and live goal controls.

The beta installer keeps the previous application identity and update public key.
Updates require confirmation and cannot install during a broadcast. The installer
does not terminate a running Studio. Publisher Authenticode signing remains pending.

## Native runtime provenance

This local beta reuses the pinned upstream media runtime. The only upstream
modification affecting its build metadata is included in
`native-runtime-branding.patch.txt`: product name and website resource strings.
Apply it with `git apply docs/native-runtime-branding.patch.txt` from the upstream
checkout using the actual path to this client file. No media implementation files
were modified. Legacy frontend and plugin changes from that build are excluded
from the runtime shipped by this client. The new custom engine is compiled from
this release's `engine` sources. This is not a clean hosted CI provenance claim.

The supplied upstream archive contains the pinned original sources; this client
archive contains the metadata patch and the build scripts. Dependency source
archives and licenses remain included in the installer.
