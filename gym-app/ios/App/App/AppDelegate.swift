import UIKit
import Capacitor
import UserNotifications
import AudioToolbox

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // WatchConnectivity is handled by the @capgo/capacitor-watch plugin.
        // Do NOT set WCSession.default.delegate here — it conflicts with the plugin.

        // Register as notification delegate to handle foreground notifications
        // with enhanced sound + haptics for rest timer alerts
        UNUserNotificationCenter.current().delegate = self

        return true
    }

    // Present notifications as banners even when app is in foreground
    // and play extra haptic + sound for rest timer notifications
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Play a strong haptic pattern for rest-done notifications
        let id = notification.request.identifier
        let notifId = Int(id) ?? (notification.request.content.userInfo["id"] as? Int ?? 0)
        if notifId == 1001 { // REST_NOTIF_ID from JS
            // Triple haptic burst for attention
            let generator = UINotificationFeedbackGenerator()
            generator.prepare()
            generator.notificationOccurred(.success)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                generator.notificationOccurred(.warning)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                generator.notificationOccurred(.success)
            }
            // Play system alert sound (louder than default notification)
            AudioServicesPlayAlertSound(SystemSoundID(1304)) // alarm-like tone
        }

        // Show banner + badge + sound even in foreground
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .sound, .badge])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // ── Push Notifications ──────────────────────────────────────────────────
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
}
