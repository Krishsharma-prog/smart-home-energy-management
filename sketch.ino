#include <DHT.h>

#define DHT_PIN 4
#define DHT_TYPE DHT22
#define PIR_PIN 13
#define POT_PIN 34
#define AC_PIN 25
#define HEATER_PIN 26
#define WASHER_PIN 33

DHT dht(DHT_PIN, DHT_TYPE);

enum SystemMode { MODE_MANUAL, MODE_AUTO };
SystemMode mode = MODE_AUTO;

float temperature = 28.0;
float humidity = 60.0;
int motion = LOW;
int potValue = 0;
float simulatedPower = 0.0;
int simulatedHour = 2;

bool acState = false;
bool heaterState = false;
bool washerState = false;

unsigned long lastSensorRead = 0;
unsigned long lastStatusPrint = 0;
const unsigned long SENSOR_INTERVAL = 2000;
const unsigned long STATUS_INTERVAL = 5000;

void setAC(bool state) { acState = state; digitalWrite(AC_PIN, state ? HIGH : LOW); }
void setHeater(bool state) { heaterState = state; digitalWrite(HEATER_PIN, state ? HIGH : LOW); }
void setWasher(bool state) { washerState = state; digitalWrite(WASHER_PIN, state ? HIGH : LOW); }

bool isOffPeak() { return simulatedHour >= 23 || simulatedHour < 6; }

String getTariff() {
  if (simulatedHour >= 18 && simulatedHour < 22) return "PEAK";
  if (isOffPeak()) return "OFF-PEAK";
  return "NORMAL";
}

float getTariffRate() {
  if (simulatedHour >= 18 && simulatedHour < 22) return 10.0;
  if (isOffPeak()) return 5.0;
  return 8.0;
}

void readSensors() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) temperature = t;
  if (!isnan(h)) humidity = h;
  motion = digitalRead(PIR_PIN);
  potValue = analogRead(POT_PIN);
  simulatedPower = (potValue / 4095.0) * 5.0;
}

void automaticControl() {
  setAC(motion == HIGH && temperature >= 28.0);
  setHeater(motion == HIGH && temperature <= 22.0 && simulatedPower < 4.0);
  setWasher(isOffPeak() && simulatedPower < 4.0);
}

void printStatus() {
  Serial.println();
  Serial.println("---------------- SMART ENERGY STATUS ----------------");
  Serial.print("MODE            : "); Serial.println(mode == MODE_AUTO ? "AUTO" : "MANUAL");
  Serial.print("TIME            : "); if (simulatedHour < 10) Serial.print('0'); Serial.print(simulatedHour); Serial.println(":00");
  Serial.print("TARIFF          : "); Serial.println(getTariff());
  Serial.print("RATE            : Rs."); Serial.print(getTariffRate(), 2); Serial.println("/kWh");
  Serial.print("TEMPERATURE     : "); Serial.print(temperature, 1); Serial.println(" C");
  Serial.print("HUMIDITY        : "); Serial.print(humidity, 1); Serial.println(" %");
  Serial.print("MOTION          : "); Serial.println(motion == HIGH ? "DETECTED" : "NO");
  Serial.print("SIMULATED LOAD  : "); Serial.print(simulatedPower, 2); Serial.println(" kW");
  Serial.print("AC              : "); Serial.println(acState ? "ON" : "OFF");
  Serial.print("WATER HEATER    : "); Serial.println(heaterState ? "ON" : "OFF");
  Serial.print("WASHING MACHINE : "); Serial.println(washerState ? "ON" : "OFF");
  Serial.println("------------------------------------------------------");
}

void help() {
  Serial.println();
  Serial.println("COMMANDS:");
  Serial.println("AUTO");
  Serial.println("MANUAL");
  Serial.println("AC ON / AC OFF");
  Serial.println("HEATER ON / HEATER OFF");
  Serial.println("WASHER ON / WASHER OFF");
  Serial.println("ALL ON / ALL OFF");
  Serial.println("TIME 0 ... TIME 23");
  Serial.println("STATUS");
  Serial.println("HELP");
  Serial.println();
}

void processCommand(String command) {
  command.trim();
  command.toUpperCase();
  if (!command.length()) return;

  Serial.print(">> "); Serial.println(command);

  if (command == "AUTO") {
    mode = MODE_AUTO;
    automaticControl();
    Serial.println("MODE = AUTO");
    printStatus();
    return;
  }

  if (command == "MANUAL") {
    mode = MODE_MANUAL;
    Serial.println("MODE = MANUAL");
    printStatus();
    return;
  }

  if (command == "AC ON") { mode = MODE_MANUAL; setAC(true); Serial.println("AC = ON"); return; }
  if (command == "AC OFF") { mode = MODE_MANUAL; setAC(false); Serial.println("AC = OFF"); return; }
  if (command == "HEATER ON") { mode = MODE_MANUAL; setHeater(true); Serial.println("WATER HEATER = ON"); return; }
  if (command == "HEATER OFF") { mode = MODE_MANUAL; setHeater(false); Serial.println("WATER HEATER = OFF"); return; }
  if (command == "WASHER ON") { mode = MODE_MANUAL; setWasher(true); Serial.println("WASHING MACHINE = ON"); return; }
  if (command == "WASHER OFF") { mode = MODE_MANUAL; setWasher(false); Serial.println("WASHING MACHINE = OFF"); return; }

  if (command == "ALL ON") {
    mode = MODE_MANUAL; setAC(true); setHeater(true); setWasher(true);
    Serial.println("ALL APPLIANCES = ON"); return;
  }

  if (command == "ALL OFF") {
    mode = MODE_MANUAL; setAC(false); setHeater(false); setWasher(false);
    Serial.println("ALL APPLIANCES = OFF"); return;
  }

  if (command.startsWith("TIME ")) {
    int hour = command.substring(5).toInt();
    if (hour >= 0 && hour <= 23) {
      simulatedHour = hour;
      Serial.print("SIMULATED TIME = "); if (hour < 10) Serial.print('0'); Serial.print(hour); Serial.println(":00");
      Serial.print("TARIFF = "); Serial.println(getTariff());
      if (mode == MODE_AUTO) automaticControl();
      printStatus();
    } else {
      Serial.println("INVALID TIME. Use TIME 0 to TIME 23.");
    }
    return;
  }

  if (command == "STATUS") { printStatus(); return; }
  if (command == "HELP") { help(); return; }

  Serial.println("UNKNOWN COMMAND. Type HELP.");
}

void readSerialCommands() {
  static String input = "";
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      processCommand(input);
      input = "";
    } else if (input.length() < 50) {
      input += c;
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(AC_PIN, OUTPUT);
  pinMode(HEATER_PIN, OUTPUT);
  pinMode(WASHER_PIN, OUTPUT);
  pinMode(PIR_PIN, INPUT);
  pinMode(POT_PIN, INPUT);

  dht.begin();
  setAC(false); setHeater(false); setWasher(false);

  Serial.println();
  Serial.println("==============================================");
  Serial.println("   TEAM DIAMOND SMART ENERGY SYSTEM");
  Serial.println("==============================================");
  Serial.println("SYSTEM STARTED - SERIAL COMMANDS ENABLED");
  help();

  readSensors();
  automaticControl();
  printStatus();
}

void loop() {
  readSerialCommands();

  if (millis() - lastSensorRead >= SENSOR_INTERVAL) {
    lastSensorRead = millis();
    readSensors();
    if (mode == MODE_AUTO) automaticControl();
  }

  if (millis() - lastStatusPrint >= STATUS_INTERVAL) {
    lastStatusPrint = millis();
    printStatus();
  }
}
