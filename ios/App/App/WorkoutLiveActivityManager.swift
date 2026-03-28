import Foundation

#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
struct WorkoutLiveActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var phase: String
        var title: String
        var subtitle: String
        var secondsRemaining: Int
    }

    var workoutName: String
}

@available(iOS 16.1, *)
final class WorkoutLiveActivityManager {
    static let shared = WorkoutLiveActivityManager()

    private var currentActivity: Activity<WorkoutLiveActivityAttributes>?

    private init() {}

    func isAvailable() -> Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    func startRest(workoutName: String, title: String, subtitle: String, secondsRemaining: Int) {
        guard isAvailable() else { return }
        let attributes = WorkoutLiveActivityAttributes(workoutName: workoutName)
        let state = WorkoutLiveActivityAttributes.ContentState(
            phase: "rest",
            title: title,
            subtitle: subtitle,
            secondsRemaining: secondsRemaining
        )

        do {
            currentActivity = try Activity.request(
                attributes: attributes,
                contentState: state,
                pushType: nil
            )
        } catch {
            NSLog("MuscleBuilder Live Activity start failed: %@", String(describing: error))
        }
    }

    func updateRest(title: String, subtitle: String, secondsRemaining: Int) {
        guard let currentActivity else { return }
        let state = WorkoutLiveActivityAttributes.ContentState(
            phase: "rest",
            title: title,
            subtitle: subtitle,
            secondsRemaining: secondsRemaining
        )
        Task {
            await currentActivity.update(using: state)
        }
    }

    func showWorkingSet(workoutName: String, exerciseName: String, setLabel: String) {
        guard let currentActivity else {
            startRest(workoutName: workoutName, title: "Working set", subtitle: "\(exerciseName) • \(setLabel)", secondsRemaining: 0)
            return
        }
        let state = WorkoutLiveActivityAttributes.ContentState(
            phase: "working",
            title: "Working set",
            subtitle: "\(exerciseName) • \(setLabel)",
            secondsRemaining: 0
        )
        Task {
            await currentActivity.update(using: state)
        }
    }

    func end() {
        guard let currentActivity else { return }
        Task {
            await currentActivity.end(dismissalPolicy: .immediate)
        }
        self.currentActivity = nil
    }
}
#else
final class WorkoutLiveActivityManager {
    static let shared = WorkoutLiveActivityManager()
    private init() {}
}
#endif
