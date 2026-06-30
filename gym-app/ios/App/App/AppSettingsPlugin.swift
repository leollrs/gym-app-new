import Foundation
import Capacitor
import UIKit

// Opens iOS Settings → this app's permission page.
//
// There is no Capacitor core API to open the Settings app (@capacitor/app has
// no `openUrl`), and `app-settings:` can't be opened from the WKWebView via
// JS. The only reliable path is native: UIApplication.open(openSettingsURLString).
//
// Mirrors the Android `AppSettings` plugin (jsName + `open` method) so the JS
// side — registerPlugin('AppSettings') in src/lib/nativePlugins.js — drives
// both platforms with a single `AppSettings.open()` call.
@objc(AppSettingsPlugin)
public class AppSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    // Capacitor v6+ requires the bridged-plugin protocol so JS calls resolve.
    public let identifier = "AppSettingsPlugin"
    public let jsName = "AppSettings"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString),
                  UIApplication.shared.canOpenURL(url) else {
                call.reject("Cannot open app settings")
                return
            }
            UIApplication.shared.open(url, options: [:]) { success in
                if success {
                    call.resolve()
                } else {
                    call.reject("Failed to open app settings")
                }
            }
        }
    }
}
