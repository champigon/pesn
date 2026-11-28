package ru.wef2000.pesennik

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.OutputStream
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.HttpsURLConnection

object UpdateUrls {
    const val CATALOG = "https://pesn.wef2000.ru/catalog.json"
    const val APPLICATION = "https://pesn.wef2000.ru/android-update.json"
    fun allowed(url: URL): Boolean = url.protocol == "https" && url.port in listOf(-1, 443) && url.userInfo == null && when (url.host.lowercase()) {
        "pesn.wef2000.ru" -> url.path in listOf("/catalog.json", "/android-update.json")
        "github.com" -> url.path.startsWith("/champigon/pesn/releases/download/")
        "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com" -> true
        else -> false
    }
    fun releaseApk(url: URL): Boolean = allowed(url) && url.host == "github.com" && url.path.startsWith("/champigon/pesn/releases/download/") && url.path.endsWith(".apk")
}

// No singleton starts requests, no jobs, services, alarms or automatic retries.
// Each instance exists only for a foreground operation initiated by a button.
class ManualNetwork(private val open: (URL) -> HttpsURLConnection = { it.openConnection() as HttpsURLConnection }) : Closeable {
    private val active = AtomicBoolean(true)
    @Volatile private var connection: HttpsURLConnection? = null
    companion object { val openedConnections = AtomicInteger() }
    private fun checkActive() { if (!active.get() || Thread.currentThread().isInterrupted) throw CancellationException("Загрузка отменена") }
    fun text(url: String, limit: Int = 16 * 1024 * 1024): String {
        val bytes = ByteArrayOutputStream()
        download(url, bytes, limit)
        return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
    }
    fun download(address: String, destination: OutputStream, limit: Int) {
        var url = URL(address)
        repeat(6) {
            checkActive(); require(UpdateUrls.allowed(url)) { "Недопустимый адрес обновления" }
            val current = open(url)
            connection = current
            try {
                checkActive()
                current.instanceFollowRedirects = false
                current.connectTimeout = 15000; current.readTimeout = 15000
                current.useCaches = false
                current.setRequestProperty("Cache-Control", "no-cache")
                current.setRequestProperty("User-Agent", "Pesennik-Android/${BuildConfig.VERSION_NAME}")
                checkActive(); openedConnections.incrementAndGet()
                val status = current.responseCode
                if (status in listOf(301, 302, 303, 307, 308)) {
                    val location = current.getHeaderField("Location") ?: error("Сервер вернул пустой адрес")
                    url = URL(url, location)
                } else {
                    require(status == 200) { if (status == 404) "Обновление пока не опубликовано" else "Сервер недоступен (код $status)" }
                    require(current.contentLengthLong <= limit) { "Файл обновления слишком большой" }
                    var total = 0
                    current.inputStream.use { input ->
                        val buffer = ByteArray(16384)
                        while (true) {
                            checkActive(); val count = input.read(buffer); if (count < 0) break
                            total += count; require(total <= limit) { "Файл обновления слишком большой" }
                            destination.write(buffer, 0, count)
                        }
                    }
                    checkActive(); return
                }
            } finally { current.disconnect(); if (connection === current) connection = null }
        }
        error("Слишком много перенаправлений сервера")
    }
    override fun close() { active.set(false); connection?.disconnect() }
}
