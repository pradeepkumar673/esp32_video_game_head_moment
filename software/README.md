# Head Tracker for Euro Truck Simulator 2

A head tracker built from an ESP32 and an MPU6050 gyro/accelerometer mounted on sunglasses. Head movement is sent to OpenTrack, which drives the in-game camera in ETS2. A browser control center shows the live head, the orientation values, device diagnostics, and settings.

## Folder layout

```
esp32_head_tracker/
├── arduin/Stage1_Bringup/Stage1_Bringup.ino   ESP32 firmware (Stage 3d)
└── software/
    ├── start.bat                              launches the bridge and the UI
    ├── head-tracker-bridge/
    │   ├── read_bridge.js                     serial → OpenTrack and WebSocket bridge
    │   ├── config.json                        tracking settings
    │   └── profiles/                          saved settings profiles
    ├── head-tracker-ui/                       React control center
    │   └── public/models/head.glb             3D head model
    └── read_stream.js, ws_check.js            test scripts (not needed to run the app)
```

## Hardware

- ESP32-WROOM-32 dev board, connected to the PC over USB
- GY-521 (MPU6050) breakout, wired to 3V3, GND, GPIO 21 (SDA), and GPIO 22 (SCL)
- The breakout is glued to the outer face of the right glasses arm

## Software

- Arduino IDE 2.x with the ESP32 board package
- Node.js (v18 or newer)
- OpenTrack 2026.1.0 or newer
- Euro Truck Simulator 2

## One-time setup

1. Flash `Stage1_Bringup.ino` to the ESP32.
2. In `software/head-tracker-bridge`, run `npm install`.
3. In `software/head-tracker-ui`, run `npm install`.
4. In OpenTrack, set **Input** to *UDP over network*, **Output** to *freetrack 2.0 Enhanced*, and **Filter** to *Accela*. Press **Start** when you're ready to play.
5. In ETS2, turn on the head tracking option under Options (TrackIR or head tracking, depending on the game version).

## Running it

1. Close the Arduino Serial Monitor. Only one program can use the COM port at a time.
2. Double-click `software/start.bat`.
3. Keep the glasses flat on the desk while the ESP32 runs its **3-minute warm-up**. Then it calibrates for 10 seconds. The bridge window shows `# STREAMING` when it's ready.
4. Put the glasses on, look straight ahead, and press **Recenter** in the browser.
5. Start OpenTrack tracking, then play.

## Controls

| Action | Where |
|---|---|
| Re-center the view | **Recenter** button, or type `r` in the bridge window |
| Re-calibrate the sensor | Diagnostics → **Calibrate sensor** (keep still for 10 seconds) |
| Change tracking settings | Settings panel. Saved to `config.json` immediately |
| Save or load a setup | Settings → Profiles |

## Settings

`config.json` holds these values. Keep `autoCenter` set to `false`. The firmware performs centering, and the bridge version drifted more during testing.

| Setting | Meaning |
|---|---|
| `autoCenter` | Bridge-side centering. Leave `false`. |
| `deadZoneDeg` | Range used by bridge-side centering. |
| `centerRate` | Speed used by bridge-side centering. |
| `stillRangeDeg` | How much movement still counts as still. |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser shows **Bridge offline** | The bridge window isn't running. Start it with `start.bat`. |
| Browser shows **Device disconnected** | Check the USB cable and the COM port number in `start.bat`. |
| Bridge says `Cannot open COM6` | Close the Arduino Serial Monitor, and check the COM port in Device Manager. |
| View drifts while looking ahead | Press **Recenter**. Make sure the 3-minute warm-up completed after power-up. |
| Octopus or head moves in the wrong direction | Check the axis signs in the firmware (`SIGN_YAW`, `SIGN_PITCH`, `SIGN_ROLL`). |
| Head model cut off or too small | Change `MARGIN` in `src/Head3D.jsx`. |
| `Frame error` lines in the bridge window | The bridge file was edited incorrectly. Replace it with the tested version. |

## Known limitations

- **Yaw drift:** The MPU6050 has no magnetometer, so yaw can't be anchored to true north. The firmware reduces drift, but recentering is still needed during long sessions.
- **Tilt leakage:** Tilting the head moves yaw by a few degrees. This is probably the board's mounting angle.
- **Warm-up:** The first 3 minutes after power-up are needed for stable readings.
- **OpenTrack check:** The browser can confirm that packets are sent, but only OpenTrack's own window confirms that it reads them.

## Possible upgrade

A BNO055 sensor includes a magnetometer and onboard fusion. It would remove most of the yaw drift.

