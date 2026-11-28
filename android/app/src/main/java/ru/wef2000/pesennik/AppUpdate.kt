package ru.wef2000.pesennik

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.security.MessageDigest

data class AppUpdate(val versionCode: Long, val versionName: String, val apkUrl: String, val sha256: String) {
    fun json(): String = JSONObject().put("versionCode", versionCode).put("versionName", versionName).put("apkUrl", apkUrl).put("sha256", sha256).toString()
    companion object {
        fun parse(raw: String): AppUpdate {
            val value = JSONObject(raw)
            val code = value.get("versionCode")
            require((code is Int || code is Long) && (code as Number).toLong() > 0) { "Некорректная версия APK" }
            val name = value.get("versionName"); val url = value.get("apkUrl"); val sha = value.get("sha256")
            require(name is String && name.isNotBlank() && name.length <= 50 && url is String && sha is String && Regex("[a-f0-9]{64}").matches(sha)) { "Некорректные данные обновления APK" }
            require(UpdateUrls.releaseApk(URL(url))) { "Неверный адрес APK" }
            return AppUpdate((code as Number).toLong(), name, url, sha)
        }
    }
}

object ApkVerification {
    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val bytes = ByteArray(16384); while (true) { val count = input.read(bytes); if (count < 0) break; digest.update(bytes, 0, count) } }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
    @Suppress("DEPRECATION")
    private fun signatures(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners ?: info.signatures else info.signatures
        return signatures?.map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { byte -> "%02x".format(byte) } }?.toSet() ?: emptySet()
    }
    @Suppress("DEPRECATION")
    fun verify(context: Context, file: File, update: AppUpdate) {
        require(sha256(file) == update.sha256) { "Проверка APK не пройдена. Файл не будет установлен." }
        // Android 9/10 collects archive certificates only when GET_SIGNATURES is also set.
        val flags = PackageManager.GET_SIGNATURES or if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else 0
        val archive = context.packageManager.getPackageArchiveInfo(file.absolutePath, flags) ?: error("Повреждённый APK")
        val installed = context.packageManager.getPackageInfo(context.packageName, flags)
        val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        require(archive.packageName == context.packageName && code == update.versionCode && code > BuildConfig.VERSION_CODE) { "APK не соответствует обновлению Песенника" }
        val current = signatures(installed)
        require(current.isNotEmpty() && current == signatures(archive)) { "Подпись APK отличается. Файл не будет установлен." }
    }
}
