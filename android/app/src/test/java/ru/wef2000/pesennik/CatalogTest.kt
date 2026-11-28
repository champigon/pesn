package ru.wef2000.pesennik

import org.junit.Assert.*
import org.junit.Test

class CatalogTest {
    private val original = """{"version":"012345abcdef","updatedAt":"2026-11-28T12:00:00.123Z","songs":[{"id":"one","title":"Первая","text":"Куплет\n\nПрипев"}]}"""
    private class Disk(var value: String? = null, var fails: Boolean = false) : SnapshotDisk {
        override fun read() = value
        override fun writeAtomically(value: String) { if (fails) error("No space"); this.value = value }
    }
    @Test fun firstLaunchReadsBundledSongsWithoutWritingOrNetwork() {
        val disk = Disk(); val repository = CatalogRepository(disk) { original }
        assertEquals("Первая", repository.load().catalog.songs[0].title); assertNull(disk.value)
    }
    @Test fun updateAtomicallyReplacesAdditionsChangesAndDeletions() {
        val disk = Disk(); val repository = CatalogRepository(disk) { original }
        repository.replace(original)
        val next = original.replace("012345abcdef", "abcdef012345").replace("\"one\"", "\"two\"").replace("Первая", "Другая")
        repository.replace(next)
        assertEquals(listOf("two"), repository.load().catalog.songs.map { it.id }); assertEquals("Другая", repository.load().catalog.songs[0].title)
    }
    @Test fun invalidAndPartialDownloadsNeverReplaceThePreviousSnapshot() {
        val disk = Disk(); val repository = CatalogRepository(disk) { original }; repository.replace(original); val saved = disk.value
        for (raw in listOf("{", original.replace("Припев", "").replace("Куплет\\n\\n", ""), original.replace("012345abcdef", "invalid"))) {
            assertThrows(Exception::class.java) { repository.replace(raw) }; assertEquals(saved, disk.value)
        }
    }
    @Test fun diskFailureKeepsThePreviousSnapshot() {
        val disk = Disk(); val repository = CatalogRepository(disk) { original }; repository.replace(original); val saved = disk.value; disk.fails = true
        assertThrows(Exception::class.java) { repository.replace(original.replace("Первая", "Изменённая")) }; assertEquals(saved, disk.value)
    }
    @Test fun duplicateIdentifiersAndImpossibleDatesAreRejected() {
        assertThrows(Exception::class.java) { CatalogFormat.parse(original.replace("2026-11-28", "2026-02-31")) }
        val item = """{"id":"one","title":"Повтор","text":"Куплет"}"""
        assertThrows(Exception::class.java) { CatalogFormat.parse(original.replace("]}", ",$item]}")) }
    }
    @Test fun savedSnapshotPreservesLineBreaks() {
        val snapshot = Snapshot(CatalogFormat.parse(original), CatalogFormat.now())
        assertEquals("Куплет\n\nПрипев", CatalogFormat.decode(CatalogFormat.encode(snapshot)).catalog.songs[0].text)
    }
    @Test fun corruptLocalSnapshotFallsBackToTheBundledCatalog() {
        assertEquals("Первая", CatalogRepository(Disk("{")) { original }.load().catalog.songs[0].title)
    }
}
