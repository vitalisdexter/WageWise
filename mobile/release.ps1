param(
    [ValidateRange(1, 2100000000)][int] $VersionCode = 5,
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$')][string] $VersionName = '2.0.0'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolchain = Join-Path $projectRoot '.android-toolchain'
if (!$env:JAVA_HOME) {
    $localJava = Get-ChildItem (Join-Path $toolchain 'jdk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$localJava) { throw 'Set JAVA_HOME to a JDK 21 installation.' }
    $env:JAVA_HOME = $localJava.FullName
}
if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $toolchain 'sdk' }
if (!(Test-Path (Join-Path $env:ANDROID_HOME 'platforms\android-36'))) { throw 'Install the Android 36 SDK and set ANDROID_HOME.' }
if (!$env:GRADLE_USER_HOME -and (Test-Path $toolchain)) { $env:GRADLE_USER_HOME = Join-Path $toolchain 'gradle' }

& npm.cmd --prefix $PSScriptRoot run sync
if ($LASTEXITCODE -ne 0) { throw 'Android asset sync failed.' }
$androidProject = Join-Path $PSScriptRoot 'android'
& (Join-Path $androidProject 'gradlew.bat') -p $androidProject --no-daemon `
    "-PwagewiseVersionCode=$VersionCode" "-PwagewiseVersionName=$VersionName" :app:testReleaseUnitTest :app:assembleRelease
if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }

$signing = Join-Path $projectRoot '.android-signing'
$null = New-Item -Path $signing -ItemType Directory -Force
$keystore = Join-Path $signing 'wagewise-release.p12'
$passwordFile = Join-Path $signing 'password.dpapi'
if ((Test-Path $keystore) -xor (Test-Path $passwordFile)) { throw 'Signing credentials are incomplete. Recover the original pair before proceeding.' }
try {
    if (!(Test-Path $keystore)) {
        $env:WAGEWISE_SIGNING_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
        $securePassword = ConvertTo-SecureString $env:WAGEWISE_SIGNING_PASSWORD -AsPlainText -Force
        $securePassword | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordFile -Encoding ascii
        & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -alias wagewise -keyalg RSA -keysize 3072 `
            -validity 10000 -storetype PKCS12 -keystore $keystore -storepass:env WAGEWISE_SIGNING_PASSWORD `
            -dname 'CN=WageWise Android Release'
        if ($LASTEXITCODE -ne 0) { throw 'Creating the signing key failed.' }
    } else {
        $securePassword = (Get-Content -LiteralPath $passwordFile -Raw).Trim() | ConvertTo-SecureString
        $env:WAGEWISE_SIGNING_PASSWORD = [Net.NetworkCredential]::new('', $securePassword).Password
    }

    $buildTools = Join-Path $env:ANDROID_HOME 'build-tools\36.0.0'
    $unsigned = Join-Path $androidProject 'app\build\outputs\apk\release\app-release-unsigned.apk'
    $release = Join-Path $PSScriptRoot 'releases'
    $null = New-Item -Path $release -ItemType Directory -Force
    $aligned = Join-Path $androidProject 'app\build\wagewise-aligned.apk'
    $apk = Join-Path $release "WageWise-$VersionName.apk"
    & (Join-Path $buildTools 'zipalign.exe') -P 16 -f 4 $unsigned $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    & (Join-Path $buildTools 'apksigner.bat') sign --ks $keystore --ks-key-alias wagewise --ks-pass env:WAGEWISE_SIGNING_PASSWORD `
        --out $apk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    Get-FileHash -LiteralPath $apk -Algorithm SHA256
} finally {
    Remove-Item Env:WAGEWISE_SIGNING_PASSWORD -ErrorAction SilentlyContinue
}
