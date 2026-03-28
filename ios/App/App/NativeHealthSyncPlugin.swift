import Capacitor
import Foundation
import HealthKit

@objc(NativeHealthSyncPlugin)
public class NativeHealthSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeHealthSyncPlugin"
    public let jsName = "NativeHealthSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncSummary", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        if let bodyMass = HKObjectType.quantityType(forIdentifier: .bodyMass) {
            types.insert(bodyMass)
        }
        if let steps = HKObjectType.quantityType(forIdentifier: .stepCount) {
            types.insert(steps)
        }
        if let heartRate = HKObjectType.quantityType(forIdentifier: .heartRate) {
            types.insert(heartRate)
        }
        if let restingHeartRate = HKObjectType.quantityType(forIdentifier: .restingHeartRate) {
            types.insert(restingHeartRate)
        }
        types.insert(HKObjectType.workoutType())
        return types
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": HKHealthStore.isHealthDataAvailable()
        ])
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device.")
            return
        }

        healthStore.requestAuthorization(toShare: [], read: readTypes) { success, error in
            if let error = error {
                call.reject("HealthKit permission request failed.", nil, error)
                return
            }
            call.resolve(["granted": success])
        }
    }

    @objc func syncSummary(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device.")
            return
        }

        let days = call.getInt("days") ?? 30
        let now = Date()
        let startOfDay = Calendar.current.startOfDay(for: now)
        let since = Calendar.current.date(byAdding: .day, value: -days, to: now) ?? now.addingTimeInterval(Double(days * -86400))
        let group = DispatchGroup()

        var bodyWeightLbs: Double?
        var stepsToday: Double?
        var restingHeartRate: Double?
        var workoutsLast30Days = 0
        var lastWorkoutAt: String?
        var firstError: Error?

        group.enter()
        latestQuantity(identifier: .bodyMass, unit: .pound()) { value, error in
            bodyWeightLbs = value
            if firstError == nil { firstError = error }
            group.leave()
        }

        group.enter()
        sumQuantity(identifier: .stepCount, startDate: startOfDay, endDate: now, unit: HKUnit.count()) { value, error in
            stepsToday = value
            if firstError == nil { firstError = error }
            group.leave()
        }

        group.enter()
        latestHeartRate { value, error in
            restingHeartRate = value
            if firstError == nil { firstError = error }
            group.leave()
        }

        group.enter()
        workoutSummary(startDate: since, endDate: now) { count, lastDate, error in
            workoutsLast30Days = count
            lastWorkoutAt = lastDate?.ISO8601Format()
            if firstError == nil { firstError = error }
            group.leave()
        }

        group.notify(queue: .main) {
            if let error = firstError {
                call.reject("Failed to read HealthKit data.", nil, error)
                return
            }

            var payload: [String: Any] = [
                "stepsToday": Int(stepsToday ?? 0),
                "workoutsLast30Days": workoutsLast30Days
            ]
            if let bodyWeightLbs {
                payload["bodyWeightLbs"] = (bodyWeightLbs * 10).rounded() / 10
            }
            if let restingHeartRate {
                payload["restingHeartRate"] = Int(restingHeartRate.rounded())
            }
            if let lastWorkoutAt {
                payload["lastWorkoutAt"] = lastWorkoutAt
            }
            call.resolve(payload)
        }
    }

    private func latestQuantity(identifier: HKQuantityTypeIdentifier, unit: HKUnit, completion: @escaping (Double?, Error?) -> Void) {
        guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
            completion(nil, nil)
            return
        }
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(sampleType: quantityType, predicate: nil, limit: 1, sortDescriptors: [sort]) { _, samples, error in
            let quantity = (samples?.first as? HKQuantitySample)?.quantity.doubleValue(for: unit)
            completion(quantity, error)
        }
        healthStore.execute(query)
    }

    private func sumQuantity(identifier: HKQuantityTypeIdentifier, startDate: Date, endDate: Date, unit: HKUnit, completion: @escaping (Double?, Error?) -> Void) {
        guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
            completion(nil, nil)
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let query = HKStatisticsQuery(quantityType: quantityType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, error in
            let value = result?.sumQuantity()?.doubleValue(for: unit)
            completion(value, error)
        }
        healthStore.execute(query)
    }

    private func latestHeartRate(completion: @escaping (Double?, Error?) -> Void) {
        if HKObjectType.quantityType(forIdentifier: .restingHeartRate) != nil {
            latestQuantity(identifier: .restingHeartRate, unit: HKUnit(from: "count/min")) { value, error in
                if value != nil || error != nil {
                    completion(value, error)
                } else {
                    self.latestQuantity(identifier: .heartRate, unit: HKUnit(from: "count/min"), completion: completion)
                }
            }
            return
        }
        latestQuantity(identifier: .heartRate, unit: HKUnit(from: "count/min"), completion: completion)
    }

    private func workoutSummary(startDate: Date, endDate: Date, completion: @escaping (Int, Date?, Error?) -> Void) {
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
            let workouts = (samples as? [HKWorkout]) ?? []
            completion(workouts.count, workouts.first?.endDate, error)
        }
        healthStore.execute(query)
    }
}
