import Foundation

struct CoachExerciseSummary {
    let name: String
    let sets: Int
    let pattern: String
    let primaryMuscle: String
    let compound: Bool
}

struct CoachDaySummary {
    let name: String
    let type: String
    let exercises: [CoachExerciseSummary]
}

struct CoachSuggestion {
    let title: String
    let plain: String
    let prompt: String
    let terms: [String]
}

enum CoachSuggestionEngine {
    static func suggestions(for days: [CoachDaySummary]) -> [CoachSuggestion] {
        guard !days.isEmpty else {
            return [
                CoachSuggestion(
                    title: "Start with a simple split",
                    plain: "You do not have a plan yet. Start with 3 or 4 training days so the coach can balance your week for you.",
                    prompt: "Create me a simple 4 day split with balanced push, pull, legs, and recovery.",
                    terms: ["split", "balance"]
                )
            ]
        }

        var results: [CoachSuggestion] = []

        for day in days where day.type != "rest" {
            var names: [String: Int] = [:]
            var patterns: [String: Int] = [:]
            var muscleSets: [String: Int] = [:]
            var compoundCount = 0
            var isolationCount = 0

            for exercise in day.exercises {
                let key = exercise.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                names[key, default: 0] += 1
                patterns[exercise.pattern, default: 0] += 1
                muscleSets[exercise.primaryMuscle, default: 0] += exercise.sets
                if exercise.compound { compoundCount += 1 } else { isolationCount += 1 }
            }

            if let duplicate = names.first(where: { $0.value > 1 }) {
                results.append(
                    CoachSuggestion(
                        title: "Combine duplicate exercises",
                        plain: "\(day.name) repeats \(duplicate.key.capitalized). Keep one line and add the sets together so the workout is easier to follow.",
                        prompt: "Explain in plain language why I should combine duplicate \(duplicate.key) entries on \(day.name).",
                        terms: ["overlap", "volume"]
                    )
                )
            }

            if let overloaded = muscleSets.max(by: { $0.value < $1.value }), overloaded.value >= 16 {
                results.append(
                    CoachSuggestion(
                        title: "This day may be too crowded",
                        plain: "\(day.name) puts \(overloaded.value) sets on \(overloaded.key). Spread part of that work to another day so performance stays higher.",
                        prompt: "Rewrite \(day.name) so \(overloaded.key.lowercased()) is not overloaded in one session.",
                        terms: ["volume", "recovery"]
                    )
                )
            }

            if let repeated = patterns.first(where: { $0.value >= 3 && $0.key != "unknown" }) {
                results.append(
                    CoachSuggestion(
                        title: "Too many similar movement angles",
                        plain: "\(day.name) repeats the \(repeated.key) pattern a lot. Swap one exercise so the day trains more than one angle.",
                        prompt: "Suggest one better replacement for a repeated \(repeated.key) exercise on \(day.name).",
                        terms: ["overlap", "balance"]
                    )
                )
            }

            if isolationCount >= 4 && compoundCount <= 1 {
                results.append(
                    CoachSuggestion(
                        title: "This day needs a stronger base lift",
                        plain: "\(day.name) leans heavily on smaller isolation work. Start with 1 or 2 compound lifts so the session is more efficient.",
                        prompt: "Improve \(day.name) by adding better compound exercises first and keeping it simple.",
                        terms: ["balance", "volume"]
                    )
                )
            }
        }

        return Array(results.prefix(5))
    }
}
