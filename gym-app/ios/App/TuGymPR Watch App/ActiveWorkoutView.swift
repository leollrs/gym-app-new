import SwiftUI
import WatchKit

struct ActiveWorkoutView: View {
    @EnvironmentObject var session: WatchSessionManager

    // Editable weight & reps
    @State private var editedWeight: Double = 0
    @State private var editedReps: Int = 0
    @State private var hasEditedWeight: Bool = false
    @State private var hasEditedReps: Bool = false

    // Local elapsed timer
    @State private var localElapsed: Int = 0
    @State private var timer: Timer?
    @State private var showEndConfirmation: Bool = false

    // Local offline set tracking — advances UI when phone is unreachable
    @State private var localCompletedSets: Int = 0

    // "Add Exercise" picker sheet
    @State private var showAddExercisePicker: Bool = false

    private var currentWeight: Double {
        hasEditedWeight ? editedWeight : session.suggestedWeight
    }

    private var currentReps: Int {
        hasEditedReps ? editedReps : session.suggestedReps
    }

    /// Sets to show on the end-confirmation sheet. Free-lift sessions keep
    /// `totalSets == 0`, so the old `totalSets > 0 ? setNumber-1 : 0` always
    /// read 0 — sum the logged sets across every free-lift entry instead, and
    /// fall back to the locally-tracked count for routines the phone hasn't
    /// advanced.
    private var endConfirmCompletedSets: Int {
        if session.isFreeLiftActive {
            return session.freeLiftEntries.reduce(0) { acc, entry in
                acc + ((entry["sets"] as? [[String: Any]])?.count ?? 0)
            }
        }
        if session.totalSets > 0 { return max(0, session.setNumber - 1) }
        return localCompletedSets
    }

    /// True when the user has logged every set the phone said belonged to
    /// this exercise. Used to flip "DONE SET" into an "EXERCISE DONE"
    /// state instead of bumping the counter past the configured total.
    private var exerciseDone: Bool {
        let isFreeLift = session.freeLiftExercise != nil
        if isFreeLift { return false }
        let total = max(0, session.totalSets)
        return total > 0 && localCompletedSets >= total
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                // Status bar — orange brand title
                WatchStatusBar(title: session.tr("WORKOUT", "ENTRENAMIENTO"))

                // Exercise eyebrow — "SET X / Y" + name. Capped so we never
                // render "SET 5 OF 4" while the phone catches up between
                // exercises.
                VStack(alignment: .leading, spacing: 1) {
                    let isFreeLift = session.freeLiftExercise != nil
                    let raw = session.setNumber > 0 ? session.setNumber : max(1, localCompletedSets + 1)
                    let total = max(1, session.totalSets)
                    let displaySet = isFreeLift ? raw : min(raw, total)

                    HStack(spacing: 4) {
                        if exerciseDone {
                            Text(session.tr("EXERCISE DONE", "EJERCICIO LISTO"))
                                .font(.system(size: 10, weight: .heavy, design: .rounded))
                                .kerning(0.6)
                                .foregroundColor(DS.brandAccent)
                        } else if isFreeLift {
                            Text("\(session.tr("SET", "SERIE")) \(displaySet)")
                                .font(.system(size: 10, weight: .heavy, design: .rounded))
                                .kerning(0.6)
                                .foregroundColor(DS.amber)
                        } else {
                            Text("\(session.tr("SET", "SERIE")) \(displaySet) / \(total)")
                                .font(.system(size: 10, weight: .heavy, design: .rounded))
                                .kerning(0.6)
                                .foregroundColor(DS.amber)
                        }
                        if session.currentSetIsPR {
                            Text("PR!")
                                .font(.system(size: 9, weight: .black, design: .rounded))
                                .foregroundColor(.black)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(DS.amber)
                                .cornerRadius(6)
                        }
                    }

                    Text(session.exerciseName.isEmpty ? session.tr("Exercise", "Ejercicio") : session.exerciseName)
                        .font(.system(size: 17, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)

                // ── Weight row (primary, on top) ──────────────────────────
                // Single inline row matching the iPhone set-logger:
                //   [ −5 ]  135 lbs  [ +5 ]
                HStack(spacing: 6) {
                    miniStepButton("−2.5", role: .minus) { adjustWeight(-2.5) }
                    VStack(spacing: 0) {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text(formatWeight(currentWeight))
                                .font(.system(size: 30, weight: .heavy, design: .rounded))
                                .foregroundColor(DS.brandAccent)
                                .monospacedDigit()
                                .minimumScaleFactor(0.5)
                                .lineLimit(1)
                            Text("lbs")
                                .font(.system(size: 11, weight: .bold, design: .rounded))
                                .foregroundColor(DS.textSub)
                        }
                        Text(session.tr("WEIGHT", "PESO"))
                            .font(.system(size: 8, weight: .heavy, design: .rounded))
                            .kerning(0.5)
                            .foregroundColor(DS.textFaint)
                    }
                    .frame(maxWidth: .infinity)
                    miniStepButton("+2.5", role: .plus) { adjustWeight(2.5) }
                }
                .padding(.horizontal, 10)

                // ── Reps row (directly below weight) ───────────────────────
                //   [ − ]  10 reps  [ + ]
                HStack(spacing: 6) {
                    miniStepButton("−", role: .minus) { adjustReps(-1) }
                    VStack(spacing: 0) {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(currentReps)")
                                .font(.system(size: 26, weight: .heavy, design: .rounded))
                                .foregroundColor(DS.amber)
                                .monospacedDigit()
                                .minimumScaleFactor(0.5)
                                .lineLimit(1)
                            Text(session.tr("reps", "reps"))
                                .font(.system(size: 10, weight: .bold, design: .rounded))
                                .foregroundColor(DS.textSub)
                        }
                        Text(session.tr("REPS", "REPS"))
                            .font(.system(size: 8, weight: .heavy, design: .rounded))
                            .kerning(0.5)
                            .foregroundColor(DS.textFaint)
                    }
                    .frame(maxWidth: .infinity)
                    miniStepButton("+", role: .plus) { adjustReps(1) }
                }
                .padding(.horizontal, 10)

                // Primary — DONE SET (or "Exercise Done" indicator). When
                // every set is logged we lock the button so the user can't
                // accidentally bump into "set 5 of 4" — they explicitly
                // hit the Add Set pill below if they want one more.
                Button {
                    if exerciseDone { return }
                    session.completeSet(actualReps: currentReps, actualWeight: currentWeight)
                    localCompletedSets += 1
                    WKInterfaceDevice.current().play(.success)
                    hasEditedReps = false
                } label: {
                    Text(exerciseDone
                         ? session.tr("EXERCISE DONE", "EJERCICIO LISTO")
                         : session.tr("DONE SET", "SERIE LISTA"))
                        .font(.system(.subheadline, design: .rounded).weight(.heavy))
                        .kerning(0.4)
                        .foregroundColor(exerciseDone ? .white : Color(red: 0, green: 0.08, blue: 0.07))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(exerciseDone ? DS.surface1 : DS.brandAccent)
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 10)

                // ── In-workout actions — Skip / + Set / − Set / + Exercise.
                // Single tight row right under DONE SET so the user never
                // has to scroll to find them.
                HStack(spacing: 4) {
                    miniActionPill(icon: "forward.fill", color: DS.amber) {
                        session.skipSetTap()
                        localCompletedSets += 1
                        WKInterfaceDevice.current().play(.click)
                    }
                    miniActionPill(icon: "plus", color: DS.brandAccent) {
                        session.addSetTap()
                        WKInterfaceDevice.current().play(.click)
                    }
                    miniActionPill(icon: "minus", color: DS.dangerRed) {
                        session.removeSetTap()
                        WKInterfaceDevice.current().play(.click)
                    }
                    miniActionPill(icon: "plus.square.fill", color: Color(red: 109/255, green: 95/255, blue: 219/255)) {
                        showAddExercisePicker = true
                        WKInterfaceDevice.current().play(.click)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.top, 2)

                // Tiny labels under the pills so the icons aren't ambiguous.
                HStack(spacing: 4) {
                    miniActionLabel(session.tr("Skip", "Saltar"))
                    miniActionLabel(session.tr("+ Set", "+ Serie"))
                    miniActionLabel(session.tr("− Set", "− Serie"))
                    miniActionLabel(session.tr("+ Ex", "+ Ej"))
                }
                .padding(.horizontal, 10)

                // Offline queue indicator
                if session.pendingActionCount > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.caption2)
                            .accessibilityLabel("Pending sync")
                        Text("\(session.pendingActionCount) \(session.tr("queued", "en cola"))")
                            .font(.system(.caption2, design: .rounded).weight(.medium))
                    }
                    .foregroundColor(DS.streakOrange.opacity(0.85))
                }

                // Elapsed time
                Text(DS.formatTime(localElapsed))
                    .font(.system(.caption2, design: .rounded).weight(.bold))
                    .monospacedDigit()
                    .foregroundColor(DS.textFaint)
                    .accessibilityAddTraits(.updatesFrequently)
                    .accessibilityLabel("Elapsed time \(DS.formatTime(localElapsed))")

                // End workout
                Button {
                    showEndConfirmation = true
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Text(session.tr("End Workout", "Terminar entrenamiento"))
                        .font(.system(.caption, design: .rounded).weight(.semibold))
                        .foregroundColor(DS.dangerRed.opacity(0.85))
                        .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Ends the current workout")
            }
            .padding(.top, 2)
            .padding(.bottom, 8)
        }
        .background(Color.black)
        .onAppear {
            editedWeight = session.suggestedWeight
            editedReps = session.suggestedReps
            localElapsed = session.elapsedSeconds
            startLocalTimer()
        }
        .onDisappear {
            timer?.invalidate()
        }
        .onChange(of: session.exerciseName) { _ in
            // Phone advanced to a different exercise — reset every per-
            // exercise piece of local state so we don't display stale
            // counts (e.g. "SET 5 OF 4" sticking around) or stale targets.
            editedWeight = session.suggestedWeight
            editedReps = session.suggestedReps
            hasEditedWeight = false
            hasEditedReps = false
            localCompletedSets = 0
        }
        .onChange(of: session.suggestedWeight) { newWeight in
            if !hasEditedWeight {
                editedWeight = newWeight
            }
        }
        .onChange(of: session.suggestedReps) { newReps in
            if !hasEditedReps {
                editedReps = newReps
            }
        }
        .onChange(of: session.setNumber) { _ in
            hasEditedReps = false
        }
        .onChange(of: session.elapsedSeconds) { newValue in
            if abs(localElapsed - newValue) > 3 {
                localElapsed = newValue
            }
        }
        .sheet(isPresented: $showEndConfirmation) {
            EndWorkoutConfirmView(
                elapsedTime: localElapsed,
                completedSets: endConfirmCompletedSets,
                onSaveAndEnd: {
                    showEndConfirmation = false
                    session.saveAndEndWorkout()
                    WKInterfaceDevice.current().play(.success)
                },
                onKeepGoing: {
                    showEndConfirmation = false
                    WKInterfaceDevice.current().play(.click)
                }
            )
        }
        .sheet(isPresented: $showAddExercisePicker) {
            // Same exercise list the Free Lift picker shows — the picked
            // exercise is appended to the live session via `add_exercise`.
            ActiveAddExerciseSheet(onPicked: { exercise in
                session.addExerciseTap(exercise: exercise)
                showAddExercisePicker = false
            }, onCancel: { showAddExercisePicker = false })
        }
    }

    @ViewBuilder
    private func miniActionPill(icon: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(color)
                .frame(maxWidth: .infinity, minHeight: 30)
                .background(color.opacity(0.18))
                .cornerRadius(9)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func miniActionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 8, weight: .heavy, design: .rounded))
            .kerning(0.3)
            .foregroundColor(DS.textFaint)
            .frame(maxWidth: .infinity)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    // MARK: - Components

    private enum StepRole { case plus, minus }

    @ViewBuilder
    private func miniStepButton(_ label: String, role: StepRole, action: @escaping () -> Void) -> some View {
        Button {
            action()
            WKInterfaceDevice.current().play(.click)
        } label: {
            Text(label)
                .font(.system(.caption, design: .rounded).weight(.heavy))
                .foregroundColor(.white)
                .frame(width: 40, height: 32)
                .background(DS.surface1)
                .cornerRadius(10)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(role == .plus ? "Increase" : "Decrease")
    }

    // MARK: - Local Timer

    private func startLocalTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            localElapsed += 1
        }
    }

    private func adjustWeight(_ delta: Double) {
        editedWeight = max(0, currentWeight + delta)
        hasEditedWeight = true
    }

    /// Render whole weights as "135" and half-pound suggestions as "137.5"
    /// (the overload engine works on a 2.5 lb grid). Previously the view used
    /// `Int(currentWeight)`, which truncated 137.5 → "137" and logged the
    /// wrong weight.
    private func formatWeight(_ w: Double) -> String {
        w == w.rounded() ? String(Int(w)) : String(format: "%.1f", w)
    }

    private func adjustReps(_ delta: Int) {
        editedReps = max(1, currentReps + delta)
        hasEditedReps = true
    }
}

// MARK: - Add-exercise picker sheet (called from active workout)

struct ActiveAddExerciseSheet: View {
    @EnvironmentObject var session: WatchSessionManager
    let onPicked: ([String: Any]) -> Void
    let onCancel: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 5) {
                HStack {
                    Text(session.tr("ADD EXERCISE", "AGREGAR"))
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .kerning(0.6)
                        .foregroundColor(DS.brandAccent)
                    Spacer(minLength: 0)
                    Button(action: onCancel) {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.white)
                            .padding(6)
                            .background(DS.surface1)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8)
                .padding(.top, 6)

                if session.availableExercises.isEmpty {
                    Text(session.tr("Open TuGymPR on your iPhone\nto sync your library",
                                   "Abre TuGymPR en tu iPhone\npara sincronizar"))
                        .font(.system(.caption2, design: .rounded))
                        .foregroundColor(DS.textFaint)
                        .multilineTextAlignment(.center)
                        .padding(.top, 12)
                } else {
                    ForEach(Array(session.availableExercises.enumerated()), id: \.offset) { _, ex in
                        Button { onPicked(ex) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "dumbbell.fill")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundColor(DS.brandAccent)
                                    .frame(width: 18)
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
            .padding(.bottom, 8)
        }
        .background(Color.black)
    }
}
