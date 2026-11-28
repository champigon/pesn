param(
  [string]$SdkRoot=$env:ANDROID_HOME,
  [string]$JdkRoot=$env:JAVA_HOME,
  [string]$GradleCommand='gradle',
  [string]$SigningDirectory,
  [switch]$SkipChecks
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(!$SigningDirectory){$SigningDirectory=Join-Path (Split-Path $projectRoot) '.private/android-signing'}
$signingPath=[IO.Path]::GetFullPath($SigningDirectory)
if($signingPath.StartsWith($projectRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Signing files must be outside the public repository'}
if(!$SdkRoot -or !$JdkRoot){throw 'Set ANDROID_HOME and JAVA_HOME (Android SDK 35 and JDK 17)'}
$env:JAVA_HOME=[IO.Path]::GetFullPath($JdkRoot)
$env:ANDROID_HOME=[IO.Path]::GetFullPath($SdkRoot)
$buildConfig=[IO.File]::ReadAllText((Join-Path $projectRoot 'android/app/build.gradle.kts'))
$version=[regex]::Match($buildConfig,'versionName = "([^"]+)"').Groups[1].Value
$code=[int][regex]::Match($buildConfig,'versionCode = (\d+)').Groups[1].Value
if(!$version -or $code -lt 1){throw 'Missing Android version'}
$tasks=@(if($SkipChecks){'assembleRelease'}else{'testDebugUnitTest';'lintRelease';'assembleRelease'})
& $GradleCommand -p (Join-Path $projectRoot 'android') --no-daemon @tasks
if($LASTEXITCODE){throw 'Android build or checks failed'}
$key=Join-Path $signingPath 'release.keystore'
$passwordFile=Join-Path $signingPath 'release.password'
if(!(Test-Path $key)){
  if(Test-Path $passwordFile){throw 'Password exists but signing key is missing; restore the backup instead of creating a different key'}
  New-Item -ItemType Directory -Force -Path $signingPath | Out-Null
  $random=[byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($random)
  [IO.File]::WriteAllText($passwordFile,[Convert]::ToBase64String($random),[Text.UTF8Encoding]::new($false))
  & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $key -storetype PKCS12 -alias pesennik -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Pesennik, OU=Android, O=Pesennik' -storepass:file $passwordFile -keypass:file $passwordFile
  if($LASTEXITCODE){throw 'Signing key generation failed'}
}
if(!(Test-Path $passwordFile)){throw 'Signing password is missing; restore the private backup'}
$backup=Join-Path (Split-Path $signingPath) 'android-signing-backup'
New-Item -ItemType Directory -Force -Path $backup | Out-Null
Copy-Item -LiteralPath $key -Destination $backup
Copy-Item -LiteralPath $passwordFile -Destination $backup
$destination=Join-Path $projectRoot "outputs/android/$version"
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$aligned=Join-Path $destination 'aligned-unsigned.apk'
$apk=Join-Path $destination 'pesennik.apk'
$tools=Join-Path $env:ANDROID_HOME 'build-tools/35.0.0'
& (Join-Path $tools 'zipalign.exe') -f -p 4 (Join-Path $projectRoot 'android/app/build/outputs/apk/release/app-release-unsigned.apk') $aligned
if($LASTEXITCODE){throw 'APK alignment failed'}
& (Join-Path $tools 'apksigner.bat') sign --ks $key --ks-key-alias pesennik --ks-pass "file:$passwordFile" --out $apk $aligned
if($LASTEXITCODE){throw 'APK signing failed'}
& (Join-Path $tools 'apksigner.bat') verify --verbose --print-certs $apk
if($LASTEXITCODE){throw 'APK signature verification failed'}
$sha=(Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$metadata=[ordered]@{versionCode=$code;versionName=$version;apkUrl="https://github.com/champigon/pesn/releases/download/android-v$version/pesennik.apk";sha256=$sha}
[IO.File]::WriteAllText((Join-Path $destination 'android-update.json'),($metadata|ConvertTo-Json)+"`n",[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $destination 'SHA256SUMS'),"$sha  pesennik.apk`n",[Text.UTF8Encoding]::new($false))
Write-Output "Signed APK: $apk"
Write-Output 'Publish the APK in GitHub Releases first, then copy android-update.json to web/ and publish the site.'
