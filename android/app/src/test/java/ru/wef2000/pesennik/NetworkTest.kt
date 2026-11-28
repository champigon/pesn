package ru.wef2000.pesennik

import org.junit.Assert.*
import org.junit.Test
import java.net.URL
import java.io.ByteArrayInputStream
import java.security.Principal
import java.security.cert.Certificate
import java.util.concurrent.CancellationException
import javax.net.ssl.HttpsURLConnection

class NetworkTest {
    private class Connection(url: URL, private val bytes: ByteArray, private val status: Int = 200, private val redirect: String? = null) : HttpsURLConnection(url) {
        var disconnected = false
        override fun connect() {}
        override fun disconnect() { disconnected = true }
        override fun usingProxy() = false
        override fun getResponseCode() = status
        override fun getContentLengthLong() = bytes.size.toLong()
        override fun getInputStream() = ByteArrayInputStream(bytes)
        override fun getHeaderField(name: String) = if (name == "Location") redirect else null
        override fun getCipherSuite() = "TLS"
        override fun getLocalCertificates(): Array<Certificate>? = null
        override fun getServerCertificates(): Array<Certificate> = emptyArray()
        override fun getPeerPrincipal(): Principal? = null
        override fun getLocalPrincipal(): Principal? = null
    }
    @Test fun constructionAndCancellationNeverOpenAConnection() {
        var count = 0; val gate = ManualNetwork { count++; Connection(it, byteArrayOf()) }
        assertEquals(0, count); gate.close()
        assertThrows(CancellationException::class.java) { gate.text(UpdateUrls.CATALOG) }; assertEquals(0, count)
    }
    @Test fun explicitRequestDownloadsAndClosesExactlyOnceWithoutRetries() {
        var count = 0; lateinit var connection: Connection
        ManualNetwork { count++; Connection(it, "Текст".toByteArray()).also { connection = it } }.use { assertEquals("Текст", it.text(UpdateUrls.CATALOG)) }
        assertEquals(1, count); assertTrue(connection.disconnected)
    }
    @Test fun rejectsForeignHostsPlainHttpOversizedFilesAndInvalidUtf8() {
        var count = 0
        ManualNetwork { count++; Connection(it, byteArrayOf(-61, 40)) }.use { gate ->
            for (url in listOf("http://pesn.wef2000.ru/catalog.json", "https://foreign.example/catalog.json")) assertThrows(IllegalArgumentException::class.java) { gate.text(url) }
            assertEquals(0, count)
            assertThrows(IllegalArgumentException::class.java) { gate.text(UpdateUrls.CATALOG, 1) }
            assertThrows(Exception::class.java) { gate.text(UpdateUrls.CATALOG) }
        }
    }
    @Test fun redirectsCannotLeakRequestsToAnUnapprovedHost() {
        var count = 0
        ManualNetwork { count++; Connection(it, byteArrayOf(), 302, "https://foreign.example/file.apk") }.use { gate -> assertThrows(IllegalArgumentException::class.java) { gate.text(UpdateUrls.CATALOG) } }
        assertEquals(1, count)
    }
    @Test fun updateMetadataRequiresAnIntegerVersionTrustedApkUrlAndHash() {
        val json = """{"versionCode":2,"versionName":"1.1.0","apkUrl":"https://github.com/champigon/pesn/releases/download/android-v1.1.0/pesennik.apk","sha256":"${"a".repeat(64)}"}"""
        assertEquals(2L, AppUpdate.parse(json).versionCode)
        for (invalid in listOf(json.replace("\"versionCode\":2", "\"versionCode\":2.5"), json.replace("github.com/champigon/pesn", "foreign.example/other"), json.replace("a".repeat(64), "invalid"))) assertThrows(Exception::class.java) { AppUpdate.parse(invalid) }
    }
}
