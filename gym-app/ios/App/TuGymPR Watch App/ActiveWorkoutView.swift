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
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(.white)
                .lineLimit(2)
                .multilineTextAlignment(.center)

            // Set counter with PR badge
            HStack(spacing: 4) {
                Text("Set \(session.setNumber) of \(session.totalSets)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.gray)

                if session.currentSetIsPR {
                    Text("PR!")
                        .font(.system(size: 10, weight: .black))
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
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(DS.gold)
                        .frame(width: 30, height: 30)
                        .background(DS.cardBg)
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)

                VStack(spacing: 0) {
                    Text("\(Int(currentWeight))")
                        .font(.system(size: 26, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                    Text("lbs")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(DS.mutedText)
                }
                .frame(minWidth: 55)

                Button {
                    adjustWeight(5)
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(DS.gold)
                        .frame(width: 30, height: 30)
                        .background(DS.cardBg)
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)
            }

            // ── Reps editor ──
            HStack(spacing: 10) {
                Button {
                    adjustReps(-1)
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Image(systemName: "minus")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(DS.gold)
                        .frame(width: 30, height: 30)
                        .background(DS.cardBg)
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)

                VStack(spacing: 0) {
                    Text("\(currentReps)")
                        .font(.system(size: 26, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                    Text("reps")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(DS.mutedText)
                }
                .frame(minWidth: 55)

                Button {
                    adjustReps(1)
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(DS.gold)
                        .frame(width: 30, height: 30)
                        .background(DS.cardBg)
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)
            }

            // ── Done button ──
            Button {
                session.completeSet(actualReps: currentReps, actualWeight: currentWeight)
                WKInterfaceDevice.current().play(.success)
                hasEditedReps = false
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 13))
                    Text("Done")
                        .font(.system(size: 14, weight: .bold))
                }
                .foregroundColor(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(DS.gold)
                .cornerRadius(10)
            }
            .buttonStyle(.plain)

            // Elapsed time
            Text(DS.formatTime(localElapsed))
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(Color(white: 0.3))

            // End workout
            Button {
                showEndConfirmation = true
                WKInterfaceDevice.current().play(.click)
            } label: {
                Text("End Workout")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.red.opacity(0.8))
                    .padding(.vertical, 6)
            }
            .buttonStyle(.plain)
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
