package com.lovebeing.glitchpixelstudio;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int REQ_RUNTIME_PERMISSIONS = 4242;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Edge-to-edge before Capacitor sets up the window.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        super.onCreate(savedInstanceState);

        // Request CAMERA + RECORD_AUDIO up-front so the WebView's
        // navigator.mediaDevices.getUserMedia() can succeed without going
        // through Capacitor's BridgeWebChromeClient permissionLauncher path
        // (which on some devices fails silently when triggered from a
        // long-running JS callback). Capacitor's default WebChromeClient
        // still calls request.grant() once the OS perm is held.
        ensureRuntimePermissions();
    }

    private boolean hasPerm(String p) {
        return ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensureRuntimePermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        java.util.List<String> need = new java.util.ArrayList<>();
        if (!hasPerm(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
        if (!hasPerm(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
        if (!need.isEmpty()) {
            ActivityCompat.requestPermissions(this, need.toArray(new String[0]), REQ_RUNTIME_PERMISSIONS);
        }
    }
}
