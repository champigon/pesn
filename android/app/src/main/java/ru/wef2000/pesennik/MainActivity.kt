package ru.wef2000.pesennik

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.util.AtomicFile
import android.view.Choreographer
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.*
import java.io.File
import java.text.Collator
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import kotlin.math.abs
import kotlin.math.roundToInt

class MainActivity : Activity(), Choreographer.FrameCallback {
    private val green = Color.rgb(20, 102, 91)
    private val ink = Color.rgb(23, 45, 41)
    private val muted = Color.rgb(97, 115, 110)
    private val paper = Color.rgb(247, 249, 248)
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val playback = Playback()
    private val preferences by lazy { getSharedPreferences("reader", MODE_PRIVATE) }
    private lateinit var repository: CatalogRepository
    private lateinit var snapshot: Snapshot
    private var selected: Song? = null
    private var font = 28
    private var foreground = false
    private var scheduled = false
    private var autoChanging = false
    private var network: ManualNetwork? = null
    private var job: Future<*>? = null
    private var operationId = 0L
    private var busy = false
    private var pendingInstall: AppUpdate? = null
    private var permissionRequested = false
    private lateinit var search: EditText
    private lateinit var count: TextView
    private lateinit var list: ListView
    private lateinit var info: TextView
    private lateinit var status: TextView
    private lateinit var update: Button
    private lateinit var songScroll: SongScroll
    private lateinit var lyrics: TextView
    private lateinit var play: Button
    private lateinit var speedLabel: TextView
    private lateinit var fontLabel: TextView
    private lateinit var stateLabel: TextView
    private lateinit var progress: TextView
    private lateinit var slower: Button
    private lateinit var faster: Button
    private lateinit var smaller: Button
    private lateinit var larger: Button
    private var filtered = emptyList<Song>()
    private val adapter = object : BaseAdapter() {
        override fun getCount() = filtered.size
        override fun getItem(position: Int) = filtered[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val song = filtered[position]
            return row().apply {
                setPadding(0, dp(13), 0, dp(13))
                addView(label("♪", 28f, green).apply { gravity = Gravity.CENTER; background = rounded(Color.rgb(231, 239, 235), 12) }, LinearLayout.LayoutParams(dp(42), dp(46)))
                addView(column().apply {
                    setPadding(dp(13), 0, dp(6), 0)
                    addView(label(song.title, 19f).apply { setTypeface(typeface, Typeface.BOLD) })
                    addView(label(song.text.lineSequence().firstOrNull { it.isNotBlank() } ?: "Текст песни", 12f, muted).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(0, dp(5), 0, 0) })
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(label("›", 28f, green))
                contentDescription = song.title
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.setOnApplyWindowInsetsListener { view, insets ->
            @Suppress("DEPRECATION")
            view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets.consumeSystemWindowInsets()
        }
        val disk = AtomicFile(File(filesDir, "catalog-snapshot.json"))
        repository = CatalogRepository(object : SnapshotDisk {
            override fun read(): String? = try { disk.openRead().bufferedReader(Charsets.UTF_8).use { it.readText() } } catch (_: java.io.FileNotFoundException) { null }
            override fun writeAtomically(value: String) {
                val stream = disk.startWrite()
                try { stream.write(value.toByteArray(Charsets.UTF_8)); disk.finishWrite(stream) } catch (error: Exception) { disk.failWrite(stream); throw error }
            }
        }) { assets.open("catalog.json").bufferedReader(Charsets.UTF_8).use { it.readText() } }
        snapshot = repository.load()
        font = preferences.getInt("font", 28).coerceIn(22, 44)
        pendingInstall = savedInstanceState?.getString("pendingInstall")?.let { runCatching { AppUpdate.parse(it) }.getOrNull() }
        permissionRequested = savedInstanceState?.getBoolean("permissionRequested") ?: false
        showLibrary(savedInstanceState?.getString("query") ?: "")
        val song = snapshot.catalog.songs.find { it.id == savedInstanceState?.getString("song") }
        if (song != null) showSong(song, savedInstanceState?.getInt("scroll") ?: 0, false)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()
    private fun rounded(color: Int, radius: Int = 10) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }
    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private fun label(value: String, size: Float = 16f, color: Int = ink) = TextView(this).apply { text = value; textSize = size; setTextColor(color); setLineSpacing(0f, 1.15f) }
    private fun button(value: String, tagName: String, action: () -> Unit) = Button(this).apply {
        text = value; tag = tagName; textSize = 14f; isAllCaps = false; minHeight = dp(46); minimumWidth = dp(42)
        setTextColor(green); background = rounded(Color.WHITE, 9); setPadding(dp(10), dp(8), dp(10), dp(8)); setOnClickListener { action() }
    }
    private fun installRoot(view: View) { view.setBackgroundColor(paper); setContentView(view); window.decorView.requestApplyInsets() }

    private fun showLibrary(query: String = "") {
        selected = null; playback.pause(); window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = column().apply { tag = "library"; setPadding(dp(20), dp(12), dp(20), dp(12)) }
        root.addView(row().apply {
            addView(label("♫", 29f, Color.WHITE).apply { gravity = Gravity.CENTER; background = rounded(green, 13) }, LinearLayout.LayoutParams(dp(48), dp(48)))
            addView(column().apply { setPadding(dp(13), 0, 0, 0); addView(label("Песенник", 23f).apply { setTypeface(typeface, Typeface.BOLD) }); addView(label("ПОЁМ ВМЕСТЕ", 10f, muted)) })
        })
        root.addView(label("СБОРНИК", 11f, green).apply { setPadding(0, dp(18), 0, dp(6)) })
        count = label("", 21f).apply { setTypeface(typeface, Typeface.BOLD) }; root.addView(count)
        search = EditText(this).apply {
            tag = "search"; hint = "Найти песню"; contentDescription = "Найти песню"; textSize = 17f; setSingleLine(); setTextColor(ink); setHintTextColor(muted)
            background = rounded(Color.WHITE); setPadding(dp(14), 0, dp(14), 0)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        }
        root.addView(search, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10); bottomMargin = dp(6) })
        val frame = FrameLayout(this)
        list = ListView(this).apply { tag = "songs"; adapter = this@MainActivity.adapter; divider = android.graphics.drawable.ColorDrawable(Color.rgb(220, 229, 225)); dividerHeight = dp(1); setOnItemClickListener { _, _, position, _ -> showSong(filtered[position]) } }
        frame.addView(list, FrameLayout.LayoutParams(-1, -1))
        val empty = label("Ничего не найдено", 16f, muted).apply { gravity = Gravity.CENTER }
        frame.addView(empty, FrameLayout.LayoutParams(-1, -1)); list.emptyView = empty
        root.addView(frame, LinearLayout.LayoutParams(-1, 0, 1f))
        val card = column().apply { background = rounded(Color.rgb(234, 241, 237), 14); setPadding(dp(15), dp(13), dp(15), dp(13)) }
        card.addView(label("Сборник с вами", 17f).apply { setTypeface(typeface, Typeface.BOLD) })
        info = label("", 11f, muted); card.addView(info)
        card.addView(label("Работает без интернета", 12f, green).apply { tag = "offline"; setPadding(0, dp(3), 0, 0) })
        update = button("Обновить сборник", "update") { refresh() }
        card.addView(update, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) })
        root.addView(card, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        status = label("Интернет используется только по кнопке", 12f, muted).apply { tag = "status"; setPadding(0, dp(7), 0, 0); gravity = Gravity.CENTER }
        root.addView(status)
        installRoot(root)
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { filterSongs() }
            override fun afterTextChanged(s: Editable?) {}
        })
        search.setText(query); filterSongs(); updateLibraryInfo()
    }
    private fun filterSongs() {
        val collator = Collator.getInstance(Locale("ru"))
        val query = search.text.toString().trim().lowercase(Locale("ru"))
        filtered = snapshot.catalog.songs.filter { it.title.lowercase(Locale("ru")).contains(query) }.sortedWith { a, b -> collator.compare(a.title, b.title) }
        count.text = "Наши песни  ${snapshot.catalog.songs.size}"
        adapter.notifyDataSetChanged()
    }
    private fun updateLibraryInfo() {
        val date = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, Locale("ru")).format(Date(CatalogFormat.timestamp(snapshot.downloadedAt)))
        info.text = "Версия ${snapshot.catalog.version}\nПолучен $date · APK ${BuildConfig.VERSION_NAME}"
        update.isEnabled = !busy; list.isEnabled = !busy
        update.text = if (busy) "Загружаем…" else "Обновить сборник"
    }

    private fun showSong(song: Song, y: Int = 0, autoStart: Boolean = true) {
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(search.windowToken, 0)
        selected = song; playback.speed = preferences.getInt("speed:${song.id}", 15).coerceIn(2, 40); playback.open(y, autoStart)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = column().apply { tag = "reader" }
        val header = row().apply { setPadding(dp(14), dp(8), dp(14), dp(8)) }
        header.addView(button("К списку", "back") { showLibrary() })
        header.addView(label("♫ Песенник", 14f, green).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, -2, 1f))
        progress = label("0%", 12f, muted); header.addView(progress)
        root.addView(header)
        songScroll = SongScroll(this).apply {
            tag = "lyrics-scroll"
            onFinger = { down -> playback.touch(down); scheduleFrame() }
            onTap = { playback.toggle(scrollY); renderControls(); scheduleFrame() }
            onMovement = { if (!autoChanging) playback.manualScroll(); renderProgress() }
            isFillViewport = true
        }
        val article = column().apply { setPadding(dp(22), dp(26), dp(22), dp(90)) }
        article.addView(label("ПОЁМ ВМЕСТЕ", 11f, green))
        article.addView(label(song.title, 34f).apply { tag = "song-title"; typeface = Typeface.SERIF; setPadding(0, dp(16), 0, dp(14)) })
        article.addView(label("Касание — пауза или продолжение", 12f, muted).apply { setPadding(0, 0, 0, dp(24)) })
        lyrics = label(song.text, font.toFloat()).apply { tag = "lyrics"; setLineSpacing(0f, 1.55f) }; article.addView(lyrics)
        article.addView(label("Песня заканчивается.\nПусть остаётся настроение.", 17f, green).apply { typeface = Typeface.create("serif", Typeface.ITALIC); setPadding(0, dp(32), 0, 0) })
        songScroll.addView(article); root.addView(songScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val bottom = column().apply { setPadding(dp(12), dp(10), dp(12), dp(10)) }
        val controls = row()
        play = button("Пауза", "play") { playback.toggle(songScroll.scrollY); renderControls(); scheduleFrame() }.apply { setTextColor(Color.WHITE); background = rounded(green) }
        controls.addView(play, LinearLayout.LayoutParams(0, dp(48), 1.2f).apply { rightMargin = dp(8) })
        val speedGroup = column()
        speedLabel = label("", 10f, muted).apply { tag = "speed" }; speedGroup.addView(speedLabel)
        val speedButtons = row()
        slower = button("−", "slower") { changeSpeed(-2) }.apply { contentDescription = "Медленнее" }
        faster = button("+", "faster") { changeSpeed(2) }.apply { contentDescription = "Быстрее" }
        speedButtons.addView(slower, LinearLayout.LayoutParams(0, dp(44), 1f)); speedButtons.addView(faster, LinearLayout.LayoutParams(0, dp(44), 1f).apply { leftMargin = dp(5) })
        speedGroup.addView(speedButtons); controls.addView(speedGroup, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
        val fontGroup = column(); fontLabel = label("", 10f, muted); fontGroup.addView(fontLabel)
        val fontButtons = row()
        smaller = button("А−", "smaller") { changeFont(-2) }.apply { contentDescription = "Уменьшить текст" }
        larger = button("А+", "larger") { changeFont(2) }.apply { contentDescription = "Увеличить текст" }
        fontButtons.addView(smaller, LinearLayout.LayoutParams(0, dp(44), 1f)); fontButtons.addView(larger, LinearLayout.LayoutParams(0, dp(44), 1f).apply { leftMargin = dp(5) })
        fontGroup.addView(fontButtons); controls.addView(fontGroup, LinearLayout.LayoutParams(0, -2, 1f))
        bottom.addView(controls)
        stateLabel = label("", 11f, muted).apply { tag = "play-state"; gravity = Gravity.CENTER; setPadding(0, dp(8), 0, 0) }; bottom.addView(stateLabel)
        root.addView(bottom); installRoot(root)
        songScroll.post { autoChanging = true; songScroll.scrollTo(0, y); autoChanging = false; renderProgress(); scheduleFrame() }
        renderControls()
    }
    private fun changeSpeed(delta: Int) {
        playback.speed = (playback.speed + delta).coerceIn(2, 40)
        preferences.edit().putInt("speed:${selected!!.id}", playback.speed).apply(); renderControls()
    }
    private fun changeFont(delta: Int) {
        val y = songScroll.scrollY; font = (font + delta).coerceIn(22, 44)
        preferences.edit().putInt("font", font).apply(); lyrics.textSize = font.toFloat(); renderControls()
        songScroll.post { autoChanging = true; songScroll.scrollTo(0, y); autoChanging = false; playback.manualScroll(); renderProgress() }
    }
    private fun renderControls() {
        if (selected == null) return
        play.text = if (playback.running) "Пауза" else "Продолжить"
        speedLabel.text = "Скорость ${playback.speed} ед/с"; fontLabel.text = "Текст $font"
        slower.isEnabled = playback.speed > 2; faster.isEnabled = playback.speed < 40; smaller.isEnabled = font > 22; larger.isEnabled = font < 44
        val text = when { playback.starting -> "Прокрутка начнётся через 2 секунды"; playback.running -> "Касание текста — пауза"; else -> "На паузе · коснитесь текста" }
        if (stateLabel.text != text) stateLabel.text = text
    }
    private fun renderProgress() {
        if (selected == null || !::songScroll.isInitialized) return
        val max = ((songScroll.getChildAt(0)?.height ?: 0) - songScroll.height).coerceAtLeast(0)
        progress.text = "${if (max > 0) (100.0 * songScroll.scrollY / max).roundToInt() else 100}%"
    }
    private fun scheduleFrame() { if (foreground && selected != null && playback.running && !scheduled) { scheduled = true; Choreographer.getInstance().postFrameCallback(this) } }
    override fun doFrame(frameTimeNanos: Long) {
        scheduled = false
        if (!foreground || selected == null) return
        val max = ((songScroll.getChildAt(0)?.height ?: 0) - songScroll.height).coerceAtLeast(0)
        val y = playback.advance(frameTimeNanos, resources.displayMetrics.density, songScroll.scrollY, max)
        autoChanging = true; songScroll.scrollTo(0, y); autoChanging = false
        renderControls(); renderProgress(); scheduleFrame()
    }

    private fun refresh() {
        if (!foreground || busy || selected != null) return
        perform("Обновляем сборник…", { gate ->
            var next: Snapshot? = null; var songError: String? = null; var appError: String? = null; var app: AppUpdate? = null
            try { next = repository.replace(gate.text(UpdateUrls.CATALOG + "?t=" + System.currentTimeMillis())) } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { songError = friendly(error) }
            try { app = AppUpdate.parse(gate.text(UpdateUrls.APPLICATION + "?t=" + System.currentTimeMillis(), 64 * 1024)) } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { appError = friendly(error) }
            RefreshResult(next, songError, app, appError)
        }) { result ->
            val previous = snapshot.catalog.version
            result.snapshot?.let { snapshot = it; filterSongs(); updateLibraryInfo() }
            val songsMessage = when { result.songError != null -> "Сборник не обновлён: ${result.songError}. Сохранённые песни доступны."; previous == snapshot.catalog.version -> "Сборник уже актуален."; else -> "Сборник обновлён." }
            status.text = songsMessage + when { result.appError != null -> " Проверка APK: ${result.appError}."; result.update != null && result.update.versionCode > BuildConfig.VERSION_CODE -> " Доступна новая версия приложения."; else -> " Приложение актуально." }
            result.update?.takeIf { it.versionCode > BuildConfig.VERSION_CODE }?.let { askApkDownload(it) }
        }
    }
    private data class RefreshResult(val snapshot: Snapshot?, val songError: String?, val update: AppUpdate?, val appError: String?)
    private fun friendly(error: Exception) = when (error) {
        is java.net.UnknownHostException, is java.net.ConnectException, is java.net.SocketTimeoutException, is javax.net.ssl.SSLException -> "Нет связи с сервером. Попробуйте позже"
        is org.json.JSONException -> "Получены повреждённые данные"
        else -> error.message ?: "Не удалось выполнить обновление"
    }
    private fun <T> perform(message: String, work: (ManualNetwork) -> T, done: (T) -> Unit) {
        if (!foreground || busy) return
        val id = ++operationId; val gate = ManualNetwork(); network = gate; busy = true; status.text = message; updateLibraryInfo()
        job = executor.submit {
            try {
                val result = work(gate)
                handler.post { if (foreground && operationId == id) { busy = false; network = null; updateLibraryInfo(); done(result) } }
            } catch (_: CancellationException) {
                // onStop already clears UI state. Never retry or resume in the background.
            } catch (error: Exception) {
                handler.post { if (foreground && operationId == id) { busy = false; network = null; updateLibraryInfo(); status.text = friendly(error) + ". Сохранённые песни доступны." } }
            } finally { gate.close() }
        }
    }
    private fun askApkDownload(app: AppUpdate) {
        if (!foreground) return
        AlertDialog.Builder(this).setTitle("Песенник ${app.versionName}").setMessage("Скачать новую версию приложения? Песни и настройки сохранятся. Установку потребуется подтвердить в Android.")
            .setNegativeButton("Позже", null).setPositiveButton("Скачать") { _, _ -> downloadApk(app) }.show()
    }
    private fun downloadApk(app: AppUpdate) {
        perform("Скачиваем APK…", { gate ->
            val temporary = File(cacheDir, "pesennik-download.part")
            try {
                temporary.outputStream().use { gate.download(app.apkUrl, it, 64 * 1024 * 1024) }
                ApkVerification.verify(this, temporary, app)
                val destination = ApkProvider.apk(this)
                require(temporary.renameTo(destination)) { "Не удалось сохранить APK" }
                destination
            } finally { temporary.delete() }
        }) { pendingInstall = app; requestInstallation() }
    }
    @Suppress("DEPRECATION")
    private fun requestInstallation() {
        val app = pendingInstall ?: return
        try {
            ApkVerification.verify(this, ApkProvider.apk(this), app)
            if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
                AlertDialog.Builder(this).setTitle("Разрешение на установку").setMessage("Android попросит разрешить Песеннику устанавливать скачанный APK. После разрешения подтвердите установку новой версии.")
                    .setNegativeButton("Отмена") { _, _ -> pendingInstall = null }.setPositiveButton("Открыть настройки") { _, _ ->
                        permissionRequested = true
                        startActivityForResult(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")), 42)
                    }.show()
                return
            }
            val intent = Intent(Intent.ACTION_VIEW).setDataAndType(ApkProvider.uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            intent.clipData = ClipData.newRawUri("APK Песенника", ApkProvider.uri)
            startActivity(intent); pendingInstall = null
        } catch (error: Exception) { status.text = "Установка не началась: ${friendly(error)}"; pendingInstall = null }
    }
    @Deprecated("Android activity result compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 42 && permissionRequested) {
            permissionRequested = false
            if (Build.VERSION.SDK_INT < 26 || packageManager.canRequestPackageInstalls()) requestInstallation() else { pendingInstall = null; status.text = "Установка отменена. Песни сохранены." }
        }
    }
    override fun onStart() { super.onStart(); foreground = true; if (selected != null) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); scheduleFrame() }
    override fun onStop() {
        foreground = false; operationId++; network?.close(); network = null; job?.cancel(true); job = null
        if (busy) { busy = false; if (::status.isInitialized) { updateLibraryInfo(); status.text = "Загрузка отменена. Для повторной попытки нажмите «Обновить сборник»." } }
        playback.pause(); if (selected != null) renderControls()
        Choreographer.getInstance().removeFrameCallback(this); scheduled = false
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onStop()
    }
    override fun onDestroy() { executor.shutdownNow(); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("query", search.text.toString()); outState.putString("song", selected?.id)
        if (selected != null) outState.putInt("scroll", songScroll.scrollY)
        pendingInstall?.let { outState.putString("pendingInstall", it.json()) }; outState.putBoolean("permissionRequested", permissionRequested)
    }
    @Deprecated("Android back compatibility")
    override fun onBackPressed() { if (selected != null) showLibrary() else super.onBackPressed() }
}

class SongScroll(context: android.content.Context) : ScrollView(context) {
    var onFinger: (Boolean) -> Unit = {}
    var onTap: () -> Unit = {}
    var onMovement: () -> Unit = {}
    private var downX = 0f; private var downY = 0f; private var downTime = 0L; private var moved = false
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { downX = event.x; downY = event.y; downTime = event.eventTime; moved = false; onFinger(true) }
            MotionEvent.ACTION_MOVE -> if (abs(event.x - downX) > 8 * resources.displayMetrics.density || abs(event.y - downY) > 8 * resources.displayMetrics.density) moved = true
            MotionEvent.ACTION_UP -> { onFinger(false); if (!moved && event.eventTime - downTime < 500) performClick() }
            MotionEvent.ACTION_CANCEL -> onFinger(false)
        }
        return super.onTouchEvent(event)
    }
    override fun performClick(): Boolean { super.performClick(); onTap(); return true }
    override fun onScrollChanged(l: Int, t: Int, oldl: Int, oldt: Int) { super.onScrollChanged(l, t, oldl, oldt); onMovement() }
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_SPACE) { performClick(); return true }
        if (keyCode in listOf(KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_PAGE_UP, KeyEvent.KEYCODE_PAGE_DOWN)) { onFinger(false) }
        return super.onKeyDown(keyCode, event)
    }
}
