#include <Wire.h>
#include <math.h>

// ---------- MPU6050 ----------
const uint8_t MPU_ADDR = 0x68;
const float ACCEL_LSB_PER_G  = 16384.0f;  // ±2 g
const float GYRO_LSB_PER_DPS = 65.5f;     // ±500 dps
const float RAD2DEG = 180.0f / M_PI;

// ---------- Axis mapping (verified) ----------
const float SIGN_YAW   = -1.0f;
const float SIGN_PITCH = -1.0f;
const float SIGN_ROLL  = +1.0f;

// ---------- Timing and filter ----------
const uint32_t SAMPLE_US    = 5000;   // 200 Hz sampling
const uint32_t STREAM_EVERY = 4;      // send every 4th sample = 50 Hz
const float    DT           = SAMPLE_US * 1e-6f;
const float    GYRO_W       = 0.98f;
const float    ACC_W        = 0.02f;
const uint32_t CAL_MS       = 10000;

// ---------- Stillness-based bias tracking ----------
const int   WIN_SAMPLES = 200;     // 1 second window
const float STILL_RANGE = 1.0f;    // dps
const float BIAS_RATE   = 0.2f;

// ---------- Auto-centering ----------
const float DEAD_ZONE_DEG = 5.0f;  // auto-centering now handled by the bridge
const float RECENTER_RATE = 0.2f;  // fraction of the error corrected each still second

// ---------- State ----------
float bias[3] = {0, 0, 0};
float yaw = 0, pitch = 0, roll = 0;
float yawOff = 0, pitchOff = 0, rollOff = 0;
uint32_t nextUs = 0;
uint32_t sampleN = 0;
uint32_t seq = 0;
uint32_t i2cErrors = 0;

float wSum[3], wMin[3], wMax[3];
float wAccSum = 0;
int   wCount  = 0;

// ---------- I2C ----------
bool writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readRegs(uint8_t reg, uint8_t *buf, uint8_t len) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, (int)len) != len) return false;
  for (uint8_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

bool readSample(float acc[3], float gyr[3]) {
  uint8_t raw[14];
  if (!readRegs(0x3B, raw, 14)) return false;
  int16_t ax = (int16_t)((raw[0]  << 8) | raw[1]);
  int16_t ay = (int16_t)((raw[2]  << 8) | raw[3]);
  int16_t az = (int16_t)((raw[4]  << 8) | raw[5]);
  int16_t gx = (int16_t)((raw[8]  << 8) | raw[9]);
  int16_t gy = (int16_t)((raw[10] << 8) | raw[11]);
  int16_t gz = (int16_t)((raw[12] << 8) | raw[13]);
  acc[0] = ax / ACCEL_LSB_PER_G;
  acc[1] = ay / ACCEL_LSB_PER_G;
  acc[2] = az / ACCEL_LSB_PER_G;
  gyr[0] = gx / GYRO_LSB_PER_DPS;
  gyr[1] = gy / GYRO_LSB_PER_DPS;
  gyr[2] = gz / GYRO_LSB_PER_DPS;
  return true;
}

// ---------- Filter ----------
void integrate(const float a[3], const float g[3]) {
  yaw   += SIGN_YAW   * (g[0] - bias[0]) * DT;
  pitch += SIGN_PITCH * (g[2] - bias[2]) * DT;
  roll  += SIGN_ROLL  * (g[1] - bias[1]) * DT;

  float aMag = sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  if (fabsf(aMag - 1.0f) < 0.15f) {
    float pAcc = SIGN_PITCH * atan2f(a[1], a[0]) * RAD2DEG;
    float rAcc = SIGN_ROLL  * atan2f(-a[2], a[0]) * RAD2DEG;
    pitch = GYRO_W * pitch + ACC_W * pAcc;
    roll  = GYRO_W * roll  + ACC_W * rAcc;
  }
}

// ---------- Stillness tracking and auto-centering ----------
void resetWindow() {
  for (int i = 0; i < 3; i++) {
    wSum[i] = 0;
    wMin[i] = 1e9f;
    wMax[i] = -1e9f;
  }
  wAccSum = 0;
  wCount = 0;
}

void updateBias(const float a[3], const float g[3]) {
  for (int i = 0; i < 3; i++) {
    wSum[i] += g[i];
    if (g[i] < wMin[i]) wMin[i] = g[i];
    if (g[i] > wMax[i]) wMax[i] = g[i];
  }
  wAccSum += sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  wCount++;

  if (wCount < WIN_SAMPLES) return;

  bool still = true;
  for (int i = 0; i < 3; i++) {
    if (wMax[i] - wMin[i] > STILL_RANGE) still = false;
  }
  float accMean = wAccSum / wCount;
  if (fabsf(accMean - 1.0f) > 0.03f) still = false;

  if (still) {
    // 1. Refine the gyro bias
    for (int i = 0; i < 3; i++) {
      float m = wSum[i] / wCount;
      bias[i] += BIAS_RATE * (m - bias[i]);
    }

    // 2. If the head is still and near center, move the center to where it is.
    //    Drift is removed. Looking more than 5 degrees away is left alone.
    float ry = yaw   - yawOff;
    float rp = pitch - pitchOff;
    float rr = roll  - rollOff;
    if (fabsf(ry) < DEAD_ZONE_DEG && fabsf(rp) < DEAD_ZONE_DEG && fabsf(rr) < DEAD_ZONE_DEG) {
      yawOff   += RECENTER_RATE * ry;
      pitchOff += RECENTER_RATE * rp;
      rollOff  += RECENTER_RATE * rr;
    }
  }
  resetWindow();
}

// ---------- Calibration (startup and 'c') ----------
void calibrate() {
  Serial.println("# CALIBRATING: keep your head still for 10 seconds");
  double gSum[3] = {0, 0, 0}, aSum[3] = {0, 0, 0};
  long n = 0;
  uint32_t t0 = millis();
  nextUs = micros();
  while (millis() - t0 < CAL_MS) {
    uint32_t nowUs = micros();
    if ((int32_t)(nowUs - nextUs) < 0) continue;
    nextUs += SAMPLE_US;
    float a[3], g[3];
    if (!readSample(a, g)) continue;
    for (int i = 0; i < 3; i++) { gSum[i] += g[i]; aSum[i] += a[i]; }
    n++;
  }
  if (n < 100) {
    Serial.println("# CALIBRATION FAILED: too few samples. Check wiring.");
    return;
  }
  for (int i = 0; i < 3; i++) bias[i] = gSum[i] / n;
  float ax = aSum[0] / n, ay = aSum[1] / n, az = aSum[2] / n;
  yaw = 0;
  pitch = SIGN_PITCH * atan2f(ay, ax) * RAD2DEG;
  roll  = SIGN_ROLL  * atan2f(-az, ax) * RAD2DEG;
  yawOff = pitchOff = rollOff = 0;
  resetWindow();
  Serial.printf("# CALIBRATED bias gx=%+.2f gy=%+.2f gz=%+.2f (%ld samples)\n",
                bias[0], bias[1], bias[2], n);
  nextUs = micros();
}

// ---------- Framing ----------
// Frame: $HT,<seq>,<yaw>,<pitch>,<roll>,<i2cErrors>*<XOR checksum>
void sendFrame() {
  char body[96];
  snprintf(body, sizeof(body), "HT,%lu,%.2f,%.2f,%.2f,%lu",
           (unsigned long)seq,
           yaw - yawOff, pitch - pitchOff, roll - rollOff,
           (unsigned long)i2cErrors);
  uint8_t cs = 0;
  for (const char *p = body; *p; p++) cs ^= (uint8_t)*p;
  Serial.printf("$%s*%02X\n", body, cs);
  seq++;
}

// ---------- Commands from the laptop ----------
void handleCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'r') {
      yawOff = yaw; pitchOff = pitch; rollOff = roll;
      Serial.println("# RECENTERED");
    } else if (c == 'c') {
      calibrate();
    }
  }
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("# Head Tracker Stage 3c: stillness bias + auto-center");

  Wire.begin(21, 22);
  Wire.setClock(400000);
  writeReg(0x6B, 0x01);
  delay(100);
  writeReg(0x1A, 0x03);
  writeReg(0x19, 4);
  writeReg(0x1B, 0x08);
  writeReg(0x1C, 0x00);

  calibrate();
  Serial.println("# STREAMING. Send 'r' to recenter, 'c' to recalibrate");
}

// ---------- Loop ----------
void loop() {
  handleCommands();

  uint32_t nowUs = micros();
  if ((int32_t)(nowUs - nextUs) < 0) return;
  nextUs += SAMPLE_US;

  float a[3], g[3];
  if (!readSample(a, g)) {
    i2cErrors++;
    return;
  }

  integrate(a, g);
  updateBias(a, g);
  sampleN++;

  if (sampleN % STREAM_EVERY == 0) sendFrame();

  if (sampleN % 2000 == 0) {  // every 10 seconds
    Serial.printf("# BIAS gx=%+.2f gy=%+.2f gz=%+.2f\n", bias[0], bias[1], bias[2]);
  }
}