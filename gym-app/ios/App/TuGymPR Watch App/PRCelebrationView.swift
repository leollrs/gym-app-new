import SwiftUI
import WatchKit

struct PRCelebrationView: View {
    @Binding var isPresented: Bool
    @State private var trophyScale: CGFloat = 0.3
    @State private var trophyRotation: Double = -30
    @State private var textOpacity: Double = 0
    @State private var backgroundOpacity: Double = 0

    var body: some View {
        ZStack {
            // Semi-transparent dark overlay
            Color.black.opacity(backgroundOpacity * 0.75)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                Spacer()

                // Animated trophy
                Image(systemName: "trophy.fill")
                    .font(.system(size: 52))
                    .foregroundColor(DS.gold)
                    .scaleEffect(trophyScale)
                    .rotationEffect(.degrees(trophyRotation))
                    .shadow(color: DS.gold.opacity(0.6), radius: 16)

                // NEW PR text
                Text("NEW PR!")
                    .font(.system(size: 22, weight: .black, design: .rounded))
                    .foregroundColor(DS.gold)
                    .tracking(2)
                    .opacity(textOpacity)

                // Subtitle
                Text("Personal Record")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(DS.mutedText)
                    .opacity(textOpacity)

                Spacer()
            }
        }
        .onAppear {
            // Haptic feedback
            WKInterfaceDevice.current().play(.notification)

            // Animate in
            withAnimation(.spring(response: 0.5, dampingFraction: 0.6, blendDuration: 0)) {
                trophyScale = 1.0
                trophyRotation = 0
                backgroundOpacity = 1.0
            }

            withAnimation(.easeOut(duration: 0.4).delay(0.3)) {
                textOpacity = 1.0
            }

            // Auto-dismiss after 3 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                withAnimation(.easeOut(duration: 0.3)) {
                    backgroundOpacity = 0
                    trophyScale = 0.3
                    textOpacity = 0
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    isPresented = false
                }
            }
        }
    }
}
