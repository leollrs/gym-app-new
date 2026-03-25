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
            totalSets: totalSets,
            startedAt: workoutStart
        )

        let state = WorkoutActivityAttributes.ContentState(
            elapsedSeconds: 0,
            completedSets: completedSets,
            currentExerciseName: exerciseName,
            isResting: false,
            restEndDate: nil,
            isRestFinished: false
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
            // Reuse the cached restEndDate so the countdown doesn't drift
            var stableState = state
            stableState.restEndDate = cachedRestEndDate
            let content = ActivityContent(state: stableState, staleDate: cachedRestEndDate)
            await pushUpdate(content)
            return
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
            let exerciseName = call.getString("currentExerciseName") ?? ""
            let isResting = call.getBool("isResting") ?? false
            let restRemainingSeconds = call.getInt("restRemainingSeconds") ?? 0

            var restEndDate: Date? = nil
            if isResting && restRemainingSeconds > 0 {
                restEndDate = Date().addingTimeInterval(Double(restRemainingSeconds))
            }

            let state = WorkoutActivityAttributes.ContentState(
                elapsedSeconds: elapsedSeconds,
                completedSets: completedSets,
                currentExerciseName: exerciseName,
                isResting: isResting,
                restEndDate: restEndDate,
                isRestFinished: false
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

            let state = WorkoutActivityAttributes.ContentState(
                elapsedSeconds: elapsedSeconds,
                completedSets: completedSets,
                currentExerciseName: "Done",
                isResting: false,
                restEndDate: nil,
                isRestFinished: false
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
