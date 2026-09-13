#include <windows.h>
#include <objbase.h>
#include <tlhelp32.h>
#include <obs.h>
#include <obs-audio-controls.h>
#include <util/base.h>
#include <util/platform.h>
#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
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
bool captureKind(const QString &kind) { return kind == "camera" || kind == "window" || kind == "display" || kind == "game"; }
const char *captureType(const QString &kind) { return kind == "camera" ? "dshow_input" : kind == "window" ? "window_capture" : kind == "game" ? "game_capture" : "monitor_capture"; }
const char *captureProperty(const QString &kind) { return kind == "camera" ? "video_device_id" : kind == "window" || kind == "game" ? "window" : "monitor_id"; }
const char *anyFullscreen = "any_fullscreen";

// The audio callback retains numbers only; raw audio never crosses the native process.
struct AudioMeter {
 obs_volmeter_t *handle=nullptr;
 std::mutex mutex;
 float inputDb=-60,outputDb=-60;
 ULONGLONG attachedAt=0,lastData=0,windowAt=0,inputClipUntil=0,outputClipUntil=0;
 static float boundedDb(float db){return std::isfinite(db)?std::clamp(db,-60.0f,0.0f):db>0?0.0f:-60.0f;}
 static void levels(void *context,const float *,const float peak[MAX_AUDIO_CHANNELS],const float inputPeak[MAX_AUDIO_CHANNELS]){
  auto *meter=static_cast<AudioMeter *>(context);const auto now=GetTickCount64();
  float input=-60,output=-60;bool inputClip=false,outputClip=false;
  for(size_t i=0;i<MAX_AUDIO_CHANNELS;i++){
   input=std::max(input,boundedDb(inputPeak[i]));output=std::max(output,boundedDb(peak[i]));
   inputClip=inputClip||(std::isfinite(inputPeak[i])&&inputPeak[i]>=0);outputClip=outputClip||(std::isfinite(peak[i])&&peak[i]>=0);
  }
  std::lock_guard lock(meter->mutex);
  if(now-meter->windowAt>=200){meter->inputDb=input;meter->outputDb=output;meter->windowAt=now;}
  else{meter->inputDb=std::max(meter->inputDb,input);meter->outputDb=std::max(meter->outputDb,output);}
  meter->lastData=now;if(inputClip)meter->inputClipUntil=now+1500;if(outputClip)meter->outputClipUntil=now+1500;
 }
 void detach(){
  // Removing the callback waits on libobs' callback mutex before releasing our state.
  if(handle){obs_volmeter_remove_callback(handle,levels,this);obs_volmeter_detach_source(handle);obs_volmeter_destroy(handle);handle=nullptr;}
  std::lock_guard lock(mutex);inputDb=outputDb=-60;attachedAt=lastData=windowAt=inputClipUntil=outputClipUntil=0;
 }
 void attach(obs_source_t *source){
  detach();if(!source)return;
  handle=obs_volmeter_create(OBS_FADER_LOG);if(!handle)return;
  obs_volmeter_set_peak_meter_type(handle,SAMPLE_PEAK_METER);
  {std::lock_guard lock(mutex);attachedAt=GetTickCount64();}
  obs_volmeter_add_callback(handle,levels,this);
  if(!obs_volmeter_attach_source(handle,source))detach();
 }
 QJsonObject read(obs_source_t *source){
  const auto now=GetTickCount64();std::lock_guard lock(mutex);
  const bool configured=source!=nullptr,receiving=configured&&lastData&&now-lastData<1000;
  // libobs meters retain the input indication while muted. Public output must not.
  const bool muted=configured&&(obs_source_muted(source)||obs_source_get_volume(source)<=0);
  const char *state=!configured?"unconfigured":!handle?"unavailable":receiving?"receiving":now-attachedAt<2000?"waiting":"unavailable";
  return {{"configured",configured},{"receiving",receiving},{"muted",muted},{"state",state},
   {"inputDb",receiving?inputDb:-60},{"outputDb",receiving&&!muted?outputDb:-60},
   {"inputClipping",receiving&&inputClipUntil>now},{"outputClipping",receiving&&!muted&&outputClipUntil>now}};
 }
 ~AudioMeter(){detach();}
};

// One composed video layer. Index 0 of the requested list is the front-most layer, like a studio source list.
struct Layer { QJsonObject spec; QString key; obs_source_t *source = nullptr; obs_sceneitem_t *item = nullptr; bool visible = true, capture = false, created = false, claimed = false; };
struct Box { int x, y, w, h; uint32_t align; };

struct Engine {
 bool initialized = false, prepared = false, starting = false, paused = false, desiredMuted = false;
 int width = 1280, height = 720, fps = 30;
 obs_scene_t *scene = nullptr;
 obs_source_t *mic = nullptr, *desktop = nullptr;
 std::vector<Layer> layers;
 QJsonObject captureConfig;
 float micVolume = 1.0f, desktopVolume = 1.0f;
 AudioMeter micMeter,desktopMeter;
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
  micMeter.detach();desktopMeter.detach();
  if (display) { obs_display_remove_draw_callback(display, draw, this); obs_display_destroy(display); display = nullptr; }
  if (preview) { DestroyWindow(preview); preview = nullptr; } previewPositioned = false;
  if (initialized) { obs_set_output_source(0, nullptr); obs_set_output_source(1, nullptr); obs_set_output_source(2, nullptr); }
  clearLayer(overlaySources); clearLayer(pauseSources); overlayConfig = {}; paused = false;
  for (auto &layer : layers) { if (layer.item) obs_sceneitem_remove(layer.item); if (layer.source) obs_source_release(layer.source); } layers.clear();
  if (scene) { obs_scene_release(scene); scene = nullptr; }
  if (mic) { obs_source_release(mic); mic = nullptr; }
  if (desktop) { obs_source_release(desktop); desktop = nullptr; }
  captureConfig = {};
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
 obs_source_t *textSource(const char *name, const QString &text, int size, int w, int h, const char *align = "left", const char *valign = "top", bool outline = false) {
  auto *settings = obs_data_create(); auto *font = obs_data_create(); obs_data_set_string(font,"face","Segoe UI"); obs_data_set_int(font,"size",size); obs_data_set_int(font,"flags",1);
  obs_data_set_obj(settings,"font",font); obs_data_release(font); obs_data_set_string(settings,"text",text.toUtf8().constData());
  obs_data_set_bool(settings,"read_from_file",false); obs_data_set_int(settings,"color",0xffffff); obs_data_set_int(settings,"opacity",100);
  obs_data_set_string(settings,"align",align); obs_data_set_string(settings,"valign",valign);
  if (outline) { obs_data_set_bool(settings,"outline",true); obs_data_set_int(settings,"outline_size",std::max(2,size/12)); obs_data_set_int(settings,"outline_color",0x000000); obs_data_set_int(settings,"outline_opacity",100); }
  obs_data_set_bool(settings,"extents",true); obs_data_set_bool(settings,"extents_wrap",true); obs_data_set_int(settings,"extents_cx",w); obs_data_set_int(settings,"extents_cy",h);
  auto *source = obs_source_create_private("text_gdiplus_v3",name,settings); obs_data_release(settings); return source;
 }
 // Layer geometry: full canvas (fit/fill) or a 16:9 box in one corner sized as a fraction of the canvas width.
 Box layerBox(const QJsonObject &n) const {
  if (n.value("fit").toString() != "corner") return {0, 0, width, height, OBS_ALIGN_CENTER};
  const double size = n.value("size").toDouble(0.3); const auto corner = n.value("corner").toString();
  const int w = std::max(16, int(std::lround(width * size))), h = std::max(9, int(std::lround(w * 9.0 / 16.0))), margin = int(std::lround(std::min(width, height) * 0.03));
  const bool top = corner.startsWith('t'), left = corner.endsWith('l');
  return {left ? margin : width - margin - w, top ? margin : height - margin - h, w, h, uint32_t((top ? OBS_ALIGN_TOP : OBS_ALIGN_BOTTOM) | (left ? OBS_ALIGN_LEFT : OBS_ALIGN_RIGHT))};
 }
 QJsonObject normalizeLayer(const QJsonObject &spec) {
  const auto kind = stringArg(spec, "kind", 16);
  require(captureKind(kind) || kind == "image" || kind == "text" || (diagnosticSelfTest && kind == "synthetic"), "Unsupported source type");
  const auto fit = spec.contains("fit") ? stringArg(spec, "fit", 8) : QString("fit"); require(fit == "fit" || fit == "fill" || fit == "corner", "Invalid layer placement");
  const auto corner = spec.contains("corner") ? stringArg(spec, "corner", 2) : QString("br"); require(corner == "tl" || corner == "tr" || corner == "bl" || corner == "br", "Invalid layer corner");
  const double size = spec.value("size").toDouble(0.3); require(std::isfinite(size) && size >= 0.1 && size <= 0.7, "Invalid layer size");
  require(!spec.contains("visible") || spec.value("visible").isBool(), "Invalid layer visibility");
  QJsonObject n{{"kind", kind}, {"fit", fit}, {"corner", corner}, {"size", size}, {"visible", spec.value("visible").toBool(true)}};
  if (captureKind(kind)) { const auto id = stringArg(spec, "id"); require(!id.isEmpty() && ((kind == "game" && id == anyFullscreen) || hasId(list(captureType(kind), captureProperty(kind)), id)), "Selected video device is unavailable"); n.insert("id", id); }
  else if (kind == "image") {
   const auto file = stringArg(spec, "file", 1024); QFileInfo info(file); const auto suffix = info.suffix().toLower();
   require(info.isAbsolute() && info.isFile() && info.size() > 0 && info.size() <= 25 * 1024 * 1024 && (suffix == "png" || suffix == "jpg" || suffix == "jpeg" || suffix == "gif" || suffix == "bmp" || suffix == "webp"), "Image file is unavailable");
   n.insert("file", QDir::toNativeSeparators(info.absoluteFilePath()));
  }
  else if (kind == "text") { const auto text = stringArg(spec, "text", 200).trimmed(); require(!text.isEmpty(), "Text source needs text"); n.insert("text", text); }
  else { n.insert("width", spec.value("width").toInt(1280)); n.insert("height", spec.value("height").toInt(720)); n.insert("color", spec.value("color").toDouble(4294967295.0)); }
  return n;
 }
 // Explicit layer list, or the single-source form used by earlier hosts. Every device id is checked against the current enumeration.
 QJsonArray layerSpecs(const QJsonObject &args) {
  QJsonArray specs;
  if (args.contains("layers")) {
   require(args.value("layers").isArray(), "Invalid layers"); const auto items = args.value("layers").toArray(); require(items.size() >= 1 && items.size() <= 8, "Scene needs 1 to 8 sources");
   for (const auto &v : items) { require(v.isObject(), "Invalid layer"); specs.append(normalizeLayer(v.toObject())); }
   return specs;
  }
  const auto kind = stringArg(args, "sourceType", 16); require(captureKind(kind), "Unsupported source type");
  specs.append(normalizeLayer({{"kind", kind}, {"id", kind == "camera" ? args.value("cameraId") : args.value("sourceId")}}));
  return specs;
 }
 static QString layerKey(const QJsonObject &n) {
  const auto kind = n.value("kind").toString();
  if (captureKind(kind)) return kind + "|" + n.value("id").toString();
  if (kind == "image") return "image|" + n.value("file").toString();
  if (kind == "text") return "text|" + n.value("text").toString() + "|" + n.value("fit").toString() + n.value("corner").toString() + QString::number(n.value("size").toDouble());
  return "synthetic|" + QString::fromUtf8(QJsonDocument(n).toJson(QJsonDocument::Compact));
 }
 obs_source_t *createLayerSource(const QJsonObject &n) {
  const auto kind = n.value("kind").toString(); obs_source_t *source = nullptr;
  if (captureKind(kind)) {
   auto *settings = obs_data_create(); const auto id = n.value("id").toString();
   if (kind == "game") {
    // Upstream game hook: DirectX/OpenGL/Vulkan games, windowed or exclusive fullscreen. "any_fullscreen" waits for the next fullscreen game.
    obs_data_set_string(settings, "capture_mode", id == anyFullscreen ? "any_fullscreen" : "window");
    if (id != anyFullscreen) obs_data_set_string(settings, "window", id.toUtf8().constData());
    obs_data_set_int(settings, "priority", 1); obs_data_set_bool(settings, "capture_cursor", true); obs_data_set_bool(settings, "anti_cheat_hook", true); obs_data_set_bool(settings, "capture_overlays", false);
   } else obs_data_set_string(settings, captureProperty(kind), id.toUtf8().constData());
   // Windows Graphics Capture reads GPU-rendered windows (games, browsers); BitBlt returns black for them. The plugin falls back to BitBlt where WGC is unsupported.
   if (kind == "window") { obs_data_set_int(settings, "priority", 1); obs_data_set_int(settings, "method", 2); obs_data_set_bool(settings, "cursor", true); obs_data_set_bool(settings, "capture_audio", false); } // Exact selected title; never whole-screen fallback.
   source = obs_source_create_private(captureType(kind), "Privex video", settings); obs_data_release(settings); require(source, "Video capture creation failed");
   obs_source_set_audio_mixers(source, 0); obs_source_set_muted(source, true); // Camera embedded audio must not bypass the selected/muted microphone.
  } else if (kind == "image") {
   auto *settings = obs_data_create(); obs_data_set_string(settings, "file", n.value("file").toString().toUtf8().constData()); obs_data_set_bool(settings, "unload", false); obs_data_set_bool(settings, "linear_alpha", false);
   source = obs_source_create_private("image_source", "Privex image", settings); obs_data_release(settings); require(source, "Image source creation failed");
  } else if (kind == "text") {
   const auto box = layerBox(n); const bool corner = n.value("fit").toString() == "corner"; const auto c = n.value("corner").toString();
   const int px = std::max(12, int(std::lround(std::min(width, height) * (corner ? n.value("size").toDouble(0.3) * 0.14 : 0.06))));
   source = textSource("Privex text", n.value("text").toString(), px, box.w, box.h, corner ? (c.endsWith('l') ? "left" : "right") : "center", corner ? (c.startsWith('t') ? "top" : "bottom") : "center", true);
   require(source, "Text source creation failed");
  } else source = colorSource("Privex synthetic layer", n.value("width").toInt(), n.value("height").toInt(), uint32_t(n.value("color").toDouble()));
  require(source, "Layer source creation failed"); return source;
 }
 void placeLayer(obs_sceneitem_t *item, const QJsonObject &n) {
  const auto box = layerBox(n); const bool fill = n.value("fit").toString() == "fill";
  obs_sceneitem_defer_update_begin(item);
  vec2 bounds{float(box.w), float(box.h)}; vec2 pos{float(box.x), float(box.y)};
  obs_sceneitem_set_bounds_type(item, fill ? OBS_BOUNDS_SCALE_OUTER : OBS_BOUNDS_SCALE_INNER); obs_sceneitem_set_bounds_alignment(item, box.align); obs_sceneitem_set_bounds_crop(item, fill);
  obs_sceneitem_set_bounds(item, &bounds); obs_sceneitem_set_alignment(item, OBS_ALIGN_TOP | OBS_ALIGN_LEFT); obs_sceneitem_set_pos(item, &pos);
  obs_sceneitem_defer_update_end(item);
 }
 struct Swap { Engine *engine; std::vector<Layer> *next; bool failed; };
 void swapLayersLocked(std::vector<Layer> &next, bool &failed) {
  for (auto &old : layers) { if (old.item) obs_sceneitem_remove(old.item); old.item = nullptr; }
  // Index 0 is the front-most layer: add it last so it renders above the others.
  for (auto it = next.rbegin(); it != next.rend(); ++it) {
   auto *item = obs_scene_add(scene, it->source); if (!item) { failed = true; continue; }
   obs_sceneitem_set_visible(item, false); placeLayer(item, it->spec); obs_sceneitem_set_visible(item, it->visible && !paused); it->item = item;
  }
  for (auto [source, item] : pauseSources) obs_sceneitem_set_order(item, OBS_ORDER_MOVE_TOP);
  for (auto [source, item] : overlaySources) obs_sceneitem_set_order(item, OBS_ORDER_MOVE_TOP);
 }
 // Replaces the composed layers. Unchanged sources are reused so a camera is not reopened; on failure nothing changes.
 void applyLayers(const QJsonArray &specs, bool waitReady) {
  require(scene, "Canvas unavailable");
  std::vector<Layer> next; std::vector<obs_source_t *> showing;
  try {
   for (const auto &v : specs) {
    Layer layer; layer.spec = v.toObject(); layer.key = layerKey(layer.spec); layer.visible = layer.spec.value("visible").toBool(true); layer.capture = captureKind(layer.spec.value("kind").toString());
    auto reuse = std::find_if(layers.begin(), layers.end(), [&](const Layer &old) { return !old.claimed && old.key == layer.key; });
    if (reuse != layers.end()) { reuse->claimed = true; layer.source = reuse->source; }
    else { layer.source = createLayerSource(layer.spec); layer.created = true; if (waitReady && layer.capture) { obs_source_inc_showing(layer.source); showing.push_back(layer.source); } }
    next.push_back(layer);
   }
   if (waitReady) for (auto &layer : next) if (layer.created && layer.capture) {
    for (int attempt = 0; attempt < 120 && (!obs_source_get_width(layer.source) || !obs_source_get_height(layer.source)); attempt++) Sleep(25);
    require(obs_source_get_width(layer.source) > 0 && obs_source_get_height(layer.source) > 0, "New video source is not ready; previous sources preserved");
   }
  } catch (...) {
   for (auto *s : showing) obs_source_dec_showing(s);
   for (auto &layer : next) if (layer.created && layer.source) obs_source_release(layer.source);
   for (auto &old : layers) old.claimed = false;
   throw;
  }
  Swap swap{this, &next, false};
  obs_scene_atomic_update(scene, [](void *data, obs_scene_t *) { auto *s = static_cast<Swap *>(data); s->engine->swapLayersLocked(*s->next, s->failed); }, &swap);
  for (auto &old : layers) if (!old.claimed && old.source) obs_source_release(old.source);
  layers = std::move(next); for (auto *s : showing) obs_source_dec_showing(s);
  require(!swap.failed, "Could not compose scene layer");
 }
 void setLayerVisible(int index, bool visible) {
  require(prepared && index >= 0 && index < int(layers.size()), "Layer unavailable");
  auto &layer = layers[size_t(index)]; layer.visible = visible; layer.spec.insert("visible", visible);
  if (layer.item) obs_sceneitem_set_visible(layer.item, visible && !paused);
 }
 const Layer *primaryLayer() const { for (auto &l : layers) if (l.visible && l.capture) return &l; for (auto &l : layers) if (l.visible) return &l; return nullptr; }
 bool videoReady() const { for (auto &l : layers) if (l.visible && l.source && obs_source_get_width(l.source) > 0 && obs_source_get_height(l.source) > 0) return true; return false; }
 QJsonArray layerStatus() const {
  QJsonArray result;
  for (auto &l : layers) { const int w = l.source ? int(obs_source_get_width(l.source)) : 0, h = l.source ? int(obs_source_get_height(l.source)) : 0; result.append(QJsonObject{{"kind", l.spec.value("kind")}, {"visible", l.visible}, {"ready", w > 0 && h > 0}, {"width", w}, {"height", h}}); }
  return result;
 }
 void setScene(const QString &mode) {
  require(prepared && scene && !layers.empty(),"Prepare video before selecting a scene"); require(mode == "pause" || mode == "live","Invalid scene mode");
  if (mode == "pause" && pauseSources.empty()) {
   addLayerSource(pauseSources,colorSource("Privex interval background",width,height,0xff181018),0,0);
   addLayerSource(pauseSources,textSource("Privex interval title",QString::fromUtf8("Voltamos em instantes"),width < height ? 38 : 48,width-96,180),48,float(height/2-70));
  }
  paused = mode == "pause";
  for (auto &layer : layers) if (layer.item) obs_sceneitem_set_visible(layer.item, layer.visible && !paused);
  for (auto [source,item] : pauseSources) obs_sceneitem_set_visible(item,paused);
  if (mic) obs_source_set_muted(mic,paused || desiredMuted);
  if (desktop) obs_source_set_muted(desktop,paused);
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
 QJsonObject enumerate() {
  init(); QJsonArray games{QJsonObject{{"id", anyFullscreen}, {"name", QString::fromUtf8("Qualquer jogo em tela cheia")}}}; for (const auto &w : list("game_capture", "window")) games.append(w);
  return {{"cameras", list("dshow_input", "video_device_id")}, {"microphones", list("wasapi_input_capture", "device_id")}, {"desktops", list("wasapi_output_capture", "device_id")}, {"displays", list("monitor_capture", "monitor_id")}, {"windows", list("window_capture", "window")}, {"games", games}};
 }
 void volume(const QJsonObject &args) {
  auto channel = stringArg(args,"channel",16); double value = args.value("volume").toDouble(-1);
  require((channel=="microphone" || channel=="desktop") && std::isfinite(value) && value>=0 && value<=100,"Invalid volume");
  float &level = channel=="microphone" ? micVolume : desktopVolume; level=float(value/100.0);
  auto *source = channel=="microphone" ? mic : desktop; if(source) obs_source_set_volume(source,level);
 }
 QJsonObject reconfigure(const QJsonObject &args) {
  require(prepared && scene,"Prepare video before changing equipment");
  require(args.value("width").toInt()==width && args.value("height").toInt()==height && args.value("fps").toInt()==fps,"End the stream before changing canvas format");
  const auto specs = layerSpecs(args);
  auto microphoneId=args.value("microphoneId").toString(),desktopId=args.value("desktopId").toString();
  require(microphoneId.isEmpty() || hasId(list("wasapi_input_capture","device_id"),microphoneId),"Selected microphone is unavailable");
  require(desktopId.isEmpty() || hasId(list("wasapi_output_capture","device_id"),desktopId),"Selected desktop audio is unavailable");
  bool changeMic=microphoneId!=captureConfig.value("microphoneId").toString(),changeDesktop=desktopId!=captureConfig.value("desktopId").toString();
  obs_source_t *nextMic=nullptr,*nextDesktop=nullptr;
  auto createAudio=[](const char *sourceType,const char *name,const QString &id) {
   if(id.isEmpty()) return static_cast<obs_source_t *>(nullptr);
   auto *settings=obs_data_create();obs_data_set_string(settings,"device_id",id.toUtf8().constData());
   auto *source=obs_source_create_private(sourceType,name,settings);obs_data_release(settings); require(source,"Audio capture creation failed");return source;
  };
  try {
   if(changeMic) nextMic=createAudio("wasapi_input_capture","Privex microphone",microphoneId);
   if(changeDesktop) nextDesktop=createAudio("wasapi_output_capture","Privex desktop audio",desktopId);
   applyLayers(specs, true);
   if(changeMic){if(nextMic){obs_source_set_volume(nextMic,micVolume);obs_source_set_muted(nextMic,paused||desiredMuted);}micMeter.detach();obs_set_output_source(1,nextMic);if(mic)obs_source_release(mic);mic=nextMic;nextMic=nullptr;micMeter.attach(mic);}
   if(changeDesktop){if(nextDesktop){obs_source_set_volume(nextDesktop,desktopVolume);obs_source_set_muted(nextDesktop,paused);}desktopMeter.detach();obs_set_output_source(2,nextDesktop);if(desktop)obs_source_release(desktop);desktop=nextDesktop;nextDesktop=nullptr;desktopMeter.attach(desktop);}
   captureConfig=args;return status();
  } catch(...){if(nextMic)obs_source_release(nextMic);if(nextDesktop)obs_source_release(nextDesktop);throw;}
 }
 QJsonObject prepare(const QJsonObject &args) {
  require(!active(), "End the stream before changing capture"); init(); clearSources();
  if(args.contains("microphoneVolume"))volume({{"channel","microphone"},{"volume",args.value("microphoneVolume")}});
  if(args.contains("desktopVolume"))volume({{"channel","desktop"},{"volume",args.value("desktopVolume")}});
  width = args.value("width").toInt(1280); height = args.value("height").toInt(720); fps = args.value("fps").toInt(30);
  require((width == 1280 && height == 720) || (width == 720 && height == 1280) || (width == 1920 && height == 1080) || (width == 1080 && height == 1920), "Unsupported canvas size");
  require(fps == 30, "Pilot supports 30 fps"); resetVideo();
  const auto specs = layerSpecs(args);
  scene = obs_scene_create_private("Privex canvas"); require(scene, "Canvas creation failed"); applyLayers(specs, false); obs_set_output_source(0, obs_scene_get_source(scene));
  auto microphoneId = args.value("microphoneId").toString();
  if (!microphoneId.isEmpty()) {
   require(hasId(list("wasapi_input_capture", "device_id"), microphoneId), "Selected microphone is unavailable");
   auto *settings = obs_data_create(); obs_data_set_string(settings, "device_id", microphoneId.toUtf8().constData());
   mic = obs_source_create_private("wasapi_input_capture", "Privex microphone", settings); obs_data_release(settings); require(mic, "Microphone creation failed");
   desiredMuted = args.value("muted").toBool(false); obs_source_set_muted(mic, desiredMuted); obs_source_set_volume(mic,micVolume); obs_set_output_source(1, mic);
  }
  auto desktopId=args.value("desktopId").toString();
  if(!desktopId.isEmpty()){
   require(hasId(list("wasapi_output_capture","device_id"),desktopId),"Selected desktop audio is unavailable");
   auto *settings=obs_data_create();obs_data_set_string(settings,"device_id",desktopId.toUtf8().constData());
   desktop=obs_source_create_private("wasapi_output_capture","Privex desktop audio",settings);obs_data_release(settings);require(desktop,"Desktop audio creation failed");
   obs_source_set_volume(desktop,desktopVolume);obs_set_output_source(2,desktop);
  }
  micMeter.attach(mic);desktopMeter.attach(desktop);
  desiredMuted=args.value("muted").toBool(false);captureConfig=args;attachPreview(args); prepared = true; return status();
 }
 QJsonObject start(QJsonObject args) {
  require(prepared && videoReady(), "Wait for a working video source before starting"); require(!active(), "Stream is already starting or active"); releaseOutput();
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
  const Layer *primary = primaryLayer();
  return {{"prepared", prepared}, {"state", QString::fromLatin1(publish.name)}, {"streaming", publish.streaming}, {"width", width}, {"height", height}, {"fps", fps}, {"muted", !mic || obs_source_muted(mic)}, {"sceneMode",paused?"pause":"live"}, {"overlayVisible",!overlaySources.empty()}, {"sourceWidth", primary ? int(obs_source_get_width(primary->source)) : 0}, {"sourceHeight", primary ? int(obs_source_get_height(primary->source)) : 0}, {"layers", layerStatus()}, {"totalBytes", output ? double(obs_output_get_total_bytes(output)) : 0}, {"droppedFrames", output ? obs_output_get_frames_dropped(output) : 0}, {"stopCode", stopCode == 999 ? QJsonValue() : QJsonValue(stopCode.load())}};
 }
 QJsonObject audioLevels(){return {{"microphone",micMeter.read(mic)},{"desktop",desktopMeter.read(desktop)}};}
};

std::atomic<int> testFrames = 0, testFitFrames = 0, testStage = 0, testPauseFrames = 0, testOverlayFrames = 0, testCornerFrames = 0, testHiddenFrames = 0;
void testFrame(void *, video_data *frame) {
 testFrames++;
 // Portrait canvas, full landscape source: center white, top/bottom letterbox black.
 auto pixel = [&](int x, int y) { return frame->data[0] + y * frame->linesize[0] + x * 4; };
 auto *top = pixel(360, 30), *center = pixel(360, 640), *left = pixel(4, 640), *right = pixel(715, 640), *bottom = pixel(360, 1240);
 if (testStage == 0 && top[0] < 20 && bottom[0] < 20 && center[0] > 230 && left[0] > 230 && right[0] > 230) testFitFrames++;
 if (testStage == 1 && left[0] < 40 && right[0] < 40) testPauseFrames++;
 auto *fill = pixel(60,1249), *track = pixel(490,1249), *outside = pixel(600,1249);
 if (testStage == 2 && fill[2] > 150 && fill[1] < 100 && fill[0] > 130 && track[2] < 100 && track[0] < 100 && outside[0] < 20 && outside[1] < 20 && outside[2] < 20) testOverlayFrames++;
 // Corner layer (40% width, bottom-right) over the letterboxed white base: red inside the box, black beside it, white center.
 auto *cornerPx = pixel(550,1180), *besideCorner = pixel(100,1180);
 if (testStage == 3 && cornerPx[2] > 200 && cornerPx[1] < 60 && cornerPx[0] < 60 && besideCorner[0] < 20 && besideCorner[2] < 20 && center[0] > 230) testCornerFrames++;
 if (testStage == 4 && cornerPx[0] < 20 && cornerPx[1] < 20 && cornerPx[2] < 20 && center[0] > 230) testHiddenFrames++;
}
int testAudioMeters(){
 require(AudioMeter::boundedDb(-INFINITY)==-60 && AudioMeter::boundedDb(NAN)==-60 && AudioMeter::boundedDb(12)==0 && AudioMeter::boundedDb(-12)==-12,"Meter numerical bounds failed");
 obs_source_info info{};info.id="privex_synthetic_audio_meter";info.type=OBS_SOURCE_TYPE_INPUT;info.output_flags=OBS_SOURCE_AUDIO;
 info.get_name=[](void *){return "Synthetic meter source";};info.create=[](obs_data_t *,obs_source_t *source)->void *{return source;};info.destroy=[](void *){};
 obs_register_source(&info);auto *source=obs_source_create_private(info.id,"Synthetic audio meter",nullptr);require(source,"Synthetic audio source unavailable");
 AudioMeter meter;meter.attach(source);require(meter.read(source).value("state").toString()=="waiting","New meter must wait for actual samples");
 auto feed=[&](float amplitude){
  alignas(16) float left[480],right[480];std::fill_n(left,480,amplitude);std::fill_n(right,480,amplitude);
  obs_source_audio audio{};audio.data[0]=reinterpret_cast<uint8_t *>(left);audio.data[1]=reinterpret_cast<uint8_t *>(right);
  audio.frames=480;audio.speakers=SPEAKERS_STEREO;audio.format=AUDIO_FORMAT_FLOAT_PLANAR;audio.samples_per_sec=48000;audio.timestamp=os_gettime_ns();
  obs_source_output_audio(source,&audio);
 };
 obs_source_set_volume(source,.5f);feed(.5f);auto level=meter.read(source);
 require(level.value("receiving").toBool() && std::abs(level.value("inputDb").toDouble()+6.0206)<.05 && std::abs(level.value("outputDb").toDouble()+12.0412)<.05,"Real volmeter input and postgain values differ from expected dBFS");
 obs_source_set_muted(source,true);feed(.5f);level=meter.read(source);
 require(level.value("inputDb").toDouble()>-7 && level.value("outputDb").toDouble()==-60 && level.value("muted").toBool(),"Mute must preserve input test but silence output meter");
 obs_source_set_muted(source,false);obs_source_set_volume(source,1);feed(1);level=meter.read(source);
 require(level.value("inputClipping").toBool() && level.value("outputClipping").toBool(),"Full scale must hold clipping indication");
 // The peak meter includes the previous buffer boundary. Flush that tail and its hold.
 feed(0);Sleep(220);feed(0);level=meter.read(source);
 require(level.value("receiving").toBool() && level.value("inputDb").toDouble()==-60 && level.value("outputDb").toDouble()==-60,"Actual silence must remain distinct from missing callbacks");
 Sleep(1050);level=meter.read(source);require(!level.value("receiving").toBool() && level.value("inputDb").toDouble()==-60,"Stale samples must not retain a false signal");
 std::atomic<bool> feeding=true;std::thread producer([&]{while(feeding){feed(.25f);Sleep(1);}});
 for(int i=0;i<20;i++){meter.detach();meter.attach(source);Sleep(2);}feeding=false;producer.join();
 meter.detach();require(meter.read(nullptr).value("state").toString()=="unconfigured","Detached meter must clear old device state");obs_source_release(source);return 8;
}
QJsonObject synthetic(int w, int h, double color, const char *fit = "fit", const char *corner = "br", double size = 0.3) { return {{"kind","synthetic"},{"width",w},{"height",h},{"color",color},{"fit",fit},{"corner",corner},{"size",size}}; }
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
 e.init();int meterChecks=testAudioMeters();e.width = 720; e.height = 1280; e.resetVideo();
 const double white = 4294967295.0, green = double(0xff00ff00u), red = double(0xff0000ffu);
 e.scene = obs_scene_create_private("Synthetic canvas"); require(e.scene, "Synthetic canvas unavailable");
 e.applyLayers(QJsonArray{e.normalizeLayer(synthetic(1280, 720, white))}, false); obs_set_output_source(0, obs_scene_get_source(e.scene));
 require(e.layers.size() == 1 && e.layers[0].source && e.layers[0].item, "Synthetic source unavailable");
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
 e.desktop=e.colorSource("Synthetic desktop audio flag",1,1,0);
 e.volume({{"channel","microphone"},{"volume",25}});e.volume({{"channel","desktop"},{"volume",60}});
 require(std::abs(obs_source_get_volume(e.mic)-.25f)<.001f && std::abs(obs_source_get_volume(e.desktop)-.60f)<.001f,"Independent audio volume not applied");
 auto *sameScene=e.scene;e.setScene("pause");require(obs_source_muted(e.desktop),"Interval must mute desktop audio too");
 e.applyLayers(QJsonArray{e.normalizeLayer(synthetic(720, 1280, green))}, false);
 require(e.scene==sameScene && e.paused && e.layers.size()==1 && !obs_sceneitem_visible(e.layers[0].item),"Switch must preserve scene and interval privacy");
 e.setScene("live");require(!obs_source_muted(e.desktop) && obs_source_muted(e.mic),"Switch/resume must restore independent mute states");
 require(std::abs(obs_source_get_volume(e.desktop)-.60f)<.001f,"Switch must preserve desktop volume");
 auto *sameVisual=e.layers[0].source;e.starting=true;bool refused=false;
 try{e.reconfigure({{"width",720},{"height",1280},{"fps",30},{"sourceType","camera"},{"cameraId","synthetic-missing-device"}});}catch(const std::exception &){refused=true;}
 require(refused && e.layers.size()==1 && e.layers[0].source==sameVisual && e.scene==sameScene && e.active(),"Unavailable replacement must preserve publishing and previous source");e.starting=false;
 refused=false;try{e.volume({{"channel","desktop"},{"volume",101}});}catch(const std::exception &){refused=true;}
 require(refused && std::abs(obs_source_get_volume(e.desktop)-.60f)<.001f,"Invalid volume must preserve previous level");
 // Layered composition: a red corner box in front of the letterboxed white base, then hidden, then re-applied reusing sources.
 e.applyLayers(QJsonArray{e.normalizeLayer(synthetic(640, 360, red, "corner", "br", 0.4)), e.normalizeLayer(synthetic(1280, 720, white))}, false); testStage=3; Sleep(500);
 require(testCornerFrames>5,"Corner layer pixel check failed");
 e.setLayerVisible(0,false); testStage=4; Sleep(500); require(testHiddenFrames>5,"Hidden layer must disappear from the canvas");
 auto *cornerSource=e.layers[0].source,*baseSource=e.layers[1].source;
 e.applyLayers(QJsonArray{e.normalizeLayer(synthetic(640, 360, red, "corner", "tl", 0.4)), e.normalizeLayer(synthetic(1280, 720, white))}, false);
 require(e.layers[1].source==baseSource && e.layers[0].source!=cornerSource && e.layers[0].visible,"Unchanged layers must keep their source; changed placement recreates only that layer");
 refused=false;try{e.applyLayers(QJsonArray{e.normalizeLayer(QJsonObject{{"kind","text"},{"text","   "}})},false);}catch(const std::exception &){refused=true;}
 require(refused && e.layers.size()==2 && e.layers[1].source==baseSource,"Invalid layer list must preserve the current composition");
 obs_remove_raw_video_callback(testFrame, nullptr);
 e.videoEncoder = obs_video_encoder_create("obs_x264", "Synthetic encoder", nullptr, nullptr); e.audioEncoder = obs_audio_encoder_create("ffmpeg_aac", "Synthetic audio encoder", nullptr, 0, nullptr);
 require(e.videoEncoder && e.audioEncoder, "Bundled H264/AAC encoders unavailable");
 send({{"ok", true}, {"test", "real-libobs-composition"}, {"frames", testFrames.load()}, {"validFitFrames", testFitFrames.load()}, {"validPauseFrames",testPauseFrames.load()}, {"validOverlayFrames",testOverlayFrames.load()}, {"validCornerFrames",testCornerFrames.load()}, {"validHiddenFrames",testHiddenFrames.load()}, {"pauseRestoresMute",true}, {"sourceSwitchAndAudioChecks",7}, {"layerCompositionChecks",4}, {"audioMeterChecks",meterChecks}, {"reconnectionStateChecks",5}, {"h264AndAacAvailable", true}, {"networkUsed", false}, {"physicalCaptureUsed", false}}); return 0;
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
    else if (command == "reconfigure") result = engine.reconfigure(args);
    else if (command == "layer") { require(args.value("index").isDouble() && args.value("visible").isBool(), "Invalid layer request"); engine.setLayerVisible(args.value("index").toInt(), args.value("visible").toBool()); result = engine.status(); }
    else if (command == "volume") { engine.volume(args); result=engine.status(); }
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
 QTimer audioTimer;QObject::connect(&audioTimer,&QTimer::timeout,[&]{if(engine.prepared)send({{"event","audio-levels"},{"channels",engine.audioLevels()}});});audioTimer.start(200);
 send({{"event", "ready"}, {"protocol", 1}}); return app.exec();
}
