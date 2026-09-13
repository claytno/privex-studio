#include <windows.h>
#include <objbase.h>
#include <tlhelp32.h>
#include <obs.h>
#include <util/base.h>
#include <QCoreApplication>
#include <QDir>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTimer>
#include <QUrl>
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <deque>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>
#include <cmath>

// No network listener, scripts, arbitrary DLL loading, passwords, or media through JS.
namespace {
std::mutex inputMutex;
std::deque<QByteArray> inputs;
std::atomic<bool> inputClosed = false;
void send(const QJsonObject &obj) { const auto bytes = QJsonDocument(obj).toJson(QJsonDocument::Compact); std::cout.write(bytes.data(), bytes.size()); std::cout << '\n' << std::flush; }
bool diagnosticSelfTest = false;
void quietLog(int level, const char *format, va_list args, void *) {
 // Diagnostics are available only in synthetic self-test, which cannot publish or capture.
 if (diagnosticSelfTest && level <= LOG_WARNING) { std::vfprintf(stderr, format, args); std::fputc('\n', stderr); }
} // OBS may log the publish URL: never emit normal runtime logs.
void require(bool pass, const char *message) { if (!pass) throw std::runtime_error(message); }
QString stringArg(const QJsonObject &o, const char *key, int max = 4096) { auto v = o.value(key); require(v.isString() && v.toString().size() <= max, "Invalid string parameter"); return v.toString(); }
QJsonArray list(const char *source, const char *property) {
 QJsonArray result; auto *props = obs_get_source_properties(source); if (!props) return result;
 auto *p = obs_properties_get(props, property);
 if (p && obs_property_get_type(p) == OBS_PROPERTY_LIST) for (size_t i = 0; i < obs_property_list_item_count(p); ++i) {
  if (obs_property_list_item_disabled(p, i)) continue;
  QJsonValue id = obs_property_list_format(p) == OBS_COMBO_FORMAT_INT ? QJsonValue(double(obs_property_list_item_int(p, i))) : QJsonValue(QString::fromUtf8(obs_property_list_item_string(p, i)));
  result.append(QJsonObject{{"id", id}, {"name", QString::fromUtf8(obs_property_list_item_name(p, i))}});
 }
 obs_properties_destroy(props); return result;
}
bool hasId(const QJsonArray &items, const QString &id) { for (const auto &v : items) if (v.toObject().value("id").toVariant().toString() == id) return true; return false; }
struct PublishState { const char *name; bool streaming; };
PublishState publishState(bool connected, bool reconnecting, bool starting, bool prepared) {
 // libobs emits reconnect without stop, so the earlier start signal can remain latched.
 if (reconnecting) return {"reconnecting", false};
 if (connected) return {"streaming", true};
 return {starting ? "connecting" : prepared ? "ready" : "idle", false};
}
DWORD parentProcessId() {
 HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0); if (snapshot == INVALID_HANDLE_VALUE) return 0;
 PROCESSENTRY32 entry{}; entry.dwSize = sizeof(entry); DWORD parent = 0;
 if (Process32First(snapshot, &entry)) do { if (entry.th32ProcessID == GetCurrentProcessId()) { parent = entry.th32ParentProcessID; break; } } while (Process32Next(snapshot, &entry));
 CloseHandle(snapshot); return parent;
}

struct Engine {
 bool initialized = false, prepared = false, starting = false, paused = false, desiredMuted = false;
 int width = 1280, height = 720, fps = 30;
 obs_scene_t *scene = nullptr;
 obs_source_t *visual = nullptr, *mic = nullptr;
 obs_sceneitem_t *visualItem = nullptr;
 std::vector<std::pair<obs_source_t *, obs_sceneitem_t *>> pauseSources, overlaySources;
 QJsonObject overlayConfig;
 obs_output_t *output = nullptr;
 obs_service_t *service = nullptr;
 obs_encoder_t *videoEncoder = nullptr, *audioEncoder = nullptr;
 obs_display_t *display = nullptr;
 HWND preview = nullptr;
 bool previewPositioned = false;
 std::atomic<bool> connected = false;
 std::atomic<int> stopCode = 999;
 std::atomic<unsigned> previewWidth = 640, previewHeight = 360;

 static void started(void *ctx, calldata_t *) { static_cast<Engine *>(ctx)->connected = true; }
 static void stopped(void *ctx, calldata_t *data) { auto *e = static_cast<Engine *>(ctx); e->connected = false; e->stopCode = int(calldata_int(data, "code")); }
 bool active() const { return starting || (output && obs_output_active(output)); }
 void init() {
  if (initialized) return;
  base_set_log_handler(quietLog, nullptr);
  require(obs_startup("pt-BR", nullptr, nullptr), "Media initialization failed"); initialized = true;
  const auto root = QCoreApplication::applicationDirPath();
  const auto data = (root + "/data/libobs/").toUtf8(); obs_add_data_path(data.constData());
  obs_audio_info ai{}; ai.samples_per_sec = 48000; ai.speakers = SPEAKERS_STEREO;
  require(obs_reset_audio(&ai), "Audio initialization failed"); resetVideo();
  const char *modules[] = {"win-dshow", "win-wasapi", "win-capture", "obs-x264", "obs-ffmpeg", "obs-outputs", "rtmp-services", "image-source", "obs-text"};
  for (auto name : modules) {
   const auto path = (root + "/obs-plugins/64bit/" + name + ".dll").toUtf8(); const auto moduleData = (root + "/data/obs-plugins/" + name).toUtf8();
   obs_module_t *m = nullptr; if (obs_open_module(&m, path.constData(), moduleData.constData()) == MODULE_SUCCESS) obs_init_module(m);
  }
  obs_post_load_modules();
 }
 void resetVideo() {
  obs_video_info vi{}; vi.graphics_module = "libobs-d3d11.dll"; vi.fps_num = fps; vi.fps_den = 1;
  vi.base_width = vi.output_width = width; vi.base_height = vi.output_height = height;
  vi.output_format = VIDEO_FORMAT_NV12; vi.colorspace = VIDEO_CS_709; vi.range = VIDEO_RANGE_PARTIAL; vi.gpu_conversion = true; vi.scale_type = OBS_SCALE_BICUBIC;
  require(obs_reset_video(&vi) == OBS_VIDEO_SUCCESS, "Video initialization failed; update your graphics driver");
 }
 void releaseOutput() {
  if (output) { obs_output_force_stop(output); obs_output_release(output); output = nullptr; }
  if (service) { obs_service_release(service); service = nullptr; }
  if (videoEncoder) { obs_encoder_release(videoEncoder); videoEncoder = nullptr; }
  if (audioEncoder) { obs_encoder_release(audioEncoder); audioEncoder = nullptr; }
  starting = false; connected = false;
 }
 void clearSources() {
  if (display) { obs_display_remove_draw_callback(display, draw, this); obs_display_destroy(display); display = nullptr; }
  if (preview) { DestroyWindow(preview); preview = nullptr; } previewPositioned = false;
  if (initialized) { obs_set_output_source(0, nullptr); obs_set_output_source(1, nullptr); }
  clearLayer(overlaySources); clearLayer(pauseSources); overlayConfig = {}; visualItem = nullptr; paused = false;
  if (scene) { obs_scene_release(scene); scene = nullptr; }
  if (visual) { obs_source_release(visual); visual = nullptr; }
  if (mic) { obs_source_release(mic); mic = nullptr; }
  prepared = false;
 }
 void cleanup() { releaseOutput(); clearSources(); if (initialized) { obs_shutdown(); initialized = false; } }
 ~Engine() { cleanup(); }
 static void draw(void *ctx, uint32_t cx, uint32_t cy) {
  auto *e = static_cast<Engine *>(ctx); if (!e->scene || !cx || !cy) return;
  const float scale = std::min(float(cx) / e->width, float(cy) / e->height);
  const int w = int(e->width * scale), h = int(e->height * scale);
  gs_viewport_push(); gs_projection_push();
  gs_set_viewport((int(cx) - w) / 2, (int(cy) - h) / 2, w, h); gs_ortho(0, float(e->width), 0, float(e->height), -100, 100);
  obs_source_video_render(obs_scene_get_source(e->scene)); gs_projection_pop(); gs_viewport_pop();
 }
 void resize(const QJsonObject &bounds) {
  int x = bounds.value("x").toInt(), y = bounds.value("y").toInt(), w = bounds.value("width").toInt(640), h = bounds.value("height").toInt(360);
  require(x >= 0 && y >= 0 && x <= 32768 && y <= 32768 && w > 0 && h > 0 && w <= 8192 && h <= 8192, "Invalid preview bounds");
  if (preview) {
   RECT client{}; require(GetClientRect(GetParent(preview), &client), "Preview parent is unavailable");
   if (x + w > client.right || y + h > client.bottom) { ShowWindow(preview, SW_HIDE); previewPositioned = false; throw std::runtime_error("Preview bounds must fit the Studio window"); }
   require(SetWindowPos(preview, HWND_TOP, x, y, w, h, SWP_NOACTIVATE), "Could not position preview"); previewPositioned = true;
  }
  if (display) obs_display_resize(display, w, h);
 }
 void attachPreview(const QJsonObject &args) {
  if (!args.contains("parentHwnd")) return;
  const auto hwndString = stringArg(args, "parentHwnd", 32); bool ok = false;
  auto value = hwndString.toULongLong(&ok, hwndString.startsWith("0x") ? 16 : 10); HWND parent = reinterpret_cast<HWND>(uintptr_t(value));
  require(ok && IsWindow(parent), "Invalid preview parent");
  DWORD owner = 0; GetWindowThreadProcessId(parent, &owner); require(owner != 0 && owner == parentProcessId(), "Preview must belong to the Studio process");
  // Remain hidden until the renderer supplies the actual preview rectangle.
  preview = CreateWindowExW(0, L"STATIC", L"Privex preview", WS_CHILD | WS_CLIPSIBLINGS, 0, 0, 640, 360, parent, nullptr, GetModuleHandle(nullptr), nullptr);
  require(preview != nullptr, "Preview window creation failed");
  gs_init_data gd{}; gd.cx = 640; gd.cy = 360; gd.format = GS_BGRA; gd.zsformat = GS_ZS_NONE; gd.window.hwnd = preview;
  display = obs_display_create(&gd, 0x121212); require(display, "Preview graphics creation failed");
  obs_display_add_draw_callback(display, draw, this);
  if (args.contains("bounds")) resize(args.value("bounds").toObject());
 }
 void fitVisual() {
  auto *item = obs_scene_add(scene, visual); visualItem = item; require(item, "Could not compose video");
  vec2 bounds{float(width), float(height)}; obs_sceneitem_set_bounds_type(item, OBS_BOUNDS_SCALE_INNER); obs_sceneitem_set_bounds_alignment(item, OBS_ALIGN_CENTER);
  obs_sceneitem_set_bounds_crop(item, false); obs_sceneitem_set_bounds(item, &bounds); obs_sceneitem_set_alignment(item, OBS_ALIGN_TOP | OBS_ALIGN_LEFT);
 }
 void clearLayer(std::vector<std::pair<obs_source_t *, obs_sceneitem_t *>> &sources) {
  for (auto [source, item] : sources) { if (item) obs_sceneitem_remove(item); if (source) obs_source_release(source); } sources.clear();
 }
 void addLayerSource(std::vector<std::pair<obs_source_t *, obs_sceneitem_t *>> &sources, obs_source_t *source, float x, float y) {
  require(source, "Native overlay source unavailable"); auto *item = obs_scene_add(scene, source);
  if (!item) { obs_source_release(source); throw std::runtime_error("Native overlay composition failed"); }
  obs_sceneitem_set_alignment(item, OBS_ALIGN_TOP | OBS_ALIGN_LEFT); vec2 pos{x,y}; obs_sceneitem_set_pos(item, &pos); sources.push_back({source,item});
 }
 obs_source_t *colorSource(const char *name, int w, int h, uint32_t color) {
  auto *settings = obs_data_create(); obs_data_set_int(settings,"width",std::max(w,1)); obs_data_set_int(settings,"height",std::max(h,1)); obs_data_set_int(settings,"color",color);
  auto *source = obs_source_create_private("color_source_v3",name,settings); obs_data_release(settings); return source;
 }
 obs_source_t *textSource(const char *name, const QString &text, int size, int w, int h) {
  auto *settings = obs_data_create(); auto *font = obs_data_create(); obs_data_set_string(font,"face","Segoe UI"); obs_data_set_int(font,"size",size); obs_data_set_int(font,"flags",1);
  obs_data_set_obj(settings,"font",font); obs_data_release(font); obs_data_set_string(settings,"text",text.toUtf8().constData());
  obs_data_set_bool(settings,"read_from_file",false); obs_data_set_int(settings,"color",0xffffff); obs_data_set_int(settings,"opacity",100);
  obs_data_set_bool(settings,"extents",true); obs_data_set_bool(settings,"extents_wrap",true); obs_data_set_int(settings,"extents_cx",w); obs_data_set_int(settings,"extents_cy",h);
  auto *source = obs_source_create_private("text_gdiplus_v3",name,settings); obs_data_release(settings); return source;
 }
 void setScene(const QString &mode) {
  require(prepared && scene && visualItem,"Prepare video before selecting a scene"); require(mode == "pause" || mode == "live","Invalid scene mode");
  if (mode == "pause" && pauseSources.empty()) {
   addLayerSource(pauseSources,colorSource("Privex interval background",width,height,0xff181018),0,0);
   addLayerSource(pauseSources,textSource("Privex interval title",QString::fromUtf8("Voltamos em instantes"),width < height ? 38 : 48,width-96,180),48,float(height/2-70));
  }
  paused = mode == "pause"; obs_sceneitem_set_visible(visualItem,!paused);
  for (auto [source,item] : pauseSources) obs_sceneitem_set_visible(item,paused);
  if (mic) obs_source_set_muted(mic,paused || desiredMuted);
  // Keep the verified public goal above the interval slate as well.
  for (auto [source,item] : overlaySources) obs_sceneitem_set_order(item,OBS_ORDER_MOVE_TOP);
 }
 void overlay(const QJsonObject &args) {
  require(args.value("visible").isBool(),"Invalid overlay visibility");
  if (!args.value("visible").toBool()) { clearLayer(overlaySources); overlayConfig = {}; return; }
  require(prepared && scene,"Prepare video before showing an overlay");
  auto title = stringArg(args,"title",100).simplified(); require(!title.isEmpty(),"Goal title required");
  double raised = args.value("raisedCents").toDouble(-1), target = args.value("targetCents").toDouble(-1);
  require(std::isfinite(raised) && std::isfinite(target) && raised >= 0 && target > 0 && raised <= 1e12 && target <= 1e12 && std::floor(raised)==raised && std::floor(target)==target,"Invalid goal amounts");
  QJsonObject next{{"visible",true},{"title",title},{"raisedCents",raised},{"targetCents",target}}; if (next == overlayConfig) return;
  clearLayer(overlaySources);
  try {
   const float scale = float(std::min(width,height)) / 720.0f;
   int margin = int(20*scale), boxWidth = int((width<height?500:440)*scale), boxHeight = int(76*scale), y = height-margin-boxHeight;
   int inset = int(10*scale), barHeight = int(6*scale), barY = y+boxHeight-int(14*scale);
   addLayerSource(overlaySources,colorSource("Privex goal background",boxWidth,boxHeight,0xe6171717),float(margin),float(y));
   auto amount = [](double cents) { return QString::number(cents / 100.0,'f',2).replace('.',','); };
   auto shortTitle = title.size()>44?title.left(43)+QString::fromUtf8("…"):title;
   auto label = shortTitle + "\nR$ " + amount(raised) + " de R$ " + amount(target);
   addLayerSource(overlaySources,textSource("Privex goal text",label,int(16*scale),boxWidth-inset*2,int(50*scale)),float(margin+inset),float(y+int(7*scale)));
   addLayerSource(overlaySources,colorSource("Privex goal track",boxWidth-inset*2,barHeight,0xff4b444b),float(margin+inset),float(barY));
   if (raised > 0) addLayerSource(overlaySources,colorSource("Privex goal progress",int((boxWidth-inset*2)*std::min(1.0,raised/target)),barHeight,0xffc22ced),float(margin+inset),float(barY));
   overlayConfig = next;
  } catch (...) { clearLayer(overlaySources); overlayConfig={}; throw; }
 }
 QJsonObject enumerate() { init(); return {{"cameras", list("dshow_input", "video_device_id")}, {"microphones", list("wasapi_input_capture", "device_id")}, {"displays", list("monitor_capture", "monitor_id")}, {"windows", list("window_capture", "window")}}; }
 QJsonObject prepare(const QJsonObject &args) {
  require(!active(), "End the stream before changing capture"); init(); clearSources();
  width = args.value("width").toInt(1280); height = args.value("height").toInt(720); fps = args.value("fps").toInt(30);
  require((width == 1280 && height == 720) || (width == 720 && height == 1280) || (width == 1920 && height == 1080) || (width == 1080 && height == 1920), "Unsupported canvas size");
  require(fps == 30, "Pilot supports 30 fps"); resetVideo();
  const auto kind = stringArg(args, "sourceType", 16); const char *type = nullptr, *prop = nullptr;
  QString selected;
  if (kind == "camera") { type = "dshow_input"; prop = "video_device_id"; selected = stringArg(args, "cameraId"); }
  else if (kind == "display") { type = "monitor_capture"; prop = "monitor_id"; selected = stringArg(args, "sourceId"); }
  else if (kind == "window") { type = "window_capture"; prop = "window"; selected = stringArg(args, "sourceId"); }
  else throw std::runtime_error("Unsupported source type");
  require(!selected.isEmpty() && hasId(list(type, prop), selected), "Selected video device is unavailable");
  obs_data_t *settings = obs_data_create(); obs_data_set_string(settings, prop, selected.toUtf8().constData());
  if (kind == "window") { obs_data_set_int(settings, "priority", 1); obs_data_set_bool(settings, "capture_audio", false); } // Exact selected title; never whole-screen fallback.
  visual = obs_source_create_private(type, "Privex video", settings); obs_data_release(settings); require(visual, "Video capture creation failed");
  obs_source_set_audio_mixers(visual, 0); obs_source_set_muted(visual, true); // Camera embedded audio must not bypass the selected/muted microphone.
  scene = obs_scene_create_private("Privex canvas"); require(scene, "Canvas creation failed"); fitVisual(); obs_set_output_source(0, obs_scene_get_source(scene));
  auto microphoneId = args.value("microphoneId").toString();
  if (!microphoneId.isEmpty()) {
   require(microphoneId != "default" && hasId(list("wasapi_input_capture", "device_id"), microphoneId), "Select a specific available microphone");
   settings = obs_data_create(); obs_data_set_string(settings, "device_id", microphoneId.toUtf8().constData());
   mic = obs_source_create_private("wasapi_input_capture", "Privex microphone", settings); obs_data_release(settings); require(mic, "Microphone creation failed");
   desiredMuted = args.value("muted").toBool(false); obs_source_set_muted(mic, desiredMuted); obs_set_output_source(1, mic);
  }
  attachPreview(args); prepared = true; return status();
 }
 QJsonObject start(QJsonObject args) {
  require(prepared && visual && obs_source_get_width(visual) > 0 && obs_source_get_height(visual) > 0, "Wait for a working video source before starting"); require(!active(), "Stream is already starting or active"); releaseOutput();
  QString server = stringArg(args, "server", 2048), key = stringArg(args, "streamKey", 4096); QUrl url(server);
  require(url.isValid() && url.scheme() == "rtmps" && !url.host().isEmpty() && url.userInfo().isEmpty() && url.fragment().isEmpty() && !key.isEmpty(), "A valid secure publish endpoint is required");
  obs_data_t *settings = obs_data_create(); obs_data_set_string(settings, "server", server.toUtf8().constData()); obs_data_set_string(settings, "key", key.toUtf8().constData()); obs_data_set_bool(settings, "use_auth", false);
  service = obs_service_create_private("rtmp_custom", "Privex secure publish", settings); obs_data_release(settings);
  key.fill(QChar(0)); args.remove("streamKey"); require(service, "Publish service unavailable");
  settings = obs_data_create(); obs_data_set_int(settings, "bitrate", width * height > 1280 * 720 ? 4500 : 2500); obs_data_set_string(settings, "rate_control", "CBR"); obs_data_set_string(settings, "preset", "veryfast"); obs_data_set_string(settings, "profile", "high"); obs_data_set_int(settings, "keyint_sec", 2);
  videoEncoder = obs_video_encoder_create("obs_x264", "Privex H264", settings, nullptr); obs_data_release(settings); require(videoEncoder, "H264 encoder unavailable");
  settings = obs_data_create(); obs_data_set_int(settings, "bitrate", 128); audioEncoder = obs_audio_encoder_create("ffmpeg_aac", "Privex AAC", settings, 0, nullptr); obs_data_release(settings); require(audioEncoder, "AAC encoder unavailable");
  obs_encoder_set_video(videoEncoder, obs_get_video()); obs_encoder_set_audio(audioEncoder, obs_get_audio());
  output = obs_output_create("rtmp_output", "Privex transmission", nullptr, nullptr); require(output, "Streaming output unavailable");
  obs_output_set_video_encoder(output, videoEncoder); obs_output_set_audio_encoder(output, audioEncoder, 0); obs_output_set_service(output, service); obs_output_set_reconnect_settings(output, 5, 3);
  auto *outputSignals = obs_output_get_signal_handler(output); signal_handler_connect(outputSignals, "start", started, this); signal_handler_connect(outputSignals, "stop", stopped, this);
  stopCode = 999; starting = true;
  if (!obs_output_start(output)) { releaseOutput(); throw std::runtime_error("Could not start transmission"); }
  return status();
 }
 QJsonObject status() {
  if (stopCode != 999) starting = false;
  const auto publish = publishState(connected.load(), output && obs_output_reconnecting(output), starting, prepared);
  return {{"prepared", prepared}, {"state", QString::fromLatin1(publish.name)}, {"streaming", publish.streaming}, {"width", width}, {"height", height}, {"fps", fps}, {"muted", !mic || obs_source_muted(mic)}, {"sceneMode",paused?"pause":"live"}, {"overlayVisible",!overlaySources.empty()}, {"sourceWidth", visual ? int(obs_source_get_width(visual)) : 0}, {"sourceHeight", visual ? int(obs_source_get_height(visual)) : 0}, {"totalBytes", output ? double(obs_output_get_total_bytes(output)) : 0}, {"droppedFrames", output ? obs_output_get_frames_dropped(output) : 0}, {"stopCode", stopCode == 999 ? QJsonValue() : QJsonValue(stopCode.load())}};
 }
};

std::atomic<int> testFrames = 0, testFitFrames = 0, testStage = 0, testPauseFrames = 0, testOverlayFrames = 0;
void testFrame(void *, video_data *frame) {
 testFrames++;
 // Portrait canvas, full landscape source: center white, top/bottom letterbox black.
 auto pixel = [&](int x, int y) { return frame->data[0] + y * frame->linesize[0] + x * 4; };
 auto *top = pixel(360, 30), *center = pixel(360, 640), *left = pixel(4, 640), *right = pixel(715, 640), *bottom = pixel(360, 1240);
 if (testStage == 0 && top[0] < 20 && bottom[0] < 20 && center[0] > 230 && left[0] > 230 && right[0] > 230) testFitFrames++;
 if (testStage == 1 && left[0] < 40 && right[0] < 40) testPauseFrames++;
 auto *fill = pixel(60,1249), *track = pixel(490,1249), *outside = pixel(600,1249);
 if (testStage == 2 && fill[2] > 150 && fill[1] < 100 && fill[0] > 130 && track[2] < 100 && track[0] < 100 && outside[0] < 20 && outside[1] < 20 && outside[2] < 20) testOverlayFrames++;
}
int selfTest(Engine &e) {
 const auto beforeDisconnect = publishState(true, false, true, true);
 require(QString::fromLatin1(beforeDisconnect.name) == "streaming" && beforeDisconnect.streaming, "Connected output must be streaming");
 const auto duringReconnect = publishState(true, true, true, true);
 require(QString::fromLatin1(duringReconnect.name) == "reconnecting" && !duringReconnect.streaming, "Reconnect must override a stale start signal");
 const auto afterReconnect = publishState(true, false, true, true);
 require(QString::fromLatin1(afterReconnect.name) == "streaming" && afterReconnect.streaming, "Recovered output must become streaming again");
 const auto initialConnection = publishState(false, false, true, true);
 require(QString::fromLatin1(initialConnection.name) == "connecting" && !initialConnection.streaming, "Pending connection must not be streaming");
 const auto failedConnection = publishState(false, false, false, true);
 require(QString::fromLatin1(failedConnection.name) == "ready" && !failedConnection.streaming, "Failed connection must return to ready without streaming");
 e.init(); e.width = 720; e.height = 1280; e.resetVideo();
 auto *settings = obs_data_create(); obs_data_set_int(settings, "width", 1280); obs_data_set_int(settings, "height", 720); obs_data_set_int(settings, "color", 0xffffffff);
 e.visual = obs_source_create_private("color_source_v3", "Synthetic fit test", settings); obs_data_release(settings); require(e.visual, "Synthetic source unavailable");
 e.scene = obs_scene_create_private("Synthetic canvas"); e.fitVisual(); obs_set_output_source(0, obs_scene_get_source(e.scene));
 video_scale_info conversion{}; conversion.format = VIDEO_FORMAT_BGRA; conversion.width = 720; conversion.height = 1280; conversion.colorspace = VIDEO_CS_709; conversion.range = VIDEO_RANGE_FULL;
 obs_add_raw_video_callback(&conversion, testFrame, nullptr); Sleep(1500);
 require(testFrames > 5 && testFitFrames > 5, "Full-image portrait composition pixel check failed");
 e.prepared = true; e.mic = e.colorSource("Synthetic mute flag",1,1,0); e.desiredMuted=false; obs_source_set_muted(e.mic,false);
 e.setScene("pause"); require(obs_source_muted(e.mic),"Pause must mute microphone"); testStage=1; Sleep(500);
 require(testPauseFrames>5,"Pause canvas did not hide video"); e.setScene("live"); require(!obs_source_muted(e.mic),"Resume must restore earlier mute state");
 e.desiredMuted=true; obs_source_set_muted(e.mic,true); e.setScene("pause"); e.setScene("live"); require(obs_source_muted(e.mic),"Resume must preserve earlier muted state");
 e.overlay({{"visible",true},{"title","Meta de teste"},{"raisedCents",2500},{"targetCents",5000}}); testStage=2; Sleep(500);
 require(testOverlayFrames>5,"Goal progress bar pixel check failed");
 auto *goalText = e.overlaySources.at(1).first; require(obs_source_get_width(goalText)>0 && obs_source_get_height(goalText)>0,"Goal text texture unavailable");
 e.overlay({{"visible",false}}); require(e.overlaySources.empty(),"Hidden goal must remove public overlay");
 obs_remove_raw_video_callback(testFrame, nullptr);
 e.videoEncoder = obs_video_encoder_create("obs_x264", "Synthetic encoder", nullptr, nullptr); e.audioEncoder = obs_audio_encoder_create("ffmpeg_aac", "Synthetic audio encoder", nullptr, 0, nullptr);
 require(e.videoEncoder && e.audioEncoder, "Bundled H264/AAC encoders unavailable");
 send({{"ok", true}, {"test", "real-libobs-composition"}, {"frames", testFrames.load()}, {"validFitFrames", testFitFrames.load()}, {"validPauseFrames",testPauseFrames.load()}, {"validOverlayFrames",testOverlayFrames.load()}, {"pauseRestoresMute",true}, {"reconnectionStateChecks",5}, {"h264AndAacAvailable", true}, {"networkUsed", false}, {"physicalCaptureUsed", false}}); return 0;
}
}
int main(int argc, char **argv) {
 SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
 SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_APPLICATION_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32 | LOAD_LIBRARY_SEARCH_USER_DIRS);
 CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
 QCoreApplication app(argc, argv); QDir::setCurrent(QCoreApplication::applicationDirPath()); Engine engine;
 if (app.arguments().contains("--self-test")) { diagnosticSelfTest = true; try { return selfTest(engine); } catch (const std::exception &e) { send({{"ok", false}, {"error", e.what()}}); return 1; } }
 std::thread([] {
  QByteArray line; bool overflow = false;
  for (int ch; (ch = std::getchar()) != EOF;) {
   if (ch == '\n') { std::lock_guard lock(inputMutex); if (inputs.size() >= 64) { inputClosed = true; return; } inputs.push_back(overflow ? QByteArray("{}") : line); line.fill(0); line.clear(); overflow = false; }
   else if (line.size() < 16384) line.append(char(ch)); else overflow = true;
  }
  inputClosed = true;
 }).detach();
 QTimer poll; QObject::connect(&poll, &QTimer::timeout, [&] {
  std::deque<QByteArray> pending; { std::lock_guard lock(inputMutex); pending.swap(inputs); }
  for (auto &line : pending) {
   QJsonParseError parse; auto doc = QJsonDocument::fromJson(line, &parse); line.fill(0); auto args = doc.object(); QJsonValue id = args.value("id");
   try {
    require(parse.error == QJsonParseError::NoError && doc.isObject() && (id.isString() || id.isDouble()), "Invalid request");
    auto command = stringArg(args, "command", 32); QJsonObject result;
    if (command == "enumerate") result = engine.enumerate();
    else if (command == "prepare") { try { result = engine.prepare(args); } catch (...) { if (!engine.active()) engine.clearSources(); throw; } }
    else if (command == "start") { try { result = engine.start(args); } catch (...) { if (!engine.active()) engine.releaseOutput(); throw; } }
    else if (command == "stop") { engine.releaseOutput(); engine.clearSources(); result = engine.status(); }
    else if (command == "status") result = engine.status();
    else if (command == "resize") { engine.resize(args.value("bounds").toObject()); result = engine.status(); }
    else if (command == "preview") { require(args.value("visible").isBool(), "Invalid preview visibility"); if (engine.preview) { const bool visible=args.value("visible").toBool(); require(!visible || engine.previewPositioned,"Position the preview before showing it"); ShowWindow(engine.preview,visible ? SW_SHOWNOACTIVATE : SW_HIDE); } result = engine.status(); }
    else if (command == "mute") { require(args.value("muted").isBool(), "Invalid mute state"); engine.desiredMuted=args.value("muted").toBool(); if (engine.mic) obs_source_set_muted(engine.mic, engine.paused || engine.desiredMuted); result = engine.status(); }
    else if (command == "scene") { engine.setScene(stringArg(args,"mode",16)); result = engine.status(); }
    else if (command == "overlay") { engine.overlay(args); result = engine.status(); }
    else if (command == "shutdown") { engine.cleanup(); send({{"id", id}, {"ok", true}, {"result", QJsonObject{{"state", "closed"}}}}); app.quit(); return; }
    else throw std::runtime_error("Unknown command");
    send({{"id", id}, {"ok", true}, {"result", result}});
   } catch (const std::exception &e) { send({{"id", id}, {"ok", false}, {"error", QString::fromUtf8(e.what())}}); }
  }
  if (inputClosed) { engine.cleanup(); app.quit(); }
 }); poll.start(25);
 QTimer stateTimer; QObject::connect(&stateTimer, &QTimer::timeout, [&] { auto state = engine.status(); state.insert("event", "status"); send(state); }); stateTimer.start(1000);
 send({{"event", "ready"}, {"protocol", 1}}); return app.exec();
}
