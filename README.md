# 🌟 AURUM MATRIX // Indian Gold & Global Macro Breakout Terminal

A high-performance personal live dashboard engineered to forecast and monitor **Gold Price Movements & Indian Retail Bullion Rates** through an interconnected matrix of global macroeconomic indicators, calibrated to [GRT Jewellers](https://www.grtjewels.com/) live rates and an **Autonomous 3-Hour Macro Forecast Engine (No API Key Required)**.

---

## 🇮🇳 Indian Retail Market Engine (Coins & Jewellery)

Designed specifically for Indian retail buyers to identify the **best possible buy windows** for 24K bullion coins and 22K hallmarked jewellery before major price spikes.

### Key Domestic Pricing Components Tracked:
* **GRT Jewellers Benchmark (22K 916 Hallmark):** **₹13,385 / 1 gram**
* **1 Sovereign / Pavan (8 Grams 22K):** **₹1,07,080** — Standard traditional wedding benchmark.
* **22K Standard Rate (10 Grams):** **₹1,33,850**
* **24K Pure Gold (999 Investment Coins & Bars):** **₹14,602 / 1g** (₹1,46,020 / 10g)
* **18K Gold (750 Setting):** **₹10,951 / 1g** (₹1,09,510 / 10g)
* **USD / INR Dynamic Currency Factor:** Tracks Rupee depreciation/appreciation. Since India imports ~90% of its bullion, a weakening Rupee raises domestic prices even when international gold is flat.
* **Customs Duty & Tax Structure:** Accounts for the post-Budget rationalized **6% Import Duty** and **3% GST**.

### Retail Store Billing Invoice Calculator:
Eliminates store confusion and hidden fees by calculating:
$$\text{Total Invoice} = \left(\text{Weight} \times \text{Base Rate} + \text{Making Charges (VA)}\right) \times 1.03 \; (\text{GST})$$
* Customizable making charges slider ($0\%$ for coins up to $25\%$ for bridal sets).
* Instant calculation of **All-Inclusive Effective Cost per Gram**.

---

## 🔄 Autonomous 3-Hour Bullion Forecaster (No API Key Needed)

Instead of requiring external API keys, the terminal features a fully autonomous **3-hour continuous evaluation routine**:

1. **Scheduled Evaluation:** Recalculates every 3 hours based on live Crude Oil, USD Index (DXY), 10Y Real Treasury Yields, CBOE VIX, USD/INR, and the active GRT rate.
2. **Real-Time Countdown:** Displays a live countdown to the next scheduled check (e.g. `02h 59m 40s`).
3. **⚡ Manual Check Now:** One-click instant evaluation without waiting 3 hours.
4. **4-Horizon Purchase Targets:**
   * **Next 3 Days (Dip Window):** 📉 **₹13,260 – ₹13,340 / g** (Save ~₹400–₹1,000 per Sovereign)
   * **Next 7 Days (Weekly Outlook):** ⚖️ **₹13,300 – ₹13,460 / g** (Stagger 50% now, 50% on dip)
   * **Next 14 Days (Fortnightly):** 📈 **₹13,420 – ₹13,620 / g** (Accumulate before month-end hike)
   * **Next 30 Days (Monthly Outlook):** 🚀 **₹13,550 – ₹13,900 / g** (Long-term secular buy bias)
5. **Audit History Log:** Expandable history table logging past 3-hour evaluations and validation statuses.
6. **Optional Gemini Provider:** Tucked into a collapsible accordion for users who still wish to connect a custom Google AI Studio key.

---

## ⚡ The 4 Core Global Macroeconomic Pillars

| Pillar | Indicator | Economic Mechanism | Correlation with Gold | Bullish Breakout Condition |
| :--- | :--- | :--- | :--- | :--- |
| **1. Inflation Engine** | **Crude Oil (WTI / Brent)** | Primary driver of supply-side inflation. Spikes in fuel escalate transportation and manufacturing costs worldwide. | **+0.74 (Strong Positive)** | **Crude Oil Spikes / Surges** |
| **2. Currency Denomination** | **US Dollar Index (DXY)** | Gold is globally priced in USD. A weaker dollar makes gold cheaper for foreign buyers (EUR, INR), driving massive accumulation. | **-0.83 (Strong Inverse)** | **USD Weakens / DXY Drops** |
| **3. Opportunity Cost** | **US 10Y Real Treasury Yields** | Gold is non-yielding. When real yields (bond return minus inflation) fall or turn negative, the penalty for holding gold vanishes. | **-0.79 (Strong Inverse)** | **Real Yields Plunge / Rate Cuts** |
| **4. Safe Haven Demand** | **CBOE Volatility Index (VIX)** | Equity sell-offs, geopolitical conflicts, or liquidity scares trigger capital flight into physical gold. | **+0.67 (Safe Haven)** | **VIX Surges / Market Panic** |

---

## 🚨 The "Perfect Storm" Breakout Formula

$$\text{Composite Breakout Score} = S_{\text{USD}} + S_{\text{Yields}} + S_{\text{Oil}} + S_{\text{VIX}} \quad \in [0, 100]$$

* **$\ge 80$ Points:** ⚡ **PERFECT STORM IMMINENT** (All 4 pillars bullishly aligned. Audio chime + visual strobe alert triggered).
* **65 – 79 Points:** 🟢 **STRONG BULLISH CONVERGENCE** (Yield & currency tailwinds active).
* **45 – 64 Points:** 🟡 **NEUTRAL / COMPETING FORCES** (Selective cross-currents; rangebound).
* **30 – 44 Points:** 🟠 **BEARISH HEADWINDS** (Rising dollar or Treasury yields creating carry drag).
* **< 30 Points:** 🔴 **STRONG BEARISH DRAG** (High real rates, surging dollar, subdued volatility).

---

## 🚀 Quick Start Guide

### Option 1: Live Node.js Server (Recommended)
```bash
npm start
# or: node server.js
```
Open **[http://localhost:3333](http://localhost:3333)** in your browser.

### Option 2: Direct Browser Launch (Zero-Setup Standalone)
Double-click `public/index.html` or run:
```bash
open public/index.html
```

---

## 🔑 How to Add Your Google AI Studio API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and generate a free API key.
2. In the dashboard, click **"⚙️ Manage Google API Key"** in the AI Forecast section.
3. Paste your key (`AIzaSy...`) and click **"Save Key"** (or click **"Test Key"** to verify connection).
4. Select your desired forecast horizon (e.g., *3 Days*) and target (*22K Wedding Jewellery*), then click **"✨ Generate N-Day AI Forecast"**!
