/*
 * Pixel Project 24/7 dashboard client for Seeed Studio reTerminal E1001.
 *
 * The device:
 *  1. Connects to 2.4 GHz Wi-Fi.
 *  2. Checks the protected Pixel dashboard version.
 *  3. Downloads the 800x480 PNG only when that version changes.
 *  4. Refreshes the e-paper only after a valid image was decoded.
 *
 * The last image remains visible if Wi-Fi, Vercel or decoding fails.
 */

#include <Arduino.h>
#include <FS.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <PNGdec.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "TFT_eSPI.h"

#if __has_include("config.h")
#include "config.h"
#else
#error "Missing config.h. Copy config.example.h to config.h and fill in Wi-Fi and Pixel credentials."
#endif

#ifndef EPAPER_ENABLE
#error "The E1001 display driver is not active. Keep driver.h beside this sketch and install Seeed_GFX."
#endif

static constexpr int PANEL_WIDTH = 800;
static constexpr int PANEL_HEIGHT = 480;
static constexpr int DEBUG_RX_PIN = 44;
static constexpr int DEBUG_TX_PIN = 43;
static constexpr unsigned long WIFI_TIMEOUT_MS = 30000;
static constexpr unsigned long MIN_REFRESH_SECONDS = 60;
static constexpr unsigned long MAX_REFRESH_SECONDS = 3600;
static constexpr size_t MAX_PNG_BYTES = 2 * 1024 * 1024;

static const char* STATE_PATH = "/api/epaper/admin-dashboard.json";
static const char* IMAGE_PATH = "/api/epaper/admin-dashboard.png";
static const char* TEMP_IMAGE_FILE = "/dashboard.tmp";
static const char* CURRENT_IMAGE_FILE = "/dashboard.png";

#define LOG Serial1

EPaper epaper;
PNG png;
Preferences preferences;
File pngFile;

static uint16_t rgbLine[PANEL_WIDTH];
static uint8_t monoLine[PANEL_WIDTH / 8];
static bool pngLineFailed = false;
static bool systemReady = false;
static unsigned long refreshSeconds = DEFAULT_REFRESH_SECONDS;

static String pixelUrl(const char* path) {
  String base(PIXEL_BASE_URL);
  while (base.endsWith("/")) base.remove(base.length() - 1);
  return base + path;
}

static bool configurationLooksValid() {
  return strlen(WIFI_SSID) > 0 &&
         strcmp(WIFI_SSID, "YOUR_2_4_GHZ_WIFI_NAME") != 0 &&
         strlen(PIXEL_DEVICE_TOKEN) >= 24 &&
         strcmp(PIXEL_DEVICE_TOKEN, "YOUR_LONG_RANDOM_DEVICE_TOKEN") != 0 &&
         String(PIXEL_BASE_URL).startsWith("https://");
}

static bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  LOG.printf("[wifi] Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_TIMEOUT_MS) {
    delay(500);
    LOG.print('.');
  }

  if (WiFi.status() != WL_CONNECTED) {
    LOG.println(" failed");
    return false;
  }

  LOG.printf(" connected, IP %s, signal %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  return true;
}

static String jsonStringValue(const String& json, const char* key) {
  String marker = String('"') + key + "\":";
  int start = json.indexOf(marker);
  if (start < 0) return "";
  start += marker.length();
  while (start < json.length() && isspace(static_cast<unsigned char>(json[start]))) start++;
  if (start >= json.length() || json[start] != '"') return "";
  start++;
  const int end = json.indexOf('"', start);
  return end > start ? json.substring(start, end) : "";
}

static long jsonIntegerValue(const String& json, const char* key, long fallback) {
  String marker = String('"') + key + "\":";
  int start = json.indexOf(marker);
  if (start < 0) return fallback;
  start += marker.length();
  while (start < json.length() && isspace(static_cast<unsigned char>(json[start]))) start++;
  int end = start;
  while (end < json.length() && isdigit(static_cast<unsigned char>(json[end]))) end++;
  return end > start ? json.substring(start, end).toInt() : fallback;
}

static bool fetchDashboardVersion(String& version) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setConnectTimeout(15000);
  http.setTimeout(30000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  if (!http.begin(client, pixelUrl(STATE_PATH))) return false;
  http.addHeader("Authorization", String("Bearer ") + PIXEL_DEVICE_TOKEN);
  http.addHeader("Accept", "application/json");

  const int status = http.GET();
  if (status != HTTP_CODE_OK) {
    LOG.printf("[pixel] State request failed: HTTP %d\n", status);
    http.end();
    return false;
  }

  const String payload = http.getString();
  http.end();

  version = jsonStringValue(payload, "version");
  long serverRefresh = jsonIntegerValue(payload, "refresh_after_seconds", DEFAULT_REFRESH_SECONDS);
  refreshSeconds = constrain(serverRefresh, MIN_REFRESH_SECONDS, MAX_REFRESH_SECONDS);

  if (version.length() < 8) {
    LOG.println("[pixel] State response did not contain a valid version");
    return false;
  }

  LOG.printf("[pixel] Dashboard version %s; next check in %lu seconds\n",
             version.c_str(), refreshSeconds);
  return true;
}

static bool downloadDashboardPng() {
  LittleFS.remove(TEMP_IMAGE_FILE);
  File target = LittleFS.open(TEMP_IMAGE_FILE, FILE_WRITE);
  if (!target) {
    LOG.println("[image] Could not create temporary image file");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setConnectTimeout(15000);
  http.setTimeout(60000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  if (!http.begin(client, pixelUrl(IMAGE_PATH))) {
    target.close();
    LittleFS.remove(TEMP_IMAGE_FILE);
    return false;
  }

  const char* responseHeaders[] = { "Content-Type" };
  http.collectHeaders(responseHeaders, 1);
  http.addHeader("Authorization", String("Bearer ") + PIXEL_DEVICE_TOKEN);
  http.addHeader("Accept", "image/png");

  const int status = http.GET();
  const int announcedLength = http.getSize();
  const String contentType = http.header("Content-Type");

  if (status != HTTP_CODE_OK ||
      (announcedLength > 0 && static_cast<size_t>(announcedLength) > MAX_PNG_BYTES) ||
      !contentType.startsWith("image/png")) {
    LOG.printf("[image] Download rejected: HTTP %d, type %s, size %d\n",
               status, contentType.c_str(), announcedLength);
    http.end();
    target.close();
    LittleFS.remove(TEMP_IMAGE_FILE);
    return false;
  }

  const int written = http.writeToStream(&target);
  http.end();
  target.close();

  File verification = LittleFS.open(TEMP_IMAGE_FILE, FILE_READ);
  const size_t actualSize = verification ? verification.size() : 0;
  if (verification) verification.close();

  if (written <= 0 || actualSize < 1000 || actualSize > MAX_PNG_BYTES) {
    LOG.printf("[image] Incomplete PNG: wrote %d bytes, file has %lu\n",
               written, static_cast<unsigned long>(actualSize));
    LittleFS.remove(TEMP_IMAGE_FILE);
    return false;
  }

  LOG.printf("[image] Downloaded %lu bytes\n", static_cast<unsigned long>(actualSize));
  return true;
}

static void* pngOpen(const char* filename, int32_t* size) {
  pngFile = LittleFS.open(filename, FILE_READ);
  if (!pngFile) return nullptr;
  *size = pngFile.size();
  return &pngFile;
}

static void pngClose(void* handle) {
  (void)handle;
  if (pngFile) pngFile.close();
}

static int32_t pngRead(PNGFILE* handle, uint8_t* buffer, int32_t length) {
  (void)handle;
  return pngFile ? pngFile.read(buffer, length) : 0;
}

static int32_t pngSeek(PNGFILE* handle, int32_t position) {
  (void)handle;
  return pngFile && pngFile.seek(position) ? position : 0;
}

static int drawPngLine(PNGDRAW* draw) {
  if (draw->iWidth != PANEL_WIDTH || draw->y < 0 || draw->y >= PANEL_HEIGHT) {
    pngLineFailed = true;
    return 0;
  }

  png.getLineAsRGB565(draw, rgbLine, PNG_RGB565_LITTLE_ENDIAN, 0xffffffff);
  memset(monoLine, 0, sizeof(monoLine));

  for (int x = 0; x < PANEL_WIDTH; x++) {
    const uint16_t color = rgbLine[x];
    const uint16_t red = ((color >> 11) & 0x1f) * 255 / 31;
    const uint16_t green = ((color >> 5) & 0x3f) * 255 / 63;
    const uint16_t blue = (color & 0x1f) * 255 / 31;
    const uint16_t luminance = (red * 299 + green * 587 + blue * 114) / 1000;

    if (luminance < MONOCHROME_THRESHOLD) {
      monoLine[x >> 3] |= static_cast<uint8_t>(0x80 >> (x & 7));
    }
  }

  epaper.drawBitmap(0, draw->y, monoLine, PANEL_WIDTH, 1, TFT_BLACK, TFT_WHITE);
  return 1;
}

static bool displayDownloadedPng() {
  pngLineFailed = false;
  const int opened = png.open(
    TEMP_IMAGE_FILE,
    pngOpen,
    pngClose,
    pngRead,
    pngSeek,
    drawPngLine
  );

  if (opened != PNG_SUCCESS) {
    LOG.printf("[image] PNG open error %d\n", opened);
    return false;
  }

  if (png.getWidth() != PANEL_WIDTH || png.getHeight() != PANEL_HEIGHT) {
    LOG.printf("[image] Wrong dimensions: %d x %d (expected 800 x 480)\n",
               png.getWidth(), png.getHeight());
    png.close();
    return false;
  }

  epaper.fillScreen(TFT_WHITE);
  const int decoded = png.decode(nullptr, 0);
  png.close();

  if (decoded != PNG_SUCCESS || pngLineFailed) {
    LOG.printf("[image] PNG decode error %d\n", decoded);
    return false;
  }

  LOG.println("[display] Refreshing e-paper; this can take several seconds");
  epaper.update();
  LOG.println("[display] Dashboard is now visible");
  return true;
}

static bool installDownloadedImage() {
  LittleFS.remove(CURRENT_IMAGE_FILE);
  if (!LittleFS.rename(TEMP_IMAGE_FILE, CURRENT_IMAGE_FILE)) {
    LOG.println("[image] Display refreshed, but the local PNG could not be retained");
    return false;
  }
  return true;
}

static void checkForDashboardUpdate(bool forceRefresh = false) {
  if (!connectWifi()) return;

  String remoteVersion;
  if (!fetchDashboardVersion(remoteVersion)) return;

  const String installedVersion = preferences.getString("version", "");
  if (!forceRefresh && installedVersion == remoteVersion) {
    LOG.println("[pixel] No change; e-paper refresh skipped");
    return;
  }

  LOG.printf("[pixel] Installing dashboard %s (previous: %s)\n",
             remoteVersion.c_str(), installedVersion.length() ? installedVersion.c_str() : "none");

  if (!downloadDashboardPng()) return;
  if (!displayDownloadedPng()) {
    LittleFS.remove(TEMP_IMAGE_FILE);
    LOG.println("[display] Previous physical image was preserved");
    return;
  }
  if (!installDownloadedImage()) return;

  preferences.putString("version", remoteVersion);
}

void setup() {
  LOG.begin(115200, SERIAL_8N1, DEBUG_RX_PIN, DEBUG_TX_PIN);
  delay(1500);
  LOG.println();
  LOG.println("==============================================");
  LOG.println(" Pixel Project 24/7 - reTerminal E1001");
  LOG.println("==============================================");

  if (!configurationLooksValid()) {
    LOG.println("[config] Invalid config.h; Wi-Fi, URL or Pixel token is still missing");
    return;
  }

  if (!LittleFS.begin(true)) {
    LOG.println("[storage] LittleFS could not be mounted");
    return;
  }

  preferences.begin("pixel-epaper", false);
  epaper.begin();
  systemReady = true;

  // An empty preference means first installation. The existing physical e-paper
  // image is never cleared while network or image validation is pending.
  checkForDashboardUpdate(!LittleFS.exists(CURRENT_IMAGE_FILE));
}

void loop() {
  if (!systemReady) {
    delay(1000);
    return;
  }

  const unsigned long waitMs = refreshSeconds * 1000UL;
  const unsigned long startedAt = millis();
  while (millis() - startedAt < waitMs) delay(250);
  checkForDashboardUpdate(false);
}
