import Foundation
import Capacitor
import UIKit

// Direct deep-link share to Instagram Stories.
//
// iOS share sheet → "pick Instagram → tap Story" is 3 taps. The official
// `instagram-stories://share` URL scheme is one tap: iOS jumps straight into
// the IG Stories composer with our image pre-loaded. The catch is the image
// has to be passed via UIPasteboard (Instagram reads it from the system
// pasteboard with specific keys), not as a URL parameter — which means we
// need native code, not a pure-JS Capacitor call.
//
// Usage from JS:
//   InstagramShare.shareToStory({
//     backgroundImage: 'data:image/png;base64,...', // full-bleed background
//     stickerImage:    'data:image/png;base64,...', // optional transparent sticker
//     contentURL:      'https://tugympr.app/...',   // deep link back to us
//   })
//
// Modes:
// 1. backgroundImage only          → IG shows that image as the Story background.
// 2. stickerImage only             → IG places the sticker on a black background;
//                                    user can then swap to a photo via IG's
//                                    "Add photo" button (this is the Strava
//                                    Stats Sticker pattern).
// 3. backgroundImage + sticker     → IG places sticker on top of background.

@objc(InstagramSharePlugin)
public class InstagramSharePlugin: CAPPlugin, CAPBridgedPlugin {
    // Capacitor v6+ requires the bridged-plugin protocol with explicit
    // identifier/jsName/pluginMethods so the JS side can locate the plugin
    // via `registerPlugin('InstagramShare')`. Without these the plugin
    // registers fine on the native side but every JS call rejects, which
    // dropped us back to the native share sheet — the multi-tap detour
    // we were trying to skip.
    public let identifier = "InstagramSharePlugin"
    public let jsName = "InstagramShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isInstagramInstalled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareToStory", returnType: CAPPluginReturnPromise),
    ]

    private let pasteboardKeyBg     = "com.instagram.sharedSticker.backgroundImage"
    private let pasteboardKeySticker = "com.instagram.sharedSticker.stickerImage"
    private let pasteboardKeyTop    = "com.instagram.sharedSticker.backgroundTopColor"
    private let pasteboardKeyBottom = "com.instagram.sharedSticker.backgroundBottomColor"
    private let pasteboardKeyURL    = "com.instagram.sharedSticker.contentURL"

    // Strip the optional `data:image/png;base64,` prefix and turn the rest
    // into raw Data. Returns nil if the string isn't valid base64.
    private func dataFromBase64(_ raw: String?) -> Data? {
        guard let raw = raw else { return nil }
        let stripped: String
        if let commaIdx = raw.firstIndex(of: ",") {
            stripped = String(raw[raw.index(after: commaIdx)...])
        } else {
            stripped = raw
        }
        return Data(base64Encoded: stripped, options: .ignoreUnknownCharacters)
    }

    @objc func isInstagramInstalled(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let installed: Bool
            if let url = URL(string: "instagram-stories://share") {
                installed = UIApplication.shared.canOpenURL(url)
            } else {
                installed = false
            }
            call.resolve(["installed": installed])
        }
    }

    @objc func shareToStory(_ call: CAPPluginCall) {
        let backgroundImage = call.getString("backgroundImage")
        let stickerImage    = call.getString("stickerImage")
        let topColor        = call.getString("backgroundTopColor")    ?? "#05070B"
        let bottomColor     = call.getString("backgroundBottomColor") ?? "#0A0D10"
        let contentURL      = call.getString("contentURL")            ?? "https://tugympr.app"
        let sourceApp       = call.getString("sourceApp")             ?? "com.tugympr.app"

        if backgroundImage == nil && stickerImage == nil {
            call.reject("Must provide at least backgroundImage or stickerImage")
            return
        }

        guard let storiesURL = URL(string: "instagram-stories://share?source_application=\(sourceApp)") else {
            call.reject("Could not build Instagram URL")
            return
        }

        DispatchQueue.main.async {
            guard UIApplication.shared.canOpenURL(storiesURL) else {
                call.reject("Instagram is not installed")
                return
            }

            var item: [String: Any] = [
                self.pasteboardKeyTop:    topColor,
                self.pasteboardKeyBottom: bottomColor,
                self.pasteboardKeyURL:    contentURL,
            ]
            if let bgData = self.dataFromBase64(backgroundImage) {
                item[self.pasteboardKeyBg] = bgData
            }
            if let stickerData = self.dataFromBase64(stickerImage) {
                item[self.pasteboardKeySticker] = stickerData
            }

            if item[self.pasteboardKeyBg] == nil && item[self.pasteboardKeySticker] == nil {
                call.reject("Failed to decode provided image(s)")
                return
            }

            // Pasteboard items expire after 5 minutes — plenty of time for IG to
            // pick them up but short enough that we don't leave images sitting on
            // the system pasteboard.
            let expirationDate = Date(timeIntervalSinceNow: 60 * 5)
            UIPasteboard.general.setItems([item], options: [
                UIPasteboard.OptionsKey.expirationDate: expirationDate,
            ])

            UIApplication.shared.open(storiesURL, options: [:]) { success in
                if success {
                    call.resolve()
                } else {
                    call.reject("Failed to open Instagram Stories")
                }
            }
        }
    }
}
