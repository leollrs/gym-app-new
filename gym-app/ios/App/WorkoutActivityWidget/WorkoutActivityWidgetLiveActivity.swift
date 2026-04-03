import ActivityKit
import WidgetKit
import SwiftUI

// MARK: - Color Scheme Helpers

private let goldColor = Color(red: 212/255, green: 175/255, blue: 55/255)
private let greenColor = Color(red: 16/255, green: 185/255, blue: 129/255)
private let darkBg = Color(red: 8/255, green: 10/255, blue: 18/255)
private let lightBg = Color(red: 245/255, green: 245/255, blue: 247/255)

private struct AdaptiveColors {
    let scheme: ColorScheme

    var primaryText: Color { scheme == .dark ? .white : Color(red: 20/255, green: 20/255, blue: 30/255) }
    var secondaryText: Color { scheme == .dark ? .white.opacity(0.5) : Color(red: 100/255, green: 100/255, blue: 110/255) }
    var labelText: Color { scheme == .dark ? .white.opacity(0.4) : Color(red: 120/255, green: 120/255, blue: 130/255) }
    var background: Color { scheme == .dark ? darkBg : lightBg }
    var gold: Color { goldColor }
    var green: Color { greenColor }
    var goldSubtle: Color { scheme == .dark ? goldColor.opacity(0.55) : goldColor.opacity(0.75) }
    var greenSubtle: Color { scheme == .dark ? greenColor.opacity(0.7) : greenColor.opacity(0.85) }
}

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
                    .foregroundColor(goldColor)
            }
        }
    }
}

// MARK: - Lock Screen

private struct LockScreenView: View {
    @Environment(\.colorScheme) var colorScheme
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        let colors = AdaptiveColors(scheme: colorScheme)
        VStack(spacing: 6) {
            LockScreenLabel(context: context, colors: colors)
            LockScreenContent(context: context, colors: colors)
            Text(context.state.currentExerciseName)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundColor(colors.secondaryText)
                .lineLimit(1)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .activityBackgroundTint(colors.background)
        .activitySystemActionForegroundColor(colors.gold)
    }
}

private struct LockScreenLabel: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>
    let colors: AdaptiveColors

    var body: some View {
        if context.state.isRestFinished {
            Text("REST DONE")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(colors.greenSubtle)
                .tracking(2.5)
        } else if context.state.isResting {
            Text("REST")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(colors.goldSubtle)
                .tracking(2.5)
        } else {
            Text("WORKOUT")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(colors.labelText)
                .tracking(2.5)
        }
    }
}

private struct LockScreenContent: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>
    let colors: AdaptiveColors

    var body: some View {
        if context.state.isRestFinished {
            Text("LOG NEXT SET")
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .foregroundColor(colors.green)
        } else if let restEnd = context.state.restEndDate, restEnd > Date() {
            Text(timerInterval: Date()...restEnd, countsDown: true)
                .font(.system(size: 46, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(colors.gold)
                .multilineTextAlignment(.center)
        } else {
            Text(context.attributes.startedAt, style: .timer)
                .font(.system(size: 46, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(colors.primaryText)
                .multilineTextAlignment(.center)
        }
    }
}

// MARK: - Dynamic Island

private struct IslandLeading: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        if let restEnd = context.state.restEndDate, restEnd > Date() {
            (Text("Rest ").foregroundColor(goldColor.opacity(0.7))
             + Text(timerInterval: Date()...restEnd, countsDown: true).foregroundColor(goldColor))
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
                .foregroundColor(greenColor)
        } else if let restEnd = context.state.restEndDate, restEnd > Date() {
            Text(timerInterval: Date()...restEnd, countsDown: true)
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(goldColor)
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
