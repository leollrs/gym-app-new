import ActivityKit
import WidgetKit
import SwiftUI

struct WorkoutActivityLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            LockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    IslandCenter(context: context)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    IslandBottom(context: context)
                }
            } compactLeading: {
                IslandLeading(context: context)
            } compactTrailing: {
                IslandTrailing(context: context)
            } minimal: {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: 10))
                    .foregroundColor(Color(red: 212/255, green: 175/255, blue: 55/255))
            }
        }
    }
}

// MARK: - Lock Screen

private struct LockScreenView: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        VStack(spacing: 6) {
            LockScreenLabel(context: context)
            LockScreenContent(context: context)
            Text(context.state.currentExerciseName)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundColor(.white.opacity(0.5))
                .lineLimit(1)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .activityBackgroundTint(Color(red: 8/255, green: 10/255, blue: 18/255))
        .activitySystemActionForegroundColor(Color(red: 212/255, green: 175/255, blue: 55/255))
    }
}

private struct LockScreenLabel: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        if context.state.isRestFinished {
            Text("REST DONE")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(Color(red: 16/255, green: 185/255, blue: 129/255).opacity(0.7))
                .tracking(2.5)
        } else if context.state.isResting {
            Text("REST")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(Color(red: 212/255, green: 175/255, blue: 55/255).opacity(0.55))
                .tracking(2.5)
        } else {
            Text("WORKOUT")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.white.opacity(0.4))
                .tracking(2.5)
        }
    }
}

private struct LockScreenContent: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        if context.state.isRestFinished {
            Text("LOG NEXT SET")
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .foregroundColor(Color(red: 16/255, green: 185/255, blue: 129/255))
        } else if let restEnd = context.state.restEndDate, restEnd > Date() {
            Text(timerInterval: Date()...restEnd, countsDown: true)
                .font(.system(size: 46, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(Color(red: 212/255, green: 175/255, blue: 55/255))
                .multilineTextAlignment(.center)
        } else {
            Text(context.attributes.startedAt, style: .timer)
                .font(.system(size: 46, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
        }
    }
}

// MARK: - Dynamic Island

private struct IslandLeading: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        if let restEnd = context.state.restEndDate, restEnd > Date() {
            (Text("Rest ").foregroundColor(Color(red: 212/255, green: 175/255, blue: 55/255).opacity(0.7))
             + Text(timerInterval: Date()...restEnd, countsDown: true).foregroundColor(Color(red: 212/255, green: 175/255, blue: 55/255)))
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .monospacedDigit()
        } else {
            (Text("💪 ").foregroundColor(.white.opacity(0.5))
             + Text(context.attributes.startedAt, style: .timer).foregroundColor(.white))
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .monospacedDigit()
        }
    }
}

private struct IslandBottom: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        Text("\(context.state.completedSets)/\(context.attributes.totalSets) sets · \(context.state.currentExerciseName)")
            .font(.system(size: 11, weight: .medium, design: .rounded))
            .foregroundColor(.white.opacity(0.5))
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

private struct IslandCenter: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        if context.state.isRestFinished {
            Text("LOG NEXT SET")
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundColor(Color(red: 16/255, green: 185/255, blue: 129/255))
        } else if let restEnd = context.state.restEndDate, restEnd > Date() {
            Text(timerInterval: Date()...restEnd, countsDown: true)
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(Color(red: 212/255, green: 175/255, blue: 55/255))
        } else {
            Text(context.attributes.startedAt, style: .timer)
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(.white)
        }
    }
}

private struct IslandTrailing: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        Text("\(context.state.completedSets)/\(context.attributes.totalSets) sets")
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .foregroundColor(.white.opacity(0.7))
    }
}
