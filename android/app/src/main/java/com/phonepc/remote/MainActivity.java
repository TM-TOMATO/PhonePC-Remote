package com.phonepc.remote;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {

    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final int FILE_CHOOSER_REQUEST_CODE = 1002;
    private static final int UNKNOWN_SOURCES_REQUEST_CODE = 1003;

    private WebView mWebView;
    private ValueCallback<Uri[]> mFilePathCallback;
    private Vibrator mVibrator;
    private PermissionRequest mPendingPermissionRequest;
    private File mPendingInstallFile;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep screen on while remote control is active
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        mVibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);

        mWebView = new WebView(this);
        setContentView(mWebView);

        configureWebView();

        // Check & request camera and audio permissions on app startup
        checkAndRequestPermissions();

        // Load bundled web app from assets (with deep link query parameters if launched via camera/QR/intent)
        String initialUrl = resolveInitialUrl(getIntent());
        mWebView.loadUrl(initialUrl);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (mWebView != null) {
            mWebView.onResume();
            mWebView.resumeTimers();
            mWebView.evaluateJavascript("if (typeof window.handleAppResume === 'function') { window.handleAppResume(); }", null);
        }
        if (getRequestedOrientation() == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) {
            hideSystemUI();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (mWebView != null) {
            mWebView.onPause();
        }
    }

    @Override
    protected void onDestroy() {
        if (mWebView != null) {
            mWebView.destroy();
            mWebView = null;
        }
        super.onDestroy();
    }

    private String resolveInitialUrl(Intent intent) {
        String baseUrl = "file:///android_asset/web/index.html";
        if (intent == null || intent.getData() == null) {
            return baseUrl;
        }

        try {
            Uri uri = intent.getData();
            String scheme = uri.getScheme();
            String id = uri.getQueryParameter("id");
            String pin = uri.getQueryParameter("pin");
            String host = uri.getQueryParameter("host");
            String proto = uri.getQueryParameter("proto");

            if ("phonepc".equalsIgnoreCase(scheme)) {
                if (proto == null || proto.isEmpty()) {
                    proto = "http";
                }
            } else if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                if (host == null || host.isEmpty()) {
                    host = uri.getAuthority();
                }
                if (proto == null || proto.isEmpty()) {
                    proto = scheme;
                }
            }

            if (id != null && !id.isEmpty() && pin != null && !pin.isEmpty()) {
                StringBuilder sb = new StringBuilder(baseUrl);
                sb.append("?id=").append(Uri.encode(id));
                sb.append("&pin=").append(Uri.encode(pin));
                if (host != null && !host.isEmpty()) {
                    sb.append("&host=").append(Uri.encode(host));
                }
                if (proto != null && !proto.isEmpty()) {
                    sb.append("&proto=").append(Uri.encode(proto));
                }
                return sb.toString();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        return baseUrl;
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null || intent.getData() == null || mWebView == null) {
            return;
        }

        try {
            Uri uri = intent.getData();
            String scheme = uri.getScheme();
            String id = uri.getQueryParameter("id");
            String pin = uri.getQueryParameter("pin");
            String host = uri.getQueryParameter("host");
            String proto = uri.getQueryParameter("proto");

            if ("phonepc".equalsIgnoreCase(scheme)) {
                if (proto == null || proto.isEmpty()) proto = "http";
            } else if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                if (host == null || host.isEmpty()) host = uri.getAuthority();
                if (proto == null || proto.isEmpty()) proto = scheme;
            }

            if (id != null && !id.isEmpty() && pin != null && !pin.isEmpty()) {
                final String fId = id.replace("'", "\\'");
                final String fPin = pin.replace("'", "\\'");
                final String fHost = (host != null) ? host.replace("'", "\\'") : "";
                final String fProto = (proto != null) ? proto.replace("'", "\\'") : "http";

                runOnUiThread(() -> {
                    String js = String.format(
                        "if (typeof window.handleDeepLinkConnect === 'function') { " +
                        "  window.handleDeepLinkConnect('%s', '%s', '%s', '%s'); " +
                        "} else { " +
                        "  window.location.href = 'file:///android_asset/web/index.html?id=%s&pin=%s&host=%s&proto=%s'; " +
                        "}",
                        fId, fPin, fHost, fProto,
                        fId, fPin, fHost, fProto
                    );
                    mWebView.evaluateJavascript(js, null);
                });
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            java.util.List<String> needed = new java.util.ArrayList<>();
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.CAMERA);
            }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.RECORD_AUDIO);
            }
            if (!needed.isEmpty()) {
                requestPermissions(needed.toArray(new String[0]), PERMISSION_REQUEST_CODE);
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = mWebView.getSettings();

        // Enable hardware acceleration
        mWebView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        // Essential WebSettings
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        // Zoom settings
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // Cache settings
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Add native JavaScript bridge
        mWebView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");

        // Download listener for handling direct APK links or browser downloads
        mWebView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                if (url.endsWith(".apk") || (mimetype != null && mimetype.contains("android.package-archive")) || url.contains("/download/apk")) {
                    downloadAndInstallApk(url);
                } else {
                    try {
                        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(i);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "다운로드 링크 열기 실패", Toast.LENGTH_SHORT).show();
                    }
                }
            }
        });

        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.endsWith(".apk") || url.contains("/download/apk")) {
                    downloadAndInstallApk(url);
                    return true;
                }
                if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
                    view.loadUrl(url);
                    return true;
                }
                return false;
            }
        });

        mWebView.setWebChromeClient(new WebChromeClient() {
            // Handle WebRTC Camera & Audio permission request from webview
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            mPendingPermissionRequest = request;
                            requestPermissions(new String[]{Manifest.permission.CAMERA}, PERMISSION_REQUEST_CODE);
                            return;
                        }
                    }
                    request.grant(request.getResources());
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                super.onPermissionRequestCanceled(request);
                if (mPendingPermissionRequest == request) {
                    mPendingPermissionRequest = null;
                }
            }

            // Support camera file upload via <input type="file" accept="image/*" capture="environment">
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (mFilePathCallback != null) {
                    mFilePathCallback.onReceiveValue(null);
                }
                mFilePathCallback = filePathCallback;

                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE);
                } catch (Exception e) {
                    mFilePathCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (mFilePathCallback == null) return;
            mFilePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            mFilePathCallback = null;
        } else if (requestCode == UNKNOWN_SOURCES_REQUEST_CODE) {
            if (mPendingInstallFile != null && mPendingInstallFile.exists()) {
                promptInstallApk(mPendingInstallFile);
                mPendingInstallFile = null;
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            boolean cameraGranted = false;
            for (int i = 0; i < permissions.length; i++) {
                if (Manifest.permission.CAMERA.equals(permissions[i]) && grantResults[i] == PackageManager.PERMISSION_GRANTED) {
                    cameraGranted = true;
                    break;
                }
            }

            if (mPendingPermissionRequest != null) {
                if (cameraGranted) {
                    mPendingPermissionRequest.grant(mPendingPermissionRequest.getResources());
                } else {
                    mPendingPermissionRequest.deny();
                }
                mPendingPermissionRequest = null;
            }

            if (cameraGranted) {
                mWebView.evaluateJavascript("if (window.onCameraPermissionGranted) { window.onCameraPermissionGranted(); }", null);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (mWebView.canGoBack()) {
            mWebView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /**
     * Download an APK from URL and trigger system installation
     */
    public void downloadAndInstallApk(final String downloadUrl) {
        if (downloadUrl == null || downloadUrl.trim().isEmpty()) {
            Toast.makeText(this, "다운로드할 URL이 올바르지 않습니다.", Toast.LENGTH_SHORT).show();
            return;
        }

        runOnUiThread(() -> Toast.makeText(this, "📥 최신 앱 다운로드 중... 잠시만 기다려주세요.", Toast.LENGTH_LONG).show());

        new Thread(() -> {
            InputStream in = null;
            FileOutputStream out = null;
            HttpURLConnection conn = null;
            try {
                URL url = new URL(downloadUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "PhonePC-Remote-Android");
                conn.connect();

                int status = conn.getResponseCode();
                // Handle HTTP redirects (GitHub Releases redirect 302 to CDN)
                int redirects = 0;
                while ((status == HttpURLConnection.HTTP_MOVED_TEMP
                        || status == HttpURLConnection.HTTP_MOVED_PERM
                        || status == 307
                        || status == 308) && redirects < 5) {
                    String redirectUrl = conn.getHeaderField("Location");
                    conn.disconnect();
                    url = new URL(redirectUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("User-Agent", "PhonePC-Remote-Android");
                    conn.connect();
                    status = conn.getResponseCode();
                    redirects++;
                }

                if (status != HttpURLConnection.HTTP_OK) {
                    throw new Exception("HTTP 응답 코드: " + status);
                }

                File cacheDir = getCacheDir();
                File apkFile = new File(cacheDir, "update.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                in = conn.getInputStream();
                out = new FileOutputStream(apkFile);
                byte[] buffer = new byte[8192];
                int len;
                while ((len = in.read(buffer)) != -1) {
                    out.write(buffer, 0, len);
                }
                out.flush();

                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "✅ 다운로드 완료! 설치 화면을 엽니다.", Toast.LENGTH_SHORT).show();
                    promptInstallApk(apkFile);
                });

            } catch (final Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "다운로드 실패: " + e.getMessage(), Toast.LENGTH_LONG).show());
            } finally {
                try { if (in != null) in.close(); } catch (Exception ignored) {}
                try { if (out != null) out.close(); } catch (Exception ignored) {}
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void promptInstallApk(File apkFile) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!getPackageManager().canRequestPackageInstalls()) {
                    mPendingInstallFile = apkFile;
                    Intent settingsIntent = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    settingsIntent.setData(Uri.parse("package:" + getPackageName()));
                    startActivityForResult(settingsIntent, UNKNOWN_SOURCES_REQUEST_CODE);
                    Toast.makeText(this, "업데이트 설치를 위해 '이 출처의 앱 허용'을 활성화해주세요.", Toast.LENGTH_LONG).show();
                    return;
                }
            }

            Uri apkUri = Uri.parse("content://com.phonepc.remote.fileprovider/" + apkFile.getName());
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(installIntent);
        } catch (Exception e) {
            Toast.makeText(this, "설치 화면 호출 실패: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /**
     * Native JavaScript Interface exposed to web JS as window.AndroidBridge
     */
    public class WebAppInterface {

        @JavascriptInterface
        public void requestCameraPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, PERMISSION_REQUEST_CODE);
                    } else {
                        mWebView.evaluateJavascript("if (window.onCameraPermissionGranted) { window.onCameraPermissionGranted(); }", null);
                    }
                } else {
                    mWebView.evaluateJavascript("if (window.onCameraPermissionGranted) { window.onCameraPermissionGranted(); }", null);
                }
            });
        }

        @JavascriptInterface
        public boolean hasCameraPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
            }
            return true;
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "설정 화면을 열 수 없습니다.", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void lockLandscape() {
            runOnUiThread(() -> {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                hideSystemUI();
            });
        }

        @JavascriptInterface
        public void lockPortrait() {
            runOnUiThread(() -> {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                showSystemUI();
            });
        }

        @JavascriptInterface
        public void unlockOrientation() {
            runOnUiThread(() -> {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            });
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            if (mVibrator != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    mVibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    mVibrator.vibrate(ms);
                }
            }
        }

        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public String getAppVersionName() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "2.2.0";
            }
        }

        @JavascriptInterface
        public int getAppVersionCode() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            } catch (Exception e) {
                return 220;
            }
        }

        @JavascriptInterface
        public void downloadAndInstallApk(String url) {
            MainActivity.this.downloadAndInstallApk(url);
        }
    }

    private void hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
            );
        }
    }

    private void showSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }
}
