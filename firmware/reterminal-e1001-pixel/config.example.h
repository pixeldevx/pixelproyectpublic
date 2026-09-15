#pragma once

// Copy this file as config.h and fill in the four values below.
// config.h is ignored by Git so Wi-Fi credentials and the device token stay private.

static const char* WIFI_SSID = "YOUR_2_4_GHZ_WIFI_NAME";
static const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Production Pixel address, without a trailing slash.
static const char* PIXEL_BASE_URL = "https://www.pixelprojects.com.co";

// Must match EPAPER_ADMIN_TOKEN configured in Vercel.
static const char* PIXEL_DEVICE_TOKEN = "YOUR_LONG_RANDOM_DEVICE_TOKEN";

// Used only if Pixel cannot return its preferred refresh interval.
static const unsigned long DEFAULT_REFRESH_SECONDS = 600;

// Black/white conversion threshold. Higher values preserve more dark gray as black.
static const uint8_t MONOCHROME_THRESHOLD = 178;
