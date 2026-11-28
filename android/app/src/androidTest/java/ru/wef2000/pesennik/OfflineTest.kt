package ru.wef2000.pesennik

import android.content.Intent
import android.graphics.Bitmap
import android.net.TrafficStats
import android.os.Process
import android.os.SystemClock
import android.content.pm.ActivityInfo
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.ListView
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.lifecycle.Lifecycle
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class OfflineTest {
    private fun screenshot(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "screenshots").apply { mkdirs() }
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap -> File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle() }
    }
    private fun <T : View> tagged(activity: MainActivity, tag: String): T = activity.window.decorView.findViewWithTag(tag)
    private fun tap(view: View) {
        val now = SystemClock.uptimeMillis()
        for ((action, time) in listOf(MotionEvent.ACTION_DOWN to now, MotionEvent.ACTION_UP to now + 40)) {
            val event = MotionEvent.obtain(now, time, action, 50f, 100f, 0); view.dispatchTouchEvent(event); event.recycle()
        }
    }

    @Test fun installedReaderStaysOfflineThroughReadingSearchAndLifecycle() {
        val before = ManualNetwork.openedConnections.get()
        ActivityScenario.launch<MainActivity>(Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java)).use { scenario ->
            val uid = Process.myUid()
            val tx = TrafficStats.getUidTxBytes(uid); val rx = TrafficStats.getUidRxBytes(uid)
            scenario.onActivity { activity ->
                val songs = tagged<ListView>(activity, "songs"); assertTrue(songs.adapter.count > 0)
                tagged<EditText>(activity, "search").setText("Вечер")
                assertTrue(songs.adapter.count > 0); screenshot("library")
                songs.performItemClick(songs.adapter.getView(0, null, songs), 0, 0)
                assertTrue(activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0)
                assertTrue(tagged<TextView>(activity, "speed").text.contains("15"))
                tap(tagged<SongScroll>(activity, "lyrics-scroll"))
                assertEquals("Продолжить", tagged<Button>(activity, "play").text.toString())
                tap(tagged<SongScroll>(activity, "lyrics-scroll"))
                assertEquals("Пауза", tagged<Button>(activity, "play").text.toString())
            }
            Thread.sleep(2800)
            scenario.onActivity { activity ->
                tagged<Button>(activity, "play").performClick()
                assertEquals("Продолжить", tagged<Button>(activity, "play").text.toString())
                assertTrue(activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0)
                tagged<Button>(activity, "faster").performClick(); assertTrue(tagged<TextView>(activity, "speed").text.contains("17"))
                screenshot("reader")
                repeat(8) { tagged<Button>(activity, "larger").performClick() }
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            }
            Thread.sleep(1000)
            scenario.recreate()
            scenario.onActivity { activity -> assertTrue(tagged<TextView>(activity, "speed").text.contains("17")); assertEquals("Продолжить", tagged<Button>(activity, "play").text.toString()) }
            scenario.moveToState(Lifecycle.State.CREATED); scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.onActivity { activity ->
                assertEquals("Продолжить", tagged<Button>(activity, "play").text.toString())
                tagged<Button>(activity, "back").performClick()
                assertTrue(activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON == 0)
            }
            Thread.sleep(1000)
            assertEquals(before, ManualNetwork.openedConnections.get())
            if (tx >= 0 && rx >= 0) { assertEquals(tx, TrafficStats.getUidTxBytes(uid)); assertEquals(rx, TrafficStats.getUidRxBytes(uid)) }
        }
    }

    @Test fun onlyButtonMayConnectAndBackgroundNeverResumesRequests() {
        val before = ManualNetwork.openedConnections.get()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity -> tagged<Button>(activity, "update").performClick() }
            val deadline = System.currentTimeMillis() + 10000
            while (ManualNetwork.openedConnections.get() == before && System.currentTimeMillis() < deadline) Thread.sleep(50)
            assertTrue(ManualNetwork.openedConnections.get() > before)
            scenario.moveToState(Lifecycle.State.CREATED)
            Thread.sleep(300)
            val stopped = ManualNetwork.openedConnections.get()
            scenario.moveToState(Lifecycle.State.RESUMED); scenario.recreate(); Thread.sleep(1500)
            assertEquals(stopped, ManualNetwork.openedConnections.get())
            scenario.onActivity { activity -> assertTrue(tagged<ListView>(activity, "songs").adapter.count > 0) }
        }
    }
}
