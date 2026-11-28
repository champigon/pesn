package ru.wef2000.pesennik

import org.json.JSONObject
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class Song(val id: String, val title: String, val text: String)
data class Catalog(val version: String, val updatedAt: String, val songs: List<Song>, val json: String)
data class Snapshot(val catalog: Catalog, val downloadedAt: String)

object CatalogFormat {
    private fun string(value: JSONObject, key: String): String {
        val item = value.get(key); require(item is String) { "Некорректное поле $key" }; return item
    }
    fun now(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
    fun timestamp(value: String): Long {
        require(Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?Z").matches(value)) { "Некорректная дата сборника" }
        val normalized = value.replace(Regex("\\.\\d+Z$"), "Z")
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { isLenient = false; timeZone = TimeZone.getTimeZone("UTC") }
        val position = ParsePosition(0)
        val parsed = format.parse(normalized, position)
        require(parsed != null && position.index == normalized.length) { "Некорректная дата сборника" }
        return parsed.time
    }
    fun parse(raw: String): Catalog {
        val root = JSONObject(raw)
        val versionValue = root.get("version")
        require((versionValue is String && Regex("[a-f0-9]{12}").matches(versionValue)) ||
            ((versionValue is Int || versionValue is Long) && (versionValue as Number).toLong() >= 1)) { "Некорректная версия сборника" }
        val updatedAt = string(root, "updatedAt"); timestamp(updatedAt)
        val array = root.getJSONArray("songs")
        require(array.length() <= 2000) { "В сборнике слишком много песен" }
        val ids = mutableSetOf<String>()
        val songs = (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            val id = string(item, "id"); val title = string(item, "title"); val text = string(item, "text")
            require(Regex("[a-zA-Z0-9_-]{1,80}").matches(id) && ids.add(id)) { "Некорректный или повторяющийся идентификатор песни" }
            require(title.isNotBlank() && title.length <= 200 && text.isNotBlank() && text.length <= 100000) { "Получен неполный текст песни" }
            Song(id, title, text)
        }
        return Catalog(versionValue.toString(), updatedAt, songs, root.toString())
    }
    fun encode(snapshot: Snapshot): String = JSONObject().put("catalog", JSONObject(snapshot.catalog.json)).put("downloadedAt", snapshot.downloadedAt).toString()
    fun decode(raw: String): Snapshot {
        val value = JSONObject(raw)
        val date = string(value, "downloadedAt"); timestamp(date)
        return Snapshot(parse(value.getJSONObject("catalog").toString()), date)
    }
}

interface SnapshotDisk { fun read(): String?; fun writeAtomically(value: String) }
class CatalogRepository(private val disk: SnapshotDisk, private val bundled: () -> String) {
    fun load(): Snapshot = try { disk.read()?.let(CatalogFormat::decode) ?: bundledSnapshot() } catch (_: Exception) { bundledSnapshot() }
    private fun bundledSnapshot(): Snapshot = CatalogFormat.parse(bundled()).let { Snapshot(it, it.updatedAt) }
    fun replace(raw: String): Snapshot {
        val next = Snapshot(CatalogFormat.parse(raw), CatalogFormat.now())
        disk.writeAtomically(CatalogFormat.encode(next))
        return next
    }
}
