import SwiftUI
import HealthKit

struct HeartRateView: View {
    @State private var heartRate: Double = 0
    @State private var isMonitoring = false
    @State private var workout: HKWorkoutSession?
    @State private var builder: HKLiveWorkoutBuilder?

    private let healthStore = HKHealthStore()
    private let gold = Color(red: 212/255, green: 175/255, blue: 55/255)
    private let darkBg = Color(red: 5/255, green: 7/255, blue: 11/255)

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "heart.fill")
                .font(.system(size: 28))
                .foregroundColor(isMonitoring ? .red : gold)
                .symbolEffect(.pulse, isActive: isMonitoring)

            if heartRate > 0 {
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(Int(heartRate))")
                        .font(.system(size: 42, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                    Text("BPM")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.gray)
                }
            } else {
                Text("--")
                    .font(.system(size: 42, weight: .black, design: .rounded))
                    .foregroundColor(Color(white: 0.3))
            }

            Button(action: {
                if isMonitoring {
                    stopMonitoring()
                } else {
                    startMonitoring()
                }
            }) {
                HStack(spacing: 6) {
                    Image(systemName: isMonitoring ? "stop.fill" : "play.fill")
                        .font(.system(size: 12))
                    Text(isMonitoring ? "Stop" : "Start")
                        .font(.system(size: 14, weight: .bold))
                }
                .foregroundColor(isMonitoring ? .white : .black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(isMonitoring ? Color.red.opacity(0.3) : gold)
                .cornerRadius(10)
            }

            Text("Heart Rate")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.gray)
                .textCase(.uppercase)
        }
        .padding(.horizontal, 8)
        .background(darkBg)
        .onAppear { requestAuthorization() }
    }

    private func requestAuthorization() {
        let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
        let workoutType = HKObjectType.workoutType()
        healthStore.requestAuthorization(toShare: [workoutType], read: [hrType]) { _, _ in }
    }

    private func startMonitoring() {
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)

            builder.dataSource?.enableCollection(for: HKQuantityType.quantityType(forIdentifier: .heartRate)!, predicate: nil)

            self.workout = session
            self.builder = builder

            session.startActivity(with: Date())
            builder.beginCollection(withStart: Date()) { _, _ in }

            isMonitoring = true

            // Observe HR updates
            let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
            let query = HKAnchoredObjectQuery(type: hrType, predicate: nil, anchor: nil, limit: HKObjectQueryNoLimit) { _, _, _, _, _ in }
            query.updateHandler = { _, samples, _, _, _ in
                guard let samples = samples as? [HKQuantitySample], let latest = samples.last else { return }
                DispatchQueue.main.async {
                    self.heartRate = latest.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                }
            }
            healthStore.execute(query)
        } catch {
            print("Failed to start workout session: \(error)")
        }
    }

    private func stopMonitoring() {
        workout?.end()
        builder?.endCollection(withEnd: Date()) { _, _ in
            self.builder?.finishWorkout { _, _ in }
        }
        isMonitoring = false
        heartRate = 0
        workout = nil
        builder = nil
    }
}
