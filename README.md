# Predictive Smart Home Energy Management System

**Team Diamond** · Smart India Hackathon 2026
**Theme:** Green Tech, Home Tech · **PS Category:** Hardware

A localized hardware controller that shifts the operation of high-power household appliances (AC, water heater, washing machine) into off-peak hours based on occupancy, temperature, and simulated load — without sacrificing resident comfort.

---

## What this repo contains

This repo holds the **working prototype** built and simulated for SIH — an ESP32-based controller running rule-based automation, validated on Wokwi. It also documents the **proposed full-scale system** from our problem statement submission, which extends this prototype with on-device ML forecasting and real power metering.

| | Built (this repo) | Proposed full-scale system |
|---|---|---|
| Controller | ESP32 (simulated) | ESP32-S3 with TFLite-Micro |
| Decision logic | Rule-based thresholds | LSTM load forecasting + RL scheduling agent |
| Sensing | DHT22 (temp/humidity), PIR (occupancy), potentiometer (simulated load) | + SCT-013 / PZEM-004T real power metering |
| Switching | Digital pins → LEDs (simulated) | Zero-crossing SSRs for real AC loads |
| Security | — | Hardware AES-128/256 on external comms |
| Connectivity | Serial monitor commands | MQTT / Home Assistant integration |

The table above is deliberately explicit about the gap — the prototype proves the *control logic and automation flow*; the ML/real-sensor pieces are the roadmap, not yet implemented in code.

---

## How it works (as built)

The controller runs in `AUTO` or `MANUAL` mode.

**In `AUTO` mode**, every sensor read cycle (2s) it evaluates:

- **AC** → ON if motion is detected **and** temperature ≥ 28°C
- **Water heater** → ON if motion is detected **and** temperature ≤ 22°C **and** simulated load < 4 kW
- **Washing machine** → ON automatically during off-peak hours (23:00–06:00) if simulated load < 4 kW

A simulated clock (`TIME <hour>`) drives a simple three-tier tariff model (`PEAK` 18:00–22:00, `OFF-PEAK` 23:00–06:00, `NORMAL` otherwise), which is what the off-peak washer scheduling is built against.

**In `MANUAL` mode**, every appliance can be toggled directly over serial.

### Serial commands

| Command | Effect |
|---|---|
| `AUTO` / `MANUAL` | Switch control mode |
| `AC ON` / `AC OFF` | Toggle AC (switches to manual) |
| `HEATER ON` / `HEATER OFF` | Toggle water heater |
| `WASHER ON` / `WASHER OFF` | Toggle washing machine |
| `ALL ON` / `ALL OFF` | Toggle all appliances |
| `TIME <0-23>` | Set the simulated hour |
| `STATUS` | Print current system state |
| `HELP` | List all commands |

---

## Hardware / Simulation setup

Simulated end-to-end in [Wokwi](https://wokwi.com) — no physical hardware required to try it.

- **ESP32 DevKit V1** — main controller
- **DHT22** — temperature & humidity
- **PIR motion sensor** — occupancy
- **Potentiometer** — stands in for real-time power draw (0–5 kW)
- **3× LEDs** (red/blue/green) — represent AC, water heater, washing machine outputs

### Run it

1. Open [wokwi.com](https://wokwi.com/projects/new/esp32) and start a new ESP32 project.
2. Replace the sketch with [`firmware/smart_energy_system.ino`](firmware/smart_energy_system.ino).
3. Replace `diagram.json` with [`simulation/diagram.json`](simulation/diagram.json) from this repo.
4. Start the simulation and open the Serial Monitor (115200 baud) — try `HELP` to see all commands, or `TIME 2` to jump into off-peak hours and watch the washer kick in automatically.

*(Or paste the direct Wokwi project link here once you re-save it under your own account.)*

---

## Repository structure

```
.
├── firmware/
│   └── smart_energy_system.ino   # ESP32 sketch (rule-based control logic)
├── simulation/
│   └── diagram.json              # Wokwi circuit definition
├── docs/
│   └── pitch-deck.pdf            # Original SIH idea submission deck
└── README.md
```

---

## Proposed full-scale system

The full problem-statement vision extends this prototype with:

- **LSTM load forecasting** — multi-layer recurrent network for hourly demand prediction
- **Reinforcement learning scheduler** — balances tariff cost against comfort penalties
- **Edge inference** — quantized models via TensorFlow Lite Micro on ESP32-S3, zero cloud dependency
- **Real power metering** — SCT-013 current transformers + PZEM-004T
- **Zero-crossing SSR switching** — arc-free relay control for real inductive loads (up to 16A)
- **Hardware AES-128/256** — encrypted external communications
- **MQTT / Home Assistant** — standards-based integration instead of a proprietary hub

Projected impact figures from the original problem-statement analysis (not measured on this simulated prototype):

- ~22.5% average reduction in monthly electricity bills
- ~18.7% reduction in peak demand
- ~6.3% MAPE on hourly consumption forecasting

## Research basis

- Base paper — researchgate.net/publication/391851233
- [TensorFlow](https://github.com/tensorflow/tensorflow)
- [Home Assistant](https://github.com/home-assistant/core)
- [Eclipse Mosquitto](https://github.com/eclipse/mosquitto)
- [ESP-IDF](https://github.com/espressif/esp-idf)
- UK-DALE, Pecan Street, and REDD energy datasets
- IEEE 2030 Smart Grid Interoperability Standard

