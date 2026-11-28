package ru.wef2000.pesennik

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class ApkUpdateTest {
    @Test fun acceptsOnlyTheNewerApkWithTheInstalledSignatureAndCorrectHash() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val path = requireNotNull(InstrumentationRegistry.getArguments().getString("apkPath"))
        val apk = File(path); assertTrue(apk.exists())
        val update = AppUpdate(2, "1.0.0", "https://github.com/champigon/pesn/releases/download/android-v1.0.0/pesennik.apk", ApkVerification.sha256(apk))
        ApkVerification.verify(context, apk, update)
        assertThrows(IllegalArgumentException::class.java) { ApkVerification.verify(context, apk, update.copy(sha256 = "0".repeat(64))) }
        assertThrows(IllegalArgumentException::class.java) { ApkVerification.verify(context, apk, update.copy(versionCode = 1)) }
    }
}
