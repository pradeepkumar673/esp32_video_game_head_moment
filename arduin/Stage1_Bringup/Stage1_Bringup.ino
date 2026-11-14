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

// ---------- Timing ----------
const uint32_t SAMPLE_US    = 5000;    // 200 Hz sampling
const uint32_t STREAM_EVERY = 4;       // 50 Hz output
const float    DT           = SAMPLE_US * 1e-6f;
const uint32_t WARMUP_MS    = 180000;  // 3 minutes at rest before calibrating
const uint32_t CAL_MS       = 10000;   // 10 seconds of calibration

// ---------- Filter ----------
const float GYRO_W = 0.98f;
const float ACC_W  = 0.02f;

// ---------- Still detection ----------
const int   WIN_SAMPLES = 200;   // 1-second windows
const float STILL_RANGE = 1.0f;  // dps swing allowed per axis

// ---------- Temperature model ----------
const double LAMBDA       = 0.995;  // forget old still points (about 200 s)
const double MIN_TEMP_VAR = 0.05;   // degC^2 of temperature spread needed to trust the slope
const double MAX_SLOPE    = 0.1;    // dps per degC sanity limit

// ---------- Auto-centering (firmware) ----------
const float DEAD_ZONE_DEG = 5.0f;
const float RECENTER_RATE = 0.2f;

// ---------- State ----------
float tRef = 0;                // reference temperature for the model
float b0[3] = {0, 0, 0};       // bias at tRef: gx, gy, gz
float kSlope[3] = {0, 0, 0};   // bias change per degC
float tempNow = 0;

double S1 = 0, ST = 0, STT = 0;          // decayed sums for the fit
double Sg[3] = {0, 0, 0}, STg[3] = {0, 0, 0};

float yaw = 0, pitch = 0, roll = 0;
float yawOff = 0, pitchOff = 0, rollOff = 0;
uint32_t nextUs = 0, sampleN = 0, seq = 0, i2cErrors = 0;

float wSum[3], wMin[3], wMax[3];
float wTempSum = 0, wAccSum = 0;
int   wCount = 0;

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

// Reads accel, gyro and die temperature in one burst.
bool readSample(float acc[3], float gyr[3], float &tempC) {
  uint8_t raw[14];
  if (!readRegs(0x3B, raw, 14)) return false;
  int16_t ax = (int16_t)((raw[0]  << 8) | raw[1]);
  int16_t ay = (int16_t)((raw[2]  << 8) | raw[3]);
  int16_t az = (int16_t)((raw[4]  << 8) | raw[5]);
  int16_t tr = (int16_t)((raw[6]  << 8) | raw[7]);
  int16_t gx = (int16_t)((raw[8]  << 8) | raw[9]);
  int16_t gy = (int16_t)((raw[10] << 8) | raw[11]);
  int16_t gz = (int16_t)((raw[12] << 8) | raw[13]);
  acc[0] = ax / ACCEL_LSB_PER_G;
  acc[1] = ay / ACCEL_LSB_PER_G;
  acc[2] = az / ACCEL_LSB_PER_G;
  gyr[0] = gx / GYRO_LSB_PER_DPS;
  gyr[1] = gy / GYRO_LSB_PER_DPS;
  gyr[2] = gz / GYRO_LSB_PER_DPS;
  tempC  = tr / 340.0f + 36.53f;
  return true;
}

// Bias at the current temperature
float biasAt(int i) {
  return b0[i] + kSlope[i] * (tempNow - tRef);
}

// ---------- Temperature model ----------
void fitModel() {
  if (S1 < 1e-6) return;
  double mT  = ST / S1;
  double var = STT / S1 - mT * mT;
  for (int i = 0; i < 3; i++) {
    double mg = Sg[i] / S1;
    if (var > MIN_TEMP_VAR) {
      double cov = STg[i] / S1 - mT * mg;
      double k = cov / var;
      if (k >  MAX_SLOPE) k =  MAX_SLOPE;
      if (k < -MAX_SLOPE) k = -MAX_SLOPE;
      kSlope[i] = (float)k;
    }
    b0[i] = (float)(mg - kSlope[i] * mT);
  }
}

void addStillPoint(const float gm[3], float tm) {
  double tc = tm - tRef;
  S1  = LAMBDA * S1 + 1.0;
  ST  = LAMBDA * ST + tc;
  STT = LAMBDA * STT + tc * tc;
  for (int i = 0; i < 3; i++) {
    Sg[i]  = LAMBDA * Sg[i]  + gm[i];
    STg[i] = LAMBDA * STg[i] + tc * gm[i];
  }
  fitModel();
}

void seedModel(const float gm[3], float tm) {
  tRef = tm;
  S1 = ST = STT = 0;
  for (int i = 0; i < 3; i++) {
    Sg[i] = STg[i] = 0;
    kSlope[i] = 0;
  }
  addStillPoint(gm, tm);
}

// ---------- Filter ----------
void integrate(const float a[3], const float g[3]) {
  yaw   += SIGN_YAW   * (g[0] - biasAt(0)) * DT;
  pitch += SIGN_PITCH * (g[2] - biasAt(2)) * DT;
  roll  += SIGN_ROLL  * (g[1] - biasAt(1)) * DT;

  float aMag = sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  if (fabsf(aMag - 1.0f) < 0.15f) {
    float pAcc = SIGN_PITCH * atan2f(a[1], a[0]) * RAD2DEG;
    float rAcc = SIGN_ROLL  * atan2f(-a[2], a[0]) * RAD2DEG;
    pitch = GYRO_W * pitch + ACC_W * pAcc;
    roll  = GYRO_W * roll  + ACC_W * rAcc;
  }
}

// ---------- Still windows: learn bias and auto-center ----------
void resetWindow() {
  for (int i = 0; i < 3; i++) {
    wSum[i] = 0;
    wMin[i] = 1e9f;
    wMax[i] = -1e9f;
  }
  wTempSum = 0;
  wAccSum = 0;
  wCount = 0;
}

void updateWindow(const float a[3], const float g[3], float T) {
  for (int i = 0; i < 3; i++) {
    wSum[i] += g[i];
    if (g[i] < wMin[i]) wMin[i] = g[i];
    if (g[i] > wMax[i]) wMax[i] = g[i];
  }
  wTempSum += T;
  wAccSum  += sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  wCount++;

  if (wCount < WIN_SAMPLES) return;

  bool still = true;
  for (int i = 0; i < 3; i++) {
    if (wMax[i] - wMin[i] > STILL_RANGE) still = false;
  }
  if (fabsf(wAccSum / wCount - 1.0f) > 0.03f) still = false;

  if (still) {
    float gm[3];
    for (int i = 0; i < 3; i++) gm[i] = wSum[i] / wCount;
    addStillPoint(gm, wTempSum / wCount);

    float ry = yaw - yawOff, rp = pitch - pitchOff, rr = roll - rollOff;
    if (fabsf(ry) < DEAD_ZONE_DEG && fabsf(rp) < DEAD_ZONE_DEG && fabsf(rr) < DEAD_ZONE_DEG) {
      yawOff   += RECENTER_RATE * ry;
      pitchOff += RECENTER_RATE * rp;
      rollOff  += RECENTER_RATE * rr;
    }
  }
  resetWindow();
}

// ---------- Warm-up and calibration ----------
void warmUp() {
  Serial.println("# WARM-UP: leave the glasses resting on the desk for 3 minutes");
  uint32_t t0 = millis();
  uint32_t lastMsg = t0;
  while (millis() - t0 < WARMUP_MS) {
    delay(1000);
    if (millis() - lastMsg >= 30000) {
      lastMsg = millis();
      float a[3], g[3], T = 0;
      if (readSample(a, g, T)) {
        Serial.printf("# warm-up %lu s  temp=%.1f C\n", (unsigned long)((millis() - t0) / 1000), T);
      }
    }
  }
}

void calibrate() {
  Serial.println("# CALIBRATING: keep the glasses still for 10 seconds");
  double gSum[3] = {0, 0, 0}, aSum[3] = {0, 0, 0}, tSum = 0;
  long n = 0;
  uint32_t t0 = millis();
  nextUs = micros();
  while (millis() - t0 < CAL_MS) {
    uint32_t nowUs = micros();
    if ((int32_t)(nowUs - nextUs) < 0) continue;
    nextUs += SAMPLE_US;
    float a[3], g[3], T = 0;
    if (!readSample(a, g, T)) continue;
    for (int i = 0; i < 3; i++) { gSum[i] += g[i]; aSum[i] += a[i]; }
    tSum += T;
    n++;
  }
  if (n < 100) {
    Serial.println("# CALIBRATION FAILED: too few samples. Check wiring.");
    return;
  }

  float gm[3], am[3];
  for (int i = 0; i < 3; i++) {
    gm[i] = gSum[i] / n;
    am[i] = aSum[i] / n;
  }
  float tm = tSum / n;

  seedModel(gm, tm);
  tempNow = tm;

  yaw = 0;
  pitch = SIGN_PITCH * atan2f(am[1], am[0]) * RAD2DEG;
  roll  = SIGN_ROLL  * atan2f(-am[2], am[0]) * RAD2DEG;
  yawOff = pitchOff = rollOff = 0;
  resetWindow();

  Serial.printf("# CALIBRATED bias gx=%+.2f gy=%+.2f gz=%+.2f temp=%.1fC (%ld samples)\n",
                gm[0], gm[1], gm[2], tm, n);
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

void printBias() {
  Serial.printf("# BIAS T=%.1fC gx=%+.2f gy=%+.2f gz=%+.2f slope gx=%+.4f gy=%+.4f gz=%+.4f dps/C\n",
                tempNow, biasAt(0), biasAt(1), biasAt(2),
                kSlope[0], kSlope[1], kSlope[2]);
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
  Serial.println("# Head Tracker Stage 3d: temperature-compensated bias");

  Wire.begin(21, 22);
  Wire.setClock(400000);
  writeReg(0x6B, 0x01);
  delay(100);
  writeReg(0x1A, 0x03);
  writeReg(0x19, 4);
  writeReg(0x1B, 0x08);
  writeReg(0x1C, 0x00);

  warmUp();
  calibrate();
  Serial.println("# STREAMING. Send 'r' to recenter, 'c' to recalibrate");
}

// ---------- Loop ----------
void loop() {
  handleCommands();

  uint32_t nowUs = micros();
  if ((int32_t)(nowUs - nextUs) < 0) return;
  nextUs += SAMPLE_US;

  float a[3], g[3], T = 0;
  if (!readSample(a, g, T)) {
    i2cErrors++;
    return;
  }
  tempNow = T;

  integrate(a, g);
  updateWindow(a, g, T);
  sampleN++;

  if (sampleN % STREAM_EVERY == 0) sendFrame();
  if (sampleN % 2000 == 0) printBias();
}