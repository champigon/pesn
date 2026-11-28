package ru.wef2000.pesennik

import kotlin.math.min

class Playback {
    var speed = 15
    var running = false; private set
    var starting = false; private set
    private var startAt = 0L
    private var previous = 0L
    private var position = 0.0
    private var touching = false
    private var manualUntil = 0L
    fun open(y: Int = 0, autoStart: Boolean = true, now: Long = System.nanoTime()) {
        position = y.toDouble(); previous = 0; touching = false; manualUntil = 0
        running = autoStart; starting = autoStart; startAt = now + 2_000_000_000L
    }
    fun pause() { running = false; starting = false; previous = 0 }
    fun toggle(y: Int) {
        if (starting) pause() else { running = !running; previous = 0 }
        position = y.toDouble()
    }
    fun touch(down: Boolean, now: Long = System.nanoTime()) { touching = down; manualUntil = now + 260_000_000L; previous = 0 }
    fun manualScroll(now: Long = System.nanoTime()) { manualUntil = now + 260_000_000L; previous = 0 }
    fun advance(now: Long, density: Float, y: Int, max: Int): Int {
        if (!running || touching || now < manualUntil) { position = y.toDouble(); previous = 0; return y }
        if (starting) { if (now < startAt) return y; starting = false; previous = 0; position = y.toDouble() }
        val elapsed = if (previous == 0L) 0.0 else min((now - previous) / 1e9, 0.1)
        previous = now
        position = min(max.toDouble(), position + speed * density * elapsed)
        if (position >= max) pause()
        return position.toInt().coerceIn(0, max.coerceAtLeast(0))
    }
}
