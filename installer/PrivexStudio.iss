#ifndef AppVersion
  #error AppVersion must be supplied by build-installer.ps1
#endif
#ifndef PayloadDir
  #error PayloadDir must be supplied by build-installer.ps1
#endif
#ifndef OutputDirPath
  #error OutputDirPath must be supplied by build-installer.ps1
#endif
#ifndef ReleaseChannel
  #error ReleaseChannel must be supplied by build-installer.ps1
#endif
#if (ReleaseChannel == "beta-unsigned") || (ReleaseChannel == "beta")
  #if ReleaseChannel == "beta-unsigned"
    #define DisplayName "Privex Studio Beta"
  #else
    #define DisplayName "Privex Studio Beta"
  #endif
  #define InstallFolder "Privex Studio Beta"
  #define ApplicationId "{3554F108-34ED-40A8-A45F-8B9223F30C1D}"
#else
  #define DisplayName "Privex Studio"
  #define InstallFolder "Privex Studio"
  #define ApplicationId "{9637A445-3D12-4EEC-84B4-3CCDB5A2C675}"
#endif

[Setup]
AppId={{#ApplicationId}
AppName={#DisplayName}
AppVersion={#AppVersion}
AppPublisher=Privex
AppPublisherURL=https://privex.site
AppSupportURL=https://privex.site
DefaultDirName={localappdata}\Programs\{#InstallFolder}
DefaultGroupName={#DisplayName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
DisableDirPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
WizardStyle=modern
SetupIconFile=privex-studio.ico
LicenseFile=TERMS.pt-BR.txt
OutputDir={#OutputDirPath}
OutputBaseFilename=Privex-Studio-{#AppVersion}-{#ReleaseChannel}-Windows-x64-Setup
Compression=lzma2
SolidCompression=yes
UninstallDisplayName={#DisplayName}
UninstallDisplayIcon={app}\Privex Studio.exe
CloseApplications=no
RestartApplications=no
SetupLogging=yes
#ifdef SignedBuild
SignTool=privex
SignedUninstaller=yes
#endif

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"; GroupDescription: "Atalhos:"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "TERMS.pt-BR.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#DisplayName}"; Filename: "{app}\Privex Studio.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\{#DisplayName}"; Filename: "{app}\Privex Studio.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Privex Studio.exe"; Description: "Abrir o Privex Studio"; Flags: nowait postinstall skipifsilent unchecked
Filename: "{app}\Privex Studio.exe"; Flags: nowait runasoriginaluser; Check: IsStudioUpdate

[UninstallDelete]
Type: files; Name: "{userappdata}\{#InstallFolder}\device.dpapi"
Type: files; Name: "{userappdata}\{#InstallFolder}\device.dpapi.tmp"

[Code]
function IsStudioUpdate(): Boolean;
begin
  Result := ExpandConstant('{param:PRIVEXUPDATE|0}') = '1';
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
#if ReleaseChannel == "beta-unsigned"
  if not WizardSilent then
    Result := MsgBox('Esta versão beta ainda não possui assinatura digital de publicador. O Windows pode mostrar alertas ou impedir a instalação conforme suas configurações. Deseja continuar a instalação?', mbConfirmation, MB_YESNO) = IDYES;
#endif
end;

function StudioIsClosed(): Boolean;
var
  Locator, Services, Processes: Variant;
begin
  Result := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('', 'root\CIMV2');
    Processes := Services.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''Privex Studio.exe'' OR Name = ''PrivexStudioEngine.exe''');
    Result := Processes.Count = 0;
  except
    Result := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Attempt: Integer;
begin
  Result := '';
  { The authorized updater exits after starting setup. Never kill a running live. }
  if IsStudioUpdate() then begin
    Log('Privex update: waiting for the Studio to close.');
    for Attempt := 1 to 45 do begin
      if StudioIsClosed() then Break;
      Sleep(1000);
    end;
  end;
  if not StudioIsClosed() then
    Result := 'Encerre sua live e feche o Privex Studio antes de instalar ou atualizar. O instalador não fecha transmissões automaticamente. Se o app já está fechado, reinicie o Windows e tente novamente.';
end;

function InitializeUninstall(): Boolean;
begin
  Result := StudioIsClosed();
  if not Result then
    MsgBox('Encerre sua live e feche o Privex Studio antes de desinstalar.', mbError, MB_OK);
end;
