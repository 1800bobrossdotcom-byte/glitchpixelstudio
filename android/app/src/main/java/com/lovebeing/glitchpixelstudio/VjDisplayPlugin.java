package com.lovebeing.glitchpixelstudio;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * VjDisplay — tells the web layer when an external display (USB-C HDMI /
 * DisplayPort, cast, DeX) is attached so Glitch Pixel Studio can drop its
 * chrome and go full-bleed for projector / VJ output, and keeps the screen
 * awake while it does. Android mirrors the activity to the external display
 * by default, so no Presentation surface is needed.
 */
@CapacitorPlugin(name = "VjDisplay")
public class VjDisplayPlugin extends Plugin {

    private DisplayManager displayManager;
    private DisplayManager.DisplayListener listener;

    @Override
    public void load() {
        displayManager = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
        listener = new DisplayManager.DisplayListener() {
            @Override public void onDisplayAdded(int displayId) { emit(); }
            @Override public void onDisplayRemoved(int displayId) { emit(); }
            @Override public void onDisplayChanged(int displayId) { /* size/rotation only */ }
        };
        displayManager.registerDisplayListener(listener, new Handler(Looper.getMainLooper()));
    }

    @Override
    protected void handleOnDestroy() {
        if (displayManager != null && listener != null) {
            displayManager.unregisterDisplayListener(listener);
        }
    }

    private JSObject state() {
        JSObject out = new JSObject();
        int external = 0;
        Display first = null;
        if (displayManager != null) {
            // Presentation-class displays only (HDMI / DisplayPort adapters, cast,
            // DeX). Foldable cover screens, always-on and virtual displays are
            // NOT in this category — counting them hid the UI on ordinary phones.
            for (Display d : displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)) {
                if (d.getDisplayId() == Display.DEFAULT_DISPLAY) continue;
                if (d.getState() == Display.STATE_OFF) continue;
                external++;
                if (first == null) first = d;
            }
        }
        out.put("externalCount", external);
        if (first != null) {
            out.put("name", first.getName());
            DisplayMetrics m = new DisplayMetrics();
            first.getRealMetrics(m);
            out.put("width", m.widthPixels);
            out.put("height", m.heightPixels);
        }
        return out;
    }

    private void emit() {
        notifyListeners("displayChange", state());
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }
}
