import SwiftUI
import WatchKit

struct RPEInputView: View {
    let onSelect: (Int) -> Void
    let onSkip: () -> Void

    @State private var selectedRPE: Int? = nil

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                // Header
                Text("HOW HARD?")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundColor(DS.gold)
                    .tracking(2)
                    .padding(.top, 4)

                Text("Rate of Perceived Exertion")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(DS.mutedText)

                // RPE grid (2 columns x 5 rows)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                    ForEach(1...10, id: \.self) { value in
                        RPECell(
                            value: value,
                            isSelected: selectedRPE == value,
                            onTap: {
                                selectedRPE = value
                                WKInterfaceDevice.current().play(.click)
                            }
                        )
                    }
                }

                // Effort label for selected RPE
                if let rpe = selectedRPE {
                    Text(effortLabel(for: rpe))
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(rpeColor(for: rpe))
                        .transition(.opacity)
                        .animation(.easeOut(duration: 0.2), value: selectedRPE)
                }

                // Confirm button
                GoldButton("Done", icon: "checkmark.circle.fill") {
                    guard let rpe = selectedRPE else { return }
                    WKInterfaceDevice.current().play(.success)
                    onSelect(rpe)
                }
                .opacity(selectedRPE != nil ? 1.0 : 0.4)
                .disabled(selectedRPE == nil)

                // Skip button
                Button(action: {
                    WKInterfaceDevice.current().play(.click)
                    onSkip()
                }) {
                    Text("Skip")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(DS.mutedText)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 8)
        }
        .background(DS.darkBg)
    }

    // MARK: - Helpers

    private func effortLabel(for rpe: Int) -> String {
        switch rpe {
        case 1...3: return "Easy"
        case 4...6: return "Moderate"
        case 7, 8:  return "Hard"
        case 9, 10: return "Max Effort"
        default:    return ""
        }
    }
}

// MARK: - Color helper (top-level for reuse)

func rpeColor(for rpe: Int) -> Color {
    switch rpe {
    case 1...3: return .green
    case 4...6: return .yellow
    case 7, 8:  return .orange
    case 9, 10: return .red
    default:    return .gray
    }
}

// MARK: - RPE Cell

struct RPECell: View {
    let value: Int
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text("\(value)")
                .font(.system(size: 18, weight: .black, design: .rounded))
                .foregroundColor(isSelected ? .black : rpeColor(for: value))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(
                    isSelected
                        ? rpeColor(for: value)
                        : rpeColor(for: value).opacity(0.15)
                )
                .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}
