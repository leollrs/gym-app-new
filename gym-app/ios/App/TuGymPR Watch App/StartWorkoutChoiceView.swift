import SwiftUI
import WatchKit
import MapKit
import CoreLocation

struct StartWorkoutPage: View {
    @EnvironmentObject var session: WatchSessionManager

    /// Today's workout — the routine the phone says is scheduled for today
    private var todayRoutine: [String: Any]? {
        session.availableRoutines.first { ($0["isTodayWorkout"] as? Bool) == true }
    }

    /// Any program routine as fallback
    private var anyProgramRoutine: [String: Any]? {
        session.availableRoutines.first { ($0["isProgram"] as? Bool) == true }
    }

    // ── Warm-up confirmation ───────────────────────────────────────
    // Tapping the hero "Start Today" tile no longer launches straight
    // into the workout — it pops a confirmation sheet that lets the
    // user pick "with warm-up" or "skip warm-up" first. The choice
    // is forwarded to startWorkout(routineId:skipWarmUp:).
    @State private var pendingRoutineId: String? = nil
    @State private var showWarmUpPrompt: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                WatchStatusBar(title: "TuGymPR")

                VStack(alignment: .leading, spacing: 0) {
                    Text(session.tr("Pick a workout", "Elige un entrenamiento"))
                        .font(.system(.headline, design: .rounded).weight(.heavy))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)

                    if let r = todayRoutine ?? anyProgramRoutine {
                        Text("\(session.tr("Today", "Hoy")) · \(cleanName(r["name"] as? String ?? ""))")
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundColor(DS.textSub)
                            .lineLimit(1)
                    } else {
                        Text(session.tr("No program assigned", "Sin programa asignado"))
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundColor(DS.textSub)
                    }
                }
                .padding(.horizontal, 12)

                // Hero teal gradient start card
                if let routine = todayRoutine ?? anyProgramRoutine {
                    Button {
                        let id = routine["id"] as? String ?? ""
                        pendingRoutineId = id
                        showWarmUpPrompt = true
                        WKInterfaceDevice.current().play(.click)
                    } label: {
                        HStack(spacing: 10) {
                            ZStack {
                                Circle()
                                    .fill(Color.white)
                                    .frame(width: 32, height: 32)
                                Image(systemName: "play.fill")
                                    .font(.system(size: 13, weight: .black))
                                    .foregroundColor(DS.brandAccent)
                            }
                            VStack(alignment: .leading, spacing: 1) {
                                Text(session.tr("START TODAY", "EMPEZAR HOY"))
                                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                                    .kerning(0.6)
                                    .foregroundColor(Color(red: 0, green: 0.08, blue: 0.07))
                                Text(cleanName(routine["name"] as? String ?? session.tr("Workout", "Entrenamiento")))
                                    .font(.system(.subheadline, design: .rounded).weight(.heavy))
                                    .foregroundColor(Color(red: 0, green: 0.08, blue: 0.07))
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 12)
                        .background(
                            LinearGradient(
                                colors: [DS.accentTeal, DS.accentTealDeep],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .cornerRadius(18)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 10)
                }

                // Alternatives — pill rows. Each tile is now an actual button
                // that fires the matching action through WatchSessionManager
                // so the iPhone navigates to the right surface.
                VStack(spacing: 5) {
                    NavigationLink(destination: QuickStartView()) {
                        AltRow(icon: "list.bullet", color: DS.accentTeal, label: session.tr("All routines", "Todas las rutinas"))
                    }
                    .buttonStyle(.plain)

                    NavigationLink(destination: CardioPickerView()) {
                        AltRow(icon: "figure.run", color: DS.streakOrange, label: session.tr("Cardio · free", "Cardio · libre"))
                    }
                    .buttonStyle(.plain)

                    NavigationLink(destination: FreeLiftExercisePickerView()) {
                        AltRow(icon: "dumbbell.fill", color: Color(red: 109/255, green: 95/255, blue: 219/255), label: session.tr("Free lift", "Levantamiento libre"))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 10)

                if session.availableRoutines.isEmpty {
                    Text(session.tr("Open TuGymPR on your iPhone to sync", "Abre TuGymPR en tu iPhone para sincronizar"))
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundColor(DS.textFaint)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 14)
                        .padding(.top, 4)
                }
            }
            .padding(.bottom, 10)
        }
        .background(Color.black)
        .confirmationDialog(
            session.tr("Start with a warm-up?", "¿Empezar con calentamiento?"),
            isPresented: $showWarmUpPrompt,
            titleVisibility: .visible
        ) {
            Button(session.tr("With warm-up", "Con calentamiento")) {
                if let id = pendingRoutineId {
                    session.startWorkout(routineId: id, skipWarmUp: false)
                }
                pendingRoutineId = nil
            }
            Button(session.tr("Skip warm-up", "Sin calentamiento")) {
                if let id = pendingRoutineId {
                    session.startWorkout(routineId: id, skipWarmUp: true)
                }
                pendingRoutineId = nil
            }
            Button(session.tr("Cancel", "Cancelar"), role: .cancel) {
                pendingRoutineId = nil
            }
        }
    }

    private func cleanName(_ name: String) -> String {
        name.hasPrefix("Auto: ") ? String(name.dropFirst(6)) : name
    }
}

private struct AltRow: View {
    let icon: String
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(color)
                .frame(width: 20)
            Text(label)
                .font(.system(.caption, design: .rounded).weight(.bold))
                .foregroundColor(.white)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(DS.surface1)
        .cornerRadius(14)
    }
}

// MARK: - Cardio activity picker (watch-only)
//
// Tapping any row drops the user straight into LiveCardioWatchView with the
// matching HKWorkoutActivityType. No iPhone interaction required — the
// summary is sent to the iPhone on End.

struct CardioActivity: Identifiable {
    let id: String       // matches the cardio_type slug used by /cardio-live
    let icon: String
    let color: Color
    let labelKeyEN: String
    let labelKeyES: String
}

struct CardioPickerView: View {
    @EnvironmentObject var session: WatchSessionManager

    private let activities: [CardioActivity] = [
        CardioActivity(id: "running",       icon: "figure.run",                color: Color(red: 16/255, green: 185/255, blue: 129/255), labelKeyEN: "Run",       labelKeyES: "Correr"),
        CardioActivity(id: "walking",       icon: "figure.walk",               color: Color(red: 34/255, green: 197/255, blue: 94/255),  labelKeyEN: "Walk",      labelKeyES: "Caminar"),
        CardioActivity(id: "cycling",       icon: "bicycle",                   color: Color(red: 59/255, green: 130/255, blue: 246/255), labelKeyEN: "Bike",      labelKeyES: "Bici"),
        CardioActivity(id: "hiking",        icon: "mountain.2.fill",           color: Color(red: 16/255, green: 185/255, blue: 129/255), labelKeyEN: "Hike",      labelKeyES: "Senderismo"),
        CardioActivity(id: "rowing",        icon: "figure.rower",              color: Color(red: 6/255, green: 182/255, blue: 212/255),  labelKeyEN: "Row",       labelKeyES: "Remo"),
        CardioActivity(id: "elliptical",    icon: "figure.elliptical",         color: Color(red: 139/255, green: 92/255, blue: 246/255), labelKeyEN: "Elliptical",labelKeyES: "Elíptica"),
        CardioActivity(id: "stair_climber", icon: "figure.step.training",      color: Color(red: 245/255, green: 158/255, blue: 11/255), labelKeyEN: "Stair",     labelKeyES: "Escalera"),
        CardioActivity(id: "hiit",          icon: "flame.fill",                color: Color(red: 249/255, green: 115/255, blue: 22/255), labelKeyEN: "HIIT",      labelKeyES: "HIIT"),
        CardioActivity(id: "other",         icon: "heart.fill",                color: DS.streakOrange,                                   labelKeyEN: "Other",     labelKeyES: "Otro"),
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 5) {
                WatchStatusBar(title: session.tr("CARDIO", "CARDIO"), color: DS.streakOrange)
                ForEach(activities) { a in
                    NavigationLink(destination: LiveCardioWatchView(activity: a)) {
                        HStack(spacing: 8) {
                            Image(systemName: a.icon)
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(a.color)
                                .frame(width: 22)
                            Text(session.tr(a.labelKeyEN, a.labelKeyES))
                                .font(.system(.caption, design: .rounded).weight(.heavy))
                                .foregroundColor(.white)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(DS.textFaint)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 9)
                        .background(DS.surface1)
                        .cornerRadius(14)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
        }
        .background(Color.black)
        .navigationTitle(session.tr("Cardio", "Cardio"))
    }
}

// MARK: - Live cardio session (watch-only)

struct LiveCardioWatchView: View {
    let activity: CardioActivity

    @EnvironmentObject var session: WatchSessionManager
    @StateObject private var workoutSession = WorkoutSessionManager()
    @Environment(\.dismiss) private var dismiss

    @State private var elapsed: Int = 0
    @State private var timer: Timer?
    @State private var paused: Bool = false
    /// How many captured fixes we've already streamed to the phone mirror, so
    /// each update only ships the NEW route points.
    @State private var lastSentRouteCount: Int = 0

    /// Summary state — when set, swap the body for the post-run summary screen.
    /// Keeps everything in one struct so the user can dismiss back to the
    /// picker on Done.
    @State private var summary: WatchCardioSummary? = nil

    var body: some View {
        if let summary {
            WatchCardioSummaryView(summary: summary, activity: activity) {
                dismiss()
            }
        } else {
            liveBody
        }
    }

    private var liveBody: some View {
        ScrollView {
            VStack(spacing: 8) {
                WatchStatusBar(title: session.tr(activity.labelKeyEN.uppercased(), activity.labelKeyES.uppercased()), color: activity.color)

                Text(formatTime(elapsed))
                    .font(.system(size: 38, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(.white)
                    .padding(.top, 4)

                // Stats grid: HR + cal
                HStack(spacing: 6) {
                    statTile(value: workoutSession.currentHeartRate > 0 ? "\(Int(workoutSession.currentHeartRate))" : "--",
                             label: "BPM",
                             color: .red)
                    statTile(value: "\(workoutSession.caloriesBurned)",
                             label: session.tr("CAL", "CAL"),
                             color: DS.streakOrange)
                }
                .padding(.horizontal, 8)

                // Distance + pace row — outdoor activities only. Always
                // shown so the user knows GPS is active even before fixes
                // start arriving.
                if workoutSession.gpsEnabled {
                    HStack(spacing: 6) {
                        statTile(
                            value: String(format: "%.2f", workoutSession.distanceMeters / 1000.0),
                            label: session.tr("KM", "KM"),
                            color: DS.brandAccent
                        )
                        statTile(
                            value: paceString(distance: workoutSession.distanceMeters, seconds: elapsed),
                            label: session.tr("PACE", "RITMO"),
                            color: DS.amber
                        )
                    }
                    .padding(.horizontal, 8)

                    // Live route map — draws the path on the wrist as it's
                    // tracked. Non-interactive so it never fights the ScrollView.
                    CardioRouteMap(
                        coordinates: workoutSession.routeLocations.map { $0.coordinate },
                        color: activity.color
                    )
                    .frame(height: 118)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 8)
                }

                // Pause / End controls
                HStack(spacing: 6) {
                    Button {
                        paused.toggle()
                        WKInterfaceDevice.current().play(.click)
                    } label: {
                        Text(paused ? session.tr("Resume", "Reanudar") : session.tr("Pause", "Pausar"))
                            .font(.system(.caption, design: .rounded).weight(.heavy))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .background(DS.surface1)
                            .cornerRadius(12)
                    }
                    .buttonStyle(.plain)

                    Button {
                        endAndSave()
                    } label: {
                        Text(session.tr("End", "Terminar"))
                            .font(.system(.caption, design: .rounded).weight(.heavy))
                            .foregroundColor(Color(red: 0, green: 0.08, blue: 0.07))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .background(DS.brandAccent)
                            .cornerRadius(12)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8)
            }
            .padding(.bottom, 8)
        }
        .background(Color.black)
        .onAppear {
            workoutSession.startCardioSession(activityType: activity.id)
            // Open the live mirror on the iPhone so the run shows up there too.
            session.startWatchCardioMirror(activityType: activity.id)
            startTicker()
        }
        .onDisappear {
            timer?.invalidate()
            timer = nil
        }
    }

    @ViewBuilder
    private func statTile(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 1) {
            Text(value)
                .font(.system(size: 18, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .kerning(0.4)
                .foregroundColor(DS.textSub)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(DS.surface1)
        .cornerRadius(12)
    }

    private func startTicker() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            if !paused { elapsed += 1 }
            // Stream stats to the iPhone mirror ~every 2s (also while paused,
            // so the phone reflects the paused state).
            if elapsed % 2 == 0 { sendMirrorUpdate() }
        }
    }

    /// Push the latest stats + any newly-captured route points to the phone
    /// mirror. Incremental — only fixes beyond `lastSentRouteCount` are sent.
    private func sendMirrorUpdate() {
        let all = workoutSession.routeLocations
        var tail: [[String: Any]] = []
        if lastSentRouteCount < all.count {
            tail = all[lastSentRouteCount..<all.count].map { loc in
                [
                    "lat": loc.coordinate.latitude,
                    "lng": loc.coordinate.longitude,
                    "t": Int(loc.timestamp.timeIntervalSince1970 * 1000),
                ]
            }
            lastSentRouteCount = all.count
        }
        session.updateWatchCardioMirror(
            elapsed: elapsed,
            distanceMeters: workoutSession.distanceMeters,
            heartRate: Int(workoutSession.currentHeartRate),
            calories: workoutSession.caloriesBurned,
            paused: paused,
            routeTail: tail
        )
    }

    private func endAndSave() {
        timer?.invalidate()
        timer = nil
        // Snapshot the route for the summary map before tearing down the session.
        let coords = workoutSession.routeLocations.map { $0.coordinate }
        let s = workoutSession.stopCardioSession()
        WKInterfaceDevice.current().play(.success)
        session.saveWatchCardio(
            activityType: activity.id,
            durationSeconds: s.durationSeconds,
            averageHeartRate: s.avgHR,
            caloriesBurned: s.calories,
            distanceKm: s.distanceKm,
            route: s.route
        )
        // Show the summary screen instead of dismissing immediately.
        summary = WatchCardioSummary(
            durationSeconds: s.durationSeconds,
            avgHR: s.avgHR,
            calories: s.calories,
            distanceKm: s.distanceKm,
            routeCoordinates: coords
        )
    }

    private func formatTime(_ s: Int) -> String {
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, sec) }
        return String(format: "%d:%02d", m, sec)
    }

    private func paceString(distance: Double, seconds: Int) -> String {
        guard distance >= 50 else { return "--:--" }
        let secPerKm = Double(seconds) / (distance / 1000.0)
        if !secPerKm.isFinite || secPerKm <= 0 || secPerKm > 3600 { return "--:--" }
        let m = Int(secPerKm) / 60, s = Int(secPerKm) % 60
        return String(format: "%d:%02d", m, s)
    }
}

// MARK: - Watch cardio summary (post-end)

struct WatchCardioSummary {
    let durationSeconds: Int
    let avgHR: Int
    let calories: Int
    let distanceKm: Double?
    /// Captured GPS route for the summary map (empty for indoor activities).
    var routeCoordinates: [CLLocationCoordinate2D] = []
}

struct WatchCardioSummaryView: View {
    let summary: WatchCardioSummary
    let activity: CardioActivity
    let onDone: () -> Void
    @EnvironmentObject var session: WatchSessionManager

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                WatchStatusBar(title: session.tr("DONE", "TERMINADO"), color: activity.color)

                // Activity icon hero
                ZStack {
                    Circle()
                        .fill(activity.color.opacity(0.18))
                        .frame(width: 56, height: 56)
                    Image(systemName: activity.icon)
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(activity.color)
                }
                .padding(.top, 4)

                Text(session.tr(activity.labelKeyEN, activity.labelKeyES))
                    .font(.system(.subheadline, design: .rounded).weight(.heavy))
                    .foregroundColor(.white)

                // Route map of the run that was just finished (outdoor only).
                if summary.routeCoordinates.count >= 2 {
                    CardioRouteMap(coordinates: summary.routeCoordinates, color: activity.color)
                        .frame(height: 110)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .padding(.horizontal, 8)
                }

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                    summaryTile(value: formatTime(summary.durationSeconds),
                                label: session.tr("TIME", "TIEMPO"),
                                color: DS.brandAccent)
                    summaryTile(value: "\(summary.calories)",
                                label: session.tr("CAL", "CAL"),
                                color: DS.streakOrange)
                    summaryTile(value: summary.avgHR > 0 ? "\(summary.avgHR)" : "--",
                                label: session.tr("AVG BPM", "FC PROM"),
                                color: .red)
                    if let km = summary.distanceKm {
                        summaryTile(value: String(format: "%.2f", km),
                                    label: session.tr("KM", "KM"),
                                    color: DS.amber)
                    }
                }
                .padding(.horizontal, 8)

                Button {
                    onDone()
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Text(session.tr("Done", "Listo"))
                        .font(.system(.caption, design: .rounded).weight(.heavy))
                        .foregroundColor(Color(red: 0, green: 0.08, blue: 0.07))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(DS.brandAccent)
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 8)
                .padding(.top, 4)
            }
            .padding(.bottom, 8)
        }
        .background(Color.black)
        .onAppear { WKInterfaceDevice.current().play(.success) }
    }

    @ViewBuilder
    private func summaryTile(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 1) {
            Text(value)
                .font(.system(size: 16, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundColor(color)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.system(size: 8, weight: .heavy, design: .rounded))
                .kerning(0.4)
                .foregroundColor(DS.textSub)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(DS.surface1)
        .cornerRadius(12)
    }

    private func formatTime(_ s: Int) -> String {
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, sec) }
        return String(format: "%d:%02d", m, sec)
    }
}

// MARK: - Free Lift exercise picker

struct FreeLiftExercisePickerView: View {
    @EnvironmentObject var session: WatchSessionManager

    var body: some View {
        ScrollView {
            VStack(spacing: 5) {
                WatchStatusBar(title: session.tr("PICK EXERCISE", "ELIGE EJERCICIO"))
                if session.availableExercises.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "dumbbell.fill")
                            .font(.title3)
                            .foregroundColor(DS.textFaint)
                            .padding(.top, 14)
                        Text(session.tr("No exercises synced", "Sin ejercicios sincronizados"))
                            .font(.system(.caption, design: .rounded).weight(.bold))
                            .foregroundColor(DS.textSub)
                        Text(session.tr("Open TuGymPR on your iPhone\nto sync your library",
                                       "Abre TuGymPR en tu iPhone\npara sincronizar"))
                            .font(.system(.caption2, design: .rounded))
                            .foregroundColor(DS.textFaint)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 6)
                } else {
                    ForEach(Array(session.availableExercises.enumerated()), id: \.offset) { _, ex in
                        Button {
                            session.startFreeLift(exercise: ex)
                            WKInterfaceDevice.current().play(.click)
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "dumbbell.fill")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundColor(DS.brandAccent)
                                    .frame(width: 20)
                                Text((ex["name"] as? String) ?? "Exercise")
                                    .font(.system(.caption, design: .rounded).weight(.heavy))
                                    .foregroundColor(.white)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(DS.surface1)
                            .cornerRadius(12)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
        }
        .background(Color.black)
        .navigationTitle(session.tr("Free lift", "Libre"))
    }
}

// MARK: - Cardio route map (shared by live + summary)
//
// Non-interactive MapKit map that draws the captured GPS route as a polyline
// with a dot on the latest fix. `.constant(.automatic)` keeps the camera
// framed to the route — so the live map follows the run as it grows and the
// summary map fits the whole path. Falls back to a "GPS…" placeholder until
// the first fix arrives.

private struct CardioRouteMap: View {
    let coordinates: [CLLocationCoordinate2D]
    let color: Color

    var body: some View {
        Map(position: .constant(.automatic), interactionModes: []) {
            if coordinates.count >= 2 {
                MapPolyline(coordinates: coordinates)
                    .stroke(color, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            }
            if let last = coordinates.last {
                Annotation("", coordinate: last) {
                    Circle()
                        .fill(color)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(Color.white, lineWidth: 2))
                }
            }
        }
        .overlay {
            if coordinates.isEmpty {
                ZStack {
                    Color.black.opacity(0.45)
                    VStack(spacing: 3) {
                        Image(systemName: "location.fill")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(color)
                        Text("GPS…")
                            .font(.system(size: 10, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                    }
                }
            }
        }
    }
}
