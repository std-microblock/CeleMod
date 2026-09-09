package com.app.ralaunch.core.common;

/** Minimal adapter used by RAL's SDL controller integration, not a second settings store. */
public final class SettingsAccess {
    private static final SettingsAccess INSTANCE = new SettingsAccess();
    public static SettingsAccess getInstance() { return INSTANCE; }
    public boolean isVirtualControllerAsFirst() { return false; }
    public boolean isVirtualControllerEnabled() { return false; }
    public boolean isVirtualControllerVibrationEnabled() { return false; }
    public boolean isTouchEventEnabled() { return true; }
    public float getVirtualControllerVibrationIntensity() { return 0f; }
}
