# Build Standalone APK for PhonePC Remote
$ErrorActionPreference = "Stop"

$BUILD_TOOLS = "C:\Users\user\android-sdk\build-tools\34.0.0"
$PLATFORM_JAR = "C:\Users\user\android-sdk\platforms\android-34\android.jar"
$JAVA_HOME = "C:\Program Files\Java\jdk-17"
$JAVAC = "$JAVA_HOME\bin\javac.exe"
$KEYTOOL = "$JAVA_HOME\bin\keytool.exe"

$AAPT2 = "$BUILD_TOOLS\aapt2.exe"
$D8 = "$BUILD_TOOLS\d8.bat"
$ZIPALIGN = "$BUILD_TOOLS\zipalign.exe"
$APKSIGNER = "$BUILD_TOOLS\apksigner.bat"

Write-Host "==> [1/7] Cleaning and preparing build directories..."
$BUILD_DIR = "build_apk"
if (Test-Path $BUILD_DIR) { Remove-Item -Recurse -Force $BUILD_DIR }
New-Item -ItemType Directory -Force -Path "$BUILD_DIR\gen" | Out-Null
New-Item -ItemType Directory -Force -Path "$BUILD_DIR\classes" | Out-Null
New-Item -ItemType Directory -Force -Path "$BUILD_DIR\dex" | Out-Null

Write-Host "==> [2/7] Compiling Android resources with AAPT2..."
& $AAPT2 compile --dir "android\app\src\main\res" -o "$BUILD_DIR\compiled_res.zip"

Write-Host "==> [3/7] Linking resources and generating R.java..."
& $AAPT2 link `
    -o "$BUILD_DIR\unaligned.apk" `
    -I $PLATFORM_JAR `
    --manifest "android\app\src\main\AndroidManifest.xml" `
    --min-sdk-version 24 `
    --target-sdk-version 34 `
    --version-code 220 `
    --version-name "2.2.0" `
    --java "$BUILD_DIR\gen" `
    -A "android\app\src\main\assets" `
    --auto-add-overlay `
    "$BUILD_DIR\compiled_res.zip"

Write-Host "==> [4/7] Compiling Java source files with javac..."
$javaFiles = @(Get-ChildItem -Recurse "$BUILD_DIR\gen", "android\app\src\main\java" -Filter "*.java" | ForEach-Object { $_.FullName })
& $JAVAC -encoding UTF-8 -source 1.8 -target 1.8 -cp $PLATFORM_JAR -d "$BUILD_DIR\classes" $javaFiles

Write-Host "==> [5/7] Converting Java bytecode to Dalvik Executable (classes.dex) with D8..."
$classFiles = @(Get-ChildItem -Recurse "$BUILD_DIR\classes" -Filter "*.class" | ForEach-Object { $_.FullName })
& $D8 --min-api 24 --output "$BUILD_DIR\dex" --lib $PLATFORM_JAR $classFiles

Write-Host "==> [6/7] Adding classes.dex to APK and Zipaligning..."
# Use Python to append classes.dex into unaligned.apk
& C:\Python314\python.exe -c "
import zipfile
with zipfile.ZipFile('$BUILD_DIR/unaligned.apk', 'a', zipfile.ZIP_DEFLATED) as zf:
    zf.write('$BUILD_DIR/dex/classes.dex', 'classes.dex')
print('classes.dex added successfully!')
"

$OUTPUT_APK = "PhonePC_Remote_v2.2.0.apk"
if (Test-Path $OUTPUT_APK) { Remove-Item -Force $OUTPUT_APK }
& $ZIPALIGN -p -f -v 4 "$BUILD_DIR\unaligned.apk" $OUTPUT_APK

Write-Host "==> [7/7] Signing APK with debug keystore..."
$KEYSTORE = "debug.keystore"
if (-not (Test-Path $KEYSTORE)) {
    & $KEYTOOL -genkey -v -keystore $KEYSTORE -alias debug -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=PhonePC Remote,OU=Dev,O=PhonePC,L=Seoul,S=Seoul,C=KR"
}

& $APKSIGNER sign --ks $KEYSTORE --ks-pass pass:android --ks-key-alias debug --key-pass pass:android $OUTPUT_APK

Write-Host "==> Verifying signature..."
& $APKSIGNER verify $OUTPUT_APK

Write-Host "`n[SUCCESS] Android APK created successfully:"
Get-Item $OUTPUT_APK | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
