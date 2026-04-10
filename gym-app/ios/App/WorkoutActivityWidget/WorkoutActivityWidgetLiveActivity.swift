import ActivityKit
import WidgetKit
import SwiftUI

// MARK: - Color Scheme Helpers

private let goldColor = Color(red: 212/255, green: 175/255, blue: 55/255)
private let greenColor = Color(red: 16/255, green: 185/255, blue: 129/255)
private let darkBg = Color(red: 8/255, green: 10/255, blue: 18/255)
private let lightBg = Color(red: 245/255, green: 245/255, blue: 247/255)
private let pauseColor = Color(red: 249/255, green: 115/255, blue: 22/255) // orange

private struct AdaptiveColors {
    let scheme: ColorScheme

    var primaryText: Color { scheme == .dark ? .white : Color(red: 20/255, green: 20/255, blue: 30/255) }
    var secondaryText: Color { scheme == .dark ? .white.opacity(0.5) : Color(red: 80/255, green: 80/255, blue: 90/255) }
    var labelText: Color { scheme == .dark ? .white.opacity(0.4) : Color(red: 90/255, green: 90/255, blue: 100/255) }
    var background: Color { scheme == .dark ? darkBg : lightBg }
    var gold: Color { goldColor }
    var green: Color { greenColor }
    var pause: Color { pauseColor }
    var goldSubtle: Color { scheme == .dark ? goldColor.opacity(0.55) : goldColor.opacity(0.75) }
    var greenSubtle: Color { scheme == .dark ? greenColor.opacity(0.7) : greenColor.opacity(0.85) }
    var pauseSubtle: Color { scheme == .dark ? pauseColor.opacity(0.6) : pauseColor.opacity(0.8) }
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
                Image(systemName: context.state.isPaused ? "pause.fill" : "dumbbell.fill")
                    .font(.caption2)
                    .foregroundColor(context.state.isPaused ? pauseColor : goldColor)
            }
        }
    }
}

// MARK: - Lock Screen

private struct LockScreenView: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        // Lock Screen always uses dark styling — light text is unreadable on light wallpapers
        let colors = AdaptiveColors(scheme: .dark)
        VStack(spacing: 6) {
            LockScreenLabel(context: context, colors: colors)
            LockScreenContent(context: context, colors: colors)
            Text(context.state.currentExerciseName)
                .font(.system(.caption, design: .rounded).weight(.medium))
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
        if context.state.isPaused {
            Text("PAUSED")
                .font(.caption2.weight(.semibold))
                .foregroundColor(colors.pauseSubtle)
                .tracking(2.5)
        } else if context.state.isRestFinished {
            Text("REST DONE")
                .font(.caption2.weight(.semibold))
                .foregroundColor(colors.greenSubtle)
                .tracking(2.5)
        } else if context.state.isResting {
            Text("REST")
                .font(.caption2.weight(.semibold))
                .foregroundColor(colors.goldSubtle)
                .tracking(2.5)
        } else {
            Text("WORKOUT")
                .font(.caption2.weight(.semibold))
                .foregroundColor(colors.labelText)
                .tracking(2.5)
        }
    }
}

private struct LockScreenContent: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>
    let colors: AdaptiveColors

    var body: some View {
        if context.state.isPaused {
            // Show static elapsed time when paused
            Text(formatElapsed(context.state.elapsedSeconds))
                .font(.system(size: 46, weight: .semibold, design: .rounded))
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .monospacedDigit()
                .foregroundColor(colors.pause)
                .multilineTextAlignment(.center)
        } else if context.state.isRestFinished {
            Text("LOG NEXT SET")
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .foregroundColor(colors.green)
        } else if let restEnd = context.state.restEndDate, restEnd > Date() {
            Text(timerInterval: Date()...restEnd, countsDown: true)
                .font(.system(size: 46, weight: .semibold, design: .rounded))
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .monospacedDigit()
                .foregroundColor(colors.gold)
                .multilineTextAlignment(.center)
        } else {
            Text(context.attributes.startedAt, style: .timer)
                .font(.system(size: 46, weight: .semibold, design: .rounded))
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
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
        let colors = AdaptiveColors(scheme: .dark)
        if context.state.isPaused {
            (Text("⏸ ").foregroundColor(colors.pause.opacity(0.7))
             + Text(formatElapsed(context.state.elapsedSeconds)).foregroundColor(colors.pause))
                .font(.system(.caption, design: .rounded).weight(.semibold))
                .monospacedDigit()
        } else if let restEnd = context.state.restEndDate, restEnd > Date() {
            (Text("Rest ").foregroundColor(colors.gold.opacity(0.7))
             + Text(timerInterval: Date()...restEnd, countsDown: true).foregroundColor(colors.gold))
                .font(.system(.caption, design: .rounded).weight(.semibold))
                .monospacedDigit()
        } else {
            (Text("💪 ").foregroundColor(colors.secondaryText)
             + Text(context.attributes.startedAt, style: .timer).foregroundColor(colors.primaryText))
                .font(.system(.caption, design: .rounded).weight(.semibold))
                .monospacedDigit()
        }
    }
}

private struct IslandBottom: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        let colors = AdaptiveColors(scheme: .dark)
        Text("\(context.state.completedSets)/\(context.attributes.totalSets) sets · \(context.state.currentExerciseName)")
            .font(.caption2.weight(.medium))
            .foregroundColor(colors.secondaryText)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

private struct IslandCenter: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        let colors = AdaptiveColors(scheme: .dark)
        if context.state.isPaused {
            Text("PAUSED")
                .font(.system(.title3, design: .rounded).weight(.bold))
                .foregroundColor(colors.pause)
        } else if context.state.isRestFinished {
            Text("LOG NEXT SET")
                .font(.system(.title3, design: .rounded).weight(.bold))
                .foregroundColor(colors.green)
        } else if let restEnd = context.state.restEndDate, restEnd > Date() {
            Text(timerInterval: Date()...restEnd, countsDown: true)
                .font(.system(.title2, design: .rounded).weight(.semibold))
                .monospacedDigit()
                .foregroundColor(colors.gold)
        } else {
            Text(context.attributes.startedAt, style: .timer)
                .font(.system(.title2, design: .rounded).weight(.semibold))
                .monospacedDigit()
                .foregroundColor(colors.primaryText)
        }
    }
}

private struct IslandTrailing: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        let colors = AdaptiveColors(scheme: .dark)
        Text("\(context.state.completedSets)/\(context.attributes.totalSets) sets")
            .font(.system(.caption, design: .rounded).weight(.semibold))
            .foregroundColor(colors.secondaryText)
    }
}

// MARK: - Helpers

private func formatElapsed(_ seconds: Int) -> String {
    let m = seconds / 60
    let s = seconds % 60
    return String(format: "%d:%02d", m, s)
}
