import SwiftUI

/// Daily summary glance — triple ring (Move / Exercise / Stand) plus streak +
/// points tiles. Mirrors the "Daily rings" face from the design reference.
/// Data is read from the shared app group (populated by the iPhone app) and
/// the `WatchSessionManager`'s streak counter.
struct DailySummaryView: View {
    @EnvironmentObject var session: WatchSessionManager

    private var defaults: UserDefaults? { UserDefaults(suiteName: "group.com.tugympr.app") }

    private var moveProgress: Double { clamp(defaults?.double(forKey: "moveProgress") ?? 0.72) }
    private var exerciseProgress: Double { clamp(defaults?.double(forKey: "exerciseProgress") ?? 0.55) }
    private var standProgress: Double { clamp(defaults?.double(forKey: "standProgress") ?? 0.9) }

    private var moveValue: Int { defaults?.integer(forKey: "moveCalories") ?? 0 }
    private var moveGoal: Int { max(defaults?.integer(forKey: "moveGoal") ?? 600, 1) }
    private var exerciseValue: Int { defaults?.integer(forKey: "exerciseMinutes") ?? 0 }
    private var exerciseGoal: Int { max(defaults?.integer(forKey: "exerciseGoal") ?? 40, 1) }
    private var standValue: Int { defaults?.integer(forKey: "standHours") ?? 0 }
    private var standGoal: Int { max(defaults?.integer(forKey: "standGoal") ?? 12, 1) }

    private var pointsToday: Int { defaults?.integer(forKey: "pointsToday") ?? 0 }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                WatchStatusBar(title: session.tr("TODAY", "HOY"))

                HStack(spacing: 10) {
                    // Triple ring
                    ZStack {
                        ring(progress: moveProgress, color: DS.ringMove, radius: 42, lineWidth: 9)
                        ring(progress: exerciseProgress, color: DS.ringExercise, radius: 31, lineWidth: 9)
                        ring(progress: standProgress, color: DS.ringStand, radius: 20, lineWidth: 9)
                    }
                    .frame(width: 95, height: 95)

                    // Legend stack
                    VStack(alignment: .leading, spacing: 3) {
                        ringLabel(title: session.tr("MOVE", "MOVER"), color: DS.ringMove,
                                  value: "\(moveValue)", unit: "/\(moveGoal) cal")
                        ringLabel(title: session.tr("EXERCISE", "EJERCICIO"), color: DS.ringExercise,
                                  value: "\(exerciseValue)", unit: "/\(exerciseGoal) min")
                        ringLabel(title: session.tr("STAND", "DE PIE"), color: DS.ringStand,
                                  value: "\(standValue)", unit: "/\(standGoal) \(session.tr("hrs", "h"))")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 10)

                // Streak + points tiles
                HStack(spacing: 5) {
                    tile(
                        icon: "flame.fill",
                        iconColor: DS.streakOrange,
                        value: "\(session.currentStreak)",
                        valueColor: DS.streakOrangeGlow,
                        label: session.tr("STREAK", "RACHA"),
                        bg: DS.streakOrangeSoft
                    )
                    tile(
                        icon: "star.fill",
                        iconColor: DS.brandAccent,
                        value: pointsToday > 0 ? "+\(pointsToday)" : "0",
                        valueColor: DS.brandAccent,
                        label: session.tr("POINTS", "PUNTOS"),
                        bg: DS.accentTealSoft
                    )
                }
                .padding(.horizontal, 10)
            }
            .padding(.bottom, 8)
        }
        .background(Color.black)
    }

    // MARK: - Components

    @ViewBuilder
    private func ring(progress: Double, color: Color, radius: CGFloat, lineWidth: CGFloat) -> some View {
        let diameter = radius * 2
        ZStack {
            Circle()
                .stroke(color.opacity(0.22), lineWidth: lineWidth)
                .frame(width: diameter, height: diameter)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .frame(width: diameter, height: diameter)
                .rotationEffect(.degrees(-90))
        }
    }

    @ViewBuilder
    private func ringLabel(title: String, color: Color, value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .kerning(0.5)
                .foregroundColor(color)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundColor(.white)
                    .monospacedDigit()
                Text(unit)
                    .font(.system(size: 9, weight: .semibold, design: .rounded))
                    .foregroundColor(DS.textFaint)
            }
        }
    }

    @ViewBuilder
    private func tile(icon: String, iconColor: Color, value: String, valueColor: Color, label: String, bg: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(iconColor)
            VStack(alignment: .leading, spacing: 0) {
                Text(value)
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundColor(valueColor)
                    .monospacedDigit()
                Text(label)
                    .font(.system(size: 8, weight: .heavy, design: .rounded))
                    .kerning(0.3)
                    .foregroundColor(DS.textSub)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(bg)
        .cornerRadius(10)
    }

    private func clamp(_ v: Double) -> Double { max(0, min(1, v)) }
}

// MARK: - Nutrition tab
//
// Mirrors the iPhone macro rings: a big calorie ring on the left, a stack
// of protein / carbs / fat numbers on the right, and a Log Food button
// that just brings the iPhone forward (the food picker / barcode scanner
// is iPhone-only).

struct NutritionView: View {
    @EnvironmentObject var session: WatchSessionManager

    private var caloriesProgress: Double {
        guard session.nutritionCaloriesGoal > 0 else { return 0 }
        return clamp(Double(session.nutritionCaloriesEaten) / Double(session.nutritionCaloriesGoal))
    }
    private var proteinProgress: Double {
        guard session.nutritionProteinGoal > 0 else { return 0 }
        return clamp(Double(session.nutritionProteinEaten) / Double(session.nutritionProteinGoal))
    }
    private var carbsProgress: Double {
        guard session.nutritionCarbsGoal > 0 else { return 0 }
        return clamp(Double(session.nutritionCarbsEaten) / Double(session.nutritionCarbsGoal))
    }
    private var fatProgress: Double {
        guard session.nutritionFatGoal > 0 else { return 0 }
        return clamp(Double(session.nutritionFatEaten) / Double(session.nutritionFatGoal))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                WatchStatusBar(title: session.tr("NUTRITION", "NUTRICIÓN"))

                HStack(alignment: .center, spacing: 10) {
                    // Big calorie ring
                    ZStack {
                        Circle()
                            .stroke(DS.streakOrange.opacity(0.18), lineWidth: 9)
                            .frame(width: 78, height: 78)
                        Circle()
                            .trim(from: 0, to: caloriesProgress)
                            .stroke(DS.streakOrange, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                            .frame(width: 78, height: 78)
                            .rotationEffect(.degrees(-90))
                        VStack(spacing: 0) {
                            Text("\(session.nutritionCaloriesEaten)")
                                .font(.system(size: 17, weight: .heavy, design: .rounded))
                                .foregroundColor(.white)
                                .monospacedDigit()
                            Text("/\(session.nutritionCaloriesGoal)")
                                .font(.system(size: 9, weight: .semibold, design: .rounded))
                                .foregroundColor(DS.textFaint)
                                .monospacedDigit()
                            Text(session.tr("CAL", "CAL"))
                                .font(.system(size: 8, weight: .heavy, design: .rounded))
                                .foregroundColor(DS.streakOrange)
                                .kerning(0.4)
                        }
                    }

                    // Macro stack
                    VStack(alignment: .leading, spacing: 4) {
                        macroLine(
                            label: session.tr("PROTEIN", "PROTEÍNA"),
                            color: DS.brandAccent,
                            value: session.nutritionProteinEaten,
                            goal: session.nutritionProteinGoal,
                            unit: "g",
                            progress: proteinProgress
                        )
                        macroLine(
                            label: session.tr("CARBS", "CARBS"),
                            color: DS.amber,
                            value: session.nutritionCarbsEaten,
                            goal: session.nutritionCarbsGoal,
                            unit: "g",
                            progress: carbsProgress
                        )
                        macroLine(
                            label: session.tr("FAT", "GRASA"),
                            color: Color(red: 109/255, green: 95/255, blue: 219/255),
                            value: session.nutritionFatEaten,
                            goal: session.nutritionFatGoal,
                            unit: "g",
                            progress: fatProgress
                        )
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 10)

                Button {
                    session.openNutritionOnPhone()
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 12, weight: .bold))
                        Text(session.tr("Log food", "Registrar comida"))
                            .font(.system(.caption, design: .rounded).weight(.heavy))
                    }
                    .foregroundColor(Color(red: 0, green: 0.08, blue: 0.07))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(DS.brandAccent)
                    .cornerRadius(12)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 10)
                .padding(.top, 4)
            }
            .padding(.bottom, 8)
        }
        .background(Color.black)
    }

    @ViewBuilder
    private func macroLine(label: String, color: Color, value: Int, goal: Int, unit: String, progress: Double) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 3) {
                Text(label)
                    .font(.system(size: 8, weight: .heavy, design: .rounded))
                    .kerning(0.4)
                    .foregroundColor(color)
                Spacer(minLength: 0)
                Text("\(value)")
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(.white)
                Text("/\(goal)\(unit)")
                    .font(.system(size: 8, weight: .semibold, design: .rounded))
                    .foregroundColor(DS.textFaint)
                    .monospacedDigit()
            }
            // Linear progress bar (compact rings would lose readability at
            // this size, so we use a thin horizontal fill)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(color.opacity(0.18))
                    RoundedRectangle(cornerRadius: 2)
                        .fill(color)
                        .frame(width: geo.size.width * CGFloat(progress))
                }
            }
            .frame(height: 4)
        }
    }

    private func clamp(_ v: Double) -> Double { max(0, min(1, v)) }
}
