import SwiftUI

@main
struct IntentKeyboardHostApp: App {
    var body: some Scene {
        WindowGroup {
            SetupView()
        }
    }
}

private struct SetupView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Enable Intent Keyboard") {
                    step("1", "Open Settings → General → Keyboard → Keyboards.")
                    step("2", "Tap Add New Keyboard and choose Intent Keyboard.")
                    step("3", "Switch keyboards with the globe key in any text field.")
                }

                Section("Privacy") {
                    Text("The first iOS prototype does not request Full Access, so the keyboard extension has no network access and cannot write to shared app-group storage.")
                }

                Section("Prototype") {
                    Text("Type rough text into the keyboard's private intent buffer, choose Raw, Natural or Civilized, render a preview, then commit it into the host app.")
                }
            }
            .navigationTitle("Intent Keyboard")
        }
    }

    private func step(_ number: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number)
                .font(.headline)
                .frame(width: 24, height: 24)
                .background(.secondary.opacity(0.15), in: Circle())
            Text(text)
        }
    }
}
