package ru.wef2000.pesennik

import org.junit.Assert.*
import org.junit.Test

class PlaybackTest {
    @Test fun startsAfterTwoSecondsAtFifteenDpPerSecond() {
        val p = Playback(); p.open(now = 1L)
        assertEquals(0, p.advance(1_900_000_000L, 1f, 0, 1000)); assertTrue(p.starting)
        p.advance(2_000_000_001L, 1f, 0, 1000)
        var y = 0; for (i in 1..60) y = p.advance(2_000_000_001L + i * 16_666_667L, 1f, y, 1000)
        assertEquals(15, y); assertFalse(p.starting)
    }
    @Test fun screenDensityKeepsTheSameVisualSpeed() {
        val p = Playback(); p.open(now = 1L); p.advance(2_000_000_001L, 2f, 0, 1000)
        var y = 0; for (i in 1..60) y = p.advance(2_000_000_001L + i * 16_666_667L, 2f, y, 1000)
        assertEquals(30, y)
    }
    @Test fun tapDuringCountdownPausesAndNextTapResumes() {
        val p = Playback(); p.open(now = 1L); p.toggle(0); assertFalse(p.running); assertFalse(p.starting)
        p.toggle(0); assertTrue(p.running)
    }
    @Test fun manualGestureAndInertiaYieldThenResumeWithoutChangingPlaybackChoice() {
        val p = Playback(); p.open(now = 1L); p.advance(2_000_000_001L, 1f, 0, 1000)
        p.touch(true, 3_000_000_000L); assertEquals(200, p.advance(3_100_000_000L, 1f, 200, 1000))
        p.touch(false, 3_200_000_000L); p.manualScroll(3_400_000_000L)
        assertEquals(300, p.advance(3_600_000_000L, 1f, 300, 1000))
        p.advance(3_700_000_000L, 1f, 300, 1000)
        assertEquals(301, p.advance(3_800_000_000L, 1f, 300, 1000)); assertTrue(p.running)
        p.pause(); p.touch(true); p.touch(false); assertFalse(p.running)
    }
    @Test fun endStopsAndBackgroundPauseNeverRestartsAutomatically() {
        val p = Playback(); p.open(10, now = 1L); p.advance(2_000_000_001L, 1f, 10, 10); assertFalse(p.running)
        p.toggle(0); p.pause(); p.advance(20_000_000_000L, 1f, 0, 1000); assertFalse(p.running)
    }
}
