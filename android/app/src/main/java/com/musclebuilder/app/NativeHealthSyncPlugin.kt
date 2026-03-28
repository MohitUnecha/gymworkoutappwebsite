package com.musclebuilder.app

import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

@CapacitorPlugin(name = "NativeHealthSync")
class NativeHealthSyncPlugin : Plugin() {
    private val providerPackageName = "com.google.android.apps.healthdata"
    private val permissions = setOf(
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class)
    )

    private var pendingPermissionCall: PluginCall? = null
    private lateinit var permissionsLauncher: ActivityResultLauncher<Set<String>>

    override fun load() {
        permissionsLauncher = bridge.activity.registerForActivityResult(
            PermissionController.createRequestPermissionResultContract()
        ) { granted ->
            val call = pendingPermissionCall ?: return@registerForActivityResult
            pendingPermissionCall = null
            val payload = JSObject()
            payload.put("granted", granted.containsAll(permissions))
            call.resolve(payload)
        }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val payload = JSObject()
        payload.put("available", sdkAvailable())
        call.resolve(payload)
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (!sdkAvailable()) {
            call.reject("Health Connect is not available on this device.")
            return
        }
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val client = HealthConnectClient.getOrCreate(context)
                val granted = withContext(Dispatchers.IO) {
                    client.permissionController.getGrantedPermissions()
                }
                if (granted.containsAll(permissions)) {
                    val payload = JSObject()
                    payload.put("granted", true)
                    call.resolve(payload)
                    return@launch
                }
                pendingPermissionCall = call
                permissionsLauncher.launch(permissions)
            } catch (error: Exception) {
                call.reject("Failed to request Health Connect permissions.", error)
            }
        }
    }

    @PluginMethod
    fun syncSummary(call: PluginCall) {
        if (!sdkAvailable()) {
            call.reject("Health Connect is not available on this device.")
            return
        }
        val days = call.getInt("days", 30) ?: 30
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val client = HealthConnectClient.getOrCreate(context)
                val granted = withContext(Dispatchers.IO) {
                    client.permissionController.getGrantedPermissions()
                }
                if (!granted.containsAll(permissions)) {
                    call.reject("Health Connect permissions are required before syncing.")
                    return@launch
                }
                val payload = withContext(Dispatchers.IO) {
                    readSummary(client, days)
                }
                call.resolve(payload)
            } catch (error: Exception) {
                call.reject("Failed to read Health Connect data.", error)
            }
        }
    }

    private fun sdkAvailable(): Boolean {
        val status = HealthConnectClient.getSdkStatus(context, providerPackageName)
        return status == HealthConnectClient.SDK_AVAILABLE
    }

    private suspend fun readSummary(client: HealthConnectClient, days: Int): JSObject {
        val now = Instant.now()
        val startOfDay = ZonedDateTime.now(ZoneId.systemDefault()).toLocalDate().atStartOfDay(ZoneId.systemDefault()).toInstant()
        val since = now.minus(days.toLong(), ChronoUnit.DAYS)

        val stepsResponse = client.readRecords(
            ReadRecordsRequest(
                recordType = StepsRecord::class,
                timeRangeFilter = TimeRangeFilter.between(startOfDay, now),
                pageSize = 500
            )
        )
        val stepsToday = stepsResponse.records.sumOf { it.count.toLong() }

        val weightResponse = client.readRecords(
            ReadRecordsRequest(
                recordType = WeightRecord::class,
                timeRangeFilter = TimeRangeFilter.before(now),
                pageSize = 20
            )
        )
        val latestWeight = weightResponse.records.maxByOrNull { record: WeightRecord -> record.time }
        val bodyWeightLbs = latestWeight?.let { record -> massToPounds(record) }

        val heartRateResponse = client.readRecords(
            ReadRecordsRequest(
                recordType = RestingHeartRateRecord::class,
                timeRangeFilter = TimeRangeFilter.before(now),
                pageSize = 10
            )
        )
        val latestHeartRate = heartRateResponse.records.maxByOrNull { record: RestingHeartRateRecord -> record.time }
        val restingHeartRate = latestHeartRate?.beatsPerMinute

        val workoutsResponse = client.readRecords(
            ReadRecordsRequest(
                recordType = ExerciseSessionRecord::class,
                timeRangeFilter = TimeRangeFilter.between(since, now),
                pageSize = 200
            )
        )
        val workouts = workoutsResponse.records
        val lastWorkout: ExerciseSessionRecord? = workouts.maxByOrNull { record -> record.endTime }

        return JSObject().apply {
            put("stepsToday", stepsToday.toInt())
            put("workoutsLast30Days", workouts.size)
            if (bodyWeightLbs != null) put("bodyWeightLbs", kotlin.math.round(bodyWeightLbs * 10.0) / 10.0)
            if (restingHeartRate != null) put("restingHeartRate", restingHeartRate)
            if (lastWorkout != null) put("lastWorkoutAt", lastWorkout.endTime.toString())
        }
    }

    private fun massToPounds(record: WeightRecord): Double? {
        return runCatching {
            val getter = record.weight.javaClass.getMethod("getPounds")
            (getter.invoke(record.weight) as? Number)?.toDouble()
        }.getOrNull()
    }
}
