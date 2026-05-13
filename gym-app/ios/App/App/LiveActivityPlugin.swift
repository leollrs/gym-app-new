import Foundation
import Capacitor
import ActivityKit
import PassKit

@available(iOS 16.2, *)
private class LiveActivityManager {
    static var currentActivity: Activity<WorkoutActivityAttributes>? = nil
    static var restEndTimer: DispatchWorkItem? = nil
    static var backgroundTaskID: UIBackgroundTaskIdentifier = .invalid
    static var isRestActive: Bool = false
    static var restDoneUntil: Date? = nil   // keep "LOG NEXT SET" visible for a few seconds
    static var cachedRestEndDate: Date? = nil

    static func endBackgroundTask() {
        if backgroundTaskID != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskID)
            backgroundTaskID = .invalid
        }
    }

    static func start(routineName: String, totalSets: Int, completedSets: Int, exerciseName: String, startTimestamp: Double) async throws -> String {
        // If the app was killed mid-workout and is cold-starting, we want to
        // re-attach to the existing Live Activity rather than killing it and
        // starting a new one (which causes the Dynamic Island to vanish for a
        // moment and lose continuity). Only re-attach if the routineName still
        // matches — otherwise it's a genuinely new workout and we replace.
        if let existing = Activity<WorkoutActivityAttributes>.activities.first(where: { $0.attributes.routineName == routineName }) {
            currentActivity = existing
            // Refresh content with latest numbers
            let refreshed = WorkoutActivityAttributes.ContentState(
                elapsedSeconds: existing.content.state.elapsedSeconds,
                completedSets: completedSets,
                totalSets: totalSets,
                currentExerciseName: exerciseName,
                isResting: existing.content.state.isResting,
                restEndDate: existing.content.state.restEndDate,
                isRestFinished: existing.content.state.isRestFinished,
                isPaused: existing.content.state.isPaused,
                distanceKm: existing.content.state.distanceKm
            )
            await existing.update(ActivityContent(state: refreshed, staleDate: nil))
            return existing.id
        }

        // Otherwise, end any stale activities (different routine) and start fresh
        for activity in Activity<WorkoutActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        currentActivity = nil
        isRestActive = false

        let workoutStart = startTimestamp > 0
            ? Date(timeIntervalSince1970: startTimestamp / 1000.0)
            : Date()

        let attributes = WorkoutActivityAttributes(
            routineName: routineName,
            initialTotalSets: totalSets,
            startedAt: workoutStart
        )

        let state = WorkoutActivityAttributes.ContentState(
            elapsedSeconds: 0,
            completedSets: completedSets,
            totalSets: totalSets,
            currentExerciseName: exerciseName,
            isResting: false,
            restEndDate: nil,
            isRestFinished: false,
            isPaused: false,
            distanceKm: nil
        )

        let content = ActivityContent(state: state, staleDate: nil)
        let activity = try Activity<WorkoutActivityAttributes>.request(
            attributes: attributes,
            content: content,
            pushType: nil
        )
        currentActivity = activity
        return activity.id
    }

    static func update(state: WorkoutActivityAttributes.ContentState) async {
        // During "rest done" grace period, override JS updates to keep showing LOG NEXT SET
        if let doneUntil = restDoneUntil, Date() < doneUntil {
            var overrideState = state
            overrideState.isResting = false
            overrideState.isRestFinished = true
            overrideState.restEndDate = cachedRestEndDate
            let content = ActivityContent(state: overrideState, staleDate: nil)
            await pushUpdate(content)
            return
        }

        // Clear expired grace period
        if restDoneUntil != nil && Date() >= restDoneUntil! {
            restDoneUntil = nil
            cachedRestEndDate = nil
            isRestActive = false
        }

        // During active rest, don't cancel/reschedule the timer — just update the content
        if state.isResting && isRestActive {
            var stableState = state
            // If the incoming restEndDate differs from the cached one by more
            // than ~2s, the user explicitly adjusted the rest (+15/-15) and
            // we should accept the new target + reschedule the background
            // "rest done" timer. Smaller diffs are routine per-second JS
            // ticks; keep the cache so the countdown doesn't drift.
            if let newEnd = state.restEndDate,
               let cached = cachedRestEndDate,
               abs(newEnd.timeIntervalSince(cached)) > 2 {
                cachedRestEndDate = newEnd
                stableState.restEndDate = newEnd

                restEndTimer?.cancel()
                restEndTimer = nil
                let delay = newEnd.timeIntervalSinceNow
                if delay > 0 {
                    let workItem = DispatchWorkItem {
                        Task { await LiveActivityManager.onRestDone() }
                    }
                    restEndTimer = workItem
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
                } else {
                    // User shortened rest below the elapsed time — fire immediately
                    Task { await LiveActivityManager.onRestDone() }
                }
            } else {
                stableState.restEndDate = cachedRestEndDate
            }
            let content = ActivityContent(state: stableState, staleDate: stableState.restEndDate)
            await pushUpdate(content)
            return
        }

        // JS says not resting but Swift still thinks rest is active. Two cases:
        //  1. User explicitly skipped — cachedEnd is meaningfully in the future
        //     (more than ~2s away). Honor the skip: fall through to the normal
        //     update path so the rest UI disappears immediately.
        //  2. Natural completion race — cachedEnd is ~now and Swift's own
        //     `restEndTimer` is about to fire `onRestDone`. Keep showing rest
        //     for that brief window so the widget doesn't flash workout-mode
        //     before the "LOG NEXT SET" prompt appears.
        if !state.isResting && isRestActive, let cachedEnd = cachedRestEndDate, cachedEnd > Date() {
            if cachedEnd.timeIntervalSinceNow <= 2 {
                var restState = state
                restState.isResting = true
                restState.restEndDate = cachedEnd
                let content = ActivityContent(state: restState, staleDate: cachedEnd)
                await pushUpdate(content)
                return
            }
            // Otherwise fall through — this is a user-initiated skip.
        }

        restEndTimer?.cancel()
        restEndTimer = nil
        endBackgroundTask()

        let staleDate = state.isResting ? state.restEndDate : nil
        let content = ActivityContent(state: state, staleDate: staleDate)
        await pushUpdate(content)

        // If starting rest, schedule background timer for "rest done" transition
        if state.isResting && !isRestActive, let restEnd = state.restEndDate {
            isRestActive = true
            cachedRestEndDate = restEnd
            let delay = restEnd.timeIntervalSinceNow
            guard delay > 0 else { return }

            backgroundTaskID = UIApplication.shared.beginBackgroundTask {
                Task { await LiveActivityManager.onRestDone() }
                LiveActivityManager.endBackgroundTask()
            }

            let workItem = DispatchWorkItem {
                Task { await LiveActivityManager.onRestDone() }
            }
            restEndTimer = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
        }

        if !state.isResting {
            isRestActive = false
            cachedRestEndDate = nil
        }
    }

    static func onRestDone() async {
        guard let activity = currentActivity ?? Activity<WorkoutActivityAttributes>.activities.first else { return }
        currentActivity = activity

        // Show "LOG NEXT SET" for 5 seconds
        restDoneUntil = Date().addingTimeInterval(5)

        var doneState = activity.content.state
        doneState.isResting = false
        doneState.isRestFinished = true
        // Keep restEndDate so the widget can reference it
        let content = ActivityContent(state: doneState, staleDate: nil)
        await activity.update(content)
        endBackgroundTask()
    }

    static func pushUpdate(_ content: ActivityContent<WorkoutActivityAttributes.ContentState>) async {
        if let activity = currentActivity {
            await activity.update(content)
        } else if let existing = Activity<WorkoutActivityAttributes>.activities.first {
            await existing.update(content)
            currentActivity = existing
        }
    }

    static func end(state: WorkoutActivityAttributes.ContentState) async {
        restEndTimer?.cancel()
        restEndTimer = nil
        endBackgroundTask()
        isRestActive = false
        restDoneUntil = nil
        cachedRestEndDate = nil

        let content = ActivityContent(state: state, staleDate: nil)
        for activity in Activity<WorkoutActivityAttributes>.activities {
            await activity.end(content, dismissalPolicy: .immediate)
        }
        currentActivity = nil
    }
}

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endLiveActivity", returnType: CAPPluginReturnPromise),
    ]

    @objc func startLiveActivity(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                call.reject("Live Activities are not enabled")
                return
            }

            let routineName = call.getString("routineName") ?? "Workout"
            let totalSets = call.getInt("totalSets") ?? 0
            let completedSets = call.getInt("completedSets") ?? 0
            let exerciseName = call.getString("currentExerciseName") ?? ""
            let startTimestamp = call.getDouble("startTimestamp") ?? 0

            Task {
                do {
                    let activityId = try await LiveActivityManager.start(
                        routineName: routineName,
                        totalSets: totalSets,
                        completedSets: completedSets,
                        exerciseName: exerciseName,
                        startTimestamp: startTimestamp
                    )
                    call.resolve(["activityId": activityId])
                } catch {
                    call.reject("Failed to start Live Activity: \(error.localizedDescription)")
                }
            }
        } else {
            call.reject("Live Activities require iOS 16.2+")
        }
    }

    @objc func updateLiveActivity(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let elapsedSeconds = call.getInt("elapsedSeconds") ?? 0
            let completedSets = call.getInt("completedSets") ?? 0
            // totalSets is dynamic now — read from JS every update so skip/remove
            // immediately reflects in the Dynamic Island denominator. Fall back to
            // existing activity's totalSets if JS omitted it.
            let fallbackTotal = LiveActivityManager.currentActivity?.content.state.totalSets
                ?? Activity<WorkoutActivityAttributes>.activities.first?.content.state.totalSets
                ?? 0
            let totalSets = call.getInt("totalSets") ?? fallbackTotal
            let exerciseName = call.getString("currentExerciseName") ?? ""
            let isResting = call.getBool("isResting") ?? false
            let restRemainingSeconds = call.getInt("restRemainingSeconds") ?? 0
            let isPaused = call.getBool("isPaused") ?? false
            // Cardio mode distance (in km). Sent as Double. nil means workout mode.
            let distanceKm: Double? = {
                if let v = call.getDouble("distanceKm") { return v }
                return nil
            }()

            var restEndDate: Date? = nil
            if isResting && restRemainingSeconds > 0 {
                restEndDate = Date().addingTimeInterval(Double(restRemainingSeconds))
            }

            let state = WorkoutActivityAttributes.ContentState(
                elapsedSeconds: elapsedSeconds,
                completedSets: completedSets,
                totalSets: totalSets,
                currentExerciseName: exerciseName,
                isResting: isResting,
                restEndDate: restEndDate,
                isRestFinished: false,
                isPaused: isPaused,
                distanceKm: distanceKm
            )

            Task {
                await LiveActivityManager.update(state: state)
                call.resolve()
            }
        } else {
            call.reject("Live Activities require iOS 16.2+")
        }
    }

    @objc func endLiveActivity(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let elapsedSeconds = call.getInt("elapsedSeconds") ?? 0
            let completedSets = call.getInt("completedSets") ?? 0
            let totalSets = call.getInt("totalSets") ?? completedSets

            let state = WorkoutActivityAttributes.ContentState(
                elapsedSeconds: elapsedSeconds,
                completedSets: completedSets,
                totalSets: totalSets,
                currentExerciseName: "Done",
                isResting: false,
                restEndDate: nil,
                isRestFinished: false,
                isPaused: false,
                distanceKm: nil
            )

            Task {
                await LiveActivityManager.end(state: state)
                call.resolve()
            }
        } else {
            call.reject("Live Activities require iOS 16.2+")
        }
    }
}

// MARK: - Wallet Pass Plugin

@objc(WalletPassPlugin)
public class WalletPassPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WalletPassPlugin"
    public let jsName = "WalletPass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "addPass", returnType: CAPPluginReturnPromise)
    ]

    @objc func addPass(_ call: CAPPluginCall) {
        guard let base64 = call.getString("pkpassBase64") else {
            call.reject("Missing pkpassBase64")
            return
        }

        guard let data = Data(base64Encoded: base64) else {
            call.reject("Invalid base64 data")
            return
        }

        guard PKAddPassesViewController.canAddPasses() else {
            call.reject("This device cannot add passes")
            return
        }

        do {
            let pass = try PKPass(data: data)

            DispatchQueue.main.async {
                guard let vc = PKAddPassesViewController(pass: pass) else {
                    call.reject("Could not create pass view controller")
                    return
                }

                self.bridge?.viewController?.present(vc, animated: true) {
                    call.resolve(["success": true])
                }
            }
        } catch {
            call.reject("Invalid pass: \(error.localizedDescription)")
        }
    }
}
