import Capacitor
import CoreLocation

@objc(BackgroundLocationPlugin)
public class BackgroundLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "BackgroundLocationPlugin"
    public let jsName = "BackgroundLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        .init(name: "start", returnType: CAPPluginReturnPromise),
        .init(name: "stop", returnType: CAPPluginReturnPromise),
        .init(name: "isRunning", returnType: CAPPluginReturnPromise),
        .init(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        .init(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        .init(name: "getLastLocation", returnType: CAPPluginReturnPromise),
    ]

    private var locationManager: CLLocationManager?
    private var pendingPermissionCall: CAPPluginCall?
    // Set when start() is called before iOS has resolved the permission
    // dialog. The auth-change delegate kicks off updates once granted.
    private var startWhenAuthorized = false
    // True while startUpdatingLocation is active. Lets start() be idempotent —
    // calling it twice (e.g. picker pre-warm + tap Start) doesn't tear down
    // the active GPS session and lose the warm fix.
    private var isUpdating = false
    // Cached last fix. Returned by getLastLocation so the JS layer can show
    // a fresh map immediately on tap-Start without waiting for the next fix.
    private var lastLocationDict: [String: Any]?

    private func statusString(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        // CLLocationManager must be created on the main thread, otherwise
        // its delegate callbacks can be delivered on a non-main run loop and
        // silently never reach the listeners.
        DispatchQueue.main.async {
            let status: CLAuthorizationStatus
            if #available(iOS 14.0, *) {
                let mgr = self.locationManager ?? CLLocationManager()
                status = mgr.authorizationStatus
                self.locationManager = mgr
            } else {
                status = CLLocationManager.authorizationStatus()
            }
            call.resolve(["location": self.statusString(status)])
        }
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let mgr = self.locationManager ?? CLLocationManager()
            mgr.delegate = self
            self.locationManager = mgr

            let current: CLAuthorizationStatus
            if #available(iOS 14.0, *) {
                current = mgr.authorizationStatus
            } else {
                current = CLLocationManager.authorizationStatus()
            }

            // If already decided, resolve immediately.
            if current != .notDetermined {
                call.resolve(["location": self.statusString(current)])
                return
            }

            // Otherwise, stash the call and fire the system prompt. The delegate
            // callback resolves the call once iOS reports the user's decision.
            call.keepAlive = true
            self.pendingPermissionCall = call
            mgr.requestWhenInUseAuthorization()
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Idempotent: if updates are already running (e.g. picker
            // pre-warmed GPS, then user tapped Start), don't tear down the
            // warm session. Just resolve and let the new listener pick up
            // the next fix — the JS bridge also calls getLastLocation()
            // immediately after attaching so no fix is lost.
            if self.isUpdating, self.locationManager != nil {
                NSLog("[BackgroundLocation] start() — already running, no-op")
                call.resolve(["started": true, "alreadyRunning": true])
                return
            }

            // Always create a fresh CLLocationManager on the main thread.
            // Reusing a manager that was instantiated on a background thread
            // (e.g. by a Capacitor plugin call resolved off-main) leaves it
            // bound to the wrong run loop, and didUpdateLocations never fires.
            let mgr = CLLocationManager()
            mgr.delegate = self
            mgr.desiredAccuracy = kCLLocationAccuracyBest
            // 3m floor cuts wake-ups when stationary. The JS layer still
            // applies a Haversine-based jitter filter on top.
            mgr.distanceFilter = 3
            mgr.pausesLocationUpdatesAutomatically = false
            mgr.activityType = .fitness
            self.locationManager = mgr

            let currentStatus: CLAuthorizationStatus
            if #available(iOS 14.0, *) {
                currentStatus = mgr.authorizationStatus
            } else {
                currentStatus = CLLocationManager.authorizationStatus()
            }
            NSLog("[BackgroundLocation] start called. authorization=%d", currentStatus.rawValue)

            switch currentStatus {
            case .authorizedAlways, .authorizedWhenInUse:
                mgr.allowsBackgroundLocationUpdates = true
                mgr.showsBackgroundLocationIndicator = true
                mgr.startUpdatingLocation()
                // Kick a one-shot request alongside the continuous stream so
                // the very first fix arrives within seconds even when iOS
                // has no cached location (cold start, indoors, after reboot).
                mgr.requestLocation()
                self.isUpdating = true
                NSLog("[BackgroundLocation] startUpdatingLocation + requestLocation fired")
                call.resolve(["started": true])

            case .notDetermined:
                // Defer: ask for permission, kick off updates from the
                // auth-change delegate once iOS reports the user's choice.
                self.startWhenAuthorized = true
                mgr.requestWhenInUseAuthorization()
                NSLog("[BackgroundLocation] deferred start — awaiting authorization")
                call.resolve(["started": true, "deferred": true])

            default:
                NSLog("[BackgroundLocation] start aborted — not authorized")
                call.resolve(["started": false])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.locationManager?.stopUpdatingLocation()
            self.locationManager?.allowsBackgroundLocationUpdates = false
            self.isUpdating = false
            call.resolve(["stopped": true])
        }
    }

    @objc func isRunning(_ call: CAPPluginCall) {
        call.resolve(["running": isUpdating])
    }

    @objc func getLastLocation(_ call: CAPPluginCall) {
        if let last = lastLocationDict {
            call.resolve(["location": last])
        } else {
            call.resolve(["location": NSNull()])
        }
    }

    // MARK: - CLLocationManagerDelegate
    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        NSLog("[BackgroundLocation] didUpdateLocations count=%d accuracy=%.1f", locations.count, loc.horizontalAccuracy)
        let payload: [String: Any] = [
            "latitude": loc.coordinate.latitude,
            "longitude": loc.coordinate.longitude,
            "accuracy": loc.horizontalAccuracy,
            "altitude": loc.altitude,
            "speed": loc.speed,  // meters/second, -1 if unavailable
            "heading": loc.course,  // degrees, -1 if unavailable
            "timestamp": Int(loc.timestamp.timeIntervalSince1970 * 1000)
        ]
        // Cache the latest fix so getLastLocation() can hand it to listeners
        // that subscribe AFTER the initial fix arrived (the picker pre-warm
        // case — we lock GPS during pick, then attach the tracker on Start).
        lastLocationDict = payload
        notifyListeners("location", data: payload)
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        NSLog("[BackgroundLocation] didFailWithError: %@", error.localizedDescription)
        notifyListeners("error", data: ["message": error.localizedDescription])
    }

    private func handleAuthChange(_ status: CLAuthorizationStatus, manager: CLLocationManager) {
        if status == .notDetermined { return }

        if let call = pendingPermissionCall {
            call.resolve(["location": statusString(status)])
            pendingPermissionCall = nil
        }

        // If start() was called before the user resolved the dialog, kick off
        // updates now that we know the answer.
        if startWhenAuthorized {
            startWhenAuthorized = false
            if status == .authorizedAlways || status == .authorizedWhenInUse {
                manager.allowsBackgroundLocationUpdates = true
                manager.showsBackgroundLocationIndicator = true
                manager.startUpdatingLocation()
                manager.requestLocation()
                NSLog("[BackgroundLocation] deferred start fired post-auth")
            } else {
                NSLog("[BackgroundLocation] deferred start aborted — denied")
            }
        }
    }

    // iOS 14+ authorization change callback
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status: CLAuthorizationStatus
        if #available(iOS 14.0, *) {
            status = manager.authorizationStatus
        } else {
            status = CLLocationManager.authorizationStatus()
        }
        handleAuthChange(status, manager: manager)
    }

    // Pre-iOS 14 fallback
    public func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        handleAuthChange(status, manager: manager)
    }
}
