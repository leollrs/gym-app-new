package com.tugympr.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Direct share to Instagram Stories — Android counterpart of the iOS
 * InstagramSharePlugin.swift. Same JS surface (registerPlugin('InstagramShare')):
 *   isInstagramInstalled() -> { installed }
 *   shareToStory({ backgroundImage, stickerImage, backgroundTopColor,
 *                  backgroundBottomColor, contentURL, sourceApp })
 *
 * iOS passes the image via UIPasteboard; Android uses Instagram's documented
 * `com.instagram.share.ADD_TO_STORY` intent. The image can't be base64 over an
 * intent, so we decode it to a temp file in cache/ig_share/ and hand Instagram
 * a content:// URI via the app's existing FileProvider
 * (${applicationId}.fileprovider → @xml/file_paths cache-path "ig_share/"),
 * granting IG read permission on it.
 *
 * Modes mirror iOS:
 *   background only            → full-screen Story background.
 *   sticker only               → sticker over the top/bottom gradient; the
 *                                user can swap in their own photo (Strava).
 *   background + sticker        → sticker on top of the background.
 */
@CapacitorPlugin(name = "InstagramShare")
public class InstagramSharePlugin extends Plugin {

    private static final String IG_PACKAGE = "com.instagram.android";
    private static final String ADD_TO_STORY = "com.instagram.share.ADD_TO_STORY";

    @PluginMethod
    public void isInstagramInstalled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("installed", isIgInstalled());
        call.resolve(ret);
    }

    @PluginMethod
    public void shareToStory(PluginCall call) {
        String backgroundImage = call.getString("backgroundImage");
        String stickerImage    = call.getString("stickerImage");
        String topColor        = call.getString("backgroundTopColor", "#05070B");
        String bottomColor     = call.getString("backgroundBottomColor", "#0A0D10");
        String sourceApp       = call.getString("sourceApp", getContext().getPackageName());

        if (backgroundImage == null && stickerImage == null) {
            call.reject("Must provide at least backgroundImage or stickerImage");
            return;
        }
        if (!isIgInstalled()) {
            call.reject("Instagram is not installed");
            return;
        }

        try {
            Activity activity = getActivity();
            String authority = getContext().getPackageName() + ".fileprovider";

            Intent intent = new Intent(ADD_TO_STORY);
            intent.setPackage(IG_PACKAGE);
            intent.putExtra("source_application", sourceApp);
            intent.putExtra("top_background_color", topColor);
            intent.putExtra("bottom_background_color", bottomColor);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Uri bgUri = writeTempImage(backgroundImage, "bg.png");
            Uri stickerUri = writeTempImage(stickerImage, "sticker.png");

            if (bgUri != null) {
                intent.setDataAndType(bgUri, "image/png");
                activity.grantUriPermission(IG_PACKAGE, bgUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                // sticker-only: no background asset, IG fills with the gradient
                intent.setType("image/*");
            }
            if (stickerUri != null) {
                intent.putExtra("interactive_asset_uri", stickerUri);
                activity.grantUriPermission(IG_PACKAGE, stickerUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }

            if (intent.resolveActivity(getContext().getPackageManager()) != null) {
                activity.startActivityForResult(intent, 0);
                call.resolve();
            } else {
                call.reject("Instagram Stories not available");
            }
        } catch (Exception e) {
            call.reject("shareToStory failed: " + e.getMessage(), e);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────
    private boolean isIgInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo(IG_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    // Decode a `data:image/png;base64,...` (or bare base64) string to a temp
    // file in cache/ig_share/ and return its FileProvider content:// URI.
    private Uri writeTempImage(String raw, String name) throws Exception {
        if (raw == null) return null;
        String b64 = raw.contains(",") ? raw.substring(raw.indexOf(',') + 1) : raw;
        byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
        if (bytes == null || bytes.length == 0) return null;

        File dir = new File(getContext().getCacheDir(), "ig_share");
        if (!dir.exists()) dir.mkdirs();
        File file = new File(dir, name);
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(bytes);
        }
        String authority = getContext().getPackageName() + ".fileprovider";
        return FileProvider.getUriForFile(getContext(), authority, file);
    }
}
