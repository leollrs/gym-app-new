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

    private var currentWeight: Double {
        hasEditedWeight ? editedWeight : session.suggestedWeight
    }

    private var currentReps: Int {
        hasEditedReps ? editedReps : session.suggestedReps
    }

    var body: some View {
        VStack(spacing: 6) {
            // Exercise name
            Text(session.exerciseName)
                .font(.subheadline.weight(.bold))
                .foregroundColor(.white)
                .lineLimit(2)
                .multilineTextAlignment(.center)

            // Set counter with PR badge + offline indicator
            HStack(spacing: 4) {
                let displaySet = session.setNumber > 0 ? session.setNumber : max(1, localCompletedSets + 1)
                Text("Set \(displaySet) of \(session.totalSets)")
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.gray)

                if session.currentSetIsPR {
                    Text("PR!")
                        .font(.caption2.weight(.black))
                        .foregroundColor(.black)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(DS.gold)
                        .cornerRadius(6)
                }
            }

            // ── Weight editor ──
            HStack(spacing: 8) {
                Button {
                    adjustWeight(-5)
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Image(systemName: "minus")
                        .font(.caption.weight(.bold))
                        .foregroundColor(DS.gold)
                        .frame(width: 44, height: 44)
                        .background(DS.cardBg)
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Decrease weight")

                VStack(spacing: 0) {
                    Text("\(Int(currentWeight))")
                        .font(.system(.title2, design: .rounded).weight(.black))
                        .foregroundColor(.white)
                    Text("lbs")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(DS.mutedText)
                }
                .frame(minWidth: 55)

                Button {
                    adjustWeight(5)
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Image(systemName: "plus")
                        .font(.caption.weight(.bold))
                        .foregroundColor(DS.gold)
                        .frame(width: 44, height: 44)
                        .background(DS.cardBg)
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Increase weight")
            }

            // ── Reps editor ──
            HStack(spacing: 10) {
                Button {
                    adjustReps(-1)
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Image(systemName: "minus")
                        .font(.caption.weight(.bold))
                        .foregroundColor(DS.gold)
                        .frame(width: 44, height: 44)
                        .background(DS.cardBg)
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Decrease reps")

                VStack(spacing: 0) {
                    Text("\(currentReps)")
                        .font(.system(.title2, design: .rounded).weight(.black))
                        .foregroundColor(.white)
                    Text("reps")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(DS.mutedText)
                }
                .frame(minWidth: 55)

                Button {
                    adjustReps(1)
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Image(systemName: "plus")
                        .font(.caption.weight(.bold))
                        .foregroundColor(DS.gold)
                        .frame(width: 44, height: 44)
                        .background(DS.cardBg)
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Increase reps")
            }

            // ── Done button ──
            Button {
                session.completeSet(actualReps: currentReps, actualWeight: currentWeight)
                localCompletedSets += 1
                WKInterfaceDevice.current().play(.success)
                hasEditedReps = false
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.subheadline)
                        .accessibilityLabel("Complete set")
                    Text("Done")
                        .font(.subheadline.weight(.bold))
                }
                .foregroundColor(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(DS.gold)
                .cornerRadius(10)
            }
            .buttonStyle(.plain)

            // Offline queue indicator
            if session.pendingActionCount > 0 {
                HStack(spacing: 3) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.caption2)
                        .accessibilityLabel("Pending sync")
                    Text("\(session.pendingActionCount) queued")
                        .font(.caption2.weight(.medium))
                }
                .foregroundColor(.orange.opacity(0.8))
            }

            // Elapsed time
            Text(DS.formatTime(localElapsed))
                .font(.system(.caption2, design: .monospaced).weight(.medium))
                .foregroundColor(Color(white: 0.3))
                .accessibilityAddTraits(.updatesFrequently)
                .accessibilityLabel("Elapsed time \(DS.formatTime(localElapsed))")

            // End workout
            Button {
                showEndConfirmation = true
                WKInterfaceDevice.current().play(.click)
            } label: {
                Text("End Workout")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.red.opacity(0.8))
                    .padding(.vertical, 6)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Ends the current workout")
        }
        .padding(.horizontal, 6)
        .padding(.top, 4)
        .background(DS.darkBg)
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
            editedWeight = session.suggestedWeight
            editedReps = session.suggestedReps
            hasEditedWeight = false
            hasEditedReps = false
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
                completedSets: session.totalSets > 0 ? session.setNumber - 1 : 0,
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

    private func adjustReps(_ delta: Int) {
        editedReps = max(1, currentReps + delta)
        hasEditedReps = true
    }
}
